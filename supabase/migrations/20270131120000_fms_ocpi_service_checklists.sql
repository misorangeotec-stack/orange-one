-- ===========================================================================
-- OCPI · Service checklist PDF, one per machine.
--
-- The service team keeps a checklist PDF for every machine (what the customer
-- must have ready before installation — power, air, floor, ink, etc.). It is
-- uploaded ONCE on Masters → Service checklists (PDF), against the machine, and
-- every deal for that machine then offers it for download:
--   · on the Service Check (the service team), and
--   · on the Customer Sign step, so the salesperson can hand it to the customer
--     before the machine is installed.
--
-- ⚠ ITS OWN BUCKET, NOT fms-ocpi-docs. That bucket is keyed on the DEAL id and
--   is hidden from service-only users by the restrictive policy in
--   20270119120000 — the very people who need this file. A checklist belongs to
--   a machine, carries no price and no customer, so it lives in
--   fms-ocpi-service-checklists, readable by any signed-in user, writable by
--   admins and the Machine master owner (the same owner as Service check points).
--
-- Path: <machine-id>/<file>. The row stores the path; replacing the PDF writes a
-- new path and the app removes the old object.
--
-- Rollback (in one transaction):
--   drop policy if exists "fms ocpi checklists read"   on storage.objects;
--   drop policy if exists "fms ocpi checklists insert" on storage.objects;
--   drop policy if exists "fms ocpi checklists update" on storage.objects;
--   drop policy if exists "fms ocpi checklists delete" on storage.objects;
--   (empty the bucket first via the Storage API/dashboard — direct deletes from storage.objects are blocked)
--   delete from storage.buckets where id = 'fms-ocpi-service-checklists';
--   drop table if exists public.fms_ocpi_service_checklists;
-- ===========================================================================

begin;

-- ── 1 · The master: one PDF per machine ────────────────────────────────────
create table if not exists public.fms_ocpi_service_checklists (
  id          uuid primary key default gen_random_uuid(),
  machine_id  uuid not null unique references public.fms_ocpi_machines(id) on delete cascade,
  file_path   text not null,
  file_name   text not null,
  uploaded_by uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.fms_ocpi_service_checklists is
  'The service checklist PDF for a machine (one per machine). Uploaded on OCPI Masters → Service checklists (PDF) by admins and the Machine master owner; downloadable on every deal for that machine at Customer Sign and Service Check. File lives in storage bucket fms-ocpi-service-checklists at file_path.';

drop trigger if exists trg_fms_ocpi_service_checklists_updated on public.fms_ocpi_service_checklists;
create trigger trg_fms_ocpi_service_checklists_updated
  before update on public.fms_ocpi_service_checklists
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_service_checklists enable row level security;

drop policy if exists fms_ocpi_service_checklists_select on public.fms_ocpi_service_checklists;
create policy fms_ocpi_service_checklists_select on public.fms_ocpi_service_checklists
  for select to authenticated using (true);

-- Same owner as Service check points: admins + the Machine master owner.
drop policy if exists fms_ocpi_service_checklists_write on public.fms_ocpi_service_checklists;
create policy fms_ocpi_service_checklists_write on public.fms_ocpi_service_checklists
  for all to authenticated
  using ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid()))))
  with check ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid()))));

-- ── 2 · The bucket: private, PDFs only, 25 MB ──────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fms-ocpi-service-checklists', 'fms-ocpi-service-checklists', false,
        26214400, array['application/pdf'])
on conflict (id) do nothing;

-- ⚠ Policy names are GLOBAL on storage.objects — these four are unique to this bucket.
drop policy if exists "fms ocpi checklists read"   on storage.objects;
drop policy if exists "fms ocpi checklists insert" on storage.objects;
drop policy if exists "fms ocpi checklists update" on storage.objects;
drop policy if exists "fms ocpi checklists delete" on storage.objects;

-- Any signed-in user may read: the service team, the salesperson, management.
create policy "fms ocpi checklists read" on storage.objects
  for select to authenticated
  using (bucket_id = 'fms-ocpi-service-checklists');

create policy "fms ocpi checklists insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fms-ocpi-service-checklists'
              and ((select public.is_admin((select auth.uid())))
                   or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid())))));

create policy "fms ocpi checklists update" on storage.objects
  for update to authenticated
  using (bucket_id = 'fms-ocpi-service-checklists'
         and ((select public.is_admin((select auth.uid())))
              or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid())))))
  with check (bucket_id = 'fms-ocpi-service-checklists'
              and ((select public.is_admin((select auth.uid())))
                   or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid())))));

create policy "fms ocpi checklists delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fms-ocpi-service-checklists'
         and ((select public.is_admin((select auth.uid())))
              or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid())))));

-- ── 3 · Assert ─────────────────────────────────────────────────────────────
do $check$
declare v_n int;
begin
  select count(*) into v_n from storage.buckets where id = 'fms-ocpi-service-checklists';
  if v_n <> 1 then raise exception 'checklist bucket missing'; end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'fms ocpi checklists %';
  if v_n <> 4 then raise exception 'checklist storage policies: % of 4 present', v_n; end if;
end $check$;

commit;
