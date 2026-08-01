-- Per-user FULL ACCESS grants for the Outstanding Dashboard (Receivables Control).
--
-- `receivables_hidden_menus` (shipped 23-Jun-2026) answers "can this user SEE the
-- menu?". It cannot answer "how much of it may they use?", and two menus have a
-- second, deeper tier that was pinned to role = admin:
--
--   reports   -> the Dashboards + Insights categories and the three reports behind
--                them (C-Level Dashboard, the 2026-07-23 C-Level original, Customer
--                Profile) were hidden from the catalogue AND route-guarded on admin.
--   settings  -> the Masters tab (the ConnectWave customer / group / company musters)
--                was admin-only; a non-admin with the menu saw only Data Refresh.
--
-- This column is the grant for that deeper tier — an ALLOW-list of menu keys where
-- the user is treated as an admin:
--   admin                       -> full access everywhere (ignores this column)
--   non-admin, NULL / empty     -> standard access (the default; nothing changes)
--   non-admin, keys present     -> full access to the listed menus
--
-- ALLOW-list here, deliberately the opposite of receivables_hidden_menus. Visibility
-- defaults to "on" so a newly shipped menu reaches everyone; elevation must default
-- to "off" so a newly shipped admin panel never does. Granting is always an explicit
-- act by an admin (Admin -> Users, or Settings -> Menu Permissions).
--
-- Keys are the same menu keys as the deny-list (lib/menus.tsx). Only `reports` and
-- `settings` have a full-access tier today; other keys are simply ignored.
--
-- NOT a substitute for the server-side check. The Masters screen writes through the
-- `muster-write` Edge Function, which re-reads this column with the service role
-- before touching another project's data — the client grant only decides what to
-- render.
--
-- Purely ADDITIVE: a new nullable column, no existing column or row touched.
-- Apply in the Orange One identity project (ref icutjkrqkbzwvmnfbzpr) via the SQL
-- editor or the session pooler before the frontend goes live — liveDirectory.ts
-- selects this column, so the directory load errors if the column is missing.

alter table public.profiles
  add column if not exists receivables_admin_menus text[];

comment on column public.profiles.receivables_admin_menus is
  'Outstanding Dashboard full-access allow-list: menu keys this user may use with admin-level depth (reports, settings). NULL/empty = standard access; admins bypass.';
