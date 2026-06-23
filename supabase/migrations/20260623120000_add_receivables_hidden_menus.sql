-- Per-user menu visibility for the Outstanding Dashboard (Receivables Control).
--
-- Lets an admin hide individual left-nav menus from a specific login. Stored as a
-- DENY-LIST of menu keys the user may NOT see:
--   admin                       -> sees every menu (ignores this column)
--   non-admin, NULL / empty     -> sees every menu (the default)
--   non-admin, keys present     -> sees every menu EXCEPT the listed keys
--
-- Deny-list (not allow-list) on purpose: brand-new menus shipped later are visible
-- to everyone by default, matching "show all, then remove access per user".
-- Menu keys: dashboard, risk-register, salesperson-analysis,
-- salesperson-collection, import, reports, settings (see lib/menus.tsx).
--
-- Purely ADDITIVE: a new nullable column, no existing column or row touched.
-- Apply in the Orange One Supabase project (ref coshondiqdhorwvibrwu) via the
-- SQL editor or `supabase db push`.

alter table public.profiles
  add column if not exists receivables_hidden_menus text[];

comment on column public.profiles.receivables_hidden_menus is
  'Outstanding Dashboard menu deny-list: menu keys this user may NOT see. NULL/empty = all menus visible; admins bypass.';
