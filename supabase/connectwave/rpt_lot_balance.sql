-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_lot_balance — remaining quantity per (company, item, lot), for the Order Desk LOT picker.
--
-- WHY: at Check Material Status the LOT is typed by hand into a free-text box (ShipLinesGrid,
-- placeholder "as marked on the stock"), so it can be mistyped or invented and nothing checks it
-- against Tally. OD-12 asks for it to come live from Tally. This is what the picker reads: the
-- lots that actually exist for an item, and how much of each is left.
--
-- ─── TWO CORRECTIONS THAT ARE NOT OPTIONAL ────────────────────────────────────────────────────
-- A naive sum(in) - sum(out) puts 16% of lots at a NEGATIVE balance. Measured 07-09-2026:
--
--   1. TALLY SHIPS THE SAME GOODS TWICE ON PAPER.  A delivery challan moves the stock and tags
--      the line with its own number; the sales invoice raised against it carries the CHALLAN's
--      number in TRACKINGNUMBER. Both rows are real, both say "out", and the goods left once.
--      Worked example, 29-May-2025, item SUBLIMATION PAPER(29GSM*48IN*1000M), lot CONT-7:
--        OTPL/167/25-26  DELIVERY CHALLAN-PAPER  out 20,000  tracking = OTPL/167/25-26  (itself)
--        PAPER/176/25-26 GST SALES- PAPER        out 20,000  tracking = OTPL/167/25-26  (the challan)
--      So: count a tracked movement ONCE, on the document that originated it — the row whose
--      voucher_no equals its own tracking_number. Untracked rows always count.
--      This alone takes negatives from 16.0% to 8.6%.
--
--   2. A LOT CAN START WITH STOCK.  Tally holds an opening balance PER BATCH on the StockItem
--      master (BATCHALLOCATIONS.LIST -> OPENINGBALANCE), and an opening is not a voucher, so no
--      movement represents it. Lots alive at a book's start therefore look over-shipped.
--      Adding it takes negatives from 8.6% to 3.6%.
--
-- The residual is inter-company movement, manual adjustment and partially-invoiced challans. Those
-- lots are simply never offered by the picker, which lists only balance > 0.
--
-- ⚠ THE RESIDUAL IS ~11%, NOT THE 3.6% FIRST RECORDED HERE. Re-measured across all 9,593 lots on
--   08-09-2026: 11.4%. The old figure was taken on a narrower set and does not reproduce. It is
--   quoted honestly here because the number gets repeated into commit messages and status notes,
--   and an over-flattering one invites somebody to trust a balance further than it deserves. The
--   corrections above are still worth having — they are what takes a naive walk from 16% to 11% —
--   but the picker's balance remains ADVISORY, never a physical count.
--
-- ─── TWO MORE, FOUND 08-09-2026 AGAINST A CLIENT SCREENSHOT ────────────────────────────────────
-- The client sent Tally's own "List of Active Batches" for REACTIVE INK E-SERIES CYAN beside our
-- picker. Three balances were wrong, one lot appeared twice, and ELEVEN lots were missing. Two
-- further defects, both now fixed here and both verified to reproduce Tally exactly:
--
--   3. A COMPANY SPLIT INTO TWO BOOKS COUNTED EVERY MOVEMENT TWICE.
--      Two of the five companies exist as BOTH a live tenant and a `~FY` archive tenant
--      (`acct_orange::779c26f4-…` and `…~20250401`), and the archive carries the SAME current-year
--      vouchers under the SAME voucher_guid. company_guid deliberately strips the tenant suffix so
--      the two books read as one company — which is right — but that made every purchase add to
--      itself. Lot 25092701341: INK/N/26-27/197 (+20) and INK/N/26-27/260 (+20) each appear in
--      both books, so in=80 rather than 40; against out=40 the lot read 40 KGS left where Tally
--      said 0.000.
--      FIX: one row per (voucher_guid, line_no, batch_no), preferring the live book.
--      ⚠ Openings had the same disease and needed a DIFFERENT fix — both books carry a StockItem
--        master for the same item with the same per-batch OPENINGBALANCE, and those were being
--        SUMMED. They are deduped by tenant, not added.
--
--   4. A LOT THAT HAD ONLY EVER COME IN WAS INVISIBLE.
--      sum(qty) filter (where movement='in') - sum(qty) filter (where movement='out') is NULL when
--      a lot has no outward movement, because X - NULL = NULL; and `NULL >= p_min` is NULL, not
--      true, so the row was silently dropped. This hit the single most important case in the whole
--      feature — a lot RECEIVED BUT NEVER YET SHIPPED, which is exactly the stock a store keeper
--      is trying to dispatch. On this one item it hid 11 lots, including a 600 KGS receipt.
--      FIX: coalesce(...,0) on both halves. Never subtract two filtered sums directly.
--
-- ⚠ ADVISORY, NOT AUTHORITATIVE. This is Tally's paper trail, not a physical count. The picker
--   shows the number so a store keeper can sanity-check it against what is in front of them, and
--   must still allow a lot to be typed in — a lot physically present but absent here must never
--   block a real dispatch.
--
-- ⚠ DO NOT REUSE THIS PATTERN FOR GODOWN-WISE STOCK. It works for lots because lot numbering
--   began FY2025-26 and we hold every movement from 2020, so a lot's history is complete. Godowns
--   are different: 69% of items carry no godown breakup at all, and the item-level walk already
--   fails to tie to Tally on 8% of items in the largest book.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create or replace view public.rpt_lot_balance as
with dedup as (
  -- Correction 1 (tracking) and correction 3 (two books, one company) — one row per PHYSICAL
  -- movement, before anything is summed.
  select distinct on (l.voucher_guid, l.line_no, l.batch_no)
         l.company_guid, l.stock_item, l.batch_name, l.movement, l.qty, l.uom,
         l.vch_date, l.batch_date, l.godown_name
    from public.rpt_batch_line l
   where l.is_real_lot
     and l.affects_stock
     and (l.tracking_number is null or l.voucher_no = l.tracking_number)
   order by l.voucher_guid, l.line_no, l.batch_no,
            (l.tenant_id like '%~%')       -- false sorts first => the live book beats the archive
),
mv as (
  -- Correction 4: coalesce BEFORE the subtraction, or an only-inwards lot vanishes.
  select company_guid, stock_item, batch_name,
         max(uom)                                              as uom,
         coalesce(sum(qty) filter (where movement = 'in'),  0)  as qty_in,
         coalesce(sum(qty) filter (where movement = 'out'), 0)  as qty_out,
         max(vch_date)                                         as last_movement,
         max(batch_date)                                       as batch_date,
         (array_agg(godown_name order by vch_date desc)
            filter (where godown_name is not null))[1]         as last_godown
    from dedup group by 1,2,3
),
-- Correction 2, with correction 3 applied: the per-batch opening off the StockItem master, taken
-- from ONE book. `~FY` archive books share a company_guid with their live book, which is why the
-- tenant suffix is stripped — and why the openings must be deduped rather than summed.
op as (
  select distinct on (t.company_guid, t.stock_item, t.batch_name)
         t.company_guid, t.stock_item, t.batch_name, t.opening
    from (
      select split_part(split_part(o.tenant_id,'::',2),'~',1) as company_guid,
             o.name                                           as stock_item,
             public.jtext(b->'BATCHNAME')                     as batch_name,
             (o.tenant_id like '%~%')                         as is_archive,
             sum(public.amt(split_part(public.jtext(b->'OPENINGBALANCE'), ' ', 1))) as opening
        from public.tally_object o
        cross join lateral jsonb_array_elements(
          case jsonb_typeof(o.raw_payload->'BATCHALLOCATIONS.LIST')
            when 'array'  then o.raw_payload->'BATCHALLOCATIONS.LIST'
            when 'object' then jsonb_build_array(o.raw_payload->'BATCHALLOCATIONS.LIST')
            else '[]'::jsonb end) as ba(b)
       where o.object_type = 'StockItem'
         and jsonb_typeof(b) = 'object'
       group by 1,2,3,4
    ) t
   order by t.company_guid, t.stock_item, t.batch_name, t.is_archive
)
select mv.company_guid, mv.stock_item, mv.batch_name, mv.uom,
       coalesce(op.opening, 0)                          as opening,
       mv.qty_in,
       mv.qty_out,
       coalesce(op.opening, 0) + mv.qty_in - mv.qty_out as balance,
       mv.last_movement, mv.batch_date, mv.last_godown
  from mv
  left join op using (company_guid, stock_item, batch_name);

