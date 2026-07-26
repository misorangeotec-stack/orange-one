-- ===========================================================================
-- PRODUCTION ENTRY FMS — FOUNDATIONS + MASTERS (Phase 1).
--
-- The SEVENTH FMS module (ink production floor). Like fms_sampling_* /
-- fms_import_* / fms_supplies_* / fms_exit_* / fms_hr_*, it mirrors the config
-- backbone into its OWN tables rather than reusing a shared one: modules must
-- stay independently droppable, and a shared step_owners table would collide on
-- step_key.
--
-- WHAT PRODUCTION ENTRY IS
--   A job-card tracker for making ink. Someone raises an issue slip (job card);
--   the card then moves, in order, through TEN steps — material handover,
--   transfer slip & batch card, production entry, quality checking, M/C testing,
--   packing-material handover, packing-material transfer, packing entry, and
--   finished-good transfer to Hojiwala — each owned by a different person who
--   records dates, a status, quantities and remarks. NO approvals, NO PO,
--   NO quotations — it is pure sequential shop-floor movement.
--
-- Tables:
--   fms_production_step_owners     — one row per workflow step_key → owners
--   fms_production_config          — key/value singletons (jsonb)
--   fms_production_counters+next_seq — document numbering (PRD-2627-0001, …)
--   fms_production_activity        — audit trail
--   fms_production_notifications   — per-user bell feed
--   fms_production_categories      — master: issue-slip category
--   fms_production_raw_materials   — master: raw material name
--   fms_production_fg_items        — master: finished-good item
--   fms_production_units           — master: unit of measure (kg, litre, …)
--   fms_production_master_managers — per-master-type owners (Setup → Master Owners)
--   fms_production_master_requests — "Request a new master" submissions queue
--
-- The four masters are FLAT lists (no parent hierarchy), each editable through the
-- shared MasterCrud, and each supports the "request a missing one → owner approves"
-- flow ported from Import.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal (reverse order):
--   drop function if exists public.fms_production_resolve_master_request(uuid,boolean,jsonb,text);
--   drop function if exists public.fms_production_is_master_manager(text,uuid);
--   drop function if exists public.fms_production_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_production_step_owner_ids(text);
--   drop function if exists public.fms_production_is_coordinator(uuid);
--   drop function if exists public.fms_production_is_step_owner(text,uuid);
--   drop function if exists public.fms_production_next_seq(text);
--   drop function if exists public.fms_production_fy_code(date);
--   drop table if exists public.fms_production_master_requests, public.fms_production_master_managers,
--                        public.fms_production_units, public.fms_production_fg_items,
--                        public.fms_production_raw_materials, public.fms_production_categories,
--                        public.fms_production_notifications, public.fms_production_activity,
--                        public.fms_production_counters, public.fms_production_config,
--                        public.fms_production_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_production_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/production-entry/lib/steps.ts.
-- authorization comes SOLELY from employee_ids; department_ids is a UI filter.
-- `issue_slip` is never owned (raising the job card IS the step).
-- ===========================================================================
create table if not exists public.fms_production_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fms_production_step_owners_not_issue check (step_key <> 'issue_slip')
);

comment on table public.fms_production_step_owners is
  'Owners per Production Entry FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. `issue_slip` is barred by CHECK — every granted user may raise a job card.';

drop trigger if exists trg_fms_production_step_owners_updated on public.fms_production_step_owners;
create trigger trg_fms_production_step_owners_updated
  before update on public.fms_production_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_production_step_owners enable row level security;
drop policy if exists fms_production_step_owners_select on public.fms_production_step_owners;
create policy fms_production_step_owners_select on public.fms_production_step_owners
  for select to authenticated using (true);
drop policy if exists fms_production_step_owners_write on public.fms_production_step_owners;
create policy fms_production_step_owners_write on public.fms_production_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_production_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 1 }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
-- ===========================================================================
create table if not exists public.fms_production_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_production_config is
  'Singleton Production Entry FMS settings (step SLAs, coordinators) keyed by name.';

drop trigger if exists trg_fms_production_config_updated on public.fms_production_config;
create trigger trg_fms_production_config_updated
  before update on public.fms_production_config
  for each row execute function public.set_updated_at();

alter table public.fms_production_config enable row level security;
drop policy if exists fms_production_config_select on public.fms_production_config;
create policy fms_production_config_select on public.fms_production_config
  for select to authenticated using (true);
