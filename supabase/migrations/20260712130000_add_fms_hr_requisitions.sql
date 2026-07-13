-- ===========================================================================
-- HR Recruitment FMS — REQUISITIONS (Phase 3).
--
-- The MRF (columns A–V of the recruitment sheet), its two-stage approval
-- (HR Head → Management), and job posting (W–Y).
--
-- Tables:
--   fms_hr_requisitions           — the MRF + every step's authoritative timestamp
--   fms_hr_requisition_platforms  — the "which platform" multi-select (join)
--
-- Helpers:
--   fms_hr_can_act(step, requisition, uid)      — THE authorization gate
--   fms_hr_can_read_requisition(requisition, uid) — the PII read gate
--
-- RPCs (all SECURITY DEFINER; lock the row, re-check authz, validate the
-- transition, and STAMP THE STEP'S TIMESTAMP ON THE DOMAIN ROW):
--   fms_hr_submit_mrf, fms_hr_resubmit_mrf, fms_hr_decide_mrf,
--   fms_hr_post_job, fms_hr_hold_requisition, fms_hr_cancel_requisition
--
-- ---------------------------------------------------------------------------
-- THREE THINGS HERE ARE NOT COPIED FROM PURCHASE, AND EACH IS LOAD-BEARING:
--
-- 1. hiring_manager_ids / reporting_to_ids are ARRAYS, not single FKs.
--    The live sheet really does say "Ritesh Tulsyan & Dimple" and "Rakesh, Vikas
--    and manmohan ji". A uuid column would have silently lost one of them.
--    reporting_to_note keeps whatever free text does not resolve to a user.
--
-- 2. salary_min/max are NULLABLE and joined by salary_note.
--    The sheet says "If fresh (Zero to two years) 15000/-" and "20 to 25K".
--    The numbers are for the over-range check at offer time; the note is the truth.
--
-- 3. THE HOD STEPS ARE OWNED PER-REQUISITION.
--    "The HOD of department X" does not exist in this portal — there is no
--    departments.hod_id. A single global owner for hod_shortlist would route
--    Sachin Plant's candidates to the Exim head. So fms_hr_can_act() routes the
--    HOD steps to THIS requisition's hiring managers (defaulting to whoever raised
--    it), and everything else to the global step-owner table.
-- ---------------------------------------------------------------------------
--
-- Purely ADDITIVE. Reversal: drop the 6 RPCs, the 2 helpers, then
-- fms_hr_requisition_platforms, fms_hr_requisitions.
-- ===========================================================================

