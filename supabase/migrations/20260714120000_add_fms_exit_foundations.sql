-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — FOUNDATIONS (Phase 1).
--
-- The THIRD FMS module. Like fms_hr_*, it mirrors the fms_purchase_* config
-- backbone rather than reusing it: modules must stay independently droppable,
-- and a shared step_owners table would collide on step_key.
--
-- Tables:
--   fms_exit_step_owners        — one row per workflow step_key → owners
--   fms_exit_config             — key/value singletons (jsonb)
--   fms_exit_counters + next_seq— document numbering (EXIT-2627-0001, …)
--   fms_exit_activity           — immutable audit trail
--   fms_exit_notifications      — per-user bell feed
--   fms_exit_reasons            — master: why they are leaving
--   fms_exit_asset_types        — master: what can be issued to an employee
--   fms_exit_document_types     — master: relieving letter, experience letter, …
--   fms_exit_payroll_heads      — master: F&F additions / deductions
--   fms_exit_clearance_items    — master: THE CLEARANCE CHECKLIST, config-driven
--
-- ── THE ONE THING TO UNDERSTAND BEFORE TOUCHING THE AUTHZ HELPERS ───────────
--
--   `resignation` IS NOT A STEP ANYONE OWNS, AND THERE MUST NEVER BE A ROW FOR
--   IT IN fms_exit_step_owners.
--
--   HR Recruitment's read gate was fms_hr_is_any_step_owner() — "owns ANY step".
--   That silently leaked candidate PII, because `mrf` is the step where every
--   department HOD is listed (so they may raise a requisition), which made the
--   gate true for people who do not work in recruitment at all. It needed a
--   retrofit (20260712180000).
--
--   Here the same mistake would be catastrophic rather than merely bad: EVERY
--   EMPLOYEE may raise their own resignation. If "may raise" were expressed as
--   step ownership, the read gate would be true for the entire company and would
--   hand every person's salary, F&F and exit-interview transcript to everybody.
--
--   So raising an exit case is not step-owned at all (it is authorised inside
--   fms_exit_raise_case, Phase 2), and the read gate — fms_exit_is_exit_staff()
--   — explicitly excludes the `resignation` key. Rule: "may resign" ≠ "works in HR".
--
-- ── PII PARTITION ──────────────────────────────────────────────────────────
-- An exit case has three incompatible audiences: the clearance crowd (IT, Admin,
-- Travel Desk) need the person's name, department and last working day; the
-- reporting manager needs the handover; and NOBODY outside HR/Payroll may see the
-- exit-interview feedback or the F&F numbers — least of all the reporting manager,
-- who is frequently the reason for the exit. One wide table cannot express that,
-- so the case is a HEADER (Phase 2) plus confidential SATELLITES (Phases 5–6),
-- each with its own read gate. The two narrow gates below exist for them.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid).
-- Reversal (reverse order):
--   drop policy … on storage.objects (the 4 fms-exit-docs policies);
--   delete from storage.buckets where id = 'fms-exit-docs';
--   drop function if exists public.fms_exit_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_exit_step_owner_ids(text);
--   drop function if exists public.fms_exit_is_finance_staff(uuid);
--   drop function if exists public.fms_exit_is_hr_confidential(uuid);
--   drop function if exists public.fms_exit_is_coordinator(uuid);
--   drop function if exists public.fms_exit_is_exit_staff(uuid);
--   drop function if exists public.fms_exit_is_step_owner(text,uuid);
--   drop function if exists public.fms_exit_next_seq(text);
--   drop function if exists public.fms_exit_fy_code(date);
--   drop table if exists public.fms_exit_clearance_items, public.fms_exit_payroll_heads,
--                        public.fms_exit_document_types, public.fms_exit_asset_types,
--                        public.fms_exit_reasons, public.fms_exit_notifications,
--                        public.fms_exit_activity, public.fms_exit_counters,
--                        public.fms_exit_config, public.fms_exit_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_exit_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/hr-exit/lib/steps.ts.
--
-- department_ids is purely a UI filter for choosing employees; AUTHORIZATION
-- COMES SOLELY FROM employee_ids (same rule as Purchase — 20260708120600).
--
-- The MANAGER steps (manager_review, asset_return, handover) are owned per-case
-- by the exiting employee's own reporting manager, not by this table. Phase 2
-- adds fms_exit_can_act() to express that. Unlike HR's HOD steps, manager access
-- there is ADDITIVE: rows set here still act as co-owners, because asset_return
-- needs an HOD sign AND an HR sign, and handover needs both confirmations.
--
-- There is NO ROW for `resignation`, ever. See the header.
-- ===========================================================================
create table if not exists public.fms_exit_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fms_exit_step_owners_not_resignation check (step_key <> 'resignation')
);

