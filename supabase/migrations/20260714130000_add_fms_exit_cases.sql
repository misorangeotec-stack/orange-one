-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — THE CASE HEADER + APPROVALS (Phase 2, M2).
--
-- Tables:
--   fms_exit_cases       — the exit case: employee snapshot, the approval chain,
--                          and ONE AUTHORITATIVE TIMESTAMP COLUMN PER STEP
--   fms_exit_step_skips  — "this step does not apply here, and here is why"
--
-- Helpers:
--   fms_exit_can_read_case(case, uid)      — the read gate
--   fms_exit_can_act(step, case, uid)      — THE authorization gate
--   fms_exit_resume_status(case)           — where a held case goes back to
--
-- RPCs (all SECURITY DEFINER; lock the row, validate the current status, re-check
-- authz via can_act(), validate inputs, stamp THE STEP'S OWN timestamp on the
-- domain row, then advance status/current_step):
--   fms_exit_raise_case, fms_exit_update_case, fms_exit_manager_review,
--   fms_exit_hr_verify, fms_exit_decide_case, fms_exit_withdraw_case,
--   fms_exit_hold_case, fms_exit_skip_step
--
-- ---------------------------------------------------------------------------
-- ⚠ NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL.
--
--   fms_exit_announce() is BEST-EFFORT and its failure is SWALLOWED by the
--   caller (that is the whole point: a dead notification must never undo a
--   completed workflow action). So the trail can be missing rows for steps that
--   definitely happened. Every step below therefore stamps its own column on
--   THIS row, and every reader — the queue, the stepper, the SLA clock, the
--   scoreboard — reads those columns and nothing else. This lesson cost Purchase
--   a migration (20260708120900) and HR another one.
-- ---------------------------------------------------------------------------
--
-- ── WHAT IS *NOT* IN THIS TABLE, AND WHY ───────────────────────────────────
-- fms_exit_cases is the WIDE-READ table: the IT person, the Admin, the Travel
-- Desk and the reporting manager all have to open it to do their jobs. So it
-- carries NO SALARY, NO F&F, NO EXIT-INTERVIEW CONTENT. Those live in
-- confidential satellites with their own narrow read gates (M5/M6) — an exit
-- interview exists to say things about the manager; if the manager can read it,
-- it is a performance review with extra steps.
--
-- Only the FACT that a step happened lives here (interview_done_at,
-- fnf_approved_at, …), so queues can show done / not-done without leaking a word.
--
-- Purely ADDITIVE. Reverses (in order):
--   drop policy "fms exit docs employee share read"       on storage.objects;
--   drop policy "fms exit docs raiser resignation read"   on storage.objects;
--   drop policy "fms exit docs raiser resignation insert" on storage.objects;
--   drop function if exists public.fms_exit_skip_step(uuid,text,text);
--   drop function if exists public.fms_exit_hold_case(uuid,boolean,text);
--   drop function if exists public.fms_exit_withdraw_case(uuid,text);
--   drop function if exists public.fms_exit_decide_case(uuid,text,text);
--   drop function if exists public.fms_exit_hr_verify(uuid,jsonb);
--   drop function if exists public.fms_exit_manager_review(uuid,text,text);
--   drop function if exists public.fms_exit_update_case(uuid,jsonb);
--   drop function if exists public.fms_exit_raise_case(jsonb);
--   drop function if exists public.fms_exit_resume_status(uuid);
--   drop function if exists public.fms_exit_can_act(text,uuid,uuid);
--   drop function if exists public.fms_exit_can_read_case(uuid,uuid);
--   drop table if exists public.fms_exit_step_skips, public.fms_exit_cases;
-- ===========================================================================