create table if not exists public.fms_hr_requisitions (
  id                     uuid primary key default gen_random_uuid(),
  mrf_no                 text not null unique,               -- MRF-2627-0001
  request_date           date not null default current_date,

  -- Who wants the person. requester_id is the raiser; hiring_manager_ids defaults
  -- to them and is what every HOD step routes to.
  requester_id           uuid references auth.users on delete set null,
  hiring_manager_ids     uuid[] not null default '{}',
  reporting_to_ids       uuid[] not null default '{}',
  reporting_to_note      text,                               -- free text the sheet carries

  department_id          uuid not null references public.departments on delete restrict,
  location_id            uuid references public.fms_hr_locations on delete set null,
  job_title              text not null,
  job_type_id            uuid references public.fms_hr_job_types on delete set null,

  position_kind          text not null default 'new' check (position_kind in ('new','replacement')),
  previous_employee_name text,                               -- required iff replacement (RPC-enforced)

  expected_start_date    date,
  positions_required     integer not null default 1 check (positions_required > 0),

  salary_min             numeric(12,2),
  salary_max             numeric(12,2),
  salary_note            text,
  constraint fms_hr_salary_range check (
    salary_max is null or salary_min is null or salary_max >= salary_min
  ),

  -- The justification block (P–U on the sheet).
  why_needed             text,
  business_contribution  text,
  impact_if_unfilled     text,
  key_responsibilities   text,
  required_skills        text,
  preferred_experience   text,

  jd_path                text,                               -- optional JD file in fms-hr-docs
  jd_name                text,

  status                 text not null default 'hr_review' check (status in (
                           'hr_review','mgmt_review','sent_back','rejected',
                           'posting','sourcing','on_hold','closed','cancelled')),
  -- The step this requisition currently sits at — drives the queues.
  current_step           text not null default 'hr_head_approval',

  -- ---- AUTHORITATIVE step timestamps ------------------------------------
  -- Never infer a step's completion from the activity trail: `announce` is
  -- best-effort and its failure is swallowed, so the trail can be missing even
  -- though the step completed. (Learned the hard way — 20260708120900.)
  submitted_at           timestamptz not null default now(),
  hr_approved_at         timestamptz,
  hr_approver_id         uuid references auth.users on delete set null,
  hr_remarks             text,
  mgmt_approved_at       timestamptz,
  mgmt_approver_id       uuid references auth.users on delete set null,
  mgmt_remarks           text,
  sent_back_at           timestamptz,
  sent_back_reason       text,
  rejected_at            timestamptz,
  reject_reason          text,
  decided_by             uuid references auth.users on delete set null,
  posted_at              timestamptz,     -- the job_posting STEP completed
  posted_on              date,            -- the business date HR typed ("Date of Job Posted")
  hold_reason            text,
  cancel_reason          text,
  closed_at              timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists fms_hr_requisitions_status_idx on public.fms_hr_requisitions (status);
create index if not exists fms_hr_requisitions_step_idx   on public.fms_hr_requisitions (current_step);
create index if not exists fms_hr_requisitions_dept_idx   on public.fms_hr_requisitions (department_id);

drop trigger if exists trg_fms_hr_requisitions_updated on public.fms_hr_requisitions;
create trigger trg_fms_hr_requisitions_updated
  before update on public.fms_hr_requisitions
  for each row execute function public.set_updated_at();

-- The platform multi-select (sheet columns W–X).
create table if not exists public.fms_hr_requisition_platforms (
  requisition_id uuid not null references public.fms_hr_requisitions on delete cascade,
  platform_id    uuid not null references public.fms_hr_job_platforms on delete restrict,
  posted_on      date,
  primary key (requisition_id, platform_id)
);

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- Who may read a requisition and (later) its candidates / resumes.
-- Deliberately tighter than Purchase's blanket select-to-authenticated: these
-- rows lead to candidate names, phone numbers and CVs.
create or replace function public.fms_hr_can_read_requisition(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_hr_is_coordinator(p_uid)
      or public.fms_hr_is_any_step_owner(p_uid)
      or exists (
        select 1 from public.fms_hr_requisitions r
        where r.id = p_req
          and (r.requester_id = p_uid or p_uid = any(r.hiring_manager_ids) or p_uid = any(r.reporting_to_ids))
      );
$$;
grant execute on function public.fms_hr_can_read_requisition(uuid, uuid) to authenticated;

-- THE gate every workflow RPC calls.
--
-- For a HOD step, ownership follows the requisition (its hiring managers, who
-- default to whoever raised the MRF). For every other step it is the global
-- step-owner table. Keep this list in sync with HOD_STEPS in lib/steps.ts.
create or replace function public.fms_hr_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  if public.is_admin(p_uid) or public.fms_hr_is_coordinator(p_uid) then
    return true;
  end if;

  if p_step_key in ('hod_shortlist','interview_2','probation_m1','probation_m2','probation_m3') then
    if p_req is null then return false; end if;
    select hiring_manager_ids into v_managers from public.fms_hr_requisitions where id = p_req;
    return v_managers is not null and p_uid = any(v_managers);
  end if;

  return public.fms_hr_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_hr_can_act(text, uuid, uuid) to authenticated;

-- ===========================================================================
-- RLS — read is gated; every write goes through the RPCs below.
-- ===========================================================================
alter table public.fms_hr_requisitions enable row level security;
drop policy if exists fms_hr_requisitions_select on public.fms_hr_requisitions;
create policy fms_hr_requisitions_select on public.fms_hr_requisitions
  for select to authenticated using (public.fms_hr_can_read_requisition(id, auth.uid()));
drop policy if exists fms_hr_requisitions_write_admin on public.fms_hr_requisitions;
create policy fms_hr_requisitions_write_admin on public.fms_hr_requisitions
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_hr_requisition_platforms enable row level security;
drop policy if exists fms_hr_requisition_platforms_select on public.fms_hr_requisition_platforms;
create policy fms_hr_requisition_platforms_select on public.fms_hr_requisition_platforms
  for select to authenticated using (public.fms_hr_can_read_requisition(requisition_id, auth.uid()));
drop policy if exists fms_hr_requisition_platforms_write_admin on public.fms_hr_requisition_platforms;
create policy fms_hr_requisition_platforms_write_admin on public.fms_hr_requisition_platforms
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPC — submit an MRF. The origin of the whole workflow.
-- ===========================================================================
drop function if exists public.fms_hr_submit_mrf(jsonb);
create or replace function public.fms_hr_submit_mrf(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_no       text;
  v_seq      integer;
  v_fy       text := public.fms_hr_fy_code(current_date);
  v_uid      uuid := auth.uid();
  v_kind     text := coalesce(p->>'position_kind', 'new');
  v_managers uuid[];
begin
  if not (public.fms_hr_is_step_owner('mrf', v_uid) or public.is_admin(v_uid)) then
    raise exception 'You are not allowed to raise a requisition';
  end if;
  if coalesce(trim(p->>'job_title'), '') = '' then
    raise exception 'Job title is required';
  end if;
  if (p->>'department_id') is null then
    raise exception 'Department is required';
  end if;
  if v_kind = 'replacement' and coalesce(trim(p->>'previous_employee_name'), '') = '' then
    raise exception 'A replacement requisition must name the previous employee';
  end if;

  -- The raiser IS the hiring manager unless they named others explicitly. This is
  -- what makes every later HOD step route back to the right person automatically.
  v_managers := coalesce(
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'hiring_manager_ids','[]'::jsonb)) x),
    '{}'::uuid[]
  );
  if cardinality(v_managers) = 0 then v_managers := array[v_uid]; end if;

  v_seq := public.fms_hr_next_seq('MRF-' || v_fy);
  v_no  := 'MRF-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_hr_requisitions (
    mrf_no, request_date, requester_id, hiring_manager_ids, reporting_to_ids, reporting_to_note,
    department_id, location_id, job_title, job_type_id,
    position_kind, previous_employee_name, expected_start_date, positions_required,
    salary_min, salary_max, salary_note,
    why_needed, business_contribution, impact_if_unfilled,
    key_responsibilities, required_skills, preferred_experience,
    jd_path, jd_name,
    status, current_step, submitted_at
  ) values (
    v_no,
    coalesce((p->>'request_date')::date, current_date),
    v_uid,
    v_managers,
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'reporting_to_ids','[]'::jsonb)) x), '{}'::uuid[]),
    nullif(trim(p->>'reporting_to_note'), ''),
    (p->>'department_id')::uuid,
    nullif(p->>'location_id','')::uuid,
    trim(p->>'job_title'),
    nullif(p->>'job_type_id','')::uuid,
    v_kind,
    nullif(trim(p->>'previous_employee_name'), ''),
    nullif(p->>'expected_start_date','')::date,
    greatest(1, coalesce((p->>'positions_required')::integer, 1)),
    nullif(p->>'salary_min','')::numeric,
    nullif(p->>'salary_max','')::numeric,
    nullif(trim(p->>'salary_note'), ''),
    nullif(trim(p->>'why_needed'), ''),
    nullif(trim(p->>'business_contribution'), ''),
    nullif(trim(p->>'impact_if_unfilled'), ''),
    nullif(trim(p->>'key_responsibilities'), ''),
    nullif(trim(p->>'required_skills'), ''),
    nullif(trim(p->>'preferred_experience'), ''),
    nullif(p->>'jd_path',''),
    nullif(p->>'jd_name',''),
    'hr_review', 'hr_head_approval', now()
  )
  returning id into v_id;

  return v_id;
