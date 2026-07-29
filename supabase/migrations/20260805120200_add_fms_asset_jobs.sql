-- ===========================================================================
-- ASSET MAINTENANCE FMS — SERVICE JOBS (Phase 3): the workflow entity.
--
-- A job is ONE trip through the chain for ONE schedule track:
--   service_due → schedule → service_done → verify_close → closed
--
-- It is shaped deliberately like fms_dispatch_orders — a wide row with a
-- <prefix>_* block per step — so the entire existing FMS engine (queue building,
-- SLA due dates, StageQueue, StepModal, the bell, My Work, the Control Center
-- scoreboard) works on it unchanged. The ONLY genuinely new machinery in this
-- module is the generator and the reminder ladder, which are migration 4.
--
-- ⚠ THE INVARIANT THIS FILE EXISTS TO PROTECT
--     at most ONE open job per schedule.
--   Enforced by a partial unique index, NOT by application logic, because there
--   are four independent ways to open a job (nightly cron, a meter reading, the
--   manual button, a cron retry after a timeout) and any two of them racing
--   would otherwise leave the asset with duplicate work and duplicate reminders.
--
-- WHAT CLOSING DOES — and the trap it avoids
--   Closing advances the parent SCHEDULE, then creates NO successor job. The next
--   one is opened by the nightly generator when the new due date enters its lead
--   window. One code path, no chains, idempotent.
--
--   For a `service` track the new due date is computed (last done + frequency).
--   For a `renewal` track it is TAKEN FROM THE RENEWED DOCUMENT, because a policy
--   renewed on 14-03-2027 may well run to 31-03-2028, or be a two-year policy —
--   computing it would be right only by luck and would drift further every year.
--
-- Purely ADDITIVE.
-- Reversal (reverse order):
--   drop function if exists public.fms_asset_skip_job(uuid,text);
--   drop function if exists public.fms_asset_cancel_job(uuid,text);
--   drop function if exists public.fms_asset_resume_job(uuid);
--   drop function if exists public.fms_asset_hold_job(uuid,text);
--   drop function if exists public.fms_asset_record_verify_close(uuid,jsonb);
--   drop function if exists public.fms_asset_record_service_done(uuid,jsonb);
--   drop function if exists public.fms_asset_record_schedule(uuid,jsonb);
--   drop function if exists public.fms_asset_raise_job_now(uuid);
--   drop function if exists public.fms_asset_open_job(uuid,text);
--   drop table if exists public.fms_asset_jobs;
-- ===========================================================================

