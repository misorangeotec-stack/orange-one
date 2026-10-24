-- ===========================================================================
-- ROLLBACK for 20261218120000_hd2_help_desk_tickets.sql
--
-- Drops the ticket table, both gates, the fan-out helper, fms_help_raise, the
-- storage helpers and the four storage policies — and RESTORES HD-1's wide
-- activity read policy, so the database is left exactly as HD-1 left it rather
-- than with no policy at all (which would make the timeline unreadable to
-- everyone and look like a different bug).
--
-- ⚠ TABLES BEFORE FUNCTIONS. The tickets policy calls fms_help_can_see, and a
--   policy is a dependent object: dropping the function first aborts with
--   ERROR 2BP01 half-way. No `cascade` — on a shared database it silently
--   removes whatever else depended on the object.
--
-- ⚠ THE STORAGE POLICIES MUST GO BEFORE fms_help_can_see FOR THE SAME REASON.
--   They are the other dependent objects, and they live in a different schema,
--   which is exactly how they get forgotten.
--
-- ⚠ THIS DESTROYS EVERY TICKET. Safe only while none has been raised. Once the
--   desk is in use this file is not a rollback, it is data loss — take a backup
--   first and expect the on-delete-restrict FK from fms_help_tickets to
--   fms_help_categories to be the least of it.
--
-- ⚠ IT DOES NOT REMOVE UPLOADED FILES. Supabase's storage.protect_delete()
--   trigger refuses a direct DELETE from storage.objects
--   (ERROR 42501), so attachments outlive their tickets and become orphans that
--   only an admin can reach. Clear them from Dashboard → Storage if that matters.
-- ===========================================================================

begin;

-- ---- storage policies (dependents of fms_help_can_see, in another schema) ---
drop policy if exists "fms help docs read"   on storage.objects;
drop policy if exists "fms help docs insert" on storage.objects;
drop policy if exists "fms help docs update" on storage.objects;
drop policy if exists "fms help docs delete" on storage.objects;

-- ---- tables ----------------------------------------------------------------
drop table if exists public.fms_help_tickets;

-- ---- put HD-1's activity policy back ---------------------------------------
drop policy if exists fms_help_activity_select on public.fms_help_activity;
create policy fms_help_activity_select on public.fms_help_activity
  for select to authenticated using (true);

-- ---- functions -------------------------------------------------------------
drop function if exists public.fms_help_raise(uuid, text, text, text, jsonb, uuid[]);
drop function if exists public.fms_help_can_add_doc(text, uuid);
drop function if exists public.fms_help_doc_slot(text);
drop function if exists public.fms_help_doc_ticket(text);
drop function if exists public.fms_help_owner_ids(uuid);
drop function if exists public.fms_help_can_act(text, uuid, uuid);
drop function if exists public.fms_help_can_see(uuid, uuid);

-- ---- prove nothing leaked --------------------------------------------------
do $rb$
declare v_n int;
begin
  if to_regclass('public.fms_help_tickets') is not null then
    raise exception 'rollback left fms_help_tickets standing';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_help_can_see','fms_help_can_act','fms_help_owner_ids',
                       'fms_help_raise','fms_help_doc_ticket','fms_help_doc_slot',
                       'fms_help_can_add_doc');
  if v_n > 0 then
    raise exception 'rollback left % HD-2 function(s) standing', v_n;
  end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'fms help docs%';
  if v_n > 0 then
    raise exception 'rollback left % help storage policy/policies standing', v_n;
  end if;
  -- HD-1's state, restored.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_help_activity'
       and policyname = 'fms_help_activity_select' and qual = 'true'
  ) then
    raise exception 'rollback did not restore HD-1''s activity read policy';
  end if;
end $rb$;

commit;
