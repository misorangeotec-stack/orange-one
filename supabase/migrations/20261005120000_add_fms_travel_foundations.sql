-- ===========================================================================
-- TRAVEL DESK FMS — FOUNDATIONS (Phase 1).
--
-- The TWELFTH FMS module. Like fms_ocpi_* / fms_exit_* / fms_hr_* / fms_asset_*
-- / fms_dispatch_* / fms_production_* / fms_sampling_* / fms_import_* /
-- fms_supplies_* / fms_purchase_*, it mirrors the config backbone into its OWN
-- tables rather than reusing a shared one: modules must stay independently
-- droppable, and a shared step_owners table would collide on step_key.
--
-- WHAT TRAVEL DESK IS
--   ONE entity — a TRIP — from the request to the settled expense claim:
--
--     request -> manager_approval -> director_approval -> advance
--       -> booking -> [travel happens] -> claim -> claim_review
--       -> finance_review -> settlement -> closed
--
--   An employee asks to travel. Their reporting manager approves; bands 6-9
--   also need a Director. Finance may disburse an advance. The Travel Desk
--   books any number of LEGS (flight, train, bus, cab, hotel). The employee
--   travels, then files an expense claim; the system computes the Daily
--   Allowance and checks every line against the band-wise policy caps. The
--   manager approves, Finance verifies, nets off the advance and pays.
--
--   ⚠ ONE TRIP, MANY LEGS — NOT one request per service. The source PRD says
--     "one travel service per requisition", which would make a flight out, a
--     hotel and a train back into THREE approvals for one journey, with no row
--     anywhere holding what the trip cost. The Daily Allowance and the claim
--     both need a single entity to hang off, so the PRD is deliberately not
--     followed here. Confirmed with the user before build.
--
-- WHAT THIS MIGRATION CREATES
--   fms_travel_step_owners        — one row per workflow step_key -> owners
--   fms_travel_config             — key/value singletons (jsonb)
--   fms_travel_counters + next_seq  — document numbering
--   fms_travel_fy_code            — April-start financial-year code
--   fms_travel_activity           — append-only audit trail (also carries the
--                                   comment thread; see phase 10)
--   fms_travel_notifications      — per-user bell feed
--   fms_travel_announce           — the single event fan-out
--   fms_travel_employee_settings  — per-person travel profile (base city, prefs)
--   storage bucket fms-travel-docs + 4 baseline policies
--
-- The trip itself, its legs, its claim and every step RPC are later migrations.
--
-- ⚠ NUMBERING IS FY-SCOPED: TRV-2627-0001, minted on SUBMIT and never on a
--   draft save, so an abandoned draft cannot burn a number. Hyphens, four
--   digits, counter scope 'trip:<fy>' — the house convention every other module
--   follows (PR-, PO-, MRF-, EXIT-, SMP-, PRD-, SO-, ASM-). The slash form seen
--   in the receivables data is TALLY's, not this portal's; do not copy it.
--
-- ⚠ EVERY WRITE PREDICATE IS GATED ON module_can_edit() FROM DAY ONE.
--   20260923120000 had to retrofit that gate onto 35 functions across ten
--   modules. fms_travel_is_step_owner therefore carries the gate in its own
--   body. Note what is NOT gated: fms_travel_step_owner_ids, which answers
--   "who should be told", not "who may act" — gating it would silently empty
--   the recipient list for a step whose owners hold a view-only grant.
--
-- ⚠ RLS policies wrap every helper call in a scalar sub-select —
--   `using ((select public.is_admin(auth.uid())))`. Called inline, Postgres
--   evaluates the function ONCE PER ROW; wrapped, it becomes a one-shot
--   InitPlan. Same rewrite as 20260730130000_speed_up_task_rls.sql (472ms ->
--   15ms) and 20260924120000_dispatch_visibility_hoisted.sql (1,620ms -> ~5ms).
--
-- ⚠ EVERY POLICY IS SCOPED `to authenticated`. `anon` holds full table grants
--   (the Supabase default); that scope is the only thing keeping anonymous
--   callers out.
--
-- ⚠ fms_travel_can_act IS NOT HERE. It must read the trip row to find that
--   trip's own reporting managers, so it ships with fms_travel_trips in phase
--   3 — exactly as OCPI put can_act in its deals migration, not in foundations.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.module_can_edit(uuid,text) / public.designations.
--
-- Reversal (reverse order):
--   drop policy if exists "fms travel docs read"   on storage.objects;
--   drop policy if exists "fms travel docs insert" on storage.objects;
--   drop policy if exists "fms travel docs update" on storage.objects;
--   drop policy if exists "fms travel docs delete" on storage.objects;
--   delete from storage.buckets where id = 'fms-travel-docs';
--   drop function if exists public.fms_travel_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_travel_step_owner_ids(text);
--   drop function if exists public.fms_travel_is_coordinator(uuid);
--   drop function if exists public.fms_travel_is_step_owner(text,uuid);
--   drop function if exists public.fms_travel_next_seq(text);
--   drop function if exists public.fms_travel_fy_code(date);
--   drop table if exists public.fms_travel_employee_settings,
--                        public.fms_travel_notifications, public.fms_travel_activity,
--                        public.fms_travel_counters, public.fms_travel_config,
--                        public.fms_travel_step_owners;
-- ===========================================================================

