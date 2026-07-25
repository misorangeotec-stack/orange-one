-- ===========================================================================
-- PRODUCTION ENTRY FMS — QUALITY BEFORE LOG BOOK + "ADDITIONAL ISSUE SLIP" loop.
--
-- Two coupled changes:
--  1) REORDER: RM Transfer now advances to QUALITY CHECK, and Quality Check
--     (approved) advances to the LOG BOOK ENTRY (transfer_slip). So the chain is
--     … material_handover → rm_transfer → quality_check → transfer_slip …
--  2) QC REJECT → GENERATE ADDITIONAL ISSUE SLIP. A rejected lot is no longer a
--     dead end: it moves to a new `awaiting_additional_issue_slip` state. There an
--     operator issues ADDITIONAL raw material (a top-up), and the card RE-ENTERS
--     material_handover → rm_transfer → quality_check. The returning re-test is
--     due +2 days (qc_retest_due, kept from the old retest rule). An approval then
--     goes to the Log Book, where the actual-use grid combines the ORIGINAL BOM +
--     every additional issue slip into ONE final entry (combining is done in the
--     UI). The loop may repeat.
--
-- The loop reuses the existing handover / rm_transfer / quality STATUSES (queue
-- membership is status-driven, so a re-entered card simply reappears). Its data
-- lives in a new `ais_rounds` jsonb array so the first-pass mh_*/rmt_* columns and
-- qc_rounds are never overwritten. record_material_handover / record_rm_transfer
-- become ROUND-AWARE: while an additional round is open they write into the round
-- instead of the base columns.
--
-- Additive: ais_rounds/ais_at/ais_by columns, new status value, the two new AIS
-- RPCs. Replace-only for the reordered handover/rm_transfer/quality RPCs.
-- ===========================================================================

-- New status value (widen the check; every existing value retained).
alter table public.fms_production_requests drop constraint if exists fms_production_requests_status_check;
alter table public.fms_production_requests add constraint fms_production_requests_status_check
  check (status in (
    'awaiting_material_handover','awaiting_rm_transfer','awaiting_transfer_slip',
    'awaiting_production','awaiting_quality','awaiting_additional_issue_slip',
    'awaiting_mc_testing','awaiting_pm_handover','awaiting_pm_transfer',
    'awaiting_packing','awaiting_fg_transfer','closed','on_hold','cancelled'));

alter table public.fms_production_requests add column if not exists ais_rounds jsonb not null default '[]'::jsonb;
alter table public.fms_production_requests drop constraint if exists fms_production_requests_ais_rounds_is_array;
alter table public.fms_production_requests add constraint fms_production_requests_ais_rounds_is_array
  check (jsonb_typeof(ais_rounds) = 'array');
alter table public.fms_production_requests add column if not exists ais_at timestamptz;
alter table public.fms_production_requests add column if not exists ais_by uuid references auth.users on delete set null;

comment on column public.fms_production_requests.ais_rounds is
  'Additional Issue Slip loop rounds (QC-reject top-ups): array of {round, ais_qty, ais_bom_lines:[{raw_material_id,qty,unit_id}], issued_at, issued_by, mh_lines, mh_done, rmt_tally, rmt_done}. While the last round has mh_done/rmt_done false the handover/rm_transfer RPCs write into it instead of the base columns.';

-- ---------------------------------------------------------------------------
-- ROUND-AWARE material handover. Base pass: writes mh_bom_lines/mh_qty/mh_at as
-- before (RM Book No. no longer written — the field was removed). Additional
-- round: records the top-up handover into the open ais round. Both advance to
-- rm_transfer. (RM Book No. column kept but no longer written.)
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_lines jsonb := coalesce(p->'mh_bom_lines', '[]'::jsonb);
  v_rounds jsonb; v_n int; v_last jsonb; v_sum numeric; v_ais boolean;
