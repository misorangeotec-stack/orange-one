-- ROLLBACK for redmark_clear_status.sql (RC-12).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange).
--    Same target as the file it reverses.
--
-- ⚠️ IT DESTROYS THE CLEARING HISTORY, WHICH IS THE POINT OF THE FEATURE.
--    Dropping the columns discards who cleared each case, when, and why. Rehearse it IMMEDIATELY
--    after the first apply, while every row still reads cleared = false and there is nothing to
--    lose. Later, EXPORT FIRST:
--
--      select ledger_id, tally_name, cleared, cleared_at, cleared_by, clear_note
--        from public.ext_redmark where cleared;
--
-- ⚠️ ORDER MATTERS. Roll back in this order, or the app breaks before the database does:
--      1. the frontend  (it selects these columns; a missing column is a PostgREST 400 on load,
--         and Customer.blocked would stop being computed at all)
--      2. muster-write  (clear_redmark / reopen_redmark write them)
--      3. this file
--    Reversing the feature also RE-FLAGS every cleared customer: the fetcher goes back to treating
--    row presence as the flag, so they reappear on the dashboard, the risk register, the credit
--    terms report and the Red Mark report. That is correct — it is what the flag meant before — but
--    it is a visible change to numbers people read, not a silent one.
--
-- WHAT IT DOES NOT TOUCH, BY DESIGN
--    Every red mark itself survives: ledger_id, tally_name, company, location, salesperson, reason,
--    checked, match_status, source and the audit pair are untouched. Reversing this feature loses
--    the clear status; it loses no red mark. `checked` in particular is not this feature's flag and
--    was never written by it.
--
-- Both statements are idempotent: running this twice, or before the create script was ever applied,
-- is a no-op rather than an error.

alter table public.ext_redmark
  drop constraint if exists ext_redmark_cleared_needs_who_when_note;

alter table public.ext_redmark
  drop column if exists cleared,
  drop column if exists cleared_at,
  drop column if exists cleared_by,
  drop column if exists clear_note;

notify pgrst, 'reload schema';

-- ── Verify the rollback landed ───────────────────────────────────────────────
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'ext_redmark'
--      and column_name in ('cleared','cleared_at','cleared_by','clear_note');    -- 0
--
-- ── And that it took nothing with it ─────────────────────────────────────────
--   select count(*) from public.ext_redmark;                        -- must still be 54
--   select count(*) filter (where checked) from public.ext_redmark;  -- must still be 54
