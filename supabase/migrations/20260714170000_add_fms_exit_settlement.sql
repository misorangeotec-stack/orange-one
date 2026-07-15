-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — THE SETTLEMENT (Phase 6, M6).
-- THE SECOND CONFIDENTIAL SATELLITE. THE MONEY.
--
-- Tables:
--   fms_exit_settlements   — 1:1 with the case (the case id IS the primary key):
--                            leave verification → payroll inputs → F&F → approval → payment
--   fms_exit_payroll_lines — free-form additions / deductions off the payroll-heads master
--
-- Helper:
--   fms_exit_step_done(case, step)          — timestamp OR skipped. THE guard primitive.
--   fms_exit_can_read_settlement(case, uid) — the read gate (see below)
--
-- RPCs (house shape: SECURITY DEFINER → select … for update → validate status →
-- fms_exit_can_act() → validate inputs → stamp THE STEP'S OWN timestamp on the header):
--   fms_exit_verify_leave(p_case, p)
--   fms_exit_record_payroll_inputs(p_case, p)     — replaces the payroll lines
--   fms_exit_generate_fnf(p_case, p)              — REFUSES without leave + payroll
--   fms_exit_approve_fnf(p_case, p_approve, p_remarks) — REFUSES without generation
--   fms_exit_release_fnf_payment(p_case, p)       — REFUSES without approval
--
-- ---------------------------------------------------------------------------
-- ⚠⚠ THE CARDINAL RULE: **RECORD, DON'T COMPUTE.** ⚠⚠
--
--   This portal holds NO SALARY DATA and NO LEAVE-BALANCE DATA. There is no HRIS
--   here, no CTC column, no payroll register. Any "net payable" this application
--   calculated would therefore be FICTION — a number with the authority of a
--   database column and the provenance of a guess, sitting next to a real one from
--   payroll, disagreeing with it.
--
--   So `fnf_amount` IS NULLABLE and there is NO SETTLEMENT CALCULATOR. What this
--   table does is CAPTURE what payroll and accounts say, ATTACH the F&F working as a
--   file, and TRACK WHO APPROVED IT AND WHO PAID IT. The payroll lines may be summed
--   FOR DISPLAY (the panel does, and labels it as such) — but a derived total is
--   never persisted here as though it were authoritative. The flow completes with
--   fnf_amount left NULL, and that is a supported path, not a hole.
-- ---------------------------------------------------------------------------
-- ⚠⚠ THE READ GATE — AND WHO IS DELIBERATELY NOT ON IT ⚠⚠
--
--   SELECT = is_admin ∨ fms_exit_is_coordinator ∨ fms_exit_is_finance_staff
--          ∨ THE LEAVER THEMSELVES, **BUT ONLY ONCE fnf_approved_at IS NOT NULL**.
--
--   They are entitled to their statement. They are NOT entitled to watch the numbers
--   being keyed — to see the notice recovery being argued over, an incentive appear
--   and disappear, a loan recovery being typed in and corrected. An approved F&F is a
--   position the company has taken; an in-progress one is a working.
--
--   And THE REPORTING MANAGER IS NOT ON THIS LIST AT ALL. Not before, not after, not
--   ever. A manager has no business reading a subordinate's settlement — their notice
--   recovery, their loan balance, what they were paid to leave. `fms_exit_can_read_case()`
--   (the header's gate) IS true for them, which is exactly why the money does not live
--   on the header.
--
--   fms_exit_is_exit_staff() is TOO WIDE here as well: the Admin and the IT clearance
--   owners own real steps and are staff, and they read the case header quite happily.
--   fms_exit_is_finance_staff() (M1) names the five steps whose owners actually need
--   the numbers — leave_verification | payroll_inputs | fnf_generate | fnf_approve |
--   fnf_payment — and nobody else.
--
--   ⚠ THE FACT lives on the WIDE-READ header: fnf_generated_at / fnf_approved_at /
--     fnf_paid_at (M2). Every chip, stepper node, queue and scoreboard reads THOSE.
--     A non-reader gets ZERO ROWS from this table — which means "not visible", NEVER
--     "not recorded". Conflating the two is how a leak gets papered over into a lie.
-- ---------------------------------------------------------------------------
-- ⚠⚠ THE SEQUENCE IS ENFORCED **HERE**, NOT IN THE UI ⚠⚠
--
--   generate → REFUSED unless leave verification AND payroll inputs are done.
--              (You cannot work out a settlement before its inputs exist.)
--   approve  → REFUSED unless the F&F has been generated. ("Approve what, exactly?")
--   pay      → REFUSED unless the F&F has been approved.
--
--   Every one of those guards reads fms_exit_step_done() — **TIMESTAMP *OR* SKIPPED** —
--   never the raw column. A skipped step is complete-with-a-reason and satisfies the
--   downstream guards, exactly as lib/queues.ts `stepDone()` says in TypeScript. That
--   is what stops an absconder — whose payroll step was legitimately waived because
--   there is nothing to key — from being PERMANENTLY WEDGED with an F&F that can never
--   be generated. A guard reading `payroll_done_at is not null` would do precisely that,
--   and the UI would still offer the button (openSteps() uses stepDone), so the user
--   would click into a raise they could do nothing about.
-- ---------------------------------------------------------------------------
-- ⚠ STORAGE — AND WHY A NEW PERMISSIVE POLICY WOULD HAVE BEEN A NO-OP.
--
--   The M1 bucket policies are gated on fms_exit_is_exit_staff() ∨ is_coordinator() —
--   which INCLUDES the Admin and IT clearance owners, who must not read the F&F working.
--   POSTGRES OR-COMBINES PERMISSIVE POLICIES, so adding a narrow permissive policy for
--   cases/<id>/fnf/ would restrict NOTHING: the broad M1 read policy would still hand
--   them the file. A narrower permissive policy can only ever WIDEN.
--
--   So: a RESTRICTIVE policy (Postgres AND-combines those), exactly as M5 did for the
--   interview prefix. Purely ADDITIVE — no existing policy is dropped, altered or
--   replaced, and every object that is not fms-exit-docs/cases/<id>/fnf/… short-circuits
--   to TRUE on its first disjunct and is completely unaffected.
--
--   ⚠ IT MUST NOT CATCH `share/`. cases/<id>/share/… is the ONE prefix the employee may
--     read (M2's "fms exit docs employee share read"), and the FINAL F&F COPY is written
--     there on purpose — the leaver is entitled to their own statement. The restrictive
--     policy below tests [3] = 'fnf', so a share/ object passes it on the third disjunct.
--
--   ⚠ `is distinct from`, never `<>`: storage.foldername() returns NULL on a short path,
--     and NULL <> 'fnf' is NULL — not TRUE — which would make the restrictive policy FAIL
--     and LOCK THE ENTIRE BUCKET, for everyone, for every prefix.
--
-- Purely ADDITIVE. Reverses (in order):
--   drop policy "fms exit fnf files are finance confidential" on storage.objects;
--   drop function if exists public.fms_exit_release_fnf_payment(uuid, jsonb);
--   drop function if exists public.fms_exit_approve_fnf(uuid, boolean, text);
--   drop function if exists public.fms_exit_generate_fnf(uuid, jsonb);
--   drop function if exists public.fms_exit_record_payroll_inputs(uuid, jsonb);
--   drop function if exists public.fms_exit_verify_leave(uuid, jsonb);
--   drop function if exists public.fms_exit_can_read_settlement(uuid, uuid);
--   drop function if exists public.fms_exit_step_done(uuid, text);
--   drop table if exists public.fms_exit_payroll_lines, public.fms_exit_settlements;
-- ===========================================================================

-- ===========================================================================
-- fms_exit_step_done — THE GUARD PRIMITIVE. Timestamp OR skipped.
--
-- The SQL mirror of `stepDone()` in lib/queues.ts, and it exists so the three F&F
-- guards below cannot drift from the UI that offers their buttons. openSteps() opens
-- fnf_generate when leave AND payroll are *done-or-skipped*; if the RPC's guard read
-- the raw timestamps instead, the UI would offer a button the database always refuses.
--
-- lwd_confirm has no timestamp column of its own — the confirmed `lwd` DATE *is* its
-- completion. Same rule as exitStepCompletedIso().
-- ===========================================================================
create or replace function public.fms_exit_step_done(p_case uuid, p_step text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.fms_exit_step_skips s
           where s.case_id = p_case and s.step_key = p_step
         )
      or exists (
           select 1 from public.fms_exit_cases c
           where c.id = p_case
             and (case p_step
                    when 'resignation'        then c.submitted_at
                    when 'manager_review'     then c.manager_reviewed_at
                    when 'hr_verification'    then c.hr_verified_at
                    when 'hr_head_approval'   then c.approved_at
                    when 'lwd_confirm'        then c.lwd::timestamptz
                    when 'clearance'          then c.clearance_completed_at
                    when 'asset_return'       then c.assets_returned_at
                    when 'handover'           then c.handover_completed_at
                    when 'exit_interview'     then c.interview_done_at
                    when 'leave_verification' then c.leave_verified_at
                    when 'payroll_inputs'     then c.payroll_done_at
                    when 'fnf_generate'       then c.fnf_generated_at
                    when 'fnf_approve'        then c.fnf_approved_at
                    when 'fnf_payment'        then c.fnf_paid_at
                    when 'documents'          then c.documents_issued_at
                    when 'archive'            then c.archived_at
                  end) is not null
         );
$$;
comment on function public.fms_exit_step_done(uuid, text) is
  'Is this step behind us? TIMESTAMP OR SKIPPED — a skipped step is complete-with-a-reason and satisfies every downstream guard. The SQL mirror of stepDone() in lib/queues.ts; change one, change the other.';
grant execute on function public.fms_exit_step_done(uuid, text) to authenticated;

-- ===========================================================================
-- fms_exit_settlements — 1:1 with the case. The case id IS the primary key: there is
-- one settlement, and a second row would be a second version of what someone is owed.
-- Correcting it UPDATES IN PLACE (every RPC below upserts).
-- ===========================================================================
create table if not exists public.fms_exit_settlements (
  case_id                 uuid primary key references public.fms_exit_cases on delete cascade,

  -- ---- LEAVE VERIFICATION (HR) — the F&F's first input ---------------------
  -- The portal holds no leave ledger. These are what HR READS OFF the leave system
  -- and states for the record, not something derived here.
  leave_balance_days      numeric(6,2),
  lwp_days                numeric(6,2),   -- leave without pay, in the final month
  encashable_days         numeric(6,2),   -- of the balance, what is actually payable
  leave_remarks           text,

  -- ---- PAYROLL INPUTS (the sheet's stage 8) — RECORDED, NOT CALCULATED -----
  -- Every one of these arrives from payroll. Nothing here is worked out by the app.
  lwp_completed           boolean not null default false,   -- "LWP processed in payroll"
  notice_recovery_days    numeric(6,2),
  notice_recovery_amount  numeric(12,2),
  incentive_amount        numeric(12,2),
  loan_recovery_amount    numeric(12,2),
  other_deductions        numeric(12,2),
  payroll_remarks         text,

  -- ---- THE F&F ------------------------------------------------------------
  -- ⚠⚠ NULLABLE, AND THAT IS THE WHOLE DESIGN. See the file header. There is no
  --    settlement calculator in this application and there must never be one: the
  --    portal does not hold a single salary figure, so any total it produced would be
  --    fiction wearing the authority of a database column. This is what payroll SAYS
  --    the number is — and if they have not said one yet, it stays NULL and the flow
  --    still completes.
  fnf_amount              numeric(12,2),
  -- The working — the actual F&F statement/sheet. Lives under cases/<id>/fnf/…, which
  -- is FINANCE-CONFIDENTIAL IN STORAGE (the restrictive policy at the foot of this file).
  fnf_file_path           text,
  fnf_file_name           text,
  fnf_remarks             text,

  -- Who decided, and what they said. ⚠ fnf_approved_by_id is THE DECIDER — on a
  -- REJECTION it is whoever sent it back. Whether that decision was an APPROVAL is told
  -- by fms_exit_cases.fnf_approved_at, and by nothing else.
  fnf_approved_by_id      uuid references auth.users on delete set null,
  fnf_approval_remarks    text,

  -- Who paid, how, and when. A business DATE (the day the money moved), never a
  -- timestamp derived from a browser clock.
  fnf_paid_on             date,
  fnf_payment_mode        text,           -- NEFT | RTGS | Cheque | Cash | …
  fnf_payment_ref         text,           -- UTR / cheque no. — "paid, somehow" is not a record
  fnf_paid_by_id          uuid references auth.users on delete set null,

  -- ⭐ THE EMPLOYEE'S OWN COPY → cases/<id>/share/…, NOT cases/<id>/fnf/….
  -- The leaver is ENTITLED TO THEIR STATEMENT. `share/` is the one prefix M2 lets them
  -- read; the `fnf/` working is not. Writing the final copy into fnf/ would leave them
  -- with a settlement they are told about and cannot open, so the RPC VALIDATES the
  -- prefix rather than trusting the caller to pick the right uploader.
  final_fnf_path          text,
  final_fnf_name          text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.fms_exit_settlements is
  'THE MONEY SATELLITE. RECORD, DON''T COMPUTE: the portal holds no salary or leave data, so fnf_amount is NULLABLE and there is no settlement calculator — this captures what payroll/accounts say, attaches the F&F working, and tracks who approved and who paid. SELECT = admin | coordinator | fms_exit_is_finance_staff | THE LEAVER, but only once fms_exit_cases.fnf_approved_at is set. NEVER the reporting manager. The FACTS (generated/approved/paid) live on the wide-read header.';

comment on column public.fms_exit_settlements.fnf_amount is
  'NULLABLE BY DESIGN. What payroll SAYS the net settlement is. Never derived here — the portal holds no salary data, so a computed total would be fiction. The flow completes with this left NULL.';

comment on column public.fms_exit_settlements.final_fnf_path is
  'The employee''s own copy of the final F&F, under cases/<id>/share/ — the one prefix the leaver may read. The RPC refuses any other prefix.';

comment on column public.fms_exit_settlements.fnf_approved_by_id is
  'WHO DECIDED — on a rejection, whoever sent it back. Whether the decision was an approval is told by fms_exit_cases.fnf_approved_at.';

drop trigger if exists trg_fms_exit_settlements_updated on public.fms_exit_settlements;
create trigger trg_fms_exit_settlements_updated
  before update on public.fms_exit_settlements
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_exit_payroll_lines — the free-form additions and deductions.
--
-- The six fixed payroll columns above cover what the sheet asks for every time. This
-- covers everything else — a gratuity, a bonus clawback, a relocation recovery, a
-- notice-period buyout — WITHOUT a migration per head. The heads come from the
-- fms_exit_payroll_heads master (M1, 10 rows seeded, kind = addition|deduction).
--
-- ⚠ head_name IS A SNAPSHOT, exactly as everywhere else in this module (the clearance
--   checks, the assets). head_id is `on delete set null` — PROVENANCE, not the label.
--   Renaming or deleting a master head next quarter must not rewrite what THIS leaver
--   was actually deducted, and a line whose name vanished with its master is a line
--   nobody can defend in a dispute.
--
-- ⚠ There is deliberately NO stored total. See the file header. The panel sums these
--   for DISPLAY and says so on the screen; nothing persists that sum as authoritative.
-- ===========================================================================
create table if not exists public.fms_exit_payroll_lines (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.fms_exit_cases on delete cascade,
  head_id     uuid references public.fms_exit_payroll_heads on delete set null,
  head_name   text not null,                                    -- SNAPSHOT
  kind        text not null check (kind in ('addition','deduction')),
  amount      numeric(12,2) not null default 0,
  remarks     text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists fms_exit_payroll_lines_case_idx on public.fms_exit_payroll_lines (case_id);

comment on table public.fms_exit_payroll_lines is
  'Free-form F&F additions / deductions. head_name is a SNAPSHOT of the payroll-heads master (head_id is provenance only, on delete set null). No total is stored — the app records these amounts, it does not compute a settlement.';

-- ===========================================================================
-- ⭐ RLS — THE NARROW GATE, AND THE ONE TIME-DEPENDENT CLAUSE IN THE MODULE.
-- ===========================================================================
create or replace function public.fms_exit_can_read_settlement(p_case uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_exit_is_coordinator(p_uid)
      or public.fms_exit_is_finance_staff(p_uid)
      -- ⭐ THE LEAVER — AND ONLY ONCE THE F&F HAS BEEN APPROVED.
      -- Entitled to the statement; not entitled to watch the numbers being keyed.
      -- NOTE what is absent: c.raised_by, and any clause on reporting_manager_ids.
      -- A manager has no business reading a subordinate's settlement, and someone who
      -- raised an exit ON BEHALF of a colleague has no business reading their F&F.
      or exists (
           select 1 from public.fms_exit_cases c
           where c.id = p_case
             and c.employee_user_id = p_uid
             and c.fnf_approved_at is not null
         );
$$;
comment on function public.fms_exit_can_read_settlement(uuid, uuid) is
  'The settlement read gate: admin | coordinator | finance staff | THE LEAVER once fnf_approved_at is set. Never the reporting manager, never the raiser, never the Admin/IT clearance owners.';
grant execute on function public.fms_exit_can_read_settlement(uuid, uuid) to authenticated;

-- Writes go through the RPCs (SECURITY DEFINER, re-checking fms_exit_can_act) — but a
-- table whose READ gate is narrower than its WRITE gate is one PostgREST call away from
-- being a write-only leak, so the write policy is the same narrow set MINUS the leaver.
alter table public.fms_exit_settlements enable row level security;

drop policy if exists fms_exit_settlements_select on public.fms_exit_settlements;
create policy fms_exit_settlements_select on public.fms_exit_settlements
  for select to authenticated
  using (public.fms_exit_can_read_settlement(case_id, auth.uid()));

drop policy if exists fms_exit_settlements_write on public.fms_exit_settlements;
create policy fms_exit_settlements_write on public.fms_exit_settlements
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_finance_staff(auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_finance_staff(auth.uid())
  );

-- The lines carry the same gate, joined through case_id. A per-head breakdown of
-- somebody's deductions is not less confidential than their total — it is more.
alter table public.fms_exit_payroll_lines enable row level security;

drop policy if exists fms_exit_payroll_lines_select on public.fms_exit_payroll_lines;
create policy fms_exit_payroll_lines_select on public.fms_exit_payroll_lines
  for select to authenticated
  using (public.fms_exit_can_read_settlement(case_id, auth.uid()));

drop policy if exists fms_exit_payroll_lines_write on public.fms_exit_payroll_lines;
create policy fms_exit_payroll_lines_write on public.fms_exit_payroll_lines
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_finance_staff(auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_finance_staff(auth.uid())
  );

-- ===========================================================================
-- RPC — VERIFY THE LEAVE BALANCE. The F&F's first input.
--
-- Dated BEFORE the last working day (lib/sla.ts: before = true) — a leave balance is
-- only final once the person stops accruing, which is why the RPC refuses without an
-- LWD: there is nothing to date, and nothing to be late for.
--
-- leave_verified_at is COALESCED, not overwritten: correcting a typo in the encashable
-- days three days later is not a second verification, and re-stamping would silently
-- move an SLA that was met.
-- ===========================================================================
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
  v_balance    numeric(6,2);
  v_lwp        numeric(6,2);
  v_encashable numeric(6,2);
begin
  select status, lwd, exit_no into v_status, v_lwd, v_no
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

  v_balance    := nullif(p->>'leave_balance_days', '')::numeric(6,2);
  v_lwp        := nullif(p->>'lwp_days', '')::numeric(6,2);
  v_encashable := nullif(p->>'encashable_days', '')::numeric(6,2);

  -- Days are days. A negative one is a typo, and it would flow straight into a payment.
  if coalesce(v_balance, 0) < 0 or coalesce(v_lwp, 0) < 0 or coalesce(v_encashable, 0) < 0 then
    raise exception 'Leave days cannot be negative';
  end if;
  -- You cannot encash more than the balance. This is the ONE arithmetic rule in the whole
  -- satellite, and it is a SANITY CHECK, not a computation: it rejects an impossible input,
  -- it does not derive a number nobody stated.
  if v_encashable is not null and v_balance is not null and v_encashable > v_balance then
    raise exception 'The encashable days (%) cannot exceed the leave balance (%)', v_encashable, v_balance;
  end if;

  insert into public.fms_exit_settlements (
    case_id, leave_balance_days, lwp_days, encashable_days, leave_remarks
  ) values (
    p_case, v_balance, v_lwp, v_encashable, nullif(trim(p->>'leave_remarks'), '')
  )
  on conflict (case_id) do update set
    leave_balance_days = excluded.leave_balance_days,
    lwp_days           = excluded.lwp_days,
    encashable_days    = excluded.encashable_days,
    leave_remarks      = excluded.leave_remarks;

  -- The FACT, on the wide-read header. Coalesced — see the RPC header.
  update public.fms_exit_cases set
    leave_verified_at = coalesce(leave_verified_at, now())
  where id = p_case;

  -- ⚠ NOT ONE NUMBER. This lands in fms_exit_activity, which every exit staffer —
  --   including the Admin and IT clearance owners — can read, and in a bell the
  --   reporting manager reads. The whole RLS policy above would be undone by a
  --   helpful sentence, from inside a SECURITY DEFINER function, silently.
  perform public.fms_exit_announce(
    'settlement', p_case, 'leave_verified',
    'Leave balance verified for ' || v_no || '.',
    public.fms_exit_step_owner_ids('payroll_inputs'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_verify_leave(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — RECORD THE PAYROLL INPUTS. The sheet's stage 8.
--
-- RECORDED, NOT CALCULATED — every number here arrives from payroll. The lines are
-- REPLACED wholesale (delete-then-insert inside one transaction): a payroll input sheet
-- is re-keyed as a whole, and merging it row by row would leave last week's withdrawn
-- deduction sitting in the F&F because nobody remembered to delete it.
--
-- payroll_done_at is COALESCED — see fms_exit_verify_leave.
-- ===========================================================================
drop function if exists public.fms_exit_record_payroll_inputs(uuid, jsonb);
create or replace function public.fms_exit_record_payroll_inputs(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_lwd    date;
  v_no     text;
  v_lines  jsonb;
  v_line   jsonb;
  v_head   uuid;
  v_name   text;
  v_kind   text;
  v_i      integer := 0;
begin
  select status, lwd, exit_no into v_status, v_lwd, v_no
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('payroll_inputs', p_case, v_uid) then
    raise exception 'Not authorized to record the payroll inputs on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its payroll inputs no longer apply', v_status;
  end if;
  -- The step is due at the payroll CUT-OFF of the month the LWD falls in (and rolls to
  -- the next month's if the LWD is after it — you cannot key a leaver's final payroll
  -- before their last day). No LWD, no cut-off, nothing to be late for.
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the payroll cut-off is derived from it';
  end if;

  insert into public.fms_exit_settlements (
    case_id, lwp_completed, notice_recovery_days, notice_recovery_amount,
    incentive_amount, loan_recovery_amount, other_deductions, payroll_remarks
  ) values (
    p_case,
    coalesce((p->>'lwp_completed')::boolean, false),
    nullif(p->>'notice_recovery_days', '')::numeric(6,2),
    nullif(p->>'notice_recovery_amount', '')::numeric(12,2),
    nullif(p->>'incentive_amount', '')::numeric(12,2),
    nullif(p->>'loan_recovery_amount', '')::numeric(12,2),
    nullif(p->>'other_deductions', '')::numeric(12,2),
    nullif(trim(p->>'payroll_remarks'), '')
  )
  on conflict (case_id) do update set
    lwp_completed          = excluded.lwp_completed,
    notice_recovery_days   = excluded.notice_recovery_days,
    notice_recovery_amount = excluded.notice_recovery_amount,
    incentive_amount       = excluded.incentive_amount,
    loan_recovery_amount   = excluded.loan_recovery_amount,
    other_deductions       = excluded.other_deductions,
    payroll_remarks        = excluded.payroll_remarks;

  -- ---- the free-form lines: REPLACE, never merge ----
  v_lines := coalesce(p->'lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'The payroll lines must be a JSON array';
  end if;

  delete from public.fms_exit_payroll_lines where case_id = p_case;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_head := nullif(v_line->>'head_id', '')::uuid;
    -- SNAPSHOT the name. Prefer what the caller sent (it is what they SAW on screen);
    -- fall back to the master. A line with neither is a line nobody can defend later.
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

    -- Amounts are recorded, not computed — but a NEGATIVE deduction is an addition
    -- wearing a disguise, and it would flip the sign of a total nobody checked.
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

  -- ⚠ NOT ONE NUMBER. See fms_exit_verify_leave.
  perform public.fms_exit_announce(
    'settlement', p_case, 'payroll_recorded',
    'Payroll inputs recorded for ' || v_no || '.',
    public.fms_exit_step_owner_ids('fnf_generate'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_record_payroll_inputs(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐ RPC — GENERATE THE F&F.
--
-- ⚠⚠ IT REFUSES UNLESS ITS INPUTS EXIST. `fms_exit_step_done` for BOTH
--    leave_verification AND payroll_inputs — timestamp OR SKIPPED. You cannot work out
--    a settlement before you know the leave balance and the deductions; but an
--    absconder whose payroll step was legitimately waived (there is nothing to key)
--    must not be permanently wedged, which is exactly why the guard is step_done and
--    not `payroll_done_at is not null`.
--
-- RECORD, DON'T COMPUTE: `fnf_amount` may be NULL and the flow still completes. The
-- real F&F is the ATTACHED WORKING — a sheet from payroll, with the arithmetic on it.
-- This RPC does not add anything up, and no future one may.
--
-- fnf_generated_at is COALESCED. It is also the column a REJECTION clears (see
-- fms_exit_approve_fnf), so a regenerated F&F re-stamps honestly.
-- ===========================================================================
drop function if exists public.fms_exit_generate_fnf(uuid, jsonb);
create or replace function public.fms_exit_generate_fnf(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_lwd    date;
  v_no     text;
  v_name   text;
  v_amount numeric(12,2);
  v_path   text;
begin
  select status, lwd, exit_no, employee_name into v_status, v_lwd, v_no, v_name
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

  -- ⭐⭐ THE SEQUENCE GUARD. The database enforces it, not the UI.
  if not public.fms_exit_step_done(p_case, 'leave_verification') then
    raise exception 'The leave balance has not been verified — the F&F cannot be worked out before its inputs exist (verify it, or waive the step with a reason)';
  end if;
  if not public.fms_exit_step_done(p_case, 'payroll_inputs') then
    raise exception 'The payroll inputs have not been recorded — the F&F cannot be worked out before its inputs exist (record them, or waive the step with a reason)';
  end if;

  v_amount := nullif(p->>'fnf_amount', '')::numeric(12,2);   -- may legitimately stay NULL
  v_path   := nullif(p->>'fnf_file_path', '');

  -- The working belongs under cases/<id>/fnf/ — the prefix the restrictive storage policy
  -- at the foot of this file makes finance-confidential. Anywhere else and it is readable
  -- by every exit staffer, including the Admin and IT clearance owners.
  if v_path is not null and v_path not like 'cases/' || p_case::text || '/fnf/%' then
    raise exception 'The F&F working must be stored under cases/%/fnf/ — that prefix is finance-confidential', p_case;
  end if;

  insert into public.fms_exit_settlements (case_id, fnf_amount, fnf_file_path, fnf_file_name, fnf_remarks)
  values (
    p_case, v_amount, v_path,
    nullif(p->>'fnf_file_name', ''),
    nullif(trim(p->>'fnf_remarks'), '')
  )
  on conflict (case_id) do update set
    fnf_amount    = excluded.fnf_amount,
    -- A new upload replaces the old; NO upload leaves the existing working alone, so
    -- correcting the amount cannot silently detach the sheet it came from.
    fnf_file_path = coalesce(excluded.fnf_file_path, public.fms_exit_settlements.fnf_file_path),
    fnf_file_name = coalesce(excluded.fnf_file_name, public.fms_exit_settlements.fnf_file_name),
    fnf_remarks   = excluded.fnf_remarks;

  update public.fms_exit_cases set
    fnf_generated_at = coalesce(fnf_generated_at, now()),
    -- The case is now in its Settlement phase. Consistent with fms_exit_resume_status(),
    -- which reads `fnf_generated_at is not null → settlement`, so a hold/resume round-trip
    -- lands back exactly here.
    status       = case when status in ('clearance','settlement') then 'settlement' else status end,
    current_step = case when status in ('clearance','settlement') then 'fnf_approve' else current_step end
  where id = p_case;

  -- ⚠ NO AMOUNT. Not in the bell, not in the activity trail. See fms_exit_verify_leave.
  perform public.fms_exit_announce(
    'settlement', p_case, 'fnf_generated',
    v_no || ' (' || v_name || ') — the full & final settlement has been prepared and needs approval.',
    public.fms_exit_step_owner_ids('fnf_approve'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_generate_fnf(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐ RPC — APPROVE (or REJECT) THE F&F.
--
-- ⚠⚠ IT REFUSES IF THE F&F HAS NOT BEEN GENERATED. Approve *what*, exactly? An
--    approval of a settlement that does not exist is a signature on a blank page, and it
--    would satisfy the payment guard below.
--
-- ⭐ WHAT A REJECTION DOES — the decision, documented:
--
--     • fnf_approved_at stays NULL (nothing was approved);
--     • fms_exit_cases.fnf_generated_at IS **CLEARED**;
--     • the settlement KEEPS its numbers and its attached working;
--     • fnf_approved_by_id = the rejecter, fnf_approval_remarks = why (REQUIRED);
--     • status/current_step fall back to fms_exit_resume_status() → 'clearance' / 'fnf_generate'.
--
--   Clearing fnf_generated_at is the whole mechanism, and it is deliberate: `openSteps()`
--   opens `fnf_generate` exactly when that stamp is absent, so the case REAPPEARS IN THE
--   PREPARER'S QUEUE, with its due date and its clock, until they fix it and regenerate.
--   The alternative — a `fnf_rejected` flag — would leave the case owed at NO step: it
--   would sit approved-not-approved in nobody's queue, and be found weeks later by the
--   employee asking where their money is. A rejected F&F is not a state; it is WORK,
--   and it belongs back with the person who has to redo it.
--
--   The numbers and the working are kept ON PURPOSE: the preparer is being asked to
--   CORRECT a sheet, not to key it again from nothing.
--
--   A rejection with no remark is refused. "Sent back" with no reason is a loop, not a
--   review.
-- ===========================================================================
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
  v_remarks text := nullif(trim(coalesce(p_remarks, '')), '');
begin
  select status, exit_no, employee_name into v_status, v_no, v_name
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('fnf_approve', p_case, v_uid) then
    raise exception 'Not authorized to approve the F&F on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its F&F no longer applies', v_status;
  end if;

  -- ⭐⭐ THE SEQUENCE GUARD.
  if not public.fms_exit_step_done(p_case, 'fnf_generate') then
    raise exception 'The F&F has not been generated yet — there is nothing to approve';
  end if;

  if not p_approve and v_remarks is null then
    raise exception 'Say why the F&F is being sent back — a rejection with no reason is a loop, not a review';
  end if;

  -- The settlement row exists by now (generate created it) — unless fnf_generate was
  -- WAIVED, in which case there may be nothing here at all. Upsert either way: a decision
  -- must be recorded even on a case whose F&F step was skipped.
  insert into public.fms_exit_settlements (case_id, fnf_approved_by_id, fnf_approval_remarks)
  values (p_case, v_uid, v_remarks)
  on conflict (case_id) do update set
    fnf_approved_by_id   = excluded.fnf_approved_by_id,
    fnf_approval_remarks = excluded.fnf_approval_remarks;

  if p_approve then
    update public.fms_exit_cases set
      fnf_approved_at = coalesce(fnf_approved_at, now()),
      current_step    = case when status = 'settlement' then 'fnf_payment' else current_step end
    where id = p_case;

    -- ⭐ The moment the LEAVER becomes able to read their own settlement
    -- (fms_exit_can_read_settlement's last clause turns true on this stamp). So they are
    -- told, and the notification is safe to send them: the fact, never the numbers.
    perform public.fms_exit_announce(
      'settlement', p_case, 'fnf_approved',
      v_no || ' (' || v_name || ') — the full & final settlement has been approved. It is now with accounts for payment.',
      public.fms_exit_step_owner_ids('fnf_payment')
        || public.fms_exit_step_owner_ids('documents'),
      jsonb_build_object('exit_no', v_no)
    );
  else
    -- ⭐ SENT BACK. Clearing the stamp puts it back in the preparer's queue. See the header.
    update public.fms_exit_cases set
      fnf_generated_at = null,
      current_step     = 'fnf_generate'
    where id = p_case;

    -- ⚠ A SEPARATE STATEMENT, DELIBERATELY. fms_exit_resume_status() reads the case row,
    --   and inside the UPDATE above it would still see the OLD (un-cleared)
    --   fnf_generated_at and hand back 'settlement' — the very state we are leaving.
    --   Run after the clear, it correctly reads 'clearance'.
    --   Scoped to status = 'settlement' so a HELD case stays held: resuming a parked case
    --   is fms_exit_hold_case's job, not a side effect of an F&F review.
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

-- ===========================================================================
-- ⭐ RPC — RELEASE THE F&F PAYMENT. The last thing anybody owes this person.
--
-- ⚠⚠ IT REFUSES IF THE F&F HAS NOT BEEN APPROVED. Money does not leave the company on
--    an unapproved working. (step_done, so a WAIVED approval — a case where there was
--    nothing to approve — still lets a recorded payment through.)
--
-- Records HOW and WHEN, not just "paid": a payment with no mode and no reference cannot
-- be traced when the leaver rings up in March saying it never arrived.
--
-- ⭐ AND IT ATTACHES THE LEAVER'S OWN COPY — under cases/<id>/share/, which the RPC
--    ENFORCES. `share/` is the one prefix M2 lets the employee read; the `fnf/` working
--    is finance-confidential. A final copy filed under fnf/ would be a settlement the
--    person is told about and cannot open. (Phase 7's archive refuses without it.)
-- ===========================================================================
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
  v_mode   text;
  v_ref    text;
  v_on     date;
  v_lwd    date;
  v_final  text;
begin
  select status, exit_no, employee_name, employee_user_id, lwd
    into v_status, v_no, v_name, v_emp, v_lwd
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  if not public.fms_exit_can_act('fnf_payment', p_case, v_uid) then
    raise exception 'Not authorized to release the F&F payment on this exit case';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its F&F no longer applies', v_status;
  end if;

  -- ⭐⭐ THE SEQUENCE GUARD.
  if not public.fms_exit_step_done(p_case, 'fnf_approve') then
    raise exception 'The F&F has not been approved — money does not leave on an unapproved settlement';
  end if;

  v_mode  := nullif(trim(p->>'fnf_payment_mode'), '');
  v_ref   := nullif(trim(p->>'fnf_payment_ref'), '');
  -- A business DATE. Defaults to today rather than being left null: a payment with no
  -- date reads as paid and reports as never.
  v_on    := coalesce(nullif(p->>'fnf_paid_on', '')::date, current_date);
  v_final := nullif(p->>'final_fnf_path', '');

  if v_mode is null then
    raise exception 'Record how the F&F was paid — "paid, somehow" cannot be traced when they ring up in March';
  end if;
  -- Nobody's final settlement was paid before their last working day.
  if v_lwd is not null and v_on < v_lwd then
    raise exception 'The F&F cannot have been paid (%) before the last working day (%)', v_on, v_lwd;
  end if;
  -- ⭐ THE EMPLOYEE'S COPY GOES UNDER share/. See the RPC header.
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
    fnf_paid_by_id   = excluded.fnf_paid_by_id,
    -- A new upload replaces the old; NO upload leaves the existing copy alone, so
    -- correcting a UTR cannot silently detach the statement the leaver was given.
    final_fnf_path   = coalesce(excluded.final_fnf_path, public.fms_exit_settlements.final_fnf_path),
    final_fnf_name   = coalesce(excluded.final_fnf_name, public.fms_exit_settlements.final_fnf_name);

  update public.fms_exit_cases set
    fnf_paid_at  = coalesce(fnf_paid_at, now()),
    -- The case stays in 'settlement' until the DOCUMENTS are issued (M7 moves it to
    -- 'closure'). The letters, not the bank transfer, are what close an exit.
    current_step = case when status = 'settlement' then 'documents' else current_step end
  where id = p_case;

  -- The leaver is told, because it is their money. The FACT only — no amount, no UTR,
  -- in a bell others can be cc'd on and an activity trail every exit staffer reads.
  perform public.fms_exit_announce(
    'settlement', p_case, 'fnf_paid',
    v_no || ' (' || v_name || ') — the full & final settlement has been paid.',
    (case when v_emp is null then '{}'::uuid[] else array[v_emp] end)
      || public.fms_exit_step_owner_ids('documents'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_release_fnf_payment(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐ STORAGE — cases/<caseId>/fnf/… IS FINANCE-CONFIDENTIAL.
--
-- A RESTRICTIVE policy, and it has to be. See the file header: a narrow PERMISSIVE
-- policy would restrict NOTHING, because Postgres OR-combines permissive policies and
-- M1's broad read policy would still hand the F&F working to any exit staffer —
-- including the Admin and IT clearance owners this phase exists to exclude.
--
-- Restrictive policies AND-combine, so this is purely ADDITIVE: no existing policy is
-- dropped, altered or replaced. Every object outside fms-exit-docs/cases/<id>/fnf/
-- short-circuits to TRUE on its first disjunct and is completely unaffected — every
-- other bucket in this project, and every other prefix in this one:
--
--   • cases/<id>/share/…      → [3] = 'share' ≠ 'fnf' → passes. THE EMPLOYEE STILL READS
--     THEIR FINAL F&F COPY AND THEIR LETTERS. Breaking that would be breaking the entire
--     reason the share/ prefix exists.
--   • cases/<id>/clearance/…  → passes. The IT owner still reads their own evidence file
--     — the control that proves this scoped a PREFIX and not the BUCKET.
--   • cases/<id>/interview/…  → passes THIS policy, and is caught by M5's own restrictive
--     one. Two restrictive policies AND together; each minds its own prefix.
--
-- `for all`, not just `for select`: an Admin/IT clearance owner has no business
-- overwriting or deleting the F&F working either, and M1's insert/update/delete policies
-- would otherwise let them.
--
-- ⚠ `is distinct from`, never `<>`. storage.foldername() returns NULL for a path with too
--   few segments, and NULL <> 'fnf' is NULL, not TRUE — which would make the restrictive
--   policy FAIL and lock the whole bucket for everyone.
--
-- No new PERMISSIVE policy is needed: fms_exit_is_finance_staff(uid) ⊆
-- fms_exit_is_exit_staff(uid) by construction (its five step keys are step keys, and none
-- of them is `resignation`), and coordinators are covered by M1 — so the people who MAY
-- read the F&F working already pass the permissive layer. This simply removes everybody else.
-- ===========================================================================
drop policy if exists "fms exit fnf files are finance confidential" on storage.objects;
create policy "fms exit fnf files are finance confidential" on storage.objects
  as restrictive
  for all to authenticated
  using (
    bucket_id is distinct from 'fms-exit-docs'
    or (storage.foldername(name))[1] is distinct from 'cases'
    or (storage.foldername(name))[3] is distinct from 'fnf'
    or public.fms_exit_is_finance_staff(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
  )
  with check (
    bucket_id is distinct from 'fms-exit-docs'
    or (storage.foldername(name))[1] is distinct from 'cases'
    or (storage.foldername(name))[3] is distinct from 'fnf'
    or public.fms_exit_is_finance_staff(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
  );
