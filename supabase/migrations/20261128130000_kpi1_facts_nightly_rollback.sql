-- ROLLBACK for 20261128130000_kpi1_facts_nightly.sql — stops the nightly KRA / KPI facts run.
-- The facts already written stay, and the scorecard keeps showing them with their "as of"
-- stamp; nothing is recomputed until it is scheduled again (or the function is called by hand).
select cron.unschedule('kpi-facts-nightly')
 where exists (select 1 from cron.job where jobname = 'kpi-facts-nightly');
