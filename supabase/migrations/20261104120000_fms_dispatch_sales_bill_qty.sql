-- THE BILLED QUANTITY BECOMES THE ONE THAT COUNTS.
--
-- WHAT WAS WRONG
--   `ship_qty` -- the store keeper's "Ship now" at Check Material Status -- was the
--   only quantity in the system. Everything downstream inherited it silently: the
--   gate pass printed it, the gate-out and delivery screens recapped it, and
--   `dispatched_qty` was recalculated from it. The billing desk had no way to say
--   that the Tally invoice covered LESS than what the store had picked, and no
--   screen would have shown the difference if it did.
--
-- WHAT CHANGES
--   The Generate Sales Bill step gains a per-line SALES BILL QTY, typed by the
--   sales_bill step owner. From that point on it is the operative figure:
--     * the gate pass prints it,
--     * the gate-out and delivery recaps show it,
--     * `dispatched_qty` is recalculated from it,
--     * the pending balance and the loop-back decision are worked out from it.
--   A line released as 60 but billed 40 settles 40; the 20 stays pending and the
--   order loops back to the stock check exactly as a short-shipped line does.
--
-- ⚠ NULL AND ZERO ARE DIFFERENT, AND THE DIFFERENCE IS LOAD-BEARING.
--     0    = "this line went out and was deliberately NOT billed" -- written by
--            apply_bill_lines against every line with a ship_qty, before the
--            payload is applied over the top.
--     null = "this row never passed through the billing grid at all" -- every row
--            that predates this migration, and every line not going out.
--   Every read is `coalesce(bill_qty, ship_qty)`, so a null falls back to the old
--   behaviour and history is untouched, while an explicit 0 correctly settles
--   nothing. Collapse the two and every pre-existing closed order re-opens with
--   its whole quantity owing.
--
-- ⚠ RE-ISSUED WHOLESALE, NOT PATCHED. Postgres records no dependency from a
--   PL/pgSQL body to a column, so each function below is restated from its LATEST
--   body -- record_sales_bill from 20260928120000 (which allocates gp_no from the
--   per-site series), archive_round from 20260921140000 (which reads mst_items,
--   not the retired master), dispatch_confirm from 20260831120000, amend_round
--   from 20260831120100. Reverting any of them to an older body would silently
--   undo that migration.
--
-- ⚠ DEPLOY ORDER IS SAFE IN BOTH DIRECTIONS, BY DESIGN. record_sales_bill
--   refuses a bill with no quantity on it -- but only when the payload CARRIES a
--   `lines` key, which only the new screen does. A build that predates the
--   billing grid sends no such key and gets exactly the old behaviour: the whole
--   consignment is billed. So this migration can land before the frontend
--   without stopping the billing desk, and the frontend can land before the
--   migration only in the sense that it will error on a missing column -- so
--   still apply this FIRST. See the shim's own note in section 4.
begin;

-- ===========================================================================
-- 1. THE COLUMNS. Additive and nullable, per the repo rule.
-- ===========================================================================
alter table public.fms_dispatch_order_items
  add column if not exists bill_qty numeric(14,3);

alter table public.fms_dispatch_order_items
  drop constraint if exists fms_dispatch_order_items_bill_qty_ck;
alter table public.fms_dispatch_order_items
  -- `>= 0`, NOT `> 0` like ship_qty's check: zero is a meaningful answer here
  -- ("released, not billed") and the constraint must not forbid it.
  add constraint fms_dispatch_order_items_bill_qty_ck
    check (bill_qty is null or bill_qty >= 0);

alter table public.fms_dispatch_round_items
  add column if not exists bill_qty numeric(14,3);

alter table public.fms_dispatch_round_items
  drop constraint if exists fms_dispatch_round_items_bill_qty_ck;
alter table public.fms_dispatch_round_items
  add constraint fms_dispatch_round_items_bill_qty_ck
    check (bill_qty is null or bill_qty >= 0);

comment on column public.fms_dispatch_order_items.bill_qty is
  'What the sales bill actually invoices for this line THIS ROUND, typed by the sales_bill step owner. Capped at ship_qty. 0 means the line went out but was not billed; null means the round never reached the billing grid (pre-2026-11-04 rows). Read as coalesce(bill_qty, ship_qty) everywhere.';
comment on column public.fms_dispatch_round_items.bill_qty is
  'The frozen billed quantity for this round. THIS is what dispatched_qty is recalculated from -- ship_qty stays as the record of what physically left the gate.';

