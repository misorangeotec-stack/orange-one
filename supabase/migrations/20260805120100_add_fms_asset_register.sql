-- ===========================================================================
-- ASSET MAINTENANCE FMS — THE REGISTER (Phase 2): assets, schedule tracks,
-- meter readings, and the date maths the whole module turns on.
--
-- THE THREE LAYERS (see 20260805120000 for why this differs from every other FMS)
--   fms_asset_assets     — permanent. A car bought in 2024 is still a row in 2031.
--   fms_asset_schedules  — permanent, SELF-ADVANCING. 1..N per asset. Each holds
--                          a frequency and a next_due_date. THIS is what the
--                          nightly generator reads.
--   fms_asset_readings   — the meter log, for the optional usage-based trigger.
--
-- The workflow entity (fms_asset_jobs) is migration 3. Nothing here has steps,
-- owners or an SLA — a schedule is a standing instruction, not a task.
--
-- WHY next_due_date LIVES ON THE SCHEDULE AND NOT ON THE JOB
--   It is the ONE piece of state that must survive every job. If it lived on the
--   job, a cancelled or skipped job would take the asset's whole future schedule
--   with it.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.departments / public.profiles.
-- Reversal (reverse order):
--   drop function if exists public.fms_asset_retire_asset(uuid,text,date);
--   drop function if exists public.fms_asset_record_reading(uuid,jsonb);
--   drop function if exists public.fms_asset_delete_schedule(uuid);
--   drop function if exists public.fms_asset_upsert_schedule(uuid,jsonb);
--   drop function if exists public.fms_asset_update_asset(uuid,jsonb);
--   drop function if exists public.fms_asset_submit_asset(jsonb);
--   drop function if exists public.fms_asset_can_act(text,uuid,uuid);
--   drop function if exists public.fms_asset_can_raise(uuid);
--   drop function if exists public.fms_asset_next_due(date,integer,text);
--   drop function if exists public.fms_asset_today_ist();
--   drop table if exists public.fms_asset_readings, public.fms_asset_schedules,
--                        public.fms_asset_assets;
-- ===========================================================================

-- ===========================================================================
-- DATE MATHS — two small functions the rest of the module leans on entirely.
-- ===========================================================================

-- ⚠ WHY THIS EXISTS. Postgres `current_date` is UTC. Both cron jobs
--   (20260805120300) run at 00:30 and 03:30 UTC, where the UTC and IST dates
--   happen to agree — but that is luck, not design: rescheduling either past
--   18:30 UTC would silently shift every due-date comparison by one day, and the
--   symptom (reminders a day early, "overdue" on the due date itself) would be
--   nearly impossible to attribute.
--
--   There is no other `at time zone` in this repo's SQL — the house style has
--   been to convert IST by hand in the cron expression. That is fine for
--   SCHEDULING; it is not enough for date ARITHMETIC. This is a deliberate,
--   documented first. Mirrors todayLocalIso()/todayIso() on the frontend, which
--   carries the same warning for the same reason.
create or replace function public.fms_asset_today_ist()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;
comment on function public.fms_asset_today_ist() is
  'Today''s date in IST. Use INSTEAD OF current_date anywhere a due date is compared — current_date is UTC and drifts a day for 5.5 hours of every IST day.';
grant execute on function public.fms_asset_today_ist() to authenticated;

-- The single date-advance function. Every "when is this next due" answer in the
-- module comes from here — the generator, the close RPC and the seed importer —
-- so a track can never advance two different ways.
--
-- Returns NULL for 'one_time' (and for a missing/zero interval), which parks the
-- track: the generator skips a null next_due_date. That is correct for a genuine
-- one-off such as a warranty, and is why the seeded Insurance / PUC / RC / AMC
-- types are years/1 rather than one_time.
--
-- Month arithmetic clamps the way Postgres does — 31-Jan + 1 month = 28-Feb —
-- which matches addMonths() in frontend/src/shared/lib/workingDays.ts.
create or replace function public.fms_asset_next_due(p_from date, p_value integer, p_unit text)
returns date
language sql
immutable
as $$
  select case
    when p_from is null                        then null::date
    when p_unit is null or p_unit = 'one_time' then null::date
    when coalesce(p_value, 0) <= 0             then null::date
    when p_unit = 'days'                       then (p_from + make_interval(days   => p_value))::date
    when p_unit = 'months'                     then (p_from + make_interval(months => p_value))::date
    when p_unit = 'years'                      then (p_from + make_interval(years  => p_value))::date
    else null::date
  end;
