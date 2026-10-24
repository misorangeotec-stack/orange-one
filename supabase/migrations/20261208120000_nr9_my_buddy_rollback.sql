-- Rollback for 20261208120000_nr9_my_buddy.sql
--
-- Drops the read-only helper and nothing else. It creates no table, touches no
-- row and changes no policy, so undoing it is a single drop: /my-buddy falls
-- back to the heading it had before, "You are your new joiner's buddy".

drop function if exists public.fms_hr_my_buddy();
