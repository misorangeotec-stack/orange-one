-- ===========================================================================
-- Travel Desk FMS — VOCABULARY MASTERS (Phase 2).
--
-- Six lists the trip form and the expense claim choose from. All six follow the
-- MasterCrud contract — `id / name / active / sort_order` — so each gets sort,
-- cascading filters, an Excel round trip and deactivate-never-delete for free.
--
-- ⚠ DEACTIVATE, NEVER DELETE. A city, a purpose or an expense category with
--   trips against it is history. Switching a row off keeps it off the pickers
--   while last quarter's claim still reads correctly.
--
-- WHAT IS HERE AND WHY EACH ONE IS A TABLE RATHER THAN A CONSTANT
--
--   fms_travel_cities      — the tier decides the hotel cap, the daily allowance
--                            and the conveyance cap. A city with no tier cannot
--                            be priced, so this cannot be free text.
--   fms_travel_purposes    — the PRD's nine, plus the "Others needs a reason"
--                            rule as a column rather than a hardcoded string
--                            comparison.
--   fms_travel_expense_categories
--                          — the claim form's own line types, AND Section 15's
--                            non-reimbursable list carried as rows with
--                            reimbursable = false. See the note on that table.
--   fms_travel_airlines / _hotels / _bus_operators
--                          — preference lists. These are the ones that grow, so
--                            they are the reason the master-request flow exists.
--
-- ⚠ ONE FOREIGN KEY IS ADDED HERE, NOT IN PHASE 1.
--   fms_travel_employee_settings.base_city_id was created as a plain uuid
--   because its target did not exist yet. It is constrained now.
--
-- Additive. Reversal (reverse order):
--   alter table public.fms_travel_employee_settings
--     drop constraint if exists fms_travel_employee_settings_base_city_fkey;
--   drop table if exists public.fms_travel_bus_operators,
--                        public.fms_travel_hotels,
--                        public.fms_travel_airlines,
--                        public.fms_travel_expense_categories,
--                        public.fms_travel_purposes,
--                        public.fms_travel_cities;
-- ===========================================================================

begin;

-- ===========================================================================
-- CITIES — and their tier, which is what prices everything.
--
-- ⚠ TIER 3 IS THE POLICY'S OWN DEFAULT: §1.3 defines it as "All other cities,
--   towns, and locations not covered in Tier 1 or Tier 2". So seeding a city at
--   tier 3 asserts nothing the policy does not already say, which is why the
--   list below can be generous without inventing policy. The eighteen Tier 1 and
--   Tier 2 rows ARE quoted from §1.3 and must not be edited casually.
--
-- ⚠ SURAT — the head office — IS TIER 2. Most trips therefore START at Tier 2,
--   and a Surat hotel is capped at the Tier 2 rate. Worth knowing before anyone
--   reads a cap and assumes the base city is a metro.
--
-- ⚠ §7.2's Tier 2 header drops Lucknow, Coimbatore and Bhubaneswar from the
--   list §1.3 gives. §1.3 is the definitions section and is used here; the
--   shorter list reads as an abbreviation ("etc."), not as a different rule.
-- ===========================================================================
create table if not exists public.fms_travel_cities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  state      text,
  tier       smallint not null default 3 check (tier in (1, 2, 3)),
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fms_travel_cities is
  'Destination and base cities with their Travel Policy tier (1.3). The tier decides the hotel cap, the daily allowance and the local conveyance cap, so a city cannot be free text. Tier 3 is the policy default for anything not named in 1.3.';

create index if not exists fms_travel_cities_tier_idx on public.fms_travel_cities (tier);

drop trigger if exists trg_fms_travel_cities_updated on public.fms_travel_cities;
create trigger trg_fms_travel_cities_updated
  before update on public.fms_travel_cities
  for each row execute function public.set_updated_at();

alter table public.fms_travel_cities enable row level security;

