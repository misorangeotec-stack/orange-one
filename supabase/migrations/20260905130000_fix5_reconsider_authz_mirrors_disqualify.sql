-- FIX-5 follow-up · Reconsider authorisation must mirror DISQUALIFY, per stage.
--
-- Found by testing as a real non-admin HR user (Saloni Rathod, `employee` +
-- hr-recruitment, natural owner of resume_upload / hr_shortlist) rather than as
-- an admin. Two faults, one root cause — a FLAT authorisation check:
--
--   as shipped:  fms_hr_can_act('final_decision') OR fms_hr_can_act('hr_shortlist')
--
--   (a) TOO PERMISSIVE. The hr_shortlist owner could bring back a candidate who
--       had been dropped at Round 2, Round 3 or Final decision — stages that
--       fms_hr_move_candidate would never have let them disqualify from. It
--       restores someone into a stage the actor has no authority over.
--
--   (b) The client half was TOO RESTRICTIVE in the opposite direction, so the
--       feature was invisible to the very person it was built for. Fixed in
--       store.tsx (canReconsiderCandidate); recorded here because the two halves
--       must be read together.
--
-- The rule that fixes both: whoever could have DISQUALIFIED them from stage X
-- may bring them back TO stage X. That is the authorisation branch already in
-- fms_hr_move_candidate for p_to_stage = 'disqualified', evaluated against the
-- destination stage, so the two functions cannot disagree.
--
-- ADDITIVE / REVERSIBLE: this is a CREATE OR REPLACE of one function body. No
-- table, column, index, grant or signature changes — CREATE OR REPLACE keeps the
-- existing grants, and 20260905120001_..._rollback.sql still drops this function
-- cleanly whatever its body.

create or replace function public.fms_hr_reconsider_candidate(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $function$
declare
  v_uid        uuid := auth.uid();
  v_c          record;
  v_req_status text;
  v_to         text;
  v_old_reason text;
  v_max_round  integer;
begin
  select * into v_c from public.fms_hr_candidates where id = p_id for update;
  if v_c.id is null then raise exception 'Candidate not found'; end if;

  if v_c.stage <> 'disqualified' then
    raise exception 'Only a dropped candidate can be reconsidered — % is at %',
      v_c.name, public.fms_hr_stage_label(v_c.stage);
  end if;

  select status into v_req_status from public.fms_hr_requisitions where id = v_c.requisition_id for update;
  if v_req_status <> 'sourcing' then
    raise exception 'This vacancy is % — nobody can be brought back into play on it', v_req_status;
  end if;

  -- A declined or lapsed OFFER is not a rejection to reconsider; it is a
  -- different thing entirely, and re-offering runs through the finalized path so
  -- the seat accounting and the onboarding stay honest.
  if exists (select 1 from public.fms_hr_onboardings o where o.candidate_id = p_id) then
    raise exception 'An offer was already made to % — re-offer them from the board instead of reconsidering', v_c.name;
  end if;

  -- ⚠ The destination is computed BEFORE the authorisation check, because the
  -- check is ABOUT the destination. `interviewN_at` is stamped when a round is
  -- HELD, not when the card enters it, so a booked-but-unheld round leaves every
  -- timestamp null — the fms_hr_interviews rows are the other half of the answer.
  select max(round) into v_max_round from public.fms_hr_interviews where candidate_id = p_id;

  v_to := case
    when v_c.final_decision_at is not null                then 'final_decision'
    when v_c.interview3_at is not null or v_max_round = 3 then 'interview_3'
    when v_c.interview2_at is not null or v_max_round = 2 then 'interview_2'
    when v_c.interview1_at is not null or v_max_round = 1 then 'interview_1'
    when v_c.telephonic_at is not null or v_max_round = 0 then 'telephonic'
    when v_c.hr_shortlisted_at is not null                then 'hr_shortlisted'
    else 'resume_uploaded'
  end;

  -- Mirrors the `p_to_stage = 'disqualified'` authorisation branch of
  -- fms_hr_move_candidate, evaluated at the destination. Keep the two in step:
  -- if that branch gains an arm, this one needs the same arm.
  if not (public.fms_hr_can_act(coalesce(public.fms_hr_pending_step(v_to), 'final_decision'),
                               v_c.requisition_id, v_uid)
          or public.fms_hr_can_act('final_decision', v_c.requisition_id, v_uid)
          or (v_to = 'hr_shortlisted' and public.fms_hr_can_act('hr_shortlist', v_c.requisition_id, v_uid))
          or (v_to = 'finalized' and public.fms_hr_can_act('onboarding', v_c.requisition_id, v_uid))) then
    raise exception 'Not authorized to bring this candidate back to %', public.fms_hr_stage_label(v_to);
  end if;

  v_old_reason := nullif(btrim(v_c.disqualification_note), '');
  if v_old_reason is null and v_c.disqualification_reason_id is not null then
    select d.name into v_old_reason from public.fms_hr_disqualification_reasons d
     where d.id = v_c.disqualification_reason_id;
  end if;
  v_old_reason := coalesce(v_old_reason, 'no reason recorded');

  -- Written BEFORE the reason is cleared, or the trail loses why they were dropped.
  -- No recipient array: p_user_ids '{}' means the bell loop never runs, and the
  -- email arm covers only master_request / candidate.interview_booked|_reassigned.
  perform public.fms_hr_announce(
    'candidate', p_id, 'reconsidered',
    format('%s was brought back into play at %s. Originally dropped %s — %s.%s',
           v_c.name, public.fms_hr_stage_label(v_to),
           coalesce(to_char(v_c.disqualified_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'earlier'),
           v_old_reason,
           case when nullif(btrim(p_note), '') is not null then ' Reason: ' || btrim(p_note) else '' end),
    '{}'::uuid[],
    jsonb_build_object('from_stage','disqualified','to_stage', v_to,
                       'original_reason', v_old_reason,
                       'original_disqualified_at', v_c.disqualified_at,
                       'note', nullif(btrim(p_note), '')));

  update public.fms_hr_candidates set
    stage = v_to, disqualified_at = null,
    disqualification_reason_id = null, disqualification_note = null
  where id = p_id;
end
$function$;

grant execute on function public.fms_hr_reconsider_candidate(uuid, text) to authenticated, service_role;
