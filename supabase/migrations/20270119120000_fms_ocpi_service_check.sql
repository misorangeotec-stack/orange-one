-- ===========================================================================
-- OCPI · Service Check — a parallel bucket for the service team.
--
-- When management countersigns, the deal goes to "Hand Over to Finance" exactly
-- as before AND, at the same moment, opens a Service Check for the service
-- team. The two are independent: Finance closing the deal does not wait for
-- Service, and Service is never blocked by Finance.
--
-- The service team records: installation date, service engineer, customer site
-- contact (name + phone), and ticks "Site is ready for installation" plus every
-- active check point in the new master fms_ocpi_service_checkpoints. All boxes
-- must be ticked to submit.
--
-- ⚠ fms_ocpi_record_management_sign IS NOT TOUCHED. The service check is opened
--   by a trigger on the status move awaiting_management_sign →
--   awaiting_finance_handover, so the countersign RPC — whatever body is live —
--   keeps working unchanged.
--
-- ⚠ DEAL STATUS IS NOT TOUCHED. The service check lives in its own svc_*
--   columns; `status` still walks the Finance chain alone.
--
-- In-flight deals (countersigned, Finance not yet done) are opened for Service
-- by the backfill below, dated from their countersignature. Closed deals are not.
--
-- Rollback (in one transaction):
--   drop trigger if exists trg_fms_ocpi_service_open on public.fms_ocpi_deals;
--   drop trigger if exists trg_fms_ocpi_service_announce on public.fms_ocpi_deals;
--   drop function if exists public.fms_ocpi_service_open();
--   drop function if exists public.fms_ocpi_service_announce();
--   drop function if exists public.fms_ocpi_record_service_check(uuid, jsonb);
--   drop table if exists public.fms_ocpi_service_checkpoints;
--   alter table public.fms_ocpi_deals
--     drop column if exists svc_opened_at, drop column if exists svc_at,
--     drop column if exists svc_by, drop column if exists svc_installation_date,
--     drop column if exists svc_engineer, drop column if exists svc_site_contact_name,
--     drop column if exists svc_site_contact_phone, drop column if exists svc_site_ready,
--     drop column if exists svc_site_remark, drop column if exists svc_checks,
--     drop column if exists svc_note;
--   drop policy if exists fms_ocpi_deals_not_service_only on public.fms_ocpi_deals;
--   drop policy if exists fms_ocpi_activity_not_service_only on public.fms_ocpi_activity;
--   drop policy if exists "fms ocpi docs not service only" on storage.objects;
--   drop function if exists public.fms_ocpi_service_deals();
--   drop function if exists public.fms_ocpi_is_service_only(uuid);
-- ===========================================================================

begin;

-- ── 1 · The master: check points the service team answers on every deal ────
create table if not exists public.fms_ocpi_service_checkpoints (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fms_ocpi_service_checkpoints is
  'Check points the service team must tick on every deal''s Service Check. Edited on Masters → Service check points by admins and the Machine master owner. A deal stores the check point NAME with its answer, so renaming or deactivating a row never rewrites a finished check.';

drop trigger if exists trg_fms_ocpi_service_checkpoints_updated on public.fms_ocpi_service_checkpoints;
create trigger trg_fms_ocpi_service_checkpoints_updated
  before update on public.fms_ocpi_service_checkpoints
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_service_checkpoints enable row level security;

drop policy if exists fms_ocpi_service_checkpoints_select on public.fms_ocpi_service_checkpoints;
create policy fms_ocpi_service_checkpoints_select on public.fms_ocpi_service_checkpoints
  for select to authenticated using (true);

-- Same owner as the Machine categories tab: admins + the Machine master owner.
drop policy if exists fms_ocpi_service_checkpoints_write on public.fms_ocpi_service_checkpoints;
create policy fms_ocpi_service_checkpoints_write on public.fms_ocpi_service_checkpoints
  for all to authenticated
  using ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid()))))
  with check ((select public.is_admin((select auth.uid())))
         or (select public.fms_ocpi_is_master_manager('machine', (select auth.uid()))));

-- ── 2 · The deal's service columns ─────────────────────────────────────────
alter table public.fms_ocpi_deals
  add column if not exists svc_opened_at          timestamptz,
  add column if not exists svc_at                 timestamptz,
  add column if not exists svc_by                 uuid references auth.users on delete set null,
  add column if not exists svc_installation_date  date,
  add column if not exists svc_engineer           text,
  add column if not exists svc_site_contact_name  text,
  add column if not exists svc_site_contact_phone text,
  add column if not exists svc_site_ready         boolean,
  add column if not exists svc_site_remark        text,
  add column if not exists svc_checks             jsonb not null default '[]'::jsonb,
  add column if not exists svc_note               text;

