-- FMS — generic multi-FMS workflow engine.
--
-- "FMS" = a staged, owner-driven business workflow (the first is Purchase FMS:
-- a 9-stage procurement pipeline). The hard design requirement: future FMS
-- modules must plug in by INSERTING CONFIG ROWS, not by adding tables. So these
-- tables are deliberately FMS-agnostic — a workflow is an ordered list of steps,
-- each step captures a free-form `values` jsonb payload defined by its field
-- schema. Adding a second/third FMS = one `fms_workflows` row + its
-- `fms_workflow_steps` / `fms_step_fields` rows (see the companion seed migration
-- `*_seed_purchase_fms.sql`). Tables, RLS, and the front-end renderer are reused
-- unchanged.
--
-- Tables (all in public, all RLS-enabled):
--   Masters     designations            — shared job-designation master
--               fms_field_options       — generic per-workflow option sets (e.g. categories)
--   Engine      fms_workflows           — one row per FMS
--               fms_workflow_steps       — ordered steps per workflow (owner = employee ids)
--               fms_step_fields         — field schema captured at each step
--   Instances   fms_entries             — one running entry (header) per workflow
--               fms_entry_stages        — one row per entry x step (dates, status, values)
-- Plus two RLS helper functions and an AFTER INSERT trigger that materialises an
-- entry's stage rows from its workflow's steps.
--
-- Index convention: `step_index` and `fms_entries.current_step_index` are
-- 0-based (origin step = 0; current_step_index = step-count => entry complete),
-- matching the Phase-1 mock's `currentIndex` / `stages[]` array.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Reuses the existing
-- public.set_updated_at() and public.is_admin(uuid) helpers. Apply in the Orange
-- One *identity* Supabase project (ref coshondiqdhorwvibrwu) via the SQL editor
-- or `supabase db push`, BEFORE the companion seed migration and BEFORE any
-- Phase-3 frontend goes live.
--
-- Reversal (drop in dependency order):
--   drop trigger if exists trg_fms_entries_materialize on public.fms_entries;
--   drop function if exists public.fms_materialize_entry_stages();
--   drop function if exists public.fms_is_current_owner(uuid, uuid);
--   drop function if exists public.fms_owns_step(uuid, uuid);
--   drop table if exists public.fms_entry_stages;
--   drop table if exists public.fms_entries;
--   drop table if exists public.fms_step_fields;
--   drop table if exists public.fms_field_options;
--   drop table if exists public.fms_workflow_steps;
--   drop table if exists public.fms_workflows;
--   drop table if exists public.designations;

-- ===========================================================================
-- MASTERS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- designations — shared job-designation master (used to map step owners).
-- ---------------------------------------------------------------------------
create table if not exists public.designations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.designations is
  'Shared job-designation master for FMS step ownership. profiles.designation stays free-text; a FK is deferred.';

drop trigger if exists trg_designations_updated on public.designations;
create trigger trg_designations_updated
  before update on public.designations
  for each row execute function public.set_updated_at();

alter table public.designations enable row level security;

drop policy if exists designations_select_all on public.designations;
create policy designations_select_all on public.designations
  for select to authenticated using (true);

drop policy if exists designations_insert_admin on public.designations;
create policy designations_insert_admin on public.designations
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists designations_update_admin on public.designations;
create policy designations_update_admin on public.designations
  for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists designations_delete_admin on public.designations;
