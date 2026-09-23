-- ===========================================================================
-- ROLLBACK for 20261215120100_ld1_learning_development_workflow.sql
--
-- ⚠ RUN THIS BEFORE the foundations rollback
--   (20261215120000_ld1_learning_development_foundations_rollback.sql). The
--   tables here carry `on delete restrict` FKs into the masters that file drops.
--
-- ⚠ TABLES BEFORE FUNCTIONS. The RLS policies on fms_ld_requests depend on
--   fms_ld_can_read_request, so dropping the function first aborts the rollback
--   half-done — the same defect the foundations rehearsal caught on 21-09-2026.
--   Deliberately NOT `drop … cascade`: on a shared database that silently
--   removes whatever else happened to depend on the object.
--
-- ⚠ THIS DESTROYS TRAINING DATA. Requests, sessions, the annual plan and every
--   step reassignment go with it. The uploaded files in fms-ld-docs do NOT —
--   they survive in the bucket, orphaned, because Supabase refuses a direct
--   DELETE from the storage tables. Clear them through the Storage API if that
--   matters.
-- ===========================================================================

-- ---- tables (reverse of creation order) ------------------------------------
drop table if exists public.fms_ld_step_assignees;
drop table if exists public.fms_ld_sessions;
drop table if exists public.fms_ld_requests;
drop table if exists public.fms_ld_plan_lines;
drop table if exists public.fms_ld_plans;

-- ---- functions (now that no policy references them) ------------------------
drop function if exists public.fms_ld_reassign_step(uuid, text, uuid, text);
drop function if exists public.fms_ld_create_session(jsonb);
drop function if exists public.fms_ld_finalise_trainer(uuid, jsonb);
drop function if exists public.fms_ld_approve_request(uuid, text, text, jsonb, text);
drop function if exists public.fms_ld_submit_proposal(uuid, jsonb);
drop function if exists public.fms_ld_validate_request(uuid, boolean, jsonb, text);
drop function if exists public.fms_ld_create_request(jsonb);
drop function if exists public.fms_ld_can_read_request(uuid, uuid);
drop function if exists public.fms_ld_can_act(text, uuid, uuid);
drop function if exists public.fms_ld_mgmt_required(numeric);
