-- ===========================================================================
-- PRODUCTION ENTRY FMS — MOVE OUTPUT METRICS TO THE LOG BOOK ENTRY.
--
-- The output metrics that used to be captured at PRODUCTION ENTRY now belong to
-- the LOG BOOK ENTRY (step 3), where the actual-use BOM already lives:
--   Expected Qty  = Σ actual use (from ts_bom_lines)
--   Scrap Qty     (entered) → Actual Output = Expected − Scrap
--   Lab Qty       (entered)
--   Packed Qty    (entered) → Loose Qty = Actual Output − Lab − Packed
--
-- Expected/Scrap/Actual/Lab reuse the existing pe_expected_qty / scrap_qty /
-- actual_qty / pe_lab_qty columns (so Quality / M/C / PM screens keep reading
-- them unchanged) — they are simply written by the transfer_slip RPCs now.
-- Packed + Loose are two NEW columns. PRODUCTION ENTRY becomes a Tally-posting
-- step: it captures only the Tally entry + remarks and no longer writes the
-- metrics (so it can't null out what the log book set).
--
-- Additive: ts_packed_qty + ts_loose_qty columns; RPC bodies rewritten.
-- Reversal: drop the two columns and restore the transfer_slip / production RPCs
-- from 20260728150000 / 20260728200000.
-- ===========================================================================

alter table public.fms_production_requests add column if not exists ts_packed_qty numeric;
alter table public.fms_production_requests add column if not exists ts_loose_qty  numeric;

comment on column public.fms_production_requests.ts_packed_qty is
  'Packed quantity entered at the log book entry. Loose = actual_qty − pe_lab_qty − ts_packed_qty.';
comment on column public.fms_production_requests.ts_loose_qty is
  'Loose quantity at the log book entry = Actual Output − Lab − Packed (derived, stored for display/reporting).';

-- ---------------------------------------------------------------------------
-- LOG BOOK RECORD (step 3 → 4): BOM + attachment + the output metrics.
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
    pe_expected_qty  = nullif(p->>'pe_expected_qty','')::numeric,
    scrap_qty        = nullif(p->>'scrap_qty','')::numeric,
    actual_qty       = nullif(p->>'actual_qty','')::numeric,
    pe_lab_qty       = nullif(p->>'pe_lab_qty','')::numeric,
    ts_packed_qty    = nullif(p->>'ts_packed_qty','')::numeric,
    ts_loose_qty     = nullif(p->>'ts_loose_qty','')::numeric,
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
-- LOG BOOK UPDATE (correct until production entry): same, attachment kept when omitted.
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
    pe_expected_qty  = nullif(p->>'pe_expected_qty','')::numeric,
    scrap_qty        = nullif(p->>'scrap_qty','')::numeric,
    actual_qty       = nullif(p->>'actual_qty','')::numeric,
    pe_lab_qty       = nullif(p->>'pe_lab_qty','')::numeric,
    ts_packed_qty    = nullif(p->>'ts_packed_qty','')::numeric,
    ts_loose_qty     = nullif(p->>'ts_loose_qty','')::numeric,
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
-- PRODUCTION RECORD (production_entry → quality): Tally posting only. The output
-- metrics are set at the log book and shown read-only here; they are NOT written
-- (and NOT nulled) by this step.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_production(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_production' then raise exception 'This job card is not awaiting production entry (status %)', v_status; end if;
  if not public.fms_production_can_act('production_entry', p_req, v_uid) then raise exception 'Not authorized to record production entry'; end if;

  update public.fms_production_requests set
    pe_actual_date  = coalesce(nullif(p->>'pe_actual_date','')::date, current_date),
    pe_tally_entry  = nullif(trim(p->>'pe_tally_entry'), ''),
    pe_remarks      = nullif(trim(p->>'pe_remarks'), ''),
    pe_at = coalesce(pe_at, now()), pe_by = coalesce(pe_by, v_uid),
    status = 'awaiting_quality', current_step = 'quality_check'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_entry',
    'Production entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for quality checking.',
    public.fms_production_step_owner_ids('quality_check'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_production(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- PRODUCTION UPDATE (correct until quality checking): Tally + remarks only.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_production(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('production_entry', p_req, v_uid) then raise exception 'Not authorized to edit the production entry'; end if;
  if not public.fms_production_pe_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The production entry can no longer be edited: quality checking has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    pe_actual_date  = coalesce(nullif(p->>'pe_actual_date','')::date, pe_actual_date),
    pe_tally_entry  = nullif(trim(p->>'pe_tally_entry'), ''),
    pe_remarks      = nullif(trim(p->>'pe_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_edited',
    format('Production entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_production(uuid, jsonb) to authenticated;
