-- ===========================================================================
-- HR Recruitment — more than one interviewer per round.
--
-- Every round (telephonic = 0, and rounds 1–3) could name exactly ONE person.
-- Real panels are not one person: a technical round is the HOD plus someone from
-- the team, a final round is two directors. Naming one of them and remembering
-- the rest is how the sheet used to work, and it is what this app exists to stop.
--
-- Modelled as uuid[] on the interview row, NOT a join table — the same decision
-- (and for the same reason) as fms_hr_requisitions.hiring_manager_ids: the list
-- is small, always read whole, never queried across, and a join table would buy
-- nothing but a second write on every booking.
--
-- interviewer_id IS KEPT AND KEPT TRUTHFUL. Dropping it would break the
-- additive-only rule, and it is still meaningful as "who is leading this round" —
-- so every write sets it to interviewer_ids[1]. Anything still reading the scalar
-- gets the panel lead rather than a stale value or a null.
--
-- interviewer_name is untouched: it is the free-text fallback for an external
-- consultant with no portal login, and it still is.
--
-- Purely ADDITIVE:
--   fms_hr_interviews.interviewer_ids  — new uuid[] column, backfilled
--   fms_hr_move_candidate              — re-issued, books a panel
--   fms_hr_schedule_interview          — re-issued, p_interviewer_ids uuid[]
--
-- Reversal:
--   drop function if exists public.fms_hr_schedule_interview(uuid, integer, uuid[], text, date);
--   -- re-run fms_hr_schedule_interview from 20260716130000 and
--   -- fms_hr_move_candidate from 20260813120100
--   alter table public.fms_hr_interviews drop column if exists interviewer_ids;
-- ===========================================================================

-- ---- 1. The column, and the history that goes into it --------------------

alter table public.fms_hr_interviews
  add column if not exists interviewer_ids uuid[] not null default '{}';

comment on column public.fms_hr_interviews.interviewer_ids is
  'Everyone taking this round. interviewer_id mirrors element 1 (the panel lead); interviewer_name still carries an external interviewer with no login.';

-- Every round booked before this migration named one person. Lift them into the
-- array so the panel view of an old interview is right, not empty.
update public.fms_hr_interviews
   set interviewer_ids = array[interviewer_id]
 where interviewer_id is not null
   and cardinality(interviewer_ids) = 0;

-- ---- 2. fms_hr_move_candidate — booking a round books a panel ------------
--
-- Re-issued whole from 20260813120100; only the interview-booking branch differs.

