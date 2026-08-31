-- ============================================================================
-- OCPI-11 · Shipment & invoice becomes a table, gains an Ink row, and
--           calculates a sub-total.
--
-- ASKED FOR BY RITESH BHAI, 31-Aug-2026. The section stacks one box per item
-- and asks each the same five questions. Three changes:
--
--   1. INK GETS A ROW. The head, the dryer, the spare parts and the centering
--      device each carry five shipment columns. Ink carried none -- so this is
--      new columns and a new branch, not a layout change. It is the largest
--      part of the job, and it lands on nearly every deal: 17 of the 19 on
--      record include ink, and none exclude it.
--   2. The section becomes a TABLE -- items down the left, questions across the
--      top. That is frontend work; nothing here depends on it.
--   3. Each row gets a SUB-TOTAL, quantity x amount.
--
-- ROW ORDER, settled 31-Aug-2026: head, ink, dryer, spare parts, centering
-- device. The ink block below sits between the head and the dryer to match, so
-- this function reads in the same order as the screen.
--
-- ⚠ THE ROW STILL APPEARS ONLY IF THE DEAL CARRIES THAT PART (client,
--   31-Aug-2026). A table implies fixed rows; this one has five rows on the 5
--   machines that can take a centering device and four on the other 23, and a
--   deal without spares shows no spares row. That is the section's whole design
--   -- "only the parts this deal actually carries are listed" -- and it is also
--   what keeps the clearing below honest. EVERY GUARD HERE IS THE TWIN OF A
--   RULE IN branching.ts. Change one, change both, or the form asks a question
--   whose answer this function then throws away on the next save.
--
-- ⚠ THE SUB-TOTAL IS DERIVED HERE AND NEVER READ FROM THE PAYLOAD. A
--   browser-computed twin would be a second, different answer for one price on
--   a contract -- the mistake `withGst` was deleted for in stage E. The form
--   recomputes it live only as a PREVIEW; this is the figure that prints.
--
--   Each sub-total is built from the SAME TWO VARIABLES its own qty and amount
--   are written from, under the SAME guard. That is why the payload extraction
--   moved into variables in this revision: reading the bag twice invites the
--   stored pair and the stored product to disagree about what was sent.
--
-- 🔴 NO SUB-TOTAL IS PART OF ANY TOTAL, and the five new columns must never
--   join one. The section has said so since stage F: an item on a SEPARATE
--   invoice is billed on its own document, so rolling it into this contract
--   would bill the customer twice for the same thing. machine_value_inr,
--   gst_amount_inr, total_inr, dryer_value_inr, dryer_gst_inr and
--   grand_total_inr all exclude these BY CONSTRUCTION and must keep excluding
--   them. A calculated column sitting in a table is exactly what a later "grand
--   total" sweeps up, which is why assertion 5 pins the two total expressions
--   character for character.
--
--   None of the five takes an _inr suffix. In this module that suffix marks the
--   DERIVED MONEY PATH, and these are rupees but are not on it. (Same reasoning
--   and same wording as the subsidized-rate columns added on 24-Aug. Those are
--   named HERE, in the header, and never inside the function -- OCPI-10's
--   assertion 6 greps the function body for that family of column names, and a
--   helpful cross-reference in a comment would fail the migration.)
--
-- ⚠ WHAT THIS FUNCTION MUST KEEP FROM OCPI-10. Redefined below from the LIVE
--   body pulled 31-Aug-2026, not from any migration file -- write_oc has been
--   redefined six times and the files on disk lag it. Carried forward:
--     · air blade, ink dust exhauster and chilling system are stored AS GIVEN,
--       ungated -- and the three machine-capability variables that used to gate
--       them are not named anywhere in this function, comments included;
--     · external centering keeps its gate;
--     · other_inclusions is written unconditionally.
--   Assertions 6-8 re-state OCPI-10's own checks so THIS change is tested
--   against them too.
--
-- ⚠ ONE OCPI-10 COUNT DELIBERATELY MOVES. Its assertion 4 required exactly six
--   uses of `coalesce(v_centering` -- one tick plus five shipment lines. The
--   centering row now has a sixth line (its sub-total), so the correct count
--   here is SEVEN. Assertion 7 below pins the new number with the new reason.
--   Nothing about the centering gate itself has changed.
-- ============================================================================