end $$;
grant execute on function public.fms_hr_submit_mrf(jsonb) to authenticated;

-- ===========================================================================
-- RPC — edit + resubmit a sent-back MRF.
-- Resubmission RESTARTS the approval clock: submitted_at is the anchor the
-- HR-Head SLA counts from, so leaving it stale would show the fixed requisition
-- as already overdue.
-- ===========================================================================
drop function if exists public.fms_hr_resubmit_mrf(uuid, jsonb);
create or replace function public.fms_hr_resubmit_mrf(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_requester uuid;
  v_uid uuid := auth.uid();
begin
  select status, requester_id into v_status, v_requester
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'sent_back' then
    raise exception 'Only a sent-back requisition can be edited and resubmitted (status %)', v_status;
  end if;
  if not (v_requester = v_uid or public.is_admin(v_uid)) then
    raise exception 'Only the requester can resubmit this requisition';
  end if;

  update public.fms_hr_requisitions set
    job_title             = coalesce(nullif(trim(p->>'job_title'), ''), job_title),
    department_id         = coalesce(nullif(p->>'department_id','')::uuid, department_id),
    location_id           = nullif(p->>'location_id','')::uuid,
    job_type_id           = nullif(p->>'job_type_id','')::uuid,
    position_kind         = coalesce(p->>'position_kind', position_kind),
    previous_employee_name= nullif(trim(p->>'previous_employee_name'), ''),
    expected_start_date   = nullif(p->>'expected_start_date','')::date,
    positions_required    = greatest(1, coalesce((p->>'positions_required')::integer, positions_required)),
    salary_min            = nullif(p->>'salary_min','')::numeric,
    salary_max            = nullif(p->>'salary_max','')::numeric,
    salary_note           = nullif(trim(p->>'salary_note'), ''),
    why_needed            = nullif(trim(p->>'why_needed'), ''),
    business_contribution = nullif(trim(p->>'business_contribution'), ''),
    impact_if_unfilled    = nullif(trim(p->>'impact_if_unfilled'), ''),
    key_responsibilities  = nullif(trim(p->>'key_responsibilities'), ''),
    required_skills       = nullif(trim(p->>'required_skills'), ''),
    preferred_experience  = nullif(trim(p->>'preferred_experience'), ''),
    jd_path               = coalesce(nullif(p->>'jd_path',''), jd_path),
    jd_name               = coalesce(nullif(p->>'jd_name',''), jd_name),
    -- Back to the top of the approval chain, with a fresh clock.
    status        = 'hr_review',
    current_step  = 'hr_head_approval',
    submitted_at  = now(),
    sent_back_at  = null,
    sent_back_reason = null,
    hr_approved_at = null, hr_approver_id = null, hr_remarks = null,
    mgmt_approved_at = null, mgmt_approver_id = null, mgmt_remarks = null
  where id = p_req;
end $$;
grant execute on function public.fms_hr_resubmit_mrf(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — the two-stage approval gate.
--   p_stage    : 'hr' | 'mgmt'
--   p_decision : 'approve' | 'reject' | 'send_back'
-- ===========================================================================
drop function if exists public.fms_hr_decide_mrf(uuid, text, text, text);
create or replace function public.fms_hr_decide_mrf(
  p_req      uuid,
  p_stage    text,
  p_decision text,
  p_remarks  text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_step   text;
begin
  if p_stage not in ('hr','mgmt') then raise exception 'Unknown approval stage %', p_stage; end if;
  if p_decision not in ('approve','reject','send_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  v_step := case when p_stage = 'hr' then 'hr_head_approval' else 'mgmt_approval' end;

  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  -- Each stage may only act when the requisition is actually sitting at it.
  if p_stage = 'hr'   and v_status <> 'hr_review'   then
    raise exception 'This requisition is not awaiting HR Head approval (status %)', v_status;
  end if;
  if p_stage = 'mgmt' and v_status <> 'mgmt_review' then
    raise exception 'This requisition is not awaiting Management approval (status %)', v_status;
  end if;

  if not public.fms_hr_can_act(v_step, p_req, v_uid) then
    raise exception 'Not authorized to decide this requisition';
  end if;
  if p_decision in ('reject','send_back') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting or sending back';
  end if;

  if p_decision = 'approve' then
    if p_stage = 'hr' then
      update public.fms_hr_requisitions set
        hr_approved_at = now(), hr_approver_id = v_uid, hr_remarks = nullif(trim(p_remarks),''),
        status = 'mgmt_review', current_step = 'mgmt_approval'
      where id = p_req;
    else
      update public.fms_hr_requisitions set
        mgmt_approved_at = now(), mgmt_approver_id = v_uid, mgmt_remarks = nullif(trim(p_remarks),''),
        status = 'posting', current_step = 'job_posting'
      where id = p_req;
    end if;

  elsif p_decision = 'reject' then
    update public.fms_hr_requisitions set
      status = 'rejected', rejected_at = now(), reject_reason = trim(p_remarks), decided_by = v_uid
    where id = p_req;

  else -- send_back
    update public.fms_hr_requisitions set
      status = 'sent_back', sent_back_at = now(), sent_back_reason = trim(p_remarks), decided_by = v_uid
    where id = p_req;
  end if;
end $$;
grant execute on function public.fms_hr_decide_mrf(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- RPC — post the job. Requires at least one platform.
-- Stamps BOTH posted_at (when the step completed — drives the SLA) and posted_on
-- (the business date HR typed — what the sheet called "Date of Job Posted").
-- These are different facts and conflating them loses one of them.
-- ===========================================================================
drop function if exists public.fms_hr_post_job(uuid, uuid[], date);
create or replace function public.fms_hr_post_job(
  p_req          uuid,
  p_platform_ids uuid[],
  p_posted_on    date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_on     date := coalesce(p_posted_on, current_date);
  pid      uuid;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'posting' then
    raise exception 'This requisition is not ready to be posted (status %)', v_status;
  end if;
  if not public.fms_hr_can_act('job_posting', p_req, v_uid) then
    raise exception 'Not authorized to post this job';
  end if;
  if p_platform_ids is null or cardinality(p_platform_ids) = 0 then
    raise exception 'Pick at least one platform the job was posted on';
  end if;

  delete from public.fms_hr_requisition_platforms where requisition_id = p_req;
  foreach pid in array p_platform_ids loop
    insert into public.fms_hr_requisition_platforms (requisition_id, platform_id, posted_on)
    values (p_req, pid, v_on)
    on conflict do nothing;
  end loop;

  update public.fms_hr_requisitions set
    posted_at    = now(),
    posted_on    = v_on,
    status       = 'sourcing',
    current_step = 'resume_upload'
  where id = p_req;
end $$;
grant execute on function public.fms_hr_post_job(uuid, uuid[], date) to authenticated;

-- ===========================================================================
-- RPC — hold / resume / cancel. A vacancy can be frozen (budget) or dropped.
-- ===========================================================================
drop function if exists public.fms_hr_hold_requisition(uuid, boolean, text);
create or replace function public.fms_hr_hold_requisition(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_step   text;
  v_uid    uuid := auth.uid();
begin
  select status, current_step into v_status, v_step
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold a requisition';
  end if;

  if p_hold then
    if v_status in ('closed','cancelled','rejected','on_hold') then
      raise exception 'A % requisition cannot be put on hold', v_status;
    end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_hr_requisitions
       set status = 'on_hold', hold_reason = trim(p_reason)
     where id = p_req;
  else
    if v_status <> 'on_hold' then raise exception 'This requisition is not on hold'; end if;
    -- Resume back to whatever step it was parked at.
    update public.fms_hr_requisitions
       set status = case v_step
                      when 'hr_head_approval' then 'hr_review'
                      when 'mgmt_approval'    then 'mgmt_review'
                      when 'job_posting'      then 'posting'
                      else 'sourcing'
                    end,
           hold_reason = null
     where id = p_req;
  end if;
end $$;
grant execute on function public.fms_hr_hold_requisition(uuid, boolean, text) to authenticated;

drop function if exists public.fms_hr_cancel_requisition(uuid, text);
create or replace function public.fms_hr_cancel_requisition(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status in ('closed','cancelled') then
    raise exception 'This requisition is already %', v_status;
  end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can cancel a requisition';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to cancel'; end if;

  update public.fms_hr_requisitions
     set status = 'cancelled', cancel_reason = trim(p_reason), closed_at = now(), decided_by = v_uid
   where id = p_req;
end $$;
grant execute on function public.fms_hr_cancel_requisition(uuid, text) to authenticated;
