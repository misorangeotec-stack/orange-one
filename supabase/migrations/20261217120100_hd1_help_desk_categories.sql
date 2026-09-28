-- ===========================================================================
-- HELP DESK FMS — THE TICKET CATEGORY MASTER (HD-1, part 2 of 2).
--
-- THIS TABLE IS THE ROUTER. Everything the workflow needs to know about a
-- ticket that the employee should not have to type is on the category row:
--
--     who owns it            owner_ids
--     how long they have     tat_days  (or tat_text, when the TAT is a policy)
--     who it escalates to    escalation_l1_ids / _l2_ids  (+ their labels)
--     is it confidential     confidential
--     does it belong to
--       another module       handoff_app_id
--
-- Source: files/FMS- Help Desk.pdf, the "TICKET CATEGORIES" table — 28 rows,
-- transcribed verbatim, plus two the client added on 28-09-2026: IT Support
-- (D5) and Others (the generic catch-all, which forces a free-text note).
-- 30 rows seeded. The decision record is HELP-DESK.md section 3.
--
-- ── FOUR THINGS THE SHEET DOES AND A NAIVE SCHEMA DOES NOT ──────────────────
--
-- 1. ⚠ SIX TATs ARE NOT NUMBERS, BUT ONLY FIVE ARE UNTIMED. "As per Exit
--    Policy", "As per Calendar", "As per Training Calendar", "As per POSH
--    Policy" and "As per Case" are carried as `tat_days = null` + `tat_text`;
--    "Immediate" (Visitor Management) is the sixth non-numeric TAT and is NOT
--    among them, because it is a real deadline — it becomes `tat_days = 0`, due
--    the same working day. Conflating the two is what made the first draft of
--    the assertion below expect six; the rehearsal caught it. A null
--    tat_days means the ticket's resolve step is DELIBERATELY UNTIMED —
--    QueueEntryBase.dueIso is `string | null` and null there means "can never be
--    late". The SLA report must state how many tickets were untimed rather than
--    quietly shrinking its own denominator.
--
-- 2. ⚠ ONE "TAT" IS A RESPONSE TIME, NOT A RESOLUTION TIME. Employee Grievance
--    says "Initial Response within 24 Hours". That is the acknowledge step, not
--    the resolve step, so it is seeded as tat_days = 1 with the sheet's own
--    wording preserved in tat_text — the screen prints both and nobody has to
--    reconcile them.
--
-- 3. ⚠ MOST ESCALATION TARGETS ARE ROLES, NOT PEOPLE. The sheet names
--    "Management", "Finance Head", "Hiring Manager", "Department Head", "HOD",
--    "Accounts", "Admin Vendor", "Insurance Provider", "ICC Committee" and
--    "Director". Only "HR Head" resolves to a portal account. So each level has
--    BOTH an id array and a LABEL: the ids are who is actually notified, the
--    label is what the sheet promises, and the ticket prints the label even when
--    no id is set. An escalation with a label and no ids is RECORDED and falls
--    back to config.policy.escalation_fallback_user_id — it never silently
--    notifies nobody while the screen claims an escalation path.
--    (PF-14 is the standing lesson: four modules shipped with no owners
--    configured and every approval in them went nowhere.)
--
-- 4. ⚠ ELEVEN CATEGORIES BELONG TO ANOTHER MODULE (decision D1). Help Desk is the
--    one front door, but a travel booking is a Travel Desk trip and an
--    onboarding query is a New Recruitment requisition. `handoff_app_id` names
--    the module; the owner's resolve panel offers "Raise it in <module>" and the
--    ticket keeps the link. The WORK lives where it belongs; only the ASK lives
--    here. Do not resolve these inside Help Desk as if the other module did not
--    exist, or the same booking is counted twice in two people's KPIs.
--
-- ── SEEDING RULES ───────────────────────────────────────────────────────────
-- ⚠ PEOPLE ARE RESOLVED BY EMAIL, NOT BY HARD-CODED UUID, and the migration
--   RAISES if one is missing. A uuid literal in a seed is unreadable six months
--   later and silently wrong if the account was recreated.
-- ⚠ NOTHING IS SEEDED WITH AN OWNER WE INVENTED. Where the sheet names a role
--   with no portal account, the row gets the label and no id.
--
-- Purely ADDITIVE.
-- Rollback: 20261217120100_hd1_help_desk_categories_rollback.sql
-- ===========================================================================

