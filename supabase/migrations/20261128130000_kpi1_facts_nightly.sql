-- KPI-1 · Arm the nightly KRA / KPI facts run.
--
-- ⚠ A LIVE SCHEDULE. Apply only once the user has seen the scorecard and said yes.
--
-- Every night at 19:37 UTC = 01:07 IST, pg_cron calls kpi_facts_kick(), which posts
-- { run: true } to the kpi-facts edge function with the shared dispatch secret. The function
-- rebuilds every fact from the modules' own code and swaps the new run in whole
-- (kpi_finish). It sends no mail and changes no module's data: it writes only kpi_facts and
-- kpi_runs.
--
-- WHY 37 19 * * *. Checked against cron.job on 18-09-2026: minute 37 is on none of the live
-- schedules (*/3, */15, */30, 1-59/15, 3-59/5, 5,20,35,50, and the daily 00:30, 01:40, 02:30,
-- 03:30, 05:33 and CC-1's 19:22 UTC). It runs 15 minutes after the ranking, whose conductor
-- finishes in seconds, so the two never load the modules at the same moment. It is also after
-- midnight IST, so the as-of date is the new day and all of yesterday's work is judged.
-- Re-check cron.job before applying.
--
-- The call is asynchronous (pg_net); its answer lands in net._http_response.
-- Rollback: …_kpi1_facts_nightly_rollback.sql.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kpi-facts-nightly') then
    raise exception 'KPI-1: kpi-facts-nightly is already scheduled';
  end if;
  if to_regprocedure('public.kpi_facts_kick()') is null then
    raise exception 'KPI-1: apply 20261128121000_kpi1_facts.sql first';
  end if;
end $$;

select cron.schedule(
  'kpi-facts-nightly',
  '37 19 * * *',
  $cmd$ set local statement_timeout = '30s'; select public.kpi_facts_kick(); $cmd$
);
