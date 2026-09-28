-- Disputed bills: a master of the customer bills in dispute (RC-13).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. The repo's `supabase/migrations/` target the identity
--    project; never `supabase db push` this repo. Apply through the management API or the SQL editor.
--    Deploy this BEFORE the muster-write Edge Function that writes the table, and before the frontend
--    that reads it. Purely ADDITIVE: one new table, nothing existing is touched.
--
-- WHY (2026-09-17)
--   Accounts keeps a hand-made sheet of bills under dispute (DISPUTE & REDMARK.xlsx, tab DISPUTE), and
--   people were typing the STATUS into its remark column — "CLEAR", "NO DISPUTE", "Dispute resolved…" —
--   because there was nowhere else to put it, so it could not be filtered, counted or defaulted away.
--   This is that list, with a real clear status beside the remark.
--
-- ⚠️ IT STORES ONLY WHAT A HUMAN TYPES.
--   Customer name, bill date, invoice amount, pending and sale type are LIVE figures: the report joins
--   each row to collection_invoice_snapshot at read time. A copy here is how a report starts
--   disagreeing with the dashboard. `tally_name` is the one exception — a display fallback for a
--   ledger that has left the snapshot, never a value anything computes with.
--
-- ⚠️ THE KEY IS (ledger_id, bill_ref), NEVER THE BILL NUMBER ALONE.
--   Measured 17-09-2026 across the 5,921 open bills: 2,010 rows share 982 bill numbers, while
--   (ledger_id, bill_ref) repeats 0 times — which is how collection_invoice_snapshot itself is keyed.
--   The sheet proves it on its own: SPARE/26-27/110 is on SWASTIK DIGITAL and on PANORAMMA PRINT.
--   ledger_id is the Tally ledger GUID, already unique per company, so no tenant column is needed
--   (ext_other_payments carries none either).
--
-- ⚠️ A SETTLED BILL LEAVES THE SNAPSHOT, AND THAT IS THE NORMAL WAY A DISPUTE ENDS.
--   So nothing here references the snapshot: a row outliving its bill is expected, and the screens show
--   it as "bill no longer open" with a prompt to clear it, rather than dropping it.
--
-- ⚠️ THE NOTE IS REQUIRED, AND THE DATABASE IS WHERE THAT IS TRUE — the same decision as Red Mark
--   (ext_redmark_cleared_needs_who_when_note): a dispute may always be cleared, so without the note a
--   cleared row is unexplainable a month later.
--
-- WHO MAY WRITE: only the `muster-write` Edge Function, via the service key. The table is READ-open to
--   anon/authenticated (the report reads it from the browser) and has no write policy. Clear/reopen
--   carry their own per-ledger rule in that function (authorizeClear); add/edit/delete need an admin
--   or a Settings full-access user.
--
-- Reversal: disputed_bills_rollback.sql. Rehearse it IMMEDIATELY after applying, while the table is
-- empty — once disputes are recorded, the rollback destroys them.

create table if not exists public.ext_dispute (
  id               bigint generated always as identity primary key,
  -- The bill this dispute is about. Both halves are the snapshot's own spelling, matched exactly.
  ledger_id        text        not null,              -- Tally ledger GUID (= Customer.id)
  bill_ref         text        not null,              -- Tally bill reference (= Invoice.billRefName)
  tally_name       text,                               -- customer name at entry; display fallback only
  -- The typed part.
  remarks          text,                               -- the field that changes weekly
  item_description text,                               -- what is disputed ("TX027-BYHX HEAD DRIVE BOARD");
                                                       -- the receivables data holds no item detail per bill
  -- The clear status, as on ext_redmark.
  cleared          boolean     not null default false,
  cleared_at       timestamptz,                        -- written by the Edge Function, never defaulted
  cleared_by       text,
  clear_note       text,
  -- Stewardship, as on every muster. `checked` means "a human verified this row" — NOT "settled".
  checked          boolean     not null default true,
  match_status     text        not null default 'guid_matched',
  source           text                 default 'muster',
  updated_at       timestamptz not null default now(),
  updated_by       text,

  constraint ext_dispute_ledger_bill_key unique (ledger_id, bill_ref),
  constraint ext_dispute_cleared_needs_who_when_note check (
    not cleared
    or (cleared_at is not null and cleared_by is not null and btrim(coalesce(clear_note, '')) <> '')
  )
);

comment on table public.ext_dispute is
  'RC-13: customer bills under dispute, one row per (ledger_id, bill_ref). Stores only typed fields; amounts, dates and names are joined live from collection_invoice_snapshot. Written only by the muster-write Edge Function.';

comment on column public.ext_dispute.cleared is
  'RC-13: the dispute is settled. The ROW STAYS — this is not a delete. Reopening sets it back to false and leaves cleared_at/cleared_by/clear_note as the record of the last clearing.';

-- Keep updated_at fresh on every in-app edit (the same trigger function every muster uses).
drop trigger if exists ext_dispute_touch on public.ext_dispute;
create trigger ext_dispute_touch before update on public.ext_dispute
  for each row execute function public.touch_updated_at();

-- RLS: read-open, write through the service role only.
-- ⚠ Grants are narrowed as well as policied. Supabase's default privileges hand anon/authenticated
--   INSERT/UPDATE/DELETE/TRUNCATE on every new public table, and RLS does not govern TRUNCATE.
alter table public.ext_dispute enable row level security;
revoke all on public.ext_dispute from anon, authenticated;
grant select on public.ext_dispute to anon, authenticated;
grant select, insert, update, delete on public.ext_dispute to service_role;
drop policy if exists ext_dispute_read on public.ext_dispute;
create policy ext_dispute_read on public.ext_dispute for select to anon, authenticated using (true);

-- PostgREST caches the schema; without this the table stays invisible until the cache turns over.
notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select count(*) from public.ext_dispute;                                   -- 0 on first apply
--   select conname from pg_constraint where conrelid = 'public.ext_dispute'::regclass order by 1;
--     -- ext_dispute_cleared_needs_who_when_note, ext_dispute_ledger_bill_key, ext_dispute_pkey
--   select policyname, cmd from pg_policies where tablename = 'ext_dispute';     -- ext_dispute_read SELECT
