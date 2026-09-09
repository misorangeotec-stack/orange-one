-- RC-15 — remove the one row created while proving the write path (10-09-2026).
--
-- ⚠️ RUN THIS IN THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb), not the identity project.
--
-- 'ZZ TEST SALESPERSON' was added through the deployed muster-write Edge Function to prove that
-- add / switch off / switch on actually land in the right database. The app itself has no delete —
-- entries are switched off, never removed — which is deliberate and is why this has to be a
-- one-line statement here rather than a button on the screen.
--
-- Safe: the name was never mapped to a customer, so nothing references it. The guard below makes
-- that explicit rather than assumed — if any ledger somehow carries the name, the delete removes
-- nothing and the select tells you so.

delete from public.ext_salesperson_master
 where name = 'ZZ TEST SALESPERSON'
   and not exists (select 1 from public.ext_ledger_tags where salesperson = 'ZZ TEST SALESPERSON')
   and not exists (select 1 from public.ext_redmark     where salesperson = 'ZZ TEST SALESPERSON');

-- Verify: 13 rows, and no test row left.
--   select count(*) from public.ext_salesperson_master;                            -- 13
--   select name from public.ext_salesperson_master where name like 'ZZ TEST%';     -- 0 rows
