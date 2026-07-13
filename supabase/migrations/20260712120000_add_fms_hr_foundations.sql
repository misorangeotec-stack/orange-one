-- ===========================================================================
-- HR Recruitment FMS — FOUNDATIONS (Phase 1).
--
-- The second FMS module. It deliberately MIRRORS the fms_purchase_* config
-- backbone rather than reusing it: two modules must stay independently
-- droppable, and a shared step_owners table would collide on step_key.
-- (The generic fms_workflows/fms_entries engine from 20260608120000 is retired —
-- see frontend/src/apps/registry.tsx — so it is not used here either.)
--
-- Tables:
--   fms_hr_step_owners             — one row per workflow step_key → owners
--   fms_hr_config                  — key/value singletons (jsonb)
--   fms_hr_counters + next_seq()   — document numbering (MRF-2627-0001, …)
--   fms_hr_activity                — immutable audit trail
--   fms_hr_notifications           — per-user bell feed
--   fms_hr_job_platforms           — master: where a job was posted
--   fms_hr_job_types               — master: Full-time / Contract / …
--   fms_hr_locations               — master: HR's own office list
--   fms_hr_disqualification_reasons— master
--   fms_hr_onboarding_items        — master: THE CHECKLIST, config-driven
--
-- Two deliberate departures from the Purchase schema, both load-bearing:
--
--  1. fms_hr_locations is a NEW master rather than reusing public.locations.
--     public.locations is Task Management's list and is wired into a completion-
--     gating trigger (task_locations, 20260602090000); adding HR's offices there
--     would surface them in Task Management's picker. Departments ARE reused
--     (public.departments), because profiles.department_id already points there —
--     an HR requisition genuinely names an org department.
--
--  2. Storage SELECT is restricted. The fms-purchase-docs bucket is readable by
--     any authenticated user; that is not acceptable here, because these objects
--     are candidate RESUMES (name, phone, address). Reads are limited to admins,
--     HR step owners and coordinators.
--
-- No approval matrix: HR approval is a fixed two-stage gate (HR Head →
-- Management) resolved by step ownership, with no amount bands.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal (reverse order):
--   drop policy … on storage.objects (the 4 fms-hr-docs policies);
--   delete from storage.buckets where id = 'fms-hr-docs';
--   drop function if exists public.fms_hr_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_hr_is_any_step_owner(uuid);
--   drop function if exists public.fms_hr_is_coordinator(uuid);
--   drop function if exists public.fms_hr_is_step_owner(text,uuid);
--   drop function if exists public.fms_hr_next_seq(text);
--   drop function if exists public.fms_hr_fy_code(date);
--   drop table if exists public.fms_hr_onboarding_items, public.fms_hr_disqualification_reasons,
--                        public.fms_hr_locations, public.fms_hr_job_types, public.fms_hr_job_platforms,
--                        public.fms_hr_notifications, public.fms_hr_activity,
--                        public.fms_hr_counters, public.fms_hr_config, public.fms_hr_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_hr_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant (mrf, hr_head_approval, mgmt_approval,
-- job_posting, resume_upload, hr_shortlist, …, probation_extension) — see
-- frontend/src/apps/hr-recruitment/lib/steps.ts.
--
-- department_ids is purely a UI filter for choosing employees; AUTHORIZATION
-- COMES SOLELY FROM employee_ids (same rule as Purchase — 20260708120600).
--
-- The HOD steps (hod_share, hod_shortlist, interview_2, probation_*) are the
-- exception: they are owned per-requisition by whoever raised the MRF, not by
-- this table. Phase 3 adds fms_hr_can_act() to express that. Rows may still be
-- set here as a fallback owner.
-- ===========================================================================
create table if not exists public.fms_hr_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_hr_step_owners is
  'Owners per HR workflow step (step_key). employee_ids are the notified/authorized owners assigned in Setup; department_ids is a UI filter only.';

drop trigger if exists trg_fms_hr_step_owners_updated on public.fms_hr_step_owners;
create trigger trg_fms_hr_step_owners_updated
  before update on public.fms_hr_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_hr_step_owners enable row level security;
drop policy if exists fms_hr_step_owners_select on public.fms_hr_step_owners;
create policy fms_hr_step_owners_select on public.fms_hr_step_owners
  for select to authenticated using (true);
