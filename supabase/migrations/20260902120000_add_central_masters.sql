-- ===========================================================================
-- CENTRAL MASTERS — one master list per concept, for every module, fed from Tally.
--
-- WHY
--   Every FMS keeps its own private copy of the same masters. Today the live
--   database holds SIX company tables for the same two-to-four Orange O Tec
--   entities, SEVEN item tables (Purchase and Import are ~90% the same
--   catalogue under two sets of ids), THREE vendor tables that have already
--   drifted apart (contact_name in two, contact_person in the third), and
--   customers keyed three incompatible ways — uuid in the modules, Tally GUID
--   in receivables, bare text in Sampling and Leads. Nothing joins to anything.
--
--   An item added in Purchase is invisible to Dispatch. A customer approved in
--   Onboarding is re-typed by hand into Dispatch — TallyPanel.tsx says so in as
--   many words. And all of it is maintained manually while Tally already holds
--   the authoritative version.
--
-- WHAT THIS MIGRATION IS
--   PHASE 0 ONLY: it CREATES the central tables and nothing else. No existing
--   table is read, altered, backfilled or dropped. No module knows these tables
--   exist yet. It is safe to apply during business hours, and safe to re-run.
--   The per-module cutovers are separate migrations, one module at a time,
--   starting with Order to Dispatch.
--
-- THE SPLIT, AND WHY IT IS NOT ONE TABLE
--   mst_companies / mst_parties / mst_items / mst_item_groups / mst_units /
--   mst_locations / mst_party_items are the GENERAL masters — real typed tables,
--   because orders, purchase orders and job cards carry foreign keys into them.
--   The long tail of name-only module lists (asset conditions, exit reasons,
--   service types) does NOT get a table each; it gets mst_lists /
--   mst_list_values in Phase 2. Nothing in Order to Dispatch needs it, so it is
--   deliberately not created here.
--
-- CUSTOMERS AND VENDORS SHARE ONE TABLE
--   In Tally both are a ledger — the same object, differing only in which group
--   it sits under. Splitting them here would mean maintaining two sync arms and
--   two rows for any firm we both buy from and sell to. is_customer / is_vendor
--   are derived from group_chain (Sundry Debtors / Sundry Creditors) and a row
--   may carry both.
--
-- Reuses the existing public.set_updated_at() and public.is_admin(uuid) helpers.
--
-- Reversal:
--   drop function if exists public.mst_is_master_manager(text, uuid);
--   drop table if exists public.mst_party_items;
--   drop table if exists public.mst_locations;
--   drop table if exists public.mst_items;
--   drop table if exists public.mst_parties;
--   drop table if exists public.mst_units;
--   drop table if exists public.mst_item_groups;
--   drop table if exists public.mst_companies;
--   drop table if exists public.mst_master_managers;
--   drop table if exists public.mst_sync_runs;
-- ===========================================================================


-- =========================================================== governance ====
--
-- Who may CRUD which central master. Deliberately its own table rather than the
-- ninth copy of fms_<mod>_master_managers: collapsing those nine pairs into one
-- is Phase 3, and this is the table they collapse INTO.

create table if not exists public.mst_master_managers (
  id          uuid primary key default gen_random_uuid(),
  master_type text not null check (master_type = any (array[
                'company', 'party', 'item', 'item_group', 'unit', 'location', 'party_item'])),
  user_id     uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  unique (master_type, user_id)
);

comment on table public.mst_master_managers is
  'Assigns one or more owners per CENTRAL master type; owners may CRUD that master. Unassigned -> admins only. Phase 3 folds the nine per-FMS *_master_managers tables into this one.';

create or replace function public.mst_is_master_manager(p_type text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mst_master_managers m
     where m.master_type = p_type and m.user_id = p_user);
$$;
grant execute on function public.mst_is_master_manager(text, uuid) to authenticated;

alter table public.mst_master_managers enable row level security;

drop policy if exists mst_master_managers_select on public.mst_master_managers;
create policy mst_master_managers_select
  on public.mst_master_managers for select using (true);

drop policy if exists mst_master_managers_write on public.mst_master_managers;
create policy mst_master_managers_write
  on public.mst_master_managers for all
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));


-- ============================================================ companies ====

create table if not exists public.mst_companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- ---- Tally identity. NULL tally_guid = a record born in the portal.
  tally_guid   text unique,
  tally_tenant text,
  tally_synced_at timestamptz,
  source       text not null default 'portal' check (source in ('portal', 'tally')),
  -- ---- Tally-owned: overwritten on every sync, never edited in the portal.
  gstin        text,
  address      text,
  -- ---- Portal-owned: sync must never touch these.
  gate_pass_prefix text,
  modules      text[] not null default '{}',
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mst_companies is
  'Central company master - the Orange O Tec entities we bill and buy as. Replaces the six per-FMS *_companies tables.';
