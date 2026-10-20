-- ROLLBACK for legal_customer.sql.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange).
--    Same target as the file it reverses.
--
-- ⚠️ IT DESTROYS EVERY LEGAL CUSTOMER RECORDED, WITH ITS CLEARING HISTORY. Export first:
--
--      select * from public.ext_legal_customer order by ledger_id;
--
-- ⚠️ ORDER MATTERS. Roll back in this order, or the app breaks before the database does:
--      1. the frontend  (the Masters → Legal Customer tab reads this table; a missing table is a
--         PostgREST 404 on load of the whole Masters panel)
--      2. muster-write  (insert/update/delete/clear/reopen_legal write it)
--      3. this file
--
-- Touches nothing else — ext_redmark and every other muster are untouched.
-- Idempotent: running it twice, or before the create script was applied, is a no-op.

drop table if exists public.ext_legal_customer;

notify pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
--   select to_regclass('public.ext_legal_customer');                           -- null
