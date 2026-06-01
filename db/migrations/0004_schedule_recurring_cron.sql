-- Stage B / B4 — schedule daily recurring-task generation via pg_cron.
--
-- Runs generate_recurring_tasks() every morning at 00:30 UTC (06:00 IST), so each
-- day's tasks from active templates exist by the start of the working day. The
-- function dedups, so a missed/retried run is harmless. cron.schedule(name,...)
-- replaces the job if it already exists, making this migration re-runnable.
--
-- Unschedule with:  select cron.unschedule('generate-recurring-daily');

create extension if not exists pg_cron;

select cron.schedule(
  'generate-recurring-daily',
  '30 0 * * *',
  $$select public.generate_recurring_tasks();$$
);
