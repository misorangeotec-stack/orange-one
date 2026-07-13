-- HR Recruitment — a vacancy is a plan; a hire is a person.
--
-- TWO BUGS, one theme: the vacancy's status was allowed to overrule facts about a
-- real human being who has already accepted an offer.
--
-- ---------------------------------------------------------------------------
-- BUG 1 — you can cancel a requisition out from under someone who accepted.
--
-- fms_hr_cancel_requisition guarded only on "not already closed/cancelled", the
-- caller's role, and a reason. It never looked at whether anyone had ACCEPTED the
-- offer. So a coordinator could cancel a vacancy whose candidate has signed, has a
-- joining date, and is halfway through the onboarding checklist. The person still
-- walks in on Monday. (Until now the damage was hidden: the cancelled requisition
-- dropped their onboarding out of every queue, so nobody could even see the
-- contradiction. The queue no longer hides it — hence this guard.)
--
-- Cancelling is now REFUSED while an accepted offer exists, and the error names the
-- person, because "cancel failed" is useless and "Yash Agarwal has accepted this
-- offer" is actionable. The way out is deliberate: mark them declined / did-not-join
-- (which frees the seat), then cancel.
--
-- ---------------------------------------------------------------------------
-- BUG 2 — a vacancy held at the moment its last hire joins NEVER closes.
--
-- fms_hr_sync_requisition_fill closed the requisition only `if v_joined >= v_seats
-- and v_status = 'sourcing'`. Put a vacancy on hold while the final hire finishes
-- onboarding, let them tick the last box, and the close branch is skipped. Lift the
-- hold and it returns to 'sourcing' — fully staffed, but still advertising for CVs,
-- forever.
--
-- That was survivable only because the requisition kept emitting a (wrong) "collect
-- resumes" work-item, so it stayed VISIBLE. The queue is about to stop emitting that
-- item once every seat is taken — which would turn this into a permanently invisible,
-- never-closing record. So this fix MUST land before that one.
--
-- Now: seats full ⇒ close, whatever non-terminal status the vacancy is in.
--
-- The REOPEN branch deliberately still requires `status = 'closed'`. A decline on a
-- HELD vacancy must leave it held — reopening a vacancy somebody deliberately paused
-- would be the same class of bug in the opposite direction.

create or replace function public.fms_hr_sync_requisition_fill(p_req uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats  integer;
  v_status text;
  v_no     text;
  v_joined integer;
begin
  select positions_required, status, mrf_no
    into v_seats, v_status, v_no
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then return; end if;

  v_joined := public.fms_hr_seats_joined(p_req);

  -- Seats full ⇒ close. A vacancy that was on hold when its last hire joined is still
  -- a filled vacancy; the hold said "stop looking", not "stay open forever".
  if v_joined >= v_seats and v_status not in ('closed', 'cancelled', 'rejected') then
    update public.fms_hr_requisitions
       set status = 'closed', closed_at = now()
     where id = p_req;
    perform public.fms_hr_announce(
      'requisition', p_req, 'closed',
      v_no || ' closed — all ' || v_seats || ' seat(s) filled',
      public.fms_hr_step_owner_ids('resume_upload')
    );

  elsif v_joined < v_seats and v_status = 'closed' then
    -- Someone we counted as hired is no longer hired. The vacancy is real again.
    update public.fms_hr_requisitions
       set status = 'sourcing', current_step = 'resume_upload', closed_at = null
     where id = p_req;
    perform public.fms_hr_announce(
      'requisition', p_req, 'reopened',
      v_no || ' reopened — ' || (v_seats - v_joined) || ' seat(s) open again',
      public.fms_hr_step_owner_ids('resume_upload')
    );
  end if;
end $$;

grant execute on function public.fms_hr_sync_requisition_fill(uuid) to authenticated;


-- Unchanged from the original except for ONE added guard. Deliberately no new
-- notification: this function never announced, and quietly starting to would be a
-- behaviour change nobody asked for.
create or replace function public.fms_hr_cancel_requisition(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_who    text;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status in ('closed','cancelled') then
    raise exception 'This requisition is already %', v_status;
  end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can cancel a requisition';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to cancel'; end if;

  -- THE NEW GUARD. A person who has accepted is not a line item. Name them, and say
  -- the way out — "cancel failed" is useless; "Yash Agarwal has accepted" is actionable.
  select c.name into v_who
    from public.fms_hr_onboardings o
    join public.fms_hr_candidates c on c.id = o.candidate_id
   where o.requisition_id = p_req
     and o.offer_status = 'accepted'
   order by c.name
   limit 1;

  if v_who is not null then
    raise exception
      '% has accepted this offer. Mark them as declined or did-not-join first, then cancel.', v_who;
  end if;

  update public.fms_hr_requisitions
     set status = 'cancelled', cancel_reason = trim(p_reason), closed_at = now(), decided_by = v_uid
   where id = p_req;
end $$;

grant execute on function public.fms_hr_cancel_requisition(uuid, text) to authenticated;
