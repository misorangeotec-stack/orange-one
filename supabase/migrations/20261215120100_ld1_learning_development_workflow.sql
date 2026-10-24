-- ===========================================================================
-- LEARNING & DEVELOPMENT FMS — WORKFLOW (LD-1, part 2 of 2).
--
-- The annual plan, the training request, the session, step reassignment, the
-- authorization predicate and the RPCs for steps 1–8 (need → HR validation →
-- proposal → HR Head approval → conditional Management approval → trainer →
-- calendar and session).
--
-- Steps 9–22 (nomination, RSVP, material, conduct, attendance, the assignment,
-- feedback, review, 30-day effectiveness, follow-up, closure) add their own
-- tables and columns in LD-3 … LD-8. Nothing here is a placeholder for them:
-- what this file creates is finished, and what it omits is absent, not stubbed.
--
-- Depends on 20261215120000_ld1_learning_development_foundations.sql.
-- Rollback: 20261215120100_ld1_learning_development_workflow_rollback.sql
--           (run it BEFORE the foundations rollback).
--
-- ⚠ THE ANNUAL PLAN IS CREATED HERE, NOT IN LD-2, AND THAT IS ON PURPOSE.
--   LD-2 owns the plan's screens and the adherence arithmetic, but a session has
--   to be able to say which plan line it fulfils from the very first row it ever
--   holds. Adding `plan_line_id` later would mean a migration against live
--   sessions and a window in which adherence is unanswerable for everything
--   booked in between. The tables land now; the screens land in LD-2.
-- ===========================================================================

-- ===========================================================================
-- THE ANNUAL TRAINING PLAN
--
-- The source document does not have this. Saloni's KPI sheet scores "annual
-- training calendar publication — uploaded by January" (2%) and "training
-- calendar adherence — planned sessions completed as scheduled" (5%), and
-- adherence has no meaning without a plan to adhere to. Client confirmed
-- 21-09-2026: BOTH doors — a published yearly plan AND mid-year ad-hoc requests.
--
-- ⚠ PUBLICATION IS VERSIONED, NOT A FLAG. 2A is scored on whether the plan was
--   published by January, so a plan that can be silently edited afterwards can
--   be back-fitted to whatever actually happened — which would score 2% for
--   nothing. `published_at` is written once by the publish RPC and the row is
--   then frozen; a change after publication supersedes the plan with a new
--   revision (`supersedes_id`) and keeps the original readable.
-- ===========================================================================
create table if not exists public.fms_ld_plans (
  id             uuid primary key default gen_random_uuid(),
  fy_code        text not null,                      -- '2627'
  title          text not null,
  status         text not null default 'draft' check (status in ('draft','published','superseded')),
  revision       integer not null default 1,
  supersedes_id  uuid references public.fms_ld_plans(id) on delete set null,
  published_at   timestamptz,
  published_by   uuid references auth.users on delete set null,
  note           text,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fms_ld_plans_published_has_stamp check (
    (status = 'published' and published_at is not null)
    or (status <> 'published')
  )
);
comment on table public.fms_ld_plans is
  'One financial year''s training plan. Published once and then frozen; an edit after publication creates a new revision that supersedes it, so "was the calendar published by January" stays answerable.';
create index if not exists fms_ld_plans_fy_idx on public.fms_ld_plans (fy_code, status);

