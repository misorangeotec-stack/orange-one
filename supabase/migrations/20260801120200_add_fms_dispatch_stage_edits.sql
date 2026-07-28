-- ===========================================================================
-- ORDER TO DISPATCH FMS — edit-until-the-next-step.
--
-- The twin of production 20260725120200 / sampling 20260724120200. Each stage
-- screen is a pending-only queue; the instant an owner acts, the row leaves it.
-- These predicates + RPCs let an owner see and CORRECT what they did — but only
-- until the next step is done.
--
-- HOW "editable until the next step" maps to the linear status machine:
--   credit_check     editable while status='awaiting_material_status'
--   material_status  editable while status='awaiting_lot_confirm'
--   lot_confirm      editable while status='awaiting_sales_bill'
--   sales_bill       editable while status='awaiting_gate_out'
--   gate_out         editable while status='awaiting_dispatch_confirm'
--   dispatch_confirm the LAST step — nothing downstream can lock it, so it STAYS
--                      editable after the order closes (safe: there is no derived
--                      stage machine to drift). Only on_hold / cancelled lock it.
--
-- Every RPC: authorized exactly like its create twin · re-checks the lock
-- SERVER-side (the disabled button is a courtesy, never the gate) · takes a row
-- lock · writes edited_at/edited_by (kept SEPARATE from the step's own *_at/*_by
-- attribution, which is history) · and announces IN THIS TRANSACTION with an
-- EMPTY recipient list, so a correction lands on the audit trail without paging
-- anyone (and `%edited` types are suppressed from email downstream).
--
-- ⚠ ATTACHMENT CONTRACT, repeated here because it is the easiest thing to get
--   wrong: the client OMITS `*_attachment_path` / `*_attachment_name` when the
--   existing file is being kept. So every attachment column is written through
--   `case when p ? '<key>' then … else <column> end` — a blank-string test would
--   wipe the invoice or the receiver copy on every remark-only edit.
--
-- Additive / replace-only. Apply BEFORE the frontend that reads these.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- credit_check
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_cc_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.cc_at is not null and o.status = 'awaiting_material_status');
$$;
grant execute on function public.fms_dispatch_cc_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_credit_check(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_cc text := nullif(trim(p->>'cc_status'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('credit_check', p_order, v_uid) then raise exception 'Not authorized to edit the credit confirmation'; end if;
  if not public.fms_dispatch_cc_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its credit confirmation can no longer be changed.'; end if;
    raise exception 'The credit confirmation can no longer be edited: the material-status check has already been recorded (status %).', v_status;
  end if;
  if v_cc is not null and v_cc not in ('credit_available','payment_required') then
    raise exception 'The credit outcome must be Credit Available or Payment Required';
  end if;

  update public.fms_dispatch_orders set
    cc_actual_date        = coalesce(nullif(p->>'cc_actual_date','')::date, cc_actual_date),
    cc_status             = coalesce(v_cc, cc_status),
    cc_payment_term_id    = nullif(p->>'cc_payment_term_id','')::uuid,
    cc_credit_limit       = nullif(p->>'cc_credit_limit','')::numeric,
    cc_outstanding_amount = nullif(p->>'cc_outstanding_amount','')::numeric,
    cc_payment_ref        = nullif(trim(p->>'cc_payment_ref'), ''),
    cc_payment_amount     = nullif(p->>'cc_payment_amount','')::numeric,
    cc_remarks            = nullif(trim(p->>'cc_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'credit_checked_edited',
    format('Credit confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_credit_check(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- material_status
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_ms_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.ms_at is not null and o.status = 'awaiting_lot_confirm');
$$;
grant execute on function public.fms_dispatch_ms_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_ms text := nullif(trim(p->>'ms_status'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to edit the material status'; end if;
  if not public.fms_dispatch_ms_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its material status can no longer be changed.'; end if;
    raise exception 'The material status can no longer be edited: LOT confirmation has already been recorded (status %).', v_status;
  end if;
  if v_ms is not null and v_ms not in ('available_for_dispatch','production_required') then
    raise exception 'The material status must be Available for Dispatch or Production Required';
  end if;

  update public.fms_dispatch_orders set
    ms_actual_date           = coalesce(nullif(p->>'ms_actual_date','')::date, ms_actual_date),
    ms_status                = coalesce(v_ms, ms_status),
    ms_godown_id             = nullif(p->>'ms_godown_id','')::uuid,
    ms_planned_dispatch_date = nullif(p->>'ms_planned_dispatch_date','')::date,
    ms_remarks               = nullif(trim(p->>'ms_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_apply_ms_lines(p_order, p->'lines');

  perform public.fms_dispatch_announce('order', p_order, 'material_checked_edited',
    format('Material status on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_material_status(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- lot_confirm
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_lc_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.lc_at is not null and o.status = 'awaiting_sales_bill');
$$;
grant execute on function public.fms_dispatch_lc_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_lot_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_filled integer;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('lot_confirm', p_order, v_uid) then raise exception 'Not authorized to edit the LOT confirmation'; end if;
  if not public.fms_dispatch_lc_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its LOT confirmation can no longer be changed.'; end if;
    raise exception 'The LOT confirmation can no longer be edited: the sales bill has already been raised (status %).', v_status;
  end if;

  perform public.fms_dispatch_apply_lc_lines(p_order, p->'lines');

  select count(*) into v_filled
    from public.fms_dispatch_order_items
   where order_id = p_order and coalesce(final_qty, 0) > 0;
  if v_filled = 0 then
    raise exception 'At least one line must keep a final dispatch quantity greater than zero';
  end if;

  update public.fms_dispatch_orders set
    lc_actual_date = coalesce(nullif(p->>'lc_actual_date','')::date, lc_actual_date),
    lc_status      = nullif(trim(p->>'lc_status'), ''),
    lc_remarks     = nullif(trim(p->>'lc_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'lot_confirmed_edited',
    format('LOT confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_lot_confirm(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- sales_bill
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_sb_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.sb_at is not null and o.status = 'awaiting_gate_out');
$$;
grant execute on function public.fms_dispatch_sb_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to edit the sales bill'; end if;
  if not public.fms_dispatch_sb_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its sales bill can no longer be changed.'; end if;
    raise exception 'The sales bill can no longer be edited: the gate-out entry has already been recorded (status %).', v_status;
  end if;
  if p ? 'sb_invoice_no' and coalesce(trim(p->>'sb_invoice_no'), '') = '' then
    raise exception 'The sales invoice number is required';
  end if;

  update public.fms_dispatch_orders set
    sb_actual_date       = coalesce(nullif(p->>'sb_actual_date','')::date, sb_actual_date),
    sb_status            = nullif(trim(p->>'sb_status'), ''),
    sb_company_id        = nullif(p->>'sb_company_id','')::uuid,
    sb_invoice_series_id = nullif(p->>'sb_invoice_series_id','')::uuid,
    sb_invoice_no        = coalesce(nullif(trim(p->>'sb_invoice_no'), ''), sb_invoice_no),
    sb_invoice_date      = nullif(p->>'sb_invoice_date','')::date,
    sb_invoice_value     = nullif(p->>'sb_invoice_value','')::numeric,
    sb_attachment_path   = case when p ? 'sb_attachment_path'
                                then nullif(p->>'sb_attachment_path','') else sb_attachment_path end,
    sb_attachment_name   = case when p ? 'sb_attachment_name'
                                then nullif(p->>'sb_attachment_name','') else sb_attachment_name end,
    sb_remarks           = nullif(trim(p->>'sb_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'billed_edited',
    format('Sales bill on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_sales_bill(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- gate_out. The gate pass number is NEVER rewritten by an edit — it has already
-- been handed to a driver on paper.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_go_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.go_at is not null and o.status = 'awaiting_dispatch_confirm');
$$;
grant execute on function public.fms_dispatch_go_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to edit the gate-out entry'; end if;
  if not public.fms_dispatch_go_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its gate-out entry can no longer be changed.'; end if;
    raise exception 'The gate-out entry can no longer be edited: the delivery has already been confirmed (status %).', v_status;
  end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, go_actual_date),
    go_status      = nullif(trim(p->>'go_status'), ''),
    go_gate_id     = nullif(p->>'go_gate_id','')::uuid,
    go_godown_id   = nullif(p->>'go_godown_id','')::uuid,
    go_vehicle_id  = nullif(p->>'go_vehicle_id','')::uuid,
    go_driver_id   = nullif(p->>'go_driver_id','')::uuid,
    go_out_at      = nullif(p->>'go_out_at','')::timestamptz,
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'gate_out_edited',
    format('Gate-out entry on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_gate_out(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_confirm — the LAST step. Nothing downstream can lock it, so it stays
-- editable after the order closes; only hold / cancel lock it. The Local vs
-- Transport branch is re-validated here too, because an edit could otherwise
-- blank the very field the table CHECK requires and fail with a constraint name
-- instead of a sentence.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_dc_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.dc_at is not null and o.status = 'closed');
$$;
grant execute on function public.fms_dispatch_dc_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_type text; v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_lr text; v_rcv text; v_tr text;
begin
  select status, order_no, dispatch_type into v_status, v_no, v_type
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('dispatch_confirm', p_order, v_uid) then raise exception 'Not authorized to edit the delivery confirmation'; end if;
  if not public.fms_dispatch_dc_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its delivery confirmation can no longer be changed.'; end if;
    raise exception 'The delivery confirmation has not been recorded yet.';
  end if;
  if v_dc is not null and v_dc not in ('delivered','partially_delivered','returned') then
    raise exception 'The delivery outcome must be Delivered, Partially Delivered or Returned';
  end if;

  -- Resolve what the row WOULD hold after this edit, then branch-check that.
  select case when p ? 'dc_lr_no' then nullif(trim(p->>'dc_lr_no'), '') else dc_lr_no end,
         case when p ? 'dc_receiver_name' then nullif(trim(p->>'dc_receiver_name'), '') else dc_receiver_name end,
         case when p ? 'dc_transporter_id' then nullif(p->>'dc_transporter_id','') else dc_transporter_id::text end
    into v_lr, v_rcv, v_tr
  from public.fms_dispatch_orders where id = p_order;

  if v_type = 'transport' then
    if v_lr is null then raise exception 'LR number is required for a Transport dispatch'; end if;
    if v_tr is null then raise exception 'Transporter is required for a Transport dispatch'; end if;
  else
    if v_rcv is null then raise exception 'Receiver name is required for a Local dispatch'; end if;
  end if;

  update public.fms_dispatch_orders set
    dc_actual_date    = coalesce(nullif(p->>'dc_actual_date','')::date, dc_actual_date),
    dc_status         = coalesce(v_dc, dc_status),
    dc_receiver_name  = v_rcv,
    dc_received_at    = nullif(p->>'dc_received_at','')::timestamptz,
    dc_driver_id      = nullif(p->>'dc_driver_id','')::uuid,
    dc_transporter_id = v_tr::uuid,
    dc_lr_no          = v_lr,
    dc_lr_date        = nullif(p->>'dc_lr_date','')::date,
    dc_freight_amount = nullif(p->>'dc_freight_amount','')::numeric,
    dc_attachment_path = case when p ? 'dc_attachment_path'
                              then nullif(p->>'dc_attachment_path','') else dc_attachment_path end,
    dc_attachment_name = case when p ? 'dc_attachment_name'
                              then nullif(p->>'dc_attachment_name','') else dc_attachment_name end,
    dc_remarks        = nullif(trim(p->>'dc_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'dispatched_edited',
    format('Delivery confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_dispatch_confirm(uuid, jsonb) to authenticated;
