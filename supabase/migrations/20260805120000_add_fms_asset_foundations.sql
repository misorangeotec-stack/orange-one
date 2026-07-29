-- ===========================================================================
-- ASSET MAINTENANCE FMS — FOUNDATIONS + MASTERS (Phase 1).
--
-- The TENTH FMS module. Like fms_dispatch_* / fms_production_* / fms_sampling_*
-- / fms_import_* / fms_supplies_* / fms_exit_* / fms_hr_*, it mirrors the config
-- backbone into its OWN tables rather than reusing a shared one: modules must
-- stay independently droppable, and a shared step_owners table would collide on
-- step_key.
--
-- WHAT ASSET MAINTENANCE IS
--   A register of every asset the company owns (cars, ACs, machinery, computer
--   accessories, plant equipment), each carrying one or more dated TRACKS —
--   "service every 6 months", "insurance expires 14-03-2027", "PUC expires
--   02-09-2026". A nightly job opens a Service Job when a track enters its
--   reminder window; a morning job pushes the reminder ladder. The job runs a
--   FOUR-step chain — service due → schedule service → record service →
--   verify & close — and closing it rolls the track's next due date forward.
--
--   ⚠ THE SHAPE IS DIFFERENT FROM EVERY OTHER FMS. Elsewhere one entity runs a
--     chain once and closes. Here there are THREE layers: the ASSET is permanent,
--     its SCHEDULES are permanent and self-advancing, and only the JOB is the
--     short-lived workflow entity. Only the job has steps, owners, queues and an
--     SLA — which is what lets the whole existing engine be reused unchanged.
--
--   Renewal types (insurance / PUC / RC / warranty / AMC / calibration) are
--   deliberately NEITHER hard-coded NOR free text: they are rows in the
--   fms_asset_schedule_types master, seeded with the common six so the module
--   works on day one, and extensible by an admin without a code change. ONE
--   reminder engine serves every type.
--
-- Tables:
--   fms_asset_step_owners     — one row per workflow step_key → owners
--   fms_asset_config          — key/value singletons (jsonb)
--   fms_asset_counters + next_seq — document numbering (ASSET-0001, ASM-2627-0001)
--   fms_asset_activity        — audit trail
--   fms_asset_notifications   — per-user bell feed
--   9 master tables (see MASTERS below)
--   fms_asset_master_managers — per-master-type owners (Setup → Master Owners)
--   fms_asset_master_requests — "Request a new master" submissions queue
--
-- Following Order to Dispatch, there is NO CHECK barring the origin step
-- (`service_due`) from fms_asset_step_owners. Semantics: no owners on
-- `service_due` ⇒ any granted user may raise a job by hand; owners set ⇒ only
-- them plus admins/coordinators. (The nightly generator raises jobs as the
-- definer and is never subject to this.)
--
-- ⚠ RLS policies here wrap every helper call in a scalar sub-select —
--   `using ((select public.is_admin(auth.uid())))`. Called inline, Postgres
--   evaluates the function ONCE PER ROW; wrapped, it becomes a one-shot InitPlan.
--   This is the same rewrite 20260730130000_speed_up_task_rls.sql applied to
--   Task Management (472ms → 15ms). New tables get it from day one.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.designations. Creates NO department master — public.departments is
-- reused directly.
-- Reversal (reverse order):
--   drop policy if exists "fms asset docs read"   on storage.objects;
--   drop policy if exists "fms asset docs insert" on storage.objects;
--   drop policy if exists "fms asset docs update" on storage.objects;
--   drop policy if exists "fms asset docs delete" on storage.objects;
--   delete from storage.buckets where id = 'fms-asset-docs';
--   drop function if exists public.fms_asset_resolve_master_request(uuid,boolean,jsonb,text);
--   drop function if exists public.fms_asset_is_master_manager(text,uuid);
--   drop function if exists public.fms_asset_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_asset_step_owner_ids(text);
--   drop function if exists public.fms_asset_is_coordinator(uuid);
--   drop function if exists public.fms_asset_is_step_owner(text,uuid);
--   drop function if exists public.fms_asset_next_seq(text);
--   drop function if exists public.fms_asset_fy_code(date);
--   drop table if exists public.fms_asset_master_requests, public.fms_asset_master_managers,
--                        public.fms_asset_cost_heads, public.fms_asset_usage_units,
--                        public.fms_asset_conditions, public.fms_asset_companies,
--                        public.fms_asset_makes, public.fms_asset_vendors,
--                        public.fms_asset_locations, public.fms_asset_categories,
--                        public.fms_asset_schedule_types,
--                        public.fms_asset_notifications, public.fms_asset_activity,
--                        public.fms_asset_counters, public.fms_asset_config,
--                        public.fms_asset_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_asset_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/asset-maintenance/lib/steps.ts.
-- Authorization comes SOLELY from employee_ids; department_ids is a UI filter.
-- ===========================================================================
create table if not exists public.fms_asset_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_asset_step_owners is
  'Owners per Asset Maintenance FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. `service_due` MAY be owned — with no owners, every granted user may raise a service job by hand.';

