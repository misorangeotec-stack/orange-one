-- ===========================================================================
-- NR-10 · Probation on the Day 7 / 15 / 30 / 60 / 90 cadence, reviewed by TWO
--          people: the HOD and the new joiner.
--
-- ADDITIVE ONLY, on a live module. The monthly model is NOT altered:
-- `fms_hr_probation_reviews` keeps its columns, its constraints and its RPC,
-- and is simply retired in place - it holds ZERO rows and always has. The new
-- cadence lands in a NEW table beside it, so nothing that exists can break and
-- the old frontend keeps working until the new one deploys.
--
-- Safe to re-cadence at all only because probation has never run: 0 probations,
-- 0 reviews, 0 rows in fms_rank_steps or kpi_facts for hr-recruitment. That
-- window closes the day somebody joins.
-- ===========================================================================

-- 1 ── the new joiner's portal account -------------------------------------
-- P0 of the Talent Equation block: "store the link, never retype it". Matching
-- a hire back to a person by employee code or by name is the trap this file has
-- been bitten by before. The joiner's half of every check-in hangs off this.

alter table public.fms_hr_onboardings
  add column if not exists employee_user_id     uuid,
  add column if not exists employee_user_set_at timestamptz,
  add column if not exists employee_user_set_by uuid;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'fms_hr_onboardings_employee_user_fkey') then
    alter table public.fms_hr_onboardings
      add constraint fms_hr_onboardings_employee_user_fkey
      foreign key (employee_user_id) references public.profiles(id) on delete set null;
  end if;
end
$do$;

comment on column public.fms_hr_onboardings.employee_user_id is
  'NR-10 / P0. The Orange One account created for this hire during onboarding. The LINK, stored - never their name or employee code re-matched later. It is what lets the joiner write their own half of a probation check-in, and nothing else in the hub reads it yet.';

