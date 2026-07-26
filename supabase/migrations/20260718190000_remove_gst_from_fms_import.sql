-- Remove GST from the Import Purchase FMS.
--
-- GST is not applicable to an import purchase — the goods come from a foreign
-- vendor. The Import FMS was forked from the domestic Procurement FMS and
-- carried its GST plumbing across untouched: the New Request form asked for a
-- GST %, and every line's value was computed as qty × rate × (1 + gst/100).
-- That value routes the line to an approval band, so a stray GST % silently
-- inflated the approval tier.
--
-- After this migration a line's value is simply qty × rate (× fx for the INR
-- equivalent), and nothing reads or writes gst_pct / gstin.
--
-- ADDITIVE-ONLY: the gst_pct and gstin columns are NOT dropped. They are nulled
-- and left in place so nothing that still references them breaks and
-- database.types.ts needs no regeneration.
--
-- Verified on live before writing this: gst_pct is already null on all
-- request_items (3), quotations (0), po_items (1) and vendor_item_prices (95),
-- and every stored line_value already equals qty × rate × fx exactly. So the
-- backfill below is a no-op on today's data — it is kept because it is
-- idempotent and guards any row created between that check and this migration.
-- The only rows that actually change are the 4 vendors, whose gstin holds the
-- placeholder string 'IMPORT' rather than a real registration number.

begin;

-- 1. Backfill -----------------------------------------------------------------

-- Request items. line_value is INR, line_value_fx is the vendor currency.
-- fx_rate_at_request is nullable (added by 20260716130100 with no backfill), so
-- guard it: multiplying by NULL would blank line_value and then violate the
-- NOT NULL on fms_import_po_items.line_value downstream.
update public.fms_import_request_items
   set line_value_fx = round(coalesce(final_qty,0) * coalesce(final_rate,0), 2),
       line_value    = round(coalesce(final_qty,0) * coalesce(final_rate,0)
                             * fx_rate_at_request, 2),
       gst_pct       = null
 where fx_rate_at_request is not null;

-- PO items. Copy from the recomputed requisition line rather than recomputing:
-- fms_import_po_items has no line_value_fx column and its line_value is the INR
-- figure, so copying both guarantees the PO ties back to its requisition and
-- sidesteps the NULL-fx case above.
update public.fms_import_po_items pi
   set line_value = ri.line_value,
       gst_pct    = null
  from public.fms_import_request_items ri
 where pi.request_item_id = ri.id
   and ri.line_value is not null;

-- PO headers. total_value / total_value_fx are written ONCE by generate_po and
-- are never recomputed by fms_import_refresh_po, so without this they would keep
-- a GST-inclusive total that drives the payment cap and the stage gate.
update public.fms_import_pos p
   set total_value    = coalesce(s.inr, 0),
       total_value_fx = coalesce(s.fx, 0)
  from (select pi.po_id,
               sum(pi.line_value)    as inr,
               sum(ri.line_value_fx) as fx
          from public.fms_import_po_items pi
          join public.fms_import_request_items ri on ri.id = pi.request_item_id
         group by pi.po_id) s
 where p.id = s.po_id;

update public.fms_import_quotations         set gst_pct = null where gst_pct is not null;
update public.fms_import_vendor_item_prices set gst_pct = null where gst_pct is not null;
update public.fms_import_vendors            set gstin   = null where gstin   is not null;

comment on column public.fms_import_request_items.line_value_fx is
  'Line value in the vendor currency (qty × rate). GST does not apply to imports.';

-- 2. RPCs ---------------------------------------------------------------------
-- Five functions applied GST. Each body below is copied from the CURRENT live
-- definition (verified with pg_get_functiondef, not from the first migration
-- that declared it) with only the value math changed — several were superseded
-- after they were introduced, and rewriting from a stale body would revert the
-- step-timestamp / SLA work that lib/sla.ts depends on.

-- 2a. submit_request — current body from 20260716130100. -----------------------
-- p_items no longer carries gst_pct.
create or replace function public.fms_import_submit_request(
  p_company_id  uuid,
  p_vendor_id   uuid,
  p_category_id uuid,
  p_note        text,
  p_currency    text,
  p_fx_rate     numeric,
  p_items       jsonb   -- [{item_id, quantity, unit, rate, line_remark}]
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
    if v_qty <= 0 then raise exception 'Each item needs a quantity greater than 0'; end if;
    if v_rate < 0 then raise exception 'Rate cannot be negative'; end if;

    v_val_fx  := round(v_qty * v_rate, 2);   -- no GST on an import line
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
      p_vendor_id, v_qty, v_rate, null, nullif(p_currency,''),
      v_fx, v_val_fx, v_val_inr,
      'approval', now()   -- no sourcing: line enters straight at approval; sourced_at anchors the SLA
    );
  end loop;

  return v_request_id;
end $$;
grant execute on function public.fms_import_submit_request(uuid, uuid, uuid, text, text, numeric, jsonb) to authenticated;

