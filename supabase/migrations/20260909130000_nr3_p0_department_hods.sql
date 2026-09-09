-- NR-3 Part B - Setup > Department HODs: who normally owns a department's hiring.
--
-- WHY THIS TABLE EXISTS
-- A requisition's hiring_manager_ids is the "acts as the HOD" field, and HR cannot
-- fill it: the MRF picker reads the RLS-scoped directory, so Saloni Rathod sees 5 of
-- 68 people and every head she would need to name is not in the dropdown. Measured
-- 09-09-2026: 17 of 19 live positions defaulted to the raiser, 15 to Saloni alone.
-- Part A makes the field settable. This is the master that stops HR having to be
-- told the answer nineteen times.
--
-- !! IT IS A DEFAULT FOR THE **NEXT** MRF, AND NOTHING ELSE.
--    No RLS policy reads it. No RPC reads it. fms_hr_can_read_requisition does not
--    read it. fms_hr_is_natural_step_owner does not read it. Being named here grants
--    not one candidate row and not one CV. The grant is, and stays,
--    fms_hr_requisitions.hiring_manager_ids.
--
-- !! THE INVARIANT, STATED SO A REVIEWER CAN GREP FOR IT:
--    NOTHING may read fms_hr_department_hods while writing fms_hr_requisitions.
--    A department changing head next March must not silently move HOD shortlist and
--    Round 2 on eleven mid-pipeline vacancies. Moving an existing position is
--    fms_hr_set_hiring_managers - explicit, audited, and it notifies. The Setup
--    screen may OFFER that ("3 open positions still name the old head - move them
--    too?"); it may never do it as a side effect.
--
-- WHY NOT departments.hod_id - asked and answered on 02-09-2026.
-- public.departments is the SHARED org master. fms_hr_requisitions.department_id FKs
-- to it, several modules read it, and the org-masters operation owns it. One column
-- there forces one answer for every module that might later want a different one.
-- This table is HR-local and additive; promoting it later is a smaller change than
-- un-picking a shared column.
--
-- WHY NOT user_hods - it looks like the answer and it is not.
-- user_hods is a REPORTING LINE and cannot be aggregated into a department head.
-- Measured 02-09-2026: Accounting & Finance names FIVE different people across its
-- 17 staff, Supply Chain four, Sales three, and 13 of 23 departments name nobody.
-- Deriving "the department's HOD" from it picks one of five arbitrarily, or nothing.
--
-- WHAT THE SCREEN DOES DERIVE, WHICH IS A DIFFERENT THING (and is why HR is not
-- handed a blank form): who holds the `hod` ROLE and sits in that department.
-- Measured 09-09-2026 - seven of twelve active departments come out with exactly one
-- name, and every one of those people is already an owner of the `mrf` step:
--     Accounting & Finance / After Sales service / Human Resources /
--     Ink Manufacturing / Marketing ......... 1 each
--     Supply Chain .......................... 2, in different sub-teams
--     Sales ................................. 6, across three sub-teams
--     Administration / AI & tech / M/C Manufacturing / Management / Quality Lab .. 0
-- The screen SHOWS that as a suggestion and writes nothing until an admin saves it,
-- so no guess is ever stored as truth. list_org_people() already returns `role` and
-- `department_id`, so the suggestion costs no query.
--
-- KEYED ON DEPARTMENT ONLY, DELIBERATELY.
-- fms_hr_requisitions has NO sub_department_id, so a finer key could not be applied
-- to a requisition even if it were stored. Worth recording that the org genuinely has
-- heads at sub-team level - Supply Chain's two are Procurement and Spare - Print Head
-- Warehouse; Sales' six split across Business Development, Label & Publication and
-- Textile - so if the MRF ever captures sub-department, this table gains a nullable
-- sub_department_id and a unique index, which is additive.
--
-- DATA SAFETY. This migration creates one new table, two triggers on it, one new
-- trigger function and one new read-only function. It modifies no existing table,
-- column, row, policy or function. It writes no data. Its only lock is on the table
-- it is creating.

begin;

create table if not exists public.fms_hr_department_hods (
  department_id uuid        primary key references public.departments(id) on delete cascade,
  hod_ids       uuid[]      not null default '{}'::uuid[],
  updated_at    timestamptz not null default now(),
  updated_by    uuid        references auth.users(id) on delete set null,
  -- The trigger below strips NULL elements; this is the invariant that survives
  -- somebody dropping the trigger. array_position(arr, null) genuinely finds a NULL
  -- element and returns NULL for an empty array, so '{}' passes.
  constraint fms_hr_department_hods_no_null_ids
    check (array_position(hod_ids, null) is null)
);

comment on table public.fms_hr_department_hods is
  'NR-3 Part B. Who normally owns hiring for a department. A DEFAULT for NEW requisitions only - read by no policy, no RPC and no read gate, and NOTHING here may ever write back to fms_hr_requisitions. Moving an existing vacancy is fms_hr_set_hiring_managers, which is audited and notifies.';

comment on column public.fms_hr_department_hods.hod_ids is
  'May be empty. Empty and "no row at all" mean the same thing to the default logic; the Setup screen distinguishes them so an unset department reads as unset rather than as answered.';

alter table public.fms_hr_department_hods enable row level security;

-- Mirrors fms_hr_config's pair exactly. The (select ...) wrapping is not cosmetic:
-- an unwrapped predicate is re-evaluated per row instead of being hoisted, which is
-- what turned 15ms into 1.4s in Order to Dispatch.
drop policy if exists fms_hr_department_hods_select on public.fms_hr_department_hods;
create policy fms_hr_department_hods_select on public.fms_hr_department_hods
  for select to authenticated
  using ((select public.is_staff((select auth.uid()))));

drop policy if exists fms_hr_department_hods_write on public.fms_hr_department_hods;
create policy fms_hr_department_hods_write on public.fms_hr_department_hods
  for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- Supabase's default privileges hand every NEW table to anon as well. 175 such grants
-- already sit across the existing fms_hr_* tables, held back by RLS alone; this one
-- does not rely on that.
revoke all on public.fms_hr_department_hods from anon;
grant select, insert, update, delete on public.fms_hr_department_hods to authenticated, service_role;

-- updated_at, via the shared trigger every sibling table uses.
drop trigger if exists trg_fms_hr_department_hods_updated on public.fms_hr_department_hods;
create trigger trg_fms_hr_department_hods_updated
  before insert or update on public.fms_hr_department_hods
  for each row execute function public.set_updated_at();

-- updated_by, dedupe and validation - what an RPC would have guarded, done as a
-- trigger instead so the write stays a plain PostgREST upsert (the same shape as the
-- five Setup sections that already work that way) AND so a direct SQL-editor write is
-- bound by the same rules. There is nothing else for an RPC to guard here: the table
-- grants nothing.
create or replace function public.fms_hr_department_hods_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $trg$
declare v_bad text;
begin
  -- Never trusted from the client.
  new.updated_by := auth.uid();

  -- Drop NULLs and duplicates. Order is not preserved and does not matter: this is a
  -- set of heads, not a ranked list.
  select coalesce(array_agg(distinct x), '{}'::uuid[])
    into new.hod_ids
    from unnest(coalesce(new.hod_ids, '{}'::uuid[])) x
   where x is not null;

  -- is_staff() is false both for an external profile and for a uuid with no profiles
  -- row at all, so one predicate closes the dangling-id hole and the external-user
  -- hole together.
  select coalesce(string_agg(coalesce(nullif(btrim(p.name), ''), x::text), ', '), '')
    into v_bad
    from unnest(new.hod_ids) x
    left join public.profiles p on p.id = x
   where not public.is_staff(x);

  if v_bad <> '' then
    raise exception 'Every department HOD must be a current staff member: %', v_bad;
  end if;

  return new;
end $trg$;

comment on function public.fms_hr_department_hods_guard() is
  'NR-3 Part B. Stamps updated_by from auth.uid(), dedupes hod_ids and refuses any id that is not current internal staff.';

-- Nobody calls a trigger function by name, so nobody needs EXECUTE on it - and
-- Postgres grants it to PUBLIC by default, which get_advisors flags as
-- "Public Can Execute SECURITY DEFINER Function". Several older fms_hr_* functions
-- still carry that default; this one does not.
-- !! REVOKING EXECUTE DOES NOT DISARM THE TRIGGER. A trigger is fired by the table's
--    owner, not by the caller, so the guard still runs for every insert and update.
--    Proved on live data 09-09-2026: after this revoke, an insert naming a
--    non-staff id was still refused and wrote nothing.
revoke execute on function public.fms_hr_department_hods_guard() from public;
revoke execute on function public.fms_hr_department_hods_guard() from anon;
revoke execute on function public.fms_hr_department_hods_guard() from authenticated;

drop trigger if exists trg_fms_hr_department_hods_guard on public.fms_hr_department_hods;
create trigger trg_fms_hr_department_hods_guard
  before insert or update on public.fms_hr_department_hods
  for each row execute function public.fms_hr_department_hods_guard();

-- ---------------------------------------------------------------------------
-- Who can EDIT in New Recruitment, as opposed to merely open it.
--
-- The picker needs to tell three states apart: no grant, View-only, and Edit.
-- fms_hr_module_user_ids() answers the first but not the second - it returns any
-- access_level. module_can_edit() gates every action in this module, so mapping a
-- head who holds View-only produces somebody who can see the vacancy and press
-- nothing. One such grant exists live.
--
-- !! A STRICT SIBLING, NOT A CHANGE TO THE EXISTING FUNCTION. Adding access_level to
--    fms_hr_module_user_ids()'s `returns table` would need DROP+CREATE, which revokes
--    its grants and breaks its live caller (hrFetch.ts) and database.types.ts in the
--    same breath. Same shape, same caller gate, and deliberately the same lack of a
--    result-side is_external filter: the picker computes "view-only = in that list
--    but not in this one", and that arithmetic only holds if this is a SUBSET of it.
--    Admins appear in both, because module_level() resolves an admin to 'edit'
--    regardless of any app_access row.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_module_edit_user_ids()
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $fn$
  select a.user_id from public.app_access a
   where a.app_id = 'hr-recruitment'
     and a.access_level = 'edit'
     and public.is_staff(auth.uid())
  union
  select r.user_id from public.user_roles r
   where r.role = 'admin' and public.is_staff(auth.uid());
$fn$;

revoke execute on function public.fms_hr_module_edit_user_ids() from public;
revoke execute on function public.fms_hr_module_edit_user_ids() from anon;
grant  execute on function public.fms_hr_module_edit_user_ids() to authenticated, service_role;

comment on function public.fms_hr_module_edit_user_ids() is
  'NR-3. Ids that can EDIT in New Recruitment. A strict subset of fms_hr_module_user_ids(); the difference is exactly the view-only grants. Ids only - app_access RLS hides other people''s grants from the picker.';

commit;