create policy designations_delete_admin on public.designations
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ===========================================================================
-- ENGINE (FMS-agnostic)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- fms_workflows — one row per FMS. Adding an FMS starts here.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_workflows (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,                  -- e.g. 'purchase'
  name         text not null,                         -- e.g. 'Purchase FMS'
  description  text,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.fms_workflows is
  'One row per FMS workflow. A new FMS = one row here plus its steps/fields — no schema change.';

drop trigger if exists trg_fms_workflows_updated on public.fms_workflows;
create trigger trg_fms_workflows_updated
  before update on public.fms_workflows
  for each row execute function public.set_updated_at();

alter table public.fms_workflows enable row level security;

drop policy if exists fms_workflows_select_all on public.fms_workflows;
create policy fms_workflows_select_all on public.fms_workflows
  for select to authenticated using (true);

drop policy if exists fms_workflows_insert_admin on public.fms_workflows;
create policy fms_workflows_insert_admin on public.fms_workflows
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists fms_workflows_update_admin on public.fms_workflows;
create policy fms_workflows_update_admin on public.fms_workflows
  for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists fms_workflows_delete_admin on public.fms_workflows;
create policy fms_workflows_delete_admin on public.fms_workflows
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- fms_workflow_steps — ordered steps per workflow. Owner = specific employees.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_workflow_steps (
  id                   uuid primary key default gen_random_uuid(),
  workflow_id          uuid not null references public.fms_workflows on delete cascade,
  step_index           integer not null,                       -- 0-based position
  key                  text not null,                          -- e.g. 'approval'
  title                text not null,
  short                text,                                   -- short stepper label
  what                 text,                                   -- the "What" annotation
  how                  text,                                   -- the "How" annotation
  when_text            text,                                   -- the "When" annotation (reserved-word-safe)
  is_origin            boolean not null default false,         -- step where entries are created
  owner_employee_ids   uuid[] not null default '{}',           -- live directory ids (assigned in Workflow Setup)
  owner_employee_names text[] not null default '{}',           -- display fallback (seeded from the sheet)
  department_id        uuid,                                   -- soft ref to a department
  designation_id       uuid references public.designations on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workflow_id, step_index),
  unique (workflow_id, key)
);

comment on table public.fms_workflow_steps is
  'Ordered steps for a workflow (0-based step_index). owner_employee_ids are the notified owners; owner_employee_names is a display fallback.';

create index if not exists fms_workflow_steps_wf_idx
  on public.fms_workflow_steps (workflow_id, step_index);

drop trigger if exists trg_fms_workflow_steps_updated on public.fms_workflow_steps;
create trigger trg_fms_workflow_steps_updated
  before update on public.fms_workflow_steps
  for each row execute function public.set_updated_at();

alter table public.fms_workflow_steps enable row level security;

drop policy if exists fms_workflow_steps_select_all on public.fms_workflow_steps;
create policy fms_workflow_steps_select_all on public.fms_workflow_steps
  for select to authenticated using (true);

drop policy if exists fms_workflow_steps_insert_admin on public.fms_workflow_steps;
create policy fms_workflow_steps_insert_admin on public.fms_workflow_steps
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists fms_workflow_steps_update_admin on public.fms_workflow_steps;
create policy fms_workflow_steps_update_admin on public.fms_workflow_steps
  for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists fms_workflow_steps_delete_admin on public.fms_workflow_steps;
create policy fms_workflow_steps_delete_admin on public.fms_workflow_steps
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- fms_step_fields — the field schema captured at each step.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_step_fields (
  id           uuid primary key default gen_random_uuid(),
  step_id      uuid not null references public.fms_workflow_steps on delete cascade,
  key          text not null,
  label        text not null,
  type         text not null,                          -- text | number | textarea | date | select
  options      jsonb,                                  -- inline list for type=select
  option_set   text,                                   -- binds to fms_field_options.option_set (dynamic master)
  required     boolean not null default false,
  half         boolean not null default false,         -- render hint: half-width
  placeholder  text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (step_id, key)
);

comment on table public.fms_step_fields is
  'Field schema per step. type=select uses inline `options`; `option_set` binds a field to a dynamic fms_field_options set (e.g. categories).';

create index if not exists fms_step_fields_step_idx
  on public.fms_step_fields (step_id, sort_order);

drop trigger if exists trg_fms_step_fields_updated on public.fms_step_fields;
create trigger trg_fms_step_fields_updated
  before update on public.fms_step_fields
  for each row execute function public.set_updated_at();

alter table public.fms_step_fields enable row level security;

