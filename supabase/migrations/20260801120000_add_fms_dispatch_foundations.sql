-- ===========================================================================
-- ORDER TO DISPATCH FMS — FOUNDATIONS + MASTERS (Phase 1).
--
-- The EIGHTH FMS module (sales order → delivery). Like fms_production_* /
-- fms_sampling_* / fms_import_* / fms_supplies_* / fms_exit_* / fms_hr_*, it
-- mirrors the config backbone into its OWN tables rather than reusing a shared
-- one: modules must stay independently droppable, and a shared step_owners table
-- would collide on step_key.
--
-- WHAT ORDER TO DISPATCH IS
--   The sales-side journey that begins when a customer order arrives and ends
--   when the driver confirms delivery. An order moves, in order, through SEVEN
--   steps — sales order, credit-limit confirmation, material-status check,
--   LOT no. & final qty, sales bill, gate-out entry, dispatch confirmation —
--   each owned by a different person who records dates, a status and remarks.
--   Source spec: Misc/Bushra Reports/FMS-Order to Dispatch.xlsx, sheet
--   "Order to Dispatch" (the hidden 7-step sheet, not the visible 6-step draft).
--   NO approvals, NO PO, NO quotations. Production Entry ends at the godown;
--   this module takes over from there.
--
-- Tables:
--   fms_dispatch_step_owners     — one row per workflow step_key → owners
--   fms_dispatch_config          — key/value singletons (jsonb)
--   fms_dispatch_counters + next_seq — document numbering (SO-2627-0001, DGP-…)
--   fms_dispatch_activity        — audit trail
--   fms_dispatch_notifications   — per-user bell feed
--   18 master tables (see MASTERS below)
--   fms_dispatch_master_managers — per-master-type owners (Setup → Master Owners)
--   fms_dispatch_master_requests — "Request a new master" submissions queue
--
-- ⚠ DELIBERATE DEVIATION FROM THE PRODUCTION TEMPLATE: there is NO CHECK barring
--   the origin step (`sales_order`) from fms_dispatch_step_owners. That CHECK was
--   dropped from Production by 20260728250000_fms_production_issue_slip_owners.sql
--   precisely so admins could restrict who may raise; the source sheet assigns
--   step 1 to the Sales Team, so we adopt the newer convention on day one.
--   Semantics: no owners on `sales_order` ⇒ any granted user may raise;
--   owners set ⇒ only them plus admins/coordinators.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal (reverse order):
--   drop policy if exists "fms dispatch docs read"   on storage.objects;
--   drop policy if exists "fms dispatch docs insert" on storage.objects;
--   drop policy if exists "fms dispatch docs update" on storage.objects;
--   drop policy if exists "fms dispatch docs delete" on storage.objects;
--   delete from storage.buckets where id = 'fms-dispatch-docs';
--   drop function if exists public.fms_dispatch_resolve_master_request(uuid,boolean,jsonb,text);
--   drop function if exists public.fms_dispatch_is_master_manager(text,uuid);
--   drop function if exists public.fms_dispatch_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_dispatch_step_owner_ids(text);
--   drop function if exists public.fms_dispatch_is_coordinator(uuid);
--   drop function if exists public.fms_dispatch_is_step_owner(text,uuid);
--   drop function if exists public.fms_dispatch_next_seq(text);
--   drop function if exists public.fms_dispatch_fy_code(date);
--   drop table if exists public.fms_dispatch_master_requests, public.fms_dispatch_master_managers,
--                        public.fms_dispatch_drivers, public.fms_dispatch_vehicles,
--                        public.fms_dispatch_invoice_series, public.fms_dispatch_gates,
--                        public.fms_dispatch_godowns, public.fms_dispatch_lots,
--                        public.fms_dispatch_items, public.fms_dispatch_ship_to,
--                        public.fms_dispatch_customers, public.fms_dispatch_mail_templates,
--                        public.fms_dispatch_packing_types, public.fms_dispatch_shortfall_reasons,
--                        public.fms_dispatch_payment_terms, public.fms_dispatch_order_sources,
--                        public.fms_dispatch_categories, public.fms_dispatch_units,
--                        public.fms_dispatch_transporters, public.fms_dispatch_companies,
--                        public.fms_dispatch_notifications, public.fms_dispatch_activity,
--                        public.fms_dispatch_counters, public.fms_dispatch_config,
--                        public.fms_dispatch_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_dispatch_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/order-to-dispatch/lib/steps.ts.
-- Authorization comes SOLELY from employee_ids; department_ids is a UI filter.
-- ===========================================================================
create table if not exists public.fms_dispatch_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_dispatch_step_owners is
  'Owners per Order to Dispatch FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. `sales_order` MAY be owned (Sales Team) — with no owners, every granted user may raise an order.';