create table if not exists public.fms_asset_jobs (
  id                uuid primary key default gen_random_uuid(),
  job_no            text not null unique,          -- ASM-2627-0001 (FY-scoped)
  asset_id          uuid not null references public.fms_asset_assets on delete restrict,
  schedule_id       uuid not null references public.fms_asset_schedules on delete restrict,
  -- Denormalised from the schedule so a job can be read, listed and emailed
  -- without a join, and so history survives the track being re-pointed.
  schedule_type_id  uuid references public.fms_asset_schedule_types on delete restrict,
  -- What the track said was due when this job was opened. NOT recomputed later:
  -- it is the yardstick the whole reminder ladder and the "was it late?" question
  -- are measured against.
  due_date          date,

  status            text not null default 'awaiting_schedule'
                      check (status in ('awaiting_schedule','awaiting_service','awaiting_verification',
                                        'closed','on_hold','cancelled','skipped')),
  current_step      text,                          -- null once the job leaves the chain
  -- Which status a held job returns to. Without this, resuming has to guess.
  hold_from_status  text,

  -- 'auto'   — the nightly generator, the normal case
  -- 'manual' — somebody pressed "Service needed now"
  -- 'usage'  — a meter reading crossed the usage interval
  raised_source     text not null default 'auto' check (raised_source in ('auto','manual','usage')),
  raised_by         uuid references auth.users on delete set null,

  -- ---- step 2: schedule the service ---------------------------------------
  sc_actual_date    date,
  sc_planned_date   date,
  sc_vendor_id      uuid references public.fms_asset_vendors on delete restrict,
  sc_remarks        text,
  sc_at             timestamptz,
  sc_by             uuid references auth.users on delete set null,

  -- ---- step 3: record the service ------------------------------------------
  sd_actual_date    date,
  sd_vendor_id      uuid references public.fms_asset_vendors on delete restrict,
  sd_cost           numeric(16,2),
  sd_cost_head_id   uuid references public.fms_asset_cost_heads on delete restrict,
  sd_bill_no        text,
  sd_bill_path      text,
  sd_bill_name      text,
  sd_meter_reading  numeric(14,2),
  sd_remarks        text,
  sd_at             timestamptz,
  sd_by             uuid references auth.users on delete set null,

  -- ---- step 4: verify and close --------------------------------------------
  vc_actual_date    date,
  -- 'satisfactory'  → close, and advance the track.
  -- 'rework_needed' → back to step 3. The track is NOT advanced: a service done
  --                   badly must not move the next due date out by six months.
  vc_outcome        text check (vc_outcome is null or vc_outcome in ('satisfactory','rework_needed')),
  -- Renewal tracks only: what the RENEWED document actually says. Required on a
  -- satisfactory close of a renewal — see the header.
  vc_new_due_date   date,
  vc_new_ref_no     text,
  vc_new_amount     numeric(16,2),
  vc_remarks        text,
  vc_at             timestamptz,
  vc_by             uuid references auth.users on delete set null,

  -- ---- exits ----------------------------------------------------------------
  hold_reason       text,
  held_at           timestamptz,
  held_by           uuid references auth.users on delete set null,
  cancel_reason     text,
  cancelled_at      timestamptz,
  cancelled_by      uuid references auth.users on delete set null,
  skipped_reason    text,
  closed_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.fms_asset_jobs is
  'One trip through the service chain for one schedule track. Opened by the nightly generator (or a meter reading, or by hand), closed at Verify & Close — which is what advances the parent schedule''s next_due_date.';

-- ⚠ THE invariant. See the file header.
create unique index if not exists fms_asset_jobs_one_open_idx
  on public.fms_asset_jobs (schedule_id)
  where status not in ('closed','cancelled','skipped');

create index if not exists fms_asset_jobs_asset_idx  on public.fms_asset_jobs (asset_id);
create index if not exists fms_asset_jobs_status_idx on public.fms_asset_jobs (status);
create index if not exists fms_asset_jobs_due_idx    on public.fms_asset_jobs (due_date)
  where status not in ('closed','cancelled','skipped');

drop trigger if exists trg_fms_asset_jobs_updated on public.fms_asset_jobs;
create trigger trg_fms_asset_jobs_updated
  before update on public.fms_asset_jobs
  for each row execute function public.set_updated_at();

alter table public.fms_asset_jobs enable row level security;
drop policy if exists fms_asset_jobs_select on public.fms_asset_jobs;
create policy fms_asset_jobs_select on public.fms_asset_jobs
  for select to authenticated using (true);
drop policy if exists fms_asset_jobs_write_admin on public.fms_asset_jobs;
create policy fms_asset_jobs_write_admin on public.fms_asset_jobs
  for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));

-- ===========================================================================
-- OPENING A JOB
--
-- fms_asset_open_job is the ONE way a job comes into existence. Three callers —
-- the nightly generator ('auto'), a meter reading ('usage'), the manual button
-- ('manual') — so the numbering, the duplicate guard and the announcement can
-- never diverge between them.
--
-- Carries NO authorization check: it is the internal core, revoked from clients.
-- Authorization lives in its public wrapper, fms_asset_raise_job_now.
--
-- Returns NULL (never raises) when the track already has an open job. That is
-- the normal, expected outcome on every cron run after the first.
-- ===========================================================================
create or replace function public.fms_asset_open_job(p_schedule uuid, p_source text default 'auto')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_no        text;
  v_fy        text;
  s           record;
  v_asset_nm  text;
  v_type_nm   text;
