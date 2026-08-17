-- Packing Material Transfer: capture the production-entry Tally no. on REPACKAGING cards.
--
-- A production card posts its production entry at its own step (`production_entry`),
-- and the packing-material transfer merely shows the number back. A repackaging card
-- bypasses that step entirely — nothing is manufactured, so there is no production
-- entry to record — yet the Tally posting still happens and its voucher number still
-- has to be on the card for the packing entry and the FG transfer that follow.
--
-- So the packing-material transfer becomes the place it is taken, for repackaging
-- cards ONLY.
--
-- ⚠ A PRODUCTION CARD'S `pe_tally_entry` IS NEVER TOUCHED HERE. `v_tally` is left
--   null unless the card is a repackaging one, and the assignment coalesces onto the
--   stored value — so for every existing production card this function writes back
--   exactly what was already there. Additive: no column added, no data rewritten,
--   two function bodies replaced.

create or replace function public.fms_production_record_pm_transfer(p_req uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_card text; v_tally text;
begin
  select status, req_no, card_type into v_status, v_no, v_card from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_pm_transfer' then raise exception 'This job card is not awaiting packing-material transfer (status %)', v_status; end if;
  if not public.fms_production_can_act('pm_transfer', p_req, v_uid) then raise exception 'Not authorized to record packing-material transfer'; end if;

  -- Repackaging only: this step is where the production entry Tally no. is taken,
  -- and it is required here for the same reason it is required at the production
  -- entry step of a normal card.
  if v_card = 'repackaging' then
    v_tally := nullif(trim(p->>'pe_tally_entry'), '');
    if v_tally is null then raise exception 'The production entry Tally number is required.'; end if;
  end if;

  update public.fms_production_requests set
    pmt_actual_date = coalesce(nullif(p->>'pmt_actual_date','')::date, current_date),
    pmt_status      = nullif(trim(p->>'pmt_status'), ''),
    pmt_qty         = nullif(p->>'pmt_qty','')::numeric,
    pmt_remarks     = nullif(trim(p->>'pmt_remarks'), ''),
    -- null on a production card → its own value is kept verbatim.
    pe_tally_entry  = coalesce(v_tally, pe_tally_entry),
    pmt_at = coalesce(pmt_at, now()), pmt_by = coalesce(pmt_by, v_uid),
    status = 'awaiting_packing', current_step = 'packing_entry'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_transfer',
    'Packing material transferred to production for ' || coalesce(v_no,'a job card') || ' — ready for packing entry.',
    public.fms_production_step_owner_ids('packing_entry'), jsonb_build_object('req_no', v_no));
end $function$;

create or replace function public.fms_production_update_pm_transfer(p_req uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_card text; v_tally text;
begin
  select status, req_no, card_type into v_status, v_no, v_card from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('pm_transfer', p_req, v_uid) then raise exception 'Not authorized to edit the packing-material transfer'; end if;
  if not public.fms_production_pmt_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The packing-material transfer can no longer be edited: packing entry has already been recorded (status %).', v_status;
  end if;

  if v_card = 'repackaging' then
    v_tally := nullif(trim(p->>'pe_tally_entry'), '');
    if v_tally is null then raise exception 'The production entry Tally number is required.'; end if;
  end if;

  update public.fms_production_requests set
    pmt_actual_date = coalesce(nullif(p->>'pmt_actual_date','')::date, pmt_actual_date),
    pmt_status      = nullif(trim(p->>'pmt_status'), ''),
    pmt_qty         = nullif(p->>'pmt_qty','')::numeric,
    pmt_remarks     = nullif(trim(p->>'pmt_remarks'), ''),
    pe_tally_entry  = coalesce(v_tally, pe_tally_entry),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'pm_transfer_edited',
    format('Packing-material transfer on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $function$;
