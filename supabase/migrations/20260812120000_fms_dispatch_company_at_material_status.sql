-- ===========================================================================
-- ORDER TO DISPATCH — THE BILLING COMPANY IS CHOSEN AT THE STOCK CHECK.
--
-- WHAT CHANGED AND WHY
--   `company_id` was retired from intake (20260811120200) because it was derived
--   from a customer→company mapping that never varied and blocked raising an
--   order when somebody forgot to set it. Nobody was deciding it.
--
--   It is now a DECISION, made by the person who checks material status: they see
--   what is physically going out and say which of our entities invoices it. That
--   is the right moment — it is the last point before the sales bill, and it is
--   per CONSIGNMENT, so a part-shipped order can bill its rounds differently.
--
-- ⚠ NOTHING IS ADDED OR DROPPED. `fms_dispatch_orders.company_id` and
--   `fms_dispatch_rounds.company_id` both already exist and are nullable, and
--   fms_dispatch_archive_round already copies the order's value onto the round.
--   This migration only makes the material-status RPCs WRITE it, and clears it
--   with the rest of the step block when a round is archived.
--
-- ⚠ EXISTING ORDERS ARE UNTOUCHED. Anything already past the stock check keeps
--   whatever company_id it holds (null for orders raised after the mapping was
--   retired). The new requirement binds only from the next stock check onward.
-- ===========================================================================

begin;

comment on column public.fms_dispatch_orders.company_id is
  'The entity that bills the round in progress. Chosen at the material-status step, archived onto the round, then cleared with the rest of the step block.';

-- ---------------------------------------------------------------------------
-- 1. Archiving a round clears the company along with the rest of the step block.
--    Without this the next round silently inherits the last round''s company and
--    the "decision" is only a decision the first time.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id,
    ms_actual_date, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name, sb_remarks, sb_at, sb_by,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id,
    o.ms_actual_date, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name, o.sb_remarks, o.sb_at, o.sb_by,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  -- Only lines that actually went out. That set IS "this round's consignment",
  -- which is what the sales-bill and delivery screens render.
  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name, unit_id,
    ordered_qty, ship_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    coalesce(it.name, 'Item'), un.name, li.unit_id,
    li.quantity, li.ship_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.fms_dispatch_items it on it.id = li.item_id
  left join public.fms_dispatch_units un on un.id = li.unit_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- WIPE. This is the half people forget, and forgetting it makes every closed
  -- order exist twice: once in the archive and once on the header.
  update public.fms_dispatch_orders set
    company_id = null,
    ms_actual_date = null, ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_remarks = null, sb_at = null, sb_by = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end $$;
revoke all on function public.fms_dispatch_archive_round(uuid, text) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Recording the stock check now takes — and requires — the billing company.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_record_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_round integer; v_uid uuid := auth.uid();
  v_total numeric; v_company uuid;
begin
  select status, order_no, round_no into v_status, v_no, v_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_material_status' then raise exception 'This order is not awaiting the material-status check (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to record the material status'; end if;

  -- The billing company. Validated against the master rather than merely cast, so
  -- a stale id from a long-open tab is refused here instead of writing a company
  -- that no longer exists onto the invoice.
  v_company := nullif(trim(p->>'ms_company_id'), '')::uuid;
  if v_company is null then
    raise exception 'Choose the company that bills this consignment';
  end if;
  if not exists (select 1 from public.fms_dispatch_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- Lines first, then validate what they add up to: "at least one line is going
  -- out" is a fact about the lines, so it cannot be checked before they land.
  v_total := public.fms_dispatch_apply_ship_lines(p_order, p->'lines');
  if coalesce(v_total, 0) <= 0 then
    raise exception 'Enter the quantity going out on at least one line, or use "Nothing available yet"';
  end if;

  update public.fms_dispatch_orders set
    company_id     = v_company,
    ms_actual_date = coalesce(nullif(p->>'ms_actual_date','')::date, current_date),
    ms_remarks     = nullif(trim(p->>'ms_remarks'), ''),
    ms_at = coalesce(ms_at, now()), ms_by = coalesce(ms_by, v_uid),
    status = 'awaiting_sales_bill', current_step = 'sales_bill'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'material_checked',
    'Stock confirmed on ' || coalesce(v_no,'an order') || ' (round ' || v_round || ', '
      || trim(to_char(v_total,'FM999999990.###')) || ' going out) - the sales bill can be raised.',
    public.fms_dispatch_step_owner_ids('sales_bill'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'ship_qty', v_total)
  );
end $$;
grant execute on function public.fms_dispatch_record_material_status(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Editing the stock check can move the company too — while it is still editable
--    (i.e. before the sales bill is raised against it).
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_update_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid(); v_total numeric; v_company uuid;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to edit the material status'; end if;
  if not public.fms_dispatch_ms_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its material status can no longer be changed.'; end if;
    raise exception 'The material status can no longer be edited: the sales bill has already been recorded (status %).', v_status;
  end if;

  -- ⚠ Ask what the ROW WOULD HOLD, not what the payload carries. An omitted key
  --   means "keep what is stored" — testing the payload alone would make an
  --   older client's remarks-only edit fail with "choose the company".
  select case when p ? 'ms_company_id' then nullif(trim(p->>'ms_company_id'),'')::uuid else o.company_id end
    into v_company from public.fms_dispatch_orders o where o.id = p_order;
  if v_company is null then
    raise exception 'Choose the company that bills this consignment';
  end if;
  if not exists (select 1 from public.fms_dispatch_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  v_total := public.fms_dispatch_apply_ship_lines(p_order, p->'lines');
  -- ⚠ The SAME assertion as the record path. Without it an edit could empty the
  --   consignment, and the order would walk to delivery having shipped nothing,
  --   archive an empty round and loop for ever.
  if coalesce(v_total, 0) <= 0 then
    raise exception 'At least one line must still be going out on this round';
  end if;

  update public.fms_dispatch_orders set
    company_id     = v_company,
    ms_actual_date = coalesce(nullif(p->>'ms_actual_date','')::date, ms_actual_date),
    ms_remarks     = nullif(trim(p->>'ms_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'material_checked_edited',
    format('Material status on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_material_status(uuid, jsonb) to authenticated;

commit;
