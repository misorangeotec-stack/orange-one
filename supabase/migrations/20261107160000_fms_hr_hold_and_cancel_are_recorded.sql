-- New Recruitment — a hold and a cancellation leave a record of WHO, WHEN and WHY.
--
-- WHY. Five vacancies have been cancelled on the live system, every one of them with a
-- reason typed into the confirm dialog — "Please Upload the JD and Location", "Its Sales
-- Co-ordinator not Service Co-ordinator". Those are messages to the person who raised the
-- MRF. `cancel_reason` has been written since 20260712130000 and is rendered on no screen
-- in the application, so not one of them was ever read. The requester sees a grey
-- CANCELLED pill on their dashboard and nothing else.
--
-- Cancel already records its actor in `decided_by`. HOLD RECORDS NOBODY: 20260713130000
-- added `hold_at` but no actor column, and the resume branch nulls both — so a vacancy
-- that was held and released leaves no evidence it ever happened. This adds `held_by`,
-- and writes the trail into `fms_hr_activity` so releasing a hold no longer erases it.
--
-- ⚠ THE ANNOUNCES CARRY NO RECIPIENT ARRAY, ON PURPOSE. `fms_hr_announce`'s `p_user_ids`
--   defaults to '{}', so the notification loop never runs and no bell fires; its email arm
--   is scoped to master_request and candidate/interview_* types, so a 'requisition' row
--   cannot reach email_outbox even with the module switch on. 20260713120000 declined to
--   add notifications here — "quietly starting to would be a behaviour change nobody asked
--   for" — and that still holds. This adds the TRAIL, not the notification.
--
-- ⚠ THIS DELIBERATELY BREAKS THE HOUSE RULE that requisition RPCs do not announce (the
--   store does it after the write). The store's `safeAnnounce` is best-effort and swallows
--   its own failure — which is exactly why 20260712130000 warns never to infer a step from
--   the trail. An audit row naming who cancelled a vacancy has to be transactional with the
--   cancellation or it is not an audit row. No double-write results: holdRequisition and
--   cancelRequisition are the only two requisition writes the store does NOT already
--   follow with safeAnnounce.
--
-- ⚠ ADDITIVE. One nullable column; both functions keep their exact signatures, so
--   `create or replace` preserves their execute grants (dropping them would revoke).
--   Reversal: `alter table … drop column held_by`, then re-apply 20260713130000 and
--   20260816120000 to restore the two bodies, then delete the backfilled activity rows.

-- ---------------------------------------------------------------------------
-- 1 · Who parked it. Mirrors `posted_by` (20260721120000): nullable, no default,
--     null on every vacancy held before attribution was captured.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_requisitions
  add column if not exists held_by uuid references auth.users on delete set null;

comment on column public.fms_hr_requisitions.held_by is
  'Who put the vacancy on hold. Cleared on resume, like hold_reason and hold_at — the durable history lives in fms_hr_activity (types held / resumed).';


-- ---------------------------------------------------------------------------
-- 2 · Hold / resume. Body from 20260713130000 VERBATIM, with three changes:
--     mrf_no read into v_no, held_by stamped and cleared, and the two announces.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_hold_requisition(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_step   text;
  v_no     text;
  v_uid    uuid := auth.uid();
begin
  select status, current_step, mrf_no into v_status, v_step, v_no
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold a requisition';
  end if;

  if p_hold then
    if v_status in ('closed','cancelled','rejected','on_hold') then
      raise exception 'A % requisition cannot be put on hold', v_status;
    end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_hr_requisitions
       set status = 'on_hold', hold_reason = trim(p_reason), hold_at = now(), held_by = v_uid
     where id = p_req;

    perform public.fms_hr_announce(
      'requisition', p_req, 'held',
      v_no || ' put on hold — ' || trim(p_reason));
  else
    if v_status <> 'on_hold' then raise exception 'This requisition is not on hold'; end if;
    -- Resume back to whatever step it was parked at.
    update public.fms_hr_requisitions
       set status = case v_step
                      when 'hr_head_approval' then 'hr_review'
                      when 'mgmt_approval'    then 'mgmt_review'
                      when 'job_posting'      then 'posting'
                      else 'sourcing'
                    end,
           hold_reason = null,
           hold_at = null,
           held_by = null
     where id = p_req;

    perform public.fms_hr_announce(
      'requisition', p_req, 'resumed',
      v_no || ' taken off hold');
  end if;
end $$;

grant execute on function public.fms_hr_hold_requisition(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3 · Cancel. Body from 20260816120000 VERBATIM — including the accepted-hire
--     guard, which must not be lost — with one announce added at the end.
-- ---------------------------------------------------------------------------
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
  v_no     text;
begin
  select status, mrf_no into v_status, v_no
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status in ('closed','cancelled') then
    raise exception 'This requisition is already %', v_status;
  end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can cancel a requisition';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to cancel'; end if;

  -- THE GUARD. A person mid-onboarding is not a line item. Name them, and say
  -- the way out — "cancel failed" is useless; "Yash Agarwal has been finalized"
  -- is actionable.
  select c.name into v_who
    from public.fms_hr_onboardings o
    join public.fms_hr_candidates c on c.id = o.candidate_id
   where o.requisition_id = p_req
     and o.offer_status = 'accepted'
   order by c.name
   limit 1;

  if v_who is not null then
    raise exception
      '% has been finalized on this requisition and is being onboarded. Move their card back to an earlier stage first, then cancel.', v_who;
  end if;

  update public.fms_hr_requisitions
     set status = 'cancelled', cancel_reason = trim(p_reason), closed_at = now(), decided_by = v_uid
   where id = p_req;

  perform public.fms_hr_announce(
    'requisition', p_req, 'cancelled',
    v_no || ' cancelled — ' || trim(p_reason));
end $$;

grant execute on function public.fms_hr_cancel_requisition(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4 · Backfill the cancellations that already happened.
--
-- A direct insert, NOT fms_hr_announce: announce stamps actor_id = auth.uid()
-- (null in a migration) and created_at = now(), which would erase exactly the two
-- facts worth keeping.
--
-- 🔴 created_at = closed_at IS LOAD-BEARING. master_report_snapshot
-- (20260830120000) runs an UNFILTERED max(created_at) and a 7-day
-- count(distinct actor_id) over the whole of fms_hr_activity. Left to default,
-- this backfill would report New Recruitment's last activity as the migration
-- timestamp and inflate its active-user count for a week.
--
-- There is no unique index on fms_hr_activity to hang `on conflict` off, so the
-- `not exists` predicate IS the idempotency. Re-running without it duplicates.
-- ---------------------------------------------------------------------------
insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
select 'requisition', r.id, 'cancelled', r.decided_by,
       r.mrf_no || ' cancelled — ' || coalesce(nullif(trim(r.cancel_reason), ''), 'no reason recorded'),
       coalesce(r.closed_at, r.updated_at)
  from public.fms_hr_requisitions r
 where r.status = 'cancelled'
   and not exists (
         select 1 from public.fms_hr_activity a
          where a.entity_type = 'requisition'
            and a.entity_id = r.id
            and a.type = 'cancelled');