begin;

-- ===========================================================================
-- fms_travel_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see
-- frontend/src/apps/travel-desk/lib/steps.ts.
--
-- Authorization comes SOLELY from employee_ids. department_ids and
-- designation_id are UI filters for CHOOSING people, nothing more. (No FMS
-- authorization predicate in the portal reads designation_id — verified across
-- all twelve modules. Do not start here.)
--
-- ⚠ TWO STEPS ARE NOT FULLY OWNED HERE. manager_approval and claim_review also
--   route to the TRIP's own approver_manager_ids, snapshotted at submit. Rows
--   set here act as ADDITIVE co-owners — which is how HR gets "same permissions
--   as the HOD" per the PRD without being named on every trip. Phase 3 adds
--   fms_travel_can_act() to express that, following hr-exit's fall-through: its
--   can_act deliberately does NOT early-return on the manager arm, and
--   hr-recruitment's equivalent (which does) is named there as the bug avoided.
--
-- There is NO CHECK barring the origin step (`request`) from this table.
-- Semantics: no owners on `request` => any granted user may raise a trip;
-- owners set => only them, plus admins and coordinators.
-- ===========================================================================
create table if not exists public.fms_travel_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_travel_step_owners is
  'Owners per Travel Desk workflow step (step_key). employee_ids are the notified/authorized owners; department_ids and designation_id are UI filters only. manager_approval and claim_review additionally route to each trip own approver_manager_ids.';

drop trigger if exists trg_fms_travel_step_owners_updated on public.fms_travel_step_owners;
create trigger trg_fms_travel_step_owners_updated
  before update on public.fms_travel_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_travel_step_owners enable row level security;

drop policy if exists fms_travel_step_owners_select on public.fms_travel_step_owners;
create policy fms_travel_step_owners_select on public.fms_travel_step_owners
  for select to authenticated using (true);