drop policy if exists fms_production_config_write on public.fms_production_config;
create policy fms_production_config_write on public.fms_production_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_production_counters + fms_production_next_seq — atomic document numbering.
-- ===========================================================================
create table if not exists public.fms_production_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_production_counters is
  'Per-scope document-number sequences (e.g. PRD-2627). Mutated only via fms_production_next_seq().';

alter table public.fms_production_counters enable row level security;
drop policy if exists fms_production_counters_select_admin on public.fms_production_counters;
create policy fms_production_counters_select_admin on public.fms_production_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_production_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_production_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_production_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_production_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_production_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-07-25 → '2627'.
create or replace function public.fms_production_fy_code(p_d date)
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
grant execute on function public.fms_production_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_production_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_production_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_production_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_production_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_production_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_production_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_production_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_production_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_production_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_production_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request' | 'master_request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_production_activity_entity_idx on public.fms_production_activity (entity_type, entity_id);
create index if not exists fms_production_activity_created_idx on public.fms_production_activity (created_at);

create table if not exists public.fms_production_notifications (
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
create index if not exists fms_production_notifications_user_idx on public.fms_production_notifications (user_id, read_at);
create index if not exists fms_production_notifications_created_idx on public.fms_production_notifications (created_at);

-- Production Entry is a per-user-granted app (not universal), so the whole audience
-- is the production team; the activity trail is readable by every granted user.
alter table public.fms_production_activity enable row level security;
drop policy if exists fms_production_activity_select on public.fms_production_activity;
create policy fms_production_activity_select on public.fms_production_activity
  for select to authenticated using (true);
drop policy if exists fms_production_activity_write_admin on public.fms_production_activity;
create policy fms_production_activity_write_admin on public.fms_production_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_production_notifications enable row level security;
drop policy if exists fms_production_notifications_select_own on public.fms_production_notifications;
create policy fms_production_notifications_select_own on public.fms_production_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_production_notifications_update_own on public.fms_production_notifications;
create policy fms_production_notifications_update_own on public.fms_production_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_production_notifications_write_admin on public.fms_production_notifications;
create policy fms_production_notifications_write_admin on public.fms_production_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state.
drop function if exists public.fms_production_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_production_announce(
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
  insert into public.fms_production_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_production_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_production_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — four flat lists, edited via the shared MasterCrud. Select = all
-- authenticated (dropdown fodder); write = admin OR that master's owner.
-- ===========================================================================
create table if not exists public.fms_production_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_production_categories is 'Issue-slip category master for Production Entry FMS.';

create table if not exists public.fms_production_raw_materials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_production_raw_materials is 'Raw material master for Production Entry FMS.';

create table if not exists public.fms_production_fg_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_production_fg_items is 'Finished-good item master for Production Entry FMS.';

create table if not exists public.fms_production_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_production_units is 'Unit-of-measure master for Production Entry FMS (kg, litre, …).';

-- updated_at triggers for each master
drop trigger if exists trg_fms_production_categories_updated on public.fms_production_categories;
create trigger trg_fms_production_categories_updated
  before update on public.fms_production_categories for each row execute function public.set_updated_at();
drop trigger if exists trg_fms_production_raw_materials_updated on public.fms_production_raw_materials;
create trigger trg_fms_production_raw_materials_updated
  before update on public.fms_production_raw_materials for each row execute function public.set_updated_at();
drop trigger if exists trg_fms_production_fg_items_updated on public.fms_production_fg_items;
create trigger trg_fms_production_fg_items_updated
  before update on public.fms_production_fg_items for each row execute function public.set_updated_at();
drop trigger if exists trg_fms_production_units_updated on public.fms_production_units;
create trigger trg_fms_production_units_updated
  before update on public.fms_production_units for each row execute function public.set_updated_at();

-- Select policies (all authenticated) for each master.
alter table public.fms_production_categories enable row level security;
drop policy if exists fms_production_categories_select on public.fms_production_categories;
create policy fms_production_categories_select on public.fms_production_categories
  for select to authenticated using (true);

alter table public.fms_production_raw_materials enable row level security;
drop policy if exists fms_production_raw_materials_select on public.fms_production_raw_materials;
create policy fms_production_raw_materials_select on public.fms_production_raw_materials
  for select to authenticated using (true);

alter table public.fms_production_fg_items enable row level security;
drop policy if exists fms_production_fg_items_select on public.fms_production_fg_items;
create policy fms_production_fg_items_select on public.fms_production_fg_items
  for select to authenticated using (true);

alter table public.fms_production_units enable row level security;
drop policy if exists fms_production_units_select on public.fms_production_units;
create policy fms_production_units_select on public.fms_production_units
  for select to authenticated using (true);

-- ===========================================================================
-- MASTER GOVERNANCE — owners per master type + "request a new master" queue.
-- ===========================================================================
create table if not exists public.fms_production_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in ('category','raw_material','fg_item','unit')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);
comment on table public.fms_production_master_managers is
  'Assigns one or more owners per Production master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → admins only.';
create index if not exists fms_production_master_managers_type_idx
  on public.fms_production_master_managers (master_type);

drop trigger if exists trg_fms_production_master_managers_updated on public.fms_production_master_managers;
create trigger trg_fms_production_master_managers_updated
  before update on public.fms_production_master_managers
  for each row execute function public.set_updated_at();

create or replace function public.fms_production_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_production_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_production_is_master_manager(text, uuid) to authenticated;

-- Master writes: admin OR that master's owner. (One policy per master table.)
drop policy if exists fms_production_categories_write on public.fms_production_categories;
create policy fms_production_categories_write on public.fms_production_categories
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('category', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('category', auth.uid()));

drop policy if exists fms_production_raw_materials_write on public.fms_production_raw_materials;
create policy fms_production_raw_materials_write on public.fms_production_raw_materials
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('raw_material', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('raw_material', auth.uid()));

drop policy if exists fms_production_fg_items_write on public.fms_production_fg_items;
create policy fms_production_fg_items_write on public.fms_production_fg_items
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('fg_item', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('fg_item', auth.uid()));

drop policy if exists fms_production_units_write on public.fms_production_units;
create policy fms_production_units_write on public.fms_production_units
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('unit', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('unit', auth.uid()));

alter table public.fms_production_master_managers enable row level security;
drop policy if exists fms_production_master_managers_select on public.fms_production_master_managers;
create policy fms_production_master_managers_select on public.fms_production_master_managers
  for select to authenticated using (true);
drop policy if exists fms_production_master_managers_write on public.fms_production_master_managers;
create policy fms_production_master_managers_write on public.fms_production_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---- "Request a new master" queue -----------------------------------------
create table if not exists public.fms_production_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in ('category','raw_material','fg_item','unit')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.fms_production_master_requests is
  'New-master-entry requests from any user. Resolved (approved → real master row created, or rejected) by admin/manager via fms_production_resolve_master_request.';
create index if not exists fms_production_master_requests_status_idx
  on public.fms_production_master_requests (status, master_type);

drop trigger if exists trg_fms_production_master_requests_updated on public.fms_production_master_requests;
create trigger trg_fms_production_master_requests_updated
  before update on public.fms_production_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_production_master_requests enable row level security;
drop policy if exists fms_production_master_requests_select on public.fms_production_master_requests;
create policy fms_production_master_requests_select on public.fms_production_master_requests
  for select to authenticated using (true);
drop policy if exists fms_production_master_requests_insert on public.fms_production_master_requests;
create policy fms_production_master_requests_insert on public.fms_production_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');
drop policy if exists fms_production_master_requests_update on public.fms_production_master_requests;
create policy fms_production_master_requests_update on public.fms_production_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager(master_type, auth.uid()));

