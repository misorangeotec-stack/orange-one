-- OCPI-14 · Phase 3 — the SERVER switches from the machine to the category.
--
-- This is the first file in OCPI-14 that changes behaviour. Phases 1 and 2 added
-- nine columns and filled them; nothing read any of them. From here on:
--
--   the Dryer card + its shipment row        machine.needs_dryer            -> category.shows_dryer
--   the Centering inclusion + shipment row   machine.opt_external_centering -> category.shows_centering
--   air blade / ink dust / chilling          asked on every deal            -> category.shows_extras
--   head / ink / spares shipment rows        the deal's own inclusion       -> asked always
--
-- ⚠ WHY THIS IS SAFE TO APPLY BEFORE THE FRONTEND SHIPS. Phase 2 made
--   needs_dryer agree with shows_dryer on all 28 machines, so the dryer rule is
--   IDENTICAL either way. shows_centering is strictly WIDER than
--   opt_external_centering (it adds Fab Pro 1I/2I/3I), and wider clears less.
--   The only narrowing is the three extras, which the old form still shows on a
--   non-Direct deal and this file now stores as false -- and per the client's
--   sheet false is the correct answer on all 17 of those machines. So the window
--   is cosmetic. Keep it to minutes anyway.
--
-- ⚠ BASED ON THE LIVE FUNCTION BODIES, captured with pg_get_functiondef into
--   supabase/backups/ocpi-14/*.live.sql and md5-verified against the database.
--   NOT on the newest migration file -- these two have been redefined six times
--   and the files diverge.
--
-- ⚠ fms_ocpi_save_draft IS NOT TOUCHED, and that is a finding rather than an
--   oversight. Its ~53-key array gates only whether write_oc runs; incl_centering
--   and centering_details are part A, and write_quotation is called
--   unconditionally. air_blade is already in the array, and the form sends the
--   whole payload every time, so write_oc still runs on every save.

begin;

-- ── 3.0 · the tick's answer moves into the new question ─────────────────────
--
-- 15 of the 20 deals on record answered "External centering system", all Yes.
-- 11 of those are on a category that still asks about centering; their answer
-- moves to incl_centering so the new question opens showing what the deal
-- already agreed rather than blank.
--
-- 🔴 THE OTHER 4 ARE LEFT WHERE THEY ARE, DELIBERATELY. They sit on Sublimation
--    deals -- answered before OCPI-10 gated the extras -- and Sublimation no
--    longer asks the question at all. Copying them forward would put a value on
--    a deal whose form cannot show it, which the RPC below would then clear on
--    the next save. external_centering keeps them, frozen and still readable in
--    the register and the revision diff.
update public.fms_ocpi_deals d
   set incl_centering = d.external_centering
  from public.fms_ocpi_machine_categories c
 where c.id = d.machine_category_id
   and coalesce(c.shows_centering, false)
   and d.external_centering is not null
   and d.incl_centering is null;

-- ── 3.1 · part A ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fms_ocpi_write_quotation(p_deal uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gst_available boolean := (p->>'gst_available')::boolean;
  v_incl_ink      boolean := (p->>'incl_ink')::boolean;
  v_incl_spares   boolean := (p->>'incl_spares')::boolean;
  v_incl_head     boolean := (p->>'incl_head')::boolean;
  v_transport     text    := nullif(btrim(p->>'transport_terms'), '');
  v_currency      text    := case when nullif(btrim(p->>'transport_terms'), '') = 'high_seas' then 'USD'
                                  else nullif(btrim(p->>'deal_value_currency'), '') end;
  v_amount        numeric := nullif(p->>'deal_value_amount', '')::numeric;
  v_fx            numeric := nullif(p->>'fx_rate', '')::numeric;
  v_machine       uuid    := nullif(p->>'machine_id', '')::uuid;
  -- NEW (OCPI-14) · THE DEAL'S OWN CATEGORY, and the two flags part A needs.
  -- v_cat is what gets STORED; the flags are what the branches read.
  v_cat_in        uuid    := nullif(p->>'machine_category_id', '')::uuid;
  v_cat           uuid;
  v_shows_dryer     boolean;
  v_shows_centering boolean;
  v_incl_centering  boolean := (p->>'incl_centering')::boolean;
  v_ink_offer     boolean := (p->>'ink_offer_agreed')::boolean;
  v_ink_qty       numeric := nullif(p->>'ink_offer_qty', '')::numeric;
  v_ink_rate      numeric := nullif(p->>'ink_offer_rate', '')::numeric;
  v_head_offer    boolean := (p->>'head_offer_agreed')::boolean;
  v_head_qty      integer := nullif(p->>'head_offer_qty', '')::integer;
  v_head_rate     numeric := nullif(p->>'head_offer_rate', '')::numeric;
begin
  -- ⚠ THE CATEGORY IS READ FROM THE PAYLOAD, NOT THE ROW, for exactly the reason
  --   the machine always has been: this statement is what SETS
  --   machine_category_id, so reading it back would test the PREVIOUS category
  --   and keep the old branch for one more save.
  --
  -- ⚠ AND IT FALLS BACK TO THE MACHINE'S OWN CATEGORY. Three cases need it:
  --   a payload from a form that predates this change; a salesperson who cleared
  --   the category filter to browse across types while a machine is selected;
  --   and any caller that does not know about the field. In all three the
  --   machine's category IS the answer -- the form snaps the two together on
  --   every pick, and this is the server saying the same thing.
  v_cat := coalesce(v_cat_in,
                    (select m.category_id from public.fms_ocpi_machines m where m.id = v_machine));

  -- NULL IS "ASK NOTHING EXTRA", never "ask everything" -- matching
  -- `?? false` in branching.ts. A deal with no machine and no category yet is
  -- the ordinary state of a brand-new draft.
  select c.shows_dryer, c.shows_centering
    into v_shows_dryer, v_shows_centering
    from public.fms_ocpi_machine_categories c
   where c.id = v_cat;

  update public.fms_ocpi_deals set
    salesperson_name   = nullif(btrim(p->>'salesperson_name'), ''),
    salesperson_user_id = nullif(p->>'salesperson_user_id', '')::uuid,
    customer_id        = nullif(p->>'customer_id', '')::uuid,
    customer_name      = nullif(btrim(p->>'customer_name'), ''),
    customer_address   = nullif(btrim(p->>'customer_address'), ''),
    customer_attn      = nullif(btrim(p->>'customer_attn'), ''),
    customer_email     = nullif(lower(btrim(p->>'customer_email')), ''),
    customer_mobile    = nullif(regexp_replace(
                           regexp_replace(coalesce(p->>'customer_mobile',''), '\D', '', 'g'),
                           '^(91|0)(?=[0-9]{10}$)', ''), ''),
    gst_available      = v_gst_available,
    gst_no             = case when v_gst_available is distinct from true then null
                              else nullif(upper(btrim(p->>'gst_no')), '') end,
    company_id         = nullif(p->>'company_id', '')::uuid,
    location_id        = nullif(p->>'location_id', '')::uuid,
    machine_count      = nullif(p->>'machine_count', '')::integer,
    machine_id         = v_machine,
    machine_category_id = v_cat,
    head_type          = nullif(btrim(p->>'head_type'), ''),
    head_count         = nullif(p->>'head_count', '')::integer,
    ink_type           = nullif(btrim(p->>'ink_type'), ''),
    ink_price          = nullif(btrim(p->>'ink_price'), ''),
    ink_credit_terms   = nullif(btrim(p->>'ink_credit_terms'), ''),
    incl_ink           = v_incl_ink,
    ink_qty_included   = case when v_incl_ink is distinct from true then null
                              else nullif(btrim(p->>'ink_qty_included'), '') end,
    -- OCPI-7 · THE INVERTED GUARD. "is distinct from false" is true for TRUE and
    -- for NULL alike -- exactly the answers that must store nothing.
    ink_offer_agreed   = case when v_incl_ink is distinct from false then null
                              else v_ink_offer end,
    ink_offer_qty      = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true then null
                              else v_ink_qty end,
    ink_offer_rate     = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true then null
                              else v_ink_rate end,
    ink_offer_subtotal = case when v_incl_ink is distinct from false
                                or v_ink_offer is distinct from true
                                or v_ink_qty is null or v_ink_rate is null then null
                              else round(v_ink_qty * v_ink_rate, 2) end,
    incl_spares        = v_incl_spares,
    spare_details      = case when v_incl_spares is distinct from true then null
                              else nullif(btrim(p->>'spare_details'), '') end,
    -- NEW (OCPI-14) · THE CENTERING DEVICE IS A DEAL INCLUSION, shaped exactly
    -- like spare parts above it: a Yes/No, and one free-text box on Yes. It
    -- REPLACES the "External centering system" tick, which was one of four
    -- ungated ticks in "Also included" and read the MACHINE's capability.
    -- Asked only where the category says so; there is no subsidized-rate branch.
    incl_centering     = case when not coalesce(v_shows_centering, false) then null
                              else v_incl_centering end,
    centering_details  = case when not coalesce(v_shows_centering, false)
                                or v_incl_centering is distinct from true then null
                              else nullif(btrim(p->>'centering_details'), '') end,
    incl_head          = v_incl_head,
    heads_included     = case when v_incl_head is distinct from true then null
                              else nullif(p->>'heads_included', '')::integer end,
    head_offer_agreed   = case when v_incl_head is distinct from false then null
                               else v_head_offer end,
    head_offer_qty      = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true then null
                               else v_head_qty end,
    head_offer_rate     = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true then null
                               else v_head_rate end,
    head_offer_subtotal = case when v_incl_head is distinct from false
                                 or v_head_offer is distinct from true
                                 or v_head_qty is null or v_head_rate is null then null
                               else round(v_head_qty * v_head_rate, 2) end,
    -- CHANGED (OCPI-14): the dryer CATEGORY is kept for a deal whose MACHINE
    -- CATEGORY carries a dryer. It used to read the machine's own capability
    -- flag; the two agree on all 28 machines after Phase 2, so this line changes
    -- nothing today and everything the day a machine is re-categorised.
    -- ⚠ Assertion 1 forbids naming that flag here, comments included.
    dryer_type         = case when not coalesce(v_shows_dryer, false) then null
                              else nullif(btrim(p->>'dryer_type'), '') end,
    deal_value_currency = v_currency,
    deal_value_amount   = v_amount,
    fx_rate            = case when v_currency = 'USD' then v_fx else null end,
    fx_rate_at         = case when v_currency = 'USD'
                              then nullif(p->>'fx_rate_at', '')::timestamptz else null end,
    fx_rate_source     = case when v_currency = 'USD'
                              then nullif(btrim(p->>'fx_rate_source'), '') else null end,
    fx_rate_overridden = case when v_currency = 'USD'
                              then (p->>'fx_rate_overridden')::boolean else null end,
    deal_value_inr     = case when v_currency = 'USD' and v_fx is not null and v_amount is not null
                              then round(v_amount * v_fx, 2) else null end,
    payment_type        = nullif(btrim(p->>'payment_type'), ''),
    payment_terms       = nullif(btrim(p->>'payment_terms'), ''),
    delivery_date       = nullif(p->>'delivery_date', '')::date,
    transport_terms     = v_transport,
    high_seas_via       = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_via'), '') end,
    high_seas_cost_by   = case when v_transport is distinct from 'high_seas' then null
                               else nullif(btrim(p->>'high_seas_cost_by'), '') end,
    local_cost_by       = case when v_transport is distinct from 'local' then null
                               else nullif(btrim(p->>'local_cost_by'), '') end,
    remarks              = nullif(btrim(p->>'remarks'), ''),
    dollar_clause_agreed = case when v_currency is distinct from 'USD' then null
                                else (p->>'dollar_clause_agreed')::boolean end
  where id = p_deal;
end $function$;

-- ── 3.2 · part B ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠ v_incl_head SURVIVES ALONE, and its two neighbours did not (OCPI-14).
  --   incl_spares and incl_ink gated only the spares and ink shipment rows,
  --   which no longer branch on the deal's inclusions at all -- so keeping the
  --   variables would have left two reads that decide nothing. v_incl_head is
  --   still needed by head_balance_remarks, which is NOT a shipment field and
  --   keeps its rule.
  v_incl_head   boolean;
  v_transport   text;
  v_currency    text;
  v_amount      numeric;
  v_inr         numeric;
  v_fx          numeric;
  v_ship_mode   text := nullif(btrim(p->>'head_ship_mode'), '');
  v_rate        numeric;
  v_value       numeric;
  v_gst         numeric;
  v_has_dryer   boolean;
  v_dryer_cat   text;
  v_no_dryer    boolean;
  -- NEW (OCPI-14) · THE THREE CATEGORY FLAGS, replacing the two machine
  -- capability columns this function used to read. Those columns still exist and
  -- are still edited on the Machines master, but they are INFORMATION ONLY from
  -- here -- the client's decision, 01-Sep-2026.
  --
  -- ⚠ DO NOT NAME THOSE TWO COLUMNS ANYWHERE IN THIS FUNCTION, comments
  --   included. Assertion 1 greps this function's own definition for them and
  --   pg_get_functiondef returns the comments too, so a helpful note explaining
  --   what they used to do would fail the migration. The predecessor of this
  --   function carried the same warning about three other names.
  v_shows_dryer     boolean;
  v_shows_centering boolean;
  v_shows_extras    boolean;
  v_dry_price   numeric;
  v_dry_inr     numeric;
  v_dry_gst     numeric;
  v_grand       numeric;
  v_ink_ship    text := nullif(btrim(p->>'ink_ship_mode'), '');
  v_dry_ship    text := nullif(btrim(p->>'dryer_ship_mode'), '');
  v_spr_ship    text := nullif(btrim(p->>'spares_ship_mode'), '');
  v_cen_ship    text := nullif(btrim(p->>'centering_ship_mode'), '');
  v_ink_inv     boolean := (p->>'ink_separate_invoice')::boolean;
  v_dry_inv     boolean := (p->>'dryer_separate_invoice')::boolean;
  v_spr_inv     boolean := (p->>'spares_separate_invoice')::boolean;
  v_cen_inv     boolean := (p->>'centering_separate_invoice')::boolean;
  v_head_inv    boolean := (p->>'head_separate_invoice')::boolean;
  v_head_q      integer := nullif(p->>'head_invoice_qty', '')::integer;
  v_head_a      numeric := nullif(p->>'head_invoice_amount', '')::numeric;
  v_ink_q       integer := nullif(p->>'ink_invoice_qty', '')::integer;
  v_ink_a       numeric := nullif(p->>'ink_invoice_amount', '')::numeric;
  v_dry_q       integer := nullif(p->>'dryer_invoice_qty', '')::integer;
  v_dry_a       numeric := nullif(p->>'dryer_invoice_amount', '')::numeric;
  v_spr_q       integer := nullif(p->>'spares_invoice_qty', '')::integer;
  v_spr_a       numeric := nullif(p->>'spares_invoice_amount', '')::numeric;
  v_cen_q       integer := nullif(p->>'centering_invoice_qty', '')::integer;
  v_cen_a       numeric := nullif(p->>'centering_invoice_amount', '')::numeric;
begin
  -- ⚠ THE SELECT LIST AND THE INTO LIST MUST STAY ALIGNED. Two machine columns
  --   and two targets came out here and three category flags went in (OCPI-14).
  --   Assign shows_centering into the wrong target and a whole block starts
  --   obeying the wrong answer, silently. Assertion 6 checks the count.
  --
  -- ⚠ THE CATEGORY IS READ OFF THE ROW, like every other branch input here, and
  --   that is safe because fms_ocpi_save_draft calls fms_ocpi_write_quotation --
  --   which OWNS machine_category_id -- before it calls this function.
  --
  -- ⚠ THE MACHINE JOIN SURVIVES FOR ONE PURPOSE ONLY: coalesce onto the
  --   machine's own category, for a row written before machine_category_id
  --   existed. Phase 2 back-filled all 20, so this is a safety net rather than a
  --   second rule; delete the coalesce and a draft saved by an older client
  --   silently loses its dryer answers.
  select d.incl_head, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr, d.fx_rate,
         nullif(btrim(coalesce(d.dryer_type, '')), ''),
         t.means_no_dryer,
         c.shows_dryer, c.shows_centering, c.shows_extras
    into v_incl_head, v_transport,
         v_currency, v_amount, v_inr, v_fx,
         v_dryer_cat,
         v_no_dryer,
         v_shows_dryer, v_shows_centering, v_shows_extras
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
    left join public.fms_ocpi_dryer_types t on t.name = d.dryer_type
    left join public.fms_ocpi_machine_categories c
           on c.id = coalesce(d.machine_category_id, m.category_id)
   where d.id = p_deal;

  -- ⚠ THE CATEGORY OPENS THE SECTION; THE DRYER CATEGORY DECIDES WHETHER IT
  --   HOLDS ANYTHING. The first line was `v_has_dryer is true` off the machine
  --   until OCPI-14; the second and third are OCPI-8 and are unchanged.
  --   Every dryer clearing below reads this one variable, so these three lines
  --   govern the six detail columns, dryer_price and its three derived rupee
  --   figures, and the six shipment columns alike.
  --
  --   ⚠ ITS TWIN IS `hasDryerDetails` in branching.ts. Change one, change both.
  v_has_dryer := coalesce(v_shows_dryer, false)
                 and v_dryer_cat is not null
                 and coalesce(v_no_dryer, false) = false;

  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  -- ⚠ THE DRYER PRICE QUESTION IS GONE FROM THE FORM (OCPI-14) and this
  --   derivation is deliberately LEFT STANDING. The form no longer sends the
  --   key, so p->>'dryer_price' is null, v_dry_price is null, the two rupee
  --   figures are null and v_grand collapses to v_value + v_gst through guards
  --   that already existed. Nothing had to change here, and changing it would
  --   have been risk for no gain: 0 of the 20 deals on record carry a price, and
  --   an older deal that did would still convert correctly.
  v_dry_price := case when not v_has_dryer or (p->>'dryer_included')::boolean is not false
                      then null else nullif(p->>'dryer_price', '')::numeric end;

  v_dry_inr := case
                 when v_dry_price is null then null
                 when v_currency = 'USD'
                   then case when v_fx is null then null else round(v_dry_price * v_fx, 2) end
                 else v_dry_price
               end;

  v_dry_gst := case when v_rate is null or v_dry_inr is null then null
                    else round(v_dry_inr * v_rate / 100, 2) end;

  -- 🔴 NOT ONE SHIPMENT SUB-TOTAL APPEARS IN THIS SUM, and none ever may. Every
  --    figure added here belongs to the machine contract; a separately-invoiced
  --    item is billed on its own document and would be charged twice.
  v_grand := case when v_value is null then null
                  else v_value + coalesce(v_gst, 0)
                       + coalesce(v_dry_inr, 0) + coalesce(v_dry_gst, 0) end;

  update public.fms_ocpi_deals set
    -- ── SHIPMENT & INVOICE · DETACHED FROM THE DEAL INCLUSIONS (OCPI-14) ─────
    --
    -- Head, ink and spare parts are now asked on EVERY deal. How a thing ships
    -- and whether it is billed on its own document is not the same question as
    -- whether it sits inside the machine price -- a customer can be invoiced
    -- separately for a head the deal does not include, which is precisely what
    -- OCPI-7's subsidized-rate block records.
    --
    -- ⚠ THE ROW'S OWN NESTED CONDITIONS ARE UNCHANGED: a route only for a
    --   separate shipment, a qty/amount only for a separate invoice.
    head_ship_mode        = v_ship_mode,
    head_ship_via         = case when v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    -- ⚠ NOT A SHIPMENT FIELD, and it keeps its rule. This is what blanks the
    --   stored text when a deal that had a head stops including one; the box was
    --   removed from the form in OCPI-3 stage H but 13 of the deals on record
    --   hold something here and can still be edited.
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = v_head_inv,
    head_invoice_qty      = case when v_head_inv is distinct from true then null else v_head_q end,
    head_invoice_amount   = case when v_head_inv is distinct from true then null else v_head_a end,
    head_invoice_subtotal = case when v_head_inv is distinct from true
                                   or v_head_q is null or v_head_a is null
                                 then null else round(v_head_q * v_head_a, 2) end,

    ink_ship_mode        = v_ink_ship,
    ink_ship_via         = case when v_ink_ship is distinct from 'separate'
                                then null else nullif(btrim(p->>'ink_ship_via'), '') end,
    ink_separate_invoice = v_ink_inv,
    ink_invoice_qty      = case when v_ink_inv is distinct from true then null else v_ink_q end,
    ink_invoice_amount   = case when v_ink_inv is distinct from true then null else v_ink_a end,
    ink_invoice_subtotal = case when v_ink_inv is distinct from true
                                  or v_ink_q is null or v_ink_a is null
                                then null else round(v_ink_q * v_ink_a, 2) end,

    dryer_chambers  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_chambers'), '') end,
    heating_mode    = case when not v_has_dryer then null else nullif(btrim(p->>'heating_mode'), '') end,
    dryer_warranty  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_warranty'), '') end,
    platter_details = nullif(btrim(p->>'platter_details'), ''),

    dryer_name      = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_name'), '') end,
    dryer_included  = case when not v_has_dryer then null else (p->>'dryer_included')::boolean end,
    dryer_price     = v_dry_price,

    dryer_ship_mode        = case when not v_has_dryer then null else v_dry_ship end,
    dryer_ship_via         = case when not v_has_dryer or v_dry_ship is distinct from 'separate'
                                  then null else nullif(btrim(p->>'dryer_ship_via'), '') end,
    dryer_separate_invoice = case when not v_has_dryer then null else v_dry_inv end,
    dryer_invoice_qty      = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else v_dry_q end,
    dryer_invoice_amount   = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else v_dry_a end,
    dryer_invoice_subtotal = case when not v_has_dryer or v_dry_inv is distinct from true
                                    or v_dry_q is null or v_dry_a is null
                                  then null else round(v_dry_q * v_dry_a, 2) end,

    spares_ship_mode        = v_spr_ship,
    spares_ship_via         = case when v_spr_ship is distinct from 'separate'
                                   then null else nullif(btrim(p->>'spares_ship_via'), '') end,
    spares_separate_invoice = v_spr_inv,
    spares_invoice_qty      = case when v_spr_inv is distinct from true then null else v_spr_q end,
    spares_invoice_amount   = case when v_spr_inv is distinct from true then null else v_spr_a end,
    spares_invoice_subtotal = case when v_spr_inv is distinct from true
                                     or v_spr_q is null or v_spr_a is null
                                   then null else round(v_spr_q * v_spr_a, 2) end,

    -- ⚠ CENTERING IS THE ONE SHIPMENT ROW THAT IS STILL GATED, and it is now the
    --   CATEGORY that gates it rather than the machine. Wider than before: the
    --   three Fab Pro models are Direct but are mapped as unable to carry a
    --   centering device, and they will now be asked anyway.
    centering_ship_mode        = case when not coalesce(v_shows_centering, false) then null else v_cen_ship end,
    centering_ship_via         = case when not coalesce(v_shows_centering, false)
                                        or v_cen_ship is distinct from 'separate'
                                      then null else nullif(btrim(p->>'centering_ship_via'), '') end,
    centering_separate_invoice = case when not coalesce(v_shows_centering, false) then null else v_cen_inv end,
    centering_invoice_qty      = case when not coalesce(v_shows_centering, false) or v_cen_inv is distinct from true
                                      then null else v_cen_q end,
    centering_invoice_amount   = case when not coalesce(v_shows_centering, false) or v_cen_inv is distinct from true
                                      then null else v_cen_a end,
    centering_invoice_subtotal = case when not coalesce(v_shows_centering, false) or v_cen_inv is distinct from true
                                        or v_cen_q is null or v_cen_a is null
                                      then null else round(v_cen_q * v_cen_a, 2) end,

    -- ── THE THREE EXTRAS · RE-GATED, AND FALSE IS NOT NULL (OCPI-14) ─────────
    --
    -- OCPI-10 ungated these four days ago because the machine mapping was
    -- hiding questions people needed. The client's 01-09 sheet answers it
    -- properly: the four extras are mapped against DIRECT machines only and read
    -- "no" for every Sublimation, Other and POD model. So they are asked on a
    -- Direct deal and not asked anywhere else.
    --
    -- 🔴 STORED AS false, NOT NULL, WHERE THEY ARE NOT ASKED -- the only place in
    --    this module where a hidden boolean does not clear to null. Ritesh Bhai
    --    asked for a definite "No", not an unanswered question, so the papers can
    --    state it. branching.ts carries the matching exception in clearHidden;
    --    if the two ever disagree the answer flickers between null and false on
    --    alternate saves.
    air_blade           = case when coalesce(v_shows_extras, false)
                               then (p->>'air_blade')::boolean else false end,
    ink_dust_exhauster  = case when coalesce(v_shows_extras, false)
                               then (p->>'ink_dust_exhauster')::boolean else false end,
    chilling_system     = case when coalesce(v_shows_extras, false)
                               then (p->>'chilling_system')::boolean else false end,

    -- ⚠ external_centering IS NO LONGER WRITTEN AT ALL, and its absence from
    --   this list is deliberate. The tick it stored was replaced by the
    --   incl_centering / centering_details pair in part A. The column is FROZEN
    --   HISTORY: 15 deals answered it, 11 of them had their answer copied
    --   forward by this migration, and the 4 on Sublimation keep theirs here
    --   because their category no longer asks. Writing it would null all 15 the
    --   first time anybody re-saved an old deal.

    other_inclusions         = nullif(btrim(p->>'other_inclusions'), ''),

    other_commitments        = nullif(btrim(p->>'other_commitments'), ''),
    printer_warranty         = nullif(btrim(p->>'printer_warranty'), ''),
    head_warranty            = nullif(btrim(p->>'head_warranty'), ''),
    post_warranty_head_price = nullif(p->>'post_warranty_head_price', '')::numeric,
    consumables_supplier     = nullif(btrim(p->>'consumables_supplier'), ''),
    insurance_clause_agreed  = (p->>'insurance_clause_agreed')::boolean,

    ref_no            = nullif(btrim(p->>'ref_no'), ''),
    delivery_days     = nullif(btrim(p->>'delivery_days'), ''),
    trade_term        = nullif(btrim(p->>'trade_term'), ''),
    machine_model_no  = nullif(btrim(p->>'machine_model_no'), ''),
    prepared_by       = nullif(btrim(p->>'prepared_by'), ''),
    approved_by       = nullif(btrim(p->>'approved_by'), ''),

    gst_rate          = v_rate,
    machine_value_inr = v_value,
    gst_amount_inr    = v_gst,
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end,
    dryer_value_inr   = v_dry_inr,
    dryer_gst_inr     = v_dry_gst,
    grand_total_inr   = v_grand
  where id = p_deal;
end $function$;

-- ── Assertions ──────────────────────────────────────────────────────────────
--
-- ⚠ THESE REPLACE, NOT EXTEND, THE COUNTS PINNED BY 20261026120000 AND
--   20261027120000. That file asserted "exactly 7 uses of coalesce(v_centering"
--   -- a variable this migration deletes. Those assertions ran at their own
--   apply time and do not re-run; re-deriving them here is what keeps the guard
--   alive rather than quietly dropping it.

do $check$
declare
  v_oc  text := pg_get_functiondef('public.fms_ocpi_write_oc(uuid,jsonb)'::regprocedure);
  v_q   text := pg_get_functiondef('public.fms_ocpi_write_quotation(uuid,jsonb)'::regprocedure);
  v_n   integer;
begin
  -- 1 · the machine's two capability columns are GONE from the branch logic.
  --     They still exist and are still edited on the Machines master; nothing
  --     here may read them again without a decision to reverse OCPI-14.
  if v_oc like '%needs_dryer%' then raise exception 'OCPI-14 assertion 1: write_oc still reads needs_dryer'; end if;
  if v_oc like '%opt_external_centering%' then raise exception 'OCPI-14 assertion 1: write_oc still reads opt_external_centering'; end if;
  if v_q  like '%needs_dryer%' then raise exception 'OCPI-14 assertion 1: write_quotation still reads needs_dryer'; end if;

  -- 2 · the centering gate, counted. The predecessor pinned SEVEN uses of its
  --     machine-capability variable -- one tick plus six shipment clearings. The
  --     tick has moved to part A and the six clearings remain, so the correct
  --     number here is EIGHT: the declaration, the INTO target, and six guards.
  --     The number deliberately changes; it is not the old one carried over.
  select count(*) into v_n from regexp_matches(v_oc, 'v_shows_centering', 'g');
  if v_n <> 8 then raise exception 'OCPI-14 assertion 2: expected 8 uses of v_shows_centering in write_oc, found %', v_n; end if;

  -- 3 · the extras are re-gated AND default to false, all three of them.
  select count(*) into v_n from regexp_matches(v_oc, 'coalesce\(v_shows_extras, false\)', 'g');
  if v_n <> 3 then raise exception 'OCPI-14 assertion 3: expected 3 extras gated on shows_extras, found %', v_n; end if;
  select count(*) into v_n from regexp_matches(v_oc, 'else false end', 'g');
  if v_n <> 3 then raise exception 'OCPI-14 assertion 4: expected 3 extras defaulting to false, found %', v_n; end if;

  -- 4 · external_centering is not written any more.
  if v_oc like '%external_centering  =%' or v_oc like '%external_centering =%' then
    raise exception 'OCPI-14 assertion 5: write_oc still writes external_centering';
  end if;

  -- 5 · the SELECT/INTO alignment. 11 selected expressions, 11 targets.
  select count(*) into v_n from regexp_matches(v_oc, 'v_shows_dryer|v_shows_centering|v_shows_extras', 'g');
  if v_n < 11 then raise exception 'OCPI-14 assertion 6: category flags under-used in write_oc (%)', v_n; end if;

  -- 6 · the shipment rows for head, ink and spares no longer read an inclusion.
  --     v_incl_head survives for head_balance_remarks alone. Five mentions: two
  --     in the note that explains why its two neighbours were deleted, then the
  --     declaration, the INTO target, and that single guard.
  select count(*) into v_n from regexp_matches(v_oc, 'v_incl_head', 'g');
  if v_n <> 5 then raise exception 'OCPI-14 assertion 7: expected 5 mentions of v_incl_head, found %', v_n; end if;
  if v_oc like '%v_incl_spares%' then raise exception 'OCPI-14 assertion 8: v_incl_spares survived and now decides nothing'; end if;
  if v_oc like '%v_incl_ink%' then raise exception 'OCPI-14 assertion 8: v_incl_ink survived and now decides nothing'; end if;

  -- 7 · THE MONEY GUARD. Not one shipment sub-total may reach the totals.
  if v_oc not like '%v_value + coalesce(v_gst, 0)%' then
    raise exception 'OCPI-14 assertion 9: total_inr no longer reads as value + gst';
  end if;
  if v_oc like '%invoice_subtotal +%' or v_oc like '%+ v_head_q%' then
    raise exception 'OCPI-14 assertion 9: a shipment sub-total reached the totals';
  end if;

  -- 8 · part A stores the category and asks the new inclusion.
  if v_q not like '%machine_category_id = v_cat%' then
    raise exception 'OCPI-14 assertion 10: write_quotation does not store the category';
  end if;
  if v_q not like '%incl_centering%' or v_q not like '%centering_details%' then
    raise exception 'OCPI-14 assertion 11: write_quotation does not write the centering inclusion';
  end if;

  -- 9 · save_draft is untouched, and still calls part A unconditionally --
  --     which is WHY the two new part-A keys needed no entry in its key array.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_save_draft'
     and pg_get_functiondef(p.oid) like '%perform public.fms_ocpi_write_quotation(v_id, p);%';
  if v_n <> 1 then raise exception 'OCPI-14 assertion 12: save_draft no longer calls write_quotation unconditionally'; end if;
end $check$;

commit;
