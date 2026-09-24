-- ===========================================================================
-- ROLLBACK for 20261215120200_ld3_ld8_participants_and_delivery.sql
--
-- ⚠ RUN THIS FIRST, before the workflow and foundations rollbacks. These tables
--   reference fms_ld_sessions and the masters that those files drop.
--
-- ⚠ TABLES BEFORE FUNCTIONS — the RLS policies on the tables below call
--   fms_ld_is_coordinator and fms_ld_is_hod_of, and a policy is a dependent
--   object. Dropping functions first aborts the rollback half-done.
--
-- ⚠ THE SESSION COLUMNS ARE **NOT** DROPPED. `alter table … drop column` on
--   fms_ld_sessions would take the attendance sheet, the evidence paths and the
--   review with it, and those are the only copy. They are additive and nullable,
--   so leaving them costs nothing and losing them cannot be undone. Drop them by
--   hand, deliberately, if the module is being removed for good:
--     alter table public.fms_ld_sessions
--       drop column if exists readiness_confirmed_at, drop column if exists readiness_by,
--       drop column if exists invitations_sent_at,    drop column if exists nominations_closed_at,
--       drop column if exists attendance_closed_at,   drop column if exists attendance_sheet_path,
--       drop column if exists evidence_paths,         drop column if exists trainer_attended,
--       drop column if exists review_note,            drop column if exists review_action_points,
--       drop column if exists reviewed_by,            drop column if exists reviewed_at,
--       drop column if exists actual_cost;
--
-- ⚠ THIS DESTROYS PARTICIPANT DATA — nominations, RSVPs, attendance marks,
--   assignment submissions, feedback and every 30-day review. The uploaded files
--   survive in fms-ld-docs, orphaned, because Supabase refuses a direct DELETE
--   from the storage tables.
-- ===========================================================================

drop table if exists public.fms_ld_effectiveness;
drop table if exists public.fms_ld_feedback;
drop table if exists public.fms_ld_assignment_submissions;
drop table if exists public.fms_ld_assignments;
drop table if exists public.fms_ld_attendance;
drop table if exists public.fms_ld_materials;
drop table if exists public.fms_ld_nominations;

drop function if exists public.fms_ld_reopen_request(uuid, text);
drop function if exists public.fms_ld_close_request(uuid, jsonb);
drop function if exists public.fms_ld_submit_effectiveness(uuid, jsonb);
drop function if exists public.fms_ld_review_session(uuid, jsonb);
drop function if exists public.fms_ld_submit_feedback(uuid, jsonb);
drop function if exists public.fms_ld_escalate_submission(uuid);
drop function if exists public.fms_ld_review_submission(uuid, text, text);
drop function if exists public.fms_ld_submit_assignment(uuid, jsonb);
drop function if exists public.fms_ld_issue_assignment(uuid, jsonb);
drop function if exists public.fms_ld_close_attendance(uuid);
drop function if exists public.fms_ld_follow_up_absentee(uuid);
drop function if exists public.fms_ld_mark_attendance(uuid, jsonb);
drop function if exists public.fms_ld_record_conduct(uuid, jsonb);
drop function if exists public.fms_ld_confirm_readiness(uuid);
drop function if exists public.fms_ld_delete_material(uuid);
drop function if exists public.fms_ld_add_material(uuid, jsonb);
drop function if exists public.fms_ld_rsvp(uuid, boolean, text);
drop function if exists public.fms_ld_send_invitations(uuid);
drop function if exists public.fms_ld_decide_nomination(uuid, boolean, text);
drop function if exists public.fms_ld_nominate(uuid, uuid[], text);
drop function if exists public.fms_ld_is_participant(uuid, uuid);
drop function if exists public.fms_ld_can_act_session(text, uuid, uuid);
