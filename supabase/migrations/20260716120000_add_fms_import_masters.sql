-- Purchase FMS (import) — MASTERS + the "Request new master" sub-flow.
--
-- This is Phase 1 of a brand-new, purpose-built import workflow module
-- (distinct from the generic `fms_*` engine). All tables are prefixed
-- `fms_import_` (convention `fms_<workflow>_<table>`). The masters are the
-- reusable foundation that the workflow tables (Phase 3+) build on.
--
-- Tables (all in public, all RLS-enabled):
--   Masters         fms_import_companies     — buyer companies (name + optional location)
--                   fms_import_categories    — top of the item hierarchy
--                   fms_import_item_groups   — under a category
--                   fms_import_items         — under a group; carries its unit
--                   fms_import_vendors       — shared across companies
--   Governance      fms_import_master_managers — per-master-type assigned managers (Setup)
--                   fms_import_master_requests — "Request new …" submissions queue
--   Helper          fms_import_is_master_manager(text, uuid)
--   RPC             fms_import_resolve_master_request(uuid, boolean, jsonb, text)
--
-- RLS model: masters are readable by all authenticated users; writes are allowed
-- for admins OR the assigned manager of that master type. master_requests can be
-- raised by any authenticated user (for themselves) and resolved by admin/manager
-- (via the SECURITY DEFINER RPC, which inserts the real master row on approval).
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Reuses the existing
-- public.set_updated_at() and public.is_admin(uuid) helpers. Apply in the Orange
-- One *identity* Supabase project (ref coshondiqdhorwvibrwu) via the SQL editor
-- or `supabase db push`, BEFORE the Phase-1 frontend goes live.
--
-- Reversal (drop in dependency order):
--   drop function if exists public.fms_import_resolve_master_request(uuid, boolean, jsonb, text);
--   drop function if exists public.fms_import_is_master_manager(text, uuid);
--   drop table if exists public.fms_import_master_requests;
--   drop table if exists public.fms_import_master_managers;
--   drop table if exists public.fms_import_items;
--   drop table if exists public.fms_import_item_groups;
--   drop table if exists public.fms_import_categories;
--   drop table if exists public.fms_import_vendors;
--   drop table if exists public.fms_import_companies;

-- ===========================================================================
-- fms_import_companies — buyer companies (name + optional location).
-- ===========================================================================
create table if not exists public.fms_import_companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, location)
);

comment on table public.fms_import_companies is
  'Buyer companies for Purchase FMS. A row is a company (+ optional location); the Stage-1 request picks one.';

