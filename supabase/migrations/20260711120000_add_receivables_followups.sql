-- Outstanding Dashboard — CUSTOMER FOLLOW-UPS + REMARKS.
--
-- The Receivables Hub has been read-only: it shows who owes what, but there is nowhere
-- to record what we DID about it. Payment-chase conversations lived in people's heads,
-- WhatsApp and private Excel. This adds an append-only follow-up log: on any customer
-- (or customer group) a team member records the discussion, an outcome, an optional
-- promise-to-pay, and the NEXT FOLLOW-UP DATE. That date drives each person's daily
-- worklist ("what do I have to chase today?"), and the rows accumulate into a
-- client-wise history management can read.
--
-- ENTITY KEY — deliberately the NAME, never the dashboard's Customer.id:
--   Customer.id is a pipeline-assigned surrogate ("C0001", one row per
--   name x company x location) that RENUMBERS on every reprocess, and it becomes a
--   Tally GUID when the admin "Live (Tally)" source toggle is on. The stable natural
--   key across the whole hub is the uppercase Tally ledger name (or the group name) --
--   it is what /customer/:id and /group/:id already carry and what consolidateByName /
--   consolidateByGroup merge on. So: (entity_type, entity_name).
--
-- OPEN/CLOSED MODEL — there is no status column, on purpose. A customer's OPEN
-- follow-up is simply the next_followup_date on its MOST RECENT row. Logging a new
-- follow-up supersedes the previous one (the new row becomes the latest), so an item
-- leaves "Due Today" the moment it is actioned; a null next_followup_date means "no
-- further chase". Same append-only-history shape as fms_purchase_followups.
--
-- Reads are open to any signed-in user; the per-salesperson narrowing is applied in the
-- UI at the useAppData scope chokepoint, consistent with the rest of the hub (see
-- lib/scope.tsx -- UI-level scoping is a documented, tracked limitation).
--
-- Purely ADDITIVE: a brand-new table, no existing table/column/row touched. Reuses the
-- existing public.set_updated_at() and public.is_admin(uuid) helpers.
-- Apply in the Orange One identity Supabase project (ref coshondiqdhorwvibrwu) via the
-- SQL editor or `supabase db push` BEFORE the frontend that reads it goes live.

create table if not exists public.receivables_followups (
  id                   uuid primary key default gen_random_uuid(),

  -- Entity: the customer (Tally ledger name) or the customer group this chase is about.
  entity_type          text not null check (entity_type in ('customer','group')),
  entity_name          text not null,

  -- The conversation.
  remarks              text not null,
  outcome              text not null check (outcome in (
                         'connected','no_response','promised_payment',
                         'payment_disputed','partial_received','escalated','other')),
  next_followup_date   date,                      -- null = no further follow-up scheduled

  -- Promise to pay (optional; typically captured when outcome = 'promised_payment').
  promised_amount      numeric,
  promised_date        date,

  -- Context frozen at the time of the call, so the history still reads true after the
  -- pipeline moves the numbers, and management reports need no re-derivation.
  outstanding_at_entry numeric,
  overdue_at_entry     numeric,
  salesperson          text,

  created_by           uuid not null default auth.uid() references auth.users on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.receivables_followups is
  'Outstanding Dashboard payment-chase log: one append-only row per follow-up on a customer or customer group (remark, outcome, promise-to-pay, next follow-up date). Keyed by NAME, not the pipeline''s Customer.id (which renumbers). The latest row per entity carries the open next_followup_date that drives the daily worklist.';

create index if not exists receivables_followups_entity_idx
  on public.receivables_followups (entity_type, entity_name);
create index if not exists receivables_followups_next_idx
  on public.receivables_followups (next_followup_date);
create index if not exists receivables_followups_created_idx
  on public.receivables_followups (created_at desc);

drop trigger if exists trg_receivables_followups_updated on public.receivables_followups;
create trigger trg_receivables_followups_updated
  before update on public.receivables_followups
  for each row execute function public.set_updated_at();

alter table public.receivables_followups enable row level security;

-- READ: any signed-in user. Follow-ups are team-wide by design (if a colleague is on
-- leave you must be able to see the last conversation with the client); the
-- per-salesperson narrowing happens in the UI.
drop policy if exists receivables_followups_select on public.receivables_followups;
create policy receivables_followups_select
  on public.receivables_followups for select
  to authenticated
  using (true);

-- INSERT: anyone signed in, but only as themselves.
drop policy if exists receivables_followups_insert on public.receivables_followups;
create policy receivables_followups_insert
  on public.receivables_followups for insert
  to authenticated
  with check (created_by = auth.uid());

-- UPDATE / DELETE: your own rows (fix a typo), or an admin (clean-up).
drop policy if exists receivables_followups_update on public.receivables_followups;
create policy receivables_followups_update
  on public.receivables_followups for update
  to authenticated
  using (created_by = auth.uid() or public.is_admin(auth.uid()))
  with check (created_by = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists receivables_followups_delete on public.receivables_followups;
create policy receivables_followups_delete
  on public.receivables_followups for delete
  to authenticated
  using (created_by = auth.uid() or public.is_admin(auth.uid()));

-- Reversal:
--   drop table if exists public.receivables_followups cascade;
