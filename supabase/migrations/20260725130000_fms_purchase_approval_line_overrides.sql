-- ===========================================================================
-- Purchase FMS — an approver can override QUANTITY / RATE / GST at approval.
--
-- Until now the only approval "override" was switching the vendor (the rate/GST
-- were pulled from that vendor's quotation, and quantity was untouchable). This
-- lets the approver also correct qty / rate / gst_pct per line before approving.
--
-- The approval band is derived from the requisition TOTAL. Because an override
-- can raise that total into a HIGHER band, the RPCs now recompute line_value and
-- the band from the NEW numbers and RE-CHECK authorisation:
--   • authorised for the new band  -> the decision is finalised as before.
--   • NOT authorised (raised beyond the approver's own limit) -> the new numbers
--     are KEPT but the requisition is sent BACK to `approval`, so the band that
--     now owns it picks it up (the client derives the queue from the same total).
--     This is "block + re-route": a lower-band approver cannot self-approve an
--     amount they raised above their limit.
--
-- ADDITIVE: no table/column changes (final_qty/final_rate/gst_pct/line_value all
-- already exist). The two request-scoped RPCs are dropped + recreated because we
-- add an optional `p_lines jsonb` argument and a `text` return (the outcome:
-- 'approved' | 'rerouted' | 'ok'). Passing p_lines = null reproduces the old
-- behaviour exactly, so existing callers keep working. The legacy per-LINE RPCs
-- (fms_purchase_decide_approval / _update_approval) are intentionally unchanged.
--
-- p_lines shape: [{ request_item_id, final_qty, final_rate, gst_pct }]
--   final_qty / final_rate omitted or "" -> keep the stored value.
--   gst_pct omitted or "" -> treated as null (no GST), matching sourcing.
-- ===========================================================================

drop function if exists public.fms_purchase_decide_approval_request(uuid, text, uuid, text);

create function public.fms_purchase_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default '',
  p_lines              jsonb default null
)
returns text language plpgsql security definer set search_path = public as $function$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_approvers uuid[];
  v_tier      text;
  v_line      record;
  v_elem      jsonb;
  v_vendor    uuid;
  v_qty       numeric(14,3);
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_lead      integer;
  v_qrate2    numeric(14,2);
  v_qgst2     numeric(6,2);
  v_lead2     integer;
  v_result    text := 'ok';
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

  -- Authorisation against the CURRENT band: to touch the requisition at all you
  -- must be its present approver (admin / band member / manually reassigned).
  select approver_user_ids, tier_label into v_approvers, v_tier
    from public.fms_purchase_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

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
    -- Vendor is now OPTIONAL: an override may change only qty/rate/gst and keep
    -- the sourced vendor. But an override with neither a vendor nor line edits is
    -- a no-op we reject, to keep the old "needs a vendor" guarantee meaningful.
    if p_override_vendor_id is null and p_lines is null then
      raise exception 'Override needs a vendor or item changes';
    end if;
    if p_override_vendor_id is not null then
      if not (
        exists (select 1 from public.fms_purchase_request_vendors
                 where request_id = p_request_id and vendor_id = p_override_vendor_id)
        or exists (select 1 from public.fms_purchase_quotations q
                     join public.fms_purchase_request_items ri on ri.id = q.request_item_id
                    where ri.request_id = p_request_id and q.vendor_id = p_override_vendor_id)
      ) then
        raise exception 'The override vendor must be one of the shortlisted vendors';
      end if;
    end if;

    for v_line in
      select id, final_qty, final_rate, gst_pct, lead_time_days, final_vendor_id
        from public.fms_purchase_request_items where id = any(v_ids)
    loop
      v_vendor := coalesce(p_override_vendor_id, v_line.final_vendor_id);
      v_qty    := v_line.final_qty;
      v_qrate  := v_line.final_rate;
      v_qgst   := v_line.gst_pct;
      v_lead   := v_line.lead_time_days;

      select e into v_elem
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'request_item_id')::uuid = v_line.id
       limit 1;

      if v_elem is not null then
        if nullif(v_elem->>'final_qty','')  is not null then v_qty   := (v_elem->>'final_qty')::numeric;  end if;
        if nullif(v_elem->>'final_rate','') is not null then v_qrate := (v_elem->>'final_rate')::numeric; end if;
        v_qgst := nullif(v_elem->>'gst_pct','')::numeric;   -- explicit clear allowed
        if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than 0'; end if;
        if v_qrate is null or v_qrate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;
      elsif p_override_vendor_id is not null then
        -- Vendor changed but this line was not hand-edited: keep the old flow and
        -- adopt the new vendor's quoted price when it has one.
        select rate, gst_pct, lead_time_days into v_qrate2, v_qgst2, v_lead2
          from public.fms_purchase_quotations
         where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;
        if v_qrate2 is not null then v_qrate := v_qrate2; v_qgst := v_qgst2; v_lead := v_lead2; end if;
      end if;

      update public.fms_purchase_request_items
         set final_vendor_id = v_vendor,
             final_qty       = v_qty,
             final_rate      = v_qrate,
             gst_pct         = v_qgst,
             lead_time_days  = v_lead,
             line_value      = round(v_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2)
       where id = v_line.id;

      -- Keep quotations consistent with the decided price for the effective vendor.
      if v_vendor is not null then
        delete from public.fms_purchase_quotations where request_item_id = v_line.id;
        insert into public.fms_purchase_quotations
          (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended)
        values (v_line.id, v_vendor, v_qrate, v_qgst, v_lead, true);
      end if;
    end loop;

    -- Re-derive the band from the NEW total.
    select coalesce(sum(line_value),0) into v_total
      from public.fms_purchase_request_items where id = any(v_ids);
    select approver_user_ids, tier_label into v_approvers, v_tier
      from public.fms_purchase_approval_matrix
     where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
     order by sort_order, min_amount limit 1;

    if p_override_vendor_id is not null then
      update public.fms_purchase_request_vendors
         set is_recommended = (vendor_id = p_override_vendor_id)
       where request_id = p_request_id;
    end if;

    if public.is_admin(auth.uid()) or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[])) then
      update public.fms_purchase_request_items
         set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
             reject_reason = null, assigned_approver_id = null, approved_at = now()
       where id = any(v_ids);
      v_result := 'approved';
    else
      -- BLOCK + RE-ROUTE: keep the new numbers, send it back to the band that now
      -- owns the raised total. Ownership is purely band-derived, so clearing the
      -- manual assignee lets every member of the new band pick it up.
      update public.fms_purchase_request_items
         set status = 'approval', approval_tier = v_tier, assigned_approver_id = null, approved_at = null
       where id = any(v_ids);
      perform public.fms_purchase_announce('request', p_request_id, 'approval_rerouted',
        format('An override raised this requisition to %s (%s) — routed for approval.',
               coalesce(v_tier,'a higher tier'), v_total),
        coalesce(v_approvers, '{}'::uuid[]),
        jsonb_build_object('tier', v_tier, 'total', v_total));
      return 'rerouted';
    end if;

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

  return v_result;
