-- ===========================================================================
-- HR RECRUITMENT FMS — THE STAGE VIEW: edit-until-next-step.
--
-- Every step screen becomes a stage view — the existing "Pending & Overdue"
-- work-list, joined by a "Completed" tab ("what I did here", Mine/All) where a
-- completed entry stays EDITABLE UNTIL THE NEXT STEP IS DONE, then locks. This
-- migration is the server half: the attribution columns the Completed tab reads,
-- and the guards that make the lock real (the greyed button is not security).
--
-- PHASE 1 covers the five TABLE-based queue screens only (approvals, job posting,
-- interviews, onboarding, probation). The four board-only candidate steps
-- (hr_shortlist / hod_share / hod_shortlist / final_decision) are a later phase.
--
-- Ported from the HR Exit migration 20260720120000, which established the shape:
-- `edited_at`/`edited_by` named apart from `updated_at` (a `set_updated_at`
-- trigger already bumps that on every write, so it cannot date an edit);
-- coalesce-protected first-writer attribution; every edit path re-checks the lock
-- server-side. HR Recruitment has FOUR entities (requisition / candidate /
-- onboarding / probation) rather than Exit's single case, so the machinery spans
-- more tables — but the rule is the same everywhere.
--
-- ── THE LOCK RULE, PER STEP (every boundary is mechanical, not taste) ─────────
--   hr_head_approval   editable while status = 'mgmt_review'   ← the three approval
--   mgmt_approval      editable while status = 'posting'         steps lock themselves
--   job_posting        editable while status = 'sourcing' ∧      (their create RPCs gate
--                        no candidate uploaded yet                on status), so the NEW
--                        — these are the only edit path and       update fns below are the
--                          carry the guard.                        only way to edit them.
--   interview rounds   editable while the card is STILL at that round — i.e. only an
--                        on_hold / no_show result (selected/rejected advance the card
--                        in the same call and lock instantly). Hardened in place.
--   onboarding         view-only once complete_at is set (joined); the edit window is
--                        while pending, which set_onboarding_date / set_offer_status /
--                        set_employee_code already allow. Hardened in place (attribution).
--   probation reviews  m1/m2/m3/m4 editable (re-record) until the decision — outcome
--                        for m1-3, final_status for m4. Hardened in place (attribution).
--   probation decision the 3-month 'extend' outcome is the ONLY non-terminal decision
--                        (approve/reject and the extension decision set final_status in
--                        the same call → terminal, view-only). ← NEW update fn, extend
--                        editable until a month-4 review is recorded.
--
-- Absolute bar on every step: the requisition is cancelled / closed / rejected /
-- on_hold. The onboarding/probation of a person who already joined is NOT gated on
-- the vacancy (a hire is a person, not a plan), matching the existing RPCs.
--
-- ── ATTRIBUTION (who did it — the Completed tab's "By") ──────────────────────
-- Actor columns already exist for: hr_head_approval (hr_approver_id), mgmt_approval
-- (mgmt_approver_id), probation reviews (reviewer_id), probation decision
-- (outcome_by / extension_outcome_by), checklist items (done_by). This migration
-- ADDS the ones that were missing so Completed→Mine works on the Phase-1 screens:
-- posted_by (requisition), result_recorded_by (interview), joining_date_by /
-- offer_decided_by / employee_code_by (onboarding). Old rows have no actor → they
-- read "Not recorded" and sit under All, never Mine. NOT backfilled — a guessed
-- actor is worse than an honest blank.
--
-- Purely ADDITIVE. New columns + `create or replace` on existing functions. No
-- table, column or row is dropped or mutated. Reverses by dropping the new columns
-- and the three new functions, and restoring the five hardened RPCs from their
-- prior migrations (…130000 / 160000 / 170000 / 190000 / 716130000).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE MISSING ATTRIBUTION + EDIT-AUDIT COLUMNS.
-- ---------------------------------------------------------------------------

-- The requisition header. posted_by was the one missing actor; edited_at/by is
-- shared by the three sequential approval steps — the requisition is in exactly
-- one of them at a time, so at most one edit window is ever open.
alter table public.fms_hr_requisitions
  add column if not exists posted_by uuid references auth.users on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users on delete set null;

comment on column public.fms_hr_requisitions.edited_at is
  'When a COMPLETED approval step (HR approval / Mgmt approval / job posting) was last corrected via the Completed-tab update RPCs. Distinct from updated_at (bumped by set_updated_at on every write) — named edited_* for exactly that reason. Null until a correction is made.';

-- The interview satellite. interviewer_id ("who conducted") and created_by ("who
-- booked") exist; result_recorded_by ("who recorded the outcome") was missing.
alter table public.fms_hr_interviews
  add column if not exists result_recorded_by uuid references auth.users on delete set null,
  add column if not exists edited_at          timestamptz,
  add column if not exists edited_by          uuid references auth.users on delete set null;

-- The onboarding header. The sub-event recorders were never captured.
alter table public.fms_hr_onboardings
  add column if not exists joining_date_by  uuid references auth.users on delete set null,
  add column if not exists offer_decided_by uuid references auth.users on delete set null,
  add column if not exists employee_code_by uuid references auth.users on delete set null,
  add column if not exists edited_at        timestamptz,
  add column if not exists edited_by        uuid references auth.users on delete set null;

-- The probation header — edited_* for a correction to the 'extend' decision. The
-- decision actors (outcome_by / extension_outcome_by) already exist.
alter table public.fms_hr_probations
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users on delete set null;

-- The probation-review satellite — edited_* for a re-recorded monthly review.
-- reviewer_id already carries "who reviewed".
alter table public.fms_hr_probation_reviews
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users on delete set null;

-- ---------------------------------------------------------------------------
-- 2. THREE NEW UPDATE FUNCTIONS — the steps whose create RPC hard-refuses once
--    advanced. Divergence from the create twin, deliberate and matching Exit: an
--    edit that KEEPS the decision leaves the original actor + timestamp untouched
--    and records the corrector in edited_*; only a flip takes a new actor.
-- ---------------------------------------------------------------------------

-- fms_hr_update_decide_mrf — correct an APPROVAL (its remark), or FLIP it to a
-- rejection / send-back, while the NEXT gate has not acted. The HR-Head approval
-- is editable while the requisition sits at 'mgmt_review'; the Management approval
-- while it sits at 'posting'. Reject / send_back are terminal / returned states,
-- so only a completed APPROVAL is editable here.
create or replace function public.fms_hr_update_decide_mrf(
  p_req      uuid,
  p_stage    text,
  p_decision text,
  p_remarks  text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_step   text;
begin
  if p_stage not in ('hr','mgmt') then raise exception 'Unknown approval stage %', p_stage; end if;
  if p_decision not in ('approve','reject','send_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  v_step := case when p_stage = 'hr' then 'hr_head_approval' else 'mgmt_approval' end;

  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  -- The edit window: the stage is DONE (approved) and the NEXT step has not acted.
  if p_stage = 'hr' and v_status <> 'mgmt_review' then
    raise exception 'The HR Head approval can no longer be edited (the requisition is %)', v_status;
  end if;
  if p_stage = 'mgmt' and v_status <> 'posting' then
    raise exception 'The Management approval can no longer be edited (the requisition is %)', v_status;
  end if;

  if not public.fms_hr_can_act(v_step, p_req, v_uid) then
    raise exception 'Not authorized to edit this approval';
  end if;
  if p_decision in ('reject','send_back') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting or sending back';
  end if;

  if p_decision = 'approve' then
    -- Keep the approval: original approver + approved_at untouched, only the remark.
    if p_stage = 'hr' then
      update public.fms_hr_requisitions set
        hr_remarks = nullif(trim(p_remarks),''), edited_at = now(), edited_by = v_uid
      where id = p_req;
    else
      update public.fms_hr_requisitions set
        mgmt_remarks = nullif(trim(p_remarks),''), edited_at = now(), edited_by = v_uid
      where id = p_req;
    end if;

  elsif p_decision = 'reject' then
    -- Flip to a rejection — terminal, taken by whoever flips it. The stage's own
    -- approval stamp is cleared (it is no longer approved).
    update public.fms_hr_requisitions set
      status = 'rejected', rejected_at = now(), reject_reason = trim(p_remarks), decided_by = v_uid,
      hr_approved_at   = case when p_stage = 'hr'   then null else hr_approved_at end,
      mgmt_approved_at = case when p_stage = 'mgmt' then null else mgmt_approved_at end,
      current_step = v_step, edited_at = now(), edited_by = v_uid
    where id = p_req;

  else -- send_back
    update public.fms_hr_requisitions set
      status = 'sent_back', sent_back_at = now(), sent_back_reason = trim(p_remarks), decided_by = v_uid,
      hr_approved_at   = case when p_stage = 'hr'   then null else hr_approved_at end,
      mgmt_approved_at = case when p_stage = 'mgmt' then null else mgmt_approved_at end,
      current_step = 'mrf_resubmit', edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;
end $$;
grant execute on function public.fms_hr_update_decide_mrf(uuid, text, text, text) to authenticated;

-- fms_hr_update_post_job — correct the platforms / posting date while the job is
-- posted but no candidate has been added yet (status 'sourcing' with an empty
-- pipeline). Once a CV lands the posting is history and locks.
create or replace function public.fms_hr_update_post_job(
  p_req          uuid,
  p_platform_ids uuid[],
  p_posted_on    date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_on     date := coalesce(p_posted_on, current_date);
  v_cands  integer;
  pid      uuid;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'sourcing' then
    raise exception 'The job posting can no longer be edited (the requisition is %)', v_status;
  end if;

  select count(*) into v_cands from public.fms_hr_candidates where requisition_id = p_req;
  if v_cands > 0 then
    raise exception 'Candidates have already been added — the job posting can no longer be edited';
  end if;

  if not public.fms_hr_can_act('job_posting', p_req, v_uid) then
    raise exception 'Not authorized to edit the job posting';
  end if;
  if p_platform_ids is null or cardinality(p_platform_ids) = 0 then
    raise exception 'Pick at least one platform the job was posted on';
  end if;

  delete from public.fms_hr_requisition_platforms where requisition_id = p_req;
  foreach pid in array p_platform_ids loop
    insert into public.fms_hr_requisition_platforms (requisition_id, platform_id, posted_on)
    values (p_req, pid, v_on)
    on conflict do nothing;
  end loop;

  -- posted_by stays the original poster (coalesce — old rows have no actor); the
  -- corrector lands in edited_*. posted_at (the STEP-completed stamp) is untouched.
  update public.fms_hr_requisitions set
    posted_on = v_on, edited_at = now(), edited_by = v_uid
  where id = p_req;
end $$;
grant execute on function public.fms_hr_update_post_job(uuid, uuid[], date) to authenticated;

-- fms_hr_update_probation_decision — the only editable probation decision is a
-- 3-month 'extend' (approve/reject set final_status in the same call → terminal).
-- Editable while final_status is null AND no month-4 review has yet been recorded
-- (a recorded M4 means the extension is in progress; re-opening it would strand
-- that review). Keep-extend edits the remark; a flip to approve/reject concludes
-- it exactly as fms_hr_decide_probation would, requiring the permanent details.
create or replace function public.fms_hr_update_probation_decision(
  p_probation      uuid,
  p_decision       text,
  p_remarks        text default '',
  p_permanent_from date default null,
  p_employee_code  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_outcome text;
  v_final   text;
begin
  if p_decision not in ('approve','reject','extend') then
    raise exception 'Unknown probation decision %', p_decision;
  end if;

  select requisition_id, outcome, final_status
    into v_req, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_outcome is distinct from 'extended' or v_final is not null then
    raise exception 'This three-month decision can no longer be edited';
  end if;
  if exists (
    select 1 from public.fms_hr_probation_reviews r
     where r.probation_id = p_probation and r.month = 4
  ) then
    raise exception 'The month-4 review has already been recorded — the extension decision can no longer be re-opened';
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'extend' then
    -- Keep the extension: original outcome_by / outcome_at untouched, only the remark.
    update public.fms_hr_probations set
      outcome_remarks = nullif(trim(p_remarks), ''), edited_at = now(), edited_by = v_uid
    where id = p_probation;

  elsif p_decision = 'approve' then
    if p_permanent_from is null then raise exception 'Give the date this person becomes permanent'; end if;
    if coalesce(trim(p_employee_code), '') = '' then raise exception 'Give the final employee ID'; end if;
    update public.fms_hr_probations set
      outcome = 'approved', outcome_by = v_uid, outcome_remarks = nullif(trim(p_remarks), ''),
      final_status = 'approved', final_status_at = now(),
      permanent_from = p_permanent_from, employee_code = trim(p_employee_code),
      edited_at = now(), edited_by = v_uid
    where id = p_probation;

  else -- reject
    if coalesce(trim(p_remarks), '') = '' then raise exception 'Say why probation was not cleared'; end if;
    update public.fms_hr_probations set
      outcome = 'rejected', outcome_by = v_uid, outcome_remarks = trim(p_remarks),
      final_status = 'rejected', final_status_at = now(),
      edited_at = now(), edited_by = v_uid
    where id = p_probation;
  end if;
end $$;
grant execute on function public.fms_hr_update_probation_decision(uuid, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. HARDENED record_interview_result — body from 20260716130000 VERBATIM, plus:
--      • result_recorded_by (coalesce-first) on the interview row;
--      • edited_* on a RE-record (the round already had a held_at).
--    Editability is unchanged: the create RPC already refuses once the card has
--    left the round (v_stage <> v_want), so selected/rejected lock instantly and
--    only on_hold / no_show remain re-recordable.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. HARDENED set_onboarding_date — body from 20260712160000 VERBATIM, plus
--    joining_date_by (coalesce-first) + edited_* on a re-set (joining_date was
--    already set). The `if count = 0` checklist seed is UNCHANGED.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_set_onboarding_date(p_onb uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_req    uuid;
  v_status text;
  v_done   timestamptz;
  v_prev   date;
  v_seeded integer;
begin
  if p_date is null then raise exception 'A joining date is required'; end if;

  select requisition_id, offer_status, completed_at, joining_date
    into v_req, v_status, v_done, v_prev
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_status in ('declined','no_show') then
    raise exception 'This candidate did not join — the onboarding no longer applies';
  end if;
  if v_done is not null then
    raise exception 'This onboarding is already complete';
  end if;

  update public.fms_hr_onboardings set
    joining_date = p_date, joining_date_set_at = now(),
    joining_date_by = coalesce(joining_date_by, v_uid),
    edited_at = case when v_prev is not null then now() else edited_at end,
    edited_by = case when v_prev is not null then v_uid else edited_by end
  where id = p_onb;

  select count(*) into v_seeded from public.fms_hr_onboarding_checks where onboarding_id = p_onb;
  if v_seeded = 0 then
    insert into public.fms_hr_onboarding_checks (
      onboarding_id, item_id, item_key, name, description,
      requires_file, allows_link, due_days, sort_order
    )
    select p_onb, i.id, i.key, i.name, i.description,
           i.requires_file, i.allows_link, i.due_days, i.sort_order
      from public.fms_hr_onboarding_items i
     where i.active
     order by i.sort_order, i.name
    on conflict (onboarding_id, item_key) do nothing;
  end if;
end $$;
grant execute on function public.fms_hr_set_onboarding_date(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. HARDENED set_offer_status — body from 20260712160000 VERBATIM, plus
--    offer_decided_by (coalesce-first) + edited_* on a re-decision.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_set_offer_status(p_onb uuid, p_status text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_cand  uuid;
  v_done  timestamptz;
  v_prev  timestamptz;
  v_name  text;
  v_no    text;
  v_seats integer;
begin
  if p_status not in ('accepted','declined','no_show') then
    raise exception 'Unknown offer outcome %', p_status;
  end if;

  select requisition_id, candidate_id, completed_at, offer_decided_at
    into v_req, v_cand, v_done, v_prev
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_done is not null then
    raise exception 'This person has already joined — the offer outcome cannot be changed';
  end if;
  if p_status in ('declined','no_show') and coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the offer was not taken up';
  end if;

  update public.fms_hr_onboardings set
    offer_status        = p_status,
    offer_status_reason = case when p_status = 'accepted' then null else trim(p_reason) end,
    offer_decided_at    = now(),
    offer_decided_by    = coalesce(offer_decided_by, v_uid),
    edited_at = case when v_prev is not null then now() else edited_at end,
    edited_by = case when v_prev is not null then v_uid else edited_by end
  where id = p_onb;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.positions_required into v_no, v_seats
    from public.fms_hr_requisitions r where r.id = v_req;

  if p_status = 'accepted' then
    perform public.fms_hr_announce(
      'onboarding', p_onb, 'offer_accepted',
      coalesce(v_name, 'The candidate') || ' accepted the offer (' || coalesce(v_no, '') || ')',
      public.fms_hr_step_owner_ids('onboarding')
    );
    perform public.fms_hr_try_complete_onboarding(p_onb);
  else
    perform public.fms_hr_announce(
      'onboarding', p_onb, 'offer_' || p_status,
      coalesce(v_name, 'The candidate') || ' did not take up the offer (' || coalesce(v_no, '')
        || ') — ' || trim(p_reason) || '. The seat is open again.',
      coalesce((select r.hiring_manager_ids from public.fms_hr_requisitions r where r.id = v_req), '{}'::uuid[])
        || public.fms_hr_step_owner_ids('resume_upload')
    );
    perform public.fms_hr_sync_requisition_fill(v_req);
  end if;
end $$;
grant execute on function public.fms_hr_set_offer_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. HARDENED set_employee_code — body from 20260712160000 VERBATIM, plus
--    employee_code_by (coalesce-first) + edited_* on a re-set. (No downstream
--    lock added: an employee ID legitimately arrives after other steps.)
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_set_employee_code(p_onb uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  uuid;
  v_prev text;
begin
  select requisition_id, employee_code into v_req, v_prev
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if coalesce(trim(p_code), '') = '' then raise exception 'An employee ID is required'; end if;

  update public.fms_hr_onboardings set
    employee_code = trim(p_code), employee_code_at = now(),
    employee_code_by = coalesce(employee_code_by, v_uid),
    edited_at = case when coalesce(trim(v_prev),'') <> '' then now() else edited_at end,
    edited_by = case when coalesce(trim(v_prev),'') <> '' then v_uid else edited_by end
  where id = p_onb;
end $$;
grant execute on function public.fms_hr_set_employee_code(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. HARDENED record_probation_review — body from 20260712170000 VERBATIM, plus
--    edited_* on the on-conflict (re-record) path. reviewer_id is already
--    re-stamped there, so a corrected review already re-attributes "who".
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_record_probation_review(
  p_probation uuid,
  p_month     integer,
  p_status    text,
  p_remarks   text default '',
  p_file_path text default null,
  p_file_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_outcome text;
  v_final   text;
  v_step    text;
  v_missing integer;
  v_name    text;
  v_no      text;
begin
  if p_month is null or p_month not between 1 and 4 then
    raise exception 'A probation review is for month 1, 2, 3 or 4';
  end if;
  if p_status not in ('satisfactory','needs_improvement','unsatisfactory') then
    raise exception 'Unknown review status %', p_status;
  end if;

  select requisition_id, candidate_id, outcome, final_status
    into v_req, v_cand, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null then
    raise exception 'This probation is already % — no further reviews apply', v_final;
  end if;

  if p_month = 4 then
    if v_outcome is distinct from 'extended' then
      raise exception 'There is no month-4 review unless the probation was extended';
    end if;
  elsif v_outcome is not null then
    raise exception 'The three-month decision has already been taken — month % can no longer be reviewed', p_month;
  end if;

  select count(*) into v_missing
    from generate_series(1, p_month - 1) m
   where not exists (
     select 1 from public.fms_hr_probation_reviews r
      where r.probation_id = p_probation and r.month = m
   );
  if v_missing > 0 then
    raise exception 'Record the earlier month(s) first — % review(s) are still missing before month %', v_missing, p_month;
  end if;

  v_step := case when p_month = 4 then 'probation_extension' else 'probation_m' || p_month end;
  if not public.fms_hr_can_act(v_step, v_req, v_uid) then
    raise exception 'Not authorized to review this person — that is the hiring manager''s call';
  end if;

  insert into public.fms_hr_probation_reviews (
    probation_id, month, status, remarks, file_path, file_name, reviewed_at, reviewer_id
  ) values (
    p_probation, p_month, p_status, nullif(trim(p_remarks), ''),
    nullif(p_file_path, ''), nullif(p_file_name, ''),
    now(), v_uid
  )
  on conflict (probation_id, month) do update set
    status      = excluded.status,
    remarks     = excluded.remarks,
    file_path   = coalesce(excluded.file_path, public.fms_hr_probation_reviews.file_path),
    file_name   = coalesce(excluded.file_name, public.fms_hr_probation_reviews.file_name),
    reviewed_at = now(),
    reviewer_id = v_uid,
    edited_at   = now(),          -- a re-record IS an edit
    edited_by   = v_uid;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no into v_no from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation, 'review_m' || p_month,
    'Month-' || p_month || ' probation review recorded for ' || coalesce(v_name, 'the new hire')
      || ' — ' || replace(p_status, '_', ' ') || ' (' || coalesce(v_no, '') || ')',
    public.fms_hr_step_owner_ids('onboarding')
  );
end $$;
grant execute on function public.fms_hr_record_probation_review(uuid, integer, text, text, text, text) to authenticated;
