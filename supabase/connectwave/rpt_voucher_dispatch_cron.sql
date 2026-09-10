-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_voucher_dispatch — pg_cron registration.
--
-- ⚠ APPLY LAST, and never while a historical backfill is running. The */5 poller starts rebuilding
--   the current FY for any tenant whose sync is newer than its last log row; registering it during
--   a wide backfill puts two scans of the 2.3 GB tally_object TOAST relation on the instance at
--   once. Same warning rpt_batch_line_cron.sql carries, for the same reason.
--
-- Slot choice: the rpt-* nightly staircase runs 14:30-18:00 UTC (20:00-23:30 IST), one job per
-- 15 minutes, currently ending with rpt-batch-refresh-nightly at 18:00. 18:15 is the next free
-- slot and leaves the staircase untouched.
--
-- This is the FOURTH */5 poller (batch, sales-register, stock-summary, now dispatch). That is
-- affordable because each one is gated on its own log table against tally_sync_state.last_sync_at
-- and returns 'up to date; skipped' without touching a voucher on the overwhelming majority of
-- ticks. Do not add a fifth without checking that assumption still holds.
--
-- cron.schedule UPSERTS BY NAME, so re-running this file is safe and no existing job is altered.
-- Both names start with 'rpt-', so they appear in the rpt_cron_health view with no change to it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'rpt-voucher-dispatch-nightly',
  '15 18 * * *',
  $$ set statement_timeout='30min'; call public.rpt_voucher_dispatch_refresh_nightly(); $$
);

select cron.schedule(
  'rpt-voucher-dispatch-after-sync',
  '*/5 * * * *',
  $$ set statement_timeout='30min'; select public.rpt_voucher_dispatch_refresh_if_stale(); $$
);

-- Confirm both landed alongside their siblings.
select jobid, schedule, jobname, active
  from cron.job
 where jobname like 'rpt-voucher-dispatch%'
 order by jobname;
