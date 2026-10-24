-- CC-1 · Arm the nightly ranking run.
--
-- ⚠ A LIVE SCHEDULE. Apply only once the user has seen the ranking and said yes.
--
-- Every night at 19:22 UTC = 00:52 IST, pg_cron calls fms_rank_kick(), which posts
-- { run: true } to the fms-ranking edge function with the shared dispatch secret. The
-- function freezes every finished month not yet frozen and recomputes the running one.
-- It sends no mail and changes no module's data: it writes only the fms_rank_* tables.
--
-- WHY 22 19 * * *. Checked against cron.job on 18-09-2026: minute 22 is on none of the
-- live schedules (*/3, */15, */30, 1-59/15, 3-59/5, 5,20,35,50, and the daily 00:30,
-- 01:40, 02:30, 03:30, 05:33 UTC). 00:52 IST is also after midnight, so the run on the
-- 1st sees the whole of the month it freezes. Re-check cron.job before applying.
--
-- The call is asynchronous (pg_net); its answer lands in net._http_response.
-- Rollback: …_cc1_fms_ranking_nightly_rollback.sql.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'fms-ranking-nightly') then
    raise exception 'CC-1: fms-ranking-nightly is already scheduled';
  end if;
  if to_regprocedure('public.fms_rank_kick()') is null then
    raise exception 'CC-1: apply 20261127120000_cc1_fms_ranking.sql first';
  end if;
end $$;

select cron.schedule(
  'fms-ranking-nightly',
  '22 19 * * *',
  $cmd$ set local statement_timeout = '30s'; select public.fms_rank_kick(); $cmd$
);
