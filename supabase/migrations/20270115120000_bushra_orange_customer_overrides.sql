-- Orange vs Non-Orange Customers — the team's own call on which bucket a customer is in.
--
-- WHY
--   The dashboard (pages/BushraOrangeCustomers.tsx) buckets each Customer Group by a rule: Orange
--   if it bought a machine from us in the last two FYs, Non-Orange if it bought only our ink. The
--   rule cannot see a machine sold before that window, so customers who have run our machine for
--   years read as Non-Orange. Asked for 09-10-2026: let the business set the bucket by hand, and
--   have the dashboard and the report follow it.
--
-- WHAT IS STORED
--   One row per Customer Group the business has set by hand. No row = the rule decides. Removing a
--   row ("back to auto") hands the customer back to the rule. The key is the Customer Group name
--   exactly as the dashboard shows it (ext_ledger_group.group_name, or the ledger name for a ledger
--   with no group), since that is what a customer IS on that screen.
--
-- ACCESS — everyone who can open the reports sees the choices; only admins change them.
--   Reads follow the reports' own gate (`outstanding-dashboard`, see apps/appInfo.ts → reports).
--   Writes are admin-only: a bucket moves every figure on the dashboard for everyone.
--
-- Purely ADDITIVE: one new table, nothing existing altered. Reuses public.set_updated_at(),
-- public.module_level(uuid, text) and public.is_admin(uuid). Apply in the Orange One *identity*
-- project (ref coshondiqdhorwvibrwu), the one bushra_central_master_overrides lives in.
-- Reversal: see the _rollback.sql beside this file.

create table if not exists public.bushra_orange_customer_overrides (
  customer_group text primary key,
  bucket         text not null,
  note           text,
  updated_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint bushra_orange_customer_overrides_bucket
    check (bucket in ('Orange', 'Non-Orange')),
  constraint bushra_orange_customer_overrides_group_not_blank
    check (length(trim(customer_group)) > 0)
);

comment on table public.bushra_orange_customer_overrides is
  'Orange vs Non-Orange Customers: a Customer Group the business has put in a bucket by hand. No row = the dashboard''s rule decides (machine in the last two FYs = Orange, ink only = Non-Orange). See 20270115120000.';

drop trigger if exists trg_bushra_orange_customer_overrides_updated on public.bushra_orange_customer_overrides;
create trigger trg_bushra_orange_customer_overrides_updated
  before update on public.bushra_orange_customer_overrides
  for each row execute function public.set_updated_at();

alter table public.bushra_orange_customer_overrides enable row level security;

drop policy if exists bushra_orange_customer_overrides_select on public.bushra_orange_customer_overrides;
create policy bushra_orange_customer_overrides_select
  on public.bushra_orange_customer_overrides for select
  to authenticated
  using ((select public.module_level(auth.uid(), 'outstanding-dashboard')) <> 'none');

drop policy if exists bushra_orange_customer_overrides_insert on public.bushra_orange_customer_overrides;
create policy bushra_orange_customer_overrides_insert
  on public.bushra_orange_customer_overrides for insert
  to authenticated
  with check ((select public.is_admin(auth.uid())));

drop policy if exists bushra_orange_customer_overrides_update on public.bushra_orange_customer_overrides;
create policy bushra_orange_customer_overrides_update
  on public.bushra_orange_customer_overrides for update
  to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

drop policy if exists bushra_orange_customer_overrides_delete on public.bushra_orange_customer_overrides;
create policy bushra_orange_customer_overrides_delete
  on public.bushra_orange_customer_overrides for delete
  to authenticated
  using ((select public.is_admin(auth.uid())));

-- ---------------------------------------------------------------- verify --
--
--   select relrowsecurity from pg_class where oid = 'public.bushra_orange_customer_overrides'::regclass;
--   select policyname, cmd from pg_policies where tablename = 'bushra_orange_customer_overrides' order by cmd;
--   select bucket, count(*) from public.bushra_orange_customer_overrides group by bucket;
