-- ===========================================================================
-- PRODUCTION ENTRY FMS — DROP "Packing Material Transfer" + MOVE "Testing of M/C"
-- to sit AFTER the Packing Entry.
--
-- Nobody was using the packing-material transfer step; cards simply sat in it
-- waiting to be clicked through. And M/C testing was being done in the wrong
-- place: the machine is tested on the packed product, so the test belongs after
-- packing, not before it.
--
--   WAS: … production_entry → mc_testing → pm_transfer → packing_entry → ready_to_dispatch
--   NOW: … production_entry → packing_entry → mc_testing → ready_to_dispatch
--
-- ⚠ ADDITIVE-ONLY, as always. Nothing is dropped: the pmt_* columns, the
--   'awaiting_pm_transfer' status value and the two pm_transfer RPCs all stay
--   exactly where they are. They simply stop being reachable — no card can hold
--   that status once section 7 has run, and no RPC advances a card into it.
--   That keeps every historic card's pmt_at / pmt_by readable on its detail page
--   instead of blanking the history of work people actually did.
--
-- THE TAIL BRANCHES (section 4). After packing, a card goes to M/C testing
-- UNLESS it has no machine to test:
--   • a REPACKAGING card — a traded FG that was only repacked; nothing was
--     manufactured, and it already skipped M/C under the old order too; or
--   • a card that ALREADY HAS an M/C result (mc_at set) — every card in flight
--     today was tested under the old order, and re-testing a batch that was
--     signed off last week would be make-work.
-- Both go straight to Ready to Dispatch.
--
-- Rollback: 20261115120001_fms_production_drop_pm_transfer_move_mc_rollback.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. PRODUCTION ENTRY now advances to PACKING ENTRY (was M/C testing).
--    Based on 20260729120100_fms_production_reorder_chain.sql.
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
    status = 'awaiting_packing', current_step = 'packing_entry'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_entry',
    'Production entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for the packing entry.',
    public.fms_production_step_owner_ids('packing_entry'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_production(uuid, jsonb) to authenticated;

-- Production entry is editable until the PACKING ENTRY is recorded (was M/C).
create or replace function public.fms_production_pe_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pe_at is not null and r.status = 'awaiting_packing');
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
    raise exception 'The production entry can no longer be edited: the packing entry has already been recorded (status %).', v_status;
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

-- ---------------------------------------------------------------------------
-- 2. Helper: does this card still owe an M/C test?
--    The ONE place the branch rule lives, so the record RPC and the resume /
--    un-hold path cannot disagree about where a packed card belongs.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_needs_mc_testing(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req
      and coalesce(r.card_type, 'production') <> 'repackaging'
      and r.mc_at is null);
