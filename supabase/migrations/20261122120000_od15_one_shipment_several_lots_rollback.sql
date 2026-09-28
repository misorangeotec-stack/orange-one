-- ===========================================================================
-- ROLLBACK OF 20261122120000_od15_one_shipment_several_lots.sql
--
-- ⚠⚠ THIS DOES NOT DROP THE TWO TABLES, AND THAT IS THE POINT.
--
--   The frontend reads the lot children through a PostgREST embed on the two
--   existing select("*") calls in dispatchFetch.ts. Drop the tables while a
--   deployed frontend still asks for them and the embed 400s -- which does not
--   degrade the lot column, it takes the WHOLE dispatch fetch down and the
--   module renders blank. Rolling back the database must never depend on the
--   frontend having been reverted first.
--
--   Both tables are additive and, once the functions below are restored, nothing
--   reads or writes them. They sit there harmlessly.
--
--   To finish the job by hand, AFTER the frontend has been reverted and only if
--   you have decided the recorded splits are not worth keeping:
--
--     select count(*) from public.fms_dispatch_round_item_lots;   -- look first
--     drop table public.fms_dispatch_order_item_lots;
--     drop table public.fms_dispatch_round_item_lots;
--
--   Those rows are real dispatch records typed by a store keeper, and they are
--   NOT recoverable from lot_no: the summary is lossy the moment a lot number
--   legitimately contains a bracket or a comma.
--
-- ⚠ THE FOUR FUNCTION BODIES BELOW ARE VERBATIM FROM pg_proc.prosrc AS AT
--   11-09-2026, BEFORE THE OD-15 MIGRATION. They are NOT the versions in the
--   migration files -- the live database was ahead of supabase/migrations/ for
--   all three dispatch RPCs (bill_qty, and mst_items in place of
--   fms_dispatch_items). Restoring from the files on disk would revert the
--   bill-quantity feature on live dispatch records. See the forward migration's
--   header, and the assertion at the end of this one, which refuses that.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · The six parent-touch triggers
-- ---------------------------------------------------------------------------

drop trigger if exists trg_dispatch_order_item_lots_touch_ins on public.fms_dispatch_order_item_lots;
drop trigger if exists trg_dispatch_order_item_lots_touch_upd on public.fms_dispatch_order_item_lots;
drop trigger if exists trg_dispatch_order_item_lots_touch_del on public.fms_dispatch_order_item_lots;
drop trigger if exists trg_dispatch_round_item_lots_touch_ins on public.fms_dispatch_round_item_lots;
drop trigger if exists trg_dispatch_round_item_lots_touch_upd on public.fms_dispatch_round_item_lots;
drop trigger if exists trg_dispatch_round_item_lots_touch_del on public.fms_dispatch_round_item_lots;

-- ---------------------------------------------------------------------------
-- 2 · fms_dispatch_touch_parent_order, back to its two arms
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_touch_parent_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_argv[0] = 'order_id' then
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (select distinct a.order_id as oid from affected a where a.order_id is not null) x
     where o.id = x.oid;
  else
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (
        select distinct r.order_id as oid
          from affected a
          join public.fms_dispatch_rounds r on r.id = a.round_id
      ) x
     where o.id = x.oid;
  end if;
  return null;
end
$function$;

-- ---------------------------------------------------------------------------
-- 3 · fms_dispatch_apply_ship_lines — verbatim as it stood
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_apply_ship_lines(p_order uuid, p_lines jsonb)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  l jsonb; v_id uuid; v_qty numeric; v_pending numeric; v_item text; v_total numeric := 0;
  v_ceiling numeric; v_done numeric; v_allow numeric;
