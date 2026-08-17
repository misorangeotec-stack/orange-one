-- ============================================================================
-- CENTRAL MASTERS — the stock-item view the masters sync needs.
-- Target project: ieeefdnyhzgrroifiqbb (ConnectWave / Tally mirror).
-- Apply via the Supabase SQL Editor (service role). Additive-only, read-only.
--
-- WHY THIS EXISTS
--   Orange One's central masters match every Tally record on its GUID, never on
--   its name. That is what makes a rename in Tally safe: we update the existing
--   master instead of creating a duplicate beside it.
--
--   Ledgers already work — v_ledger_detail selects `guid`, so companies and
--   parties (customers + vendors) sync cleanly.
--
--   Stock items do not. The only stock-item view is v_clevel_stock_item, which
--   was built for the C-Level stock REPORT and therefore selects `o.name` but
--   never `o.guid` — a report has no need of an id. The GUID is not missing from
--   the data; public.tally_object has carried it all along. It is simply not
--   projected. Without it the masters sync would key items on their name, and
--   renaming an item in Tally would silently fork it into two masters.
--
--   So: a second, parallel view. v_clevel_stock_item is left exactly as it is —
--   the stock report depends on its shape, and this must not disturb it.
--
-- WHAT THIS IS NOT
--   Not a change to Tally. Not a change to the connector. Not a change to the
--   Tally -> Supabase push. Nothing is stored, computed or refreshed. This
--   projects one extra column off a table that is already being written.
--
-- Reuses the existing public.jtext(jsonb) helper (see clevel-mirror/objects.sql).
--
-- Reversal:
--   drop view if exists public.v_master_stock_item;
-- ============================================================================

create or replace view public.v_master_stock_item as
  select o.tenant_id,
         split_part(o.tenant_id, '::', 2) as company_guid,
         -- THE WHOLE POINT OF THIS VIEW. Everything else here already exists on
         -- v_clevel_stock_item; this column is why the file was written.
         o.guid,
         o.name as item,
         coalesce(nullif(public.jtext(o.raw_payload->'PARENT'), ''), '(Ungrouped)') as stock_group,
         public.jtext(o.raw_payload->'BASEUNITS') as base_unit
  from public.tally_object o
  where o.object_type = 'StockItem'
    and not o.is_deleted
    and o.name is not null;

grant select on public.v_master_stock_item to anon;

comment on view public.v_master_stock_item is
  'Stock-item master for the Orange One central-masters sync. Identical to v_clevel_stock_item minus the quantity/value columns, PLUS the Tally guid the sync keys on. Read-only; owned by postgres so it bypasses RLS on tally_object.';


-- ---------------------------------------------------------------- verify --
--
-- Run this after applying. Expect a row count > 0 and NO nulls in guid.
--
--   select count(*) as items,
--          count(guid) as with_guid,
--          count(distinct guid) as distinct_guids,
--          count(distinct stock_group) as groups,
--          count(distinct base_unit) as units
--     from public.v_master_stock_item;
--
-- with_guid and distinct_guids must both equal items. If distinct_guids is
-- lower, the mirror is holding the same item under one guid across several
-- tenants — tell Orange One before the first item sync, because the sync would
-- then need to key on (tenant_id, guid) rather than guid alone.
