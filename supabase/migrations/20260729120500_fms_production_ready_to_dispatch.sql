-- ===========================================================================
-- PRODUCTION ENTRY FMS — NEW STEP "READY TO DISPATCH" (multi-select holding bay).
--
-- After the Packing Entry, cards land in a new READY TO DISPATCH stage instead of
-- going straight to FG Transfer. There a user reviews each FG (batch card no, FG
-- item, packed qty, production Tally entry), selects one or MANY, and marks them
-- ready — moving the selected cards on to FG Transfer to Godown.
--
-- Also finalises the whole reorder's resume point: fms_production_resume_status
-- now derives from current_step (robust across the additional-issue-slip loop),
-- not from a timestamp ladder.
--
-- Additive: awaiting_ready_to_dispatch status, rtd_at/rtd_by, the bulk mark RPC.
-- Replace-only: record/update_packing (successor → ready_to_dispatch) + resume.
-- ===========================================================================

alter table public.fms_production_requests drop constraint if exists fms_production_requests_status_check;
alter table public.fms_production_requests add constraint fms_production_requests_status_check
  check (status in (
    'awaiting_material_handover','awaiting_rm_transfer','awaiting_transfer_slip',
    'awaiting_production','awaiting_quality','awaiting_additional_issue_slip',
    'awaiting_mc_testing','awaiting_pm_handover','awaiting_pm_transfer',
    'awaiting_packing','awaiting_ready_to_dispatch','awaiting_fg_transfer',
    'closed','on_hold','cancelled'));

alter table public.fms_production_requests add column if not exists rtd_at timestamptz;
alter table public.fms_production_requests add column if not exists rtd_by uuid references auth.users on delete set null;
comment on column public.fms_production_requests.rtd_at is
  'Ready to Dispatch: when the card was marked ready (moved from packing to FG transfer), via the bulk mark RPC.';

-- Packing entry now advances to READY TO DISPATCH (was FG transfer).
create or replace function public.fms_production_record_packing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_packing' then raise exception 'This job card is not awaiting packing entry (status %)', v_status; end if;
  if not public.fms_production_can_act('packing_entry', p_req, v_uid) then raise exception 'Not authorized to record packing entry'; end if;

  update public.fms_production_requests set
    pk_actual_date = coalesce(nullif(p->>'pk_actual_date','')::date, current_date),
    pk_status      = nullif(trim(p->>'pk_status'), ''),
    packed_qty     = nullif(p->>'packed_qty','')::numeric,
    loose_ink_qty  = nullif(p->>'loose_ink_qty','')::numeric,
    pk_remarks     = nullif(trim(p->>'pk_remarks'), ''),
    pk_at = coalesce(pk_at, now()), pk_by = coalesce(pk_by, v_uid),
    status = 'awaiting_ready_to_dispatch', current_step = 'ready_to_dispatch'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'packing_entry',
    'Packing entry recorded for ' || coalesce(v_no,'a job card') || ' — ready to dispatch.',
    public.fms_production_step_owner_ids('ready_to_dispatch'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_packing(uuid, jsonb) to authenticated;

-- Packing entry editable until the card is marked ready to dispatch.
create or replace function public.fms_production_pk_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pk_at is not null and r.status = 'awaiting_ready_to_dispatch');
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
    raise exception 'The packing entry can no longer be edited: the card has already been marked ready to dispatch (status %).', v_status;
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
-- BULK — mark the selected cards ready to dispatch (→ FG transfer). Skips cards
-- not in awaiting_ready_to_dispatch or that the caller may not act on. Returns
-- how many were moved.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_mark_ready_to_dispatch(p_reqs uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_status text; v_no text; v_count int := 0;
begin
  if p_reqs is null or array_length(p_reqs, 1) is null then return 0; end if;
  foreach v_id in array p_reqs loop
    select status, req_no into v_status, v_no from public.fms_production_requests where id = v_id for update;
    if v_status is null or v_status <> 'awaiting_ready_to_dispatch' then continue; end if;
    if not public.fms_production_can_act('ready_to_dispatch', v_id, v_uid) then continue; end if;

    update public.fms_production_requests set
      rtd_at = coalesce(rtd_at, now()), rtd_by = coalesce(rtd_by, v_uid),
      status = 'awaiting_fg_transfer', current_step = 'fg_transfer'
    where id = v_id;

    perform public.fms_production_announce('request', v_id, 'ready_to_dispatch',
      'Marked ready to dispatch: ' || coalesce(v_no,'a job card') || ' — ready for FG transfer to godown.',
      public.fms_production_step_owner_ids('fg_transfer'), jsonb_build_object('req_no', v_no));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
grant execute on function public.fms_production_mark_ready_to_dispatch(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- resume_status — now derived from current_step (robust across the additional-
-- issue-slip loop, where base *_at timestamps no longer imply the open step).
-- Un-hold restores the card to exactly the step it was parked on.
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
