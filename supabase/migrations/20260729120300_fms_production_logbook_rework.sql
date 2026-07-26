-- ===========================================================================
-- PRODUCTION ENTRY FMS — LOG BOOK ENTRY rework: production loss + packing merge.
--
-- Three changes to the Log Book Entry (transfer_slip):
--  1) PRODUCTION LOSS is now captured alongside scrap. Actual Output is
--     Expected − Production Loss − Scrap (was Expected − Scrap).
--  2) The PACKING-MATERIAL list (packaging items used) is captured HERE — the
--     separate Packing Material Handover step is being removed. It is still
--     stored in pmh_qty + pmh_bom_lines so the downstream Packing Material
--     Transfer and Packing Entry steps read it unchanged.
--  3) Each packaging line gains an "EXTRA" quantity; the system auto-adds 7% to
--     the extra (a wastage buffer on the extra only). Stored per line as
--     {packaging_item_id, unit_id, qty, extra, extra_buffered, total} with
--     extra_buffered = round(extra*1.07, 3) and total = round(qty + extra*1.07, 3)
--     — SERVER-computed so the client cannot drift.
--
-- Additive: ts_production_loss column + a pack-lines helper. Replace-only for the
-- log-book RPCs (based on 20260728230000). Successor unchanged (→ production).
-- ===========================================================================

alter table public.fms_production_requests add column if not exists ts_production_loss numeric;
comment on column public.fms_production_requests.ts_production_loss is
  'Production loss quantity entered at the log book entry. Actual Output = Expected − Production Loss − Scrap.';

-- Normalise packaging lines: keep only lines with an item; compute the 7%-buffered
-- extra and the line total. Returns [] for an empty/blank input.
create or replace function public.fms_production_pack_lines(p_lines jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'packaging_item_id', l->>'packaging_item_id',
    'unit_id',           nullif(l->>'unit_id',''),
    'qty',               nullif(trim(l->>'qty'), ''),
    'extra',             nullif(trim(l->>'extra'), ''),
    'extra_buffered',    round(coalesce(nullif(trim(l->>'extra'), '')::numeric, 0) * 1.07, 3),
    'total',             round(coalesce(nullif(trim(l->>'qty'), '')::numeric, 0)
                             + coalesce(nullif(trim(l->>'extra'), '')::numeric, 0) * 1.07, 3)
  )), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  where coalesce(trim(l->>'packaging_item_id'), '') <> '';
