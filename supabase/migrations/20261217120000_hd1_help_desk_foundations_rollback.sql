-- ===========================================================================
-- ROLLBACK for 20261217120000_hd1_help_desk_foundations.sql
--
-- Undoes the Help Desk foundations: step owners, config, counters, activity,
-- notifications, the authz helpers and the storage bucket.
--
-- ⚠ RUN PART 2'S ROLLBACK FIRST
--   (20261217120100_hd1_help_desk_categories_rollback.sql). The category master
--   and the master-request table depend on nothing here by FK, but their RLS
--   policies call fms_help_is_coordinator(), and a policy is a dependent object
--   — so dropping these functions while those tables stand fails with
--   ERROR 2BP01. This file alone is therefore not "the rollback".
--
-- ⚠ NOTHING HERE TOUCHES ANY OTHER MODULE. Only fms_help_* objects.
--   public.set_updated_at(), public.is_admin() and public.designations are
--   shared and are left alone.
--
-- ⚠ THE BUCKET IS NOT DROPPED, AND IT CANNOT BE. Supabase installs a
--   `storage.protect_delete()` trigger that refuses a direct DELETE from BOTH
--   storage.objects and storage.buckets:
--       ERROR 42501: Direct deletion from storage tables is not allowed.
--                    Use the Storage API instead.
--   The reversal comments in most of the older FMS foundations migrations carry
--   that line anyway; they have never been run. Removing the bucket is a manual
--   Dashboard → Storage job, or leave it: an empty, unreferenced private bucket
--   costs nothing and breaks nothing. HD-1 creates it with NO policies, so there
--   are none to drop here either.
--
-- ⚠ TABLES BEFORE FUNCTIONS. Dropping a function while a policy calls it aborts
--   the rollback half-done. Dropping the tables takes their policies with them
--   and the functions then drop cleanly. `drop … cascade` is deliberately NOT
--   used: on a shared database it silently removes whatever else depended on the
--   object, which is the opposite of what a rollback is for.
-- ===========================================================================

begin;

-- ---- tables (reverse of creation order) ------------------------------------
drop table if exists public.fms_help_notifications;
drop table if exists public.fms_help_activity;
drop table if exists public.fms_help_counters;
drop table if exists public.fms_help_config;
drop table if exists public.fms_help_step_owners;

-- ---- functions -------------------------------------------------------------
drop function if exists public.fms_help_announce(text, uuid, text, text, uuid[], jsonb);
drop function if exists public.fms_help_step_owner_ids(text);
drop function if exists public.fms_help_is_reassign_target(uuid);
drop function if exists public.fms_help_is_coordinator(uuid);
drop function if exists public.fms_help_is_step_owner(text, uuid);
drop function if exists public.fms_help_fy_code(date);
drop function if exists public.fms_help_next_seq(text);

-- ---- prove nothing leaked --------------------------------------------------
do $rb$
declare v_n int;
begin
  select count(*) into v_n
    from information_schema.tables
   where table_schema = 'public' and table_name like 'fms\_help\_%';
  if v_n > 0 then
    raise exception 'rollback left % fms_help_* table(s) standing', v_n;
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'fms\_help\_%';
  if v_n > 0 then
    raise exception 'rollback left % fms_help_* function(s) standing', v_n;
  end if;

  select count(*) into v_n
    from pg_policies
   where schemaname = 'public' and tablename like 'fms\_help\_%';
  if v_n > 0 then
    raise exception 'rollback left % fms_help_* policy/policies standing', v_n;
  end if;
end $rb$;

commit;

-- MANUAL, after this file: Dashboard → Storage → delete the `fms-help-docs`
-- bucket if you want it gone. SQL cannot.
