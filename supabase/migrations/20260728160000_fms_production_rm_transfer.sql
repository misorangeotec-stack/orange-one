-- ===========================================================================
-- PRODUCTION ENTRY FMS — NEW STEP "RM TRANSFER TO PRODUCTION".
--
-- Inserts a step between Material Handover and Log Book Entry. The card flows:
--   material_handover -> rm_transfer -> transfer_slip (Log Book) -> production ...
-- The step shows the handover details (read-only) and captures the Tally
-- location-transfer entry, then advances to the log book.
--
-- Additive: a new status value, five rmt_* columns, one record + one update RPC.
-- The handover RPC is repointed to advance into rm_transfer, and resume_status
-- gains the new node. Reversal: drop the two RPCs + the columns, restore the
-- status check + handover advance + resume_status.
-- ===========================================================================

-- New status value (widening the check — every existing value is retained).
alter table public.fms_production_requests drop constraint if exists fms_production_requests_status_check;
alter table public.fms_production_requests add constraint fms_production_requests_status_check
  check (status in (
    'awaiting_material_handover','awaiting_rm_transfer','awaiting_transfer_slip',
    'awaiting_production','awaiting_quality','awaiting_mc_testing',
    'awaiting_pm_handover','awaiting_pm_transfer','awaiting_packing',
    'awaiting_fg_transfer','closed','on_hold','cancelled'));

-- Step columns (rmt_ prefix — distinct from pm_transfer's pmt_).
alter table public.fms_production_requests add column if not exists rmt_actual_date date;
alter table public.fms_production_requests add column if not exists rmt_tally_entry text;
alter table public.fms_production_requests add column if not exists rmt_remarks    text;
alter table public.fms_production_requests add column if not exists rmt_at         timestamptz;
alter table public.fms_production_requests add column if not exists rmt_by         uuid references auth.users on delete set null;

comment on column public.fms_production_requests.rmt_tally_entry is
  'RM Transfer to Production (the Tally location-transfer entry) recorded between the material handover and the log book entry.';

-- ---------------------------------------------------------------------------
-- resume_status gains the rm_transfer node (held cards return to the right step).
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_resume_status(p_req uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when r.fg_at  is not null then 'closed'
    when r.pk_at  is not null then 'awaiting_fg_transfer'
    when r.pmt_at is not null then 'awaiting_packing'
    when r.pmh_at is not null then 'awaiting_pm_transfer'
    when r.mc_at  is not null then 'awaiting_pm_handover'
    when r.qc_at  is not null then 'awaiting_mc_testing'
    when r.pe_at  is not null then 'awaiting_quality'
    when r.ts_at  is not null then 'awaiting_production'
    when r.rmt_at is not null then 'awaiting_transfer_slip'
    when r.mh_at  is not null then 'awaiting_rm_transfer'
    else 'awaiting_material_handover'
  end
  from public.fms_production_requests r where r.id = p_req;
$$;
grant execute on function public.fms_production_resume_status(uuid) to authenticated;

-- The handover is now editable while the card awaits rm_transfer (its new next
-- status), not awaiting_transfer_slip.
create or replace function public.fms_production_mh_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.mh_at is not null and r.status = 'awaiting_rm_transfer');
$$;
grant execute on function public.fms_production_mh_editable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Handover now advances into rm_transfer (body otherwise per 20260728150000).
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
    status = 'awaiting_rm_transfer', current_step = 'rm_transfer'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'material_handover',
    'Material handover confirmed for ' || coalesce(v_no,'a job card') || ' — ready for RM transfer to production.',
    public.fms_production_step_owner_ids('rm_transfer'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_material_handover(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RECORD (rm_transfer -> transfer_slip): capture the Tally entry (required).
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_record_rm_transfer(uuid, jsonb);
create or replace function public.fms_production_record_rm_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_rm_transfer' then raise exception 'This job card is not awaiting RM transfer to production (status %)', v_status; end if;
  if not public.fms_production_can_act('rm_transfer', p_req, v_uid) then raise exception 'Not authorized to record the RM transfer'; end if;
  if coalesce(nullif(trim(p->>'rmt_tally_entry'), ''), '') = '' then raise exception 'A Tally entry is required'; end if;

  update public.fms_production_requests set
    rmt_actual_date = coalesce(nullif(p->>'rmt_actual_date','')::date, current_date),
    rmt_tally_entry = nullif(trim(p->>'rmt_tally_entry'), ''),
    rmt_remarks     = nullif(trim(p->>'rmt_remarks'), ''),
    rmt_at = coalesce(rmt_at, now()), rmt_by = coalesce(rmt_by, v_uid),
    status = 'awaiting_transfer_slip', current_step = 'transfer_slip'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'rm_transfer',
    'RM transferred to production for ' || coalesce(v_no,'a job card') || ' — ready for log book entry.',
    public.fms_production_step_owner_ids('transfer_slip'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_rm_transfer(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Edit-until-next-step for rm_transfer.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_rmt_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.rmt_at is not null and r.status = 'awaiting_transfer_slip');
$$;
grant execute on function public.fms_production_rmt_editable(uuid) to authenticated;

drop function if exists public.fms_production_update_rm_transfer(uuid, jsonb);
create or replace function public.fms_production_update_rm_transfer(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('rm_transfer', p_req, v_uid) then raise exception 'Not authorized to edit the RM transfer'; end if;
  if not public.fms_production_rmt_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The RM transfer can no longer be edited: the log book entry has already been recorded (status %).', v_status;
  end if;
  if coalesce(nullif(trim(p->>'rmt_tally_entry'), ''), '') = '' then raise exception 'A Tally entry is required'; end if;

  update public.fms_production_requests set
    rmt_actual_date = coalesce(nullif(p->>'rmt_actual_date','')::date, rmt_actual_date),
    rmt_tally_entry = nullif(trim(p->>'rmt_tally_entry'), ''),
    rmt_remarks     = nullif(trim(p->>'rmt_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'rm_transfer_edited',
    format('RM transfer on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_rm_transfer(uuid, jsonb) to authenticated;
