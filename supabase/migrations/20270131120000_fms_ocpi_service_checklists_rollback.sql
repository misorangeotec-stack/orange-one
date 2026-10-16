-- Rollback for 20270131120000_fms_ocpi_service_checklists.sql
begin;
drop policy if exists "fms ocpi checklists read"   on storage.objects;
drop policy if exists "fms ocpi checklists insert" on storage.objects;
drop policy if exists "fms ocpi checklists update" on storage.objects;
drop policy if exists "fms ocpi checklists delete" on storage.objects;
-- Empty the bucket first via the Storage API/dashboard: direct deletes from storage.objects are blocked.
delete from storage.buckets where id = 'fms-ocpi-service-checklists';
drop table if exists public.fms_ocpi_service_checklists;
commit;
