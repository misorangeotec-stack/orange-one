-- Rollback for 20261218120000_bushra_central_master_overrides_read_widen.sql
--
-- Restores the SELECT policy exactly as 20261212120000 created it — one app, and the bare
-- unwrapped call it was written with, so the reversal is the true inverse rather than a
-- tidied version of it.
--
-- ⚠ WHAT THIS COSTS, so it is a decision and not a reflex. Going back narrows reads to
--   admins and holders of bushra-central-master. On the live grants as of 28-09-2026 that
--   is 5 + 1 people, and it puts the other 15 holders of outstanding-dashboard back to
--   reading UNCORRECTED item classification on the Bushra Sales dashboards — silently,
--   because RLS answers a disallowed read with no rows rather than an error. Their screens
--   will simply disagree with an admin's. Only roll back if that is what is wanted.
--
-- No data is touched either way: this file swaps one policy for another. Nothing is
-- dropped that is not immediately recreated, and no override row is read or written.

drop policy if exists bushra_central_master_overrides_select on public.bushra_central_master_overrides;
create policy bushra_central_master_overrides_select
  on public.bushra_central_master_overrides for select
  to authenticated
  using (public.module_level(auth.uid(), 'bushra-central-master') <> 'none');

-- ---------------------------------------------------------------- verify --
--
--   select policyname, cmd, qual from pg_policies
--    where tablename = 'bushra_central_master_overrides' and cmd = 'SELECT';
--
-- Expected qual: (module_level(auth.uid(), 'bushra-central-master'::text) <> 'none'::text)
-- ============================================================================
