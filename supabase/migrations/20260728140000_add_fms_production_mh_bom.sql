-- ===========================================================================
-- PRODUCTION ENTRY FMS — PER-RAW-MATERIAL HANDOVER (actual qty + issue lot no).
--
-- The material-handover step captured a single quantity. A job card hands over
-- MANY raw materials (its BOM), so the handover now captures, per raw material,
-- the ACTUAL quantity handed over and its ISSUE LOT NUMBER — pre-filled from the
-- issue slip's bom_lines and editable by the person confirming the handover.
--
-- Stored as an additive jsonb array `mh_bom_lines` on the card row (same one-
-- entity-per-card shape as issue-slip bom_lines). Each element:
--   { "raw_material_id", "unit_id", "qty", "lot_no" }.
-- The legacy single `mh_qty` column is kept and set to the SUM of the line
-- quantities, so the detail/stage views still show a handover quantity.
--
-- Purely ADDITIVE. Reversal:
--   alter table public.fms_production_requests drop column if exists mh_bom_lines;
-- (and restore the two handover RPC bodies from
--  20260725120100 / 20260725120200.)
-- ===========================================================================

alter table public.fms_production_requests
  add column if not exists mh_bom_lines jsonb not null default '[]'::jsonb;

alter table public.fms_production_requests
  drop constraint if exists fms_production_requests_mh_bom_lines_is_array;
alter table public.fms_production_requests
  add constraint fms_production_requests_mh_bom_lines_is_array
  check (jsonb_typeof(mh_bom_lines) = 'array');

comment on column public.fms_production_requests.mh_bom_lines is
  'Material-handover BOM: JSON array of {raw_material_id, unit_id, qty, lot_no} — the ACTUAL quantity handed over and issue lot number per raw material, pre-filled from the issue-slip bom_lines. mh_qty mirrors the sum of these quantities. Empty [] for legacy handovers (which used the single mh_qty).';

-- Sum the "qty" of a mh_bom_lines array (null when empty), for the legacy mh_qty mirror.
create or replace function public.fms_production_mh_lines_sum(p_lines jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  select sum(nullif(trim(l->>'qty'), '')::numeric)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
$$;

-- ---------------------------------------------------------------------------
-- RECORD (step 2 → 3): now stores mh_bom_lines; mh_qty = sum of the lines, or the
-- flat mh_qty for a legacy no-BOM handover. Actual date still auto-stamps today.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_record_material_handover(uuid, jsonb);
create or replace function public.fms_production_record_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb := coalesce(p->'mh_bom_lines', '[]'::jsonb); v_sum numeric;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_material_handover' then raise exception 'This job card is not awaiting material handover (status %)', v_status; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then raise exception 'Not authorized to record material handover'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'mh_bom_lines must be a JSON array'; end if;

  v_sum := public.fms_production_mh_lines_sum(v_lines);

  update public.fms_production_requests set
    mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, current_date),
    mh_status      = nullif(trim(p->>'mh_status'), ''),
    mh_bom_lines   = v_lines,
    mh_qty         = coalesce(v_sum, nullif(p->>'mh_qty','')::numeric),
    rm_book_no     = nullif(trim(p->>'rm_book_no'), ''),
    mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
    mh_at = coalesce(mh_at, now()), mh_by = coalesce(mh_by, v_uid),
    status = 'awaiting_transfer_slip', current_step = 'transfer_slip'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'material_handover',
    'Material handover confirmed for ' || coalesce(v_no,'a job card') || ' — ready for transfer slip & batch card.',
    public.fms_production_step_owner_ids('transfer_slip'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_material_handover(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE (correct until the next step): same mh_bom_lines + mh_qty handling.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_update_material_handover(uuid, jsonb);
create or replace function public.fms_production_update_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb := coalesce(p->'mh_bom_lines', '[]'::jsonb); v_sum numeric;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then raise exception 'Not authorized to edit the material handover'; end if;
  if not public.fms_production_mh_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The material handover can no longer be edited: the next step has already been recorded (status %).', v_status;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'mh_bom_lines must be a JSON array'; end if;

  v_sum := public.fms_production_mh_lines_sum(v_lines);

  update public.fms_production_requests set
    mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, mh_actual_date),
    mh_status      = nullif(trim(p->>'mh_status'), ''),
    mh_bom_lines   = v_lines,
    mh_qty         = coalesce(v_sum, nullif(p->>'mh_qty','')::numeric),
    rm_book_no     = nullif(trim(p->>'rm_book_no'), ''),
    mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'material_handover_edited',
    format('Material handover on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_material_handover(uuid, jsonb) to authenticated;