end $function$;

grant execute on function public.fms_purchase_decide_approval_request(uuid, text, uuid, text, jsonb) to authenticated;


-- Request-scoped correction (edit an already-approved requisition) ------------
drop function if exists public.fms_purchase_update_approval_request(uuid, text, uuid, text);

create function public.fms_purchase_update_approval_request(
  p_request_id         uuid,
  p_decision           text,
  p_override_vendor_id uuid default null,
  p_reason             text default '',
  p_lines              jsonb default null
)
returns text language plpgsql security definer set search_path = public as $function$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_bad       integer;
  v_approvers uuid[];
  v_tier      text;
  v_line      record;
  v_elem      jsonb;
  v_vendor    uuid;
  v_qty       numeric(14,3);
  v_qrate     numeric(14,2);
  v_qgst      numeric(6,2);
  v_lead      integer;
  v_qrate2    numeric(14,2);
  v_qgst2     numeric(6,2);
  v_lead2     integer;
  v_result    text := 'ok';
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
    if p_override_vendor_id is null and p_lines is null then
      raise exception 'Override needs a vendor or item changes';
    end if;
    if p_override_vendor_id is not null then
      if not (
        exists (select 1 from public.fms_purchase_request_vendors
                 where request_id = p_request_id and vendor_id = p_override_vendor_id)
        or exists (select 1 from public.fms_purchase_quotations q
                     join public.fms_purchase_request_items ri on ri.id = q.request_item_id
                    where ri.request_id = p_request_id and q.vendor_id = p_override_vendor_id)
      ) then
        raise exception 'The override vendor must be one of the shortlisted vendors';
      end if;
    end if;

    for v_line in
      select id, final_qty, final_rate, gst_pct, lead_time_days, final_vendor_id
        from public.fms_purchase_request_items where id = any(v_ids)
    loop
      v_vendor := coalesce(p_override_vendor_id, v_line.final_vendor_id);
      v_qty    := v_line.final_qty;
      v_qrate  := v_line.final_rate;
      v_qgst   := v_line.gst_pct;
      v_lead   := v_line.lead_time_days;

      select e into v_elem
        from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'request_item_id')::uuid = v_line.id
       limit 1;

      if v_elem is not null then
        if nullif(v_elem->>'final_qty','')  is not null then v_qty   := (v_elem->>'final_qty')::numeric;  end if;
        if nullif(v_elem->>'final_rate','') is not null then v_qrate := (v_elem->>'final_rate')::numeric; end if;
        v_qgst := nullif(v_elem->>'gst_pct','')::numeric;
        if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be greater than 0'; end if;
        if v_qrate is null or v_qrate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;
      elsif p_override_vendor_id is not null then
        select rate, gst_pct, lead_time_days into v_qrate2, v_qgst2, v_lead2
          from public.fms_purchase_quotations
         where request_item_id = v_line.id and vendor_id = p_override_vendor_id limit 1;
        if v_qrate2 is not null then v_qrate := v_qrate2; v_qgst := v_qgst2; v_lead := v_lead2; end if;
      end if;

      update public.fms_purchase_request_items
         set final_vendor_id = v_vendor,
             final_qty       = v_qty,
             final_rate      = v_qrate,
             gst_pct         = v_qgst,
             lead_time_days  = v_lead,
             line_value      = round(v_qty * v_qrate * (1 + coalesce(v_qgst,0)/100.0), 2),
             edited_at       = now(),
             edited_by       = auth.uid()
       where id = v_line.id;

      if v_vendor is not null then
        delete from public.fms_purchase_quotations where request_item_id = v_line.id;
        insert into public.fms_purchase_quotations
          (request_item_id, vendor_id, rate, gst_pct, lead_time_days, is_recommended)
        values (v_line.id, v_vendor, v_qrate, v_qgst, v_lead, true);
      end if;
    end loop;

    select coalesce(sum(line_value),0) into v_total
      from public.fms_purchase_request_items where id = any(v_ids);
    select approver_user_ids, tier_label into v_approvers, v_tier
      from public.fms_purchase_approval_matrix
     where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
     order by sort_order, min_amount limit 1;

    if p_override_vendor_id is not null then
      update public.fms_purchase_request_vendors
         set is_recommended = (vendor_id = p_override_vendor_id)
       where request_id = p_request_id;
    end if;

    if public.is_admin(auth.uid()) or auth.uid() = any(coalesce(v_approvers, '{}'::uuid[])) then
      update public.fms_purchase_request_items
         set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
             edited_at = now(), edited_by = auth.uid()
       where id = any(v_ids);
      v_result := 'approved';
    else
      -- BLOCK + RE-ROUTE: move it back to `approval` under the new band.
      update public.fms_purchase_request_items
         set status = 'approval', approval_tier = v_tier, assigned_approver_id = null,
             approved_at = null, edited_at = now(), edited_by = auth.uid()
       where id = any(v_ids);
      perform public.fms_purchase_announce('request', p_request_id, 'approval_rerouted',
        format('An edit raised this requisition to %s (%s) — routed for approval.',
               coalesce(v_tier,'a higher tier'), v_total),
        coalesce(v_approvers, '{}'::uuid[]),
        jsonb_build_object('tier', v_tier, 'total', v_total));
      return 'rerouted';
    end if;

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

  return v_result;
end $function$;

grant execute on function public.fms_purchase_update_approval_request(uuid, text, uuid, text, jsonb) to authenticated;
