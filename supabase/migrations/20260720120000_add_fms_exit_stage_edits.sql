-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — THE STAGE VIEW: edit-until-next-step.
--
-- Every step screen becomes a stage view — the existing "Pending & Overdue"
-- work-list, joined by a "Completed" tab ("what I did here", Mine/All) where a
-- completed entry stays EDITABLE UNTIL THE NEXT STEP IS DONE, then locks. This
-- migration is the server half: the attribution columns the Completed tab reads,
-- and the guards that make the lock real (the greyed button is not security).
--
-- Ported from the three purchase-family FMS apps (Purchase / Import / Office
-- Supplies), whose migrations established the shape: `edited_at`/`edited_by`
-- named apart from `updated_at` (a `set_updated_at` trigger already bumps that on
-- every write, including a stage machine's own recomputes, so it cannot date an
-- edit); coalesce-protected first-writer attribution; every edit path re-checks
-- the lock server-side.
--
-- ── THE LOCK RULE, PER STEP (every boundary is mechanical, not taste) ─────────
--   manager_review    editable while reviewed ∧ hr_verified_at null   (create RPC
--   hr_verification   editable while verified ∧ approved_at null       gates on
--   hr_head_approval  editable while approved ∧ lwd null               status, so
--                       — these three lock themselves; the NEW update fns below
--                         are the only edit path and carry the guard.)
--   lwd_confirm       editable while lwd set ∧ leave/payroll NOT done  ← NEW guard.
--                       leave & payroll are computed against the LWD and never
--                       recomputed; moving the LWD after them corrupts the F&F.
--   clearance         editable (reopen the checklist) until terminal   — no calc.
--   asset_return      VIEW-ONLY once complete — sign_assets/update_asset already
--                       refuse after the HR signature. Nothing added.
--   handover          VIEW-ONLY once complete — record_handover already refuses
--                       after HR confirm. Nothing added.
--   exit_interview    editable (record_interview upsert) until terminal — no calc.
--   leave_verification / payroll_inputs  editable while fnf_generated_at null  ← NEW
--                       guard. The F&F is computed from them and nothing recomputes
--                       it; a post-generation edit silently corrupts the settlement.
--   fnf_generate      editable while fnf_approved_at null              ← NEW guard.
--   fnf_approve       editable while fnf_paid_at null                  ← NEW guard.
--   fnf_payment       editable until terminal — release_fnf_payment already
--                       coalesce-locks fnf_paid_at and refuses on a terminal case.
--   documents         editable while archived_at null — issue_documents already
--                       refuses on the archived (terminal) status. Nothing added.
--   archive           terminal — never editable.
--
-- Absolute bar on every step: the case is withdrawn / rejected / archived /
-- on_hold, or the step is skipped. on_hold is mechanical — fms_exit_resume_status
-- derives the resume target from the very timestamps an edit touches.
--
-- ── ATTRIBUTION (who did it — the Completed tab's "By") ──────────────────────
-- Actor columns already exist for: manager_review, hr_verification,
-- hr_head_approval, asset_return (assets_hr_signed_by), handover (hr_confirmed_by),
-- clearance CHECK (done_by), fnf_approve (fnf_approved_by_id), fnf_payment
-- (fnf_paid_by_id), exit_interview (conducted_by). This migration ADDS the ones
-- that were missing so Completed→Mine works everywhere: lwd_confirmed_by,
-- clearance_completed_by, documents_issued_by, archived_by (on the wide-read
-- header) and leave_verified_by, payroll_done_by, fnf_generated_by (on the finance
-- satellite, where the numbers already live). Old rows have no actor → they read
-- "Not recorded" and sit under All, never Mine. NOT backfilled — a guessed actor
-- is worse than an honest blank.
--
-- ── WHY `create or replace` ON EXISTING RPCs IS SAFE ─────────────────────────
-- Ten workflow RPCs are re-created with their body carried forward VERBATIM plus
-- the one documented change each (a downstream-lock raise, an actor stamp, or an
-- edited_* stamp). No behaviour a caller relies on changes; the seeds inside
-- confirm_lwd keep their `if count = 0` idempotency, so re-confirming a corrected
-- LWD still moves every due date and touches no checklist/asset/document row.
--
-- Purely ADDITIVE. New columns + `create or replace` on existing functions. No
-- table, column or row is dropped or mutated. Reverses by dropping the new columns
-- and the three new functions, and restoring the ten RPCs from their prior
-- migrations (20260714130000 / 140000 / 150000 / 160000 / 170000 / 180000).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE MISSING ATTRIBUTION + EDIT-AUDIT COLUMNS.
-- ---------------------------------------------------------------------------

-- The wide-read header. lwd_confirmed_at already exists (added in M3); only the
-- actor was missing. edited_at/by is shared by the sequential header steps
-- (manager_review, hr_verification, hr_head_approval, lwd_confirm, documents) —
-- the case is in exactly one phase at a time, so at most one of their edit
-- windows is ever open, and one pair is exact.
alter table public.fms_exit_cases
  add column if not exists lwd_confirmed_by     uuid references auth.users on delete set null,
  add column if not exists clearance_completed_by uuid references auth.users on delete set null,
  add column if not exists documents_issued_by  uuid references auth.users on delete set null,
  add column if not exists archived_by          uuid references auth.users on delete set null,
  add column if not exists edited_at            timestamptz,
  add column if not exists edited_by            uuid references auth.users on delete set null;

comment on column public.fms_exit_cases.edited_at is
  'When a COMPLETED header step (manager review / HR verify / head approval / LWD / documents) was last corrected. Distinct from updated_at (bumped by set_updated_at on every write) — named edited_* for exactly that reason. Null until a correction is made.';

-- The finance satellite — the money already lives here, so the who-did-it for the
-- finance steps lives here too and inherits the same narrow RLS. edited_at/by is
-- shared across leave / payroll / generate / approve / payment: the exact who &
-- when-DONE is on each step's own actor column + header timestamp, so this shared
-- pair being the LAST corrector across the satellite is cosmetic, as intended.
alter table public.fms_exit_settlements
  add column if not exists leave_verified_by uuid references auth.users on delete set null,
  add column if not exists payroll_done_by   uuid references auth.users on delete set null,
  add column if not exists fnf_generated_by  uuid references auth.users on delete set null,
  add column if not exists edited_at         timestamptz,
  add column if not exists edited_by         uuid references auth.users on delete set null;

-- The confidential interview satellite. conducted_by already carries "who held it";
-- this is only the edit-audit pair for a correction to a recorded interview.
alter table public.fms_exit_interviews
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users on delete set null;

-- ---------------------------------------------------------------------------
-- 2. THREE NEW UPDATE FUNCTIONS — the approval steps.
--
-- Their create RPCs (manager_review / hr_verify / decide_case) gate on status and
-- so refuse once the step has advanced; these are the edit path. Divergence from
-- the create twin, deliberate and matching Office Supplies: an edit that KEEPS the
-- decision leaves the original actor + timestamp untouched and records the
-- corrector in edited_*; only a flip to reject takes a new actor + rejected_at.
-- ---------------------------------------------------------------------------

-- manager_review — correct the recommendation / remarks while HR has not verified.
create or replace function public.fms_exit_update_manager_review(
  p_case           uuid,
  p_recommendation text,
  p_remarks        text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_reviewed timestamptz;
  v_verified timestamptz;
  v_uid      uuid := auth.uid();
begin
  if p_recommendation not in ('accept','reject','discuss') then
    raise exception 'Unknown recommendation %', p_recommendation;
  end if;

  select status, manager_reviewed_at, hr_verified_at
    into v_status, v_reviewed, v_verified
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status in ('withdrawn','rejected','archived','on_hold') then
    raise exception 'This exit case is % — its manager review can no longer be edited', v_status;
  end if;
  if v_reviewed is null then
    raise exception 'The reporting manager review has not been recorded yet — there is nothing to edit';
  end if;
  if v_verified is not null then
    raise exception 'HR has already verified this case — the manager review can no longer be edited';
  end if;
  if not public.fms_exit_can_act('manager_review', p_case, v_uid) then
    raise exception 'Not authorized to edit the manager review on this exit case';
  end if;
  if p_recommendation <> 'accept' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A remark is required when the recommendation is not a plain acceptance';
  end if;

  -- The decision + timestamp stay the original's; only discussed_at follows the
  -- recommendation, and the corrector lands in edited_*.
  update public.fms_exit_cases set
    manager_recommendation = p_recommendation,
    manager_remarks        = nullif(trim(p_remarks), ''),
    discussed_at           = case when p_recommendation = 'discuss' then coalesce(discussed_at, now()) else discussed_at end,
    edited_at              = now(),
    edited_by              = v_uid
  where id = p_case;
end $$;
grant execute on function public.fms_exit_update_manager_review(uuid, text, text) to authenticated;

-- hr_verification — correct notice / policy / proposed LWD before the Head decides.
create or replace function public.fms_exit_update_hr_verify(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     text;
  v_verified   timestamptz;
  v_approved   timestamptz;
  v_uid        uuid := auth.uid();
  v_applicable boolean := coalesce((p->>'policy_applicable')::boolean, true);
  v_proposed   date := nullif(p->>'proposed_lwd','')::date;
begin
  select status, hr_verified_at, approved_at
    into v_status, v_verified, v_approved
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status in ('withdrawn','rejected','archived','on_hold') then
    raise exception 'This exit case is % — its HR verification can no longer be edited', v_status;
  end if;
  if v_verified is null then
    raise exception 'HR verification has not been recorded yet — there is nothing to edit';
  end if;
  if v_approved is not null then
    raise exception 'The HR Head has already approved this case — the verification can no longer be edited';
  end if;
  if not public.fms_exit_can_act('hr_verification', p_case, v_uid) then
    raise exception 'Not authorized to edit the HR verification on this exit case';
  end if;
  if v_proposed is null then
    raise exception 'A proposed last working day is required';
  end if;
  if not v_applicable and coalesce(trim(p->>'policy_na_reason'), '') = '' then
    raise exception 'Say why the notice policy does not apply';
  end if;

  update public.fms_exit_cases set
    notice_period_days = coalesce(nullif(p->>'notice_period_days','')::integer, notice_period_days),
    notice_waived      = coalesce((p->>'notice_waived')::boolean, notice_waived),
    policy_applicable  = v_applicable,
    policy_na_reason   = case when v_applicable then null else trim(p->>'policy_na_reason') end,
    proposed_lwd       = v_proposed,
    hr_remarks         = nullif(trim(p->>'hr_remarks'), ''),
    edited_at          = now(),
    edited_by          = v_uid
  where id = p_case;
end $$;
grant execute on function public.fms_exit_update_hr_verify(uuid, jsonb) to authenticated;

-- hr_head_approval — correct the approval remark, or FLIP an approval to a
-- rejection, while the LWD has not been confirmed. (Once confirmed the checklist,
-- assets and documents are seeded off it, so re-opening the decision would strand
-- them — hence the `lwd is null` boundary.) A reject is terminal, exactly as in
-- the create twin, so there is no reject→approve here.
create or replace function public.fms_exit_update_head_decision(
  p_case     uuid,
  p_decision text,
  p_remarks  text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_approved timestamptz;
  v_lwd      date;
  v_uid      uuid := auth.uid();
begin
  if p_decision not in ('approve','reject') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  select status, approved_at, lwd
    into v_status, v_approved, v_lwd
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status in ('withdrawn','rejected','archived','on_hold') then
    raise exception 'This exit case is % — the approval can no longer be edited', v_status;
  end if;
  if v_approved is null then
    raise exception 'This case has not been approved — there is no approval to edit';
  end if;
  if v_lwd is not null then
    raise exception 'The last working day has been confirmed and the clearance seeded — the approval can no longer be re-opened';
  end if;
  if not public.fms_exit_can_act('hr_head_approval', p_case, v_uid) then
    raise exception 'Not authorized to edit the approval on this exit case';
  end if;
  if p_decision = 'reject' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting an exit case';
  end if;

  if p_decision = 'approve' then
    -- Keep the approval: original approver + approved_at untouched; corrector in edited_*.
    update public.fms_exit_cases set
      approval_remarks = nullif(trim(p_remarks), ''),
      edited_at        = now(),
      edited_by        = v_uid
    where id = p_case;
  else
    -- Flip to a rejection — the terminal decision, taken by whoever flips it.
    update public.fms_exit_cases set
      approved_at      = null,
      approver_id      = v_uid,
      approval_remarks = nullif(trim(p_remarks), ''),
      rejected_at      = now(),
      reject_reason    = trim(p_remarks),
      status           = 'rejected',
      current_step     = 'hr_head_approval',
      edited_at        = now(),
      edited_by        = v_uid
    where id = p_case;
  end if;
end $$;
grant execute on function public.fms_exit_update_head_decision(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. HARDENED confirm_lwd — body from 20260714180000 VERBATIM, plus:
--      • the downstream guard (refuse a re-confirm once leave or payroll is done);
--      • lwd_confirmed_by (coalesce-first) + edited_* on a re-confirm.
--    The three `if count = 0` seeds are UNCHANGED — re-confirming a corrected LWD
--    still moves every due date and touches no checklist / asset / document row.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_confirm_lwd(uuid, date);
create or replace function public.fms_exit_confirm_lwd(p_case uuid, p_lwd date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_step     text;
  v_no       text;
  v_name     text;
  v_emp      uuid;
  v_mgrs     uuid[];
  v_seeded   integer;
  v_owners   uuid[];
  v_recips   uuid[];
  v_prev_lwd date;
  v_leave    timestamptz;
  v_payroll  timestamptz;
begin
  if p_lwd is null then raise exception 'A last working day is required'; end if;

  select status, current_step, exit_no, employee_name, employee_user_id, reporting_manager_ids,
         lwd, leave_verified_at, payroll_done_at
    into v_status, v_step, v_no, v_name, v_emp, v_mgrs,
         v_prev_lwd, v_leave, v_payroll
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if v_status <> 'clearance' or v_step not in ('lwd_confirm', 'clearance') then
    raise exception 'This case is not at the last-working-day step (status %, step %)', v_status, v_step;
  end if;
  if not public.fms_exit_can_act('lwd_confirm', p_case, v_uid) then
    raise exception 'Not authorized to confirm the last working day on this exit case';
  end if;

  -- ⭐ THE DOWNSTREAM LOCK. Leave/payroll are computed against the LWD and never
  --   recomputed, so moving it under them would silently corrupt the F&F. (An F&F
  --   rejection clears fnf_generated_at, not these, so the numbers are re-verified
  --   from the preparer's queue — this stays the correct bar.)
  if v_prev_lwd is not null and (v_leave is not null or v_payroll is not null) then
    raise exception 'The leave balance / payroll inputs have already been recorded against this last working day — correct or re-open those first before changing it';
  end if;

  update public.fms_exit_cases set
    lwd              = p_lwd,
    lwd_confirmed_at = now(),
    lwd_confirmed_by = coalesce(lwd_confirmed_by, v_uid),
    current_step     = 'clearance',
    -- A re-confirmation of an already-set LWD is a correction; the first one is not.
    edited_at        = case when v_prev_lwd is not null then now() else edited_at end,
    edited_by        = case when v_prev_lwd is not null then v_uid else edited_by end
  where id = p_case;

  -- ---- SEED THE CHECKLIST. (M3.) Once, from the ACTIVE master, snapshotted. ----
  select count(*) into v_seeded from public.fms_exit_clearance_checks where case_id = p_case;
  if v_seeded = 0 then
    insert into public.fms_exit_clearance_checks (
      case_id, item_id, item_key,
      name, department_label, description,
      owner_ids, owner_is_reporting_manager,
      requires_file, allows_link, due_days, sort_order, satisfied_by_step
    )
    select p_case, i.id, i.key,
           i.name, i.department_label, i.description,
           i.owner_ids, i.owner_is_reporting_manager,
           i.requires_file, i.allows_link, i.due_days, i.sort_order, i.satisfied_by_step
      from public.fms_exit_clearance_items i
     where i.active
     order by i.sort_order, i.name
    on conflict (case_id, item_key) do nothing;
  end if;

  -- ---- SEED THE ASSET LIST. (M4.) Same shape, same guard, same transaction. ----
  select count(*) into v_seeded from public.fms_exit_assets where case_id = p_case;
  if v_seeded = 0 then
    insert into public.fms_exit_assets (case_id, asset_type_id, name, sort_order)
    select p_case, t.id, t.name, t.sort_order
      from public.fms_exit_asset_types t
     where t.active
     order by t.sort_order, t.name
    on conflict (case_id, name) do nothing;
  end if;

  -- ---- SEED THE DOCUMENT LIST. (M7.) The third list, the same idiom. ----------
  perform public.fms_exit_seed_documents(p_case);

  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_owners
    from public.fms_exit_clearance_checks k,
         lateral unnest(
           case when cardinality(k.owner_ids) > 0 then k.owner_ids
                else public.fms_exit_step_owner_ids('clearance') end
         ) u
   where k.case_id = p_case;

  v_recips := coalesce(v_owners, '{}'::uuid[])
            || coalesce(v_mgrs, '{}'::uuid[])
            || case when v_emp is null then '{}'::uuid[] else array[v_emp] end;

  perform public.fms_exit_announce(
    'case', p_case, 'lwd_confirmed',
    v_no || ' — the last working day for ' || v_name || ' is ' || to_char(p_lwd, 'DD-MM-YYYY')
         || '. The clearance checklist is now open.',
    v_recips,
    jsonb_build_object('exit_no', v_no, 'lwd', p_lwd)
  );
end $$;
grant execute on function public.fms_exit_confirm_lwd(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. HARDENED try_complete_clearance — body from 20260714140000 VERBATIM, plus
--    clearance_completed_by (the person whose tick completed the list; cleared
--    with the stamp when a row is re-opened). auth.uid() is the ticker: this runs
--    inside the toggle / NA RPC.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_try_complete_clearance(p_case uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_done    timestamptz;
  v_no      text;
  v_name    text;
  v_total   integer;
  v_settled integer;
begin
  select status, clearance_completed_at, exit_no, employee_name
    into v_status, v_done, v_no, v_name
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then return; end if;

  select count(*), count(*) filter (where done or not_applicable)
    into v_total, v_settled
    from public.fms_exit_clearance_checks where case_id = p_case;

  if v_total = 0 then return; end if;

  if v_settled < v_total then
    if v_done is not null then
      update public.fms_exit_cases set
        clearance_completed_at = null,
        clearance_completed_by = null
      where id = p_case;
    end if;
    return;
  end if;

  if v_done is not null then return; end if;

  update public.fms_exit_cases set
    clearance_completed_at = now(),
    clearance_completed_by = v_uid
  where id = p_case;

  perform public.fms_exit_announce(
    'case', p_case, 'clearance_completed',
    v_no || ' — every department has cleared ' || v_name || '.',
    public.fms_exit_step_owner_ids('hr_verification')
      || public.fms_exit_step_owner_ids('payroll_inputs'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_try_complete_clearance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. HARDENED verify_leave — body from 20260714170000 VERBATIM, plus:
--      • the downstream guard (refuse once the F&F has been generated);
--      • leave_verified_by (coalesce-first) + edited_* on a correction.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_verify_leave(uuid, jsonb);
create or replace function public.fms_exit_verify_leave(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_status     text;
  v_lwd        date;
  v_no         text;
  v_prev       timestamptz;
  v_generated  timestamptz;
  v_balance    numeric(6,2);
  v_lwp        numeric(6,2);
  v_encashable numeric(6,2);
begin
  select status, lwd, exit_no, leave_verified_at, fnf_generated_at
    into v_status, v_lwd, v_no, v_prev, v_generated
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('leave_verification', p_case, v_uid) then
    raise exception 'Not authorized to verify the leave balance on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its leave verification no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the leave balance is only final once they stop accruing';
  end if;
  -- ⭐ THE DOWNSTREAM LOCK. The F&F is computed from the leave balance and nothing
  --   recomputes it; a rejection clears fnf_generated_at, which re-opens this.
  if v_generated is not null then
    raise exception 'The full & final has already been generated from this leave balance — send the F&F back first if the leave needs correcting';
  end if;

  v_balance    := nullif(p->>'leave_balance_days', '')::numeric(6,2);
  v_lwp        := nullif(p->>'lwp_days', '')::numeric(6,2);
  v_encashable := nullif(p->>'encashable_days', '')::numeric(6,2);

  if coalesce(v_balance, 0) < 0 or coalesce(v_lwp, 0) < 0 or coalesce(v_encashable, 0) < 0 then
    raise exception 'Leave days cannot be negative';
  end if;
  if v_encashable is not null and v_balance is not null and v_encashable > v_balance then
    raise exception 'The encashable days (%) cannot exceed the leave balance (%)', v_encashable, v_balance;
  end if;

  insert into public.fms_exit_settlements (
    case_id, leave_balance_days, lwp_days, encashable_days, leave_remarks, leave_verified_by
  ) values (
    p_case, v_balance, v_lwp, v_encashable, nullif(trim(p->>'leave_remarks'), ''), v_uid
  )
  on conflict (case_id) do update set
    leave_balance_days = excluded.leave_balance_days,
    lwp_days           = excluded.lwp_days,
    encashable_days    = excluded.encashable_days,
    leave_remarks      = excluded.leave_remarks,
    leave_verified_by  = coalesce(public.fms_exit_settlements.leave_verified_by, excluded.leave_verified_by);

  update public.fms_exit_cases set
    leave_verified_at = coalesce(leave_verified_at, now())
  where id = p_case;

  -- A correction (the step was already done) records the corrector on the satellite.
  if v_prev is not null then
    update public.fms_exit_settlements set edited_at = now(), edited_by = v_uid where case_id = p_case;
  end if;

  perform public.fms_exit_announce(
    'settlement', p_case, 'leave_verified',
    'Leave balance verified for ' || v_no || '.',
    public.fms_exit_step_owner_ids('payroll_inputs'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_verify_leave(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. HARDENED record_payroll_inputs — body from 20260714170000 VERBATIM, plus
--    the F&F-generated guard, payroll_done_by (coalesce-first), edited_* on edit.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_record_payroll_inputs(uuid, jsonb);
create or replace function public.fms_exit_record_payroll_inputs(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    text;
  v_lwd       date;
  v_no        text;
  v_prev      timestamptz;
  v_generated timestamptz;
  v_lines     jsonb;
  v_line      jsonb;
  v_head      uuid;
  v_name      text;
  v_kind      text;
  v_i         integer := 0;
begin
  select status, lwd, exit_no, payroll_done_at, fnf_generated_at
    into v_status, v_lwd, v_no, v_prev, v_generated
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('payroll_inputs', p_case, v_uid) then
    raise exception 'Not authorized to record the payroll inputs on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its payroll inputs no longer apply', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the payroll cut-off is derived from it';
  end if;
  -- ⭐ THE DOWNSTREAM LOCK. Same reason as verify_leave — the F&F consumes these.
  if v_generated is not null then
    raise exception 'The full & final has already been generated from these payroll inputs — send the F&F back first if they need correcting';
  end if;

  insert into public.fms_exit_settlements (
    case_id, lwp_completed, notice_recovery_days, notice_recovery_amount,
    incentive_amount, loan_recovery_amount, other_deductions, payroll_remarks, payroll_done_by
  ) values (
    p_case,
    coalesce((p->>'lwp_completed')::boolean, false),
    nullif(p->>'notice_recovery_days', '')::numeric(6,2),
    nullif(p->>'notice_recovery_amount', '')::numeric(12,2),
    nullif(p->>'incentive_amount', '')::numeric(12,2),
    nullif(p->>'loan_recovery_amount', '')::numeric(12,2),
    nullif(p->>'other_deductions', '')::numeric(12,2),
    nullif(trim(p->>'payroll_remarks'), ''),
    v_uid
  )
  on conflict (case_id) do update set
    lwp_completed          = excluded.lwp_completed,
    notice_recovery_days   = excluded.notice_recovery_days,
    notice_recovery_amount = excluded.notice_recovery_amount,
    incentive_amount       = excluded.incentive_amount,
    loan_recovery_amount   = excluded.loan_recovery_amount,
    other_deductions       = excluded.other_deductions,
    payroll_remarks        = excluded.payroll_remarks,
    payroll_done_by        = coalesce(public.fms_exit_settlements.payroll_done_by, excluded.payroll_done_by);

  v_lines := coalesce(p->'lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'The payroll lines must be a JSON array';
  end if;

  delete from public.fms_exit_payroll_lines where case_id = p_case;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_head := nullif(v_line->>'head_id', '')::uuid;
    v_name := nullif(trim(v_line->>'head_name'), '');
    if v_name is null and v_head is not null then
      select h.name into v_name from public.fms_exit_payroll_heads h where h.id = v_head;
    end if;
    if v_name is null then
      raise exception 'Every payroll line needs a head';
    end if;

    v_kind := nullif(trim(v_line->>'kind'), '');
    if v_kind is null and v_head is not null then
      select h.kind into v_kind from public.fms_exit_payroll_heads h where h.id = v_head;
    end if;
    if v_kind not in ('addition','deduction') then
      raise exception 'A payroll line is either an addition or a deduction, not "%"', coalesce(v_kind, '');
    end if;

    if coalesce(nullif(v_line->>'amount', '')::numeric(12,2), 0) < 0 then
      raise exception '% — an amount cannot be negative. Use the other kind instead.', v_name;
    end if;

    insert into public.fms_exit_payroll_lines (case_id, head_id, head_name, kind, amount, remarks, sort_order)
    values (
      p_case, v_head, v_name, v_kind,
      coalesce(nullif(v_line->>'amount', '')::numeric(12,2), 0),
      nullif(trim(v_line->>'remarks'), ''),
      v_i
    );
    v_i := v_i + 1;
  end loop;

  update public.fms_exit_cases set
    payroll_done_at = coalesce(payroll_done_at, now())
  where id = p_case;

  if v_prev is not null then
    update public.fms_exit_settlements set edited_at = now(), edited_by = v_uid where case_id = p_case;
  end if;

  perform public.fms_exit_announce(
    'settlement', p_case, 'payroll_recorded',
    'Payroll inputs recorded for ' || v_no || '.',
    public.fms_exit_step_owner_ids('fnf_generate'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_record_payroll_inputs(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. HARDENED generate_fnf — body from 20260714170000 VERBATIM, plus the
--    fnf-approved guard, fnf_generated_by (coalesce-first), edited_* on a regen.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_generate_fnf(uuid, jsonb);
create or replace function public.fms_exit_generate_fnf(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_lwd      date;
  v_no       text;
  v_name     text;
  v_prev     timestamptz;
  v_approved timestamptz;
  v_amount   numeric(12,2);
  v_path     text;
begin
  select status, lwd, exit_no, employee_name, fnf_generated_at, fnf_approved_at
    into v_status, v_lwd, v_no, v_name, v_prev, v_approved
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('fnf_generate', p_case, v_uid) then
    raise exception 'Not authorized to generate the F&F on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its F&F no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the F&F is dated from it';
  end if;
  -- ⭐ THE DOWNSTREAM LOCK. The approved figures derive from the generated ones; a
  --   rejection clears fnf_approved_at (never set) and re-opens this naturally.
  if v_approved is not null then
    raise exception 'The F&F has already been approved — send it back first if the working needs regenerating';
  end if;

  if not public.fms_exit_step_done(p_case, 'leave_verification') then
    raise exception 'The leave balance has not been verified — the F&F cannot be worked out before its inputs exist (verify it, or waive the step with a reason)';
  end if;
  if not public.fms_exit_step_done(p_case, 'payroll_inputs') then
    raise exception 'The payroll inputs have not been recorded — the F&F cannot be worked out before its inputs exist (record them, or waive the step with a reason)';
  end if;

  v_amount := nullif(p->>'fnf_amount', '')::numeric(12,2);
  v_path   := nullif(p->>'fnf_file_path', '');

  if v_path is not null and v_path not like 'cases/' || p_case::text || '/fnf/%' then
    raise exception 'The F&F working must be stored under cases/%/fnf/ — that prefix is finance-confidential', p_case;
  end if;

  insert into public.fms_exit_settlements (case_id, fnf_amount, fnf_file_path, fnf_file_name, fnf_remarks, fnf_generated_by)
  values (
    p_case, v_amount, v_path,
    nullif(p->>'fnf_file_name', ''),
    nullif(trim(p->>'fnf_remarks'), ''),
    v_uid
  )
  on conflict (case_id) do update set
    fnf_amount       = excluded.fnf_amount,
    fnf_file_path    = coalesce(excluded.fnf_file_path, public.fms_exit_settlements.fnf_file_path),
    fnf_file_name    = coalesce(excluded.fnf_file_name, public.fms_exit_settlements.fnf_file_name),
    fnf_remarks      = excluded.fnf_remarks,
    fnf_generated_by = coalesce(public.fms_exit_settlements.fnf_generated_by, excluded.fnf_generated_by);

  update public.fms_exit_cases set
    fnf_generated_at = coalesce(fnf_generated_at, now()),
    status       = case when status in ('clearance','settlement') then 'settlement' else status end,
    current_step = case when status in ('clearance','settlement') then 'fnf_approve' else current_step end
  where id = p_case;

  if v_prev is not null then
    update public.fms_exit_settlements set edited_at = now(), edited_by = v_uid where case_id = p_case;
  end if;

  perform public.fms_exit_announce(
    'settlement', p_case, 'fnf_generated',
    v_no || ' (' || v_name || ') — the full & final settlement has been prepared and needs approval.',
    public.fms_exit_step_owner_ids('fnf_approve'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_generate_fnf(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. HARDENED approve_fnf — body from 20260714170000 VERBATIM, plus the fnf-paid
--    guard and edited_* on a re-decision. (fnf_approved_by_id already records the
--    decider.) The reject branch is unchanged — it clears fnf_generated_at, which
--    is the whole re-open mechanism.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_approve_fnf(uuid, boolean, text);
create or replace function public.fms_exit_approve_fnf(p_case uuid, p_approve boolean, p_remarks text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_no      text;
  v_name    text;
  v_prev    timestamptz;
  v_paid    timestamptz;
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  select status, exit_no, employee_name, fnf_approved_at, fnf_paid_at
    into v_status, v_no, v_name, v_prev, v_paid
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('fnf_approve', p_case, v_uid) then
    raise exception 'Not authorized to approve the F&F on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its F&F no longer applies', v_status;
  end if;
  -- ⭐ THE DOWNSTREAM LOCK. You cannot un-approve a settlement that has been paid.
  if v_paid is not null then
    raise exception 'The F&F has already been paid — its approval can no longer be changed';
  end if;

  if not public.fms_exit_step_done(p_case, 'fnf_generate') then
    raise exception 'The F&F has not been generated yet — there is nothing to approve';
  end if;

  if not p_approve and v_remarks is null then
    raise exception 'Say why the F&F is being sent back — a rejection with no reason is a loop, not a review';
  end if;

  insert into public.fms_exit_settlements (case_id, fnf_approved_by_id, fnf_approval_remarks)
  values (p_case, v_uid, v_remarks)
  on conflict (case_id) do update set
    fnf_approved_by_id   = excluded.fnf_approved_by_id,
    fnf_approval_remarks = excluded.fnf_approval_remarks;

  -- A re-decision on an already-approved F&F is a correction.
  if v_prev is not null then
    update public.fms_exit_settlements set edited_at = now(), edited_by = v_uid where case_id = p_case;
  end if;

  if p_approve then
    update public.fms_exit_cases set
      fnf_approved_at = coalesce(fnf_approved_at, now()),
      current_step    = case when status = 'settlement' then 'fnf_payment' else current_step end
    where id = p_case;

    perform public.fms_exit_announce(
      'settlement', p_case, 'fnf_approved',
      v_no || ' (' || v_name || ') — the full & final settlement has been approved. It is now with accounts for payment.',
      public.fms_exit_step_owner_ids('fnf_payment')
        || public.fms_exit_step_owner_ids('documents'),
      jsonb_build_object('exit_no', v_no)
    );
  else
    update public.fms_exit_cases set
      fnf_generated_at = null,
      current_step     = 'fnf_generate'
    where id = p_case;

    update public.fms_exit_cases set
      status = public.fms_exit_resume_status(p_case)
    where id = p_case and status = 'settlement';

    perform public.fms_exit_announce(
      'settlement', p_case, 'fnf_rejected',
      v_no || ' (' || v_name || ') — the full & final settlement was sent back: ' || v_remarks,
      public.fms_exit_step_owner_ids('fnf_generate')
        || public.fms_exit_step_owner_ids('payroll_inputs'),
      jsonb_build_object('exit_no', v_no)
    );
  end if;
end $$;
grant execute on function public.fms_exit_approve_fnf(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. HARDENED release_fnf_payment — body from 20260714170000 VERBATIM, plus
--    edited_* on a correction (a UTR fix after the first release). No new guard:
--    it already coalesce-locks fnf_paid_at and refuses on a terminal case, which
--    is exactly the "editable until terminal" boundary. fnf_paid_by_id already
--    records the payer.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_release_fnf_payment(uuid, jsonb);
create or replace function public.fms_exit_release_fnf_payment(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_no     text;
  v_name   text;
  v_emp    uuid;
  v_prev   timestamptz;
  v_mode   text;
  v_ref    text;
  v_on     date;
  v_lwd    date;
  v_final  text;
begin
  select status, exit_no, employee_name, employee_user_id, lwd, fnf_paid_at
    into v_status, v_no, v_name, v_emp, v_lwd, v_prev
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('fnf_payment', p_case, v_uid) then
    raise exception 'Not authorized to release the F&F payment on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its F&F no longer applies', v_status;
  end if;

  if not public.fms_exit_step_done(p_case, 'fnf_approve') then
    raise exception 'The F&F has not been approved — money does not leave on an unapproved settlement';
  end if;

  v_mode  := nullif(trim(p->>'fnf_payment_mode'), '');
  v_ref   := nullif(trim(p->>'fnf_payment_ref'), '');
  v_on    := coalesce(nullif(p->>'fnf_paid_on', '')::date, current_date);
  v_final := nullif(p->>'final_fnf_path', '');

  if v_mode is null then
    raise exception 'Record how the F&F was paid — "paid, somehow" cannot be traced when they ring up in March';
  end if;
  if v_lwd is not null and v_on < v_lwd then
    raise exception 'The F&F cannot have been paid (%) before the last working day (%)', v_on, v_lwd;
  end if;
  if v_final is not null and v_final not like 'cases/' || p_case::text || '/share/%' then
    raise exception 'The employee''s final F&F copy must be stored under cases/%/share/ — it is the one prefix they can read', p_case;
  end if;

  insert into public.fms_exit_settlements (
    case_id, fnf_paid_on, fnf_payment_mode, fnf_payment_ref, fnf_paid_by_id,
    final_fnf_path, final_fnf_name
  ) values (
    p_case, v_on, v_mode, v_ref, v_uid, v_final, nullif(p->>'final_fnf_name', '')
  )
  on conflict (case_id) do update set
    fnf_paid_on      = excluded.fnf_paid_on,
    fnf_payment_mode = excluded.fnf_payment_mode,
    fnf_payment_ref  = excluded.fnf_payment_ref,
    fnf_paid_by_id   = coalesce(public.fms_exit_settlements.fnf_paid_by_id, excluded.fnf_paid_by_id),
    final_fnf_path   = coalesce(excluded.final_fnf_path, public.fms_exit_settlements.final_fnf_path),
    final_fnf_name   = coalesce(excluded.final_fnf_name, public.fms_exit_settlements.final_fnf_name);

  update public.fms_exit_cases set
    fnf_paid_at  = coalesce(fnf_paid_at, now()),
    current_step = case when status = 'settlement' then 'documents' else current_step end
  where id = p_case;

  if v_prev is not null then
    update public.fms_exit_settlements set edited_at = now(), edited_by = v_uid where case_id = p_case;
  end if;

  perform public.fms_exit_announce(
    'settlement', p_case, 'fnf_paid',
    v_no || ' (' || v_name || ') — the full & final settlement has been paid.',
    (case when v_emp is null then '{}'::uuid[] else array[v_emp] end)
      || public.fms_exit_step_owner_ids('documents'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_release_fnf_payment(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. HARDENED record_interview — body from 20260714160000 VERBATIM, plus
--     edited_* on a correction. (conducted_by already records who held it.)
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_record_interview(uuid, jsonb);
create or replace function public.fms_exit_record_interview(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_lwd      date;
  v_no       text;
  v_prev     timestamptz;
  v_by       uuid;
  v_on       date;
  v_reason   uuid;
  v_rehire   boolean;
  v_feedback jsonb;
begin
  select status, lwd, exit_no, interview_done_at
    into v_status, v_lwd, v_no, v_prev
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('exit_interview', p_case, v_uid) then
    raise exception 'Not authorized to record the exit interview on this exit case';
  end if;

  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its exit interview no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the exit interview is dated from it';
  end if;

  v_by     := coalesce(nullif(p->>'conducted_by', '')::uuid, v_uid);
  v_on     := coalesce(nullif(p->>'conducted_on', '')::date, current_date);
  v_reason := nullif(p->>'primary_reason_id', '')::uuid;
  v_rehire := nullif(p->>'would_rehire', '')::boolean;

  v_feedback := coalesce(p->'feedback', '{}'::jsonb);
  if jsonb_typeof(v_feedback) <> 'object' then
    raise exception 'The interview feedback must be a JSON object';
  end if;

  insert into public.fms_exit_interviews (
    case_id, conducted_by, conducted_on, primary_reason_id, would_rehire,
    remarks, feedback, portal_feedback_done, file_path, file_name
  ) values (
    p_case, v_by, v_on, v_reason, v_rehire,
    nullif(trim(p->>'remarks'), ''),
    v_feedback,
    coalesce((p->>'portal_feedback_done')::boolean, false),
    nullif(p->>'file_path', ''),
    nullif(p->>'file_name', '')
  )
  on conflict (case_id) do update set
    conducted_by         = excluded.conducted_by,
    conducted_on         = excluded.conducted_on,
    primary_reason_id    = excluded.primary_reason_id,
    would_rehire         = excluded.would_rehire,
    remarks              = excluded.remarks,
    feedback             = excluded.feedback,
    portal_feedback_done = excluded.portal_feedback_done,
    file_path            = coalesce(excluded.file_path, public.fms_exit_interviews.file_path),
    file_name            = coalesce(excluded.file_name, public.fms_exit_interviews.file_name),
    -- A correction to an interview already recorded.
    edited_at            = case when public.fms_exit_interviews.case_id is not null then now() else null end,
    edited_by            = case when public.fms_exit_interviews.case_id is not null then v_uid else null end;

  update public.fms_exit_cases set
    interview_done_at = coalesce(interview_done_at, now())
  where id = p_case;

  -- The upsert stamps edited_* whenever the row pre-existed; on the very FIRST
  -- record the step was not yet done, so clear it back to null.
  if v_prev is null then
    update public.fms_exit_interviews set edited_at = null, edited_by = null where case_id = p_case;
  end if;

  perform public.fms_exit_announce(
    'case', p_case, 'interview_recorded',
    'Exit interview recorded for ' || v_no || '.',
    public.fms_exit_step_owner_ids('hr_verification')
      || public.fms_exit_step_owner_ids('hr_head_approval'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_record_interview(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. HARDENED issue_documents — body from 20260714180000 VERBATIM, plus
--     documents_issued_by (coalesce-first) + edited_* on a re-issue. No new
--     guard: the archived (terminal) status already refuses, which is the
--     "editable while archived_at null" boundary.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_issue_documents(uuid, jsonb);
create or replace function public.fms_exit_issue_documents(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_no      text;
  v_name    text;
  v_emp     uuid;
  v_prev    timestamptz;
  v_docs    jsonb;
  v_d       jsonb;
  v_id      uuid;
  v_row     public.fms_exit_documents%rowtype;
  v_issued  date;
  v_path    text;
  v_pending integer;
  v_total   integer;
begin
  select status, exit_no, employee_name, employee_user_id, documents_issued_at
    into v_status, v_no, v_name, v_emp, v_prev
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('documents', p_case, v_uid) then
    raise exception 'Not authorized to issue the exit documents on this case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its exit documents no longer apply', v_status;
  end if;

  perform public.fms_exit_seed_documents(p_case);

  v_docs := coalesce(p->'documents', '[]'::jsonb);
  if jsonb_typeof(v_docs) <> 'array' then
    raise exception 'The documents payload must be a JSON array';
  end if;

  for v_d in select * from jsonb_array_elements(v_docs) loop
    v_id := nullif(v_d->>'id', '')::uuid;
    if v_id is null then raise exception 'Every document line must name its row'; end if;

    select * into v_row from public.fms_exit_documents
     where id = v_id and case_id = p_case for update;
    if v_row.id is null then
      raise exception 'That document does not belong to this exit case';
    end if;

    v_path   := coalesce(nullif(v_d->>'file_path', ''), v_row.file_path);
    v_issued := coalesce(nullif(v_d->>'issued_on', '')::date, v_row.issued_on);

    if v_path is not null and v_path not like 'cases/' || p_case::text || '/share/%' then
      raise exception 'The % must be stored under cases/%/share/ — it is the one prefix the employee can open', v_row.name, p_case;
    end if;

    if v_issued is not null and v_row.requires_file and v_path is null then
      raise exception '% cannot be marked issued without the document attached — a letter with no PDF is a promise, not a document', v_row.name;
    end if;

    update public.fms_exit_documents set
      issued_on = v_issued,
      file_path = v_path,
      file_name = coalesce(nullif(v_d->>'file_name', ''), file_name),
      remarks   = case when jsonb_exists(v_d, 'remarks')
                       then nullif(trim(v_d->>'remarks'), '') else remarks end
    where id = v_id;
  end loop;

  select count(*), count(*) filter (where issued_on is null)
    into v_total, v_pending
    from public.fms_exit_documents where case_id = p_case;

  if v_total > 0 and v_pending = 0 then
    update public.fms_exit_cases set
      documents_issued_at = coalesce(documents_issued_at, now()),
      documents_issued_by = coalesce(documents_issued_by, v_uid),
      status       = case when status in ('clearance','settlement') then 'closure' else status end,
      current_step = case when status in ('clearance','settlement','closure') then 'archive' else current_step end,
      -- A re-issue of already-issued documents is a correction.
      edited_at    = case when v_prev is not null then now() else edited_at end,
      edited_by    = case when v_prev is not null then v_uid else edited_by end
    where id = p_case;

    perform public.fms_exit_announce(
      'document', p_case, 'documents_issued',
      v_no || ' (' || v_name || ') — the exit documents have been issued. The case can be archived once the signed acknowledgement comes back.',
      (case when v_emp is null then '{}'::uuid[] else array[v_emp] end)
        || public.fms_exit_step_owner_ids('archive'),
      jsonb_build_object('exit_no', v_no)
    );
  else
    update public.fms_exit_cases set documents_issued_at = null
     where id = p_case and documents_issued_at is not null;
  end if;
end $$;
grant execute on function public.fms_exit_issue_documents(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. HARDENED archive_case — body from 20260714180000 VERBATIM, plus archived_by.
--     archive is terminal, so this never needs edited_* (its Completed row is
--     always locked). archived_by is coalesce-first purely for defensiveness.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_archive_case(uuid, jsonb);
create or replace function public.fms_exit_archive_case(p_case uuid, p jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_no       text;
  v_name     text;
  v_emp      uuid;
  v_blocked  text[];
begin
  select status, exit_no, employee_name, employee_user_id
    into v_status, v_no, v_name, v_emp
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('archive', p_case, v_uid) then
    raise exception 'Not authorized to archive this exit case';
  end if;
  if v_status = 'archived' then
    raise exception 'This exit case is already archived';
  end if;
  if v_status in ('withdrawn','rejected') then
    raise exception 'This exit case is % — it was never completed, and it is not archived, it is closed', v_status;
  end if;
  if v_status = 'on_hold' then
    raise exception 'This exit case is on hold — take it off hold before archiving it';
  end if;

  v_blocked := public.fms_exit_archive_blockers(p_case);
  if cardinality(v_blocked) > 0 then
    raise exception 'This exit cannot be archived yet — %', array_to_string(v_blocked, '; and ');
  end if;

  update public.fms_exit_cases set
    archived_at           = now(),
    archived_by           = coalesce(archived_by, v_uid),
    status                = 'archived',
    current_step          = 'archive',
    system_status_changed = true,
    clearance_remarks     = coalesce(nullif(trim(p->>'remarks'), ''), clearance_remarks)
  where id = p_case;

  perform public.fms_exit_announce(
    'case', p_case, 'archived',
    v_no || ' (' || v_name || ') — the exit is complete and the case is archived. Every document was issued and acknowledged.',
    (case when v_emp is null then '{}'::uuid[] else array[v_emp] end)
      || public.fms_exit_step_owner_ids('hr_verification')
      || public.fms_exit_step_owner_ids('hr_head_approval'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_archive_case(uuid, jsonb) to authenticated;
