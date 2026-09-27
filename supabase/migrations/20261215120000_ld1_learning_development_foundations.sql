-- ===========================================================================
-- LEARNING & DEVELOPMENT FMS — FOUNDATIONS + MASTERS (LD-1, part 1 of 2).
--
-- The module mirrors the config backbone into its OWN fms_ld_* tables rather
-- than reusing a shared one, exactly as fms_dispatch_* / fms_hr_* / fms_import_*
-- do: modules must stay independently droppable, and a shared step_owners table
-- would collide on step_key.
--
-- WHAT LEARNING & DEVELOPMENT IS
--   Training from the moment somebody spots a skill gap to the moment the record
--   closes: need → HR validation → proposal, priority and budget → HR Head (and,
--   conditionally, Management) approval → trainer → calendar and session →
--   nomination by the HOD and approval by L&D → invitation and RSVP → material →
--   the session itself → attendance → the assignment → feedback → HR's session
--   review → the HOD's 30-day effectiveness note → follow-up → closure.
--   22 steps. Source spec: files/Orange_Hub_Learning_Development_FMS_Flow.docx,
--   §11 "Final Arrow-wise End-to-End Flow" (page 8), plus the twelve decisions
--   the client made on 21-09-2026 — see WORKLIST.md → Learning & Development →
--   LD-0, which is the record of what was asked and what was answered.
--
-- TWO CLIENT DECISIONS THAT SHOW UP IN THIS FILE
--   • NO ASSESSMENT. No test, no marks, no pass mark, no assessment-result
--     master. Only whether each nominee submitted the assignment. §7 of the
--     document lists an "Assessment result" master; it is deliberately absent.
--   • MANAGEMENT APPROVAL IS CONDITIONAL — never / always / above an amount,
--     held in fms_ld_config under 'approval_rule'. Seeded 'never' so a fresh
--     install does not park every request in front of somebody who has not been
--     named yet (PF-14: four modules shipped with no owners and their approvals
--     went nowhere).
--
-- ⚠ DELIBERATE DEVIATION FROM §7 OF THE SOURCE DOCUMENT. It asks for six
--   masters: delay reasons, session outcome, attendance status, assessment
--   result, effectiveness outcome, follow-up action. Only TWO of those are
--   vocabulary; the rest are LOGIC. "Conducted" vs "cancelled" decides whether a
--   session counts toward calendar adherence; "present" vs "partial" decides the
--   learning hours; "not effective" decides whether a follow-up is forced. A
--   master row can be renamed by its owner from a Masters screen, and renaming
--   one of those would silently change an arithmetic that feeds an appraisal
--   score. So outcomes and statuses are CHECK-constrained enums in code, and
--   only delay reasons + follow-up actions (both purely descriptive) are
--   masters. Assessment result is gone entirely with the client's decision.
--
-- ⚠ SESSION TYPES CARRY A STABLE `code` AS WELL AS A NAME, and that is
--   load-bearing. The weekly review report counts "external agency" and
--   "technical" as separate lines and a session that is both is reported under
--   both and once in the total, and LD-9 identifies POSH and Safety sessions to
--   credit a year's mandatory compliance. Matching on the display name would
--   break the moment somebody edits "POSH" to "POSH (Prevention of Sexual
--   Harassment)" — which is exactly the sort of edit a master screen invites.
--   The code is what the reports match on; the name is what people read.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Rollback: 20261215120000_ld1_learning_development_foundations_rollback.sql
-- ===========================================================================

-- ===========================================================================
-- fms_ld_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see
-- frontend/src/apps/learning-development/lib/steps.ts.
-- Authorization comes SOLELY from employee_ids; department_ids is a UI filter.
--
-- No CHECK bars the origin step (`need_raised`) from being owned: with no owners
-- on it ANY signed-in user may raise a training need, which is what the document
-- asks for ("HOD / HR / Management creates a Training Request"). Naming owners
-- narrows it. Same convention as Order to Dispatch's `sales_order`.
-- ===========================================================================
create table if not exists public.fms_ld_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_ld_step_owners is
  'Owners per Learning & Development FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. With no owners on `need_raised`, every signed-in user may raise a training need.';