-- 2b. save_sourcing — current body from 20260716122500 (keeps sourced_at). -----
-- p_gst_pct is retained in the signature but ignored: dropping a parameter would
-- break the existing client contract. It can go in a later cleanup.
create or replace function public.fms_import_save_sourcing(
  p_request_item_id uuid, p_quotations jsonb, p_recommended_vendor_id uuid,
  p_final_qty numeric, p_final_rate numeric,
  p_gst_pct numeric default null, p_sourcing_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_elem   jsonb;
  v_value  numeric(16,2);
begin
  select status into v_status from public.fms_import_request_items
   where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('sourcing','approval','on_hold') then
    raise exception 'This line is not open for sourcing (status %)', v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_import_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this line';
  end if;
  if p_recommended_vendor_id is null then raise exception 'A recommended vendor is required'; end if;
  if coalesce(p_final_qty,0) <= 0 or coalesce(p_final_rate,0) < 0 then
    raise exception 'Final qty must be > 0 and rate >= 0';
  end if;

  delete from public.fms_import_quotations where request_item_id = p_request_item_id;
  if p_quotations is not null then
    for v_elem in select * from jsonb_array_elements(p_quotations) loop
      insert into public.fms_import_quotations
        (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
      values (
        p_request_item_id,
        (v_elem->>'vendor_id')::uuid,
        (v_elem->>'rate')::numeric,
        null,
        nullif(v_elem->>'lead_time_days','')::integer,
        nullif(v_elem->>'remark',''),
        ((v_elem->>'vendor_id')::uuid = p_recommended_vendor_id)
      );
    end loop;
  end if;

  v_value := round(p_final_qty * p_final_rate, 2);   -- no GST on an import line

  update public.fms_import_request_items
     set final_vendor_id = p_recommended_vendor_id,
         final_qty = p_final_qty,
         final_rate = p_final_rate,
         gst_pct = null,
         line_value = v_value,
         sourcing_reason = nullif(p_sourcing_reason,''),
         status = 'approval',
         reject_reason = null,
         sourced_at = now()   -- re-sourcing restarts the approval clock
   where id = p_request_item_id;
end $$;
grant execute on function public.fms_import_save_sourcing(uuid, jsonb, uuid, numeric, numeric, numeric, text) to authenticated;

-- 2c. decide_approval — current body from 20260716122500 -----------------------
-- (keeps approved_at stamping and the assigned_approver_id authz path).
-- The 'override' branch is unreachable in Import — there is no sourcing step, so
-- there are never any quotations to override with — but it is fixed defensively.
create or replace function public.fms_import_decide_approval(
  p_request_item_id uuid, p_decision text,
  p_override_vendor_id uuid default null, p_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status   text;
  v_value    numeric(16,2);
  v_approver uuid;
  v_tier     text;
  v_qrate    numeric(14,2);
  v_assigned uuid;
begin
  select status, line_value, assigned_approver_id
    into v_status, v_value, v_assigned
    from public.fms_import_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'This line is not awaiting approval (status %)', v_status;
  end if;

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_import_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null,
           approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate into v_qrate from public.fms_import_quotations
      where request_item_id = p_request_item_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_import_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_request_item_id;
    update public.fms_import_request_items
       set final_vendor_id = p_override_vendor_id,
           final_rate = v_qrate,
           gst_pct = null,
           line_value = round(final_qty * v_qrate, 2),   -- no GST on an import line
           status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null,
           approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           assigned_approver_id = null
     where id = p_request_item_id;

  elsif p_decision = 'hold' then
    update public.fms_import_request_items set status = 'on_hold' where id = p_request_item_id;

  elsif p_decision = 'resume' then
    -- Back to awaiting approval — the line is no longer approved.
    update public.fms_import_request_items
       set status = 'approval', approved_at = null
     where id = p_request_item_id;

  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end $$;
grant execute on function public.fms_import_decide_approval(uuid, text, uuid, text) to authenticated;

-- 2d. generate_po — current body from 20260716130100. --------------------------
-- Stops copying gst_pct onto the PO line.
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
    select ri.status, ri.final_vendor_id, ri.final_qty, ri.final_rate,
           ri.line_value, ri.line_value_fx, ri.currency, r.company_id
      into v_lstatus, v_vendor, v_fqty, v_frate, v_lval, v_lvalfx, v_ccy, v_company
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
    values (v_po_id, v_id, v_fqty, v_frate, null, v_lval);

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

-- 2e. resolve_master_request — current body from 20260716130000. ---------------
-- This is the master-request APPROVAL path, and it is the one that would quietly
-- undo the backfill above: the next approved vendor or vendor-item-price request
-- would re-insert gstin / gst_pct straight from proposed_payload. Both keys are
-- now ignored. Older pending requests whose payload still carries them are
-- unaffected — the keys are simply not read.
create or replace function public.fms_import_resolve_master_request(
  p_request_id uuid, p_approve boolean, p_payload jsonb default null, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_import_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_import_vendors (name, gstin, contact_name, phone, email, address, default_currency, created_by)
      values (
        nullif(v_payload->>'name',''), null, v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address',
        nullif(v_payload->>'default_currency',''), auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_import_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      insert into public.fms_import_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      insert into public.fms_import_items (item_group_id, name, unit, created_by)
      values ((v_payload->>'item_group_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_import_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    elsif v_type = 'vendor_item_price' then
      insert into public.fms_import_vendor_item_prices (vendor_id, item_id, currency, rate, gst_pct, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'currency',''), 'USD'),
        coalesce((v_payload->>'rate')::numeric, 0),
        null,
        auth.uid()
      )
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_import_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_import_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
grant execute on function public.fms_import_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

commit;
