-- ===========================================================================
-- Import Purchase FMS — an approver may HAND A REQUISITION to someone else.
--
-- WHY THIS EXISTS AGAIN
-- Reassign was built once and deliberately removed by
-- 20260806123000_fms_import_remove_reassign.sql, for one stated reason: its
-- picker listed EVERY profile, so an approval could be handed to someone with
-- no approval authority at all. That objection is answered here by a CONFIGURED
-- POOL — an admin names, in Setup, exactly who may receive a handover — so the
-- feature comes back with the gate it was missing rather than staying dropped.
--
-- WHAT A HANDOVER MEANS
-- ONE REQUISITION AT A TIME, and it MOVES. Once handed over, the requisition
-- leaves the original approver's queue and only the holder (or an admin) may
-- decide it. It is not a standing "stand-in for everything while I am away";
-- that was considered and set aside (see IM-1 in WORKLIST.md).
--
-- ⚠ THE OR THAT WAS NOT A MOVE
-- Both request-scoped approval RPCs already carried
--     is_admin OR fms_import_is_approver OR assigned_approver_id = auth.uid()
-- left behind, inert, by the removal migration. As an OR that is a SHARE, not a
-- move: a DIFFERENT configured approver could still decide a requisition handed
-- to someone else. Sections 3-5 replace it with a holder rule in all three
-- approval RPCs.
--
-- ⚠ THE LEGACY PER-LINE RPC WAS A BYPASS
-- fms_import_decide_approval resolves its approver by a band lookup on
-- line_value — and line_value has been 0 for every line since 20260727120000
-- made Import a pure quantity requisition, so the lookup always matches the
-- FIRST active approver. That approver could decide a handed-over line through
-- it. No UI reaches this RPC, but it is granted to `authenticated`. Section 5
-- closes it. 20260806123000 said to strip the dead branch "the next time one is
-- edited for a real reason" — this is that edit, except the branch is being
-- REVIVED rather than stripped.
--
-- ⚠ assigned_approver_id IS NO LONGER CLEARED AT THE DECISION
-- It used to be nulled on approve/reject. If it is cleared at approval, the
-- holder can approve but then cannot REVISE her own decision before the PO —
-- fms_import_update_approval_request reads assigned_approver_id on
-- approved_pending_po lines and would find nothing. It now survives the
-- decision, which also keeps the trail readable.
--
-- ADDITIVE, per the repo rule:
--   * No table, column or function is dropped.
--   * Every create-or-replace keeps its EXACT current argument list. Changing a
--     signature would create a PostgREST OVERLOAD, not a replacement.
--   * The pool is a row in the existing fms_import_config key/value singleton
--     (key 'reassign_pool'), not a new table.
--
-- NO SERVER-SIDE ANNOUNCE HERE, DELIBERATELY. fms_import_announce builds the
-- email_outbox payload straight from p_meta, and every key send-email renders
-- is authored in the app's lib/emailMeta.ts. A `perform fms_import_announce`
-- inside this RPC would mail the receiver a blank-looking card. The store raises
-- it client-side instead — the same reason cancelLines announces from the
-- client. The reason text travels with that announce, which is why there is no
-- p_note parameter here.
--
-- REVERSAL — REHEARSED ON LIVE DATA 2026-08-27 (cutover → rollback → abort, run
-- for real against icutjkrqkbzwvmnfbzpr, not read off the page). Two things the
-- rehearsal DISPROVED, both of which had been written here as fact first:
--
--   ⚠ THE DROP ORDER IS NOT ENFORCED. This header originally said the RPC bodies
--     must go back before the helper is dropped "because the RPCs reference it".
--     They do, but Postgres does not dependency-track a reference from inside a
--     string-quoted function body: dropping fms_import_can_receive_reassignment
--     while fms_import_reassign_request still existed was ACCEPTED, and the
--     breakage showed up only at call time. So the order is a matter of keeping
--     the broken window short, not something the database will refuse.
--
--   ⚠ STEPS 1 AND 2 BELOW ARE OPTIONAL. Once assigned_approver_id is back to all
--     NULL (step 4), the holder branch added to the three approval RPCs is
--     unreachable and their new bodies behave EXACTLY like the pre-migration
--     ones — verified: an outsider still gets 'Not authorized to approve this
--     requisition', a configured approver still passes authz. Restore them only
--     if you want the source to match the files; nothing observable depends on it.
--
-- The recipe, in the order it was actually run:
--   3. drop function public.fms_import_reassign_request(uuid, uuid);
--      drop function public.fms_import_can_receive_reassignment(uuid);
--      (helper LAST in practice, so no call can land mid-window)
--   4. update public.fms_import_request_items set assigned_approver_id = null
--       where assigned_approver_id is not null;
--   5. delete from public.fms_import_config where key = 'reassign_pool';
--   1. (optional) re-run sections 2 and 3 of
--      20260727120000_fms_import_quantity_requisition.sql
--      (fms_import_decide_approval_request, fms_import_update_approval_request).
--   2. (optional) re-run the fms_import_decide_approval block from
--      20260718190000_remove_gst_from_fms_import.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who may RECEIVE a handover.
--
-- Backed by fms_import_config key 'reassign_pool':
--     { "department_ids": [...], "user_ids": [...] }
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a UI filter for
--   CHOOSING people in Setup and grants nothing — the same rule every FMS
--   step-owner table follows (20261005120000_add_fms_travel_foundations.sql).
--   Do not start reading department_ids here.
--
-- Shape mirrors fms_import_is_coordinator
-- (20260716120400_add_fms_import_activity_notifications.sql).
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_import_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_import_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed an Import approval? Reads ONLY fms_import_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_import_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Hand a requisition over (or take it back).
--
-- p_approver_id NULL = return it to the configured approvers. That is the
-- "take it back" path, and it is why this is one RPC rather than two.
--
-- WHO MAY CALL IT is deliberately BROADER than who may decide: an active
-- approver keeps the right to pull a requisition back after handing it over,
-- which the holder rule in sections 3-5 would otherwise deny him. Same shape as
-- fms_hr_reassign_interview — whoever owes the work may pass it on, and work
-- already done cannot be handed over at all.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_reassign_request(
  p_request_id  uuid,
  p_approver_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_ids       uuid[];
  v_count     integer;
  v_is_holder boolean;
begin
  perform 1 from public.fms_import_request_items
   where request_id = p_request_id and status in ('approval','on_hold')
   for update;

  select array_agg(id), count(*), bool_or(assigned_approver_id = v_uid)
    into v_ids, v_count, v_is_holder
    from public.fms_import_request_items
   where request_id = p_request_id and status in ('approval','on_hold');

  if coalesce(v_count, 0) = 0 then
    raise exception 'Nothing on this requisition is awaiting approval — it can no longer be reassigned';
  end if;

  if not (public.is_admin(v_uid)
          or public.fms_import_is_approver(v_uid)
          or coalesce(v_is_holder, false)) then
    raise exception 'Not authorized to reassign this requisition';
  end if;

  if p_approver_id is not null then
    if p_approver_id = v_uid then
      raise exception 'Pick someone else — a requisition cannot be reassigned to yourself';
    end if;
    -- The pool, OR a configured approver: the second arm is what lets it be
    -- handed BACK without an admin having to also list every approver in the pool.
    if not (public.fms_import_can_receive_reassignment(p_approver_id)
            or public.fms_import_is_approver(p_approver_id)) then
      raise exception 'That person may not receive an approval. Add them in Setup, under Approvers, first.';
    end if;
  end if;

  -- ⚠ status is NOT touched. A line the approver put on hold stays on hold; the
  --   removed fms_import_reassign_line forced status='approval' here and so
  --   silently RESUMED a held line as a side effect of handing it over.
  update public.fms_import_request_items
     set assigned_approver_id = p_approver_id
   where id = any(v_ids);
end $$;

comment on function public.fms_import_reassign_request(uuid, uuid) is
  'Hand one Import requisition awaiting approval to another person, or pass NULL to return it to the configured approvers. Callable by an admin, any active approver, or the current holder. Does not announce - the store raises the notification client-side so the email renders with content.';

grant execute on function public.fms_import_reassign_request(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. decide_approval_request — the holder rule.
--    Base body = 20260727120000_fms_import_quantity_requisition.sql section 2.
--    Deltas, and ONLY these two:
--      * the three-arm OR becomes a holder rule (a handover MOVES the work);
--      * assigned_approver_id is no longer cleared on approve / reject.
--    Signature unchanged. The `override` branch remains unreachable in Import.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_decide_approval_request(
  p_request_id         uuid,
  p_decision           text,       -- approve | override | reject | hold | resume
  p_override_vendor_id uuid default null,   -- unused in Import; kept for signature parity
  p_reason             text default '',
  p_rates              jsonb default null    -- unused; kept for signature parity
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
  v_handed    boolean;
  v_is_holder boolean;
begin
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

  -- No value banding: the approver is simply the first active configured
  -- approver. The routing is who to STAMP/notify; any active approver may act —
  -- unless the requisition has been handed over, which the check below enforces.
  select approver_user_id, tier_label into v_approver, v_tier
    from public.fms_import_approval_matrix
   where active
   order by sort_order, min_amount limit 1;

  -- A HANDOVER MOVES THE WORK. While assigned_approver_id is set, the holder is
  -- the only non-admin who may decide — this is deliberately NOT an OR against
  -- fms_import_is_approver, or the handover would merely SHARE the requisition
  -- and it would stay in the original approver's queue too.
  select bool_or(assigned_approver_id is not null),
         bool_or(assigned_approver_id = auth.uid())
    into v_handed, v_is_holder
    from public.fms_import_request_items
   where id = any(v_ids);

  if public.is_admin(auth.uid()) then
    null;
  elsif coalesce(v_handed, false) then
    if not coalesce(v_is_holder, false) then
      raise exception 'This requisition has been reassigned — only the person holding it may decide it';
    end if;
  elsif not public.fms_import_is_approver(auth.uid()) then
    raise exception 'Not authorized to approve this requisition';
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
           and ri.status in ('approval','on_hold');
        if not found then
          raise exception 'Line % is not awaiting approval on this requisition', v_line_id;
        end if;
      end loop;
    end if;

    -- assigned_approver_id SURVIVES the decision, so the holder can still revise
    -- it via fms_import_update_approval_request until the PO exists.
    update public.fms_import_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null, approved_at = now()
     where id = any(v_ids);

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason
     where id = any(v_ids);

  elsif p_decision = 'hold' then
    update public.fms_import_request_items set status = 'on_hold' where id = any(v_ids);

  elsif p_decision = 'resume' then
    update public.fms_import_request_items set status = 'approval', approved_at = null
     where id = any(v_ids);

  else
    raise exception 'Unknown decision %', p_decision;
  end if;

  select coalesce(sum(ri.line_value),0) into v_val_fx
    from public.fms_import_request_items ri where ri.id = any(v_ids);

  perform public.fms_import_announce('request', p_request_id, 'approval_' || p_decision,
    format('Approval decision on the requisition (%s), %s item(s)', p_decision, v_count),
    '{}'::uuid[], jsonb_build_object('decision', p_decision, 'lines', v_count, 'total', v_val_fx));
end $$;

grant execute on function public.fms_import_decide_approval_request(uuid, text, uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. update_approval_request — same two deltas as (3).
--    Base body = 20260727120000_fms_import_quantity_requisition.sql section 3.
-- ---------------------------------------------------------------------------
create or replace function public.fms_import_update_approval_request(
  p_request_id         uuid,
  p_decision           text,       -- approve | override | reject
  p_override_vendor_id uuid default null,   -- unused in Import; kept for signature parity
  p_reason             text default '',
  p_rates              jsonb default null    -- unused; kept for signature parity
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
  v_handed    boolean;
  v_is_holder boolean;
begin
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
   where active
   order by sort_order, min_amount limit 1;

  -- Same holder rule as section 3. This is the branch that only works because
  -- the decision no longer clears assigned_approver_id: a handover receiver who
  -- approved must still be able to revise her own decision before the PO.
  select bool_or(assigned_approver_id is not null),
         bool_or(assigned_approver_id = auth.uid())
    into v_handed, v_is_holder
    from public.fms_import_request_items
   where id = any(v_ids);

  if public.is_admin(auth.uid()) then
    null;
  elsif coalesce(v_handed, false) then
    if not coalesce(v_is_holder, false) then
      raise exception 'This requisition has been reassigned — only the person holding it may change this approval';
    end if;
  elsif not public.fms_import_is_approver(auth.uid()) then
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
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason,
           approved_at = null,
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
-- 5. decide_approval — the LEGACY per-line RPC. Closing the bypass.
--    Base body = 20260718190000_remove_gst_from_fms_import.sql section 2c.
--
--    No UI reaches this any more (the request-scoped twin replaced it, and
--    store.decideApproval is an orphan with no caller — see IM-1). It is still
--    granted to `authenticated`, and its band lookup on line_value always
--    resolves to the FIRST active approver now that every line_value is 0, so
--    without this edit that one person could decide a handed-over line.
--
--    Deltas, and ONLY these two, matching sections 3 and 4:
--      * the approver arm becomes a holder rule;
--      * assigned_approver_id is no longer cleared on approve/override/reject.
--    Signature unchanged.
-- ---------------------------------------------------------------------------
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

  -- Holder rule, same as the request-scoped RPCs: while this line is handed
  -- over, the holder is the only non-admin who may decide it.
  if public.is_admin(auth.uid()) then
    null;
  elsif v_assigned is not null then
    if v_assigned <> auth.uid() then
      raise exception 'This line has been reassigned — only the person holding it may decide it';
    end if;
  elsif not public.fms_import_is_approver(auth.uid()) then
    raise exception 'Not authorized to approve this line';
  end if;

  if p_decision = 'approve' then
    update public.fms_import_request_items
       set status = 'approved_pending_po', approver_id = auth.uid(), approval_tier = v_tier,
           reject_reason = null,
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
           reject_reason = null,
           approved_at = now()
     where id = p_request_item_id;

  elsif p_decision = 'reject' then
    if nullif(p_reason,'') is null then raise exception 'A reason is required to reject'; end if;
    update public.fms_import_request_items
       set status = 'rejected', approver_id = auth.uid(), reject_reason = p_reason
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

commit;
