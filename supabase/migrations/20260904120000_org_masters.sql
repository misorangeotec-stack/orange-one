-- ===========================================================================
-- ORGANISATION MASTERS — Department, Sub-department, Designation, Band.
--
-- WHY
--   The user master carries one organisational fact: department. HR's employee
--   sheet carries four — department, SUB-department, designation and (via the
--   band categorisation sheet) a band. Designation is free text today, so
--   `Deputy GM`, `DGM` and `Deputy General Manager` are three spellings of one
--   rank, and the department list has silently absorbed things that are really
--   sub-departments (`After Sales - Application`, `Spare Warehouse`, `Travel
--   Desk`) plus a stray `new test dept`.
--
-- ⚠ NOTHING HERE EDITS OR REMOVES AN EXISTING DEPARTMENT ROW.
--   `departments` is pointed at by 5,213 tasks, 195 recurring tasks, 45 HR job
--   titles, 12 requisitions and the `department_ids uuid[]` on nine FMS
--   step-owner tables. A rename would rewrite five thousand rows of history and
--   a delete would strand them. Rows are switched OFF (the new `active` flag),
--   never merged and never dropped — every id stays exactly where it is. The
--   seed migration that follows relies on that.
--
-- ⚠ BAND IS INDEPENDENT OF DESIGNATION, ON PURPOSE.
--   Band is NOT derived from, and places no constraint on, designation. Several
--   designations may sit in one band and the same designation may sit in
--   different bands for different people. There is deliberately no band_id on
--   `designations` — putting one there is the mistake this comment exists to
--   prevent.
--
-- ⚠ `profiles.designation` (text) IS KEPT AND MUST STAY IN SYNC.
--   It is not a leftover. The `list_org_people()` SECURITY DEFINER function
--   returns it, and that is what every @mention picker in the portal renders.
--   `designation_id` is the source of truth from here on; the text is its
--   mirror. Write BOTH, exactly as 20260720160000 kept `approver_user_id`
--   beside `approver_user_ids`.
--
-- `designations` already exists with the right shape (20260608120000) and is
-- FK'd from every `fms_*_step_owners` table, so it is left alone structurally.
--
-- Additive: two new tables, two new columns on `departments`, four new nullable
-- columns on `profiles`, one guard trigger.
--
-- Reversal:
--   drop trigger if exists trg_profiles_guard_org_fields on public.profiles;
--   drop function if exists public.guard_profile_org_fields();
--   alter table public.profiles
--     drop column if exists employee_code,
--     drop column if exists band_id,
--     drop column if exists designation_id,
--     drop column if exists sub_department_id;
--   drop table if exists public.sub_departments;
--   drop table if exists public.bands;
--   alter table public.departments drop column if exists sort_order, drop column if exists active;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- departments — gains the MasterCrud contract columns. No row is touched.
-- ---------------------------------------------------------------------------
alter table public.departments
  add column if not exists active     boolean not null default true,
  add column if not exists sort_order integer not null default 0;

comment on column public.departments.active is
  'Switched off = hidden from NEW pickers, still resolvable by id everywhere it is already referenced (5k+ tasks). Departments are never deleted.';

-- ---------------------------------------------------------------------------
-- sub_departments — a department''s subdivisions. Parent is compulsory.
-- ---------------------------------------------------------------------------
create table if not exists public.sub_departments (
  id            uuid primary key default gen_random_uuid(),
  -- RESTRICT, not cascade: a sub-department with people against it is history.
  department_id uuid not null references public.departments on delete restrict,
  name          text not null,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (department_id, name)
);

comment on table public.sub_departments is
  'Subdivisions of a department (HR''s "Sub Department"). Unique per parent, so two departments may each have a "Procurement".';

create index if not exists sub_departments_department_idx
  on public.sub_departments (department_id);

drop trigger if exists trg_sub_departments_updated on public.sub_departments;
create trigger trg_sub_departments_updated
  before update on public.sub_departments
  for each row execute function public.set_updated_at();

alter table public.sub_departments enable row level security;

drop policy if exists sub_departments_select on public.sub_departments;
create policy sub_departments_select on public.sub_departments
  for select to authenticated using (true);

