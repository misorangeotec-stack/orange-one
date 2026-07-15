-- ===========================================================================
-- OFFICE SUPPLIES PURCHASE FMS — FOUNDATIONS (Phase 1).
--
-- The FOURTH FMS module. Like fms_exit_* / fms_hr_* / fms_purchase_*, it mirrors
-- the config backbone rather than reusing it: modules must stay independently
-- droppable, and a shared step_owners table would collide on step_key.
--
-- A lightweight office-supply requisition FMS: a staff member raises a request,
-- it is (conditionally) approved, then handed over. NO vendor PO, sourcing,
-- quotations, GRN or Tally — those belong to the heavyweight `procurement` app.
--
-- Tables:
--   fms_supplies_step_owners     — one row per workflow step_key → owners
--   fms_supplies_config          — key/value singletons (jsonb)
--   fms_supplies_counters+next_seq — document numbering (SUPPLY-2627-0001, …)
--   fms_supplies_activity        — audit trail
--   fms_supplies_notifications   — per-user bell feed
--   fms_supplies_companies       — master: the buying company
--   fms_supplies_departments     — master: the requester's department + its HOD approver
--   fms_supplies_categories      — master: office-supply category + `requires_approval`
--   fms_supplies_items           — master: the specific item (under a category)
--   fms_supplies_service_types   — master: a Services/Maintenance service
--
-- ── THE ROUTING SWITCH ──────────────────────────────────────────────────────
-- `fms_supplies_categories.requires_approval` is the whole routing decision.
--   true  → request → first approval (HOD) → second approval (Management) → handover
--   false → request → handover (skips both approvals)
-- A Services/Maintenance request skips approvals regardless of category.
--
-- ── THE HOD (FIRST APPROVAL) ────────────────────────────────────────────────
-- There is no departments.hod_id in this portal, so the department master carries
-- its own `hod_user_id`. The `first_approval` step routes PER REQUEST to that
-- person (Phase 2's fms_supplies_can_act), with the step-owner row as an ADDITIVE
-- fallback so a department with no HOD set never leaves the step owned by nobody.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal (reverse order):
--   drop function if exists public.fms_supplies_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_supplies_step_owner_ids(text);
--   drop function if exists public.fms_supplies_is_fulfilment_staff(uuid);
--   drop function if exists public.fms_supplies_is_coordinator(uuid);
--   drop function if exists public.fms_supplies_is_step_owner(text,uuid);
--   drop function if exists public.fms_supplies_next_seq(text);
--   drop function if exists public.fms_supplies_fy_code(date);
--   drop table if exists public.fms_supplies_items, public.fms_supplies_service_types,
--                        public.fms_supplies_categories, public.fms_supplies_departments,
--                        public.fms_supplies_companies, public.fms_supplies_notifications,
--                        public.fms_supplies_activity, public.fms_supplies_counters,
--                        public.fms_supplies_config, public.fms_supplies_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_supplies_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/office-supplies/lib/steps.ts.
-- authorization comes SOLELY from employee_ids; department_ids is a UI filter.
--
-- `request` is never owned (raising IS the step). `first_approval` is owned per
-- request by the department's hod_user_id; any row set here is an ADDITIVE fallback.
-- ===========================================================================
create table if not exists public.fms_supplies_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fms_supplies_step_owners_not_request check (step_key <> 'request')
);

comment on table public.fms_supplies_step_owners is
  'Owners per Office Supplies FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. `request` is barred by CHECK — every employee may raise one.';

drop trigger if exists trg_fms_supplies_step_owners_updated on public.fms_supplies_step_owners;
create trigger trg_fms_supplies_step_owners_updated
  before update on public.fms_supplies_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_supplies_step_owners enable row level security;
drop policy if exists fms_supplies_step_owners_select on public.fms_supplies_step_owners;
create policy fms_supplies_step_owners_select on public.fms_supplies_step_owners
  for select to authenticated using (true);
drop policy if exists fms_supplies_step_owners_write on public.fms_supplies_step_owners;
create policy fms_supplies_step_owners_write on public.fms_supplies_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_supplies_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 1 }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
-- ===========================================================================
create table if not exists public.fms_supplies_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_supplies_config is
  'Singleton Office Supplies FMS settings (step SLAs, coordinators) keyed by name.';