$$;
grant execute on function public.fms_production_needs_mc_testing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. PACKING ENTRY now advances to M/C TESTING (was ready to dispatch), except
--    for the two cases in section 2. Based on 20260903120700.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_packing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid(); v_card text;
  v_net numeric; v_packed numeric; v_mc boolean;
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

  v_mc := public.fms_production_needs_mc_testing(p_req);

  update public.fms_production_requests set
    pk_actual_date = coalesce(nullif(p->>'pk_actual_date','')::date, current_date),
    pk_status      = nullif(trim(p->>'pk_status'), ''),
    packed_qty     = nullif(p->>'packed_qty','')::numeric,
    loose_ink_qty  = nullif(p->>'loose_ink_qty','')::numeric,
    pk_remarks     = nullif(trim(p->>'pk_remarks'), ''),
    -- null on a production card -> both figures keep their log book values.
    ts_packed_qty  = coalesce(v_packed, ts_packed_qty),
    ts_loose_qty   = case when v_packed is null then ts_loose_qty else round(v_net - v_packed, 3) end,
    pk_at = coalesce(pk_at, now()), pk_by = coalesce(pk_by, v_uid),
    status       = case when v_mc then 'awaiting_mc_testing' else 'awaiting_ready_to_dispatch' end,
    current_step = case when v_mc then 'mc_testing'          else 'ready_to_dispatch'          end
  where id = p_req;

  if v_mc then
    perform public.fms_production_announce('request', p_req, 'packing_entry',
      'Packing entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for M/C testing.',
      public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
  else
    perform public.fms_production_announce('request', p_req, 'packing_entry',
      'Packing entry recorded for ' || coalesce(v_no,'a job card') || ' — ready to dispatch.',
      public.fms_production_step_owner_ids('ready_to_dispatch'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_packing(uuid, jsonb) to authenticated;

-- Packing is editable until the step AFTER it is recorded — which is now M/C
-- testing for most cards and ready-to-dispatch for the branch cases, so BOTH
-- statuses count as "still editable".
create or replace function public.fms_production_pk_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pk_at is not null
      and r.status in ('awaiting_mc_testing', 'awaiting_ready_to_dispatch'));
$$;
grant execute on function public.fms_production_pk_editable(uuid) to authenticated;

create or replace function public.fms_production_update_packing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_card text; v_net numeric; v_packed numeric;
begin
  select status, req_no, card_type, round(coalesce(actual_qty,0) - coalesce(pe_lab_qty,0), 3)
    into v_status, v_no, v_card, v_net
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('packing_entry', p_req, v_uid) then raise exception 'Not authorized to edit the packing entry'; end if;
  if not public.fms_production_pk_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing entry can no longer be edited: the card has already moved on (status %).', v_status;
  end if;

  if v_card = 'repackaging' and p ? 'ts_packed_qty' then
    v_packed := nullif(trim(p->>'ts_packed_qty'), '')::numeric;
    if v_packed is null then raise exception 'The packed quantity is required.'; end if;
    if v_packed < 0 then raise exception 'The packed quantity cannot be negative.'; end if;
    if v_packed > v_net then raise exception 'The packed quantity cannot be more than the net quantity for packing (%).', v_net; end if;
  end if;

  update public.fms_production_requests set
    pk_actual_date = coalesce(nullif(p->>'pk_actual_date','')::date, pk_actual_date),
    pk_status      = nullif(trim(p->>'pk_status'), ''),
    packed_qty     = nullif(p->>'packed_qty','')::numeric,
    loose_ink_qty  = nullif(p->>'loose_ink_qty','')::numeric,
    pk_remarks     = nullif(trim(p->>'pk_remarks'), ''),
    ts_packed_qty  = coalesce(v_packed, ts_packed_qty),
    ts_loose_qty   = case when v_packed is null then ts_loose_qty else round(v_net - v_packed, 3) end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'packing_edited',
    format('Packing entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_packing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. M/C TESTING now advances to READY TO DISPATCH (was pm_transfer).
--    Approve / reject / admin-only bypass are unchanged. Based on 20260729120400.
-- ---------------------------------------------------------------------------
comment on column public.fms_production_requests.mc_status is
  'M/C testing result: approved | rejected | bypassed. Recorded AFTER the packing entry; approval or bypass advances the card to ready to dispatch, a rejection keeps it in M/C testing for a re-test. Bypass is admin-only and stamps mc_bypassed_by/at.';

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
      status = 'awaiting_ready_to_dispatch', current_step = 'ready_to_dispatch'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'mc_testing',
      'M/C testing ' || v_result || ' for ' || coalesce(v_no,'a job card') || ' — ready to dispatch.',
      public.fms_production_step_owner_ids('ready_to_dispatch'), jsonb_build_object('req_no', v_no));
  else
    perform public.fms_production_announce('request', p_req, 'mc_testing_rejected',
      'M/C testing rejected for ' || coalesce(v_no,'a job card') || ' — a re-test is required.',
      public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_mc_testing(uuid, jsonb) to authenticated;

-- M/C testing now editable until the card is marked ready to dispatch.
create or replace function public.fms_production_mc_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.mc_at is not null and r.status = 'awaiting_ready_to_dispatch');
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
    raise exception 'M/C testing can no longer be edited: the card has already been marked ready to dispatch (status %).', v_status;
  end if;

  update public.fms_production_requests set
    mc_actual_date     = coalesce(nullif(p->>'mc_actual_date','')::date, mc_actual_date),
    mc_remarks         = nullif(trim(p->>'mc_remarks'), ''),
    mc_attachment_path = case when p ? 'mc_attachment_path' then nullif(p->>'mc_attachment_path','') else mc_attachment_path end,
    mc_attachment_name = case when p ? 'mc_attachment_name' then nullif(p->>'mc_attachment_name','') else mc_attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'mc_testing_edited',
    format('M/C testing on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_mc_testing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. resume_status — un-holding a card must land it on a step that still exists.
--    'pm_transfer' now resolves to the packing entry; 'packing_entry' resolves
--    through the same branch rule as section 3 rather than assuming M/C is next.
--    Based on 20260729120500.
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
    -- The dropped step: a card parked on it comes back to the packing entry.
    when 'pm_transfer'            then 'awaiting_packing'
    when 'packing_entry'          then (case when r.pk_at is null then 'awaiting_packing'
                                             when public.fms_production_needs_mc_testing(p_req) then 'awaiting_mc_testing'
                                             else 'awaiting_ready_to_dispatch' end)
    when 'mc_testing'             then (case when r.mc_at is not null then 'awaiting_ready_to_dispatch' else 'awaiting_mc_testing' end)
    when 'ready_to_dispatch'      then 'awaiting_ready_to_dispatch'
    when 'fg_transfer'            then (case when r.fg_at is not null then 'closed' else 'awaiting_fg_transfer' end)
    else 'awaiting_material_handover'
  end
  from public.fms_production_requests r where r.id = p_req;
$$;
grant execute on function public.fms_production_resume_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. REPACKAGING INTAKE — a repackaging card is now raised straight into the
--    PACKING ENTRY (it used to be raised into pm_transfer, which no longer
--    exists). Everything else is verbatim from 20260925120000; the ONLY changes
--    are the landing status/step and the two words in its announcement.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_no     text;
  v_seq    integer;
  v_bseq   integer;
  v_batch  text;
  -- ⚠ v_fy is not initialised here: it depends on v_issue, which is only known
  --   once the payload has been read.
  v_fy     text;
  v_uid    uuid  := auth.uid();
  v_name   text  := nullif(trim(p->>'requester_name'), '');
  v_lines  jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first  jsonb;
  v_rm     text;
  v_qty    text;
  v_unit   text;
  v_type   text;
  v_pack   jsonb;
  v_fg     numeric;
  v_lot    text;
  v_today  date;
  v_issue  date;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Raise-Request authorization: open to all module users unless issue_slip has
  -- owners configured, in which case only they / admin / coordinator may raise.
  -- Identical for both card types — a repackaging slip is still an issue slip.
  if exists (
    select 1 from public.fms_production_step_owners
    where step_key = 'issue_slip' and coalesce(array_length(employee_ids, 1), 0) > 0
  ) and not public.fms_production_can_act('issue_slip', null, v_uid) then
    raise exception 'You are not authorized to raise a job card. Ask an admin to add you as an owner of the Raise Request step.';
  end if;

  v_type := lower(coalesce(nullif(trim(p->>'card_type'), ''), 'production'));
  if v_type not in ('production','repackaging') then
    raise exception 'Unknown card type %', v_type;
  end if;

  -- The job date. IST, never UTC — see 20260903120200. Shared by both card types.
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_issue := coalesce(nullif(trim(p->>'issue_date'), '')::date, v_today);
  if v_issue > v_today then
    raise exception 'The job date cannot be in the future.';
  end if;
  -- The financial year of the job, not of the moment it was typed.
  v_fy := public.fms_production_fy_code(v_issue);

  -- =======================================================================
  -- REPACKAGING. Returns early so the production path below stays untouched.
  -- =======================================================================
  if v_type = 'repackaging' then
    if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then
      raise exception 'Finished-good item is required';
    end if;

    v_fg := nullif(trim(p->>'fg_qty'), '')::numeric;
    if v_fg is null or v_fg <= 0 then
      raise exception 'Enter the quantity to repack';
    end if;

    -- The incoming FG lot. Mandatory: it is what every downstream step traces
    -- the repacked goods back to, and there is no way to recover it later.
    v_lot := nullif(trim(p->>'fg_lot_no'), '');
    if v_lot is null then
      raise exception 'The FG item lot number is required on a repackaging slip';
    end if;

    -- Same helper the log book uses, so extra/total are computed identically.
    v_pack := coalesce(p->'pmh_bom_lines', '[]'::jsonb);
    if jsonb_typeof(v_pack) <> 'array' then raise exception 'pmh_bom_lines must be a JSON array'; end if;
    v_pack := public.fms_production_pack_lines(v_pack);
    if jsonb_array_length(v_pack) = 0 then
      raise exception 'At least one packaging item is required';
    end if;

    if v_name is null then
      v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
    end if;

    v_seq := public.fms_production_next_seq('PRD-' || v_fy);
    v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

    -- THE SAME counter as a production card — one unbroken series. The MONTH
    -- comes from the job date, so a back-dated job carries that month's prefix.
    v_bseq  := public.fms_production_next_batch_seq();
    v_batch := to_char(v_issue, 'YY') || to_char(v_issue, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

    -- No wastage: packed = FG qty, and loss/scrap/lab are zero.
    insert into public.fms_production_requests (
      req_no, jobcard_no, card_type, issue_date, fg_item_id, fg_qty, fg_lot_no,
      bom_lines, issue_remarks, raised_by, requester_name,
      pe_expected_qty, ts_production_loss, scrap_qty, actual_qty, pe_lab_qty,
      ts_packed_qty, ts_loose_qty, pmh_qty, pmh_bom_lines,
      status, current_step, submitted_at
    ) values (
      v_no,
      v_batch,
      'repackaging',
      v_issue,
      (p->>'fg_item_id')::uuid,
      v_fg,
      v_lot,
      '[]'::jsonb,
      nullif(trim(p->>'issue_remarks'), ''),
      v_uid, v_name,
      v_fg, 0, 0, v_fg, 0,
      v_fg, 0, v_fg, v_pack,
      'awaiting_packing', 'packing_entry', now()
    )
    returning id into v_id;

    perform public.fms_production_announce(
      'request', v_id, 'raised',
      'Repackaging card ' || v_no || ' (' || v_batch || ', FG lot ' || v_lot || ') raised — ready for the packing entry.',
      public.fms_production_step_owner_ids('packing_entry'),
      jsonb_build_object('req_no', v_no, 'card_type', 'repackaging')
    );

    return v_id;
  end if;

  -- =======================================================================
  -- PRODUCTION — verbatim from 20260903120200. Do not alter.
  -- =======================================================================

  -- Normalise the BOM: must be an array; drop blank rows (no raw_material_id).
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'bom_lines must be a JSON array';
  end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;  -- NULL when the BOM is empty

  v_rm   := coalesce(nullif(trim(v_first->>'raw_material_id'), ''), nullif(trim(p->>'raw_material_id'), ''));
  v_qty  := coalesce(nullif(v_first->>'required_qty', ''),          nullif(p->>'required_qty', ''));
  v_unit := coalesce(nullif(v_first->>'unit_id', ''),               nullif(p->>'unit_id', ''));

  if v_rm is null then raise exception 'At least one raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  -- Internal reference number (PRD-2627-0001).
  v_seq := public.fms_production_next_seq('PRD-' || v_fy);
  v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  -- Lot/Batch (Issue Slip) number: YYMM-NNNN, continuous NNNN. YYMM is the JOB's
  -- month, so a back-dated card belongs to the month it was actually made in.
  v_bseq  := public.fms_production_next_batch_seq();
  v_batch := to_char(v_issue, 'YY') || to_char(v_issue, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

  insert into public.fms_production_requests (
    req_no, jobcard_no, issue_date, category_id, raw_material_id, required_qty, unit_id, fg_item_id, fg_qty,
    bom_lines, issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    v_batch,
    v_issue,
    nullif(p->>'category_id','')::uuid,
    v_rm::uuid,
    nullif(v_qty,'')::numeric,
    nullif(v_unit,'')::uuid,
    (p->>'fg_item_id')::uuid,
    nullif(p->>'fg_qty','')::numeric,
    v_lines,
    nullif(trim(p->>'issue_remarks'), ''),
    v_uid, v_name,
    'awaiting_material_handover', 'material_handover', now()
  )
  returning id into v_id;

  perform public.fms_production_announce(
    'request', v_id, 'raised',
    'Job card ' || v_no || ' (' || v_batch || ') raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_production_submit_request(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. MOVE THE CARDS IN FLIGHT.
--
--    Both groups land on the PACKING ENTRY, and section 3's branch then sends
--    each to the right next step on its own:
--
--    a) awaiting_pm_transfer — the step being deleted. These cards already have
--       mc_at set (they passed M/C under the old order), so after packing they
--       go straight to ready-to-dispatch and are not re-tested. Repackaging
--       cards here have no mc_at but are exempt by card type, same result.
--
--    b) awaiting_mc_testing — NOT yet packed and NOT yet tested. Under the new
--       order packing comes first, so they pack, then test. Nothing is skipped.
--
--    ⚠ on_hold cards are deliberately untouched: their parked step lives in
--      current_step, and section 5 already redirects 'pm_transfer' on resume.
-- ---------------------------------------------------------------------------
update public.fms_production_requests
   set status = 'awaiting_packing', current_step = 'packing_entry'
 where status in ('awaiting_pm_transfer', 'awaiting_mc_testing');

-- A held card whose parked step was the deleted one is re-parked on packing, so
-- current_step never names a step the UI no longer has.
update public.fms_production_requests
   set current_step = 'packing_entry'
 where current_step = 'pm_transfer'
   and status in ('on_hold', 'cancelled');

-- The step-owner row for the dropped step is left in place (additive-only); it
-- simply stops being read. Same for any SLA entry keyed 'pm_transfer'.

-- ---------------------------------------------------------------------------
-- 8. THE DUE-DATE ANCHORS (Setup → Due Dates).
--
--    Each step's SLA row names the step whose completion starts its clock. Those
--    anchors were stored against the OLD chain, so after the reorder the Due Dates
--    screen reads:
--        Testing of M/C          After Quality   ← should be After Packing
--        FG Transfer to Godown   After Packing   ← should be After Dispatch
--
--    Both are still LEGAL anchors (each names a strictly earlier step, so
--    resolveStepSla keeps them) — which is exactly why they had to be corrected
--    here rather than being dropped as invalid on load. Every other step already
--    reads correctly: those rows carry no stored anchor, so they fall through to
--    the code default of "the step before me", which the new STEPS order fixed.
--
--    ⚠ LABELS, not arithmetic. Production Entry computes a due date from its own
--      ANCHOR_AT map in lib/queues.ts, which the reorder already corrected; the
--      stored `anchor` is what the settings screen SAYS. Left alone it would keep
--      describing a chain that no longer exists. `days` is deliberately untouched
--      — the numbers on that screen are the admin's, not ours.
--
--    Only the two stale keys are rewritten; jsonb_set leaves the rest of the map,
--    and every `days` value in it, exactly as the admin last saved it.
-- ---------------------------------------------------------------------------
update public.fms_production_config
   set value = jsonb_set(
                 jsonb_set(
                   value,
                   '{mc_testing,anchor}',  '"packing_entry"'::jsonb, true),
                 '{fg_transfer,anchor}',   '"ready_to_dispatch"'::jsonb, true),
       updated_at = now()
 where key = 'step_sla'
   and (
         (value -> 'mc_testing'  ->> 'anchor') is distinct from 'packing_entry'
      or (value -> 'fg_transfer' ->> 'anchor') is distinct from 'ready_to_dispatch'
       );

-- The dropped step's own SLA row is left in place (additive-only); nothing reads
-- it now that pm_transfer is not in STEPS.

-- ---------------------------------------------------------------------------
-- 9. THE DROPPED STEP'S OWNERS — carry them to the Packing Entry.
--
--    ⚠ WITHOUT THIS THE WORK DISAPPEARS FOR THE PEOPLE DOING IT. Every queue is
--      filtered by fms_production_can_act(step, …) — admin, process coordinator,
--      or an OWNER OF THAT STEP. Whoever was named on pm_transfer could see those
--      cards only because they owned pm_transfer. Section 7 moves the cards to
--      packing_entry; if the owners do not move with them, the cards are still
--      there, still open, and simply invisible to the team responsible for them.
--      A non-owner does not even get the Packing Entry nav link (canSeeQueue).
--
--    Owners are UNIONed, never replaced: the packing team keeps its own people and
--    gains the packing-material transfer's. Duplicates are removed. The department
--    filter is merged the same way; designation_id is left alone, since two steps
--    can name different designations and there is no defensible way to pick one.
--
--    The pm_transfer row itself stays (additive-only) and is simply never read.
-- ---------------------------------------------------------------------------
-- The packing row may not exist yet (a step with no owners has no row at all).
insert into public.fms_production_step_owners (step_key)
select 'packing_entry'
where exists (select 1 from public.fms_production_step_owners where step_key = 'pm_transfer')
  and not exists (select 1 from public.fms_production_step_owners where step_key = 'packing_entry');

update public.fms_production_step_owners pk
   set department_ids = array(select distinct unnest(pk.department_ids || pm.department_ids)),
       employee_ids   = array(select distinct unnest(pk.employee_ids   || pm.employee_ids)),
       updated_at     = now()
  from public.fms_production_step_owners pm
 where pk.step_key = 'packing_entry'
   and pm.step_key = 'pm_transfer';