comment on column public.fms_ocpi_deals.svc_opened_at is
  'When the Service Check opened — the moment management countersigned. Null = never sent to Service. Runs in parallel with the Finance chain; status is not involved.';
comment on column public.fms_ocpi_deals.svc_at is
  'When the service team completed the Service Check. Null while it is open.';
comment on column public.fms_ocpi_deals.svc_checks is
  'The check-point answers: [{name, ok, remark}]. The NAME is stored, not the master id, so the finished check reads the same after the master changes.';

-- ── 3 · Backfill in-flight deals BEFORE the triggers exist ─────────────────
--   (so the backfill does not fire a notification per old deal)
update public.fms_ocpi_deals
   set svc_opened_at = coalesce(ms_at, now())
 where svc_opened_at is null
   and status in ('awaiting_finance_handover', 'awaiting_finance_receipt');

-- ── 4 · Open the Service Check when management countersigns ────────────────
create or replace function public.fms_ocpi_service_open()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.svc_opened_at is null
     and old.status = 'awaiting_management_sign'
     and new.status = 'awaiting_finance_handover' then
    new.svc_opened_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists trg_fms_ocpi_service_open on public.fms_ocpi_deals;
create trigger trg_fms_ocpi_service_open
  before update of status on public.fms_ocpi_deals
  for each row execute function public.fms_ocpi_service_open();

create or replace function public.fms_ocpi_service_announce()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.svc_opened_at is null and new.svc_opened_at is not null then
    perform public.fms_ocpi_announce(
      'deal', new.id, 'service_check_opened',
      coalesce(new.oc_no, new.quotation_no, 'A deal') || ' has been countersigned'
        || coalesce(' — ' || new.customer_name, '')
        || '. The service team has to complete the Service Check.',
      coalesce(public.fms_ocpi_step_owner_ids('service_check'), '{}'::uuid[]),
      jsonb_build_object('oc_no', new.oc_no));
  end if;
  return null;
end $fn$;

drop trigger if exists trg_fms_ocpi_service_announce on public.fms_ocpi_deals;
-- ⚠ NOT `after update OF svc_opened_at`: a column-list trigger only fires when
--   the column is in the UPDATE's SET list, and here it is set by the BEFORE
--   trigger above, which Postgres does not count.
create trigger trg_fms_ocpi_service_announce
  after update on public.fms_ocpi_deals
  for each row
  when (old.svc_opened_at is null and new.svc_opened_at is not null)
  execute function public.fms_ocpi_service_announce();

-- ── 5 · The service team records the check ─────────────────────────────────
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

  select status, raised_by, coalesce(oc_no, quotation_no), svc_opened_at, svc_at
    into v_status, v_owner, v_ref, v_opened, v_done
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
    -- Every ACTIVE check point must be ticked.
    select c.name
      from public.fms_ocpi_service_checkpoints c
      left join lateral (
        select el as elem from jsonb_array_elements(v_checks) el
         where el->>'name' = c.name limit 1
      ) e on true
     where c.active
       and (e.elem is null
            or jsonb_typeof(e.elem->'ok') <> 'boolean'
            or (e.elem->>'ok')::boolean is not true)
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

-- ── 6 · SERVICE-ONLY USERS SEE NO MONEY AND NO PAPERS ──────────────────────
--
-- A "service-only" user owns the Service Check step and nothing else in OCPI:
-- not admin, not a process coordinator, not a module viewer, owner of no other
-- step, and has raised no deal. For them:
--   · fms_ocpi_deals rows are hidden (RESTRICTIVE policy — the existing
--     permissive policies are not touched), and so are quotation versions,
--     whose policy reads through the deals policy;
--   · every file in the fms-ocpi-docs bucket is hidden (OC, PI, summary,
--     signed scans);
--   · the activity log is hidden;
--   · they read ONLY customer + machine fields, through
--     fms_ocpi_service_deals() below.
-- Everyone else is unaffected: the restrictive policies are TRUE for them.

