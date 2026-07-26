-- ===========================================================================
-- SAMPLING FMS — FOUNDATIONS (Phase 1).
--
-- The SIXTH FMS module (ink / raw-material sampling). Like fms_supplies_* /
-- fms_exit_* / fms_hr_* / fms_import_* / fms_purchase_*, it mirrors the config
-- backbone into its OWN tables rather than reusing a shared one: modules must
-- stay independently droppable, and a shared step_owners table would collide on
-- step_key.
--
-- WHAT SAMPLING IS
--   A lab-sampling tracker. Someone raises a sampling request; the sample is
--   received (inward) or sent (outward) and confirmed received; it is tested;
--   the result is recorded and the request closes. NO PO, quotations, GRN,
--   payments or approvals — sampling is pure movement + testing + result.
--
-- Tables:
--   fms_sampling_step_owners     — one row per workflow step_key → owners
--   fms_sampling_config          — key/value singletons (jsonb)
--   fms_sampling_counters+next_seq — document numbering (SMP-2627-0001, …)
--   fms_sampling_activity        — audit trail
--   fms_sampling_notifications   — per-user bell feed
--   fms_sampling_companies       — master: the Orange O Tec entity
--   fms_sampling_master_managers — per-master-type owners (Setup → Master Owners)
--
-- Company is the ONLY master, and it is STRUCTURAL (rarely added), so there is
-- NO "request a new master" queue — an admin or the company master's owner adds
-- one directly on the Masters page (mirrors how office-supplies treats company /
-- department / category: ownable but not requestable).
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal (reverse order):
--   drop function if exists public.fms_sampling_resolve_... (none — no requests flow);
--   drop function if exists public.fms_sampling_is_master_manager(text,uuid);
--   drop function if exists public.fms_sampling_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_sampling_step_owner_ids(text);
--   drop function if exists public.fms_sampling_is_coordinator(uuid);
--   drop function if exists public.fms_sampling_is_step_owner(text,uuid);
--   drop function if exists public.fms_sampling_next_seq(text);
--   drop function if exists public.fms_sampling_fy_code(date);
--   drop table if exists public.fms_sampling_master_managers, public.fms_sampling_companies,
--                        public.fms_sampling_notifications, public.fms_sampling_activity,
--                        public.fms_sampling_counters, public.fms_sampling_config,
--                        public.fms_sampling_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_sampling_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/sampling/lib/steps.ts.
-- authorization comes SOLELY from employee_ids; department_ids is a UI filter.
-- `request` is never owned (raising IS the step).
-- ===========================================================================
create table if not exists public.fms_sampling_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fms_sampling_step_owners_not_request check (step_key <> 'request')
);

comment on table public.fms_sampling_step_owners is
  'Owners per Sampling FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. `request` is barred by CHECK — every granted user may raise one.';

drop trigger if exists trg_fms_sampling_step_owners_updated on public.fms_sampling_step_owners;
create trigger trg_fms_sampling_step_owners_updated
  before update on public.fms_sampling_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_sampling_step_owners enable row level security;
drop policy if exists fms_sampling_step_owners_select on public.fms_sampling_step_owners;
create policy fms_sampling_step_owners_select on public.fms_sampling_step_owners
  for select to authenticated using (true);
drop policy if exists fms_sampling_step_owners_write on public.fms_sampling_step_owners;
create policy fms_sampling_step_owners_write on public.fms_sampling_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_sampling_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 1 }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
-- ===========================================================================
create table if not exists public.fms_sampling_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_sampling_config is
  'Singleton Sampling FMS settings (step SLAs, coordinators) keyed by name.';

drop trigger if exists trg_fms_sampling_config_updated on public.fms_sampling_config;
create trigger trg_fms_sampling_config_updated
  before update on public.fms_sampling_config
  for each row execute function public.set_updated_at();

alter table public.fms_sampling_config enable row level security;
drop policy if exists fms_sampling_config_select on public.fms_sampling_config;
create policy fms_sampling_config_select on public.fms_sampling_config
  for select to authenticated using (true);
drop policy if exists fms_sampling_config_write on public.fms_sampling_config;
create policy fms_sampling_config_write on public.fms_sampling_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_sampling_counters + fms_sampling_next_seq — atomic document numbering.
-- ===========================================================================
create table if not exists public.fms_sampling_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_sampling_counters is
  'Per-scope document-number sequences (e.g. SMP-2627). Mutated only via fms_sampling_next_seq().';

alter table public.fms_sampling_counters enable row level security;
drop policy if exists fms_sampling_counters_select_admin on public.fms_sampling_counters;
create policy fms_sampling_counters_select_admin on public.fms_sampling_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_sampling_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_sampling_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_sampling_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_sampling_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_sampling_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-07-24 → '2627'.
create or replace function public.fms_sampling_fy_code(p_d date)
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
grant execute on function public.fms_sampling_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_sampling_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_sampling_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_sampling_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_sampling_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_sampling_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_sampling_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_sampling_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_sampling_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_sampling_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_sampling_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_sampling_activity_entity_idx on public.fms_sampling_activity (entity_type, entity_id);
create index if not exists fms_sampling_activity_created_idx on public.fms_sampling_activity (created_at);