create or replace function public.fms_hr_move_candidate(p_id uuid, p_to_stage text, p jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_req        uuid;
  v_from       text;
  v_req_status text;
  v_seats      integer;
  v_taken      integer;
  v_to_step    text;
  v_pending    text;
  v_from_rank  integer;
  v_to_rank    integer;
  v_round      integer;
  v_joining    date;
  v_onb        uuid;
  v_ids        uuid[] := '{}';
begin
  select c.requisition_id, c.stage into v_req, v_from
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_from = p_to_stage then return; end if;

  select status, positions_required into v_req_status, v_seats
    from public.fms_hr_requisitions where id = v_req for update;
  if v_req_status in ('on_hold','cancelled','closed') then
    raise exception 'This requisition is % — candidates cannot be moved', v_req_status;
  end if;

  v_to_step   := public.fms_hr_stage_step(p_to_stage);
  v_pending   := public.fms_hr_pending_step(v_from);
  v_from_rank := public.fms_hr_stage_rank(v_from);
  v_to_rank   := public.fms_hr_stage_rank(p_to_stage);

  -- ---- 1. Is this transition legal at all? -------------------------------
  -- Forward is normally one column at a time, BUT inside the interview zone (from
  -- hod_shortlisted rank 4 up to final_decision rank 9) a forward jump of any
  -- distance is allowed — Telephonic and the rounds are optional.
  if p_to_stage <> 'disqualified' and v_to_rank > v_from_rank then
    if not (v_to_rank = v_from_rank + 1
            or (v_from_rank >= 4 and v_to_rank <= 9)) then
      raise exception 'That is not a legal forward move (% → %)', v_from, p_to_stage;
    end if;
  end if;
  if v_from in ('finalized','disqualified') and v_to_rank >= v_from_rank then
    raise exception 'This candidate is already %', v_from;
  end if;

  -- ---- 2. May this person do it? -----------------------------------------
  if p_to_stage = 'disqualified' then
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act('final_decision', v_req, v_uid)) then
      raise exception 'Not authorized to disqualify this candidate';
    end if;

  elsif v_to_rank < v_from_rank then
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act(v_to_step, v_req, v_uid)) then
      raise exception 'Not authorized to move this candidate back to %', p_to_stage;
    end if;

  else
    if not public.fms_hr_can_act(v_to_step, v_req, v_uid) then
      raise exception 'Not authorized to move this candidate to %', p_to_stage;
    end if;
  end if;

  -- ---- 3. Moving BACKWARDS undoes the stages being reversed ---------------
  if v_to_rank < v_from_rank then
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — their onboarding is complete and cannot be undone by moving the card';
      end if;
      delete from public.fms_hr_onboardings where candidate_id = p_id;
    end if;

    update public.fms_hr_candidates set
      hr_shortlisted_at = case when v_to_rank < 2 then null else hr_shortlisted_at end,
      hr_shortlisted_by = case when v_to_rank < 2 then null else hr_shortlisted_by end,
      shared_to_hod_at  = case when v_to_rank < 3 then null else shared_to_hod_at end,
      shared_to_hod_by  = case when v_to_rank < 3 then null else shared_to_hod_by end,
      hod_decided_at    = case when v_to_rank < 4 then null else hod_decided_at end,
      hod_decided_by    = case when v_to_rank < 4 then null else hod_decided_by end,
      telephonic_at     = case when v_to_rank < 5 then null else telephonic_at end,
      interview1_at     = case when v_to_rank < 6 then null else interview1_at end,
      interview2_at     = case when v_to_rank < 7 then null else interview2_at end,
      interview3_at     = case when v_to_rank < 8 then null else interview3_at end,
      final_decision_at = case when v_to_rank < 9 then null else final_decision_at end,
      decision_remarks  = case when v_to_rank < 9 then null else decision_remarks end,
      finalized_at = null, finalized_by = null, offered_ctc = null, joined_at = null,
      disqualified_at = null, disqualification_reason_id = null, disqualification_note = null
    where id = p_id;

    -- A numbered round maps to rank 5+round, so drop interview rows past where the
    -- card is going back to. greatest(-1, …) means going below Telephonic drops round 0 too.
    delete from public.fms_hr_interviews
     where candidate_id = p_id and round > greatest(-1, v_to_rank - 5);
  end if;

  -- ---- 4. The move -------------------------------------------------------
  if p_to_stage = 'hr_shortlisted' then
    update public.fms_hr_candidates
       set stage = p_to_stage, hr_shortlisted_at = now(), hr_shortlisted_by = v_uid
     where id = p_id;

  elsif p_to_stage = 'shared_with_hod' then
    update public.fms_hr_candidates
       set stage = p_to_stage, shared_to_hod_at = now(), shared_to_hod_by = v_uid
     where id = p_id;

  elsif p_to_stage = 'hod_shortlisted' then
    update public.fms_hr_candidates
       set stage = p_to_stage, hod_decided_at = now(), hod_decided_by = v_uid
     where id = p_id;

  elsif p_to_stage in ('telephonic','interview_1','interview_2','interview_3') then
    -- Entering a round (0 = telephonic) BOOKS it. The result closes it separately.
    v_round := case p_to_stage when 'telephonic' then 0
                               else substring(p_to_stage from 'interview_(\d)')::integer end;

    -- The panel. Accepts the array; falls back to the old scalar key so a client
    -- that has not been redeployed yet still books successfully.
    if jsonb_typeof(p->'interviewer_ids') = 'array' then
      select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_ids
        from jsonb_array_elements_text(p->'interviewer_ids') as t(x)
       where coalesce(trim(x), '') <> '';
    elsif coalesce(p->>'interviewer_id', '') <> '' then
      v_ids := array[(p->>'interviewer_id')::uuid];
    end if;

    if cardinality(v_ids) = 0 and coalesce(trim(p->>'interviewer_name'), '') = '' then
      raise exception 'Say who is taking this interview';
    end if;

    insert into public.fms_hr_interviews (
      candidate_id, round, interviewer_ids, interviewer_id, interviewer_name,
      scheduled_on, status, created_by
    )
    values (
      p_id, v_round, v_ids, v_ids[1],
      nullif(trim(p->>'interviewer_name'), ''),
      nullif(p->>'scheduled_on','')::date,
      'scheduled', v_uid
    )
    on conflict (candidate_id, round) do update set
      interviewer_ids  = excluded.interviewer_ids,
      interviewer_id   = excluded.interviewer_id,
      interviewer_name = excluded.interviewer_name,
      scheduled_on     = excluded.scheduled_on,
      status           = 'scheduled',
      held_at          = null;

    update public.fms_hr_candidates set stage = p_to_stage where id = p_id;

  elsif p_to_stage = 'final_decision' then
    update public.fms_hr_candidates
       set stage = p_to_stage, final_decision_at = now(),
           decision_remarks = coalesce(nullif(trim(p->>'decision_remarks'), ''), decision_remarks)
     where id = p_id;

  elsif p_to_stage = 'finalized' then
    if v_from <> 'final_decision' then
      raise exception 'A candidate can only be finalized from the Final Decision column';
    end if;

    v_taken := public.fms_hr_seats_taken(v_req, p_id);
    if v_taken >= v_seats then
      raise exception 'All % seat(s) on this requisition are already filled', v_seats;
    end if;

    v_joining := nullif(p->>'joining_date','')::date;

    update public.fms_hr_candidates set
      stage = 'finalized', finalized_at = now(), finalized_by = v_uid,
      offered_ctc = nullif(p->>'offered_ctc','')::numeric,
      decision_remarks = coalesce(nullif(trim(p->>'decision_remarks'), ''), decision_remarks)
    where id = p_id;

    -- The onboarding is born with whatever date the selector knew. RETURNING is
    -- empty on conflict, so re-read — a re-finalize after a backward move has
    -- already deleted the old row, but belt and braces.
    insert into public.fms_hr_onboardings (
      candidate_id, requisition_id, created_by,
      joining_date, joining_date_set_at, joining_date_by
    )
    values (
      p_id, v_req, v_uid,
      v_joining,
      case when v_joining is not null then now() end,
      case when v_joining is not null then v_uid end
    )
    on conflict (candidate_id) do nothing
    returning id into v_onb;

    if v_onb is null then
      select id into v_onb from public.fms_hr_onboardings where candidate_id = p_id;
    end if;

    -- A dated onboarding is an OPEN onboarding: seed the checklist now, exactly as
    -- fms_hr_set_onboarding_date would, from the items active at this moment.
    -- Snapshotted deliberately — later master edits never rewrite history.
    if v_joining is not null and v_onb is not null then
      insert into public.fms_hr_onboarding_checks (
        onboarding_id, item_id, item_key, name, description,
        requires_file, allows_link, due_days, sort_order
      )
      select v_onb, i.id, i.key, i.name, i.description,
             i.requires_file, i.allows_link, i.due_days, i.sort_order
        from public.fms_hr_onboarding_items i
       where i.active
       order by i.sort_order, i.name
      on conflict (onboarding_id, item_key) do nothing;
    end if;

  elsif p_to_stage = 'disqualified' then
    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_reason_id = nullif(p->>'disqualification_reason_id','')::uuid,
      disqualification_note = nullif(trim(p->>'disqualification_note'), '')
    where id = p_id;

  elsif p_to_stage = 'resume_uploaded' then
    update public.fms_hr_candidates set stage = 'resume_uploaded' where id = p_id;

  else
    raise exception 'Unknown stage %', p_to_stage;
  end if;