create or replace function public.fms_ocpi_is_service_only(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_uid is not null
     and exists (select 1 from public.fms_ocpi_step_owners o
                  where o.step_key = 'service_check' and p_uid = any(o.employee_ids))
     and not exists (select 1 from public.fms_ocpi_step_owners o
                      where o.step_key <> 'service_check' and p_uid = any(o.employee_ids))
     and not public.is_admin(p_uid)
     and not public.fms_ocpi_is_coordinator(p_uid)
     and not public.module_is_viewer(p_uid, 'ocpi')
     and not exists (select 1 from public.fms_ocpi_deals d where d.raised_by = p_uid);
$fn$;

comment on function public.fms_ocpi_is_service_only(uuid) is
  'True for a user whose ONLY OCPI role is the Service Check step. Such a user may not read deals, quotation versions, OCPI documents or the activity log; they read customer + machine fields through fms_ocpi_service_deals().';
grant execute on function public.fms_ocpi_is_service_only(uuid) to authenticated;

drop policy if exists fms_ocpi_deals_not_service_only on public.fms_ocpi_deals;
create policy fms_ocpi_deals_not_service_only on public.fms_ocpi_deals
  as restrictive for select to authenticated
  using (not (select public.fms_ocpi_is_service_only((select auth.uid()))));

drop policy if exists fms_ocpi_activity_not_service_only on public.fms_ocpi_activity;
create policy fms_ocpi_activity_not_service_only on public.fms_ocpi_activity
  as restrictive for select to authenticated
  using (not (select public.fms_ocpi_is_service_only((select auth.uid()))));

-- Scoped to the OCPI bucket: every other bucket passes the first conjunct.
drop policy if exists "fms ocpi docs not service only" on storage.objects;
create policy "fms ocpi docs not service only" on storage.objects
  as restrictive for select to authenticated
  using (bucket_id <> 'fms-ocpi-docs'
         or not (select public.fms_ocpi_is_service_only((select auth.uid()))));

-- What the service team reads instead: customer + machine + service fields.
-- ⚠ NO deal value, rates, payment or commercial terms, FX, or document paths.
create or replace function public.fms_ocpi_service_deals()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
           'id', d.id, 'status', d.status, 'created_at', d.created_at, 'updated_at', d.updated_at,
           'quotation_no', d.quotation_no, 'oc_no', d.oc_no, 'oc_at', d.oc_at, 'ms_at', d.ms_at,
           'raised_by', d.raised_by, 'salesperson_name', d.salesperson_name,
           'customer_id', d.customer_id, 'customer_name', d.customer_name,
           'customer_address', d.customer_address, 'customer_attn', d.customer_attn,
           'customer_email', d.customer_email, 'customer_mobile', d.customer_mobile,
           'gst_no', d.gst_no,
           'machine_id', d.machine_id, 'machine_count', d.machine_count,
           'machine_category_id', d.machine_category_id,
           'head_type', d.head_type, 'head_count', d.head_count, 'ink_type', d.ink_type,
           'dryer_type', d.dryer_type, 'dryer_name', d.dryer_name,
           'incl_centering', d.incl_centering, 'centering_details', d.centering_details,
           'air_blade', d.air_blade, 'ink_dust_exhauster', d.ink_dust_exhauster,
           'chilling_system', d.chilling_system,
           'incl_ink', d.incl_ink, 'ink_qty_included', d.ink_qty_included,
           'incl_spares', d.incl_spares, 'spare_details', d.spare_details,
           'incl_head', d.incl_head, 'heads_included', d.heads_included,
           'delivery_date', d.delivery_date,
           'svc_opened_at', d.svc_opened_at, 'svc_at', d.svc_at, 'svc_by', d.svc_by,
           'svc_installation_date', d.svc_installation_date, 'svc_engineer', d.svc_engineer,
           'svc_site_contact_name', d.svc_site_contact_name,
           'svc_site_contact_phone', d.svc_site_contact_phone,
           'svc_site_ready', d.svc_site_ready, 'svc_site_remark', d.svc_site_remark,
           'svc_checks', d.svc_checks, 'svc_note', d.svc_note)
    from public.fms_ocpi_deals d
   where d.svc_opened_at is not null
     and public.fms_ocpi_can_act('service_check', d.id, auth.uid());
$fn$;

comment on function public.fms_ocpi_service_deals() is
  'The Service Check queue for the service team: customer, machine and service fields only — never value, terms, rates or document paths.';
grant execute on function public.fms_ocpi_service_deals() to authenticated;

-- ── 7 · Assert ─────────────────────────────────────────────────────────────
do $check$
declare v_n int;
begin
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.fms_ocpi_deals'::regclass
     and tgname in ('trg_fms_ocpi_service_open', 'trg_fms_ocpi_service_announce');
  if v_n <> 2 then raise exception 'service triggers missing (%)', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_deals
   where status in ('awaiting_finance_handover', 'awaiting_finance_receipt')
     and svc_opened_at is null;
  if v_n <> 0 then raise exception '% in-flight deal(s) were not opened for Service', v_n; end if;

  select count(*) into v_n from pg_policies
   where policyname in ('fms_ocpi_deals_not_service_only', 'fms_ocpi_activity_not_service_only',
                        'fms ocpi docs not service only')
     and permissive = 'RESTRICTIVE';
  if v_n <> 3 then raise exception 'service-only lock: % of 3 restrictive policies present', v_n; end if;

  -- Nobody may be service-only by accident on day one: no one owns the step yet.
  select count(*) into v_n from public.fms_ocpi_step_owners
   where step_key = 'service_check' and array_length(employee_ids, 1) > 0;
  if v_n <> 0 then raise exception 'service_check already has owners — review before locking'; end if;
end $check$;

commit;