begin;

-- ── 1 · Ink's five shipment columns ─────────────────────────────────────────
-- Types copied from the head's, which is the pattern the other three follow:
-- a counted quantity and a rupee amount.
alter table public.fms_ocpi_deals
  add column if not exists ink_ship_mode        text,
  add column if not exists ink_ship_via         text,
  add column if not exists ink_separate_invoice boolean,
  add column if not exists ink_invoice_qty      integer,
  add column if not exists ink_invoice_amount   numeric(16,2);

comment on column public.fms_ocpi_deals.ink_ship_mode is
  'How ink travels: with the machine, or as a separate shipment. Asked only when incl_ink is TRUE; fms_ocpi_write_oc clears it when incl_ink is not TRUE.';

comment on column public.fms_ocpi_deals.ink_ship_via is
  'The route for a SEPARATE ink shipment. There is nothing to route when it travels with the machine, so this is kept only when ink_ship_mode is ''separate''.';

comment on column public.fms_ocpi_deals.ink_separate_invoice is
  'Is the included ink billed on its own invoice? Asked only when incl_ink is TRUE.';

comment on column public.fms_ocpi_deals.ink_invoice_qty is
  'Quantity on the SEPARATE INVOICE for ink that IS included in the deal. NOT the subsidized quantity asked in section B, which is its opposite: ink the deal does NOT include. The two can never both be set - this one needs incl_ink TRUE, that one needs it FALSE. Kept only when incl_ink is TRUE and ink_separate_invoice is TRUE.';

comment on column public.fms_ocpi_deals.ink_invoice_amount is
  'Amount on the SEPARATE INVOICE for ink that IS included in the deal, excluding tax. NOT the subsidized rate asked in section B, which is its opposite - see ink_invoice_qty.';

-- ── 2 · A sub-total for every shipment row ──────────────────────────────────
-- 🔴 Read the header before adding any of these to a total. They are excluded
--    from every rupee derivation on this table BY CONSTRUCTION.
alter table public.fms_ocpi_deals
  add column if not exists head_invoice_subtotal      numeric(16,2),
  add column if not exists ink_invoice_subtotal       numeric(16,2),
  add column if not exists dryer_invoice_subtotal     numeric(16,2),
  add column if not exists spares_invoice_subtotal    numeric(16,2),
  add column if not exists centering_invoice_subtotal numeric(16,2);

comment on column public.fms_ocpi_deals.head_invoice_subtotal is
  'DERIVED in fms_ocpi_write_oc, never read from the payload: round(head_invoice_qty * head_invoice_amount, 2), excluding tax. NOT PART OF THE DEAL VALUE AND MUST NEVER BE ADDED TO IT - a separately-invoiced item is billed on its own document, so counting it here would bill it twice. machine_value_inr, gst_amount_inr, total_inr, dryer_value_inr, dryer_gst_inr and grand_total_inr all exclude it. No _inr suffix on purpose: that suffix marks the derived money path, and this is rupees but is not on it.';

comment on column public.fms_ocpi_deals.ink_invoice_subtotal is
  'DERIVED in fms_ocpi_write_oc: round(ink_invoice_qty * ink_invoice_amount, 2), excluding tax. Never added to any total - see head_invoice_subtotal.';

comment on column public.fms_ocpi_deals.dryer_invoice_subtotal is
  'DERIVED in fms_ocpi_write_oc: round(dryer_invoice_qty * dryer_invoice_amount, 2), excluding tax. Never added to any total - see head_invoice_subtotal. In particular it is NOT dryer_value_inr, which is the dryer''s own price on the machine contract and IS on the money path.';

comment on column public.fms_ocpi_deals.spares_invoice_subtotal is
  'DERIVED in fms_ocpi_write_oc: round(spares_invoice_qty * spares_invoice_amount, 2), excluding tax. Never added to any total - see head_invoice_subtotal.';

comment on column public.fms_ocpi_deals.centering_invoice_subtotal is
  'DERIVED in fms_ocpi_write_oc: round(centering_invoice_qty * centering_invoice_amount, 2), excluding tax. Never added to any total - see head_invoice_subtotal.';

