-- ===========================================================================
-- ROLLBACK for 20261127120100_od16_four_states_and_the_dispatch_note.
--
-- Undoes phase 2: `fms_dispatch_my_orders` goes back to its OD-14 eight-state
-- shape, and the gate outward entry loses its customer-facing note.
--
-- ⚠ NOTHING HERE TOUCHES CANCELLING, because phase 2 does not either. An earlier
--   draft made `fms_dispatch_cancel_customer_order` refuse and snapshotted the old
--   body so this file could put it back; both were dropped when the rule turned
--   out to be "cancel until we accept", which `fms_dispatch_customer_window_open`
--   already enforced unchanged. If you are looking for that restore step, it is
--   gone on purpose and there is nothing to undo.
--
-- ⚠ THE STATE WORDS ROLL BACK WITH THE FRONTEND OR NOT AT ALL. Running this while
--   the OD-16 Order Desk is deployed leaves the browser mapping eight server keys
--   ('placed', 'preparing', 'paused', …) through a five-key table, and every one
--   of them falls to the "With us" catch-all. Not an error on screen — just every
--   order reading the same meaningless word.
--
-- ⚠ ORDER OF THE TWO ROLLBACKS. This one may be run on its own — it leaves the
--   OD-16 phase-1 forms master alone. But if BOTH are being undone, run THIS ONE
--   FIRST: the `my_orders` restored here no longer mentions
--   `fms_dispatch_ledger_forms`, so phase 1 is then free to drop that table. The
--   other way round leaves a window in which `my_orders` selects from a table
--   that no longer exists, and every customer's order list raises.
--
-- ⚠ THE COLUMNS ARE DROPPED, AND WITH THEM EVERY NOTE TYPED FOR A CUSTOMER. They
--   exist nowhere else. To undo the code but keep the text, run everything here
--   EXCEPT section 5.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. THE ORDER DESK GOES BACK TO THE OD-14 SHAPE
-- ===========================================================================
drop function if exists public.fms_dispatch_my_orders();

create or replace function public.fms_dispatch_my_orders()
returns table(id uuid, order_no text, order_date date, order_remarks text,
              status_key text, can_change boolean, placed_at timestamptz,
              company_id uuid, company_label text, lines jsonb)
language sql stable security definer set search_path to 'public'
as $fn$
  select o.id, o.order_no, o.order_date, o.order_remarks,
         case
           when o.status = 'cancelled'              then 'cancelled'
           when o.status = 'awaiting_sales_return'  then 'cancelling'
           when o.status = 'on_hold'                then 'paused'
           when exists (select 1 from public.fms_dispatch_rounds r where r.order_id = o.id)
                and o.status not in ('closed')      then 'part_dispatched'
           when o.current_step in ('sales_order','credit_check')   then 'placed'
           when o.current_step in ('material_status','sales_bill') then 'preparing'
           when o.current_step = 'gate_out'                        then 'dispatched'
           else 'delivered'
         end,
         public.fms_dispatch_customer_window_open(o.id),
         o.submitted_at,
         o.company_id,
         (select coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, '')
            from public.mst_companies c where c.id = o.company_id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'line_no', li.line_no, 'item_id', li.item_id, 'name', i.name,
                    'quantity', li.quantity, 'unit', li.unit, 'line_remark', li.line_remark)
                  order by li.line_no)
             from public.fms_dispatch_order_items li
             join public.mst_items i on i.id = li.item_id
            where li.order_id = o.id
         ), '[]'::jsonb)
    from public.fms_dispatch_orders o
   where public.fms_dispatch_customer_org_of(auth.uid()) is not null
     and public.fms_dispatch_customer_org_of_login(o.raised_by)
         = public.fms_dispatch_customer_org_of(auth.uid())
   order by o.submitted_at desc nulls last, o.order_no desc;
$fn$;

revoke all on function public.fms_dispatch_my_orders() from public;
grant execute on function public.fms_dispatch_my_orders() to authenticated;

-- ===========================================================================
-- 2. THE GATE OUTWARD ENTRY STOPS WRITING THE CUSTOMER NOTE
-- ===========================================================================
create or replace function public.fms_dispatch_record_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_uid uuid := auth.uid(); v_gp text;
begin
  select status, order_no, round_no, gp_no into v_status, v_no, v_round, v_gp
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_gate_out' then raise exception 'This order is not awaiting the gate outward entry (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to record the gate outward entry'; end if;
  if v_gp is null then
    raise exception 'This order has no gate pass number - the sales bill must be recorded first';
  end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, current_date),
    go_outward_no  = v_gp,
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    go_at = coalesce(go_at, now()), go_by = coalesce(go_by, v_uid),
    status = 'awaiting_dispatch_confirm', current_step = 'dispatch_confirm'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'gate_out',
    'Gate outward ' || v_gp || ' recorded for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting delivery confirmation.',
    public.fms_dispatch_step_owner_ids('dispatch_confirm'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'outward_no', v_gp)
  );
end $$;
grant execute on function public.fms_dispatch_record_gate_out(uuid, jsonb) to authenticated;

create or replace function public.fms_dispatch_update_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to edit the gate outward entry'; end if;
  if not public.fms_dispatch_go_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its gate outward entry can no longer be changed.'; end if;
    raise exception 'The gate outward entry can no longer be edited: the delivery has already been confirmed (status %).', v_status;
  end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, go_actual_date),
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'gate_out_edited',
    format('Gate outward entry on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_gate_out(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 3. ARCHIVING — back to the OD-15 body, verbatim
-- ===========================================================================
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

  -- OD-15 · FREEZE THE SPLIT ALONGSIDE THE LINE IT BELONGS TO.
  --
  -- ⚠ THIS MUST RUN BEFORE THE WIPE BELOW, which deletes the staging children.
  --   The join is on (round_id, order_item_id), which the round-items table
  --   already carries a UNIQUE index for, so one order line can only ever match
  --   the one round item just inserted for it.
  insert into public.fms_dispatch_round_item_lots (round_item_id, lot_no, qty, seq)
  select ri.id, ol.lot_no, ol.qty, ol.seq
    from public.fms_dispatch_order_item_lots ol
    join public.fms_dispatch_round_items ri
      on ri.round_id = v_round_id and ri.order_item_id = ol.order_item_id
   order by ri.id, ol.seq;

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

  -- OD-15 · the children join ship_qty, bill_qty and lot_no in being cleared:
  -- they described THIS round, and they are now frozen on the round item.
  delete from public.fms_dispatch_order_item_lots
   where order_item_id in (
     select id from public.fms_dispatch_order_items where order_id = p_order);

  -- bill_qty joins ship_qty and lot_no: the next round raises its own invoice.
  update public.fms_dispatch_order_items
     set ship_qty = null, bill_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end
$fn$;

revoke all on function public.fms_dispatch_archive_round(uuid, text) from public, authenticated;

-- ===========================================================================
-- 4. THE COLUMNS
-- ===========================================================================
-- Last, because sections 3 and 4 must stop referencing them first.
alter table public.fms_dispatch_rounds drop column if exists go_customer_remark;
alter table public.fms_dispatch_orders drop column if exists go_customer_remark;

commit;
