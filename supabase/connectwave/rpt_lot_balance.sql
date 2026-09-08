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
-- The residual 3.6% (347 lots) is inter-company movement, manual adjustment and partially-invoiced
-- challans. They are simply never offered by the picker, which lists only balance > 0.
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
with moves as (
  -- Correction 1: one row per tracked movement, on the originating document.
  select company_guid, stock_item, batch_name, movement, qty, uom, vch_date, batch_date, godown_name
    from public.rpt_batch_line
   where is_real_lot
     and affects_stock
     and (tracking_number is null or voucher_no = tracking_number)
),
mv as (
  select company_guid, stock_item, batch_name,
         max(uom)                                    as uom,
         sum(qty) filter (where movement = 'in')     as qty_in,
         sum(qty) filter (where movement = 'out')    as qty_out,
         max(vch_date)                               as last_movement,
         max(batch_date)                             as batch_date,
         (array_agg(godown_name order by vch_date desc)
            filter (where godown_name is not null))[1] as last_godown
    from moves group by 1,2,3
),
-- Correction 2: the per-batch opening off the StockItem master. `~FY` archive books share a
-- company_guid with their live book, which is why the tenant suffix is stripped.
op as (
  select split_part(split_part(tenant_id,'::',2),'~',1) as company_guid,
         name                                          as stock_item,
         public.jtext(b->'BATCHNAME')                  as batch_name,
         sum(public.amt(split_part(public.jtext(b->'OPENINGBALANCE'), ' ', 1))) as opening
    from public.tally_object o
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(o.raw_payload->'BATCHALLOCATIONS.LIST')
        when 'array'  then o.raw_payload->'BATCHALLOCATIONS.LIST'
        when 'object' then jsonb_build_array(o.raw_payload->'BATCHALLOCATIONS.LIST')
        else '[]'::jsonb end) as ba(b)
   where o.object_type = 'StockItem'
     and jsonb_typeof(b) = 'object'
   group by 1,2,3
)
select mv.company_guid, mv.stock_item, mv.batch_name, mv.uom,
       coalesce(op.opening, 0)                                   as opening,
       coalesce(mv.qty_in, 0)                                    as qty_in,
       coalesce(mv.qty_out, 0)                                   as qty_out,
       coalesce(op.opening, 0) + coalesce(mv.qty_in, 0) - coalesce(mv.qty_out, 0) as balance,
       mv.last_movement, mv.batch_date, mv.last_godown
  from mv
  left join op using (company_guid, stock_item, batch_name);

grant select on public.rpt_lot_balance to anon, authenticated;

-- The picker's query, as an RPC so the frontend sends an item name rather than assembling filters.
-- Lots with stock left, biggest first; ties broken by most recent movement so the lot a store
-- keeper is most likely holding sorts to the top.
create or replace function public.rpt_lots_for_item(
  p_item text, p_company text default null, p_min numeric default 0.0001)
returns table (
  company_guid text, batch_name text, balance numeric, uom text,
  last_movement text, batch_date date, last_godown text)
language sql stable as $fn$
  select b.company_guid, b.batch_name, b.balance, b.uom,
         b.last_movement, b.batch_date, b.last_godown
    from public.rpt_lot_balance b
   where b.stock_item = p_item
     and (p_company is null or b.company_guid = p_company)
     and b.balance >= p_min
   order by b.balance desc, b.last_movement desc
   limit 200;
$fn$;

grant execute on function public.rpt_lots_for_item(text, text, numeric) to anon, authenticated;
