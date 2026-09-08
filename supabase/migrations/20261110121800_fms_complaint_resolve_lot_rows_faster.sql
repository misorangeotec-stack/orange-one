-- ===========================================================================
-- Complaint (RM/FG) FMS — MAKE THE LOT RESOLVER FAST ENOUGH TO TYPE AT (13b).
--
-- MEASURED on the live database, 08-09-2026:
--
--       1 row      0.4s
--      10 rows     0.9s
--      50 rows     2.5s
--     100 rows     5.0s      <- what the form actually sends, worst case
--     200 rows     TIMEOUT   (57014)
--
-- Five seconds is not a lookup, it is a wait — and the form's own cap of 100
-- rows sat a factor of two from the statement timeout. One busy lot, or a
-- master table that keeps growing, and a working feature starts failing with a
-- 500 that reads to the user as "no such lot".
--
-- THE HOT SPOT was the category `left join lateral`: it re-scanned all 14,267
-- rows of mst_items ONCE PER INPUT ROW, evaluating lower(btrim(name)) each time
-- — 1.4 million comparisons for one lookup. The party and item books had the
-- same shape of waste, aggregating every master row when only the handful of
-- names actually present in the input can possibly match.
--
-- THE FIX, in two parts and no change of behaviour:
--
--   1. Collect the DISTINCT names the caller asked about first, then join the
--      masters to that small set ONCE. Each master table is now read a fixed
--      number of times instead of once per row.
--
--   2. Two functional indexes on lower(btrim(name)), which is the expression
--      every one of these joins matches on. Both are additive and tiny
--      (7,842 and 14,267 rows); nothing else about the central masters changes.
--
-- ⚠ THE MATCHING RULES ARE UNCHANGED, deliberately: company by guid then name,
--   party and item only within the book and only when unambiguous, category by
--   agreement across books. `having count(*) = 1` still counts every row in the
--   (book, name) group — joining to a DISTINCT name list cannot duplicate a
--   group member, so the ambiguity guard means exactly what it did before.
--
-- Reversal: re-apply 20261110121700, and
--   drop index if exists public.mst_parties_lower_name_idx;
--   drop index if exists public.mst_items_lower_name_idx;
-- ===========================================================================

begin;

-- lower() and btrim() are immutable, so these are legal as functional indexes.
create index if not exists mst_parties_lower_name_idx
  on public.mst_parties (lower(btrim(name)));
create index if not exists mst_items_lower_name_idx
  on public.mst_items (lower(btrim(name)));

create or replace function public.fms_complaint_resolve_lot_rows(p_rows jsonb)
returns table (
  idx        int,
  company_id uuid,
  party_id   uuid,
  item_id    uuid,
  category   text,
  ink_type   text
)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select
      (r.ord)::int - 1                                          as idx,
      nullif(btrim(r.value->>'company_guid'), '')                as company_guid,
      nullif(btrim(r.value->>'tally_company'), '')               as tally_company,
      lower(nullif(btrim(r.value->>'party_name'), ''))           as party_key,
      lower(nullif(btrim(r.value->>'item_name'), ''))            as item_key
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
      with ordinality r(value, ord)
  ),
  -- 1. The book. GUID FIRST — stable across Tally's financial-year renames;
  --    the name is the fallback for a book whose guid we never recorded.
  co as (
    select s.*, coalesce(g.id, nm.id) as company_id
    from src s
    left join lateral (
      select c.id from public.mst_companies c
       where s.company_guid is not null and c.tally_guid::text = s.company_guid
       limit 1
    ) g on true
    left join lateral (
      select c.id from public.mst_companies c
       where s.tally_company is not null
         and lower(btrim(c.tally_name)) = lower(s.tally_company)
       limit 1
    ) nm on true
  ),
  -- THE POINT OF THIS MIGRATION: the masters are joined to these small distinct
  -- sets once, instead of being re-scanned for every input row.
  want_party as (select distinct party_key as key from src where party_key is not null),
  want_item  as (select distinct item_key  as key from src where item_key  is not null),
  -- 2. Party and item WITHIN the book, and only where the name is unique there.
  party_book as (
    select p.company_id, lower(btrim(p.name)) as key, (array_agg(p.id))[1] as id
    from public.mst_parties p
    join want_party w on w.key = lower(btrim(p.name))
    where p.active and p.company_id is not null
    group by p.company_id, lower(btrim(p.name))
    having count(*) = 1
  ),
  item_book as (
    select i.company_id, lower(btrim(i.name)) as key, (array_agg(i.id))[1] as id
    from public.mst_items i
    join want_item w on w.key = lower(btrim(i.name))
    where i.active and i.company_id is not null
    group by i.company_id, lower(btrim(i.name))
    having count(*) = 1
  ),
  -- 3. Category across books: agreement, or nothing.
  cat as (
    select
      w.key,
      case when count(distinct i.category) = 1 then min(i.category) end as category,
      case when count(distinct i.ink_type)  = 1 then min(i.ink_type)  end as ink_type
    from want_item w
    join public.mst_items i on lower(btrim(i.name)) = w.key
    where i.active and i.category is not null
    group by w.key
  )
  select
    co.idx,
    co.company_id,
    p.id  as party_id,
    it.id as item_id,
    c.category,
    c.ink_type
  from co
  left join party_book p on p.company_id = co.company_id and p.key = co.party_key
  left join item_book  it on it.company_id = co.company_id and it.key = co.item_key
  left join cat        c  on c.key = co.item_key
  order by co.idx;
$$;

comment on function public.fms_complaint_resolve_lot_rows(jsonb) is
  'Resolve ConnectWave rpt_batch_line rows to our mst_companies / mst_parties / mst_items ids plus the ink category. The book is matched on company_guid (stable across Tally FY renames) and falls back to tally_name. Results come back in the order they were sent and are matched by idx. A null id means "ambiguous, let the user pick" — never a guess.';

grant execute on function public.fms_complaint_resolve_lot_rows(jsonb) to authenticated;

-- Self-assertion: the guid arm still resolves the book that 13a fixed, and an
-- unknown guid still refuses to invent one. Behaviour must not have moved.
do $mig$
declare
  v_id uuid;
  v_expected uuid;
begin
  select id into v_expected from public.mst_companies
   where tally_guid::text = '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e';
  if v_expected is not null then
    select company_id into v_id from public.fms_complaint_resolve_lot_rows(
      '[{"company_guid":"59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e",
         "tally_company":"ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2024-26)",
         "party_name":null,"item_name":null}]'::jsonb);
    if v_id is distinct from v_expected then
      raise exception 'guid arm regressed: got %, expected %', v_id, v_expected;
    end if;
  end if;

  select company_id into v_id from public.fms_complaint_resolve_lot_rows(
    '[{"company_guid":"00000000-0000-0000-0000-000000000000",
       "tally_company":"__no such book__","party_name":null,"item_name":null}]'::jsonb);
  if v_id is not null then
    raise exception 'resolver invented a company for an unknown guid';
  end if;
end $mig$;

commit;

-- Fresh statistics for the new expression indexes, so the planner uses them on
-- the very first lookup rather than after autovacuum gets round to it.
analyze public.mst_parties;
analyze public.mst_items;
