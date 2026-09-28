-- ROLLBACK for rpt_ledger_voucher_dates.sql + rpt_ledger_voucher_dates_cron.sql (RC-19).
--
-- ⚠️ APPLY TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb). Same target as the files it reverses.
--
-- SAFE TO RUN AT ANY TIME: the table holds only data derived from tally_voucher_line, rebuilt whole on
-- every run. Nothing is lost that the create script cannot rebuild in under a second.
--
-- ORDER: the frontend first if you are rolling back for good. The Credit Terms report FAILS SOFT without
-- this table (Customer since and Last transaction read "could not be loaded"), so running this file while
-- the page is live degrades it rather than breaking it.
--
-- Idempotent: running it twice, or before the create script was applied, is a no-op.

select cron.unschedule(jobid)
  from cron.job
 where jobname in ('rpt-ledger-voucher-dates-after-sync', 'rpt-ledger-voucher-dates-nightly');

drop function if exists public.rpt_ledger_voucher_dates_if_stale();
drop function if exists public.rpt_ledger_voucher_dates_rebuild(text, timestamptz);
drop table if exists public.rpt_ledger_voucher_dates_refresh_log;
drop table if exists public.rpt_ledger_voucher_dates;

notify pgrst, 'reload schema';

-- ── Verify the rollback landed ───────────────────────────────────────────────
--   select to_regclass('public.rpt_ledger_voucher_dates'),              -- null
--          to_regclass('public.rpt_ledger_voucher_dates_refresh_log');  -- null
--   select count(*) from cron.job where jobname like 'rpt-ledger-voucher-dates%';   -- 0