-- ── 3 · write_oc learns the ink row and the five sub-totals ─────────────────
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
  -- ⚠ THE ONLY SURVIVING EXTRA-CAPABILITY VARIABLE (OCPI-10). The other
  --   three came out with the gates they fed; this one still drives seven
  --   clearings -- the centering tick and the six shipment lines.
  --   ⚠ Do NOT name the three removed variables anywhere in this
  --     function, comments included. Assertion 2 greps this function's own
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
  --   columns and three targets came out of this together (OCPI-10), and
  --   incl_ink went in (OCPI-11). Assign opt_external_centering into the wrong
  --   target and a shipment block starts obeying the wrong answer, silently.
  --   Assertion 8 checks it.
  select d.incl_head, d.incl_spares, d.incl_ink, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr, d.fx_rate,
         m.needs_dryer,
         m.opt_external_centering
    into v_incl_head, v_incl_spares, v_incl_ink, v_transport,
         v_currency, v_amount, v_inr, v_fx,
         v_has_dryer,
         v_centering
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_deal;

  v_has_dryer := v_has_dryer is true;

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

-- ── 4 · save_draft learns the five new key names ────────────────────────────
-- THE EASIEST THING IN THIS MODULE TO MISS, in the function's own words. The
-- part-B writer runs only when the payload carries one of these literal names.
-- The form always sends the whole bag, so the ink keys would have ridden in on
-- a neighbour today -- but a payload of ONLY ink shipment answers would never
-- have reached write_oc at all, and nothing would have said so.
create or replace function public.fms_ocpi_save_draft(p jsonb, p_deal uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid := p_deal;
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if nullif(btrim(p->>'customer_name'), '') is null then
    raise exception 'Enter the customer name before saving';
  end if;

  if v_id is null then
    if not public.fms_ocpi_can_act('quotation', null, v_uid) then
      raise exception 'You are not authorized to raise a quotation';
    end if;
    insert into public.fms_ocpi_deals (raised_by, status, current_step)
    values (v_uid, 'draft', 'quotation')
    returning id into v_id;
  else
    select status, raised_by into v_status, v_owner
      from public.fms_ocpi_deals where id = v_id for update;
    if v_status is null then raise exception 'Quotation not found'; end if;
    if v_status <> 'draft' then
      raise exception 'This quotation has already been submitted - use Edit instead';
    end if;
    if v_owner is distinct from v_uid and not public.fms_ocpi_is_coordinator(v_uid) then
      raise exception 'This draft belongs to someone else';
    end if;
  end if;

  -- ORDER IS SEMANTIC: write_oc branches on part-A answers it reads off the
  -- row, so part A must already be written. incl_ink is one of them now -- the
  -- ink shipment row is gated on an answer this call is what stores.
  perform public.fms_ocpi_write_quotation(v_id, p);

  -- THE EASIEST THING IN THIS MODULE TO MISS. write_oc runs ONLY when the bag
  -- carries one of these literal key names. A new part-B field left off this
  -- list is never written at all - no error, no warning, the value simply never
  -- lands. QT-M0037 is what that looks like from outside: 36 keys, none of them
  -- part B, so write_oc never ran and its paper prints a blank total.
  if p ?| array[
       'head_ship_mode', 'head_ship_via', 'head_balance_remarks', 'head_separate_invoice',
       'head_invoice_qty', 'head_invoice_amount',
       'ink_ship_mode', 'ink_ship_via', 'ink_separate_invoice',
       'ink_invoice_qty', 'ink_invoice_amount',
       'dryer_chambers', 'heating_mode', 'dryer_warranty', 'platter_details',
       'dryer_name', 'dryer_included', 'dryer_price',
       'dryer_ship_mode', 'dryer_ship_via', 'dryer_separate_invoice',
       'dryer_invoice_qty', 'dryer_invoice_amount',
       'spares_ship_mode', 'spares_ship_via', 'spares_separate_invoice',
       'spares_invoice_qty', 'spares_invoice_amount',
       'centering_ship_mode', 'centering_ship_via', 'centering_separate_invoice',
       'centering_invoice_qty', 'centering_invoice_amount',
       'air_blade', 'external_centering', 'ink_dust_exhauster', 'chilling_system',
       'other_inclusions',
       'other_commitments', 'printer_warranty', 'head_warranty', 'post_warranty_head_price',
       'consumables_supplier', 'insurance_clause_agreed',
       'ref_no', 'delivery_days', 'trade_term', 'machine_model_no',
       'prepared_by', 'approved_by', 'gst_rate', 'machine_value_inr'
     ] then
    perform public.fms_ocpi_write_oc(v_id, p);
  end if;

  return v_id;
end $function$;

-- ── 5 · Machine checks ──────────────────────────────────────────────────────
do $check$
declare
  v_def text;
  v_n   integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  if v_def is null then raise exception 'OCPI-11: fms_ocpi_write_oc missing after replace'; end if;

  -- 1 · The ink row is written, and gated on the deal's own inclusion answer.
  if v_def not like '%ink_ship_mode        = case when v_incl_ink is distinct from true%'
  or v_def not like '%ink_separate_invoice = case when v_incl_ink is distinct from true%'
  or v_def not like '%ink_invoice_qty      = case when v_incl_ink is distinct from true or v_ink_inv is distinct from true%'
  or v_def not like '%ink_invoice_amount   = case when v_incl_ink is distinct from true or v_ink_inv is distinct from true%' then
    raise exception 'OCPI-11: write_oc does not store the ink shipment row under incl_ink';
  end if;

  -- 2 · incl_ink actually reaches the function. A guard on a variable nothing
  --     ever assigns is null forever, and would clear the whole ink row on
  --     every save -- silently, which is this module's defining hazard.
  if v_def not like '%d.incl_ink%' or v_def not like '%into v_incl_head, v_incl_spares, v_incl_ink,%' then
    raise exception 'OCPI-11: write_oc does not select incl_ink into v_incl_ink - the ink row would clear on every save';
  end if;

  -- 3 · All five sub-totals are derived, and none is read from the payload.
  v_n := (length(v_def) - length(replace(v_def, '_invoice_subtotal = case', ''))) / length('_invoice_subtotal = case');
  if v_n <> 5 then
    raise exception 'OCPI-11: expected 5 derived shipment sub-totals, found %', v_n;
  end if;
  -- Named one at a time on purpose. A wildcard spanning two occurrences of
  -- `invoice_subtotal` matches trivially -- there are five of them with plenty
  -- of `p->>` in between -- and fires on correct code.
  if v_def like '%p->>''head_invoice_subtotal''%'
  or v_def like '%p->>''ink_invoice_subtotal''%'
  or v_def like '%p->>''dryer_invoice_subtotal''%'
  or v_def like '%p->>''spares_invoice_subtotal''%'
  or v_def like '%p->>''centering_invoice_subtotal''%' then
    raise exception 'OCPI-11: a shipment sub-total is being read from the payload - it must be derived here';
  end if;

  -- 4 · Each sub-total is the product of the SAME two variables stored beside
  --     it. Re-reading the bag is how the stored pair and the stored product
  --     come to disagree.
  if v_def not like '%then null else round(v_head_q * v_head_a, 2) end%'
  or v_def not like '%then null else round(v_ink_q * v_ink_a, 2) end%'
  or v_def not like '%then null else round(v_dry_q * v_dry_a, 2) end%'
  or v_def not like '%then null else round(v_spr_q * v_spr_a, 2) end%'
  or v_def not like '%then null else round(v_cen_q * v_cen_a, 2) end%' then
    raise exception 'OCPI-11: a sub-total is not the product of its own stored qty and amount';
  end if;

  -- 5 · 🔴 THE MONEY GUARD. The two totals are pinned character for character.
  --     This is the assertion that stops a later "grand total" sweeping a
  --     calculated column into a contract price and billing a
  --     separately-invoiced item twice.
  --
  -- ⚠ BOTH PINS END AT THEIR STATEMENT TERMINATOR -- the trailing `end,` and
  --   `end;` are part of the match, and that is what makes them airtight. With
  --   a bare `end%` tail the pattern would happily accept
  --   `... end + coalesce(head_invoice_subtotal, 0)`, which is the exact thing
  --   this assertion exists to forbid. Do not relax them.
  --
  -- ⚠ AND DO NOT "HELP" BY ADDING `like '%v_grand :=%invoice_subtotal%'`. LIKE
  --   spans the whole definition, so that matches any body mentioning v_grand
  --   anywhere before a sub-total anywhere -- which every CORRECT body does. It
  --   fired on this migration's own first two runs, on correct code.
  if v_def not like '%total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end,%' then
    raise exception 'OCPI-11: total_inr is no longer exactly the machine value plus its GST';
  end if;
  if v_def not like '%v_grand := case when v_value is null then null%else v_value + coalesce(v_gst, 0)%+ coalesce(v_dry_inr, 0) + coalesce(v_dry_gst, 0) end;%' then
    raise exception 'OCPI-11: grand_total_inr is no longer exactly machine + GST + dryer + dryer GST';
  end if;

  -- 6 · OCPI-10 SURVIVES: the three ungated extras stay ungated.
  if v_def ~ 'v_air' or v_def ~ 'v_exhauster' or v_def ~ 'v_chilling' then
    raise exception 'OCPI-11: write_oc reads a machine capability for air blade / exhauster / chilling again - OCPI-10 was undone';
  end if;
  if v_def not like '%air_blade           = (p->>''air_blade'')::boolean%'
  or v_def not like '%ink_dust_exhauster  = (p->>''ink_dust_exhauster'')::boolean%'
  or v_def not like '%chilling_system     = (p->>''chilling_system'')::boolean%' then
    raise exception 'OCPI-11: write_oc no longer stores all three ungated extras as given';
  end if;

  -- 7 · OCPI-10 SURVIVES: external centering keeps its gate. THE COUNT MOVES
  --     FROM SIX TO SEVEN, deliberately -- the centering row gained a
  --     sub-total, so it is now one tick plus six shipment lines.
  if v_def not like '%external_centering  = case when coalesce(v_centering, ''no'') = ''no'' then null%' then
    raise exception 'OCPI-11: external_centering lost its gate - it is the one extra that keeps it';
  end if;
  v_n := (length(v_def) - length(replace(v_def, 'coalesce(v_centering', ''))) / length('coalesce(v_centering');
  if v_n <> 7 then
    raise exception 'OCPI-11: expected 7 centering guards (1 tick + 6 shipment), found %', v_n;
  end if;

  -- 8 · OCPI-10 SURVIVES: the select/into lists are still in step, and
  --     other_inclusions is still written.
  if v_def not like '%m.opt_external_centering%'
  or v_def like '%m.opt_air_blade%'
  or v_def like '%m.opt_ink_dust_exhauster%'
  or v_def like '%m.opt_chilling_system%' then
    raise exception 'OCPI-11: write_oc selects a removed machine capability - the select/into lists are out of step';
  end if;
  if v_def not like '%other_inclusions         = nullif(btrim(p->>''other_inclusions''), '''')%' then
    raise exception 'OCPI-11: write_oc no longer writes other_inclusions';
  end if;

  -- 9 · OCPI-7 SURVIVES: write_oc owns every rupee derivation on this table and
  --     must still know nothing about a section-B offer column.
  if v_def like '%offer_subtotal%' or v_def like '%offer_rate%' or v_def like '%offer_qty%' then
    raise exception 'OCPI-11: fms_ocpi_write_oc mentions an offer column - a deal total must never include one';
  end if;

  -- 10 · The sniff array carries all five new keys, and has not lost the one
  --      OCPI-10 added. A payload of only ink shipment answers must reach
  --      write_oc.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_save_draft';
  if v_def is null then raise exception 'OCPI-11: fms_ocpi_save_draft missing after replace'; end if;
  if v_def not like '%''ink_ship_mode''%'
  or v_def not like '%''ink_ship_via''%'
  or v_def not like '%''ink_separate_invoice''%'
  or v_def not like '%''ink_invoice_qty''%'
  or v_def not like '%''ink_invoice_amount''%' then
    raise exception 'OCPI-11: save_draft part-B key array does not carry the five ink shipment keys';
  end if;
  if v_def not like '%''other_inclusions''%' then
    raise exception 'OCPI-11: save_draft part-B key array lost other_inclusions - OCPI-10 was undone';
  end if;
end $check$;

commit;
