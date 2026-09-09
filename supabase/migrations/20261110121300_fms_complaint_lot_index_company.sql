-- ===========================================================================
-- Complaint (RM/FG) FMS — RESOLVE THE COMPANY, AND SCOPE THE REST TO IT (10d).
--
-- TWO FAULTS, ONE CAUSE.
--
-- 1. THE COMPANY NEVER FILLED. `applyLotMatch` had nothing to set it from: the
--    lot index knew the TALLY company name and no migration ever mapped it to
--    `mst_companies`. So picking a shipment left the Company picker empty, and a
--    complaint could be filed against no book at all.
--
-- 2. THE PARTY AND ITEM MOSTLY DID NOT LINK — 8,058 of 31,852 rows. The resolver
--    matched on name alone and gave up whenever a name was ambiguous, which is
--    almost always: masters are stored PER COMPANY BOOK, so one real customer is
--    up to five `mst_parties` rows and one real ink is four `mst_items` rows.
--
-- The cause of both is the same: the index carried no company_id, so nothing
-- could be scoped. `mst_companies.tally_name` holds the Tally company name
-- VERBATIM for all five books (verified 05-09-2026), so the join is exact.
--
-- ⚠ SCOPING BY COMPANY IS WHAT MAKES THE FK SAFE, and is why the old guard was
--   not simply loosened. "This name is ambiguous, so refuse" and "this name is
--   ambiguous, so guess" are both wrong; "this name within THIS BOOK" is the
--   question that actually has one answer. Where a book still yields two rows of
--   one name — mst_parties has no unique constraint on name — the id stays null
--   and the user picks. A wrong customer id flows into a credit note.
--
-- Additive: one new column, a re-issued resolver, a re-issued lookup.
--
-- Reversal:
--   alter table public.fms_complaint_lot_index drop column if exists company_id;
--   -- then re-apply the resolver + lookup from 20261110121100 / 20261110121200.
-- ===========================================================================

begin;

alter table public.fms_complaint_lot_index
  add column if not exists company_id uuid references public.mst_companies on delete set null;

comment on column public.fms_complaint_lot_index.company_id is
  'Which of OUR books this voucher is in, resolved from tally_company via mst_companies.tally_name. Scopes the party and item resolution, and fills the Company picker when a shipment is chosen.';

create index if not exists fms_complaint_lot_index_company_id_idx
  on public.fms_complaint_lot_index (company_id);


