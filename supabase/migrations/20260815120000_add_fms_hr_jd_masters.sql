-- ===========================================================================
-- HR Recruitment FMS — THE JD MASTERS (job titles, skills, qualifications).
--
-- Step 1 of the FMS (the MRF form) is being rebuilt around a standard job
-- description instead of six free-text boxes. That needs three new masters, all
-- shaped exactly like the four that already exist (20260712120000) so the shared
-- MasterCrud, insertMaster/updateMaster and the master-governance machinery
-- (20260713130000) pick them up with no special-casing:
--
--   fms_hr_job_titles      — the job title / position list, each tagged to a
--                            department, each optionally carrying a JD TEMPLATE
--   fms_hr_skills          — one flat list, grouped by `category`
--   fms_hr_qualifications  — education
--
-- NOT public.designations. That table is the EMPLOYEE title list behind
-- profiles.designation (six rows, admin-managed, no department, no JD). This one
-- is the list of titles VACANCIES are raised for: HR-owned, requestable, and
-- carrying the JD. Different owners, different lifecycles, deliberately separate.
--
-- WHY THE TEMPLATE COLUMNS ARE ON THE JOB TITLE
-- The form is filled by a HOD a few times a year, not by an HR specialist. A
-- fuller JD must not mean a longer form, so picking a job title PRE-FILLS the
-- whole job-description step; the HOD reviews and tweaks instead of authoring.
-- Every default_* column is nullable/defaulted — a job title with no template
-- simply yields an empty step, never an error.
--
-- The template columns are deliberately NOT part of the master-request payload.
-- Someone requesting a missing job title is asked for a name and a department;
-- HR authors the template afterwards on the Masters page. masterFields.ts drives
-- only the request/approve modals, MasterCrud takes its own `fields` prop.
--
-- ADDITIVE. Three new tables, three new policies each, and a WIDENING of the two
-- master_type CHECK constraints (a drop+add of the constraint only — no table,
-- column or row is mutated; 20260713130000 set the precedent by dropping and
-- recreating policies). fms_hr_resolve_master_request gains three branches.
--
-- Reuses public.is_admin(uuid), public.set_updated_at(),
-- public.fms_hr_is_master_manager(text, uuid), public.departments.
--
-- Reversal:
--   -- restore both master_type CHECKs to their four/five original values, then:
--   drop table if exists public.fms_hr_job_titles;
--   drop table if exists public.fms_hr_skills;
--   drop table if exists public.fms_hr_qualifications;
--   -- and re-run 20260713130000's version of fms_hr_resolve_master_request.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- fms_hr_job_titles — the job title master + its optional JD template.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_job_titles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  -- The department this title normally sits in. Picking the title on the MRF
  -- auto-fills the form's department; the HOD can still override it, which is
  -- why this is a default and not a constraint. `set null` (not restrict): a
  -- retired department must not pin a job title.
  department_id uuid references public.departments on delete set null,

  -- ---- The JD template. All optional. -------------------------------------
  default_job_type_id          uuid references public.fms_hr_job_types on delete set null,
  default_role_summary         text,
  -- Newline-separated bullets, same encoding the form's bullet editor uses.
  default_responsibilities     text,
  default_experience_min_years numeric(4,1),
  default_experience_max_years numeric(4,1),
  -- Plain uuid[] with no FK (arrays cannot carry one). A deleted skill or
  -- qualification leaves a dangling id, which the client resolves to nothing and
  -- drops — the same contract as fms_hr_requisitions.hiring_manager_ids.
  default_qualification_ids    uuid[] not null default '{}',
  default_skill_ids            uuid[] not null default '{}',
  default_preferred_skill_ids  uuid[] not null default '{}',

  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.fms_hr_job_titles is
  'Job titles / positions a requisition can be raised for, each optionally carrying a JD template that pre-fills the MRF form. Distinct from public.designations, which is the EMPLOYEE title list behind profiles.designation.';
comment on column public.fms_hr_job_titles.default_responsibilities is
  'Newline-separated bullets. The MRF bullet editor splits on newline and rejoins the same way.';

create index if not exists fms_hr_job_titles_dept_idx
  on public.fms_hr_job_titles (department_id);

