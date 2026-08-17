-- Packing Entry: let a REPACKAGING card set its packed quantity, and derive the loose.
--
-- A production card arrives here with both figures already decided — they were
-- entered in the log book, and this step is a review. A repackaging card has no log
-- book: at intake its packed quantity was simply assumed to be the whole FG
-- quantity. Reality can differ (part of the lot goes out loose), so this is the step
-- where the split is actually made.
--
-- Loose is DERIVED, never sent: net (actual output − lab) minus packed. Accepting a
-- client-supplied loose figure is how the two drift apart.
--
-- ⚠ THE PRODUCTION PATH IS UNCHANGED. `v_packed` stays null unless the card is a
--   repackaging one AND the key is present, and both assignments coalesce onto the
--   stored value — so for a production card these functions write back exactly what
--   was already there. No column added, no data rewritten.

create or replace function public.fms_production_record_packing(p_req uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    -- null on a production card -> both figures keep their log book values.
    ts_packed_qty  = coalesce(v_packed, ts_packed_qty),
    ts_loose_qty   = case when v_packed is null then ts_loose_qty else round(v_net - v_packed, 3) end,
    pk_at = coalesce(pk_at, now()), pk_by = coalesce(pk_by, v_uid),
    status = 'awaiting_ready_to_dispatch', current_step = 'ready_to_dispatch'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'packing_entry',
    'Packing entry recorded for ' || coalesce(v_no,'a job card') || ' — ready to dispatch.',
    public.fms_production_step_owner_ids('ready_to_dispatch'), jsonb_build_object('req_no', v_no));
end $function$;

create or replace function public.fms_production_update_packing(p_req uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_card text; v_net numeric; v_packed numeric;
begin
  select status, req_no, card_type, round(coalesce(actual_qty,0) - coalesce(pe_lab_qty,0), 3)
    into v_status, v_no, v_card, v_net
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('packing_entry', p_req, v_uid) then raise exception 'Not authorized to edit the packing entry'; end if;
  if not public.fms_production_pk_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing entry can no longer be edited: the card has already been marked ready to dispatch (status %).', v_status;
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
end $function$;