end $$;
grant execute on function public.fms_hr_move_candidate(uuid, text, jsonb) to authenticated;

-- ---- 3. fms_hr_schedule_interview — the same, for the re-book path -------
--
-- The scalar signature is dropped, so there is no overload to resolve against.

drop function if exists public.fms_hr_schedule_interview(uuid, integer, uuid, text, date);
drop function if exists public.fms_hr_schedule_interview(uuid, integer, uuid[], text, date);
create or replace function public.fms_hr_schedule_interview(
  p_id               uuid,
  p_round            integer,
  p_interviewer_ids  uuid[] default '{}',
  p_interviewer_name text default null,
  p_scheduled_on     date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_stage text;
  v_want  text;
  v_step  text;
  v_ids   uuid[] := coalesce(p_interviewer_ids, '{}');
begin
  if p_round not between 0 and 3 then raise exception 'Round must be 0 (telephonic), 1, 2 or 3'; end if;
  if cardinality(v_ids) = 0 and coalesce(trim(p_interviewer_name), '') = '' then
    raise exception 'Say who is taking this interview';
  end if;

  v_want := case when p_round = 0 then 'telephonic' else 'interview_' || p_round end;
  v_step := case when p_round = 0 then 'telephonic_screening' else 'interview_' || p_round end;

  select requisition_id, stage into v_req, v_stage
    from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_stage <> v_want then
    raise exception 'This candidate is not at % (they are at %)', v_want, v_stage;
  end if;
  if not public.fms_hr_can_act(v_step, v_req, v_uid) then
    raise exception 'Not authorized to schedule this round for this candidate';
  end if;

  insert into public.fms_hr_interviews (
    candidate_id, round, interviewer_ids, interviewer_id, interviewer_name,
    scheduled_on, status, created_by
  )
  values (
    p_id, p_round, v_ids, v_ids[1], nullif(trim(p_interviewer_name), ''),
    p_scheduled_on, 'scheduled', v_uid
  )
  on conflict (candidate_id, round) do update set
    interviewer_ids  = excluded.interviewer_ids,
    interviewer_id   = excluded.interviewer_id,
    interviewer_name = excluded.interviewer_name,
    scheduled_on     = excluded.scheduled_on,
    status           = 'scheduled',
    held_at          = null;
end $$;
grant execute on function public.fms_hr_schedule_interview(uuid, integer, uuid[], text, date) to authenticated;
