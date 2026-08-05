-- ===========================================================================
-- THE ORDER NOW STATES WHO BILLS IT, WHERE IT GOES, AND THE CUSTOMER'S OWN PO.
--
-- WHAT MOVES
--   Billing company was decided at the MATERIAL STATUS step (20260812120000).
--   That put the question to the store keeper, two steps after the person who
--   actually knows the answer had already left the flow. It moves to intake:
--   `fms_dispatch_submit_order` now demands an active company, and material
--   status stops asking.
--
-- WHAT ARRIVES WITH IT
--   customer_location — defaulted from the customer master, overridable per
--     order, and free-typed when a consignment goes somewhere new. Deliberately
--     TEXT on the order, not an FK: it is a fact about this consignment, and a
--     later rename of the master must not rewrite history.
--   customer_po_no — optional. The customer's own reference, quoted back.
--
-- WHAT REPLACES THE COMPANY AT MATERIAL STATUS
--   ms_tempo_no (text) and ms_porter (boolean) — both OPTIONAL, both part of
--   the per-round step block, so they mirror onto fms_dispatch_rounds.
--
-- ⚠ COMPANY IS NO LONGER WIPED BY archive_round.
--   It was part of the step block, so every archive nulled it and the next
--   round re-decided. It is an ORDER-level fact now: decided once, true for
--   every round, and it must survive the wipe. 20260812120100 asserted the wipe
--   CONTAINED `company_id = null`; the assertion at the foot of this file is the
--   inverse, so a future copy-paste of the old body fails loudly.
--
-- ⚠ EVERY FUNCTION BELOW WAS DIFFED AGAINST THE LIVE DEFINITION FIRST
--   (`select pg_get_functiondef(oid) from pg_proc where proname = ...`), per the
--   rule set out in 20260812120100. Two of them — email_payload and
--   resolve_master_request — had no canonical source in the repo at all: they
--   were last repaired by in-database pg_get_functiondef + replace() patches in
--   20260811120000. Their whole live bodies are carried here, so from now on
--   they DO have one. Do not re-issue either from an older file.
--
-- ALSO FIXED IN PASSING — A LIVE BUG.
--   `fms_dispatch_update_order` still resolved the company from
--   `fms_dispatch_customers.company_id` and raised 'This customer has no company
--   mapped' when it was null. 20260811120200 removed that lookup from
--   submit_order but never from update_order, and the mapping is null on 136 of
--   137 customers — so EDITING ANY SALES ORDER has been failing since then. The
--   rewrite below takes the company from the payload and the lookup is gone.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------- columns --

alter table public.fms_dispatch_customers
  add column if not exists location text;

comment on column public.fms_dispatch_customers.location is
  'Where this customer normally takes delivery. Defaulted onto a new sales order, and overridable there.';

alter table public.fms_dispatch_orders
  add column if not exists customer_location text,
  add column if not exists customer_po_no    text,
  add column if not exists ms_tempo_no       text,
  add column if not exists ms_porter         boolean;

comment on column public.fms_dispatch_orders.company_id is
  'The entity that bills this order. Chosen ONCE at intake and true for every round - archive_round must NOT wipe it.';
comment on column public.fms_dispatch_orders.customer_location is
  'Where this consignment goes. Seeded from the customer master at intake; free text, so a master rename cannot rewrite it.';
comment on column public.fms_dispatch_orders.customer_po_no is
  'The customer''s own purchase-order reference. Optional.';
comment on column public.fms_dispatch_orders.ms_tempo_no is
  'Vehicle carrying this round, recorded at the stock check. Optional. Part of the step block - archived and wiped per round.';
comment on column public.fms_dispatch_orders.ms_porter is
  'Whether this round went by porter. Optional; null means nobody answered.';

alter table public.fms_dispatch_rounds
  add column if not exists ms_tempo_no text,
  add column if not exists ms_porter   boolean;

