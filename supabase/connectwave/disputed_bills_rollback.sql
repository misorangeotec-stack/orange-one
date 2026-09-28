-- ROLLBACK for disputed_bills.sql (RC-13).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange).
--    Same target as the file it reverses.
--
-- ⚠️ IT DESTROYS EVERY DISPUTE RECORDED, WITH ITS REMARKS AND ITS CLEARING HISTORY.
--    Rehearse it IMMEDIATELY after the first apply, while the table is empty. Later, EXPORT FIRST:
--
--      select * from public.ext_dispute order by id;
--
-- ⚠️ ORDER MATTERS. Roll back in this order, or the app breaks before the database does:
--      1. the frontend  (the Disputed Bills report and the Masters tab read this table; a missing
--         table is a PostgREST 404 on load)
--      2. muster-write  (insert/update/delete/clear/reopen_dispute write it)
--      3. this file
--
-- WHAT IT DOES NOT TOUCH, BY DESIGN
--    ext_redmark and every other muster. RC-13 only ADDED a table; Red Mark's clear status is RC-12's
--    and has its own rollback (redmark_clear_status_rollback.sql).
--
-- Idempotent: running it twice, or before the create script was applied, is a no-op.

drop table if exists public.ext_dispute;

notify pgrst, 'reload schema';

-- ── Verify the rollback landed ───────────────────────────────────────────────
--   select to_regclass('public.ext_dispute');                                  -- null
--
-- ── And that it took nothing with it ─────────────────────────────────────────
--   select count(*), count(*) filter (where cleared) from public.ext_redmark;   -- 54, 0 (as of 17-09-2026)
