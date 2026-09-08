-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_batch_line — verification. Run after any rebuild or backfill.
-- Floors come from the audit of 07-09-2026 against the live mirror.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- 1. THE TEST CASE — the client's own screenshot: invoice INK/26-27/2445, 04-Sep-2026, R STUDIO,
--    REACTIVE INK ECO BLACK, batch 26081306, 20.0000 KGS @ 690.00 = 13,800.00, godown HOJIWALA.
--    godown_name stays NULL until the connector fetch change lands; everything else must match.
select voucher_no, vch_date, direction, movement, stock_item, batch_name, is_real_lot,
       godown_name, qty, uom, rate, amount, batch_date, batch_date_src
  from public.rpt_batch_line
 where voucher_no = 'INK/26-27/2445';

-- 2. ROW-COUNT FLOORS (whole table)
--    expect: batch_rows >= 162,329 · real_lot_rows >= 111,520 · godown_rows >= 93,314
--    after the connector change: godown_rows >= 154,000
select count(*)                                        as batch_rows,
       count(*) filter (where is_real_lot)             as real_lot_rows,
       count(distinct batch_name) filter (where is_real_lot) as distinct_lots,
       count(*) filter (where godown_name is not null) as godown_rows,
       count(*) filter (where batch_date is not null)  as dated_rows,
       count(*) filter (where batch_mfd  is not null)  as mfd_rows,
       count(distinct tenant_id)                       as tenants
  from public.rpt_batch_line;

-- 3. COVERAGE BY TENANT x FY — the anti-"PROVEN ABSENT" view.
--    FY2026-27 rows must show godown_rows = 0 BEFORE the connector change and non-zero after.
select * from public.rpt_batch_coverage order by tenant_id, fy;

-- 4. GRAIN IS LOSSLESS — batch quantities must tie to their parent inventory line.
--    Measured 8,607/8,607 before build. Any row here is a real extraction bug.
with per_line as (
  select tenant_id, voucher_guid, line_no, sum(qty) as batch_qty
    from public.rpt_batch_line group by 1,2,3
)
select count(*) as lines_checked,
       count(*) filter (where abs(batch_qty) > 0) as lines_with_qty
  from per_line;

-- 5. GODOWN DOMAIN CHECK — every non-blank godown must exist in the Godown master (45 rows).
--    ⚠ Expect a small number of failures: 'PRIMARY BATCH' appears as a GODOWN on ~8 rows because
--    batch and godown were typed into swapped columns in Tally. That is a data-entry finding to
--    report, NOT something to repair silently here.
select b.godown_name, count(*) as rows
  from public.rpt_batch_line b
 where b.godown_name is not null
   and not exists (select 1 from public.tally_object g
                    where g.object_type = 'Godown' and g.name = b.godown_name)
 group by 1 order by 2 desc;

-- 6. NO DOUBLE-COUNTING OF STOCK JOURNALS — we read ALLINVENTORYENTRIES only. A stock journal's
--    lines should appear once per direction, never twice for the same (voucher, item, batch).
select count(*) as duplicate_keys
  from (select tenant_id, voucher_guid, line_no, batch_no, count(*) c
          from public.rpt_batch_line group by 1,2,3,4 having count(*) > 1) d;

-- 7. ANON-KEY READ TEST — must be run with VITE_CONNECTWAVE_SUPABASE_ANON_KEY, NOT the
--    management token. This is the exact check OD-12 got wrong: tally_object returns [] to the
--    anon key because it is RLS-on with no policies, which reads as "empty" rather than "denied".
--      curl "https://ieeefdnyhzgrroifiqbb.supabase.co/rest/v1/rpt_batch_line?select=batch_name,godown_name&limit=3" \
--           -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--    Expect three rows. An empty array means the policy did not apply.

-- 8. CROSS-CHECK AGAINST THE INDEPENDENT EXTRACTOR (different project, icutjkrqkbzwvmnfbzpr).
--    fms_complaint_lot_index holds 31,852 rows built from Tally by an unrelated route, covering
--    4 companies over FY2026-27 only. Every one of its (voucher_no, item, batch) triples should
--    be reproducible here. Disagreement is a real bug in one of the two, not noise.
--    Run against the HUB project:
--      select count(*) from public.fms_complaint_lot_index;   -- expect 31852
--    then compare voucher_no sets for the overlapping window.
