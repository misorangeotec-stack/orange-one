-- ===========================================================================
-- HR Recruitment FMS — the requisition carries a STRUCTURED job description.
--
-- The MRF form was a transcription of the old Google Sheet: six free-text boxes
-- across "Why this position is needed" and "Who you're looking for". Nobody
-- wrote them at the same level of detail, so HR could not compare two
-- requisitions and the posted JD had to be re-authored by hand. This replaces
-- them with the standard JD structure, backed by the masters added in
-- 20260815120000.
--
-- WHAT CHANGES SHAPE
--   * job_title stays TEXT and stays NOT NULL. job_title_id is added ALONGSIDE
--     it and the form writes both — the chosen job title's name is copied into
--     job_title. That is deliberate and load-bearing: every list column, queue
--     export, kanban card and notification email that reads job_title keeps
--     working untouched, and the requisitions raised before this migration (with
--     free-text titles and no master row) stay readable forever.
--   * salary_min / salary_max are REUSED, not replaced. A "fixed" salary writes
--     min = max = the amount, which is what keeps the over-range warning on an
--     offer working with no special-casing. salary_structure and salary_period
--     only describe how to render and compare them.
--   * business_contribution, impact_if_unfilled and preferred_experience are
--     LEFT IN PLACE, in the table and in both RPCs below. The new form stops
--     sending them, but ~13 existing requisitions have them filled and the
--     detail page still renders whatever is there. Dropping the columns would
--     destroy that data; not writing them costs nothing.
--
-- ADDITIVE: every new column is nullable or defaulted, so every existing row
-- stays valid. The two RPCs are restated in full (create or replace has no patch
-- form); the only edits are the new columns in the insert / update chains.
--
-- Reversal: re-apply 20260712130000's fms_hr_submit_mrf / fms_hr_resubmit_mrf,
-- then `alter table public.fms_hr_requisitions drop column …` for the list below.
-- ===========================================================================

alter table public.fms_hr_requisitions
  add column if not exists job_title_id uuid references public.fms_hr_job_titles on delete set null,
  add column if not exists role_summary   text,
  -- How to READ salary_min/salary_max, not where they live.
  add column if not exists salary_structure text not null default 'range'
    check (salary_structure in ('fixed','range')),
  add column if not exists salary_period    text not null default 'month'
    check (salary_period in ('month','annum')),
  add column if not exists incentive_note   text,
  add column if not exists experience_min_years numeric(4,1),
  add column if not exists experience_max_years numeric(4,1),
  add column if not exists freshers_ok      boolean not null default false,
  -- uuid[] rather than join tables: these are a snapshot of what was asked for,
  -- never queried relationally, and the requisition already stores its people
  -- this way (hiring_manager_ids, reporting_to_ids). A deleted master leaves a
  -- dangling id that the client resolves to nothing and drops.
  add column if not exists qualification_ids   uuid[] not null default '{}',
  add column if not exists skill_ids           uuid[] not null default '{}',
  add column if not exists preferred_skill_ids uuid[] not null default '{}',
  add column if not exists skills_note      text;

comment on column public.fms_hr_requisitions.job_title_id is
  'The job title master row this was raised from. job_title holds its name; rows raised before 20260815 have a title but no master row.';
comment on column public.fms_hr_requisitions.salary_structure is
  '"fixed" → salary_min = salary_max = the single agreed figure. "range" → a genuine band.';
comment on column public.fms_hr_requisitions.skill_ids is
  'Must-have skills (fms_hr_skills). preferred_skill_ids is the nice-to-have list; both span every skill category.';

create index if not exists fms_hr_requisitions_job_title_idx
  on public.fms_hr_requisitions (job_title_id);

-- ===========================================================================
-- RPC — submit an MRF. The origin of the whole workflow.
-- Restated from 20260712130000; only the JD columns are new.
-- ===========================================================================
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
    department_id, location_id, job_title, job_title_id, job_type_id,
    position_kind, previous_employee_name, expected_start_date, positions_required,
    salary_min, salary_max, salary_note, salary_structure, salary_period, incentive_note,
    why_needed, business_contribution, impact_if_unfilled,
    role_summary, key_responsibilities, required_skills, preferred_experience,
    experience_min_years, experience_max_years, freshers_ok,
    qualification_ids, skill_ids, preferred_skill_ids, skills_note,
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
    nullif(p->>'job_title_id','')::uuid,
    nullif(p->>'job_type_id','')::uuid,
    v_kind,
    nullif(trim(p->>'previous_employee_name'), ''),
    nullif(p->>'expected_start_date','')::date,
    greatest(1, coalesce((p->>'positions_required')::integer, 1)),
    nullif(p->>'salary_min','')::numeric,
    nullif(p->>'salary_max','')::numeric,
    nullif(trim(p->>'salary_note'), ''),
    -- coalesce, not nullif: these two are NOT NULL and an older client that does
    -- not send them must still be able to submit.
    coalesce(nullif(p->>'salary_structure',''), 'range'),
    coalesce(nullif(p->>'salary_period',''), 'month'),
    nullif(trim(p->>'incentive_note'), ''),
    nullif(trim(p->>'why_needed'), ''),
    nullif(trim(p->>'business_contribution'), ''),
    nullif(trim(p->>'impact_if_unfilled'), ''),
    nullif(trim(p->>'role_summary'), ''),
    nullif(trim(p->>'key_responsibilities'), ''),
    nullif(trim(p->>'required_skills'), ''),
    nullif(trim(p->>'preferred_experience'), ''),
    nullif(p->>'experience_min_years','')::numeric,
    nullif(p->>'experience_max_years','')::numeric,
    coalesce((p->>'freshers_ok')::boolean, false),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'qualification_ids','[]'::jsonb)) x), '{}'::uuid[]),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'skill_ids','[]'::jsonb)) x), '{}'::uuid[]),
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'preferred_skill_ids','[]'::jsonb)) x), '{}'::uuid[]),
    nullif(trim(p->>'skills_note'), ''),
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
    job_title_id        = nullif(p->>'job_title_id','')::uuid,
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
    -- coalesce to the CURRENT value, not to a literal: a resubmit from an older
    -- client must not silently reset a range back to 'range'/'month'.
    salary_structure      = coalesce(nullif(p->>'salary_structure',''), salary_structure),
    salary_period         = coalesce(nullif(p->>'salary_period',''), salary_period),
    incentive_note        = nullif(trim(p->>'incentive_note'), ''),
    why_needed            = nullif(trim(p->>'why_needed'), ''),
    business_contribution = nullif(trim(p->>'business_contribution'), ''),
    impact_if_unfilled    = nullif(trim(p->>'impact_if_unfilled'), ''),
    role_summary          = nullif(trim(p->>'role_summary'), ''),
    key_responsibilities  = nullif(trim(p->>'key_responsibilities'), ''),
    required_skills       = nullif(trim(p->>'required_skills'), ''),
    preferred_experience  = nullif(trim(p->>'preferred_experience'), ''),
    experience_min_years  = nullif(p->>'experience_min_years','')::numeric,
    experience_max_years  = nullif(p->>'experience_max_years','')::numeric,
    freshers_ok           = coalesce((p->>'freshers_ok')::boolean, false),
    qualification_ids     = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'qualification_ids','[]'::jsonb)) x), '{}'::uuid[]),
    skill_ids             = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'skill_ids','[]'::jsonb)) x), '{}'::uuid[]),
    preferred_skill_ids   = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'preferred_skill_ids','[]'::jsonb)) x), '{}'::uuid[]),
    skills_note           = nullif(trim(p->>'skills_note'), ''),
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
