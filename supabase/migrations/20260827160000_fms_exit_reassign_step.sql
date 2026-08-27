-- ===========================================================================
-- HR Exit — a step owner may HAND A STEP to someone else.
--
-- Fifth module, and it follows HR Recruitment's shape (20260827150000) rather
-- than the single-column shape of Import / Purchase / Office Supplies: an exit
-- case walks fifteen steps and the holder therefore has to be keyed on
-- (case, step). Read that file's header first; this one records the differences.
--
-- ⚠ THERE IS NO HARD STOP HERE — THE EXCLUSIVITY IS PLAINER THAN THAT.
-- Recruitment's hiring-manager branch `return`s with no fall-through, which made
-- seven of its steps unreachable by anyone else. Exit's equivalents deliberately
-- do NOT: both the manager branch and the clearance branch carry the comment
-- "NO early return" and fall through to the configured step owner. So nothing is
-- structurally sealed. The problem here is simply that **all fifteen rows in
-- fms_exit_step_owners hold exactly one person** — including hr_head_approval and
-- fnf_approve, the two approvals. Every step in this module is one absence away
-- from stalling, and unlike Purchase there is no second name to add because the
-- business has configured one everywhere.
--
-- ⚠ DO NOT NAME ANYTHING "HANDOVER" IN THIS MODULE.
-- `handover` is already a STEP KEY here and means the physical/knowledge handover
-- from the leaver to their team. The feature is called reassignment throughout —
-- fms_exit_reassign_step, fms_exit_step_assignees — and the word "handover" in
-- comments always refers to that step, never to this feature.
--
-- ⚠ IT INTERACTS WITH fms_exit_update_case, AND THE PRECEDENCE IS DELIBERATE.
-- That RPC can rewrite reporting_manager_ids, which is a de-facto reassignment
-- for manager_review / asset_return / handover: change the managers and those
-- steps change hands. The two must not contradict each other, so the rule is that
-- an explicit assignee WINS. While a row exists in fms_exit_step_assignees for
-- (case, step), editing the case's managers has no effect on who owes that step
-- until the assignee is released. That is the right way round — somebody chose a
-- person for this step on purpose, and a bulk manager edit should not silently
-- undo it — but it does mean a manager change that looks ignored is explained by
-- an outstanding assignee.
--
-- ⚠ THE READ GATE HAD TO BE WIDENED, as in Office Supplies and Recruitment.
-- fms_exit_cases' RLS select is fms_exit_can_read_case, whose module arm is
-- module_is_viewer — `module_level(...) = 'view'` EXACTLY. A receiver holding an
-- *edit* grant who is not the leaver, the raiser, a reporting manager or a
-- clearance owner matches nothing, so the case would not even load.
--
-- ⚠ NO LIVE CASES EXIST YET (fms_exit_cases is empty as of 2026-08-27). The
-- authorisation cases below were therefore proved against a synthetic case
-- created and rolled back inside the same transaction. Nothing was left behind,
-- and no real person's exit was touched.
--
-- ⚠⚠ A LIVE CONFIGURATION GAP THIS WORK EXPOSED, AND DID NOT CAUSE.
-- fms_exit_is_step_owner is MODULE-GATED — it is
-- `module_can_edit(uid,'hr-exit') and __ungated(...)`. Seven of the fifteen
-- configured step owners have hr-exit access 'none', so they CANNOT ACT ON THE
-- STEPS THEY ARE CONFIGURED TO OWN, and could not before this migration either:
--
--     asset_return, handover, leave_verification  DHARMISHTHA PRAJAPATI
--     fnf_approve                                 Ritesh Tulsyan
--     fnf_generate, payroll_inputs                Bushra
--     fnf_payment                                 Jyoti
--
-- fnf_approve is one of the two approvals this feature exists for, so for those
-- seven steps the module is not "one person deep" — it is admin-and-coordinator
-- only. Reassignment helps (an admin or the coordinator can now put a named
-- person on the step) but the real fix is granting those four people edit access.
-- The authorisation test asserts the number 7 so it is checked, not remembered.
-- Filed alongside PF-14 in WORKLIST.md.
--
-- ADDITIVE: one new table, three new functions, two create-or-replace bodies
-- keeping their EXACT argument lists.
--
-- NO SERVER-SIDE ANNOUNCE. The store raises it client-side.
--
-- VERIFIED ON LIVE DATA 2026-08-27 inside a rolled-back transaction: 22 cases,
-- 22 passed, against a synthetic case created and discarded in the same
-- transaction (the final SELECT re-checks that fms_exit_cases is still empty and
-- that no 'ZZ-TEST-EXIT' row survives). What it proves beyond the usual set:
--   * The reassignment REPLACES THE WHOLE OR CHAIN, not just one arm — after it,
--     neither the reporting manager nor the configured step owner may act.
--   * ⚠ It WINS over a later fms_exit_update_case manager edit: changing
--     reporting_manager_ids while an assignee exists does not move that step,
--     though it does move the manager steps that have no assignee.
--   * The read gate, before and after: an edit-level receiver could not read the
--     case, and could once they held a step.
--   * ⚠ manager_review, exit_interview and hr_head_approval are all owned by Riya
--     Kumari, who is ALSO the sole exit coordinator — so for HER a reassignment
--     ADDS the receiver without removing her, by design. The MOVE therefore has
--     to be observed on a step whose owner is not the coordinator (`documents`),
--     and the queue must follow the assignee even for a coordinator. Same finding
--     as HR Recruitment.
--
-- REVERSAL — the same unusual ordering as Recruitment, and for the same reason:
-- the new gate body CALLS fms_exit_is_natural_step_owner, so the BODIES go back
-- FIRST or every RPC that gates on fms_exit_can_act breaks, not just reassign.
--   1. re-run the fms_exit_can_act__ungated body from its previous defining
--      migration, and the fms_exit_can_read_case body from its own.
--   2. drop function public.fms_exit_reassign_step(uuid, text, uuid, text);
--      drop function public.fms_exit_is_natural_step_owner(text, uuid, uuid);
--      drop function public.fms_exit_can_receive_reassignment(uuid);
--   3. delete from public.fms_exit_config where key = 'reassign_pool';
--   4. drop table public.fms_exit_step_assignees;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who holds which step.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_exit_step_assignees (
  case_id     uuid not null references public.fms_exit_cases(id) on delete cascade,
  step_key    text not null,
  assigned_to uuid not null references auth.users on delete cascade,
  assigned_by uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  note        text,
  primary key (case_id, step_key)
);