-- ---------------------------------------------------------------------------
-- fms_hr_skills — one flat list; `category` is a grouping, not an identity.
--
-- unique(name), NOT unique(category, name): the form shows ONE skills picker
-- with the categories as group headers, so two rows reading "Excel (advanced)"
-- under different headers would look like a bug. It also keeps the client's
-- case-insensitive duplicate check (findExistingMaster, which matches on name
-- alone across the whole type) honest — under a composite key it would refuse a
-- legitimate request for the same word in another category.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_skills (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  category    text not null default 'technical'
              check (category in ('technical','tool','soft','language','certification')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_hr_skills is
  'Skills a requisition can ask for. `category` groups them in the MRF pickers (technical / tool / soft / language / certification).';

create index if not exists fms_hr_skills_category_idx
  on public.fms_hr_skills (category, sort_order);

-- ---------------------------------------------------------------------------
-- fms_hr_qualifications — education.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_qualifications (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_hr_qualifications is
  'Educational qualifications a requisition can ask for (ITI, Diploma, B.E., MBA, …).';

-- ---------------------------------------------------------------------------
-- Triggers + RLS — identical to the four masters in 20260712120000, except the
-- write policy starts out already relaxed to `admin OR that master's owner`
-- (20260713130000 had to retrofit that onto the originals).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from (values
      ('fms_hr_job_titles',     'job_title'),
      ('fms_hr_skills',         'skill'),
      ('fms_hr_qualifications', 'qualification')
    ) as t(tbl, mt)
  loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', r.tbl);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', r.tbl);

    execute format('alter table public.%1$I enable row level security', r.tbl);

    -- Dropdown fodder, not PII: everyone signed in may read.
    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format('create policy %1$s_select on public.%1$I
                    for select to authenticated using (true)', r.tbl);

    execute format('drop policy if exists %1$s_write on public.%1$I', r.tbl);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated
         using (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(%2$L, auth.uid()))
         with check (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(%2$L, auth.uid()))',
      r.tbl, r.mt);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- GOVERNANCE — admit the three new types.
--
-- A CHECK constraint cannot be widened in place, so this is drop + add. No
-- table, column or row is touched, and every existing value still passes.
-- ---------------------------------------------------------------------------
alter table public.fms_hr_master_managers
  drop constraint if exists fms_hr_master_managers_master_type_check;
alter table public.fms_hr_master_managers
  add constraint fms_hr_master_managers_master_type_check
  check (master_type in (
    'job_platform','job_type','location','disqualification_reason','onboarding_item',
    'job_title','skill','qualification'
  ));

-- All three ARE requestable — unlike onboarding_item, each one backs a dropdown
-- on the MRF form, so "it's missing from this list" is a real moment to serve.
alter table public.fms_hr_master_requests
  drop constraint if exists fms_hr_master_requests_master_type_check;
alter table public.fms_hr_master_requests
  add constraint fms_hr_master_requests_master_type_check
  check (master_type in (
    'job_platform','job_type','location','disqualification_reason',
    'job_title','skill','qualification'
  ));

-- ---------------------------------------------------------------------------
-- RPC — the resolve chain, now eight branches.
--
-- ⚠ WIRE CONTRACT: the jsonb keys read below are produced verbatim by
-- frontend/src/apps/hr-recruitment/lib/masterFields.ts. Add a field there without
-- adding it here and it is silently dropped when the request is approved.
--
-- Unchanged from 20260713130000 except for the three new branches; restated in
-- full because `create or replace function` has no patch form.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
  v_name    text;
begin
  -- Lock the request; capture its type + current status.
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_hr_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  -- Authorization: admin, or the assigned owner of this master type.
  if not (public.is_admin(auth.uid()) or public.fms_hr_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  -- The approver's (optionally edited) payload wins; else the original.
  v_payload := coalesce(p_payload, v_payload);

  if p_approve then
    v_name := btrim(coalesce(v_payload->>'name', ''));
    if v_name = '' then
      raise exception 'A name is required to approve a master request';
    end if;

    begin
      if v_type = 'job_platform' then
        insert into public.fms_hr_job_platforms (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'job_type' then
        insert into public.fms_hr_job_types (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'location' then
        insert into public.fms_hr_locations (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'disqualification_reason' then
        insert into public.fms_hr_disqualification_reasons (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'job_title' then
        -- department_id only. The JD template is HR's job, on the Masters page —
        -- a requester is never asked to author one.
        insert into public.fms_hr_job_titles (name, department_id, created_by)
        values (v_name, nullif(v_payload->>'department_id','')::uuid, auth.uid())
        returning id into v_new_id;

      elsif v_type = 'skill' then
        -- Falls back to the column default rather than raising: an older client
        -- that predates the category field must still be approvable.
        insert into public.fms_hr_skills (name, category, created_by)
        values (v_name, coalesce(nullif(btrim(v_payload->>'category'),''), 'technical'), auth.uid())
        returning id into v_new_id;

      elsif v_type = 'qualification' then
        insert into public.fms_hr_qualifications (name, created_by)
        values (v_name, auth.uid())
        returning id into v_new_id;

      else
        raise exception 'Unknown master type %', v_type;
      end if;

    exception
      when unique_violation then
        -- These masters carry a CASE-SENSITIVE unique(name); the client's dup check
        -- is case-INSENSITIVE (i.e. stricter), so this only fires on a genuine race:
        -- the exact name was added straight into the master while this request sat
        -- pending, or the approver edited the name into an existing one. Nothing is
        -- half-done — the request stays pending and can still be rejected.
        raise exception '"%" is already in that master — reject this request instead of approving it.', v_name
          using errcode = '23505';
      when check_violation then
        -- Only reachable via a hand-edited payload: an unknown skill category.
        raise exception 'That is not a valid category for a %.', v_type
          using errcode = '23514';
    end;

    update public.fms_hr_master_requests
       set status             = 'approved',
           reviewed_by        = auth.uid(),
           review_note        = p_note,
           resolved_master_id = v_new_id,
           proposed_payload   = v_payload
     where id = p_request_id;
  else
    update public.fms_hr_master_requests
       set status      = 'rejected',
           reviewed_by = auth.uid(),
           review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

comment on function public.fms_hr_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (creating the real master row) or reject an HR master request. Admin or that master type''s owner only.';
grant execute on function public.fms_hr_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- EMAIL — teach the master-request mail the three new type labels.
--
-- Without this a request for a job title mails "A new entry was requested"
-- (the else arm of the case). Restated in full from 20260814120000; only the
-- three `when` lines are new.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_master_request_email_payload(
  p_entity_id uuid,
  p_type      text,
  p_text      text,
  p_meta      jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b  text := '/hr-recruitment';
  mr record;
  v_label text;
  v_name  text;
begin
  select * into mr from public.fms_hr_master_requests where id = p_entity_id;
  -- Row gone (or not readable) — fall back to the bell text so the mail is
  -- still coherent rather than empty.
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_label := case coalesce(p_meta->>'masterType', mr.master_type)
               when 'job_platform'            then 'job platform'
               when 'job_type'                then 'job type'
               when 'location'                then 'location'
               when 'disqualification_reason' then 'disqualification reason'
               when 'onboarding_item'         then 'checklist item'
               when 'job_title'             then 'job title'
               when 'skill'                   then 'skill'
               when 'qualification'           then 'qualification'
               else 'entry'
             end;
  v_name := coalesce(nullif(btrim(mr.proposed_payload->>'name'), ''), 'entry');

  if p_type = 'master_requested' then
    return jsonb_build_object(
      'subject',   'New ' || v_label || ' requested - "' || v_name || '"',
      'eyebrow',   'Master request',
      'headline',  'A new ' || v_label || ' was requested',
      'action',    'requested a new ' || v_label,
      'rows',      jsonb_build_array(jsonb_build_object('label', 'Name', 'value', v_name)),
      'ctaLabel',  'Review master requests',
      'ctaPath',   b || '/master-requests');
  end if;

  -- master_approved / master_rejected — addressed to the requester.
  return jsonb_build_object(
    'subject',  case when p_type = 'master_approved'
                     then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                     else 'Your ' || v_label || ' request was rejected' end,
    'eyebrow',  case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
    'headline', case when p_type = 'master_approved'
                     then 'Your new ' || v_label || ' was approved'
                     else 'Your ' || v_label || ' request was rejected' end,
    'action',   case when p_type = 'master_approved'
                     then 'approved a ' || v_label
                     else 'rejected a ' || v_label end,
    'rows',     jsonb_build_array(jsonb_build_object('label', 'Name', 'value', v_name)),
    'ctaLabel', 'Open master requests',
    'ctaPath',  b || '/master-requests')
  -- The reviewer's reason is the whole point of a rejection mail — carry it.
  || case when coalesce(btrim(mr.review_note), '') <> ''
          then jsonb_build_object('note', jsonb_build_object('label', 'Note', 'text', mr.review_note))
          else '{}'::jsonb end;
end $$;

grant execute on function public.fms_hr_master_request_email_payload(uuid, text, text, jsonb) to authenticated;
