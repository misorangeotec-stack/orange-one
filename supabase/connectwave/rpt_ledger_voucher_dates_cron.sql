-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_ledger_voucher_dates — pg_cron registration (RC-19). APPLY AFTER rpt_ledger_voucher_dates.sql.
--
-- SLOT CHOICE, read off the LIVE cron.job table on 17-09-2026 — the repo does not list every job:
--
--   minute mod 5 = 0   rpt-batch / rpt-sales-register / rpt-stock-summary / rpt-voucher-dispatch
--                      after-sync pollers (*/5), plus collection_refresh_after_sync (*/30)
--   minute mod 5 = 2   rpt-sales-despatch-after-sync (2-59/5)      — live, no file in this repo
--   minute mod 5 = 3   Orange One's masters-sync-watch (3-59/5), which READS this project
--   minute mod 5 = 4   rpt-soa-register-after-sync (4-59/5)        — live, no file in this repo
--
--   So the after-sync poller takes the last free offset, 1. It only ever does work in the tick after
--   collection_meta.refreshed_at moves, i.e. just after a snapshot rebuild has COMMITTED, so it is not
--   reading a table another job is mid-way through rewriting. ⚠ Every offset is now taken: the next
--   job scheduled here must be placed by measured load, not by arithmetic.
--
--   The nightly run re-applies the post-dated-voucher cap on the new IST day. 18:41 UTC = 00:11 IST,
--   after the rpt-* staircase (14:30-18:15 UTC; rpt-voucher-dispatch-nightly finishes ~18:21).
--
-- cron.schedule UPSERTS BY NAME, so re-running this file is safe. Both names start with 'rpt-'.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

select cron.schedule(
  'rpt-ledger-voucher-dates-after-sync',
  '1-59/5 * * * *',
  $$ set statement_timeout='10min'; select public.rpt_ledger_voucher_dates_if_stale(); $$
);

select cron.schedule(
  'rpt-ledger-voucher-dates-nightly',
  '41 18 * * *',
  $$ set statement_timeout='10min'; select public.rpt_ledger_voucher_dates_rebuild('cron', (select refreshed_at from public.collection_meta where id = 1)); $$
);

-- Confirm both landed.
select jobid, schedule, jobname, username, active
  from cron.job
 where jobname like 'rpt-ledger-voucher-dates%'
 order by jobname;
