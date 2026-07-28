-- ===========================================================================
-- email_outbox — allow an EXTERNAL recipient (no portal user).
--
-- WHY
--   Every email the portal has sent so far goes to a colleague, so
--   `email_outbox.to_user_id` has been NOT NULL since the table was created
--   (20260721140000). The Order to Dispatch FMS introduces the first outbound
--   mail to someone OUTSIDE the company: the customer, told the planned dispatch
--   date at the material-status step. Such a row has an address but no user.
--
-- WHY THIS IS SAFE
--   Across the whole repo `to_user_id` appears ONLY in INSERT column lists. It is
--   never read:
--     · the dispatch trigger + cron in 20260721140100_add_email_dispatch.sql
--       reference only `new.id`;
--     · supabase/functions/send-email/index.ts sends to `row.to_email` and marks
--       a row 'skipped' when that is blank (index.ts:387, :391).
--   So relaxing the column cannot change any existing behaviour. The replacement
--   CHECK keeps the real invariant — a row must be addressable SOMEHOW.
--
--   `not valid` then `validate` so the ALTER does not hold a lock while it scans
--   the whole table. Every existing row carries a to_user_id, so validation passes.
--
-- Reversal:
--   alter table public.email_outbox drop constraint if exists email_outbox_recipient_ck;
--   -- (only after deleting any rows with a null to_user_id)
--   alter table public.email_outbox alter column to_user_id set not null;
--   alter table public.email_outbox drop column if exists to_name;
-- ===========================================================================

alter table public.email_outbox alter column to_user_id drop not null;

-- The recipient's display name, for an external address that has no profile.
alter table public.email_outbox add column if not exists to_name text;

alter table public.email_outbox drop constraint if exists email_outbox_recipient_ck;
alter table public.email_outbox
  add constraint email_outbox_recipient_ck
  check (to_user_id is not null or nullif(btrim(to_email), '') is not null)
  not valid;
alter table public.email_outbox validate constraint email_outbox_recipient_ck;

comment on column public.email_outbox.to_user_id is
  'Recipient portal user, when there is one. NULL for an external recipient (e.g. a customer) — then to_email carries the address and to_name the display name. The recipient CHECK requires at least one of the two.';
comment on column public.email_outbox.to_name is
  'Display name for an external recipient with no profile row.';
