-- ===========================================================================
-- OCPI FMS — FOUNDATIONS (Phase 1).
--
-- The ELEVENTH FMS module. Like fms_asset_* / fms_dispatch_* / fms_production_*
-- / fms_sampling_* / fms_import_* / fms_supplies_* / fms_exit_* / fms_hr_*, it
-- mirrors the config backbone into its OWN tables rather than reusing a shared
-- one: modules must stay independently droppable, and a shared step_owners
-- table would collide on step_key.
--
-- WHAT OCPI IS
--   The pre-sale of a printing machine, from the first quotation to a
--   countersigned order confirmation. ONE entity — a DEAL — runs a six-step
--   chain:
--
--     quotation → quotation_approval → order_confirmation → oc_approval
--       → customer_signoff → management_signoff → closed
--
--   The salesperson drafts a quotation (part A of the old Microsoft form),
--   generates a PDF, iterates it through as many REVISIONS as the negotiation
--   needs, then marks it final. Management or finance approve. The salesperson
--   then fills part B, the order confirmation is generated off a per-machine
--   template, management approve it, the customer signs a printout, and
--   management countersign. Both signed documents are captured here.
--
--   ⚠ ONE ENTITY, NOT TWO. The order confirmation inherits every quotation
--     field by BEING THE SAME ROW. There is no copy step, so the two documents
--     cannot drift apart — which is the whole complaint about the paper process
--     this replaces.
--
-- Tables created here:
--   fms_ocpi_step_owners      — one row per workflow step_key → owners
--   fms_ocpi_config           — key/value singletons (jsonb)
--   fms_ocpi_counters + next_seq — document numbering
--   fms_ocpi_activity         — audit trail
--   fms_ocpi_notifications    — per-user bell feed
--   fms_ocpi_company_profiles — per selling entity: letterhead, bank block, city
--   storage bucket fms-ocpi-docs
--
-- The deal itself, its quotation versions and every step RPC are migration 2
-- (20260929120100). The machine/template masters are migration 3.
--
-- ⚠ NUMBERING IS NOT FY-SCOPED FOR THE QUOTATION, AND THAT IS DELIBERATE.
--   A quotation series already exists on paper — `QT-M0023` was issued through
--   the Microsoft form — so the scope is the bare string 'quotation' and the
--   counter is SEEDED past the current maximum rather than restarted at 1.
--   Restarting would re-issue numbers customers already hold. The order
--   confirmation is FY-scoped ('oc:<fy>'), matching the OTPL/OC/ prefix the
--   PowerPoint templates print. fms_ocpi_fy_code() is here for the latter.
--
-- ⚠ EVERY WRITE PREDICATE IS GATED ON module_can_edit() FROM DAY ONE.
--   20260923120000 had to retrofit that gate onto 35 functions across ten
--   modules by copying each body to <name>__ungated and wrapping the original.
--   A module written after that migration should not need the same surgery, so
--   fms_ocpi_is_step_owner carries the gate in its own body. Note what is NOT
--   gated: fms_ocpi_step_owner_ids (a notification fan-out, i.e. a read) and
--   fms_ocpi_is_coordinator (not a write predicate on its own).
--
-- ⚠ RLS policies wrap every helper call in a scalar sub-select —
--   `using ((select public.is_admin(auth.uid())))`. Called inline, Postgres
--   evaluates the function ONCE PER ROW; wrapped, it becomes a one-shot
--   InitPlan. Same rewrite as 20260730130000_speed_up_task_rls.sql (472ms →
--   15ms) and 20260924120000_dispatch_visibility_hoisted.sql (1,620ms → ~5ms).
--
-- ⚠ EVERY POLICY IS SCOPED `to authenticated`. `anon` holds full table grants
--   (the Supabase default); that scope is the only thing keeping anonymous
--   callers out.
--
-- Purely ADDITIVE. Reuses public.set_updated_at() / public.is_admin(uuid) /
-- public.module_can_edit(uuid,text) / public.designations / public.mst_companies
-- / public.mst_locations. Creates no customer master — mst_parties is read
-- directly (see migration 2).
--
-- Reversal (reverse order):
--   drop policy if exists "fms ocpi docs read"   on storage.objects;
--   drop policy if exists "fms ocpi docs insert" on storage.objects;
--   drop policy if exists "fms ocpi docs update" on storage.objects;
--   drop policy if exists "fms ocpi docs delete" on storage.objects;
--   delete from storage.buckets where id = 'fms-ocpi-docs';
--   drop function if exists public.fms_ocpi_announce(text,uuid,text,text,uuid[],jsonb);
--   drop function if exists public.fms_ocpi_step_owner_ids(text);
--   drop function if exists public.fms_ocpi_is_coordinator(uuid);
--   drop function if exists public.fms_ocpi_is_step_owner(text,uuid);
--   drop function if exists public.fms_ocpi_next_seq(text);
--   drop function if exists public.fms_ocpi_fy_code(date);
--   drop table if exists public.fms_ocpi_company_profiles,
--                        public.fms_ocpi_notifications, public.fms_ocpi_activity,
--                        public.fms_ocpi_counters, public.fms_ocpi_config,
--                        public.fms_ocpi_step_owners;
-- ===========================================================================

