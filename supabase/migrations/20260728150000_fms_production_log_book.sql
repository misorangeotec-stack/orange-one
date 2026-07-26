-- ===========================================================================
-- PRODUCTION ENTRY FMS — STEP 3 IS NOW "LOG BOOK ENTRY".
--
-- The step formerly called "Transfer Slip & Batch Card" becomes the LOG BOOK
-- ENTRY. The step KEY (transfer_slip) and all ts_* columns are unchanged — only
-- the meaning/UI evolves. It now captures, per raw material, the ACTUAL USE
-- alongside the (locked) requested + handover quantities carried from earlier
-- steps, allows adding NEW items (a master pick or free text) with their own lot
-- number, and requires a mandatory attachment.
--
-- Additive: a jsonb `ts_bom_lines` array + two attachment columns. Each line:
--   { raw_material_id, raw_material_name, unit_id, requested_qty, handover_qty,
--     actual_use, lot_no, is_new }.
-- Reversal: drop the three columns and restore the two transfer_slip RPC bodies.
-- ===========================================================================

alter table public.fms_production_requests
  add column if not exists ts_bom_lines jsonb not null default '[]'::jsonb;
alter table public.fms_production_requests
  drop constraint if exists fms_production_requests_ts_bom_lines_is_array;
alter table public.fms_production_requests
  add constraint fms_production_requests_ts_bom_lines_is_array
  check (jsonb_typeof(ts_bom_lines) = 'array');

alter table public.fms_production_requests add column if not exists ts_attachment_path text;
alter table public.fms_production_requests add column if not exists ts_attachment_name text;

comment on column public.fms_production_requests.ts_bom_lines is
  'Log Book Entry (step 3) BOM: array of {raw_material_id, raw_material_name, unit_id, requested_qty, handover_qty, actual_use, lot_no, is_new}. Existing items carry the locked requested/handover/lot from earlier steps with an editable actual_use; is_new items are added here (master pick or free text) with their own lot number.';

-- ---------------------------------------------------------------------------
-- RECORD (step 3 → 4): store the log-book BOM + mandatory attachment.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_record_transfer_slip(uuid, jsonb);
create or replace function public.fms_production_record_transfer_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb := coalesce(p->'ts_bom_lines', '[]'::jsonb);
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_transfer_slip' then raise exception 'This job card is not awaiting the log book entry (status %)', v_status; end if;
  if not public.fms_production_can_act('transfer_slip', p_req, v_uid) then raise exception 'Not authorized to record the log book entry'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'ts_bom_lines must be a JSON array'; end if;
  if coalesce(nullif(trim(p->>'ts_attachment_path'), ''), '') = '' then raise exception 'An attachment is required for the log book entry'; end if;

  update public.fms_production_requests set
    ts_actual_date   = coalesce(nullif(p->>'ts_actual_date','')::date, current_date),
    ts_status        = nullif(trim(p->>'ts_status'), ''),
    transfer_slip_no = nullif(trim(p->>'transfer_slip_no'), ''),
    batch_card_no    = nullif(trim(p->>'batch_card_no'), ''),
    ts_bom_lines     = v_lines,
    ts_attachment_path = nullif(trim(p->>'ts_attachment_path'), ''),
    ts_attachment_name = nullif(trim(p->>'ts_attachment_name'), ''),
    ts_remarks       = nullif(trim(p->>'ts_remarks'), ''),
    ts_at = coalesce(ts_at, now()), ts_by = coalesce(ts_by, v_uid),
    status = 'awaiting_production', current_step = 'production_entry'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'transfer_slip',
    'Log book entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for production entry.',
    public.fms_production_step_owner_ids('production_entry'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_transfer_slip(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE (correct until production entry): same, attachment kept when omitted.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_update_transfer_slip(uuid, jsonb);
create or replace function public.fms_production_update_transfer_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb := coalesce(p->'ts_bom_lines', '[]'::jsonb);
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('transfer_slip', p_req, v_uid) then raise exception 'Not authorized to edit the log book entry'; end if;
  if not public.fms_production_ts_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The log book entry can no longer be edited: production entry has already been recorded (status %).', v_status;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'ts_bom_lines must be a JSON array'; end if;

  update public.fms_production_requests set
    ts_actual_date   = coalesce(nullif(p->>'ts_actual_date','')::date, ts_actual_date),
    ts_status        = nullif(trim(p->>'ts_status'), ''),
    transfer_slip_no = nullif(trim(p->>'transfer_slip_no'), ''),
    batch_card_no    = nullif(trim(p->>'batch_card_no'), ''),
    ts_bom_lines     = v_lines,
    -- attachment: replace when the key is present, keep the current file otherwise.
    ts_attachment_path = case when p ? 'ts_attachment_path' then nullif(trim(p->>'ts_attachment_path'), '') else ts_attachment_path end,
    ts_attachment_name = case when p ? 'ts_attachment_name' then nullif(trim(p->>'ts_attachment_name'), '') else ts_attachment_name end,
    ts_remarks       = nullif(trim(p->>'ts_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'transfer_slip_edited',
    format('Log book entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_transfer_slip(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Handover announce text follows the rename ("… ready for log book entry.").
-- Body identical to 20260728140000 otherwise.
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
    'Material handover confirmed for ' || coalesce(v_no,'a job card') || ' — ready for log book entry.',
    public.fms_production_step_owner_ids('transfer_slip'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_material_handover(uuid, jsonb) to authenticated;