-- ── 0. Checks first, OUTSIDE any lock ───────────────────────────────────────
do $pre$
declare v_missing text;
begin
  if to_regclass('public.fms_help_config') is null then
    raise exception 'HD-1 part 2: apply 20261217120000_hd1_help_desk_foundations.sql first';
  end if;
  if to_regclass('public.fms_help_categories') is not null then
    raise exception 'HD-1 part 2: fms_help_categories already exists — this migration has been applied';
  end if;

  -- The five HR accounts the sheet names. Fail here, loudly, rather than seeding
  -- 30 categories with null owners that nobody notices until a ticket goes
  -- nowhere.
  select string_agg(e, ', ') into v_missing
    from unnest(array[
      'khushi@orangeotec.com',      -- Khushi Soni      — HR Operations
      'travel@orangeotec.com',      -- Tanisha Tikde    — Travel Desk
      'recruitment@orangeotec.com', -- Saloni Rathod    — TA / L&D
      'office@orangeotec.com',      -- Dharmistha Prajapati — HR & Admin ("Receptionist cum HR Executive")
      'riya@orangeotec.com'         -- Riya Kumari      — HR Head
    ]) as e
   where not exists (select 1 from public.profiles p where lower(p.email) = e);
  if v_missing is not null then
    raise exception 'HD-1 part 2: no profile for %', v_missing;
  end if;
end $pre$;

begin;

-- ===========================================================================
-- Who may edit the master. Admins and coordinators always; plus whoever Setup
-- names, so HR can maintain their own category list without an admin login.
-- ===========================================================================
insert into public.fms_help_config (key, value)
values ('master_owners', jsonb_build_object('department_ids', '[]'::jsonb, 'user_ids', '[]'::jsonb))
on conflict (key) do nothing;