begin
  -- A payload carrying NO line data must return before the blanket clear below.
  -- The credit ceiling is not applied on this path either: nothing changed, so
  -- an order already over its ceiling (only reachable by a coordinator's
  -- correction) must not become unsaveable for a remark.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    select coalesce(sum(ship_qty), 0) into v_total
      from public.fms_dispatch_order_items where order_id = p_order;
    return v_total;
  end if;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_id := nullif(l->>'id','')::uuid;
    if v_id is null then continue; end if;
    v_qty := coalesce(nullif(l->>'ship_qty','')::numeric, 0);
    if v_qty <= 0 then continue; end if;

    select greatest(li.quantity - li.dispatched_qty, 0), coalesce(it.name, 'this item')
      into v_pending, v_item
      from public.fms_dispatch_order_items li
      left join public.mst_items it on it.id = li.item_id
     where li.id = v_id and li.order_id = p_order;

    if v_pending is null then continue; end if;
    if v_qty > v_pending then
      raise exception 'Cannot send % of %: only % is still pending on that line',
        trim(to_char(v_qty, 'FM999999990.###')), v_item, trim(to_char(v_pending, 'FM999999990.###'));
    end if;

    update public.fms_dispatch_order_items
       set ship_qty = v_qty, lot_no = nullif(trim(l->>'lot_no'), '')
     where id = v_id and order_id = p_order;

    v_total := v_total + v_qty;
  end loop;

  -- THE CREDIT CEILING. Order-level, because credit approves a quantity for the
  -- consignment and leaves the split across lines to whoever can see the stock.
  -- Checked after the loop for that reason - no single line can breach it, only
  -- the sum can. A null cc_approved_qty is UNCAPPED, not "zero approved".
  select o.cc_approved_qty into v_ceiling
    from public.fms_dispatch_orders o where o.id = p_order;

  if v_ceiling is not null then
    select coalesce(sum(li.dispatched_qty), 0) into v_done
      from public.fms_dispatch_order_items li where li.order_id = p_order;
    v_allow := greatest(v_ceiling - v_done, 0);

    if v_total > v_allow then
      raise exception 'Credit has authorised % on this order and % has already gone out, so only % may be sent. Reduce the quantities going out.',
        trim(to_char(v_ceiling, 'FM999999990.###')),
        trim(to_char(v_done, 'FM999999990.###')),
        trim(to_char(v_allow, 'FM999999990.###'));
    end if;
  end if;

  return v_total;
end $fn$;

revoke all on function public.fms_dispatch_apply_ship_lines(uuid, jsonb) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 4 · fms_dispatch_archive_round — verbatim as it stood
-- ---------------------------------------------------------------------------

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

  -- ⚠ THE FILTER STAYS ON ship_qty, NOT bill_qty. A line the store released but
  --   the biller did not invoice still physically left the building, and the
  --   round is the record of that. It archives with bill_qty = 0, so it settles
  --   nothing against the order and comes back as pending -- which is the point
  --   -- but it is not erased from the consignment's history.
  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, bill_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    -- ⚠ mst_items, THE LIVE MASTER. This read the frozen legacy master until
    --   2026-08-20 and therefore wrote 'Item' for every product dispatched
    --   after the Phase 1 cutover. See 20260921140000.
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.bill_qty, li.lot_no
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

  -- bill_qty joins ship_qty and lot_no: the next round raises its own invoice.
  update public.fms_dispatch_order_items
     set ship_qty = null, bill_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $fn$;

revoke all on function public.fms_dispatch_archive_round(uuid, text) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 5 · fms_dispatch_amend_round — verbatim as it stood
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_order uuid; v_no text; v_round integer; v_raiser uuid; v_status text; v_old text;
  v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_reason text := nullif(trim(p->>'amend_reason'), '');
  l jsonb; v_pending numeric; v_bad text; v_qty numeric;
  v_allow numeric; v_headroom numeric; v_to_credit boolean;
  v_doc_path text; v_doc_new boolean := p ? 'dc_attachment_path';