begin
  select status, req_no, ais_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_material_handover' then raise exception 'This job card is not awaiting material handover (status %)', v_status; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then raise exception 'Not authorized to record material handover'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'mh_bom_lines must be a JSON array'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_n := jsonb_array_length(v_rounds);
  v_ais := v_n > 0 and coalesce((v_rounds->(v_n-1)->>'mh_done')::boolean, false) = false;

  if v_ais then
    -- Additional round: store the top-up handover in the open round; keep base cols.
    v_last := (v_rounds->(v_n-1)) || jsonb_build_object('mh_lines', v_lines, 'mh_done', true);
    update public.fms_production_requests set
      ais_rounds = jsonb_set(v_rounds, array[(v_n-1)::text], v_last),
      status = 'awaiting_rm_transfer', current_step = 'rm_transfer'
    where id = p_req;
  else
    v_sum := public.fms_production_mh_lines_sum(v_lines);
    update public.fms_production_requests set
      mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, current_date),
      mh_status      = nullif(trim(p->>'mh_status'), ''),
      mh_bom_lines   = v_lines,
      mh_qty         = coalesce(v_sum, nullif(p->>'mh_qty','')::numeric),
      mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
      mh_at = coalesce(mh_at, now()), mh_by = coalesce(mh_by, v_uid),
      status = 'awaiting_rm_transfer', current_step = 'rm_transfer'
    where id = p_req;
  end if;

  perform public.fms_production_announce('request', p_req, 'material_handover',
    'Material handover confirmed for ' || coalesce(v_no,'a job card') || ' — ready for RM transfer to production.',
    public.fms_production_step_owner_ids('rm_transfer'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_material_handover(uuid, jsonb) to authenticated;

-- update_material_handover: base handover correction (RM Book No. no longer written).
create or replace function public.fms_production_update_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_lines jsonb := coalesce(p->'mh_bom_lines', '[]'::jsonb); v_sum numeric;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then raise exception 'Not authorized to edit the material handover'; end if;
  if not public.fms_production_mh_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The material handover can no longer be edited: the RM transfer has already been recorded (status %).', v_status;
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'mh_bom_lines must be a JSON array'; end if;

  v_sum := public.fms_production_mh_lines_sum(v_lines);
  update public.fms_production_requests set
    mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, mh_actual_date),
    mh_status      = nullif(trim(p->>'mh_status'), ''),
    mh_bom_lines   = v_lines,
    mh_qty         = coalesce(v_sum, nullif(p->>'mh_qty','')::numeric),
    mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'material_handover_edited',
    format('Material handover on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_material_handover(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- ROUND-AWARE RM transfer → QUALITY CHECK (reordered target). Additional round:
-- records the top-up transfer into the open round. Both advance to quality.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_rm_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_rounds jsonb; v_n int; v_last jsonb; v_ais boolean; v_tally text := nullif(trim(p->>'rmt_tally_entry'), '');
begin
  select status, req_no, ais_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_rm_transfer' then raise exception 'This job card is not awaiting RM transfer to production (status %)', v_status; end if;
  if not public.fms_production_can_act('rm_transfer', p_req, v_uid) then raise exception 'Not authorized to record the RM transfer'; end if;
  if coalesce(v_tally, '') = '' then raise exception 'A Tally entry is required'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_n := jsonb_array_length(v_rounds);
  v_ais := v_n > 0
       and coalesce((v_rounds->(v_n-1)->>'mh_done')::boolean, false) = true
       and coalesce((v_rounds->(v_n-1)->>'rmt_done')::boolean, false) = false;

  if v_ais then
    v_last := (v_rounds->(v_n-1)) || jsonb_build_object('rmt_tally', v_tally, 'rmt_done', true);
    update public.fms_production_requests set
      ais_rounds = jsonb_set(v_rounds, array[(v_n-1)::text], v_last),
      status = 'awaiting_quality', current_step = 'quality_check'
    where id = p_req;
  else
    update public.fms_production_requests set
      rmt_actual_date = coalesce(nullif(p->>'rmt_actual_date','')::date, current_date),
      rmt_tally_entry = v_tally,
      rmt_remarks     = nullif(trim(p->>'rmt_remarks'), ''),
      rmt_at = coalesce(rmt_at, now()), rmt_by = coalesce(rmt_by, v_uid),
      status = 'awaiting_quality', current_step = 'quality_check'
    where id = p_req;
  end if;

  perform public.fms_production_announce('request', p_req, 'rm_transfer',
    'RM transferred to production for ' || coalesce(v_no,'a job card') || ' — ready for quality checking.',
    public.fms_production_step_owner_ids('quality_check'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_rm_transfer(uuid, jsonb) to authenticated;

-- RM transfer now editable until QUALITY CHECK is recorded (was the log book).
create or replace function public.fms_production_rmt_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.rmt_at is not null and r.status = 'awaiting_quality');
$$;
grant execute on function public.fms_production_rmt_editable(uuid) to authenticated;

create or replace function public.fms_production_update_rm_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_tally text := nullif(trim(p->>'rmt_tally_entry'), '');
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('rm_transfer', p_req, v_uid) then raise exception 'Not authorized to edit the RM transfer'; end if;
  if not public.fms_production_rmt_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The RM transfer can no longer be edited: quality checking has already been recorded (status %).', v_status;
  end if;
  if coalesce(v_tally, '') = '' then raise exception 'A Tally entry is required'; end if;

  update public.fms_production_requests set
    rmt_actual_date = coalesce(nullif(p->>'rmt_actual_date','')::date, rmt_actual_date),
    rmt_tally_entry = v_tally,
    rmt_remarks     = nullif(trim(p->>'rmt_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'rm_transfer_edited',
    format('RM transfer on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_rm_transfer(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- QUALITY CHECK — approve → LOG BOOK; reject → ADDITIONAL ISSUE SLIP (+2-day
-- retest carried on qc_retest_due). Test rounds accumulate with no hard cap
-- (each reject spawns a top-up + re-test).
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_rounds jsonb; v_round int; v_result text; v_date date; v_datein text;
begin
  select status, req_no, qc_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_quality' then raise exception 'This job card is not awaiting quality checking (status %)', v_status; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to record quality checking'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_round  := jsonb_array_length(v_rounds) + 1;

  v_result := lower(nullif(trim(p->>'qc_result'), ''));
  if v_result is null or v_result not in ('approved','rejected') then raise exception 'Choose Approve or Reject'; end if;

  v_datein := nullif(trim(p->>'qc_test_date'), '');
  v_date := coalesce(v_datein::date, current_date);

  update public.fms_production_requests set
    qc_rounds = v_rounds || jsonb_build_object(
      'round', v_round, 'test_date', v_date, 'result', v_result,
      'remarks', nullif(trim(p->>'qc_remarks'), ''),
      'attachment_path', nullif(trim(p->>'qc_attachment_path'), ''),
      'attachment_name', nullif(trim(p->>'qc_attachment_name'), '')),
    qc_actual_date = v_date,
    qc_status = v_result,
    qc_remarks = nullif(trim(p->>'qc_remarks'), ''),
    qc_attachment_path = nullif(trim(p->>'qc_attachment_path'), ''),
    qc_attachment_name = nullif(trim(p->>'qc_attachment_name'), ''),
    qc_by = v_uid
  where id = p_req;

  if v_result = 'approved' then
    update public.fms_production_requests set
      qc_at = coalesce(qc_at, now()), qc_retest_due = null,
      status = 'awaiting_transfer_slip', current_step = 'transfer_slip'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'quality_check',
      'Quality checking approved for ' || coalesce(v_no,'a job card') || ' (Test ' || v_round || ') — ready for the log book entry.',
      public.fms_production_step_owner_ids('transfer_slip'), jsonb_build_object('req_no', v_no));
  else
    -- Rejected: raise an additional issue slip; the returning re-test is due +2 days.
    update public.fms_production_requests set
      qc_retest_due = v_date + 2,
      status = 'awaiting_additional_issue_slip', current_step = 'additional_issue_slip'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'quality_rejected',
      'Quality Test ' || v_round || ' rejected for ' || coalesce(v_no,'a job card') ||
      ' — raise an additional issue slip (re-test due ' || to_char(v_date + 2, 'DD-MM-YYYY') || ').',
      public.fms_production_step_owner_ids('additional_issue_slip'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_quality(uuid, jsonb) to authenticated;

-- Quality now editable until the LOG BOOK ENTRY is recorded (was M/C testing).
create or replace function public.fms_production_qc_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.qc_at is not null and r.status = 'awaiting_transfer_slip');
$$;
grant execute on function public.fms_production_qc_editable(uuid) to authenticated;

create or replace function public.fms_production_update_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_rounds jsonb; v_n int; v_last jsonb; v_date date;
begin
  select status, req_no, qc_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to edit quality checking'; end if;
  if not public.fms_production_qc_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'Quality checking can no longer be edited: the log book entry has already been recorded (status %).', v_status;
  end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_n := jsonb_array_length(v_rounds);
  if v_n = 0 then raise exception 'There is no quality test to edit'; end if;
  v_last := v_rounds->(v_n - 1);
  v_date := coalesce(nullif(trim(p->>'qc_actual_date'), '')::date, (v_last->>'test_date')::date);

  v_last := v_last
    || jsonb_build_object('test_date', v_date, 'remarks', nullif(trim(p->>'qc_remarks'), ''))
    || case when p ? 'qc_attachment_path'
         then jsonb_build_object('attachment_path', nullif(p->>'qc_attachment_path',''), 'attachment_name', nullif(p->>'qc_attachment_name',''))
         else '{}'::jsonb end;

  update public.fms_production_requests set
    qc_rounds = jsonb_set(v_rounds, array[(v_n - 1)::text], v_last),
    qc_actual_date = v_date,
    qc_remarks = nullif(trim(p->>'qc_remarks'), ''),
    qc_attachment_path = case when p ? 'qc_attachment_path' then nullif(p->>'qc_attachment_path','') else qc_attachment_path end,
    qc_attachment_name = case when p ? 'qc_attachment_name' then nullif(p->>'qc_attachment_name','') else qc_attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'quality_edited',
    format('Quality checking on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_quality(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- GENERATE ADDITIONAL ISSUE SLIP — the top-up for a QC-rejected lot. Appends an
-- ais round (additional FG qty + additional RM) and re-enters material handover.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_additional_issue_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_rounds jsonb; v_lines jsonb := coalesce(p->'ais_bom_lines', '[]'::jsonb); v_round int;
begin
  select status, req_no, ais_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_additional_issue_slip' then raise exception 'This job card is not awaiting an additional issue slip (status %)', v_status; end if;
  if not public.fms_production_can_act('additional_issue_slip', p_req, v_uid) then raise exception 'Not authorized to raise an additional issue slip'; end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'ais_bom_lines must be a JSON array'; end if;

  -- Drop blank RM rows.
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';
  if jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one additional raw material'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_round  := jsonb_array_length(v_rounds) + 1;

  update public.fms_production_requests set
    ais_rounds = v_rounds || jsonb_build_object(
      'round', v_round,
      'ais_qty', nullif(trim(p->>'ais_qty'), ''),
      'ais_bom_lines', v_lines,
      'issued_at', now(), 'issued_by', v_uid,
      'mh_lines', null, 'mh_done', false,
      'rmt_tally', null, 'rmt_done', false),
    ais_at = now(), ais_by = v_uid,
    status = 'awaiting_material_handover', current_step = 'material_handover'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'additional_issue_slip',
    'Additional issue slip raised for ' || coalesce(v_no,'a job card') || ' — ready for material handover of the top-up.',
    public.fms_production_step_owner_ids('material_handover'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_additional_issue_slip(uuid, jsonb) to authenticated;

-- Editable only right after issuing, before the top-up handover is recorded.
create or replace function public.fms_production_ais_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req
      and jsonb_array_length(coalesce(r.ais_rounds, '[]'::jsonb)) > 0
      and r.status = 'awaiting_material_handover'
      and coalesce((r.ais_rounds->(jsonb_array_length(r.ais_rounds)-1)->>'mh_done')::boolean, false) = false);
$$;
grant execute on function public.fms_production_ais_editable(uuid) to authenticated;

create or replace function public.fms_production_update_additional_issue_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_rounds jsonb; v_n int; v_last jsonb; v_lines jsonb := coalesce(p->'ais_bom_lines', '[]'::jsonb);
begin
  select status, req_no, ais_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('additional_issue_slip', p_req, v_uid) then raise exception 'Not authorized to edit the additional issue slip'; end if;
  if not public.fms_production_ais_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The additional issue slip can no longer be edited: its material handover has already been recorded.';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'ais_bom_lines must be a JSON array'; end if;

  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';
  if jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one additional raw material'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_n := jsonb_array_length(v_rounds);
  v_last := (v_rounds->(v_n-1))
    || jsonb_build_object('ais_qty', nullif(trim(p->>'ais_qty'), ''), 'ais_bom_lines', v_lines);

  update public.fms_production_requests set
    ais_rounds = jsonb_set(v_rounds, array[(v_n-1)::text], v_last),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'additional_issue_slip_edited',
    format('Additional issue slip on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_additional_issue_slip(uuid, jsonb) to authenticated;
