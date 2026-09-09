-- ===========================================================================
-- Complaint (RM/FG) FMS — THE LOT INDEX (Phase 10).
--
-- One row per (voucher line × batch allocation) pulled out of Tally, so the
-- raise form can answer "which shipment was this LOT on?" in milliseconds.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A TABLE AND NOT A LIVE TALLY CALL. Measured 05-09-2026 against the live
-- books, not assumed:
--
--   whole FY 26-27, full inventory + batch   82.2s   90 MB
--   whole FY 26-27, batch fields only        55.7s   88 MB
--
-- and Tally offers no server-side filter on batch name — two attempts to build
-- one (TDL $$FilterCount and $$FullList CONTAINS) HUNG THE LIVE INSTANCE, one
-- read-timing-out after 900s and the other resetting the connection.
--
-- So a per-lookup call would be a 56-second, 88 MB request, parsed in a browser,
-- and only ever on a machine running Tally. The Vercel deployment could never do
-- it at all: Tally is on-premise and the app is in the cloud.
--
-- Extracting once into this table costs the same 56 seconds ONCE, and every
-- lookup afterwards is an indexed Supabase query that works everywhere.
-- ─────────────────────────────────────────────────────────────────────────
--
-- ⚠ THIS TABLE IS A CACHE, NOT A RECORD. Tally owns every value in it. The
--   extractor (tools/sync_tally_lot_index.py) is free to delete and re-insert a
--   company's rows wholesale, so NOTHING may reference these rows by id and no
--   complaint may FK to them. A complaint copies the facts it needs onto its own
--   row at submit — which is the same freezing rule item_name and party_name
--   already follow.
--
-- ⚠ lot_key IS THE LOOKUP COLUMN, not batch_name. Tally stores lots as bare
--   digits ("26081377") or with internal reference numbers glued on
--   ("#1637-26071173", "#952 #953-2602582") — 11,425 of 19,651 values in
--   Enterprises carry a `#` prefix. lot_key is the trailing digit run, and it is
--   computed by the SAME rule as normaliseLot() in lib/resolveLot.ts. If the two
--   ever disagree, a lot typed by hand silently finds nothing, which looks like
--   "no such lot" rather than "we disagree about spelling".
--
-- ⚠ PLACEHOLDERS ARE NOT INDEXED. Tally returns 'Primary Batch' or 'Any' where an
--   item has no batch tracking; the extractor drops those. That is why purchase
--   coverage is thin (868 of 1,060 lines in Enterprises are placeholders) and why
--   the RM arm of the form still expects typing.
--
-- Additive. Reversal:
--   drop function if exists public.fms_complaint_lot_lookup(text, text);
--   drop table if exists public.fms_complaint_lot_index;
-- ===========================================================================

begin;

create table if not exists public.fms_complaint_lot_index (
  id            uuid primary key default gen_random_uuid(),
  -- Tally's own company name, exactly as the gateway reports it. Not an FK to
  -- mst_companies: the extractor works from what Tally has open, and a company
  -- it cannot map must still be indexable.
  tally_company text not null,
  -- 'sales' = we shipped it (FG side). 'purchase' = we received it (RM side).
  direction     text not null check (direction in ('sales', 'purchase', 'other')),
  voucher_no    text not null,
  voucher_date  date,
  voucher_type  text,
  party_name    text,
  item_name     text,
  -- The batch string exactly as Tally holds it — shown beside the clean lot so a
  -- reader can see what was actually recorded.
  batch_name    text not null,
  -- The trailing digit run. THE LOOKUP KEY. See the header.
  lot_key       text not null,
  godown        text,
  qty           text,
  -- Resolved against the central masters where the names match, so a picked
  -- candidate can fill the FKs too. Null is normal and never blocks anything.
  party_id      uuid references public.mst_parties on delete set null,
  item_id       uuid references public.mst_items   on delete set null,
  synced_at     timestamptz not null default now()
);

comment on table public.fms_complaint_lot_index is
  'Batch/LOT allocations extracted from Tally so the Complaint form can resolve a LOT to the shipments it was on. A CACHE — Tally owns every value, the extractor replaces rows wholesale, and nothing may reference them by id.';

-- The one query this table exists to serve.
create index if not exists fms_complaint_lot_index_key_idx
  on public.fms_complaint_lot_index (lot_key, direction);
-- Prefix search, for a partially-remembered lot number.
create index if not exists fms_complaint_lot_index_key_prefix_idx
  on public.fms_complaint_lot_index (lot_key text_pattern_ops);
-- Lets the extractor clear one company without scanning the table.
create index if not exists fms_complaint_lot_index_company_idx
  on public.fms_complaint_lot_index (tally_company);

-- Natural key. Re-running the extractor must UPDATE rather than duplicate, and a
-- lot can legitimately appear twice on one voucher for the same item from two
-- godowns — so the godown is part of the key.
create unique index if not exists fms_complaint_lot_index_natural_key
  on public.fms_complaint_lot_index
     (tally_company, voucher_no, item_name, batch_name, coalesce(godown, ''));

alter table public.fms_complaint_lot_index enable row level security;

-- Readable by anyone who may raise a complaint — it is lookup fodder, and it
-- holds nothing a signed-in user could not see on the invoice itself.
drop policy if exists fms_complaint_lot_index_select on public.fms_complaint_lot_index;
create policy fms_complaint_lot_index_select on public.fms_complaint_lot_index
  for select to authenticated using (true);

