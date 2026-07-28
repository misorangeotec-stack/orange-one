-- ===========================================================================
-- CUSTOMER CREATION FMS — FOUNDATIONS (Phase 0).
--
-- New-customer onboarding, run from INSIDE the Receivables Control Hub
-- (/outstanding-dashboard/customer-onboarding) rather than as its own portal
-- app. Like every other FMS module it mirrors the config backbone into its OWN
-- tables: modules must stay independently droppable, and a shared step_owners
-- table would collide on step_key.
--
-- WHAT THIS IS
--   Sales meet a prospect and fill a 7-part form (identity, GST/KYC, contact,
--   ink profile, potential, trade references, credit request). Accounts then
--   verify it, the Sales Head grades and approves it, a Director approves it
--   when the credit limit is large, and finally someone records the Tally
--   ledger that was created. Nine steps, one row, full audit trail.
--
-- Tables:
--   fms_customer_step_owners       — one row per workflow step_key → owners
--   fms_customer_config            — key/value singletons (jsonb)
--   fms_customer_counters+next_seq — document numbering (CUST-2627-0001, …)
--   fms_customer_activity          — audit trail
--   fms_customer_notifications     — per-user bell feed
--   fms_customer_gst_states        — GST state-code master (seeded, 40 rows)
--
-- ⚠⚠ DO NOT WIRE THIS MODULE TO ORDER-TO-DISPATCH.
--   An approved customer must NEVER be written into public.fms_dispatch_customers,
--   public.fms_dispatch_ship_to, or any other fms_dispatch_* table — not
--   automatically, not behind a button, not as a "seam for later". There is no
--   dispatch_customer_id column and no push_to_dispatch RPC, deliberately.
--   Order-to-Dispatch sources its customer data from elsewhere. This was decided
--   explicitly (28-Jul-2026); the completed request IS the record, and downstream
--   teams pull it from the Excel export on the All Requests screen.
--
-- ⚠ NO MASTER-MANAGERS TABLE, unlike sampling/supplies/production. This module
--   has no user-editable masters: customer type, printing application and
--   consumption band are closed vocabularies pinned by CHECK constraints and
--   mirrored as TS constants. fms_customer_gst_states is reference data seeded
--   here, not something an owner curates.
--
-- ⚠ RLS IS "InitPlan-WRAPPED" AND ITS NEIGHBOURS ARE NOT — THAT IS DELIBERATE.
--   Every policy below writes (select auth.uid()) and
--   (select public.is_admin((select auth.uid()))) rather than the bare calls the
--   other fms_* modules use. Wrapping a STABLE call whose arguments are
--   query-constant turns it into an InitPlan: evaluated ONCE per query instead of
--   once per row. The value cannot change, so this is value-preserving. See
--   20260730130000_speed_up_task_rls.sql, where the same rewrite took the task
--   policies from 472 ms to 10 ms. Do NOT "fix" these back to match sampling.
--
-- Purely ADDITIVE. Reuses public.set_updated_at(), public.is_admin(uuid),
-- public.email_module_settings / public.email_module_enabled(text) and
-- public.email_outbox (20260721150000).
--
-- NOTE: the fms-customer-docs storage POLICIES are NOT here — they reference
-- public.fms_customer_requests, which lands in 20260802120100. Only the bucket
-- is created below, so an upload is impossible until that migration runs.
--
-- Reversal (reverse order):
--   drop policy if exists "fms customer docs read"/"…insert"/"…update"/"…delete" on storage.objects;
--   delete from storage.buckets where id = 'fms-customer-docs';
--   delete from public.email_module_settings where module_id = 'customer-onboarding';
--   drop function if exists public.fms_customer_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_customer_is_any_step_owner(uuid);
--   drop function if exists public.fms_customer_step_owner_ids(text);
--   drop function if exists public.fms_customer_is_coordinator(uuid);
--   drop function if exists public.fms_customer_is_step_owner(text,uuid);
--   drop function if exists public.fms_customer_next_seq(text);
--   drop function if exists public.fms_customer_fy_code(date);
--   drop table if exists public.fms_customer_gst_states, public.fms_customer_notifications,
--                        public.fms_customer_activity, public.fms_customer_counters,
--                        public.fms_customer_config, public.fms_customer_step_owners;
-- ===========================================================================

