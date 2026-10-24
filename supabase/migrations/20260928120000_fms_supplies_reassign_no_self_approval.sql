-- General Purchase: a request may not be handed to the person who asked for it.
--
-- WHY
-- ---
-- fms_supplies_submit_request is careful never to route a request to its own raiser or
-- its subject: that safeguard is the reason an HOD's own request skips the HOD approval
-- and goes straight to Management. fms_supplies_reassign_request could undo it in one
-- click. It refused only "reassign to yourself", so the HOD (or an admin) could hand the
-- first approval to the very person who raised the request, and that person could then
-- approve it.
--
-- Reproduced on live data during the 28-09-2026 walkthrough. SUPPLY-2627-0026 ended up
-- with raised_by = requested_for_user_id = assigned_approver_id = first_approver_id, all
-- one account. Nothing on any screen said anything was unusual.
--
-- WHAT CHANGES
-- ------------
-- One more check on the receiving end, in the same place as the existing self-check. The
-- authority rules, the status rule and the pool rule are untouched. Rebuilt from
-- pg_proc.prosrc as it stands live, not from the newest migration file — the live
-- definition is the one that matters.
--
-- The UI mirrors it: apps/office-supplies/store.tsx drops the raiser and the beneficiary
-- from `reassignCandidates`, so the name is never offered in the first place. This is the
-- gate.

-- ⚠ Keep the DEFAULT. The live signature is (p_req uuid, p_approver_id uuid default null);
-- dropping it makes CREATE OR REPLACE fail with 42P13 rather than quietly changing the API.
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