grant select on public.rpt_lot_balance to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The picker's query, as an RPC so the frontend sends an item name rather than assembling filters.
-- Lots with stock left, biggest first; ties broken by most recent movement so the lot a store
-- keeper is most likely holding sorts to the top.
--
-- ⚠ THIS IS NOT `select … from rpt_lot_balance where stock_item = p_item`, deliberately. The view
--   cannot push an item predicate into its own CTEs, so that form scanned every batch line and
--   every StockItem master before filtering: 2.1s. Repeating the logic with `p_item` inside both
--   CTEs — plus rpt_batch_line_item_only_idx — takes it to 0.4s.
--
-- ⚠ THE PRICE OF THAT SPEED IS THAT THE LOGIC IS DUPLICATED. The view above and this function must
--   be changed TOGETHER. Both carried all four corrections wrong at different times; keep them in
--   step or the picker and any report built on the view will quietly disagree.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.rpt_lots_for_item(
  p_item text, p_company text default null, p_min numeric default 0.0001)
returns table (
  company_guid text, batch_name text, balance numeric, uom text,
  last_movement text, batch_date date, last_godown text)
language sql stable as $fn$
  with dedup as (
    select distinct on (l.voucher_guid, l.line_no, l.batch_no)
           l.company_guid, l.batch_name, l.movement, l.qty, l.uom,
           l.vch_date, l.batch_date, l.godown_name
      from public.rpt_batch_line l
     where l.stock_item = p_item
       and l.is_real_lot
       and l.affects_stock
       and (l.tracking_number is null or l.voucher_no = l.tracking_number)
       and (p_company is null or l.company_guid = p_company)
     order by l.voucher_guid, l.line_no, l.batch_no, (l.tenant_id like '%~%')
  ),
  mv as (
    select d.company_guid, d.batch_name,
           max(d.uom)                                                as uom,
           coalesce(sum(d.qty) filter (where d.movement = 'in'),  0)
         - coalesce(sum(d.qty) filter (where d.movement = 'out'), 0) as net,
           max(d.vch_date)                                           as last_movement,
           max(d.batch_date)                                         as batch_date,
           (array_agg(d.godown_name order by d.vch_date desc)
              filter (where d.godown_name is not null))[1]           as last_godown
      from dedup d group by 1,2
  ),
  op as (
    select distinct on (t.company_guid, t.batch_name)
           t.company_guid, t.batch_name, t.opening
      from (
        select split_part(split_part(o.tenant_id,'::',2),'~',1) as company_guid,
               public.jtext(b->'BATCHNAME')                     as batch_name,
               (o.tenant_id like '%~%')                         as is_archive,
               sum(public.amt(split_part(public.jtext(b->'OPENINGBALANCE'), ' ', 1))) as opening
          from public.tally_object o
          cross join lateral jsonb_array_elements(
            case jsonb_typeof(o.raw_payload->'BATCHALLOCATIONS.LIST')
              when 'array'  then o.raw_payload->'BATCHALLOCATIONS.LIST'
              when 'object' then jsonb_build_array(o.raw_payload->'BATCHALLOCATIONS.LIST')
              else '[]'::jsonb end) as ba(b)
         where o.object_type = 'StockItem'
           and o.name = p_item                    -- the predicate the view cannot push down
           and jsonb_typeof(b) = 'object'
         group by 1,2,3
      ) t
     order by t.company_guid, t.batch_name, t.is_archive
  )
  select mv.company_guid, mv.batch_name,
         coalesce(op.opening, 0) + mv.net as balance,
         mv.uom, mv.last_movement, mv.batch_date, mv.last_godown
    from mv left join op using (company_guid, batch_name)
   where coalesce(op.opening, 0) + mv.net >= p_min
   order by balance desc, mv.last_movement desc
   limit 200;
$fn$;

grant execute on function public.rpt_lots_for_item(text, text, numeric) to anon, authenticated;
