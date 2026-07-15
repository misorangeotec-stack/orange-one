-- Purchase FMS (import) — CONFIG / Setup backbone (Phase 2).
--
-- The "no-code" wiring for the workflow: who owns each step, the amount-tiered
-- approval matrix, singleton settings (process coordinators, amount basis), and
-- the document-number counters used by Phase-3 numbering.
--
-- Tables:
--   fms_import_step_owners     — one row per workflow step_key → owners
--   fms_import_approval_matrix — value band → approver (amount-tiered routing)
--   fms_import_config          — key/value singletons (jsonb)
--   fms_import_counters        — document-number sequences (locked in RPCs)
--   + fms_import_next_seq(text) — atomic counter increment (SECURITY DEFINER)
--
-- RLS: all readable by authenticated; step_owners / approval_matrix / config are
-- admin-only writes (Setup is admin). counters have no client write (the RPC is
-- definer); select is admin-only.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal:
--   drop function if exists public.fms_import_next_seq(text);
--   drop table if exists public.fms_import_counters;
--   drop table if exists public.fms_import_config;
--   drop table if exists public.fms_import_approval_matrix;
--   drop table if exists public.fms_import_step_owners;

-- ===========================================================================
-- fms_import_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant (request, sourcing, approval, po, …).
-- ===========================================================================
create table if not exists public.fms_import_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_id   uuid,
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_import_step_owners is
  'Owners per workflow step (step_key). employee_ids are the notified/authorized owners assigned in Setup.';

drop trigger if exists trg_fms_import_step_owners_updated on public.fms_import_step_owners;
create trigger trg_fms_import_step_owners_updated
  before update on public.fms_import_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_import_step_owners enable row level security;
drop policy if exists fms_import_step_owners_select on public.fms_import_step_owners;
create policy fms_import_step_owners_select on public.fms_import_step_owners
  for select to authenticated using (true);
drop policy if exists fms_import_step_owners_write on public.fms_import_step_owners;
create policy fms_import_step_owners_write on public.fms_import_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_import_approval_matrix — value band → approver (amount-tiered).
-- A line routes to the band whose [min_amount, max_amount] contains its value;
-- max_amount null = open-ended top band.
-- ===========================================================================
create table if not exists public.fms_import_approval_matrix (
  id                uuid primary key default gen_random_uuid(),
  tier_label        text not null,
  min_amount        numeric(14,2) not null default 0,
  max_amount        numeric(14,2),
  approver_user_id  uuid not null references auth.users on delete cascade,
  sort_order        integer not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (max_amount is null or max_amount >= min_amount)
);

comment on table public.fms_import_approval_matrix is
  'Amount-tiered approval routing: each active band maps a value range to an approver.';

create index if not exists fms_import_approval_matrix_order_idx
  on public.fms_import_approval_matrix (sort_order, min_amount);

drop trigger if exists trg_fms_import_approval_matrix_updated on public.fms_import_approval_matrix;
create trigger trg_fms_import_approval_matrix_updated
  before update on public.fms_import_approval_matrix
  for each row execute function public.set_updated_at();

alter table public.fms_import_approval_matrix enable row level security;
drop policy if exists fms_import_approval_matrix_select on public.fms_import_approval_matrix;
create policy fms_import_approval_matrix_select on public.fms_import_approval_matrix
  for select to authenticated using (true);
drop policy if exists fms_import_approval_matrix_write on public.fms_import_approval_matrix;
create policy fms_import_approval_matrix_write on public.fms_import_approval_matrix
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_import_config — key/value singletons (jsonb). e.g.
--   'process_coordinators' → {"user_ids": [...]}
--   'amount_basis'         → {"value": "line_incl_gst"}
-- ===========================================================================
create table if not exists public.fms_import_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_import_config is
  'Singleton import settings (process coordinators, amount basis, …) keyed by name.';

drop trigger if exists trg_fms_import_config_updated on public.fms_import_config;
create trigger trg_fms_import_config_updated
  before update on public.fms_import_config
  for each row execute function public.set_updated_at();

alter table public.fms_import_config enable row level security;
drop policy if exists fms_import_config_select on public.fms_import_config;
create policy fms_import_config_select on public.fms_import_config
  for select to authenticated using (true);
drop policy if exists fms_import_config_write on public.fms_import_config;
create policy fms_import_config_write on public.fms_import_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_import_counters + fms_import_next_seq — atomic document numbering.
-- next_seq increments the counter for a scope under a row lock and returns the
-- new value. SECURITY DEFINER so workflow RPCs (Phase 3) can call it regardless
-- of the caller's table rights; no client gets direct write access.
-- ===========================================================================
create table if not exists public.fms_import_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_import_counters is
  'Per-scope document-number sequences (e.g. PR-2627, PO-2627). Mutated only via fms_import_next_seq().';

alter table public.fms_import_counters enable row level security;
drop policy if exists fms_import_counters_select_admin on public.fms_import_counters;
create policy fms_import_counters_select_admin on public.fms_import_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_import_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_import_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_import_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_import_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';

grant execute on function public.fms_import_next_seq(text) to authenticated;
