-- ===========================================================================
-- ROLLBACK for 20261217120100_hd1_help_desk_categories.sql
--
-- Drops the ticket-category master, the master-request table, the master-owner
-- helper and the `master_owners` config key.
--
-- ⚠ RUN THIS BEFORE THE FOUNDATIONS ROLLBACK
--   (20261217120000_hd1_help_desk_foundations_rollback.sql). The policies on
--   these two tables call fms_help_is_coordinator(), and a policy is a dependent
--   object — dropping the foundations functions first aborts with ERROR 2BP01
--   after the foundation tables are already gone.
--
-- ⚠ TABLES BEFORE FUNCTIONS, for the same reason, and no `cascade`: on a shared
--   database cascade silently removes whatever else depended on the object.
--
-- ⚠ THIS DESTROYS THE 30 SEEDED CATEGORIES. Nothing references them yet at
--   HD-1 (fms_help_tickets does not exist until HD-2), so this is safe here and
--   will NOT be once tickets are raised — at that point the FK refuses, which is
--   the correct failure.
-- ===========================================================================

begin;

drop table if exists public.fms_help_master_requests;
drop table if exists public.fms_help_categories;

drop function if exists public.fms_help_is_master_manager(uuid);

delete from public.fms_help_config where key = 'master_owners';

do $rb$
declare v_n int;
begin
  if to_regclass('public.fms_help_categories') is not null
     or to_regclass('public.fms_help_master_requests') is not null then
    raise exception 'rollback left a Help Desk master table standing';
  end if;
  if to_regprocedure('public.fms_help_is_master_manager(uuid)') is not null then
    raise exception 'rollback left fms_help_is_master_manager standing';
  end if;
  select count(*) into v_n from public.fms_help_config where key = 'master_owners';
  if v_n > 0 then
    raise exception 'rollback left the master_owners config key standing';
  end if;
end $rb$;

commit;