comment on table public.fms_exit_step_assignees is
  'Who is currently holding one STEP of one exit case. Keyed on (case_id, step_key) because that is how fms_exit_can_act already authorises. A row here REPLACES the natural owner for that step - including the reporting managers, so it also overrides a later fms_exit_update_case manager edit until the row is deleted. Deleted, not nulled, on a hand-back.';

alter table public.fms_exit_step_assignees enable row level security;

create policy fms_exit_step_assignees_select on public.fms_exit_step_assignees
  for select using (public.fms_exit_can_read_case(case_id, auth.uid()));

create policy fms_exit_step_assignees_write on public.fms_exit_step_assignees
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_exit_step_assignees to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Who may RECEIVE a reassignment.
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a Setup picker
--   filter and grants nothing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_exit_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_exit_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed an HR Exit step? Reads ONLY fms_exit_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_exit_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Who owns a step when nobody is holding it.
--
-- The pre-existing rule, lifted out of fms_exit_can_act__ungated verbatim with
-- its admin/coordinator arm left behind. Note that BOTH special branches keep
-- their fall-through: a reporting manager OR the configured owner may act, and a
-- clearance-row owner OR the configured owner may. That is what makes this an OR
-- chain rather than the seven sealed steps Recruitment had.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_is_natural_step_owner(p_step_key text, p_case uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  -- MANAGER_STEPS — mirrored in lib/steps.ts.
  if p_step_key in ('manager_review', 'asset_return', 'handover') and p_case is not null then
    select reporting_manager_ids into v_managers from public.fms_exit_cases where id = p_case;
    if v_managers is not null and p_uid = any(v_managers) then
      return true;
    end if;
    -- NO early return. Fall through to the configured owner.
  end if;

  -- CLEARANCE — the step's owner, OR the owner of a row ON THIS CASE.
  if p_step_key = 'clearance' and p_case is not null then
    if exists (
      select 1
        from public.fms_exit_clearance_checks k
        join public.fms_exit_cases c on c.id = k.case_id
       where k.case_id = p_case
         and (p_uid = any(k.owner_ids)
           or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids)))
    ) then
      return true;
    end if;
    -- NO early return, for the same reason as above.
  end if;

  return public.fms_exit_is_step_owner(p_step_key, p_uid);
end $$;

comment on function public.fms_exit_is_natural_step_owner(text, uuid, uuid) is
  'Who owns this step of this exit case when nobody has been assigned it. Deliberately excludes the admin/coordinator arm: that is authority, not ownership, and the reassign RPC needs to ask about ownership specifically so the natural owner can take a step back.';

