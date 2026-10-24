-- ===========================================================================
-- ROLLBACK for 20261215120500_ld9_ld10_compliance_and_reporting.sql
--
-- ⚠ TABLE BEFORE FUNCTIONS — its RLS policies call fms_ld_is_coordinator, and a
--   policy is a dependent object.
-- ===========================================================================
drop table if exists public.fms_ld_mandatory_programs;

drop function if exists public.fms_ld_plan_adherence(text);
drop function if exists public.fms_ld_learning_hours(integer);
drop function if exists public.fms_ld_period_summary(date, date);
drop function if exists public.fms_ld_mandatory_status(integer);