$$;
grant execute on function public.fms_production_pack_lines(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- LOG BOOK RECORD (→ production): BOM + output (incl. production loss) + packing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_transfer_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_lines jsonb := coalesce(p->'ts_bom_lines', '[]'::jsonb);
  v_expected numeric := nullif(p->>'pe_expected_qty','')::numeric;
  v_scrap    numeric := nullif(p->>'scrap_qty','')::numeric;
  v_loss     numeric := nullif(p->>'ts_production_loss','')::numeric;
  v_lab      numeric := nullif(p->>'pe_lab_qty','')::numeric;
  v_packed   numeric := nullif(p->>'ts_packed_qty','')::numeric;
  v_actual   numeric;
  v_loose    numeric;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_transfer_slip' then raise exception 'This job card is not awaiting the log book entry (status %)', v_status; end if;
  if not public.fms_production_can_act('transfer_slip', p_req, v_uid) then raise exception 'Not authorized to record the log book entry'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'ts_bom_lines must be a JSON array'; end if;
  if coalesce(nullif(trim(p->>'ts_attachment_path'), ''), '') = '' then raise exception 'An attachment is required for the log book entry'; end if;

  v_actual := case when v_expected is null then null else round(v_expected - coalesce(v_loss,0) - coalesce(v_scrap,0), 3) end;
  v_loose  := case when v_actual  is null then null else round(v_actual - coalesce(v_lab,0) - coalesce(v_packed,0), 3) end;

  update public.fms_production_requests set
    ts_actual_date     = coalesce(nullif(p->>'ts_actual_date','')::date, current_date),
    ts_status          = nullif(trim(p->>'ts_status'), ''),
    transfer_slip_no   = nullif(trim(p->>'transfer_slip_no'), ''),
    batch_card_no      = nullif(trim(p->>'batch_card_no'), ''),
    ts_bom_lines       = v_lines,
    pe_expected_qty    = v_expected,
    scrap_qty          = v_scrap,
    ts_production_loss = v_loss,
    actual_qty         = v_actual,
    pe_lab_qty         = v_lab,
    ts_packed_qty      = v_packed,
    ts_loose_qty       = v_loose,
    -- packing material captured here (feeds pm_transfer / packing_entry)
    pmh_qty            = v_packed,
    pmh_bom_lines      = public.fms_production_pack_lines(coalesce(p->'pmh_bom_lines', '[]'::jsonb)),
    ts_attachment_path = nullif(trim(p->>'ts_attachment_path'), ''),
    ts_attachment_name = nullif(trim(p->>'ts_attachment_name'), ''),
    ts_remarks         = nullif(trim(p->>'ts_remarks'), ''),
    ts_at = coalesce(ts_at, now()), ts_by = coalesce(ts_by, v_uid),
    status = 'awaiting_production', current_step = 'production_entry'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'transfer_slip',
    'Log book entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for production entry.',
    public.fms_production_step_owner_ids('production_entry'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_transfer_slip(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- LOG BOOK UPDATE (correct until production entry): same; attachment kept when omitted.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_transfer_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_lines jsonb := coalesce(p->'ts_bom_lines', '[]'::jsonb);
  v_expected numeric := nullif(p->>'pe_expected_qty','')::numeric;
  v_scrap    numeric := nullif(p->>'scrap_qty','')::numeric;
  v_loss     numeric := nullif(p->>'ts_production_loss','')::numeric;
  v_lab      numeric := nullif(p->>'pe_lab_qty','')::numeric;
  v_packed   numeric := nullif(p->>'ts_packed_qty','')::numeric;
  v_actual   numeric;
  v_loose    numeric;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('transfer_slip', p_req, v_uid) then raise exception 'Not authorized to edit the log book entry'; end if;
  if not public.fms_production_ts_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The log book entry can no longer be edited: production entry has already been recorded (status %).', v_status;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'ts_bom_lines must be a JSON array'; end if;

  v_actual := case when v_expected is null then null else round(v_expected - coalesce(v_loss,0) - coalesce(v_scrap,0), 3) end;
  v_loose  := case when v_actual  is null then null else round(v_actual - coalesce(v_lab,0) - coalesce(v_packed,0), 3) end;

  update public.fms_production_requests set
    ts_actual_date     = coalesce(nullif(p->>'ts_actual_date','')::date, ts_actual_date),
    ts_status          = nullif(trim(p->>'ts_status'), ''),
    transfer_slip_no   = nullif(trim(p->>'transfer_slip_no'), ''),
    batch_card_no      = nullif(trim(p->>'batch_card_no'), ''),
    ts_bom_lines       = v_lines,
    pe_expected_qty    = v_expected,
    scrap_qty          = v_scrap,
    ts_production_loss = v_loss,
    actual_qty         = v_actual,
    pe_lab_qty         = v_lab,
    ts_packed_qty      = v_packed,
    ts_loose_qty       = v_loose,
    pmh_qty            = v_packed,
    pmh_bom_lines      = public.fms_production_pack_lines(coalesce(p->'pmh_bom_lines', '[]'::jsonb)),
    ts_attachment_path = case when p ? 'ts_attachment_path' then nullif(trim(p->>'ts_attachment_path'), '') else ts_attachment_path end,
    ts_attachment_name = case when p ? 'ts_attachment_name' then nullif(trim(p->>'ts_attachment_name'), '') else ts_attachment_name end,
    ts_remarks         = nullif(trim(p->>'ts_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'transfer_slip_edited',
    format('Log book entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_transfer_slip(uuid, jsonb) to authenticated;