drop policy if exists fms_step_fields_select_all on public.fms_step_fields;
create policy fms_step_fields_select_all on public.fms_step_fields
  for select to authenticated using (true);

drop policy if exists fms_step_fields_insert_admin on public.fms_step_fields;
create policy fms_step_fields_insert_admin on public.fms_step_fields
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists fms_step_fields_update_admin on public.fms_step_fields;
create policy fms_step_fields_update_admin on public.fms_step_fields
  for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists fms_step_fields_delete_admin on public.fms_step_fields;
create policy fms_step_fields_delete_admin on public.fms_step_fields
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- fms_field_options — generic per-workflow option sets (e.g. categories->unit).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_field_options (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.fms_workflows on delete cascade,
  option_set   text not null,                          -- e.g. 'category'
  label        text not null,                          -- e.g. 'RAW MATERIAL'
  meta         jsonb not null default '{}',            -- e.g. {"unit":"KGS"}
  sort_order   integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workflow_id, option_set, label)
);

comment on table public.fms_field_options is
  'Dynamic, admin-editable option sets per workflow (referenced by fms_step_fields.option_set). meta carries extras like {"unit":...}.';

create index if not exists fms_field_options_set_idx
  on public.fms_field_options (workflow_id, option_set);

drop trigger if exists trg_fms_field_options_updated on public.fms_field_options;
create trigger trg_fms_field_options_updated
  before update on public.fms_field_options
  for each row execute function public.set_updated_at();

alter table public.fms_field_options enable row level security;

drop policy if exists fms_field_options_select_all on public.fms_field_options;
create policy fms_field_options_select_all on public.fms_field_options
  for select to authenticated using (true);

drop policy if exists fms_field_options_insert_admin on public.fms_field_options;
create policy fms_field_options_insert_admin on public.fms_field_options
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists fms_field_options_update_admin on public.fms_field_options;
create policy fms_field_options_update_admin on public.fms_field_options
  for update to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists fms_field_options_delete_admin on public.fms_field_options;
create policy fms_field_options_delete_admin on public.fms_field_options
  for delete to authenticated using (public.is_admin(auth.uid()));

-- ===========================================================================
-- INSTANCES (FMS-agnostic)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- fms_entries — one running entry (header) per workflow.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_entries (
  id                  uuid primary key default gen_random_uuid(),
  workflow_id         uuid not null references public.fms_workflows on delete restrict,
  code                text not null,                          -- human code, e.g. 'PO-1042'
  current_step_index  integer not null default 0,             -- 0-based; = step-count when complete
  status              text not null default 'in_progress',    -- in_progress | completed | cancelled | on_hold
  summary             jsonb not null default '{}',            -- denormalised header fields for listing
  created_by          uuid references auth.users on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workflow_id, code)
);

comment on table public.fms_entries is
  'One running entry per workflow. summary holds denormalised header fields so lists need no stage join.';

create index if not exists fms_entries_workflow_idx
  on public.fms_entries (workflow_id);

drop trigger if exists trg_fms_entries_updated on public.fms_entries;
create trigger trg_fms_entries_updated
  before update on public.fms_entries
  for each row execute function public.set_updated_at();

alter table public.fms_entries enable row level security;

-- ---------------------------------------------------------------------------
-- fms_entry_stages — one row per entry x step (dates, status, values payload).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_entry_stages (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.fms_entries on delete cascade,
  step_id       uuid not null references public.fms_workflow_steps on delete restrict,
  step_index    integer not null,                       -- denormalised for ordering
  status        text not null default 'pending',        -- pending | active | done
  planned_date  date,
  actual_date   timestamptz,
  values        jsonb not null default '{}',            -- captured field values, keyed by field key
  completed_by  uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entry_id, step_id)
);

comment on table public.fms_entry_stages is
  'One row per entry x workflow step. Rows are materialised by trigger on entry insert; `values` is the generic per-step payload.';

