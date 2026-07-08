-- Orange One MOBILE APP — core scaffold table.
--
-- First migration for the new Expo/React Native mobile app (lives in `mobile/`).
-- The mobile app authenticates against THIS identity project (ref
-- coshondiqdhorwvibrwu) — the same accounts as the web portal — so it needs no
-- new auth. This migration adds only what the mobile scaffold needs to prove
-- end-to-end read/write: a per-user device registry.
--
-- Naming: mobile-app tables are prefixed `app_` (convention `app_<table>`), to
-- keep them clearly separate from the web portal's tables and the `fms_*` engine.
--
-- Tables (public, RLS-enabled):
--   app_devices  — one row per (user, device); push token + last-seen metadata.
--
-- RLS model: a user may only see and write their OWN device rows
-- (user_id = auth.uid()). No admin bypass needed here.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Reuses the existing
-- public.set_updated_at() helper. Apply in the Orange One *identity* Supabase
-- project (ref coshondiqdhorwvibrwu) via the SQL editor or `supabase db push`,
-- BEFORE the mobile app writes to it.
--
-- Reversal:
--   drop table if exists public.app_devices;

create table if not exists public.app_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id   text not null,
  platform    text,
  model       text,
  push_token  text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, device_id)
);

comment on table public.app_devices is
  'Orange One mobile app: one row per (user, device). RLS-scoped to the owner.';

create index if not exists app_devices_user_id_idx on public.app_devices (user_id);

-- Keep updated_at fresh on every update (reuses the shared trigger fn).
drop trigger if exists app_devices_set_updated_at on public.app_devices;
create trigger app_devices_set_updated_at
  before update on public.app_devices
  for each row execute function public.set_updated_at();

-- Row-Level Security: a user sees/writes only their own device rows.
alter table public.app_devices enable row level security;

drop policy if exists app_devices_select_own on public.app_devices;
create policy app_devices_select_own on public.app_devices
  for select using (user_id = auth.uid());

drop policy if exists app_devices_insert_own on public.app_devices;
create policy app_devices_insert_own on public.app_devices
  for insert with check (user_id = auth.uid());

drop policy if exists app_devices_update_own on public.app_devices;
create policy app_devices_update_own on public.app_devices
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists app_devices_delete_own on public.app_devices;
create policy app_devices_delete_own on public.app_devices
  for delete using (user_id = auth.uid());
