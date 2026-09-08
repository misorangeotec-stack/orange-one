-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_batch_line — pg_cron registration.
--
-- ⚠ APPLY LAST. The */5 poller starts rebuilding the current FY for any tenant whose sync is
--   newer than its last log row. Registering it while a historical backfill is running would put
--   two heavy scans of a 1.87 GB TOAST relation on a 1 GB-RAM instance at the same time.
--
-- Slot choice: the existing rpt-* staircase runs 14:30-17:45 UTC (20:00-23:15 IST), one job per
-- 15 minutes, ending with rpt-stock-summary-refresh-nightly at 17:45. 18:00 UTC is the next free
-- slot and leaves the staircase untouched.
--
-- cron.schedule UPSERTS BY NAME, so re-running this file is safe and no existing job is altered.
-- Both names start with 'rpt-', so they appear in the rpt_cron_health view with no change to it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'rpt-batch-refresh-nightly',
  '0 18 * * *',
  $$ set statement_timeout='30min'; call public.rpt_batch_refresh_nightly(); $$
);

select cron.schedule(
  'rpt-batch-after-sync',
  '*/5 * * * *',
  $$ set statement_timeout='30min'; select public.rpt_batch_refresh_if_stale(); $$
);

-- Confirm both landed alongside their siblings.
select jobid, schedule, jobname, active
  from cron.job
 where jobname like 'rpt-batch%'
 order by jobname;
