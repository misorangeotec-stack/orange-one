-- Red Mark: a CLEAR status on the master (RC-12).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. The repo's `supabase/migrations/` + `supabase db push`
--    target the identity project — run this one against the ConnectWave project.
--    Deploy this BEFORE the muster-write Edge Function that writes these columns, and before the
--    frontend that reads them. Purely ADDITIVE: four new columns on one table, nothing renamed,
--    nothing dropped, no existing row rewritten.
--
-- WHY (2026-09-16)
--   `ext_redmark` holds one row per red-marked ledger and the row's PRESENCE is the flag, so the
--   only way off the list was `delete_redmark` — which throws away exactly the history the master
--   exists to build: who was red-marked, why, for how long, and how it ended. The client asked on
--   03-09-2026 for a CLEAR status instead: the case is settled, the customer stops counting as
--   red-marked everywhere, and the record stays.
--
-- ⚠️ `checked` IS NOT THAT FLAG AND MUST NOT BE REUSED.
--   Every muster is seeded from the finance sheets and topped up on each sync with unchecked STUB
--   rows for brand-new customers; `checked` means "a human has verified this row". Overloading it
--   with "the customer has paid" breaks both meanings at once and cannot be untangled afterwards.
--   Measured 14-09-2026: all 54 rows read checked = true, which under the other meaning would say
--   every red mark is already settled.
--
-- ⚠️ THE NOTE IS REQUIRED, AND THE DATABASE IS WHERE THAT IS TRUE.
--   A partly-paid case may always be cleared — no balance check, by decision — so without the note
--   a cleared row with money still owed against it is unexplainable a month later. The check
--   constraint below is what makes "cleared" and "unexplained" unrepresentable together, rather
--   than trusting each of the three writers (the Muster Editor, the report, the Excel import).
--
-- WHO MAY WRITE THEM: only the `muster-write` Edge Function, via the service key. This table is
--   anon-READ-only (RLS policy ext_redmark_read) and has no other writer anywhere — checked
--   16-09-2026 against pg_proc, pg_rewrite, cron.job, pg_publication_tables and the ConnectWave-App
--   checkout: no function, view, cron job, realtime publication or seeding script touches it. It was
--   seeded once by ext_redmark_master.sql.
--
-- The clear/reopen action carries its OWN authorisation rule in that function (admin, or a Settings
-- full-access user, or a collector whose receivables_collection_teams contains this ledger's
-- ext_ledger_group.collection_team) — see supabase/functions/muster-write/index.ts.
--
-- Reversal: redmark_clear_status_rollback.sql. Rehearse it IMMEDIATELY, while nothing has been
-- cleared yet — once a case is cleared, the rollback destroys the record of how it ended.

alter table public.ext_redmark
  -- The flag itself. NOT NULL with a default, so every existing row reads "not cleared" the moment
  -- the column exists and the fetcher's `cleared !== true` test never meets an unknown.
  add column if not exists cleared    boolean not null default false,
  -- Who cleared it, and when. `cleared_at` is written by the Edge Function rather than defaulted:
  -- a default would stamp a clearing date on rows that were never cleared.
  add column if not exists cleared_at timestamptz,
  add column if not exists cleared_by text,
  -- How it ended — full payment, part payment plus write-off, legal settlement. Required on clear
  -- by the constraint below.
  add column if not exists clear_note text;

comment on column public.ext_redmark.cleared is
  'RC-12: the case is settled and the customer no longer counts as Red Mark anywhere (connectwaveFetcher ignores cleared rows when building Customer.blocked). The ROW STAYS — this is not a delete. Reopening sets it back to false and leaves cleared_at/cleared_by/clear_note as the record of the last clearing.';

comment on column public.ext_redmark.clear_note is
  'Why the case was closed. Required whenever cleared is true (see the check constraint): a partly-paid case may be cleared, so without this a cleared row with money still owed against it is unexplainable.';

-- Cleared implies all three of who, when and why. Every one of the 54 live rows has cleared = false,
-- so the constraint is satisfied on arrival and validates in milliseconds — the whole-table scan it
-- performs is over a 54-row table, not a snapshot.
do $$
begin
  alter table public.ext_redmark
    add constraint ext_redmark_cleared_needs_who_when_note
    check (
      not cleared
      or (cleared_at is not null and cleared_by is not null and btrim(coalesce(clear_note, '')) <> '')
    );
exception
  when duplicate_object then null;   -- already applied
end $$;

-- PostgREST caches the schema; without this the new columns stay invisible to the Edge Function and
-- to the browser's select until the cache happens to turn over.
notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select count(*) total, count(*) filter (where cleared) cleared
--     from public.ext_redmark;                                    -- 54, 0
--   select conname from pg_constraint
--    where conrelid = 'public.ext_redmark'::regclass
--      and conname = 'ext_redmark_cleared_needs_who_when_note';   -- one row
