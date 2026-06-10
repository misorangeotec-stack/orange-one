-- Stage B — add "WHEN" recurrence + per-day "Not Applicable" (schema part).
--
-- "When" is a 4th recurrence type. A "when" template fires every working day
-- Mon–Sat (skipping only Sunday) — the task is added to the assignee's list by
-- default, and they mark that day's instance "Not Applicable" when it doesn't
-- apply. An N/A instance is excluded from every report metric. Purely additive.
--
-- ⚠️ RUN THIS MIGRATION ON ITS OWN, BEFORE 0014. Postgres does not allow a new
-- enum value to be ADDED and then USED in the same transaction, and 0014's
-- functions reference 'when'. The Supabase SQL editor runs a script as one
-- transaction, so apply 0013 first (let it commit), then apply 0014 separately.
--
-- Reversal: enum values cannot be dropped in Postgres; to fully revert you would
-- recreate the type. The added columns are safe to drop:
--   alter table public.tasks drop column if exists not_applicable;
--   alter table public.tasks drop column if exists not_applicable_at;

-- 1. New enum label. IF NOT EXISTS makes this re-runnable (PG12+; Supabase = PG15).
alter type public.recurrence_type add value if not exists 'when';

-- 2. Per-instance "Not Applicable" flag on generated tasks. Reversible: the
--    underlying status is preserved. N/A tasks are filtered out of all report
--    counts/percentages in the frontend selectors (planned, RYG, dashboard).
alter table public.tasks
  add column if not exists not_applicable boolean not null default false;

-- 3. Light audit: when the instance was marked N/A (nulled when un-marked).
alter table public.tasks
  add column if not exists not_applicable_at timestamptz;

comment on column public.tasks.not_applicable is
  'True when this task instance was marked "Not Applicable" for its day (only used by "when" recurring instances). Excluded from all report metrics; reversible.';
comment on column public.tasks.not_applicable_at is
  'When not_applicable was last set true (null when applicable).';