grant execute on function public.fms_exit_is_natural_step_owner(text, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. can_act__ungated — the assignee rule.
--
--    ONE delta: an assignee check ahead of everything except admin/coordinator,
--    with the rest delegated to the helper above.
--
--    ⚠ The assignee REPLACES the natural owner rather than joining them. An OR
--      would be a SHARE — the step would stay in the original owner's queue too.
--      This is also what gives an assignee precedence over a later
--      fms_exit_update_case manager edit; see the header.
--
--    Signature unchanged. fms_exit_can_act is NOT touched and still opens with
--    module_can_edit(p_uid,'hr-exit'), so a receiver without an edit grant is
--    refused by the DATABASE. Setup warns about that.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_can_act__ungated(p_step_key text, p_case uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_assignee uuid;
begin
  if public.is_admin(p_uid) or public.fms_exit_is_coordinator(p_uid) then
    return true;
  end if;

  if p_case is not null then
    select assigned_to into v_assignee
      from public.fms_exit_step_assignees
     where case_id = p_case and step_key = p_step_key;
    if v_assignee is not null then
      return v_assignee = p_uid;
    end if;
  end if;

  return public.fms_exit_is_natural_step_owner(p_step_key, p_case, p_uid);
end $$;


-- ---------------------------------------------------------------------------
-- 5. can_read_case — admit the assignee.
--
--    ⚠ WITHOUT THIS THE FEATURE IS A DEAD END. module_is_viewer is
--      `module_level(...) = 'view'` EXACTLY, so a receiver holding an *edit*
--      grant matches none of the existing arms unless they already happen to be
--      the leaver, the raiser, a reporting manager or a clearance-row owner.
--
--    ONE delta: the fms_exit_step_assignees arm. Signature unchanged.
-- ---------------------------------------------------------------------------
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
      or public.module_is_viewer(p_uid, 'hr-exit')
      or exists (
        select 1 from public.fms_exit_cases c
        where c.id = p_case
          and (c.employee_user_id = p_uid
            or c.raised_by = p_uid
            or p_uid = any(c.reporting_manager_ids))
      )
      or exists (
        select 1 from public.fms_exit_step_assignees a
         where a.case_id = p_case and a.assigned_to = p_uid
      )
      or exists (
        select 1
          from public.fms_exit_clearance_checks k
          join public.fms_exit_cases c on c.id = k.case_id
         where k.case_id = p_case
           and (p_uid = any(k.owner_ids)
             or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids)))
      );
$$;


-- ---------------------------------------------------------------------------
-- 6. Reassign a step (or take it back).
--
-- p_assignee NULL = return it to whoever naturally owns the step.
--
-- WHO MAY CALL IT is deliberately BROADER than who may act: the NATURAL owner
-- keeps the right to pull a step back after passing it on.
--
-- WHO MAY RECEIVE is the pool OR the step's natural owner, so it can always be
-- returned without an admin having to list every reporting manager in the pool.
-- ---------------------------------------------------------------------------
create or replace function public.fms_exit_reassign_step(
  p_case     uuid,
  p_step_key text,
  p_assignee uuid default null,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_assignee uuid;
begin
  select status into v_status from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;
  -- ⚠ The terminal statuses here are withdrawn / rejected / archived. There is NO
  --   'cancelled' in this module's CaseStatus union — an earlier draft guarded on
  --   it and would have guarded on nothing, letting a withdrawn case be reassigned.
  if v_status in ('withdrawn', 'rejected', 'archived') then
    raise exception 'This exit case is % — its steps can no longer be reassigned', v_status;
  end if;

  select assigned_to into v_assignee from public.fms_exit_step_assignees
   where case_id = p_case and step_key = p_step_key;

  if not (public.is_admin(v_uid)
          or public.fms_exit_is_coordinator(v_uid)
          or (v_assignee is not null and v_assignee = v_uid)
          or public.fms_exit_is_natural_step_owner(p_step_key, p_case, v_uid)) then
    raise exception 'Not authorized to reassign this step';
  end if;

  if p_assignee is null then
    delete from public.fms_exit_step_assignees
     where case_id = p_case and step_key = p_step_key;
    return;
  end if;

  if p_assignee = v_uid then
    raise exception 'Pick someone else — a step cannot be reassigned to yourself';
  end if;

  if not (public.fms_exit_can_receive_reassignment(p_assignee)
          or public.fms_exit_is_natural_step_owner(p_step_key, p_case, p_assignee)) then
    raise exception 'That person may not receive a step. Add them in Setup, under Reassignment, first.';
  end if;

  insert into public.fms_exit_step_assignees (case_id, step_key, assigned_to, assigned_by, note)
  values (p_case, p_step_key, p_assignee, v_uid, nullif(btrim(p_note), ''))
  on conflict (case_id, step_key) do update
    set assigned_to = excluded.assigned_to,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        note        = excluded.note;
end $$;

comment on function public.fms_exit_reassign_step(uuid, text, uuid, text) is
  'Reassign ONE step of ONE exit case to another person, or pass NULL to return it to its natural owner. Callable by an admin, a process coordinator, the step''s natural owner, or the current assignee. An assignee takes precedence over a later fms_exit_update_case manager edit. Does not announce - the store raises the notification client-side.';

grant execute on function public.fms_exit_reassign_step(uuid, text, uuid, text) to authenticated;

commit;
