-- ===========================================================================
-- ROLLBACK for 20261231120000_fms_travel_raise_for_list.sql.
--
-- Drops the read function. The 'raise_for' config row is kept (additive-only
-- rule): with the function gone nothing reads it, and an admin's list survives
-- a re-apply.
-- ===========================================================================

begin;

drop function if exists public.fms_travel_raise_for_people();

commit;
