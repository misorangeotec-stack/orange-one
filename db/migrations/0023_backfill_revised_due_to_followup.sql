-- 0023_backfill_revised_due_to_followup.sql
--
-- One-time backfill to go with the new revise behavior (reviseTask now sets
-- due_date = follow_up_date and moves week_start to that date's Monday, so a
-- revised task's deadline tracks its follow-up and it isn't flagged overdue
-- before the follow-up arrives).
--
-- Tasks revised BEFORE that change kept their old due_date, so they still read as
-- due/overdue on the original date while showing a later follow-up (e.g. the
-- "Fund Flow" task: DUE = today, follow-up = 01-07-2026). This syncs those.
--
-- Scope (deliberately conservative): only OPEN tasks still awaiting a follow-up
-- (status not completed/shifted) whose due_date hasn't been moved yet. Completed
-- and shifted history is left untouched, so past weekly scorecards don't change.
--
-- week_start uses Postgres date_trunc('week', ...), which is Monday-based and
-- matches the app's mondayOf() helper exactly.
--
-- NOT auto-reversible (it overwrites due_date/week_start in place). Run the
-- PREVIEW select below first and keep its output if you want an undo reference.

-- ── PREVIEW (run on its own first; mutates nothing) ───────────────────────────
-- select id, title, status, due_date, follow_up_date, week_start,
--        (date_trunc('week', follow_up_date::timestamp))::date as new_week_start
-- from public.tasks
-- where status not in ('completed','shifted')
--   and follow_up_date is not null
--   and due_date is distinct from follow_up_date
-- order by follow_up_date;

begin;

update public.tasks
set
  due_date   = follow_up_date,
  week_start = (date_trunc('week', follow_up_date::timestamp))::date
where status not in ('completed','shifted')
  and follow_up_date is not null
  and due_date is distinct from follow_up_date;

commit;