comment on column public.mst_companies.gate_pass_prefix is
  'PORTAL-OWNED. Order to Dispatch gate-pass numbering. Tally has no such concept, so no sync ever writes it.';


-- ========================================================== item groups ====
--
-- Name-keyed, not GUID-keyed. Tally exposes a stock item's group as the PARENT
-- string on the item itself, so the sync upserts groups BY NAME as it walks the
-- items. That is why this table (and mst_units, for the same reason) keeps the
-- unique(name) the entity tables below deliberately drop.

create table if not exists public.mst_item_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  source       text not null default 'portal' check (source in ('portal', 'tally')),
  tally_synced_at timestamptz,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mst_item_groups is
  'Central item-group / category master. Keyed by NAME because Tally reports a stock item''s group as a string on the item, not as a referenced object.';


-- ================================================================ units ====

create table if not exists public.mst_units (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  source       text not null default 'portal' check (source in ('portal', 'tally')),
  tally_synced_at timestamptz,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mst_units is
  'Central unit-of-measure master, upserted by name from each stock item base units. Replaces fms_production_units and the free-text unit column on four item tables.';


-- ============================================================== parties ====
--
-- NO UNIQUE CONSTRAINT ON name - A DELIBERATE DEPARTURE.
--   Every per-FMS customer/vendor master declares `name text not null unique`.
--   That cannot survive here for two reasons:
--     1. THE SYNC MUST NEVER HARD-FAIL. Tally holds ~9,200 ledgers. If one of
--        them happens to share a name with a portal-created row, a unique
--        constraint turns a routine 15-minute sync into a hard error and the
--        masters silently stop updating.
--     2. PHASE 2 MERGES DUPLICATES ON PURPOSE. Purchase and Import hold the same
--        firms under two ids; the reconcile screen is what decides which rows
--        are the same party. A unique index would make that migration abort
--        instead of merge.
--   Uniqueness that IS enforced: tally_guid. Everything else is resolved by the
--   reconcile screen, and the Add form already warns on a near-match via the
--   existing findExistingMaster helper.

create table if not exists public.mst_parties (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text,
  -- ---- Tally identity
  tally_guid   text unique,
  tally_tenant text,
  tally_synced_at timestamptz,
  source       text not null default 'portal' check (source in ('portal', 'tally')),
  -- ---- what the party IS. Both may be true: we buy from and sell to some firms.
  is_customer  boolean not null default false,
  is_vendor    boolean not null default false,
  -- ---- Tally-owned: overwritten on every sync.
  gstin         text,
  sub_group     text,
  group_chain   text[],
  credit_limit  numeric,
  credit_period text,
  -- ---- Portal-owned: sync must never touch these.
  company_id   uuid references public.mst_companies on delete set null,
  location     text,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  modules      text[] not null default '{}',
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mst_parties is
  'Central party master - customers AND vendors in one table, because in Tally both are a ledger. is_customer / is_vendor are derived from group_chain and a row may carry both. Replaces every per-FMS *_customers and *_vendors table.';
comment on column public.mst_parties.location is
  'PORTAL-OWNED, FREE TEXT, FORCE-UPPERCASED by the UI. Where the CUSTOMER takes delivery - NOT one of our sites. Our sites are mst_locations. The two must never be conflated.';
comment on column public.mst_parties.company_id is
  'PORTAL-OWNED. Which of OUR companies bills this party. Order to Dispatch requires it; Tally has no equivalent, so no sync ever writes it.';
comment on column public.mst_parties.modules is
  'PORTAL-OWNED ALLOW-LIST. Tally holds ~9,200 ledgers and Dispatch offers ~325 customers. A ledger arrives from a sync with modules = {} - present and searchable, but in nobody dropdown until an admin ticks the apps that should offer it. Sync must never overwrite this.';


-- ================================================================ items ====

create table if not exists public.mst_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text,
  -- ---- Tally identity
  tally_guid   text unique,
  tally_tenant text,
  tally_synced_at timestamptz,
  source       text not null default 'portal' check (source in ('portal', 'tally')),
  -- ---- Tally-owned
  group_id     uuid references public.mst_item_groups on delete set null,
  unit_id      uuid references public.mst_units on delete set null,
  -- ---- Portal-owned
  hsn_code     text,
  modules      text[] not null default '{}',
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.mst_items is
  'Central item master. Replaces all seven per-FMS item tables (dispatch/purchase/import/supplies items, production raw materials, packaging items and FG items). No unique on name, for the same two reasons as mst_parties.';
comment on column public.mst_items.unit_id is
  'The item carries its own unit - the rationale 20260811120000 gave when it dropped fms_dispatch_units. Auto-fills the order line when the item is picked.';


-- ============================================================ locations ====
--
-- OUR sites, per company. NOT mst_parties.location, which is where a customer
-- takes delivery. 20260819120000 spelled out why the two must stay apart.

create table if not exists public.mst_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- RESTRICT, not cascade: a location with orders against it is history, and
  -- deleting the company must not silently take that history with it.
  company_id  uuid not null references public.mst_companies on delete restrict,
  modules     text[] not null default '{}',
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Scoped to the company, not global: two companies may both have a "Unit 1".
  unique (company_id, name)
);

comment on table public.mst_locations is
  'Our own sites, per company - the place a consignment leaves from. Portal-owned; Tally has no equivalent. Distinct from mst_parties.location, which is where the CUSTOMER takes delivery.';


-- ========================================================= party <-> item ==
--
-- A NAMELESS master: the pair IS the record. Carried over from
-- fms_dispatch_customer_items, whose UI contract (masterFields.ts) already
-- special-cases it.

create table if not exists public.mst_party_items (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.mst_parties on delete cascade,
  item_id    uuid not null references public.mst_items   on delete cascade,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (party_id, item_id)
);

comment on table public.mst_party_items is
  'Which items a party may order. A row here is what makes an item selectable on that party sales order; no row means the item is not offered to them. Replaces fms_dispatch_customer_items.';


-- ============================================================ sync runs ====
--
-- THE WATCHER MEMORY, not just a log. source_last_sync_at holds the mirror
-- own watermark as of the last successful pull; the 15-minute watcher compares
-- the mirror current watermark against the newest success here and does
-- nothing when they match. That is what makes a quiet tick cost one cheap query.

create table if not exists public.mst_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'success', 'error')),
  trigger     text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  -- The mirror max(tally_sync_run.finished_at) at the moment we pulled.
  source_last_sync_at timestamptz,
  counts      jsonb not null default '{}'::jsonb,
  error       text,
  created_by  uuid references auth.users on delete set null
);

