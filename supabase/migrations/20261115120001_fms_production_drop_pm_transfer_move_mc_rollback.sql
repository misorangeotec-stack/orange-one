-- ===========================================================================
-- ROLLBACK for 20261115120000_fms_production_drop_pm_transfer_move_mc.sql
--
-- Restores the old chain:
--   … production_entry → mc_testing → pm_transfer → packing_entry → ready_to_dispatch
--
-- ⚠ WHAT THIS CANNOT UNDO. The forward migration merged two queues into one:
--   cards from BOTH awaiting_pm_transfer and awaiting_mc_testing were set to
--   awaiting_packing, and nothing records which was which. Section 3 below sorts
--   them by mc_at — a card with an M/C result goes back to pm_transfer, one
--   without goes back to mc_testing — which is right for every card that had not
--   moved in the meantime. A card PACKED under the new order (pk_at set) is left
--   at ready-to-dispatch rather than dragged backwards, since its packing is real
--   work that the old chain has no place to put.
--
--   Nothing was dropped going forward, so there is nothing to recreate here: the
--   pmt_* columns and the pm_transfer RPCs were never removed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Production entry advances to M/C testing again.
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
    status = 'awaiting_mc_testing', current_step = 'mc_testing'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_entry',
    'Production entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for M/C testing.',
    public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_production(uuid, jsonb) to authenticated;

create or replace function public.fms_production_pe_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pe_at is not null and r.status = 'awaiting_mc_testing');
$$;
grant execute on function public.fms_production_pe_editable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. M/C testing advances to pm_transfer again; packing advances to RTD again.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_result text; v_date date;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_mc_testing' then raise exception 'This job card is not awaiting M/C testing (status %)', v_status; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to record M/C testing'; end if;

  v_result := lower(nullif(trim(p->>'mc_result'), ''));
  if v_result is null or v_result not in ('approved','rejected','bypassed') then raise exception 'Choose Approve, Reject or Bypass'; end if;
  if v_result = 'bypassed' and not public.is_admin(v_uid) then raise exception 'Only an admin can bypass M/C testing'; end if;
  v_date := coalesce(nullif(trim(p->>'mc_test_date'),'')::date, current_date);

  update public.fms_production_requests set
    mc_actual_date     = v_date,
    mc_status          = v_result,
    mc_remarks         = nullif(trim(p->>'mc_remarks'), ''),
    mc_attachment_path = nullif(trim(p->>'mc_attachment_path'), ''),
    mc_attachment_name = nullif(trim(p->>'mc_attachment_name'), ''),
    mc_bypassed_by     = case when v_result = 'bypassed' then v_uid else mc_bypassed_by end,
    mc_bypassed_at     = case when v_result = 'bypassed' then now() else mc_bypassed_at end,
    mc_by = v_uid
  where id = p_req;

  if v_result in ('approved','bypassed') then
    update public.fms_production_requests set
      mc_at = coalesce(mc_at, now()),
      status = 'awaiting_pm_transfer', current_step = 'pm_transfer'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'mc_testing',
      'M/C testing ' || v_result || ' for ' || coalesce(v_no,'a job card') || ' — ready for packing-material transfer.',
      public.fms_production_step_owner_ids('pm_transfer'), jsonb_build_object('req_no', v_no));
  else
    perform public.fms_production_announce('request', p_req, 'mc_testing_rejected',
      'M/C testing rejected for ' || coalesce(v_no,'a job card') || ' — a re-test is required.',
      public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_mc_testing(uuid, jsonb) to authenticated;

create or replace function public.fms_production_mc_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.mc_at is not null and r.status = 'awaiting_pm_transfer');
$$;
grant execute on function public.fms_production_mc_editable(uuid) to authenticated;

