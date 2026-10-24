-- ===========================================================================
-- ROLLBACK for 20261227120000_fms_supplies_reassign_second_approval.sql.
--
-- Puts the AUTHORITY back exactly as it was: reassign is first-approval only,
-- and the second approval belongs to its step owners alone. The column is kept
-- (additive-only rule) but emptied, so nothing reads a stale holder.
--
-- Deliberately NOT reverted: fms_supplies_can_read_request and
-- fms_supplies_email_payload. Both carry repairs (the first-approval holder's
-- read arm, the 'reassigned' email card), and with the column all NULL their
-- second-approval parts do nothing.
-- ===========================================================================

begin;

update public.fms_supplies_requests
   set second_assigned_approver_id = null
 where second_assigned_approver_id is not null;

create or replace function public.fms_supplies_can_act__ungated(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hod    uuid;
  v_holder uuid;
begin
  if public.is_admin(p_uid) or public.fms_supplies_is_coordinator(p_uid) then
    return true;
  end if;

  if p_step_key = 'first_approval' then
    -- A HANDOVER MOVES THE WORK. While assigned_approver_id is set, the holder is
    -- the only non-admin who may decide — the HOD no longer can, which is what
    -- takes the request out of the HOD's queue.
    select assigned_approver_id into v_holder
      from public.fms_supplies_requests where id = p_req;
    if v_holder is not null then
      return v_holder = p_uid;
    end if;

    v_hod := public.fms_supplies_request_hod(p_req);
    return v_hod is not null and v_hod = p_uid;
  end if;

  return public.fms_supplies_is_step_owner(p_step_key, p_uid);
end $$;

create or replace function public.fms_supplies_reassign_request(p_req uuid, p_approver_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_hod    uuid;
  v_holder uuid;
  v_raiser uuid;
  v_for    uuid;
begin
  select status, assigned_approver_id, raised_by, requested_for_user_id
    into v_status, v_holder, v_raiser, v_for
    from public.fms_supplies_requests
   where id = p_req
   for update;

  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_first_approval' then
    raise exception 'This request is not awaiting first approval (status %) — it can no longer be reassigned', v_status;
  end if;

  v_hod := public.fms_supplies_request_hod(p_req);

  if not (public.is_admin(v_uid)
          or public.fms_supplies_is_coordinator(v_uid)
          or (v_hod is not null and v_hod = v_uid)
          or (v_holder is not null and v_holder = v_uid)) then
    raise exception 'Not authorized to reassign this request';
  end if;

  if p_approver_id is not null then
    if p_approver_id = v_uid then
      raise exception 'Pick someone else — a request cannot be reassigned to yourself';
    end if;
    -- NEW: nobody approves their own request, however it reached them.
    if p_approver_id = v_raiser or (v_for is not null and p_approver_id = v_for) then
      raise exception 'Pick someone else — this request cannot be approved by the person who raised it or who it is for';
    end if;
    if not (public.fms_supplies_can_receive_reassignment(p_approver_id)
            or (v_hod is not null and p_approver_id = v_hod)) then
      raise exception 'That person may not receive an approval. Add them in Setup, under Approvals, first.';
    end if;
  end if;

  -- ⚠ status and current_step are NOT touched. The request stays exactly where
  --   it is in the flow; only who owes the decision changes.
  update public.fms_supplies_requests
     set assigned_approver_id = p_approver_id
   where id = p_req;
end $$;

commit;
