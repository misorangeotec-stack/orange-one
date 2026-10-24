-- Rollback for 20261126120000_pf16_backup_schedule_and_run_log.sql
--
-- Stops the nightly backup from being woken and removes its database objects.
-- ⚠ It does NOT touch Google Drive: every copy already taken stays in
--   "Orange One Backup". Dropping backup_runs loses only the run history.
-- ⚠ The read-only login `orange_one_backup` was created outside this migration
--   (its password is not in git). Drop it separately if wanted:
--     drop role if exists orange_one_backup;

select cron.unschedule('backup-kick')     where exists (select 1 from cron.job where jobname = 'backup-kick');
select cron.unschedule('backup-watchdog') where exists (select 1 from cron.job where jobname = 'backup-watchdog');

drop function if exists public.backup_watchdog();
drop function if exists public.backup_kick();
drop function if exists public.backup_dispatch(text);
drop function if exists public.backup_run_finish(bigint, text, jsonb, text);
drop function if exists public.backup_run_start(text, text);
drop function if exists public.backup_due(timestamptz);

drop table if exists public.backup_runs;
drop table if exists private.backup_config;