drop trigger if exists trg_fms_asset_step_owners_updated on public.fms_asset_step_owners;
create trigger trg_fms_asset_step_owners_updated
  before update on public.fms_asset_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_asset_step_owners enable row level security;
drop policy if exists fms_asset_step_owners_select on public.fms_asset_step_owners;
create policy fms_asset_step_owners_select on public.fms_asset_step_owners
  for select to authenticated using (true);
drop policy if exists fms_asset_step_owners_write on public.fms_asset_step_owners;
create policy fms_asset_step_owners_write on public.fms_asset_step_owners
  for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

-- ===========================================================================
-- fms_asset_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 1,
--                              "unit": "working_days" }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
--   'reminder_ladder'      → { "days": [45, 30, 15, 7, 1] }
--
-- The ladder is a DESCENDING list of days-before-due at which a reminder fires.
-- A tier only fires if it is <= that schedule's own lead_days, so a 15-day
-- service lead never attempts a T-45 reminder it could not reach, and a 45-day
-- insurance lead does not fall silent between being raised and T-15.
-- ===========================================================================
create table if not exists public.fms_asset_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_asset_config is
  'Singleton Asset Maintenance FMS settings (step SLAs, coordinators, reminder ladder) keyed by name.';

drop trigger if exists trg_fms_asset_config_updated on public.fms_asset_config;
create trigger trg_fms_asset_config_updated
  before update on public.fms_asset_config
  for each row execute function public.set_updated_at();

alter table public.fms_asset_config enable row level security;
drop policy if exists fms_asset_config_select on public.fms_asset_config;
create policy fms_asset_config_select on public.fms_asset_config
  for select to authenticated using (true);
drop policy if exists fms_asset_config_write on public.fms_asset_config;
create policy fms_asset_config_write on public.fms_asset_config
  for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

-- Seeded (unlike step_sla / process_coordinators, which the frontend resolves
-- from code defaults) because the reminder engine reads it SERVER-SIDE, where
-- there is no frontend default to fall back on.
insert into public.fms_asset_config (key, value)
values ('reminder_ladder', jsonb_build_object('days', jsonb_build_array(45, 30, 15, 7, 1)))
on conflict (key) do nothing;

-- ===========================================================================
-- fms_asset_counters + fms_asset_next_seq — atomic document numbering.
-- Scopes in use:
--   'asset'      → ASSET-0001.   NOT FY-scoped: an asset is permanent, and
--                  restarting its numbering every April would be meaningless.
--   'job:<fy>'   → ASM-2627-0001. FY-scoped, like every other FMS document.
-- ===========================================================================
create table if not exists public.fms_asset_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_asset_counters is
  'Per-scope document-number sequences (asset, job:<fy>). Mutated only via fms_asset_next_seq().';

alter table public.fms_asset_counters enable row level security;
drop policy if exists fms_asset_counters_select_admin on public.fms_asset_counters;
create policy fms_asset_counters_select_admin on public.fms_asset_counters
  for select to authenticated using ((select public.is_admin(auth.uid())));

create or replace function public.fms_asset_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_asset_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_asset_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_asset_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_asset_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-01 → '2627'.
create or replace function public.fms_asset_fy_code(p_d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_d) >= 4
      then to_char(p_d, 'YY') || to_char((p_d + interval '1 year'), 'YY')
    else to_char((p_d - interval '1 year'), 'YY') || to_char(p_d, 'YY')
  end;
$$;
grant execute on function public.fms_asset_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_asset_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_asset_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_asset_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_asset_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_asset_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_asset_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_asset_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_asset_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_asset_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_asset_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'asset' | 'job' | 'master_request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_asset_activity_entity_idx on public.fms_asset_activity (entity_type, entity_id);
create index if not exists fms_asset_activity_created_idx on public.fms_asset_activity (created_at);