create index if not exists fms_entry_stages_entry_idx
  on public.fms_entry_stages (entry_id, step_index);

drop trigger if exists trg_fms_entry_stages_updated on public.fms_entry_stages;
create trigger trg_fms_entry_stages_updated
  before update on public.fms_entry_stages
  for each row execute function public.set_updated_at();

alter table public.fms_entry_stages enable row level security;

-- ===========================================================================
-- RLS HELPERS — security definer to bypass RLS inside the check (and avoid
-- recursive policy evaluation on fms_entries).
-- ===========================================================================
create or replace function public.fms_owns_step(p_step_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_workflow_steps s
    where s.id = p_step_id
      and p_uid = any(s.owner_employee_ids)
  );
$$;

comment on function public.fms_owns_step(uuid, uuid) is
  'True if p_uid is an assigned owner of the given workflow step.';

create or replace function public.fms_is_current_owner(p_entry_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.fms_entries e
    join public.fms_workflow_steps s
      on s.workflow_id = e.workflow_id
     and s.step_index = e.current_step_index
    where e.id = p_entry_id
      and p_uid = any(s.owner_employee_ids)
  );
$$;

comment on function public.fms_is_current_owner(uuid, uuid) is
  'True if p_uid owns the step at the entry''s current_step_index (the active stage owner).';

-- ===========================================================================
-- TRIGGER — materialise an entry's stage rows from its workflow's steps.
-- The origin step becomes 'active', the rest 'pending'. security definer so it
-- can populate stage rows the creator does not own (owner-RLS would block them).
-- ===========================================================================
create or replace function public.fms_materialize_entry_stages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fms_entry_stages (entry_id, step_id, step_index, status)
  select new.id, s.id, s.step_index,
         case when s.is_origin then 'active' else 'pending' end
  from public.fms_workflow_steps s
  where s.workflow_id = new.workflow_id;
  return new;
end $$;

drop trigger if exists trg_fms_entries_materialize on public.fms_entries;
create trigger trg_fms_entries_materialize
  after insert on public.fms_entries
  for each row execute function public.fms_materialize_entry_stages();

-- ===========================================================================
-- RLS POLICIES — instances (depend on the helpers above).
-- ===========================================================================

-- fms_entries: read all; insert by admin or the origin-step owner; update by
-- admin or the active-stage owner; delete admin-only.
drop policy if exists fms_entries_select_all on public.fms_entries;
create policy fms_entries_select_all on public.fms_entries
  for select to authenticated using (true);

drop policy if exists fms_entries_insert on public.fms_entries;
create policy fms_entries_insert on public.fms_entries
  for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1 from public.fms_workflow_steps s
      where s.workflow_id = fms_entries.workflow_id
        and s.is_origin
        and auth.uid() = any(s.owner_employee_ids)
    )
  );

drop policy if exists fms_entries_update on public.fms_entries;
create policy fms_entries_update on public.fms_entries
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_is_current_owner(id, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_is_current_owner(id, auth.uid()));

drop policy if exists fms_entries_delete_admin on public.fms_entries;
create policy fms_entries_delete_admin on public.fms_entries
  for delete to authenticated using (public.is_admin(auth.uid()));

-- fms_entry_stages: read all; insert admin-only (normal path is the definer
-- trigger, which bypasses RLS); update by admin or that step's owner; no client
-- delete (entry cascade removes them).
drop policy if exists fms_entry_stages_select_all on public.fms_entry_stages;
create policy fms_entry_stages_select_all on public.fms_entry_stages
  for select to authenticated using (true);

drop policy if exists fms_entry_stages_insert_admin on public.fms_entry_stages;
create policy fms_entry_stages_insert_admin on public.fms_entry_stages
  for insert to authenticated with check (public.is_admin(auth.uid()));

drop policy if exists fms_entry_stages_update on public.fms_entry_stages;
create policy fms_entry_stages_update on public.fms_entry_stages
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_owns_step(step_id, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_owns_step(step_id, auth.uid()));