comment on table public.mst_sync_runs is
  'One row per masters sync. source_last_sync_at is the Tally mirror own watermark at pull time - the watcher compares against the newest success here and skips when unchanged.';

create index if not exists mst_sync_runs_recent_idx
  on public.mst_sync_runs (started_at desc);


-- ============================================================== indexes ====
--
-- Every FK, plus the columns the pickers actually filter on. `modules` is GIN
-- because every module read is `where '<app-id>' = any(modules)`.

create index if not exists mst_companies_name_idx      on public.mst_companies (lower(name));
create index if not exists mst_companies_modules_idx   on public.mst_companies using gin (modules);

create index if not exists mst_parties_name_idx        on public.mst_parties (lower(name));
create index if not exists mst_parties_modules_idx     on public.mst_parties using gin (modules);
create index if not exists mst_parties_company_idx     on public.mst_parties (company_id);
create index if not exists mst_parties_customer_idx    on public.mst_parties (is_customer) where is_customer;
create index if not exists mst_parties_vendor_idx      on public.mst_parties (is_vendor)   where is_vendor;

create index if not exists mst_items_name_idx          on public.mst_items (lower(name));
create index if not exists mst_items_modules_idx       on public.mst_items using gin (modules);
create index if not exists mst_items_group_idx         on public.mst_items (group_id);
create index if not exists mst_items_unit_idx          on public.mst_items (unit_id);

create index if not exists mst_locations_company_idx   on public.mst_locations (company_id);

create index if not exists mst_party_items_party_idx   on public.mst_party_items (party_id);
create index if not exists mst_party_items_item_idx    on public.mst_party_items (item_id);


-- ============================================================= triggers ====

drop trigger if exists set_updated_at on public.mst_companies;
create trigger set_updated_at before update on public.mst_companies
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.mst_item_groups;
create trigger set_updated_at before update on public.mst_item_groups
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.mst_units;
create trigger set_updated_at before update on public.mst_units
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.mst_parties;
create trigger set_updated_at before update on public.mst_parties
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.mst_items;
create trigger set_updated_at before update on public.mst_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.mst_locations;
create trigger set_updated_at before update on public.mst_locations
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.mst_party_items;
create trigger set_updated_at before update on public.mst_party_items
  for each row execute function public.set_updated_at();