drop trigger if exists trg_fms_ld_step_owners_updated on public.fms_ld_step_owners;
create trigger trg_fms_ld_step_owners_updated
  before update on public.fms_ld_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_ld_step_owners enable row level security;
drop policy if exists fms_ld_step_owners_select on public.fms_ld_step_owners;
create policy fms_ld_step_owners_select on public.fms_ld_step_owners
  for select to authenticated using (true);
drop policy if exists fms_ld_step_owners_write on public.fms_ld_step_owners;
create policy fms_ld_step_owners_write on public.fms_ld_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_ld_config — key/value singletons (jsonb). Keys seeded below:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 2,
--                              "unit": "working" | "calendar" }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
--   'approval_rule'        → { "mgmt": "never" | "always" | "above",
--                              "above_amount": 25000 }
--   'nomination_rules'     → { "hod_may_nominate": true, "self_may_nominate": false,
--                              "default_capacity": null, "cutoff_days": 3,
--                              "require_ld_approval": true }
--   'feedback_assignment'  → { "feedback_window_hours": 48, "assignment_due_days": 7,
--                              "review_sla_days": 7,
--                              "internal_trainer_sees_names": true }
--   'effectiveness'        → { "days_after_session": 30, "reminder_lead_days": 3,
--                              "respond_within_days": 7 }
--   'targets'              → { "internal_year": 15, "external_year": 48,
--                              "external_month": 3, "technical_month": 2,
--                              "total_month": 5, "attendance_pct": 85,
--                              "assignment_pct": 80, "hours_per_head_year": 10 }
--
-- ⚠ EVERY NUMBER ABOVE IS A SEED, NOT A RULE. §1 of the source document says the
--   L&D timelines "are recommended configuration values and may be changed by HR
--   before development sign-off", and the two HR documents disagree with each
--   other on the targets (the KPI sheet says 15 internal + 48 external a year;
--   the weekly form says 3 external + 2 technical + 5 total a month, which is 36
--   external a year). Both sets are seeded so nothing is blocked, and Setup →
--   Targets is where HR settles it. See LD-0's owed list.
-- ===========================================================================
create table if not exists public.fms_ld_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_ld_config is
  'Singleton Learning & Development FMS settings (step SLAs, coordinators, the conditional Management-approval rule, nomination rules, feedback/assignment windows, effectiveness window, annual and monthly training targets) keyed by name.';

drop trigger if exists trg_fms_ld_config_updated on public.fms_ld_config;
create trigger trg_fms_ld_config_updated
  before update on public.fms_ld_config
  for each row execute function public.set_updated_at();

alter table public.fms_ld_config enable row level security;
drop policy if exists fms_ld_config_select on public.fms_ld_config;
create policy fms_ld_config_select on public.fms_ld_config
  for select to authenticated using (true);
