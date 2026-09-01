-- ============================================================================
-- OCPI-8 · "Not Applicable" means NO DRYER — the server learns the rule, and
--           the six placeholder dryers lose their [SAMPLE] prefix.
--
-- ASKED FOR BY RITESH BHAI, 31-Aug-2026. The Dryer details card appears when the
-- MACHINE takes a dryer (needs_dryer, 11 of 28 models) and then shows every
-- question inside it regardless of the CATEGORY the salesperson picked. Choose
-- the category that means no dryer and the name, chambers, heating medium,
-- included-in-deal and price all stay on screen, unfillable, with the
-- completeness warning still asking for a dryer name that cannot be given.
--
-- The business decision is made: that category stays on offer, and it means no
-- dryer details. The form hides everything below the category selector; this
-- file is the server half.
--
-- 🔴 WHY THE SERVER HALF IS NOT OPTIONAL. fms_ocpi_write_oc nulls every column
--    its branches hide, on every write. It knew only about m.needs_dryer. A
--    chamber count and a dryer price typed before the salesperson switched
--    category would have stayed on the row and printed on the contract, under a
--    card the form no longer shows. Same trap as OCPI-7 and OCPI-10; same fix,
--    in the same breath as branching.ts.
--
-- ── THREE THINGS THIS FILE DOES ──────────────────────────────────────────────
--
--   1. A MARKER ON THE CATEGORY, NOT A MAGIC STRING. fms_ocpi_deals.dryer_type
--      is TEXT — the category's NAME, frozen into every revision payload (that
--      is why the column kept its name through OCPI-3's relabel). Matching the
--      literal name in code would mean renaming that category in Masters
--      silently switches the branch off, with no error anywhere. So the master
--      row carries a flag saying what it MEANS, and both engines read the flag.
--
--      ⚠ THE NAME IS STILL LOAD-BEARING, because a DEAL stores the text and not
--        an id. A rename would leave saved deals pointing at a category the
--        master no longer knows. So a trigger refuses to rename a flagged row
--        and says why; the Masters screen says the same in words.
--
--      ⚠ THE LITERAL NAME APPEARS EXACTLY ONCE — in the one-time UPDATE below
--        that resolves today's row. Nothing at runtime, here or in TypeScript,
--        ever compares to it again. Assertion 2 enforces that for the RPC.
--
--   2. write_oc's dryer gate narrows. One variable already drives every dryer
--      clearing in that function, so one line covers the six detail columns,
--      dryer_price and its three derived rupee figures, AND the six shipment
--      columns. The shipment row hiding too is the client's own decision
--      (01-Sep-2026): no dryer means nothing to ship, and leaving that row on
--      screen while this function nulls it is exactly the form/server drift the
--      module forbids.
--
--   3. The six [SAMPLE] dryers are RENAMED IN PLACE. Client's instruction,
--      01-Sep-2026, after the risk was put to them once.
--
--      🔴 THE DOCUMENTED CLEANUP STOPS WORKING, and that is the cost of this
--         change rather than an oversight. `delete from fms_ocpi_dryers where
--         name like '[SAMPLE]%'` was how the placeholders were to be cleared
--         when Bushra's real list arrives; afterwards NOTHING distinguishes a
--         placeholder from a real dryer, in the master or on a deal. OCPI.md
--         now carries the six exact names in place of the pattern.
--
-- ⚠ write_oc IS REDEFINED FROM THE LIVE BODY pulled 01-Sep-2026, not from any
--   migration file. It has been redefined six times and the files on disk lag
--   it. Everything OCPI-7, OCPI-10 and OCPI-11 put there is carried forward
--   untouched, and assertions 4 to 9 below are those migrations' own guards
--   re-run against the new body so that redefining it cannot quietly undo them.
-- ============================================================================

begin;

-- ── 1 · The marker ──────────────────────────────────────────────────────────
--
-- Additive and nullable with a default, per the project rule. Every read
-- coalesces, so a row written before this column existed reads as "a real
-- category" — the safe answer, since it hides nothing and clears nothing.

alter table public.fms_ocpi_dryer_types
  add column if not exists means_no_dryer boolean default false;