create table if not exists public.fms_asset_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  type        text not null,
  entity_type text not null,
  entity_id   uuid not null,
  text        text not null,
  actor_id    uuid references auth.users on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists fms_asset_notifications_user_idx on public.fms_asset_notifications (user_id, read_at);
create index if not exists fms_asset_notifications_created_idx on public.fms_asset_notifications (created_at);

alter table public.fms_asset_activity enable row level security;
drop policy if exists fms_asset_activity_select on public.fms_asset_activity;
create policy fms_asset_activity_select on public.fms_asset_activity
  for select to authenticated using (true);
drop policy if exists fms_asset_activity_write_admin on public.fms_asset_activity;
create policy fms_asset_activity_write_admin on public.fms_asset_activity
  for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

alter table public.fms_asset_notifications enable row level security;
drop policy if exists fms_asset_notifications_select_own on public.fms_asset_notifications;
create policy fms_asset_notifications_select_own on public.fms_asset_notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists fms_asset_notifications_update_own on public.fms_asset_notifications;
create policy fms_asset_notifications_update_own on public.fms_asset_notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists fms_asset_notifications_write_admin on public.fms_asset_notifications;
create policy fms_asset_notifications_write_admin on public.fms_asset_notifications
  for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state. The actor is NOT skipped —
-- see 20260726150000_fms_notify_self_on_own_steps.sql: people want a receipt for
-- steps they action themselves.
--
-- ⚠ Called by the nightly cron functions, where auth.uid() is NULL. A null actor
--   is correct and expected — the bell renders it as "Asset Maintenance", not as
--   a person. Do not add a `coalesce(auth.uid(), …)` guess here.
--
-- 20260805120400_add_fms_asset_email.sql REPLACES this with an identical body
-- plus the gated email_outbox enqueue.
drop function if exists public.fms_asset_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_asset_announce(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_user_ids    uuid[] default '{}',
  p_meta        jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
begin
  insert into public.fms_asset_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_asset_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_asset_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — 9 tables, all edited via the shared MasterCrud (which also gives
-- Excel export/import for free). Select = all authenticated (dropdown fodder);
-- write = admin OR that master's owner.
--
-- Every master carries the MasterCrud contract columns: id / name / active /
-- sort_order. Nothing is ever hard-deleted — rows are deactivated, so an old
-- job's history can never be orphaned (hence `on delete restrict` on the
-- workflow FKs in migration 2).
--
-- NOTE what is ABSENT: there is no department master. public.departments is
-- reused directly. (Office Supplies created fms_supplies_departments; that was a
-- divergence, and its own HOD logic reads public.departments anyway.)
-- ===========================================================================