comment on table public.fms_exit_step_owners is
  'Owners per HR Exit workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. `resignation` is barred by CHECK — every employee may raise one, so it must never confer staff-level read access.';

drop trigger if exists trg_fms_exit_step_owners_updated on public.fms_exit_step_owners;
create trigger trg_fms_exit_step_owners_updated
  before update on public.fms_exit_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_exit_step_owners enable row level security;
drop policy if exists fms_exit_step_owners_select on public.fms_exit_step_owners;
create policy fms_exit_step_owners_select on public.fms_exit_step_owners
  for select to authenticated using (true);
drop policy if exists fms_exit_step_owners_write on public.fms_exit_step_owners;
create policy fms_exit_step_owners_write on public.fms_exit_step_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_exit_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 2 }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
--   'payroll_cutoff_day'   → { "day": 25 }    the monthly payroll cut-off
--   'default_notice_days'  → { "value": 30 }  suggested notice period on a new case
--   'allow_self_service'   → { "value": true } may an employee raise their own exit?
-- ===========================================================================
create table if not exists public.fms_exit_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_exit_config is
  'Singleton HR Exit settings (step SLAs, coordinators, payroll cut-off, notice default) keyed by name.';

drop trigger if exists trg_fms_exit_config_updated on public.fms_exit_config;
create trigger trg_fms_exit_config_updated
  before update on public.fms_exit_config
  for each row execute function public.set_updated_at();

alter table public.fms_exit_config enable row level security;
drop policy if exists fms_exit_config_select on public.fms_exit_config;
create policy fms_exit_config_select on public.fms_exit_config
  for select to authenticated using (true);
drop policy if exists fms_exit_config_write on public.fms_exit_config;
create policy fms_exit_config_write on public.fms_exit_config
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- fms_exit_counters + fms_exit_next_seq — atomic document numbering.
-- Its own counter table, not fms_hr_*'s: modules stay independently droppable.
-- ===========================================================================
create table if not exists public.fms_exit_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_exit_counters is
  'Per-scope document-number sequences (e.g. EXIT-2627). Mutated only via fms_exit_next_seq().';

alter table public.fms_exit_counters enable row level security;
drop policy if exists fms_exit_counters_select_admin on public.fms_exit_counters;
create policy fms_exit_counters_select_admin on public.fms_exit_counters
  for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public.fms_exit_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_exit_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_exit_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_exit_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope.';
grant execute on function public.fms_exit_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-07-14 → '2627'.
create or replace function public.fms_exit_fy_code(p_d date)
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
grant execute on function public.fms_exit_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_exit_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_exit_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_exit_is_step_owner(text, uuid) to authenticated;

-- ⚠ THE READ GATE. Deliberately NOT called `is_any_step_owner`.
--
-- "Works in the exit process at all" — the test that lets someone read an exit
-- case they are not personally attached to. The `step_key <> 'resignation'`
-- clause is belt-and-braces alongside the CHECK constraint on the table: raising
-- your own resignation must never make you exit staff. See the file header.
create or replace function public.fms_exit_is_exit_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_exit_step_owners o
    where p_uid = any(o.employee_ids)
      and o.step_key <> 'resignation'
  );