-- ===========================================================================
-- fms_customer_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see
-- frontend/src/apps/receivables-hub/lib/customerOnboarding/steps.ts:
--   submission | accounts_verification | sales_head_approval
--   | director_approval | tally_creation
--
-- Authorization comes SOLELY from employee_ids; department_ids is a UI filter
-- that narrows the people list in Settings and grants nothing.
--
-- UNLIKE sampling there is NO check barring the origin step. A 'submission' row
-- with owners restricts WHO MAY RAISE a customer; no 'submission' row at all
-- means every user with hub access may raise one. Sales needs that switch.
-- ===========================================================================
create table if not exists public.fms_customer_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_customer_step_owners is
  'Owners per Customer Creation FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. A ''submission'' row restricts who may raise a new customer; no row = anyone with hub access may raise.';

drop trigger if exists trg_fms_customer_step_owners_updated on public.fms_customer_step_owners;
create trigger trg_fms_customer_step_owners_updated
  before update on public.fms_customer_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_customer_step_owners enable row level security;
drop policy if exists fms_customer_step_owners_select on public.fms_customer_step_owners;
create policy fms_customer_step_owners_select on public.fms_customer_step_owners
  for select to authenticated using (true);
drop policy if exists fms_customer_step_owners_write on public.fms_customer_step_owners;
create policy fms_customer_step_owners_write on public.fms_customer_step_owners
  for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- ===========================================================================
