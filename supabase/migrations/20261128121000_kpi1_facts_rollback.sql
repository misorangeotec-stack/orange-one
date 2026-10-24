-- ROLLBACK for 20261128121000_kpi1_facts.sql — removes the KRA / KPI facts, the run log and
-- the report function. Nothing else reads them: the scorecard screen then shows its "no
-- figures yet" state.
--
-- ⚠ Stop the nightly job FIRST if it was armed (…_kpi1_facts_nightly_rollback.sql), or its
--   next kick posts to a function whose tables are gone and fails every night.
-- The generator refactor (…120000_kpi1_recurring_fires_on.sql) has its own rollback; run it
-- AFTER this one, since kpi_report calls recurring_fires_on.

drop function if exists public.kpi_facts_kick();
drop function if exists private.kpi_facts_url();
drop function if exists public.kpi_report(uuid, date, date);
drop function if exists public.kpi_run_fail(uuid, text);
drop function if exists public.kpi_finish(uuid);
drop function if exists public.kpi_put_module(uuid, text, jsonb);
drop function if exists public.kpi_put_rows(uuid, jsonb);
drop function if exists public.kpi_run_begin(uuid, timestamptz, text[], jsonb);
drop table if exists public.kpi_facts;
drop table if exists public.kpi_runs;
