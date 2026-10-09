-- ===========================================================================
-- Save as draft, for every FMS raise form.
--
-- WHAT. One shared table of half-filled raise forms (a purchase request, a
-- sales order, a complaint ...), plus a private bucket holding the files that
-- were attached to them. A draft is a parked FORM, not a request: it has no
-- number, no step and no owner in the workflow, and nothing in any FMS queue,
-- report or count ever reads this table. Submitting runs the app's normal
-- submit RPC with the form's contents and then deletes the draft.
--
-- WHY NOT a status='draft' row in each app's request table, as Production,
-- Travel and OCPI do? Ten apps would each need a status value, three RPCs and
-- an RLS change on a live queue table, and every list in those apps would need
-- to learn to hide drafts. Here no existing table, policy or RPC changes.
--
-- WHO SEES A DRAFT. The person who saved it, admins, and anyone an admin has
-- granted the 'all-drafts' app (Admin -> Module Access) - that app is the one
-- "All Drafts" page in the Control group, and its grant is READ-ONLY here.
-- Nobody else: not the step owners, not the HOD, not a module viewer. Only the
-- owner may change a draft; the owner or an admin may delete it.
--
-- FILES. Bucket 'fms-drafts', path '<owner uuid>/<draft uuid>/<file>'. The
-- first folder IS the owner, which is what the storage policies test. On
-- Continue the files are downloaded back into the form as ordinary picked
-- files, so each app's own upload path runs unchanged at submit.
--
-- Additive only: one new table, one new bucket, policies with names unique to
-- this module. Rollback: 20270103120000_add_fms_drafts_rollback.sql.
-- ===========================================================================

begin;

create table if not exists public.fms_drafts (
  id          uuid primary key default gen_random_uuid(),
  -- Which raise form this belongs to, e.g. 'procurement:request'.
  app_key     text not null,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- One line for the drafts list: "Orange O Tec - 3 items".
  title       text not null default '',
  -- Plain-language lines ("Ink XYZ - 5 kg") so All Drafts can show what a
  -- draft holds without knowing each form's payload.
  summary     jsonb not null default '[]'::jsonb,
  -- The form's own fields, exactly as the form wants them back. Opaque here.
  payload     jsonb not null default '{}'::jsonb,
  -- [{path, name, mime_type, size_bytes}] in bucket 'fms-drafts'.
  files       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.fms_drafts is
  'Save-as-draft for FMS raise forms. Owner + admins only. Never read by any queue or report.';

create index if not exists fms_drafts_owner_app_idx
  on public.fms_drafts (owner_id, app_key, updated_at desc);

create or replace function public.fms_drafts_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- The owner never changes, whatever the client sends.
  new.owner_id := old.owner_id;
  return new;
end;
$$;

drop trigger if exists fms_drafts_touch on public.fms_drafts;
create trigger fms_drafts_touch
  before update on public.fms_drafts
  for each row execute function public.fms_drafts_touch();

alter table public.fms_drafts enable row level security;

drop policy if exists fms_drafts_select on public.fms_drafts;
create policy fms_drafts_select
  on public.fms_drafts for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select public.is_admin((select auth.uid())))
    or (select public.module_level((select auth.uid()), 'all-drafts')) <> 'none'
  );

drop policy if exists fms_drafts_insert on public.fms_drafts;
create policy fms_drafts_insert
  on public.fms_drafts for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists fms_drafts_update on public.fms_drafts;
create policy fms_drafts_update
  on public.fms_drafts for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists fms_drafts_delete on public.fms_drafts;
create policy fms_drafts_delete
  on public.fms_drafts for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or (select public.is_admin((select auth.uid())))
  );

grant select, insert, update, delete on public.fms_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- Files. Policy names are GLOBAL on storage.objects - these are unique to
-- this module, so another module's `drop policy if exists` can't remove them.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fms-drafts', 'fms-drafts', false)
on conflict (id) do nothing;

drop policy if exists "fms drafts files read"   on storage.objects;
drop policy if exists "fms drafts files insert" on storage.objects;
drop policy if exists "fms drafts files update" on storage.objects;
drop policy if exists "fms drafts files delete" on storage.objects;

create policy "fms drafts files read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-drafts'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.is_admin((select auth.uid())))
         or (select public.module_level((select auth.uid()), 'all-drafts')) <> 'none')
  );

create policy "fms drafts files insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-drafts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "fms drafts files update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fms-drafts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'fms-drafts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "fms drafts files delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fms-drafts'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.is_admin((select auth.uid()))))
  );

commit;
