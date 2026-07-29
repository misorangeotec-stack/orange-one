-- ===========================================================================
-- ASSET MAINTENANCE FMS — STAGE EDITS (Phase 6).
--
-- Correct a step that has already been recorded, WITHOUT re-running the chain.
-- Each step gets a pair:
--   fms_asset_<pfx>_editable(p_job)  — may this step still be corrected?
--   fms_asset_update_<step>(p_job,p) — apply the correction
--
-- THE RULE: a step is editable until the NEXT step has been actioned. Once the
-- service is recorded, the scheduling details are history; changing them would
-- rewrite the account of what happened.
--
-- `verify_close` is the exception and stays editable after close — it is the last
-- step, so nothing downstream can contradict it. This matches Order to Dispatch's
-- treatment of its own final step.
--
-- ⚠ CLOSING IS NOT RE-RUN BY AN EDIT. fms_asset_update_verify_close deliberately
--   does NOT touch fms_asset_schedules.next_due_date. Advancing the track is a
--   one-time consequence of closing; letting an edit re-advance it would push the
--   next service out by another full interval every time somebody fixed a typo.
--   Correcting a wrong next-due date is done on the schedule itself
--   (fms_asset_upsert_schedule), where it is visible and deliberate.
--
-- The server is the gate; frontend/src/apps/asset-maintenance/lib/queues.ts
-- mirrors these predicates only so the UI can grey a button and SAY WHY.
--
-- Purely ADDITIVE.
-- Reversal:
--   drop function if exists public.fms_asset_update_verify_close(uuid,jsonb);
--   drop function if exists public.fms_asset_update_service_done(uuid,jsonb);
--   drop function if exists public.fms_asset_update_schedule(uuid,jsonb);
--   drop function if exists public.fms_asset_vc_editable(uuid);
--   drop function if exists public.fms_asset_sd_editable(uuid);
--   drop function if exists public.fms_asset_sc_editable(uuid);
-- ===========================================================================

-- ---- editability predicates -----------------------------------------------
create or replace function public.fms_asset_sc_editable(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_asset_jobs j
    where j.id = p_job and j.sc_at is not null and j.status = 'awaiting_service'
  );
$$;
grant execute on function public.fms_asset_sc_editable(uuid) to authenticated;

create or replace function public.fms_asset_sd_editable(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_asset_jobs j
    where j.id = p_job and j.sd_at is not null and j.status = 'awaiting_verification'
  );
$$;
grant execute on function public.fms_asset_sd_editable(uuid) to authenticated;

create or replace function public.fms_asset_vc_editable(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_asset_jobs j
    where j.id = p_job and j.vc_at is not null and j.status = 'closed'
  );
$$;
grant execute on function public.fms_asset_vc_editable(uuid) to authenticated;

