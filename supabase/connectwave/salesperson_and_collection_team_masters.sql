-- Salesperson and Collection Team MASTERS — the two vocabularies the Outstanding Dashboard
-- maps customers to (RC-15).
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. The repo's `supabase/migrations/` + `supabase db push`
--    target the identity project — run this one in the ConnectWave project's SQL editor.
--    Deploy this BEFORE the muster-write Edge Function that validates against it, and before the
--    frontend that reads it. Purely ADDITIVE: it creates two new tables and touches nothing else.
--
-- WHY THESE EXIST (2026-09-09)
--   `ext_ledger_tags.salesperson` and `ext_ledger_group.collection_team` are free text typed into a
--   box whose suggestions are drawn from whatever was typed last. Matching is exact and
--   case-sensitive everywhere (see the frontend's lib/scopeParties.ts), so a typo is not a cosmetic
--   problem — it is a scope that silently matches nothing. Two such tags are live on real users
--   today: 'MAYANK' (which exists only in a database that no longer exists) and 'Others' where the
--   muster holds 'OTHERS'. Neither shows as wrong on any screen. A fixed list makes both
--   unrepresentable.
--
-- SHAPE — copied from public.sale_type, this project's existing user-editable vocabulary master:
--   is_active rather than a delete, audit columns, and a flag for the catch-all value.
--   No tenant_id, for the same reason receivables_followups.sql gives: single tenant today.
--
-- ⚠️ THE NAME IS THE PRIMARY KEY, NOT A SURROGATE ID.
--   What is stored on a ledger, on profiles.receivables_salespersons in the identity project, and on
--   report_email_recipients.salesperson IS the string. A surrogate id would imply a join that cannot
--   exist across two Supabase projects, and would turn a rename into an invisible label change
--   instead of the explicit cascade muster-write performs.
--
-- ⚠️ NO FOREIGN KEY FROM ext_ledger_tags / ext_ledger_group. DELIBERATE.
--   collection_refresh() runs on cron in this project and auto-enrolls every brand-new debtor ledger
--   at the literal salesperson 'OTHERS'; connector/tools/seed_ext_tables.py upserts from Google
--   Sheets. A rejected insert in either would abort the nightly refresh — a receivables outage, in a
--   pipeline this repo does not own. Validation therefore lives in the muster-write Edge Function,
--   which is the only door the app writes through. Values that reach the columns by any other route
--   are surfaced on the Masters screen as "in use but not in the master" rather than blocked here.
--
-- Reversal: salesperson_and_collection_team_masters_rollback.sql. Rehearse it BEFORE muster-write is
-- redeployed — once the function validates against these tables, dropping them breaks every save on
-- the Masters screen, and the rehearsal stops being a rehearsal.

-- updated_at maintenance. Already defined on this project by receivables_followups.sql; repeated
-- with create-or-replace so this file can be applied on its own.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── 1. Salesperson ───────────────────────────────────────────────────────────
create table if not exists public.ext_salesperson_master (
  name         text primary key,

  -- Switched off, never deleted. Inactive means NOT OFFERED FOR NEW MAPPINGS; every customer
  -- already carrying the name keeps reading it, on every screen and in every report.
  is_active    boolean     not null default true,

  -- Locked: may be neither renamed nor switched off. 'OTHERS' only — collection_refresh() writes
  -- that exact string on every sync, so a muster without it makes every new customer invalid.
  is_protected boolean     not null default false,

  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text,

  constraint ext_salesperson_master_name_clean
    check (name = btrim(name) and name <> ''),
  constraint ext_salesperson_master_protected_stays_active
    check (is_active or not is_protected)
);

comment on table public.ext_salesperson_master is
  'The salesperson vocabulary for the Outstanding Dashboard: the permitted values of ext_ledger_tags.salesperson, ext_redmark.salesperson and profiles.receivables_salespersons (identity project). Keyed by the name itself, because the name is what those columns store. Entries are switched off (is_active=false), never deleted. Written only by the identity-project muster-write Edge Function; read anon.';

-- ⚠️ The whole point of RC-15, applied to the master itself: without this the master could hold
-- 'OTHERS' and 'Others' at once and offer both in the same picker, which is precisely the live bug
-- this table exists to remove. It stops the LIST holding two spellings. It does NOT normalise
-- matching anywhere — comparisons stay exact and case-sensitive.
create unique index if not exists ext_salesperson_master_name_ci
  on public.ext_salesperson_master (upper(name));

create index if not exists ext_salesperson_master_active_idx
  on public.ext_salesperson_master (is_active);

drop trigger if exists trg_ext_salesperson_master_updated on public.ext_salesperson_master;
create trigger trg_ext_salesperson_master_updated
  before update on public.ext_salesperson_master
  for each row execute function public.set_updated_at();

-- ── 2. Collection team ───────────────────────────────────────────────────────
create table if not exists public.ext_collection_team_master (
  name         text primary key,
  is_active    boolean     not null default true,
  is_protected boolean     not null default false,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   text,

  constraint ext_collection_team_master_name_clean
    check (name = btrim(name) and name <> ''),
  constraint ext_collection_team_master_protected_stays_active
    check (is_active or not is_protected)
);

comment on table public.ext_collection_team_master is
  'The collection-team vocabulary for the Outstanding Dashboard: the permitted values of ext_ledger_group.collection_team. Same shape and rules as ext_salesperson_master. Nothing is protected here — unlike salesperson, no sync writes a literal team name.';

create unique index if not exists ext_collection_team_master_name_ci
  on public.ext_collection_team_master (upper(name));

create index if not exists ext_collection_team_master_active_idx
  on public.ext_collection_team_master (is_active);

drop trigger if exists trg_ext_collection_team_master_updated on public.ext_collection_team_master;
create trigger trg_ext_collection_team_master_updated
  before update on public.ext_collection_team_master
  for each row execute function public.set_updated_at();

-- ── 3. RLS — the house pattern for every ext_* table on this project ─────────
-- Anon/authenticated may READ; nobody but service_role may write. Orange One admins authenticate
-- against a DIFFERENT project, so their JWT means nothing here — the muster-write Edge Function is
-- the guarded write door. RLS is default-deny, so the permissive SELECT policy is REQUIRED or anon
-- reads 0 rows and every picker comes up empty.
do $$
declare t text;
begin
  foreach t in array array['ext_salesperson_master', 'ext_collection_team_master'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read', t);
  end loop;
end $$;

-- ── 4. Seed ──────────────────────────────────────────────────────────────────
-- Salesperson: the 13 distinct values live on ext_ledger_tags as measured 09-09-2026 across 1,875
-- ledger rows — no case clashes, nothing untrimmed, plus 37 NULL. The ledger counts are recorded in
-- `note` so a later reader can tell whether this list still reflects the data.
--
-- ⚠️ 'RELATED PARTY' is not a person and belongs on the list anyway — 24 ledgers carry it.
-- ⚠️ 'OTHERS' carries 682 ledgers and is the value every sync mints. It is seeded protected.
--
-- on conflict do nothing: re-running this file is a no-op and never overwrites a hand edit.
insert into public.ext_salesperson_master (name, is_protected, note) values
  ('OTHERS',        true,  'Catch-all. Written literally by collection_refresh() on every sync, so it can be neither renamed nor switched off. 682 ledgers at seed.'),
  ('NAKUL JI',      false, '319 ledgers at seed'),
  ('MANMOHAN JI',   false, '307 ledgers at seed'),
  ('UMESH JI',      false, '132 ledgers at seed'),
  ('KHURSHID JI',   false, '116 ledgers at seed'),
  ('KARAN SIR',     false, '75 ledgers at seed'),
  ('AAYUSH SIR',    false, '62 ledgers at seed'),
  ('DHANANJAY',     false, '42 ledgers at seed'),
  ('PURAV SHAH',    false, '40 ledgers at seed'),
  ('SUHEL',         false, '27 ledgers at seed'),
  ('RELATED PARTY', false, 'Not a person. 24 ledgers at seed.'),
  ('ABHISHEK',      false, '9 ledgers at seed'),
  ('HARI OM',       false, '3 ledgers at seed')
on conflict (name) do nothing;

-- Collection team: the four teams from Jayshree's UPDATED MASTER SHEET, each spelled ONCE.
-- ⚠️ The column is entirely unpopulated on live data — 1,631 empty strings and 244 NULLs across
--    1,875 ledgers — so this list is right from its first row and there is nothing to migrate.
--    Seeding 'Vijay' with this capitalisation is also what disposes of the Vijay/vijay split waiting
--    in that sheet, before RC-11 loads 722 rows against it.
insert into public.ext_collection_team_master (name, is_protected, note) values
  ('Mohta ji', false, '228 rows in the source sheet'),
  ('Jayshree', false, '224 rows in the source sheet'),
  ('Nitesh',   false, '156 rows in the source sheet'),
  ('Vijay',    false, '114 rows in the source sheet, stored there as Vijay (102) and vijay (12)')
on conflict (name) do nothing;

-- ── 5. Verify the apply landed (read these back before moving on) ────────────
--   select name, is_active, is_protected from public.ext_salesperson_master order by name;    -- 13
--   select name, is_active, is_protected from public.ext_collection_team_master order by name; --  4
--   select count(*) from public.ext_ledger_tags;   -- must still be 1875
--   select count(*) from public.ext_ledger_group;  -- must still be 1875
