-- ===========================================================================
-- ROLLBACK for 20261215120400_ld2_annual_plan.sql — the RPCs only.
--
-- The fms_ld_plans / fms_ld_plan_lines TABLES belong to 20261215120100 and are
-- that migration's to drop. Dropping them here would take a published plan with
-- it, and a published plan is the evidence behind "the calendar was up by
-- January" — the one thing in this module that cannot be reconstructed.
-- ===========================================================================
drop function if exists public.fms_ld_link_session_to_plan(uuid, uuid);
drop function if exists public.fms_ld_revise_plan(uuid);
drop function if exists public.fms_ld_publish_plan(uuid);
drop function if exists public.fms_ld_delete_plan_line(uuid);
drop function if exists public.fms_ld_upsert_plan_line(jsonb);
drop function if exists public.fms_ld_create_plan(jsonb);
drop function if exists public.fms_ld_can_plan(uuid);