-- Resolve a master request: approve (create the real master row) or reject.
-- SECURITY DEFINER so it can insert into the target master regardless of the
-- caller's own per-table policy; re-checks authz and locks the request row.
create or replace function public.fms_production_resolve_master_request(
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
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_production_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_production_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'category' then
      insert into public.fms_production_categories (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'raw_material' then
      insert into public.fms_production_raw_materials (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'fg_item' then
      insert into public.fms_production_fg_items (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'unit' then
      insert into public.fms_production_units (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_production_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_production_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
comment on function public.fms_production_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real master row) or reject a Production master request. Admin or the master type''s owner only.';
grant execute on function public.fms_production_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ===========================================================================
-- STORAGE — private bucket for the Quality-Checking test-report attachment.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-production-docs', 'fms-production-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms production docs read"   on storage.objects;
drop policy if exists "fms production docs insert" on storage.objects;
drop policy if exists "fms production docs update" on storage.objects;
drop policy if exists "fms production docs delete" on storage.objects;

create policy "fms production docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-production-docs');
create policy "fms production docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-production-docs');
create policy "fms production docs update" on storage.objects
  for update to authenticated using (bucket_id = 'fms-production-docs') with check (bucket_id = 'fms-production-docs');
create policy "fms production docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-production-docs');
