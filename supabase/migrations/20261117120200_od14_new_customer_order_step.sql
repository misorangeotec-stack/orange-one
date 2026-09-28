-- ===========================================================================
-- OD-14 PHASE 3 — A CUSTOMER ORDER STANDS WHERE A NEW SALES ORDER STANDS.
--
-- Today a customer order lands at `credit_check` with `intake_completed_at` null,
-- in the same queue as staff orders, showing a blank company and "Not yet
-- decided" for type. The only way to finish it is three comboboxes bolted to the
-- top of the credit-check modal. Nothing on any screen says "this is a customer
-- order that still needs writing up" — you find out by opening it.
--
-- Our process begins at a sales order. A customer order should begin in that same
-- place: its own queue, worked on the same form, and once completed it rejoins the
-- existing chain with nothing downstream changed.
--
-- ⚠ THIS REVERSES OD-13 P3's DELIBERATE CHOICE NOT TO ADD A STATUS, so here is why
--   that choice was right then and is wrong now. P3 said status "drives every
--   queue, filter, export and report in the staff app" and used
--   `intake_source + intake_completed_at` instead — correct, when the order was
--   meant to sit IN the credit-check queue and merely carry three extra fields.
--   Phase 3 wants it OUT of that queue and in one of its own, and a queue is
--   chosen by status. Every reader is a `Record<DispatchStatus, …>` in strict
--   TypeScript, so the compiler names them all; there are seven.
--
-- ⚠ NO PERMISSION CHANGE, AND THAT IS DELIBERATE. The obvious move — let
--   `sales_order` step owners work this queue — would be a new grant nobody asked
--   for, and it would not work anyway: a customer order has `location_id` null, and
--   `fms_dispatch_can_see_order`'s owner arm matches only the fallback owner-set on
--   a null location — which holds ZERO people (checked live for both `sales_order`
--   and `credit_check`), so RLS would hand them no rows to work on. The people who
--   should complete these orders are already named, per customer, by decision Q8's
--   "who we tell when they order" — and `fms_dispatch_can_act__ungated` has carried
--   that arm since P2.
--   Admins and coordinators keep their blanket access.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. THE NEW STATUS
-- ===========================================================================
-- Widening a CHECK is additive: it admits a value, drops nothing, rewrites no row.
alter table public.fms_dispatch_orders drop constraint if exists fms_dispatch_orders_status_check;
alter table public.fms_dispatch_orders add constraint fms_dispatch_orders_status_check
  check (status = any (array[
    'awaiting_order_completion',
    'awaiting_credit_check',
    'awaiting_material_status',
    'awaiting_sales_bill',
    'awaiting_gate_out',
    'awaiting_dispatch_confirm',
    'awaiting_sales_return',
    'closed', 'on_hold', 'cancelled']));

-- ===========================================================================
-- 2. THE CUSTOMER'S EDIT WINDOW HAS TO KNOW ABOUT IT
-- ===========================================================================
-- ⚠ THE ONE CHANGE HERE THAT FAILS SILENTLY IF FORGOTTEN. Both
--   `fms_dispatch_update_customer_order` and `fms_dispatch_cancel_customer_order`
--   gate on this function, and it keys on `status = 'awaiting_credit_check'`. Move
--   a new order to `awaiting_order_completion` without touching it and every
--   customer loses the ability to change or cancel the moment they place an order
--   — no error, no refusal, just a Change button that is never offered.
--
-- Decision Q7 said the window closes "when our team touches the order". Until now
-- that moment had to be inferred; the new step names it exactly.
create or replace function public.fms_dispatch_customer_window_open(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1 from public.fms_dispatch_orders o
     where o.id = p_order
       and o.intake_source = 'customer'
       and o.status in ('awaiting_order_completion', 'awaiting_credit_check')
       and o.cc_decided_at is null
       and not exists (select 1 from public.fms_dispatch_rounds r where r.order_id = o.id)
  );
$fn$;

