-- Rollback for 20270131120000_fms_ocpi_service_checklists.sql
begin;
drop policy if exists "fms ocpi checklists read"   on storage.objects;
drop policy if exists "fms ocpi checklists insert" on storage.objects;
drop policy if exists "fms ocpi checklists update" on storage.objects;
drop policy if exists "fms ocpi checklists delete" on storage.objects;
-- Empty the bucket first via the Storage API/dashboard: direct deletes from storage.objects are blocked.
delete from storage.buckets where id = 'fms-ocpi-service-checklists';
drop table if exists public.fms_ocpi_service_checklists;
-- Restore the Service Check save from 20270119120000 (checkpoints master).
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

commit;