create table if not exists public.fms_sampling_notifications (
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
create index if not exists fms_sampling_notifications_user_idx on public.fms_sampling_notifications (user_id, read_at);
create index if not exists fms_sampling_notifications_created_idx on public.fms_sampling_notifications (created_at);

-- Sampling is a per-user-granted app (not universal), so the whole audience is
-- the sampling team; the activity trail is readable by every granted user.
alter table public.fms_sampling_activity enable row level security;
drop policy if exists fms_sampling_activity_select on public.fms_sampling_activity;
create policy fms_sampling_activity_select on public.fms_sampling_activity
  for select to authenticated using (true);
drop policy if exists fms_sampling_activity_write_admin on public.fms_sampling_activity;
create policy fms_sampling_activity_write_admin on public.fms_sampling_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_sampling_notifications enable row level security;
drop policy if exists fms_sampling_notifications_select_own on public.fms_sampling_notifications;
create policy fms_sampling_notifications_select_own on public.fms_sampling_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_sampling_notifications_update_own on public.fms_sampling_notifications;
create policy fms_sampling_notifications_update_own on public.fms_sampling_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_sampling_notifications_write_admin on public.fms_sampling_notifications;
create policy fms_sampling_notifications_write_admin on public.fms_sampling_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state.
drop function if exists public.fms_sampling_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_sampling_announce(
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
  insert into public.fms_sampling_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_sampling_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_sampling_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — the company, edited via the shared MasterCrud.
-- Select = all authenticated (dropdown fodder); write = admin OR the company
-- master's owner (relaxed below).
-- ===========================================================================
create table if not exists public.fms_sampling_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_sampling_companies is 'The Orange O Tec entities a sampling request belongs to.';

drop trigger if exists trg_fms_sampling_companies_updated on public.fms_sampling_companies;
create trigger trg_fms_sampling_companies_updated
  before update on public.fms_sampling_companies
  for each row execute function public.set_updated_at();

alter table public.fms_sampling_companies enable row level security;
drop policy if exists fms_sampling_companies_select on public.fms_sampling_companies;
create policy fms_sampling_companies_select on public.fms_sampling_companies
  for select to authenticated using (true);

-- ===========================================================================
-- MASTER GOVERNANCE — owners per master type (only 'company' today).
-- ===========================================================================
create table if not exists public.fms_sampling_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in ('company')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);
comment on table public.fms_sampling_master_managers is
  'Assigns one or more owners per Sampling master type; owners may CRUD that master. Unassigned → admins only.';
create index if not exists fms_sampling_master_managers_type_idx
  on public.fms_sampling_master_managers (master_type);

drop trigger if exists trg_fms_sampling_master_managers_updated on public.fms_sampling_master_managers;
create trigger trg_fms_sampling_master_managers_updated
  before update on public.fms_sampling_master_managers
  for each row execute function public.set_updated_at();

create or replace function public.fms_sampling_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_sampling_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_sampling_is_master_manager(text, uuid) to authenticated;

-- Company write: admin OR the company master's owner.
drop policy if exists fms_sampling_companies_write on public.fms_sampling_companies;
create policy fms_sampling_companies_write on public.fms_sampling_companies
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('company', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('company', auth.uid()));

alter table public.fms_sampling_master_managers enable row level security;
drop policy if exists fms_sampling_master_managers_select on public.fms_sampling_master_managers;
create policy fms_sampling_master_managers_select on public.fms_sampling_master_managers
  for select to authenticated using (true);
drop policy if exists fms_sampling_master_managers_write on public.fms_sampling_master_managers;
create policy fms_sampling_master_managers_write on public.fms_sampling_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---- Seeds (idempotent; owners edit these in Masters afterwards) ------------
insert into public.fms_sampling_companies (name, sort_order) values
  ('Orange O tec Pvt Ltd', 1),
  ('Orange O tec Enterprise Pvt Ltd', 2)
on conflict (name) do nothing;

-- ===========================================================================
-- STORAGE — private bucket for the result/lab-report attachment.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-sampling-docs', 'fms-sampling-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms sampling docs read"   on storage.objects;
drop policy if exists "fms sampling docs insert" on storage.objects;
drop policy if exists "fms sampling docs update" on storage.objects;
drop policy if exists "fms sampling docs delete" on storage.objects;

create policy "fms sampling docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-sampling-docs');
create policy "fms sampling docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-sampling-docs');
create policy "fms sampling docs update" on storage.objects
  for update to authenticated using (bucket_id = 'fms-sampling-docs') with check (bucket_id = 'fms-sampling-docs');
create policy "fms sampling docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-sampling-docs');