create or replace function public.fms_production_record_packing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_card text; v_net numeric; v_packed numeric;
begin
  select status, req_no, card_type, round(coalesce(actual_qty,0) - coalesce(pe_lab_qty,0), 3)
    into v_status, v_no, v_card, v_net
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_packing' then raise exception 'This job card is not awaiting packing entry (status %)', v_status; end if;
  if not public.fms_production_can_act('packing_entry', p_req, v_uid) then raise exception 'Not authorized to record packing entry'; end if;

  if v_card = 'repackaging' and p ? 'ts_packed_qty' then
    v_packed := nullif(trim(p->>'ts_packed_qty'), '')::numeric;
    if v_packed is null then raise exception 'The packed quantity is required.'; end if;
    if v_packed < 0 then raise exception 'The packed quantity cannot be negative.'; end if;
    if v_packed > v_net then raise exception 'The packed quantity cannot be more than the net quantity for packing (%).', v_net; end if;
  end if;

  update public.fms_production_requests set
    pk_actual_date = coalesce(nullif(p->>'pk_actual_date','')::date, current_date),
    pk_status      = nullif(trim(p->>'pk_status'), ''),
    packed_qty     = nullif(p->>'packed_qty','')::numeric,
    loose_ink_qty  = nullif(p->>'loose_ink_qty','')::numeric,
    pk_remarks     = nullif(trim(p->>'pk_remarks'), ''),
    ts_packed_qty  = coalesce(v_packed, ts_packed_qty),
    ts_loose_qty   = case when v_packed is null then ts_loose_qty else round(v_net - v_packed, 3) end,
    pk_at = coalesce(pk_at, now()), pk_by = coalesce(pk_by, v_uid),
    status = 'awaiting_ready_to_dispatch', current_step = 'ready_to_dispatch'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'packing_entry',
    'Packing entry recorded for ' || coalesce(v_no,'a job card') || ' — ready to dispatch.',
    public.fms_production_step_owner_ids('ready_to_dispatch'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_packing(uuid, jsonb) to authenticated;

create or replace function public.fms_production_pk_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pk_at is not null and r.status = 'awaiting_ready_to_dispatch');
$$;
grant execute on function public.fms_production_pk_editable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Put the cards back. See the caveat at the top of this file.
-- ---------------------------------------------------------------------------
update public.fms_production_requests
   set status = 'awaiting_pm_transfer', current_step = 'pm_transfer'
 where status = 'awaiting_packing'
   and pk_at is null
   and mc_at is not null;

update public.fms_production_requests
   set status = 'awaiting_mc_testing', current_step = 'mc_testing'
 where status = 'awaiting_packing'
   and pk_at is null
   and mc_at is null
   and coalesce(card_type, 'production') <> 'repackaging';

-- A card packed under the new order but not yet M/C tested has no home in the
-- old chain — the old order tests BEFORE packing. Send it to pm_transfer, the
-- step the old chain runs between the two, so it is not stranded.
update public.fms_production_requests
   set status = 'awaiting_pm_transfer', current_step = 'pm_transfer'
 where status = 'awaiting_mc_testing'
   and pk_at is not null;

-- ---------------------------------------------------------------------------
-- 4. resume_status + the repackaging intake, back to the pm_transfer landing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_resume_status(p_req uuid)
returns text language sql stable security definer set search_path = public as $$
  select case r.current_step
    when 'material_handover'      then 'awaiting_material_handover'
    when 'rm_transfer'            then 'awaiting_rm_transfer'
    when 'quality_check'          then 'awaiting_quality'
    when 'additional_issue_slip'  then 'awaiting_additional_issue_slip'
    when 'transfer_slip'          then 'awaiting_transfer_slip'
    when 'production_entry'       then 'awaiting_production'
    when 'mc_testing'             then 'awaiting_mc_testing'
    when 'pm_transfer'            then 'awaiting_pm_transfer'
    when 'packing_entry'          then 'awaiting_packing'
    when 'ready_to_dispatch'      then 'awaiting_ready_to_dispatch'
    when 'fg_transfer'            then (case when r.fg_at is not null then 'closed' else 'awaiting_fg_transfer' end)
    else 'awaiting_material_handover'
  end
  from public.fms_production_requests r where r.id = p_req;
$$;
grant execute on function public.fms_production_resume_status(uuid) to authenticated;

drop function if exists public.fms_production_needs_mc_testing(uuid);

-- ⚠ The repackaging intake must also be restored to landing in pm_transfer.
--   Re-run 20260925120000_fms_production_repack_fg_lot_no.sql after this file:
--   it recreates fms_production_submit_request verbatim with that landing.

-- ---------------------------------------------------------------------------
-- 5. Put the two due-date anchors back the way the Due Dates screen had them.
--    `days` is untouched here as it was on the way in.
-- ---------------------------------------------------------------------------
update public.fms_production_config
   set value = jsonb_set(
                 jsonb_set(
                   value,
                   '{mc_testing,anchor}',  '"quality_check"'::jsonb, true),
                 '{fg_transfer,anchor}',   '"packing_entry"'::jsonb, true),
       updated_at = now()
 where key = 'step_sla';
