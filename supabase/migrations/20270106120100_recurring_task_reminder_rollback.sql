-- Rollback for 20270106120100_recurring_task_reminder.sql.
-- Removes the job, the sender, the reminder rows and the added columns. The enum label
-- 'task_recurring_reminder' (20270106120000) stays — Postgres cannot drop one; unused it is harmless.

select cron.unschedule('recurring-task-reminders')
where exists (select 1 from cron.job where jobname = 'recurring-task-reminders');

drop function if exists public.send_recurring_reminders(date);

delete from public.notifications where type = 'task_recurring_reminder';

drop index if exists public.notifications_recurring_reminder_idx;
alter table public.notifications
  drop column if exists reminder_date,
  drop column if exists recurring_task_id;

alter table public.recurring_tasks
  drop constraint if exists recurring_tasks_notify_days_before_check;
alter table public.recurring_tasks
  drop column if exists notify_days_before,
  drop column if exists notify_required;
