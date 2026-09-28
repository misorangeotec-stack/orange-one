-- ============================================================================
-- R8 — expose the HSN code Tally already holds for every stock item.
-- Target project: ieeefdnyhzgrroifiqbb (ConnectWave / Tally mirror).
-- Apply via the Supabase SQL Editor (service role). Additive-only, read-only.
--
-- ⚠ NOT APPLIED. Written and left for the ConnectWave owner to run — it changes
--   a live view on the Tally mirror, which is not this repo's database.
--
-- WHY THIS EXISTS
--   OCPI prints an HSN code on the Performa Invoice and the Order Confirmation,
--   and 23 of 29 machines have none. The whole paper archive — every PDF, .docx,
--   .pptx and .xlsx across 2025.26 and 2026.27 — yields exactly TWO codes
--   (84433910 on five machines, 84433250 on the K24). There is nowhere else on
--   paper to look.
--
--   But TALLY HAS BEEN COLLECTING THEM ALL ALONG. The connector's StockItem
--   FETCH names HSNCODE explicitly (connector/internal/tally/entities.go:86), so
--   `public.tally_object.raw_payload -> 'HSNCODE'` is populated for every stock
--   item the mirror holds — 17,704 of them. Nothing reads it:
--
--     v_master_stock_item   guid, item, stock_group, base_unit      — no HSN
--     v_clevel_stock_item   + quantity/value columns                — no HSN
--     rpt_sales_register    party, particulars, qty, rate, revenue  — no HSN
--     rpt_stock_summary_item  38 columns of movement and valuation  — no HSN
--
--   The value is not missing from the data. It is simply not projected — the
--   same shape of gap `masters_views.sql` was written to close for `guid`.
--
-- WHAT THIS IS NOT
--   Not a change to Tally. Not a change to the connector. Not a change to the
--   Tally → Supabase push. Nothing is stored, computed or refreshed. This adds
--   one projected column to a view that is already being read.
--
-- ⚠ THE COLUMN IS ADDED AT THE END, and it has to be. `create or replace view`
--   in Postgres may APPEND columns but may not insert, reorder or retype them —
--   replacing with `hsn_code` anywhere but last fails outright. Appending is
--   also what keeps existing readers safe: `select *` gains a column it ignores,
--   and Orange One's masters-sync names its columns explicitly.
--
-- ⚠ `v_clevel_stock_item` IS LEFT ALONE, deliberately — the C-Level stock report
--   depends on its shape. Same rule `masters_views.sql` set.
--
-- 🔴 WHAT THIS DOES **NOT** SETTLE, and must be checked after applying:
--    1. WHETHER THE FIELD IS ACTUALLY FILLED. The connector fetches HSNCODE;
--       that does not prove the operator ever typed one. The verify block below
--       counts it. If it comes back near zero, R8 stays a client ask and this
--       view costs nothing.
--    2. WHICH TALLY ITEM IS WHICH OCPI MACHINE. Tally names them as sold —
--       `DIGITAL PRINTING MACHINE_FAB PRO 2i-01-16HD`, `MP5000`,
--       `POSITIONAL PRINTER FOR TEXTILE PRINTING` — and OCPI names them
--       `Fab Pro 2I`, `MP5000`, `Position Printer`. There is no id in common.
--       Any mapping is a judgement per machine and must be confirmed against a
--       real paper before a code is written onto an invoice.
--    3. WHICH COMPANY'S ANSWER GOVERNS. The mirror carries several tenants
--       (Orange O Tec Noida, Orange O Tec Enterprises, Colorix). The same item
--       may carry a different heading under each. Read `tenant_id` with the code.
--
-- Reuses the existing public.jtext(jsonb) helper (see clevel-mirror/objects.sql).
--
-- Reversal — restores the four-column shape exactly:
--   create or replace view public.v_master_stock_item as
--     select o.tenant_id, split_part(o.tenant_id,'::',2) as company_guid, o.guid,
--            o.name as item,
--            coalesce(nullif(public.jtext(o.raw_payload->'PARENT'),''),'(Ungrouped)') as stock_group,
--            public.jtext(o.raw_payload->'BASEUNITS') as base_unit
--       from public.tally_object o
--      where o.object_type='StockItem' and not o.is_deleted and o.name is not null;
--   ⚠ Dropping the column requires `drop view` first — replace cannot remove one.
-- ============================================================================

create or replace view public.v_master_stock_item as
  select o.tenant_id,
         split_part(o.tenant_id, '::', 2) as company_guid,
         o.guid,
         o.name as item,
         coalesce(nullif(public.jtext(o.raw_payload->'PARENT'), ''), '(Ungrouped)') as stock_group,
         public.jtext(o.raw_payload->'BASEUNITS') as base_unit,
         -- R8 · appended, never inserted — see the note above.
         -- Empty string is normalised to NULL: Tally writes '' for an item whose
         -- HSN was never typed, and '' would read as "answered, blank" downstream.
         nullif(btrim(public.jtext(o.raw_payload->'HSNCODE')), '') as hsn_code
  from public.tally_object o
  where o.object_type = 'StockItem'
    and not o.is_deleted
    and o.name is not null;

grant select on public.v_master_stock_item to anon;

comment on view public.v_master_stock_item is
  'Stock-item master for the Orange One central-masters sync. Identical to v_clevel_stock_item minus the quantity/value columns, PLUS the Tally guid the sync keys on and (R8) the HSN code Tally already holds. Read-only; owned by postgres so it bypasses RLS on tally_object.';


-- ---------------------------------------------------------------- verify --
--
-- 1 · Is the field filled at all? If `with_hsn` is 0, stop — Tally has nothing
--     to give and R8 remains a client ask.
--
--   select count(*) as items,
--          count(hsn_code) as with_hsn,
--          count(distinct hsn_code) as distinct_codes
--     from public.v_master_stock_item;
--
-- 2 · What headings does the machinery actually carry, and under which company?
--     8443 is the printing-machinery chapter; both codes we hold sit in it.
--
--   select hsn_code, count(*) as items,
--          string_agg(distinct split_part(tenant_id,'::',2), ', ') as companies,
--          (array_agg(item order by item))[1:3] as examples
--     from public.v_master_stock_item
--    where hsn_code like '8443%'
--    group by hsn_code
--    order by items desc;
--
-- 3 · The machines by name, to start the mapping in note 2 above.
--
--   select tenant_id, item, stock_group, hsn_code
--     from public.v_master_stock_item
--    where hsn_code is not null
--      and (item ilike '%printing machine%' or item ilike '%printer%'
--           or item ilike '%fab pro%' or item ilike '%homer%'
--           or item ilike '%alpha%'   or item ilike '%pengda%'
--           or item ilike '%mp5000%'  or item ilike '%lario%')
--    order by item;
-- ============================================================================