-- fms_customer_config — key/value singletons (jsonb). Keys in use:
--   'step_sla'             → { "<step_key>": { "anchor": "<step_key>", "days": 1 }, … }
--   'process_coordinators' → { "user_ids": [ … ] }
--   'approval'             → { "director_threshold": 500000,
--                              "exempt_advance_terms": true,
--                              "exempt_when_no_limit_requested": true }
--
-- 'approval' is read server-side by fms_customer_director_required() (Phase 1).
-- Changing it must never rewrite history, which is why the threshold in force is
-- FROZEN onto each request at the moment the Sales Head approves it.
-- ===========================================================================
create table if not exists public.fms_customer_config (
  key         text primary key,
  value       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

comment on table public.fms_customer_config is
  'Singleton Customer Creation FMS settings (step SLAs, coordinators, director-approval threshold) keyed by name.';

drop trigger if exists trg_fms_customer_config_updated on public.fms_customer_config;
create trigger trg_fms_customer_config_updated
  before update on public.fms_customer_config
  for each row execute function public.set_updated_at();

alter table public.fms_customer_config enable row level security;
drop policy if exists fms_customer_config_select on public.fms_customer_config;
create policy fms_customer_config_select on public.fms_customer_config
  for select to authenticated using (true);
drop policy if exists fms_customer_config_write on public.fms_customer_config;
create policy fms_customer_config_write on public.fms_customer_config
  for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- Seed the approval rules so director_required() has something to read on day
-- one. 0 = every credit request goes to the Director until an admin sets a real
-- threshold, which is the safe default (over-escalating beats under-escalating).
insert into public.fms_customer_config (key, value)
values ('approval', jsonb_build_object(
  'director_threshold', 0,
  'exempt_advance_terms', true,
  'exempt_when_no_limit_requested', true
))
on conflict (key) do nothing;

-- ===========================================================================
-- fms_customer_counters + fms_customer_next_seq — atomic document numbering.
-- Scope is 'CUST-<fy>' so the series restarts each financial year.
-- ===========================================================================
create table if not exists public.fms_customer_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_customer_counters is
  'Per-scope document-number sequences (e.g. CUST-2627). Mutated only via fms_customer_next_seq().';

alter table public.fms_customer_counters enable row level security;
drop policy if exists fms_customer_counters_select_admin on public.fms_customer_counters;
create policy fms_customer_counters_select_admin on public.fms_customer_counters
  for select to authenticated
  using ((select public.is_admin((select auth.uid()))));

create or replace function public.fms_customer_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_customer_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_customer_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_customer_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope. Called only from fms_customer_submit_request — a draft never burns a number.';
grant execute on function public.fms_customer_next_seq(text) to authenticated;

-- Financial-year code for numbering: 2026-08-02 → '2627'.
create or replace function public.fms_customer_fy_code(p_d date)
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
grant execute on function public.fms_customer_fy_code(date) to authenticated;

-- ===========================================================================
-- fms_customer_gst_states — GST state-code master.
--
-- WHY A TABLE AND NOT A TS CONSTANT: the state name is derived from the first
-- two digits of the GSTIN by BOTH the wizard (live, as you type) and
-- fms_customer_submit_request (which cannot trust the browser). A TS-only map
-- would force a hand-copied CASE in SQL, and the two would drift the first time
-- a code changed. One table, read by both.
--
-- ⚠ THE ROWS EVERY COPIED LIST GETS WRONG — all present below:
--     11 is SIKKIM (routinely mis-filed with the north-east block)
--     25 Daman & Diu — PRE-MERGER, seeded active=false: historic GSTINs must
--        still validate, but the code must never appear in a picker
--     26 is the MERGED "Dadra & Nagar Haveli and Daman & Diu" (2020)
--     28 Andhra Pradesh BEFORE the 2014 division — still live on old GSTINs,
--        seeded active=false
--     36 is TELANGANA, 37 is the CURRENT Andhra Pradesh
--     38 Ladakh, 97 Other Territory, 99 Centre Jurisdiction
--   A missing code makes submit reject a perfectly valid GSTIN with no useful
--   message, so this seed is load-bearing.
--
-- NOTE: there is deliberately NO region column. Region was dropped from the
-- form on the user's instruction — do not reintroduce it.
-- ===========================================================================
create table if not exists public.fms_customer_gst_states (
  code        text primary key,
  name        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fms_customer_gst_states_code_len check (code ~ '^[0-9]{2}$')
);

comment on table public.fms_customer_gst_states is
  'GST state codes (first two digits of a GSTIN) → state name. Read by both the onboarding wizard and fms_customer_submit_request so the derivation cannot drift. Inactive rows are legacy codes that must still validate but never appear in a picker.';

drop trigger if exists trg_fms_customer_gst_states_updated on public.fms_customer_gst_states;
create trigger trg_fms_customer_gst_states_updated
  before update on public.fms_customer_gst_states
  for each row execute function public.set_updated_at();

alter table public.fms_customer_gst_states enable row level security;
drop policy if exists fms_customer_gst_states_select on public.fms_customer_gst_states;
create policy fms_customer_gst_states_select on public.fms_customer_gst_states
  for select to authenticated using (true);
drop policy if exists fms_customer_gst_states_write on public.fms_customer_gst_states;
create policy fms_customer_gst_states_write on public.fms_customer_gst_states
  for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

insert into public.fms_customer_gst_states (code, name, active, sort_order) values
  ('01', 'Jammu and Kashmir',                          true,  1),
  ('02', 'Himachal Pradesh',                           true,  2),
  ('03', 'Punjab',                                     true,  3),
  ('04', 'Chandigarh',                                 true,  4),
  ('05', 'Uttarakhand',                                true,  5),
  ('06', 'Haryana',                                    true,  6),
  ('07', 'Delhi',                                      true,  7),
  ('08', 'Rajasthan',                                  true,  8),
  ('09', 'Uttar Pradesh',                              true,  9),
  ('10', 'Bihar',                                      true, 10),
  ('11', 'Sikkim',                                     true, 11),
  ('12', 'Arunachal Pradesh',                          true, 12),
  ('13', 'Nagaland',                                   true, 13),
  ('14', 'Manipur',                                    true, 14),
  ('15', 'Mizoram',                                    true, 15),
  ('16', 'Tripura',                                    true, 16),
  ('17', 'Meghalaya',                                  true, 17),
  ('18', 'Assam',                                      true, 18),
  ('19', 'West Bengal',                                true, 19),
  ('20', 'Jharkhand',                                  true, 20),
  ('21', 'Odisha',                                     true, 21),
  ('22', 'Chhattisgarh',                               true, 22),
  ('23', 'Madhya Pradesh',                             true, 23),
  ('24', 'Gujarat',                                    true, 24),
  ('25', 'Daman and Diu (pre-merger)',                 false, 25),
  ('26', 'Dadra and Nagar Haveli and Daman and Diu',   true, 26),
  ('27', 'Maharashtra',                                true, 27),
  ('28', 'Andhra Pradesh (before division)',           false, 28),
  ('29', 'Karnataka',                                  true, 29),
  ('30', 'Goa',                                        true, 30),
  ('31', 'Lakshadweep',                                true, 31),
  ('32', 'Kerala',                                     true, 32),
  ('33', 'Tamil Nadu',                                 true, 33),
  ('34', 'Puducherry',                                 true, 34),
  ('35', 'Andaman and Nicobar Islands',                true, 35),
  ('36', 'Telangana',                                  true, 36),
  ('37', 'Andhra Pradesh',                             true, 37),
  ('38', 'Ladakh',                                     true, 38),
  ('97', 'Other Territory',                            true, 97),
  ('99', 'Centre Jurisdiction',                        true, 99)
on conflict (code) do nothing;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
create or replace function public.fms_customer_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_customer_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_customer_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
-- Coordinators may act on EVERY step and hold/resume/cancel any request.
create or replace function public.fms_customer_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_customer_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids', '[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_customer_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
create or replace function public.fms_customer_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_customer_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_customer_step_owner_ids(text) to authenticated;

-- "Is this user an owner of ANY back-office step?" — i.e. Accounts, Sales Head,
-- Director or Tally. Exists so the read policies (and the storage policies in
-- 20260802120100) stay one short InitPlan instead of four, and so adding a step
-- later does not mean editing five policy bodies.
--
-- 'submission' is EXCLUDED on purpose: owning submission means "may raise",
-- which must not by itself grant sight of every other rep's customers.
create or replace function public.fms_customer_is_any_step_owner(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_customer_step_owners o
    where o.step_key <> 'submission'
      and p_uid = any(o.employee_ids)
  );
$$;
grant execute on function public.fms_customer_is_any_step_owner(uuid) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_customer_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'request'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists fms_customer_activity_entity_idx  on public.fms_customer_activity (entity_type, entity_id);
create index if not exists fms_customer_activity_created_idx on public.fms_customer_activity (created_at);

comment on table public.fms_customer_activity is
  '⚠ NARRATIVE TRAIL ONLY. NEVER infer a step''s completion from this table — announce() is best-effort and its errors are swallowed. Every step stamps its own *_at / *_by columns on fms_customer_requests, and those are the history.';

create table if not exists public.fms_customer_notifications (
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
create index if not exists fms_customer_notifications_user_idx    on public.fms_customer_notifications (user_id, read_at);
create index if not exists fms_customer_notifications_created_idx on public.fms_customer_notifications (created_at);

-- Activity read: back-office step owners see everything; a rep sees the trail of
-- requests they raised or were assigned. The constant checks come FIRST so a
-- staff user short-circuits before the per-row EXISTS is ever evaluated.
--
-- NOTE the forward reference to public.fms_customer_requests — that table lands
-- in 20260802120100, so THIS POLICY IS CREATED THERE, not here. Postgres
-- validates the body at creation time and would fail on a missing relation.
alter table public.fms_customer_activity enable row level security;
drop policy if exists fms_customer_activity_write_admin on public.fms_customer_activity;
create policy fms_customer_activity_write_admin on public.fms_customer_activity
  for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

alter table public.fms_customer_notifications enable row level security;
drop policy if exists fms_customer_notifications_select_own on public.fms_customer_notifications;
create policy fms_customer_notifications_select_own on public.fms_customer_notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists fms_customer_notifications_update_own on public.fms_customer_notifications;
create policy fms_customer_notifications_update_own on public.fms_customer_notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists fms_customer_notifications_write_admin on public.fms_customer_notifications;
create policy fms_customer_notifications_write_admin on public.fms_customer_notifications
  for all to authenticated
  using      ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- ===========================================================================
-- EMAIL GATE
--
-- Seeded OFF: nothing emails until an admin flips Customer Onboarding →
-- Notifications in the hub's Settings. Sampling needed a SECOND migration
-- (20260726120100) to retrofit the enqueue into its announce(); this module
-- ships announce() with the enqueue already inside, so there is no retrofit.
-- ===========================================================================
insert into public.email_module_settings (module_id, enabled)
values ('customer-onboarding', false)
on conflict (module_id) do nothing;

-- ===========================================================================
-- fms_customer_announce — one call = one activity row (actor = caller) + a bell
-- notification per recipient + (when the module's email is on) one email_outbox
-- row per recipient. Self-skip + de-dup are shared by all three.
--
-- Called as the LAST statement of every workflow RPC, targeting the NEXT step's
-- owners. Best-effort: NEVER the source of truth for state.
-- ===========================================================================
drop function if exists public.fms_customer_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_customer_announce(
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
  v_actor    uuid := auth.uid();
  u          uuid;
  seen       uuid[] := '{}';
  v_email_on boolean := public.email_module_enabled('customer-onboarding');
  v_email    text;
begin
  insert into public.fms_customer_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;

      insert into public.fms_customer_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '')  from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('customer_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(p_meta, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_customer_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- STORAGE — the KYC document bucket.
--
-- Private. Upload key convention: <requestId>/<slot>/<epoch>-<sanitised-name>,
-- slot ∈ gst | pan | cheque | msme. The first path segment is what the policies
-- in 20260802120100 match against fms_customer_requests.id.
--
-- ⚠ DO NOT COPY THE SAMPLING BUCKET'S POLICIES. 20260724120000 grants every
--   authenticated user SELECT on the whole fms-sampling-docs bucket. These files
--   are PAN cards and cancelled cheques; the equivalent here would let anyone
--   with a portal login read every customer's banking documents. The policies in
--   the next migration are scoped to the request's raiser plus the back-office
--   step owners, and they must stay that way.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-customer-docs', 'fms-customer-docs', false)
on conflict (id) do nothing;