-- ------------------------------------------------------------ intake RPCs --

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

  -- The billing company, asked here because the person raising the order is the
  -- one who knows it. Validated against the master rather than merely cast, so a
  -- stale id from a long-open tab is refused now instead of reaching an invoice.
  v_company := nullif(trim(p->>'company_id'), '')::uuid;
  if v_company is null then
    raise exception 'Choose the company that bills this order';
  end if;
  if not exists (select 1 from public.fms_dispatch_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, customer_id,
    customer_location, customer_po_no,
    order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at
  ) values (
    v_no, v_type, v_company, v_cust,
    nullif(trim(p->>'customer_location'), ''),
    nullif(trim(p->>'customer_po_no'), ''),
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

-- --------------------------------------------------- material status RPCs --

create or replace function public.fms_dispatch_record_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_round integer; v_uid uuid := auth.uid();
  v_total numeric;
begin
  select status, order_no, round_no into v_status, v_no, v_round
    from public.fms_dispatch_orders where id = p_order for update;
  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_material_status' then raise exception 'This order is not awaiting the material-status check (status %)', v_status; end if;
  if not public.fms_dispatch_can_act('material_status', p_order, v_uid) then raise exception 'Not authorized to record the material status'; end if;

  -- No company question here any more - it was answered when the order was
  -- raised, and re-asking it per round let one order bill two entities.

  -- Lines first, then validate what they add up to: "at least one line is going
  -- out" is a fact about the lines, so it cannot be checked before they land.
  v_total := public.fms_dispatch_apply_ship_lines(p_order, p->'lines');
  if coalesce(v_total, 0) <= 0 then
    raise exception 'Enter the quantity going out on at least one line, or use "Nothing available yet"';
  end if;

  update public.fms_dispatch_orders set
    ms_actual_date = coalesce(nullif(p->>'ms_actual_date','')::date, current_date),
    ms_tempo_no    = nullif(trim(p->>'ms_tempo_no'), ''),
    -- ⚠ NOT `(p->>'ms_porter')::boolean`. The step modal posts '' for every
    --   untouched field and that cast throws 22P02 on an empty string, which
    --   would make an unanswered optional field fail the whole save.
    ms_porter      = case lower(nullif(trim(p->>'ms_porter'), ''))
                       when 'yes' then true when 'true' then true when 't' then true when '1' then true
                       when 'no'  then false when 'false' then false when 'f' then false when '0' then false
                       else null end,
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

create or replace function public.fms_dispatch_update_material_status(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid(); v_total numeric;
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

  -- ⚠ An omitted key means "keep what is stored" - only a key that was actually
  --   sent may overwrite. Both fields are optional, so a sent-but-blank value is
  --   a legitimate erase.
  update public.fms_dispatch_orders set
    ms_actual_date = coalesce(nullif(p->>'ms_actual_date','')::date, ms_actual_date),
    ms_tempo_no    = case when p ? 'ms_tempo_no'
                          then nullif(trim(p->>'ms_tempo_no'),'') else ms_tempo_no end,
    ms_porter      = case when p ? 'ms_porter'
                          then case lower(nullif(trim(p->>'ms_porter'), ''))
                                 when 'yes' then true when 'true' then true when 't' then true when '1' then true
                                 when 'no'  then false when 'false' then false when 'f' then false when '0' then false
                                 else null end
                          else ms_porter end,
    ms_remarks     = nullif(trim(p->>'ms_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_order;

  perform public.fms_dispatch_announce('order', p_order, 'material_checked_edited',
    format('Material status on %s edited', coalesce(v_no,'the order')), '{}'::uuid[], '{}'::jsonb);
end $$;

-- ------------------------------------------------------------ the archive --

create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name, sb_remarks, sb_at, sb_by,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id,
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

-- ------------------------------------------------------------ mail bodies --
--
-- ⚠ CARRIED FROM THE LIVE DEFINITION, NOT FROM 20260810120300. That file's copy
--   predates the units-master cut; the item query below is the repaired one
--   (no unit_id, no join to the dropped master). This file is now its canonical
--   source. Diff before you replace it again.
--
-- The source select is `o.*`, so the two new order columns were already in
-- scope - only the rendered row list grows.

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

-- --------------------------------------------------- master-request intake --
--
-- ⚠ WIRE CONTRACT. The keys read below are the keys `lib/masterFields.ts` puts
--   into proposed_payload. `location` joins the customer arm here at the same
--   time it joins that file - a field added on one side only is silently
--   dropped on approve.
--
-- Also carried from the live definition; 20260811120200's copy is older.

create or replace function public.fms_dispatch_resolve_master_request(
  p_request_id uuid, p_approve boolean, p_payload jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_type text; v_status text; v_payload jsonb; v_new_id uuid; v_name text;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_dispatch_master_requests where id = p_request_id for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  if not (public.is_admin(auth.uid()) or public.fms_dispatch_is_master_manager(v_type, auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');

  if p_approve then
    -- ⚠ customer_item is EXEMPT from the name check. A mapping row has no name of
    --   its own — it is described by the pair it names — so demanding one here
    --   would make every mapping request unapprovable.
    if v_name is null and v_type <> 'customer_item' then
      raise exception 'A name is required to approve a master request';
    end if;

    if v_type = 'company' then
      insert into public.fms_dispatch_companies (name, gstin, address, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'),''), nullif(trim(v_payload->>'address'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer' then
      insert into public.fms_dispatch_customers
        (name, code, location, gstin, contact_name, phone, email, created_by)
      values (v_name,
              nullif(trim(v_payload->>'code'),''),
              nullif(trim(v_payload->>'location'),''),
              nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'contact_name'),''),
              nullif(trim(v_payload->>'phone'),''),
              nullif(trim(v_payload->>'email'),''),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item' then
      insert into public.fms_dispatch_items (name, code, unit, hsn_code, created_by)
      values (v_name,
              nullif(trim(v_payload->>'code'),''),
              nullif(trim(v_payload->>'unit'),''),
              nullif(trim(v_payload->>'hsn_code'),''),
              auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer_item' then
      if nullif(trim(v_payload->>'customer_id'),'') is null
         or nullif(trim(v_payload->>'item_id'),'') is null then
        raise exception 'A mapping needs both a customer and an item';
      end if;
      insert into public.fms_dispatch_customer_items (customer_id, item_id, created_by)
      values ((v_payload->>'customer_id')::uuid, (v_payload->>'item_id')::uuid, auth.uid())
      returning id into v_new_id;

    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_dispatch_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_dispatch_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $$;

-- ---------------------------------------------------------------- asserts --
--
-- ⚠ MATCH CODE, NOT PROSE. pg_get_functiondef returns the comments too, and the
--   comments above deliberately name the very identifiers being banned. Each
--   test below matches a token sequence that can only occur in executable SQL.

do $check$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_reason text';
  if v_def is null then raise exception 'archive_round missing after replace'; end if;
  -- The inverse of 20260812120100's assertion: the company must now SURVIVE.
  if v_def like '%company_id = null%' then raise exception 'archive_round still wipes company_id - it is an intake field now'; end if;
  if v_def not like '%o.ms_tempo_no, o.ms_porter%' then raise exception 'archive_round does not archive the tempo/porter'; end if;
  -- Still true, and still worth guarding: the units master is gone.
  if v_def like '%li.unit_id%' then raise exception 'archive_round still selects li.unit_id'; end if;
  if v_def like '%unit_name, unit_id%' then raise exception 'archive_round still inserts a unit_id column'; end if;
  if v_def like '%join public.fms_dispatch_units%' then raise exception 'archive_round still joins the dropped units master'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_record_material_status';
  if v_def like '%p->>''ms_company_id''%' then raise exception 'material status still reads ms_company_id'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_submit_order';
  if v_def not like '%p->>''company_id''%' then raise exception 'submit_order does not read a company'; end if;
  if v_def not like '%customer_location%' then raise exception 'submit_order does not read the customer location'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_order';
  -- The bug this file fixes: the company must come from the payload, never from
  -- the retired customer mapping.
  if v_def like '%c.company_id into v_company%' then raise exception 'update_order still resolves the company from the customer master'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_email_payload';
  if v_def not like '%Customer location%' then raise exception 'email payload lost the customer location row'; end if;
  if v_def like '%fms_dispatch_units%' then raise exception 'email payload regressed to the pre-units-cut body'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_resolve_master_request';
  if v_def not like '%name, code, location, gstin%' then raise exception 'approving a customer request would drop the location'; end if;
end $check$;

commit;