create table if not exists public.fms_ld_plan_lines (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.fms_ld_plans(id) on delete cascade,
  planned_month     date not null,                   -- first of the month
  title             text not null,
  session_type_ids  uuid[] not null default '{}',
  -- Who it is FOR, as a plan rather than as named people: any combination may be
  -- set, and all-empty means "the whole company".
  department_ids    uuid[] not null default '{}',
  designation_ids   uuid[] not null default '{}',
  band_ids          uuid[] not null default '{}',
  planned_headcount integer,
  planned_hours     numeric(6,2),
  estimated_cost    numeric(14,2),
  note              text,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.fms_ld_plan_lines is
  'One intended training in the year''s plan. A session may point at one of these (fms_ld_sessions.plan_line_id); a session with none is ad-hoc and counts toward the volume targets but NOT toward calendar adherence.';
create index if not exists fms_ld_plan_lines_plan_idx on public.fms_ld_plan_lines (plan_id, planned_month);

-- ===========================================================================
-- THE TRAINING REQUEST — one row per Training Request ID, steps 1–7.
--
-- ⚠ `mgmt_required` IS FROZEN ON THE ROW AT PROPOSAL TIME, not read live from
--   fms_ld_config. The rule is admin-editable (never / always / above ₹X), and
--   a request that cleared HR Head approval under "above ₹25,000" must not
--   silently sprout a second approval gate because somebody lowered the
--   threshold that afternoon — nor lose one because somebody raised it. The
--   rule decides; the decision is then a fact about this request.
-- ===========================================================================
create table if not exists public.fms_ld_requests (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,                 -- TRN-2627-0001
  status                text not null default 'draft' check (status in (
                          'draft','submitted','under_validation','returned','proposed',
                          'hr_approved','approved','rejected','trainer_finalised',
                          'scheduled','closed','cancelled')),

  -- step 1 · need
  title                 text not null,
  need_source_id        uuid references public.fms_ld_need_sources(id) on delete restrict,
  department_id         uuid references public.departments(id) on delete set null,
  requested_by          uuid references auth.users on delete set null,
  skill_gap             text,
  objective             text,
  target_group          text,
  required_by           date,
  priority              text check (priority in ('high','medium','low')),
  attachment_path       text,
  submitted_at          timestamptz,

  -- step 2 · sent back
  returned_at           timestamptz,
  returned_by           uuid references auth.users on delete set null,
  return_reason         text,

  -- step 3 · HR validation
  competency_id         uuid references public.fms_ld_competencies(id) on delete restrict,
  is_mandatory          boolean not null default false,
  duplicate_checked     boolean not null default false,
  business_justification text,
  expected_outcome      text,
  validated_by          uuid references auth.users on delete set null,
  validated_at          timestamptz,
  validation_note       text,

  -- step 4 · proposal, priority and budget
  session_type_ids      uuid[] not null default '{}',
  delivery_mode         text check (delivery_mode in ('classroom','online','hybrid','on_the_job')),
  proposed_trainer_type text check (proposed_trainer_type in ('internal','external')),
  proposed_cost         numeric(14,2),
  proposed_month        date,
  proposal_path         text,
  proposed_by           uuid references auth.users on delete set null,
  proposed_at           timestamptz,

  -- steps 5 and 6 · approvals
  mgmt_required         boolean,
  hr_approved_by        uuid references auth.users on delete set null,
  hr_approved_at        timestamptz,
  hr_approval_note      text,
  mgmt_approved_by      uuid references auth.users on delete set null,
  mgmt_approved_at      timestamptz,
  mgmt_approval_note    text,
  approved_budget       numeric(14,2),
  rejected_by           uuid references auth.users on delete set null,
  rejected_at           timestamptz,
  reject_reason         text,

  -- step 7 · trainer finalisation
  trainer_id            uuid references public.fms_ld_trainers(id) on delete restrict,
  trainer_terms         text,
  quotation_path        text,
  trainer_confirmed_by  uuid references auth.users on delete set null,
  trainer_confirmed_at  timestamptz,

  -- step 22 · closure (columns land now so the lifecycle is one row; LD-8 fills them)
  actual_cost           numeric(14,2),
  final_outcome         text,
  closure_note          text,
  closed_by             uuid references auth.users on delete set null,
  closed_at             timestamptz,
  reopened_by           uuid references auth.users on delete set null,
  reopened_at           timestamptz,
  reopen_reason         text,

  -- held (§6 dependency hold)
  held_reason_id        uuid references public.fms_ld_delay_reasons(id) on delete restrict,
  held_note             text,
  held_at               timestamptz,
  held_by               uuid references auth.users on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.fms_ld_requests is
  'One Training Request ID — the need, its validation, the proposal and budget, both approval gates and the trainer. mgmt_required is FROZEN here at proposal time rather than read live from the config rule, so moving the threshold never changes the gate a live request already passed.';
create index if not exists fms_ld_requests_status_idx on public.fms_ld_requests (status);
create index if not exists fms_ld_requests_requester_idx on public.fms_ld_requests (requested_by);
create index if not exists fms_ld_requests_dept_idx on public.fms_ld_requests (department_id);

drop trigger if exists trg_fms_ld_requests_updated on public.fms_ld_requests;
create trigger trg_fms_ld_requests_updated
  before update on public.fms_ld_requests
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- THE SESSION — step 8 onward. Born from an approved request, OR from a plan
-- line, OR from neither (ad-hoc). All three are legal; adherence only counts
-- the ones carrying plan_line_id.
--
-- ⚠ session_type_ids IS AN ARRAY AND THAT IS LOAD-BEARING. The weekly review
--   report: "External consultant / agency training and technical training are
--   counted separately — a technical session run by an external agency is
--   reported under both lines and once in the Total." One column cannot answer
--   that, and discovering it after go-live means a migration on live sessions.
-- ===========================================================================
create table if not exists public.fms_ld_sessions (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                    -- TRS-2627-0001
  request_id         uuid references public.fms_ld_requests(id) on delete set null,
  plan_line_id       uuid references public.fms_ld_plan_lines(id) on delete set null,

  title              text not null,
  session_type_ids   uuid[] not null default '{}',
  delivery_mode      text check (delivery_mode in ('classroom','online','hybrid','on_the_job')),
  trainer_id         uuid references public.fms_ld_trainers(id) on delete restrict,

  session_date       date not null,
  start_time         time,
  end_time           time,
  hours              numeric(5,2),
  venue_id           uuid references public.fms_ld_venues(id) on delete restrict,
  meeting_link       text,
  capacity           integer,
  registration_cutoff date,

  status             text not null default 'scheduled' check (status in (
                       'scheduled','nomination_open','invited','ready','conducted',
                       'attendance_closed','in_review','closed','rescheduled','cancelled')),
  outcome            text check (outcome in ('conducted','partially_conducted','rescheduled','cancelled')),
  actual_start       timestamptz,
  actual_end         timestamptz,
  change_reason      text,
  rescheduled_from   uuid references public.fms_ld_sessions(id) on delete set null,

  created_by         uuid references auth.users on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint fms_ld_sessions_end_after_start check (
    start_time is null or end_time is null or end_time > start_time
  ),
  constraint fms_ld_sessions_cutoff_before_date check (
    registration_cutoff is null or registration_cutoff <= session_date
  )
);
comment on table public.fms_ld_sessions is
  'One scheduled training event. request_id and plan_line_id are both optional and independent: from an approved request, from the annual plan, or ad-hoc. session_type_ids is an ARRAY because a session can be external AND technical at once and the weekly report counts it under both.';
create index if not exists fms_ld_sessions_date_idx on public.fms_ld_sessions (session_date);
create index if not exists fms_ld_sessions_status_idx on public.fms_ld_sessions (status);
create index if not exists fms_ld_sessions_request_idx on public.fms_ld_sessions (request_id);
create index if not exists fms_ld_sessions_plan_line_idx on public.fms_ld_sessions (plan_line_id);

drop trigger if exists trg_fms_ld_sessions_updated on public.fms_ld_sessions;
create trigger trg_fms_ld_sessions_updated
  before update on public.fms_ld_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_fms_ld_plans_updated on public.fms_ld_plans;
create trigger trg_fms_ld_plans_updated
  before update on public.fms_ld_plans
  for each row execute function public.set_updated_at();
drop trigger if exists trg_fms_ld_plan_lines_updated on public.fms_ld_plan_lines;
create trigger trg_fms_ld_plan_lines_updated
  before update on public.fms_ld_plan_lines
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- STEP REASSIGNMENT — one step of one request (or one session) handed to a
-- named person, replacing the global step owner for that row only.
--
-- ⚠ TWO NULLABLE FKs WITH A "EXACTLY ONE" CHECK, not a polymorphic
--   (entity_type, entity_id) pair. A polymorphic key cannot carry a foreign key,
--   so a deleted request would leave an assignee row pointing at nothing —
--   invisible junk that still answers "who owns this step". Two real FKs with
--   `on delete cascade` keep the integrity; two partial unique indexes give the
--   same one-holder-per-step guarantee the single-FK modules get.
-- ===========================================================================
create table if not exists public.fms_ld_step_assignees (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references public.fms_ld_requests(id) on delete cascade,
  session_id  uuid references public.fms_ld_sessions(id) on delete cascade,
  step_key    text not null,
  assigned_to uuid not null references auth.users on delete cascade,
  assigned_by uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  note        text,
  constraint fms_ld_step_assignees_one_target check (num_nonnulls(request_id, session_id) = 1)
);
comment on table public.fms_ld_step_assignees is
  'Who is currently holding one STEP of one request or one session. A row here REPLACES the global step owner for that row only; it is deleted, not nulled, on a hand-back.';
create unique index if not exists fms_ld_step_assignees_request_step_uniq
  on public.fms_ld_step_assignees (request_id, step_key) where request_id is not null;
create unique index if not exists fms_ld_step_assignees_session_step_uniq
  on public.fms_ld_step_assignees (session_id, step_key) where session_id is not null;

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- Does the config rule demand Management approval for this cost?
-- Returns the answer for the rule AS IT STANDS NOW; callers freeze it on the row.
create or replace function public.fms_ld_mgmt_required(p_cost numeric)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case coalesce((select c.value->>'mgmt' from public.fms_ld_config c where c.key = 'approval_rule'), 'never')
    when 'always' then true
    when 'never'  then false
    when 'above'  then coalesce(p_cost, 0) > coalesce(
                        (select (c.value->>'above_amount')::numeric
                           from public.fms_ld_config c where c.key = 'approval_rule'), 0)
    else false
  end;
$$;
comment on function public.fms_ld_mgmt_required(numeric) is
  'Does the current approval rule (never / always / above an amount) require Management approval for this cost? Evaluated once at proposal time and frozen on fms_ld_requests.mgmt_required.';
grant execute on function public.fms_ld_mgmt_required(numeric) to authenticated;

-- May p_uid act on p_step_key for this request?
--
-- ⚠ THE CLIENT LIST AND THIS FUNCTION MUST AGREE. The row-owned steps live in
--   frontend/src/apps/learning-development/lib/steps.ts (ROW_OWNED_STEPS).
--   Recruitment has shipped that disagreement twice — once leaving a HOD unable
--   to reject a CV they were reviewing. Change one, change the other.
--
-- Request-scoped steps only; the session- and participant-scoped steps arrive
-- with LD-3 … LD-8 and extend this function then.
create or replace function public.fms_ld_can_act(
  p_step_key   text,
  p_request_id uuid,
  p_uid        uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_requester uuid;
  v_assignee  uuid;
begin
  if p_uid is null then return false; end if;

  -- Admins and process coordinators oversee every step.
  if public.fms_ld_is_coordinator(p_uid) then return true; end if;

  -- A per-row reassignment REPLACES the global owner for that step.
  select assigned_to into v_assignee
    from public.fms_ld_step_assignees
   where request_id = p_request_id and step_key = p_step_key;
  if v_assignee is not null then
    return v_assignee = p_uid;
  end if;

  select requested_by into v_requester
    from public.fms_ld_requests where id = p_request_id;

  -- Revising a sent-back request is owed by whoever raised it, not by a step owner.
  if p_step_key = 'need_resubmit' then
    return v_requester = p_uid;
  end if;

  return public.fms_ld_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_ld_can_act(text, uuid, uuid) to authenticated;

-- Who may READ one request.
--
-- ⚠ NOT EVERYONE, even though the module is universal. The calendar and the
--   sessions are company-wide by the client's explicit ask; a request carries
--   the proposed and approved BUDGET and the trainer's commercial terms, which
--   is HR's business and the requester's. A plain employee sees the training on
--   the calendar, not what it cost to buy.
--
-- ⚠ READS NO TABLE THAT READS THIS ONE. fms_ld_sessions' own select policy is
--   `using (true)`, so there is no policy cycle here — two policies that read
--   each other make Postgres refuse both, which is how Travel Desk went dark.
create or replace function public.fms_ld_can_read_request(p_request_id uuid, p_uid uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_requester uuid;
begin
  if p_uid is null then return false; end if;
  if public.fms_ld_is_coordinator(p_uid) then return true; end if;

  select requested_by into v_requester from public.fms_ld_requests where id = p_request_id;
  if v_requester = p_uid then return true; end if;

  -- Any owner of any step in this workflow, and anyone holding a reassigned step.
  if exists (select 1 from public.fms_ld_step_owners o where p_uid = any(o.employee_ids)) then
    return true;
  end if;
  if exists (select 1 from public.fms_ld_step_assignees a
              where a.request_id = p_request_id and a.assigned_to = p_uid) then
    return true;
  end if;

  return false;
end $$;
grant execute on function public.fms_ld_can_read_request(uuid, uuid) to authenticated;

-- ===========================================================================
-- RLS
--
-- Reads are policy-driven; WRITES GO THROUGH THE RPCs BELOW and nothing else.
-- Every write policy is admin-only, so a mistyped PostgREST patch from the
-- browser cannot move a request sideways past its own rules.
-- ===========================================================================
alter table public.fms_ld_plans enable row level security;
alter table public.fms_ld_plan_lines enable row level security;
alter table public.fms_ld_requests enable row level security;
alter table public.fms_ld_sessions enable row level security;
alter table public.fms_ld_step_assignees enable row level security;

do $$
declare t text;
begin
  -- The plan and the calendar are company-wide: the client asked for "a proper
  -- calendar overview to the HR executive as well as to all the people who will
  -- be involved".
  foreach t in array array['plans','plan_lines','sessions','step_assignees'] loop
    execute format('drop policy if exists fms_ld_%1$s_select on public.fms_ld_%1$s', t);
    execute format(
      'create policy fms_ld_%1$s_select on public.fms_ld_%1$s
         for select to authenticated using (true)', t);
    execute format('drop policy if exists fms_ld_%1$s_write on public.fms_ld_%1$s', t);
    execute format(
      'create policy fms_ld_%1$s_write on public.fms_ld_%1$s
         for all to authenticated
         using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t);
  end loop;
end $$;

drop policy if exists fms_ld_requests_select on public.fms_ld_requests;
create policy fms_ld_requests_select on public.fms_ld_requests
  for select to authenticated using (public.fms_ld_can_read_request(id, auth.uid()));
drop policy if exists fms_ld_requests_write on public.fms_ld_requests;
create policy fms_ld_requests_write on public.fms_ld_requests
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPCs — steps 1 to 8.
--
-- Each one re-checks authorization, refuses a move the status master does not
-- allow (§5 of the source document), writes the row, and announces. They are the
-- only write path: the tables' own policies are admin-only.
-- ===========================================================================

-- ---- step 1 · raise ---------------------------------------------------------
create or replace function public.fms_ld_create_request(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_uid  uuid := auth.uid();
  v_sub  boolean := coalesce((p_payload->>'submit')::boolean, false);
  v_code text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- With NO owners on `need_raised`, anyone may raise — which is what the
  -- document asks for ("HOD / HR / Management creates a Training Request").
  -- Naming owners in Setup narrows it.
  if exists (select 1 from public.fms_ld_step_owners o
              where o.step_key = 'need_raised' and array_length(o.employee_ids,1) > 0)
     and not public.fms_ld_can_act('need_raised', null, v_uid) then
    raise exception 'You are not allowed to raise a training need';
  end if;

  if coalesce(p_payload->>'title','') = '' then
    raise exception 'A title is required';
  end if;
  -- §4: "Request cannot submit without objective, target group and required-by date."
  if v_sub and (coalesce(p_payload->>'objective','') = ''
                or coalesce(p_payload->>'target_group','') = ''
                or p_payload->>'required_by' is null) then
    raise exception 'Objective, target group and required-by date are required before submitting';
  end if;

  insert into public.fms_ld_requests (
    title, need_source_id, department_id, requested_by, skill_gap, objective,
    target_group, required_by, priority, attachment_path,
    status, submitted_at
  ) values (
    p_payload->>'title',
    nullif(p_payload->>'need_source_id','')::uuid,
    nullif(p_payload->>'department_id','')::uuid,
    v_uid,
    p_payload->>'skill_gap',
    p_payload->>'objective',
    p_payload->>'target_group',
    nullif(p_payload->>'required_by','')::date,
    nullif(p_payload->>'priority',''),
    p_payload->>'attachment_path',
    case when v_sub then 'submitted' else 'draft' end,
    case when v_sub then now() else null end
  ) returning id into v_id;

  if v_sub then
    v_code := 'TRN-' || public.fms_ld_fy_code(current_date) || '-' ||
              lpad(public.fms_ld_next_seq('request:' || public.fms_ld_fy_code(current_date))::text, 4, '0');
    update public.fms_ld_requests set code = v_code where id = v_id;

    perform public.fms_ld_announce(
      'request', v_id, 'ld_need_raised',
      'New training need raised: ' || (p_payload->>'title'),
      public.fms_ld_step_owner_ids('need_validation'));
  end if;

  return v_id;
end $$;
grant execute on function public.fms_ld_create_request(jsonb) to authenticated;

-- ---- step 3 · HR validation (or send back) ----------------------------------
create or replace function public.fms_ld_validate_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default '{}'::jsonb,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_req    uuid;
begin
  select status, requested_by into v_status, v_req
    from public.fms_ld_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Training request not found'; end if;
  if v_status not in ('submitted','under_validation') then
    raise exception 'This request is % and cannot be validated', v_status;
  end if;
  if not public.fms_ld_can_act('need_validation', p_request_id, v_uid) then
    raise exception 'Not authorised to validate training needs';
  end if;

  if not p_approve then
    if coalesce(p_note,'') = '' then
      raise exception 'A reason is required when sending a request back';
    end if;
    update public.fms_ld_requests
       set status = 'returned', returned_at = now(), returned_by = v_uid, return_reason = p_note
     where id = p_request_id;
    perform public.fms_ld_announce('request', p_request_id, 'ld_need_returned',
      'Training need sent back: ' || p_note, array[v_req]);
    return;
  end if;

  update public.fms_ld_requests
     set status = 'under_validation',
         competency_id = coalesce(nullif(p_payload->>'competency_id','')::uuid, competency_id),
         is_mandatory = coalesce((p_payload->>'is_mandatory')::boolean, is_mandatory),
         duplicate_checked = coalesce((p_payload->>'duplicate_checked')::boolean, duplicate_checked),
         business_justification = coalesce(p_payload->>'business_justification', business_justification),
         expected_outcome = coalesce(p_payload->>'expected_outcome', expected_outcome),
         validated_by = v_uid, validated_at = now(), validation_note = p_note
   where id = p_request_id;

  perform public.fms_ld_announce('request', p_request_id, 'ld_need_validated',
    'Training need validated', public.fms_ld_step_owner_ids('proposal'));
end $$;
grant execute on function public.fms_ld_validate_request(uuid, boolean, jsonb, text) to authenticated;

-- ---- step 4 · proposal, priority and budget ---------------------------------
-- Freezes mgmt_required here. See the ⚠ on fms_ld_requests.
create or replace function public.fms_ld_submit_proposal(p_request_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_cost   numeric := nullif(p_payload->>'proposed_cost','')::numeric;
  v_mgmt   boolean;
begin
  select status into v_status from public.fms_ld_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Training request not found'; end if;
  if v_status not in ('under_validation','returned','proposed') then
    raise exception 'This request is % and is not ready for a proposal', v_status;
  end if;
  if not public.fms_ld_can_act('proposal', p_request_id, v_uid) then
    raise exception 'Not authorised to propose training';
  end if;
  if coalesce(p_payload->>'priority','') = '' then
    raise exception 'A priority is required on the proposal';
  end if;

  v_mgmt := public.fms_ld_mgmt_required(v_cost);

  update public.fms_ld_requests
     set status = 'proposed',
         priority = p_payload->>'priority',
         session_type_ids = coalesce(
           (select array_agg(x::uuid) from jsonb_array_elements_text(
              coalesce(p_payload->'session_type_ids','[]'::jsonb)) t(x)), '{}'::uuid[]),
         delivery_mode = nullif(p_payload->>'delivery_mode',''),
         proposed_trainer_type = nullif(p_payload->>'proposed_trainer_type',''),
         proposed_cost = v_cost,
         proposed_month = nullif(p_payload->>'proposed_month','')::date,
         proposal_path = p_payload->>'proposal_path',
         proposed_by = v_uid, proposed_at = now(),
         mgmt_required = v_mgmt
   where id = p_request_id;

  perform public.fms_ld_announce('request', p_request_id, 'ld_proposal_submitted',
    'Training proposal ready for HR Head approval',
    public.fms_ld_step_owner_ids('hr_head_approval'),
    jsonb_build_object('mgmt_required', v_mgmt, 'proposed_cost', v_cost));
end $$;
grant execute on function public.fms_ld_submit_proposal(uuid, jsonb) to authenticated;

-- ---- steps 5 and 6 · the two approval gates ---------------------------------
--
-- ⚠ A SKIPPED MANAGEMENT GATE IS RECORDED, NOT ABSENT. When mgmt_required is
--   false the request goes straight from hr_approved to approved, and the
--   activity trail says so — otherwise the audit shows a request that was never
--   put to Management with no statement that it never had to be.
create or replace function public.fms_ld_approve_request(
  p_request_id uuid,
  p_stage      text,            -- 'hr_head' | 'management'
  p_decision   text,            -- 'approve' | 'reject' | 'return'
  p_payload    jsonb default '{}'::jsonb,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_mgmt   boolean;
  v_req    uuid;
  v_step   text := case p_stage when 'hr_head' then 'hr_head_approval'
                                when 'management' then 'mgmt_approval' end;
  v_budget numeric := nullif(p_payload->>'approved_budget','')::numeric;
begin
  if v_step is null then raise exception 'Unknown approval stage %', p_stage; end if;

  select status, mgmt_required, requested_by
    into v_status, v_mgmt, v_req
    from public.fms_ld_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Training request not found'; end if;
  if not public.fms_ld_can_act(v_step, p_request_id, v_uid) then
    raise exception 'Not authorised to give % approval', p_stage;
  end if;

  if p_stage = 'hr_head' and v_status <> 'proposed' then
    raise exception 'This request is % and is not waiting for HR Head approval', v_status;
  end if;
  if p_stage = 'management' then
    if v_status <> 'hr_approved' then
      raise exception 'This request is % and is not waiting for Management approval', v_status;
    end if;
    if not coalesce(v_mgmt, false) then
      raise exception 'Management approval is not required for this request';
    end if;
  end if;

  if p_decision = 'reject' then
    if coalesce(p_note,'') = '' then raise exception 'A reason is required to reject'; end if;
    update public.fms_ld_requests
       set status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = p_note
     where id = p_request_id;
    perform public.fms_ld_announce('request', p_request_id, 'ld_request_rejected',
      'Training request rejected: ' || p_note, array[v_req]);
    return;
  end if;

  if p_decision = 'return' then
    if coalesce(p_note,'') = '' then raise exception 'A reason is required to return'; end if;
    update public.fms_ld_requests
       set status = 'under_validation', returned_at = now(), returned_by = v_uid, return_reason = p_note
     where id = p_request_id;
    perform public.fms_ld_announce('request', p_request_id, 'ld_request_returned',
      'Training proposal returned for revision: ' || p_note,
      public.fms_ld_step_owner_ids('proposal'));
    return;
  end if;

  if p_decision <> 'approve' then raise exception 'Unknown decision %', p_decision; end if;

  if p_stage = 'hr_head' then
    if coalesce(v_mgmt, false) then
      update public.fms_ld_requests
         set status = 'hr_approved', hr_approved_by = v_uid, hr_approved_at = now(),
             hr_approval_note = p_note, approved_budget = coalesce(v_budget, approved_budget)
       where id = p_request_id;
      perform public.fms_ld_announce('request', p_request_id, 'ld_hr_approved',
        'Training approved by HR Head, now with Management',
        public.fms_ld_step_owner_ids('mgmt_approval'));
    else
      update public.fms_ld_requests
         set status = 'approved', hr_approved_by = v_uid, hr_approved_at = now(),
             hr_approval_note = p_note, approved_budget = coalesce(v_budget, approved_budget)
       where id = p_request_id;
      -- The skip, stated.
      perform public.fms_ld_announce('request', p_request_id, 'ld_mgmt_not_required',
        'Management approval not required under the current approval rule',
        '{}'::uuid[]);
      perform public.fms_ld_announce('request', p_request_id, 'ld_request_approved',
        'Training approved — trainer to be finalised',
        public.fms_ld_step_owner_ids('trainer_finalization'));
    end if;
  else
    update public.fms_ld_requests
       set status = 'approved', mgmt_approved_by = v_uid, mgmt_approved_at = now(),
           mgmt_approval_note = p_note, approved_budget = coalesce(v_budget, approved_budget)
     where id = p_request_id;
    perform public.fms_ld_announce('request', p_request_id, 'ld_request_approved',
      'Training approved by Management — trainer to be finalised',
      public.fms_ld_step_owner_ids('trainer_finalization'));
  end if;
end $$;
grant execute on function public.fms_ld_approve_request(uuid, text, text, jsonb, text) to authenticated;

-- ---- step 7 · trainer finalisation ------------------------------------------
create or replace function public.fms_ld_finalise_trainer(p_request_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
begin
  select status into v_status from public.fms_ld_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Training request not found'; end if;
  if v_status not in ('approved','trainer_finalised') then
    raise exception 'This request is % and is not ready for a trainer', v_status;
  end if;
  if not public.fms_ld_can_act('trainer_finalization', p_request_id, v_uid) then
    raise exception 'Not authorised to finalise the trainer';
  end if;
  if nullif(p_payload->>'trainer_id','') is null then
    raise exception 'A trainer is required';
  end if;

  update public.fms_ld_requests
     set status = 'trainer_finalised',
         trainer_id = (p_payload->>'trainer_id')::uuid,
         trainer_terms = p_payload->>'trainer_terms',
         quotation_path = p_payload->>'quotation_path',
         trainer_confirmed_by = v_uid, trainer_confirmed_at = now()
   where id = p_request_id;

  perform public.fms_ld_announce('request', p_request_id, 'ld_trainer_confirmed',
    'Trainer confirmed — session to be scheduled',
    public.fms_ld_step_owner_ids('session_scheduling'));
end $$;
grant execute on function public.fms_ld_finalise_trainer(uuid, jsonb) to authenticated;

-- ---- step 8 · create the session --------------------------------------------
--
-- Accepts a request_id, a plan_line_id, both, or neither. "Neither" is an ad-hoc
-- session, which is legal and is exactly what the annual-plan half is there to
-- distinguish: only a session carrying plan_line_id counts toward adherence.
create or replace function public.fms_ld_create_session(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  uuid := nullif(p_payload->>'request_id','')::uuid;
  v_id   uuid;
  v_code text;
  v_st   text;
begin
  if not public.fms_ld_can_act('session_scheduling', v_req, v_uid) then
    raise exception 'Not authorised to schedule sessions';
  end if;
  if coalesce(p_payload->>'title','') = '' then raise exception 'A title is required'; end if;
  if nullif(p_payload->>'session_date','') is null then raise exception 'A session date is required'; end if;

  if v_req is not null then
    select status into v_st from public.fms_ld_requests where id = v_req for update;
    if v_st is null then raise exception 'Training request not found'; end if;
    if v_st not in ('trainer_finalised','scheduled') then
      raise exception 'This request is % and is not ready to be scheduled', v_st;
    end if;
  end if;

  v_code := 'TRS-' || public.fms_ld_fy_code(current_date) || '-' ||
            lpad(public.fms_ld_next_seq('session:' || public.fms_ld_fy_code(current_date))::text, 4, '0');

  insert into public.fms_ld_sessions (
    code, request_id, plan_line_id, title, session_type_ids, delivery_mode, trainer_id,
    session_date, start_time, end_time, hours, venue_id, meeting_link, capacity,
    registration_cutoff, created_by
  ) values (
    v_code, v_req, nullif(p_payload->>'plan_line_id','')::uuid,
    p_payload->>'title',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
       coalesce(p_payload->'session_type_ids','[]'::jsonb)) t(x)), '{}'::uuid[]),
    nullif(p_payload->>'delivery_mode',''),
    nullif(p_payload->>'trainer_id','')::uuid,
    (p_payload->>'session_date')::date,
    nullif(p_payload->>'start_time','')::time,
    nullif(p_payload->>'end_time','')::time,
    nullif(p_payload->>'hours','')::numeric,
    nullif(p_payload->>'venue_id','')::uuid,
    p_payload->>'meeting_link',
    nullif(p_payload->>'capacity','')::int,
    nullif(p_payload->>'registration_cutoff','')::date,
    v_uid
  ) returning id into v_id;

  if v_req is not null then
    update public.fms_ld_requests set status = 'scheduled' where id = v_req;
  end if;

  perform public.fms_ld_announce('session', v_id, 'ld_session_scheduled',
    'Training session scheduled: ' || (p_payload->>'title'),
    public.fms_ld_step_owner_ids('nomination'));

  return v_id;
end $$;
grant execute on function public.fms_ld_create_session(jsonb) to authenticated;

-- ---- reassign one step -------------------------------------------------------
create or replace function public.fms_ld_reassign_step(
  p_request_id uuid,
  p_step_key   text,
  p_to_user    uuid,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.fms_ld_is_coordinator(v_uid)
     and not public.fms_ld_is_step_owner(p_step_key, v_uid) then
    raise exception 'Not authorised to reassign this step';
  end if;

  if p_to_user is null then
    delete from public.fms_ld_step_assignees
     where request_id = p_request_id and step_key = p_step_key;
    perform public.fms_ld_announce('request', p_request_id, 'ld_step_handed_back',
      'Step handed back to its usual owners', public.fms_ld_step_owner_ids(p_step_key));
    return;
  end if;

  insert into public.fms_ld_step_assignees (request_id, step_key, assigned_to, assigned_by, note)
  values (p_request_id, p_step_key, p_to_user, v_uid, p_note)
  on conflict (request_id, step_key) where request_id is not null
  do update set assigned_to = excluded.assigned_to,
                assigned_by = excluded.assigned_by,
                assigned_at = now(),
                note = excluded.note;

  perform public.fms_ld_announce('request', p_request_id, 'ld_step_reassigned',
    coalesce(p_note, 'Step reassigned'), array[p_to_user]);
end $$;
grant execute on function public.fms_ld_reassign_step(uuid, text, uuid, text) to authenticated;
