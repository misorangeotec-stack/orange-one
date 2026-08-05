-- ===========================================================================
-- HR Recruitment — the board ends where the process ends: a HIRED column.
--
-- WHAT CHANGES
--   1. A new terminal candidate stage `hired`, above `finalized` (rank 11).
--      "Selected" is relabelled "Made Offer" on the client; the stored value
--      `finalized` is unchanged — it always meant "offer extended", which is what
--      it captures (offered CTC, joining date, and the onboarding it opens).
--   2. `hired` is an ACKNOWLEDGEMENT, never a second record of joining. The board
--      move writes the stage and NOTHING else: fms_hr_try_complete_onboarding is
--      still the one place that stamps joined_at, opens the probation and fills the
--      seat. The move is refused until that has happened, so the two cannot drift.
--   3. Made Offer is no longer terminal. Its two exits are `hired` (they joined)
--      and `disqualified` (declined / no-show), the latter voiding the onboarding
--      the finalize move opened. Both were previously impossible.
--   4. `final_decision` ("Awaiting Decision") loses its board column, so an offer
--      may now be made from any stage in the interview zone. The stage VALUE stays
--      legal and every function still understands it — nothing is dropped.
--
-- SEAT ACCOUNTING — the load-bearing fix. fms_hr_seats_taken counted
-- `stage = 'finalized'` only. Without widening it to include `hired`, marking
-- someone hired would RELEASE their seat: a one-seat vacancy would allow a second
-- candidate to be offered the same seat, and the client's reqInResumeUpload would
-- re-open the filled vacancy and demand CVs on the board, the queues, the Control
-- Center and My Work.
--
-- THE CLOSED-REQUISITION TRAP. fms_hr_move_candidate refuses every move on a
-- closed requisition. But the last hire to complete onboarding CLOSES the
-- requisition (via fms_hr_sync_requisition_fill) — so that exact candidate could
-- never be marked hired. `hired` is therefore exempt from that guard: it is not
-- pipeline movement, it is the acknowledgement of a hire that already happened.
--
-- READS ON TOP OF 20260816120000 (offer accepted at finalize). Onboardings are
-- born 'accepted' there, so the only thing standing between an offer and a hire is
-- the joining date and the checklist. Nothing here re-issues a function that one
-- touches (it re-issues fms_hr_cancel_requisition; this re-issues the board move),
-- so the two are independent — but they must not share a timestamp, hence 120100.
--
-- Purely ADDITIVE: widened CHECK, function re-issues. No column or value dropped,
-- no existing row rewritten. Ranks 1..10 are UNCHANGED — they are hard-coded
-- thresholds in the backward-clear below and in lib/board.ts's zone bounds.
--
-- Reversal: re-run fms_hr_move_candidate from 20260813120200,
-- fms_hr_record_interview_result from 20260721120000, fms_hr_seats_taken and the
-- stage helpers from 20260716130000 / 20260712160000, then narrow the CHECK.
-- ===========================================================================

-- ---- Schema: widen the enum -----------------------------------------------

alter table public.fms_hr_candidates
  drop constraint if exists fms_hr_candidates_stage_check;
alter table public.fms_hr_candidates
  add constraint fms_hr_candidates_stage_check check (stage in (
    'resume_uploaded','hr_shortlisted','shared_with_hod','hod_shortlisted',
    'telephonic','interview_1','interview_2','interview_3','final_decision',
    'finalized','hired','disqualified'));

