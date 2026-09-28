-- Bushra Central Master overrides — let the people who READ the figures read the corrections.
--
-- WHAT WAS WRONG
--   20261212120000 gated reads on a grant in the Bushra Central Master app:
--
--     using (public.module_level(auth.uid(), 'bushra-central-master') <> 'none')
--
--   That was right while the app was the only thing that read the table. It stopped being
--   right the moment the Bushra Sales dashboards began laying these corrections over
--   mst_items (lib/bushraSalesRegister.ts, loadItemLookup) — because those dashboards live
--   in a DIFFERENT app, outstanding-dashboard, and are granted separately.
--
--   Measured on live before this migration: 5 admins and 1 granted user could read the
--   overrides; 15 non-admin holders of outstanding-dashboard could not. RLS does not
--   refuse a read it disallows — it returns NO ROWS. So those 15 would have seen the
--   uncorrected classification, with no error and nothing on screen to say so, while an
--   admin beside them saw the corrected one. Two people, one dashboard, different figures.
--
--   The app's own store already promised otherwise: "what anyone saves, everyone reads"
--   (apps/bushra-central-master/lib/overridesDb.ts). This makes that true.
--
-- WHAT CHANGES
--   The SELECT policy, and nothing else. A grant on EITHER consuming app now reads.
--
-- ⚠ WRITES ARE NOT WIDENED, DELIBERATELY. Insert, update and delete still require 'edit'
--   on bushra-central-master. The asked-for shape was "everyone sees, only editors
--   change", and a reader of the Sales dashboards is not thereby an editor of the
--   masters. Only the read was ever too narrow.
--
-- ⚠ WHAT THIS EXPOSES is item classification — Type, Category, Ink type, Group, Colour,
--   Code for a stock item. It carries no money, no customer and no person. Anyone granted
--   the Outstanding Dashboard already reads these same fields off mst_items on every
--   screen; this is the team's correction of them, and it is what those screens are
--   drawing. There is nothing here that a reader of that app could not already see.
--
-- ⚠ THE TWO CHECKS ARE WRAPPED IN (select ...) ON PURPOSE. A bare `module_level(auth.uid(),
--   …)` in a USING clause is re-evaluated PER ROW; wrapped in a scalar subquery the planner
--   hoists it to a one-time InitPlan. The old policy was not wrapped, and this table is read
--   whole (one row per corrected item, thousands after a bulk Excel correction), so the
--   unwrapped form would have paid for the widening twice over. Note that pg_policies
--   prints the wrapping away — read this file, not the catalogue, when copying it.
--
-- Purely a policy replacement: no table, column, row, index or function is touched, and
-- nothing is dropped that is not immediately recreated. Apply in the Orange One *identity*
-- project (ref icutjkrqkbzwvmnfbzpr — the app's VITE_SUPABASE_URL; earlier headers in this
-- folder name a ref that is no longer the one the portal runs on).
-- Reversal: see the _rollback.sql beside this file. It has been rehearsed on live, not
-- merely written.

drop policy if exists bushra_central_master_overrides_select on public.bushra_central_master_overrides;
create policy bushra_central_master_overrides_select
  on public.bushra_central_master_overrides for select
  to authenticated
  using (
    (select public.module_level(auth.uid(), 'bushra-central-master')) <> 'none'
    or (select public.module_level(auth.uid(), 'outstanding-dashboard')) <> 'none'
  );

-- ---------------------------------------------------------------- verify --
--
-- 1 · One SELECT policy, and the write policies untouched at 'edit'.
--
--   select policyname, cmd, qual, with_check from pg_policies
--    where tablename = 'bushra_central_master_overrides' order by cmd;
--
-- 2 · A real non-admin who holds outstanding-dashboard but NOT bushra-central-master now
--     passes the read test, and still fails the write test. Substitute their id.
--
--   select public.module_level('<user>','bushra-central-master')  as bcm,   -- 'none'
--          public.module_level('<user>','outstanding-dashboard')  as od,    -- 'edit'
--          ((select public.module_level('<user>','bushra-central-master')) <> 'none'
--        or (select public.module_level('<user>','outstanding-dashboard')) <> 'none') as may_read;
--
-- 3 · Nobody gained a write. This must stay 1 (bushra-central-master at 'edit') + admins.
--
--   select count(*) from public.app_access
--    where app_id = 'bushra-central-master' and access_level = 'edit';
-- ============================================================================