-- ===========================================================================
-- 3. A PLACED ORDER STARTS AT THE NEW STEP
-- ===========================================================================
create or replace function public.fms_dispatch_submit_customer_order(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_g       public.fms_dispatch_customer_orgs%rowtype;
  v_company uuid := nullif(trim(p->>'company_id'), '')::uuid;
  v_party   uuid;
  v_id      uuid;
  v_no      text;
  v_seq     integer;
  v_fy      text := public.fms_dispatch_fy_code(current_date);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  v_org := public.fms_dispatch_customer_org_of(v_uid);
  if v_org is null then
    raise exception 'This login is not set up to place orders';
  end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'This login is not allowed to place orders';
  end if;

  select * into v_g from public.fms_dispatch_customer_orgs where id = v_org;

  -- ⚠ TRANSITIONAL, AND STILL HERE. Remove this branch, and raise instead, once
  --   the frontend carrying the company picker is live on master. See Phase 2.
  if v_company is null then
    select c.company_id into v_company
      from public.fms_dispatch_customer_org_companies(v_org) c
     limit 1;
    if v_company is null then
      raise exception 'Your account is not finished being set up. Please call us.';
    end if;
  end if;

  select mp.id into v_party
    from public.mst_parties mp
   where mp.id = any (v_g.party_ids) and mp.company_id = v_company;
  if v_party is null then
    raise exception 'Sorry - we cannot take an order for that company on your account. Please call us.';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'Sorry - we cannot take an order for that company just now. Please call us.';
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, location_id, customer_id,
    customer_location, order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at, intake_source
  ) values (
    v_no, null, v_company, null, v_party,
    v_g.customer_location, current_date, nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_g.display_name,
    -- The order is not awaiting a credit decision. It is awaiting being written up.
    'awaiting_order_completion', 'sales_order', now(),
    1, now(), 'customer'
  ) returning id into v_id;

  perform public.fms_dispatch_replace_customer_lines(v_id, p->'lines');

  -- ⚠ TO THE ORG'S NAMED RECIPIENTS, never to fms_dispatch_step_owner_ids('sales_order').
  --   That resolves to people whom fms_dispatch_can_see_order refuses on a
  --   null-location order, so announce would drop every one of them and the order
  --   would reach nobody (Correction 3).
  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'New customer order ' || v_no || ' from ' || v_g.display_name ||
    ' - open it under New Customer Orders and complete the details.',
    v_g.notify_user_ids,
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end
$fn$;

