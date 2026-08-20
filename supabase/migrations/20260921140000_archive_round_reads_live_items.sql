-- ===========================================================================
-- CLOSING A DISPATCH ROUND STOPS NAMING EVERY PRODUCT "Item".
--
-- WHAT WAS WRONG
--   fms_dispatch_archive_round freezes each shipped line into
--   fms_dispatch_round_items, copying the product NAME so a completed round
--   still reads correctly years later even if the master is renamed. It looked
--   that name up in:
--
--     left join public.fms_dispatch_items it on it.id = li.item_id
--
--   fms_dispatch_items is the LEGACY master, frozen at the Phase 1 cutover on
--   2026-08-17 and kept only as the rollback. It holds 234 rows; the live
--   master, mst_items, holds 14,261. So the join matched nothing and
--   `coalesce(it.name, 'Item')` wrote the literal word "Item".
--
--   This was not intermittent. Of the 293 affected rows, ZERO would have
--   resolved against the legacy table - every dispatch closed since the cutover
--   stored "Item". The gate pass hid it, because gatePass.ts falls back to
--   `meta.itemName(i.itemId)`; the Order Register export reads the stored copy
--   directly and shows the placeholder.
--
-- ⚠ THE STANDING CHECK IN CENTRAL-MASTERS.md EXISTS FOR EXACTLY THIS, and it
--   would have caught it: it greps every function body for
--   fms_dispatch_(customers|items|customer_items) to prove nothing still reads
--   the frozen masters. This function was simply missed when the cutover
--   repointed the others. Re-run that check after any cutover, not just during.
--
--   Only mst_apply_reconcile_link still names the frozen tables now, and that
--   one is correct: merging a legacy row onto its Tally twin is its whole job.
--
-- ⚠ THE FALLBACK STAYS, and stays LAST. `coalesce(it.name, 'Item')` is still
--   right for a line whose item_id is null. What was wrong was the table it
--   asked, not the fact that it has an answer for "no item at all".
--
-- Reversal:
--   -- restore the old (broken) lookup:
--   --   left join public.fms_dispatch_items it on it.id = li.item_id
--   -- and put the placeholders back:
--   update public.fms_dispatch_round_items ri set item_name = 'Item'
--     from private.round_item_name_backfill b where b.round_item_id = ri.id;
--   drop table private.round_item_name_backfill;
-- ===========================================================================

create schema if not exists private;

-- --------------------------------------------------------------------------
-- 1. The cause. One join, repointed at the live master.
-- --------------------------------------------------------------------------
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id, location_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name,
    sb_eway_path, sb_eway_name, sb_remarks, sb_at, sb_by,
    sb_hold_at, sb_hold_reason, sb_hold_by,
    gp_no,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name,
    dc_attachment_pages, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id, o.location_id,
    -- ONLY the decision this round actually made. When credit approved enough to
    -- cover several rounds, the later ones inherit that decision and must archive
    -- NOTHING - otherwise one decision appears once per round it happened to
    -- cover, in the Completed tab and in the register.
    case when o.cc_round_no = o.round_no then o.cc_status       else null end,
    case when o.cc_round_no = o.round_no then o.cc_approved_qty else null end,
    case when o.cc_round_no = o.round_no then o.cc_remarks      else null end,
    case when o.cc_round_no = o.round_no then o.cc_at           else null end,
    case when o.cc_round_no = o.round_no then o.cc_by           else null end,
    o.ms_actual_date, o.ms_tempo_no, o.ms_porter, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name,
    o.sb_eway_path, o.sb_eway_name, o.sb_remarks, o.sb_at, o.sb_by,
    -- No round-ownership test, unlike the cc_ block: a hold belongs to the
    -- invoice this round did or did not raise, and the wipe below guarantees
    -- that whatever the header holds was set during THIS round.
    o.sb_hold_at, o.sb_hold_reason, o.sb_hold_by,
    -- Travels with the sb_ block, because it was issued for that invoice.
    o.gp_no,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name,
    o.dc_attachment_pages, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    -- ⚠ mst_items, THE LIVE MASTER. This read the frozen legacy master until
    --   2026-08-20 and therefore wrote 'Item' for every product dispatched
    --   after the Phase 1 cutover. See the migration header.
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.mst_items it on it.id = li.item_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- WIPE.
  --
  -- ⚠ company_id AND location_id ARE BOTH DELIBERATELY ABSENT. Both are chosen
  --   once at intake and are true for every round of the order, so wiping either
  --   would blank it the instant a round closed - and the header, the queues, the
  --   register, the emails and the row-level security predicate all read them.
  --
  -- ⚠ THE cc_ BLOCK IS ABSENT for a third reason: whether the credit decision
  --   survives into the next round depends on whether any headroom is left, which
  --   only the caller has worked out.
  --
  -- ⚠ gp_no, THE sb_eway_ PAIR, THE sb_hold_ TRIO AND dc_attachment_pages ARE
  --   ALL PRESENT, which is the opposite of the two fields above and easy to get
  --   wrong by proximity. A new round raises a NEW invoice and is delivered
  --   against NEW paperwork.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_eway_path = null, sb_eway_name = null,
    sb_remarks = null, sb_at = null, sb_by = null,
    sb_hold_at = null, sb_hold_reason = null, sb_hold_by = null,
    gp_no = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_attachment_pages = null,
    dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $fn$;

-- --------------------------------------------------------------------------
-- 2. Repair what the bug already wrote.
--
-- The product LINK was never lost - only the copied name - so every row is
-- recoverable from mst_items. Backed up first, keyed by row id, so the reversal
-- puts back exactly the rows this touched and nothing else.
-- --------------------------------------------------------------------------
do $$
declare v_before int; v_fixed int; v_left int;
begin
  if to_regclass('private.round_item_name_backfill') is not null then
    raise exception 'ABORT: private.round_item_name_backfill already exists - this migration has already run';
  end if;

  select count(*) into v_before from public.fms_dispatch_round_items where item_name = 'Item';

  create table private.round_item_name_backfill as
  select ri.id as round_item_id, ri.item_name as old_name, i.name as new_name
    from public.fms_dispatch_round_items ri
    join public.mst_items i on i.id = ri.item_id
   where ri.item_name = 'Item';

  update public.fms_dispatch_round_items ri
     set item_name = b.new_name
    from private.round_item_name_backfill b
   where b.round_item_id = ri.id;
  get diagnostics v_fixed = row_count;

  select count(*) into v_left from public.fms_dispatch_round_items where item_name = 'Item';

  raise notice 'round item names: % were placeholders, % repaired, % left (item_id null)',
    v_before, v_fixed, v_left;
end $$;

do $check$
declare v_bad int;
begin
  -- Nothing that HAS an item may still be called "Item".
  select count(*) into v_bad
    from public.fms_dispatch_round_items ri
    join public.mst_items i on i.id = ri.item_id
   where ri.item_name = 'Item';
  if v_bad <> 0 then
    raise exception 'CHECK FAILED: % round items still say Item despite having a product', v_bad;
  end if;

  -- And the function must no longer name the frozen master.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
       and p.prosrc ~ 'join public\.fms_dispatch_items'
  ) then
    raise exception 'CHECK FAILED: fms_dispatch_archive_round still joins the frozen items master';
  end if;
end $check$;

comment on table private.round_item_name_backfill is
  'Round items whose frozen name was the placeholder "Item" because archive_round read the retired fms_dispatch_items master, with the name restored from mst_items. Undo data for migration 20260921140000.';