drop trigger if exists trg_fms_dispatch_step_owners_updated on public.fms_dispatch_step_owners;
create trigger trg_fms_dispatch_step_owners_updated
  before update on public.fms_dispatch_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_dispatch_step_owners enable row level security;
drop policy if exists fms_dispatch_step_owners_select on public.fms_dispatch_step_owners;
create policy fms_dispatch_step_owners_select on public.fms_dispatch_step_owners
  for select to authenticated using (true);
drop policy if exists fms_dispatch_step_owners_write on public.fms_dispatch_step_owners;
create policy fms_dispatch_step_owners_write on public.fms_dispatch_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_dispatch_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 1,
--                              "unit": "same_day_cutoff", "cutoffHour": 12 }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
--   'customer_mail'        → { "enabled": false, "template_code": "dispatch_plan" }
-- ===========================================================================
create table if not exists public.fms_dispatch_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_dispatch_config is
  'Singleton Order to Dispatch FMS settings (step SLAs, coordinators, customer-mail switch) keyed by name.';

drop trigger if exists trg_fms_dispatch_config_updated on public.fms_dispatch_config;
create trigger trg_fms_dispatch_config_updated
  before update on public.fms_dispatch_config
  for each row execute function public.set_updated_at();

alter table public.fms_dispatch_config enable row level security;
drop policy if exists fms_dispatch_config_select on public.fms_dispatch_config;
create policy fms_dispatch_config_select on public.fms_dispatch_config
  for select to authenticated using (true);
drop policy if exists fms_dispatch_config_write on public.fms_dispatch_config;
create policy fms_dispatch_config_write on public.fms_dispatch_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- The customer auto-mail ships OFF. Turning it on sends outside the company, so
-- it needs its own switch on top of the per-module email gate.
insert into public.fms_dispatch_config (key, value)
values ('customer_mail', jsonb_build_object('enabled', false, 'template_code', 'dispatch_plan'))
on conflict (key) do nothing;

-- ===========================================================================
-- fms_dispatch_counters + fms_dispatch_next_seq — atomic document numbering.
-- Scopes in use: 'order:<fy>' → SO-2627-0001, 'gatepass:<fy>' → DGP-2627-0001.
-- ===========================================================================
create table if not exists public.fms_dispatch_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_dispatch_counters is
  'Per-scope document-number sequences (order:<fy>, gatepass:<fy>). Mutated only via fms_dispatch_next_seq().';

alter table public.fms_dispatch_counters enable row level security;
drop policy if exists fms_dispatch_counters_select_admin on public.fms_dispatch_counters;
create policy fms_dispatch_counters_select_admin on public.fms_dispatch_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_dispatch_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_dispatch_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_dispatch_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_dispatch_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_dispatch_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-01 → '2627'.
create or replace function public.fms_dispatch_fy_code(p_d date)
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
grant execute on function public.fms_dispatch_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_dispatch_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_dispatch_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_dispatch_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_dispatch_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_dispatch_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_dispatch_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_dispatch_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_dispatch_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_dispatch_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_dispatch_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'order' | 'master_request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_dispatch_activity_entity_idx on public.fms_dispatch_activity (entity_type, entity_id);
create index if not exists fms_dispatch_activity_created_idx on public.fms_dispatch_activity (created_at);

