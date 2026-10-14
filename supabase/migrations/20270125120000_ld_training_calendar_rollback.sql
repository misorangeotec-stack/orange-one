-- Rollback of 20270125120000_ld_training_calendar.sql
--
-- ⚠ DROPS THE CALENDAR COLUMNS — any calendar training's category, trainer,
--   cancel/complete stamps and mail stamps are lost. The sessions themselves,
--   their attendees and attendance stay. Restores the 10-hour target.

begin;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'ld-training-mails') then
    perform cron.unschedule('ld-training-mails');
  end if;
end $cron$;

drop function if exists public.fms_ld_send_due_training_mails(date);
drop function if exists public.fms_ld_complete_session(uuid, jsonb);
drop function if exists public.fms_ld_cancel_session(uuid, text);
drop function if exists public.fms_ld_bulk_save_calendar(jsonb);
drop function if exists public.fms_ld_save_calendar_session(jsonb);
drop function if exists public.fms_ld_queue_training_mail(uuid, text, uuid[]);
drop function if exists public.fms_ld_trainer_label(uuid);
drop function if exists public.fms_ld_people_directory();
drop function if exists public.fms_ld_now_ist();
drop function if exists public.fms_ld_is_teams_link(text);
drop function if exists public.fms_ld_can_manage_calendar(uuid);

delete from public.fms_ld_config where key = 'calendar_managers';
update public.fms_ld_config
   set value = jsonb_set(value, '{hours_per_head_year}', '10'::jsonb)
 where key = 'targets';

alter table public.fms_ld_nominations drop column if exists invite_mailed_at;

drop index if exists public.fms_ld_sessions_source_idx;
alter table public.fms_ld_sessions
  drop constraint if exists fms_ld_sessions_calendar_complete_chk,
  drop constraint if exists fms_ld_sessions_source_chk,
  drop constraint if exists fms_ld_sessions_category_chk,
  drop column if exists ics_sequence,
  drop column if exists cancel_mail_sent_at,
  drop column if exists invite_mail_sent_at,
  drop column if exists completed_by,
  drop column if exists completed_at,
  drop column if exists cancelled_by,
  drop column if exists cancelled_at,
  drop column if exists external_trainer_name,
  drop column if exists trainer_user_id,
  drop column if exists description,
  drop column if exists source,
  drop column if exists category;

commit;