begin
  select sc.id, sc.asset_id, sc.schedule_type_id, sc.next_due_date, sc.active,
         a.active as asset_active, a.name as asset_name, a.asset_no, a.custodian_user_id
    into s
  from public.fms_asset_schedules sc
  join public.fms_asset_assets a on a.id = sc.asset_id
  where sc.id = p_schedule
  for update of sc;

  if s.id is null then return null; end if;
  if not s.active or not s.asset_active then return null; end if;
  if s.next_due_date is null then return null; end if;

  -- Cheap pre-check; the unique index below is the real guarantee.
  if exists (
    select 1 from public.fms_asset_jobs j
    where j.schedule_id = p_schedule
      and j.status not in ('closed','cancelled','skipped')
  ) then
    return null;
  end if;

  v_fy := public.fms_asset_fy_code(coalesce(s.next_due_date, public.fms_asset_today_ist()));
  v_no := 'ASM-' || v_fy || '-' || lpad(public.fms_asset_next_seq('job:' || v_fy)::text, 4, '0');

  begin
    insert into public.fms_asset_jobs
      (job_no, asset_id, schedule_id, schedule_type_id, due_date,
       status, current_step, raised_source, raised_by)
    values
      (v_no, s.asset_id, p_schedule, s.schedule_type_id, s.next_due_date,
       'awaiting_schedule', 'schedule', coalesce(p_source,'auto'), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- Another caller won the race. Correct outcome, not an error.
    return null;
  end;

  select name into v_type_nm from public.fms_asset_schedule_types where id = s.schedule_type_id;
  v_asset_nm := coalesce(s.asset_no || ' ' || s.asset_name, s.asset_name, 'an asset');

  perform public.fms_asset_announce(
    'job', v_id, 'job_raised',
    coalesce(v_type_nm, 'Service') || ' due on ' || to_char(s.next_due_date, 'DD-MM-YYYY')
      || ' for ' || v_asset_nm || ' - schedule it with a vendor.',
    (select array_remove(
       public.fms_asset_step_owner_ids('schedule') || s.custodian_user_id, null)),
    jsonb_build_object('job_no', v_no, 'asset_no', s.asset_no, 'asset_name', s.asset_name,
                       'schedule_type', v_type_nm, 'due_date', s.next_due_date,
                       'source', coalesce(p_source,'auto')));

  return v_id;
end $$;
comment on function public.fms_asset_open_job(uuid, text) is
  'INTERNAL. The single way a service job is created (cron / meter reading / manual). Returns NULL when the track already has an open job. Authorization lives in fms_asset_raise_job_now.';
revoke execute on function public.fms_asset_open_job(uuid, text) from anon, authenticated;

-- The "Service needed now" button — open a job ahead of its reminder window.
create or replace function public.fms_asset_raise_job_now(p_schedule uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_custodian uuid;
  v_id        uuid;
begin
  select a.custodian_user_id into v_custodian
    from public.fms_asset_schedules sc
    join public.fms_asset_assets a on a.id = sc.asset_id
   where sc.id = p_schedule;

  if not (public.fms_asset_can_raise(v_uid)
          or (v_custodian is not null and v_custodian = v_uid)) then
    raise exception 'Not authorized to raise a service job for this asset';
  end if;

  v_id := public.fms_asset_open_job(p_schedule, 'manual');
  if v_id is null then
    raise exception 'This schedule already has an open service job, or it is inactive / has no next due date';
  end if;
  return v_id;
end $$;
grant execute on function public.fms_asset_raise_job_now(uuid) to authenticated;

-- ===========================================================================
-- RECORD RPCs — one per queue step.
--
-- All three share the shape (PL/pgSQL has no macro, so it is spelled out):
--   lock row · check status · check authz · validate in human sentences ·
--   stamp the step's own *_at/*_by + captured data · advance · announce
--
-- Every timestamp is `coalesce(<x>_at, now())` so a correction never rewrites
-- the original moment the step was actioned.
--
-- ⚠ WIRE CONTRACT: the jsonb keys read below are the `key` values in
--   frontend/src/apps/asset-maintenance/lib/stepConfig.ts, VERBATIM. Rename one
--   side only and the value is silently dropped.
-- ===========================================================================

-- ---- step 2: schedule the service -----------------------------------------
create or replace function public.fms_asset_record_schedule(p_job uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_no      text;
  v_asset   uuid;
  v_uid     uuid := auth.uid();
  v_planned date := nullif(p->>'sc_planned_date','')::date;
  v_custodian uuid;
  v_label   text;
begin
  select j.status, j.job_no, j.asset_id into v_status, v_no, v_asset
    from public.fms_asset_jobs j where j.id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status <> 'awaiting_schedule' then
    raise exception 'This job is not awaiting scheduling (status %)', v_status;
  end if;
  if not public.fms_asset_can_act('schedule', p_job, v_uid) then
    raise exception 'Not authorized to schedule this service';
  end if;
  if v_planned is null then
    raise exception 'Enter the date the service is planned for';
  end if;

  update public.fms_asset_jobs set
    sc_actual_date = coalesce(nullif(p->>'sc_actual_date','')::date, public.fms_asset_today_ist()),
    sc_planned_date = v_planned,
    sc_vendor_id   = nullif(p->>'sc_vendor_id','')::uuid,
    sc_remarks     = nullif(trim(p->>'sc_remarks'),''),
    sc_at          = coalesce(sc_at, now()),
    sc_by          = coalesce(sc_by, v_uid),
    status         = 'awaiting_service',
    current_step   = 'service_done'
  where id = p_job;

  select a.custodian_user_id, a.asset_no || ' ' || a.name into v_custodian, v_label
    from public.fms_asset_assets a where a.id = v_asset;

  perform public.fms_asset_announce(
    'job', p_job, 'job_scheduled',
    v_no || ' scheduled for ' || to_char(v_planned, 'DD-MM-YYYY')
      || ' on ' || coalesce(v_label, 'the asset') || ' - record the service once it is done.',
    (select array_remove(public.fms_asset_step_owner_ids('service_done') || v_custodian, null)),
    jsonb_build_object('job_no', v_no, 'planned_date', v_planned));
end $$;
grant execute on function public.fms_asset_record_schedule(uuid, jsonb) to authenticated;

-- ---- step 3: record the service -------------------------------------------
create or replace function public.fms_asset_record_service_done(p_job uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_no      text;
  v_asset   uuid;
  v_uid     uuid := auth.uid();
  v_date    date := nullif(p->>'sd_actual_date','')::date;
  v_meter   numeric := nullif(p->>'sd_meter_reading','')::numeric;
  v_label   text;
begin
  select j.status, j.job_no, j.asset_id into v_status, v_no, v_asset
    from public.fms_asset_jobs j where j.id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status <> 'awaiting_service' then
    raise exception 'This job is not awaiting the service record (status %)', v_status;
  end if;
  if not public.fms_asset_can_act('service_done', p_job, v_uid) then
    raise exception 'Not authorized to record this service';
  end if;
  if v_date is null then
    raise exception 'Enter the date the service was actually carried out';
  end if;
  if v_date > public.fms_asset_today_ist() then
    raise exception 'The service date cannot be in the future';
  end if;

  update public.fms_asset_jobs set
    sd_actual_date   = v_date,
    sd_vendor_id     = nullif(p->>'sd_vendor_id','')::uuid,
    sd_cost          = nullif(p->>'sd_cost','')::numeric,
    sd_cost_head_id  = nullif(p->>'sd_cost_head_id','')::uuid,
    sd_bill_no       = nullif(trim(p->>'sd_bill_no'),''),
    -- Attachment contract: an ABSENT key keeps the stored file; a present-but-
    -- blank key clears it. Sending "" on every edit would wipe the bill.
    sd_bill_path     = case when p ? 'sd_bill_path' then nullif(p->>'sd_bill_path','') else sd_bill_path end,
    sd_bill_name     = case when p ? 'sd_bill_name' then nullif(p->>'sd_bill_name','') else sd_bill_name end,
    sd_meter_reading = v_meter,
    sd_remarks       = nullif(trim(p->>'sd_remarks'),''),
    sd_at            = coalesce(sd_at, now()),
    sd_by            = coalesce(sd_by, v_uid),
    status           = 'awaiting_verification',
    current_step     = 'verify_close'
  where id = p_job;

  -- Keep the asset's meter in step, but never let a lower/older figure overwrite
  -- a newer one. The usage-interval evaluation deliberately does NOT run here —
  -- this job is still open, and opening another for the same track is barred.
  if v_meter is not null then
    update public.fms_asset_assets
       set current_usage = v_meter, usage_as_on = v_date
     where id = v_asset
       and (usage_as_on is null or usage_as_on <= v_date);
  end if;

  select a.asset_no || ' ' || a.name into v_label from public.fms_asset_assets a where a.id = v_asset;

  perform public.fms_asset_announce(
    'job', p_job, 'job_serviced',
    v_no || ' - service recorded on ' || to_char(v_date, 'DD-MM-YYYY')
      || ' for ' || coalesce(v_label, 'the asset') || ' - awaiting verification.',
    public.fms_asset_step_owner_ids('verify_close'),
    jsonb_build_object('job_no', v_no, 'service_date', v_date,
                       'cost', nullif(p->>'sd_cost','')::numeric));
end $$;
grant execute on function public.fms_asset_record_service_done(uuid, jsonb) to authenticated;

-- ---- step 4: verify and close ----------------------------------------------
--
-- THE step that makes the register self-sustaining. Everything else could be
-- done on paper; this is what moves next_due_date so the cycle repeats without
-- anyone remembering to re-arm it.
create or replace function public.fms_asset_record_verify_close(p_job uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_no        text;
  v_asset     uuid;
  v_sched     uuid;
  v_service   date;
  v_meter     numeric;
  v_uid       uuid := auth.uid();
  v_outcome   text := nullif(trim(p->>'vc_outcome'),'');
  v_remarks   text := nullif(trim(p->>'vc_remarks'),'');
  v_new_due   date := nullif(p->>'vc_new_due_date','')::date;
  v_kind      text;
  v_type_nm   text;
  v_raiser    uuid;
  v_custodian uuid;
  v_label     text;
  v_next      date;
begin
  select j.status, j.job_no, j.asset_id, j.schedule_id, j.sd_actual_date, j.sd_meter_reading, j.raised_by
    into v_status, v_no, v_asset, v_sched, v_service, v_meter, v_raiser
    from public.fms_asset_jobs j where j.id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status <> 'awaiting_verification' then
    raise exception 'This job is not awaiting verification (status %)', v_status;
  end if;
  if not public.fms_asset_can_act('verify_close', p_job, v_uid) then
    raise exception 'Not authorized to verify and close this service';
  end if;
  if v_outcome is null or v_outcome not in ('satisfactory','rework_needed') then
    raise exception 'Record the verification outcome: Satisfactory or Rework needed';
  end if;

  select st.kind, st.name into v_kind, v_type_nm
    from public.fms_asset_schedules sc
    join public.fms_asset_schedule_types st on st.id = sc.schedule_type_id
   where sc.id = v_sched;

  select a.custodian_user_id, a.asset_no || ' ' || a.name into v_custodian, v_label
    from public.fms_asset_assets a where a.id = v_asset;

  -- ---- rework: back to step 3, and the track does NOT move -----------------
  if v_outcome = 'rework_needed' then
    if v_remarks is null then
      raise exception 'Say what needs redoing before sending this back';
    end if;
    update public.fms_asset_jobs set
      vc_actual_date = coalesce(nullif(p->>'vc_actual_date','')::date, public.fms_asset_today_ist()),
      vc_outcome     = v_outcome,
      vc_remarks     = v_remarks,
      status         = 'awaiting_service',
      current_step   = 'service_done'
    where id = p_job;

    perform public.fms_asset_announce(
      'job', p_job, 'job_rework',
      v_no || ' sent back - ' || v_remarks,
      (select array_remove(public.fms_asset_step_owner_ids('service_done') || v_custodian, null)),
      jsonb_build_object('job_no', v_no, 'reason', v_remarks));
    return;
  end if;

  -- ---- satisfactory: close, and ADVANCE THE TRACK --------------------------
  --
  -- A renewal MUST carry the new expiry off the renewed document. Computing it
  -- from last-done + frequency is right only by luck for a policy, and the error
  -- compounds at every renewal until a certificate quietly lapses.
  if v_kind = 'renewal' and v_new_due is null then
    raise exception 'Enter the new expiry date shown on the renewed % document', coalesce(lower(v_type_nm), 'renewal');
  end if;
  if v_new_due is not null and v_new_due <= coalesce(v_service, public.fms_asset_today_ist()) then
    raise exception 'The new expiry date must be after the service / renewal date';
  end if;

  update public.fms_asset_jobs set
    vc_actual_date  = coalesce(nullif(p->>'vc_actual_date','')::date, public.fms_asset_today_ist()),
    vc_outcome      = v_outcome,
    vc_new_due_date = v_new_due,
    vc_new_ref_no   = nullif(trim(p->>'vc_new_ref_no'),''),
    vc_new_amount   = nullif(p->>'vc_new_amount','')::numeric,
    vc_remarks      = v_remarks,
    vc_at           = coalesce(vc_at, now()),
    vc_by           = coalesce(vc_by, v_uid),
    status          = 'closed',
    current_step    = null,
    closed_at       = coalesce(closed_at, now())
  where id = p_job;

  update public.fms_asset_schedules sc set
    last_done_date     = coalesce(v_service, sc.last_done_date),
    next_due_date      = coalesce(
                           v_new_due,
                           public.fms_asset_next_due(
                             coalesce(v_service, public.fms_asset_today_ist()),
                             sc.frequency_value, sc.frequency_unit)),
    usage_at_last_done = coalesce(v_meter, sc.usage_at_last_done),
    ref_no             = coalesce(nullif(trim(p->>'vc_new_ref_no'),''), sc.ref_no),
    amount             = coalesce(nullif(p->>'vc_new_amount','')::numeric, sc.amount)
  where sc.id = v_sched
  returning sc.next_due_date into v_next;

  perform public.fms_asset_announce(
    'job', p_job, 'job_closed',
    v_no || ' closed for ' || coalesce(v_label, 'the asset') || '. '
      || case when v_next is null
              then 'No further ' || coalesce(lower(v_type_nm), 'service') || ' is scheduled.'
              else 'Next ' || coalesce(lower(v_type_nm), 'service') || ' due '
                   || to_char(v_next, 'DD-MM-YYYY') || '.' end,
    (select array_remove(array[v_raiser, v_custodian], null)),
    jsonb_build_object('job_no', v_no, 'next_due_date', v_next, 'schedule_type', v_type_nm));
end $$;
grant execute on function public.fms_asset_record_verify_close(uuid, jsonb) to authenticated;

-- ===========================================================================
-- EXITS — hold / resume / cancel / skip.
--
-- A held or cancelled job leaves every queue (queue membership reads `status`),
-- but the TRACK is untouched: next_due_date still stands, so cancelling a job
-- does not cancel the service. Only Verify & Close moves a track.
-- ===========================================================================
create or replace function public.fms_asset_hold_job(p_job uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, job_no into v_status, v_no from public.fms_asset_jobs where id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status in ('closed','cancelled','skipped','on_hold') then
    raise exception 'This job cannot be put on hold (status %)', v_status;
  end if;
  if not public.fms_asset_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can put a job on hold';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Say why the job is on hold'; end if;

  update public.fms_asset_jobs
     set hold_from_status = v_status, status = 'on_hold',
         hold_reason = trim(p_reason), held_at = now(), held_by = v_uid
   where id = p_job;

  perform public.fms_asset_announce('job', p_job, 'job_held',
    v_no || ' put on hold - ' || trim(p_reason), '{}'::uuid[],
    jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_hold_job(uuid, text) to authenticated;

create or replace function public.fms_asset_resume_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_from text; v_no text; v_uid uuid := auth.uid(); v_step text;
begin
  select status, hold_from_status, job_no into v_status, v_from, v_no
    from public.fms_asset_jobs where id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status <> 'on_hold' then raise exception 'This job is not on hold'; end if;
  if not public.fms_asset_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can resume a job';
  end if;

  v_from := coalesce(v_from, 'awaiting_schedule');
  v_step := case v_from
              when 'awaiting_schedule'     then 'schedule'
              when 'awaiting_service'      then 'service_done'
              when 'awaiting_verification' then 'verify_close'
              else 'schedule' end;

  update public.fms_asset_jobs
     set status = v_from, current_step = v_step,
         hold_from_status = null, hold_reason = null, held_at = null, held_by = null
   where id = p_job;

  perform public.fms_asset_announce('job', p_job, 'job_resumed',
    v_no || ' resumed.', public.fms_asset_step_owner_ids(v_step),
    jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_resume_job(uuid) to authenticated;

create or replace function public.fms_asset_cancel_job(p_job uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, job_no into v_status, v_no from public.fms_asset_jobs where id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status in ('closed','cancelled','skipped') then
    raise exception 'This job is already %', v_status;
  end if;
  if not public.fms_asset_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can cancel a job';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Say why the job is being cancelled'; end if;

  update public.fms_asset_jobs
     set status = 'cancelled', current_step = null, cancel_reason = trim(p_reason),
         cancelled_at = now(), cancelled_by = v_uid, closed_at = coalesce(closed_at, now())
   where id = p_job;

  perform public.fms_asset_announce('job', p_job, 'job_cancelled',
    v_no || ' cancelled - ' || trim(p_reason) || '. The schedule itself is unchanged.',
    '{}'::uuid[], jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_cancel_job(uuid, text) to authenticated;

-- Skip: this cycle is not happening (asset idle, sold mid-cycle, service waived)
-- but the track lives on. Distinct from cancel so the two read differently in
-- history; fms_asset_retire_asset skips en masse.
create or replace function public.fms_asset_skip_job(p_job uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, job_no into v_status, v_no from public.fms_asset_jobs where id = p_job for update;
  if v_status is null then raise exception 'Service job not found'; end if;
  if v_status in ('closed','cancelled','skipped') then
    raise exception 'This job is already %', v_status;
  end if;
  if not public.fms_asset_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can skip a service';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Say why this service is being skipped'; end if;

  update public.fms_asset_jobs
     set status = 'skipped', current_step = null, skipped_reason = trim(p_reason),
         closed_at = coalesce(closed_at, now())
   where id = p_job;

  perform public.fms_asset_announce('job', p_job, 'job_skipped',
    v_no || ' skipped - ' || trim(p_reason), '{}'::uuid[],
    jsonb_build_object('job_no', v_no));
end $$;
grant execute on function public.fms_asset_skip_job(uuid, text) to authenticated;