drop trigger if exists trg_fms_supplies_config_updated on public.fms_supplies_config;
create trigger trg_fms_supplies_config_updated
  before update on public.fms_supplies_config
  for each row execute function public.set_updated_at();

alter table public.fms_supplies_config enable row level security;
drop policy if exists fms_supplies_config_select on public.fms_supplies_config;
create policy fms_supplies_config_select on public.fms_supplies_config
  for select to authenticated using (true);
drop policy if exists fms_supplies_config_write on public.fms_supplies_config;
create policy fms_supplies_config_write on public.fms_supplies_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_supplies_counters + fms_supplies_next_seq — atomic document numbering.
-- ===========================================================================
create table if not exists public.fms_supplies_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_supplies_counters is
  'Per-scope document-number sequences (e.g. SUPPLY-2627). Mutated only via fms_supplies_next_seq().';

alter table public.fms_supplies_counters enable row level security;
drop policy if exists fms_supplies_counters_select_admin on public.fms_supplies_counters;
create policy fms_supplies_counters_select_admin on public.fms_supplies_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_supplies_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_supplies_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_supplies_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_supplies_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_supplies_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-07-15 → '2627'.
create or replace function public.fms_supplies_fy_code(p_d date)
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
grant execute on function public.fms_supplies_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step (the global step-owner table).
create or replace function public.fms_supplies_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_supplies_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_supplies_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_supplies_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_supplies_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_supplies_is_coordinator(uuid) to authenticated;

-- "Works the fulfilment side" — owns the second_approval or handover step. These
-- people process every request, so they may read them all. First-approval HODs
-- are handled per-request (they read only their own department's requests).
create or replace function public.fms_supplies_is_fulfilment_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_supplies_step_owners o
    where p_uid = any(o.employee_ids)
      and o.step_key in ('second_approval', 'handover')
  );
