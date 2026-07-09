-- ===========================================================================
-- Purchase FMS (procurement) — AUTHORITATIVE step-completion timestamps.
--
-- Due dates are becoming admin-configurable as "anchor step's completion + N
-- working days", where the anchor may be ANY earlier step. That needs a reliable
-- "this step finished at <ts>" for every step.
--
-- 8 of the 11 steps already have one on a domain row that only exists once the
-- step is done (PO / PI / Payment / GRN / TallyBooking / Followup / RequestItem
-- created_at). Three do not — `sourcing`, `approval` and `share_po` only left a
-- row in fms_purchase_activity, which that migration itself calls "best-effort,
-- never the source of truth" (the client fires `announce` separately and
-- `safeAnnounce` swallows failures). So the trail can be missing even though the
-- step completed.
--
-- Fix: three nullable timestamp columns, stamped INSIDE the SECURITY DEFINER RPCs
-- that perform the transition, so they cannot drift from the state they describe.
-- Existing rows are backfilled from the activity trail where it happens to exist,
-- else from the row's own created_at.
--
-- Additive / replace-only.
-- ===========================================================================

-- 1. Columns -----------------------------------------------------------------
alter table public.fms_purchase_request_items
  add column if not exists sourced_at  timestamptz,
  add column if not exists approved_at timestamptz;
alter table public.fms_purchase_pos
  add column if not exists shared_at timestamptz;

comment on column public.fms_purchase_request_items.sourced_at is
  'When sourcing was saved for this line (re-sourcing restarts the clock).';
comment on column public.fms_purchase_request_items.approved_at is
  'When the line was approved/overridden. Cleared if the approval is resumed.';
comment on column public.fms_purchase_pos.shared_at is
  'When the PO was first shared with the vendor. Set once.';