create table if not exists public.fms_exit_cases (
  id                      uuid primary key default gen_random_uuid(),
  exit_no                 text not null unique,          -- EXIT-2627-0001
  case_type               text not null default 'resignation' check (case_type in (
                            'resignation','absconding','termination','retirement','end_of_contract')),

  -- ---- The employee: A SNAPSHOT, plus an OPTIONAL login link -------------
  -- There is no HRIS / employee master in this portal, and `departments` has no
  -- hod_id. So the case captures who is leaving rather than pointing at a row
  -- that does not exist, and reporting_manager_ids — not "the department's HOD"
  -- — is what every manager-owned step routes to.
  --
  -- employee_user_id is NULLABLE ON PURPOSE: plenty of staff have no portal
  -- login. They get no notifications (HR mails them out-of-band) and the case is
  -- raised on their behalf. A NOT NULL here would make the app unusable for
  -- exactly the people it most often has to handle.
  employee_user_id        uuid references auth.users on delete set null,
  employee_code           text not null,
  employee_name           text not null,
  department_id           uuid not null references public.departments on delete restrict,
  -- FREE TEXT, deliberately. public.designations exists but is DEAD IN THE UI —
  -- profiles.designation is itself free text — so a FK here would be a lie.
  designation             text,
  date_of_joining         date,

  reporting_manager_ids   uuid[] not null default '{}',
  reporting_manager_note  text,                          -- whoever does not resolve to a login

  raised_by               uuid references auth.users on delete set null,
  raised_on_behalf        boolean not null default false,

  reason_id               uuid references public.fms_exit_reasons on delete set null,
  reason_note             text,

  resignation_letter_path text,
  resignation_letter_name text,

  notice_period_days      integer,
  notice_waived           boolean not null default false,
  policy_applicable       boolean not null default true,
  policy_na_reason        text,

  -- TWO dates, not one. proposed_lwd is what HR TYPES at verification; `lwd` is
  -- the FINALISED last working day, set at the lwd_confirm step. `lwd` is the
  -- event SEVEN downstream SLAs hang off (clearance, assets, handover, the exit
  -- interview, leave, payroll, F&F), so it must not be quietly changed by a
  -- pending proposal.
  proposed_lwd            date,
  lwd                     date,

  clearance_remarks       text,
  -- The sheet's "Status changed in system" — a manual flag, ticked by whoever
  -- disables the accounts. There is no HRMS to integrate with.
  system_status_changed   boolean not null default false,

  -- STATUSES ARE NOT STEP KEYS. on_hold / withdrawn / rejected / archived exist
  -- here and NOWHERE in StepKey: a status loose in the work queue flows silently
  -- into the KPI tiles, the Dashboard and the cross-FMS scoreboard as "work owed
  -- by Nobody". A held case leaves every queue and is counted on its own strip.
  status                  text not null default 'manager_review' check (status in (
                            'manager_review','hr_review','head_approval','clearance',
                            'settlement','closure',
                            'on_hold','withdrawn','rejected','archived')),
  current_step            text not null default 'manager_review',

  -- ---- AUTHORITATIVE step timestamps (see the header) --------------------
  submitted_at            timestamptz not null default now(),

  -- manager_review is a RECOMMENDATION and NEVER BLOCKS. You cannot legally
  -- refuse a resignation, so accept / reject / discuss is recorded with remarks
  -- and the case advances REGARDLESS. Only the HR Head can terminally stop it.
  manager_reviewed_at     timestamptz,
  manager_recommendation  text check (manager_recommendation in ('accept','reject','discuss')),
  manager_remarks         text,
  manager_reviewer_id     uuid references auth.users on delete set null,
  -- 'discuss' stamps this AND LEAVES THE SLA CLOCK ALONE. A manager wanting a
  -- conversation is not new work; re-clocking would make "Discuss" an SLA dodge.
  discussed_at            timestamptz,

  hr_verified_at          timestamptz,
  hr_verifier_id          uuid references auth.users on delete set null,
  hr_remarks              text,

  approved_at             timestamptz,
  approver_id             uuid references auth.users on delete set null,
  approval_remarks        text,

  clearance_completed_at  timestamptz,
  assets_returned_at      timestamptz,
  handover_completed_at   timestamptz,
  interview_done_at       timestamptz,   -- the FACT only; the content is in M5
  leave_verified_at       timestamptz,
  payroll_done_at         timestamptz,
  fnf_generated_at        timestamptz,   -- the FACT only; the numbers are in M6
  fnf_approved_at         timestamptz,
  fnf_paid_at             timestamptz,
  documents_issued_at     timestamptz,
  archived_at             timestamptz,

  rejected_at             timestamptz,
  reject_reason           text,
  withdrawn_at            timestamptz,
  withdraw_reason         text,
  -- FROM DAY ONE. HR Recruitment needed a whole migration to bolt hold on later.
  hold_at                 timestamptz,
  hold_reason             text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.fms_exit_cases is
  'The exit case header — the WIDE-READ table. Employee snapshot, approval chain, and one authoritative timestamp per step. Deliberately carries NO salary, NO F&F and NO interview content: the clearance crowd and the reporting manager can read it.';

create index if not exists fms_exit_cases_status_idx   on public.fms_exit_cases (status);
create index if not exists fms_exit_cases_step_idx     on public.fms_exit_cases (current_step);
create index if not exists fms_exit_cases_dept_idx     on public.fms_exit_cases (department_id);
create index if not exists fms_exit_cases_employee_idx on public.fms_exit_cases (employee_user_id);
create index if not exists fms_exit_cases_lwd_idx      on public.fms_exit_cases (lwd);

-- ONE OPEN CASE PER EMPLOYEE. Precedent: 20260713120000:23.
-- A partial unique index, so a person who left, came back and left again is fine —
-- but a second LIVE case for the same employee code is refused at the database,
-- not by a race-prone SELECT-then-INSERT in the app.
create unique index if not exists fms_exit_one_open_case_per_employee
  on public.fms_exit_cases (employee_code)
  where status not in ('withdrawn','rejected','archived');

drop trigger if exists trg_fms_exit_cases_updated on public.fms_exit_cases;
create trigger trg_fms_exit_cases_updated
  before update on public.fms_exit_cases
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_exit_step_skips — the ONE mechanism that covers every real-world hole.
--
-- An absconder has no handover. A terminated employee gets no relieving letter.
-- Training clearance is "if applicable". Branching the workflow for each of these
-- would triple the step list; instead a step is SKIPPED WITH A REASON.
--
-- A SKIPPED STEP IS COMPLETE-WITH-A-REASON: it emits no queue entry, it is greyed
-- (⊘) on the stepper with the reason on hover, and IT SATISFIES THE DOWNSTREAM
-- GUARDS. Hence stepDone(c, step) = timestamp(step) IS NOT NULL *OR* skipped(step),
-- and every gate reads stepDone — never the raw timestamp.
--
-- The approval chain (manager_review / hr_verification / hr_head_approval /
-- lwd_confirm) is NOT skippable: those steps drive `status`, so skipping one would
-- leave the case's status and its open work disagreeing. `resignation` is not
-- skippable either (raising the case IS the step), and neither is `archive` (the
-- terminal act is performed, not waived).
-- ===========================================================================
create table if not exists public.fms_exit_step_skips (
  case_id     uuid not null references public.fms_exit_cases on delete cascade,
  step_key    text not null,
  reason      text not null,                              -- never optional: a silent skip is a lost step
  skipped_by  uuid references auth.users on delete set null,
  skipped_at  timestamptz not null default now(),
  primary key (case_id, step_key)
);

comment on table public.fms_exit_step_skips is
  'A step that does not apply to this case, and why. Complete-with-a-reason: emits no queue entry and SATISFIES the downstream guards.';

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- ⚠⚠ M3 MUST `create or replace` THIS FUNCTION TO ADD ONE MORE CLAUSE ⚠⚠
--
--        ... or exists (select 1 from public.fms_exit_clearance_checks k
--                        where k.case_id = p_case and p_uid = any(k.owner_ids))
--
-- The IT person, the Admin and the Travel Desk own NO STEP AT ALL — they own a
-- CLEARANCE ROW. Without that clause they cannot open the very case they owe work
-- on. It cannot be written here because fms_exit_clearance_checks does not exist
-- until M3, and a `sql` function body referencing a missing table fails at CREATE.
-- (This is also precisely why the money and the interview live in separate tables:
-- the clearance crowd must be able to read the header, and nothing more.)
create or replace function public.fms_exit_can_read_case(p_case uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_exit_is_coordinator(p_uid)
      or public.fms_exit_is_exit_staff(p_uid)
      or exists (
        select 1 from public.fms_exit_cases c
        where c.id = p_case
          and (c.employee_user_id = p_uid
            or c.raised_by = p_uid
            or p_uid = any(c.reporting_manager_ids))
      );
$$;
grant execute on function public.fms_exit_can_read_case(uuid, uuid) to authenticated;

-- THE gate every workflow RPC calls.
--
-- ⚠ MANAGER ACCESS IS ADDITIVE, NOT EXCLUSIVE. fms_hr_can_act() EARLY-RETURNS for
-- its HOD steps, and that is exactly what made them unreachable whenever the
-- manager list was empty. Here a manager is a CO-OWNER: asset_return needs an HOD
-- sign AND an HR sign; handover needs the manager's confirmation AND HR's. So the
-- manager branch falls THROUGH to the configured step owner rather than returning
-- false — which also means a manager who never responds cannot wedge the case.
--
-- ⚠ KEEP THE `in (...)` LIST BELOW IN SYNC WITH `MANAGER_STEPS` IN
--   frontend/src/apps/hr-exit/lib/steps.ts. CHANGE ONE, CHANGE THE OTHER.
--   (The same duplication has bitten HR twice.)
--
-- M3 adds the `clearance` branch (a clearance row's own owner_ids). It cannot go
-- here — same missing-table reason as above.
create or replace function public.fms_exit_can_act(p_step_key text, p_case uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  if public.is_admin(p_uid) or public.fms_exit_is_coordinator(p_uid) then
    return true;
  end if;

  -- MANAGER_STEPS — mirrored in lib/steps.ts.
  if p_step_key in ('manager_review', 'asset_return', 'handover') and p_case is not null then
    select reporting_manager_ids into v_managers from public.fms_exit_cases where id = p_case;
    if v_managers is not null and p_uid = any(v_managers) then
      return true;
    end if;
    -- NO early return. Fall through to the configured owner.
  end if;

  return public.fms_exit_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_exit_can_act(text, uuid, uuid) to authenticated;

-- Where a held case goes back to when it is taken off hold.
--
-- Derived from the case's own timestamps rather than from a stashed "status before
-- hold" column: the stamps are the truth, and a stashed status can go stale if the
-- case is edited while parked.
create or replace function public.fms_exit_resume_status(p_case uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.archived_at is not null         then 'archived'
    when c.documents_issued_at is not null then 'closure'
    when c.fnf_generated_at is not null    then 'settlement'
    when c.approved_at is not null         then 'clearance'
    when c.hr_verified_at is not null      then 'head_approval'
    when c.manager_reviewed_at is not null then 'hr_review'
    else 'manager_review'
  end
  from public.fms_exit_cases c where c.id = p_case;
$$;
grant execute on function public.fms_exit_resume_status(uuid) to authenticated;

-- ===========================================================================
-- RLS — read is gated; every write goes through the RPCs below.
-- ===========================================================================
alter table public.fms_exit_cases enable row level security;
drop policy if exists fms_exit_cases_select on public.fms_exit_cases;
create policy fms_exit_cases_select on public.fms_exit_cases
  for select to authenticated using (public.fms_exit_can_read_case(id, auth.uid()));
drop policy if exists fms_exit_cases_write_admin on public.fms_exit_cases;
create policy fms_exit_cases_write_admin on public.fms_exit_cases
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_exit_step_skips enable row level security;
drop policy if exists fms_exit_step_skips_select on public.fms_exit_step_skips;
create policy fms_exit_step_skips_select on public.fms_exit_step_skips
  for select to authenticated using (public.fms_exit_can_read_case(case_id, auth.uid()));
drop policy if exists fms_exit_step_skips_write_admin on public.fms_exit_step_skips;
create policy fms_exit_step_skips_write_admin on public.fms_exit_step_skips
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPC — raise an exit case. THE ORIGIN OF THE WHOLE WORKFLOW.
--
-- ⚠ THIS IS THE ONE PLACE THE SELF-SERVICE RULE LIVES, AND IT IS **NEVER**
--   GATED ON STEP OWNERSHIP.
--
--   `resignation` is not an owned step and must never become one. If "may raise"
--   were expressed as step ownership, then fms_exit_is_exit_staff() — the PII read
--   gate — would be true for the entire company, and the app would hand out every
--   person's salary, F&F and exit-interview transcript to everybody. (HR
--   Recruitment shipped exactly that bug and needed 20260712180000 to unship it.)
--
-- Allowed if ANY of:
--   • it is your OWN exit         (employee_user_id = auth.uid()) AND self-service is on
--   • you are admin / a process coordinator / exit staff  → raising on behalf
--   • you name YOURSELF among the reporting managers      → a manager raising for
--     one of their own people (absconding, termination)
-- ===========================================================================
drop function if exists public.fms_exit_raise_case(jsonb);
create or replace function public.fms_exit_raise_case(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id         uuid;
  v_no         text;
  v_seq        integer;
  v_fy         text := public.fms_exit_fy_code(current_date);
  v_uid        uuid := auth.uid();
  v_emp        uuid := nullif(p->>'employee_user_id', '')::uuid;
  v_managers   uuid[];
  v_self       boolean;
  v_notice     integer;
  v_default    integer;
  v_selfserve  boolean;
  v_constraint text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  v_managers := coalesce(
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'reporting_manager_ids','[]'::jsonb)) x),
    '{}'::uuid[]
  );

  select coalesce((value->>'value')::boolean, true) into v_selfserve
    from public.fms_exit_config where key = 'allow_self_service';
  v_selfserve := coalesce(v_selfserve, true);

  v_self := (v_emp is not null and v_emp = v_uid);

  if not (
       (v_self and v_selfserve)
    or public.is_admin(v_uid)
    or public.fms_exit_is_coordinator(v_uid)
    or public.fms_exit_is_exit_staff(v_uid)
    or (v_uid = any(v_managers))
  ) then
    raise exception 'You are not allowed to raise this exit case';
  end if;

  if coalesce(trim(p->>'employee_code'), '') = '' then raise exception 'Employee code is required'; end if;
  if coalesce(trim(p->>'employee_name'), '') = '' then raise exception 'Employee name is required'; end if;
  if (p->>'department_id') is null or trim(p->>'department_id') = '' then
    raise exception 'Department is required';
  end if;

  -- Suggested notice period, from Setup → Policy. HR can override it at verification.
  select coalesce((value->>'value')::integer, 30) into v_default
    from public.fms_exit_config where key = 'default_notice_days';
  v_notice := coalesce(nullif(p->>'notice_period_days','')::integer, v_default, 30);

  v_seq := public.fms_exit_next_seq('EXIT-' || v_fy);
  v_no  := 'EXIT-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  begin
    insert into public.fms_exit_cases (
      exit_no, case_type,
      employee_user_id, employee_code, employee_name, department_id, designation, date_of_joining,
      reporting_manager_ids, reporting_manager_note,
      raised_by, raised_on_behalf,
      reason_id, reason_note,
      resignation_letter_path, resignation_letter_name,
      notice_period_days,
      status, current_step, submitted_at
    ) values (
      v_no,
      coalesce(nullif(p->>'case_type',''), 'resignation'),
      v_emp,
      trim(p->>'employee_code'),
      trim(p->>'employee_name'),
      (p->>'department_id')::uuid,
      nullif(trim(p->>'designation'), ''),
      nullif(p->>'date_of_joining','')::date,
      v_managers,
      nullif(trim(p->>'reporting_manager_note'), ''),
      v_uid,
      not v_self,
      nullif(p->>'reason_id','')::uuid,
      nullif(trim(p->>'reason_note'), ''),
      nullif(p->>'resignation_letter_path',''),
      nullif(p->>'resignation_letter_name',''),
      v_notice,
      'manager_review', 'manager_review', now()
    )
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'fms_exit_one_open_case_per_employee' then
      raise exception 'This employee already has an open exit case';
    end if;
    raise;
  end;

  -- The case now needs the manager's recommendation, and HR needs to know it exists.
  -- Announced HERE (not in the client) because an ordinary employee raising their own
  -- resignation owns no step: the SECURITY DEFINER context is what lets the fan-out
  -- reach people they cannot otherwise write to. Best-effort by construction — it is
  -- never the source of truth for state (see the file header).
  perform public.fms_exit_announce(
    'case', v_id, 'raised',
    'Exit case ' || v_no || ' raised for ' || trim(p->>'employee_name') || ' — your review is needed.',
    v_managers || public.fms_exit_step_owner_ids('hr_verification'),
    jsonb_build_object('exit_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_exit_raise_case(jsonb) to authenticated;

-- ===========================================================================
-- RPC — edit a case. The raiser, or HR / a coordinator — and ONLY before the HR
-- Head has approved it. After that the case is the input to seven other people's
-- work, and quietly changing the department or the manager under them is not an
-- edit, it is a different case.
--
-- ⚠ THIS IS A **PATCH**, NOT A REPLACE. Every column is guarded by
--   `jsonb_exists(p, '<key>')`: A KEY THAT IS ABSENT MEANS "LEAVE IT ALONE",
--   whereas a key present-but-empty means "clear it".
--
--   Without that distinction the client's most common call — "I have just uploaded
--   the resignation letter, store its path" — would send only the two letter keys
--   and SILENTLY BLANK the designation, the joining date, the reason and the
--   manager note, because `p->>'designation'` on a missing key is NULL and NULL is
--   exactly what "clear it" looks like. A partial update that quietly deletes the
--   fields it was not told about is not an update.
-- ===========================================================================
drop function if exists public.fms_exit_update_case(uuid, jsonb);
create or replace function public.fms_exit_update_case(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raiser   uuid;
  v_approved timestamptz;
  v_status   text;
  v_uid      uuid := auth.uid();
begin
  select raised_by, approved_at, status
    into v_raiser, v_approved, v_status
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_approved is not null then
    raise exception 'This case has already been approved and can no longer be edited';
  end if;
  if not (v_raiser = v_uid
          or public.is_admin(v_uid)
          or public.fms_exit_is_coordinator(v_uid)
          or public.fms_exit_is_step_owner('hr_verification', v_uid)) then
    raise exception 'Only the person who raised this case, or HR, can edit it';
  end if;

  update public.fms_exit_cases set
    -- These four can never be blanked: a case with no name, code, department or type
    -- is not a case. An empty value is treated as "not supplied".
    case_type     = coalesce(nullif(p->>'case_type',''), case_type),
    employee_name = coalesce(nullif(trim(p->>'employee_name'), ''), employee_name),
    employee_code = coalesce(nullif(trim(p->>'employee_code'), ''), employee_code),
    department_id = coalesce(nullif(p->>'department_id','')::uuid, department_id),
    -- Nullable, so present-but-empty legitimately means "clear it" — hence the guard.
    employee_user_id = case when jsonb_exists(p, 'employee_user_id')
                            then nullif(p->>'employee_user_id','')::uuid else employee_user_id end,
    designation      = case when jsonb_exists(p, 'designation')
                            then nullif(trim(p->>'designation'), '') else designation end,
    date_of_joining  = case when jsonb_exists(p, 'date_of_joining')
                            then nullif(p->>'date_of_joining','')::date else date_of_joining end,
    -- An empty ARRAY would leave the case unroutable — every manager step would be
    -- owed by nobody — so it is treated as "not supplied", not as "clear it".
    reporting_manager_ids = coalesce(
                              (select array_agg(x::uuid)
                                 from jsonb_array_elements_text(p->'reporting_manager_ids') x),
                              reporting_manager_ids),
    reporting_manager_note = case when jsonb_exists(p, 'reporting_manager_note')
                                  then nullif(trim(p->>'reporting_manager_note'), '') else reporting_manager_note end,
    reason_id   = case when jsonb_exists(p, 'reason_id')
                       then nullif(p->>'reason_id','')::uuid else reason_id end,
    reason_note = case when jsonb_exists(p, 'reason_note')
                       then nullif(trim(p->>'reason_note'), '') else reason_note end,
    resignation_letter_path = coalesce(nullif(p->>'resignation_letter_path',''), resignation_letter_path),
    resignation_letter_name = coalesce(nullif(p->>'resignation_letter_name',''), resignation_letter_name)
  where id = p_case;
end $$;
grant execute on function public.fms_exit_update_case(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — the reporting manager's review.
--
-- ⚠ A RECOMMENDATION. IT NEVER BLOCKS. The case ALWAYS advances to HR, whatever
-- the manager says — you cannot legally refuse a resignation, and this was an
-- explicit decision, not an oversight. Only fms_exit_decide_case (the HR Head) can
-- terminally reject.
--
-- 'discuss' additionally stamps discussed_at and LEAVES THE SLA CLOCK ALONE: a
-- manager wanting a conversation is not new work, and re-clocking would turn
-- "Discuss" into an SLA dodge.
-- ===========================================================================
drop function if exists public.fms_exit_manager_review(uuid, text, text);
create or replace function public.fms_exit_manager_review(
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
  v_status text;
  v_uid    uuid := auth.uid();
begin
  if p_recommendation not in ('accept','reject','discuss') then
    raise exception 'Unknown recommendation %', p_recommendation;
  end if;

  select status into v_status from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status <> 'manager_review' then
    raise exception 'This case is not awaiting the reporting manager (status %)', v_status;
  end if;
  if not public.fms_exit_can_act('manager_review', p_case, v_uid) then
    raise exception 'Not authorized to review this exit case';
  end if;
  if p_recommendation <> 'accept' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A remark is required when the recommendation is not a plain acceptance';
  end if;

  update public.fms_exit_cases set
    manager_reviewed_at    = now(),
    manager_recommendation = p_recommendation,
    manager_remarks        = nullif(trim(p_remarks), ''),
    manager_reviewer_id    = v_uid,
    discussed_at           = case when p_recommendation = 'discuss' then now() else discussed_at end,
    -- ALWAYS advances. See the header.
    status                 = 'hr_review',
    current_step           = 'hr_verification'
  where id = p_case;
end $$;
grant execute on function public.fms_exit_manager_review(uuid, text, text) to authenticated;

-- ===========================================================================
-- RPC — HR verification: notice period, policy applicability, and the PROPOSED
-- last working day.
--
-- proposed_lwd is what HR works out from the notice period. It is NOT `lwd`: the
-- confirmed last working day is set at lwd_confirm (M3), because seven SLAs and
-- the whole clearance checklist hang off it and must not move under a proposal.
-- ===========================================================================
drop function if exists public.fms_exit_hr_verify(uuid, jsonb);
create or replace function public.fms_exit_hr_verify(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_uid       uuid := auth.uid();
  v_applicable boolean := coalesce((p->>'policy_applicable')::boolean, true);
  v_proposed  date := nullif(p->>'proposed_lwd','')::date;
begin
  select status into v_status from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status <> 'hr_review' then
    raise exception 'This case is not awaiting HR verification (status %)', v_status;
  end if;
  if not public.fms_exit_can_act('hr_verification', p_case, v_uid) then
    raise exception 'Not authorized to verify this exit case';
  end if;
  if v_proposed is null then
    raise exception 'A proposed last working day is required';
  end if;
  if not v_applicable and coalesce(trim(p->>'policy_na_reason'), '') = '' then
    raise exception 'Say why the notice policy does not apply';
  end if;

  update public.fms_exit_cases set
    notice_period_days = coalesce(nullif(p->>'notice_period_days','')::integer, notice_period_days),
    notice_waived      = coalesce((p->>'notice_waived')::boolean, false),
    policy_applicable  = v_applicable,
    policy_na_reason   = case when v_applicable then null else trim(p->>'policy_na_reason') end,
    proposed_lwd       = v_proposed,
    hr_verified_at     = now(),
    hr_verifier_id     = v_uid,
    hr_remarks         = nullif(trim(p->>'hr_remarks'), ''),
    status             = 'head_approval',
    current_step       = 'hr_head_approval'
  where id = p_case;
end $$;
grant execute on function public.fms_exit_hr_verify(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — the HR Head's decision. THE ONLY ACTOR WHO CAN TERMINALLY REJECT A CASE.
--   approve → status 'clearance', step 'lwd_confirm' (M3 confirms the LWD and
--             seeds the clearance checklist from it)
--   reject  → terminal 'rejected' (+ a reason, always)
-- ===========================================================================
drop function if exists public.fms_exit_decide_case(uuid, text, text);
create or replace function public.fms_exit_decide_case(
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
  v_status text;
  v_uid    uuid := auth.uid();
begin
  if p_decision not in ('approve','reject') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  select status into v_status from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status <> 'head_approval' then
    raise exception 'This case is not awaiting HR Head approval (status %)', v_status;
  end if;
  if not public.fms_exit_can_act('hr_head_approval', p_case, v_uid) then
    raise exception 'Not authorized to decide this exit case';
  end if;
  if p_decision = 'reject' and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting an exit case';
  end if;

  if p_decision = 'approve' then
    update public.fms_exit_cases set
      approved_at      = now(),
      approver_id      = v_uid,
      approval_remarks = nullif(trim(p_remarks), ''),
      status           = 'clearance',
      current_step     = 'lwd_confirm'
    where id = p_case;
  else
    update public.fms_exit_cases set
      approved_at      = null,
      approver_id      = v_uid,
      approval_remarks = nullif(trim(p_remarks), ''),
      rejected_at      = now(),
      reject_reason    = trim(p_remarks),
      status           = 'rejected',
      current_step     = 'hr_head_approval'
    where id = p_case;
  end if;
end $$;
grant execute on function public.fms_exit_decide_case(uuid, text, text) to authenticated;

-- ===========================================================================
-- RPC — the employee retracts. Allowed right up until the money has moved:
-- `fnf_paid_at is null and archived_at is null`. Once the F&F is paid, "I changed
-- my mind" is a re-hire, not a withdrawal.
-- ===========================================================================
drop function if exists public.fms_exit_withdraw_case(uuid, text);
create or replace function public.fms_exit_withdraw_case(p_case uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_emp    uuid;
  v_raiser uuid;
  v_paid   timestamptz;
  v_arch   timestamptz;
  v_uid    uuid := auth.uid();
begin
  select status, employee_user_id, raised_by, fnf_paid_at, archived_at
    into v_status, v_emp, v_raiser, v_paid, v_arch
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This case is already %', v_status;
  end if;
  if v_paid is not null or v_arch is not null then
    raise exception 'The full & final has already been settled — this case can no longer be withdrawn';
  end if;
  if not (v_emp = v_uid
          or v_raiser = v_uid
          or public.is_admin(v_uid)
          or public.fms_exit_is_coordinator(v_uid)
          or public.fms_exit_is_step_owner('hr_verification', v_uid)) then
    raise exception 'Only the employee, the person who raised it, or HR can withdraw this case';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to withdraw'; end if;

  update public.fms_exit_cases set
    status          = 'withdrawn',
    withdrawn_at    = now(),
    withdraw_reason = trim(p_reason)
  where id = p_case;
end $$;
grant execute on function public.fms_exit_withdraw_case(uuid, text) to authenticated;

-- ===========================================================================
-- RPC — park a case (a disputed termination, a negotiation, a legal hold).
--
-- `on_hold` IS A STATUS, NEVER A StepKey. A held case leaves EVERY queue and is
-- counted on its own strip with a days-parked number — never inside a red count.
-- Resuming returns it to the step its own timestamps say it had reached.
-- ===========================================================================
drop function if exists public.fms_exit_hold_case(uuid, boolean, text);
create or replace function public.fms_exit_hold_case(p_case uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
begin
  select status into v_status from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_exit_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold an exit case';
  end if;

  if p_hold then
    if v_status in ('withdrawn','rejected','archived','on_hold') then
      raise exception 'A % case cannot be put on hold', v_status;
    end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_exit_cases
       set status = 'on_hold', hold_at = now(), hold_reason = trim(p_reason)
     where id = p_case;
  else
    if v_status <> 'on_hold' then raise exception 'This case is not on hold'; end if;
    update public.fms_exit_cases
       set status = public.fms_exit_resume_status(p_case),
           hold_at = null,
           hold_reason = null
     where id = p_case;
  end if;
end $$;
grant execute on function public.fms_exit_hold_case(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — skip a step, with a reason.
--
-- The one generic mechanism for every real-world hole (see fms_exit_step_skips).
-- HR Head / coordinator / admin only: waiving a step is a policy decision, not a
-- data-entry one.
--
-- The approval chain and `archive` are NOT skippable — see the table comment.
-- ===========================================================================
drop function if exists public.fms_exit_skip_step(uuid, text, text);
create or replace function public.fms_exit_skip_step(p_case uuid, p_step text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
begin
  select status into v_status from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'A % case has no open steps to skip', v_status;
  end if;
  if not (public.is_admin(v_uid)
          or public.fms_exit_is_coordinator(v_uid)
          or public.fms_exit_is_step_owner('hr_head_approval', v_uid)) then
    raise exception 'Only the HR Head, a process coordinator or an admin can skip a step';
  end if;
  if p_step not in ('clearance','asset_return','handover','exit_interview',
                    'leave_verification','payroll_inputs',
                    'fnf_generate','fnf_approve','fnf_payment','documents') then
    raise exception 'Step % cannot be skipped', p_step;
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'A reason is required to skip a step — a silent skip is a lost step';
  end if;

  insert into public.fms_exit_step_skips (case_id, step_key, reason, skipped_by)
  values (p_case, p_step, trim(p_reason), v_uid)
  on conflict (case_id, step_key) do update
    set reason = excluded.reason, skipped_by = excluded.skipped_by, skipped_at = now();
end $$;
grant execute on function public.fms_exit_skip_step(uuid, text, text) to authenticated;

-- ===========================================================================
-- STORAGE — ADDITIVE ONLY. The 4 staff policies from 20260714120000 are UNTOUCHED.
-- Postgres OR-combines permissive policies, so each of these purely WIDENS access
-- for one narrowly-scoped path. (The idiom: 20260703140000_add_app_leads.sql:96 and
-- 20260708130000_add_leads_media_dashboard_read.sql.)
-- ===========================================================================

-- 1. THE SHARE PREFIX — the entire reason it exists.
--    cases/<caseId>/share/… holds the relieving letter, the experience letter, the
--    final F&F copy and the signed acknowledgement. It is the ONE prefix the exiting
--    employee themselves may read. Everything else in the bucket — the interview
--    notes, the F&F working, the clearance evidence — stays staff-only.
drop policy if exists "fms exit docs employee share read" on storage.objects;
create policy "fms exit docs employee share read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'share'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and c.employee_user_id = auth.uid()
    )
  );

-- 2. THE RESIGNATION LETTER. Without this, an ordinary employee cannot attach the
--    letter their own resignation requires: the M1 insert policy is staff-only, and
--    a self-service raiser is by definition not staff. Scoped to
--    cases/<their own case>/resignation/… and only while the case is unapproved —
--    they can write nowhere else in the bucket, ever.
drop policy if exists "fms exit docs raiser resignation insert" on storage.objects;
create policy "fms exit docs raiser resignation insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'resignation'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and (c.employee_user_id = auth.uid() or c.raised_by = auth.uid())
        and c.approved_at is null
    )
  );

drop policy if exists "fms exit docs raiser resignation read" on storage.objects;
create policy "fms exit docs raiser resignation read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'resignation'
    and exists (
      select 1 from public.fms_exit_cases c
      where c.id::text = (storage.foldername(name))[2]
        and (c.employee_user_id = auth.uid() or c.raised_by = auth.uid())
    )
  );
