-- ===========================================================================
-- ORDER TO DISPATCH FMS — RESHAPE, PART 2 of 4: EVERY FUNCTION, RE-ISSUED.
--
-- ⚠ WHY *EVERY* FUNCTION AND NOT JUST THE CHANGED ONES
--   Postgres records NO dependency from a PL/pgSQL body to a column. Migration 1
--   dropped ~40 columns; every function that named one still exists, still
--   creates cleanly, and fails only when a human clicks the button. So each
--   function below that mentioned a dropped column, a dropped status value or a
--   dropped table is rewritten here — including several whose logic is unchanged.
--
-- THE ROUND MACHINE (see migration 1's header for the two rules)
--   record_dispatch_confirm is the only place the chain branches:
--     stamp dc_* → work out whether anything is still owed → archive the round
--     with that answer as its reason → RECALCULATE dispatched_qty from the
--     archive → wipe the header → close, or start round N+1.
--
-- CREDIT IS DECIDED ONCE PER ORDER
--   cc_decided_at = when the outcome was last set (Approve or On hold).
--   cc_at         = STEP COMPLETION, stamped on Approve only.
--   An on-hold order therefore keeps status='awaiting_credit_check' and stays in
--   the pending queue with cc_at null — which is exactly what was asked for.
-- ===========================================================================

do $$
declare v_o bigint;
begin
  select count(*) into v_o from public.fms_dispatch_orders;
  if v_o > 0 then
    raise exception 'Order to Dispatch holds % order(s). Apply the reshape set only to the never-seeded module.', v_o;
  end if;
end $$;

-- ===========================================================================
-- 0. REMOVE THE LOT-CONFIRMATION STEP AND THE OLD LINE WRITERS
-- ===========================================================================
drop function if exists public.fms_dispatch_record_lot_confirm(uuid, jsonb);
drop function if exists public.fms_dispatch_update_lot_confirm(uuid, jsonb);
drop function if exists public.fms_dispatch_lc_editable(uuid);
drop function if exists public.fms_dispatch_apply_lc_lines(uuid, jsonb);
drop function if exists public.fms_dispatch_apply_ms_lines(uuid, jsonb);

-- ===========================================================================
-- 1. AUTHORIZATION
-- ===========================================================================

-- The gate every workflow RPC calls: admin / coordinator / the step's owner.
--
-- ⚠ THE DRIVER ARM IS GONE. It let the driver named on the gate-out entry
--   confirm their own delivery. Gate-out no longer records a driver and the
--   Drivers master is deleted, so the arm referenced three objects that no
--   longer exist. CONSEQUENCE: `dispatch_confirm` now needs a configured step
--   owner. Seed one before go-live or the last step falls back to admins only.
create or replace function public.fms_dispatch_can_act(p_step_key text, p_order uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(p_uid)
      or public.fms_dispatch_is_coordinator(p_uid)
      or public.fms_dispatch_is_step_owner(p_step_key, p_uid);
$$;
grant execute on function public.fms_dispatch_can_act(text, uuid, uuid) to authenticated;

-- Where a held order goes back to — derived from the CURRENT round's own
-- timestamps. After a loop-back those are all null again except cc_at, so this
-- lands on 'awaiting_material_status' with no round-awareness needed.
create or replace function public.fms_dispatch_resume_status(p_order uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when o.status = 'closed'    then 'closed'
    when o.dc_at is not null    then 'closed'
    when o.go_at is not null    then 'awaiting_dispatch_confirm'
    when o.sb_at is not null    then 'awaiting_gate_out'
    when o.ms_at is not null    then 'awaiting_sales_bill'
    when o.cc_at is not null    then 'awaiting_material_status'
    else 'awaiting_credit_check'
  end
  from public.fms_dispatch_orders o where o.id = p_order;
$$;
grant execute on function public.fms_dispatch_resume_status(uuid) to authenticated;

-- ===========================================================================
-- 2. THE TWO ROUND HELPERS
--
-- ⚠ Both are SECURITY DEFINER with no authorization check of their own, exactly
--   like the line helpers they join. Their EXECUTE grant is deliberately NOT
--   given to `authenticated`: their callers are themselves SECURITY DEFINER and
--   run as owner, so the grant buys nothing and would let anyone rewrite the
--   dispatch ledger with a direct PostgREST call. See section 3.
-- ===========================================================================

-- THE definition of "how much of this line has been delivered": the sum of what
-- shipped on rounds whose outcome was 'delivered'. Recalculated, never
-- incremented — so an edit, a correction or a re-run can never double-count and
-- the number can never drift from the history it is supposed to summarise.
create or replace function public.fms_dispatch_recalc_dispatched(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.fms_dispatch_order_items li
     set dispatched_qty = coalesce((
           select sum(ri.ship_qty)
             from public.fms_dispatch_round_items ri
             join public.fms_dispatch_rounds r on r.id = ri.round_id
            where ri.order_item_id = li.id
              and r.order_id = p_order
              and r.dc_status = 'delivered'
         ), 0)
   where li.order_id = p_order;
end $$;
revoke all on function public.fms_dispatch_recalc_dispatched(uuid) from public, authenticated;

-- Freeze the current round into the archive and WIPE the order's step block.
-- Called on every path that ends a round: delivery confirmed (looped or closed)
-- and cancellation part-way through.
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

-- ===========================================================================
-- 3. LINE HELPERS
-- ===========================================================================

-- Replace an order's whole line set. Reachable only while the order is still at
-- the origin step, but guarded anyway: it DELETEs and re-INSERTs, which would
-- reset dispatched_qty and orphan the archive's line references.
create or replace function public.fms_dispatch_replace_lines(p_order uuid, p_lines jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare l jsonb; v_n integer := 0;
begin
  if exists (select 1 from public.fms_dispatch_rounds where order_id = p_order) then
    raise exception 'The items cannot be changed - a dispatch has already gone out on this order';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'At least one item line is required';
  end if;

  delete from public.fms_dispatch_order_items where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    -- Skip the trailing blank row the shared LineGrid always keeps at the bottom.
    if coalesce(trim(l->>'item_id'), '') = '' then continue; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then
      raise exception 'Every item line needs a quantity greater than zero';
    end if;

    v_n := v_n + 1;
    insert into public.fms_dispatch_order_items (order_id, line_no, item_id, quantity, unit_id, line_remark)
    values (
      p_order, v_n,
      (l->>'item_id')::uuid,
      (l->>'quantity')::numeric,
      nullif(l->>'unit_id','')::uuid,
      nullif(trim(l->>'line_remark'), '')
    );
  end loop;

  if v_n = 0 then raise exception 'At least one item line is required'; end if;
  return v_n;
end $$;
-- ⚠ SECURITY: previously granted to `authenticated`, which let any signed-in
--   user POST to this RPC with someone else's order id. Its only callers are
--   SECURITY DEFINER and run as owner, so the grant was never needed.
revoke all on function public.fms_dispatch_replace_lines(uuid, jsonb) from public, authenticated;

-- Write THIS ROUND's selection: which lines are going out, how much, which LOT.
-- Replaces fms_dispatch_apply_ms_lines, which only PATCHED the lines present in
-- the payload — with rounds that leaves a stale ship_qty on a line the person
-- just took back off the consignment.
create or replace function public.fms_dispatch_apply_ship_lines(p_order uuid, p_lines jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  l jsonb; v_id uuid; v_qty numeric; v_pending numeric; v_item text; v_total numeric := 0;
begin
  -- ⚠ The blanket clear below is destructive, so a payload that carries NO line
  --   data must return before it. Otherwise a remarks-only call silently empties
  --   the round, and the order loops for ever shipping nothing while burning an
  --   invoice number and an outward number each time.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    select coalesce(sum(ship_qty), 0) into v_total
      from public.fms_dispatch_order_items where order_id = p_order;
    return v_total;
  end if;

  -- A line ABSENT from the payload is a line NOT going out this round. Clearing
  -- first is what makes that expressible at all.
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
      left join public.fms_dispatch_items it on it.id = li.item_id
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

  return v_total;
end $$;
revoke all on function public.fms_dispatch_apply_ship_lines(uuid, jsonb) from public, authenticated;

-- ===========================================================================
-- 4. INTAKE
-- ===========================================================================
drop function if exists public.fms_dispatch_submit_order(jsonb);
create or replace function public.fms_dispatch_submit_order(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_no text; v_seq integer;
  v_fy text := public.fms_dispatch_fy_code(current_date);
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p->>'requester_name'), '');
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'Not authorized to raise a sales order';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;
  if coalesce(trim(p->>'customer_id'), '') = '' then raise exception 'Customer is required'; end if;
  v_cust := (p->>'customer_id')::uuid;

  -- THE COMPANY↔CUSTOMER MAPPING. The order no longer asks which of our
  -- companies is selling — it is read from the customer master, where it is a
  -- required field. Raising against an unmapped customer would produce an
  -- invoice whose issuing entity this FMS never knew, so it is refused here.
  select c.company_id into v_company from public.fms_dispatch_customers c where c.id = v_cust;
  if v_company is null then
    raise exception 'This customer has no company mapped. Set it in Masters -> Customers before raising an order.';
  end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, customer_id, order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at
  ) values (
    v_no, v_type, v_company, v_cust,
    coalesce(nullif(p->>'order_date','')::date, current_date),
    nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_name,
    'awaiting_credit_check', 'credit_check', now(),
    1, now()
  )
  returning id into v_id;

  perform public.fms_dispatch_replace_lines(v_id, p->'lines');

  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'Sales order ' || v_no || ' raised - awaiting credit-limit confirmation.',
    public.fms_dispatch_step_owner_ids('credit_check'),
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_dispatch_submit_order(jsonb) to authenticated;

drop function if exists public.fms_dispatch_update_order(uuid, jsonb);
create or replace function public.fms_dispatch_update_order(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_cc timestamptz; v_raiser uuid; v_no text;
  v_uid uuid := auth.uid();
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid; v_held boolean;
begin
  select status, cc_at, raised_by, order_no, cc_status = 'credit_hold'
    into v_status, v_cc, v_raiser, v_no, v_held
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_credit_check' or v_cc is not null then
    raise exception 'This order can no longer be edited - the credit check has already been recorded';
  end if;
  if not (v_raiser = v_uid or public.fms_dispatch_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this order (or a coordinator) may edit it';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;

  v_cust := coalesce(nullif(p->>'customer_id','')::uuid,
                     (select customer_id from public.fms_dispatch_orders where id = p_order));
  -- Re-resolved on EVERY edit, not only when the customer changed: nothing
  -- downstream has consumed the company yet, so a snapshot from a since-changed
  -- mapping has no defender.
  select c.company_id into v_company from public.fms_dispatch_customers c where c.id = v_cust;
  if v_company is null then
    raise exception 'This customer has no company mapped. Set it in Masters -> Customers first.';
  end if;

  update public.fms_dispatch_orders set
    dispatch_type = v_type,
    company_id    = v_company,
    customer_id   = v_cust,
    order_date    = coalesce(nullif(p->>'order_date','')::date, order_date),
    order_remarks = nullif(trim(p->>'order_remarks'), ''),
    -- ⚠ Editing the goods CLEARS a credit hold. The hold and its written reason
    --   were a judgement about a specific set of items; silently carrying them
    --   over to a different set is how a hold gets bypassed by accident.
    cc_status     = case when v_held then null else cc_status end,
    cc_remarks    = case when v_held then null else cc_remarks end,
    cc_decided_at = case when v_held then null else cc_decided_at end,
    cc_decided_by = case when v_held then null else cc_decided_by end,
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  if p ? 'lines' then
    perform public.fms_dispatch_replace_lines(p_order, p->'lines');
  end if;

  perform public.fms_dispatch_announce(
    'order', p_order, 'order_edited',
    'Sales order ' || coalesce(v_no, '') || ' was edited.'
      || case when v_held then ' The credit hold on it was cleared and must be decided again.' else '' end,
    case when v_held then public.fms_dispatch_step_owner_ids('credit_check') else '{}'::uuid[] end,
    jsonb_build_object('order_no', v_no)
  );
end $$;
grant execute on function public.fms_dispatch_update_order(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 5. STEP 2 — CONFIRM CREDIT LIMIT. Approve, or hold with a reason.
-- ===========================================================================
drop function if exists public.fms_dispatch_record_credit_check(uuid, jsonb);
create or replace function public.fms_dispatch_record_credit_check(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
  v_cc text := nullif(trim(p->>'cc_status'), '');
  v_remarks text := nullif(trim(p->>'cc_remarks'), '');
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  -- Deliberately re-runnable: a held order stays at this status, so the same
  -- person comes back to this same RPC to approve it.
  if v_status <> 'awaiting_credit_check' then raise exception 'This order is not awaiting credit confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('credit_check', p_order, v_uid) then raise exception 'Not authorized to confirm the credit limit'; end if;
  if v_cc is null or v_cc not in ('approved','credit_hold') then
    raise exception 'Record the credit outcome: Approve or On hold';
  end if;
  if v_cc = 'credit_hold' and v_remarks is null then
    raise exception 'A remark is required when an order is put on hold';
  end if;

  if v_cc = 'credit_hold' then
    -- Decision recorded; the order does NOT advance. cc_at stays null, which is
    -- what keeps it in this step's pending queue rather than its Completed tab.
    update public.fms_dispatch_orders set
      cc_status = 'credit_hold', cc_remarks = v_remarks,
      cc_decided_at = now(), cc_decided_by = v_uid
    where id = p_order;

    -- Every credit decision lands on the audit trail. Without this a second
    -- approver silently overwrites the first person's hold and its reason.
    perform public.fms_dispatch_announce(
      'order', p_order, 'credit_on_hold',
      'Credit hold on ' || coalesce(v_no,'an order') || ': ' || v_remarks,
      array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'cc_status', v_cc, 'reason', v_remarks)
    );
    return;
  end if;

  update public.fms_dispatch_orders set
    cc_status = 'approved',
    -- An approve that follows a hold must not silently erase the hold's reason.
    cc_remarks = coalesce(v_remarks, cc_remarks),
    cc_decided_at = now(), cc_decided_by = v_uid,
    cc_at = coalesce(cc_at, now()), cc_by = coalesce(cc_by, v_uid),
    status = 'awaiting_material_status', current_step = 'material_status'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'credit_checked',
    'Credit approved on ' || coalesce(v_no,'an order') || ' - awaiting the material-status check.',
    public.fms_dispatch_step_owner_ids('material_status'),
    jsonb_build_object('order_no', v_no, 'cc_status', 'approved')
  );
end $$;
grant execute on function public.fms_dispatch_record_credit_check(uuid, jsonb) to authenticated;

create or replace function public.fms_dispatch_cc_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.cc_at is not null and o.status = 'awaiting_material_status');
$$;
grant execute on function public.fms_dispatch_cc_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_credit_check(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_cc text := nullif(trim(p->>'cc_status'), '');
  v_remarks text := nullif(trim(p->>'cc_remarks'), '');
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('credit_check', p_order, v_uid) then raise exception 'Not authorized to edit the credit confirmation'; end if;
  if not public.fms_dispatch_cc_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its credit confirmation can no longer be changed.'; end if;
    if v_status = 'awaiting_credit_check' then
      raise exception 'This credit decision is still open - re-record it from the Confirm Credit Limit queue instead.';
    end if;
    raise exception 'The credit confirmation can no longer be edited: the material-status check has already been recorded (status %).', v_status;
  end if;
  -- Only a recorded (approved) decision is reachable here, and un-approving it
  -- would strand an order that has already moved on.
  if v_cc is not null and v_cc <> 'approved' then
    raise exception 'An approved credit confirmation cannot be changed back to a hold - the order has already moved on.';
  end if;

  update public.fms_dispatch_orders set
    cc_remarks   = v_remarks,
    cc_edited_at = now(), cc_edited_by = v_uid,
    edited_at    = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'credit_checked_edited',
    format('Credit confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_credit_check(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 6. STEP 3 — CHECK MATERIAL STATUS. Partial selection lives here.
-- ===========================================================================
drop function if exists public.fms_dispatch_record_material_status(uuid, jsonb);
create or replace function public.fms_dispatch_record_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_uid uuid := auth.uid(); v_total numeric;
begin
  select status, order_no, round_no into v_status, v_no, v_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_material_status' then raise exception 'This order is not awaiting the material-status check (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to record the material status'; end if;

  -- Lines first, then validate what they add up to: "at least one line is going
  -- out" is a fact about the lines, so it cannot be checked before they land.
  v_total := public.fms_dispatch_apply_ship_lines(p_order, p->'lines');
  if coalesce(v_total, 0) <= 0 then
    raise exception 'Enter the quantity going out on at least one line, or use "Nothing available yet"';
  end if;

  update public.fms_dispatch_orders set
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

-- "Nothing available yet" — the store checked and found no stock.
--
-- WHY THIS EXISTS: without it the store keeper has no legal action while goods
-- are in production. The order would sit at this step with its clock running and
-- go permanently red, which is indistinguishable from an abandoned order.
-- Re-stamping round_started_at restarts the clock, so waiting is visible as
-- waiting rather than as lateness.
create or replace function public.fms_dispatch_material_nothing_available(p_order uuid, p_remarks text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_uid uuid := auth.uid();
begin
  select status, order_no, round_no into v_status, v_no, v_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_material_status' then raise exception 'This order is not awaiting the material-status check (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to record the material status'; end if;

  update public.fms_dispatch_orders set
    ms_remarks = nullif(trim(p_remarks), ''),
    round_started_at = now()
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'material_pending',
    'Stock checked on ' || coalesce(v_no,'an order') || ' (round ' || v_round || ') - nothing available yet'
      || coalesce(': ' || nullif(trim(p_remarks), ''), '') || '.',
    '{}'::uuid[],
    jsonb_build_object('order_no', v_no, 'round_no', v_round)
  );
end $$;
grant execute on function public.fms_dispatch_material_nothing_available(uuid, text) to authenticated;

create or replace function public.fms_dispatch_ms_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.ms_at is not null and o.status = 'awaiting_sales_bill');
$$;
grant execute on function public.fms_dispatch_ms_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_total numeric;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to edit the material status'; end if;
  if not public.fms_dispatch_ms_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its material status can no longer be changed.'; end if;
    raise exception 'The material status can no longer be edited: the sales bill has already been recorded (status %).', v_status;
  end if;

  v_total := public.fms_dispatch_apply_ship_lines(p_order, p->'lines');
  -- ⚠ The SAME assertion as the record path. Without it an edit could empty the
  --   consignment, and the order would walk to delivery having shipped nothing,
  --   archive an empty round and loop for ever.
  if coalesce(v_total, 0) <= 0 then
    raise exception 'At least one line must still be going out on this round';
  end if;

  update public.fms_dispatch_orders set
    ms_actual_date = coalesce(nullif(p->>'ms_actual_date','')::date, ms_actual_date),
    ms_remarks     = nullif(trim(p->>'ms_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'material_checked_edited',
    format('Material status on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_material_status(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 7. STEP 4 — GENERATE SALES BILL. Invoice no. AND attachment are both required.
-- ===========================================================================
drop function if exists public.fms_dispatch_record_sales_bill(uuid, jsonb);
create or replace function public.fms_dispatch_record_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_uid uuid := auth.uid();
begin
  select status, order_no, round_no into v_status, v_no, v_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_sales_bill' then raise exception 'This order is not awaiting the sales bill (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('sales_bill', p_order, v_uid) then raise exception 'Not authorized to record the sales bill'; end if;
  if coalesce(trim(p->>'sb_invoice_no'), '') = '' then raise exception 'The Tally invoice number is required'; end if;
  if coalesce(trim(p->>'sb_attachment_path'), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = coalesce(nullif(p->>'sb_actual_date','')::date, current_date),
    sb_invoice_no      = trim(p->>'sb_invoice_no'),
    sb_attachment_path = nullif(p->>'sb_attachment_path',''),
    sb_attachment_name = nullif(p->>'sb_attachment_name',''),
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    sb_at = coalesce(sb_at, now()), sb_by = coalesce(sb_by, v_uid),
    status = 'awaiting_gate_out', current_step = 'gate_out'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'billed',
    'Sales bill ' || trim(p->>'sb_invoice_no') || ' raised for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting the gate outward entry.',
    public.fms_dispatch_step_owner_ids('gate_out'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'invoice_no', trim(p->>'sb_invoice_no'))
  );
end $$;
grant execute on function public.fms_dispatch_record_sales_bill(uuid, jsonb) to authenticated;

create or replace function public.fms_dispatch_sb_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.sb_at is not null and o.status = 'awaiting_gate_out');
$$;
grant execute on function public.fms_dispatch_sb_editable(uuid) to authenticated;

create or replace function public.fms_dispatch_update_sales_bill(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_path text;
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
  --   kept, so the "is it there?" test must ask what the row WOULD hold — not
  --   what the payload carries. Testing the payload makes every remarks-only
  --   edit fail with "attach the sales invoice".
  select case when p ? 'sb_attachment_path' then nullif(p->>'sb_attachment_path','') else o.sb_attachment_path end
    into v_path from public.fms_dispatch_orders o where o.id = p_order;
  if coalesce(trim(v_path), '') = '' then raise exception 'Attach the sales invoice before saving'; end if;

  update public.fms_dispatch_orders set
    sb_actual_date     = coalesce(nullif(p->>'sb_actual_date','')::date, sb_actual_date),
    sb_invoice_no      = coalesce(nullif(trim(p->>'sb_invoice_no'), ''), sb_invoice_no),
    sb_attachment_path = case when p ? 'sb_attachment_path' then nullif(p->>'sb_attachment_path','') else sb_attachment_path end,
    sb_attachment_name = case when p ? 'sb_attachment_name' then nullif(p->>'sb_attachment_name','') else sb_attachment_name end,
    sb_remarks         = nullif(trim(p->>'sb_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'billed_edited',
    format('Sales bill on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_sales_bill(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 8. STEP 5 — GATE OUTWARD ENTRY. The number is TYPED from the paper register.
-- ===========================================================================
drop function if exists public.fms_dispatch_record_gate_out(uuid, jsonb);
create or replace function public.fms_dispatch_record_gate_out(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_round integer; v_uid uuid := auth.uid(); v_out text := nullif(trim(p->>'go_outward_no'), '');
begin
  select status, order_no, round_no into v_status, v_no, v_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_gate_out' then raise exception 'This order is not awaiting the gate outward entry (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to record the gate outward entry'; end if;
  if v_out is null then raise exception 'The gate outward number is required'; end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, current_date),
    go_outward_no  = v_out,
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    go_at = coalesce(go_at, now()), go_by = coalesce(go_by, v_uid),
    status = 'awaiting_dispatch_confirm', current_step = 'dispatch_confirm'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'gate_out',
    'Gate outward ' || v_out || ' recorded for ' || coalesce(v_no,'an order')
      || ' (round ' || v_round || ') - awaiting delivery confirmation.',
    public.fms_dispatch_step_owner_ids('dispatch_confirm'),
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'outward_no', v_out)
  );
end $$;
grant execute on function public.fms_dispatch_record_gate_out(uuid, jsonb) to authenticated;

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
  if not public.fms_dispatch_can_act('gate_out', p_order, v_uid) then raise exception 'Not authorized to edit the gate outward entry'; end if;
  if not public.fms_dispatch_go_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its gate outward entry can no longer be changed.'; end if;
    raise exception 'The gate outward entry can no longer be edited: the delivery has already been confirmed (status %).', v_status;
  end if;
  if p ? 'go_outward_no' and coalesce(trim(p->>'go_outward_no'), '') = '' then
    raise exception 'The gate outward number is required';
  end if;

  update public.fms_dispatch_orders set
    go_actual_date = coalesce(nullif(p->>'go_actual_date','')::date, go_actual_date),
    go_outward_no  = coalesce(nullif(trim(p->>'go_outward_no'), ''), go_outward_no),
    go_remarks     = nullif(trim(p->>'go_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'gate_out_edited',
    format('Gate outward entry on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_gate_out(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 9. STEP 6 — CONFIRMATION ON DISPATCH. The only place the chain branches.
-- ===========================================================================
drop function if exists public.fms_dispatch_record_dispatch_confirm(uuid, jsonb);
create or replace function public.fms_dispatch_record_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_raiser uuid; v_round integer; v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_pending numeric; v_reason text; v_round_id uuid; v_shipped numeric;
begin
  select status, order_no, raised_by, round_no
    into v_status, v_no, v_raiser, v_round
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

  -- Last line of defence against an empty consignment reaching the archive.
  select coalesce(sum(ship_qty), 0) into v_shipped
    from public.fms_dispatch_order_items where order_id = p_order;
  if v_shipped <= 0 then
    raise exception 'Nothing is marked as going out on this round - correct the material status first';
  end if;

  update public.fms_dispatch_orders set
    dc_actual_date     = coalesce(nullif(p->>'dc_actual_date','')::date, current_date),
    dc_status          = v_dc,
    dc_attachment_path = nullif(p->>'dc_attachment_path',''),
    dc_attachment_name = nullif(p->>'dc_attachment_name',''),
    dc_remarks         = nullif(trim(p->>'dc_remarks'), ''),
    dc_at = coalesce(dc_at, now()), dc_by = coalesce(dc_by, v_uid)
  where id = p_order;

  -- What will still be owed once this round is counted. Worked out BEFORE the
  -- archive, because the archived row has to carry the answer as its reason —
  -- and fms_dispatch_rounds is written once, not updated afterwards.
  -- A Returned round contributes nothing: the goods came back.
  select coalesce(sum(greatest(
           li.quantity - li.dispatched_qty
             - (case when v_dc = 'delivered' then coalesce(li.ship_qty, 0) else 0 end), 0)), 0)
    into v_pending
    from public.fms_dispatch_order_items li where li.order_id = p_order;

  v_reason := case when v_pending <= 0 then 'closed' else 'looped' end;

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

-- The last step, so nothing downstream can lock it — but after a round is
-- archived the header is empty, so this is only ever true for a round that is
-- still awaiting its confirmation. Corrections to a FINISHED round go through
-- fms_dispatch_amend_round.
create or replace function public.fms_dispatch_dc_editable(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_dispatch_orders o
    where o.id = p_order and o.dc_at is not null and o.status not in ('on_hold','cancelled'));
$$;
grant execute on function public.fms_dispatch_dc_editable(uuid) to authenticated;

-- ⚠ This NEVER touches quantities or the archive. The outcome drives
--   dispatched_qty, and re-applying it here would double-count. Correcting a
--   confirmed delivery is fms_dispatch_amend_round's job.
create or replace function public.fms_dispatch_update_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_path text;
begin
  select status, order_no into v_status, v_no from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_can_act('dispatch_confirm', p_order, v_uid) then raise exception 'Not authorized to edit the delivery confirmation'; end if;
  if not public.fms_dispatch_dc_editable(p_order) then
    if v_status = 'on_hold' then raise exception 'This order is on hold - take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This order was cancelled - its delivery confirmation can no longer be changed.'; end if;
    raise exception 'This round is closed - open it from the order page to correct what was delivered.';
  end if;
  if p ? 'dc_status' and nullif(trim(p->>'dc_status'), '') is not null
     and nullif(trim(p->>'dc_status'), '') <> (select dc_status from public.fms_dispatch_orders where id = p_order) then
    raise exception 'The delivery outcome cannot be changed here - it drives the dispatched quantities. Use Correct this round on the order page.';
  end if;

  select case when p ? 'dc_attachment_path' then nullif(p->>'dc_attachment_path','') else o.dc_attachment_path end
    into v_path from public.fms_dispatch_orders o where o.id = p_order;
  if coalesce(trim(v_path), '') = '' then raise exception 'Attach the receiver copy or LR before saving'; end if;

  update public.fms_dispatch_orders set
    dc_actual_date     = coalesce(nullif(p->>'dc_actual_date','')::date, dc_actual_date),
    dc_attachment_path = case when p ? 'dc_attachment_path' then nullif(p->>'dc_attachment_path','') else dc_attachment_path end,
    dc_attachment_name = case when p ? 'dc_attachment_name' then nullif(p->>'dc_attachment_name','') else dc_attachment_name end,
    dc_remarks         = nullif(trim(p->>'dc_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'dispatched_edited',
    format('Delivery confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_dispatch_confirm(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 10. CORRECT A FINISHED ROUND — coordinators only.
--
-- This is how a PART return is recorded: 60 bags went out, the customer kept 40
-- and sent 20 back. The driver marks the round Returned (or Delivered), and a
-- coordinator then sets the round's outcome and per-line quantities to what
-- actually happened. It is also the only way back from a mis-tapped button.
--
-- Because dispatched_qty is RECALCULATED rather than accumulated, correcting a
-- round is just: change the row, recalculate, re-evaluate. No compensating
-- arithmetic, nothing to get out of step.
-- ===========================================================================
create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order uuid; v_no text; v_round integer; v_raiser uuid; v_status text; v_old text;
  v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_reason text := nullif(trim(p->>'amend_reason'), '');
  l jsonb; v_pending numeric; v_bad text;
begin
  select r.order_id, r.round_no, r.dc_status into v_order, v_round, v_old
    from public.fms_dispatch_rounds r where r.id = p_round for update;
  if v_order is null then raise exception 'That dispatch round was not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can correct a completed round';
  end if;
  if v_reason is null then raise exception 'A reason is required when correcting a round'; end if;

  select o.status, o.order_no, o.raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders o where o.id = v_order for update;
  if v_status = 'cancelled' then raise exception 'This order was cancelled - its rounds can no longer be corrected'; end if;
  if v_dc is not null and v_dc not in ('delivered','returned') then
    raise exception 'The outcome must be Delivered or Returned';
  end if;

  if p ? 'lines' and jsonb_typeof(p->'lines') = 'array' then
    for l in select * from jsonb_array_elements(p->'lines') loop
      if coalesce(trim(l->>'id'), '') = '' then continue; end if;
      if coalesce(nullif(l->>'ship_qty','')::numeric, 0) <= 0 then
        raise exception 'A corrected quantity must be greater than zero - remove the line instead';
      end if;
      update public.fms_dispatch_round_items
         set ship_qty = (l->>'ship_qty')::numeric,
             lot_no   = coalesce(nullif(trim(l->>'lot_no'), ''), lot_no)
       where id = (l->>'id')::uuid and round_id = p_round;
    end loop;
  end if;

  update public.fms_dispatch_rounds set
    dc_status    = coalesce(v_dc, dc_status),
    amended_at   = now(), amended_by = v_uid, amend_reason = v_reason
  where id = p_round;

  -- Catch an over-delivery BEFORE the recalculation trips the table CHECK and
  -- surfaces as a constraint name nobody can read.
  select string_agg(it.name, ', ') into v_bad
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = v_order
     and coalesce((select sum(ri.ship_qty) from public.fms_dispatch_round_items ri
                   join public.fms_dispatch_rounds r on r.id = ri.round_id
                  where ri.order_item_id = li.id and r.order_id = v_order and r.dc_status = 'delivered'), 0)
         > li.quantity;
  if v_bad is not null then
    raise exception 'That correction would deliver more than was ordered on: %', v_bad;
  end if;

  perform public.fms_dispatch_recalc_dispatched(v_order);

  -- A correction that leaves something owing must re-open a closed order,
  -- otherwise the balance has nowhere to go.
  select coalesce(sum(greatest(quantity - dispatched_qty, 0)), 0) into v_pending
    from public.fms_dispatch_order_items where order_id = v_order;

  if v_status = 'closed' and v_pending > 0 then
    update public.fms_dispatch_orders set
      round_no = round_no + 1, round_started_at = now(),
      status = 'awaiting_material_status', current_step = 'material_status',
      closed_at = null
    where id = v_order;
    update public.fms_dispatch_rounds set archived_reason = 'looped'
      where id = p_round and archived_reason = 'closed';
  end if;

  perform public.fms_dispatch_announce(
    'order', v_order, 'round_amended',
    'Round ' || v_round || ' of ' || coalesce(v_no,'an order') || ' was corrected'
      || case when v_dc is not null and v_dc is distinct from v_old
              then ' (' || v_old || ' -> ' || v_dc || ')' else '' end
      || ': ' || v_reason
      || case when v_status = 'closed' and v_pending > 0
              then ' The order has re-opened with ' || trim(to_char(v_pending,'FM999999990.###')) || ' still pending.'
              else '' end,
    case when v_status = 'closed' and v_pending > 0
         then public.fms_dispatch_step_owner_ids('material_status') || array_remove(array[v_raiser], null)
         else array_remove(array[v_raiser], null) end,
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'reason', v_reason)
  );
end $$;
grant execute on function public.fms_dispatch_amend_round(uuid, jsonb) to authenticated;

-- ===========================================================================
-- 11. LIFECYCLE — hold / resume / close / cancel.
-- ===========================================================================
drop function if exists public.fms_dispatch_hold_order(uuid, boolean, text);
create or replace function public.fms_dispatch_hold_order(p_order uuid, p_hold boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_next text; v_step text;
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can hold or resume an order'; end if;
  if v_status = 'cancelled' then raise exception 'This order was cancelled'; end if;

  if p_hold then
    if v_status = 'on_hold' then return; end if;
    if v_status = 'closed' then raise exception 'This order is already closed'; end if;
    update public.fms_dispatch_orders
       set status = 'on_hold', hold_at = now(), hold_reason = nullif(trim(p_reason), '')
     where id = p_order;
    perform public.fms_dispatch_announce('order', p_order, 'held',
      'Order ' || coalesce(v_no,'') || ' put on hold.', array_remove(array[v_raiser], null),
      jsonb_build_object('order_no', v_no, 'reason', nullif(trim(p_reason), '')));
  else
    if v_status <> 'on_hold' then return; end if;
    v_next := public.fms_dispatch_resume_status(p_order);
    v_step := case v_next
                when 'awaiting_credit_check'     then 'credit_check'
                when 'awaiting_material_status'  then 'material_status'
                when 'awaiting_sales_bill'       then 'sales_bill'
                when 'awaiting_gate_out'         then 'gate_out'
                when 'awaiting_dispatch_confirm' then 'dispatch_confirm'
                else 'dispatch_confirm' end;
    update public.fms_dispatch_orders
       set status = v_next, current_step = v_step, hold_at = null, hold_reason = null
     where id = p_order;
    perform public.fms_dispatch_announce('order', p_order, 'resumed',
      'Order ' || coalesce(v_no,'') || ' taken off hold.',
      public.fms_dispatch_step_owner_ids(v_step),
      jsonb_build_object('order_no', v_no));
  end if;
end $$;
grant execute on function public.fms_dispatch_hold_order(uuid, boolean, text) to authenticated;

-- Close an order that will never be completed — 80 of 100 shipped and the
-- customer cancelled the balance.
--
-- ⚠ ONLY BETWEEN ROUNDS. Mid-round the goods may already be through the gate,
--   and closing then would leave a consignment that physically left the plant
--   with no delivery record anywhere. Refusing keeps that impossible, and means
--   there is never a live round to archive here.
create or replace function public.fms_dispatch_close_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_resume text;
begin
  select status, order_no, raised_by into v_status, v_no, v_raiser
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can close an order early'; end if;
  if v_status = 'closed' then raise exception 'This order is already closed'; end if;
  if v_status = 'cancelled' then raise exception 'This order was cancelled'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to close an order early'; end if;

  v_resume := public.fms_dispatch_resume_status(p_order);
  if v_resume <> 'awaiting_material_status' then
    raise exception 'This order is part-way through a dispatch. Finish that round, or cancel the order instead.';
  end if;

  update public.fms_dispatch_orders set
    status = 'closed', current_step = 'dispatch_confirm',
    closed_at = coalesce(closed_at, now()),
    closed_reason = trim(p_reason), closed_by = v_uid,
    hold_at = null, hold_reason = null
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'closed_early',
    'Order ' || coalesce(v_no,'') || ' closed with a balance outstanding: ' || trim(p_reason),
    array_remove(array[v_raiser], null),
    jsonb_build_object('order_no', v_no, 'reason', trim(p_reason)));
end $$;
grant execute on function public.fms_dispatch_close_order(uuid, text) to authenticated;

drop function if exists public.fms_dispatch_cancel_order(uuid, text);
create or replace function public.fms_dispatch_cancel_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid(); v_live boolean;
begin
  select status, order_no, raised_by, ms_at is not null
    into v_status, v_no, v_raiser, v_live
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then raise exception 'Only a coordinator or admin can cancel an order'; end if;
  if v_status = 'closed' then raise exception 'This order is already closed'; end if;
  if v_status = 'cancelled' then return; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;

  -- A part-recorded round must not survive on the header of a cancelled order:
  -- it would keep appearing, and stay editable, in the step queues.
  if v_live then
    perform public.fms_dispatch_archive_round(p_order, 'cancelled');
    perform public.fms_dispatch_recalc_dispatched(p_order);
  end if;

  update public.fms_dispatch_orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'cancelled',
    'Order ' || coalesce(v_no,'') || ' cancelled.', array_remove(array[v_raiser], null),
    jsonb_build_object('order_no', v_no, 'reason', trim(p_reason)));
end $$;
grant execute on function public.fms_dispatch_cancel_order(uuid, text) to authenticated;
