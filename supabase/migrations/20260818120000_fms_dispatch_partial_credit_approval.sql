-- ===========================================================================
-- PARTIAL CREDIT APPROVAL — credit sets a QUANTITY CEILING, not just a yes/no.
--
-- THE PROBLEM
--   "Confirm Credit Limit" offered Approved or On hold and nothing between.
--   Collections routinely want to release part of a consignment — 35 kg of the
--   70 kg ordered — and hold the balance until payment lands. The only way to
--   express that was to approve everything and hope the store keeper shipped
--   less, which is not a control.
--
-- THE MODEL
--   cc_approved_qty  CUMULATIVE quantity credit has authorised on this order,
--                    across every decision it has ever made. Grows, never
--                    resets. NULL means UNCAPPED — that is what every row
--                    predating this migration means, and nothing in flight may
--                    start failing because of it.
--   headroom         cc_approved_qty - sum(dispatched_qty). What may still go
--                    out. Derived everywhere, stored nowhere.
--   cc_round_no      The round the CURRENT decision was made for.
--
-- ⚠ WHY cc_round_no EXISTS AND A TIMESTAMP WILL NOT DO
--   The archive has to answer "did this round have its own credit decision?",
--   because a round that merely inherited an earlier one must not archive a
--   second copy of it — the Completed tab would then show the same decision
--   twice. The obvious test, cc_at >= round_started_at, is WRONG:
--   fms_dispatch_material_nothing_available re-stamps round_started_at every
--   time the store reports no stock, which would push it past cc_at and
--   silently drop the credit snapshot. So the round number is recorded
--   explicitly.
--
-- THE LOOP-BACK RULE
--   On dispatch confirm with quantity still pending, the order loops back to
--   awaiting_credit_check ONLY WHEN HEADROOM IS EXHAUSTED, and to
--   awaiting_material_status (as before) when headroom remains. An order that
--   credit approved in full and the store could only part-fill has nothing new
--   to ask credit; an order whose approved quantity has all gone out does.
--   A RETURNED round contributes nothing to dispatched_qty, so its headroom is
--   untouched and it correctly goes back to the store, not to credit.
--
-- Additive only: two nullable columns, five nullable columns on the archive,
-- and replacements for the seven functions that have to know about them.
-- ===========================================================================

-- ---------------------------------------------------------------- columns --

alter table public.fms_dispatch_orders
  add column if not exists cc_approved_qty numeric(14,3),
  add column if not exists cc_round_no     integer;

comment on column public.fms_dispatch_orders.cc_approved_qty is
  'CUMULATIVE quantity credit has authorised on this order across every decision. Material status may not send more than this minus what has already gone out. NULL = uncapped (every row raised before partial approval existed).';
comment on column public.fms_dispatch_orders.cc_round_no is
  'The round the CURRENT credit decision belongs to. Set by every decision including a hold; cleared when an exhausted order loops back for a fresh one. The archive uses it to copy a decision onto exactly the round that made it.';

alter table public.fms_dispatch_rounds
  add column if not exists cc_status       text,
  add column if not exists cc_approved_qty numeric(14,3),
  add column if not exists cc_remarks      text,
  add column if not exists cc_at           timestamptz,
  add column if not exists cc_by           uuid;

comment on column public.fms_dispatch_rounds.cc_at is
  'The credit decision MADE DURING this round, or null when the round ran under a decision an earlier round had already made. Not "the decision governing the order" — that is on the order header.';

-- 'partial' joins the outcome enum. Declared inline originally, so it carries
-- the generated name; there is no re-issue in DDL — drop, then add back.
alter table public.fms_dispatch_orders
  drop constraint if exists fms_dispatch_orders_cc_status_check;
alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_cc_status_check
    check (cc_status is null or cc_status in ('approved','partial','credit_hold'));