-- ===========================================================================
-- SEAT ACCOUNTING — a hired person still occupies the seat they were offered.
-- Mirrors seatsTaken() in frontend/src/apps/hr-recruitment/lib/queues.ts.
-- ===========================================================================
create or replace function public.fms_hr_seats_taken(p_req uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.fms_hr_candidates c
    left join public.fms_hr_onboardings o on o.candidate_id = c.id
   where c.requisition_id = p_req
     and c.stage in ('finalized','hired')
     and (p_exclude is null or c.id <> p_exclude)
     and coalesce(o.offer_status, 'pending') not in ('declined','no_show');
$$;
grant execute on function public.fms_hr_seats_taken(uuid, uuid) to authenticated;

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
    when 'hired'            then 11
    else 0
  end;
$$;

-- Who owns the move INTO a stage. Marking someone hired belongs to whoever ran
-- their onboarding — the same authority that ticked the last checklist item.
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
    when 'hired'           then 'onboarding'
    when 'disqualified'    then 'final_decision'
    else 'resume_upload'
  end;
$$;

-- The step a card in this column is WAITING ON. `hired` is terminal: it owes
-- nobody anything, so it emits no queue row anywhere. `finalized` stays null for
-- the same reason it always was — the onboarding it opened carries that work, and
-- pointing this at 'onboarding' would double-count it against the candidate too.
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
-- RPC — THE BOARD MOVE (re-issue).
--
-- Body from 20260813120200 VERBATIM except:
--   • the closed/on-hold guard exempts `hired` (see the header)
--   • `hired` is a hard dead end; `finalized` is no longer terminal
--   • the skippable zone reaches rank 10, so an offer can be made from any
--     interview stage — `final_decision` is no longer a required stop-over
--   • a new `hired` branch, which writes the stage and nothing else
--   • disqualifying out of Made Offer voids the onboarding and re-syncs the fill
-- ===========================================================================
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
  v_done       timestamptz;
begin
  select c.requisition_id, c.stage into v_req, v_from
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_from = p_to_stage then return; end if;

  select status, positions_required into v_req_status, v_seats
    from public.fms_hr_requisitions where id = v_req for update;
  -- `hired` is exempt: the last hire to finish onboarding CLOSES the requisition,
  -- so gating it here would make that candidate permanently unmarkable.
  if v_req_status in ('on_hold','cancelled','closed') and p_to_stage <> 'hired' then
    raise exception 'This requisition is % — candidates cannot be moved', v_req_status;
  end if;

  v_to_step   := public.fms_hr_stage_step(p_to_stage);
  v_pending   := public.fms_hr_pending_step(v_from);
  v_from_rank := public.fms_hr_stage_rank(v_from);
  v_to_rank   := public.fms_hr_stage_rank(p_to_stage);

  -- ---- 1. Is this transition legal at all? -------------------------------
  -- Forward is normally one column at a time, BUT inside the interview zone (from
  -- hod_shortlisted rank 4 up to Made Offer rank 10) a forward jump of any distance
  -- is allowed — Telephonic and the rounds are optional, and the offer can be made
  -- as soon as whoever owns the decision is satisfied.
  if v_from = 'hired' then
    raise exception 'This person has joined — that cannot be undone by moving the card';
  end if;

  if p_to_stage = 'hired' then
    if v_from <> 'finalized' then
      raise exception 'Only a candidate who has been made an offer can be marked hired';
    end if;
  elsif p_to_stage <> 'disqualified' and v_to_rank > v_from_rank then
    if not (v_to_rank = v_from_rank + 1
            or (v_from_rank >= 4 and v_to_rank <= 10)) then
      raise exception 'That is not a legal forward move (% → %)', v_from, p_to_stage;
    end if;
  end if;

  if v_from = 'disqualified' and v_to_rank >= v_from_rank then
    raise exception 'This candidate is already disqualified';
  end if;

  -- ---- 2. May this person do it? -----------------------------------------
  if p_to_stage = 'disqualified' then
    -- Out of Made Offer, the onboarding owner counts too: they are the person who
    -- chases the acceptance, so they are the person who finds out it was declined.
    -- Keep this in step with canActOnCandidate() in store.tsx, or the board offers
    -- an action the server then refuses.
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act('final_decision', v_req, v_uid)
            or (v_from = 'finalized' and public.fms_hr_can_act('onboarding', v_req, v_uid))) then
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
    -- No longer reachable from the board (the column is gone), but the stage value
    -- is still legal and the RPC still honours it — nothing is dropped.
    update public.fms_hr_candidates
       set stage = p_to_stage, final_decision_at = now(),
           decision_remarks = coalesce(nullif(trim(p->>'decision_remarks'), ''), decision_remarks)
     where id = p_id;

  elsif p_to_stage = 'finalized' then
    -- The Awaiting-Decision stop-over is gone: an offer may be made from any stage
    -- in the interview zone. The legality check above is what constrains that.
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

  elsif p_to_stage = 'hired' then
    -- AN ACKNOWLEDGEMENT, NOT A RECORD. joined_at, the probation and the seat were
    -- all written by fms_hr_try_complete_onboarding at the moment the person
    -- genuinely joined. This writes the stage and nothing else, so the board and
    -- the onboarding can never tell different stories about the same person.
    select o.completed_at into v_done
      from public.fms_hr_onboardings o where o.candidate_id = p_id;
    if v_done is null then
      raise exception 'Their onboarding is not complete yet — the offer must be accepted and every checklist item ticked before they can be marked hired';
    end if;

    update public.fms_hr_candidates set stage = 'hired' where id = p_id;

  elsif p_to_stage = 'disqualified' then
    -- Out of Made Offer: the offer was declined or they never turned up, so the
    -- onboarding the finalize move opened is void and the seat goes back.
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — mark them hired, or record a did-not-join on the onboarding screen';
      end if;
      delete from public.fms_hr_onboardings where candidate_id = p_id;
    end if;

    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_reason_id = nullif(p->>'disqualification_reason_id','')::uuid,
      disqualification_note = nullif(trim(p->>'disqualification_note'), '')
    where id = p_id;

    if v_from = 'finalized' then
      perform public.fms_hr_sync_requisition_fill(v_req);
    end if;

  elsif p_to_stage = 'resume_uploaded' then
    update public.fms_hr_candidates set stage = 'resume_uploaded' where id = p_id;

  else
    raise exception 'Unknown stage %', p_to_stage;
  end if;