-- ---- step 2: schedule -------------------------------------------------------
create or replace function public.fms_asset_update_schedule(p_job uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_no      text;
  v_planned date := nullif(p->>'sc_planned_date','')::date;
begin
  select job_no into v_no from public.fms_asset_jobs where id = p_job for update;
  if v_no is null then raise exception 'Service job not found'; end if;
  if not public.fms_asset_sc_editable(p_job) then
    raise exception 'The scheduling details can no longer be changed - the service has already been recorded';
  end if;
  if not public.fms_asset_can_act('schedule', p_job, v_uid) then
    raise exception 'Not authorized to change this schedule';
  end if;
  if v_planned is null then raise exception 'Enter the date the service is planned for'; end if;

  update public.fms_asset_jobs set
    sc_actual_date  = coalesce(nullif(p->>'sc_actual_date','')::date, sc_actual_date),
    sc_planned_date = v_planned,
    sc_vendor_id    = case when p ? 'sc_vendor_id' then nullif(p->>'sc_vendor_id','')::uuid else sc_vendor_id end,
    sc_remarks      = case when p ? 'sc_remarks'   then nullif(trim(p->>'sc_remarks'),'')   else sc_remarks end
  where id = p_job;

  perform public.fms_asset_announce('job', p_job, 'job_schedule_edited',
    v_no || ' - scheduling details corrected.', '{}'::uuid[],
    jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_update_schedule(uuid, jsonb) to authenticated;

-- ---- step 3: service done ---------------------------------------------------
create or replace function public.fms_asset_update_service_done(p_job uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_no    text;
  v_asset uuid;
  v_date  date := nullif(p->>'sd_actual_date','')::date;
  v_meter numeric := nullif(p->>'sd_meter_reading','')::numeric;
begin
  select job_no, asset_id into v_no, v_asset from public.fms_asset_jobs where id = p_job for update;
  if v_no is null then raise exception 'Service job not found'; end if;
  if not public.fms_asset_sd_editable(p_job) then
    raise exception 'The service record can no longer be changed - it has already been verified';
  end if;
  if not public.fms_asset_can_act('service_done', p_job, v_uid) then
    raise exception 'Not authorized to change this service record';
  end if;
  if v_date is null then raise exception 'Enter the date the service was actually carried out'; end if;
  if v_date > public.fms_asset_today_ist() then raise exception 'The service date cannot be in the future'; end if;

  update public.fms_asset_jobs set
    sd_actual_date   = v_date,
    sd_vendor_id     = case when p ? 'sd_vendor_id'     then nullif(p->>'sd_vendor_id','')::uuid       else sd_vendor_id end,
    sd_cost          = case when p ? 'sd_cost'          then nullif(p->>'sd_cost','')::numeric         else sd_cost end,
    sd_cost_head_id  = case when p ? 'sd_cost_head_id'  then nullif(p->>'sd_cost_head_id','')::uuid    else sd_cost_head_id end,
    sd_bill_no       = case when p ? 'sd_bill_no'       then nullif(trim(p->>'sd_bill_no'),'')         else sd_bill_no end,
    -- Attachment contract: an ABSENT key keeps the stored bill; a present-but-
    -- blank key clears it. This is exactly the edit path where sending "" on
    -- every save would silently wipe the invoice.
    sd_bill_path     = case when p ? 'sd_bill_path'     then nullif(p->>'sd_bill_path','')             else sd_bill_path end,
    sd_bill_name     = case when p ? 'sd_bill_name'     then nullif(p->>'sd_bill_name','')             else sd_bill_name end,
    sd_meter_reading = case when p ? 'sd_meter_reading' then v_meter                                   else sd_meter_reading end,
    sd_remarks       = case when p ? 'sd_remarks'       then nullif(trim(p->>'sd_remarks'),'')         else sd_remarks end
  where id = p_job;

  if v_meter is not null then
    update public.fms_asset_assets
       set current_usage = v_meter, usage_as_on = v_date
     where id = v_asset
       and (usage_as_on is null or usage_as_on <= v_date);
  end if;

  perform public.fms_asset_announce('job', p_job, 'job_service_edited',
    v_no || ' - service record corrected.', '{}'::uuid[],
    jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_update_service_done(uuid, jsonb) to authenticated;

-- ---- step 4: verify & close -------------------------------------------------
--
-- Corrects the RECORD of the verification. See the header: it deliberately does
-- not re-advance the track.
create or replace function public.fms_asset_update_verify_close(p_job uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_no  text;
begin
  select job_no into v_no from public.fms_asset_jobs where id = p_job for update;
  if v_no is null then raise exception 'Service job not found'; end if;
  if not public.fms_asset_vc_editable(p_job) then
    raise exception 'This job is not closed, so there is nothing to correct here';
  end if;
  if not public.fms_asset_can_act('verify_close', p_job, v_uid) then
    raise exception 'Not authorized to change this verification';
  end if;

  update public.fms_asset_jobs set
    vc_actual_date = coalesce(nullif(p->>'vc_actual_date','')::date, vc_actual_date),
    vc_new_ref_no  = case when p ? 'vc_new_ref_no' then nullif(trim(p->>'vc_new_ref_no'),'')  else vc_new_ref_no end,
    vc_new_amount  = case when p ? 'vc_new_amount' then nullif(p->>'vc_new_amount','')::numeric else vc_new_amount end,
    vc_remarks     = case when p ? 'vc_remarks'    then nullif(trim(p->>'vc_remarks'),'')     else vc_remarks end
  where id = p_job;

  perform public.fms_asset_announce('job', p_job, 'job_verify_edited',
    v_no || ' - verification details corrected.', '{}'::uuid[],
    jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_update_verify_close(uuid, jsonb) to authenticated;
