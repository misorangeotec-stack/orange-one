-- Rollback for 20270204120100_peer_task_review.sql
--
-- ⚠ THIS DROPS EVERY PEER REVIEW CLOSE. The tasks themselves are untouched (still
--   completed / in progress as they are). Take the closes out first if they are wanted:
--     \copy (select id, created_by, assigned_to, peer_closed_at, peer_closed_by
--              from public.tasks where peer_closed_at is not null) to 'peer_closes.csv' with (format csv, header);
--
-- The 'peer_review' / 'peer_reopened' notification rows and enum labels stay
-- (an enum label cannot be dropped; the bell renders them with a generic fallback).

begin;

drop trigger if exists trg_tasks_notify_peer_review on public.tasks;
drop function if exists public.notify_task_peer_review();

drop trigger if exists trg_tasks_guard_peer_review on public.tasks;
drop function if exists public.guard_task_peer_review();

drop index if exists public.tasks_peer_awaiting_review_idx;
alter table public.tasks
  drop column if exists peer_closed_by,
  drop column if exists peer_closed_at;

commit;
