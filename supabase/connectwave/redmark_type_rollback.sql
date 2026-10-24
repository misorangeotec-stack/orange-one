-- ROLLBACK for redmark_type.sql.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb). Same target as the file it reverses.
--
-- ⚠️ IT FORGETS WHICH CUSTOMERS ARE LEGAL. Every row stays on the master as plain Red Mark. Export first:
--      select ledger_id, tally_name from public.ext_redmark where mark_type = 'legal';
--
-- ORDER: roll back the frontend, then muster-write (it writes mark_type), then this file.

alter table public.ext_redmark drop constraint if exists ext_redmark_mark_type_check;
alter table public.ext_redmark drop column if exists mark_type;

notify pgrst, 'reload schema';

-- Verify:  select count(*) from public.ext_redmark;   -- unchanged (51 on 21-10-2026)