-- ---------------------------------------------------------------- backfill --
--
-- An order already approved was approved IN FULL, so its ceiling is everything
-- it ordered. Anything still on hold keeps a null ceiling: it has authorised
-- nothing yet, and the hold itself is what stops it moving.
update public.fms_dispatch_orders o
   set cc_approved_qty = (select coalesce(sum(li.quantity), 0)
                            from public.fms_dispatch_order_items li
                           where li.order_id = o.id)
 where o.cc_status = 'approved' and o.cc_approved_qty is null;

update public.fms_dispatch_orders
   set cc_round_no = 1
 where cc_status is not null and cc_round_no is null;

-- ===========================================================================
-- THE ARCHIVE — carried from 20260817120100 with the credit block added.
-- ===========================================================================
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name, sb_remarks, sb_at, sb_by,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id,
    -- ⚠ ONLY the decision this round actually made. When credit approved enough
    --   to cover several rounds, the later ones inherit that decision and must
    --   archive NOTHING — otherwise one decision appears once per round it
    --   happened to cover, in the Completed tab and in the register.
    case when o.cc_round_no = o.round_no then o.cc_status       else null end,
    case when o.cc_round_no = o.round_no then o.cc_approved_qty else null end,
    case when o.cc_round_no = o.round_no then o.cc_remarks      else null end,
    case when o.cc_round_no = o.round_no then o.cc_at           else null end,
    case when o.cc_round_no = o.round_no then o.cc_by           else null end,
    o.ms_actual_date, o.ms_tempo_no, o.ms_porter, o.ms_remarks, o.ms_at, o.ms_by,
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name, o.sb_remarks, o.sb_at, o.sb_by,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  -- Only lines that actually went out. That set IS "this round's consignment",
  -- which is what the sales-bill and delivery screens render.
  --
  -- ⚠ NO unit_id, and NO join to fms_dispatch_units — that master is gone. The
  --   unit is plain text carried on the order line (a snapshot taken when the
  --   order was raised), and it is frozen onto the round item here so history
  --   survives a later rename.
  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.fms_dispatch_items it on it.id = li.item_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- WIPE. This is the half people forget, and forgetting it makes every closed
  -- order exist twice: once in the archive and once on the header.
  --
  -- ⚠ company_id IS DELIBERATELY ABSENT FROM THIS LIST. It used to be part of
  --   the step block, chosen per round at material status. It is now chosen once
  --   at intake and is true for every round of the order, so wiping it here
  --   would blank the billing entity the instant a round closed - and the order
  --   header, the queues, the register and the emails all read it. The archive
  --   still keeps its own copy above, which is what makes historic rounds
  --   self-describing.
  --
  -- ⚠ THE cc_ BLOCK IS DELIBERATELY ABSENT TOO, for a different reason. Whether
  --   the credit decision survives into the next round is not this function's
  --   question — it depends on whether any headroom is left, which only the
  --   caller has worked out. record_dispatch_confirm and amend_round clear it
  --   when, and only when, the order is going back to the credit queue.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
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
-- LINE SELECTION — the per-line clamp gains an order-level ceiling.
-- ===========================================================================
create or replace function public.fms_dispatch_apply_ship_lines(p_order uuid, p_lines jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  l jsonb; v_id uuid; v_qty numeric; v_pending numeric; v_item text; v_total numeric := 0;
  v_ceiling numeric; v_done numeric; v_allow numeric;
begin
  -- ⚠ The blanket clear below is destructive, so a payload that carries NO line
  --   data must return before it. Otherwise a remarks-only call silently empties
  --   the round, and the order loops for ever shipping nothing while burning an
  --   invoice number and an outward number each time.
  --
  --   The credit ceiling is not applied on this path either: nothing changed, so
  --   an order already over its ceiling (only reachable by a coordinator's
  --   correction) must not become unsaveable for a remark.
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

  -- THE CREDIT CEILING. Order-level, because credit approves a quantity for the
  -- consignment and leaves the split across lines to whoever can see the stock.
  -- Checked after the loop for that reason — no single line can breach it, only
  -- the sum can.
  --
  -- A null cc_approved_qty is UNCAPPED, not "zero approved": every order raised
  -- before partial approval existed has one, and they must keep working.
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
end $$;
revoke all on function public.fms_dispatch_apply_ship_lines(uuid, jsonb) from public, authenticated;

-- ===========================================================================
-- STEP 2 — CONFIRM CREDIT LIMIT. Approve, approve part of it, or hold.
-- ===========================================================================
create or replace function public.fms_dispatch_record_credit_check(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
  v_cc text := nullif(trim(p->>'cc_status'), '');
  v_remarks text := nullif(trim(p->>'cc_remarks'), '');
  v_round integer; v_cc_round integer; v_fresh boolean;
  v_ordered numeric; v_dispatched numeric; v_pending numeric;
  v_qty numeric; v_total numeric;
begin
  select status, order_no, raised_by, round_no, cc_round_no
    into v_status, v_no, v_raiser, v_round, v_cc_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  -- Deliberately re-runnable: a held order stays at this status, so the same
  -- person comes back to this same RPC to approve it.
  if v_status <> 'awaiting_credit_check' then raise exception 'This order is not awaiting credit confirmation (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('credit_check', p_order, v_uid) then raise exception 'Not authorized to confirm the credit limit'; end if;
  if v_cc is null or v_cc not in ('approved','partial','credit_hold') then
    raise exception 'Record the credit outcome: Approve, Approve part of it, or hold';
  end if;
  -- A hold and a part-release are both judgements someone downstream has to act
  -- on, so both owe a reason. A full approval does not.
  if v_cc = 'credit_hold' and v_remarks is null then
    raise exception 'A remark is required when an order is put on hold';
  end if;
  if v_cc = 'partial' and v_remarks is null then
    raise exception 'A remark is required when only part of an order is approved';
  end if;

  -- ⚠ The reference for a partial is what is STILL PENDING, not what was
  --   originally ordered. On round 2 of a 70 kg order with 35 already gone,
  --   "half" means half of the remaining 35 — asking the same question against
  --   70 would let credit re-authorise quantity it has already released.
  select coalesce(sum(li.quantity), 0), coalesce(sum(li.dispatched_qty), 0)
    into v_ordered, v_dispatched
    from public.fms_dispatch_order_items li where li.order_id = p_order;
  v_pending := greatest(v_ordered - v_dispatched, 0);

  -- ⚠ Every branch — the hold included — stamps the round. It is what lets the
  --   modal re-open an open hold for editing, and what stops the archive
  --   copying one decision onto every round it happened to cover.
  v_fresh := (v_cc_round is distinct from v_round);

  if v_cc = 'credit_hold' then
    -- Decision recorded; the order does NOT advance. cc_at stays null, which is
    -- what keeps it in this step's pending queue rather than its Completed tab.
    update public.fms_dispatch_orders set
      cc_status = 'credit_hold', cc_remarks = v_remarks,
      cc_round_no = v_round,
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

  if v_cc = 'partial' then
    v_qty := nullif(trim(p->>'cc_approved_qty'), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter how much of this order is approved';
    end if;
    if v_qty >= v_pending then
      raise exception 'That is the whole balance of % - record it as Approved instead',
        trim(to_char(v_pending, 'FM999999990.###'));
    end if;
    -- Stored CUMULATIVELY: what has already gone out was authorised by an
    -- earlier decision and stays authorised. Written as dispatched + qty rather
    -- than added to the previous value so that re-deciding within the same round
    -- (after a hold, say) replaces rather than compounds.
    v_total := v_dispatched + v_qty;
  else
    v_total := v_ordered;
  end if;

  update public.fms_dispatch_orders set
    cc_status = v_cc,
    -- An approve that follows a hold must not silently erase the hold's reason.
    cc_remarks = coalesce(v_remarks, cc_remarks),
    cc_approved_qty = v_total,
    cc_round_no = v_round,
    cc_decided_at = now(), cc_decided_by = v_uid,
    -- ⚠ A decision made for a NEW round gets a new completion stamp. Carrying
    --   round 1's forward would file round 2's approval weeks in the past, in
    --   the Completed tab and in every throughput count.
    cc_at = case when v_fresh then now() else coalesce(cc_at, now()) end,
    cc_by = case when v_fresh then v_uid else coalesce(cc_by, v_uid) end,
    status = 'awaiting_material_status', current_step = 'material_status'
  where id = p_order;

  perform public.fms_dispatch_announce(
    'order', p_order, 'credit_checked',
    case when v_cc = 'partial'
         then 'Credit approved ' || trim(to_char(v_qty, 'FM999999990.###')) || ' of the '
              || trim(to_char(v_pending, 'FM999999990.###')) || ' pending on '
              || coalesce(v_no,'an order') || ' - awaiting the material-status check.'
         else 'Credit approved on ' || coalesce(v_no,'an order') || ' - awaiting the material-status check.'
    end,
    public.fms_dispatch_step_owner_ids('material_status'),
    jsonb_build_object('order_no', v_no, 'cc_status', v_cc, 'approved_qty', v_total)
  );
end $$;
grant execute on function public.fms_dispatch_record_credit_check(uuid, jsonb) to authenticated;

create or replace function public.fms_dispatch_update_credit_check(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_cc text := nullif(trim(p->>'cc_status'), '');
  v_remarks text := nullif(trim(p->>'cc_remarks'), '');
  v_current text; v_ordered numeric; v_dispatched numeric; v_committed numeric;
  v_qty numeric; v_total numeric;
begin
  select status, order_no, cc_status into v_status, v_no, v_current
    from public.fms_dispatch_orders where id = p_order for update;
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
  -- Only a RECORDED decision is reachable here — approved, or approved in part.
  -- Turning either back into a hold would strand an order that has moved on.
  if v_cc is not null and v_cc not in ('approved','partial') then
    raise exception 'A recorded credit confirmation cannot be changed back to a hold - the order has already moved on.';
  end if;

  v_cc := coalesce(v_cc, v_current);
  if v_cc = 'partial' and v_remarks is null then
    raise exception 'A remark is required when only part of an order is approved';
  end if;

  -- What is already SPOKEN FOR: delivered on earlier rounds, plus whatever the
  -- store keeper has already selected for this one. Lowering the ceiling under
  -- either would leave a consignment nobody had approved.
  select coalesce(sum(li.quantity), 0), coalesce(sum(li.dispatched_qty), 0),
         coalesce(sum(li.dispatched_qty), 0) + coalesce(sum(li.ship_qty), 0)
    into v_ordered, v_dispatched, v_committed
    from public.fms_dispatch_order_items li where li.order_id = p_order;

  if v_cc = 'partial' then
    v_qty := nullif(trim(p->>'cc_approved_qty'), '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter how much of this order is approved';
    end if;
    v_total := v_dispatched + v_qty;
    if v_total >= v_ordered then
      raise exception 'That is the whole order - record it as Approved instead';
    end if;
    if v_total < v_committed then
      raise exception 'Credit cannot be cut to % - % is already going out or has gone out. Reduce the material status first.',
        trim(to_char(v_total, 'FM999999990.###')), trim(to_char(v_committed, 'FM999999990.###'));
    end if;
  else
    v_total := v_ordered;
  end if;

  update public.fms_dispatch_orders set
    cc_status    = v_cc,
    cc_remarks   = v_remarks,
    cc_approved_qty = v_total,
    cc_edited_at = now(), cc_edited_by = v_uid,
    edited_at    = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'credit_checked_edited',
    format('Credit confirmation on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_dispatch_update_credit_check(uuid, jsonb) to authenticated;

-- ===========================================================================
-- INTAKE EDIT — carried from 20260817120100 with one new guard.
--
-- ⚠ WHY THE NEW GUARD. This RPC's window was "status = awaiting_credit_check
--   and cc_at is null", which was airtight while credit was decided once and an
--   order never came back. An exhausted order now DOES come back, and without
--   this an order that has already dispatched would have its Edit button light
--   up again — its customer, billing company, dispatch type and order date all
--   rewritable mid-flight. fms_dispatch_replace_lines already refuses on the
--   same test; the header had no equivalent.
-- ===========================================================================
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
  if exists (select 1 from public.fms_dispatch_rounds where order_id = p_order) then
    raise exception 'This order has already dispatched - its details can no longer be edited';
  end if;
  if not (v_raiser = v_uid or public.fms_dispatch_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this order (or a coordinator) may edit it';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;

  v_cust := coalesce(nullif(p->>'customer_id','')::uuid,
                     (select customer_id from public.fms_dispatch_orders where id = p_order));

  -- ⚠ Ask what the ROW WOULD HOLD, not what the payload carries. An omitted key
  --   means "keep what is stored", so an older client that never learnt to send
  --   a company does not fail with "choose the company".
  select case when p ? 'company_id' then nullif(trim(p->>'company_id'),'')::uuid else o.company_id end
    into v_company from public.fms_dispatch_orders o where o.id = p_order;
  if v_company is null then
    raise exception 'Choose the company that bills this order';
  end if;
  if not exists (select 1 from public.fms_dispatch_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  update public.fms_dispatch_orders set
    dispatch_type = v_type,
    company_id    = v_company,
    customer_id   = v_cust,
    customer_location = case when p ? 'customer_location'
                             then nullif(trim(p->>'customer_location'),'') else customer_location end,
    customer_po_no    = case when p ? 'customer_po_no'
                             then nullif(trim(p->>'customer_po_no'),'') else customer_po_no end,
    order_date    = coalesce(nullif(p->>'order_date','')::date, order_date),
    order_remarks = nullif(trim(p->>'order_remarks'), ''),
    -- ⚠ Editing the goods CLEARS a credit hold. The hold and its written reason
    --   were a judgement about a specific set of items; silently carrying them
    --   over to a different set is how a hold gets bypassed by accident.
    cc_status     = case when v_held then null else cc_status end,
    cc_remarks    = case when v_held then null else cc_remarks end,
    cc_round_no   = case when v_held then null else cc_round_no end,
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
-- STEP 6 — CONFIRMATION ON DISPATCH. The branch now has three ways out.
-- ===========================================================================
create or replace function public.fms_dispatch_record_dispatch_confirm(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_raiser uuid; v_round integer; v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_pending numeric; v_reason text; v_round_id uuid; v_shipped numeric;
  v_allow numeric; v_headroom numeric; v_to_credit boolean;
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
             + (case when v_dc = 'delivered' then coalesce(li.ship_qty, 0) else 0 end)), 0)
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
    --   cleared is the DECISION — outcome, remark, stamps and round — so the
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
-- CORRECT A FINISHED ROUND — same three-way routing when it re-opens an order.
--
-- ⚠ AMEND DOES NOT CHECK CREDIT, AND THAT IS NOT AN OVERSIGHT. It records what
--   physically happened; reality does not need authorising after the fact. If a
--   correction pushes the delivered total past the approved quantity, headroom
--   simply floors at zero and the re-open below routes the balance to credit,
--   which is the right conversation to have.
-- ===========================================================================
create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order uuid; v_no text; v_round integer; v_raiser uuid; v_status text; v_old text;
  v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_reason text := nullif(trim(p->>'amend_reason'), '');
  l jsonb; v_pending numeric; v_bad text;
  v_allow numeric; v_headroom numeric; v_to_credit boolean;
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

  perform public.fms_dispatch_announce(
    'order', v_order, 'round_amended',
    'Round ' || v_round || ' of ' || coalesce(v_no,'an order') || ' was corrected'
      || case when v_dc is not null and v_dc is distinct from v_old
              then ' (' || v_old || ' -> ' || v_dc || ')' else '' end
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
-- THE MAIL BODY — carried VERBATIM from 20260817120100 with one row added.
--
-- ⚠ That file is the canonical source and says so; this copy was produced by
--   slicing it and inserting the block below, not by retyping it. Diff the two
--   before replacing either again.
-- ===========================================================================
create or replace function public.fms_dispatch_email_payload(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b text := '/order-to-dispatch';
  r record;
  mr record;
  v_eyebrow text; v_headline text; v_action text; v_subject text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb; v_items jsonb;
  v_label text; v_name text;
  v_next_label text; v_next_queue text;
  v_round integer; v_held boolean; v_early boolean;
begin
  -- ---- master-data governance (unchanged) ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_dispatch_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := replace(coalesce(p_meta->>'master_type', mr.master_type), '_', ' ');
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Open master requests', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- the sales order ----
  select o.*, c.name as customer_name, co.name as company_name
    into r
    from public.fms_dispatch_orders o
    left join public.fms_dispatch_customers c on c.id = o.customer_id
    left join public.fms_dispatch_companies co on co.id = o.company_id
   where o.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  -- ⚠ The announcing RPC captures round_no BEFORE it increments and passes it in
  --   the meta, because by the time this runs the row already says round N+1.
  --   Reading r.round_no here would head round 1's email "Round 2".
  v_round := coalesce(nullif(p_meta->>'round_no','')::integer, r.round_no);
  v_held  := (r.cc_status = 'credit_hold' and r.cc_at is null);
  v_early := (r.status = 'closed' and r.closed_reason is not null);

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Order no.','value', r.order_no),
    jsonb_build_object('label','Customer','value', coalesce(r.customer_name,'-')),
    jsonb_build_object('label','Customer location','value', coalesce(r.customer_location,'-')),
    jsonb_build_object('label','Customer PO no.','value', coalesce(r.customer_po_no,'-')),
    jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
    jsonb_build_object('label','Type','value', initcap(r.dispatch_type)),
    jsonb_build_object('label','Order date','value', to_char(r.order_date, 'DD-MM-YYYY')),
    jsonb_build_object('label','Round','value', v_round::text)
  );

  -- The credit ceiling, once credit has set one. Only on a PARTIAL: a full
  -- approval's ceiling is the whole order, and printing "70 of 70" in an email
  -- adds a number without adding a fact.
  if r.cc_status = 'partial' and r.cc_approved_qty is not null then
    v_rows := v_rows || jsonb_build_object('label','Credit approved',
      'value', trim(to_char(r.cc_approved_qty, 'FM999999990.###')));
  end if;

  -- The tempo and the porter answer belong to the round in progress, so they are
  -- appended only once the stock check has actually recorded them.
  if coalesce(btrim(r.ms_tempo_no), '') <> '' then
    v_rows := v_rows || jsonb_build_object('label','Tempo no.','value', r.ms_tempo_no);
  end if;
  if r.ms_porter is not null then
    v_rows := v_rows || jsonb_build_object('label','Porter','value', case when r.ms_porter then 'Yes' else 'No' end);
  end if;

  -- The consignment: what is going out on the round in progress. Once a round is
  -- archived its ship_qty is cleared, so this falls back to the ordered quantity
  -- — which is the right thing to show on an order that is between rounds.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(it.name, 'Item'),
           'qty', trim(to_char(coalesce(li.ship_qty, li.quantity), 'FM999999990.###')) ||
                  case when coalesce(li.unit,'') <> '' then ' ' || li.unit else '' end
         ) order by li.line_no), '[]'::jsonb)
    into v_items
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = r.id;

  v_next_label := case r.current_step
                    when 'credit_check'     then 'Credit Confirmation'
                    when 'material_status'  then 'Material Status Check'
                    when 'sales_bill'       then 'Sales Bill'
                    when 'gate_out'         then 'Gate Outward Entry'
                    when 'dispatch_confirm' then 'Dispatch Confirmation'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'credit_check'     then '/queues/credit-check'
                    when 'material_status'  then '/queues/material-status'
                    when 'sales_bill'       then '/queues/sales-bill'
                    when 'gate_out'         then '/queues/gate-out'
                    when 'dispatch_confirm' then '/queues/dispatch-confirm'
                    else '/orders/' || r.id::text end;

  v_eyebrow := case p_type
                 when 'raised'             then 'New sales order'
                 when 'credit_checked'     then 'Credit approved'
                 when 'credit_on_hold'     then 'Credit on hold'
                 when 'material_checked'   then 'Stock confirmed'
                 when 'material_pending'   then 'Nothing available yet'
                 when 'billed'             then 'Sales bill raised'
                 when 'gate_out'           then 'Out of the gate'
                 when 'dispatched'         then 'Delivered'
                 when 'dispatch_returned'  then 'Returned'
                 when 'round_amended'      then 'Round corrected'
                 when 'closed_early'       then 'Closed early'
                 when 'held'               then 'On hold'
                 when 'resumed'            then 'Resumed'
                 when 'cancelled'          then 'Cancelled'
                 else 'Order update' end;

  if v_held then
    -- The order sits at awaiting_credit_check but is deliberately NOT due.
    v_headline  := 'Order ' || r.order_no || ' is on hold at credit';
    v_action    := 'put an order on hold at the credit check';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Credit hold - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')';
  elsif v_early then
    v_headline  := 'Order ' || r.order_no || ' was closed with a balance outstanding';
    v_action    := 'closed an order early';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Closed early - ' || r.order_no;
  elsif r.status = 'closed' then
    v_headline  := 'Order ' || r.order_no || ' is closed';
    v_action    := 'confirmed the final delivery';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := 'Delivered - ' || r.order_no || ' (' || coalesce(r.customer_name,'customer') || ')';
  elsif r.status in ('on_hold','cancelled') then
    v_headline  := 'Order ' || r.order_no || ' is ' || replace(r.status, '_', ' ');
    v_action    := replace(r.status, '_', ' ') || ' an order';
    v_cta_label := 'Open the order';
    v_cta_path  := b || '/orders/' || r.id::text;
    v_subject   := initcap(replace(r.status, '_', ' ')) || ' - ' || r.order_no;
  elsif p_type = 'dispatch_returned' then
    -- A returned round that looped: the order is back at the material check.
    v_headline  := 'Round ' || v_round || ' of ' || r.order_no || ' came back';
    v_action    := 'recorded a returned consignment';
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := 'Returned - ' || r.order_no || ' (round ' || v_round || ')';
  elsif p_type = 'material_pending' then
    v_headline  := r.order_no || ' has no stock available yet';
    v_action    := 'checked stock and found nothing available';
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := 'Awaiting stock - ' || r.order_no;
  else
    v_headline  := r.order_no || ' is ready for ' || v_next_label;
    v_action    := 'moved an order to ' || v_next_label;
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := v_next_label || ' due - ' || r.order_no ||
                   ' (' || coalesce(r.customer_name,'customer') || ')';
  end if;

  return jsonb_build_object(
    'subject',  v_subject,
    'eyebrow',  v_eyebrow,
    'headline', v_headline,
    'action',   v_action,
    'docLabel', 'Order ' || r.order_no,
    'rows',     v_rows,
    'items',    v_items,
    'ctaLabel', v_cta_label,
    'ctaPath',  v_cta_path
  )
  || case when coalesce(btrim(p_text),'') <> ''
          then jsonb_build_object('note', jsonb_build_object('label','Update','text', p_text))
          else '{}'::jsonb end;
end $$;