end $$;
grant execute on function public.fms_hr_move_candidate(uuid, text, jsonb) to authenticated;

-- ===========================================================================
-- RPC — record an interview RESULT (re-issue).
--
-- Body from 20260721120000 VERBATIM except the advance target: `final_decision`
-- is no longer offered, because the column it named is gone. Rounds 0–2 still
-- flow into the next round by default; a `selected` result on Round 3 now leaves
-- the card where it is, visibly passed. Making the offer is a deliberate move
-- that collects its own terms (agreed CTC, joining date) — an interview result
-- has nowhere to put them.
-- ===========================================================================
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
  v_prev_held  timestamptz;
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

  -- A round that already carries a held_at is being RE-recorded — an edit.
  select held_at into v_prev_held
    from public.fms_hr_interviews where candidate_id = p_id and round = p_round;

  update public.fms_hr_interviews set
    status  = p_status,
    held_at = now(),
    remarks = nullif(trim(p_remarks), ''),
    document_path = coalesce(p_doc_path, document_path),
    document_name = coalesce(p_doc_name, document_name),
    video_url     = coalesce(nullif(trim(p_video_url), ''), video_url),
    result_recorded_by = coalesce(result_recorded_by, v_uid),
    edited_at = case when v_prev_held is not null then now() else edited_at end,
    edited_by = case when v_prev_held is not null then v_uid else edited_by end
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
    -- Advance to the chosen round; default to the immediate next when none is
    -- given. Round 3 has no round after it — the card stays put.
    v_next := nullif(trim(p_next_stage), '');
    if v_next is null then
      v_next := case p_round
                  when 0 then 'interview_1'
                  when 1 then 'interview_2'
                  when 2 then 'interview_3'
                  else null end;
    end if;

    if v_next is not null then
      if v_next not in ('interview_1','interview_2','interview_3') then
        raise exception 'Invalid next stage %', v_next;
      end if;
      if public.fms_hr_stage_rank(v_next) <= public.fms_hr_stage_rank(v_stage) then
        raise exception 'The next stage must be later than the current one';
      end if;

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

comment on constraint fms_hr_candidates_stage_check on public.fms_hr_candidates is
  'Board stages. shared_with_hod and final_decision no longer have their own column on the board (the first merges into Shortlisted by HR, the second is gone) but remain legal values — nothing is dropped.';
