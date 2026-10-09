-- ===========================================================================
-- ROLLBACK for 20270103120000_add_fms_drafts.sql.
--
-- Drops the policies, trigger and function. The table and bucket are KEPT
-- (additive-only rule): with the policies gone no signed-in user can read or
-- write them, and a re-apply finds every saved draft still there. To remove
-- them for good, empty the bucket in the dashboard, then:
--   drop table if exists public.fms_drafts;
--   delete from storage.buckets where id = 'fms-drafts';
-- ===========================================================================

begin;

drop policy if exists "fms drafts files read"   on storage.objects;
drop policy if exists "fms drafts files insert" on storage.objects;
drop policy if exists "fms drafts files update" on storage.objects;
drop policy if exists "fms drafts files delete" on storage.objects;

drop policy if exists fms_drafts_select on public.fms_drafts;
drop policy if exists fms_drafts_insert on public.fms_drafts;
drop policy if exists fms_drafts_update on public.fms_drafts;
drop policy if exists fms_drafts_delete on public.fms_drafts;

drop trigger if exists fms_drafts_touch on public.fms_drafts;
drop function if exists public.fms_drafts_touch();

commit;