-- ================================================================== RLS ====
--
-- Read is open to every signed-in user: a master feeds pickers in every module,
-- and the module allow-list lives in `modules`, not in a policy.
--
-- EVERY HELPER CALL WRAPPED IN (select ...). Unwrapped, Postgres treats
-- is_admin(auth.uid()) as row-dependent and re-runs it FOR EVERY ROW; wrapped,
-- it is hoisted into a one-shot InitPlan. Same form as 20260819120000, for the
-- same reason 20260730130000 established.

do $rls$
declare
  r record;
begin
  for r in
    select * from (values
      ('mst_companies',   'company'),
      ('mst_item_groups', 'item_group'),
      ('mst_units',       'unit'),
      ('mst_parties',     'party'),
      ('mst_items',       'item'),
      ('mst_locations',   'location'),
      ('mst_party_items', 'party_item')
    ) as t(tbl, master_type)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_select', r.tbl);
    execute format(
      'create policy %I on public.%I for select using (true)',
      r.tbl || '_select', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_write', r.tbl);
    execute format($f$
      create policy %I on public.%I for all
        using (
          (select public.is_admin((select auth.uid())))
          or (select public.mst_is_master_manager(%L, (select auth.uid())))
        )
        with check (
          (select public.is_admin((select auth.uid())))
          or (select public.mst_is_master_manager(%L, (select auth.uid())))
        )
    $f$, r.tbl || '_write', r.tbl, r.master_type, r.master_type);
  end loop;
end $rls$;

-- The sync log: everyone may read "last synced", only an admin may write by
-- hand. The Edge Function writes with the service role and bypasses RLS.
alter table public.mst_sync_runs enable row level security;

drop policy if exists mst_sync_runs_select on public.mst_sync_runs;
create policy mst_sync_runs_select
  on public.mst_sync_runs for select using (true);

drop policy if exists mst_sync_runs_write on public.mst_sync_runs;
create policy mst_sync_runs_write
  on public.mst_sync_runs for all
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));


-- ============================================================== asserts ====
--
-- MATCH STRUCTURE, NOT PROSE. The comments above name the very identifiers
-- being tested, so every check below reads the catalogue rather than the text.

do $check$
declare
  v_tbl text;
  v_missing text;
begin
  -- All nine tables exist, with RLS on.
  foreach v_tbl in array array[
    'mst_master_managers', 'mst_companies', 'mst_item_groups', 'mst_units',
    'mst_parties', 'mst_items', 'mst_locations', 'mst_party_items', 'mst_sync_runs']
  loop
    if to_regclass('public.' || v_tbl) is null then
      raise exception 'central masters: public.% was not created', v_tbl;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = v_tbl and c.relrowsecurity) then
      raise exception 'central masters: RLS is not enabled on %', v_tbl;
    end if;
  end loop;

  -- The three entity tables must be GUID-unique and name-NON-unique. Getting
  -- this backwards is what would make a routine sync hard-fail.
  foreach v_tbl in array array['mst_companies', 'mst_parties', 'mst_items']
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = ('public.' || v_tbl)::regclass and c.contype = 'u'
         and pg_get_constraintdef(c.oid) = 'UNIQUE (tally_guid)')
    then
      raise exception 'central masters: % has no unique constraint on tally_guid', v_tbl;
    end if;
    if exists (
      select 1 from pg_constraint c
       where c.conrelid = ('public.' || v_tbl)::regclass and c.contype = 'u'
         and pg_get_constraintdef(c.oid) = 'UNIQUE (name)')
    then
      raise exception 'central masters: % declares UNIQUE (name) - a sync name clash would then hard-fail', v_tbl;
    end if;
  end loop;

  -- The portal-owned columns a sync must never overwrite have to exist before
  -- the sync is written against them.
  select string_agg(x.col, ', ') into v_missing
    from (values ('modules'), ('company_id'), ('location'), ('sort_order'), ('active')) as x(col)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'mst_parties' and column_name = x.col);
  if v_missing is not null then
    raise exception 'central masters: mst_parties is missing portal-owned column(s): %', v_missing;
  end if;

  -- The watcher cannot skip a quiet tick without its watermark.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'mst_sync_runs'
                    and column_name = 'source_last_sync_at') then
    raise exception 'central masters: mst_sync_runs has no source_last_sync_at - the watcher has no memory';
  end if;

  if to_regprocedure('public.mst_is_master_manager(text, uuid)') is null then
    raise exception 'central masters: mst_is_master_manager was not created';
  end if;
end $check$;