-- ===========================================================================
-- 4. COMPLETING ONE — THE WHOLE SALES ORDER, IN ONE CALL
-- ===========================================================================
-- ⚠ WHY NOT `fms_dispatch_update_order`, WHICH ALREADY DOES ALMOST THIS. Two
--   reasons, both fatal:
--
--   1. It gates on raiser-or-coordinator, and on a customer order the RAISER IS
--      THE CUSTOMER. The named recipient this work belongs to fails that check.
--   2. It writes lines through `fms_dispatch_replace_lines`, which validates the
--      exact `mst_party_items(customer_id, item_id)` pair -- 36 of 62 possible
--      lines on Bishen's primary book, 0 on two others. It would refuse lines
--      nobody touched. `fms_dispatch_replace_customer_lines` is the sibling that
--      validates against the union of ticked ledgers, by name since Phase 2.
create or replace function public.fms_dispatch_complete_customer_order(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := nullif(trim(p->>'company_id'), '')::uuid;
  v_loc     uuid := nullif(trim(p->>'location_id'), '')::uuid;
  v_type    text := nullif(lower(trim(p->>'dispatch_type')), '');
  v_date    date := nullif(trim(p->>'order_date'), '')::date;
  v_src     text;
  v_status  text;
  v_raiser  uuid;
  v_org     uuid;
  v_party   uuid;
  v_repointed integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select o.intake_source, o.status, o.raised_by
    into v_src, v_status, v_raiser
    from public.fms_dispatch_orders o where o.id = p_order for update;
  if v_src is null then raise exception 'Sales order not found'; end if;
  if v_src <> 'customer' then
    raise exception 'This order was raised by our own team - edit it on the order form instead';
  end if;
  if v_status <> 'awaiting_order_completion' then
    -- Reached from the credit-check queue's "Reopen details", which is allowed
    -- only while the verdict is undecided and nothing has dispatched.
    if not (v_status = 'awaiting_credit_check'
            and exists (select 1 from public.fms_dispatch_orders o
                         where o.id = p_order and o.cc_decided_at is null)
            and not exists (select 1 from public.fms_dispatch_rounds r where r.order_id = p_order))
    then
      raise exception 'This order has gone too far to change its details';
    end if;
  end if;
  if not public.fms_dispatch_can_act('sales_order', p_order, v_uid) then
    raise exception 'Not authorized to complete this order';
  end if;

  v_org := public.fms_dispatch_customer_org_of_login(v_raiser);
  if v_org is null then raise exception 'This order has no customer account behind it'; end if;

  -- ⚠ THE TICK LIST IS A LIMIT ON US (Q11). The company must be one this customer
  --   can legitimately be billed from, and the ledger follows from it.
  select mp.id into v_party
    from public.fms_dispatch_customer_orgs g
    join public.mst_parties mp on mp.id = any (g.party_ids)
   where g.id = v_org and mp.company_id = v_company;
  if v_party is null then
    raise exception 'That company does not bill this customer. Choose one of the companies on their ledger list.';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- Same rule fms_dispatch_submit_order applies: a site is required only where the
  -- company HAS one.
  if v_loc is not null then
    if not public.fms_dispatch_location_is_active_for_company(v_loc, v_company) then
      raise exception 'That location is not an active location of the selected company';
    end if;
  elsif exists (select 1 from public.mst_locations loc
                 join public.mst_company_locations cl on cl.location_id = loc.id
                where cl.company_id = v_company and loc.active and cl.active) then
    raise exception 'Choose the location this order dispatches from';
  end if;

  if v_type is null or v_type not in ('local','transport') then
    raise exception 'Choose whether this goes Local or by Transport';
  end if;

  update public.fms_dispatch_orders
     set company_id         = v_company,
         location_id        = v_loc,
         dispatch_type      = v_type,
         customer_id        = v_party,
         order_date         = coalesce(v_date, order_date),
         customer_po_no     = nullif(trim(p->>'customer_po_no'), ''),
         order_remarks      = nullif(trim(p->>'order_remarks'), ''),
         customer_location  = coalesce(nullif(trim(p->>'customer_location'), ''), customer_location),
         intake_completed_at = now(),
         status             = 'awaiting_credit_check',
         current_step       = 'credit_check',
         edited_at          = now(),
         edited_by          = v_uid
   where id = p_order;

  perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);

  if p ? 'lines' then
    perform public.fms_dispatch_replace_customer_lines(p_order, p->'lines');
  end if;

  -- ⚠ STILL HERE, AND STILL BEST EFFORT. Since Phase 2 the customer picks items
  --   from the billing book itself, so on an untouched order this moves nothing.
  --   It earns its place on the one path that can still produce a cross-book line:
  --   the completer CHANGING the company after the customer chose a different one.
  with moved as (
    update public.fms_dispatch_order_items li
       set item_id = tgt.id
      from public.mst_items src, public.mst_items tgt
     where li.order_id = p_order and src.id = li.item_id
       and upper(trim(tgt.name)) = upper(trim(src.name))
       and tgt.company_id = v_company and tgt.active
       and tgt.id <> li.item_id
    returning 1)
  select count(*) into v_repointed from moved;

  perform public.fms_dispatch_announce(
    'order', p_order, 'order_edited',
    'Customer order completed - it is now with credit check.',
    public.fms_dispatch_step_owner_ids('credit_check'),
    jsonb_build_object('lines_repointed', v_repointed));
end
$fn$;

revoke all on function public.fms_dispatch_complete_customer_order(uuid, jsonb) from public;
grant execute on function public.fms_dispatch_complete_customer_order(uuid, jsonb) to authenticated;

comment on function public.fms_dispatch_complete_customer_order(uuid, jsonb) is
  'OD-14. Writes up a customer order on the ordinary sales-order form and moves it to credit '
  'check. Gated on fms_dispatch_can_act(''sales_order'', …), which admits admins, coordinators '
  'and the customer''s named recipients (Q8) — never the raiser check fms_dispatch_update_order '
  'uses, because on a customer order the raiser is the customer.';

-- ===========================================================================
-- 5. THE ORDERS ALREADY WAITING
-- ===========================================================================
-- Every customer order that has not had its details filled in belongs in the new
-- queue; that is the whole point of building it. Keyed on the same pair that
-- decided this before the status existed, so it cannot catch anything else.
--
-- ⚠ THE `intake_completed_at is null` CLAUSE IS DOING THE WORK. Without it this
--   would drag back a held or cancelled customer order whose details were filled
--   in days ago — one of each exists live.
update public.fms_dispatch_orders
   set status = 'awaiting_order_completion',
       current_step = 'sales_order'
 where intake_source = 'customer'
   and intake_completed_at is null
   and status = 'awaiting_credit_check'
   and cc_decided_at is null
   and not exists (select 1 from public.fms_dispatch_rounds r where r.order_id = fms_dispatch_orders.id);

commit;
