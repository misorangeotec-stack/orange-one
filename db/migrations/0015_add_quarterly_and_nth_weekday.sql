-- Stage B — add QUARTERLY recurrence + monthly Nth-weekday scheduling (schema part).
--
-- Two additive capabilities for recurring tasks:
--   1. A 4th-ish frequency 'quarterly' — fires 7 days before each quarter ends
--      (Mar 24 / Jun 23 / Sep 23 / Dec 24). (Generator logic lands in 0016.)
--   2. Monthly "Nth weekday" scheduling (e.g. "1st Saturday of every month") via
--      two new columns. When monthly_weekday is set, the monthly template fires on
--      the monthly_nth occurrence (1..5) of that weekday; otherwise it keeps using
--      monthly_days (day-of-month). Existing monthly templates are unaffected.
--
-- ⚠️ RUN THIS MIGRATION ON ITS OWN, BEFORE 0016. Postgres does not allow a new
-- enum value to be ADDED and then USED in the same transaction, and 0016's
-- functions reference 'quarterly'. The Supabase SQL editor runs a script as one
-- transaction, so apply 0015 first (let it commit), then apply 0016 separately.
--
-- Reversal: enum values cannot be dropped in Postgres; to fully revert you would
-- recreate the type. The added columns are safe to drop:
--   alter table public.recurring_tasks drop column if exists monthly_nth;
--   alter table public.recurring_tasks drop column if exists monthly_weekday;

-- 1. New enum label. IF NOT EXISTS makes this re-runnable (PG12+; Supabase = PG15).
alter type public.recurrence_type add value if not exists 'quarterly';

-- 2. Monthly Nth-weekday columns. Both null = day-of-month mode (monthly_days).
alter table public.recurring_tasks
  add column if not exists monthly_nth smallint;     -- 1..5 = 1st..5th occurrence
alter table public.recurring_tasks
  add column if not exists monthly_weekday smallint;  -- 0=Sun..6=Sat (matches weekly_days)

comment on column public.recurring_tasks.monthly_nth is
  'For monthly Nth-weekday scheduling: which occurrence (1..5). Null = day-of-month mode (use monthly_days).';
comment on column public.recurring_tasks.monthly_weekday is
  'For monthly Nth-weekday scheduling: weekday 0=Sun..6=Sat. Set together with monthly_nth (e.g. nth=1, weekday=6 = 1st Saturday). Null = day-of-month mode.';