drop policy if exists fms_ld_config_write on public.fms_ld_config;
create policy fms_ld_config_write on public.fms_ld_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Seeds. `on conflict do nothing` so re-running never overwrites HR's settings.
insert into public.fms_ld_config (key, value) values
  ('approval_rule', '{"mgmt":"never","above_amount":25000}'::jsonb),
  ('nomination_rules', '{"hod_may_nominate":true,"self_may_nominate":false,"default_capacity":null,"cutoff_days":3,"require_ld_approval":true}'::jsonb),
  ('feedback_assignment', '{"feedback_window_hours":48,"assignment_due_days":7,"review_sla_days":7,"internal_trainer_sees_names":true}'::jsonb),
  ('effectiveness', '{"days_after_session":30,"reminder_lead_days":3,"respond_within_days":7}'::jsonb),
  ('targets', '{"internal_year":15,"external_year":48,"external_month":3,"technical_month":2,"total_month":5,"attendance_pct":85,"assignment_pct":80,"hours_per_head_year":10}'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- fms_ld_counters + fms_ld_next_seq — atomic document numbering.
-- Scopes: 'request:<fy>' → TRN-2627-0001, 'session:<fy>' → TRS-2627-0001.
-- ===========================================================================
create table if not exists public.fms_ld_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_ld_counters is
  'Per-scope document-number sequences (request:<fy>, session:<fy>). Mutated only via fms_ld_next_seq().';

alter table public.fms_ld_counters enable row level security;
drop policy if exists fms_ld_counters_select_admin on public.fms_ld_counters;
create policy fms_ld_counters_select_admin on public.fms_ld_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_ld_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_ld_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_ld_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_ld_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_ld_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-01 → '2627'.
create or replace function public.fms_ld_fy_code(p_d date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_d) >= 4
      then to_char(p_d, 'YY') || to_char((p_d + interval '1 year'), 'YY')
    else to_char((p_d - interval '1 year'), 'YY') || to_char(p_d, 'YY')
  end;
$$;
grant execute on function public.fms_ld_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_ld_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_ld_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_ld_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_ld_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_ld_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_ld_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_ld_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_ld_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_ld_step_owner_ids(text) to authenticated;

-- ---------------------------------------------------------------------------
-- THE HOD OF ONE EMPLOYEE, and the employees of one HOD.
--
-- Two of this module's steps are ROW-OWNED by a HOD rather than by the step-owner
-- table: nominating their own people, and writing the 30-day effectiveness note
-- about them. There is no departments.hod_id in this hub, so "the HOD" is
-- resolved the same way the rest of the platform does it — user_hods first
-- (the reporting line, 47 of 67 internal profiles carried one on 21-09-2026),
-- falling back to fms_hr_department_hods (the recruitment module's department
-- map, which held ONE row for 23 departments on the same date).
--
-- ⚠ IT RETURNS AN EMPTY ARRAY FOR TWENTY PEOPLE TODAY, AND THAT IS THE POINT.
--   An attendee whose HOD cannot be resolved has nobody the system can ask, and
--   the honest answer is to SAY SO on the session review rather than count the
--   effectiveness review complete. Never treat empty as "no review needed" —
--   reporting a control that does not exist is worse than reporting a gap.
--   Tracked in LD-8; the map itself is somebody's data job, not a build item.
--
-- ⚠ READS ANOTHER MODULE'S TABLE (fms_hr_department_hods) on the fallback arm.
--   Deliberate and one-directional: L&D reads it, never writes it, and the join
--   is guarded with to_regclass so this module still installs on a database
--   where New Recruitment has not been applied.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_hods_of(p_employee_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids  uuid[] := '{}';
  v_dept uuid;
begin
  if p_employee_id is null then return '{}'::uuid[]; end if;

  select coalesce(array_agg(distinct h.hod_id), '{}'::uuid[])
    into v_ids
  from public.user_hods h
  where h.employee_id = p_employee_id
    and h.hod_id is not null;

  if array_length(v_ids, 1) is not null then
    return v_ids;
  end if;

  -- Fallback: the department map, if New Recruitment is installed here.
  if to_regclass('public.fms_hr_department_hods') is null then
    return '{}'::uuid[];
  end if;

  select p.department_id into v_dept from public.profiles p where p.id = p_employee_id;
  if v_dept is null then return '{}'::uuid[]; end if;

  execute
    'select coalesce(d.hod_ids, ''{}''::uuid[]) from public.fms_hr_department_hods d where d.department_id = $1'
    into v_ids using v_dept;

  return coalesce(v_ids, '{}'::uuid[]);
end $$;

comment on function public.fms_ld_hods_of(uuid) is
  'The HODs of one employee: user_hods (the reporting line) first, the recruitment module''s department map as a fallback. Returns an EMPTY array when neither knows — the caller must surface that, never treat it as "no review needed".';
grant execute on function public.fms_ld_hods_of(uuid) to authenticated;

-- Is p_uid the HOD of p_employee_id? The predicate behind the two row-owned steps.
create or replace function public.fms_ld_is_hod_of(p_uid uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and p_uid = any(public.fms_ld_hods_of(p_employee_id));
$$;
grant execute on function public.fms_ld_is_hod_of(uuid, uuid) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_ld_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request' | 'session' | 'plan' | 'master_request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_ld_activity_entity_idx on public.fms_ld_activity (entity_type, entity_id);
create index if not exists fms_ld_activity_created_idx on public.fms_ld_activity (created_at);

comment on table public.fms_ld_activity is
  'Audit trail: who changed what, when, and why. §13 of the source document makes this an acceptance item — every change stores user, timestamp, old value, new value and reason (the last three in meta).';

create table if not exists public.fms_ld_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  type        text not null,
  entity_type text not null,
  entity_id   uuid not null,
  text        text not null,
  actor_id    uuid references auth.users on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists fms_ld_notifications_user_idx on public.fms_ld_notifications (user_id, read_at);
create index if not exists fms_ld_notifications_created_idx on public.fms_ld_notifications (created_at);

alter table public.fms_ld_activity enable row level security;
drop policy if exists fms_ld_activity_select on public.fms_ld_activity;
create policy fms_ld_activity_select on public.fms_ld_activity
  for select to authenticated using (true);
drop policy if exists fms_ld_activity_write_admin on public.fms_ld_activity;
create policy fms_ld_activity_write_admin on public.fms_ld_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_ld_notifications enable row level security;
drop policy if exists fms_ld_notifications_select_own on public.fms_ld_notifications;
create policy fms_ld_notifications_select_own on public.fms_ld_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_ld_notifications_update_own on public.fms_ld_notifications;
create policy fms_ld_notifications_update_own on public.fms_ld_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_ld_notifications_write_admin on public.fms_ld_notifications;
create policy fms_ld_notifications_write_admin on public.fms_ld_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state. The actor is NOT skipped —
-- people want a receipt for steps they action themselves.
--
-- ⚠ THIS MODULE'S FAN-OUT IS WIDER THAN ANY OTHER FMS HERE. A session with 30
--   nominees notifies 30 people per notice, and the module is universal so every
--   employee is a potential recipient. That is fine in-app; it is the reason
--   LD-12 (email) is last on the list and ships switched off.
drop function if exists public.fms_ld_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_ld_announce(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_user_ids    uuid[] default '{}',
  p_meta        jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
begin
  insert into public.fms_ld_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_ld_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_ld_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — 7 tables, all edited via the shared MasterCrud (which also gives
-- Excel export/import for free). Select = all authenticated (dropdown fodder);
-- write = admin OR that master's owner.
--
-- Every master carries the MasterCrud contract columns: id / name / active /
-- sort_order. Nothing is ever hard-deleted — rows are deactivated, so a past
-- session's history can never be orphaned (hence `on delete restrict` on the
-- workflow FKs in part 2).
-- ===========================================================================

-- ---- session types ---------------------------------------------------------
-- `code` is the stable handle the reports match on; `name` is what people read
-- and may be renamed freely. See the ⚠ in this file's header for why.
create table if not exists public.fms_ld_session_types (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_ld_session_types is
  'What a training session IS. A session carries SEVERAL of these at once (fms_ld_sessions.session_type_ids), because the weekly review report counts an external agency session and a technical session on separate lines and reports a session that is both under both lines and once in the total. `code` is stable and is what reports and the POSH/Safety compliance check match on; `name` is editable.';

insert into public.fms_ld_session_types (code, name, sort_order) values
  ('external_agency', 'External Agency',      10),
  ('internal',        'Internal',             20),
  ('technical',       'Technical',            30),
  ('functional',      'Functional',           40),
  ('behavioural',     'Behavioural',          50),
  ('leadership',      'Leadership',           60),
  ('posh',            'POSH',                 70),
  ('safety',          'Safety',               80),
  ('compliance',      'Compliance',           90),
  ('induction',       'Induction',           100),
  ('mandatory',       'Mandatory / Statutory', 110)
on conflict (name) do nothing;

-- ---- competencies ----------------------------------------------------------
create table if not exists public.fms_ld_competencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_ld_competencies is
  'The competency a training maps to, recorded at HR validation (§3 step 2 of the source document: "Validation status, remarks, mapped competency").';

-- ---- need sources ----------------------------------------------------------
create table if not exists public.fms_ld_need_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_ld_need_sources is
  'Where a training need came from. §2 of the source document names six: HOD, HR, PMS/KRA review, induction, compliance requirement, management direction.';

insert into public.fms_ld_need_sources (name, sort_order) values
  ('HOD request',            10),
  ('HR / L&D',               20),
  ('PMS / KRA review',       30),
  ('Induction',              40),
  ('Compliance requirement', 50),
  ('Management direction',   60)
on conflict (name) do nothing;

-- ---- venues ----------------------------------------------------------------
create table if not exists public.fms_ld_venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  address     text,
  capacity    integer,
  is_online   boolean not null default false,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_ld_venues is
  'Where a session happens. An online "venue" carries is_online and the session holds the joining link instead of a room.';

-- ---- trainers --------------------------------------------------------------
-- ⚠ AN EXTERNAL TRAINER IS A MASTER ROW, NEVER A LOGIN (client decision, LD-0 · 5).
--   No outsider gets an Orange Hub account: HR uploads their material and marks
--   the session on their behalf. employee_id is therefore set ONLY for internal
--   trainers, and the CHECK below makes the two shapes mutually exclusive rather
--   than leaving it to the UI.
create table if not exists public.fms_ld_trainers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  trainer_type  text not null check (trainer_type in ('internal','external')),
  employee_id   uuid references public.profiles(id) on delete set null,
  agency        text,
  contact_name  text,
  email         text,
  phone         text,
  speciality    text,
  rate          numeric(14,2),
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint fms_ld_trainers_name_type_uniq unique (name, trainer_type),
  constraint fms_ld_trainers_internal_has_employee check (
    (trainer_type = 'internal' and employee_id is not null)
    or (trainer_type = 'external' and employee_id is null)
  )
);
comment on table public.fms_ld_trainers is
  'Who delivers a session. INTERNAL trainers are real portal users (employee_id) and may own the material and conduct steps themselves; EXTERNAL trainers are a master row with no login at all — HR acts on their behalf, and they therefore never see feedback either (client decision, 21-09-2026).';
create index if not exists fms_ld_trainers_employee_idx on public.fms_ld_trainers (employee_id);

-- ---- delay reasons ---------------------------------------------------------
-- The one master in §7 that really is vocabulary: it explains a pause, it never
-- decides an arithmetic.
create table if not exists public.fms_ld_delay_reasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_ld_delay_reasons is
  'Why a step is held. §6 of the source document: the clock may pause only for an approved dependency reason picked from this master, with approval and remarks mandatory.';

insert into public.fms_ld_delay_reasons (name, sort_order) values
  ('HOD input pending',              10),
  ('Approval pending',               20),
  ('Budget pending',                 30),
  ('Trainer unavailable',            40),
  ('Participant nomination pending', 50),
  ('Venue / link issue',             60),
  ('Employee unavailable',           70),
  ('System issue',                   80),
  ('Material pending',               90),
  ('Assignment pending',            100),
  ('Feedback pending',              110),
  ('Manager effectiveness pending', 120),
  ('Other (remarks mandatory)',     130)
on conflict (name) do nothing;

-- ---- follow-up actions -----------------------------------------------------
create table if not exists public.fms_ld_followup_actions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_ld_followup_actions is
  'What happens after the effectiveness review. §7 of the source document names six.';

insert into public.fms_ld_followup_actions (name, sort_order) values
  ('Manager coaching',     10),
  ('Reassessment',         20),
  ('Refresher training',   30),
  ('Advanced training',    40),
  ('Process / job aid',    50),
  ('No action',            60)
on conflict (name) do nothing;

-- ---- updated_at triggers + read policies for every master ------------------
do $$
declare t text;
begin
  foreach t in array array[
    'session_types','competencies','need_sources','venues','trainers',
    'delay_reasons','followup_actions'
  ] loop
    execute format('drop trigger if exists trg_fms_ld_%1$s_updated on public.fms_ld_%1$s', t);
    execute format(
      'create trigger trg_fms_ld_%1$s_updated before update on public.fms_ld_%1$s
         for each row execute function public.set_updated_at()', t);
    execute format('alter table public.fms_ld_%1$s enable row level security', t);
    execute format('drop policy if exists fms_ld_%1$s_select on public.fms_ld_%1$s', t);
    execute format(
      'create policy fms_ld_%1$s_select on public.fms_ld_%1$s
         for select to authenticated using (true)', t);
  end loop;
end $$;

-- ===========================================================================
-- MASTER GOVERNANCE — owners per master type + "request a new master" queue.
-- ===========================================================================
create table if not exists public.fms_ld_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in (
                    'session_type','competency','need_source','venue','trainer',
                    'delay_reason','followup_action')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);
comment on table public.fms_ld_master_managers is
  'Assigns one or more owners per Learning & Development master type; owners may CRUD that master and resolve its new-entry requests. Unassigned → admins only.';
create index if not exists fms_ld_master_managers_type_idx
  on public.fms_ld_master_managers (master_type);

drop trigger if exists trg_fms_ld_master_managers_updated on public.fms_ld_master_managers;
create trigger trg_fms_ld_master_managers_updated
  before update on public.fms_ld_master_managers
  for each row execute function public.set_updated_at();

create or replace function public.fms_ld_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_ld_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_ld_is_master_manager(text, uuid) to authenticated;

-- Master writes: admin OR that master's owner. One policy per master table,
-- generated from the (table, master_type) pairing so the two lists cannot drift.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('session_types','session_type'), ('competencies','competency'),
      ('need_sources','need_source'), ('venues','venue'), ('trainers','trainer'),
      ('delay_reasons','delay_reason'), ('followup_actions','followup_action')
    ) as v(tbl, mtype)
  loop
    execute format('drop policy if exists fms_ld_%1$s_write on public.fms_ld_%1$s', r.tbl);
    execute format(
      'create policy fms_ld_%1$s_write on public.fms_ld_%1$s
         for all to authenticated
         using (public.is_admin(auth.uid()) or public.fms_ld_is_master_manager(%2$L, auth.uid()))
         with check (public.is_admin(auth.uid()) or public.fms_ld_is_master_manager(%2$L, auth.uid()))',
      r.tbl, r.mtype);
  end loop;
end $$;

alter table public.fms_ld_master_managers enable row level security;
drop policy if exists fms_ld_master_managers_select on public.fms_ld_master_managers;
create policy fms_ld_master_managers_select on public.fms_ld_master_managers
  for select to authenticated using (true);
drop policy if exists fms_ld_master_managers_write on public.fms_ld_master_managers;
create policy fms_ld_master_managers_write on public.fms_ld_master_managers
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ---- "Request a new master" queue -----------------------------------------
create table if not exists public.fms_ld_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in (
                       'session_type','competency','need_source','venue','trainer',
                       'delay_reason','followup_action')),
  proposed_payload   jsonb not null default '{}',
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.fms_ld_master_requests is
  'New-master-entry requests from any user. Resolved (approved → real master row created, or rejected) by admin/owner via fms_ld_resolve_master_request.';
create index if not exists fms_ld_master_requests_status_idx
  on public.fms_ld_master_requests (status, master_type);

drop trigger if exists trg_fms_ld_master_requests_updated on public.fms_ld_master_requests;
create trigger trg_fms_ld_master_requests_updated
  before update on public.fms_ld_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_ld_master_requests enable row level security;
drop policy if exists fms_ld_master_requests_select on public.fms_ld_master_requests;
create policy fms_ld_master_requests_select on public.fms_ld_master_requests
  for select to authenticated using (true);
drop policy if exists fms_ld_master_requests_insert on public.fms_ld_master_requests;
create policy fms_ld_master_requests_insert on public.fms_ld_master_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending');
drop policy if exists fms_ld_master_requests_update on public.fms_ld_master_requests;
create policy fms_ld_master_requests_update on public.fms_ld_master_requests
  for update to authenticated
  using (public.is_admin(auth.uid()) or public.fms_ld_is_master_manager(master_type, auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_ld_is_master_manager(master_type, auth.uid()));

-- Resolve a master request: approve (create the real master row) or reject.
-- SECURITY DEFINER so it can insert into the target master regardless of the
-- caller's own per-table policy; re-checks authz and locks the request row.
--
-- ⚠ WIRE CONTRACT: the payload keys below are read VERBATIM and must match
--   frontend/src/apps/learning-development/lib/masterFields.ts. Adding a field
--   there without adding it here silently drops it on approve.
create or replace function public.fms_ld_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text default null
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
begin
  select master_type, status, coalesce(p_payload, proposed_payload)
    into v_type, v_status, v_payload
  from public.fms_ld_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'This request has already been %', v_status;
  end if;
  if not (public.is_admin(auth.uid()) or public.fms_ld_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorised to resolve % requests', v_type;
  end if;

  if not p_approve then
    update public.fms_ld_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
    return null;
  end if;

  if v_type = 'session_type' then
    insert into public.fms_ld_session_types (name, sort_order)
    values (v_payload->>'name', coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  elsif v_type = 'competency' then
    insert into public.fms_ld_competencies (name, sort_order)
    values (v_payload->>'name', coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  elsif v_type = 'need_source' then
    insert into public.fms_ld_need_sources (name, sort_order)
    values (v_payload->>'name', coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  elsif v_type = 'venue' then
    insert into public.fms_ld_venues (name, address, capacity, is_online, sort_order)
    values (v_payload->>'name', v_payload->>'address',
            nullif(v_payload->>'capacity','')::int,
            coalesce((v_payload->>'is_online')::boolean, false),
            coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  elsif v_type = 'trainer' then
    insert into public.fms_ld_trainers
      (name, trainer_type, employee_id, agency, contact_name, email, phone, speciality, rate, sort_order)
    values (v_payload->>'name',
            coalesce(v_payload->>'trainer_type','external'),
            nullif(v_payload->>'employee_id','')::uuid,
            v_payload->>'agency', v_payload->>'contact_name',
            v_payload->>'email', v_payload->>'phone', v_payload->>'speciality',
            nullif(v_payload->>'rate','')::numeric,
            coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  elsif v_type = 'delay_reason' then
    insert into public.fms_ld_delay_reasons (name, sort_order)
    values (v_payload->>'name', coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  elsif v_type = 'followup_action' then
    insert into public.fms_ld_followup_actions (name, sort_order)
    values (v_payload->>'name', coalesce((v_payload->>'sort_order')::int, 0))
    returning id into v_new_id;

  else
    raise exception 'Unknown master type %', v_type;
  end if;

  update public.fms_ld_master_requests
     set status = 'approved', reviewed_by = auth.uid(),
         review_note = p_note, resolved_master_id = v_new_id
   where id = p_request_id;

  return v_new_id;
end $$;
grant execute on function public.fms_ld_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;

-- ===========================================================================
-- STORAGE — private bucket. Folders: proposal/, quotation/, material/,
-- attendance/, evidence/, assignment/, submission/.
--
-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's (and vice versa).
--
-- ⚠ THIS IS THE FIRST MODULE HERE WHERE AN ORDINARY EMPLOYEE WRITES A FILE.
--   Every other FMS bucket is written by step owners; this one takes assignment
--   submissions from any nominee, and the module is universal. The insert policy
--   is therefore open to `authenticated` like its siblings, and the REAL limit is
--   the path convention plus the RPC that records the submission — a stray
--   upload with no submission row is invisible to every screen. Tightening this
--   to per-folder ownership is worth doing once LD-6 exists and the paths are
--   settled; it is noted there rather than guessed at now.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-ld-docs', 'fms-ld-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms ld docs read"   on storage.objects;
drop policy if exists "fms ld docs insert" on storage.objects;
drop policy if exists "fms ld docs update" on storage.objects;
drop policy if exists "fms ld docs delete" on storage.objects;

create policy "fms ld docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-ld-docs');
create policy "fms ld docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-ld-docs');
create policy "fms ld docs update" on storage.objects
  for update to authenticated using (bucket_id = 'fms-ld-docs') with check (bucket_id = 'fms-ld-docs');
create policy "fms ld docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-ld-docs');
