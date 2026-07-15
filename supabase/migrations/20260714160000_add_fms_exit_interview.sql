-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — THE EXIT INTERVIEW (Phase 5, M5).
-- THE FIRST CONFIDENTIAL SATELLITE.
--
-- Table:
--   fms_exit_interviews — 1:1 with the case (the case id IS the primary key)
--
-- RPC:
--   fms_exit_record_interview(p_case uuid, p jsonb)
--
-- ---------------------------------------------------------------------------
-- ⚠⚠ THE ONE RULE THAT DEFINES THIS MIGRATION ⚠⚠
--
--   SELECT on fms_exit_interviews
--     = admin ∨ fms_exit_is_coordinator ∨ fms_exit_is_hr_confidential
--     AND NOBODY ELSE.
--
--   NOT the reporting manager. NOT the employee. NOT the IT / Admin / Travel-Desk
--   clearance owners (who ARE exit staff, and must still read nothing here).
--
--   An exit interview exists to say things ABOUT THE MANAGER. If the manager can
--   read it, it is not an exit interview — it is a performance review with extra
--   steps, and the next person who is asked to be candid will not be.
--
--   fms_exit_cases is the WIDE-READ header (the clearance crowd, the manager, the
--   raiser and the employee all open it to do their jobs) — which is precisely why
--   the interview does not live on it. The FACT that the interview happened lives on
--   the header as fms_exit_cases.interview_done_at (added in M2), so the queues, the
--   stepper and the Control Center can show done / not-done WITHOUT LEAKING A WORD
--   of the content. A non-reader gets ZERO ROWS from this table and still sees the
--   correct chip. "Not visible" and "not recorded" are different facts; the header
--   carries the second one so this table never has to soften the first.
-- ---------------------------------------------------------------------------
-- ⚠ STORAGE — AND WHY A NEW POLICY ALONE WOULD HAVE BEEN A NO-OP.
--
--   The M1 bucket policies ("fms exit docs read/insert/update/delete") are gated on
--   fms_exit_is_exit_staff() ∨ fms_exit_is_coordinator() — which INCLUDES the Admin
--   and IT clearance owners, who must not read the interview file.
--
--   POSTGRES OR-COMBINES PERMISSIVE POLICIES. So merely ADDING a narrow permissive
--   policy for the interview/ prefix restricts NOTHING: the broad M1 read policy
--   would still hand the file to any exit staff. A narrower permissive policy can
--   only ever widen.
--
--   The fix is therefore a RESTRICTIVE policy, which Postgres AND-combines with the
--   OR of the permissive ones. That is PURELY ADDITIVE — no existing policy is
--   dropped, altered or replaced, and the M1/M2/M3/M4 policies are untouched:
--
--       (permissive₁ OR permissive₂ OR …) AND restrictive
--
--   It is scoped so that it is a no-op for every object that is NOT
--   fms-exit-docs/cases/<caseId>/interview/… — every other bucket in this project
--   (leads media, purchase docs, HR docs) and every other prefix in this one short-
--   circuits to TRUE on its first disjunct and is completely unaffected.
--
--   `is distinct from` (not `<>`) throughout: storage.foldername() returns NULL for
--   a path with too few segments, and NULL <> 'interview' is NULL, not TRUE — which
--   would make the restrictive policy FAIL and lock the whole bucket.
--
--   No new PERMISSIVE policy is needed. fms_exit_is_hr_confidential(uid) ⊆
--   fms_exit_is_exit_staff(uid) by construction (its three step keys are step keys,
--   and none of them is `resignation`), and coordinators are covered by M1 — so the
--   people who MAY read the interview file already pass the permissive layer. The
--   restrictive policy simply removes everybody else.
-- ---------------------------------------------------------------------------
--
-- Purely ADDITIVE. Reverses (in order):
--   drop policy "fms exit interview files are hr confidential" on storage.objects;
--   drop function if exists public.fms_exit_record_interview(uuid, jsonb);
--   drop table if exists public.fms_exit_interviews;
-- ===========================================================================

