-- Task Management — Locations feature.
--
-- Adds a location dimension to tasks. A location is a company + place pair
-- (e.g. "Otec · Surat") plus a special "General" entry. A task (one-time or
-- recurring) can be tagged with several locations; the task then carries a
-- per-location checklist and CANNOT be marked complete until every location is
-- ticked off. Tasks with no locations behave exactly as before (no gating).
--
-- Three new tables:
--   locations                 — admin-managed master list
--   task_locations            — per-task checklist rows (the things to tick off)
--   recurring_task_locations  — which locations a recurring template applies to
-- Plus a BEFORE UPDATE trigger on tasks that enforces the completion gate.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Reuses the existing
-- public.set_updated_at(), public.is_admin(uuid) and public.is_hod_of(uuid,uuid)
-- helpers. Apply in the Orange One Supabase project (ref coshondiqdhorwvibrwu)
-- via the SQL editor or `supabase db push`, BEFORE the frontend goes live.
--
-- Reversal:
--   drop trigger if exists trg_tasks_locations_gate on public.tasks;
--   drop function if exists public.enforce_task_locations_complete();
--   drop table if exists public.recurring_task_locations;
--   drop table if exists public.task_locations;
--   drop table if exists public.locations;

-- ---------------------------------------------------------------------------
-- 1. locations — admin master list
-- ---------------------------------------------------------------------------
create table if not exists public.locations (
  id          uuid primary key default gen_random_uuid(),
  company     text,                                   -- null for the General entry
  name        text not null,                          -- the place, e.g. "Surat"
  is_general  boolean not null default false,         -- true marks the General row
  active      boolean not null default true,          -- soft-disable instead of delete
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.locations is
  'Task Management master list of locations (company + place, plus a General entry). Admin-managed.';

drop trigger if exists trg_locations_updated on public.locations;
create trigger trg_locations_updated
  before update on public.locations
  for each row execute function public.set_updated_at();

alter table public.locations enable row level security;

-- Everyone signed in can read the master list (needed to render task checklists
-- and the pickers). Only admins can write it.
drop policy if exists locations_select_all on public.locations;
create policy locations_select_all on public.locations
  for select to authenticated
  using (true);

drop policy if exists locations_insert_admin on public.locations;
create policy locations_insert_admin on public.locations
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

drop policy if exists locations_update_admin on public.locations;
create policy locations_update_admin on public.locations
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists locations_delete_admin on public.locations;
create policy locations_delete_admin on public.locations
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. task_locations — the per-task checklist
-- ---------------------------------------------------------------------------
create table if not exists public.task_locations (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks on delete cascade,
  location_id   uuid not null references public.locations on delete restrict,
  completed_at  timestamptz,
  completed_by  uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  unique (task_id, location_id)
);

comment on table public.task_locations is
  'Per-task location checklist. A task with rows here cannot complete until every row has completed_at set.';

create index if not exists task_locations_task_idx on public.task_locations (task_id);

alter table public.task_locations enable row level security;

-- A caller may act on a task_location row when they can act on the parent task
-- (assignee, creator, admin, or HOD of the assignee) — mirrors the tasks policy.
drop policy if exists task_locations_rw on public.task_locations;
create policy task_locations_rw on public.task_locations
  for all to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_locations.task_id
        and (
          t.assigned_to = auth.uid()
          or t.created_by = auth.uid()
          or public.is_admin(auth.uid())
          or (t.assigned_to is not null and public.is_hod_of(auth.uid(), t.assigned_to))
        )
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_locations.task_id
        and (
          t.assigned_to = auth.uid()
          or t.created_by = auth.uid()
          or public.is_admin(auth.uid())
          or (t.assigned_to is not null and public.is_hod_of(auth.uid(), t.assigned_to))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. recurring_task_locations — which locations a template applies to
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_task_locations (
  id                 uuid primary key default gen_random_uuid(),
  recurring_task_id  uuid not null references public.recurring_tasks on delete cascade,
  location_id        uuid not null references public.locations on delete restrict,
  created_at         timestamptz not null default now(),
  unique (recurring_task_id, location_id)
);

comment on table public.recurring_task_locations is
  'Locations a recurring template applies to; copied onto each generated task as task_locations rows.';

create index if not exists recurring_task_locations_tpl_idx
  on public.recurring_task_locations (recurring_task_id);

alter table public.recurring_task_locations enable row level security;

-- Mirror the recurring_tasks visibility/write rules.
drop policy if exists recurring_task_locations_select on public.recurring_task_locations;
create policy recurring_task_locations_select on public.recurring_task_locations
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_tasks r
      where r.id = recurring_task_locations.recurring_task_id
        and (
          r.assigned_to = auth.uid()
          or r.created_by = auth.uid()
          or public.is_admin(auth.uid())
          or (r.assigned_to is not null and public.is_hod_of(auth.uid(), r.assigned_to))
        )
    )
  );

drop policy if exists recurring_task_locations_write on public.recurring_task_locations;
create policy recurring_task_locations_write on public.recurring_task_locations
  for all to authenticated
  using (
    exists (
      select 1 from public.recurring_tasks r
      where r.id = recurring_task_locations.recurring_task_id
        and (
          r.created_by = auth.uid()
          or public.is_admin(auth.uid())
          or (r.assigned_to is not null and public.is_hod_of(auth.uid(), r.assigned_to))
        )
    )
  )
  with check (
    exists (
      select 1 from public.recurring_tasks r
      where r.id = recurring_task_locations.recurring_task_id
        and (
          r.created_by = auth.uid()
          or public.is_admin(auth.uid())
          or (r.assigned_to is not null and public.is_hod_of(auth.uid(), r.assigned_to))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Completion gate — a task with pending locations cannot be completed.
-- ---------------------------------------------------------------------------
-- BEFORE UPDATE on tasks: when the status transitions INTO 'completed', reject
-- the change if any of the task's locations is still pending. Tasks with zero
-- task_locations rows are never blocked (backward-compatible).
create or replace function public.enforce_task_locations_complete()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if exists (
      select 1 from public.task_locations
      where task_id = new.id and completed_at is null
    ) then
      raise exception 'All locations must be completed before this task can be marked complete';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_locations_gate on public.tasks;
create trigger trg_tasks_locations_gate
  before update on public.tasks
  for each row execute function public.enforce_task_locations_complete();
