-- ===========================================================================
-- OCPI-3 · the dryer attracts GST, exactly like the machine.
--
-- ANSWERED BY THE CLIENT, 29-Aug-2026: "the dryer line becomes with GST the
-- same way you have presented the machine". This was the one thing left
-- deliberately unresolved in stages I and J.
--
-- WHAT WAS HAPPENING. When a dryer is NOT part of the deal it carries its own
-- price. `total_inr` deliberately excluded it, because nobody had said whether
-- tax applied - so the two papers ADDED THE TWO FIGURES IN THE BROWSER for
-- display, and the dryer line was marked "excluding GST". That was a holding
-- position, and its own comment said the addition belonged here once answered.
--
-- WHAT HAPPENS NOW. Three derived columns, computed and stored the same way the
-- machine's money already is:
--
--     dryer_value_inr   the dryer price in RUPEES
--     dryer_gst_inr     GST on the dryer, at the deal's own rate
--     grand_total_inr   machine + its GST + dryer + its GST
--
-- ⚠ total_inr IS UNCHANGED and still means THE MACHINE TOTAL. The papers print
--   machine total -> dryer total -> final total, which is what the client asked
--   for; re-pointing total_inr at the grand total would silently restate every
--   figure that has ever been derived from it.
--
-- ⚠ THE DRYER IS QUOTED IN THE DEAL'S CURRENCY, like the machine value. A USD
--   deal converts it at the SAME frozen fx_rate, so a contract's arithmetic can
--   still be reproduced from the contract. Without this the dryer price would be
--   read as rupees on a dollar deal - an ~85x error on a contract, which is the
--   exact mistake the currency column was added to prevent.
--
-- ⚠ HIGH SEAS STILL ATTRACTS NO GST AT ALL. v_rate is null there, so the
--   dryer's GST is null too and the grand total is machine + dryer. No zero-tax
--   row appears: a zero-tax line and no line are different claims.
--
-- ADDITIVE ONLY. Three new nullable columns; one function body re-issued.
-- ROLLBACK: re-run 20261021140000 for the previous fms_ocpi_write_oc body. The
--   columns can stay - nothing else reads them.
-- ===========================================================================

begin;

alter table public.fms_ocpi_deals
  add column if not exists dryer_value_inr numeric(16, 2),
  add column if not exists dryer_gst_inr   numeric(16, 2),
  add column if not exists grand_total_inr numeric(16, 2);

comment on column public.fms_ocpi_deals.dryer_value_inr is
  'The separately-charged dryer price IN RUPEES. Equals dryer_price on a rupee deal; converted at the frozen fx_rate on a dollar one, exactly like machine_value_inr. Derived - never taken from the payload.';
comment on column public.fms_ocpi_deals.dryer_gst_inr is
  'GST on the dryer, at the deal own gst_rate. Null on a High Seas deal, which attracts no GST at all - null, not zero.';
comment on column public.fms_ocpi_deals.grand_total_inr is
  'What the customer pays in total: machine + its GST + dryer + its GST. total_inr remains the MACHINE total; the papers print machine total, dryer total, final total.';

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
  v_fx          numeric;
  v_ship_mode   text := nullif(btrim(p->>'head_ship_mode'), '');
  v_rate        numeric;
  v_value       numeric;
  v_gst         numeric;
  v_has_dryer   boolean;
  v_centering   text;
  v_air         text;
  v_exhauster   text;
  v_chilling    text;
  v_dry_price   numeric;
  v_dry_inr     numeric;
  v_dry_gst     numeric;
  v_grand       numeric;
  v_dry_ship    text := nullif(btrim(p->>'dryer_ship_mode'), '');
  v_spr_ship    text := nullif(btrim(p->>'spares_ship_mode'), '');
  v_cen_ship    text := nullif(btrim(p->>'centering_ship_mode'), '');
  v_dry_inv     boolean := (p->>'dryer_separate_invoice')::boolean;
  v_spr_inv     boolean := (p->>'spares_separate_invoice')::boolean;
  v_cen_inv     boolean := (p->>'centering_separate_invoice')::boolean;
  v_head_inv    boolean := (p->>'head_separate_invoice')::boolean;
begin
  select d.incl_head, d.incl_spares, d.transport_terms,
         d.deal_value_currency, d.deal_value_amount, d.deal_value_inr, d.fx_rate,
         m.needs_dryer,
         m.opt_external_centering, m.opt_air_blade,
         m.opt_ink_dust_exhauster, m.opt_chilling_system
    into v_incl_head, v_incl_spares, v_transport,
         v_currency, v_amount, v_inr, v_fx,
         v_has_dryer,
         v_centering, v_air,
         v_exhauster, v_chilling
    from public.fms_ocpi_deals d
    left join public.fms_ocpi_machines m on m.id = d.machine_id
   where d.id = p_deal;

  v_has_dryer := v_has_dryer is true;

  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  -- The dryer's own money. A price exists only when the dryer is NOT part of the
  -- deal; everything below is null when it is.
  v_dry_price := case when not v_has_dryer or (p->>'dryer_included')::boolean is not false
                      then null else nullif(p->>'dryer_price', '')::numeric end;

  -- Quoted in the DEAL's currency and converted at the SAME frozen rate as the
  -- machine - see the file header for why reading it as rupees would be an ~85x
  -- error on a dollar contract.
  v_dry_inr := case
                 when v_dry_price is null then null
                 when v_currency = 'USD'
                   then case when v_fx is null then null else round(v_dry_price * v_fx, 2) end
                 else v_dry_price
               end;

  v_dry_gst := case when v_rate is null or v_dry_inr is null then null
                    else round(v_dry_inr * v_rate / 100, 2) end;

  -- What the customer actually pays. Null only when the MACHINE total is
  -- unknown: an incomplete deal must print a blank, never a total that quietly
  -- treats a missing figure as zero.
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
                                 then null else nullif(p->>'head_invoice_qty', '')::integer end,
    head_invoice_amount   = case when v_incl_head is distinct from true or v_head_inv is distinct from true
                                 then null else nullif(p->>'head_invoice_amount', '')::numeric end,

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
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end,
    dryer_value_inr   = v_dry_inr,
    dryer_gst_inr     = v_dry_gst,
    grand_total_inr   = v_grand
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_oc(uuid, jsonb) is
  'Write the part-B columns from a jsonb bag, nulling whatever the branch rules hide. The MACHINE decides: needs_dryer gates every dryer column, and each opt_ capability gates its own extra and the centering shipment answers. Quantity and amount are kept only when that item is separately invoiced. High Seas suppresses GST entirely. DERIVED here: the rupee value, GST and total for the machine, and - since 29-Aug-2026 - the dryer rupee value, its GST at the same rate, and grand_total_inr. total_inr still means the MACHINE total. Touches NO part-A column.';

commit;
