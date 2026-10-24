-- Recurring-task reminder · 1 of 2 — the new bell notification type.
--
-- On its own on purpose: Postgres will not let a new enum label be USED in the same
-- transaction that adds it, and 20270106120100 inserts rows of this type
-- (same split as 20260721120000_add_assigned_notification_type.sql).
--
-- Additive. An enum label cannot be dropped, so there is no rollback for this file; an
-- unused label is harmless (the bell renders unknown types with a generic fallback).

alter type public.notification_type add value if not exists 'task_recurring_reminder';