create or replace function public.fms_help_is_master_manager(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fms_help_is_coordinator(p_uid)
      or exists (
        select 1 from public.fms_help_config c
        where c.key = 'master_owners'
          and p_uid::text in (
            select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
          )
      );
$$;

comment on function public.fms_help_is_master_manager(uuid) is
  'May this user edit the Help Desk ticket-category master? Admins and coordinators always, plus fms_help_config.master_owners -> user_ids. department_ids in that row is a Setup picker filter and grants nothing. Deliberately NOT gated on module_can_edit — help-desk is universal.';
grant execute on function public.fms_help_is_master_manager(uuid) to authenticated;


-- ===========================================================================
-- fms_help_categories
-- ===========================================================================
create table if not exists public.fms_help_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,

  -- ⚠ STABLE, LOWER-CASE, AND WHAT EVERY REPORT MATCHES ON — never the name.
  --   The SLA, ageing and trend reports group by this, and the confidential
  --   register identifies its three rows by it. Matching on the display name
  --   would break the moment somebody edits "POSH" to "POSH (Prevention of
  --   Sexual Harassment)" on the Masters screen — which is exactly the sort of
  --   edit a masters screen invites. The code is what the code reads; the name
  --   is what people read. Same rule as fms_ld_session_types.code.
  code          text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),

  -- The "concerned department" the flow routes to. A UI and reporting fact; the
  -- authorization is owner_ids and nothing else.
  department_id uuid references public.departments(id) on delete set null,

  -- THE PROCESS OWNER. Plural so leave and cover work; the sheet names one.
  owner_ids     uuid[] not null default '{}',

  -- The escalation ladder (D3: fired by REOPEN, not by a TAT breach).
  -- ids = who is notified. label = what the sheet promises. See ⚠ 3 in the header.
  escalation_l1_ids   uuid[] not null default '{}',
  escalation_l1_label text,
  escalation_l2_ids   uuid[] not null default '{}',
  escalation_l2_label text,

  -- THE TAT. Working days from the ticket being raised. See ⚠ 1 and ⚠ 2.
  --   tat_days = 0     due the same working day ("Immediate", "Same Day")
  --   tat_days = null  deliberately untimed; tat_text says why
  tat_days      integer check (tat_days is null or tat_days between 0 and 365),
  tat_text      text,

  -- D4. Readable only by the raiser, the owners, anyone escalated to, and
  -- admins. Enforced in HD-2's fms_help_can_see, not in the UI.
  confidential  boolean not null default false,

  -- The generic catch-all forces a free-text note, because "Others" on its own
  -- tells the owner nothing.
  requires_note boolean not null default false,

  -- D1. The module that actually owns this work, if any.
  handoff_app_id text check (handoff_app_id is null or handoff_app_id in (
    'travel-desk', 'office-supplies', 'learning-development', 'hr-recruitment', 'hr-exit'
  )),

  -- D5. IT complaints are passed to an OUTSIDE partner (Premware) and
  -- Dharmistha's KRA 9 is measured on that hand-off ("escalated within 24
  -- hours"). The ticket carries external_escalated_at; this flag is what makes
  -- the field appear and the report count it.
  tracks_external_escalation boolean not null default false,
  external_partner_label     text,

  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A confidential category that hands off to another module would leak the
  -- ticket into a module with an ordinary read gate.
  constraint fms_help_categories_confidential_never_hands_off
    check (not (confidential and handoff_app_id is not null)),
  -- Either a number or an explanation; a row with neither is a promise nobody
  -- can read.
  constraint fms_help_categories_tat_stated
    check (tat_days is not null or nullif(btrim(coalesce(tat_text, '')), '') is not null)
);

comment on table public.fms_help_categories is
  'Help Desk ticket categories — THE ROUTER. Each row decides who owns a ticket (owner_ids), how long they have (tat_days, or tat_text when the TAT is a policy rather than a number), who a reopen escalates to (escalation_l*_ids, with _label for the roles that are not portal accounts), whether it is confidential (D4) and whether the work belongs to another module (handoff_app_id, D1).';
comment on column public.fms_help_categories.code is
  'Stable report key. Every report and the confidential register match on THIS, never on name. Never re-use a code another category holds.';
comment on column public.fms_help_categories.tat_days is
  'Working days from raise to resolve. 0 = same working day. NULL = deliberately untimed (the resolve step gets dueIso null and can never be late); tat_text then says why.';
comment on column public.fms_help_categories.escalation_l1_label is
  'What the source sheet promises, e.g. "Management (if policy exception)". Printed on the ticket even when no id is set, so the screen never claims an escalation path that does not exist.';
comment on column public.fms_help_categories.handoff_app_id is
  'D1: the module that actually owns this work. The owner resolves by raising it there; the ticket keeps the link. Only the ASK lives in Help Desk.';

create index if not exists fms_help_categories_active_idx on public.fms_help_categories (active, sort_order);

drop trigger if exists trg_fms_help_categories_updated on public.fms_help_categories;
create trigger trg_fms_help_categories_updated
  before update on public.fms_help_categories
  for each row execute function public.set_updated_at();

alter table public.fms_help_categories enable row level security;

-- Everyone reads the list — you cannot raise a ticket without choosing one, and
-- the module is universal. The category list is a vocabulary, not a secret: the
-- CONFIDENTIAL flag hides the tickets, never the category name.
drop policy if exists fms_help_categories_select on public.fms_help_categories;
create policy fms_help_categories_select on public.fms_help_categories
  for select to authenticated using (true);

