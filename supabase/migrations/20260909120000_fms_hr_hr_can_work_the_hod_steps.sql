-- NR-4 - HR can work the seven HOD steps: hiring manager OR a named step owner.
--
-- WHY
-- When a head of department raises a vacancy, seven of its steps are locked to that
-- head - hod_shortlist, interview_2, probation_m1/m2/m3, probation_final,
-- probation_extension. HR cannot press any of them, and SETTINGS CANNOT GRANT IT.
-- The lock is double:
--
--   * Setup -> Step Owners renders those seven rows greyed, with the word
--     "Automatic" and no Edit button.
--   * and even a row inserted straight into fms_hr_step_owners would be INERT,
--     because the branch below `return`s before it ever reaches
--     fms_hr_is_step_owner(). No error, no effect. (Confirmed 09-09-2026: no such
--     row exists, so nobody has hit this yet.)
--
-- Measured on live data 09-09-2026: Saloni Rathod is `employee`, not an admin and
-- not a process coordinator. On the three live positions she is not the hiring
-- manager of, 17 real candidates sit at HOD shortlist that she cannot touch -
-- MRF-2627-0012 (6), MRF-2627-0013 (1), MRF-2627-0017 (10) - plus 1 on the ZZ TEST
-- position. MRF-2627-0017 alone went from 2 to 10 in a day. NR-3 will hand 17 more
-- positions to real heads, at which point HR loses these steps on all of them too.
--
-- THE RULE: `OR`, NEVER A SWAP - AND THAT DISTINCTION IS THE WHOLE DESIGN.
-- StepOwnersSection's own comment objects that naming people on HOD steps globally
-- "would send every department's candidates to one person, which is exactly the bug
-- this design avoids." That is a fair objection to REPLACING the hiring manager. It
-- is no objection at all to ADDING to them. The hiring manager keeps the step, keeps
-- the queue entry, keeps the bell and keeps the daily digest; a named person simply
-- gains the button as well, so HR can move a card when a head has stalled. Authority
-- and workload diverge here ON PURPOSE - the five workload sites in store.tsx and the
-- sixth in core/workspace/mywork/items/hr.ts are deliberately NOT changed.
--
-- BLAST RADIUS, MEASURED - this one line is reached by all of it.
-- Nothing in RLS calls this function (checked against pg_policies: zero matches).
-- 22 RPCs authorise through fms_hr_can_act, and every one of them lands here:
--   fms_hr_add_candidates, fms_hr_decide_extension, fms_hr_decide_mrf,
--   fms_hr_decide_probation, fms_hr_move_candidate, fms_hr_post_job,
--   fms_hr_reassign_interview, fms_hr_reconsider_candidate,
--   fms_hr_record_interview_result, fms_hr_record_probation_review,
--   fms_hr_schedule_interview, fms_hr_set_candidate_resume, fms_hr_set_employee_code,
--   fms_hr_set_interview_media, fms_hr_set_offer_status, fms_hr_set_onboarding_date,
--   fms_hr_set_requisition_jd, fms_hr_toggle_onboarding_check,
--   fms_hr_update_candidate, fms_hr_update_decide_mrf, fms_hr_update_post_job,
--   fms_hr_update_probation_decision.
--
-- !! AND A 23rd CALLER THAT DOES NOT GO THROUGH fms_hr_can_act.
--    fms_hr_reassign_step calls this function TWICE directly - once to ask whether
--    the actor may hand the step on, once to ask whether the assignee may receive it.
--    So a named HOD-step owner also becomes able to reassign a HOD step, and to be
--    handed one. Intended; recorded here so it is not later found as a surprise.
--
-- !! NOT WIDENED: `final_decision` ("Make the Offer"). It is not one of the seven, so
--    this change cannot reach it. It stays an ordinary step-owner row naming Riya
--    Kumari alone - the client's decision of 07-09-2026, and a deliberate exception
--    to "HR gets full pipeline control".
--
-- !! NAMING ANYONE ON ONE OF THESE STEPS IS A PII GRANT, and it is wider than the
--    button. fms_hr_is_recruitment_staff() is "owns any step_owners row except
--    `mrf`", and it is an arm of fms_hr_can_read_requisition(), which gates SELECT on
--    fms_hr_candidates, _candidate_scores, _interviews, _onboardings,
--    _onboarding_checks, _probations and _probation_reviews - plus
--    fms_hr_requisitions itself through the sibling fms_hr_can_view_requisition().
--    SEPARATELY, the private `fms-hr-docs` bucket is gated on
--    `fms_hr_is_coordinator OR fms_hr_is_any_step_owner`, a different pair that never
--    consults can_read() - and its read, update AND delete policies all use it, so a
--    new row also opens every CV and JD in the bucket, unscoped by requisition. For
--    Saloni this changes nothing: she already owns hr_shortlist. For anyone else it
--    is a full grant, and the Setup screen now says so in those words.
--
-- !! CHANGE ONE LIST, CHANGE THE OTHER. The `in (...)` list below and HOD_STEPS in
--    frontend/src/apps/hr-recruitment/lib/steps.ts are the same list in two
--    languages. probation_final and probation_extension were missing from the SQL
--    side until 20260712170000, which made the HOD unable to reject a CV they were
--    reviewing.
--
-- ADDITIVE ONLY. No table, column, row or policy is created, dropped or mutated. One
-- function body is replaced in place: `create or replace`, same signature, so the OID
-- and the execute grants survive (dropping would revoke them, and would orphan every
-- already-compiled caller).
--
-- REVERSAL: run 20260909120000_fms_hr_hr_can_work_the_hod_steps_rollback.sql, which
-- restores the body verbatim from 20260827150000_fms_hr_reassign_step.sql. Read the
-- warning at the top of that file first: the rollback makes named owners inert but
-- does NOT delete their fms_hr_step_owners rows, and those rows still grant the PII
-- described above.
--
-- REHEARSED ON LIVE DATA 09-09-2026: the rollback file was run inside an aborting
-- transaction with probes on both sides, and it genuinely restored the old refusal
-- before the abort put this body back.

