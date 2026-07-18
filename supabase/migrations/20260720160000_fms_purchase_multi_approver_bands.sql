-- ===========================================================================
-- Purchase FMS — an approval band can have MORE THAN ONE approver.
--
-- Until now a band pointed at exactly one person (approver_user_id), so a single
-- absence stalled every requisition in that value range. Master ownership and
-- step ownership already support several people; approvals now match, using the
-- same `uuid[]` shape as fms_purchase_step_owners.employee_ids.
--
-- ANY listed approver may decide — this is "one of these people", not "all of
-- them must sign". There is no sequential/quorum approval here, and this change
-- deliberately does not add one.
--
-- ADDITIVE. `approver_user_id` is NOT dropped: it stays as a mirror of the first
-- approver so anything still reading it keeps working, and because it is NOT NULL.
-- `approver_user_ids` is the source of truth from here on.
-- ===========================================================================

alter table public.fms_purchase_approval_matrix
  add column if not exists approver_user_ids uuid[] not null default '{}';

comment on column public.fms_purchase_approval_matrix.approver_user_ids is
  'Everyone who may approve in this band. ANY ONE of them can decide. Source of truth; approver_user_id is a legacy mirror of the first entry.';
comment on column public.fms_purchase_approval_matrix.approver_user_id is
  'LEGACY mirror of approver_user_ids[1], kept because it is NOT NULL and older readers still reference it. Write both.';

-- Seed the array from the single approver each band already has.
update public.fms_purchase_approval_matrix
   set approver_user_ids = array[approver_user_id]
 where approver_user_id is not null
   and coalesce(cardinality(approver_user_ids), 0) = 0;

-- ---------------------------------------------------------------------------
-- Every function that authorises against the matrix now checks MEMBERSHIP of
-- approver_user_ids instead of equality with approver_user_id. Bodies carried
-- forward verbatim; only the band lookup + the authz line change.
-- ---------------------------------------------------------------------------

-- 1. Request-scoped decision -------------------------------------------------
create or replace function public.fms_purchase_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_approvers uuid[];
  v_tier      text;
  v_line      record;
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_lead      integer;
begin
  perform 1 from public.fms_purchase_request_items
   where request_id = p_request_id and status in ('approval','on_hold')
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id and ri.status in ('approval','on_hold');

  if coalesce(v_count,0) = 0 then
    raise exception 'No items on this requisition are awaiting approval';
  end if;

  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  -- ANY approver on the band may decide.
  if not (public.is_admin(auth.uid())
          or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))
          or exists (select 1 from public.fms_purchase_request_items
                      where id = any(v_ids) and assigned_approver_id = auth.uid())) then
    raise exception 'Not authorized to approve this requisition';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null, approved_at = now()
     where id = any(v_ids);

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    if not (
      exists (select 1 from public.fms_purchase_request_vendors
               where request_id = p_request_id and vendor_id = p_override_vendor_id)
      or exists (select 1 from public.fms_purchase_quotations q
                   join public.fms_purchase_request_items ri on ri.id = q.request_item_id
                  where ri.request_id = p_request_id and q.vendor_id = p_override_vendor_id)
    ) then
      raise exception 'The override vendor must be one of the shortlisted vendors';
    end if;

    for v_line in
      select id, final_qty, final_rate, gst_pct, lead_time_days
        from public.fms_purchase_request_items where id = any(v_ids)
    loop
      select rate, gst_pct, lead_time_days into v_qrate, v_qgst, v_lead
        from public.fms_purchase_quotations
       where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;

      if v_qrate is null then
        v_qrate := v_line.final_rate;
        v_qgst  := v_line.gst_pct;
        v_lead  := v_line.lead_time_days;
      end if;

      delete from public.fms_purchase_quotations where request_item_id = v_line.id;
      insert into public.fms_purchase_quotations
        (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended)
      values (v_line.id, p_override_vendor_id, v_qrate, v_qgst, v_lead, true);

      update public.fms_purchase_request_items
         set final_vendor_id = p_override_vendor_id,
             final_rate      = v_qrate,
             gst_pct         = v_qgst,
             lead_time_days  = v_lead,
             line_value      = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
             status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
             reject_reason = null, assigned_approver_id = null, approved_at = now()
       where id = v_line.id;
    end loop;

    update public.fms_purchase_request_vendors
       set is_recommended = (vendor_id = p_override_vendor_id)
     where request_id = p_request_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           assigned_approver_id = null
     where id = any(v_ids);

  elsif p_decision = 'hold' then
    update public.fms_purchase_request_items set status = 'on_hold' where id = any(v_ids);

  elsif p_decision = 'resume' then
    update public.fms_purchase_request_items set status = 'approval', approved_at = null
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('request', p_request_id, 'approval_' || p_decision,
    format('Approval decision on the requisition (%s), %s item(s), %s', p_decision, v_count, v_total),
    '{}'::uuid[], jsonb_build_object('decision', p_decision, 'lines', v_count, 'total', v_total));
end $function$;

grant execute on function public.fms_purchase_decide_approval_request(uuid, text, uuid, text) to authenticated;


