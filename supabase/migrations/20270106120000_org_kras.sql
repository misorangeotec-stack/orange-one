-- ===========================================================================
-- KRA DETAILS — each employee's Key Result Areas and the weight of each.
--
-- WHY
--   HR writes a KRA sheet per person: Designation | Department | Emp Name | KRA
--   | Wt%. Until now those sheets lived in Word files and, for five HR staff, as
--   code literals in the KRA / KPI Lab (apps/hr-reports/framework). This is the
--   master they are kept in from here on — the fifth tab on Admin → Organisation,
--   after Bands — and the list Task Management's "Task Category" will offer a
--   HOD when they assign a task against a KRA (next step, not in this file).
--
-- ⚠ DESIGNATION AND DEPARTMENT ARE NOT STORED HERE.
--   They are read from the employee's profile. Storing them beside profile_id
--   would give a second copy that silently goes stale the day someone is
--   promoted or moves team. The screen and the Excel export show the profile's
--   current values; the import accepts the columns and ignores them.
--
-- ⚠ ONE ROW PER KRA, NOT PER PERSON. An employee normally has several; their
--   active weights are meant to total 100. That is checked on screen (amber
--   when it is not 100), NOT by a constraint — a sheet is entered one line at a
--   time, so it is under 100 for every line but the last.
--
-- ⚠ SWITCHED OFF, NEVER DELETED — the house rule for every master. Once tasks
--   are assigned against a KRA, deleting it would strand them.
--
-- Additive: one new table. Nothing existing is touched.
-- Reversal: 20270106120000_org_kras_rollback.sql
-- ===========================================================================

create table if not exists public.org_kras (
  id          uuid primary key default gen_random_uuid(),
  -- RESTRICT, not cascade: a KRA with tasks against it is history.
  profile_id  uuid not null references public.profiles on delete restrict,
  -- The KRA itself, e.g. "Talent Acquisition, Buddy Program & Probation".
  -- Called `name` for the MasterCrud contract every master follows.
  name        text not null,
  -- Wt% — this KRA's share of the employee's 100.
  weight      numeric(5,2) not null check (weight >= 0 and weight <= 100),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, name)
);

comment on table public.org_kras is
  'Per-employee KRAs with weight (Wt%). Designation / department are read from profiles, never stored here. Switched off, never deleted.';

create index if not exists org_kras_profile_idx on public.org_kras (profile_id);

drop trigger if exists trg_org_kras_updated on public.org_kras;
create trigger trg_org_kras_updated
  before update on public.org_kras
  for each row execute function public.set_updated_at();

alter table public.org_kras enable row level security;

-- Every signed-in user may read: HODs will pick from this list when assigning
-- tasks, and nothing in a KRA title is confidential. Same as bands.
drop policy if exists org_kras_select on public.org_kras;
create policy org_kras_select on public.org_kras
  for select to authenticated using (true);

drop policy if exists org_kras_write on public.org_kras;
create policy org_kras_write on public.org_kras
  for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));
