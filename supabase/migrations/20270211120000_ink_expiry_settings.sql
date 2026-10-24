-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Ink Expiry — which godowns COUNT, per company ("Godowns counted" on the dashboard).
--
-- The user, 22-10-2026: count stock godown-wise the same way as Ink IMS — for Enterprises Surat
-- only FINISHED GOODS-SACHIN and HOJIWALA (Production, Lab, LOOSE INK, Warehouse and job work are
-- not saleable stock). One row, shared by everyone:
--   counted_godowns   { "<company guid>": ["FINISHED GOODS-SACHIN", "HOJIWALA"], … } — godown names
--                     as in Tally, matched case-insensitively. Per company because names repeat
--                     across books. A company with no list counts every godown.
--   read    anyone with a grant on the app ('view' or 'edit'), and admins
--   write   admins only
--
-- Purely ADDITIVE: one new table, its policies. Reuses public.module_level() and public.is_admin().
-- Apply in the Orange One *identity* project (the VITE_SUPABASE_URL project).
-- Reversal: the _rollback.sql beside this file. Until this is applied the page keeps the default.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.ink_expiry_settings (
  id              smallint primary key default 1 check (id = 1),
  counted_godowns jsonb not null
                  default '{"59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e": ["FINISHED GOODS-SACHIN", "HOJIWALA"]}'::jsonb,
  updated_by      uuid references auth.users on delete set null,
  updated_at      timestamptz not null default now()
);
comment on table public.ink_expiry_settings is
  'Ink Expiry: the one settings row — godowns whose stock counts, per company guid. See 20270211120000.';
insert into public.ink_expiry_settings (id) values (1) on conflict (id) do nothing;

alter table public.ink_expiry_settings enable row level security;

drop policy if exists ink_expiry_settings_select on public.ink_expiry_settings;
create policy ink_expiry_settings_select on public.ink_expiry_settings for select to authenticated
  using ((select public.module_level(auth.uid(), 'ink-expiry')) <> 'none' or (select public.is_admin(auth.uid())));

drop policy if exists ink_expiry_settings_write on public.ink_expiry_settings;
create policy ink_expiry_settings_write on public.ink_expiry_settings for update to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

grant select, update on public.ink_expiry_settings to authenticated;

commit;