begin
  select r.order_id, r.round_no, r.dc_status into v_order, v_round, v_old
    from public.fms_dispatch_rounds r where r.id = p_round for update;
  if v_order is null then raise exception 'That dispatch round was not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can correct a completed round';
  end if;
  if v_reason is null then raise exception 'A reason is required when correcting a round'; end if;

  select o.status, o.order_no, o.raised_by, o.cc_approved_qty
    into v_status, v_no, v_raiser, v_allow
    from public.fms_dispatch_orders o where o.id = v_order for update;
  if v_status = 'cancelled' then raise exception 'This order was cancelled - its rounds can no longer be corrected'; end if;
  if v_status = 'awaiting_sales_return' then
    raise exception 'This order is waiting on its sales return - record or withdraw that first';
  end if;
  if v_dc is not null and v_dc not in ('delivered','returned') then
    raise exception 'The outcome must be Delivered or Returned';
  end if;

  -- ⚠ THE PROOF CANNOT BE REMOVED, ONLY REPLACED. Same presence contract as
  --   everywhere else in this module: the key OMITTED keeps the stored document
  --   untouched, which is what a quantity-only correction sends. But a key that
  --   IS present and blank is not "clear it" here as it would be for an optional
  --   slot - a delivered round with no receiver copy is a delivery nobody can
  --   evidence, and record_dispatch_confirm refuses to create one.
  if v_doc_new and coalesce(trim(p->>'dc_attachment_path'), '') = '' then
    raise exception 'A round cannot be left without a receiver copy - attach the replacement before saving';
  end if;

  if p ? 'lines' and jsonb_typeof(p->'lines') = 'array' then
    for l in select * from jsonb_array_elements(p->'lines') loop
      if coalesce(trim(l->>'id'), '') = '' then continue; end if;
      v_qty := coalesce(nullif(l->>'bill_qty','')::numeric,
                        nullif(l->>'ship_qty','')::numeric, 0);
      if v_qty <= 0 then
        raise exception 'A corrected quantity must be greater than zero - remove the line instead';
      end if;
      update public.fms_dispatch_round_items
         set bill_qty = v_qty,
             lot_no   = coalesce(nullif(trim(l->>'lot_no'), ''), lot_no)
       where id = (l->>'id')::uuid and round_id = p_round;
    end loop;
  end if;

  -- The primary this correction will leave behind - the new one when page one is
  -- being replaced, the stored one when only the extra pages are. It is what the
  -- normaliser must strip from the extra pages, or a replaced page one is stored
  -- twice: once as the primary and once as an extra.
  select case when v_doc_new then nullif(p->>'dc_attachment_path','') else r.dc_attachment_path end
    into v_doc_path from public.fms_dispatch_rounds r where r.id = p_round;

  update public.fms_dispatch_rounds set
    dc_status    = coalesce(v_dc, dc_status),
    dc_attachment_path  = case when p ? 'dc_attachment_path'  then nullif(p->>'dc_attachment_path','')  else dc_attachment_path  end,
    dc_attachment_name  = case when p ? 'dc_attachment_name'  then nullif(p->>'dc_attachment_name','')  else dc_attachment_name  end,
    dc_attachment_pages = case when p ? 'dc_attachment_pages'
                               then public.fms_dispatch_doc_pages(p->'dc_attachment_pages', v_doc_path)
                               else dc_attachment_pages end,
    amended_at   = now(), amended_by = v_uid, amend_reason = v_reason
  where id = p_round;

  -- Catch an over-delivery BEFORE the recalculation trips the table CHECK and
  -- surfaces as a constraint name nobody can read.
  select string_agg(it.name, ', ') into v_bad
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = v_order
     and coalesce((select sum(coalesce(ri.bill_qty, ri.ship_qty)) from public.fms_dispatch_round_items ri
                   join public.fms_dispatch_rounds r on r.id = ri.round_id
                  where ri.order_item_id = li.id and r.order_id = v_order and r.dc_status = 'delivered'), 0)
         > li.quantity;
  if v_bad is not null then
    raise exception 'That correction would deliver more than was ordered on: %', v_bad;
  end if;

  perform public.fms_dispatch_recalc_dispatched(v_order);

  -- A correction that leaves something owing must re-open a closed order,
  -- otherwise the balance has nowhere to go.
  select coalesce(sum(greatest(quantity - dispatched_qty, 0)), 0),
         case when v_allow is null then null else v_allow - coalesce(sum(dispatched_qty), 0) end
    into v_pending, v_headroom
    from public.fms_dispatch_order_items where order_id = v_order;

  v_to_credit := (v_headroom is not null and v_headroom <= 0);

  if v_status = 'closed' and v_pending > 0 then
    update public.fms_dispatch_orders set
      round_no = round_no + 1, round_started_at = now(),
      status       = case when v_to_credit then 'awaiting_credit_check' else 'awaiting_material_status' end,
      current_step = case when v_to_credit then 'credit_check'          else 'material_status'          end,
      -- The same reset as the dispatch-confirm loop, for the same reason: the
      -- balance is unapproved, so the decision must be made again. Only the
      -- cumulative ceiling survives.
      cc_status     = case when v_to_credit then null else cc_status     end,
      cc_remarks    = case when v_to_credit then null else cc_remarks    end,
      cc_round_no   = case when v_to_credit then null else cc_round_no   end,
      cc_at         = case when v_to_credit then null else cc_at         end,
      cc_by         = case when v_to_credit then null else cc_by         end,
      cc_decided_at = case when v_to_credit then null else cc_decided_at end,
      cc_decided_by = case when v_to_credit then null else cc_decided_by end,
      cc_edited_at  = case when v_to_credit then null else cc_edited_at  end,
      cc_edited_by  = case when v_to_credit then null else cc_edited_by  end,
      closed_at = null
    where id = v_order;
    update public.fms_dispatch_rounds set archived_reason = 'looped'
      where id = p_round and archived_reason = 'closed';
  end if;

  -- ⚠ THE DOCUMENT SWAP IS ANNOUNCED. A correction that only replaces the
  --   receiver copy changes no quantity and no outcome, so without this clause
  --   the notification would read as though nothing happened and the swap would
  --   be invisible to everyone downstream.
  perform public.fms_dispatch_announce(
    'order', v_order, 'round_amended',
    'Round ' || v_round || ' of ' || coalesce(v_no,'an order') || ' was corrected'
      || case when v_dc is not null and v_dc is distinct from v_old
              then ' (' || v_old || ' -> ' || v_dc || ')' else '' end
      || case when v_doc_new then ' (receiver copy replaced)' else '' end
      || ': ' || v_reason
      || case when v_status = 'closed' and v_pending > 0
              then ' The order has re-opened with ' || trim(to_char(v_pending,'FM999999990.###'))
                   || ' still pending'
                   || case when v_to_credit then ', awaiting a fresh credit decision.' else '.' end
              else '' end,
    case when v_status = 'closed' and v_pending > 0
         then public.fms_dispatch_step_owner_ids(case when v_to_credit then 'credit_check' else 'material_status' end)
              || array_remove(array[v_raiser], null)
         else array_remove(array[v_raiser], null) end,
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'reason', v_reason)
  );