-- ===========================================================================
-- fms_exit_interviews — 1:1 with the case. The case id IS the primary key: there is
-- one exit interview, and a second row would be a second version of what was said.
-- Correcting an interview UPDATES IN PLACE (the RPC upserts) rather than growing a
-- second transcript that disagrees with the first.
-- ===========================================================================
create table if not exists public.fms_exit_interviews (
  case_id              uuid primary key references public.fms_exit_cases on delete cascade,

  -- Who held it. NOT necessarily auth.uid(): HR often keys in an interview that the
  -- HR Head or a skip-level manager actually conducted.
  conducted_by         uuid references auth.users on delete set null,
  conducted_on         date,

  -- The reason the LEAVER gave, in the room — which is very often not the reason on
  -- the resignation letter (fms_exit_cases.reason_id). Keeping both is the entire
  -- point of the attrition-reason report: the gap between them IS the finding.
  primary_reason_id    uuid references public.fms_exit_reasons on delete set null,
  would_rehire         boolean,
  remarks              text,

  -- Structured ratings, kept OPEN-ENDED on purpose. Every company changes its exit
  -- questionnaire; a column per question would make that a migration, and a dropped
  -- column would erase the answers people already gave. The frontend owns the shape.
  feedback             jsonb   not null default '{}'::jsonb,

  -- The sheet's "Exit Feedback Update on Portal" — a manual flag, because the portal
  -- in question is somebody else's system and there is nothing here to integrate with.
  portal_feedback_done boolean not null default false,

  file_path            text,   -- the signed interview form / notes → cases/<id>/interview/…
  file_name            text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.fms_exit_interviews is
  'THE CONFIDENTIAL SATELLITE. What was actually said at the exit interview. SELECT = admin | coordinator | fms_exit_is_hr_confidential ONLY — never the reporting manager (the interview exists to say things about them) and never the employee. The FACT that it happened lives on fms_exit_cases.interview_done_at, so every queue can show done/not-done without leaking a word.';

comment on column public.fms_exit_interviews.feedback is
  'Structured ratings, open-ended by design: the questionnaire changes, and a column per question would make that a migration while a dropped column would erase answers already given.';

drop trigger if exists trg_fms_exit_interviews_updated on public.fms_exit_interviews;
create trigger trg_fms_exit_interviews_updated
  before update on public.fms_exit_interviews
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ⭐ RLS — THE NARROW GATE. THE WHOLE POINT OF THE PHASE.
--
-- Note what is NOT here: fms_exit_can_read_case(). Every other satellite uses it —
-- and it is true for the reporting managers, the employee, the raiser and every
-- clearance owner. Using it here would hand the manager the transcript of an
-- interview held to discuss the manager.
--
-- fms_exit_is_exit_staff() is ALSO too wide: the Admin and IT clearance owners own
-- real steps and are staff, and they have no business reading this either.
--
-- fms_exit_is_hr_confidential(uid) (defined in M1) is exactly the right set: the
-- owners of hr_verification | hr_head_approval | exit_interview — the three people
-- who need the content to do their job. Plus coordinators and admins.
--
-- INSERT/UPDATE carry the same gate. Writes go through the RPC anyway (which
-- re-checks with fms_exit_can_act), but a table whose read gate is narrower than its
-- write gate is one PostgREST call away from being a write-only leak.
-- ===========================================================================
alter table public.fms_exit_interviews enable row level security;

drop policy if exists fms_exit_interviews_select on public.fms_exit_interviews;
create policy fms_exit_interviews_select on public.fms_exit_interviews
  for select to authenticated
  using (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_hr_confidential(auth.uid())
  );

drop policy if exists fms_exit_interviews_write on public.fms_exit_interviews;
create policy fms_exit_interviews_write on public.fms_exit_interviews
  for all to authenticated
  using (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_hr_confidential(auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
    or public.fms_exit_is_hr_confidential(auth.uid())
  );

-- ===========================================================================
-- RPC — RECORD (or CORRECT) THE EXIT INTERVIEW.
--
-- The house shape: SECURITY DEFINER → lock the case → validate the status → re-check
-- authz via fms_exit_can_act() → validate the inputs → stamp the step's own timestamp
-- on the domain row → announce.
--
-- ⚠ THE ANNOUNCE MUST NOT QUOTE THE FEEDBACK. It fans out to step owners and writes a
--   row to fms_exit_activity, which is readable by exit staff and coordinators — a set
--   that includes people this table deliberately excludes. "Exit interview recorded for
--   EXIT-…", and not one word more. A notification that leaked the remark would undo
--   the entire RLS policy above, from inside a SECURITY DEFINER function, silently.
--
-- ⚠ interview_done_at IS COALESCED, NOT OVERWRITTEN. The step completed the first time
--   the interview was recorded; correcting a typo in the remarks three days later is
--   not a second interview, and re-stamping would silently move an SLA that was met.
--
-- UPSERT on the case id: an interview can be corrected, and correcting it must update
-- in place rather than duplicate (the primary key makes that structural, not hopeful).
-- ===========================================================================
drop function if exists public.fms_exit_record_interview(uuid, jsonb);
create or replace function public.fms_exit_record_interview(p_case uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_lwd     date;
  v_no      text;
  v_by      uuid;
  v_on      date;
  v_reason  uuid;
  v_rehire  boolean;
  v_feedback jsonb;
begin
  select status, lwd, exit_no
    into v_status, v_lwd, v_no
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  -- Authorization FIRST, and it is fms_exit_can_act('exit_interview', …) — i.e. the
  -- configured owner of the exit_interview step, a coordinator, or an admin. It is NOT
  -- a manager step, so the manager branch inside can_act() never fires for it.
  if not public.fms_exit_can_act('exit_interview', p_case, v_uid) then
    raise exception 'Not authorized to record the exit interview on this exit case';
  end if;

  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its exit interview no longer applies', v_status;
  end if;
  -- The interview is due BEFORE the last working day (lib/sla.ts: before = true), so
  -- it is dated from it. There is nothing to schedule, and nothing to be late for,
  -- until that date exists.
  if v_lwd is null then
    raise exception 'Confirm the last working day first — the exit interview is dated from it';
  end if;

  -- Who held it. Defaults to the caller, but HR legitimately keys in an interview the
  -- HR Head conducted, so the payload can name someone else.
  v_by     := coalesce(nullif(p->>'conducted_by', '')::uuid, v_uid);
  -- A business date. Defaults to TODAY rather than being left null: an interview with
  -- no date reads as held and reports as never.
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
    -- A new upload replaces the old one; NO upload leaves the existing file alone, so
    -- ticking "feedback updated on the portal" cannot silently detach the interview form.
    file_path            = coalesce(excluded.file_path, public.fms_exit_interviews.file_path),
    file_name            = coalesce(excluded.file_name, public.fms_exit_interviews.file_name);

  -- ---- The FACT, on the WIDE-READ header. The content stays here. ----
  -- Coalesced: the step completed when the interview was FIRST recorded. See the header.
  update public.fms_exit_cases set
    interview_done_at = coalesce(interview_done_at, now())
  where id = p_case;

  -- ⚠ NOT ONE WORD OF THE FEEDBACK. See the header. This lands in a bell the reporting
  --   manager can read, and in an activity trail every clearance owner can read.
  perform public.fms_exit_announce(
    'case', p_case, 'interview_recorded',
    'Exit interview recorded for ' || v_no || '.',
    public.fms_exit_step_owner_ids('hr_verification')
      || public.fms_exit_step_owner_ids('hr_head_approval'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_record_interview(uuid, jsonb) to authenticated;

-- ===========================================================================
-- ⭐ STORAGE — cases/<caseId>/interview/… IS HR-CONFIDENTIAL.
--
-- A RESTRICTIVE policy, and it has to be. See the file header: adding a narrow
-- PERMISSIVE policy would restrict nothing, because Postgres OR-combines permissive
-- policies and the broad M1 read policy would still hand the file to any exit staff —
-- including the Admin and IT clearance owners this whole phase exists to exclude.
--
-- Restrictive policies AND-combine, so this is purely ADDITIVE: no existing policy is
-- dropped, altered or replaced. Every object outside
-- fms-exit-docs/cases/<id>/interview/ short-circuits to TRUE on its first disjunct and
-- is completely unaffected — every other bucket in this project, and every other prefix
-- in this one.
--
-- `for all`, not just `for select`: an Admin/IT clearance owner has no business
-- overwriting or deleting the interview form either, and the M1 update/delete/insert
-- policies would otherwise let them.
-- ===========================================================================
drop policy if exists "fms exit interview files are hr confidential" on storage.objects;
create policy "fms exit interview files are hr confidential" on storage.objects
  as restrictive
  for all to authenticated
  using (
    bucket_id is distinct from 'fms-exit-docs'
    or (storage.foldername(name))[1] is distinct from 'cases'
    or (storage.foldername(name))[3] is distinct from 'interview'
    or public.fms_exit_is_hr_confidential(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
  )
  with check (
    bucket_id is distinct from 'fms-exit-docs'
    or (storage.foldername(name))[1] is distinct from 'cases'
    or (storage.foldername(name))[3] is distinct from 'interview'
    or public.fms_exit_is_hr_confidential(auth.uid())
    or public.fms_exit_is_coordinator(auth.uid())
  );
