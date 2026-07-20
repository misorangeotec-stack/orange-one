-- ===========================================================================
-- Import Purchase FMS — request-scoped APPROVAL (one decision per requisition).
--
-- Until now Import decided approvals per LINE, banded on each line's own value
-- (fms_import_decide_approval / fms_import_update_approval). This adds the
-- requisition-scoped twin, matching the Procurement app: the band is picked on
-- the SUM of the lines under decision, and Approve / Reject / Hold / Resume act
-- on every one of them at once. Five ₹40k lines become one ₹200k decision.
--
-- ADDED ALONGSIDE the per-line functions, which are KEPT and still granted
-- (additive-only; `drop function` is destructive). They stay as the escape hatch
-- for a legacy requisition whose lines were decided in separate passes.
--
-- Import specifics vs Procurement (deliberate simplifications):
--   • singular approver_user_id (Import has no approver_user_ids[] array);
--   • Import has NO quoted vendors — the vendor comes from the request header +
--     price master — so the `override` decision does NOT switch vendor. Instead
--     it lets the approver REVISE THE RATES (e.g. a negotiated price) and approve
--     in one step: `p_rates` carries [{request_item_id, rate}] in the vendor's
--     FOREIGN currency, and each line's foreign + INR values are recomputed from
--     the request-time FX rate (fx_rate_at_request). The band/tier stay the ones
--     that routed the requisition to this approver — revising a rate does not
--     re-route the decision.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. DECIDE — one decision for the whole requisition.
--    override = revise the rates on some/all lines, then approve.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,       -- approve | override | reject | hold | resume
  p_override_vendor_id uuid default null,   -- unused in Import; kept for signature parity
  p_reason             text default '',
  p_rates              jsonb default null    -- [{request_item_id, rate}] for `override`
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_approver  uuid;
  v_tier      text;
  v_elem      jsonb;
  v_line_id   uuid;
  v_new_rate  numeric(14,2);
  v_val_fx    numeric(16,2);
begin
  -- Lock every line under decision, then aggregate. Only 'approval'/'on_hold':
  -- a line decided in an earlier pass, or cancelled, is not part of THIS
  -- decision, and the UI sums the same subset so client and server agree.
  perform 1 from public.fms_import_request_items
   where request_id = p_request_id and status in ('approval','on_hold')
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_import_request_items ri
   where ri.request_id = p_request_id and ri.status in ('approval','on_hold');

  if coalesce(v_count,0) = 0 then
    raise exception 'No items on this requisition are awaiting approval';
  end if;

  -- Band on the requisition TOTAL (not per line). Computed on the CURRENT values,
  -- before any rate revision — a revised rate does not re-route the decision.
  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or exists (select 1 from public.fms_import_request_items
                      where id = any(v_ids) and assigned_approver_id = auth.uid())) then
    raise exception 'Not authorized to approve this requisition';
  end if;

  if p_decision = 'approve' or p_decision = 'override' then
    -- OVERRIDE: apply the approver's revised rates first. Each entry must name a
    -- line still awaiting decision on THIS requisition. Recompute the foreign line
    -- value (no GST on an import line) and the INR value from the request-time FX
    -- rate, so the two currencies never disagree.
    if p_decision = 'override' then
      if p_rates is null or jsonb_array_length(p_rates) = 0 then
        raise exception 'No revised rates supplied';
      end if;
      for v_elem in select * from jsonb_array_elements(p_rates) loop
        v_line_id  := (v_elem->>'request_item_id')::uuid;
        v_new_rate := nullif(v_elem->>'rate','')::numeric;
        if v_new_rate is null or v_new_rate < 0 then
          raise exception 'Enter a rate of 0 or more for every revised line';
        end if;
        update public.fms_import_request_items ri
           set final_rate    = v_new_rate,
               line_value_fx = round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2),
               line_value    = round(round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2)
                                     * coalesce(ri.fx_rate_at_request, 1), 2)
         where ri.id = v_line_id
           and ri.request_id = p_request_id
           and ri.status in ('approval','on_hold');
        if not found then
          raise exception 'Line % is not awaiting approval on this requisition', v_line_id;
        end if;
      end loop;
    end if;

    update public.fms_import_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, assigned_approver_id = null, approved_at = now()
     where id = any(v_ids);

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           assigned_approver_id = null
     where id = any(v_ids);

  elsif p_decision = 'hold' then
    update public.fms_import_request_items set status = 'on_hold' where id = any(v_ids);

  elsif p_decision = 'resume' then
    -- Back to awaiting approval — the lines are no longer approved.
    update public.fms_import_request_items set status = 'approval', approved_at = null
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  -- Recompute the total for the notice AFTER any revision, so it reads true.
  select coalesce(sum(ri.line_value),0) into v_val_fx
    from public.fms_import_request_items ri where ri.id = any(v_ids);

  perform public.fms_import_announce('request', p_request_id, 'approval_' || p_decision,
    format('Approval decision on the requisition (%s), %s item(s)', p_decision, v_count),
    '{}'::uuid[], jsonb_build_object('decision', p_decision, 'lines', v_count, 'total', v_val_fx));