drop policy if exists fms_hr_step_owners_write on public.fms_hr_step_owners;
create policy fms_hr_step_owners_write on public.fms_hr_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_hr_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 2 }, … }
--   'probation_sla'        → { "probation_m1": 1, … }   (calendar MONTHS from joining)
--   'process_coordinators' → { "user_ids": [ … ] }
--   'min_cvs_to_share'     → { "value": 5 }             (the sheet's "5–10 CVs" rule)
-- ===========================================================================
create table if not exists public.fms_hr_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_hr_config is
  'Singleton HR Recruitment settings (step SLAs, probation SLAs, process coordinators, …) keyed by name.';

drop trigger if exists trg_fms_hr_config_updated on public.fms_hr_config;
create trigger trg_fms_hr_config_updated
  before update on public.fms_hr_config
  for each row execute function public.set_updated_at();

alter table public.fms_hr_config enable row level security;
drop policy if exists fms_hr_config_select on public.fms_hr_config;
create policy fms_hr_config_select on public.fms_hr_config
  for select to authenticated using (true);
drop policy if exists fms_hr_config_write on public.fms_hr_config;
create policy fms_hr_config_write on public.fms_hr_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_hr_counters + fms_hr_next_seq — atomic document numbering.
-- ===========================================================================
create table if not exists public.fms_hr_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_hr_counters is
  'Per-scope document-number sequences (e.g. MRF-2627, CAN-2627). Mutated only via fms_hr_next_seq().';

alter table public.fms_hr_counters enable row level security;
drop policy if exists fms_hr_counters_select_admin on public.fms_hr_counters;
create policy fms_hr_counters_select_admin on public.fms_hr_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_hr_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_hr_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_hr_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_hr_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_hr_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-07-12 → '2627'.
create or replace function public.fms_hr_fy_code(p_d date)
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
grant execute on function public.fms_hr_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_hr_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_hr_is_step_owner(text, uuid) to authenticated;

-- Owner of ANY step. This is the "works in recruitment at all" test, and it is
-- what gates reading candidate PII / resumes (see the storage policy below and
-- fms_hr_can_read_requisition in Phase 3). Purchase has no equivalent because
-- its rows are not personal data.
create or replace function public.fms_hr_is_any_step_owner(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_step_owners o
    where p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_hr_is_any_step_owner(uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_hr_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_hr_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_hr_is_coordinator(uuid) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_hr_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'requisition' | 'candidate' | 'interview' | 'onboarding' | 'probation'
  entity_id   uuid not null,
  type        text not null,            -- 'submitted' | 'hr_approved' | 'moved' | 'disqualified' | ...
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_hr_activity_entity_idx on public.fms_hr_activity (entity_type, entity_id);
create index if not exists fms_hr_activity_created_idx on public.fms_hr_activity (created_at);

create table if not exists public.fms_hr_notifications (
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
create index if not exists fms_hr_notifications_user_idx on public.fms_hr_notifications (user_id, read_at);
create index if not exists fms_hr_notifications_created_idx on public.fms_hr_notifications (created_at);

-- The activity trail carries candidate names in `note`, so it is NOT world-readable
-- the way fms_purchase_activity is.
alter table public.fms_hr_activity enable row level security;
drop policy if exists fms_hr_activity_select on public.fms_hr_activity;
create policy fms_hr_activity_select on public.fms_hr_activity
  for select to authenticated
  using (public.fms_hr_is_coordinator(auth.uid()) or public.fms_hr_is_any_step_owner(auth.uid()));
drop policy if exists fms_hr_activity_write_admin on public.fms_hr_activity;
create policy fms_hr_activity_write_admin on public.fms_hr_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_hr_notifications enable row level security;
drop policy if exists fms_hr_notifications_select_own on public.fms_hr_notifications;
create policy fms_hr_notifications_select_own on public.fms_hr_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_hr_notifications_update_own on public.fms_hr_notifications;
create policy fms_hr_notifications_update_own on public.fms_hr_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_hr_notifications_write_admin on public.fms_hr_notifications;
create policy fms_hr_notifications_write_admin on public.fms_hr_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state. Every workflow RPC stamps its
-- own timestamp column on a domain row (the lesson of 20260708120900).
drop function if exists public.fms_hr_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_hr_announce(
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
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_hr_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_hr_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — all {id, name, active, sort_order}, edited via the shared MasterCrud.
-- Select = all authenticated (they are dropdown fodder, not PII); write = admin.
-- ===========================================================================

create table if not exists public.fms_hr_job_platforms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_hr_job_platforms is 'Where a vacancy is advertised (LinkedIn, Naukri, referral, …).';

create table if not exists public.fms_hr_job_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_hr_job_types is 'Employment type offered (Full-time, Contract, Intern, …).';

-- HR's own office list. See the header: public.locations belongs to Task Management.
create table if not exists public.fms_hr_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_hr_locations is 'Offices/sites a vacancy can be raised for. Separate from public.locations, which gates Task Management completion.';

create table if not exists public.fms_hr_disqualification_reasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_hr_disqualification_reasons is 'Why a candidate was dropped. Drives the "where does the pipeline leak" report.';

-- THE ONBOARDING CHECKLIST — config-driven on purpose.
-- Making each item a workflow step would blow up STEPS / the nav / the Control
-- Center, and would make "HR adds an 8th item" a code change. Instead `onboarding`
-- is ONE step, and each item's own due date = onboarding_date + due_days (working).
create table if not exists public.fms_hr_onboarding_items (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,     -- stable id for code that special-cases an item
  name          text not null,
  description   text,
  requires_file boolean not null default false,
  allows_link   boolean not null default false,   -- paste a Drive link instead of / as well as a file
  due_days      integer not null default 0,       -- working days from the onboarding date
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.fms_hr_onboarding_items is
  'The onboarding checklist, editable in Setup. Adding an item must never need a migration.';

do $$
declare t text;
begin
  foreach t in array array[
    'fms_hr_job_platforms','fms_hr_job_types','fms_hr_locations',
    'fms_hr_disqualification_reasons','fms_hr_onboarding_items'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                    for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated
                    using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t);
  end loop;
end $$;

-- ---- Seeds (idempotent; admins edit these in Setup afterwards) --------------

insert into public.fms_hr_job_platforms (name, sort_order) values
  ('Job Portal', 1), ('Career Page', 2), ('LinkedIn', 3), ('Naukri', 4),
  ('Employee Referral', 5), ('Consultancy', 6)
on conflict (name) do nothing;

insert into public.fms_hr_job_types (name, sort_order) values
  ('Full-Time', 1), ('Part-Time', 2), ('Contract', 3), ('Intern', 4), ('Consultant', 5)
on conflict (name) do nothing;

-- The three offices the requisition sheet actually uses.
insert into public.fms_hr_locations (name, sort_order) values
  ('Althan Office', 1), ('Sachin Office', 2), ('Delhi Office', 3)
on conflict (name) do nothing;

insert into public.fms_hr_disqualification_reasons (name, sort_order) values
  ('Not a skills match', 1),
  ('Insufficient experience', 2),
  ('Salary expectation too high', 3),
  ('Location not suitable', 4),
  ('Failed the interview', 5),
  ('Candidate withdrew', 6),
  ('No response / unreachable', 7),
  ('Position filled', 8)
on conflict (name) do nothing;

-- The 6 checklist items from the sheet's "HR Work" block (AS–BE). The Employee ID
-- is captured as a field on the onboarding, not as a checklist row.
insert into public.fms_hr_onboarding_items (key, name, requires_file, allows_link, due_days, sort_order) values
  ('offer_letter_sent',    'Offer letter sent',                                    true,  true,  0, 1),
  ('documents_collection', 'Documents collection',                                 false, true,  3, 2),
  ('police_verification',  'Police verification',                                  false, true,  7, 3),
  ('filing_of_records',    'Complete filing of records internally',                false, false, 7, 4),
  ('onboarding_form',      'Onboarding form + name/salary updated in list',        false, true,  2, 5),
  ('seating_system_sim',   'Seating arrangement, system, SIM handover, records',   false, false, 1, 6)
on conflict (key) do nothing;

-- ---- Config defaults --------------------------------------------------------
-- step_sla is left unset: the frontend merges a stored map over its code defaults
-- (previous step + 1 working day), so an unset step still behaves sanely.
insert into public.fms_hr_config (key, value) values
  ('probation_sla',    '{"probation_m1": 1, "probation_m2": 2, "probation_m3": 3, "probation_final": 3, "probation_extension": 4}'::jsonb),
  ('min_cvs_to_share', '{"value": 5}'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- STORAGE — private bucket for resumes, offer letters, onboarding docs.
--
-- Paths:  resumes/<requisitionId>/<ts>-<name>
--         onboarding/<onboardingId>/<itemKey>/<ts>-<name>
--         probation/<probationId>/m<month>/<ts>-<name>
--
-- SELECT is restricted (unlike fms-purchase-docs): these are resumes.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-hr-docs', 'fms-hr-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms hr docs read" on storage.objects;
create policy "fms hr docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-hr-docs'
    and (public.fms_hr_is_coordinator(auth.uid()) or public.fms_hr_is_any_step_owner(auth.uid()))
  );

drop policy if exists "fms hr docs insert" on storage.objects;
create policy "fms hr docs insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-hr-docs'
    and (public.fms_hr_is_coordinator(auth.uid()) or public.fms_hr_is_any_step_owner(auth.uid()))
  );

drop policy if exists "fms hr docs update" on storage.objects;
create policy "fms hr docs update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fms-hr-docs'
    and (public.fms_hr_is_coordinator(auth.uid()) or public.fms_hr_is_any_step_owner(auth.uid()))
  );

drop policy if exists "fms hr docs delete" on storage.objects;
create policy "fms hr docs delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fms-hr-docs'
    and (public.fms_hr_is_coordinator(auth.uid()) or public.fms_hr_is_any_step_owner(auth.uid()))
  );
