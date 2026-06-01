-- Per-salesperson scoping for the Outstanding Dashboard.
--
-- Tags an Orange One login profile with the salesperson name(s) (exactly as they
-- appear in the Receivables data) that the user is allowed to see. The dashboard
-- reads this and restricts the view:
--   admin                    -> sees everything (ignores this column)
--   non-admin, names present -> sees only those salespeople
--   non-admin, NULL / empty  -> sees nothing (must be tagged first)
--
-- Purely ADDITIVE: a new nullable column, no existing column or row touched.
-- Apply in the Orange One Supabase project (ref coshondiqdhorwvibrwu) via the
-- SQL editor or `supabase db push`.

alter table public.profiles
  add column if not exists receivables_salespersons text[];

comment on column public.profiles.receivables_salespersons is
  'Outstanding Dashboard scope: salesperson names this user may see. NULL/empty = none (non-admin); admins bypass.';