drop policy if exists fms_travel_step_owners_write on public.fms_travel_step_owners;
create policy fms_travel_step_owners_write on public.fms_travel_step_owners
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- fms_travel_config — key/value singletons.
--
-- Keys installed here:
--   'policy'            — the numeric rules that are NOT rates: how far ahead a
--                         trip may be raised, how many passengers, how long an
--                         employee has to claim, and so on. Every one of them
--                         is a figure from the Domestic Travel Policy, and every
--                         one is editable in Settings rather than compiled in.
--   'company_identity'  — legal name, GSTIN and address for the hotel folio
--                         guidance (§7.1) and the ITC register (§11.3).
--
-- Keys added by later phases: 'step_sla', 'process_coordinators',
-- 'approval_matrix'.
--
-- ⚠ THE GSTIN IS DELIBERATELY BLANK. The policy carries it as
--   "[⚠ CONFIRM GSTIN with Finance]" in both §7.1 and §11.3. A placeholder
--   number printed on guidance an employee shows a hotel would be worse than an
--   obvious gap, so the UI renders the gap and says who to ask.
-- ===========================================================================
create table if not exists public.fms_travel_config (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.fms_travel_config is
  'Travel Desk module settings as jsonb singletons: policy, company_identity, step_sla, process_coordinators, approval_matrix.';

drop trigger if exists trg_fms_travel_config_updated on public.fms_travel_config;
create trigger trg_fms_travel_config_updated
  before update on public.fms_travel_config
  for each row execute function public.set_updated_at();

alter table public.fms_travel_config enable row level security;

drop policy if exists fms_travel_config_select on public.fms_travel_config;
create policy fms_travel_config_select on public.fms_travel_config
  for select to authenticated using (true);

drop policy if exists fms_travel_config_write on public.fms_travel_config;
create policy fms_travel_config_write on public.fms_travel_config
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- Every number below is quoted from the Domestic Travel Policy, section named.
insert into public.fms_travel_config (key, value) values
  ('policy', jsonb_build_object(
      'max_passengers',            5,      -- PRD §17
      'booking_window_days',       30,     -- PRD §5: travel date within 30 days
      'advance_booking_warn_days', 7,      -- §4.1: air booked 7+ days ahead
      'claim_deadline_days',       5,      -- §11.1: within 5 working days of return
      'claim_hard_stop_days',      30,     -- §11.3: >30 days needs Director approval
      'advance_max_pct',           90,     -- §11.1: advance <= 90% of estimate
      'advance_recovery_days',     30,     -- §11.2: unsettled at 30 days -> payroll
      'hod_review_days',           2,      -- §12
      'finance_process_days',      5,      -- §12
      'credit_days',               7,      -- §12
      'dispute_threshold',         10000,  -- §12.2: HR Head decides below, Director above
      'hotel_cap_hard_multiple',   1.5,    -- §7.3: never above 1.5x cap without Director
      'emergency_window_hours',    24      -- §3.5 (note §3.1 says 48h from return — see H4)
    )),
  ('company_identity', jsonb_build_object(
      'legal_name', 'Orange O Tech Pvt. Ltd.',
      'gstin',      '',                    -- §7.1 / §11.3 [⚠ CONFIRM with Finance]
      'address',    ''
    ))
on conflict (key) do nothing;


-- ===========================================================================
-- NUMBERING — 'trip:<fy>' -> TRV-2627-0001.
--
-- FY-scoped because reimbursement is bounded by the financial year and Finance
-- reconciles per year. The counter key CONTAINS the FY, so the series restarts
-- at 0001 each April with no seeding and no reset job.
-- ===========================================================================
create table if not exists public.fms_travel_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_travel_counters is
  'Per-scope document-number sequences (trip:<fy>). Mutated only via fms_travel_next_seq().';

alter table public.fms_travel_counters enable row level security;

drop policy if exists fms_travel_counters_select_admin on public.fms_travel_counters;
create policy fms_travel_counters_select_admin on public.fms_travel_counters
  for select to authenticated using ((select public.is_admin(auth.uid())));

create or replace function public.fms_travel_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_travel_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_travel_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_travel_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope. A new scope string starts at 1, which is how FY restarts fall out with no seeding.';
grant execute on function public.fms_travel_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-01 -> '2627'.
create or replace function public.fms_travel_fy_code(p_d date)
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
grant execute on function public.fms_travel_fy_code(date) to authenticated;


-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
--
-- ⚠ THE module_can_edit GATE IS PART OF THE BODY, not a later wrapper. See the
--   header: 20260923120000 had to retrofit this onto 35 existing functions by
--   copying each body to <name>__ungated and wrapping the original.
create or replace function public.fms_travel_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'travel-desk')
     and exists (
       select 1 from public.fms_travel_step_owners o
       where o.step_key = p_step_key
         and p_uid = any(o.employee_ids)
     );
$$;

comment on function public.fms_travel_is_step_owner(text, uuid) is
  'Does this user own this Travel Desk step AND hold an edit-level grant on the module? Gated on module_can_edit in its own body, so no __ungated split is ever needed here.';
grant execute on function public.fms_travel_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
--
-- The Travel Desk coordinator is a real role in the source PRD: they book, they
-- upload tickets, they record refunds, and they may raise a request on behalf
-- of senior management. That is exactly what this predicate grants.
create or replace function public.fms_travel_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_travel_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_travel_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
--
-- ⚠ NOT GATED on module_can_edit, deliberately. This answers "who should be
--   told", not "who may act". Gating it would silently empty the recipient list
--   for a step whose owners happen to hold a view grant.
create or replace function public.fms_travel_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_travel_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_travel_step_owner_ids(text) to authenticated;