drop trigger if exists trg_fms_import_companies_updated on public.fms_import_companies;
create trigger trg_fms_import_companies_updated
  before update on public.fms_import_companies
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_import_categories — top of the item hierarchy.
-- ===========================================================================
create table if not exists public.fms_import_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_fms_import_categories_updated on public.fms_import_categories;
create trigger trg_fms_import_categories_updated
  before update on public.fms_import_categories
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_import_item_groups — under a category.
-- ===========================================================================
create table if not exists public.fms_import_item_groups (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.fms_import_categories on delete cascade,
  name        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists fms_import_item_groups_cat_idx
  on public.fms_import_item_groups (category_id);

drop trigger if exists trg_fms_import_item_groups_updated on public.fms_import_item_groups;
create trigger trg_fms_import_item_groups_updated
  before update on public.fms_import_item_groups
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_import_items — under a group; carries its unit.
-- ===========================================================================
create table if not exists public.fms_import_items (
  id            uuid primary key default gen_random_uuid(),
  item_group_id uuid not null references public.fms_import_item_groups on delete cascade,
  name          text not null,
  unit          text not null default '',
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (item_group_id, name)
);

create index if not exists fms_import_items_group_idx
  on public.fms_import_items (item_group_id);

drop trigger if exists trg_fms_import_items_updated on public.fms_import_items;
create trigger trg_fms_import_items_updated
  before update on public.fms_import_items
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_import_vendors — shared across companies.
-- ===========================================================================
create table if not exists public.fms_import_vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  gstin         text,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  active        boolean not null default true,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_fms_import_vendors_updated on public.fms_import_vendors;
create trigger trg_fms_import_vendors_updated
  before update on public.fms_import_vendors
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_import_master_managers — per-master-type assigned managers (Setup).
-- ===========================================================================
create table if not exists public.fms_import_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in ('company','category','item_group','item','vendor')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_import_master_managers is
  'Assigns one or more managers per master type; managers may CRUD that master and resolve its new-entry requests.';

create index if not exists fms_import_master_managers_type_idx
  on public.fms_import_master_managers (master_type);

drop trigger if exists trg_fms_import_master_managers_updated on public.fms_import_master_managers;
create trigger trg_fms_import_master_managers_updated
  before update on public.fms_import_master_managers
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_import_master_requests — "Request new …" submissions queue.
-- ===========================================================================
create table if not exists public.fms_import_master_requests (
  id                uuid primary key default gen_random_uuid(),
  master_type       text not null check (master_type in ('company','category','item_group','item','vendor')),
  proposed_payload  jsonb not null default '{}',
  status            text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by      uuid references auth.users on delete set null,
  reviewed_by       uuid references auth.users on delete set null,
  review_note       text,
  resolved_master_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.fms_import_master_requests is
  'New-master-entry requests from any user. Resolved (approved → real master row created, or rejected) by admin/manager via fms_import_resolve_master_request.';

create index if not exists fms_import_master_requests_status_idx
  on public.fms_import_master_requests (status, master_type);

drop trigger if exists trg_fms_import_master_requests_updated on public.fms_import_master_requests;
create trigger trg_fms_import_master_requests_updated
  before update on public.fms_import_master_requests
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- HELPER — is the user an assigned manager of the given master type?
-- security definer so it can read fms_import_master_managers under RLS.
-- ===========================================================================
create or replace function public.fms_import_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_import_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;

comment on function public.fms_import_is_master_manager(text, uuid) is
  'True if p_uid is an assigned manager of the given master type.';

-- ===========================================================================
-- RLS — masters: read all; write by admin or that master''s manager.
-- A small helper macro is inlined per table (policies can''t be parameterised).
-- ===========================================================================

-- companies
alter table public.fms_import_companies enable row level security;
drop policy if exists fms_import_companies_select on public.fms_import_companies;
create policy fms_import_companies_select on public.fms_import_companies
  for select to authenticated using (true);
drop policy if exists fms_import_companies_write on public.fms_import_companies;
create policy fms_import_companies_write on public.fms_import_companies
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('company', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('company', auth.uid()));

-- categories
alter table public.fms_import_categories enable row level security;
drop policy if exists fms_import_categories_select on public.fms_import_categories;
create policy fms_import_categories_select on public.fms_import_categories
  for select to authenticated using (true);
drop policy if exists fms_import_categories_write on public.fms_import_categories;
create policy fms_import_categories_write on public.fms_import_categories
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('category', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('category', auth.uid()));

-- item_groups
alter table public.fms_import_item_groups enable row level security;
drop policy if exists fms_import_item_groups_select on public.fms_import_item_groups;
create policy fms_import_item_groups_select on public.fms_import_item_groups
  for select to authenticated using (true);
drop policy if exists fms_import_item_groups_write on public.fms_import_item_groups;
create policy fms_import_item_groups_write on public.fms_import_item_groups
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('item_group', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('item_group', auth.uid()));

-- items
alter table public.fms_import_items enable row level security;
drop policy if exists fms_import_items_select on public.fms_import_items;
create policy fms_import_items_select on public.fms_import_items
  for select to authenticated using (true);
drop policy if exists fms_import_items_write on public.fms_import_items;
create policy fms_import_items_write on public.fms_import_items
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('item', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('item', auth.uid()));

-- vendors
alter table public.fms_import_vendors enable row level security;
drop policy if exists fms_import_vendors_select on public.fms_import_vendors;
create policy fms_import_vendors_select on public.fms_import_vendors
  for select to authenticated using (true);
drop policy if exists fms_import_vendors_write on public.fms_import_vendors;
create policy fms_import_vendors_write on public.fms_import_vendors
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('vendor', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager('vendor', auth.uid()));

-- ===========================================================================
-- RLS — master_managers: read all; write admin-only (Setup config).
-- ===========================================================================
alter table public.fms_import_master_managers enable row level security;
drop policy if exists fms_import_master_managers_select on public.fms_import_master_managers;
create policy fms_import_master_managers_select on public.fms_import_master_managers
  for select to authenticated using (true);
drop policy if exists fms_import_master_managers_write on public.fms_import_master_managers;
create policy fms_import_master_managers_write on public.fms_import_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RLS — master_requests: read all; any user may raise their own; resolve by
-- admin/manager (update). No client delete.
-- ===========================================================================
alter table public.fms_import_master_requests enable row level security;
drop policy if exists fms_import_master_requests_select on public.fms_import_master_requests;
create policy fms_import_master_requests_select on public.fms_import_master_requests
  for select to authenticated using (true);

drop policy if exists fms_import_master_requests_insert on public.fms_import_master_requests;
create policy fms_import_master_requests_insert on public.fms_import_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');

drop policy if exists fms_import_master_requests_update on public.fms_import_master_requests;
create policy fms_import_master_requests_update on public.fms_import_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(master_type, auth.uid()));

-- ===========================================================================
-- RPC — resolve a master request: approve (create the real master row) or
-- reject. SECURITY DEFINER so it can insert into the target master regardless of
-- the caller''s own per-table policy; re-checks authz (admin or that type''s
-- manager) and locks the request row to avoid double-resolution.
-- ===========================================================================
create or replace function public.fms_import_resolve_master_request(
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
  v_type      text;
  v_status    text;
  v_payload   jsonb;
  v_new_id    uuid;
begin
  -- Lock the request; capture its type + current status.
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_import_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  -- Authorization: admin or the assigned manager of this master type.
  if not (public.is_admin(auth.uid()) or public.fms_import_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  -- Use the (optionally edited) payload provided by the approver, else the original.
  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'vendor' then
      insert into public.fms_import_vendors (name, gstin, contact_name, phone, email, address, created_by)
      values (
        nullif(v_payload->>'name',''), v_payload->>'gstin', v_payload->>'contact_name',
        v_payload->>'phone', v_payload->>'email', v_payload->>'address', auth.uid()
      )
      returning id into v_new_id;
    elsif v_type = 'category' then
      insert into public.fms_import_categories (name, created_by)
      values (nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item_group' then
      insert into public.fms_import_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, nullif(v_payload->>'name',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'item' then
      insert into public.fms_import_items (item_group_id, name, unit, created_by)
      values ((v_payload->>'item_group_id')::uuid, nullif(v_payload->>'name',''), coalesce(v_payload->>'unit',''), auth.uid())
      returning id into v_new_id;
    elsif v_type = 'company' then
      insert into public.fms_import_companies (name, location, created_by)
      values (nullif(v_payload->>'name',''), v_payload->>'location', auth.uid())
      returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_import_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_import_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

comment on function public.fms_import_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real master row) or reject a master request. Admin or the master type''s manager only.';

grant execute on function public.fms_import_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;