end $$;

grant execute on function public.fms_import_decide_approval_request(uuid, text, uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. CORRECTION — change an already-approved requisition's decision.
--    Refuses once ANY line has reached its PO. approve / override / reject
--    (no hold/resume when correcting). override = re-price the approved lines.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_update_approval_request(
  p_request_id         uuid,
  p_decision           text,       -- approve | override | reject
  p_override_vendor_id uuid default null,   -- unused in Import; kept for signature parity
  p_reason             text default '',
  p_rates              jsonb default null    -- [{request_item_id, rate}] for `override`
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids       uuid[];
  v_total     numeric(16,2);
  v_count     integer;
  v_bad       integer;
  v_approver  uuid;
  v_tier      text;
  v_elem      jsonb;
  v_line_id   uuid;
  v_new_rate  numeric(14,2);
begin
  -- A PO on any line freezes the whole requisition's decision.
  select count(*) into v_bad from public.fms_import_request_items
   where request_id = p_request_id and status = 'po';
  if v_bad > 0 then
    raise exception 'A PO has already been generated for this requisition — the approval can no longer be changed.';
  end if;

  perform 1 from public.fms_import_request_items
   where request_id = p_request_id and status = 'approved_pending_po'
   for update;

  select array_agg(ri.id), count(*), coalesce(sum(ri.line_value),0)
    into v_ids, v_count, v_total
    from public.fms_import_request_items ri
   where ri.request_id = p_request_id and ri.status = 'approved_pending_po';

  if coalesce(v_count,0) = 0 then
    raise exception 'This requisition has no approved decision awaiting a PO.';
  end if;

  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active and v_total >= min_amount and (max_amount is null or v_total <= max_amount)
   order by sort_order, min_amount limit 1;

  if not (public.is_admin(auth.uid())
          or (v_approver is not null and v_approver = auth.uid())
          or exists (select 1 from public.fms_import_request_items
                      where id = any(v_ids) and assigned_approver_id = auth.uid())) then
    raise exception 'Not authorized to change this approval';
  end if;

  if p_decision = 'approve' or p_decision = 'override' then
    if p_decision = 'override' then
      if p_rates is null or jsonb_array_length(p_rates) = 0 then
        raise exception 'No revised rates supplied';
      end if;
      for v_elem in select * from jsonb_array_elements(p_rates) loop
        v_line_id  := (v_elem->>'request_item_id')::uuid;
        v_new_rate := nullif(v_elem->>'rate','')::numeric;
        if v_new_rate is null or v_new_rate < 0 then
          raise exception 'Enter a rate of 0 or more for every revised line';
        end if;
        update public.fms_import_request_items ri
           set final_rate    = v_new_rate,
               line_value_fx = round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2),
               line_value    = round(round(ri.final_qty * v_new_rate * (1 + coalesce(ri.gst_pct,0)/100.0), 2)
                                     * coalesce(ri.fx_rate_at_request, 1), 2)
         where ri.id = v_line_id
           and ri.request_id = p_request_id
           and ri.status = 'approved_pending_po';
        if not found then
          raise exception 'Line % is not an approved line awaiting a PO on this requisition', v_line_id;
        end if;
      end loop;
    end if;

    update public.fms_import_request_items
       set approver_id = auth.uid(), approval_tier = v_tier, reject_reason = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  elsif p_decision = 'reject' then
    -- Reversing an approval. approved_at is cleared: leaving a stale stamp would
    -- date a decision that was withdrawn.
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null, assigned_approver_id = null,
           edited_at = now(), edited_by = auth.uid()
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  perform public.fms_import_announce('request', p_request_id, 'approval_edited',
    format('Approval decision changed (%s)', p_decision), '{}'::uuid[],
    jsonb_build_object('decision', p_decision, 'lines', v_count));
end $$;

grant execute on function public.fms_import_update_approval_request(uuid, text, uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Mark the per-line predecessors superseded (kept, still granted).
-- ---------------------------------------------------------------------------
comment on function public.fms_import_decide_approval(uuid, text, uuid, text) is
  'SUPERSEDED by fms_import_decide_approval_request. Retained for per-line decisions on legacy requisitions decided in separate passes.';
comment on function public.fms_import_update_approval(uuid, text, uuid, text) is
  'SUPERSEDED by fms_import_update_approval_request. Retained for per-line corrections on legacy requisitions.';
