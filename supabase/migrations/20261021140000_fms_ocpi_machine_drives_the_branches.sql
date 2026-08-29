-- ===========================================================================
-- OCPI-3 · Stage E — THE MACHINE DECIDES WHAT IS ASKED, NOT THE SALESPERSON.
--
-- Two writers are re-issued here and they MUST land together, because between
-- them they own one rule:
--
--     fms_ocpi_write_quotation  owns  dryer_type          (part A)
--     fms_ocpi_write_oc         owns  every other dryer   (part B)
--                                     column, and the four extras
--
-- WHAT CHANGES
--
--   1. "Does this deal have a dryer?" stops being the salesperson's answer and
--      becomes the MACHINE's. It used to read
--
--          d.dryer_type is not null and d.dryer_type <> 'Not Applicable'
--
--      - i.e. the deal's own "Dryer required" dropdown. The client's sheet
--      settles it per model instead, so `fms_ocpi_machines.needs_dryer` decides,
--      and `dryer_type` is re-purposed to mean the dryer's CATEGORY (Indian /
--      Chinese) with `dryer_name` naming the model inside it.
--
--   2. The four optional extras - air blade, external centering, ink dust
--      exhauster, chilling system - are written only when the machine can carry
--      them. They were stored unconditionally, so a Pengda with no air blade
--      could still be recorded as having one, and the detailed sheet would say
--      so on a contract.
--
-- ⚠ THE TYPESCRIPT COPY IS lib/branching.ts AND IT CHANGED IN THE SAME COMMIT.
--   That file decides what a user SEES; this decides what is STORED. If the two
--   ever disagree the server erases answers the form is still showing, on every
--   save, with no error and nothing in a log. `machineFacts` in lib/fieldSpec.ts
--   reads exactly the five machine columns read below - keep that true.
--
-- ⚠ NULL IS "NO", NOT "MAYBE". A machine with `needs_dryer` unset asks no dryer
--   questions, and an unmapped capability asks nothing. That is why the Machine
--   master now REQUIRES the dryer flag: leaving it blank there would quietly
--   make a whole section of the quotation unreachable for that model. All 28
--   machines carry an answer today.
--
-- ⚠ ON DUMMY DATA THIS RE-SHAPES 4 EXISTING DRAFTS. Four deals name a dryer on a
--   machine now flagged as taking none; their dryer answers are nulled the next
--   time somebody SAVES them - not now, and not on a deal nobody edits. The
--   client confirmed on 27-Aug-2026 that all data in the module is dummy.
--
-- ADDITIVE ONLY: no column is added, altered or dropped. Two function bodies.
--
-- ROLLBACK: re-run migration 20261021130000, which holds the previous body of
--   fms_ocpi_write_oc, and 20260929121000 for fms_ocpi_write_quotation.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- E.6a · fms_ocpi_write_quotation - dryer_type follows the machine.
--
-- ⚠ THE MACHINE IS READ FROM THE PAYLOAD, NOT FROM THE ROW. This statement is
--   what SETS machine_id; reading it back off the row would test the PREVIOUS
--   machine, so switching from a dryer model to a non-dryer one would keep the
--   category for one more save. Everything else is verbatim from 20260929121000.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_write_quotation(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  v_needs_dryer   boolean;
begin
  -- No machine, or a machine with the flag unset, means no dryer and therefore
  -- no dryer category. `select into` simply leaves it null when nothing matches.
  select m.needs_dryer into v_needs_dryer
    from public.fms_ocpi_machines m where m.id = v_machine;

  update public.fms_ocpi_deals set
    salesperson_name   = nullif(btrim(p->>'salesperson_name'), ''),
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
    head_type          = nullif(btrim(p->>'head_type'), ''),
    head_count         = nullif(p->>'head_count', '')::integer,
    ink_type           = nullif(btrim(p->>'ink_type'), ''),
    ink_price          = nullif(btrim(p->>'ink_price'), ''),
    ink_credit_terms   = nullif(btrim(p->>'ink_credit_terms'), ''),
    incl_ink           = v_incl_ink,
    ink_qty_included   = case when v_incl_ink is distinct from true then null
                              else nullif(btrim(p->>'ink_qty_included'), '') end,
    incl_spares        = v_incl_spares,
    spare_details      = case when v_incl_spares is distinct from true then null
                              else nullif(btrim(p->>'spare_details'), '') end,
    incl_head          = v_incl_head,
    heads_included     = case when v_incl_head is distinct from true then null
                              else nullif(p->>'heads_included', '')::integer end,
    -- ⚠ CHANGED (stage E): the dryer CATEGORY, kept only for a machine that
    --   takes a dryer. Was stored unconditionally as "Dryer required".
    dryer_type         = case when v_needs_dryer is distinct from true then null
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
end $$;

comment on function public.fms_ocpi_write_quotation(uuid, jsonb) is
  'Write the part-A columns from a jsonb bag, nulling whatever the branch rules hide. High Seas forces USD. dryer_type now means the dryer CATEGORY and is kept only when the chosen machine''s needs_dryer flag is true - the machine is read from the PAYLOAD, since this is the statement that sets machine_id. Touches NO part-B column.';

-- ---------------------------------------------------------------------------
-- E.6b · fms_ocpi_write_oc - the dryer and the extras follow the machine.
--
-- Reproduced from 20261021130000 with two changes and nothing else:
--   * v_has_dryer reads m.needs_dryer instead of the deal's own dryer_type
--   * air_blade / external_centering / ink_dust_exhauster / chilling_system are
--     kept only when the machine can carry them
--
-- ⚠ platter_details STAYS UNGATED, deliberately. The form used to show it only
--   with a dryer while this function stored it always - the form being the
--   stricter of the two, so a machine with no dryer could never record a platter
--   the database was willing to keep. Stage E moved the field to Machine details
--   to agree with THIS behaviour rather than gate it here. Its home is still an
--   open question with the client; if it turns out to belong to the dryer, gate
--   it in both places.
--
-- ⚠ total_inr STILL IGNORES dryer_price. Whether a separately-charged dryer
--   attracts GST is unanswered, and guessing at tax on a contract is not a
--   decision code should make. The papers carry it as its own line (stage I).
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incl_head   boolean;
  v_incl_spares boolean;
  v_transport   text;
  v_currency    text;
  v_amount      numeric;
  v_inr         numeric;
  v_ship_mode   text := nullif(btrim(p->>'head_ship_mode'), '');
  v_rate        numeric;
  v_value       numeric;
  v_gst         numeric;
  v_has_dryer   boolean;
  v_centering   text;
  v_air         text;
  v_exhauster   text;
  v_chilling    text;
  v_dry_ship    text := nullif(btrim(p->>'dryer_ship_mode'), '');
  v_spr_ship    text := nullif(btrim(p->>'spares_ship_mode'), '');
  v_cen_ship    text := nullif(btrim(p->>'centering_ship_mode'), '');
  v_dry_inv     boolean := (p->>'dryer_separate_invoice')::boolean;
  v_spr_inv     boolean := (p->>'spares_separate_invoice')::boolean;
  v_cen_inv     boolean := (p->>'centering_separate_invoice')::boolean;
  v_head_inv    boolean := (p->>'head_separate_invoice')::boolean;
begin
  -- What can this MACHINE have? Read off the machine, through a left join so a
  -- deal with no machine yet simply gets nulls - which every branch below reads
  -- as "do not ask, do not store".
  --
  -- ⚠ machine_id IS ALREADY CURRENT HERE. fms_ocpi_save_draft calls
  --   write_quotation first and that is semantic, not incidental - see its
  --   comment. This function must never be called before it.
  select d.incl_head, d.incl_spares, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr,
         m.needs_dryer,
         m.opt_external_centering, m.opt_air_blade,
         m.opt_ink_dust_exhauster, m.opt_chilling_system
    into v_incl_head, v_incl_spares, v_transport,
         v_currency, v_amount, v_inr,
         v_has_dryer,
         v_centering, v_air,
         v_exhauster, v_chilling
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_deal;

  -- ⚠ CHANGED (stage E). Was: v_dryer is not null and v_dryer <> 'Not Applicable'
  --   - the salesperson's own answer. It is the model's property now.
  v_has_dryer := v_has_dryer is true;

  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  update public.fms_ocpi_deals set
    head_ship_mode        = case when v_incl_head is distinct from true then null else v_ship_mode end,
    head_ship_via         = case when v_incl_head is distinct from true or v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = case when v_incl_head is distinct from true then null else v_head_inv end,
    -- quantity and amount belong to a SEPARATE invoice and to nothing else
    head_invoice_qty      = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_qty', '')::integer end,
    head_invoice_amount   = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_amount', '')::numeric end,

    dryer_chambers  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_chambers'), '') end,
    heating_mode    = case when not v_has_dryer then null else nullif(btrim(p->>'heating_mode'), '') end,
    dryer_warranty  = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_warranty'), '') end,
    -- see the header: ungated on purpose, and the form now agrees
    platter_details = nullif(btrim(p->>'platter_details'), ''),

    dryer_name      = case when not v_has_dryer then null else nullif(btrim(p->>'dryer_name'), '') end,
    dryer_included  = case when not v_has_dryer then null else (p->>'dryer_included')::boolean end,
    -- a price only when the dryer is NOT part of the deal
    dryer_price     = case when not v_has_dryer or (p->>'dryer_included')::boolean is not false
                           then null else nullif(p->>'dryer_price', '')::numeric end,

    dryer_ship_mode        = case when not v_has_dryer then null else v_dry_ship end,
    dryer_ship_via         = case when not v_has_dryer or v_dry_ship is distinct from 'separate'
                                  then null else nullif(btrim(p->>'dryer_ship_via'), '') end,
    dryer_separate_invoice = case when not v_has_dryer then null else v_dry_inv end,
    dryer_invoice_qty      = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else nullif(p->>'dryer_invoice_qty', '')::integer end,
    dryer_invoice_amount   = case when not v_has_dryer or v_dry_inv is distinct from true
                                  then null else nullif(p->>'dryer_invoice_amount', '')::numeric end,

    spares_ship_mode        = case when v_incl_spares is distinct from true then null else v_spr_ship end,
    spares_ship_via         = case when v_incl_spares is distinct from true or v_spr_ship is distinct from 'separate'
                                   then null else nullif(btrim(p->>'spares_ship_via'), '') end,
    spares_separate_invoice = case when v_incl_spares is distinct from true then null else v_spr_inv end,
    spares_invoice_qty      = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else nullif(p->>'spares_invoice_qty', '')::integer end,
    spares_invoice_amount   = case when v_incl_spares is distinct from true or v_spr_inv is distinct from true
                                   then null else nullif(p->>'spares_invoice_amount', '')::numeric end,

    centering_ship_mode        = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_ship end,
    centering_ship_via         = case when coalesce(v_centering, 'no') = 'no' or v_cen_ship is distinct from 'separate'
                                      then null else nullif(btrim(p->>'centering_ship_via'), '') end,
    centering_separate_invoice = case when coalesce(v_centering, 'no') = 'no' then null else v_cen_inv end,
    centering_invoice_qty      = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else nullif(p->>'centering_invoice_qty', '')::integer end,
    centering_invoice_amount   = case when coalesce(v_centering, 'no') = 'no' or v_cen_inv is distinct from true
                                      then null else nullif(p->>'centering_invoice_amount', '')::numeric end,

    -- ⚠ CHANGED (stage E). All four were stored unconditionally, so a machine
    --   that cannot take an air blade could still be recorded as having one -
    --   and the detailed sheet would print it on a contract. 'optional' and
    --   'yes' both mean the machine CAN carry it; 'no' and unmapped mean never.
    air_blade           = case when coalesce(v_air,       'no') = 'no' then null else (p->>'air_blade')::boolean end,
    external_centering  = case when coalesce(v_centering, 'no') = 'no' then null else (p->>'external_centering')::boolean end,
    ink_dust_exhauster  = case when coalesce(v_exhauster, 'no') = 'no' then null else (p->>'ink_dust_exhauster')::boolean end,
    chilling_system     = case when coalesce(v_chilling,  'no') = 'no' then null else (p->>'chilling_system')::boolean end,

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
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_oc(uuid, jsonb) is
  'Write the part-B columns from a jsonb bag, nulling whatever the branch rules hide. The MACHINE decides: needs_dryer gates every dryer column, and each opt_* capability gates its own extra and the centering device''s shipment answers. Quantity and amount are kept only when that item is separately invoiced. High Seas suppresses GST entirely; the rupee value, GST and total are DERIVED. total_inr does NOT include dryer_price. platter_details is ungated on purpose. Touches NO part-A column.';

commit;
