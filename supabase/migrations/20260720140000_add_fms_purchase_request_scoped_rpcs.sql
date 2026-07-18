-- ===========================================================================
-- Purchase FMS — request-scoped SOURCING + APPROVAL routines.
--
-- These are ADDED ALONGSIDE the existing per-line functions, which are kept and
-- still granted. Reasons:
--   • different signatures, so nothing that calls the old ones breaks;
--   • the per-line path is the only one that can express a requisition whose
--     lines went to different vendors. None exist today (checked), but dropping
--     the escape hatch would strand any that appear;
--   • `drop function` is destructive, and this project is additive-only.
--
-- Contains:
--   1. fms_purchase_save_sourcing_request     — stage 2, whole requisition
--   2. fms_purchase_decide_approval_request   — stage 3, whole requisition
--   3. fms_purchase_update_approval_request   — stage 3 correction, whole requisition
--   4. fms_purchase_generate_po               — replaced ONLY to carry lead_time_days
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. SOURCING — one requisition, up to 3 shortlisted vendors, per-item rates.
--
-- p_vendors : [{vendor_id, remark}]                        (1..3, distinct)
-- p_lines   : [{request_item_id, qty, rate, gst_pct, lead_time_days}]
--
-- There is no "final rate" separate from the quoted rate any more: the rate typed
-- against an ITEM is the final rate. Vendors carry no rate at all — they are a
-- shortlist, and the ticked one wins every line.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_save_sourcing_request(
  p_request_id            uuid,
  p_vendors               jsonb,
  p_recommended_vendor_id uuid,
  p_lines                 jsonb,
  p_sourcing_reason       text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_req_id     uuid;
  v_elem       jsonb;
  v_vendor_ct  integer;
  v_line_ct    integer;
  v_locked     uuid;
  v_line_id    uuid;
  v_status     text;
  v_owner      uuid;
  v_qty        numeric(14,3);
  v_rate       numeric(14,2);
  v_gst        numeric(6,2);
  v_lead       integer;
  v_value      numeric(16,2);
  v_remark     text;
begin
  select id into v_req_id from public.fms_purchase_requests
   where id = p_request_id for update;
  if v_req_id is null then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this requisition';
  end if;

  -- --- the vendor shortlist -------------------------------------------------
  v_vendor_ct := coalesce(jsonb_array_length(p_vendors), 0);
  if v_vendor_ct < 1 then raise exception 'Shortlist at least one vendor'; end if;
  if v_vendor_ct > 3 then raise exception 'At most three vendors can be shortlisted'; end if;
  if p_recommended_vendor_id is null then raise exception 'Tick the vendor you are recommending'; end if;

  if (select count(distinct e->>'vendor_id') from jsonb_array_elements(p_vendors) e) <> v_vendor_ct then
    raise exception 'Each shortlisted vendor must be different';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_vendors) e
     where (e->>'vendor_id')::uuid = p_recommended_vendor_id
  ) then
    raise exception 'The recommended vendor must be one of the shortlisted vendors';
  end if;

  -- Fewer than three vendors now REQUIRES a reason. Enforced here, not just in
  -- the form, so it cannot be bypassed by calling the RPC directly.
  if v_vendor_ct < 3 and nullif(p_sourcing_reason,'') is null then
    raise exception 'A single-source reason is required when fewer than three vendors are shortlisted';
  end if;

  -- --- vendor lock on a part-sourced requisition ----------------------------
  -- If some lines were already decided (approved/PO'd) against a vendor, the rest
  -- of the requisition MUST go to that same vendor — otherwise the requisition
  -- ends up split across two vendors, which this model cannot represent and which
  -- would silently rewrite a price someone already signed off.
  select ri.final_vendor_id into v_locked
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id
     and ri.status in ('approved_pending_po','po')
     and ri.final_vendor_id is not null
   limit 1;
  if v_locked is not null and v_locked is distinct from p_recommended_vendor_id then
    raise exception 'Part of this requisition is already approved against a different vendor (%). All its lines must go to that vendor.',
      (select name from public.fms_purchase_vendors where id = v_locked);
  end if;

  -- --- replace the shortlist ------------------------------------------------
  delete from public.fms_purchase_request_vendors where request_id = p_request_id;
  insert into public.fms_purchase_request_vendors (request_id, vendor_id, is_recommended, remark, sort_order)
  select p_request_id,
         (e->>'vendor_id')::uuid,
         (e->>'vendor_id')::uuid = p_recommended_vendor_id,
         nullif(e->>'remark',''),
         (ord - 1)::integer
    from jsonb_array_elements(p_vendors) with ordinality as t(e, ord);

  -- --- the lines ------------------------------------------------------------
  v_line_ct := coalesce(jsonb_array_length(p_lines), 0);
  if v_line_ct < 1 then raise exception 'Enter a rate for at least one item'; end if;

  for v_elem in select * from jsonb_array_elements(p_lines) loop
    v_line_id := (v_elem->>'request_item_id')::uuid;

    select ri.status, ri.request_id into v_status, v_owner
      from public.fms_purchase_request_items ri
     where ri.id = v_line_id for update;

    if v_status is null then raise exception 'Item line % not found', v_line_id; end if;
    if v_owner is distinct from p_request_id then
      raise exception 'Item line % does not belong to this requisition', v_line_id;
    end if;
    -- RAISE, don't skip: a decided line arriving in the payload means the form was
    -- stale and is about to overwrite somebody's decision.
    if v_status not in ('sourcing','approval','on_hold') then
      raise exception 'An item on this requisition is no longer open for sourcing (status %). Reload and try again.', v_status;
    end if;

    v_qty  := (v_elem->>'qty')::numeric;
    v_rate := (v_elem->>'rate')::numeric;
    v_gst  := nullif(v_elem->>'gst_pct','')::numeric;
    v_lead := nullif(v_elem->>'lead_time_days','')::integer;

    if coalesce(v_qty,0) <= 0 then raise exception 'Quantity must be greater than 0'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;

    v_value := round(v_qty * v_rate * (1 + coalesce(v_gst,0)/100.0), 2);

    -- Mirror ONE quotation row for the recommended vendor. The other shortlisted
    -- vendors deliberately get no row: they quoted nothing, and inventing a rate
    -- for them would show the approver three identical prices.
    select nullif(e->>'remark','') into v_remark
      from jsonb_array_elements(p_vendors) e
     where (e->>'vendor_id')::uuid = p_recommended_vendor_id limit 1;

    delete from public.fms_purchase_quotations where request_item_id = v_line_id;
    insert into public.fms_purchase_quotations
      (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
    values (v_line_id, p_recommended_vendor_id, v_rate, v_gst, v_lead, v_remark, true);

    update public.fms_purchase_request_items
       set final_vendor_id = p_recommended_vendor_id,
           final_qty       = v_qty,
           final_rate      = v_rate,
           gst_pct         = v_gst,
           lead_time_days  = v_lead,
           line_value      = v_value,
           sourcing_reason = nullif(p_sourcing_reason,''),
           status          = 'approval',
           reject_reason   = null,
           sourced_at      = now(),   -- re-sourcing restarts the approval clock
           sourced_by      = auth.uid()
     where id = v_line_id;
  end loop;

  update public.fms_purchase_requests
     set sourcing_reason = nullif(p_sourcing_reason,''),
         sourced_at      = now(),
         sourced_by      = auth.uid()
   where id = p_request_id;
end $function$;

grant execute on function public.fms_purchase_save_sourcing_request(uuid, jsonb, uuid, jsonb, text) to authenticated;

comment on function public.fms_purchase_save_sourcing_request(uuid, jsonb, uuid, jsonb, text) is
  'Stage 2, whole requisition. Accepts lines in sourcing/approval/on_hold, so re-sourcing IS the edit path — there is no separate update RPC for this step.';


-- ---------------------------------------------------------------------------
-- 2. APPROVAL — one decision for the whole requisition.
--
-- The band is picked on the SUM of the lines under decision, not per line. That
-- is the point of the change, and it moves work up the matrix: five ₹40k lines
-- used to be five ₹40k decisions and are now one ₹200k decision.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_ids      uuid[];
  v_total    numeric(16,2);
  v_count    integer;
  v_approver uuid;
  v_tier     text;
  v_line     record;
  v_qrate    numeric(14,2);
  v_qgst     numeric(6,2);
  v_lead     integer;
begin
  -- Lock every line under decision, then aggregate. Deliberately only
  -- 'approval'/'on_hold': a line decided in an earlier pass, or cancelled, is not
  -- part of THIS decision, and the UI shows the same subtotal so client and server
  -- cannot disagree.
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

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
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

    -- The override vendor must be on the shortlist. Legacy requisitions predate
    -- the shortlist table, so fall back to the vendors that actually quoted.
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
      -- Legacy fork: if that vendor genuinely quoted this line, swap the quoted
      -- price in (byte-identical to the old per-line behaviour). Under the new
      -- model there is no second price, so only the vendor changes.
      select rate, gst_pct, lead_time_days into v_qrate, v_qgst, v_lead
        from public.fms_purchase_quotations
       where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;

      if v_qrate is null then
        v_qrate := v_line.final_rate;
        v_qgst  := v_line.gst_pct;
        v_lead  := v_line.lead_time_days;
      end if;

      -- Re-point the mirror in the SAME transaction as final_vendor_id, so the
      -- two can never disagree.
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
    update public.fms_purchase_request_items set status = 'on_hold'
     where id = any(v_ids);

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


-- ---------------------------------------------------------------------------
-- 3. APPROVAL CORRECTION — change an already-approved requisition's decision.
--     Refuses once ANY line has reached its PO. approve/override/reject only,
--     matching the per-line update_approval (no hold/resume when correcting).
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_update_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default ''
)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_ids      uuid[];
  v_total    numeric(16,2);
  v_count    integer;
  v_bad      integer;
  v_approver uuid;
  v_tier     text;
  v_line     record;
  v_qrate    numeric(14,2);
  v_qgst     numeric(6,2);
  v_lead     integer;
begin
  -- Every line must still be an approved decision awaiting its PO.
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

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
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
    -- Reversing an approval. approved_at is cleared: leaving a stale stamp would
    -- date a decision that was withdrawn.
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


-- ---------------------------------------------------------------------------
-- 4. generate_po — carry lead_time_days onto the PO line.
--     Body carried forward verbatim from the live definition; the ONLY changes
--     are the v_lead local, its select, and its insert column.
-- ---------------------------------------------------------------------------
create or replace function public.fms_purchase_generate_po(
  p_vendor_id uuid, p_company_id uuid, p_request_item_ids uuid[], p_po_no text default null
)
returns uuid language plpgsql security definer set search_path = public as $function$
declare
  v_po_id  uuid;
  v_no     text;
  v_seq    integer;
  v_fy     text;
  v_id     uuid;
  v_total  numeric(16,2) := 0;
  v_fqty   numeric(14,3);
  v_frate  numeric(14,2);
  v_fgst   numeric(6,2);
  v_lval   numeric(16,2);
  v_lead   integer;
  v_vendor uuid;
  v_lstatus text;
  v_company uuid;
begin
  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('po', auth.uid())) then
    raise exception 'Not authorized to generate POs';
  end if;
  if p_request_item_ids is null or array_length(p_request_item_ids, 1) is null then
    raise exception 'Select at least one line for the PO';
  end if;

  if p_po_no is not null and exists (select 1 from public.fms_purchase_pos where po_no = p_po_no) then
    raise exception 'PO number % already exists', p_po_no;
  end if;
  if p_po_no is null then
    v_fy  := public.fms_purchase_fy_code(current_date);
    v_seq := public.fms_purchase_next_seq('po:' || v_fy);
    v_no  := 'PO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');
  else
    v_no := p_po_no;
  end if;

  insert into public.fms_purchase_pos (po_no, vendor_id, company_id, created_by)
  values (v_no, p_vendor_id, p_company_id, auth.uid())
  returning id into v_po_id;

  foreach v_id in array p_request_item_ids loop
    select ri.status, ri.final_vendor_id, ri.final_qty, ri.final_rate, ri.gst_pct,
           ri.line_value, ri.lead_time_days, r.company_id
      into v_lstatus, v_vendor, v_fqty, v_frate, v_fgst, v_lval, v_lead, v_company
    from public.fms_purchase_request_items ri
    join public.fms_purchase_requests r on r.id = ri.request_id
    where ri.id = v_id
    for update of ri;

    if v_lstatus is null then raise exception 'Line % not found', v_id; end if;
    if v_lstatus <> 'approved_pending_po' then
      raise exception 'Line % is not an approved pool line (status %)', v_id, v_lstatus;
    end if;
    if v_vendor is distinct from p_vendor_id then
      raise exception 'Line % is for a different vendor', v_id;
    end if;
    if v_company is distinct from p_company_id then
      raise exception 'Line % belongs to a different company', v_id;
    end if;

    insert into public.fms_purchase_po_items (po_id, request_item_id, qty, rate, gst_pct, line_value, lead_time_days)
    values (v_po_id, v_id, v_fqty, v_frate, v_fgst, v_lval, v_lead);

    update public.fms_purchase_request_items set status = 'po' where id = v_id;
    v_total := v_total + coalesce(v_lval, 0);
  end loop;

  update public.fms_purchase_pos set total_value = v_total where id = v_po_id;
  return v_po_id;
end $function$;

grant execute on function public.fms_purchase_generate_po(uuid, uuid, uuid[], text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Mark the per-line predecessors superseded (kept, still granted).
-- ---------------------------------------------------------------------------
comment on function public.fms_purchase_save_sourcing(uuid, jsonb, uuid, numeric, numeric, numeric, text) is
  'SUPERSEDED by fms_purchase_save_sourcing_request. Retained: it is the only path that can source a requisition whose lines go to different vendors.';
comment on function public.fms_purchase_decide_approval(uuid, text, uuid, text) is
  'SUPERSEDED by fms_purchase_decide_approval_request. Retained for per-line decisions on legacy mixed-vendor requisitions.';
comment on function public.fms_purchase_update_approval(uuid, text, uuid, text) is
  'SUPERSEDED by fms_purchase_update_approval_request. Retained for per-line corrections on legacy mixed-vendor requisitions.';
