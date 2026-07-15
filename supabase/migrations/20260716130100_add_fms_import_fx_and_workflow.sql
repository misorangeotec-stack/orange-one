-- ===========================================================================
-- Import Purchase FMS — foreign-currency workflow + the import request/payment.
--
-- Two behavioural differences from domestic procurement are baked in here:
--
--  1. NO sourcing. The vendor is chosen on the request header and the rate is
--     read from the vendor-item price master (editable on the line), so a request
--     line is born already at 'approval' with its final vendor/qty/rate/value set
--     — there is no Sourcing queue. `fms_import_submit_request` does the work the
--     domestic `save_sourcing` used to do.
--
--  2. FOREIGN CURRENCY. Prices/POs are in the vendor's currency; an INR
--     equivalent is derived from an exchange rate. The approval matrix routes on
--     an INR value, so `line_value` (INR) is computed at submit from the
--     request-time FX rate (`fx_rate_at_request`), kept DISTINCT from the FX rate
--     captured later at Payment. Foreign amounts live alongside in *_fx columns.
--
-- Additive columns + two replace-only RPCs. Depends on 120200 (workflow core),
-- 130000 (currency master). The `payment` step keeps the internal step_key
-- 'advance_payment' (only its UI title changes to "Payment"); a 100%-advance is
-- guaranteed because the frontend always shares the PO with payment_terms
-- 'full_advance', which drives refresh_po straight to the advance/payment stage.
-- ===========================================================================

-- 1. Currency / FX columns ---------------------------------------------------
alter table public.fms_import_requests
  add column if not exists vendor_id uuid references public.fms_import_vendors on delete restrict,
  add column if not exists currency  text;

alter table public.fms_import_request_items
  add column if not exists currency          text,
  add column if not exists fx_rate_at_request numeric(18,6),
  add column if not exists line_value_fx      numeric(16,2);

alter table public.fms_import_pos
  add column if not exists currency       text,
  add column if not exists total_value_fx numeric(16,2) not null default 0,
  add column if not exists fx_rate        numeric(18,6),
  add column if not exists fx_rate_at     timestamptz,
  add column if not exists fx_source      text;

alter table public.fms_import_payments
  add column if not exists currency    text,
  add column if not exists amount_fx   numeric(16,2),
  add column if not exists fx_rate     numeric(18,6),
  add column if not exists inr_amount  numeric(16,2),
  add column if not exists details     text,
  add column if not exists advice_path text,
  add column if not exists advice_name text;

comment on column public.fms_import_request_items.line_value_fx is
  'Line value in the vendor currency (qty × rate × (1+gst/100)).';
comment on column public.fms_import_request_items.fx_rate_at_request is
  'Exchange rate (foreign→INR) captured at submit, used to derive line_value (INR) for approval routing.';
comment on column public.fms_import_pos.total_value_fx is
  'PO value in the vendor currency. total_value stays the INR equivalent (approval basis).';

