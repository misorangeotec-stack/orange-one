-- ===========================================================================
-- COMPANY-SCOPED MASTERS — the three lists that let a sales order narrow down
--
-- Order to Dispatch is about to stop keeping its own billing company and
-- dispatch location and start reading the central ones. For that to be useful
-- rather than merely tidier, three questions need answers this database cannot
-- currently give:
--
--   1. which of our sites does this company dispatch from?
--   2. which of our companies may bill this customer?
--   3. which of our companies may sell this item?
--
-- ⚠ NONE OF THE THREE CAN BE READ OFF TALLY, and (3) is the one that decides
--   the shape of all of this. Tally keeps a SEPARATE stock item per company
--   book. Phase 1's reconcile linked each of the 234 Dispatch items to exactly
--   one of them, and 209 landed in the O-tec book against 21 in Enterprise —
--   yet the same physical product is sold by both firms. Measured on live data:
--   filtering the item picker on mst_items.company_id would offer 21 items on an
--   Enterprise order instead of ~230, and would invalidate 589 of that company's
--   619 existing order lines. mst_items.company_id records where Tally FILES the
--   item, which is not the same fact as who SELLS it.
--
--   The same holds, less violently, for customers: 71 of 303 existing orders
--   were billed by a company that is not the one on the customer's ledger.
--
-- So these are OUR lists. They are seeded (in supabase/phase2/01_cutover.sql)
-- from order history plus each row's own Tally book, which is what makes every
-- existing order valid by construction — the lists are built from those very
-- orders. Afterwards they are edited in Central Masters, and the Tally sync
-- never deletes from them: a mapping may be created here BEFORE any invoice
-- exists, and the sale reaches the register later.
--
-- Purely additive except for one relaxation, called out in full below.
--
-- Reversal: drop the three tables, restore the mst_master_managers CHECK to its
-- seven types, and re-add `alter table public.mst_locations alter column
-- company_id set not null` (safe only while every row still carries one).
-- ===========================================================================


-- ======================================== mst_locations becomes a flat list ==
--
-- ⚠ THE ONE NON-ADDITIVE CHANGE IN THIS MIGRATION, and the reason it is safe:
--   mst_locations holds ZERO rows and its only consumer is the admin Masters
--   tab. There is no data to put at risk.
--
-- It was built as one row per (company, site) because that is how Dispatch
-- stored it: three real sites — NOIDA, SURAT-HOJIWALA, SURAT-SACHIN — held
-- twice, once per company. Measured before changing it: all 14 step-owner
-- assignments carry IDENTICAL people for both companies at the same site, so
-- the company half of that key has never distinguished anything. Keeping it
-- would mean a fifth company adds three more rows to retype rather than three
-- ticks, and the user's instruction was explicit — the dispatch location is a
-- master of its own, with nothing to do with Tally, MAPPED to companies.
--
-- company_id is left in place rather than dropped (nothing is ever dropped
-- here) and simply stops being used. It is nullable so a site can exist
-- independently of any one company.
alter table public.mst_locations alter column company_id drop not null;

-- The old `unique (company_id, name)` cannot police a flat list: NULLs are
-- distinct in a unique index, so it would happily accept NOIDA three times.
create unique index if not exists mst_locations_global_name_uk
  on public.mst_locations (lower(name))
  where company_id is null;

comment on column public.mst_locations.company_id is
  'Legacy and unused. Which companies dispatch from a site is mst_company_locations, because a site is shared by several. Kept nullable rather than dropped; new rows leave it null.';


-- ==================================================== company <-> location ==

create table if not exists public.mst_company_locations (
  id          uuid primary key default gen_random_uuid(),
  -- RESTRICT on both sides: a pair that orders point through is history.
  company_id  uuid not null references public.mst_companies on delete restrict,
  location_id uuid not null references public.mst_locations on delete restrict,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  source      text not null default 'portal',
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, location_id)
);

comment on table public.mst_company_locations is
  'Which of our sites each company dispatches from. Replaces the company_id column that used to sit on each duplicated location row. Portal-owned; no Tally equivalent.';


-- ===================================================== party <-> company ====

create table if not exists public.mst_party_companies (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.mst_parties   on delete cascade,
  company_id uuid not null references public.mst_companies on delete restrict,
  active     boolean not null default true,
  sort_order integer not null default 0,
  -- 'portal'        added by a human here
  -- 'order_history' seeded from an order this company actually raised
  -- 'tally'         seeded from the ledger's own company book
  source     text not null default 'portal',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (party_id, company_id)
);

comment on table public.mst_party_companies is
  'Which of our companies may bill this party. NOT mst_parties.company_id, which is the Tally book the ledger is filed in - 71 of 303 existing orders were billed by the other company, so the two are different facts.';


-- ====================================================== item <-> company ====

create table if not exists public.mst_item_companies (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.mst_items     on delete cascade,
  company_id uuid not null references public.mst_companies on delete restrict,
  active     boolean not null default true,
  sort_order integer not null default 0,
  source     text not null default 'portal',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, company_id)
);

comment on table public.mst_item_companies is
  'Which of our companies may sell this item. Deliberately NOT mst_items.company_id: that is where Tally files the stock item, and 209 of 234 Dispatch items are filed under one book while both companies sell them.';


-- ==================================================== indexes & triggers ====

create index if not exists mst_company_locations_location_idx
  on public.mst_company_locations (location_id);
create index if not exists mst_party_companies_company_idx
  on public.mst_party_companies (company_id);
create index if not exists mst_item_companies_company_idx
  on public.mst_item_companies (company_id);

do $trg$
declare t text;
begin
  foreach t in array array['mst_company_locations','mst_party_companies','mst_item_companies']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $trg$;


-- ================================================================== RLS ====
--
-- Same shape as every other mst_* table (20260902120100): any signed-in user
-- may READ - the order form needs these lists and most of its users are not
-- admins - and only an admin or that master's manager may WRITE.

do $rls$
declare r record;
begin
  for r in
    select * from (values
      ('mst_company_locations', 'company_location'),
      ('mst_party_companies',   'party_company'),
      ('mst_item_companies',    'item_company')
    ) as t(tbl, master_type)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_select', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      r.tbl || '_select', r.tbl);

    execute format('drop policy if exists %I on public.%I', r.tbl || '_write', r.tbl);
    execute format($f$
      create policy %I on public.%I for all to authenticated
        using (
          (select public.is_admin((select auth.uid())))
          or (select public.mst_is_master_manager(%L, (select auth.uid())))
        )
        with check (
          (select public.is_admin((select auth.uid())))
          or (select public.mst_is_master_manager(%L, (select auth.uid())))
        )
    $f$, r.tbl || '_write', r.tbl, r.master_type, r.master_type);
  end loop;
end $rls$;


-- ============================================ the three new master types ====
--
-- Widening an allowed-value list, not narrowing one: every row already stored
-- satisfies the new CHECK. Asserted rather than assumed, because a failed
-- re-add would leave the table with no CHECK at all.

do $chk$
declare v_bad int;
begin
  select count(*) into v_bad
    from public.mst_master_managers
   where master_type not in (
     'company','party','item','item_group','unit','location','party_item',
     'company_location','party_company','item_company');
  if v_bad > 0 then
    raise exception 'mst_master_managers holds % row(s) outside the new type list', v_bad;
  end if;

  alter table public.mst_master_managers
    drop constraint if exists mst_master_managers_master_type_check;
  alter table public.mst_master_managers
    add constraint mst_master_managers_master_type_check check (master_type in (
      'company','party','item','item_group','unit','location','party_item',
      'company_location','party_company','item_company'));
end $chk$;
