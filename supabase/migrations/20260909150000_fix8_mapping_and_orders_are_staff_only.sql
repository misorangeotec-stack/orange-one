-- FIX-8 · A customer's own login passed the gate that guards item mapping
--
-- WHAT WAS WRONG
--   `fms_dispatch_can_raise(uid)` was written when only staff could sign in. OD-13
--   gave three outside companies real logins, and the predicate was widened to admit
--   them so they could place their own orders:
--
--     case when fms_dispatch_customer_org_of(p_uid) is not null
--            then module_can_edit(p_uid, 'customer-orders')      -- an Order Desk CUSTOMER
--          else module_can_edit(p_uid, 'order-to-dispatch')
--               and fms_dispatch_can_raise__ungated(p_uid) end
--
--   Every call site inherited that widened meaning without being revisited. Two of
--   them are STAFF-ONLY operations and were left open to a customer session:
--
--     fms_dispatch_map_customer_item  — decides WHICH ITEMS a customer may buy.
--                                       A customer could add items to their own list.
--     fms_dispatch_submit_order       — the staff sales order. Takes customer_id,
--                                       company_id and location_id from its payload,
--                                       so a customer could raise an order naming
--                                       ANOTHER customer. (Found by the FIX-8 sweep;
--                                       the entry only named the mapping RPC.)
--
--   Both are SECURITY DEFINER with EXECUTE granted to `authenticated`, so they were
--   reachable by calling the endpoint directly with a valid customer session. Neither
--   is rendered by the Order Desk UI — hidden, not blocked. No evidence either was
--   ever called by a customer.
--
-- WHAT IS NOT CHANGED, DELIBERATELY
--   fms_dispatch_submit_customer_order already requires customer_org_of(uid) IS NOT
--   NULL, so it admits customers ONLY. That is what OD-13 built and it stays as it is.
--   fms_dispatch_can_raise itself is NOT touched: its widened meaning is correct for
--   that RPC. The two answers are both right in different places, so the fix is at the
--   call site rather than in the shared predicate.
--
-- THE ADDED CLAUSE IS A NO-OP FOR STAFF
--   Measured on live data 09-09-2026: fms_dispatch_customer_org_of() is NULL for all
--   65 internal profiles and NON-NULL for exactly the 3 external logins (Bishen Dyeing,
--   ZZ DEMO Bhoomi Fashion, ZZ TEST Kalahansh).
--
--   It also makes the guard BOOLEAN-CLEAN, which the old line was not. If
--   module_can_edit ever returned NULL, `can_raise` would be NULL, `not NULL` is NULL,
--   and `if not ... then raise` would never fire — silently authorising. With the new
--   clause a customer yields `<anything> and false` = false, so the guard fires
--   regardless of what the first arm returns.
--
-- Additive: two CREATE OR REPLACE, same signatures, so OIDs and EXECUTE grants survive.
-- ⚠ Do NOT "fix" this instead by revoking the `authenticated` EXECUTE grant — the
--   customer's own three RPCs need it, and revoking it broadly breaks the Order Desk.

CREATE OR REPLACE FUNCTION public.fms_dispatch_map_customer_item(p_customer uuid, p_company uuid, p_items uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_created     integer := 0;
  v_reactivated integer := 0;
  v_skipped     integer := 0;
  v_item        uuid;
  v_bad         text;
  v_existing    boolean;
begin
  -- FIX-8: staff only. `can_raise` alone admits an Order Desk customer, who would
  -- then be deciding which items they are allowed to buy.
  if not (public.fms_dispatch_can_raise(auth.uid())
          and public.fms_dispatch_customer_org_of(auth.uid()) is null) then
    raise exception 'You do not have permission to map items in Order to Dispatch.';
  end if;

  if p_customer is null or p_company is null then
    raise exception 'A mapping needs both a customer and a company';
  end if;

  if p_items is null or cardinality(p_items) = 0 then
    return jsonb_build_object('created', 0, 'reactivated', 0, 'skipped', 0);
  end if;

  perform public.fms_dispatch_assert_customer_of_company(p_customer, p_company);

  select string_agg(i.name, ', ' order by i.name) into v_bad
    from public.mst_items i
   where i.id = any(p_items)
     and (i.company_id is distinct from p_company or not i.active);

  if v_bad is not null then
    raise exception 'These items are not in that company''s book, or are switched off: %', v_bad;
  end if;

  if (select count(*) from public.mst_items i where i.id = any(p_items))
     <> cardinality(p_items) then
    raise exception 'One of those items no longer exists. Reload and try again.';
  end if;

  foreach v_item in array p_items loop
    select active into v_existing
      from public.mst_party_items
     where party_id = p_customer and item_id = v_item;

    if v_existing is null then
      insert into public.mst_party_items (party_id, item_id, source, created_by)
      values (p_customer, v_item, 'portal', auth.uid());
      v_created := v_created + 1;
    elsif v_existing then
      v_skipped := v_skipped + 1;
    else
      update public.mst_party_items
         set active = true, updated_at = now()
       where party_id = p_customer and item_id = v_item;
      v_reactivated := v_reactivated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'reactivated', v_reactivated, 'skipped', v_skipped);
end $function$;


CREATE OR REPLACE FUNCTION public.fms_dispatch_submit_order(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_no text; v_seq integer;
  v_fy text := public.fms_dispatch_fy_code(current_date);
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p->>'requester_name'), '');
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid; v_location uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  -- FIX-8: staff only. A customer login passes `can_raise`, and this RPC takes the
  -- customer, the billing company and the site from its payload — so without this
  -- clause a customer could raise an order in ANOTHER customer's name. Their own
  -- route is fms_dispatch_submit_customer_order, which derives all three from them.
  if not (public.fms_dispatch_can_raise(v_uid)
          and public.fms_dispatch_customer_org_of(v_uid) is null) then
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
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- Unconditional on intake: a brand-new order has no history to protect,
  -- and the picker only ever offered this company's own customers.
  perform public.fms_dispatch_assert_customer_of_company(v_cust, v_company);

  -- THE SITE THIS LEAVES FROM.
  v_location := nullif(trim(p->>'location_id'), '')::uuid;
  if v_location is not null then
    if not exists (select 1 from (select loc.id, cl.company_id, (loc.active and cl.active) as active from public.mst_locations loc join public.mst_company_locations cl on cl.location_id = loc.id) l
                    where l.id = v_location and l.company_id = v_company and l.active) then
      raise exception 'That location is not an active location of the selected company';
    end if;
  elsif exists (select 1 from (select loc.id, cl.company_id, (loc.active and cl.active) as active from public.mst_locations loc join public.mst_company_locations cl on cl.location_id = loc.id) l
                 where l.company_id = v_company and l.active) then
    raise exception 'Choose the location this order dispatches from';
  end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, location_id, customer_id,
    customer_location, customer_po_no,
    order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at
  ) values (
    v_no, v_type, v_company, v_location, v_cust,
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
end $function$;
