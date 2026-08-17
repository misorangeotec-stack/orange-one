-- ===========================================================================
-- CENTRAL MASTERS — an item group belongs to a company too.
--
-- WHY
--   20260902120000 made mst_item_groups name-keyed and global, because the sync
--   walks the items and reads each one's group as a bare string. That was a
--   shortcut, and the data says so: 420 global group rows are really 565
--   (company, group) pairs, and 103 group names are used by MORE THAN ONE
--   company. So "PAPER ROLL" is currently one row standing for what are, in
--   Tally, several companies' separate stock groups.
--
--   Merged like that the Item Groups tab cannot answer whose group a row is, and
--   filtering items by group crosses companies. Items and parties are already
--   per-company; groups are the odd one out.
--
-- ⚠ UNITS ARE DELIBERATELY LEFT GLOBAL. KGS, MTR and PCS are the same unit in
--   every company — there are 13 of them and splitting them per company would
--   produce five copies of each for no gain. A unit is a measure; a stock group
--   is an organising choice a company makes.
--
-- WHAT THIS DOES
--   1. Adds company_id.
--   2. Replaces UNIQUE (name) with uniqueness per company — the old constraint
--      is exactly what forced the merge.
--   3. Claims each existing row for the company whose items use it most, so no
--      row is orphaned and existing group_ids stay valid for that company.
--   4. Creates the missing (company, name) rows.
--   5. REPOINTS mst_items.group_id at the row for the item's OWN company.
--
--   Step 5 rewrites group_id on items — safe, because mst_items is nine hours
--   old, nothing outside the Masters screen reads it yet, and no FMS has been
--   cut over. It would NOT be safe after Phase 1.
--
-- Reversal:
--   alter table public.mst_item_groups drop column if exists company_id;
--   drop index if exists public.mst_item_groups_company_name_key;
--   alter table public.mst_item_groups add constraint mst_item_groups_name_key unique (name);
--   (the split rows would then have to be de-duplicated by hand)
-- ===========================================================================

alter table public.mst_item_groups
  add column if not exists company_id uuid references public.mst_companies on delete set null;

comment on column public.mst_item_groups.company_id is
  'Which company this stock group belongs to. Tally-owned, derived from the items in it. 103 group NAMES are shared across companies, which is why the group list is per-company and not global.';

-- The constraint that forced the merge in the first place.
alter table public.mst_item_groups drop constraint if exists mst_item_groups_name_key;

-- ⚠ coalesce, not a bare (company_id, name): Postgres treats NULLs as distinct,
--   so a plain unique would let two company-less rows share a name.
create unique index if not exists mst_item_groups_company_name_key
  on public.mst_item_groups (coalesce(company_id::text, ''), lower(name));

-- 3. Claim each existing row for the company that uses it most. Ties break on
--    company id so a re-run cannot pick a different winner.
with pick as (
  select g.id as group_id,
         (select i.company_id
            from public.mst_items i
           where i.group_id = g.id and i.company_id is not null
           group by i.company_id
           order by count(*) desc, i.company_id
           limit 1) as company_id
    from public.mst_item_groups g
   where g.company_id is null
)
update public.mst_item_groups g
   set company_id = p.company_id
  from pick p
 where p.group_id = g.id and p.company_id is not null;

-- 4. Every (company, group name) an item actually uses must exist as a row.
insert into public.mst_item_groups (name, company_id, source, tally_synced_at)
select distinct g.name, i.company_id, 'tally', now()
  from public.mst_items i
  join public.mst_item_groups g on g.id = i.group_id
 where i.company_id is not null
on conflict do nothing;

-- 5. Point every item at its OWN company's group row.
update public.mst_items i
   set group_id = g2.id
  from public.mst_item_groups g1,
       public.mst_item_groups g2
 where g1.id = i.group_id
   and i.company_id is not null
   and g2.company_id = i.company_id
   and lower(g2.name) = lower(g1.name)
   and g2.id <> i.group_id;


-- ============================================================== asserts ====

do $check$
declare
  v_crossed bigint;
  v_orphan  bigint;
  v_groups  bigint;
begin
  -- The whole point: no item may sit in another company's group.
  select count(*) into v_crossed
    from public.mst_items i
    join public.mst_item_groups g on g.id = i.group_id
   where i.company_id is not null
     and g.company_id is not null
     and g.company_id <> i.company_id;
  if v_crossed > 0 then
    raise exception 'group company: % item(s) still point at another company''s group', v_crossed;
  end if;

  -- Nothing may have lost its group in the repoint.
  select count(*) into v_orphan
    from public.mst_items i
   where i.group_id is not null
     and not exists (select 1 from public.mst_item_groups g where g.id = i.group_id);
  if v_orphan > 0 then
    raise exception 'group company: % item(s) point at a group that no longer exists', v_orphan;
  end if;

  select count(*) into v_groups from public.mst_item_groups;
  raise notice 'group company: % group rows after the split', v_groups;
end $check$;