drop policy if exists fms_help_categories_write on public.fms_help_categories;
create policy fms_help_categories_write on public.fms_help_categories
  for all to authenticated
  using ((select public.fms_help_is_master_manager(auth.uid())))
  with check ((select public.fms_help_is_master_manager(auth.uid())));


-- ===========================================================================
-- fms_help_master_requests — "there should be a category for X".
--
-- ⚠⚠ THE WIRE CONTRACT IS DELIBERATELY TINY: name, and why.
--
--   Every other module's master-request payload carries the whole row, and each
--   key must appear in the resolve RPC's INSERT chain or it is SILENTLY DROPPED
--   on approve — no error, no warning, the master row simply created without the
--   value the requester typed and the approver read and agreed to. (See the
--   "WIRE CONTRACT" warning on fms_ld_resolve_master_request.)
--
--   That trap is avoided here by not building the road: a REQUESTER may ask for
--   a category by NAME and say why. The owner, the escalation ladder, the TAT,
--   the confidential flag and the hand-off are decided by whoever APPROVES it,
--   on the Masters screen, where they can see the codes and owners already in
--   use. Those are not things a person outside HR should be asked to invent
--   about a list they cannot see — exactly the reasoning that keeps `code` and
--   `sort_order` off L&D's request form.
-- ===========================================================================
create table if not exists public.fms_help_master_requests (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid not null references public.profiles(id) on delete cascade,
  proposed_name  text not null check (length(btrim(proposed_name)) > 0),
  reason         text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_category_id uuid references public.fms_help_categories(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.fms_help_master_requests is
  'Requests for a new Help Desk ticket category. The payload is deliberately just a NAME and a reason — the owner, escalation, TAT, confidentiality and hand-off are set by the approver on the Masters screen, which is what keeps this module out of the silent-drop wire-contract trap.';

create index if not exists fms_help_master_requests_pending_idx
  on public.fms_help_master_requests (created_at) where status = 'pending';

drop trigger if exists trg_fms_help_master_requests_updated on public.fms_help_master_requests;
create trigger trg_fms_help_master_requests_updated
  before update on public.fms_help_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_help_master_requests enable row level security;

-- A requester sees their own; managers of the master see all of them.
drop policy if exists fms_help_master_requests_select on public.fms_help_master_requests;
create policy fms_help_master_requests_select on public.fms_help_master_requests
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or (select public.fms_help_is_master_manager(auth.uid()))
  );

-- Anyone may ask; only for themselves.
drop policy if exists fms_help_master_requests_insert on public.fms_help_master_requests;
create policy fms_help_master_requests_insert on public.fms_help_master_requests
  for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending');

-- Only a manager decides.
drop policy if exists fms_help_master_requests_update on public.fms_help_master_requests;
create policy fms_help_master_requests_update on public.fms_help_master_requests
  for update to authenticated
  using ((select public.fms_help_is_master_manager(auth.uid())))
  with check ((select public.fms_help_is_master_manager(auth.uid())));


-- ===========================================================================
-- THE SEED — 30 categories.
--
-- 28 from the source sheet, transcribed row for row, plus:
--   · IT Support  (D5) — Dharmistha's KRA 9 needs it; the sheet has no IT row
--   · Others      (the client's explicit ask) — forces a free-text note
--
-- TWO DELIBERATE DEPARTURES FROM THE SHEET, both decisions of 28-09-2026:
--   · Employee Engagement Activities is owned by KHUSHI, not Saloni (D6). Her
--     own appraisal claims engagement, celebrations, rewards and internal
--     communication at 25% — her single largest KRA — and spells the boundary
--     out line by line; Saloni's sheet carries no engagement line at all. The
--     Help Desk sheet is the document that is wrong.
--   · Ten rows carry handoff_app_id (D1).
-- ===========================================================================
with people as (
  select
    (select id from public.profiles where lower(email) = 'khushi@orangeotec.com')      as khushi,
    (select id from public.profiles where lower(email) = 'travel@orangeotec.com')      as tanisha,
    (select id from public.profiles where lower(email) = 'recruitment@orangeotec.com') as saloni,
    (select id from public.profiles where lower(email) = 'office@orangeotec.com')      as dharmistha,
    (select id from public.profiles where lower(email) = 'riya@orangeotec.com')        as hr_head
),
dept as (
  select id as hr from public.departments where name = 'Human Resources'
),
rows_to_seed as (
  select * from (values
    -- code, name, owner, l1_ids, l1_label, l2_label, tat_days, tat_text, confidential, requires_note, handoff, sort
    ('attendance_corrections',  'Attendance Corrections',              'khushi',     'hr_head', 'HR Head',              'Management (if policy exception)', 1,    null,                               false, false, null,                   10),
    ('leave_management',        'Leave Management',                    'khushi',     'hr_head', 'HR Head',              'Management',                       1,    null,                               false, false, null,                   20),
    ('payroll_queries',         'Payroll Queries',                     'khushi',     'hr_head', 'HR Head',              'Finance Head',                     2,    null,                               false, false, null,                   30),
    ('salary_discrepancy',      'Salary Discrepancy',                  'khushi',     'hr_head', 'HR Head',              'Finance Head',                     2,    null,                               false, false, null,                   40),
    ('payslip_request',         'Payslip Request',                     'khushi',     'hr_head', 'HR Head',              null,                               1,    null,                               false, false, null,                   50),
    ('full_and_final',          'Full & Final Settlement',             'khushi',     'hr_head', 'HR Head',              'Finance Head',                     null, 'As per Exit Policy',               false, false, 'hr-exit',              60),
    ('pms',                     'Performance Management (PMS)',        'khushi',     'hr_head', 'HR Head',              'Management',                       3,    null,                               false, false, null,                   70),
    ('salary_revision',         'Salary Revision / Increment Queries', 'khushi',     'hr_head', 'HR Head',              'Management',                       3,    null,                               false, false, null,                   80),
    ('hr_policy',               'HR Policy Clarification',             'khushi',     'hr_head', 'HR Head',              null,                               2,    null,                               false, false, null,                   90),

    ('travel_booking',          'Travel Booking',                      'tanisha',    'hr_head', 'HR Head',              'Management (if exception)',        1,    null,                               false, false, 'travel-desk',         100),
    ('travel_transport',        'Hotel / Flight / Cab Booking',        'tanisha',    'hr_head', 'HR Head',              null,                               1,    null,                               false, false, 'travel-desk',         110),
    ('travel_approval',         'Travel Approval Coordination',        'tanisha',    'hr_head', 'HR Head',              'Department Head',                  1,    null,                               false, false, 'travel-desk',         120),
    ('travel_reimbursement',    'Travel Reimbursement',                'tanisha',    'hr_head', 'HR Head',              'Accounts',                         3,    null,                               false, false, 'travel-desk',         130),

    ('recruitment_status',      'Recruitment Status',                  'saloni',     'hr_head', 'HR Head',              'Hiring Manager',                   2,    null,                               false, false, 'hr-recruitment',      140),
    ('interview_scheduling',    'Interview Scheduling',                'saloni',     'hr_head', 'HR Head',              'Hiring Manager',                   0,    'Same Day',                         false, false, 'hr-recruitment',      150),
    ('candidate_coordination',  'Candidate Coordination',              'saloni',     'hr_head', 'HR Head',              null,                               0,    'Same Day',                         false, false, 'hr-recruitment',      160),
    -- D6: Khushi, not Saloni. See the header.
    ('employee_engagement',     'Employee Engagement Activities',      'khushi',     'hr_head', 'HR Head',              null,                               null, 'As per Calendar',                  false, false, null,                  170),
    ('training_development',    'Training & Development',              'saloni',     'hr_head', 'HR Head',              'HOD',                              null, 'As per Training Calendar',         false, false, 'learning-development',180),
    ('onboarding_coordination', 'Onboarding Coordination',             'saloni',     'hr_head', 'HR Head',              'Hiring Manager',                   2,    null,                               false, false, 'hr-recruitment',      190),

    ('admin_requests',          'Admin Requests',                      'dharmistha', 'hr_head', 'HR Head',              'Admin Vendor',                     2,    null,                               false, false, null,                  200),
    ('office_assets',           'Office Assets / Stationery',          'dharmistha', 'hr_head', 'HR Head',              'Admin Vendor',                     2,    null,                               false, false, 'office-supplies',     210),
    ('visitor_management',      'Visitor Management',                  'dharmistha', 'hr_head', 'HR Head',              null,                               0,    'Immediate',                        false, false, null,                  220),
    ('insurance',              'Insurance (Mediclaim / GPA / GMC)',    'dharmistha', 'hr_head', 'HR Head',              'Insurance Provider',               3,    null,                               false, false, null,                  230),
    ('employee_id_card',        'Employee ID Card',                    'dharmistha', 'hr_head', 'HR Head',              null,                               2,    null,                               false, false, null,                  240),
    -- D5: not on the sheet. Dharmistha's KRA 9 — "100% IT complaints logged and
    -- escalated to the IT consultancy partner Premware within 24 hours".
    ('it_support',              'IT Support',                          'dharmistha', 'hr_head', 'HR Head',              'Premware (IT partner)',            3,    null,                               false, false, null,                  250),

    -- "Concerned HR Team Member" on the sheet — seeded to all four executives
    -- below, after this list.
    ('general_hr_query',        'General HR Query',                    'hr_team',    'hr_head', 'HR Head',              null,                               1,    null,                               false, false, null,                  260),
    -- The client's catch-all. Triaged by the same four, then re-categorised.
    ('others',                  'Others',                              'hr_team',    'hr_head', 'HR Head',              null,                               1,    null,                               false, true,  null,                  270),

    -- ── confidential (D4) ────────────────────────────────────────────────────
    -- L1 on these three is NOT the HR Head: the sheet routes them to a Director
    -- or to the ICC, and neither is a portal account. Label only, no ids.
    ('employee_grievance',      'Employee Grievance',                  'hr_head',    'none',    'Director (if required)','Management',                      1,    'Initial Response within 24 Hours', true,  false, null,                  280),
    ('posh',                    'Sexual Harassment / POSH Complaint',  'hr_head',    'none',    'ICC Committee',        'Management',                       null, 'As per POSH Policy',               true,  false, null,                  290),
    ('disciplinary',            'Disciplinary Matters',                'hr_head',    'none',    'Director',             'Management',                       null, 'As per Case',                      true,  false, null,                  300)
  ) as t(code, name, owner_key, l1_key, l1_label, l2_label, tat_days, tat_text, confidential, requires_note, handoff, sort_order)
)
insert into public.fms_help_categories (
  code, name, department_id, owner_ids,
  escalation_l1_ids, escalation_l1_label, escalation_l2_ids, escalation_l2_label,
  tat_days, tat_text, confidential, requires_note, handoff_app_id,
  tracks_external_escalation, external_partner_label, active, sort_order
)
select
  r.code,
  r.name,
  d.hr,
  case r.owner_key
    when 'khushi'     then array[p.khushi]
    when 'tanisha'    then array[p.tanisha]
    when 'saloni'     then array[p.saloni]
    when 'dharmistha' then array[p.dharmistha]
    when 'hr_head'    then array[p.hr_head]
    -- "Concerned HR Team Member": the four executives who run the desk. The HR
    -- Head is NOT included — she is the escalation, and putting her in the
    -- owner list would make every general query her queue.
    when 'hr_team'    then array[p.khushi, p.tanisha, p.saloni, p.dharmistha]
  end,
  case when r.l1_key = 'hr_head' then array[p.hr_head] else '{}'::uuid[] end,
  r.l1_label,
  -- ⚠ EVERY L2 IS LABEL-ONLY. Not one of Management / Finance Head / Hiring
  --   Manager / Department Head / HOD / Accounts / Admin Vendor / Insurance
  --   Provider / Premware resolves to a portal account today. Naming a real
  --   person is HR's to do, on the Masters screen; guessing would route a POSH
  --   escalation to somebody nobody chose.
  '{}'::uuid[],
  r.l2_label,
  r.tat_days,
  r.tat_text,
  r.confidential,
  r.requires_note,
  r.handoff,
  (r.code = 'it_support'),
  case when r.code = 'it_support' then 'Premware' end,
  true,
  r.sort_order
from rows_to_seed r cross join people p cross join dept d;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_n int; v_names text;
begin
  select count(*) into v_n from public.fms_help_categories;
  if v_n <> 30 then
    raise exception 'HD-1 part 2: expected 30 categories, seeded %', v_n;
  end if;

  -- Every category has a real owner. A category owned by nobody is a ticket
  -- that goes nowhere, and it is silent.
  select string_agg(name, ', ') into v_names
    from public.fms_help_categories
   where coalesce(array_length(owner_ids, 1), 0) = 0
      or exists (select 1 from unnest(owner_ids) o where o is null);
  if v_names is not null then
    raise exception 'HD-1 part 2: these categories have no owner: %', v_names;
  end if;

  -- The three confidential rows, by code — never by name (see the code comment).
  select count(*) into v_n from public.fms_help_categories
   where code in ('employee_grievance', 'posh', 'disciplinary') and confidential;
  if v_n <> 3 then
    raise exception 'HD-1 part 2: expected 3 confidential categories, found %', v_n;
  end if;
  select count(*) into v_n from public.fms_help_categories where confidential;
  if v_n <> 3 then
    raise exception 'HD-1 part 2: % categories are confidential; only the three named ones may be', v_n;
  end if;

  -- D1's hand-offs. ELEVEN, not the ten the first draft of the plan counted:
  -- Full & Final Settlement (-> Employee Exit) and Candidate Coordination
  -- (-> New Recruitment) belong to another module too, and were missed when the
  -- overlap was first listed. Caught by rehearsing this assertion, 28-09-2026.
  select count(*) into v_n from public.fms_help_categories where handoff_app_id is not null;
  if v_n <> 11 then
    raise exception 'HD-1 part 2: expected 11 hand-off categories, found %', v_n;
  end if;

  -- D6: engagement is Khushi's, not Saloni's.
  if not exists (
    select 1 from public.fms_help_categories c
     where c.code = 'employee_engagement'
       and (select id from public.profiles where lower(email) = 'khushi@orangeotec.com') = any(c.owner_ids)
  ) then
    raise exception 'HD-1 part 2: employee_engagement is not owned by Khushi (D6)';
  end if;

  -- The FIVE untimed rows carry an explanation — the CHECK guarantees one of the
  -- two, this proves we meant the null. Five, not six: "Immediate" is a real
  -- deadline and is tat_days = 0. See ⚠ 1 in the header.
  select count(*) into v_n from public.fms_help_categories
   where tat_days is null and nullif(btrim(coalesce(tat_text,'')), '') is not null;
  if v_n <> 5 then
    raise exception 'HD-1 part 2: expected 5 untimed categories with tat_text, found %', v_n;
  end if;
  -- ...and the same-working-day ones really are zero, not null.
  select count(*) into v_n from public.fms_help_categories where tat_days = 0;
  if v_n <> 3 then
    raise exception 'HD-1 part 2: expected 3 same-day categories (interview_scheduling, candidate_coordination, visitor_management), found %', v_n;
  end if;

  -- Nothing may be scoped {public}: anon holds full table grants.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_help_categories', 'fms_help_master_requests')
     and roles::text like '%public%';
  if v_n > 0 then
    raise exception 'HD-1 part 2: % policy/policies scoped to {public}', v_n;
  end if;

  -- The universal-module gate again (see the foundations header).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fms_help_is_master_manager'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-1 part 2: fms_help_is_master_manager gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