-- ===========================================================================
-- 2. BACKFILL. Before this migration the billed quantity WAS the shipped one,
--    so every historic row is restated as such rather than left null. The
--    coalesce in the readers is belt and braces on top of this, not instead.
-- ===========================================================================
update public.fms_dispatch_round_items
   set bill_qty = ship_qty
 where bill_qty is null;

-- Live headers already past the billing desk: the invoice was raised under the
-- old rule, so the quantity it covers is the shipped one.
update public.fms_dispatch_order_items li
   set bill_qty = li.ship_qty
  from public.fms_dispatch_orders o
 where o.id = li.order_id
   and li.bill_qty is null
   and coalesce(li.ship_qty, 0) > 0
   and o.sb_at is not null;

-- ===========================================================================
-- 3. THE WRITER. Mirrors fms_dispatch_apply_ship_lines (20260810120100:214),
--    including its two guards: an empty payload returns rather than clearing,
--    and a line absent from the payload is a line NOT billed.
-- ===========================================================================
create or replace function public.fms_dispatch_apply_bill_lines(p_order uuid, p_lines jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  l jsonb; v_id uuid; v_qty numeric; v_ship numeric; v_item text; v_total numeric := 0;
begin
  -- ⚠ The reset below is destructive, so a payload carrying NO line data must
  --   return before it -- otherwise a remarks-only edit of the sales bill
  --   silently zeroes the invoice and the order loops for ever delivering
  --   nothing. Same guard, same reason, as apply_ship_lines.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    select coalesce(sum(bill_qty), 0) into v_total
      from public.fms_dispatch_order_items where order_id = p_order;
    return v_total;
  end if;

  -- RESET TO ZERO, NOT TO NULL, on the lines that are going out. See the header:
  -- zero settles nothing, null falls back to ship_qty. A line not going out at
  -- all goes back to null, because it has no billable quantity to speak of.
  update public.fms_dispatch_order_items
     set bill_qty = case when coalesce(ship_qty, 0) > 0 then 0 else null end
   where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_id := nullif(l->>'id','')::uuid;
    if v_id is null then continue; end if;
    v_qty := coalesce(nullif(l->>'bill_qty','')::numeric, 0);
    -- A blank or zero line is simply not billed, and the reset above already
    -- says so. Skipping keeps "leave it empty" a legal answer.
    if v_qty <= 0 then continue; end if;

    select coalesce(li.ship_qty, 0), coalesce(it.name, 'this item')
      into v_ship, v_item
      from public.fms_dispatch_order_items li
      left join public.mst_items it on it.id = li.item_id
     where li.id = v_id and li.order_id = p_order;

    if v_ship is null then continue; end if;

    -- ⚠ CAPPED AT WHAT THE STORE RELEASED, per line. You cannot invoice what did
    --   not leave the building, and the gate pass -- which prints this figure --
    --   would otherwise list more than is on the vehicle. The pending and credit
    --   ceilings are enforced upstream by apply_ship_lines, so they hold here by
    --   construction.
    if v_ship <= 0 then
      raise exception 'Cannot bill % of %: that line is not going out on this round',
        trim(to_char(v_qty, 'FM999999990.###')), v_item;
    end if;
    if v_qty > v_ship then
      raise exception 'Cannot bill % of %: only % is going out on this round',
        trim(to_char(v_qty, 'FM999999990.###')), v_item, trim(to_char(v_ship, 'FM999999990.###'));
    end if;

    update public.fms_dispatch_order_items
       set bill_qty = v_qty
     where id = v_id and order_id = p_order;

    v_total := v_total + v_qty;
  end loop;

  return v_total;
end $$;
-- Never granted: its only callers are SECURITY DEFINER and run as owner, so a
-- grant would only let a signed-in user rewrite someone else's invoice by a
-- direct PostgREST call. Same reasoning as apply_ship_lines.
revoke all on function public.fms_dispatch_apply_bill_lines(uuid, jsonb) from public, authenticated;

-- ===========================================================================
-- 4. STEP 4 -- GENERATE SALES BILL. Restated from 20260928120000, whose gp_no
--    allocation must survive intact; the only additions are the lines that
--    apply and check the billed quantities.
-- ===========================================================================
create or replace function public.fms_dispatch_record_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status   text;
  v_no       text;
  v_round    integer;
  v_uid      uuid := auth.uid();
  v_company  uuid;
  v_location uuid;
  v_gp       text;
  v_date     date;
  v_billed   numeric;
begin
  select status, order_no, round_no, company_id, location_id, gp_no
    into v_status, v_no, v_round, v_company, v_location, v_gp
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_bill' then raise exception 'This order is not awaiting the sales bill (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to record the sales bill'; end if;
  if coalesce(trim(p->>'sb_invoice_no'), '') = '' then raise exception 'The Tally invoice number is required'; end if;
  if coalesce(trim(p->>'sb_attachment_path'), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;
  -- ⚠ THERE IS NO EQUIVALENT CHECK FOR THE E-WAY BILL, and adding one would stop
  --   every below-threshold consignment at the billing desk.

  -- THE BILLED QUANTITIES, before anything is stamped. An invoice covering
  -- nothing is not an invoice, and letting one through would burn a gate pass
  -- number on a consignment that settles no quantity at all.
  --
  -- ⚠ BACKWARD-COMPATIBILITY SHIM ON THE `else` ARM, AND IT IS DELIBERATE.
  --   A payload with no `lines` KEY AT ALL can only come from a build that
  --   predates the billing grid -- the new screen always sends the key, even
  --   when every box is blank. Refusing those would have broken live billing
  --   for the window between this migration landing and the frontend deploying,
  --   with no action available to the person at the desk. So a stale client gets
  --   exactly the old behaviour: the whole consignment is billed.
  --
  --   This is safe to delete once no stale build can reach the database, and it
  --   is the ONLY path that bills a quantity nobody typed. Do not widen it to an
  --   empty `lines` array -- that IS the new screen saying "nothing was entered",
  --   which is the refusal this step exists to make.
  if p ? 'lines' then
    v_billed := public.fms_dispatch_apply_bill_lines(p_order, p->'lines');
    if coalesce(v_billed, 0) <= 0 then
      raise exception 'Enter the sales bill quantity against at least one line before saving';
    end if;
  else
    update public.fms_dispatch_order_items
       set bill_qty = ship_qty
     where order_id = p_order and coalesce(ship_qty, 0) > 0;
    select coalesce(sum(bill_qty), 0) into v_billed
      from public.fms_dispatch_order_items where order_id = p_order;
    if coalesce(v_billed, 0) <= 0 then
      raise exception 'Nothing is marked as going out on this round - record the material status first';
    end if;
  end if;

  -- Resolved here rather than read back out of the row: the number's month has
  -- to match the date this same statement is about to write, and depending on
  -- when a column becomes visible mid-update is how that quietly goes wrong.
  v_date := coalesce(nullif(p->>'sb_actual_date','')::date, current_date);

  -- `is null` guarded because the allocator burns a number on every call. In
  -- practice the status check above already makes a second pass impossible, but
  -- the guard is what makes that a belt AND braces rather than a coincidence.
  if v_gp is null then
    v_gp := public.fms_dispatch_gate_pass_no(v_company, v_location, v_date);
  end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = v_date,
    sb_invoice_no      = trim(p->>'sb_invoice_no'),
    sb_attachment_path = nullif(p->>'sb_attachment_path',''),
    sb_attachment_name = nullif(p->>'sb_attachment_name',''),
    sb_eway_path       = nullif(p->>'sb_eway_path',''),
    sb_eway_name       = nullif(p->>'sb_eway_name',''),
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    sb_at = coalesce(sb_at, now()), sb_by = coalesce(sb_by, v_uid),
    gp_no = coalesce(gp_no, v_gp),
    status = 'awaiting_gate_out', current_step = 'gate_out'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'billed',
    'Sales bill ' || trim(p->>'sb_invoice_no') || ' raised for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting the gate outward entry. Gate pass ' || v_gp || '.',
    public.fms_dispatch_step_owner_ids('gate_out'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round,
                       'invoice_no', trim(p->>'sb_invoice_no'), 'gate_pass_no', v_gp,
                       'billed_qty', v_billed)
  );
end $$;
grant execute on function public.fms_dispatch_record_sales_bill(uuid, jsonb) to authenticated;

-- Restated from 20260825120000 (the e-way pair) plus the billed lines.
--
-- ⚠ IT STILL MUST NOT MENTION gp_no. Editing an invoice must never renumber its
--   gate pass -- 20260822120000 asserts that at deploy time, and this file
--   re-asserts it at the foot.
create or replace function public.fms_dispatch_update_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_path text; v_billed numeric;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to edit the sales bill'; end if;
  if not public.fms_dispatch_sb_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its sales bill can no longer be changed.'; end if;
    raise exception 'The sales bill can no longer be edited: the gate outward entry has already been recorded (status %).', v_status;
  end if;
  if p ? 'sb_invoice_no' and coalesce(trim(p->>'sb_invoice_no'), '') = '' then
    raise exception 'The Tally invoice number is required';
  end if;

  -- ⚠ ATTACHMENT CONTRACT. The client OMITS the key when the stored file is being
  --   kept, so the "is it there?" test must ask what the row WOULD hold -- not
  --   what the payload carries. Testing the payload makes every remarks-only
  --   edit fail with "attach the sales invoice".
  select case when p ? 'sb_attachment_path' then nullif(p->>'sb_attachment_path','') else o.sb_attachment_path end
    into v_path from public.fms_dispatch_orders o where o.id = p_order;
  if coalesce(trim(v_path), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;

  -- ⚠ THE SAME PRESENCE CONTRACT AS THE ATTACHMENTS, and for the same reason: a
  --   remarks-only edit sends no `lines` key, and apply_bill_lines would then
  --   have nothing to re-apply after its reset. Only an edit that actually
  --   carries quantities is allowed to rewrite them.
  if p ? 'lines' then
    v_billed := public.fms_dispatch_apply_bill_lines(p_order, p->'lines');
    if coalesce(v_billed, 0) <= 0 then
      raise exception 'Enter the sales bill quantity against at least one line before saving';
    end if;
  end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = coalesce(nullif(p->>'sb_actual_date','')::date, sb_actual_date),
    sb_invoice_no      = coalesce(nullif(trim(p->>'sb_invoice_no'), ''), sb_invoice_no),
    sb_attachment_path = case when p ? 'sb_attachment_path' then nullif(p->>'sb_attachment_path','') else sb_attachment_path end,
    sb_attachment_name = case when p ? 'sb_attachment_name' then nullif(p->>'sb_attachment_name','') else sb_attachment_name end,
    sb_eway_path       = case when p ? 'sb_eway_path' then nullif(p->>'sb_eway_path','') else sb_eway_path end,
    sb_eway_name       = case when p ? 'sb_eway_name' then nullif(p->>'sb_eway_name','') else sb_eway_name end,
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'billed_edited',
    format('Sales bill on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_sales_bill(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 5. THE LEDGER. One line changes, and it is the line that makes the billed
--    quantity real everywhere: dispatched_qty is RECALCULATED, never
--    incremented, so switching its source switches every derived figure --
--    pending, headroom, the closed/looped decision -- in one place.
-- ===========================================================================
create or replace function public.fms_dispatch_recalc_dispatched(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.fms_dispatch_order_items li
     set dispatched_qty = coalesce((
           select sum(coalesce(ri.bill_qty, ri.ship_qty))
             from public.fms_dispatch_round_items ri
             join public.fms_dispatch_rounds r on r.id = ri.round_id
            where ri.order_item_id = li.id
              and r.order_id = p_order
              and r.dc_status = 'delivered'
         ), 0)
   where li.order_id = p_order;
end $$;
revoke all on function public.fms_dispatch_recalc_dispatched(uuid) from public, authenticated;

-- ===========================================================================
-- 6. THE ARCHIVE. Restated from 20260921140000 -- which reads mst_items rather
--    than the retired fms_dispatch_items master, a fact that file asserts at
--    deploy time -- with bill_qty carried in and wiped out.
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

-- ===========================================================================
-- 7. STEP 6 -- CONFIRMATION ON DISPATCH. Restated from 20260831120000; every
--    read of ship_qty becomes coalesce(bill_qty, ship_qty), so the pending
--    balance, the credit headroom and the closed/looped decision are all worked
--    out from what was actually invoiced.
-- ===========================================================================
create or replace function public.fms_dispatch_record_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_raiser uuid; v_round integer; v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_pending numeric; v_reason text; v_round_id uuid; v_shipped numeric;
  v_allow numeric; v_headroom numeric; v_to_credit boolean; v_pages jsonb;
begin
  select status, order_no, raised_by, round_no, cc_approved_qty
    into v_status, v_no, v_raiser, v_round, v_allow
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_dispatch_confirm' then raise exception 'This order is not awaiting delivery confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('dispatch_confirm', p_order, v_uid) then raise exception 'Not authorized to confirm the dispatch'; end if;
  if v_dc is null or v_dc not in ('delivered','returned') then
    raise exception 'Record the delivery outcome: Delivered or Returned';
  end if;
  if coalesce(trim(p->>'dc_attachment_path'), '') = '' then
    raise exception 'Attach the receiver copy or LR before saving';
  end if;

  -- ⚠ THERE IS NO EQUIVALENT CHECK FOR THE EXTRA PAGES, and adding one would
  --   stop every single-page LR at the delivery desk. Page one is the record;
  --   the back of the sheet is evidence, not a rule.
  --
  -- Normalised HERE, after the authorisation and outcome checks, so a caller
  -- who may not act on this step is told that, and not handed a shape error.
  v_pages := public.fms_dispatch_doc_pages(p->'dc_attachment_pages',
                                           nullif(p->>'dc_attachment_path',''));

  -- Last line of defence against an empty consignment reaching the archive.
  -- Reads the BILLED figure: a round where everything was released but nothing
  -- invoiced settles nothing, and letting it archive would close the order on a
  -- delivery of zero.
  select coalesce(sum(coalesce(bill_qty, ship_qty)), 0) into v_shipped
    from public.fms_dispatch_order_items where order_id = p_order;
  if v_shipped <= 0 then
    raise exception 'Nothing is marked as going out on this round - correct the material status first';
  end if;

  -- Plain assignment for the pages, not a presence-CASE like the edit path
  -- below: this function is reachable only at awaiting_dispatch_confirm, where
  -- the archive wipe has already nulled the column, so there is nothing to
  -- keep. That is exactly how dc_attachment_path itself is written here.
  update public.fms_dispatch_orders set
    dc_actual_date      = coalesce(nullif(p->>'dc_actual_date','')::date, current_date),
    dc_status           = v_dc,
    dc_attachment_path  = nullif(p->>'dc_attachment_path',''),
    dc_attachment_name  = nullif(p->>'dc_attachment_name',''),
    dc_attachment_pages = v_pages,
    dc_remarks          = nullif(trim(p->>'dc_remarks'), ''),
    dc_at = coalesce(dc_at, now()), dc_by = coalesce(dc_by, v_uid)
  where id = p_order;

  -- What will still be owed once this round is counted. Worked out BEFORE the
  -- archive, because the archived row has to carry the answer as its reason --
  -- and fms_dispatch_rounds is written once, not updated afterwards.
  -- A Returned round contributes nothing: the goods came back.
  select coalesce(sum(greatest(
           li.quantity - li.dispatched_qty
             - (case when v_dc = 'delivered' then coalesce(li.bill_qty, li.ship_qty, 0) else 0 end), 0)), 0)
    into v_pending
    from public.fms_dispatch_order_items li where li.order_id = p_order;

  -- ...and how much of the credit ceiling this round will have used up. Same
  -- projection, same reason. Null ceiling ⇒ null headroom ⇒ nothing to ask
  -- credit about, which is exactly how every pre-partial order behaves.
  --
  -- ⚠ A RETURNED round leaves headroom untouched, so it goes back to the store
  --   and not to credit. Credit released the quantity; it simply came home.
  if v_allow is null then
    v_headroom := null;
  else
    select v_allow - coalesce(sum(li.dispatched_qty
             + (case when v_dc = 'delivered' then coalesce(li.bill_qty, li.ship_qty, 0) else 0 end)), 0)
      into v_headroom
      from public.fms_dispatch_order_items li where li.order_id = p_order;
  end if;

  v_reason := case when v_pending <= 0 then 'closed' else 'looped' end;
  v_to_credit := (v_pending > 0 and v_headroom is not null and v_headroom <= 0);

  v_round_id := public.fms_dispatch_archive_round(p_order, v_reason);
  perform public.fms_dispatch_recalc_dispatched(p_order);

  if v_reason = 'closed' then
    update public.fms_dispatch_orders set
      status = 'closed', current_step = 'dispatch_confirm',
      closed_at = coalesce(closed_at, now())
    where id = p_order;

    perform public.fms_dispatch_announce(
      'order', p_order, 'dispatched',
      'Order ' || coalesce(v_no,'') || ' delivered in full and closed.',
      array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'dc_status', v_dc, 'round_no', v_round)
    );

  elsif v_to_credit then
    -- BACK TO CREDIT. Everything credit released has now gone out, so the
    -- balance has never been approved by anyone and must not move until it is.
    --
    -- ⚠ cc_approved_qty IS KEPT. It is the cumulative record of what credit has
    --   authorised over this order's life; the next decision adds to it. What is
    --   cleared is the DECISION -- outcome, remark, stamps and round -- so the
    --   step reads as genuinely open again and its SLA clock starts from the new
    --   round rather than from the order's receipt.
    update public.fms_dispatch_orders set
      round_no = round_no + 1,
      round_started_at = now(),
      status = 'awaiting_credit_check', current_step = 'credit_check',
      cc_status = null, cc_remarks = null, cc_round_no = null,
      cc_at = null, cc_by = null,
      cc_decided_at = null, cc_decided_by = null,
      cc_edited_at = null, cc_edited_by = null
    where id = p_order;

    perform public.fms_dispatch_announce(
      'order', p_order,
      case when v_dc = 'returned' then 'dispatch_returned' else 'dispatched' end,
      'Round ' || v_round || ' of ' || coalesce(v_no,'an order')
        || case when v_dc = 'returned' then ' came back - the consignment was returned. '
                else ' was delivered. ' end
        || trim(to_char(v_pending,'FM999999990.###'))
        || ' still pending and the approved quantity is used up - back to the credit check.',
      public.fms_dispatch_step_owner_ids('credit_check') || array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'dc_status', v_dc, 'round_no', v_round, 'pending_qty', v_pending)
    );

  else
    -- LOOP BACK. `current_step` matters as much as `status`: the alert builder
    -- keys its headline and its deep link off current_step, so leaving it on
    -- dispatch_confirm sends everyone to the wrong queue.
    update public.fms_dispatch_orders set
      round_no = round_no + 1,
      round_started_at = now(),
      status = 'awaiting_material_status', current_step = 'material_status'
    where id = p_order;

    -- Announced with the round number CAPTURED BEFORE the increment, or the
    -- email about round 1 arrives headed "Round 2".
    perform public.fms_dispatch_announce(
      'order', p_order,
      case when v_dc = 'returned' then 'dispatch_returned' else 'dispatched' end,
      'Round ' || v_round || ' of ' || coalesce(v_no,'an order')
        || case when v_dc = 'returned' then ' came back - the consignment was returned. '
                else ' was delivered. ' end
        || trim(to_char(v_pending,'FM999999990.###')) || ' still pending - back to the material-status check.',
      public.fms_dispatch_step_owner_ids('material_status') || array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'dc_status', v_dc, 'round_no', v_round, 'pending_qty', v_pending)
    );
  end if;
end $$;
grant execute on function public.fms_dispatch_record_dispatch_confirm(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 8. CORRECT A FINISHED ROUND. Restated from 20260831120100.
--
--    ⚠ IT NOW CORRECTS bill_qty, NOT ship_qty, and that is the right column:
--      the modal asks "what was actually delivered", and delivered is what the
--      ledger settles -- which is now the billed figure. ship_qty stays as the
--      frozen record of what physically left the gate, so a correction no longer
--      rewrites history it was never asking about.
--
--    The payload still accepts the old `ship_qty` key so a stale client is not
--    silently ignored; `bill_qty` wins when both are present.
-- ===========================================================================
create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;
grant execute on function public.fms_dispatch_amend_round(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 9. ASSERTIONS. Each one guards an invariant an obvious-looking future edit
--    would undo, and each fails the DEPLOY rather than a click months later.
-- ===========================================================================
do $check$
declare v_src text; v_bad int;
begin
  -- Carried forward from 20260822120000 / 20260928120000: editing an invoice
  -- must never renumber its gate pass.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_sales_bill';
  if v_src ~* 'gp_no' then
    raise exception 'fms_dispatch_update_sales_bill now writes gp_no - editing an invoice must NOT renumber its gate pass';
  end if;

  -- Carried forward from 20260921140000: the archive must read the LIVE items
  -- master, not the retired one, or every frozen name becomes "Item".
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
       and p.prosrc ~ 'join public\.fms_dispatch_items'
  ) then
    raise exception 'CHECK FAILED: fms_dispatch_archive_round still joins the frozen items master';
  end if;

  -- NEW: the ledger must settle on the billed figure. Reverting this one line
  -- silently restores the old behaviour with no other visible symptom.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_recalc_dispatched';
  if v_src !~* 'bill_qty' then
    raise exception 'CHECK FAILED: fms_dispatch_recalc_dispatched no longer reads bill_qty - the ledger would settle on what was picked, not what was billed';
  end if;

  -- NEW: the backfill must have left no delivered round unaccounted for, or
  -- every closed order would re-open the next time anything recalculates.
  select count(*) into v_bad
    from public.fms_dispatch_round_items
   where bill_qty is null;
  if v_bad <> 0 then
    raise exception 'CHECK FAILED: % archived round items still have a null bill_qty', v_bad;
  end if;
end $check$;

commit;