create table if not exists public.fms_dispatch_notifications (
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
create index if not exists fms_dispatch_notifications_user_idx on public.fms_dispatch_notifications (user_id, read_at);
create index if not exists fms_dispatch_notifications_created_idx on public.fms_dispatch_notifications (created_at);

alter table public.fms_dispatch_activity enable row level security;
drop policy if exists fms_dispatch_activity_select on public.fms_dispatch_activity;
create policy fms_dispatch_activity_select on public.fms_dispatch_activity
  for select to authenticated using (true);
drop policy if exists fms_dispatch_activity_write_admin on public.fms_dispatch_activity;
create policy fms_dispatch_activity_write_admin on public.fms_dispatch_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_dispatch_notifications enable row level security;
drop policy if exists fms_dispatch_notifications_select_own on public.fms_dispatch_notifications;
create policy fms_dispatch_notifications_select_own on public.fms_dispatch_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_dispatch_notifications_update_own on public.fms_dispatch_notifications;
create policy fms_dispatch_notifications_update_own on public.fms_dispatch_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_dispatch_notifications_write_admin on public.fms_dispatch_notifications;
create policy fms_dispatch_notifications_write_admin on public.fms_dispatch_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state. The actor is NOT skipped —
-- see 20260726150000_fms_notify_self_on_own_steps.sql: people want a receipt for
-- steps they action themselves.
drop function if exists public.fms_dispatch_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_dispatch_announce(
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
  insert into public.fms_dispatch_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_dispatch_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_dispatch_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — 18 tables, all edited via the shared MasterCrud (which also gives
-- Excel export/import for free). Select = all authenticated (dropdown fodder);
-- write = admin OR that master's owner.
--
-- Created in FK dependency order: companies + transporters + the flat lists
-- first, then the tables that reference them.
--
-- Every master carries the MasterCrud contract columns: id / name / active /
-- sort_order. Nothing is ever hard-deleted — rows are deactivated, so an old
-- order's history can never be orphaned (hence `on delete restrict` on the
-- workflow FKs in migration 2).
-- ===========================================================================

-- ---- flat, no dependencies -------------------------------------------------
create table if not exists public.fms_dispatch_companies (
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
comment on table public.fms_dispatch_companies is 'Selling company / plant master for Order to Dispatch FMS.';

create table if not exists public.fms_dispatch_transporters (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  gstin         text,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.fms_dispatch_transporters is 'Transporter master — the LR issuer on a Transport-type dispatch.';

create table if not exists public.fms_dispatch_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_units is 'Unit-of-measure master (KGS, LTR, PCS, BOX).';

create table if not exists public.fms_dispatch_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_categories is 'Item category master.';

create table if not exists public.fms_dispatch_order_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_order_sources is 'How the order arrived (Email / WhatsApp / Phone / Sales visit).';

create table if not exists public.fms_dispatch_payment_terms (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  days         integer,
  description  text,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.fms_dispatch_payment_terms is
  'Payment-term master used by the credit-limit step — which term applies, or what was agreed when payment is required up front.';

create table if not exists public.fms_dispatch_shortfall_reasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_shortfall_reasons is
  'Why a line could not be fully dispatched. Used at the material-status step (Production required) and again at LOT confirmation when final qty < ordered qty.';

create table if not exists public.fms_dispatch_packing_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_packing_types is 'Packing type per dispatched line (Drum / Carton / Bag / Can / Loose).';

create table if not exists public.fms_dispatch_mail_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique,
  subject     text not null default '',
  body        text not null default '',
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_mail_templates is
  'Customer-facing email templates. Tokens: {{customer}} {{order_no}} {{order_date}} {{planned_dispatch_date}} {{items}} {{type}}. Rendered by fms_dispatch_render_mail_template().';

create table if not exists public.fms_dispatch_drivers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  phone       text,
  licence_no  text,
  -- Optional link to a portal user: a driver who signs in can action the
  -- dispatch-confirmation step from their own queue (see fms_dispatch_can_act).
  user_id     uuid references auth.users on delete set null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_drivers is
  'Driver master. user_id optionally maps the driver to a portal user so they can confirm their own delivery.';
create index if not exists fms_dispatch_drivers_user_idx on public.fms_dispatch_drivers (user_id);

-- ---- depend on the above ---------------------------------------------------
create table if not exists public.fms_dispatch_customers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  code                  text,
  gstin                 text,
  contact_name          text,
  phone                 text,
  -- The recipient of the material-status auto-mail. Blank = the mail is skipped
  -- (recorded on the order as ms_mail_skipped_reason), never an error.
  email                 text,
  billing_address       text,
  credit_limit          numeric(16,2),
  credit_days           integer,
  default_type          text check (default_type is null or default_type in ('local','transport')),
  default_transporter_id uuid references public.fms_dispatch_transporters on delete set null,
  active                boolean not null default true,
  sort_order            integer not null default 0,
  created_by            uuid references auth.users on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.fms_dispatch_customers is
  'Customer master. credit_limit / credit_days back the credit step''s decision; email is where the material-status auto-mail goes.';

create table if not exists public.fms_dispatch_ship_to (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.fms_dispatch_customers on delete cascade,
  name          text not null,
  address       text,
  city          text,
  state         text,
  contact_name  text,
  phone         text,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Scoped, not global: two customers may both call an address "Factory".
  unique (customer_id, name)
);
comment on table public.fms_dispatch_ship_to is 'Delivery addresses per customer. A customer may have several.';
create index if not exists fms_dispatch_ship_to_customer_idx on public.fms_dispatch_ship_to (customer_id);

create table if not exists public.fms_dispatch_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text,
  category_id uuid references public.fms_dispatch_categories on delete restrict,
  unit_id     uuid references public.fms_dispatch_units on delete restrict,
  hsn_code    text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_dispatch_items is
  'Saleable item master. unit_id auto-fills the order line''s unit when the item is picked.';

create table if not exists public.fms_dispatch_lots (
  id             uuid primary key default gen_random_uuid(),
  -- `name` IS the lot number — the MasterCrud contract wants a `name` column.
  name           text not null unique,
  item_id        uuid references public.fms_dispatch_items on delete restrict,
  mfg_date       date,
  expiry_date    date,
  available_qty  numeric(14,3),
  unit_id        uuid references public.fms_dispatch_units on delete restrict,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.fms_dispatch_lots is
  'LOT master. The source sheet typed a bare lot number into a cell; here it is a real master so the picker is filtered by item and a mistyped lot cannot exist. The order line also stores lot_no_snapshot so a later rename never rewrites history.';
create index if not exists fms_dispatch_lots_item_idx on public.fms_dispatch_lots (item_id);

create table if not exists public.fms_dispatch_godowns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company_id  uuid references public.fms_dispatch_companies on delete restrict,
  location    text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);
comment on table public.fms_dispatch_godowns is 'Where stock is physically checked, and the default origin for gate-out.';

create table if not exists public.fms_dispatch_gates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company_id  uuid references public.fms_dispatch_companies on delete restrict,
  location    text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);
comment on table public.fms_dispatch_gates is 'Point of exit on the gate register.';

create table if not exists public.fms_dispatch_invoice_series (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company_id  uuid references public.fms_dispatch_companies on delete restrict,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);
comment on table public.fms_dispatch_invoice_series is 'The Tally voucher series a sales invoice was raised under.';

create table if not exists public.fms_dispatch_vehicles (
  id             uuid primary key default gen_random_uuid(),
  -- `name` IS the vehicle number.
  name           text not null unique,
  vehicle_type   text,
  -- Null = own vehicle.
  transporter_id uuid references public.fms_dispatch_transporters on delete restrict,
  capacity       text,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.fms_dispatch_vehicles is 'Vehicle master for the gate register. transporter_id null = own vehicle.';
create index if not exists fms_dispatch_vehicles_transporter_idx on public.fms_dispatch_vehicles (transporter_id);

-- ---- updated_at triggers + select policies for all 18 masters --------------
-- Driven by a loop rather than 18×2 hand-written blocks: the shape is identical
-- for every master, and a loop cannot drift the way a copy-paste can.
do $$
declare
  t text;
  masters text[] := array[
    'companies','transporters','units','categories','order_sources','payment_terms',
    'shortfall_reasons','packing_types','mail_templates','drivers','customers',
    'ship_to','items','lots','godowns','gates','invoice_series','vehicles'
  ];
begin
  foreach t in array masters loop
    execute format('drop trigger if exists trg_fms_dispatch_%1$s_updated on public.fms_dispatch_%1$s', t);
    execute format(
      'create trigger trg_fms_dispatch_%1$s_updated before update on public.fms_dispatch_%1$s
         for each row execute function public.set_updated_at()', t);
    execute format('alter table public.fms_dispatch_%1$s enable row level security', t);
    execute format('drop policy if exists fms_dispatch_%1$s_select on public.fms_dispatch_%1$s', t);
    execute format(
      'create policy fms_dispatch_%1$s_select on public.fms_dispatch_%1$s
         for select to authenticated using (true)', t);
  end loop;
end $$;

-- Seed the units every order needs on day one; everything else is loaded through
-- Masters → Import (the shared MasterCrud Excel round trip).
insert into public.fms_dispatch_units (name, sort_order)
values ('KGS', 1), ('LTR', 2), ('PCS', 3), ('BOX', 4)
on conflict (name) do nothing;

insert into public.fms_dispatch_mail_templates (name, code, subject, body, sort_order)
values (
  'Planned dispatch intimation',
  'dispatch_plan',
  'Your order {{order_no}} is planned for dispatch on {{planned_dispatch_date}}',
  'Dear {{customer}},' || chr(10) || chr(10) ||
  'Thank you for your order {{order_no}} dated {{order_date}}.' || chr(10) || chr(10) ||
  'We have confirmed material availability and planned your dispatch for {{planned_dispatch_date}} ({{type}}).' || chr(10) || chr(10) ||
  'Order details:' || chr(10) || '{{items}}' || chr(10) || chr(10) ||
  'We will share the invoice and delivery details once the consignment leaves our plant.' || chr(10) || chr(10) ||
  'Warm regards,' || chr(10) || 'Orange O Tec',
  1
)
on conflict (code) do nothing;

-- ===========================================================================
-- MASTER GOVERNANCE — owners per master type + "request a new master" queue.
--
-- 18 master types. `mail_template` is OWNABLE but not offered in the request
-- picker (nobody "requests" an email template) — that split is enforced in the
-- frontend's REQUESTABLE_DISPATCH_MASTER_TYPES, not here, so an admin can still
-- resolve one if it is ever raised by hand.
-- ===========================================================================
create table if not exists public.fms_dispatch_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in (
                    'company','transporter','unit','category','order_source','payment_term',
                    'shortfall_reason','packing_type','mail_template','driver','customer',
                    'ship_to','item','lot','godown','gate','invoice_series','vehicle')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);
comment on table public.fms_dispatch_master_managers is
  'Assigns one or more owners per Order to Dispatch master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → admins only.';
create index if not exists fms_dispatch_master_managers_type_idx
  on public.fms_dispatch_master_managers (master_type);

drop trigger if exists trg_fms_dispatch_master_managers_updated on public.fms_dispatch_master_managers;
create trigger trg_fms_dispatch_master_managers_updated
  before update on public.fms_dispatch_master_managers
  for each row execute function public.set_updated_at();

create or replace function public.fms_dispatch_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_dispatch_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_dispatch_is_master_manager(text, uuid) to authenticated;

-- Master writes: admin OR that master's owner. One policy per master table,
-- generated from the (table, master_type) pairing so the two lists cannot drift.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('companies','company'), ('transporters','transporter'), ('units','unit'),
      ('categories','category'), ('order_sources','order_source'), ('payment_terms','payment_term'),
      ('shortfall_reasons','shortfall_reason'), ('packing_types','packing_type'),
      ('mail_templates','mail_template'), ('drivers','driver'), ('customers','customer'),
      ('ship_to','ship_to'), ('items','item'), ('lots','lot'), ('godowns','godown'),
      ('gates','gate'), ('invoice_series','invoice_series'), ('vehicles','vehicle')
    ) as v(tbl, mtype)
  loop
    execute format('drop policy if exists fms_dispatch_%1$s_write on public.fms_dispatch_%1$s', r.tbl);
    execute format(
      'create policy fms_dispatch_%1$s_write on public.fms_dispatch_%1$s
         for all to authenticated
         using (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(%2$L, auth.uid()))
         with check (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(%2$L, auth.uid()))',
      r.tbl, r.mtype);
  end loop;
end $$;

alter table public.fms_dispatch_master_managers enable row level security;
drop policy if exists fms_dispatch_master_managers_select on public.fms_dispatch_master_managers;
create policy fms_dispatch_master_managers_select on public.fms_dispatch_master_managers
  for select to authenticated using (true);
drop policy if exists fms_dispatch_master_managers_write on public.fms_dispatch_master_managers;
create policy fms_dispatch_master_managers_write on public.fms_dispatch_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---- "Request a new master" queue -----------------------------------------
create table if not exists public.fms_dispatch_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in (
                       'company','transporter','unit','category','order_source','payment_term',
                       'shortfall_reason','packing_type','mail_template','driver','customer',
                       'ship_to','item','lot','godown','gate','invoice_series','vehicle')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.fms_dispatch_master_requests is
  'New-master-entry requests from any user. Resolved (approved → real master row created, or rejected) by admin/owner via fms_dispatch_resolve_master_request.';
create index if not exists fms_dispatch_master_requests_status_idx
  on public.fms_dispatch_master_requests (status, master_type);

drop trigger if exists trg_fms_dispatch_master_requests_updated on public.fms_dispatch_master_requests;
create trigger trg_fms_dispatch_master_requests_updated
  before update on public.fms_dispatch_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_dispatch_master_requests enable row level security;
drop policy if exists fms_dispatch_master_requests_select on public.fms_dispatch_master_requests;
create policy fms_dispatch_master_requests_select on public.fms_dispatch_master_requests
  for select to authenticated using (true);
drop policy if exists fms_dispatch_master_requests_insert on public.fms_dispatch_master_requests;
create policy fms_dispatch_master_requests_insert on public.fms_dispatch_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');
drop policy if exists fms_dispatch_master_requests_update on public.fms_dispatch_master_requests;
create policy fms_dispatch_master_requests_update on public.fms_dispatch_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(master_type, auth.uid()));

-- Resolve a master request: approve (create the real master row) or reject.
-- SECURITY DEFINER so it can insert into the target master regardless of the
-- caller's own per-table policy; re-checks authz and locks the request row.
--
-- ⚠ WIRE CONTRACT: the payload keys below are read VERBATIM and must match
--   frontend/src/apps/order-to-dispatch/lib/masterFields.ts. Adding a field
--   there without adding it here silently drops it on approve.
create or replace function public.fms_dispatch_resolve_master_request(
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
  from public.fms_dispatch_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');

  if p_approve then
    if v_name is null then raise exception 'A name is required to approve a master request'; end if;

    if v_type = 'company' then
      insert into public.fms_dispatch_companies (name, gstin, address, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'),''), nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'transporter' then
      insert into public.fms_dispatch_transporters (name, gstin, contact_name, phone, email, address, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'),''), nullif(trim(v_payload->>'contact_name'),''),
              nullif(trim(v_payload->>'phone'),''), nullif(trim(v_payload->>'email'),''),
              nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'unit' then
      insert into public.fms_dispatch_units (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'category' then
      insert into public.fms_dispatch_categories (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'order_source' then
      insert into public.fms_dispatch_order_sources (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'payment_term' then
      insert into public.fms_dispatch_payment_terms (name, days, description, created_by)
      values (v_name, nullif(v_payload->>'days','')::integer, nullif(trim(v_payload->>'description'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'shortfall_reason' then
      insert into public.fms_dispatch_shortfall_reasons (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'packing_type' then
      insert into public.fms_dispatch_packing_types (name, created_by) values (v_name, auth.uid()) returning id into v_new_id;

    elsif v_type = 'mail_template' then
      insert into public.fms_dispatch_mail_templates (name, code, subject, body, created_by)
      values (v_name, nullif(trim(v_payload->>'code'),''), coalesce(v_payload->>'subject',''),
              coalesce(v_payload->>'body',''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'driver' then
      insert into public.fms_dispatch_drivers (name, phone, licence_no, user_id, created_by)
      values (v_name, nullif(trim(v_payload->>'phone'),''), nullif(trim(v_payload->>'licence_no'),''),
              nullif(v_payload->>'user_id','')::uuid, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer' then
      insert into public.fms_dispatch_customers (name, code, gstin, contact_name, phone, email,
                                                 billing_address, credit_limit, credit_days,
                                                 default_type, default_transporter_id, created_by)
      values (v_name, nullif(trim(v_payload->>'code'),''), nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'contact_name'),''), nullif(trim(v_payload->>'phone'),''),
              nullif(trim(v_payload->>'email'),''), nullif(trim(v_payload->>'billing_address'),''),
              nullif(v_payload->>'credit_limit','')::numeric, nullif(v_payload->>'credit_days','')::integer,
              nullif(trim(v_payload->>'default_type'),''), nullif(v_payload->>'default_transporter_id','')::uuid,
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'ship_to' then
      insert into public.fms_dispatch_ship_to (customer_id, name, address, city, state, contact_name, phone, created_by)
      values (nullif(v_payload->>'customer_id','')::uuid, v_name, nullif(trim(v_payload->>'address'),''),
              nullif(trim(v_payload->>'city'),''), nullif(trim(v_payload->>'state'),''),
              nullif(trim(v_payload->>'contact_name'),''), nullif(trim(v_payload->>'phone'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item' then
      insert into public.fms_dispatch_items (name, code, category_id, unit_id, hsn_code, created_by)
      values (v_name, nullif(trim(v_payload->>'code'),''), nullif(v_payload->>'category_id','')::uuid,
              nullif(v_payload->>'unit_id','')::uuid, nullif(trim(v_payload->>'hsn_code'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'lot' then
      insert into public.fms_dispatch_lots (name, item_id, mfg_date, expiry_date, available_qty, unit_id, created_by)
      values (v_name, nullif(v_payload->>'item_id','')::uuid, nullif(v_payload->>'mfg_date','')::date,
              nullif(v_payload->>'expiry_date','')::date, nullif(v_payload->>'available_qty','')::numeric,
              nullif(v_payload->>'unit_id','')::uuid, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'godown' then
      insert into public.fms_dispatch_godowns (name, company_id, location, created_by)
      values (v_name, nullif(v_payload->>'company_id','')::uuid, nullif(trim(v_payload->>'location'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'gate' then
      insert into public.fms_dispatch_gates (name, company_id, location, created_by)
      values (v_name, nullif(v_payload->>'company_id','')::uuid, nullif(trim(v_payload->>'location'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'invoice_series' then
      insert into public.fms_dispatch_invoice_series (name, company_id, created_by)
      values (v_name, nullif(v_payload->>'company_id','')::uuid, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'vehicle' then
      insert into public.fms_dispatch_vehicles (name, vehicle_type, transporter_id, capacity, created_by)
      values (v_name, nullif(trim(v_payload->>'vehicle_type'),''), nullif(v_payload->>'transporter_id','')::uuid,
              nullif(trim(v_payload->>'capacity'),''), auth.uid())
      returning id into v_new_id;

    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_dispatch_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_dispatch_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
comment on function public.fms_dispatch_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (create the real master row) or reject an Order to Dispatch master request. Admin or the master type''s owner only.';
grant execute on function public.fms_dispatch_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ===========================================================================
-- STORAGE — private bucket for the sales invoice (step 5) and the receiver
-- copy / LR (step 7). Folders: invoice/, receiver/, lr/.
--
-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's (and vice versa).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-dispatch-docs', 'fms-dispatch-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms dispatch docs read"   on storage.objects;
drop policy if exists "fms dispatch docs insert" on storage.objects;
drop policy if exists "fms dispatch docs update" on storage.objects;
drop policy if exists "fms dispatch docs delete" on storage.objects;

create policy "fms dispatch docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-dispatch-docs');
create policy "fms dispatch docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-dispatch-docs');
create policy "fms dispatch docs update" on storage.objects
  for update to authenticated using (bucket_id = 'fms-dispatch-docs') with check (bucket_id = 'fms-dispatch-docs');
create policy "fms dispatch docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-dispatch-docs');