-- 2. save_sourcing — stamp sourced_at ----------------------------------------
create or replace function public.fms_purchase_save_sourcing(
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
  select status into v_status from public.fms_purchase_request_items
   where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('sourcing','approval','on_hold') then
    raise exception 'This line is not open for sourcing (status %)', v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this line';
  end if;
  if p_recommended_vendor_id is null then raise exception 'A recommended vendor is required'; end if;
  if coalesce(p_final_qty,0) <= 0 or coalesce(p_final_rate,0) < 0 then
    raise exception 'Final qty must be > 0 and rate >= 0';
  end if;

  delete from public.fms_purchase_quotations where request_item_id = p_request_item_id;
  if p_quotations is not null then
    for v_elem in select * from jsonb_array_elements(p_quotations) loop
      insert into public.fms_purchase_quotations
        (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
      values (
        p_request_item_id,
        (v_elem->>'vendor_id')::uuid,
        (v_elem->>'rate')::numeric,
        nullif(v_elem->>'gst_pct','')::numeric,
        nullif(v_elem->>'lead_time_days','')::integer,
        nullif(v_elem->>'remark',''),
        ((v_elem->>'vendor_id')::uuid = p_recommended_vendor_id)
      );
    end loop;
  end if;

  v_value := round(p_final_qty * p_final_rate * (1 + coalesce(p_gst_pct,0)/100.0), 2);

  update public.fms_purchase_request_items
     set final_vendor_id = p_recommended_vendor_id,
         final_qty = p_final_qty,
         final_rate = p_final_rate,
         gst_pct = p_gst_pct,
         line_value = v_value,
         sourcing_reason = nullif(p_sourcing_reason,''),
         status = 'approval',
         reject_reason = null,
         sourced_at = now()   -- re-sourcing restarts the approval clock
   where id = p_request_item_id;
end $$;
grant execute on function public.fms_purchase_save_sourcing(uuid, jsonb, uuid, numeric, numeric, numeric, text) to authenticated;

-- 3. decide_approval — stamp approved_at (cleared on resume) ------------------
create or replace function public.fms_purchase_decide_approval(
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
  v_qgst     numeric(6,2);
  v_assigned uuid;
begin
  select status, line_value, assigned_approver_id
    into v_status, v_value, v_assigned
    from public.fms_purchase_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'This line is not awaiting approval (status %)', v_status;
  end if;

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null,
           approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_request_item_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_request_item_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id,
           final_rate = v_qrate,
           gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null,
           approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           assigned_approver_id = null
     where id = p_request_item_id;

  elsif p_decision = 'hold' then
    update public.fms_purchase_request_items set status = 'on_hold' where id = p_request_item_id;

  elsif p_decision = 'resume' then
    -- Back to awaiting approval — the line is no longer approved.
    update public.fms_purchase_request_items
       set status = 'approval', approved_at = null
     where id = p_request_item_id;

  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end $$;
grant execute on function public.fms_purchase_decide_approval(uuid, text, uuid, text) to authenticated;

-- 4. share_po — stamp shared_at (set once) -----------------------------------
drop function if exists public.fms_purchase_share_po(uuid, text, text, text, text, text, date);
create or replace function public.fms_purchase_share_po(
  p_po_id uuid,
  p_document_path text default null,
  p_document_name text default null,
  p_tally_po_no text default null,
  p_remarks text default null,
  p_payment_terms text default null,
  p_dispatch_date date default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('share_po', auth.uid())) then
    raise exception 'Not authorized to share this PO';
  end if;
  if nullif(p_document_path,'') is null then
    raise exception 'The PO PDF is required to mark the PO shared';
  end if;
  if nullif(p_tally_po_no,'') is null then
    raise exception 'The Tally PO number is required to mark the PO shared';
  end if;
  if p_dispatch_date is null then
    raise exception 'The expected dispatch date is required to mark the PO shared';
  end if;
  if nullif(p_payment_terms,'') is not null
     and p_payment_terms not in ('full_advance','partial_advance','credit','on_delivery') then
    raise exception 'Invalid payment terms';
  end if;
  update public.fms_purchase_pos
     set status        = case when status = 'generated' then 'shared' else status end,
         current_stage = case when current_stage = 'share_po' then 'collect_pi' else current_stage end,
         document_path = nullif(p_document_path,''),
         document_name = nullif(p_document_name,''),
         tally_po_no   = nullif(p_tally_po_no,''),
         share_remarks = nullif(p_remarks,''),
         payment_terms = coalesce(nullif(p_payment_terms,''), payment_terms),
         dispatch_date = p_dispatch_date,
         shared_at     = coalesce(shared_at, now())   -- first share wins
   where id = p_po_id;
end $$;
grant execute on function public.fms_purchase_share_po(uuid, text, text, text, text, text, date) to authenticated;

-- 5. Backfill existing rows ---------------------------------------------------
-- Prefer the (best-effort) activity trail; fall back to the row's own created_at
-- so no in-flight item is left without an anchor.
update public.fms_purchase_request_items ri
   set sourced_at = coalesce(
     (select min(a.created_at) from public.fms_purchase_activity a
       where a.entity_type = 'line' and a.entity_id = ri.id and a.type = 'sourced'),
     ri.created_at)
 where ri.sourced_at is null
   and ri.status not in ('sourcing','cancelled');

update public.fms_purchase_request_items ri
   set approved_at = coalesce(
     (select min(a.created_at) from public.fms_purchase_activity a
       where a.entity_type = 'line' and a.entity_id = ri.id and a.type = 'approved'),
     ri.created_at)
 where ri.approved_at is null
   and ri.status in ('approved_pending_po','po');

update public.fms_purchase_pos p
   set shared_at = coalesce(
     (select min(a.created_at) from public.fms_purchase_activity a
       where a.entity_type = 'po' and a.entity_id = p.id and a.type = 'po_shared'),
     p.created_at)
 where p.shared_at is null
   and p.current_stage <> 'share_po';
