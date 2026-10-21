-- ===========================================================================
-- OCPI · Service checklist PDF, one per machine — and the PDF IS the checklist.
--
-- The check points the service team answers on a deal now come from the
-- machine's checklist PDF: when the PDF is uploaded, the app reads its text and
-- stores one check point per Sr. No row (or per line) in `items`. On the Service
-- Check every point is marked READY or NOT READY, as on the PDF. The manual master
-- fms_ocpi_service_checkpoints is no longer consulted (the table is kept, so
-- nothing is lost; its Masters tab is hidden).
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
--   see the _rollback.sql file (it also restores fms_ocpi_record_service_check), or:
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
  items       jsonb not null default '[]'::jsonb,
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

comment on column public.fms_ocpi_service_checklists.items is
  'The check points read from the PDF, one string per line, in order: ["Power supply 3-phase ready", ...]. These are the boxes on the Service Check for every deal of this machine.';

-- ── 3 · The Service Check answers the machine's PDF points ─────────────────
-- Same as 20270119120000 except the "every check point" rule: instead of every
-- active row of fms_ocpi_service_checkpoints, every point of the deal machine's
-- checklist must be answered (Ready = ok true, Not Ready = ok false, remark optional).
create or replace function public.fms_ocpi_record_service_check(p_deal uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_owner    uuid;
  v_ref      text;
  v_opened   timestamptz;
  v_done     timestamptz;
  v_machine  uuid;
  v_date     date;
  v_engineer text := nullif(btrim(coalesce(p->>'engineer', '')), '');
  v_cname    text := nullif(btrim(coalesce(p->>'site_contact_name', '')), '');
  v_cphone   text := nullif(btrim(coalesce(p->>'site_contact_phone', '')), '');
  v_ready    boolean;
  v_remark   text := nullif(btrim(coalesce(p->>'site_remark', '')), '');
  v_note     text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_checks   jsonb := coalesce(p->'checks', '[]'::jsonb);
  v_missing  text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, coalesce(oc_no, quotation_no), svc_opened_at, svc_at, machine_id
    into v_status, v_owner, v_ref, v_opened, v_done, v_machine
    from public.fms_ocpi_deals where id = p_deal for update;
  if v_status is null then raise exception 'Deal not found'; end if;
  if v_opened is null then raise exception 'This deal has not been sent to the service team'; end if;
  if v_done is not null then raise exception 'The Service Check on this deal is already complete'; end if;
  if v_status in ('cancelled', 'rejected', 'on_hold') then
    raise exception 'This deal is %, so there is no Service Check to complete', v_status;
  end if;

  if not public.fms_ocpi_can_act('service_check', p_deal, v_uid) then
    raise exception 'You are not on the service team for this step';
  end if;

  begin
    v_date := nullif(btrim(coalesce(p->>'installation_date', '')), '')::date;
  exception when others then
    raise exception 'Installation date is not a valid date';
  end;
  if jsonb_typeof(p->'site_ready') = 'boolean' then
    v_ready := (p->>'site_ready')::boolean;
  end if;
  if jsonb_typeof(v_checks) <> 'array' then
    raise exception 'Check points must be a list';
  end if;

  select string_agg(x, ', ') into v_missing from (
    select unnest(array[
      case when v_date is null     then 'Installation date' end,
      case when v_engineer is null then 'Service engineer' end,
      case when v_cname is null    then 'Customer site contact name' end,
      case when v_cphone is null   then 'Customer site contact phone' end,
      case when v_ready is not true then 'Site is ready for installation' end
    ]) as x
    union all
    -- Every point of the machine's checklist PDF must be marked Ready or Not
    -- Ready (the remark on a Not Ready point is optional).
    select case
             when e.elem is null or jsonb_typeof(e.elem->'ok') <> 'boolean'
               then i.item
           end
      from public.fms_ocpi_service_checklists c
      cross join lateral jsonb_array_elements_text(c.items) as i(item)
      left join lateral (
        select el as elem from jsonb_array_elements(v_checks) el
         where el->>'name' = i.item limit 1
      ) e on true
     where c.machine_id = v_machine
  ) t where x is not null;

  if v_missing is not null then
    raise exception 'Still needed before the Service Check can be completed: %', v_missing;
  end if;

  update public.fms_ocpi_deals
     set svc_installation_date  = v_date,
         svc_engineer           = v_engineer,
         svc_site_contact_name  = v_cname,
         svc_site_contact_phone = v_cphone,
         svc_site_ready         = v_ready,
         svc_site_remark        = v_remark,
         svc_checks             = (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'name',   el->>'name',
                    'ok',     (el->>'ok')::boolean,
                    'remark', nullif(btrim(coalesce(el->>'remark', '')), ''))), '[]'::jsonb)
             from jsonb_array_elements(v_checks) el
            where jsonb_typeof(el->'ok') = 'boolean'),
         svc_note               = v_note,
         svc_at                 = now(),
         svc_by                 = v_uid
   where id = p_deal;

  perform public.fms_ocpi_announce(
    'deal', p_deal, 'service_check_done',
    coalesce(v_ref, 'The deal') || ' — the service team completed the Service Check'
      || ' (installation ' || to_char(v_date, 'DD-Mon-YYYY') || ', engineer ' || v_engineer || ')',
    case when v_owner is null then '{}'::uuid[] else array[v_owner] end,
    jsonb_build_object('installation_date', v_date, 'engineer', v_engineer, 'site_ready', v_ready));
end $function$;

grant execute on function public.fms_ocpi_record_service_check(uuid, jsonb) to authenticated;

-- ── 4 · Assert ─────────────────────────────────────────────────────────────
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
