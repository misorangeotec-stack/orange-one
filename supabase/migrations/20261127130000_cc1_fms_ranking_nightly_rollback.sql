-- ROLLBACK for 20261127130000_cc1_fms_ranking_nightly.sql — stops the nightly ranking run.
-- The rankings already computed stay; nothing is recomputed until it is scheduled again
-- (or the function is called by hand).
select cron.unschedule('fms-ranking-nightly')
 where exists (select 1 from cron.job where jobname = 'fms-ranking-nightly');
