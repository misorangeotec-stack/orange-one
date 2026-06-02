-- Stage B — add MONTHLY recurrence (schema part).
--
-- Extends recurring tasks with a monthly option: a template fires on chosen
-- days of the month (1..31), plus a sentinel 32 meaning "last day of month"
-- (so month-end works across 28/30/31-day months). Purely additive.
--
-- ⚠️ RUN THIS MIGRATION ON ITS OWN, BEFORE 0010. Postgres does not allow a new
-- enum value to be ADDED and then USED in the same transaction, and 0010's
-- functions reference 'monthly'. The Supabase SQL editor runs a script as one
-- transaction, so apply 0009 first (let it commit), then apply 0010 separately.
--
-- Reversal: enum values cannot be dropped in Postgres; to fully revert you would
-- recreate the type. The added column is safe to drop:
--   alter table public.recurring_tasks drop column if exists monthly_days;

-- 1. New enum label. IF NOT EXISTS makes this re-runnable (PG12+; Supabase = PG15).
alter type public.recurrence_type add value if not exists 'monthly';

-- 2. Chosen days of the month for monthly templates (1..31; 32 = last day).
--    Mirrors weekly_days: an int[] defaulting to empty. Not used by daily/weekly.
alter table public.recurring_tasks
  add column if not exists monthly_days int[] not null default '{}'::int[];

comment on column public.recurring_tasks.monthly_days is
  'Days of month a monthly template fires on (1..31); 32 is the sentinel for "last day of month". Empty for daily/weekly.';