-- 2. Request-scoped correction -----------------------------------------------
create or replace function public.fms_purchase_update_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_bad       integer;
  v_approvers uuid[];
  v_tier      text;
  v_line      record;
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_lead      integer;
begin
  select count(*) into v_bad from public.fms_purchase_request_items
   where request_id = p_request_id and status = 'po';
  if v_bad > 0 then
    raise exception 'A PO has already been generated for this requisition — the approval can no longer be changed.';
  end if;

  perform 1 from public.fms_purchase_request_items
   where request_id = p_request_id and status = 'approved_pending_po'
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id and ri.status = 'approved_pending_po';

  if coalesce(v_count,0) = 0 then
    raise exception 'This requisition has no approved decision awaiting a PO.';
  end if;

  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))
          or exists (select 1 from public.fms_purchase_request_items
                      where id = any(v_ids) and assigned_approver_id = auth.uid())) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    if not (
      exists (select 1 from public.fms_purchase_request_vendors
               where request_id = p_request_id and vendor_id = p_override_vendor_id)
      or exists (select 1 from public.fms_purchase_quotations q
                   join public.fms_purchase_request_items ri on ri.id = q.request_item_id
                  where ri.request_id = p_request_id and q.vendor_id = p_override_vendor_id)
    ) then
      raise exception 'The override vendor must be one of the shortlisted vendors';
    end if;

    for v_line in
      select id, final_qty, final_rate, gst_pct, lead_time_days
        from public.fms_purchase_request_items where id = any(v_ids)
    loop
      select rate, gst_pct, lead_time_days into v_qrate, v_qgst, v_lead
        from public.fms_purchase_quotations
       where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;
      if v_qrate is null then
        v_qrate := v_line.final_rate; v_qgst := v_line.gst_pct; v_lead := v_line.lead_time_days;
      end if;

      delete from public.fms_purchase_quotations where request_item_id = v_line.id;
      insert into public.fms_purchase_quotations
        (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended)
      values (v_line.id, p_override_vendor_id, v_qrate, v_qgst, v_lead, true);

      update public.fms_purchase_request_items
         set final_vendor_id = p_override_vendor_id, final_rate = v_qrate, gst_pct = v_qgst,
             lead_time_days = v_lead,
             line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
             approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
             edited_at = now(), edited_by = auth.uid()
       where id = v_line.id;
    end loop;

    update public.fms_purchase_request_vendors
       set is_recommended = (vendor_id = p_override_vendor_id)
     where request_id = p_request_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null, assigned_approver_id = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('request', p_request_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision, 'lines', v_count));
end $function$;

grant execute on function public.fms_purchase_update_approval_request(uuid, text, uuid, text) to authenticated;


-- 3. Legacy per-LINE decision (still used for mixed-vendor requisitions) ------
create or replace function public.fms_purchase_decide_approval(
  p_request_item_id uuid, p_decision text, p_override_vendor_id uuid default null, p_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_status    text;
  v_value     numeric(16,2);
  v_approvers uuid[];
  v_tier      text;
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_assigned  uuid;
begin
  select status, line_value, assigned_approver_id
    into v_status, v_value, v_assigned
    from public.fms_purchase_request_items where id = p_request_item_id for update;
  if v_status is null then raise exception 'Line not found'; end if;
  if v_status not in ('approval','on_hold') then
    raise exception 'This line is not awaiting approval (status %)', v_status;
  end if;

  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null, approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_request_item_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_request_item_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id, final_rate = v_qrate, gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null, approved_at = now()
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
    update public.fms_purchase_request_items set status = 'approval', approved_at = null
     where id = p_request_item_id;

  else
    raise exception 'Unknown decision %', p_decision;
  end if;
end $function$;

grant execute on function public.fms_purchase_decide_approval(uuid, text, uuid, text) to authenticated;


-- 4. Legacy per-LINE correction ----------------------------------------------
create or replace function public.fms_purchase_update_approval(
  p_line_id uuid, p_decision text, p_override_vendor_id uuid default null, p_reason text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_status text; v_value numeric(16,2); v_approvers uuid[]; v_tier text;
  v_qrate numeric(14,2); v_qgst numeric(6,2); v_assigned uuid;
begin
  select status, line_value, assigned_approver_id into v_status, v_value, v_assigned
    from public.fms_purchase_request_items where id = p_line_id for update;
  if v_status is null then raise exception 'Line not found'; end if;

  if not public.fms_purchase_approval_editable(p_line_id) then
    if v_status = 'po' then
      raise exception 'The PO has already been generated for this line — the approval can no longer be changed.';
    elsif v_status in ('rejected','cancelled') then
      raise exception 'This line is % — its approval can no longer be changed.', v_status;
    end if;
    raise exception 'This line is not an approved decision awaiting its PO (status %).', v_status;
  end if;

  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_value >= min_amount and (max_amount is null or v_value <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[]))
          or (v_assigned is not null and v_assigned = auth.uid())) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' then
    update public.fms_purchase_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'override' then
    if p_override_vendor_id is null then raise exception 'Override needs a vendor'; end if;
    select rate, gst_pct into v_qrate, v_qgst from public.fms_purchase_quotations
      where request_item_id = p_line_id and vendor_id = p_override_vendor_id limit 1;
    if v_qrate is null then raise exception 'Override vendor must be one of the quoted vendors'; end if;
    update public.fms_purchase_quotations set is_recommended = (vendor_id = p_override_vendor_id)
      where request_item_id = p_line_id;
    update public.fms_purchase_request_items
       set final_vendor_id = p_override_vendor_id, final_rate = v_qrate, gst_pct = v_qgst,
           line_value = round(final_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
           approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_purchase_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null, assigned_approver_id = null,
           edited_at = now(), edited_by = auth.uid()
     where id = p_line_id;
  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_purchase_announce('line', p_line_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision));
end $function$;

grant execute on function public.fms_purchase_update_approval(uuid, text, uuid, text) to authenticated;
