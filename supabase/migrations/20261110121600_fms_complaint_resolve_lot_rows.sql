-- ===========================================================================
-- Complaint (RM/FG) FMS — RESOLVE LOT ROWS THAT CAME FROM CONNECTWAVE (13).
--
-- THE LOT NOW COMES FROM CONNECTWAVE, NOT FROM OUR OWN SYNCED INDEX.
--
-- ConnectWave gained `rpt_batch_line` on 07-09-2026 — 162,973 inventory lines
-- carrying the batch dimension the mirror never used to expose, of which 112,277
-- are real lots (`is_real_lot`). That is 3.5x the coverage of the index
-- tools/sync_tally_lot_index.py builds, and — the part that matters — 9,698
-- purchase lines against that script's 1,875, so the RAW-MATERIAL arm of this
-- module can finally answer a lookup at all.
--
-- ⚠ CONNECTWAVE KNOWS NAMES, NOT OUR IDS. It is a mirror of Tally, so a row
--   names a party, an item and a company as Tally spells them; it has never
--   heard of mst_parties.id. The form needs the ids — the Company picker, the
--   party FK and the ink category all key off them — so this function is the
--   bridge: hand it the rows the browser just read from ConnectWave, get back
--   the ids.
--
-- ⚠ WHY A FUNCTION AND NOT A CLIENT-SIDE JOIN. Resolving in the browser would
--   mean shipping 7,842 parties and 14,267 items to it to match against. It
--   would also fork the matching rules, and the rules are the whole difficulty
--   here — see below.
--
-- THE RULES ARE COPIED FROM fms_complaint_lot_index_resolve (20261110121300),
-- deliberately and verbatim in spirit, because they were each learned the hard
-- way:
--
--   1. COMPANY FIRST, by exact match on mst_companies.tally_name. Verified
--      07-09-2026: all five of our books match a ConnectWave v_company row
--      exactly. (ConnectWave also carries two prior-FY books we do not hold;
--      those resolve to null and the user picks the company, which is correct.)
--
--   2. PARTY AND ITEM ONLY *WITHIN* THAT BOOK, and only when unambiguous.
--      Masters are stored per company book, so one real customer is up to five
--      mst_parties rows and one real ink is four mst_items rows. Matching on
--      name alone left 8,058 of 31,852 rows unresolved; matching on name within
--      the book is the question that has one answer. Where a book still holds
--      two rows of one name (mst_parties has no unique constraint on name) the
--      id stays NULL and the user picks. A wrong customer id flows into a
--      credit note — refusing to guess is the point.
--
--   3. CATEGORY BY NAME ACROSS BOOKS, not via item_id. The same ink is four
--      rows, all agreeing, and resolving through a single book's id threw the
--      category away whenever that book's row was the ambiguous one. Where the
--      books disagree the category is null and the user types it.
--
-- ⚠ ORDINALITY IS THE CONTRACT. The caller matches results back to the rows it
--   sent BY POSITION, so this returns `idx` and the caller must not reorder.
--   Returning the names back would be ambiguous — the same party and item can
--   legitimately appear on two different vouchers in one result set.
--
-- Additive: one new read-only function. Nothing is dropped; the lot index, its
-- lookup RPC and the sync script all keep working and are simply no longer the
-- form's source.
--
-- Reversal: drop function if exists public.fms_complaint_resolve_lot_rows(jsonb);
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
      nullif(btrim(r.value->>'tally_company'), '')      as tally_company,
      nullif(btrim(r.value->>'party_name'), '')         as party_name,
      nullif(btrim(r.value->>'item_name'), '')          as item_name
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
      with ordinality r(value, ord)
  ),
  -- 1. The book.
  co as (
    select s.*, c.id as company_id
    from src s
    left join public.mst_companies c
      on lower(btrim(c.tally_name)) = lower(s.tally_company)
  ),
  -- 2a. One row per (book, name) — and ONLY where that name is unique in the
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
  'Resolve ConnectWave rpt_batch_line rows (which carry Tally NAMES) to our mst_companies / mst_parties / mst_items ids plus the ink category. Results come back in the order they were sent and are matched by idx. A null id is normal and means "ambiguous, let the user pick" — never a guess.';

grant execute on function public.fms_complaint_resolve_lot_rows(jsonb) to authenticated;

-- Self-assertion: the function exists, is callable, and refuses to invent an id
-- for a name it cannot pin down.
do $mig$
declare
  v_rows int;
begin
  select count(*) into v_rows
  from public.fms_complaint_resolve_lot_rows(
    '[{"tally_company":"__no such book__","party_name":"__nobody__","item_name":"__nothing__"}]'::jsonb);
  if v_rows <> 1 then
    raise exception 'fms_complaint_resolve_lot_rows returned % rows for 1 input row', v_rows;
  end if;
  perform 1 from public.fms_complaint_resolve_lot_rows(
    '[{"tally_company":"__no such book__","party_name":"__nobody__","item_name":"__nothing__"}]'::jsonb)
   where company_id is null and party_id is null and item_id is null;
  if not found then
    raise exception 'fms_complaint_resolve_lot_rows invented an id for an unknown name';
  end if;
end $mig$;

commit;