-- 2. submit_request — import version (vendor header, no sourcing) ------------
drop function if exists public.fms_import_submit_request(uuid, uuid, text, jsonb);
create or replace function public.fms_import_submit_request(
  p_company_id  uuid,
  p_vendor_id   uuid,
  p_category_id uuid,
  p_note        text,
  p_currency    text,
  p_fx_rate     numeric,
  p_items       jsonb   -- [{item_id, quantity, unit, rate, gst_pct, line_remark}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_no         text;
  v_seq        integer;
  v_fy         text;
  v_elem       jsonb;
  v_qty        numeric(14,3);
  v_rate       numeric(16,4);
  v_gst        numeric(6,2);
  v_val_fx     numeric(16,2);
  v_val_inr    numeric(16,2);
  v_fx         numeric(18,6);
begin
  if p_company_id is null or p_vendor_id is null or p_category_id is null then
    raise exception 'Company, vendor and category are required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item line is required';
  end if;
  v_fx := coalesce(p_fx_rate, 0);
  if v_fx <= 0 then
    raise exception 'A valid exchange rate is required';
  end if;

  v_fy  := public.fms_import_fy_code(current_date);
  v_seq := public.fms_import_next_seq('request:' || v_fy);
  v_no  := 'IPR-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_import_requests (request_no, company_id, category_id, vendor_id, currency, requester_id, note)
  values (v_no, p_company_id, p_category_id, p_vendor_id, nullif(p_currency,''), auth.uid(), nullif(p_note, ''))
  returning id into v_request_id;

  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_qty  := coalesce((v_elem->>'quantity')::numeric, 0);
    v_rate := coalesce((v_elem->>'rate')::numeric, 0);
    v_gst  := nullif(v_elem->>'gst_pct','')::numeric;
    if v_qty <= 0 then raise exception 'Each item needs a quantity greater than 0'; end if;
    if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;

    v_val_fx  := round(v_qty * v_rate * (1 + coalesce(v_gst,0)/100.0), 2);
    v_val_inr := round(v_val_fx * v_fx, 2);

    insert into public.fms_import_request_items (
      request_id, item_id, quantity, unit, line_remark,
      final_vendor_id, final_qty, final_rate, gst_pct, currency,
      fx_rate_at_request, line_value_fx, line_value,
      status, sourced_at
    )
    values (
      v_request_id,
      (v_elem->>'item_id')::uuid,
      v_qty,
      coalesce(v_elem->>'unit', ''),
      nullif(v_elem->>'line_remark', ''),
      p_vendor_id, v_qty, v_rate, v_gst, nullif(p_currency,''),
      v_fx, v_val_fx, v_val_inr,
      'approval', now()   -- no sourcing: line enters straight at approval; sourced_at anchors the SLA
    );
  end loop;

  return v_request_id;
end $$;
grant execute on function public.fms_import_submit_request(uuid, uuid, uuid, text, text, numeric, jsonb) to authenticated;

-- 3. record_payment — carry currency / FX / advice on the payment ------------
-- p_amount is the INR value (caps against the PO's INR total_value); p_amount_fx
-- is the vendor-currency amount actually paid. Keeps the 'advance_payment' owner
-- authz from 20260716122600.
drop function if exists public.fms_import_record_payment(uuid, text, numeric, uuid, date, text, text);
create or replace function public.fms_import_record_payment(
  p_po_id uuid, p_kind text, p_amount numeric,
  p_pi_id uuid default null, p_paid_on date default null, p_utr text default null,
  p_pi_remarks text default null,
  p_currency text default null, p_fx_rate numeric default null,
  p_amount_fx numeric default null, p_details text default null,
  p_advice_path text default null, p_advice_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_total_fx numeric(16,2);
  v_paid_fx  numeric(16,2);
begin
  if not (public.is_admin(auth.uid())
          or public.fms_import_is_step_owner('advance_payment', auth.uid())) then
    raise exception 'Not authorized to record payments';
  end if;
  if p_kind not in ('advance','installment') then raise exception 'Invalid payment kind'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Amount must be greater than 0'; end if;

  -- Cap on the FOREIGN amount vs the PO's foreign value — NOT on INR. A 100%
  -- advance is the whole foreign PO value; the INR equivalent varies with the FX
  -- rate at payment vs at request, so an INR cap would wrongly reject a full pay
  -- when the currency has appreciated. (Import always pays whole-PO; p_pi_id null.)
  select total_value_fx into v_total_fx from public.fms_import_pos where id = p_po_id for update;
  select coalesce(sum(amount_fx),0) into v_paid_fx from public.fms_import_payments where po_id = p_po_id;
  if p_amount_fx is not null and coalesce(v_total_fx,0) > 0
     and v_paid_fx + p_amount_fx > v_total_fx + 0.01 then
    raise exception 'Payment exceeds the PO value (% paid of %)', v_paid_fx + p_amount_fx, v_total_fx;
  end if;

  insert into public.fms_import_payments
    (po_id, pi_id, kind, amount, paid_on, utr_ref, pi_remarks,
     currency, amount_fx, fx_rate, inr_amount, details, advice_path, advice_name, created_by)
  values
    (p_po_id, p_pi_id, p_kind, p_amount, coalesce(p_paid_on, current_date), nullif(p_utr,''), nullif(p_pi_remarks,''),
     nullif(p_currency,''), p_amount_fx, p_fx_rate, p_amount, nullif(p_details,''), nullif(p_advice_path,''), nullif(p_advice_name,''), auth.uid())
  returning id into v_id;   -- inr_amount mirrors the INR `amount` we capped on

  perform public.fms_import_refresh_po(p_po_id);
  return v_id;
end $$;
grant execute on function public.fms_import_record_payment(uuid, text, numeric, uuid, date, text, text, text, numeric, numeric, text, text, text) to authenticated;

-- 4. generate_po — also stamp the PO's foreign currency + foreign total ---------
-- The base (renamed) generate_po sums only total_value (INR). Import PO screens /
-- the Payment modal need the vendor-currency total + currency on the PO too.
create or replace function public.fms_import_generate_po(
  p_vendor_id  uuid,
  p_company_id uuid,
  p_request_item_ids uuid[],
  p_po_no      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id   uuid;
  v_no      text;
  v_seq     integer;
  v_fy      text;
  v_id      uuid;
  v_total   numeric(16,2) := 0;
  v_totalfx numeric(16,2) := 0;
  v_fqty    numeric(14,3);
  v_frate   numeric(14,2);
  v_fgst    numeric(6,2);
  v_lval    numeric(16,2);
  v_lvalfx  numeric(16,2);
  v_vendor  uuid;
  v_lstatus text;
  v_company uuid;
  v_ccy     text;
begin
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to generate POs';
  end if;
  if p_request_item_ids is null or array_length(p_request_item_ids, 1) is null then
    raise exception 'Select at least one line for the PO';
  end if;

  if p_po_no is not null and exists (select 1 from public.fms_import_pos where po_no = p_po_no) then
    raise exception 'PO number % already exists', p_po_no;
  end if;
  if p_po_no is null then
    v_fy  := public.fms_import_fy_code(current_date);
    v_seq := public.fms_import_next_seq('po:' || v_fy);
    v_no  := 'IPO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');
  else
    v_no := p_po_no;
  end if;

  insert into public.fms_import_pos (po_no, vendor_id, company_id, created_by)
  values (v_no, p_vendor_id, p_company_id, auth.uid())
  returning id into v_po_id;

  foreach v_id in array p_request_item_ids loop
    select ri.status, ri.final_vendor_id, ri.final_qty, ri.final_rate, ri.gst_pct,
           ri.line_value, ri.line_value_fx, ri.currency, r.company_id
      into v_lstatus, v_vendor, v_fqty, v_frate, v_fgst, v_lval, v_lvalfx, v_ccy, v_company
    from public.fms_import_request_items ri
    join public.fms_import_requests r on r.id = ri.request_id
    where ri.id = v_id
    for update of ri;

    if v_lstatus is null then raise exception 'Line % not found', v_id; end if;
    if v_lstatus <> 'approved_pending_po' then
      raise exception 'Line % is not an approved pool line (status %)', v_id, v_lstatus;
    end if;
    if v_vendor is distinct from p_vendor_id then raise exception 'Line % is for a different vendor', v_id; end if;
    if v_company is distinct from p_company_id then raise exception 'Line % belongs to a different company', v_id; end if;

    insert into public.fms_import_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value)
    values (v_po_id, v_id, v_fqty, v_frate, v_fgst, v_lval);

    update public.fms_import_request_items set status = 'po' where id = v_id;
    v_total   := v_total + coalesce(v_lval, 0);
    v_totalfx := v_totalfx + coalesce(v_lvalfx, 0);
  end loop;

  update public.fms_import_pos
     set total_value = v_total, total_value_fx = v_totalfx, currency = v_ccy
   where id = v_po_id;
  return v_po_id;
end $$;
grant execute on function public.fms_import_generate_po(uuid, uuid, uuid[], text) to authenticated;
