-- ===========================================================================
-- PRODUCTION ENTRY FMS — edit-until-the-next-step.
--
-- The twin of sampling 20260724120200 / import 20260719120000. Each stage screen
-- is a pending-only queue; the instant an owner acts the row leaves it. These
-- predicates + RPCs let an owner see and CORRECT what they did — but only until
-- the next step is done.
--
-- HOW "editable until the next step" maps to the linear status machine:
--   material_handover editable while status='awaiting_transfer_slip'
--   transfer_slip     editable while status='awaiting_production'
--   production_entry  editable while status='awaiting_quality'
--   quality_check     editable while status='awaiting_mc_testing'
--   mc_testing        editable while status='awaiting_pm_handover'
--   pm_handover       editable while status='awaiting_pm_transfer'
--   pm_transfer       editable while status='awaiting_packing'
--   packing_entry     editable while status='awaiting_fg_transfer'
--   fg_transfer       the LAST step — nothing downstream can lock it, so it STAYS
--                       editable after the card closes (safe: no derived stage
--                       machine to drift). Only on_hold / cancelled lock it.
--
-- Every RPC: authorized exactly like its create twin · re-checks the lock
-- SERVER-side (the disabled button is a courtesy, never the gate) · takes a row
-- lock · writes edited_at/edited_by (kept SEPARATE from the step's own *_at/*_by
-- attribution, which is history) · and announces IN THIS TRANSACTION.
--
-- Additive / replace-only. Apply BEFORE the frontend that reads these.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- material_handover
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_mh_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.mh_at is not null and r.status = 'awaiting_transfer_slip');
$$;
grant execute on function public.fms_production_mh_editable(uuid) to authenticated;

