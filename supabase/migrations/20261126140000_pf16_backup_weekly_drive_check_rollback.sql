-- Rollback for 20261126140000_pf16_backup_weekly_drive_check.sql
-- run.py tolerates these being absent only if its verify step is removed too.
drop function if exists public.backup_files_forget(bigint, jsonb);
drop function if exists public.backup_files_logged();
