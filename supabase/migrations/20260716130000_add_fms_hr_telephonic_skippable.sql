-- ===========================================================================
-- HR Recruitment FMS — Telephonic Screening + skippable interview stages,
-- Round-2 video link, and an Awaiting-Decision remark.
--
-- WHAT CHANGES
--   1. A new candidate stage `telephonic` sits between `hod_shortlisted` and
--      `interview_1`, modelled as interview ROUND 0 in fms_hr_interviews (so the
--      whole booking / result / queue machinery is reused, not duplicated).
--   2. The four interview-type stages (telephonic, interview_1..3) are OPTIONAL:
--      inside the "zone" (rank 4..9) a forward move may jump any distance — skip
--      Telephonic, skip a round, or go straight to Awaiting Decision.
--   3. Recording a `selected` result advances the card to a CHOSEN next stage
--      (any later interview stage, or final_decision) instead of the fixed +1.
--   4. fms_hr_interviews gains `video_url` (online interviews, mostly Round 2).
--   5. fms_hr_candidates gains `telephonic_at` (the round-0 held stamp) and
--      `decision_remarks` (a free-text note captured on the Awaiting-Decision /
--      finalize move).
--
-- OWNERSHIP: `telephonic_screening` is a normal global-owner step (HR's screening
-- call). Its owner row is seeded from `interview_1` so it works out of the box; an
-- admin can reconfigure it in Setup → Step Owners. fms_hr_can_act is NOT touched.
--
-- Ranks shift because a stage was inserted:
--   resume_uploaded 1 · hr_shortlisted 2 · shared_with_hod 3 · hod_shortlisted 4 ·
--   telephonic 5 · interview_1 6 · interview_2 7 · interview_3 8 · final_decision 9 ·
--   finalized/disqualified 10.  A numbered interview round maps to rank = 5 + round.
--
-- Purely ADDITIVE (widened CHECKs, new columns, function re-issues). Reversal:
-- restore the prior function bodies and drop the two columns + video_url.
-- ===========================================================================

-- ---- Schema: widen the enums, add the columns -----------------------------

alter table public.fms_hr_candidates
  drop constraint if exists fms_hr_candidates_stage_check;
alter table public.fms_hr_candidates
  add constraint fms_hr_candidates_stage_check check (stage in (
    'resume_uploaded','hr_shortlisted','shared_with_hod','hod_shortlisted',
    'telephonic','interview_1','interview_2','interview_3','final_decision',
    'finalized','disqualified'));

alter table public.fms_hr_candidates add column if not exists telephonic_at   timestamptz;
alter table public.fms_hr_candidates add column if not exists decision_remarks text;

alter table public.fms_hr_interviews
  drop constraint if exists fms_hr_interviews_round_check;
alter table public.fms_hr_interviews
  add constraint fms_hr_interviews_round_check check (round between 0 and 3);

alter table public.fms_hr_interviews add column if not exists video_url text;

-- ---- Seed the telephonic_screening owner from interview_1 ------------------
insert into public.fms_hr_step_owners (step_key, department_ids, designation_id, employee_ids)
select 'telephonic_screening', department_ids, designation_id, employee_ids
  from public.fms_hr_step_owners where step_key = 'interview_1'
on conflict (step_key) do nothing;

-- ===========================================================================
-- Helpers — keep in step with lib/board.ts, lib/steps.ts, lib/queues.ts.
-- ===========================================================================
create or replace function public.fms_hr_stage_rank(p_stage text)
returns integer language sql immutable as $$
  select case p_stage
    when 'resume_uploaded'  then 1
    when 'hr_shortlisted'   then 2
    when 'shared_with_hod'  then 3
    when 'hod_shortlisted'  then 4
    when 'telephonic'       then 5
    when 'interview_1'      then 6
    when 'interview_2'      then 7
    when 'interview_3'      then 8
    when 'final_decision'   then 9
    when 'finalized'        then 10
    when 'disqualified'     then 10
    else 0
  end;