drop policy if exists fms_travel_cities_select on public.fms_travel_cities;
create policy fms_travel_cities_select on public.fms_travel_cities
  for select to authenticated using (true);

-- Write is widened in 20261005120500 to the list's own master managers. Until
-- then, admins only.
drop policy if exists fms_travel_cities_write on public.fms_travel_cities;
create policy fms_travel_cities_write on public.fms_travel_cities
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- Tier 1 — §1.3 verbatim, all eight.
insert into public.fms_travel_cities (name, state, tier, sort_order) values
  ('Mumbai',      'Maharashtra',   1, 10),
  ('Delhi (NCR)', 'Delhi',         1, 20),
  ('Bengaluru',   'Karnataka',     1, 30),
  ('Chennai',     'Tamil Nadu',    1, 40),
  ('Hyderabad',   'Telangana',     1, 50),
  ('Kolkata',     'West Bengal',   1, 60),
  ('Pune',        'Maharashtra',   1, 70),
  ('Ahmedabad',   'Gujarat',       1, 80)
on conflict (name) do nothing;

-- Tier 2 — §1.3 verbatim, all ten ("and similar" is why the list can grow).
insert into public.fms_travel_cities (name, state, tier, sort_order) values
  ('Surat',       'Gujarat',        2, 110),
  ('Vadodara',    'Gujarat',        2, 120),
  ('Rajkot',      'Gujarat',        2, 130),
  ('Jaipur',      'Rajasthan',      2, 140),
  ('Lucknow',     'Uttar Pradesh',  2, 150),
  ('Indore',      'Madhya Pradesh', 2, 160),
  ('Nagpur',      'Maharashtra',    2, 170),
  ('Coimbatore',  'Tamil Nadu',     2, 180),
  ('Chandigarh',  'Chandigarh',     2, 190),
  ('Bhubaneswar', 'Odisha',         2, 200)
on conflict (name) do nothing;

-- Tier 3 — a starting set so the form is usable on day one. Every one of these
-- is "not named in §1.3", which is exactly what the policy defines as Tier 3.
insert into public.fms_travel_cities (name, state, tier, sort_order) values
  ('Agra',        'Uttar Pradesh',  3, 300),
  ('Amritsar',    'Punjab',         3, 305),
  ('Aurangabad',  'Maharashtra',    3, 310),
  ('Bhilwara',    'Rajasthan',      3, 315),
  ('Bhiwandi',    'Maharashtra',    3, 320),
  ('Erode',       'Tamil Nadu',     3, 325),
  ('Gandhinagar', 'Gujarat',        3, 330),
  ('Jodhpur',     'Rajasthan',      3, 335),
  ('Kanpur',      'Uttar Pradesh',  3, 340),
  ('Kochi',       'Kerala',         3, 345),
  ('Ludhiana',    'Punjab',         3, 350),
  ('Madurai',     'Tamil Nadu',     3, 355),
  ('Nashik',      'Maharashtra',    3, 360),
  ('Panipat',     'Haryana',        3, 365),
  ('Salem',       'Tamil Nadu',     3, 370),
  ('Solapur',     'Maharashtra',    3, 375),
  ('Tirupur',     'Tamil Nadu',     3, 380),
  ('Varanasi',    'Uttar Pradesh',  3, 385)
on conflict (name) do nothing;

-- Now that the target exists, constrain the phase-1 column.
-- RESTRICT, not cascade: a city somebody's base city points at is not something
-- to lose silently.
do $mig$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'fms_travel_employee_settings_base_city_fkey'
  ) then
    alter table public.fms_travel_employee_settings
      add constraint fms_travel_employee_settings_base_city_fkey
      foreign key (base_city_id) references public.fms_travel_cities on delete restrict;
  end if;
end $mig$;