$$;
grant execute on function public.fms_supplies_is_fulfilment_staff(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_supplies_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_supplies_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_supplies_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_supplies_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request' | 'master_request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_supplies_activity_entity_idx on public.fms_supplies_activity (entity_type, entity_id);
create index if not exists fms_supplies_activity_created_idx on public.fms_supplies_activity (created_at);

create table if not exists public.fms_supplies_notifications (
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
create index if not exists fms_supplies_notifications_user_idx on public.fms_supplies_notifications (user_id, read_at);
create index if not exists fms_supplies_notifications_created_idx on public.fms_supplies_notifications (created_at);

-- The activity trail carries requester + beneficiary names, so it is scoped to the
-- fulfilment crowd + coordinators, not world-readable.
alter table public.fms_supplies_activity enable row level security;
drop policy if exists fms_supplies_activity_select on public.fms_supplies_activity;
create policy fms_supplies_activity_select on public.fms_supplies_activity
  for select to authenticated
  using (public.fms_supplies_is_coordinator(auth.uid()) or public.fms_supplies_is_fulfilment_staff(auth.uid()));
drop policy if exists fms_supplies_activity_write_admin on public.fms_supplies_activity;
create policy fms_supplies_activity_write_admin on public.fms_supplies_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_supplies_notifications enable row level security;
drop policy if exists fms_supplies_notifications_select_own on public.fms_supplies_notifications;
create policy fms_supplies_notifications_select_own on public.fms_supplies_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_supplies_notifications_update_own on public.fms_supplies_notifications;
create policy fms_supplies_notifications_update_own on public.fms_supplies_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_supplies_notifications_write_admin on public.fms_supplies_notifications;
create policy fms_supplies_notifications_write_admin on public.fms_supplies_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state.
drop function if exists public.fms_supplies_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_supplies_announce(
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
  insert into public.fms_supplies_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_supplies_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_supplies_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — edited via the shared MasterCrud.
-- Select = all authenticated (dropdown fodder); write = admin until the master
-- governance migration relaxes it to the master's owner.
-- ===========================================================================

create table if not exists public.fms_supplies_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_supplies_companies is 'The buying companies (Orange O Tec entities).';

-- The department carries its own HOD (first-approval) approver — there is no
-- departments.hod_id in this portal.
create table if not exists public.fms_supplies_departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  hod_user_id uuid references auth.users on delete set null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_supplies_departments is
  'The requester departments. hod_user_id is the first-approval (HOD) approver for requests raised under this department; null falls back to the first_approval step owners.';

-- `requires_approval` is the routing switch: true → two approvals; false → straight to handover.
create table if not exists public.fms_supplies_categories (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  requires_approval boolean not null default false,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_by        uuid references auth.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.fms_supplies_categories is
  'Office-supply categories. requires_approval decides the route: true = HOD + Management approval; false = straight to handover.';

create table if not exists public.fms_supplies_items (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.fms_supplies_categories on delete cascade,
  name        text not null,
  unit        text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (category_id, name)
);
comment on table public.fms_supplies_items is 'The specific items available under each category.';
create index if not exists fms_supplies_items_category_idx on public.fms_supplies_items (category_id);

create table if not exists public.fms_supplies_service_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_supplies_service_types is 'Services/Maintenance service types (Desktop/Laptop support, Printer support, …).';

do $$
declare t text;
begin
  foreach t in array array[
    'fms_supplies_companies','fms_supplies_departments','fms_supplies_categories',
    'fms_supplies_items','fms_supplies_service_types'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated
                    using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t);
  end loop;
end $$;

-- ---- Seeds (idempotent; owners edit these in Masters afterwards) ------------

insert into public.fms_supplies_companies (name, sort_order) values
  ('Orange O tec Pvt Ltd', 1),
  ('Orange O tec Enterprise Pvt Ltd', 2)
on conflict (name) do nothing;

insert into public.fms_supplies_departments (name, sort_order) values
  ('Account/Finance', 1), ('Exim', 2), ('Collection', 3), ('Plant-Sachin', 4),
  ('Hojiwala', 5), ('Noida', 6), ('Sales Team', 7), ('Service Team', 8),
  ('Marketing', 9), ('HR', 10), ('MIS', 11)
on conflict (name) do nothing;

-- The routing switch is seeded here: Computer & Tech Accessories needs both
-- approvals; Stationery and Office Maintenance go straight to handover.
insert into public.fms_supplies_categories (name, requires_approval, sort_order) values
  ('Stationery Items', false, 1),
  ('Computer & Tech Accessories (basic)', true, 2),
  ('Office Maintenance Items', false, 3)
on conflict (name) do nothing;

-- Items, under their category (idempotent by (category_id, name)).
do $$
declare
  v_stationery uuid;
  v_computer   uuid;
  v_maint      uuid;
begin
  select id into v_stationery from public.fms_supplies_categories where name = 'Stationery Items';
  select id into v_computer   from public.fms_supplies_categories where name = 'Computer & Tech Accessories (basic)';
  select id into v_maint      from public.fms_supplies_categories where name = 'Office Maintenance Items';

  insert into public.fms_supplies_items (category_id, name, sort_order)
  select v_stationery, x.name, x.ord from (values
    ('Pens, pencils, erasers', 1), ('Notebooks, writing pads', 2), ('Files, folders', 3),
    ('Sticky notes', 4), ('Markers, highlighters', 5), ('Stapler, pins', 6),
    ('Calculator', 7), ('Printer Paper', 8), ('Other', 99)
  ) as x(name, ord)
  on conflict (category_id, name) do nothing;

  insert into public.fms_supplies_items (category_id, name, sort_order)
  select v_computer, x.name, x.ord from (values
    ('New Laptop', 1), ('New Desktop', 2), ('New Printer', 3), ('Mobile Phone', 4),
    ('New Sim Card', 5), ('Mouse', 6), ('Keyboard', 7), ('USB drives', 8),
    ('Laptop charger (basic replacement)', 9), ('Other', 99)
  ) as x(name, ord)
  on conflict (category_id, name) do nothing;

  insert into public.fms_supplies_items (category_id, name, sort_order)
  select v_maint, x.name, x.ord from (values
    ('Dustbin', 1), ('Cleaning cloths', 2), ('Air freshener', 3), ('Tissue papers', 4), ('Other', 99)
  ) as x(name, ord)
  on conflict (category_id, name) do nothing;
end $$;

insert into public.fms_supplies_service_types (name, sort_order) values
  ('Desktop/Laptop Support', 1),
  ('Printer & scanner support', 2),
  ('Network / internet services', 3),
  ('Other', 99)
on conflict (name) do nothing;