begin;

-- ===========================================================================
-- fms_ocpi_step_owners — owners assigned to each workflow step.
-- step_key is a code-defined constant — see frontend/src/apps/ocpi/lib/steps.ts.
-- Authorization comes SOLELY from employee_ids; department_ids is a UI filter.
--
-- The two APPROVAL steps are ordinary rows here (quotation_approval,
-- oc_approval) — that is the whole of the approval mechanism, per the decision
-- to follow Order to Dispatch rather than invent a second one. If value bands
-- are ever wanted, fms_purchase_approval_matrix is the shape to copy.
--
-- Following Order to Dispatch, there is NO CHECK barring the origin step
-- (`quotation`) from this table. Semantics: no owners on `quotation` ⇒ any
-- granted user may raise a deal; owners set ⇒ only them plus admins and
-- coordinators.
-- ===========================================================================
create table if not exists public.fms_ocpi_step_owners (
  id              uuid primary key default gen_random_uuid(),
  step_key        text not null unique,
  department_ids  uuid[] not null default '{}',
  designation_id  uuid references public.designations on delete set null,
  employee_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_ocpi_step_owners is
  'Owners per OCPI workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. The approval gates are just the quotation_approval and oc_approval rows.';

drop trigger if exists trg_fms_ocpi_step_owners_updated on public.fms_ocpi_step_owners;
create trigger trg_fms_ocpi_step_owners_updated
  before update on public.fms_ocpi_step_owners
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_step_owners enable row level security;

drop policy if exists fms_ocpi_step_owners_select on public.fms_ocpi_step_owners;
create policy fms_ocpi_step_owners_select on public.fms_ocpi_step_owners
  for select to authenticated using (true);

drop policy if exists fms_ocpi_step_owners_write on public.fms_ocpi_step_owners;
create policy fms_ocpi_step_owners_write on public.fms_ocpi_step_owners
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- ===========================================================================
-- fms_ocpi_config — key/value singletons.
-- Keys in use: 'step_sla', 'process_coordinators' ({"user_ids":[...]}),
--              'quotation_validity_days', 'default_gst_rate'.
-- ===========================================================================
create table if not exists public.fms_ocpi_config (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.fms_ocpi_config is
  'OCPI module settings as jsonb singletons: step_sla, process_coordinators, quotation_validity_days, default_gst_rate.';

drop trigger if exists trg_fms_ocpi_config_updated on public.fms_ocpi_config;
create trigger trg_fms_ocpi_config_updated
  before update on public.fms_ocpi_config
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_config enable row level security;

drop policy if exists fms_ocpi_config_select on public.fms_ocpi_config;
create policy fms_ocpi_config_select on public.fms_ocpi_config
  for select to authenticated using (true);

drop policy if exists fms_ocpi_config_write on public.fms_ocpi_config;
create policy fms_ocpi_config_write on public.fms_ocpi_config
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

insert into public.fms_ocpi_config (key, value) values
  ('quotation_validity_days', '{"days": 30}'::jsonb),
  ('default_gst_rate',        '{"rate": 18}'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- NUMBERING
--   'quotation'  → QT-M0024, QT-M0025, …  (continues the paper series)
--   'oc:<fy>'    → OTPL/OC/2627/0001      (FY-scoped, as the templates print)
-- ===========================================================================
create table if not exists public.fms_ocpi_counters (
  scope       text primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.fms_ocpi_counters is
  'Per-scope document-number sequences (quotation, oc:<fy>). Mutated only via fms_ocpi_next_seq(). The quotation scope is SEEDED past the highest number already issued on paper — see the header.';

alter table public.fms_ocpi_counters enable row level security;

drop policy if exists fms_ocpi_counters_select_admin on public.fms_ocpi_counters;
create policy fms_ocpi_counters_select_admin on public.fms_ocpi_counters
  for select to authenticated using ((select public.is_admin(auth.uid())));

create or replace function public.fms_ocpi_next_seq(p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.fms_ocpi_counters (scope, last_value)
  values (p_scope, 1)
  on conflict (scope) do update
    set last_value = public.fms_ocpi_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

comment on function public.fms_ocpi_next_seq(text) is
  'Atomically increment and return the next sequence value for a numbering scope. A new scope string starts at 1, which is how FY restarts fall out with no seeding.';
grant execute on function public.fms_ocpi_next_seq(text) to authenticated;

-- ⚠ SEED THE QUOTATION SCOPE BEFORE THE FIRST LIVE NUMBER IS MINTED.
--   The paper series had reached at least QT-M0023. 23 is a FLOOR, not a
--   confirmed maximum — Bushra owns the real figure (tracked in OCPI.md). This
--   seeds the floor so a number already in a customer's hands can never be
--   re-issued; raise it with a one-line update once the true maximum is known,
--   which is safe because the counter only ever moves forward.
insert into public.fms_ocpi_counters (scope, last_value)
values ('quotation', 23)
on conflict (scope) do nothing;

-- Financial-year code for numbering: 2026-08-01 → '2627'.
create or replace function public.fms_ocpi_fy_code(p_d date)
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
grant execute on function public.fms_ocpi_fy_code(date) to authenticated;

-- ===========================================================================
-- AUTHZ HELPERS
-- ===========================================================================

-- Owner check for one workflow step.
--
-- ⚠ THE module_can_edit GATE IS PART OF THE BODY, not a later wrapper. See the
--   header: 20260923120000 had to retrofit this onto 35 existing functions.
create or replace function public.fms_ocpi_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'ocpi')
     and exists (
       select 1 from public.fms_ocpi_step_owners o
       where o.step_key = p_step_key
         and p_uid = any(o.employee_ids)
     );
$$;

comment on function public.fms_ocpi_is_step_owner(text, uuid) is
  'Does this user own this OCPI step AND hold an edit-level grant on the module? Gated on module_can_edit in its own body, so no __ungated split is ever needed here.';
grant execute on function public.fms_ocpi_is_step_owner(text, uuid) to authenticated;

-- Process-coordinator check (reads the singleton config row). Admins included.
create or replace function public.fms_ocpi_is_coordinator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
    or exists (
      select 1 from public.fms_ocpi_config c
      where c.key = 'process_coordinators'
        and p_uid::text in (
          select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
        )
    );
$$;
grant execute on function public.fms_ocpi_is_coordinator(uuid) to authenticated;

-- Owners of one step, as an array — for the notification fan-out.
--
-- ⚠ NOT GATED on module_can_edit, deliberately. This answers "who should be
--   told", not "who may act". Gating it would silently empty the recipient list
--   for a step whose owners happen to hold a view grant.
create or replace function public.fms_ocpi_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_ocpi_step_owners o where o.step_key = p_step_key),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_ocpi_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- ACTIVITY + NOTIFICATIONS
-- ===========================================================================
create table if not exists public.fms_ocpi_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,            -- 'deal' | 'quotation_version'
  entity_id   uuid not null,
  type        text not null,
  actor_id    uuid references auth.users on delete set null,
  note        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.fms_ocpi_activity is
  'Append-only audit trail for OCPI. Written ONLY inside security-definer RPCs, via fms_ocpi_announce() — never inserted from the browser.';

create index if not exists fms_ocpi_activity_entity_idx  on public.fms_ocpi_activity (entity_type, entity_id);
create index if not exists fms_ocpi_activity_created_idx on public.fms_ocpi_activity (created_at);

alter table public.fms_ocpi_activity enable row level security;

drop policy if exists fms_ocpi_activity_select on public.fms_ocpi_activity;
create policy fms_ocpi_activity_select on public.fms_ocpi_activity
  for select to authenticated using (true);

drop policy if exists fms_ocpi_activity_write_admin on public.fms_ocpi_activity;
create policy fms_ocpi_activity_write_admin on public.fms_ocpi_activity
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

create table if not exists public.fms_ocpi_notifications (
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

comment on table public.fms_ocpi_notifications is
  'Per-user bell feed for OCPI. Best-effort: never the source of truth for state.';

create index if not exists fms_ocpi_notifications_user_idx    on public.fms_ocpi_notifications (user_id, read_at);
create index if not exists fms_ocpi_notifications_created_idx on public.fms_ocpi_notifications (created_at);

alter table public.fms_ocpi_notifications enable row level security;

drop policy if exists fms_ocpi_notifications_select_own on public.fms_ocpi_notifications;
create policy fms_ocpi_notifications_select_own on public.fms_ocpi_notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists fms_ocpi_notifications_update_own on public.fms_ocpi_notifications;
create policy fms_ocpi_notifications_update_own on public.fms_ocpi_notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- One call = one activity row + a notification fan-out.
-- 20260929120400 will `create or replace` this with the same body plus a gated
-- email_outbox enqueue, exactly as every other module does.
create or replace function public.fms_ocpi_announce(
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
  insert into public.fms_ocpi_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_ocpi_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;

comment on function public.fms_ocpi_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one OCPI event: an activity row always, plus one notification per recipient. Pass an EMPTY recipient list for a correction — it belongs on the audit trail without paging anyone.';
grant execute on function public.fms_ocpi_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- fms_ocpi_company_profiles — the selling entity's identity on the document.
--
-- WHY THIS EXISTS AT ALL
--   Every PowerPoint order-confirmation template hardcodes ONE letterhead, ONE
--   bank account (Axis, Sachin, A/C 919030077980346) and ONE Ex-Works city
--   (Surat). There are FIVE companies in mst_companies — two Orange O Tec
--   entities, their Noida arms, and Colorix Digital Printing Solutions LLP —
--   and the letterhead footer embedded in those decks carries a REGISTERED
--   ADDRESS and a CIN. Booked under any other entity, the bank block and the
--   CIN on a customer's contract are simply wrong.
--
--   Order to Dispatch and Customer Onboarding both had to retrofit a company
--   dimension (20260918120000, 20260920120000). This module carries it from day
--   one, which costs one table because 1,878 of the 1,888 customers in
--   mst_parties already have company_id — so picking the customer resolves the
--   entity with no extra question.
--
-- Rows are seeded EMPTY on purpose: an admin fills them in Settings → Company
-- Profiles. A deal whose company has no profile falls back to the default row
-- (is_default = true), so the common Orange O Tec / Surat case works untouched.
-- ===========================================================================
create table if not exists public.fms_ocpi_company_profiles (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid unique references public.mst_companies on delete restrict,
  is_default          boolean not null default false,
  legal_name          text,
  cin                 text,
  registered_address  text,
  bank_name           text,
  bank_branch         text,
  bank_account_no     text,
  bank_ifsc           text,
  ex_works_city       text,
  letterhead_path     text,
  active              boolean not null default true,
  sort_order          integer not null default 0,
  created_by          uuid references auth.users on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.fms_ocpi_company_profiles is
  'Per selling entity: the legal name, CIN, registered address, bank block, Ex-Works city and letterhead asset printed on that entity''s quotations and order confirmations. Exactly one row may be is_default.';

-- Only one default, enforced rather than trusted.
create unique index if not exists fms_ocpi_company_profiles_default_uk
  on public.fms_ocpi_company_profiles ((true)) where is_default;

drop trigger if exists trg_fms_ocpi_company_profiles_updated on public.fms_ocpi_company_profiles;
create trigger trg_fms_ocpi_company_profiles_updated
  before update on public.fms_ocpi_company_profiles
  for each row execute function public.set_updated_at();

alter table public.fms_ocpi_company_profiles enable row level security;

drop policy if exists fms_ocpi_company_profiles_select on public.fms_ocpi_company_profiles;
create policy fms_ocpi_company_profiles_select on public.fms_ocpi_company_profiles
  for select to authenticated using (true);

drop policy if exists fms_ocpi_company_profiles_write on public.fms_ocpi_company_profiles;
create policy fms_ocpi_company_profiles_write on public.fms_ocpi_company_profiles
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- The default profile: Orange O Tec Pvt Ltd, Sachin, Surat — read verbatim off
-- the letterhead embedded in the order-confirmation decks and off their bank
-- block. company_id stays NULL so this row also covers a deal whose customer
-- carries no company.
insert into public.fms_ocpi_company_profiles
  (is_default, legal_name, cin, registered_address, bank_name, bank_branch,
   bank_account_no, bank_ifsc, ex_works_city, sort_order)
select
  true,
  'M/s ORANGE O TEC PVT LTD.',
  'U72200RJ2011PTC033991',
  'Shed No. A2/7111, Road No. 71, Gate No. 01, G.I.D.C. Sachin, Surat-394 230, (Guj.) India',
  'AXIS BANK',
  'SACHIN',
  '919030077980346',
  'UTIB0003360',
  'Surat',
  0
where not exists (select 1 from public.fms_ocpi_company_profiles where is_default);

-- ===========================================================================
-- STORAGE — private bucket for the generated quotation / order confirmation and
-- the two signed scans. Object path is
--   <deal-id>/<slot>/<epoch>-<filename>
-- with slot ∈ quotation | oc | customer-signed | management-signed.
--
-- ⚠ THE FIRST PATH SEGMENT IS LOAD-BEARING. 20260929120500 replaces the four
--   policies below with ones that derive the owning deal from that segment and
--   reuse fms_ocpi_can_see_deal — the same hardening
--   20260821120000_fms_dispatch_doc_storage_policies.sql applied after
--   discovering that a bucket-id-only rule let any authenticated user mint a
--   signed URL for any invoice. The baseline below exists only so phase 1 has a
--   working bucket; do not ship the signature loop on it.
--
-- ⚠ Policy names are GLOBAL on storage.objects. These four are unique to this
--   module — never reuse another module's names, or its `drop policy if exists`
--   would delete this one's (and vice versa).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('fms-ocpi-docs', 'fms-ocpi-docs', false)
on conflict (id) do nothing;

drop policy if exists "fms ocpi docs read"   on storage.objects;
drop policy if exists "fms ocpi docs insert" on storage.objects;
drop policy if exists "fms ocpi docs update" on storage.objects;
drop policy if exists "fms ocpi docs delete" on storage.objects;

create policy "fms ocpi docs read" on storage.objects
  for select to authenticated using (bucket_id = 'fms-ocpi-docs');
create policy "fms ocpi docs insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fms-ocpi-docs');
create policy "fms ocpi docs update" on storage.objects
  for update to authenticated
  using (bucket_id = 'fms-ocpi-docs') with check (bucket_id = 'fms-ocpi-docs');
create policy "fms ocpi docs delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fms-ocpi-docs');

commit;
