-- 0024_add_reopened_activity_type.sql
--
-- Adds a 'reopened' value to the public.activity_type enum so the task timeline can
-- record when a completed task is reopened back to In Progress.
--
-- Context: the new Reopen action (current-week only) reverses a completion —
-- status -> in_progress and completed_at cleared. The log_task_activity trigger only
-- auto-logs completed/revised/shifted, so the client (taskWrites.reopenTask) inserts a
-- 'reopened' activity row itself; that insert needs this enum value to exist first.
--
-- Additive only: no existing tables/columns/data are mutated. ALTER TYPE ... ADD VALUE
-- cannot run inside a transaction that then uses the new value, so this migration only
-- adds the value (run it before deploying the frontend — deploy-ordering rule).
--
-- Reversible: there is no clean way to drop a single enum value in Postgres; leaving the
-- value in place is harmless if rolled back (nothing references it once reopenTask is gone).

alter type public.activity_type add value if not exists 'reopened';