create or replace function public.fms_production_update_material_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('material_handover', p_req, v_uid) then raise exception 'Not authorized to edit the material handover'; end if;
  if not public.fms_production_mh_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The material handover can no longer be edited: the next step has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    mh_actual_date = coalesce(nullif(p->>'mh_actual_date','')::date, mh_actual_date),
    mh_status      = nullif(trim(p->>'mh_status'), ''),
    mh_qty         = nullif(p->>'mh_qty','')::numeric,
    rm_book_no     = nullif(trim(p->>'rm_book_no'), ''),
    mh_remarks     = nullif(trim(p->>'mh_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'material_handover_edited',
    format('Material handover on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_material_handover(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- transfer_slip
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_ts_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.ts_at is not null and r.status = 'awaiting_production');
$$;
grant execute on function public.fms_production_ts_editable(uuid) to authenticated;

create or replace function public.fms_production_update_transfer_slip(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('transfer_slip', p_req, v_uid) then raise exception 'Not authorized to edit the transfer slip'; end if;
  if not public.fms_production_ts_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The transfer slip can no longer be edited: production entry has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    ts_actual_date   = coalesce(nullif(p->>'ts_actual_date','')::date, ts_actual_date),
    ts_status        = nullif(trim(p->>'ts_status'), ''),
    transfer_slip_no = nullif(trim(p->>'transfer_slip_no'), ''),
    batch_card_no    = nullif(trim(p->>'batch_card_no'), ''),
    ts_remarks       = nullif(trim(p->>'ts_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'transfer_slip_edited',
    format('Transfer slip on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_transfer_slip(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- production_entry
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_pe_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pe_at is not null and r.status = 'awaiting_quality');
$$;
grant execute on function public.fms_production_pe_editable(uuid) to authenticated;

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
    pe_actual_date = coalesce(nullif(p->>'pe_actual_date','')::date, pe_actual_date),
    pe_status      = nullif(trim(p->>'pe_status'), ''),
    actual_qty     = nullif(p->>'actual_qty','')::numeric,
    scrap_qty      = nullif(p->>'scrap_qty','')::numeric,
    lot_no         = nullif(trim(p->>'lot_no'), ''),
    pe_remarks     = nullif(trim(p->>'pe_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_edited',
    format('Production entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_production(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- quality_check
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_qc_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.qc_at is not null and r.status = 'awaiting_mc_testing');
$$;
grant execute on function public.fms_production_qc_editable(uuid) to authenticated;

create or replace function public.fms_production_update_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to edit quality checking'; end if;
  if not public.fms_production_qc_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'Quality checking can no longer be edited: M/C testing has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    qc_actual_date     = coalesce(nullif(p->>'qc_actual_date','')::date, qc_actual_date),
    qc_status          = nullif(trim(p->>'qc_status'), ''),
    qc_remarks         = nullif(trim(p->>'qc_remarks'), ''),
    -- when the caller passes an attachment key it replaces; absent key keeps the current file.
    qc_attachment_path = case when p ? 'qc_attachment_path' then nullif(p->>'qc_attachment_path','') else qc_attachment_path end,
    qc_attachment_name = case when p ? 'qc_attachment_name' then nullif(p->>'qc_attachment_name','') else qc_attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'quality_edited',
    format('Quality checking on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_quality(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- mc_testing
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_mc_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.mc_at is not null and r.status = 'awaiting_pm_handover');
$$;
grant execute on function public.fms_production_mc_editable(uuid) to authenticated;

create or replace function public.fms_production_update_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to edit M/C testing'; end if;
  if not public.fms_production_mc_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'M/C testing can no longer be edited: packing-material handover has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    mc_actual_date = coalesce(nullif(p->>'mc_actual_date','')::date, mc_actual_date),
    mc_status      = nullif(trim(p->>'mc_status'), ''),
    mc_remarks     = nullif(trim(p->>'mc_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'mc_testing_edited',
    format('M/C testing on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_mc_testing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- pm_handover
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_pmh_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pmh_at is not null and r.status = 'awaiting_pm_transfer');
$$;
grant execute on function public.fms_production_pmh_editable(uuid) to authenticated;

create or replace function public.fms_production_update_pm_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('pm_handover', p_req, v_uid) then raise exception 'Not authorized to edit the packing-material handover'; end if;
  if not public.fms_production_pmh_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing-material handover can no longer be edited: the transfer has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    pmh_actual_date = coalesce(nullif(p->>'pmh_actual_date','')::date, pmh_actual_date),
    pmh_status      = nullif(trim(p->>'pmh_status'), ''),
    pmh_qty         = nullif(p->>'pmh_qty','')::numeric,
    pmh_batch_no    = nullif(trim(p->>'pmh_batch_no'), ''),
    pmh_remarks     = nullif(trim(p->>'pmh_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_handover_edited',
    format('Packing-material handover on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_pm_handover(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- pm_transfer
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_pmt_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pmt_at is not null and r.status = 'awaiting_packing');
$$;
grant execute on function public.fms_production_pmt_editable(uuid) to authenticated;

create or replace function public.fms_production_update_pm_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('pm_transfer', p_req, v_uid) then raise exception 'Not authorized to edit the packing-material transfer'; end if;
  if not public.fms_production_pmt_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing-material transfer can no longer be edited: packing entry has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    pmt_actual_date = coalesce(nullif(p->>'pmt_actual_date','')::date, pmt_actual_date),
    pmt_status      = nullif(trim(p->>'pmt_status'), ''),
    pmt_qty         = nullif(p->>'pmt_qty','')::numeric,
    pmt_remarks     = nullif(trim(p->>'pmt_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_transfer_edited',
    format('Packing-material transfer on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_pm_transfer(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- packing_entry
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_pk_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pk_at is not null and r.status = 'awaiting_fg_transfer');
$$;
grant execute on function public.fms_production_pk_editable(uuid) to authenticated;

create or replace function public.fms_production_update_packing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('packing_entry', p_req, v_uid) then raise exception 'Not authorized to edit the packing entry'; end if;
  if not public.fms_production_pk_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing entry can no longer be edited: the finished-good transfer has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    pk_actual_date = coalesce(nullif(p->>'pk_actual_date','')::date, pk_actual_date),
    pk_status      = nullif(trim(p->>'pk_status'), ''),
    packed_qty     = nullif(p->>'packed_qty','')::numeric,
    loose_ink_qty  = nullif(p->>'loose_ink_qty','')::numeric,
    pk_remarks     = nullif(trim(p->>'pk_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'packing_edited',
    format('Packing entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_packing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- fg_transfer — the LAST step. Stays editable after close; only on_hold /
-- cancelled lock it. Safe: this app has no derived stage machine.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_fg_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.fg_at is not null and r.status = 'closed');
$$;
grant execute on function public.fms_production_fg_editable(uuid) to authenticated;

create or replace function public.fms_production_update_fg_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('fg_transfer', p_req, v_uid) then raise exception 'Not authorized to edit the finished-good transfer'; end if;
  if not public.fms_production_fg_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then raise exception 'This job card is cancelled — its finished-good transfer can no longer be edited.';
    end if;
    raise exception 'No finished-good transfer has been recorded on this job card yet — there is nothing to edit.';
  end if;

  update public.fms_production_requests set
    fg_actual_date = coalesce(nullif(p->>'fg_actual_date','')::date, fg_actual_date),
    fg_status      = nullif(trim(p->>'fg_status'), ''),
    final_qty      = nullif(p->>'final_qty','')::numeric,
    fg_remarks     = nullif(trim(p->>'fg_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'fg_transfer_edited',
    format('Finished-good transfer on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_fg_transfer(uuid, jsonb) to authenticated;
