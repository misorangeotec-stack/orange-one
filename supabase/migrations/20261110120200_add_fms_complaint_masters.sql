-- ===========================================================================
-- Complaint (RM/FG) FMS — MASTERS (Phase 3).
--
-- EXACTLY TWO, and the restraint is the point.
--
--   fms_complaint_natures     — WHAT went wrong (shade variation, clogging,
--                               leaking pouch, short quantity)
--   fms_complaint_root_causes — WHY it went wrong, plus the band the Dashboard
--                               Paretos on
--
-- ⚠ THE CUSTOMER, THE VENDOR, THE ITEM AND THE INK CATEGORY ARE NOT HERE, AND
--   MUST NEVER BE ADDED.
--     party    -> public.mst_parties (7,842 rows; customers AND vendors in one
--                 table, because in Tally both are a ledger)
--     item     -> public.mst_items (14,267 rows)
--     category -> public.mst_items.category — "Category of Ink", 96 values,
--                 filled on 13,220 items, hand-maintained from the Inventory
--                 Mapping sheet. NOT the Tally stock group: only 858 of 13k
--                 rows agree with their own group, and just 40 of the 96 names
--                 are group names at all. Do not "simplify" it to group_id.
--     company  -> public.mst_companies      unit -> public.mst_units
--
--   fms_dispatch_customers is the cautionary tale: a customer saved into a
--   per-module copy was invisible everywhere else, and that module now renders
--   an explainer page where its master screen used to be. This is also the
--   answered half of OD-2 in WORKLIST.md — "remove them… they come from Tally
--   only".
--
-- ⚠ SEVERITY, RESOLUTION TYPE AND COMPLAINT TYPE ARE NOT MASTERS EITHER. They
--   are CHECK'd vocabularies on the complaint row (phase 5), because each value
--   BRANCHES CODE — the resolution reference field re-labels itself per type,
--   and a master would let someone add a fifth resolution the UI cannot render
--   and the RPC cannot act on.
--
-- Write access is ADMIN-ONLY here and widened to the master's assigned owner in
-- phase 4, once fms_complaint_is_master_manager exists. Splitting it that way
-- keeps this migration free of a forward reference.
--
-- Additive. Reversal:
--   drop table if exists public.fms_complaint_root_causes, public.fms_complaint_natures;
-- ===========================================================================

begin;

-- ===========================================================================
-- fms_complaint_natures — the vocabulary of WHAT went wrong.
-- ===========================================================================
create table if not exists public.fms_complaint_natures (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.fms_complaint_natures is
  'What went wrong, in the words the quality team uses. Module-owned: nothing central holds this vocabulary.';

-- Case-insensitive uniqueness on the ACTIVE rows only. A retired name may be
-- re-used later, and deactivating is how a value retires — rows are never
-- deleted, so existing references stay resolvable.
create unique index if not exists fms_complaint_natures_name_key
  on public.fms_complaint_natures (lower(name)) where active;

drop trigger if exists trg_fms_complaint_natures_updated on public.fms_complaint_natures;
create trigger trg_fms_complaint_natures_updated
  before update on public.fms_complaint_natures
  for each row execute function public.set_updated_at();

alter table public.fms_complaint_natures enable row level security;

-- Readable by everyone signed in: it is dropdown fodder on the raise form.
drop policy if exists fms_complaint_natures_select on public.fms_complaint_natures;
create policy fms_complaint_natures_select on public.fms_complaint_natures
  for select to authenticated using (true);

drop policy if exists fms_complaint_natures_write on public.fms_complaint_natures;
create policy fms_complaint_natures_write on public.fms_complaint_natures
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- fms_complaint_root_causes — WHY it went wrong.
--
-- `cause_group` is what makes the Dashboard's Pareto readable: forty individual
-- causes tell nobody anything, six bands tell you where to look. A CHECK'd
-- vocabulary rather than a master of its own, for the usual reason — the
-- Dashboard renders one card per band, so a seventh band would render nowhere.
-- ===========================================================================
create table if not exists public.fms_complaint_root_causes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cause_group text not null check (cause_group in (
                'material', 'process', 'handling', 'storage', 'transport', 'party_side')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.fms_complaint_root_causes is
  'Why a complaint happened. cause_group bands the causes so the Dashboard can Pareto them; party_side is the band for "not ours".';

create unique index if not exists fms_complaint_root_causes_name_key
  on public.fms_complaint_root_causes (lower(name)) where active;

drop trigger if exists trg_fms_complaint_root_causes_updated on public.fms_complaint_root_causes;
create trigger trg_fms_complaint_root_causes_updated
  before update on public.fms_complaint_root_causes
  for each row execute function public.set_updated_at();

alter table public.fms_complaint_root_causes enable row level security;

drop policy if exists fms_complaint_root_causes_select on public.fms_complaint_root_causes;
create policy fms_complaint_root_causes_select on public.fms_complaint_root_causes
  for select to authenticated using (true);

drop policy if exists fms_complaint_root_causes_write on public.fms_complaint_root_causes;
create policy fms_complaint_root_causes_write on public.fms_complaint_root_causes
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));


-- ===========================================================================
-- SEED — a starting vocabulary so the raise form is usable on day one.
--
-- Deliberately SHORT and generic. These are ink and packaging failures anyone in
-- the trade would recognise; the quality team will add their own words, and
-- anything here that turns out to be wrong gets deactivated rather than deleted.
-- ===========================================================================
insert into public.fms_complaint_natures (name, sort_order) values
  ('Shade variation',        10),
  ('Clogging / nozzle drop', 20),
  ('Viscosity out of spec',  30),
  ('Sedimentation',          40),
  ('Leaking pouch / can',    50),
  ('Packaging damage',       60),
  ('Short quantity',         70),
  ('Wrong item supplied',    80),
  ('Contamination',          90)
on conflict do nothing;

insert into public.fms_complaint_root_causes (name, cause_group, sort_order) values
  ('Raw material off-spec',            'material',   10),
  ('Wrong batch used in production',   'material',   20),
  ('Process parameter deviation',      'process',    30),
  ('Filtration missed or incomplete',  'process',    40),
  ('Mishandling at packing',           'handling',   50),
  ('Wrong item picked',                'handling',   60),
  ('Stored above temperature',         'storage',    70),
  ('Shelf life exceeded',              'storage',    80),
  ('Damaged in transit',               'transport',  90),
  ('Customer storage / handling',      'party_side', 100),
  ('Customer machine settings',        'party_side', 110)
on conflict do nothing;


do $mig$
begin
  if not exists (select 1 from public.fms_complaint_natures) then
    raise exception 'Complaint: the nature seed did not install';
  end if;
  if not exists (select 1 from public.fms_complaint_root_causes) then
    raise exception 'Complaint: the root-cause seed did not install';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('fms_complaint_natures', 'fms_complaint_root_causes')
       and roles::text like '%public%'
  ) then
    raise exception 'Complaint: a master policy is scoped to {public}';
  end if;
end $mig$;

commit;
