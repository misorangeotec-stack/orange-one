-- ===========================================================================
-- OCPI — STAGE C of the revision: High Seas / Others decides currency and tax,
-- and the rupee figures stop being typed twice.
--
-- WHAT THE CLIENT ASKED FOR
--   Section C now opens with one choice — High Seas or Others — and everything
--   commercial follows from it:
--     · High Seas ⇒ the deal is in USD, always, and NO GST is charged.
--     · Others    ⇒ GST is charged at the stated rate.
--   A dollar deal shows both currencies, converted at a live rate the
--   salesperson may override; a rupee deal shows rupees alone.
--
-- ⚠ transport_terms IS ALREADY THAT FIELD. It has held `high_seas` / `local`
--   since phase 1. This migration gives it consequences; it does NOT add a
--   parallel "deal type" column. The UI relabels `local` as "Others" — the
--   stored value is untouched, so every existing row and every frozen version
--   still reads correctly.
--
-- THE TWO PRICES THAT COULD DISAGREE
--   `deal_value_amount` (part A, INR *or* USD) and `machine_value_inr` (part B,
--   rupees, and what the detailed sheet's total is built from) were typed
--   separately, on two forms, with nothing reconciling them. A salesperson could
--   quote ₹52,00,000 on the quotation and type ₹50,00,000 on the order
--   confirmation and nothing anywhere would notice.
--
--   So machine_value_inr, gst_amount_inr and total_inr are now DERIVED here,
--   from the deal value and the GST rate, and the payload's own values for them
--   are ignored. There is one price on a deal.
--
-- ⚠ THE GST SUPPRESSION LIVES IN write_oc, NOT write_quotation. gst_rate is a
--   part-B column, and the two writers must keep their column separation or
--   saving one blanks the other (20260929121000's header). write_oc already
--   reads part-A answers off the row to branch — incl_head, dryer_type — so
--   transport_terms simply joins them.
--
-- ⚠ HIGH SEAS PRINTS NO GST ROW AT ALL, NOT A ZERO ONE. `gst_rate` is set NULL
--   rather than 0, and gst_amount_inr with it, so the renderer can tell "no tax
--   applies" from "tax of nothing". A zero-tax line on a high-seas contract is a
--   different claim from no line, and only one of them is true.
--
-- ⚠ THE FX RATE IS FROZEN, NEVER RE-DERIVED. Import learned this
--   (20260716130100): a rate looked up again at print time silently restates
--   arithmetic the customer already agreed to. The rate lives on the row, and
--   stage D copies it onto each quotation version beside the frozen document.
--
-- Reversal (reverse order):
--   -- re-run 20261019120100's fms_ocpi_write_quotation verbatim
--   -- re-run 20260929121000's fms_ocpi_write_oc verbatim
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Part A — the deal type forces the currency, and the FX position is stored.
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
  -- ⚠ HIGH SEAS IS ALWAYS A DOLLAR DEAL. Forced here and not merely defaulted in
  --   the form, so a stale INR left on the row cannot survive the switch.
  v_currency      text    := case when v_transport = 'high_seas' then 'USD'
                                  else nullif(btrim(p->>'deal_value_currency'), '') end;
  v_amount        numeric := nullif(p->>'deal_value_amount', '')::numeric;
  v_fx            numeric := nullif(p->>'fx_rate', '')::numeric;
begin
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
    machine_id         = nullif(p->>'machine_id', '')::uuid,
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
    dryer_type         = nullif(btrim(p->>'dryer_type'), ''),

    deal_value_currency = v_currency,
    deal_value_amount   = v_amount,

    -- ---- the FX position, for a dollar deal --------------------------------
    -- Cleared outright on a rupee deal: a stale rate left behind would convert
    -- a figure that needs no converting, and print it.
    fx_rate            = case when v_currency = 'USD' then v_fx else null end,
    fx_rate_at         = case when v_currency = 'USD'
                              then nullif(p->>'fx_rate_at', '')::timestamptz else null end,
    fx_rate_source     = case when v_currency = 'USD'
                              then nullif(btrim(p->>'fx_rate_source'), '') else null end,
    fx_rate_overridden = case when v_currency = 'USD'
                              then (p->>'fx_rate_overridden')::boolean else null end,
    -- The rupee equivalent, computed here rather than trusted from the browser.
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
  'Write the part-A columns from a jsonb bag, nulling whatever the branch rules hide. High Seas forces USD; the FX rate and the rupee equivalent are stored for a dollar deal and cleared for a rupee one. Touches NO part-B column.';

-- ---------------------------------------------------------------------------
-- 2 · Part B — no GST on high seas, and the rupee totals are derived.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_write_oc(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incl_head boolean;
  v_dryer     text;
  v_transport text;
  v_currency  text;
  v_amount    numeric;
  v_inr       numeric;
  v_ship_mode text := nullif(btrim(p->>'head_ship_mode'), '');
  v_rate      numeric;
  v_value     numeric;
  v_gst       numeric;
begin
  -- Read the PART-A answers this form branches on. They are not in the payload —
  -- part B does not own them — so they come from the row.
  select incl_head, dryer_type, transport_terms, deal_value_currency,
         deal_value_amount, deal_value_inr
    into v_incl_head, v_dryer, v_transport, v_currency, v_amount, v_inr
    from public.fms_ocpi_deals where id = p_deal;

  -- ⚠ HIGH SEAS ATTRACTS NO GST. Null, not zero — see the header.
  v_rate := case when v_transport = 'high_seas' then null
                 else nullif(p->>'gst_rate', '')::numeric end;

  -- ⚠ THE RUPEE VALUE IS DERIVED, NOT TYPED. One price on a deal.
  v_value := case when v_currency = 'USD' then v_inr else v_amount end;
  v_gst   := case when v_rate is null or v_value is null then null
                  else round(v_value * v_rate / 100, 2) end;

  update public.fms_ocpi_deals set
    head_ship_mode        = case when v_incl_head is distinct from true then null else v_ship_mode end,
    head_ship_via         = case when v_incl_head is distinct from true or v_ship_mode is distinct from 'separate'
                                 then null else nullif(btrim(p->>'head_ship_via'), '') end,
    head_balance_remarks  = case when v_incl_head is distinct from true then null
                                 else nullif(btrim(p->>'head_balance_remarks'), '') end,
    head_separate_invoice = case when v_incl_head is distinct from true then null
                                 else (p->>'head_separate_invoice')::boolean end,

    dryer_chambers = case when v_dryer is null or v_dryer = 'Not Applicable' then null
                          else nullif(btrim(p->>'dryer_chambers'), '') end,
    heating_mode   = case when v_dryer is null or v_dryer = 'Not Applicable' then null
                          else nullif(btrim(p->>'heating_mode'), '') end,
    dryer_warranty = case when v_dryer is null or v_dryer = 'Not Applicable' then null
                          else nullif(btrim(p->>'dryer_warranty'), '') end,
    platter_details = nullif(btrim(p->>'platter_details'), ''),

    air_blade           = (p->>'air_blade')::boolean,
    external_centering  = (p->>'external_centering')::boolean,
    ink_dust_exhauster  = (p->>'ink_dust_exhauster')::boolean,
    chilling_system     = (p->>'chilling_system')::boolean,

    other_commitments       = nullif(btrim(p->>'other_commitments'), ''),
    printer_warranty        = nullif(btrim(p->>'printer_warranty'), ''),
    head_warranty           = nullif(btrim(p->>'head_warranty'), ''),
    post_warranty_head_price = nullif(p->>'post_warranty_head_price', '')::numeric,
    consumables_supplier    = nullif(btrim(p->>'consumables_supplier'), ''),
    insurance_clause_agreed = (p->>'insurance_clause_agreed')::boolean,

    ref_no            = nullif(btrim(p->>'ref_no'), ''),
    delivery_days     = nullif(btrim(p->>'delivery_days'), ''),
    trade_term        = nullif(btrim(p->>'trade_term'), ''),
    machine_model_no  = nullif(btrim(p->>'machine_model_no'), ''),
    prepared_by       = nullif(btrim(p->>'prepared_by'), ''),
    approved_by       = nullif(btrim(p->>'approved_by'), ''),

    -- Derived, not taken from the payload — see the header.
    gst_rate          = v_rate,
    machine_value_inr = v_value,
    gst_amount_inr    = v_gst,
    total_inr         = case when v_value is null then null else v_value + coalesce(v_gst, 0) end
  where id = p_deal;
end $$;

comment on function public.fms_ocpi_write_oc(uuid, jsonb) is
  'Write the part-B columns from a jsonb bag, nulling whatever the branch rules hide. High Seas suppresses GST entirely (null, not zero); the rupee value, GST and total are DERIVED from the deal value, never typed. Touches NO part-A column.';

commit;
