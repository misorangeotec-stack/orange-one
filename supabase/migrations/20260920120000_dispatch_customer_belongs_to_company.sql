-- ORDER TO DISPATCH — the customer must be one the billing company can bill.
--
-- The third of the three narrowings the sales order form now applies. Two were
-- already enforced server-side and this one was not:
--
--   company → dispatch site   enforced (mst_company_locations, since Phase 2)
--   customer → item           enforced (mst_party_items, in fms_dispatch_replace_lines)
--   company → customer        ← this file
--
-- WHY IT HAS TO BE HERE AS WELL AS IN THE PICKER. The payload is JSON. A tab
-- left open before the narrowing shipped, or an edit that changes the company
-- after the customer was chosen, would otherwise post a pair the form would no
-- longer offer — and the billing company is on the invoice.
--
-- WHAT COUNTS AS "CAN BILL". Tally's own answer: a firm has a separate ledger
-- in every book it trades with, so mst_parties.company_id IS the mapping and no
-- second list is maintained. A customer with NO company book passes for every
-- company — that is not a loophole but the only workable rule for a customer
-- the portal has just created through a master request, which reaches Tally
-- only after the first invoice is raised.
--
-- ⚠ DEPLOY ORDER: THE FRONTEND MUST BE LIVE FIRST. 71 of the 303 orders raised
--   before this were billed by a company that is not the one on their
--   customer's ledger, because until now the picker offered one flat list of
--   328 names whatever company was chosen. Applying this while that picker is
--   still live would start refusing orders people are entitled to raise.
--
-- ⚠ AND EDITING AN OLD ORDER MUST STILL WORK. Those 71 are history and cannot
--   be re-decided; the update path therefore checks the pair ONLY when the
--   customer is actually being changed. Leaving a mismatched order's customer
--   alone stays legal; choosing a different one applies today's rule.
--
-- Additive: two CREATE OR REPLACE bodies, no schema change, no data touched.

create or replace function public.fms_dispatch_assert_customer_of_company(
  p_customer uuid, p_company uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text; v_co text;
begin
  if p_customer is null or p_company is null then return; end if;
  if exists (
    select 1 from public.mst_parties c
     where c.id = p_customer
       and c.is_customer
       and (c.company_id is null or c.company_id = p_company)
  ) then
    return;
  end if;

  -- Named, both halves. "Invalid customer" sends somebody hunting; the two
  -- names say which pair was refused and therefore what to change.
  select name into v_name from public.mst_parties where id = p_customer;
  select coalesce(nullif(trim(alias), ''), name) || coalesce(' - ' || location, '')
    into v_co from public.mst_companies where id = p_company;
  raise exception '% is not a customer of %. Pick a customer that company bills, or ask for the ledger to be opened in Tally.',
    coalesce(v_name, 'That customer'), coalesce(v_co, 'that company');
end $$;

comment on function public.fms_dispatch_assert_customer_of_company(uuid, uuid) is
  'Raises unless the customer sits in the billing company''s Tally book (or in none at all). Shared by submit and update so the two cannot drift.';


create or replace function public.fms_dispatch_submit_order(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_no text; v_seq integer;
  v_fy text := public.fms_dispatch_fy_code(current_date);
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(p->>'requester_name'), '');
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid; v_location uuid;
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
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- ← THE NEW RULE. On intake it is unconditional: a brand-new order has no
  --   history to protect and the picker only ever offered this company's own.
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


create or replace function public.fms_dispatch_update_order(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_cc timestamptz; v_raiser uuid; v_no text;
  v_uid uuid := auth.uid();
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid; v_location uuid; v_held boolean;
  v_cust_before uuid;
begin
  select status, cc_at, raised_by, order_no, cc_status = 'credit_hold', customer_id
    into v_status, v_cc, v_raiser, v_no, v_held, v_cust_before
  from public.fms_dispatch_orders where id = p_order for update;

  if v_status is null then raise exception 'Sales order not found'; end if;
  if v_status <> 'awaiting_credit_check' or v_cc is not null then
    raise exception 'This order can no longer be edited - the credit check has already been recorded';
  end if;
  -- A partial credit approval sends an exhausted order back to this status, so
  -- the two tests above are no longer sufficient on their own.
  if exists (select 1 from public.fms_dispatch_rounds where order_id = p_order) then
    raise exception 'This order has already dispatched - its details can no longer be edited';
  end if;
  if not (v_raiser = v_uid or public.fms_dispatch_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this order (or a coordinator) may edit it';
  end if;
  if v_type not in ('local','transport') then raise exception 'Dispatch type must be Local or Transport'; end if;

  v_cust := coalesce(nullif(p->>'customer_id','')::uuid, v_cust_before);

  -- ⚠ Ask what the ROW WOULD HOLD, not what the payload carries. An omitted key
  --   means "keep what is stored", so an older client that never learnt to send
  --   a company (or a location) does not fail with "choose the company".
  select case when p ? 'company_id'  then nullif(trim(p->>'company_id'),'')::uuid  else o.company_id  end,
         case when p ? 'location_id' then nullif(trim(p->>'location_id'),'')::uuid else o.location_id end
    into v_company, v_location
    from public.fms_dispatch_orders o where o.id = p_order;
  if v_company is null then
    raise exception 'Choose the company that bills this order';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- ← THE NEW RULE, DELIBERATELY CONDITIONAL. 71 of the 303 orders raised before
  --   the picker narrowed hold a customer the billing company does not bill,
  --   because the picker offered one flat list whatever company was chosen.
  --   Those orders are history: refusing to save them would mean an order that
  --   can be opened, corrected and then never put back. So the pair is only
  --   tested when the CUSTOMER is being changed — keeping the stored one is
  --   always allowed, choosing a different one obeys today's rule.
  if v_cust is distinct from v_cust_before then
    perform public.fms_dispatch_assert_customer_of_company(v_cust, v_company);
  end if;

  -- The same rule as intake, against whatever the row would end up holding: a
  -- location must belong to the company, and is compulsory once that company has
  -- any. Changing the company to one with different sites therefore forces a
  -- matching location rather than leaving a stale one pointing elsewhere.
  if v_location is not null then
    if not exists (select 1 from (select loc.id, cl.company_id, (loc.active and cl.active) as active from public.mst_locations loc join public.mst_company_locations cl on cl.location_id = loc.id) l
                    where l.id = v_location and l.company_id = v_company and l.active) then
      raise exception 'That location is not an active location of the selected company';
    end if;
  elsif exists (select 1 from (select loc.id, cl.company_id, (loc.active and cl.active) as active from public.mst_locations loc join public.mst_company_locations cl on cl.location_id = loc.id) l
                 where l.company_id = v_company and l.active) then
    raise exception 'Choose the location this order dispatches from';
  end if;

  update public.fms_dispatch_orders set
    dispatch_type = v_type,
    company_id    = v_company,
    location_id   = v_location,
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
end $function$;
