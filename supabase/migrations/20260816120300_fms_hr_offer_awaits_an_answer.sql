-- ===========================================================================
-- HR Recruitment — MAKING AN OFFER IS NOT THE SAME AS IT BEING ACCEPTED.
--
-- WHAT WAS WRONG
--   20260816120000 set fms_hr_onboardings.offer_status to default 'accepted', so
--   the instant a card was dragged into Made Offer the system recorded that the
--   candidate had accepted. Nobody was ever asked. Two different facts were being
--   collapsed into one:
--
--     "we made an offer"   <- what the drag actually means
--     "they said yes"      <- what was being written
--
--   It was not a considered model. The onboarding panel's offer-outcome card had
--   been removed, and fms_hr_try_complete_onboarding refuses to complete unless it
--   reads 'accepted' — so with rows born 'pending' and no control left to change
--   them, no onboarding could ever complete. Defaulting to 'accepted' unblocked
--   joining at the cost of making the field a lie, and fms_hr_offer_acceptance
--   could then only ever report ~100%.
--
-- WHAT THIS DOES
--   Restores 'pending' as the birth state and gives the answer a place to come
--   from. An offer now sits at "awaiting answer" until somebody says otherwise:
--
--     accepted            -> the explicit action on the Made Offer card, which
--                            calls the EXISTING fms_hr_set_offer_status (it already
--                            authorises, refuses once joined, announces, and runs
--                            try_complete_onboarding).
--     declined / no_show  -> the move to Disqualified, unchanged (20260816120200).
--
-- ⚠ EXISTING ROWS ARE NOT TOUCHED. Everyone currently reading 'accepted' keeps it.
--   Those acceptances are unverified — nobody was asked — but rewriting them to
--   'pending' would invent a question HR was never posed, and would strand any
--   hire whose onboarding has already completed. History stays as it was recorded;
--   only new offers get the honest state.
--
-- ⚠ THE CHECKLIST IS NOT BLOCKED. Documents can still be collected while an offer
--   is outstanding — that is normal. What is gated is COMPLETION: joined_at, the
--   probation and the requisition close still wait on 'accepted', which is exactly
--   what try_complete_onboarding's guard was always for.
--
-- ⚠ SEATS ARE UNAFFECTED. fms_hr_seats_taken counts stage in ('finalized','hired')
--   and excludes declined/no_show, so a pending offer still holds its seat. Nobody
--   else can be offered it while the candidate is deciding.
--
-- Additive only: one default changed, one function re-issued, no data rewritten.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The birth state. Every insert site omits offer_status, so the default alone
--    covers them.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_onboardings alter column offer_status set default 'pending';

comment on table public.fms_hr_onboardings is
  'One onboarding per candidate who has been made an offer. Born pending — making the offer is not accepting it; the Made Offer card carries the explicit answer. offer_status declined/no_show releases the seat; completed_at means they actually joined, and requires acceptance first.';

-- ---------------------------------------------------------------------------
-- 2. Re-offering someone must not assert an answer either.
--
--    The finalize branch upserts the onboarding, and its ON CONFLICT arm reset a
--    previously-declined row to 'accepted'. The reset itself is right — offering
--    again must not inherit the old verdict — but the value was wrong: a re-offer
--    is a fresh question, so it resets to 'pending'.
--
-- ⚠ THIS BODY WAS TAKEN FROM THE LIVE DATABASE (pg_get_functiondef), not from the
--   last migration file that happens to contain the function. 20260812120100
--   records why: a function repaired in place has no canonical source in the repo,
--   and re-issuing it from a stale file silently reverts the repair. The live body
--   and the repo text had already diverged in comments here. Only the one
--   assignment below differs from what is running.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fms_hr_move_candidate(p_id uuid, p_to_stage text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_outcome    text;
  v_reason_txt text;
begin
  select c.requisition_id, c.stage into v_req, v_from
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_from = p_to_stage then return; end if;

  select status, positions_required into v_req_status, v_seats
    from public.fms_hr_requisitions where id = v_req for update;
  if v_req_status in ('on_hold','cancelled','closed') and p_to_stage <> 'hired' then
    raise exception 'This requisition is % — candidates cannot be moved', v_req_status;
  end if;

  v_to_step   := public.fms_hr_stage_step(p_to_stage);
  v_pending   := public.fms_hr_pending_step(v_from);
  v_from_rank := public.fms_hr_stage_rank(v_from);
  v_to_rank   := public.fms_hr_stage_rank(p_to_stage);

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

  if p_to_stage = 'disqualified' then
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

  if v_to_rank < v_from_rank then
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — their onboarding is complete and cannot be undone by moving the card';
      end if;
      -- A CORRECTION, not an outcome: the offer should not have gone out.
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

    delete from public.fms_hr_interviews
     where candidate_id = p_id and round > greatest(-1, v_to_rank - 5);
  end if;

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
    v_round := case p_to_stage when 'telephonic' then 0
                               else substring(p_to_stage from 'interview_(\d)')::integer end;

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

    -- DO UPDATE, not DO NOTHING: an earlier offer may have been declined and that
    -- row deliberately kept. Offering again must not inherit the old verdict —
    -- and must not assert a new one either. A re-offer is a fresh question, so it
    -- resets to 'pending' and waits for the same answer as any other offer.
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
    on conflict (candidate_id) do update set
      requisition_id      = excluded.requisition_id,
      joining_date        = coalesce(excluded.joining_date, public.fms_hr_onboardings.joining_date),
      joining_date_set_at = coalesce(excluded.joining_date_set_at, public.fms_hr_onboardings.joining_date_set_at),
      joining_date_by     = coalesce(excluded.joining_date_by, public.fms_hr_onboardings.joining_date_by),
      offer_status        = 'pending',
      offer_status_reason = null,
      offer_decided_at    = null,
      offer_decided_by    = null
    returning id into v_onb;

    if v_onb is null then
      select id into v_onb from public.fms_hr_onboardings where candidate_id = p_id;
    end if;

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
    select o.completed_at into v_done
      from public.fms_hr_onboardings o where o.candidate_id = p_id;
    if v_done is null then
      raise exception 'Their onboarding is not complete yet — the offer must be accepted and every checklist item ticked before they can be marked hired';
    end if;

    update public.fms_hr_candidates set stage = 'hired' where id = p_id;

  elsif p_to_stage = 'disqualified' then
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — mark them hired, or record a did-not-join on the onboarding screen';
      end if;

      -- THE OUTCOME, KEPT. The seat is freed either way (fms_hr_seats_taken excludes
      -- declined/no_show), and this is the only record the acceptance rate reads.
      v_outcome := lower(coalesce(nullif(trim(p->>'offer_outcome'), ''), 'declined'));
      if v_outcome not in ('declined','no_show') then
        raise exception 'Unknown offer outcome % — expected declined or no_show', v_outcome;
      end if;

      v_reason_txt := nullif(trim(p->>'disqualification_note'), '');
      if v_reason_txt is null then
        select d.name into v_reason_txt
          from public.fms_hr_disqualification_reasons d
         where d.id = nullif(p->>'disqualification_reason_id','')::uuid;
      end if;
      v_reason_txt := coalesce(v_reason_txt, 'The offer was not taken up');

      update public.fms_hr_onboardings set
        offer_status        = v_outcome,
        offer_status_reason = v_reason_txt,
        offer_decided_at    = now(),
        offer_decided_by    = coalesce(offer_decided_by, v_uid)
      where candidate_id = p_id;
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
end $function$;

commit;