-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
--
-- ⚠ THE ACTIVITY TABLE ALSO CARRIES THE CONVERSATION. The source PRD asks for a
--   thread with @mentions and attachments; the house answer is an activity row
--   of type 'comment' with the mentions and files in `meta`, NOT a comments
--   table of its own (hr-recruitment's fms_hr_post_comment does exactly this).
--   The trail is already "who did what, with a note", so a comment is one more
--   kind of entry — and the detail page can render process and conversation as
--   ONE timeline, which is the only way "moved to booking" and "customer pushed
--   the meeting" mean anything next to each other.
-- ===========================================================================
create table if not exists public.fms_travel_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'trip' | 'leg' | 'claim_line'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.fms_travel_activity is
  'Append-only audit trail for Travel Desk, and the home of the comment thread (type = comment, with mentions and attachments in meta). Written ONLY inside security-definer RPCs, via fms_travel_announce() — never inserted from the browser.';

create index if not exists fms_travel_activity_entity_idx  on public.fms_travel_activity (entity_type, entity_id);
create index if not exists fms_travel_activity_created_idx on public.fms_travel_activity (created_at);

alter table public.fms_travel_activity enable row level security;

drop policy if exists fms_travel_activity_select on public.fms_travel_activity;
create policy fms_travel_activity_select on public.fms_travel_activity
  for select to authenticated using (true);

drop policy if exists fms_travel_activity_write_admin on public.fms_travel_activity;
create policy fms_travel_activity_write_admin on public.fms_travel_activity
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

create table if not exists public.fms_travel_notifications (
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

comment on table public.fms_travel_notifications is
  'Per-user bell feed for Travel Desk. Best-effort: never the source of truth for state.';

create index if not exists fms_travel_notifications_user_idx    on public.fms_travel_notifications (user_id, read_at);
create index if not exists fms_travel_notifications_created_idx on public.fms_travel_notifications (created_at);

alter table public.fms_travel_notifications enable row level security;

drop policy if exists fms_travel_notifications_select_own on public.fms_travel_notifications;
create policy fms_travel_notifications_select_own on public.fms_travel_notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists fms_travel_notifications_update_own on public.fms_travel_notifications;
create policy fms_travel_notifications_update_own on public.fms_travel_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- One call = one activity row + a notification fan-out.
-- Phase 10 will `create or replace` this with the same body plus a gated
-- email_outbox enqueue, exactly as every other module does.
create or replace function public.fms_travel_announce(
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
  insert into public.fms_travel_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_travel_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;

comment on function public.fms_travel_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one Travel Desk event: an activity row always, plus one notification per recipient. Pass an EMPTY recipient list for a correction — it belongs on the audit trail without paging anyone.';
grant execute on function public.fms_travel_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;


-- ===========================================================================
-- fms_travel_employee_settings — the traveller's own standing details.
--
-- WHY THIS IS A MODULE TABLE AND NOT COLUMNS ON profiles
--   base_city is defined by the Travel Policy (§1.3: "the city from which the
--   employee normally works and which is mentioned in their appointment letter")
--   and NOTHING ELSE IN THE PORTAL USES IT. A core column would make every
--   consumer of profiles carry a fact only travel reads. Gender and date of
--   birth go the other way — those are HR facts about a person that airlines
--   happen to need, so they are added to profiles in phase 3.
--
--   Note this is NOT public.mst_locations, which is "our own sites, per company
--   — the place a consignment leaves from". A base city is where a PERSON
--   works. 20260902120000 spelled out why those two must stay apart, and this
--   is a third thing again.
--
-- ⚠ base_city_id IS PLAIN uuid, NOT A FOREIGN KEY. fms_travel_cities is created
--   in phase 2, one migration later. Phase 2 adds the constraint once the target
--   exists; declaring it here would make this migration depend on the next one.
--
-- A row is created on demand — an employee with no row simply has no default,
-- and the trip form asks. Nobody has to be pre-seeded for the module to work.
-- ===========================================================================
create table if not exists public.fms_travel_employee_settings (
  user_id            uuid primary key references auth.users on delete cascade,
  base_city_id       uuid,
  seat_preference    text,
  meal_preference    text,
  frequent_flyer_no  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.fms_travel_employee_settings is
  'Per-person travel defaults: base city (Travel Policy §1.3), seat and meal preference, frequent-flyer number. Module-owned so no core table carries a travel-only fact. base_city_id is FK-constrained in phase 2, once fms_travel_cities exists.';

drop trigger if exists trg_fms_travel_employee_settings_updated on public.fms_travel_employee_settings;
create trigger trg_fms_travel_employee_settings_updated
  before update on public.fms_travel_employee_settings
  for each row execute function public.set_updated_at();

alter table public.fms_travel_employee_settings enable row level security;

-- Readable by everyone signed in: the Travel Desk coordinator books for other
-- people and needs their seat and meal preference to do it.
drop policy if exists fms_travel_employee_settings_select on public.fms_travel_employee_settings;
create policy fms_travel_employee_settings_select on public.fms_travel_employee_settings
  for select to authenticated using (true);

-- Your own row, or an admin's. A coordinator does NOT get to rewrite someone's
-- base city — that is an HR fact about where a person is posted, and §1.3 ties
-- it to the appointment letter.
drop policy if exists fms_travel_employee_settings_write_own on public.fms_travel_employee_settings;
create policy fms_travel_employee_settings_write_own on public.fms_travel_employee_settings
  for all to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin(auth.uid())))
  with check (user_id = (select auth.uid()) or (select public.is_admin(auth.uid())));


-- ===========================================================================
-- STORAGE — private bucket for tickets, hotel folios, receipts, the approval
-- printout, cancellation evidence and mileage logs. Object path is
--   <trip-id>/<slot>/<epoch>-<filename>
-- with slot ∈ ticket | hotel | receipt | approval | cancellation | mileage-log.
--
-- ⚠ THE FIRST PATH SEGMENT IS LOAD-BEARING. Phase 6 replaces the four policies
--   below with ones that derive the owning trip from that segment and reuse
--   fms_travel_can_see_trip — the same hardening
--   20260821120000_fms_dispatch_doc_storage_policies.sql applied after
--   discovering that a bucket-id-only rule let any authenticated user mint a
--   signed URL for any invoice. The baseline below exists only so phase 1 has a
--   working bucket; do not ship the claim on it.
--
--   That matters more here than in most modules: an expense receipt carries a
--   named person's spending, and a hotel folio carries where they slept.
--
-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's (and vice versa).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-travel-docs', 'fms-travel-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms travel docs read"   on storage.objects;
drop policy if exists "fms travel docs insert" on storage.objects;
drop policy if exists "fms travel docs update" on storage.objects;
drop policy if exists "fms travel docs delete" on storage.objects;

create policy "fms travel docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-travel-docs');
create policy "fms travel docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-travel-docs');
create policy "fms travel docs update" on storage.objects
  for update to authenticated
  using (bucket_id = 'fms-travel-docs') with check (bucket_id = 'fms-travel-docs');
create policy "fms travel docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-travel-docs');


-- ===========================================================================
-- ASSERTIONS — this migration fails rather than silently widening access.
-- ===========================================================================
do $mig$
declare
  v_public int;
  v_tables text[] := array[
    'fms_travel_step_owners', 'fms_travel_config', 'fms_travel_counters',
    'fms_travel_activity', 'fms_travel_notifications', 'fms_travel_employee_settings'
  ];
  t text;
begin
  -- Every policy scoped to authenticated, never {public}.
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename = any(v_tables)
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'Travel Desk: % policy/policies are scoped to {public}; anon holds table grants, so that is an open door', v_public;
  end if;

  -- RLS actually enabled on all six.
  foreach t in array v_tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'Travel Desk: RLS is not enabled on %', t;
    end if;
  end loop;

  -- The four storage policies exist and are ours.
  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'fms travel docs %') <> 4 then
    raise exception 'Travel Desk: expected exactly 4 fms-travel-docs storage policies';
  end if;

  -- The numbering helper round-trips, and the FY code is the April-start form.
  if public.fms_travel_fy_code(date '2026-08-01') <> '2627' then
    raise exception 'Travel Desk: fy_code(2026-08-01) should be 2627, got %', public.fms_travel_fy_code(date '2026-08-01');
  end if;
  if public.fms_travel_fy_code(date '2026-03-31') <> '2526' then
    raise exception 'Travel Desk: fy_code(2026-03-31) should be 2526, got %', public.fms_travel_fy_code(date '2026-03-31');
  end if;

  -- The policy config landed with the figures the module reads.
  if not exists (
    select 1 from public.fms_travel_config
     where key = 'policy' and (value->>'max_passengers')::int = 5
  ) then
    raise exception 'Travel Desk: the policy config row did not install';
  end if;
end $mig$;

commit;