-- ---------------------------------------------------------------------------
-- The resolver, re-issued: company first, then party and item WITHIN it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_complaint_lot_index_resolve(p_company text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_co      int;
  v_parties int;
  v_items   int;
begin
  -- 1. The book. Exact match on the name Tally itself reports.
  update public.fms_complaint_lot_index i
     set company_id = c.id
    from public.mst_companies c
   where i.company_id is null
     and (p_company is null or i.tally_company = p_company)
     and lower(btrim(c.tally_name)) = lower(btrim(i.tally_company));
  get diagnostics v_co = row_count;

  -- 2. The party, WITHIN that book. Still unambiguous-only: mst_parties has no
  --    unique constraint on name, so a book holding two rows of one name leaves
  --    the id null rather than picking one.
  update public.fms_complaint_lot_index i
     set party_id = p.id
    from (
      select company_id, lower(btrim(name)) as key, (array_agg(id))[1] as id
        from public.mst_parties
       where active and company_id is not null
       group by company_id, lower(btrim(name))
      having count(*) = 1
    ) p
   where i.party_id is null
     and (p_company is null or i.tally_company = p_company)
     and i.company_id is not null
     and i.party_name is not null
     and p.company_id = i.company_id
     and p.key = lower(btrim(i.party_name));
  get diagnostics v_parties = row_count;

  -- 3. The item, likewise.
  update public.fms_complaint_lot_index i
     set item_id = it.id
    from (
      select company_id, lower(btrim(name)) as key, (array_agg(id))[1] as id
        from public.mst_items
       where active and company_id is not null
       group by company_id, lower(btrim(name))
      having count(*) = 1
    ) it
   where i.item_id is null
     and (p_company is null or i.tally_company = p_company)
     and i.company_id is not null
     and i.item_name is not null
     and it.company_id = i.company_id
     and it.key = lower(btrim(i.item_name));
  get diagnostics v_items = row_count;

  return format('companies=%s parties=%s items=%s', v_co, v_parties, v_items);
end $$;

comment on function public.fms_complaint_lot_index_resolve() is
  'Fill company_id from mst_companies.tally_name, then party_id and item_id by exact unambiguous name WITHIN that company. Best-effort and re-runnable: a null id is normal and the form falls back to the frozen name.';
revoke all on function public.fms_complaint_lot_index_resolve(text) from public;
grant execute on function public.fms_complaint_lot_index_resolve(text) to service_role;

-- The no-arg form the extractor already calls, kept so its call site is unchanged.
create or replace function public.fms_complaint_lot_index_resolve()
returns text language sql security definer set search_path = public as
$$ select public.fms_complaint_lot_index_resolve(null::text); $$;
revoke all on function public.fms_complaint_lot_index_resolve() from public;
grant execute on function public.fms_complaint_lot_index_resolve() to service_role;


-- ---------------------------------------------------------------------------
-- The lookup, re-issued to hand the company back to the form.
-- ---------------------------------------------------------------------------
-- ⚠ DROP FIRST. `create or replace` cannot change a function's return type
--   (42P13) — this one gains tally_company and company_id, so the OUT row type
--   differs. Dropping inside the transaction means the old signature is never
--   visible as missing to a concurrent caller.
drop function if exists public.fms_complaint_lot_lookup(text, text);

create function public.fms_complaint_lot_lookup(p_lot text, p_direction text default null)
returns table (
  direction     text,
  voucher_no    text,
  voucher_date  date,
  voucher_type  text,
  tally_company text,
  company_id    uuid,
  party_name    text,
  party_id      uuid,
  item_name     text,
  item_id       uuid,
  category      text,
  ink_type      text,
  batch_name    text,
  godown        text,
  qty           text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.direction,
    i.voucher_no,
    i.voucher_date,
    i.voucher_type,
    i.tally_company,
    i.company_id,
    i.party_name,
    i.party_id,
    i.item_name,
    i.item_id,
    cat.category,
    cat.ink_type,
    i.batch_name,
    i.godown,
    i.qty
  from public.fms_complaint_lot_index i
  -- Category by NAME across books, not by item_id: the same ink is four rows,
  -- all agreeing. Disagreement yields null and the user types it. (10c)
  left join lateral (
    select
      case when count(distinct it.category) = 1 then min(it.category) end as category,
      case when count(distinct it.ink_type) = 1 then min(it.ink_type) end as ink_type
    from public.mst_items it
    where it.active
      and it.category is not null
      and lower(btrim(it.name)) = lower(btrim(i.item_name))
  ) cat on true
  where i.lot_key = btrim(coalesce(p_lot, ''))
    and (p_direction is null or i.direction = p_direction)
  order by i.voucher_date desc nulls last, i.voucher_no
  limit 100;
$$;

comment on function public.fms_complaint_lot_lookup(text, text) is
  'Every shipment a LOT was on, newest first, with the company, party, item and ink category resolved. Returns a LIST — a lot number is not a unique key.';
grant execute on function public.fms_complaint_lot_lookup(text, text) to authenticated;


-- ⚠ NO BACKFILL HERE, DELIBERATELY. Resolving all 31,852 index rows against
--   14,267 items in one statement exceeds the API statement timeout (57014) and
--   rolls the whole migration back. The resolver therefore takes an optional
--   company scope and is run one book at a time, right after this lands. The
--   extractor calls the no-arg form, which is fine on an incremental sync.

commit;
