-- Task Management — 'assigned' notification type (1 of 2).
--
-- This file contains the enum value and NOTHING ELSE, on purpose. Postgres lets
-- ALTER TYPE ... ADD VALUE run inside a transaction block, but refuses to let the
-- new label be USED in that same transaction ("unsafe use of new value"). Each
-- migration file is applied in its own transaction, so this separation is exactly
-- what makes 20260721120100 (which inserts rows typed 'assigned') safe to apply.
--
-- Additive: existing 'mention' rows and the column default are untouched.
-- Reversal: none — Postgres cannot drop an enum label. Acceptable; an unused
-- label is inert.

alter type public.notification_type add value if not exists 'assigned';