comment on column public.fms_ocpi_dryer_types.means_no_dryer is
  'TRUE on the category that means "this deal has no dryer". The quotation form '
  'shows the category selector but hides every dryer question below it, and '
  'fms_ocpi_write_oc nulls every dryer column on the row. Set on exactly one row '
  'today; a second is allowed and needs no code change. The NAME of a flagged row '
  'cannot be changed - deals store the category as TEXT, so a rename would strand '
  'them. Deactivate instead. See OCPI-8.';

-- THE ONE PLACE THE NAME IS MATCHED. A one-time resolution of today's row.
update public.fms_ocpi_dryer_types
   set means_no_dryer = true
 where name = 'Not Applicable';

-- ── 2 · The name of a flagged row is locked ─────────────────────────────────
--
-- ⚠ IT MUST FIRE ON A NAME CHANGE ONLY, not on any update. Two ordinary paths
--   update this table without touching the name and must keep working: the
--   Masters screen's active toggle (name/active/sort_order, name unchanged) and
--   fms_ocpi_resolve_master_request's `on conflict (name) do update set active
--   = true`, whose conflict target IS the name.
--
-- The message is written to be read by whoever hit it: MasterCrud surfaces
-- (e as Error).message straight onto the screen.

create or replace function public.fms_ocpi_dryer_type_name_is_locked()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(old.means_no_dryer, false) and new.name is distinct from old.name then
    raise exception
      'This category is the one that means the deal has no dryer, and the quotation form recognises it by that setting. Deals already saved store the category as text, so renaming it here would leave them pointing at a category that no longer exists. Deactivate it instead of renaming it.';
  end if;
  return new;
end $fn$;

drop trigger if exists fms_ocpi_dryer_type_name_lock on public.fms_ocpi_dryer_types;
create trigger fms_ocpi_dryer_type_name_lock
  before update on public.fms_ocpi_dryer_types
  for each row execute function public.fms_ocpi_dryer_type_name_is_locked();

-- ── 3 · The six placeholders lose their prefix ──────────────────────────────
--
-- Rename, never delete. fms_ocpi_deals.dryer_name stores the TEXT, not an id,
-- so a rename cannot break a saved quotation. (No deal on record holds a dryer
-- name at all — the master was empty until 29-Aug-2026.)
--
-- Postgres LIKE has no bracket classes, so '[' is a literal here.

update public.fms_ocpi_dryers
   set name = replace(name, '[SAMPLE] ', '')
 where name like '[SAMPLE]%';

-- ── 4 · write_oc learns the rule ────────────────────────────────────────────

create or replace function public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_incl_head   boolean;
  v_incl_spares boolean;
  -- NEW (OCPI-11). Ink's shipment row hangs off the SAME inclusion the
  -- subsidized-rate branch in part A hangs off, but on the opposite answer:
  -- that one asks when ink is NOT in the deal, this one asks when it IS. They
  -- are mutually exclusive by construction and can never both hold a value.
  v_incl_ink    boolean;
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
  -- NEW (OCPI-8) · THE DEAL'S OWN HALF OF THE DRYER QUESTION. The machine says
  -- whether a dryer is possible; the salesperson's CATEGORY says whether this
  -- deal actually carries one. v_dryer_cat is the category as stored on the row
  -- (text, trimmed to null when blank); v_no_dryer is the flag off the matching
  -- master row.
  --
  -- ⚠ THE JOIN CARRIES NO `active` FILTER, deliberately. Deactivating that
  --   category must not flip existing deals back to "a real category" and
  --   un-hide five fields this function has already nulled.
  --
  -- ⚠ AN UNRECOGNISED NAME IS A REAL CATEGORY. That is the steady state of the
  --   form's "+ Other" path between a request and its approval, and branching.ts
  --   resolves it the same way. The two must agree or the form asks a question
  --   this function throws away.
  v_dryer_cat   text;
  v_no_dryer    boolean;
  -- ⚠ THE ONLY SURVIVING EXTRA-CAPABILITY VARIABLE (OCPI-10). The other
  --   three came out with the gates they fed; this one still drives seven
  --   clearings -- the centering tick and the six shipment lines.
  --   ⚠ Do NOT name the three removed variables anywhere in this
  --     function, comments included. Assertion 6 greps this function's own
  --     definition for them, and pg_get_functiondef returns the comments too
  --     -- so a helpful note naming them would fail the migration.
  v_centering   text;
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
  -- NEW (OCPI-11) · THE FIVE QUANTITY / AMOUNT PAIRS, PULLED ONCE.
  -- Each pair used to be read straight out of the bag at its own assignment.
  -- It is read once here instead because the sub-total must be the product of
  -- THE SAME TWO VALUES that are stored beside it. Reading the bag a second
  -- time to compute the product is how a stored pair and a stored product come
  -- to disagree about what the browser actually sent.
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
  -- ⚠ THE SELECT LIST AND THE INTO LIST MUST STAY ALIGNED. Three machine
  --   columns and three targets came out of this together (OCPI-10), incl_ink
  --   went in (OCPI-11), and the deal's dryer category went in (OCPI-8). Assign
  --   opt_external_centering into the wrong target and a shipment block starts
  --   obeying the wrong answer, silently. Assertion 8 checks it.
  --
  -- ⚠ THE CATEGORY IS READ OFF THE ROW, like every other branch input here, and
  --   that is safe because fms_ocpi_save_draft calls fms_ocpi_write_quotation --
  --   which OWNS dryer_type -- before it calls this function. Assertion 3 pins
  --   that order. (fms_ocpi_save_oc_draft calls this function alone, but nothing
  --   in the app calls that entry point, and the OC step cannot edit part A.)
  select d.incl_head, d.incl_spares, d.incl_ink, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr, d.fx_rate,
         m.needs_dryer,
         m.opt_external_centering,
         nullif(btrim(coalesce(d.dryer_type, '')), ''),
         t.means_no_dryer
    into v_incl_head, v_incl_spares, v_incl_ink, v_transport,
         v_currency, v_amount, v_inr, v_fx,
         v_has_dryer,
         v_centering,
         v_dryer_cat,
         v_no_dryer
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
    left join public.fms_ocpi_dryer_types t on t.name = d.dryer_type
   where d.id = p_deal;

  -- ⚠ THE MACHINE OPENS THE SECTION; THE CATEGORY DECIDES WHETHER IT HOLDS
  --   ANYTHING (OCPI-8). Every dryer clearing below reads this one variable, so
  --   these three lines govern the six detail columns, dryer_price and its three
  --   derived rupee figures, and the six shipment columns alike.
  --
  --   A BLANK category clears too, and that is the same rule rather than a
  --   second one: the form hides every dryer question until a category is
  --   picked, so an answer cannot be given under a blank one. Verified harmless
  --   against live data on 01-Sep-2026 -- the 3 deals with no category and the 4
  --   on the no-dryer category hold nothing in any dryer column.
  --
  --   ⚠ ITS TWIN IS `hasDryerDetails` in branching.ts, and `hasDryer` there is
  --     the FIRST line alone -- still machine-only, because the CATEGORY itself
  --     is asked of any machine that takes a dryer. Change one, change both.
  v_has_dryer := v_has_dryer is true
                 and v_dryer_cat is not null
                 and coalesce(v_no_dryer, false) = false;

  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  -- The dryer's own money. A price exists only when the dryer is NOT part of the deal.
  v_dry_price := case when not v_has_dryer or (p->>'dryer_included')::boolean is not false
                      then null else nullif(p->>'dryer_price', '')::numeric end;

  -- Quoted in the DEAL's currency, converted at the SAME frozen rate as the machine.
  v_dry_inr := case
                 when v_dry_price is null then null
                 when v_currency = 'USD'
                   then case when v_fx is null then null else round(v_dry_price * v_fx, 2) end
                 else v_dry_price
               end;

  v_dry_gst := case when v_rate is null or v_dry_inr is null then null
                    else round(v_dry_inr * v_rate / 100, 2) end;

  -- Null only when the MACHINE total is unknown: an incomplete deal prints a
  -- blank, never a total that quietly treats a missing figure as zero.
  --
  -- 🔴 NOT ONE SHIPMENT SUB-TOTAL APPEARS IN THIS SUM, and none ever may. Every
  --    figure added here belongs to the machine contract; a separately-invoiced
  --    item is billed on its own document and would be charged twice. Assertion
  --    5 pins this expression and total_inr's character for character.
  v_grand := case when v_value is null then null
                  else v_value + coalesce(v_gst, 0)
                       + coalesce(v_dry_inr, 0) + coalesce(v_dry_gst, 0) end;

  update public.fms_ocpi_deals set
    head_ship_mode        = case when v_incl_head is distinct from true then null else v_ship_mode end,
    head_ship_via         = case when v_incl_head is distinct from true or v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = case when v_incl_head is distinct from true then null else v_head_inv end,
    head_invoice_qty      = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else v_head_q end,
    head_invoice_amount   = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else v_head_a end,
    head_invoice_subtotal = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                   or v_head_q is null or v_head_a is null
                                 then null else round(v_head_q * v_head_a, 2) end,

    -- NEW (OCPI-11) · THE INK ROW. Same five questions as its neighbours, on
    -- the deal's own inclusion answer. It sits between the head and the dryer
    -- because that is the row order on screen.
    ink_ship_mode        = case when v_incl_ink is distinct from true then null else v_ink_ship end,
    ink_ship_via         = case when v_incl_ink is distinct from true or v_ink_ship is distinct from 'separate'
                                then null else nullif(btrim(p->>'ink_ship_via'), '') end,
    ink_separate_invoice = case when v_incl_ink is distinct from true then null else v_ink_inv end,
    ink_invoice_qty      = case when v_incl_ink is distinct from true or v_ink_inv is distinct from true
                                then null else v_ink_q end,
    ink_invoice_amount   = case when v_incl_ink is distinct from true or v_ink_inv is distinct from true
                                then null else v_ink_a end,
    ink_invoice_subtotal = case when v_incl_ink is distinct from true or v_ink_inv is distinct from true
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

    spares_ship_mode        = case when v_incl_spares is distinct from true then null else v_spr_ship end,
    spares_ship_via         = case when v_incl_spares is distinct from true or v_spr_ship is distinct from 'separate'
                                   then null else nullif(btrim(p->>'spares_ship_via'), '') end,
    spares_separate_invoice = case when v_incl_spares is distinct from true then null else v_spr_inv end,
    spares_invoice_qty      = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else v_spr_q end,
    spares_invoice_amount   = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else v_spr_a end,
    spares_invoice_subtotal = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                     or v_spr_q is null or v_spr_a is null
                                   then null else round(v_spr_q * v_spr_a, 2) end,

    -- ⚠ STILL MACHINE-GATED, all six. The centering device's shipment
    --   questions follow the machine exactly as they always have; the
    --   sub-total joins them under the same guard.
    centering_ship_mode        = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_ship end,
    centering_ship_via         = case when coalesce(v_centering, 'no') = 'no' or v_cen_ship is distinct from 'separate'
                                      then null else nullif(btrim(p->>'centering_ship_via'), '') end,
    centering_separate_invoice = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_inv end,
    centering_invoice_qty      = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else v_cen_q end,
    centering_invoice_amount   = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else v_cen_a end,
    centering_invoice_subtotal = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                        or v_cen_q is null or v_cen_a is null
                                      then null else round(v_cen_q * v_cen_a, 2) end,

    -- ⚠ THREE OF THESE FOUR NO LONGER READ THE MACHINE, ON PURPOSE (OCPI-10).
    --   Air blade, ink dust exhauster and chilling system are asked on every
    --   deal now, so the salesperson's answer is stored as given. Restoring a
    --   machine-capability guard on any of these three would silently
    --   discard the answer on 25 of the 28 machines -- that WAS the bug that
    --   migration exists to remove. Assertion 6 objects if one comes back.
    air_blade           = (p->>'air_blade')::boolean,
    -- ⚠ ... AND THE FOURTH STILL DOES. External centering follows the dryer's
    --   logic by the client's own instruction: backed by the machine, or not
    --   asked at all. It is still a gated field, so it still clears. Do not
    --   tidy this into matching the three around it.
    external_centering  = case when coalesce(v_centering, 'no') = 'no' then null else (p->>'external_centering')::boolean end,
    ink_dust_exhauster  = (p->>'ink_dust_exhauster')::boolean,
    chilling_system     = (p->>'chilling_system')::boolean,

    -- Section B's eighth pointer. Free text, never gated, and NOT the retired
    -- other_commitments on the line below it.
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

    -- Derived, not taken from the payload.
    gst_rate          = v_rate,
    machine_value_inr = v_value,
    gst_amount_inr    = v_gst,
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end,
    dryer_value_inr   = v_dry_inr,
    dryer_gst_inr     = v_dry_gst,
    grand_total_inr   = v_grand
  where id = p_deal;
end $function$;

-- ── 5 · Assertions ──────────────────────────────────────────────────────────
--
-- Numbers 4 to 9 are OCPI-7 / OCPI-10 / OCPI-11's own guards, re-run against
-- the body written above. Redefining a function is how those get undone by
-- accident, so they travel with every redefinition.

do $check$
declare
  v_def text;
  v_n   integer;
begin
  -- 1 · The marker landed on exactly one row, and the trigger exists.
  if (select count(*) from public.fms_ocpi_dryer_types where coalesce(means_no_dryer, false)) <> 1 then
    raise exception 'OCPI-8: expected exactly one dryer category flagged as meaning no dryer, found %',
      (select count(*) from public.fms_ocpi_dryer_types where coalesce(means_no_dryer, false));
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.fms_ocpi_dryer_types'::regclass
       and tgname = 'fms_ocpi_dryer_type_name_lock'
       and not tgisinternal
  ) then
    raise exception 'OCPI-8: the rename lock on fms_ocpi_dryer_types is missing';
  end if;

  -- 2 · The RPC resolves the category through the master and NEVER by name.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  if v_def is null then raise exception 'OCPI-8: fms_ocpi_write_oc missing after replace'; end if;

  if v_def ilike '%not applicable%' then
    raise exception 'OCPI-8: fms_ocpi_write_oc matches the category by NAME - rename it in Masters and the branch switches off silently';
  end if;
  if v_def not like '%left join public.fms_ocpi_dryer_types t on t.name = d.dryer_type%' then
    raise exception 'OCPI-8: fms_ocpi_write_oc no longer resolves the dryer category against its master';
  end if;
  if v_def like '%fms_ocpi_dryer_types t on t.name = d.dryer_type and t.active%'
  or v_def like '%fms_ocpi_dryer_types t on t.active%' then
    raise exception 'OCPI-8: the dryer-category join filters on active - deactivating that category would un-hide fields this function has nulled';
  end if;
  if v_def not like '%v_has_dryer := v_has_dryer is true%and v_dryer_cat is not null%and coalesce(v_no_dryer, false) = false;%' then
    raise exception 'OCPI-8: the dryer gate no longer consults the deal category';
  end if;

  -- 3 · save_draft still writes part A (which owns dryer_type) BEFORE part B
  --     (which now reads it off the row).
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_save_draft';
  if v_def is null then raise exception 'OCPI-8: fms_ocpi_save_draft missing'; end if;
  if position('fms_ocpi_write_quotation' in v_def) = 0
  or position('fms_ocpi_write_oc' in v_def) = 0
  or position('fms_ocpi_write_quotation' in v_def) > position('fms_ocpi_write_oc' in v_def) then
    raise exception 'OCPI-8: save_draft no longer writes part A before part B - write_oc would read a stale dryer_type';
  end if;
  -- The part-B sniff array must still carry the dryer keys, or a dryer-only
  -- payload never reaches write_oc and nothing is cleared at all.
  if v_def not like '%''dryer_chambers''%'
  or v_def not like '%''dryer_name''%'
  or v_def not like '%''dryer_included''%'
  or v_def not like '%''dryer_price''%' then
    raise exception 'OCPI-8: save_draft part-B key array lost a dryer key';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';

  -- 4 · OCPI-11 SURVIVES: no sub-total is read from the payload.
  if v_def like '%p->>''head_invoice_subtotal''%'
  or v_def like '%p->>''ink_invoice_subtotal''%'
  or v_def like '%p->>''dryer_invoice_subtotal''%'
  or v_def like '%p->>''spares_invoice_subtotal''%'
  or v_def like '%p->>''centering_invoice_subtotal''%' then
    raise exception 'OCPI-8: a shipment sub-total is being read from the payload - it must be derived here';
  end if;
  if v_def not like '%then null else round(v_head_q * v_head_a, 2) end%'
  or v_def not like '%then null else round(v_ink_q * v_ink_a, 2) end%'
  or v_def not like '%then null else round(v_dry_q * v_dry_a, 2) end%'
  or v_def not like '%then null else round(v_spr_q * v_spr_a, 2) end%'
  or v_def not like '%then null else round(v_cen_q * v_cen_a, 2) end%' then
    raise exception 'OCPI-8: a sub-total is not the product of its own stored qty and amount';
  end if;

  -- 5 · 🔴 THE MONEY GUARD, carried over character for character from OCPI-11.
  --     Both pins END AT THEIR STATEMENT TERMINATOR; a bare `end%` tail would
  --     happily accept `... end + coalesce(head_invoice_subtotal, 0)`, which is
  --     the exact thing this exists to forbid. Do not relax them.
  if v_def not like '%total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end,%' then
    raise exception 'OCPI-8: total_inr is no longer exactly the machine value plus its GST';
  end if;
  if v_def not like '%v_grand := case when v_value is null then null%else v_value + coalesce(v_gst, 0)%+ coalesce(v_dry_inr, 0) + coalesce(v_dry_gst, 0) end;%' then
    raise exception 'OCPI-8: grand_total_inr is no longer exactly machine + GST + dryer + dryer GST';
  end if;

  -- 6 · OCPI-10 SURVIVES: the three ungated extras stay ungated.
  if v_def ~ 'v_air' or v_def ~ 'v_exhauster' or v_def ~ 'v_chilling' then
    raise exception 'OCPI-8: write_oc reads a machine capability for air blade / exhauster / chilling again - OCPI-10 was undone';
  end if;
  if v_def not like '%air_blade           = (p->>''air_blade'')::boolean%'
  or v_def not like '%ink_dust_exhauster  = (p->>''ink_dust_exhauster'')::boolean%'
  or v_def not like '%chilling_system     = (p->>''chilling_system'')::boolean%' then
    raise exception 'OCPI-8: write_oc no longer stores all three ungated extras as given';
  end if;

  -- 7 · OCPI-10 SURVIVES: external centering keeps its gate, 1 tick + 6
  --     shipment lines.
  if v_def not like '%external_centering  = case when coalesce(v_centering, ''no'') = ''no'' then null%' then
    raise exception 'OCPI-8: external_centering lost its gate - it is the one extra that keeps it';
  end if;
  v_n := (length(v_def) - length(replace(v_def, 'coalesce(v_centering', ''))) / length('coalesce(v_centering');
  if v_n <> 7 then
    raise exception 'OCPI-8: expected 7 centering guards (1 tick + 6 shipment), found %', v_n;
  end if;

  -- 8 · OCPI-10 SURVIVES: the select/into lists are still in step, and
  --     other_inclusions is still written.
  if v_def not like '%m.opt_external_centering%'
  or v_def like '%m.opt_air_blade%'
  or v_def like '%m.opt_ink_dust_exhauster%'
  or v_def like '%m.opt_chilling_system%' then
    raise exception 'OCPI-8: write_oc selects a removed machine capability - the select/into lists are out of step';
  end if;
  if v_def not like '%other_inclusions         = nullif(btrim(p->>''other_inclusions''), '''')%' then
    raise exception 'OCPI-8: write_oc no longer writes other_inclusions';
  end if;

  -- 9 · OCPI-7 SURVIVES: write_oc owns every rupee derivation on this table and
  --     must still know nothing about a section-B offer column.
  if v_def like '%offer_subtotal%' or v_def like '%offer_rate%' or v_def like '%offer_qty%' then
    raise exception 'OCPI-8: fms_ocpi_write_oc mentions an offer column - a deal total must never include one';
  end if;

  -- 10 · The six placeholders lost the prefix, and nothing else did.
  if exists (select 1 from public.fms_ocpi_dryers where name like '[SAMPLE]%') then
    raise exception 'OCPI-8: a dryer still carries the [SAMPLE] prefix';
  end if;
  if (select count(*) from public.fms_ocpi_dryers) <> 6 then
    raise exception 'OCPI-8: expected 6 dryers after the rename, found %',
      (select count(*) from public.fms_ocpi_dryers);
  end if;
  if (select count(distinct (dryer_type_id, name)) from public.fms_ocpi_dryers)
     <> (select count(*) from public.fms_ocpi_dryers) then
    raise exception 'OCPI-8: the rename collided two dryers inside one category';
  end if;
end $check$;

commit;
