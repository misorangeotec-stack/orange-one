-- ===========================================================================
-- HR Recruitment FMS — fix who may disqualify, and who may undo a misdrop.
--
-- THE BUG (caught driving the board end-to-end as real users):
--   The HOD could not disqualify a candidate they were actively reviewing, and
--   the Director could not push a card back to correct their own misdrop.
--
-- THE CAUSE:
--   `fms_hr_stage_step(stage)` answers "which step MOVED a card INTO this column".
--   That is the right question for a FORWARD move (to enter 'hod_shortlisted' you
--   must own `hod_shortlist`). It is the WRONG question for authorizing action on a
--   card that is already sitting somewhere: a card in 'shared_with_hod' was put
--   there by HR, but the person RESPONSIBLE for it now is the HOD, who owes it a
--   `hod_shortlist` decision.
--
-- THE FIX — a second, distinct primitive:
--   fms_hr_pending_step(stage) = the step that moves a card OUT of this column,
--   i.e. whose work-item it currently is. (This is also exactly the mapping
--   lib/queues.ts uses to compute the card's due date, so the two now agree.)
--
--   • forward     → must own the TARGET stage's step        (unchanged)
--   • backward    → must own the card's PENDING step, or the target's step.
--                   Whoever is responsible for the card can push it back.
--   • disqualify  → must own the card's PENDING step, or Final Decision.
--                   Anyone actively handling the candidate can drop them.
--
-- Also: validate the transition BEFORE authorization, so a two-column jump says
-- "one column at a time" instead of a misleading "not authorized".
--
-- Purely a function replacement. Reversal: re-run 20260712140000's definition.
-- ===========================================================================

-- The step a card in this column is WAITING ON — whose work-item it is.
-- Keep in step with STAGE_PENDING_STEP in lib/queues.ts.
create or replace function public.fms_hr_pending_step(p_stage text)
returns text
language sql
immutable
as $$
  select case p_stage
    when 'resume_uploaded'  then 'hr_shortlist'    -- HR must screen this CV
    when 'hr_shortlisted'   then 'hod_share'       -- HR must send it to the HOD
    when 'shared_with_hod'  then 'hod_shortlist'   -- the HOD must decide
    when 'hod_shortlisted'  then 'interview_1'     -- Round 1 must be booked
    when 'interview_1'      then 'interview_1'     -- Round 1 must be conducted
    when 'interview_2'      then 'interview_2'
    when 'interview_3'      then 'interview_3'
    when 'final_decision'   then 'final_decision'
    else null                                       -- finalized / disqualified: closed
  end;
$$;
grant execute on function public.fms_hr_pending_step(text) to authenticated;

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

  -- ---- 1. Is this transition legal at all? (checked FIRST, for a clear error) --
  if p_to_stage <> 'disqualified' and v_to_rank > v_from_rank and v_to_rank <> v_from_rank + 1 then
    raise exception 'A candidate must move one column at a time (% → %)', v_from, p_to_stage;
  end if;
  if v_from in ('finalized','disqualified') and v_to_rank >= v_from_rank then
    raise exception 'This candidate is already %', v_from;
  end if;

  -- ---- 2. May this person do it? -----------------------------------------
  if p_to_stage = 'disqualified' then
    -- Whoever is actively handling the candidate can drop them — not only the
    -- Final Decision owner. This is what the HOD needs when reviewing shared CVs.
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act('final_decision', v_req, v_uid)) then
      raise exception 'Not authorized to disqualify this candidate';
    end if;

  elsif v_to_rank < v_from_rank then
    -- Undoing a misdrop: the person responsible for the card right now may push it
    -- back, as may whoever owns the column it is going back to.
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
  -- A stale timestamp would keep a due date anchored to something that was taken
  -- back, so the board would quietly lie about what is overdue.
  if v_to_rank < v_from_rank then
    update public.fms_hr_candidates set
      hr_shortlisted_at = case when v_to_rank < 2 then null else hr_shortlisted_at end,
      hr_shortlisted_by = case when v_to_rank < 2 then null else hr_shortlisted_by end,
      shared_to_hod_at  = case when v_to_rank < 3 then null else shared_to_hod_at end,
      shared_to_hod_by  = case when v_to_rank < 3 then null else shared_to_hod_by end,
      hod_decided_at    = case when v_to_rank < 4 then null else hod_decided_at end,
      hod_decided_by    = case when v_to_rank < 4 then null else hod_decided_by end,
      interview1_at     = case when v_to_rank < 5 then null else interview1_at end,
      interview2_at     = case when v_to_rank < 6 then null else interview2_at end,
      interview3_at     = case when v_to_rank < 7 then null else interview3_at end,
      final_decision_at = case when v_to_rank < 8 then null else final_decision_at end,
      finalized_at = null, finalized_by = null, offered_ctc = null,
      disqualified_at = null, disqualification_reason_id = null, disqualification_note = null
    where id = p_id;
    -- Interview rounds beyond where the card is going back to no longer happened.
    delete from public.fms_hr_interviews
     where candidate_id = p_id and round > greatest(0, v_to_rank - 4);
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

  elsif p_to_stage in ('interview_1','interview_2','interview_3') then
    -- Entering a round BOOKS it. The result closes it — "scheduled" is not
    -- "conducted", and conflating them is where SLA slippage hides.
    v_round := substring(p_to_stage from 'interview_(\d)')::integer;
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
       set stage = p_to_stage, final_decision_at = now()
     where id = p_id;

  elsif p_to_stage = 'finalized' then
    if v_from <> 'final_decision' then
      raise exception 'A candidate can only be finalized from the Final Decision column';
    end if;
    select count(*) into v_taken
      from public.fms_hr_candidates
     where requisition_id = v_req and stage = 'finalized' and id <> p_id;
    if v_taken >= v_seats then
      raise exception 'All % seat(s) on this requisition are already filled', v_seats;
    end if;

    update public.fms_hr_candidates set
      stage = 'finalized', finalized_at = now(), finalized_by = v_uid,
      offered_ctc = nullif(p->>'offered_ctc','')::numeric
    where id = p_id;

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
-- RPC — schedule (or re-schedule) the round a candidate is CURRENTLY in.
--
-- Needed because a 'selected' result auto-advances the card into the next round
-- with the interview not yet booked (we cannot know who will take it). The card
-- then shows "to be scheduled", and this is what books it. `move_candidate` can't
-- do it: the card is already in that column, and a same-stage move is a no-op.
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
begin
  if p_round not between 1 and 3 then raise exception 'Round must be 1, 2 or 3'; end if;
  if p_interviewer_id is null and coalesce(trim(p_interviewer_name), '') = '' then
    raise exception 'Say who is taking this interview';
  end if;

  select requisition_id, stage into v_req, v_stage
    from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_stage <> ('interview_' || p_round) then
    raise exception 'This candidate is not in Round % (they are at %)', p_round, v_stage;
  end if;
  if not public.fms_hr_can_act('interview_' || p_round, v_req, v_uid) then
    raise exception 'Not authorized to schedule Round % for this candidate', p_round;
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