-- ---- schedule types: the answer to "different assets need different reminders"
create table if not exists public.fms_asset_schedule_types (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null unique,
  -- 'service'  — work is performed ON the asset (a service, a calibration).
  -- 'renewal'  — a DOCUMENT lapses and is replaced (insurance, PUC, AMC).
  --              Only these ask for the new expiry date at Verify & Close.
  kind                      text not null default 'service' check (kind in ('service','renewal')),
  default_frequency_value   integer,
  default_frequency_unit    text check (default_frequency_unit is null
                              or default_frequency_unit in ('days','months','years','one_time')),
  default_lead_days         integer not null default 15,
  active                    boolean not null default true,
  sort_order                integer not null default 0,
  created_by                uuid references auth.users on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on table public.fms_asset_schedule_types is
  'What KIND of dated track a schedule is — Periodic Service, Insurance, PUC, AMC Renewal, Calibration, … Seeded with the common six and extensible by an admin, which is why renewals are neither hard-coded nor free text. kind=renewal makes Verify & Close ask for the NEW expiry date off the renewed document.';

create table if not exists public.fms_asset_categories (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null unique,
  default_lead_days         integer,
  -- Which schedule types a NEW asset of this category is pre-offered. A
  -- convenience default, always overridable per asset.
  -- ⚠ A uuid[] cannot carry a foreign key, so deleting a schedule type would
  --   leave a dangling id here. Schedule types are never hard-deleted (they are
  --   deactivated), and the frontend filters unknown ids out when building the
  --   form — but do not assume referential integrity on this column.
  default_schedule_type_ids uuid[] not null default '{}',
  active                    boolean not null default true,
  sort_order                integer not null default 0,
  created_by                uuid references auth.users on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on table public.fms_asset_categories is
  'Asset category (Vehicle, Air Conditioner, Machinery, …). default_schedule_type_ids pre-offers the right tracks: a Vehicle gets Insurance + PUC + RC + Service, a Computer gets Warranty + AMC.';

create table if not exists public.fms_asset_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  address     text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_asset_locations is 'Where an asset physically sits (Head Office, Plant 1, Godown).';

create table if not exists public.fms_asset_vendors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  contact_person  text,
  phone           text,
  email           text,
  gstin           text,
  address         text,
  active          boolean not null default true,
  sort_order      integer not null default 0,
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.fms_asset_vendors is
  'Whoever the asset was bought from AND whoever services it — one master, because for most assets they are the same firm.';

create table if not exists public.fms_asset_makes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_asset_makes is 'Manufacturer / brand (Daikin, Voltas, Maruti, Dell).';

create table if not exists public.fms_asset_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  gstin       text,
  address     text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_asset_companies is 'Which group company owns the asset.';

create table if not exists public.fms_asset_conditions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_asset_conditions is 'Current state of the asset (In Use, Under Repair, Idle, Scrapped, Sold).';

create table if not exists public.fms_asset_usage_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_asset_usage_units is
  'How an asset''s usage is metered (KM, Hours, Cycles) — for the optional usage-based service trigger.';

create table if not exists public.fms_asset_cost_heads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_asset_cost_heads is
  'What a service spend was for (Labour, Spares, Consumables, AMC Fee, Statutory Fee). One head per job — enough for spend analysis without a second grid.';

-- ---- updated_at triggers + select policies for all 9 masters ---------------
-- Driven by a loop rather than 9×2 hand-written blocks: the shape is identical
-- for every master, and a loop cannot drift the way a copy-paste can.
do $$
declare
  t text;
  masters text[] := array[
    'schedule_types','categories','locations','vendors','makes',
    'companies','conditions','usage_units','cost_heads'
  ];
begin
  foreach t in array masters loop
    execute format('drop trigger if exists trg_fms_asset_%1$s_updated on public.fms_asset_%1$s', t);
    execute format(
      'create trigger trg_fms_asset_%1$s_updated before update on public.fms_asset_%1$s
         for each row execute function public.set_updated_at()', t);
    execute format('alter table public.fms_asset_%1$s enable row level security', t);
    execute format('drop policy if exists fms_asset_%1$s_select on public.fms_asset_%1$s', t);
    execute format(
      'create policy fms_asset_%1$s_select on public.fms_asset_%1$s
         for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---- seeds -----------------------------------------------------------------
-- Only what the module cannot start without. Everything else (locations,
-- vendors, makes, companies, and the asset register itself) is bulk-loaded.
--
-- ⚠ Insurance / PUC / RC / AMC seed as years/1, NOT one_time. fms_asset_next_due
--   returns NULL for one_time, which parks a track permanently — correct only
--   for a genuine one-off, and silently wrong for anything that gets renewed.
insert into public.fms_asset_schedule_types
  (name, kind, default_frequency_value, default_frequency_unit, default_lead_days, sort_order)
values
  ('Periodic Service',      'service',  6, 'months',   15, 1),
  ('Insurance',             'renewal',  1, 'years',    45, 2),
  ('PUC',                   'renewal',  1, 'years',    30, 3),
  ('RC / Fitness',          'renewal',  1, 'years',    45, 4),
  ('Warranty Expiry',       'renewal',  1, 'one_time', 30, 5),
  ('AMC Renewal',           'renewal',  1, 'years',    45, 6),
  ('Calibration',           'service', 12, 'months',   30, 7),
  ('Statutory Inspection',  'service', 12, 'months',   30, 8)
on conflict (name) do nothing;

insert into public.fms_asset_conditions (name, sort_order)
values ('In Use', 1), ('Under Service', 2), ('Under Repair', 3), ('Idle', 4), ('Scrapped', 5), ('Sold', 6)
on conflict (name) do nothing;

insert into public.fms_asset_usage_units (name, sort_order)
values ('KM', 1), ('Hours', 2), ('Cycles', 3)
on conflict (name) do nothing;

insert into public.fms_asset_cost_heads (name, sort_order)
values ('Labour', 1), ('Spares', 2), ('Consumables', 3), ('AMC Fee', 4), ('Statutory Fee', 5)
on conflict (name) do nothing;

insert into public.fms_asset_categories (name, default_lead_days, sort_order)
values
  ('Vehicle', 45, 1), ('Air Conditioner', 15, 2), ('Machinery', 30, 3),
  ('Computer & IT', 15, 4), ('Electrical', 15, 5), ('Furniture', 15, 6),
  ('Safety Equipment', 30, 7)
on conflict (name) do nothing;

-- Pre-offer the right tracks per category. Done as a follow-up update (not in
-- the insert above) because it needs the schedule-type ids, which only exist
-- after their own insert.
update public.fms_asset_categories c
   set default_schedule_type_ids = coalesce(
     (select array_agg(t.id order by t.sort_order)
        from public.fms_asset_schedule_types t
       where t.name = any(v.type_names)), '{}'::uuid[])
  from (values
    ('Vehicle',          array['Periodic Service','Insurance','PUC','RC / Fitness']),
    ('Air Conditioner',  array['Periodic Service','AMC Renewal','Warranty Expiry']),
    ('Machinery',        array['Periodic Service','Calibration','Statutory Inspection','Warranty Expiry']),
    ('Computer & IT',    array['Warranty Expiry','AMC Renewal']),
    ('Electrical',       array['Periodic Service','Warranty Expiry']),
    ('Safety Equipment', array['Statutory Inspection','Periodic Service'])
  ) as v(cat_name, type_names)
 where c.name = v.cat_name
   and c.default_schedule_type_ids = '{}'::uuid[];

-- ===========================================================================
-- MASTER GOVERNANCE — owners per master type + "request a new master" queue.
--
-- 9 master types. `company`, `schedule_type` and `cost_head` are OWNABLE but not
-- offered in the request picker (they are structural, not day-to-day additions)
-- — that split is enforced in the frontend's REQUESTABLE_ASSET_MASTER_TYPES, not
-- here, so an admin can still resolve one if it is ever raised by hand.
-- ===========================================================================
create table if not exists public.fms_asset_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in (
                    'schedule_type','category','location','vendor','make',
                    'company','condition','usage_unit','cost_head')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);
comment on table public.fms_asset_master_managers is
  'Assigns one or more owners per Asset Maintenance master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → admins only.';
create index if not exists fms_asset_master_managers_type_idx
  on public.fms_asset_master_managers (master_type);

drop trigger if exists trg_fms_asset_master_managers_updated on public.fms_asset_master_managers;
create trigger trg_fms_asset_master_managers_updated
  before update on public.fms_asset_master_managers
  for each row execute function public.set_updated_at();

create or replace function public.fms_asset_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_asset_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_asset_is_master_manager(text, uuid) to authenticated;

-- Master writes: admin OR that master's owner. One policy per master table,
-- generated from the (table, master_type) pairing so the two lists cannot drift.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('schedule_types','schedule_type'), ('categories','category'), ('locations','location'),
      ('vendors','vendor'), ('makes','make'), ('companies','company'),
      ('conditions','condition'), ('usage_units','usage_unit'), ('cost_heads','cost_head')
    ) as v(tbl, mtype)
  loop
    execute format('drop policy if exists fms_asset_%1$s_write on public.fms_asset_%1$s', r.tbl);
    execute format(
      'create policy fms_asset_%1$s_write on public.fms_asset_%1$s
         for all to authenticated
         using ((select public.is_admin(auth.uid())) or (select public.fms_asset_is_master_manager(%2$L, auth.uid())))
         with check ((select public.is_admin(auth.uid())) or (select public.fms_asset_is_master_manager(%2$L, auth.uid())))',
      r.tbl, r.mtype);
  end loop;
end $$;

alter table public.fms_asset_master_managers enable row level security;
drop policy if exists fms_asset_master_managers_select on public.fms_asset_master_managers;
create policy fms_asset_master_managers_select on public.fms_asset_master_managers
  for select to authenticated using (true);
drop policy if exists fms_asset_master_managers_write on public.fms_asset_master_managers;
create policy fms_asset_master_managers_write on public.fms_asset_master_managers
  for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

-- ---- "Request a new master" queue -----------------------------------------
create table if not exists public.fms_asset_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in (
                       'schedule_type','category','location','vendor','make',
                       'company','condition','usage_unit','cost_head')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.fms_asset_master_requests is
  'New-master-entry requests from any user. Resolved (approved → real master row created, or rejected) by admin/owner via fms_asset_resolve_master_request.';
create index if not exists fms_asset_master_requests_status_idx
  on public.fms_asset_master_requests (status, master_type);

drop trigger if exists trg_fms_asset_master_requests_updated on public.fms_asset_master_requests;
create trigger trg_fms_asset_master_requests_updated
  before update on public.fms_asset_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_asset_master_requests enable row level security;
drop policy if exists fms_asset_master_requests_select on public.fms_asset_master_requests;
create policy fms_asset_master_requests_select on public.fms_asset_master_requests
  for select to authenticated using (true);
drop policy if exists fms_asset_master_requests_insert on public.fms_asset_master_requests;
create policy fms_asset_master_requests_insert on public.fms_asset_master_requests
  for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending');
drop policy if exists fms_asset_master_requests_update on public.fms_asset_master_requests;
create policy fms_asset_master_requests_update on public.fms_asset_master_requests
  for update to authenticated
  using ((select public.is_admin(auth.uid())) or (select public.fms_asset_is_master_manager(master_type, auth.uid())))
  with check ((select public.is_admin(auth.uid())) or (select public.fms_asset_is_master_manager(master_type, auth.uid())));

-- Resolve a master request: approve (create the real master row) or reject.
-- SECURITY DEFINER so it can insert into the target master regardless of the
-- caller's own per-table policy; re-checks authz and locks the request row.
--
-- ⚠ WIRE CONTRACT: the payload keys below are read VERBATIM and must match
--   frontend/src/apps/asset-maintenance/lib/masterFields.ts. Adding a field
--   there without adding it here silently drops it on approve.
create or replace function public.fms_asset_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
  v_name    text;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_asset_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_asset_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');

  if p_approve then
    if v_name is null then raise exception 'A name is required to approve a master request'; end if;

    if v_type = 'schedule_type' then
      insert into public.fms_asset_schedule_types
        (name, kind, default_frequency_value, default_frequency_unit, default_lead_days, created_by)
      values (v_name,
              coalesce(nullif(trim(v_payload->>'kind'),''), 'service'),
              nullif(v_payload->>'default_frequency_value','')::integer,
              nullif(trim(v_payload->>'default_frequency_unit'),''),
              coalesce(nullif(v_payload->>'default_lead_days','')::integer, 15),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'category' then
      insert into public.fms_asset_categories (name, default_lead_days, created_by)
      values (v_name, nullif(v_payload->>'default_lead_days','')::integer, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'location' then
      insert into public.fms_asset_locations (name, address, created_by)
      values (v_name, nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'vendor' then
      insert into public.fms_asset_vendors (name, contact_person, phone, email, gstin, address, created_by)
      values (v_name, nullif(trim(v_payload->>'contact_person'),''), nullif(trim(v_payload->>'phone'),''),
              nullif(trim(v_payload->>'email'),''), nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'make' then
      insert into public.fms_asset_makes (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'company' then
      insert into public.fms_asset_companies (name, gstin, address, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'),''), nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'condition' then
      insert into public.fms_asset_conditions (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'usage_unit' then
      insert into public.fms_asset_usage_units (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'cost_head' then
      insert into public.fms_asset_cost_heads (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_asset_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_asset_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
comment on function public.fms_asset_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real master row) or reject an Asset Maintenance master request. Admin or the master type''s owner only.';
grant execute on function public.fms_asset_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ===========================================================================
-- STORAGE — private bucket for the purchase invoice / warranty card on an asset
-- and the service bill on a job. Folders: invoice/, warranty/, bill/, doc/.
--
-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's (and vice versa).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-asset-docs', 'fms-asset-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms asset docs read"   on storage.objects;
drop policy if exists "fms asset docs insert" on storage.objects;
drop policy if exists "fms asset docs update" on storage.objects;
drop policy if exists "fms asset docs delete" on storage.objects;

create policy "fms asset docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-asset-docs');
create policy "fms asset docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-asset-docs');
create policy "fms asset docs update" on storage.objects
  for update to authenticated using (bucket_id = 'fms-asset-docs') with check (bucket_id = 'fms-asset-docs');
create policy "fms asset docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-asset-docs');