-- No write policy: the extractor runs on the service key, which bypasses RLS.
-- Nobody types into this table.


-- ===========================================================================
-- THE LOOKUP.
--
-- Returns EVERY line the lot was on, newest first — never one row. 92% of lots
-- in Enterprises FY26-27 appear on more than one line, because a drum is bought
-- once and sold from repeatedly; lot 300930426 was purchased from Universal Dye
-- Chem and then sold to three different customers. Picking "the" match would be
-- a coin toss, so the form shows the list and the user chooses.
--
-- `p_direction` narrows to the side the complaint is about: a finished-good
-- complaint wants the SALES lines (who we shipped it to), a raw-material one
-- wants the PURCHASE lines (who we bought it from).
-- ===========================================================================
create or replace function public.fms_complaint_lot_lookup(p_lot text, p_direction text default null)
returns table (
  direction    text,
  voucher_no   text,
  voucher_date date,
  voucher_type text,
  party_name   text,
  party_id     uuid,
  item_name    text,
  item_id      uuid,
  category     text,
  ink_type     text,
  batch_name   text,
  godown       text,
  qty          text
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
    i.party_name,
    i.party_id,
    i.item_name,
    i.item_id,
    -- ⚠ CATEGORY OF INK IS JOINED, NOT STORED. The lot index is a cache of Tally,
    --   and Tally does not hold this: `mst_items.category` is a PORTAL-owned
    --   column, 96 values hand-maintained from the Inventory Mapping sheet and
    --   filled on 13,220 items. Joining it here rather than copying it into the
    --   index means correcting an item's category once fixes every future lookup,
    --   instead of waiting for the next sync to overwrite a stale copy.
    --
    -- ⚠ NOT mst_items.group_id, however much "category" sounds like a stock group:
    --   only 858 of 13k rows agree with their own group, and just 40 of the 96
    --   category names are group names at all.
    it.category,
    it.ink_type,
    i.batch_name,
    i.godown,
    i.qty
  from public.fms_complaint_lot_index i
  -- LEFT join: an item Tally names but the central master has not matched still
  -- yields a usable candidate — the party and the invoice are the point.
  left join public.mst_items it on it.id = i.item_id
  where i.lot_key = btrim(coalesce(p_lot, ''))
    and (p_direction is null or i.direction = p_direction)
  order by i.voucher_date desc nulls last, i.voucher_no
  limit 100;   -- a lot on 581 lines is real; nobody picks from 581 rows
$$;

comment on function public.fms_complaint_lot_lookup(text, text) is
  'Every shipment a LOT was on, newest first, optionally narrowed to sales or purchase, with the ink category joined live from mst_items. Returns a LIST — a lot number is not a unique key.';
grant execute on function public.fms_complaint_lot_lookup(text, text) to authenticated;


-- ===========================================================================
-- MASTER RESOLUTION — fill party_id / item_id from the names Tally gave us.
--
-- Called by the extractor after each run. BEST-EFFORT AND RE-RUNNABLE: a null id
-- is normal and never blocks a lookup, because the form falls back to the frozen
-- name, which is what a complaint stores anyway.
--
-- ⚠ EXACT, CASE-INSENSITIVE NAME MATCH ONLY. No fuzzy matching, deliberately: a
--   near-match here would put the WRONG customer id on a complaint, and from
--   there into a credit note. `mst_parties` has no unique constraint on name
--   (one row per Tally book), so the match is additionally required to be
--   UNAMBIGUOUS — where a name resolves to several parties, the id is left null
--   and the user picks.
-- ===========================================================================
create or replace function public.fms_complaint_lot_index_resolve()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parties int;
  v_items   int;
begin
  update public.fms_complaint_lot_index i
     set party_id = p.id
    from (
      select lower(btrim(name)) as key, min(id) as id
        from public.mst_parties
       where active
       group by lower(btrim(name))
      having count(*) = 1          -- unambiguous only; see the header
    ) p
   where i.party_id is null
     and i.party_name is not null
     and lower(btrim(i.party_name)) = p.key;
  get diagnostics v_parties = row_count;

  update public.fms_complaint_lot_index i
     set item_id = it.id
    from (
      select lower(btrim(name)) as key, min(id) as id
        from public.mst_items
       where active
       group by lower(btrim(name))
      having count(*) = 1
    ) it
   where i.item_id is null
     and i.item_name is not null
     and lower(btrim(i.item_name)) = it.key;
  get diagnostics v_items = row_count;

  return format('parties=%s items=%s', v_parties, v_items);
end $$;

comment on function public.fms_complaint_lot_index_resolve() is
  'Fill party_id / item_id on the lot index by exact, unambiguous, case-insensitive name match. Best-effort: a null id is normal and the form falls back to the name.';
revoke all on function public.fms_complaint_lot_index_resolve() from public;
grant execute on function public.fms_complaint_lot_index_resolve() to service_role;


do $mig$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'fms_complaint_lot_index' and c.relrowsecurity
  ) then
    raise exception 'Complaint: RLS is not enabled on fms_complaint_lot_index';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_complaint_lot_index'
       and roles::text like '%public%'
  ) then
    raise exception 'Complaint: the lot index policy is scoped to {public}';
  end if;
end $mig$;

commit;