drop policy if exists sub_departments_write on public.sub_departments;
create policy sub_departments_write on public.sub_departments
  for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- bands — the 9-level band ladder. `name` is the CATEGORY ("Executive Level").
-- ---------------------------------------------------------------------------
create table if not exists public.bands (
  id          uuid primary key default gen_random_uuid(),
  band_no     integer not null unique,
  name        text not null,
  -- The example designations from the band categorisation sheet. Guidance for
  -- whoever is filling the user form; it constrains nothing.
  description text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.bands is
  'Band ladder (1..9). `name` is the category, e.g. Band 3 = "Executive Level". Assigned per user and INDEPENDENT of designation.';

drop trigger if exists trg_bands_updated on public.bands;
create trigger trg_bands_updated
  before update on public.bands
  for each row execute function public.set_updated_at();

alter table public.bands enable row level security;

drop policy if exists bands_select on public.bands;
create policy bands_select on public.bands
  for select to authenticated using (true);

drop policy if exists bands_write on public.bands;
create policy bands_write on public.bands
  for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- profiles — four nullable columns. SET NULL everywhere, so switching a master
-- off can never block a login or strand a user row.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists sub_department_id uuid references public.sub_departments on delete set null,
  add column if not exists designation_id    uuid references public.designations    on delete set null,
  add column if not exists band_id           uuid references public.bands           on delete set null,
  add column if not exists employee_code     text;

comment on column public.profiles.designation is
  'LEGACY MIRROR of designation_id''s name, kept because list_org_people() returns it and every @mention picker renders it. Write both.';
comment on column public.profiles.employee_code is
  'HR employee code (e.g. OTPL-S-10092). Unique where present; null for service accounts.';

create unique index if not exists profiles_employee_code_key
  on public.profiles (employee_code) where employee_code is not null;

create index if not exists profiles_sub_department_idx on public.profiles (sub_department_id);
create index if not exists profiles_designation_idx    on public.profiles (designation_id);
create index if not exists profiles_band_idx           on public.profiles (band_id);

-- ---------------------------------------------------------------------------
-- Guard: only an admin may set someone''s place in the organisation.
--
-- `profiles_update_own` is `using (id = auth.uid() or is_admin(auth.uid()))` —
-- it gates the ROW, not the COLUMNS, so without this a signed-in user could
-- PATCH their own department, band or employee code straight through PostgREST.
-- That was survivable while `designation` was a free-text vanity field on the
-- account page; it is not once these columns drive directory visibility
-- (`same_department`) and HR salary visibility.
--
-- auth.uid() is null for the service role, which is how the admin-users Edge
-- Function writes — those calls pass through untouched.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_org_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or (select public.is_admin((select auth.uid()))) then
    return new;
  end if;

  if new.department_id     is distinct from old.department_id
     or new.sub_department_id is distinct from old.sub_department_id
     or new.designation_id    is distinct from old.designation_id
     or new.designation       is distinct from old.designation
     or new.band_id           is distinct from old.band_id
     or new.employee_code     is distinct from old.employee_code
  then
    raise exception
      'Department, sub-department, designation, band and employee code are set by an administrator.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_org_fields() is
  'Column-level guard for profiles: non-admins may edit their own name/avatar, never their organisational placement.';

drop trigger if exists trg_profiles_guard_org_fields on public.profiles;
create trigger trg_profiles_guard_org_fields
  before update on public.profiles
  for each row execute function public.guard_profile_org_fields();

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'departments' and column_name = 'active') then
    raise exception 'departments.active missing';
  end if;

  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'sub_departments') then
    raise exception 'sub_departments missing';
  end if;

  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'bands') then
    raise exception 'bands missing';
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name in ('sub_department_id', 'designation_id', 'band_id', 'employee_code')) <> 4 then
    raise exception 'profiles is missing one of the four new organisation columns';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_profiles_guard_org_fields') then
    raise exception 'profiles org-field guard trigger missing';
  end if;

  -- The whole point of this migration: no department row was harmed.
  if (select count(*) from public.departments) < 21 then
    raise exception 'departments lost rows — expected at least the 21 that existed before';
  end if;
end
$check$;