end $fn$;

grant execute on function public.fms_dispatch_amend_round(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6 · The two OD-15 helpers. Nothing calls them once the above is restored.
-- ---------------------------------------------------------------------------

drop function if exists public.fms_dispatch_lot_text(jsonb, numeric);
drop function if exists public.fms_dispatch_lots_normalise(jsonb);

-- ---------------------------------------------------------------------------
-- 7 · ASSERTION — the restore is complete and the drift was NOT reintroduced
-- ---------------------------------------------------------------------------

do $check$
declare v_txt text; v int; v_bad text;
begin
  -- ⚠ BYTE-IDENTICAL, NOT MERELY EQUIVALENT. These are md5(prosrc) as the four
  --   functions stood at 11-09-2026, immediately before the OD-15 migration, read
  --   straight from pg_proc. A rollback that restores behaviour but not the exact
  --   text is one nobody can verify afterwards -- and the drift described in the
  --   header is precisely what happens when nobody can.
  --
  --   Two things had to be right for this to pass, and both were found by running
  --   it rather than reading it: the three RPC bodies end "end " with a TRAILING
  --   SPACE (written "end $fn$;" on one line, not "end" then a newline), and the
  --   live touch function carries NO comments inside its body, though the file at
  --   20260926120000 shows three.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and md5(p.prosrc) is distinct from (case p.proname
       when 'fms_dispatch_amend_round'        then '4ebd9bd32ac52e47f2710f4ba518d248'
       when 'fms_dispatch_apply_ship_lines'   then 'e32cce5ece67c378eef9b99b23a01942'
       when 'fms_dispatch_archive_round'      then '4de8509cb0dea4cf74ef0046a6c4a1c8'
       when 'fms_dispatch_touch_parent_order' then '60b146b7d046f5aabed60cffb1beddb6'
     end)
     and p.proname in ('fms_dispatch_amend_round','fms_dispatch_apply_ship_lines',
                       'fms_dispatch_archive_round','fms_dispatch_touch_parent_order');
  if v_bad is not null then
    raise exception 'ROLLBACK FAILED: these are not byte-identical to the pre-OD-15 bodies: %', v_bad;
  end if;

  select p.prosrc into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_amend_round';
  if v_txt like '%fms_dispatch_lot_text%' then
    raise exception 'ROLLBACK FAILED: amend_round still renders through the OD-15 formatter.';
  end if;
  if v_txt not like '%bill_qty = v_qty%' then
    raise exception 'ROLLBACK FAILED: amend_round lost its bill_qty write.';
  end if;

  select p.prosrc into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round';
  if v_txt like '%fms_dispatch_round_item_lots%' then
    raise exception 'ROLLBACK FAILED: archive_round still freezes the lot children.';
  end if;
  if v_txt not like '%li.bill_qty%' or v_txt not like '%mst_items%' then
    raise exception 'ROLLBACK FAILED: archive_round lost bill_qty or mst_items.';
  end if;

  select p.prosrc into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_apply_ship_lines';
  if v_txt like '%fms_dispatch_order_item_lots%' then
    raise exception 'ROLLBACK FAILED: apply_ship_lines still writes the lot children.';
  end if;

  select count(*) into v
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and c.relname in ('fms_dispatch_order_item_lots','fms_dispatch_round_item_lots');
  if v <> 0 then
    raise exception 'ROLLBACK FAILED: % triggers still stand on the lot tables.', v;
  end if;

  -- The nine original parent-touch triggers must be untouched by all of this.
  select count(*) into v
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and c.relname in ('fms_dispatch_order_items','fms_dispatch_rounds','fms_dispatch_round_items')
     and t.tgname like 'trg_dispatch_%_touch_%';
  if v <> 9 then
    raise exception 'ROLLBACK FAILED: expected the original 9 parent-touch triggers, found %.', v;
  end if;

  -- The tables are meant to SURVIVE. See the header.
  select count(*) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('fms_dispatch_order_item_lots','fms_dispatch_round_item_lots');
  if v <> 2 then
    raise exception 'ROLLBACK FAILED: the lot tables must be LEFT STANDING, found % of 2.', v;
  end if;
end $check$;

commit;
