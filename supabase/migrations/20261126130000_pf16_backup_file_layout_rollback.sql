-- Rollback for 20261126130000_pf16_backup_file_layout.sql
--
-- ⚠ Dropping private.backup_files loses the map from each backed-up file back to
--   its place in the app. The files themselves stay in Google Drive, and the last
--   "Files index.csv" uploaded there still holds the same map.

drop function if exists public.backup_files_index_csv();
drop function if exists public.backup_files_done(bigint, jsonb);
drop function if exists public.backup_files_plan(text, int);
drop function if exists public.backup_file_catalog(text, int, boolean);
drop table if exists private.backup_files;
drop function if exists private.backup_suffix(text, text);
drop function if exists private.backup_clean_file(text);
drop function if exists private.backup_clean(text, int);
