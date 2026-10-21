-- Shared screen layouts — an admin sizes the Bushra dashboards and reports once, for everyone.
--
-- WHY
--   Every size a reader sets on the Bushra pages (column widths, table and chart heights, bar
--   thickness, the columns picked, which sections are open) lives in that browser's localStorage.
--   Asked for 10-10-2026: "everytime when I login this page I need to resize the same". So an admin
--   saves the layout from their own screen, and every viewer opens on it.
--
-- WHAT IS STORED
--   One row per layout scope (today only 'bushra'): `entries` is the admin's localStorage layout
--   keys → values, exactly as the browser holds them. A viewer's browser applies a row once per
--   save (it remembers `updated_at`), so their own later tweaks hold until the admin saves again.
--   Nothing here is business data — a lost row only means everyone opens on the default sizes.
--
-- ACCESS — every signed-in user reads; only admins write.
--
-- Purely ADDITIVE: one new table. Reuses public.set_updated_at() and public.is_admin(uuid).
-- Apply in the Orange One *identity* project (ref coshondiqdhorwvibrwu).
-- Reversal: see the _rollback.sql beside this file.

create table if not exists public.hub_shared_layouts (
  id          text primary key,
  entries     jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint hub_shared_layouts_entries_is_object check (jsonb_typeof(entries) = 'object')
);

comment on table public.hub_shared_layouts is
  'Screen layouts an admin saved for everyone (column widths, heights, picked columns…), as browser localStorage key → value. One row per scope; see 20270118120000.';

drop trigger if exists trg_hub_shared_layouts_updated on public.hub_shared_layouts;
create trigger trg_hub_shared_layouts_updated
  before update on public.hub_shared_layouts
  for each row execute function public.set_updated_at();

alter table public.hub_shared_layouts enable row level security;

drop policy if exists hub_shared_layouts_select on public.hub_shared_layouts;
create policy hub_shared_layouts_select
  on public.hub_shared_layouts for select
  to authenticated
  using (true);

drop policy if exists hub_shared_layouts_insert on public.hub_shared_layouts;
create policy hub_shared_layouts_insert
  on public.hub_shared_layouts for insert
  to authenticated
  with check ((select public.is_admin(auth.uid())));

drop policy if exists hub_shared_layouts_update on public.hub_shared_layouts;
create policy hub_shared_layouts_update
  on public.hub_shared_layouts for update
  to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

drop policy if exists hub_shared_layouts_delete on public.hub_shared_layouts;
create policy hub_shared_layouts_delete
  on public.hub_shared_layouts for delete
  to authenticated
  using ((select public.is_admin(auth.uid())));

-- verify:
--   select id, jsonb_object_keys(entries) from public.hub_shared_layouts;
--   select id, updated_at, (select count(*) from jsonb_object_keys(entries)) as keys from public.hub_shared_layouts;