create or replace function public.fms_hr_set_employee_user(p_onboarding uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_req uuid;
begin
  select requisition_id into v_req from public.fms_hr_onboardings where id = p_onboarding for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;

  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to link an account to this hire';
  end if;
  if p_user is not null and not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That account does not exist';
  end if;
  -- One account, one hire. Pointing two hires at the same person would make
  -- "my probation" ambiguous for them.
  if p_user is not null and exists (
    select 1 from public.fms_hr_onboardings
     where employee_user_id = p_user and id <> p_onboarding
  ) then
    raise exception 'That account is already linked to another hire';
  end if;

  update public.fms_hr_onboardings
     set employee_user_id     = p_user,
         employee_user_set_at = case when p_user is null then null else now() end,
         employee_user_set_by = case when p_user is null then null else v_uid end
   where id = p_onboarding;
end
$fn$;

grant execute on function public.fms_hr_set_employee_user(uuid, uuid) to authenticated;

-- 2 ── the check-ins --------------------------------------------------------
-- One row per (probation, day), seeded when the probation opens so the five due
-- dates exist from day one - the queue, the reminders and the report all read
-- them, and none of those should be inventing rows.

create table if not exists public.fms_hr_probation_checkins (
  id            uuid primary key default gen_random_uuid(),
  probation_id  uuid not null references public.fms_hr_probations(id) on delete cascade,
  day_no        integer not null check (day_no in (7, 15, 30, 60, 90)),
  -- CALENDAR days from the joining date. ⚠ NOT working days: this codebase counts
  -- day-unit SLAs Mon-Sat, which would land "Day 7" on the 8th calendar day.
  due_on        date not null,

  -- the HOD's side
  hod_status    text check (hod_status in ('satisfactory', 'needs_improvement', 'unsatisfactory')),
  hod_remarks   text,
  hod_at        timestamptz,
  hod_by        uuid,
  file_path     text,
  file_name     text,

  -- the new joiner's own side
  joiner_status  text check (joiner_status in ('going_well', 'mixed', 'not_going_well')),
  joiner_remarks text,
  joiner_at      timestamptz,
  joiner_by      uuid,

  -- stamped when the SECOND side lands: a check-in is not done until both are in
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (probation_id, day_no)
);

comment on table public.fms_hr_probation_checkins is
  'NR-10. The Day 7/15/30/60/90 probation check-ins. TWO-SIDED by the client''s decision of 21-09-2026: the HOD writes one side and the new joiner writes the other, and the check-in counts as done only when both are in by due_on. HR does not write either side - HR chases them, and is scored on whether they arrived on time. Replaces the monthly fms_hr_probation_reviews, which is retired in place with zero rows.';

create index if not exists fms_hr_probation_checkins_due_idx
  on public.fms_hr_probation_checkins (due_on) where completed_at is null;

alter table public.fms_hr_probation_checkins enable row level security;

-- Readable by anyone who can read the requisition — the same gate every other
-- probation row uses — PLUS the joiner themselves, who can read no requisition
-- at all and must still see their own check-ins.
drop policy if exists fms_hr_probation_checkins_select on public.fms_hr_probation_checkins;
create policy fms_hr_probation_checkins_select
  on public.fms_hr_probation_checkins for select
  using (
    exists (
      select 1 from public.fms_hr_probations p
       where p.id = fms_hr_probation_checkins.probation_id
         and public.fms_hr_can_read_requisition(p.requisition_id, auth.uid())
    )
    or exists (
      select 1 from public.fms_hr_probations p
        join public.fms_hr_onboardings o on o.id = p.onboarding_id
       where p.id = fms_hr_probation_checkins.probation_id
         and o.employee_user_id = auth.uid()
    )
  );

-- Writes go through the SECURITY DEFINER RPC below, as everywhere else in this
-- module. The admin arm exists so a mistake can be repaired without a migration.
drop policy if exists fms_hr_probation_checkins_write_admin on public.fms_hr_probation_checkins;
create policy fms_hr_probation_checkins_write_admin
  on public.fms_hr_probation_checkins for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_hr_probation_checkins to authenticated;

-- 3 ── seeding --------------------------------------------------------------

create or replace function public.fms_hr_seed_probation_checkins(p_probation uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_join date;
begin
  select joining_date into v_join from public.fms_hr_probations where id = p_probation;
  if v_join is null then return; end if;

  insert into public.fms_hr_probation_checkins (probation_id, day_no, due_on)
  select p_probation, d, v_join + d
    from unnest(array[7, 15, 30, 60, 90]) as d
  on conflict (probation_id, day_no) do nothing;
end
$fn$;

revoke all on function public.fms_hr_seed_probation_checkins(uuid) from public;
grant execute on function public.fms_hr_seed_probation_checkins(uuid) to service_role;

-- Any probation that already exists (there are none today) gets its five rows.
do $do$
declare r record;
begin
  for r in select id from public.fms_hr_probations loop
    perform public.fms_hr_seed_probation_checkins(r.id);
  end loop;
end
$do$;

-- 4 ── opening a probation now seeds them -----------------------------------
-- Body copied from pg_proc.prosrc as it runs today; the seeding call and the
-- announcement's wording are the only changes.

create or replace function public.fms_hr_open_probation(p_onb uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cand    uuid;
  v_req     uuid;
  v_joining date;
  v_done    timestamptz;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
  v_id      uuid;
begin
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  select o.candidate_id, o.requisition_id, o.joining_date, o.completed_at
    into v_cand, v_req, v_joining, v_done
    from public.fms_hr_onboardings o where o.id = p_onb;

  -- A probation is the consequence of joining. No joining, no probation.
  if v_done is null or v_joining is null then return; end if;

  insert into public.fms_hr_probations (onboarding_id, candidate_id, requisition_id, joining_date)
  values (p_onb, v_cand, v_req, v_joining)
  on conflict (onboarding_id) do nothing
  returning id into v_id;

  if v_id is null then return; end if;   -- already open; nothing new to announce

  -- NR-10: the five check-ins exist from the moment the probation does.
  perform public.fms_hr_seed_probation_checkins(v_id);

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', v_id, 'opened',
    coalesce(v_name, 'The new hire') || ' is on probation — the Day-7 check-in is due '
      || to_char(v_joining + 7, 'DD-MM-YYYY')
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[])
  );
end
$fn$;

-- 5 ── submitting a side ----------------------------------------------------

create or replace function public.fms_hr_submit_probation_checkin(
  p_probation uuid,
  p_day       integer,
  p_side      text,
  p_status    text,
  p_remarks   text default null,
  p_file_path text default null,
  p_file_name text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_req    uuid;
  v_onb    uuid;
  v_final  text;
  v_joiner uuid;
  v_step   text;
  v_name   text;
  v_row    record;
begin
  if p_side not in ('hod', 'joiner') then
    raise exception 'A check-in has two sides: hod and joiner (got %)', p_side;
  end if;
  if p_day not in (7, 15, 30, 60, 90) then
    raise exception 'The check-ins are Day 7, 15, 30, 60 and 90 (got %)', p_day;
  end if;

  select p.requisition_id, p.onboarding_id, p.final_status
    into v_req, v_onb, v_final
    from public.fms_hr_probations p where p.id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null then
    raise exception 'This probation is already % — its check-ins are closed', v_final;
  end if;

  select o.employee_user_id into v_joiner from public.fms_hr_onboardings o where o.id = v_onb;

  if p_side = 'hod' then
    if p_status is null or p_status not in ('satisfactory', 'needs_improvement', 'unsatisfactory') then
      raise exception 'Unknown review status %', p_status;
    end if;
    v_step := 'probation_d' || p_day;
    if not public.fms_hr_can_act(v_step, v_req, v_uid) then
      raise exception 'Not authorized to review this person — that is the head of department''s call';
    end if;
  else
    if p_status is null or p_status not in ('going_well', 'mixed', 'not_going_well') then
      raise exception 'Unknown answer %', p_status;
    end if;
    -- Only the person it is about, and only if HR has linked their account. An
    -- admin cannot write this side either: it is the joiner's own words or it is
    -- nothing, and somebody else typing it is what makes the answer worthless.
    if v_joiner is null then
      raise exception 'No Orange One account is linked to this hire yet — HR links it during onboarding';
    end if;
    if v_uid is distinct from v_joiner then
      raise exception 'Only the new joiner can write their own side of a check-in';
    end if;
  end if;

  insert into public.fms_hr_probation_checkins (probation_id, day_no, due_on)
  select p_probation, p_day, joining_date + p_day
    from public.fms_hr_probations where id = p_probation
  on conflict (probation_id, day_no) do nothing;

  if p_side = 'hod' then
    update public.fms_hr_probation_checkins set
      hod_status  = p_status,
      hod_remarks = nullif(trim(p_remarks), ''),
      hod_at      = now(),
      hod_by      = v_uid,
      file_path   = case when p_file_path is null then file_path
                         when btrim(p_file_path) = '' then null else p_file_path end,
      file_name   = case when p_file_name is null then file_name
                         when btrim(p_file_name) = '' then null else p_file_name end,
      updated_at  = now()
    where probation_id = p_probation and day_no = p_day;
  else
    update public.fms_hr_probation_checkins set
      joiner_status  = p_status,
      joiner_remarks = nullif(trim(p_remarks), ''),
      joiner_at      = now(),
      joiner_by      = v_uid,
      updated_at     = now()
    where probation_id = p_probation and day_no = p_day;
  end if;

  -- Done only when BOTH sides are in. Stamped once and left alone, so a later
  -- correction to either side cannot quietly re-date whether it was on time.
  update public.fms_hr_probation_checkins
     set completed_at = now()
   where probation_id = p_probation and day_no = p_day
     and completed_at is null
     and hod_at is not null and joiner_at is not null;

  select * into v_row from public.fms_hr_probation_checkins
   where probation_id = p_probation and day_no = p_day;

  select c.name into v_name
    from public.fms_hr_candidates c
    join public.fms_hr_probations p on p.candidate_id = c.id
   where p.id = p_probation;

  perform public.fms_hr_announce(
    'probation', p_probation, 'checkin_d' || p_day,
    'Day-' || p_day || ' check-in: '
      || case when p_side = 'hod' then 'the head of department' else coalesce(v_name, 'the new joiner') end
      || ' has answered'
      || case when v_row.completed_at is not null then ' — both sides are now in'
              else ' — still waiting on the other side' end,
    public.fms_hr_step_owner_ids('onboarding')
  );
end
$fn$;

grant execute on function public.fms_hr_submit_probation_checkin(uuid, integer, text, text, text, text, text) to authenticated;

-- 6 ── the new steps are owned the way the monthly ones were ----------------
-- Copied from probation_m1 rather than left empty: an unowned step falls back to
-- the requisition's hiring managers only, and whoever HR named for the monthly
-- reviews plainly meant to be named for these.

insert into public.fms_hr_step_owners (step_key, department_ids, designation_id, employee_ids)
select 'probation_d' || d, o.department_ids, o.designation_id, o.employee_ids
  from unnest(array[7, 15, 30, 60, 90]) as d
  cross join (select * from public.fms_hr_step_owners where step_key = 'probation_m1') o
 where not exists (
   select 1 from public.fms_hr_step_owners x where x.step_key = 'probation_d' || d
 );

-- 7 ── the HOD arm of the ownership rule now covers the new steps ------------
-- Body copied from pg_proc.prosrc; the five day keys are added to the list and
-- the three monthly ones are KEPT, so the retired model still authorises if it
-- is ever read.

create or replace function public.fms_hr_is_natural_step_owner(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_managers uuid[];
begin
  if p_step_key in (
    'hod_shortlist','interview_2',
    'probation_m1','probation_m2','probation_m3',
    'probation_d7','probation_d15','probation_d30','probation_d60','probation_d90',
    'probation_final','probation_extension'
  ) then
    -- NR-4: no requisition in hand, so the hiring-manager arm cannot be evaluated -
    -- but the named-owner arm never needed one. Unreachable from all 23 live callers:
    -- every one of them derives p_req from a row it has already null-checked.
    if p_req is null then return public.fms_hr_is_step_owner(p_step_key, p_uid); end if;

    select hiring_manager_ids into v_managers from public.fms_hr_requisitions where id = p_req;

    -- NR-4: the OR. `v_managers is not null and ...` is kept rather than a bare
    -- `p_uid = any(v_managers)` because BOTH ARMS MUST STAY BOOLEAN-CLEAN. A null
    -- array would make the comparison NULL, `NULL or false` is NULL, and every caller
    -- tests `if not public.fms_hr_can_act(...)` - `not NULL` is NULL, so the guard
    -- would never fire and the RPC would silently authorise.
    --
    -- fms_hr_is_step_owner, NOT its __ungated twin: the gated one is exactly what this
    -- function's own tail calls, so both arms then apply the same
    -- module_can_edit(uid,'hr-recruitment') rule and a view-only user still cannot act.
    return (v_managers is not null and p_uid = any(v_managers))
        or public.fms_hr_is_step_owner(p_step_key, p_uid);
  end if;

  return public.fms_hr_is_step_owner(p_step_key, p_uid);
end
$fn$;

-- 8 ── the joiner's own read gate -------------------------------------------
-- ⚠ Applied as a FOLLOW-UP after testing, because the first version silently
-- failed: the policy's joiner arm read fms_hr_probations and fms_hr_onboardings
-- inline, and a policy is evaluated AS THE CALLER, so those reads met their own
-- RLS — which the joiner fails. The EXISTS returned false, the hire saw an empty
-- page, and nothing errored anywhere. Proven with `set local role authenticated`:
-- the hire saw 0 of their 5 check-ins before this, and 5 after.

create or replace function public.fms_hr_is_my_probation(p_probation uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.fms_hr_probations p
      join public.fms_hr_onboardings o on o.id = p.onboarding_id
     where p.id = p_probation
       and p_uid is not null
       and o.employee_user_id = p_uid
  );
$fn$;

revoke all on function public.fms_hr_is_my_probation(uuid, uuid) from public;
grant execute on function public.fms_hr_is_my_probation(uuid, uuid) to authenticated, service_role;

drop policy if exists fms_hr_probation_checkins_select on public.fms_hr_probation_checkins;
create policy fms_hr_probation_checkins_select
  on public.fms_hr_probation_checkins for select
  using (
    exists (
      select 1 from public.fms_hr_probations p
       where p.id = fms_hr_probation_checkins.probation_id
         and public.fms_hr_can_read_requisition(p.requisition_id, auth.uid())
    )
    or public.fms_hr_is_my_probation(fms_hr_probation_checkins.probation_id, auth.uid())
  );