$$;

create or replace function public.fms_hr_stage_step(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'hr_shortlisted'  then 'hr_shortlist'
    when 'shared_with_hod' then 'hod_share'
    when 'hod_shortlisted' then 'hod_shortlist'
    when 'telephonic'      then 'telephonic_screening'
    when 'interview_1'     then 'interview_1'
    when 'interview_2'     then 'interview_2'
    when 'interview_3'     then 'interview_3'
    when 'final_decision'  then 'final_decision'
    when 'finalized'       then 'final_decision'
    when 'disqualified'    then 'final_decision'
    else 'resume_upload'
  end;
$$;

-- The step a card in this column is WAITING ON. hod_shortlisted now points at the
-- telephonic screen (the default next); the rounds beyond it are skippable.
create or replace function public.fms_hr_pending_step(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'resume_uploaded'  then 'hr_shortlist'
    when 'hr_shortlisted'   then 'hod_share'
    when 'shared_with_hod'  then 'hod_shortlist'
    when 'hod_shortlisted'  then 'telephonic_screening'
    when 'telephonic'       then 'telephonic_screening'
    when 'interview_1'      then 'interview_1'
    when 'interview_2'      then 'interview_2'
    when 'interview_3'      then 'interview_3'
    when 'final_decision'   then 'final_decision'
    else null
  end;
$$;
grant execute on function public.fms_hr_pending_step(text) to authenticated;

-- ===========================================================================
-- RPC — THE BOARD MOVE (re-issue). Adds the telephonic branch, the skippable-zone
-- transition rule, decision_remarks, and the shifted backward-clear thresholds.
-- ===========================================================================
drop function if exists public.fms_hr_move_candidate(uuid, text, jsonb);
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
    if (p->>'interviewer_id') is null and coalesce(trim(p->>'interviewer_name'), '') = '' then
      raise exception 'Say who is taking this interview';
    end if;

    insert into public.fms_hr_interviews (candidate_id, round, interviewer_id, interviewer_name, scheduled_on, status, created_by)
    values (
      p_id, v_round,
      nullif(p->>'interviewer_id','')::uuid,
      nullif(trim(p->>'interviewer_name'), ''),
      nullif(p->>'scheduled_on','')::date,
      'scheduled', v_uid
    )
    on conflict (candidate_id, round) do update set
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

    update public.fms_hr_candidates set
      stage = 'finalized', finalized_at = now(), finalized_by = v_uid,
      offered_ctc = nullif(p->>'offered_ctc','')::numeric,
      decision_remarks = coalesce(nullif(trim(p->>'decision_remarks'), ''), decision_remarks)
    where id = p_id;

    insert into public.fms_hr_onboardings (candidate_id, requisition_id, created_by)
    values (p_id, v_req, v_uid)
    on conflict (candidate_id) do nothing;

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

-- ===========================================================================
-- RPC — schedule (re-issue). Round 0 (telephonic) allowed; the expected stage and
-- the authorization step both special-case it.
-- ===========================================================================
drop function if exists public.fms_hr_schedule_interview(uuid, integer, uuid, text, date);
create or replace function public.fms_hr_schedule_interview(
  p_id               uuid,
  p_round            integer,
  p_interviewer_id   uuid default null,
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
begin
  if p_round not between 0 and 3 then raise exception 'Round must be 0 (telephonic), 1, 2 or 3'; end if;
  if p_interviewer_id is null and coalesce(trim(p_interviewer_name), '') = '' then
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

  insert into public.fms_hr_interviews (candidate_id, round, interviewer_id, interviewer_name, scheduled_on, status, created_by)
  values (p_id, p_round, p_interviewer_id, nullif(trim(p_interviewer_name), ''), p_scheduled_on, 'scheduled', v_uid)
  on conflict (candidate_id, round) do update set
    interviewer_id   = excluded.interviewer_id,
    interviewer_name = excluded.interviewer_name,
    scheduled_on     = excluded.scheduled_on,
    status           = 'scheduled',
    held_at          = null;
end $$;
grant execute on function public.fms_hr_schedule_interview(uuid, integer, uuid, text, date) to authenticated;

-- ===========================================================================
-- RPC — record an interview RESULT (re-issue). Round 0 allowed; `video_url`
-- captured; on `selected` the card advances to a CHOSEN next stage (a later
-- interview stage, or final_decision) — the rounds are optional.
-- ===========================================================================
drop function if exists public.fms_hr_record_interview_result(uuid, integer, text, text, text, text);
drop function if exists public.fms_hr_record_interview_result(uuid, integer, text, text, text, text, text, text);
create or replace function public.fms_hr_record_interview_result(
  p_id         uuid,
  p_round      integer,
  p_status     text,
  p_remarks    text default '',
  p_doc_path   text default null,
  p_doc_name   text default null,
  p_video_url  text default null,
  p_next_stage text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_req        uuid;
  v_stage      text;
  v_want       text;
  v_step       text;
  v_next       text;
  v_next_round integer;
begin
  if p_round not between 0 and 3 then raise exception 'Round must be 0 (telephonic), 1, 2 or 3'; end if;
  if p_status not in ('selected','rejected','on_hold','no_show') then
    raise exception 'Unknown interview result %', p_status;
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
    raise exception 'Not authorized to record this round for this candidate';
  end if;

  update public.fms_hr_interviews set
    status  = p_status,
    held_at = now(),
    remarks = nullif(trim(p_remarks), ''),
    document_path = coalesce(p_doc_path, document_path),
    document_name = coalesce(p_doc_name, document_name),
    video_url     = coalesce(nullif(trim(p_video_url), ''), video_url)
  where candidate_id = p_id and round = p_round;

  if not found then
    raise exception 'That round was never scheduled for this candidate';
  end if;

  -- Stamp the round's completion on the CANDIDATE — the anchor for the next due date.
  if p_round = 0 then
    update public.fms_hr_candidates set telephonic_at = now() where id = p_id;
  elsif p_round = 1 then
    update public.fms_hr_candidates set interview1_at = now() where id = p_id;
  elsif p_round = 2 then
    update public.fms_hr_candidates set interview2_at = now() where id = p_id;
  else
    update public.fms_hr_candidates set interview3_at = now() where id = p_id;
  end if;

  if p_status = 'selected' then
    -- Advance to the chosen stage; default to the immediate next when none is given.
    v_next := nullif(trim(p_next_stage), '');
    if v_next is null then
      v_next := case p_round
                  when 0 then 'interview_1'
                  when 1 then 'interview_2'
                  when 2 then 'interview_3'
                  else 'final_decision' end;
    end if;
    if v_next not in ('interview_1','interview_2','interview_3','final_decision') then
      raise exception 'Invalid next stage %', v_next;
    end if;
    if public.fms_hr_stage_rank(v_next) <= public.fms_hr_stage_rank(v_stage) then
      raise exception 'The next stage must be later than the current one';
    end if;

    if v_next = 'final_decision' then
      update public.fms_hr_candidates set stage = 'final_decision', final_decision_at = now() where id = p_id;
    else
      v_next_round := substring(v_next from 'interview_(\d)')::integer;
      insert into public.fms_hr_interviews (candidate_id, round, status, created_by)
      values (p_id, v_next_round, 'scheduled', v_uid)
      on conflict (candidate_id, round) do nothing;
      update public.fms_hr_candidates set stage = v_next where id = p_id;
    end if;

  elsif p_status = 'rejected' then
    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_note = coalesce(nullif(trim(p_remarks), ''), 'Not selected at ' || v_want)
    where id = p_id;
  end if;
end $$;
grant execute on function public.fms_hr_record_interview_result(uuid, integer, text, text, text, text, text, text) to authenticated;