$$;
grant execute on function public.fms_exit_is_exit_staff(uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_exit_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_exit_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_exit_is_coordinator(uuid) to authenticated;

-- ── The two NARROW gates, for the confidential satellites ──────────────────
--
-- Exit staff (above) is too wide for these. The IT person who owns `clearance`
-- and the Admin who owns `asset_return` are exit staff — they must NOT read the
-- exit interview or the settlement. These name the specific steps whose owners
-- legitimately need that data to do their job.

-- HR proper: whoever verifies, approves, or conducts the exit interview.
create or replace function public.fms_exit_is_hr_confidential(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_exit_step_owners o
    where p_uid = any(o.employee_ids)
      and o.step_key in ('hr_verification', 'hr_head_approval', 'exit_interview')
  );
$$;
grant execute on function public.fms_exit_is_hr_confidential(uuid) to authenticated;

-- Payroll / Accounts: whoever touches the money.
create or replace function public.fms_exit_is_finance_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_exit_step_owners o
    where p_uid = any(o.employee_ids)
      and o.step_key in ('leave_verification', 'payroll_inputs',
                         'fnf_generate', 'fnf_approve', 'fnf_payment')
  );
$$;
grant execute on function public.fms_exit_is_finance_staff(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_exit_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_exit_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_exit_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_exit_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'case' | 'clearance' | 'asset' | 'handover' | 'settlement' | …
  entity_id   uuid not null,
  type        text not null,            -- 'raised' | 'manager_reviewed' | 'approved' | 'cleared' | …
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_exit_activity_entity_idx on public.fms_exit_activity (entity_type, entity_id);
create index if not exists fms_exit_activity_created_idx on public.fms_exit_activity (created_at);

create table if not exists public.fms_exit_notifications (
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
create index if not exists fms_exit_notifications_user_idx on public.fms_exit_notifications (user_id, read_at);
create index if not exists fms_exit_notifications_created_idx on public.fms_exit_notifications (created_at);

-- The activity trail carries employee names in `note`, so it is not world-readable.
alter table public.fms_exit_activity enable row level security;
drop policy if exists fms_exit_activity_select on public.fms_exit_activity;
create policy fms_exit_activity_select on public.fms_exit_activity
  for select to authenticated
  using (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid()));
drop policy if exists fms_exit_activity_write_admin on public.fms_exit_activity;
create policy fms_exit_activity_write_admin on public.fms_exit_activity
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_exit_notifications enable row level security;
drop policy if exists fms_exit_notifications_select_own on public.fms_exit_notifications;
create policy fms_exit_notifications_select_own on public.fms_exit_notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists fms_exit_notifications_update_own on public.fms_exit_notifications;
create policy fms_exit_notifications_update_own on public.fms_exit_notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists fms_exit_notifications_write_admin on public.fms_exit_notifications;
create policy fms_exit_notifications_write_admin on public.fms_exit_notifications
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- One call = one activity row (actor = caller) + a notification fan-out.
-- Best-effort: NEVER the source of truth for state. Every workflow RPC stamps its
-- own timestamp column on a domain row (the lesson of 20260708120900).
drop function if exists public.fms_exit_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_exit_announce(
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
  insert into public.fms_exit_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_exit_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;
grant execute on function public.fms_exit_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- MASTERS — edited via the shared MasterCrud.
-- Select = all authenticated (they are dropdown fodder, not PII); write = admin
-- until 20260714190000 relaxes it to the master's owner.
-- ===========================================================================

create table if not exists public.fms_exit_reasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_exit_reasons is 'Why the employee is leaving. Drives the attrition-reason report.';

create table if not exists public.fms_exit_asset_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_exit_asset_types is 'What can be issued to an employee and must come back (laptop, ID card, SIM, …).';

create table if not exists public.fms_exit_document_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  requires_file boolean not null default true,   -- a letter with no PDF is a promise, not a document
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.fms_exit_document_types is 'Documents issued at closure (relieving letter, experience letter, F&F statement, NOC).';

create table if not exists public.fms_exit_payroll_heads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        text not null default 'deduction' check (kind in ('addition','deduction')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_exit_payroll_heads is
  'Line items on the F&F. The app RECORDS these amounts, it does not compute the settlement.';

-- ===========================================================================
-- THE CLEARANCE CHECKLIST — config-driven on purpose.
--
-- The source workflow names 8 clearance departments. Making each one a workflow
-- step would double the step list, double the nav, and make "HR adds a 9th
-- department" a code change + a migration. Instead `clearance` is ONE step whose
-- items live here, exactly as fms_hr_onboarding_items backs HR's onboarding.
--
-- Two columns carry the weight:
--
--  • due_days is SIGNED, and negative is the NORMAL case. A clearance item is due
--    BEFORE the last working day — you cannot chase a laptop after the person has
--    gone. It is a plain master column, never an SLA rule, so it never passes
--    through resolveStepSla() (which rejects negatives and silently substitutes a
--    default). The TS side does the maths with addWorkingDaysSigned().
--
--  • satisfied_by_step stops the same work being owed twice. Asset Return and
--    Handover are ALSO first-class steps (the operational sheet gives them their
--    own planned/actual/status/HOD-sign/HR-sign columns), so completing that step
--    auto-ticks the matching clearance rows. Clear the column and the row becomes
--    independent again — i.e. Admin/IT sign twice, if that is what they want.
-- ===========================================================================
create table if not exists public.fms_exit_clearance_items (
  id                          uuid primary key default gen_random_uuid(),
  key                         text not null unique,   -- stable slug for code that special-cases an item
  name                        text not null,
  department_label            text not null,          -- 'IT' | 'Admin' | 'Payroll' | 'Accounts' | 'Travel Desk' | 'Training' | 'HR' | 'Reporting Manager'
  description                 text,
  -- WHO owes it. Empty → falls back to the owners of the `clearance` step.
  owner_ids                   uuid[] not null default '{}',
  -- The rows that route PER CASE, like a MANAGER step: the case's own manager.
  owner_is_reporting_manager  boolean not null default false,
  requires_file               boolean not null default false,
  allows_link                 boolean not null default false,
  due_days                    integer not null default -1,   -- SIGNED, from the LWD. Negative = before it.
  satisfied_by_step           text,                          -- 'asset_return' | 'handover' | null
  active                      boolean not null default true,
  sort_order                  integer not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.fms_exit_clearance_items is
  'The departmental exit-clearance checklist, editable in Masters. Adding a department must never need a migration. due_days is signed and counted from the last working day (negative = before it).';

do $$
declare t text;
begin
  foreach t in array array[
    'fms_exit_reasons','fms_exit_asset_types','fms_exit_document_types',
    'fms_exit_payroll_heads','fms_exit_clearance_items'
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

-- ---- Seeds (idempotent; owners edit these in Masters afterwards) ------------

insert into public.fms_exit_reasons (name, sort_order) values
  ('Better opportunity', 1),
  ('Higher studies', 2),
  ('Relocation', 3),
  ('Health reasons', 4),
  ('Personal reasons', 5),
  ('Compensation', 6),
  ('Manager / team', 7),
  ('Role & growth', 8),
  ('Retirement', 9),
  ('End of contract', 10),
  ('Termination', 11),
  ('Absconding', 12)
on conflict (name) do nothing;

insert into public.fms_exit_asset_types (name, sort_order) values
  ('Laptop', 1), ('Mobile', 2), ('ID Card', 3), ('Access Card', 4), ('SIM', 5),
  ('Keys', 6), ('PPE', 7), ('Uniform', 8), ('Company Documents', 9), ('Vehicle', 10)
on conflict (name) do nothing;

insert into public.fms_exit_document_types (name, requires_file, sort_order) values
  ('Experience Letter', true, 1),
  ('Relieving Letter', true, 2),
  ('Full & Final Statement', true, 3),
  ('NOC', false, 4)
on conflict (name) do nothing;

insert into public.fms_exit_payroll_heads (name, kind, sort_order) values
  ('LWP', 'deduction', 1),
  ('Notice Recovery', 'deduction', 2),
  ('Loan Recovery', 'deduction', 3),
  ('Advance Recovery', 'deduction', 4),
  ('Asset Loss Recovery', 'deduction', 5),
  ('Other Deduction', 'deduction', 6),
  ('Incentive', 'addition', 7),
  ('Leave Encashment', 'addition', 8),
  ('Gratuity', 'addition', 9),
  ('Other Addition', 'addition', 10)
on conflict (name) do nothing;

-- The 8 clearance departments from the source workflow. owner_ids is left empty:
-- Setup wires the real people (the sheet names Khushi Soni for Payroll, Tanisha for
-- Travel Desk, Nidhi Binani for Training), and an empty list falls back to the
-- `clearance` step owners so nothing is ever owed by nobody.
insert into public.fms_exit_clearance_items
  (key, name, department_label, owner_is_reporting_manager, requires_file, allows_link, due_days, satisfied_by_step, sort_order) values
  ('manager_kt',        'Work handover & knowledge transfer',                    'Reporting Manager', true,  false, false, -2, 'handover',     1),
  ('hr_policy',         'Exit interview & policy compliance',                    'HR',                false, false, false, -1, null,           2),
  ('payroll_inputs',    'Payroll inputs & F&F',                                  'Payroll',           false, false, false,  0, null,           3),
  ('accounts_recovery', 'Loan recovery, advances, F&F approval',                 'Accounts',          false, false, false,  7, null,           4),
  ('admin_assets',      'ID card, access card, keys, furniture, uniform',        'Admin',             false, false, false, -1, 'asset_return', 5),
  ('it_assets',         'Laptop, email disable, system access, software licences','IT',               false, false, false, -1, 'asset_return', 6),
  ('travel_advance',    'Travel advance settlement',                             'Travel Desk',       false, false, false,  0, null,           7),
  ('training_material', 'Return of training material (if applicable)',           'Training',          false, false, false, -1, null,           8)
on conflict (key) do nothing;

-- ---- Config defaults --------------------------------------------------------
-- step_sla is left unset: the frontend merges a stored map over its code defaults,
-- so an unset step still behaves sanely.
insert into public.fms_exit_config (key, value) values
  ('payroll_cutoff_day',  '{"day": 25}'::jsonb),
  ('default_notice_days', '{"value": 30}'::jsonb),
  ('allow_self_service',  '{"value": true}'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- STORAGE — private bucket for resignation letters, clearance evidence,
-- asset photos, the F&F working, and the letters issued at closure.
--
-- Paths:
--   cases/<caseId>/resignation/<ts>-<name>
--   cases/<caseId>/clearance/<itemKey>/<ts>-<name>
--   cases/<caseId>/assets/<ts>-<name>
--   cases/<caseId>/handover/<ts>-<name>
--   cases/<caseId>/interview/<ts>-<name>     ← NEVER employee-visible
--   cases/<caseId>/fnf/<ts>-<name>           ← NEVER employee-visible (the working)
--   cases/<caseId>/share/<ts>-<name>         ← EMPLOYEE-VISIBLE: relieving letter,
--                                              experience letter, final F&F copy, signed ack
--
-- These policies are the STAFF ones. The employee's own read of `share/` is added
-- in 20260714130000, once fms_exit_cases exists to join against — Postgres
-- OR-combines permissive policies, so that one is purely additive (the idiom from
-- 20260708130000_add_leads_media_dashboard_read.sql).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-exit-docs', 'fms-exit-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms exit docs read" on storage.objects;
create policy "fms exit docs read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid()))
  );

drop policy if exists "fms exit docs insert" on storage.objects;
create policy "fms exit docs insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-exit-docs'
    and (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid()))
  );

drop policy if exists "fms exit docs update" on storage.objects;
create policy "fms exit docs update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid()))
  );

drop policy if exists "fms exit docs delete" on storage.objects;
create policy "fms exit docs delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (public.fms_exit_is_coordinator(auth.uid()) or public.fms_exit_is_exit_staff(auth.uid()))
  );