-- ===========================================================================
-- PURPOSE OF TRAVEL — the PRD's nine (§7 of v2.0, §6 of v3.0).
--
-- `requires_remarks` is a COLUMN rather than a hardcoded check for "Others",
-- because the moment somebody adds "Internal Audit" or "Vendor Visit" they will
-- want the same rule available without a deploy.
-- ===========================================================================
create table if not exists public.fms_travel_purposes (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  requires_remarks boolean not null default false,
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_by       uuid references auth.users on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.fms_travel_purposes is
  'Why the trip is being taken. requires_remarks forces a free-text reason - set on Others, and available to any row that needs it.';

drop trigger if exists trg_fms_travel_purposes_updated on public.fms_travel_purposes;
create trigger trg_fms_travel_purposes_updated
  before update on public.fms_travel_purposes
  for each row execute function public.set_updated_at();

alter table public.fms_travel_purposes enable row level security;

drop policy if exists fms_travel_purposes_select on public.fms_travel_purposes;
create policy fms_travel_purposes_select on public.fms_travel_purposes
  for select to authenticated using (true);

drop policy if exists fms_travel_purposes_write on public.fms_travel_purposes;
create policy fms_travel_purposes_write on public.fms_travel_purposes
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

insert into public.fms_travel_purposes (name, requires_remarks, sort_order) values
  ('Customer Visit',        false, 10),
  ('Customer Complaint',    false, 20),
  ('Sales Meeting',         false, 30),
  ('New Customer Meeting',  false, 40),
  ('Exhibition',            false, 50),
  ('Branch Visit',          false, 60),
  ('Conference',            false, 70),
  ('Government Work',       false, 80),
  ('Others',                true,  90)
on conflict (name) do nothing;


-- ===========================================================================
-- EXPENSE CATEGORIES — what a claim line can be.
--
-- ⚠ SECTION 15'S NON-REIMBURSABLE LIST LIVES HERE, AS ROWS WITH
--   reimbursable = false. That is the single most useful thing in this
--   migration. On paper, "alcohol is never reimbursable regardless of band or
--   approval" is a sentence in a policy nobody re-reads, enforced only if a
--   reviewer happens to notice a bar tab inside a restaurant bill. As a row, the
--   CATEGORY ITSELF REFUSES — the claim form will not total it, and no approver
--   has to be the one to say no.
--
--   They are rows rather than an exclusion list because a claim sometimes has to
--   RECORD a non-reimbursable expense (a fine incurred on company time, a
--   personal upgrade paid out of the same card) so the trip's full cost is
--   visible even though the company is not paying it.
--
-- ⚠ receipt_required_above AND self_declaration_cap ARE THE TC-INVARIANT ONES
--   ONLY. §11.3 sets a blanket "receipt for any single expense above ₹200" and
--   ₹300 for a hired cab. But the LOCAL CONVEYANCE self-declaration limit varies
--   by travel category (§10: ₹200 per trip for TC-C, ₹100 for TC-D), so it
--   cannot live on the category — it belongs in the rate card, as
--   conveyance_self_dec. A per-category column holding a band-varying number is
--   how a cap ends up applied to the wrong person.
--
-- `kind` groups categories for the engine: everything of kind 'hotel' is checked
-- against the hotel cap, everything of kind 'conveyance' against the daily
-- conveyance cap, and so on.
-- ===========================================================================
create table if not exists public.fms_travel_expense_categories (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  kind                  text not null check (kind in (
                          'transport', 'transfer', 'hotel', 'conveyance',
                          'meal', 'mileage', 'fee', 'misc', 'non_reimbursable')),
  reimbursable          boolean not null default true,
  -- Null = a receipt is ALWAYS required (air, train, hotel).
  receipt_required_above numeric(12,2),
  -- Null = no self-declaration allowed, or the limit is band-varying and lives
  -- in the rate card instead.
  self_declaration_cap  numeric(12,2),
  needs_guest_details   boolean not null default false,
  -- Why the company will not pay for it, printed beside the line.
  refusal_note          text,
  active                boolean not null default true,
  sort_order            integer not null default 0,
  created_by            uuid references auth.users on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.fms_travel_expense_categories is
  'Claim line types. Section 15 non-reimbursables are rows with reimbursable = false, so the category itself refuses rather than an approver having to notice. Band-varying limits live in the rate card, not here.';

drop trigger if exists trg_fms_travel_expense_categories_updated on public.fms_travel_expense_categories;
create trigger trg_fms_travel_expense_categories_updated
  before update on public.fms_travel_expense_categories
  for each row execute function public.set_updated_at();

alter table public.fms_travel_expense_categories enable row level security;

drop policy if exists fms_travel_expense_categories_select on public.fms_travel_expense_categories;
create policy fms_travel_expense_categories_select on public.fms_travel_expense_categories
  for select to authenticated using (true);

drop policy if exists fms_travel_expense_categories_write on public.fms_travel_expense_categories;
create policy fms_travel_expense_categories_write on public.fms_travel_expense_categories
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- Reimbursable — Annexure B Part A, plus the ones §4 to §13 name.
insert into public.fms_travel_expense_categories
  (name, kind, reimbursable, receipt_required_above, self_declaration_cap, needs_guest_details, sort_order) values
  ('Air Ticket',                     'transport',  true, null,  null, false, 10),
  ('Train Ticket',                   'transport',  true, null,  null, false, 20),
  ('Bus Ticket',                     'transport',  true, null,  null, false, 30),
  ('Airport / Station Transfer',     'transfer',   true, 300,   null, false, 40),
  ('Hotel — room charges',           'hotel',      true, null,  null, false, 50),
  ('Local Conveyance at Destination','conveyance', true, 300,   null, false, 60),
  ('Rental Vehicle (full day)',      'conveyance', true, null,  null, false, 70),
  ('Own Vehicle — fuel / km',        'mileage',    true, null,  null, false, 80),
  ('Toll & Parking',                 'transfer',   true, 200,   null, false, 90),
  ('Business Meal (with guests)',    'meal',       true, null,  null, true, 100),
  ('Team Meal',                      'meal',       true, 200,   null, false, 110),
  ('Refreshments during travel',     'meal',       true, 200,   200,  false, 120),
  ('Late-night Meal',                'meal',       true, 300,   300,  false, 130),
  ('Excess Baggage (company material)','fee',      true, null,  null, false, 140),
  ('Conference / Training Fee',      'fee',        true, null,  null, false, 150),
  ('Miscellaneous (porterage, tips)','misc',       true, 200,   200,  false, 160)
on conflict (name) do nothing;

-- NOT reimbursable — Section 15, verbatim categories with its own examples.
insert into public.fms_travel_expense_categories
  (name, kind, reimbursable, refusal_note, sort_order) values
  ('Alcohol & Tobacco',        'non_reimbursable', false,
   'Never reimbursable under any circumstances, regardless of band or whether a client was present (Policy §9.1 and §15).', 900),
  ('Personal Entertainment',   'non_reimbursable', false,
   'Movies, shows, sport, shopping, spa, gym, tours (Policy §15).', 910),
  ('Personal Phone / Internet','non_reimbursable', false,
   'Personal roaming, home internet, OTT subscriptions (Policy §15).', 920),
  ('Traffic Fines & Challans', 'non_reimbursable', false,
   'Parking fines, challans, speeding — the employee is personally liable (Policy §15).', 930),
  ('Loss or Theft',            'non_reimbursable', false,
   'Report to the police and to HR; the company is not liable (Policy §15).', 940),
  ('Personal Medical',         'non_reimbursable', false,
   'Covered by group medical insurance, not by the travel policy (Policy §15).', 950),
  ('Gifts & Presents',         'non_reimbursable', false,
   'Business gifting has a separate policy (Policy §15).', 960),
  ('Spouse or Family Travel',  'non_reimbursable', false,
   'Any expense for an accompanying spouse, child or family member (Policy §15).', 970),
  ('Personal Upgrade',         'non_reimbursable', false,
   'Room or cabin upgrades beyond the band entitlement, paid by choice (Policy §15 and §16).', 980)
on conflict (name) do nothing;


-- ===========================================================================
-- PREFERENCE LISTS — airline, hotel, bus operator.
--
-- These are the lists that GROW, and they are the reason the master-request
-- flow (20261005120500) exists: a salesperson in a hotel lobby should be able to
-- name the hotel they are standing in without waiting for an admin.
-- ===========================================================================
create table if not exists public.fms_travel_airlines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fms_travel_hotels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  city_id    uuid references public.fms_travel_cities on delete set null,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fms_travel_bus_operators (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fms_travel_airlines is 'Preferred airline on a flight request (PRD 8).';
comment on table public.fms_travel_hotels is 'Approved or previously used hotels, optionally tied to a city (Policy 7.1).';
comment on table public.fms_travel_bus_operators is 'Preferred bus operator on a bus request (PRD 8).';

do $mig$
declare t text;
begin
  foreach t in array array['fms_travel_airlines', 'fms_travel_hotels', 'fms_travel_bus_operators'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated '
      'using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())))', t);
  end loop;
end $mig$;

-- The carriers an Indian domestic traveller actually meets. Not policy — just a
-- starting list so the first request does not open an empty dropdown.
insert into public.fms_travel_airlines (name, sort_order) values
  ('IndiGo', 10), ('Air India', 20), ('Air India Express', 30), ('Akasa Air', 40),
  ('SpiceJet', 50), ('Vistara', 60), ('Alliance Air', 70), ('Star Air', 80)
on conflict (name) do nothing;


-- ===========================================================================
-- ASSERTIONS
-- ===========================================================================
do $mig$
declare
  v_public int;
  v_tables text[] := array[
    'fms_travel_cities', 'fms_travel_purposes', 'fms_travel_expense_categories',
    'fms_travel_airlines', 'fms_travel_hotels', 'fms_travel_bus_operators'
  ];
  t text;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public' and tablename = any(v_tables)
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'Travel Desk masters: % policy/policies scoped to {public}', v_public;
  end if;

  foreach t in array v_tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception 'Travel Desk masters: RLS is not enabled on %', t;
    end if;
  end loop;

  -- The eight Tier 1 cities §1.3 names, and Surat at Tier 2 (not Tier 1).
  if (select count(*) from public.fms_travel_cities where tier = 1) <> 8 then
    raise exception 'Travel Desk: expected exactly 8 Tier 1 cities, found %',
      (select count(*) from public.fms_travel_cities where tier = 1);
  end if;
  if (select tier from public.fms_travel_cities where name = 'Surat') <> 2 then
    raise exception 'Travel Desk: Surat must be Tier 2 - the head office is not a metro under this policy';
  end if;

  -- Others is the purpose that demands a reason.
  if not exists (
    select 1 from public.fms_travel_purposes where name = 'Others' and requires_remarks
  ) then
    raise exception 'Travel Desk: the Others purpose must require remarks';
  end if;

  -- Section 15 landed as refusing categories, not as a comment nobody reads.
  if (select count(*) from public.fms_travel_expense_categories where not reimbursable) < 9 then
    raise exception 'Travel Desk: the Section 15 non-reimbursable categories did not install';
  end if;
  if not exists (
    select 1 from public.fms_travel_expense_categories
     where name = 'Alcohol & Tobacco' and not reimbursable
  ) then
    raise exception 'Travel Desk: alcohol must be a category that refuses itself';
  end if;

  -- The phase-1 column is now constrained.
  if not exists (
    select 1 from pg_constraint where conname = 'fms_travel_employee_settings_base_city_fkey'
  ) then
    raise exception 'Travel Desk: base_city_id was not constrained to fms_travel_cities';
  end if;
end $mig$;

commit;
