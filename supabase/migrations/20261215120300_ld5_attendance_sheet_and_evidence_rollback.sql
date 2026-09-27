-- ===========================================================================
-- ROLLBACK for 20261215120300_ld5_attendance_sheet_and_evidence.sql
--
-- Drops the two RPCs only. The columns they write (attendance_sheet_path,
-- evidence_paths) were added by 20261215120200 and are that migration's to
-- remove — and its own rollback deliberately leaves them, because they hold the
-- only copy of a signed sheet.
--
-- ⚠ THE UPLOADED FILES ARE NOT TOUCHED. Supabase refuses a direct DELETE from
--   the storage tables; clear them through the Storage API if that matters.
-- ===========================================================================
drop function if exists public.fms_ld_add_evidence(uuid, text[]);
drop function if exists public.fms_ld_set_attendance_sheet(uuid, text);
