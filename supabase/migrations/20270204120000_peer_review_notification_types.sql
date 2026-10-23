-- Peer task review · 1 of 2 — the two new bell notification types.
--
-- On its own on purpose: Postgres will not let a new enum label be USED in the same
-- transaction that adds it, and 20270204120100 inserts rows of these types
-- (same split as 20270106120000_recurring_reminder_notification_type.sql).
--
--   peer_review    → the person who GAVE a peer task: "Dimple completed it, review it".
--   peer_reopened  → the person DOING it: "the reviewer sent it back to you".
--
-- Additive. An enum label cannot be dropped, so there is no rollback for this file; an
-- unused label is harmless (the bell renders unknown types with a generic fallback).

alter type public.notification_type add value if not exists 'peer_review';
alter type public.notification_type add value if not exists 'peer_reopened';
