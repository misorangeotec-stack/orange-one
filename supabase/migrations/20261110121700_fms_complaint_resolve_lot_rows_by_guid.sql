-- ===========================================================================
-- Complaint (RM/FG) FMS — MATCH THE BOOK ON ITS GUID, NOT ITS NAME (13a).
--
-- THE BUG: picking a shipment left the Company picker empty for most lots. Lot
-- 26071221, invoice INK/26-27/2403 to OMKARA DIGITAL PRINTS, resolved the party,
-- the item and the category — and no company.
--
-- THE CAUSE: 20261110121600 matched our books to ConnectWave by NAME, against
-- `mst_companies.tally_name`. That name is not stable. ConnectWave's `v_company`
-- returns SEVEN rows for FIVE companies, because a Tally company file that has
-- been renamed appears under both names against ONE guid:
--
--     ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2026-27)        39,235 batch lines
--     ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2024-26)        39,235 batch lines
--        ^ the same guid, the same book, counted twice under two names
--
--     ORANGE O TEC ENTERPRISES PRIVATE LIMITED-NOIDA -FY 26-27   7,656
--     ORANGE O TEC ENTERPRISES PRIVATE LIMITED-NOIDA - FY25-26   7,656
--        ^ likewise
--
-- `mst_companies.tally_name` holds ONE of each pair, so whichever name the
-- caller happened to carry decided whether the book resolved. That is a coin
-- toss dressed up as an exact match, and it is why a FY-renamed book — which is
-- the live, current book, with vouchers dated to 15-09-2026 — silently missed.
--
-- THE FIX: `mst_companies.tally_guid` is populated for all five books and equals
-- ConnectWave's `company_guid` exactly (verified 08-09-2026). A guid does not
-- change when the financial year rolls over and the file is renamed. Match on
-- it.
--
-- ⚠ THE NAME MATCH IS KEPT AS A FALLBACK, not deleted. It is correct whenever it
--   fires, and it is the only thing that can resolve a book whose tally_guid was
--   never recorded. Guid first, name second, null third — never a guess.
--
-- Additive: `create or replace`, and the return type is unchanged, so no drop is
-- needed. The p_rows contract GAINS an optional "company_guid" key; a caller
-- that sends only "tally_company" behaves exactly as before.
--
-- Reversal: re-apply 20261110121600.
-- ===========================================================================

begin;

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
      (r.ord)::int - 1                                  as idx,
      nullif(btrim(r.value->>'company_guid'), '')       as company_guid,
      nullif(btrim(r.value->>'tally_company'), '')      as tally_company,
      nullif(btrim(r.value->>'party_name'), '')         as party_name,
      nullif(btrim(r.value->>'item_name'), '')          as item_name
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
      with ordinality r(value, ord)
  ),
  -- 1. The book. GUID FIRST — stable across Tally's financial-year renames.
  --    The name is the fallback for a book whose guid we never recorded.
  co as (
    select
      s.*,
      coalesce(
        (select c.id from public.mst_companies c
          where s.company_guid is not null
            and c.tally_guid::text = s.company_guid
          limit 1),
        (select c.id from public.mst_companies c
          where s.tally_company is not null
            and lower(btrim(c.tally_name)) = lower(s.tally_company)
          limit 1)
      ) as company_id
    from src s
  ),
  -- 2a. One row per (book, name), and ONLY where that name is unique in the
  --     book. `having count(*) = 1` is what refuses to guess.
  party_book as (
    select company_id, lower(btrim(name)) as key, (array_agg(id))[1] as id
    from public.mst_parties
    where active and company_id is not null
    group by company_id, lower(btrim(name))
    having count(*) = 1
  ),
  item_book as (
    select company_id, lower(btrim(name)) as key, (array_agg(id))[1] as id
    from public.mst_items
    where active and company_id is not null
    group by company_id, lower(btrim(name))
    having count(*) = 1
  )
  select
    co.idx,
    co.company_id,
    p.id  as party_id,
    it.id as item_id,
    cat.category,
    cat.ink_type
  from co
  -- 2b. Scoped to the book, so the same customer name in another book cannot win.
  left join party_book p
    on p.company_id = co.company_id
   and p.key = lower(co.party_name)
  left join item_book it
    on it.company_id = co.company_id
   and it.key = lower(co.item_name)
  -- 3. Category across books: agreement, or nothing.
  left join lateral (
    select
      case when count(distinct i2.category) = 1 then min(i2.category) end as category,
      case when count(distinct i2.ink_type)  = 1 then min(i2.ink_type)  end as ink_type
    from public.mst_items i2
    where i2.active
      and i2.category is not null
      and lower(btrim(i2.name)) = lower(co.item_name)
  ) cat on true
  order by co.idx;
$$;

comment on function public.fms_complaint_resolve_lot_rows(jsonb) is
  'Resolve ConnectWave rpt_batch_line rows to our mst_companies / mst_parties / mst_items ids plus the ink category. The book is matched on company_guid (stable across Tally FY renames) and falls back to tally_name. Results come back in the order they were sent and are matched by idx. A null id means "ambiguous, let the user pick" — never a guess.';

grant execute on function public.fms_complaint_resolve_lot_rows(jsonb) to authenticated;

-- Self-assertion: the guid arm resolves the very book that failed before, and an
-- unknown guid still refuses to invent a company.
do $mig$
declare
  v_id uuid;
  v_expected uuid;
begin
  select id into v_expected from public.mst_companies
   where tally_guid::text = '59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e';
  if v_expected is null then
    raise notice 'Enterprises-Surat guid not present in mst_companies; guid arm unverified';
  else
    -- The name here is the FY2024-26 spelling, which is NOT in tally_name. Before
    -- this migration that resolved to null; the guid must now carry it.
    select company_id into v_id from public.fms_complaint_resolve_lot_rows(
      '[{"company_guid":"59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e",
         "tally_company":"ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2024-26)",
         "party_name":null,"item_name":null}]'::jsonb);
    if v_id is distinct from v_expected then
      raise exception 'guid arm did not resolve the book: got %, expected %', v_id, v_expected;
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
