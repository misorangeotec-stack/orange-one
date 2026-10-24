-- Recurring Half-yearly / Yearly · 1 of 2 — the two new frequency values.
--
-- ⚠️ RUN ON ITS OWN, BEFORE 20270205120100. Postgres does not allow a new enum value to be
-- ADDED and then USED in the same transaction, and 20270205120100's functions use both.
--
-- No rollback file: enum values cannot be dropped. Unused values are harmless — the
-- 20270205120100 rollback leaves them in place and nothing writes them.

alter type public.recurrence_type add value if not exists 'half_yearly';
alter type public.recurrence_type add value if not exists 'yearly';
