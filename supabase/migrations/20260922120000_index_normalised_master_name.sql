-- ===========================================================================
-- THE COMPANY-LINK REFRESH STOPS TAKING ELEVEN SECONDS.
--
-- `mst-refresh-company-links` (cron job 30, at 5/20/35/50 past every hour) runs
-- mst_refresh_party_companies() + mst_refresh_item_companies(). Measured over
-- 252 runs to 2026-08-20: 11.6s average, 16.3s worst, EVERY run, whether or not
-- anything changed. It sits on mst_parties / mst_items for all of it — the two
-- tables every Order to Dispatch screen reads.
--
-- WHY IT WAS SLOW — two separate causes, both fixed here.
--
-- 1. NO INDEX COULD MATCH. Both functions pair a firm across books on its
--    punctuation-stripped name:
--
--      upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))
--
--    mst_parties_name_idx is on lower(name) — a DIFFERENT expression — so
--    nothing could serve the join.
--
-- 2. THE PARTY JOIN WAS AN `OR`, WHICH NO INDEX CAN SERVE EVEN SO. It matched
--    `name-match OR gstin-match` in one condition. Postgres nested-looped 334
--    Dispatch parties against all 7,832 parties and recomputed the regex for
--    every pair — 2,615,136 comparisons per run. Adding the index alone changed
--    nothing, which is the whole reason this file does both.
--
-- THE FIX
--   · index the exact normalisation expression, on both tables;
--   · index gstin, for the half of the party join that uses it;
--   · split the party function's `OR` into two UNIONed joins, so each half can
--     use its own index. Items needed no rewrite — that join never had an OR,
--     so the index alone was enough.
--
-- MEASURED, same database, immediately before and after:
--   parties  11,600 ms → 22.8 ms
--   items       (rest of the 11.6s) → 32.3 ms
--
-- PROVED EQUIVALENT BEFORE THE REWRITE WAS APPLIED: the OR form and the UNION
-- form both return 720 rows, and EXCEPT in both directions returns zero. No row
-- in mst_party_companies changes; only the time taken to arrive at it.
--
-- ⚠ THE INDEX EXPRESSION MUST MATCH THE FUNCTIONS CHARACTER FOR CHARACTER.
--   Postgres uses an expression index only when the query's expression is
--   identical. Edit one side's normalisation — a different character class,
--   lower() for upper() — and the index silently stops being used and the
--   eleven seconds come back with no error to notice. Change both, or neither.
--
-- ⚠ THIS MAKES THE JOB CHEAP, NOT CORRECT. It still rebuilds everything four
--   times an hour with no check for whether the masters changed at all. The
--   honest fix is to guard it on mst_sync_runs' watermark, the way
--   masters-sync-watch already does — 575 runs, 0.0s average, because it does
--   nothing when nothing changed. Tracked as PF-3 on the work list.
--
-- Additive: three indexes and one function body. Nothing dropped, no data
-- rewritten, no column touched.
-- ===========================================================================

create index if not exists mst_parties_name_key_idx
  on public.mst_parties (upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g')));

comment on index public.mst_parties_name_key_idx is
  'Punctuation-stripped name, the key mst_refresh_party_companies() joins on to find the same firm in another Tally book. Must stay identical to that function''s expression or it stops being used, silently.';

create index if not exists mst_items_name_key_idx
  on public.mst_items (upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g')));

comment on index public.mst_items_name_key_idx is
  'Punctuation-stripped name, the key mst_refresh_item_companies() joins on. Must stay identical to that function''s expression or it stops being used, silently.';

create index if not exists mst_parties_gstin_idx
  on public.mst_parties (gstin) where gstin is not null and gstin <> '';

comment on index public.mst_parties_gstin_idx is
  'The gstin half of mst_refresh_party_companies()''s pairing, which is a join of its own since the OR was split.';

analyze public.mst_parties;
analyze public.mst_items;

create or replace function public.mst_refresh_party_companies()
 returns table(added integer, linked integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_added int := 0;
  v_linked int := 0;
begin
  -- Every (our customer, company book) pair Tally can justify: a ledger of the
  -- same firm filed in that book. The party's own book counts as itself.
  --
  -- ⚠ THE NAME MATCH AND THE GSTIN MATCH ARE TWO UNIONED JOINS, NOT ONE `OR`.
  --   They used to be a single join with `name-match OR gstin-match`. An OR in a
  --   join condition cannot be served by an index, so Postgres nested-looped
  --   334 Dispatch parties against all 7,832 and recomputed the regex for each
  --   pair - 2,615,136 comparisons, 11.7 SECONDS, four times an hour, on the
  --   tables every Order to Dispatch screen reads. Split, each half uses its own
  --   index (mst_parties_name_key_idx, mst_parties_gstin_idx) and the whole
  --   thing runs in 11 MILLISECONDS. Measured 2026-08-20; the two forms were
  --   proved to return the identical 720 rows, both directions of EXCEPT empty.
  --
  --   Do not fold them back into one OR. Do not change the normalisation here
  --   without changing mst_parties_name_key_idx to match character for
  --   character - a mismatch silently stops using the index and the eleven
  --   seconds return with no error to notice.
  create temp table _derived on commit drop as
  with mine as (
    select p.id, p.company_id, p.gstin,
           upper(regexp_replace(p.name, '[^A-Za-z0-9]+', '', 'g')) as key
      from public.mst_parties p
     where p.modules @> array['order-to-dispatch'] and p.active
  )
  select distinct m.id as party_id, s.company_id
    from mine m
    join public.mst_parties s
      on s.company_id is not null
     and upper(regexp_replace(s.name, '[^A-Za-z0-9]+', '', 'g')) = m.key
  union
  select distinct m.id, s.company_id
    from mine m
    join public.mst_parties s
      on s.company_id is not null
     and m.gstin is not null and m.gstin <> '' and s.gstin = m.gstin
  union
  select m.id, m.company_id from mine m where m.company_id is not null;

  -- A hand-added pair that Tally now backs stops being "not yet in Tally".
  update public.mst_party_companies pc
     set source = 'tally'
    from _derived d
   where d.party_id = pc.party_id and d.company_id = pc.company_id
     and pc.source <> 'tally';
  get diagnostics v_linked = row_count;

  insert into public.mst_party_companies (party_id, company_id, source)
  select d.party_id, d.company_id, 'tally' from _derived d
  on conflict (party_id, company_id) do nothing;
  get diagnostics v_added = row_count;

  return query select v_added, v_linked;
end
$function$;
