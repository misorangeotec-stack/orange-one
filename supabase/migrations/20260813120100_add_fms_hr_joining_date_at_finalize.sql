-- ===========================================================================
-- HR Recruitment — capture the joining date when a candidate is SELECTED.
--
-- Today the joining date is asked for twice over: you finalize someone, and then
-- someone opens Onboarding and types the date that was already agreed in the
-- conversation that produced the selection. The date is known at selection time.
-- So the finalize move now accepts it, and Onboarding reads what was set here
-- rather than asking again.
--
-- Setting it here does everything fms_hr_set_onboarding_date would have done:
-- stamps joining_date / joining_date_set_at / joining_date_by AND seeds the
-- checklist from the ACTIVE master items. That is the point — the onboarding
-- arrives already open for work instead of locked behind a date entry.
--
-- STILL OPTIONAL. Leave it blank and nothing changes: the onboarding is created
-- dateless and locked, exactly as before, and HR sets the date in Onboarding.
-- Plenty of selections happen before a start date is agreed, and forcing a
-- guessed date would poison every checklist due date computed from it.
--
-- Purely ADDITIVE — one re-issued function, no schema change. The columns it
-- writes (joining_date, joining_date_set_at from 20260712160000; joining_date_by
-- from 20260721120000) all already exist.
--
-- Reversal: re-run fms_hr_move_candidate from
--           20260716130000_add_fms_hr_telephonic_skippable.sql.
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
