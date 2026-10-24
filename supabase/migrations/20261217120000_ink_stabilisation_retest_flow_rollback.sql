-- ============================================================================
-- Rollback for 20261217120000_ink_stabilisation_retest_flow.sql
--
-- ⚠ THIS DESTROYS EVERY SUBMITTED RETEST, EVERY REVIEW AND THE WHOLE TRAIL. The lots
--   themselves come from ConnectWave and are unaffected, but the Plant's remarks and
--   Management's decisions exist nowhere else. Export first if they might be wanted:
--
--     \copy (select * from public.ink_stab_tests order by due_date) to 'ink_stab_tests.csv' with (format csv, header);
--     \copy (select * from public.ink_stab_activity order by id)    to 'ink_stab_activity.csv' with (format csv, header);
--
-- ⚠ THE ATTACHED FILES ARE NOT DELETED BY SQL. Supabase refuses direct deletes from
--   storage.objects; empty the 'ink-stab-docs' bucket from the dashboard (or the Storage
--   API) BEFORE running this, or the bucket delete below fails.
-- ============================================================================

begin;

drop policy if exists "ink stab docs read"   on storage.objects;
drop policy if exists "ink stab docs insert" on storage.objects;
drop policy if exists "ink stab docs update" on storage.objects;
drop policy if exists "ink stab docs delete" on storage.objects;
delete from storage.buckets where id = 'ink-stab-docs';

drop function if exists public.ink_stab_delete_doc(uuid);
drop function if exists public.ink_stab_add_doc(uuid, jsonb);
drop function if exists public.ink_stab_review(uuid, text, text);
drop function if exists public.ink_stab_submit(jsonb);
drop function if exists public.ink_stab_can(text, uuid);

drop table if exists public.ink_stab_activity;
drop table if exists public.ink_stab_docs;
drop table if exists public.ink_stab_tests;
drop table if exists public.ink_stab_step_owners;

commit;

-- public.set_updated_at(), module_level(), module_can_edit() and is_admin() are shared
-- helpers used by many other tables. Left alone.
