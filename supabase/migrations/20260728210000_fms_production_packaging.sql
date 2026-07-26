-- ===========================================================================
-- PRODUCTION ENTRY FMS — PACKAGING ITEM MASTER + reworked PM HANDOVER.
--
-- The packing-material handover now captures the FG packed quantity plus a
-- multi-line list of PACKAGING ITEMS (each with its own unit, carried from a new
-- packaging-item master) and their quantities — mirroring the raw-material BOM on
-- the issue slip / handover.
--
-- Additive:
--   * new master table fms_production_packaging_items (name + unit_id)
--   * 'packaging_item' added to the master governance CHECK constraints + resolve RPC
--   * pmh_bom_lines jsonb on fms_production_requests (the packaging lines)
--   * record/update pm_handover rewritten to store pmh_qty + pmh_bom_lines
-- pmh_status / pmh_batch_no are kept (unused) for reversibility.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Packaging-item master (name + own unit, like raw materials).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_production_packaging_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  unit_id     uuid references public.fms_production_units on delete set null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_production_packaging_items is 'Packaging-item master for Production Entry FMS (carton, label, …); each carries its own unit.';

drop trigger if exists trg_fms_production_packaging_items_updated on public.fms_production_packaging_items;
create trigger trg_fms_production_packaging_items_updated
  before update on public.fms_production_packaging_items for each row execute function public.set_updated_at();

alter table public.fms_production_packaging_items enable row level security;

drop policy if exists fms_production_packaging_items_select on public.fms_production_packaging_items;
create policy fms_production_packaging_items_select on public.fms_production_packaging_items
  for select to authenticated using (true);

drop policy if exists fms_production_packaging_items_write on public.fms_production_packaging_items;
create policy fms_production_packaging_items_write on public.fms_production_packaging_items
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('packaging_item', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_production_is_master_manager('packaging_item', auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Widen master-governance CHECK constraints to allow 'packaging_item'.
-- ---------------------------------------------------------------------------
alter table public.fms_production_master_managers drop constraint if exists fms_production_master_managers_master_type_check;
alter table public.fms_production_master_managers add constraint fms_production_master_managers_master_type_check
  check (master_type in ('category','raw_material','fg_item','unit','packaging_item'));

alter table public.fms_production_master_requests drop constraint if exists fms_production_master_requests_master_type_check;
alter table public.fms_production_master_requests add constraint fms_production_master_requests_master_type_check
  check (master_type in ('category','raw_material','fg_item','unit','packaging_item'));

-- ---------------------------------------------------------------------------
-- 3. Resolve-master-request: create a packaging item (name + optional unit).
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_production_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_production_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    if v_type = 'category' then
      insert into public.fms_production_categories (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'raw_material' then
      insert into public.fms_production_raw_materials (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'fg_item' then
      insert into public.fms_production_fg_items (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'unit' then
      insert into public.fms_production_units (name, created_by)
      values (nullif(trim(v_payload->>'name'),''), auth.uid()) returning id into v_new_id;
    elsif v_type = 'packaging_item' then
      insert into public.fms_production_packaging_items (name, unit_id, created_by)
      values (nullif(trim(v_payload->>'name'),''), nullif(v_payload->>'unit_id','')::uuid, auth.uid()) returning id into v_new_id;
    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_production_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_production_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;
grant execute on function public.fms_production_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. pmh_bom_lines jsonb (the packaging lines) on the request.
-- ---------------------------------------------------------------------------
alter table public.fms_production_requests add column if not exists pmh_bom_lines jsonb not null default '[]'::jsonb;
alter table public.fms_production_requests drop constraint if exists fms_production_requests_pmh_bom_lines_is_array;
alter table public.fms_production_requests add constraint fms_production_requests_pmh_bom_lines_is_array
  check (jsonb_typeof(pmh_bom_lines) = 'array');

comment on column public.fms_production_requests.pmh_bom_lines is
  'Packing-material handover lines: array of {packaging_item_id, unit_id, qty}. pmh_qty is the FG packed quantity.';

-- ---------------------------------------------------------------------------
-- 5. Record / update PM handover: FG packed qty + packaging lines.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_record_pm_handover(uuid, jsonb);
create or replace function public.fms_production_record_pm_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_pm_handover' then raise exception 'This job card is not awaiting packing-material handover (status %)', v_status; end if;
  if not public.fms_production_can_act('pm_handover', p_req, v_uid) then raise exception 'Not authorized to record packing-material handover'; end if;

  v_lines := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'pmh_bom_lines must be an array'; end if;

  update public.fms_production_requests set
    pmh_actual_date = coalesce(nullif(p->>'pmh_actual_date','')::date, current_date),
    pmh_qty         = nullif(p->>'pmh_qty','')::numeric,
    pmh_bom_lines   = v_lines,
    pmh_remarks     = nullif(trim(p->>'pmh_remarks'), ''),
    pmh_at = coalesce(pmh_at, now()), pmh_by = coalesce(pmh_by, v_uid),
    status = 'awaiting_pm_transfer', current_step = 'pm_transfer'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_handover',
    'Packing material handed over for ' || coalesce(v_no,'a job card') || ' — ready for packing-material transfer.',
    public.fms_production_step_owner_ids('pm_transfer'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_pm_handover(uuid, jsonb) to authenticated;

create or replace function public.fms_production_update_pm_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('pm_handover', p_req, v_uid) then raise exception 'Not authorized to edit the packing-material handover'; end if;
  if not public.fms_production_pmh_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing-material handover can no longer be edited: the transfer has already been recorded (status %).', v_status;
  end if;

  v_lines := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'pmh_bom_lines must be an array'; end if;

  update public.fms_production_requests set
    pmh_actual_date = coalesce(nullif(p->>'pmh_actual_date','')::date, pmh_actual_date),
    pmh_qty         = nullif(p->>'pmh_qty','')::numeric,
    pmh_bom_lines   = v_lines,
    pmh_remarks     = nullif(trim(p->>'pmh_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_handover_edited',
    format('Packing-material handover on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_pm_handover(uuid, jsonb) to authenticated;