begin;

create or replace function public.fms_hr_is_natural_step_owner(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  if p_step_key in (
    'hod_shortlist','interview_2',
    'probation_m1','probation_m2','probation_m3',
    'probation_final','probation_extension'
  ) then
    -- NR-4: no requisition in hand, so the hiring-manager arm cannot be evaluated -
    -- but the named-owner arm never needed one. Unreachable from all 23 live callers:
    -- every one of them derives p_req from a row it has already null-checked.
    if p_req is null then return public.fms_hr_is_step_owner(p_step_key, p_uid); end if;

    select hiring_manager_ids into v_managers from public.fms_hr_requisitions where id = p_req;

    -- NR-4: the OR. `v_managers is not null and ...` is kept rather than a bare
    -- `p_uid = any(v_managers)` because BOTH ARMS MUST STAY BOOLEAN-CLEAN. A null
    -- array would make the comparison NULL, `NULL or false` is NULL, and every caller
    -- tests `if not public.fms_hr_can_act(...)` - `not NULL` is NULL, so the guard
    -- would never fire and the RPC would silently authorise.
    --
    -- fms_hr_is_step_owner, NOT its __ungated twin: the gated one is exactly what this
    -- function's own tail calls, so both arms then apply the same
    -- module_can_edit(uid,'hr-recruitment') rule and a view-only user still cannot act.
    return (v_managers is not null and p_uid = any(v_managers))
        or public.fms_hr_is_step_owner(p_step_key, p_uid);
  end if;

  return public.fms_hr_is_step_owner(p_step_key, p_uid);
end $$;

comment on function public.fms_hr_is_natural_step_owner(text, uuid, uuid) is
  'Who owns this step of this requisition when nobody has been handed it - for the seven HOD/probation steps the hiring managers OR anyone named on that step in Setup (NR-4, additive: the hiring manager never loses it), the configured step owners for everything else. Deliberately excludes the admin/coordinator arm: that is authority, not ownership.';

grant execute on function public.fms_hr_is_natural_step_owner(text, uuid, uuid) to authenticated;

commit;