$$;
comment on function public.fms_asset_next_due(date, integer, text) is
  'Advance a date by one interval. NULL for one_time or a non-positive interval, which parks the track.';
grant execute on function public.fms_asset_next_due(date, integer, text) to authenticated;

-- ===========================================================================
-- fms_asset_assets — the register.
-- ===========================================================================
create table if not exists public.fms_asset_assets (
  id                uuid primary key default gen_random_uuid(),
  -- ASSET-0001. NOT financial-year scoped: an asset is permanent, so restarting
  -- its numbering every April would be meaningless. Job numbers ARE FY-scoped.
  asset_no          text not null unique,
  name              text not null,
  category_id       uuid references public.fms_asset_categories on delete restrict,
  make_id           uuid references public.fms_asset_makes on delete restrict,
  model             text,
  -- Vehicle registration, machine serial, laptop service tag — whatever uniquely
  -- identifies THIS unit. Unique where present, so the same machine cannot be
  -- registered twice (the commonest data error in an asset register).
  serial_no         text,

  company_id        uuid references public.fms_asset_companies on delete restrict,
  location_id       uuid references public.fms_asset_locations on delete restrict,
  department_id     uuid references public.departments on delete restrict,
  -- The person answerable for this asset. Gets every reminder, and may action
  -- the schedule + service steps for it even without being a step owner.
  custodian_user_id uuid references auth.users on delete set null,

  purchase_date     date,
  purchase_cost     numeric(16,2),
  vendor_id         uuid references public.fms_asset_vendors on delete restrict,
  invoice_no        text,
  invoice_path      text,
  invoice_name      text,
  -- An INPUT CONVENIENCE, not a second reminder mechanism: submit_asset turns
  -- this into a one_time "Warranty Expiry" schedule row. Everything remind-able
  -- is a schedule; nothing reminds off this column.
  warranty_months   integer,

  condition_id      uuid references public.fms_asset_conditions on delete restrict,
  usage_unit_id     uuid references public.fms_asset_usage_units on delete restrict,
  current_usage     numeric(14,2),
  usage_as_on       date,

  retired_on        date,
  retired_reason    text,

  remarks           text,
  active            boolean not null default true,
  created_by        uuid references auth.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.fms_asset_assets is
  'The asset register — one row per physical thing the company owns. Permanent: an asset is retired (active=false, retired_on set), never deleted, so its service history stays attributable.';

create unique index if not exists fms_asset_assets_serial_idx
  on public.fms_asset_assets (lower(serial_no)) where serial_no is not null;
create index if not exists fms_asset_assets_category_idx  on public.fms_asset_assets (category_id);
create index if not exists fms_asset_assets_custodian_idx on public.fms_asset_assets (custodian_user_id);
create index if not exists fms_asset_assets_active_idx    on public.fms_asset_assets (active);

drop trigger if exists trg_fms_asset_assets_updated on public.fms_asset_assets;
create trigger trg_fms_asset_assets_updated
  before update on public.fms_asset_assets
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_asset_schedules — the dated tracks. THE heart of the module.
--
-- One row = one standing instruction: "service this every 6 months", "this
-- policy expires on 14-03-2027 and needs 45 days' notice".
--
-- unique (asset_id, schedule_type_id): an asset gets at most one track of each
-- type. This blocks the real error (adding Insurance twice); if a genuine need
-- for two of a kind ever appears, the answer is a second schedule type, not a
-- duplicate row.
-- ===========================================================================
create table if not exists public.fms_asset_schedules (
  id                  uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references public.fms_asset_assets on delete restrict,
  schedule_type_id    uuid not null references public.fms_asset_schedule_types on delete restrict,

  frequency_value     integer,
  frequency_unit      text not null default 'months'
                        check (frequency_unit in ('days','months','years','one_time')),
  last_done_date      date,
  -- NULL parks the track: the generator skips it. Happens after a one_time track
  -- fires, and is the honest state for "we do not know when this is next due".
  next_due_date       date,
  -- How many days BEFORE next_due_date the job is opened. Also caps the reminder
  -- ladder — a tier further out than this can never fire for this track.
  lead_days           integer not null default 15,

  -- The optional SECOND trigger, for vehicles and machinery. Not cron-driven — a
  -- nightly date job cannot know a meter reading — so it is evaluated by
  -- fms_asset_record_reading when someone logs one.
  usage_interval      numeric(14,2),
  usage_at_last_done  numeric(14,2),

  -- Renewal-track facts: the policy / contract number, who issued it, what it
  -- cost. Carried here rather than on the job because they describe the CURRENT
  -- document, and are replaced wholesale at each renewal.
  ref_no              text,
  provider            text,
  amount              numeric(16,2),

  notes               text,
  active              boolean not null default true,
  created_by          uuid references auth.users on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (asset_id, schedule_type_id)
);
comment on table public.fms_asset_schedules is
  'Dated tracks per asset — service intervals AND renewal expiries, one engine for both. next_due_date is the single piece of state that must outlive every job, which is why it lives here and not on fms_asset_jobs.';

create index if not exists fms_asset_schedules_asset_idx on public.fms_asset_schedules (asset_id);
-- The generator's index: "active tracks whose reminder window has opened".
create index if not exists fms_asset_schedules_due_idx
  on public.fms_asset_schedules (next_due_date) where active and next_due_date is not null;

drop trigger if exists trg_fms_asset_schedules_updated on public.fms_asset_schedules;
create trigger trg_fms_asset_schedules_updated
  before update on public.fms_asset_schedules
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_asset_readings — the meter log (odometer, running hours).
-- ===========================================================================
create table if not exists public.fms_asset_readings (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references public.fms_asset_assets on delete cascade,
  reading_date date not null,
  reading      numeric(14,2) not null,
  note         text,
  recorded_by  uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
comment on table public.fms_asset_readings is
  'Meter readings per asset. Logging one also evaluates every usage-based schedule on that asset and may raise a service job — the usage arm of the trigger, which no cron job could provide.';
create index if not exists fms_asset_readings_asset_idx
  on public.fms_asset_readings (asset_id, reading_date desc);

-- ===========================================================================
-- RLS — select is open to authenticated (the module grant is the real gate);
-- direct writes are admin-only, because every mutation goes through a
-- SECURITY DEFINER RPC that re-checks authorization.
-- ===========================================================================
do $$
declare
  t text;
  tables text[] := array['assets','schedules','readings'];
begin
  foreach t in array tables loop
    execute format('alter table public.fms_asset_%1$s enable row level security', t);
    execute format('drop policy if exists fms_asset_%1$s_select on public.fms_asset_%1$s', t);
    execute format(
      'create policy fms_asset_%1$s_select on public.fms_asset_%1$s
         for select to authenticated using (true)', t);
    execute format('drop policy if exists fms_asset_%1$s_write_admin on public.fms_asset_%1$s', t);
    execute format(
      'create policy fms_asset_%1$s_write_admin on public.fms_asset_%1$s
         for all to authenticated
         using ((select public.is_admin(auth.uid())))
         with check ((select public.is_admin(auth.uid())))', t);
  end loop;
end $$;

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- May this user add an asset / raise a service job by hand?
-- No owners on `service_due` ⇒ anyone with the module. Owners set ⇒ only them,
-- plus admins and coordinators.
create or replace function public.fms_asset_can_raise(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and (
       public.fms_asset_is_coordinator(p_uid)
       or public.fms_asset_is_step_owner('service_due', p_uid)
       or not exists (
         select 1 from public.fms_asset_step_owners o
         where o.step_key = 'service_due'
           and array_length(o.employee_ids, 1) > 0
       )
     );
$$;
grant execute on function public.fms_asset_can_raise(uuid) to authenticated;

-- May this user action this step on this job?
--
-- Admins and coordinators always; the step's owners always. Plus ONE extra arm:
-- the asset's CUSTODIAN may schedule and record the service on their own asset —
-- they are the person who actually takes the car to the garage, and making them
-- wait on a step owner is how services get missed in the first place. The
-- custodian is deliberately NOT given `verify_close`: verification is the check
-- on their own work, so it stays with the step owners.
--
-- ⚠ frontend/src/apps/asset-maintenance/store.tsx#canActOn MIRRORS this,
--   including the custodian arm. Change one and change the other, or the UI will
--   offer a button the server refuses.
create or replace function public.fms_asset_can_act(p_step_key text, p_job uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_custodian uuid;
begin
  if p_uid is null then return false; end if;
  if public.fms_asset_is_coordinator(p_uid) then return true; end if;
  if public.fms_asset_is_step_owner(p_step_key, p_uid) then return true; end if;

  if p_step_key in ('schedule','service_done') and p_job is not null then
    select a.custodian_user_id into v_custodian
      from public.fms_asset_jobs j
      join public.fms_asset_assets a on a.id = j.asset_id
     where j.id = p_job;
    return v_custodian is not null and v_custodian = p_uid;
  end if;

  return false;
end $$;
grant execute on function public.fms_asset_can_act(text, uuid, uuid) to authenticated;

-- ===========================================================================
-- WRITE RPCs
-- ===========================================================================

-- Create an asset. Allocates ASSET-0001, then — if warranty_months is given —
-- creates the one_time Warranty Expiry track, so warranty is remind-able through
-- the same single mechanism as everything else.
create or replace function public.fms_asset_submit_asset(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_id         uuid;
  v_no         text;
  v_name       text := nullif(trim(p->>'name'), '');
  v_warranty   integer := nullif(p->>'warranty_months','')::integer;
  v_purchase   date := nullif(p->>'purchase_date','')::date;
  v_wtype      uuid;
begin
  if not public.fms_asset_can_raise(v_uid) then
    raise exception 'Not authorized to add an asset';
  end if;
  if v_name is null then
    raise exception 'Give the asset a name';
  end if;

  v_no := 'ASSET-' || lpad(public.fms_asset_next_seq('asset')::text, 4, '0');

  insert into public.fms_asset_assets (
    asset_no, name, category_id, make_id, model, serial_no,
    company_id, location_id, department_id, custodian_user_id,
    purchase_date, purchase_cost, vendor_id, invoice_no, invoice_path, invoice_name,
    warranty_months, condition_id, usage_unit_id, current_usage, usage_as_on,
    remarks, created_by
  ) values (
    v_no, v_name,
    nullif(p->>'category_id','')::uuid, nullif(p->>'make_id','')::uuid,
    nullif(trim(p->>'model'),''), nullif(trim(p->>'serial_no'),''),
    nullif(p->>'company_id','')::uuid, nullif(p->>'location_id','')::uuid,
    nullif(p->>'department_id','')::uuid, nullif(p->>'custodian_user_id','')::uuid,
    v_purchase, nullif(p->>'purchase_cost','')::numeric,
    nullif(p->>'vendor_id','')::uuid, nullif(trim(p->>'invoice_no'),''),
    nullif(p->>'invoice_path',''), nullif(p->>'invoice_name',''),
    v_warranty, nullif(p->>'condition_id','')::uuid, nullif(p->>'usage_unit_id','')::uuid,
    nullif(p->>'current_usage','')::numeric, nullif(p->>'usage_as_on','')::date,
    nullif(trim(p->>'remarks'),''), v_uid
  )
  returning id into v_id;

  -- Warranty → a real track, so the reminder engine sees it like anything else.
  if coalesce(v_warranty, 0) > 0 and v_purchase is not null then
    select id into v_wtype from public.fms_asset_schedule_types where name = 'Warranty Expiry';
    if v_wtype is not null then
      insert into public.fms_asset_schedules
        (asset_id, schedule_type_id, frequency_value, frequency_unit,
         next_due_date, lead_days, notes, created_by)
      values
        (v_id, v_wtype, v_warranty, 'one_time',
         (v_purchase + make_interval(months => v_warranty))::date, 30,
         'Auto-created from the purchase date and warranty period.', v_uid)
      on conflict (asset_id, schedule_type_id) do nothing;
    end if;
  end if;

  perform public.fms_asset_announce(
    'asset', v_id, 'asset_added',
    v_no || ' - ' || v_name || ' added to the asset register.',
    (select array_remove(array[nullif(p->>'custodian_user_id','')::uuid], null)),
    jsonb_build_object('asset_no', v_no, 'asset_name', v_name));

  return v_id;
end $$;
grant execute on function public.fms_asset_submit_asset(jsonb) to authenticated;

-- Edit an asset. Attachment keys follow the house contract: a key that is ABSENT
-- leaves the stored file alone; a key present-but-blank clears it. Sending "" on
-- every edit would wipe the purchase invoice.
create or replace function public.fms_asset_update_asset(p_asset uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_no  text;
begin
  select asset_no into v_no from public.fms_asset_assets where id = p_asset for update;
  if v_no is null then raise exception 'Asset not found'; end if;
  if not public.fms_asset_can_raise(v_uid) then
    raise exception 'Not authorized to edit an asset';
  end if;

  update public.fms_asset_assets set
    name              = coalesce(nullif(trim(p->>'name'),''), name),
    category_id       = case when p ? 'category_id'       then nullif(p->>'category_id','')::uuid       else category_id end,
    make_id           = case when p ? 'make_id'           then nullif(p->>'make_id','')::uuid           else make_id end,
    model             = case when p ? 'model'             then nullif(trim(p->>'model'),'')             else model end,
    serial_no         = case when p ? 'serial_no'         then nullif(trim(p->>'serial_no'),'')         else serial_no end,
    company_id        = case when p ? 'company_id'        then nullif(p->>'company_id','')::uuid        else company_id end,
    location_id       = case when p ? 'location_id'       then nullif(p->>'location_id','')::uuid       else location_id end,
    department_id     = case when p ? 'department_id'     then nullif(p->>'department_id','')::uuid     else department_id end,
    custodian_user_id = case when p ? 'custodian_user_id' then nullif(p->>'custodian_user_id','')::uuid else custodian_user_id end,
    purchase_date     = case when p ? 'purchase_date'     then nullif(p->>'purchase_date','')::date     else purchase_date end,
    purchase_cost     = case when p ? 'purchase_cost'     then nullif(p->>'purchase_cost','')::numeric  else purchase_cost end,
    vendor_id         = case when p ? 'vendor_id'         then nullif(p->>'vendor_id','')::uuid         else vendor_id end,
    invoice_no        = case when p ? 'invoice_no'        then nullif(trim(p->>'invoice_no'),'')        else invoice_no end,
    invoice_path      = case when p ? 'invoice_path'      then nullif(p->>'invoice_path','')            else invoice_path end,
    invoice_name      = case when p ? 'invoice_name'      then nullif(p->>'invoice_name','')            else invoice_name end,
    warranty_months   = case when p ? 'warranty_months'   then nullif(p->>'warranty_months','')::integer else warranty_months end,
    condition_id      = case when p ? 'condition_id'      then nullif(p->>'condition_id','')::uuid      else condition_id end,
    usage_unit_id     = case when p ? 'usage_unit_id'     then nullif(p->>'usage_unit_id','')::uuid     else usage_unit_id end,
    current_usage     = case when p ? 'current_usage'     then nullif(p->>'current_usage','')::numeric  else current_usage end,
    usage_as_on       = case when p ? 'usage_as_on'       then nullif(p->>'usage_as_on','')::date       else usage_as_on end,
    remarks           = case when p ? 'remarks'           then nullif(trim(p->>'remarks'),'')           else remarks end
  where id = p_asset;

  perform public.fms_asset_announce(
    'asset', p_asset, 'asset_edited', v_no || ' updated.', '{}'::uuid[],
    jsonb_build_object('asset_no', v_no));
end $$;
grant execute on function public.fms_asset_update_asset(uuid, jsonb) to authenticated;

-- Add or edit one schedule track. `id` present ⇒ update, absent ⇒ insert.
--
-- On insert, next_due_date is taken as given (that is the whole point — you are
-- entering the date on the policy, or the date of the last service). It is only
-- ever COMPUTED on close, and only when the closer does not supply one.
create or replace function public.fms_asset_upsert_schedule(p_asset uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_id   uuid := nullif(p->>'id','')::uuid;
  v_type uuid := nullif(p->>'schedule_type_id','')::uuid;
  v_unit text := coalesce(nullif(trim(p->>'frequency_unit'),''), 'months');
  v_due  date := nullif(p->>'next_due_date','')::date;
  v_lead integer := coalesce(nullif(p->>'lead_days','')::integer, 15);
begin
  if not public.fms_asset_can_raise(v_uid) then
    raise exception 'Not authorized to change an asset''s schedule';
  end if;
  if not exists (select 1 from public.fms_asset_assets where id = p_asset) then
    raise exception 'Asset not found';
  end if;
  if v_type is null then raise exception 'Pick what kind of schedule this is'; end if;
  if v_unit not in ('days','months','years','one_time') then
    raise exception 'Frequency must be in days, months, years, or a one-time date';
  end if;
  if v_lead < 0 then raise exception 'Reminder lead days cannot be negative'; end if;
  if v_due is null and v_id is null then
    raise exception 'Enter when this is next due - that is what the reminder counts back from';
  end if;

  if v_id is null then
    insert into public.fms_asset_schedules (
      asset_id, schedule_type_id, frequency_value, frequency_unit,
      last_done_date, next_due_date, lead_days,
      usage_interval, usage_at_last_done, ref_no, provider, amount, notes, created_by
    ) values (
      p_asset, v_type, nullif(p->>'frequency_value','')::integer, v_unit,
      nullif(p->>'last_done_date','')::date, v_due, v_lead,
      nullif(p->>'usage_interval','')::numeric, nullif(p->>'usage_at_last_done','')::numeric,
      nullif(trim(p->>'ref_no'),''), nullif(trim(p->>'provider'),''),
      nullif(p->>'amount','')::numeric, nullif(trim(p->>'notes'),''), v_uid
    )
    returning id into v_id;
  else
    update public.fms_asset_schedules set
      schedule_type_id   = v_type,
      frequency_value    = nullif(p->>'frequency_value','')::integer,
      frequency_unit     = v_unit,
      last_done_date     = nullif(p->>'last_done_date','')::date,
      next_due_date      = v_due,
      lead_days          = v_lead,
      usage_interval     = nullif(p->>'usage_interval','')::numeric,
      usage_at_last_done = nullif(p->>'usage_at_last_done','')::numeric,
      ref_no             = nullif(trim(p->>'ref_no'),''),
      provider           = nullif(trim(p->>'provider'),''),
      amount             = nullif(p->>'amount','')::numeric,
      notes              = nullif(trim(p->>'notes'),''),
      active             = coalesce(nullif(p->>'active','')::boolean, active)
    where id = v_id and asset_id = p_asset;
  end if;

  return v_id;
end $$;
grant execute on function public.fms_asset_upsert_schedule(uuid, jsonb) to authenticated;

-- Deactivate a track. Never a hard delete while any job references it — the
-- service history has to stay attributable to the track that produced it.
create or replace function public.fms_asset_delete_schedule(p_schedule uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.fms_asset_can_raise(v_uid) then
    raise exception 'Not authorized to change an asset''s schedule';
  end if;

  if exists (select 1 from public.fms_asset_jobs where schedule_id = p_schedule) then
    update public.fms_asset_schedules set active = false where id = p_schedule;
  else
    delete from public.fms_asset_schedules where id = p_schedule;
  end if;
end $$;
grant execute on function public.fms_asset_delete_schedule(uuid) to authenticated;

-- Log a meter reading — and evaluate the usage arm of the trigger.
--
-- This is the ONLY place a usage-based service can be raised. A nightly date job
-- cannot know that a car has done another 10,000 km; only a human entering the
-- odometer can. The date arm remains the automatic one.
create or replace function public.fms_asset_record_reading(p_asset uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_reading numeric := nullif(p->>'reading','')::numeric;
  v_date    date := coalesce(nullif(p->>'reading_date','')::date, public.fms_asset_today_ist());
  s         record;
begin
  if v_uid is null then raise exception 'Sign in to record a reading'; end if;
  if v_reading is null then raise exception 'Enter the meter reading'; end if;
  if not exists (select 1 from public.fms_asset_assets where id = p_asset) then
    raise exception 'Asset not found';
  end if;

  insert into public.fms_asset_readings (asset_id, reading_date, reading, note, recorded_by)
  values (p_asset, v_date, v_reading, nullif(trim(p->>'note'),''), v_uid);

  update public.fms_asset_assets
     set current_usage = v_reading, usage_as_on = v_date
   where id = p_asset
     and (usage_as_on is null or usage_as_on <= v_date);   -- never let a backdated entry rewrite the latest

  for s in
    select sc.id, sc.usage_interval, sc.usage_at_last_done
      from public.fms_asset_schedules sc
     where sc.asset_id = p_asset
       and sc.active
       and coalesce(sc.usage_interval, 0) > 0
       and v_reading - coalesce(sc.usage_at_last_done, 0) >= sc.usage_interval
  loop
    -- Raising is idempotent: the one-open-job index means a track already in
    -- flight is silently skipped, so repeated readings cannot pile up jobs.
    begin
      perform public.fms_asset_raise_job_now(s.id);
    exception when others then null;
    end;
  end loop;
end $$;
grant execute on function public.fms_asset_record_reading(uuid, jsonb) to authenticated;

-- Retire an asset (sold, scrapped, written off).
--
-- Without this the register keeps nagging about a car that left the company
-- two years ago — the single most corrosive failure mode for a reminder system,
-- because people learn to ignore it.
create or replace function public.fms_asset_retire_asset(p_asset uuid, p_reason text, p_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_no  text;
  v_on  date := coalesce(p_date, public.fms_asset_today_ist());
begin
  select asset_no into v_no from public.fms_asset_assets where id = p_asset for update;
  if v_no is null then raise exception 'Asset not found'; end if;
  if not public.fms_asset_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can retire an asset';
  end if;
  if nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'Say why the asset is being retired';
  end if;

  update public.fms_asset_assets
     set active = false, retired_on = v_on, retired_reason = trim(p_reason)
   where id = p_asset;

  update public.fms_asset_schedules set active = false where asset_id = p_asset;

  update public.fms_asset_jobs
     set status = 'skipped', current_step = null,
         skipped_reason = 'Asset retired: ' || trim(p_reason),
         closed_at = coalesce(closed_at, now())
   where asset_id = p_asset
     and status not in ('closed','cancelled','skipped');

  perform public.fms_asset_announce(
    'asset', p_asset, 'asset_retired',
    v_no || ' retired - ' || trim(p_reason) || '. Its schedules and open jobs are closed.',
    '{}'::uuid[], jsonb_build_object('asset_no', v_no, 'retired_on', v_on));
end $$;
grant execute on function public.fms_asset_retire_asset(uuid, text, date) to authenticated;
