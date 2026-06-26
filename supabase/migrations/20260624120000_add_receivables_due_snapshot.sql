-- Frozen month-start snapshot for the new Monthly Collection Report (v2).
--
-- The existing Salesperson Collection Report reverse-engineers its "opening" columns
-- (Opening Outstanding, Due-upto-month-end) from TODAY's live data on every load, so
-- those anchors drift through the month. The manual Excel process instead FREEZES them
-- on the 1st, which is what makes "Received + Pending = Due" verifiable.
--
-- This table stores, per customer per month, the frozen month-start figures captured
-- in-app (admin "Capture month-start snapshot"):
--   opening_outstanding  -- = previous month-end outstanding (already frozen in trend)
--   due_upto             -- = bills due by month-end as known at capture (overdue + coming-due)
--   due_soon             -- = the portion of due_upto NOT yet overdue at capture (coming due)
-- The report reads these for the frozen anchors; Received / Pending / Collection % stay live.
-- Target is a computed 65% rule (NOT stored). Salesperson is frozen at capture time.
--
-- Purely ADDITIVE: a brand-new table, no existing table/column/row touched.
-- Apply in the Orange One identity Supabase project (ref coshondiqdhorwvibrwu) via the
-- SQL editor or `supabase db push` BEFORE the frontend that reads it goes live.

create table if not exists public.receivables_due_snapshot (
  id                  bigserial primary key,
  month               text        not null,                  -- trend month label, e.g. "Jun-26"
  customer_id         text        not null,                  -- receivables ledger id (other project)
  customer_name       text,
  company             text,
  location            text,
  salesperson         text,                                  -- frozen at capture
  opening_outstanding numeric     not null default 0,        -- rupees
  due_upto            numeric     not null default 0,        -- rupees (overdue + coming-due)
  due_soon            numeric     not null default 0,        -- rupees (coming-due portion of due_upto)
  captured_at         timestamptz not null default now(),
  captured_by         uuid,
  unique (month, customer_id)
);

comment on table public.receivables_due_snapshot is
  'Frozen month-start figures (opening outstanding + due-by-month-end) per customer per month for the Monthly Collection Report v2. Captured in-app by an admin; additive/read-mostly.';

create index if not exists receivables_due_snapshot_month_idx
  on public.receivables_due_snapshot (month);

alter table public.receivables_due_snapshot enable row level security;

-- Any signed-in user may READ (the report itself is admin-gated in the UI for now, but
-- reads are harmless aggregates and this keeps the policy simple / future-proof).
drop policy if exists receivables_due_snapshot_select on public.receivables_due_snapshot;
create policy receivables_due_snapshot_select
  on public.receivables_due_snapshot for select
  to authenticated
  using (true);

-- Only admins may capture / overwrite the frozen snapshot.
drop policy if exists receivables_due_snapshot_write on public.receivables_due_snapshot;
create policy receivables_due_snapshot_write
  on public.receivables_due_snapshot for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
