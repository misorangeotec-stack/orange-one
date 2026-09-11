-- ===========================================================================
-- ROLLBACK OF 20261117120100_od14_customer_picks_the_book.sql
--
-- Restores every function to the body it had before OD-14 Phase 2, verbatim from
-- pg_get_functiondef, and drops the two that did not exist.
--
-- ⚠ ROLL THE FRONTEND BACK FIRST, OR THIS BREAKS ORDERING OUTRIGHT. The OD-14
--   Order Desk sends `p_company` to fms_dispatch_my_items and `company_id` to
--   fms_dispatch_submit_customer_order. The restored functions accept neither: the
--   items call fails on an unknown argument and the customer sees an empty picker.
--   Undeploy, then run this.
--
-- ⚠ ORDERS ALREADY PLACED KEEP THEIR COMPANY, AND THAT IS CORRECT. An order raised
--   under OD-14 carries `company_id` and a `customer_id` pointing at that book's
--   ledger. Nothing here unwinds them, and nothing should: they are real orders
--   billed to a real company, and the pre-OD-14 credit-check panel handles a
--   company that is already set perfectly well — it simply asks again.
--
-- ⚠ WHAT THIS DOES COST: the `primary_ledger` readiness arm comes back, and every
--   customer saved through the OD-14 form has `primary_party_id` still holding
--   whatever it held before (the form stopped writing it; it never cleared it). So
--   an org created FRESH under OD-14 has a null main ledger and will refuse to
--   switch on until an admin picks one. Three customers exist today, all created
--   before OD-14, all with the column populated.
-- ===========================================================================

begin;

-- 1 · the two new functions go
drop function if exists public.fms_dispatch_my_companies();
drop function if exists public.fms_dispatch_customer_org_companies(uuid);

-- 2 · items, back to the union with no argument
drop function if exists public.fms_dispatch_my_items(uuid);

create or replace function public.fms_dispatch_my_items()
returns table(item_id uuid, name text, unit text, item_type text)
language sql stable security definer set search_path to 'public'
as $fn$
  select distinct on (i.name)
         i.id, i.name, u.name, i.item_type
    from public.fms_dispatch_customer_orgs g
    join public.mst_party_items pi on pi.party_id = any (g.party_ids) and pi.active
    join public.mst_items i on i.id = pi.item_id and i.active
    left join public.mst_units u on u.id = i.unit_id
   where g.id = public.fms_dispatch_customer_org_of(auth.uid())
   order by i.name, i.id;
$fn$;

revoke all on function public.fms_dispatch_my_items() from public;
grant execute on function public.fms_dispatch_my_items() to authenticated;

-- 3 · my_orders loses the book
drop function if exists public.fms_dispatch_my_orders();

create or replace function public.fms_dispatch_my_orders()
returns table(id uuid, order_no text, order_date date, order_remarks text,
              status_key text, can_change boolean, placed_at timestamptz, lines jsonb)
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

-- 4 · lines validate on the exact item id again
--
-- ⚠ AND THIS IS THE ONE THAT BITES ORDERS ALREADY PLACED. A line raised under
--   OD-14 carries the BILLING BOOK'S copy of the item, which may have no mapping
--   row of its own — 28 of Kalahansh's 53 Enterprise items are like that. Such an
--   order can still be read, dispatched and invoiced; it can no longer be EDITED
--   by the customer, who gets "Sorry - X is not on your list" on a line they never
--   touched. Map the missing pairs in Central Masters if that matters.
create or replace function public.fms_dispatch_replace_customer_lines(p_order uuid, p_lines jsonb)
returns integer
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  l jsonb;
  v_n integer := 0;
  v_org uuid;
  v_parties uuid[];
  v_item uuid;
  v_unit text;
  v_item_name text;
begin
  if exists (select 1 from public.fms_dispatch_rounds where order_id = p_order) then
    raise exception 'The items cannot be changed - a dispatch has already gone out on this order';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Add at least one item to your order';
  end if;

  select public.fms_dispatch_customer_org_of_login(o.raised_by) into v_org
    from public.fms_dispatch_orders o where o.id = p_order;
  if v_org is null then
    raise exception 'This is not a customer order';
  end if;
  select g.party_ids into v_parties from public.fms_dispatch_customer_orgs g where g.id = v_org;

  delete from public.fms_dispatch_order_items where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(l->>'item_id'), '') = '' then continue; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then
      raise exception 'Every item needs a quantity greater than zero';
    end if;

    v_item := (l->>'item_id')::uuid;

    if not exists (
      select 1 from public.mst_party_items ci
       where ci.party_id = any (v_parties) and ci.item_id = v_item and ci.active
    ) then
      select name into v_item_name from public.mst_items where id = v_item;
      raise exception 'Sorry - % is not on your list. Please call us and we will add it.',
        coalesce(v_item_name, 'that item');
    end if;

    select u.name into v_unit
      from public.mst_items i
      left join public.mst_units u on u.id = i.unit_id
     where i.id = v_item;

    v_n := v_n + 1;
    insert into public.fms_dispatch_order_items (order_id, line_no, item_id, quantity, unit, line_remark)
    values (p_order, v_n, v_item, (l->>'quantity')::numeric, v_unit, nullif(trim(l->>'line_remark'), ''));
  end loop;

  if v_n = 0 then raise exception 'Add at least one item to your order'; end if;
  return v_n;
end
$fn$;

-- 5 · submit goes back to the provisional main ledger
create or replace function public.fms_dispatch_submit_customer_order(p jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_g    public.fms_dispatch_customer_orgs%rowtype;
  v_id   uuid;
  v_no   text;
  v_seq  integer;
  v_fy   text := public.fms_dispatch_fy_code(current_date);
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
  if v_g.primary_party_id is null then
    raise exception 'Your account is not finished being set up. Please call us.';
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, location_id, customer_id,
    customer_location, order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at, intake_source
  ) values (
    v_no, null, null, null, v_g.primary_party_id,
    v_g.customer_location, current_date, nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_g.display_name,
    'awaiting_credit_check', 'credit_check', now(),
    1, now(), 'customer'
  ) returning id into v_id;

  perform public.fms_dispatch_replace_customer_lines(v_id, p->'lines');

  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'New order ' || v_no || ' from ' || v_g.display_name ||
    ' - fill in the billing company, site and dispatch type, then run the credit check.',
    v_g.notify_user_ids,
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end
$fn$;

-- 6 · readiness, orgs_admin and save_customer_org take the main ledger back
create or replace function public.fms_dispatch_customer_org_readiness(
  p_party_ids uuid[], p_notify_user_ids uuid[], p_primary_party_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'missing', coalesce(jsonb_agg(m order by m), '[]'::jsonb),
    'item_count', (
      select count(distinct i.name)
        from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
       where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[]))
         and pi.active and i.active
    )
  )
  from (
    select 'ledgers' as m where coalesce(cardinality(p_party_ids), 0) = 0
    union all
    select 'primary_ledger'
     where p_primary_party_id is null
        or not (p_primary_party_id = any (coalesce(p_party_ids, '{}'::uuid[])))
    union all
    select 'recipients' where coalesce(cardinality(p_notify_user_ids), 0) = 0
    union all
    select 'items' where not exists (
       select 1 from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
        where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[]))
          and pi.active and i.active)
  ) s;
$fn$;

create or replace function public.fms_dispatch_customer_orgs_admin()
returns table(id uuid, display_name text, party_ids uuid[], party_names text[],
              primary_party_id uuid, primary_party_name text, customer_location text,
              notify_user_ids uuid[], notify_names text[], default_location_id uuid,
              default_dispatch_type text, active boolean, login_count integer,
              item_count integer, missing text[])
language sql stable security definer set search_path to 'public'
as $fn$
  select g.id, g.display_name, g.party_ids,
         (select coalesce(array_agg(mp.name order by c.name), '{}')
            from public.mst_parties mp left join public.mst_companies c on c.id = mp.company_id
           where mp.id = any (g.party_ids)),
         g.primary_party_id,
         (select mp.name from public.mst_parties mp where mp.id = g.primary_party_id),
         g.customer_location,
         g.notify_user_ids,
         (select coalesce(array_agg(pr.name order by pr.name), '{}')
            from public.profiles pr where pr.id = any (g.notify_user_ids)),
         g.default_location_id, g.default_dispatch_type, g.active,
         (select count(*)::integer from public.fms_dispatch_customer_logins l
           where l.org_id = g.id and l.active),
         (r.value->>'item_count')::integer,
         (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r.value->'missing') t(x))
    from public.fms_dispatch_customer_orgs g
    cross join lateral (
      select public.fms_dispatch_customer_org_readiness(
               g.party_ids, g.notify_user_ids, g.primary_party_id) as value
    ) r
   where public.fms_dispatch_is_coordinator(auth.uid())
   order by g.display_name;
$fn$;

create or replace function public.fms_dispatch_save_customer_org(p jsonb)
returns uuid
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid := nullif(trim(p->>'id'), '')::uuid;
  v_name     text := nullif(trim(p->>'display_name'), '');
  v_parties  uuid[];
  v_notify   uuid[];
  v_primary  uuid := nullif(trim(p->>'primary_party_id'), '')::uuid;
  v_loc      uuid := nullif(trim(p->>'default_location_id'), '')::uuid;
  v_type     text := nullif(lower(trim(p->>'default_dispatch_type')), '');
  v_active   boolean := coalesce((p->>'active')::boolean, false);
  v_ready    jsonb;
  v_missing  text;
  v_bad      text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only an admin or a process coordinator can set up customer logins';
  end if;
  if v_name is null then raise exception 'Give the customer a name -- this is what they see on their own screen'; end if;

  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_parties
    from jsonb_array_elements_text(coalesce(p->'party_ids', '[]'::jsonb)) t(x);
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_notify
    from jsonb_array_elements_text(coalesce(p->'notify_user_ids', '[]'::jsonb)) t(x);

  select string_agg(x::text, ', ') into v_bad
    from unnest(v_parties) x
   where not exists (select 1 from public.mst_parties mp
                      where mp.id = x and mp.is_customer and mp.active);
  if v_bad is not null then
    raise exception 'One of the ticked ledgers is not an active customer ledger (%)', v_bad;
  end if;

  select string_agg(mp.name, ', ') into v_bad
    from public.mst_parties mp
   where mp.id = any (v_parties) and mp.company_id is null;
  if v_bad is not null then
    raise exception 'This ledger has no billing company, so credit check could never choose it: %', v_bad;
  end if;

  select string_agg(c.name, ', ') into v_bad
    from (select mp.company_id, count(*) n
            from public.mst_parties mp
           where mp.id = any (v_parties)
           group by mp.company_id having count(*) > 1) d
    join public.mst_companies c on c.id = d.company_id;
  if v_bad is not null then
    raise exception 'Two ticked ledgers belong to the same billing company (%). Tick only one per company, or credit check cannot tell them apart.', v_bad;
  end if;

  if v_primary is not null and not (v_primary = any (v_parties)) then
    raise exception 'The main ledger must be one of the ticked ledgers';
  end if;

  select string_agg(coalesce(pr.name, x::text), ', ') into v_bad
    from unnest(v_notify) x
    left join public.profiles pr on pr.id = x
   where pr.id is null
      or coalesce(pr.is_external, false)
      or not public.module_can_edit(x, 'order-to-dispatch');
  if v_bad is not null then
    raise exception 'These people cannot be told about this customer''s orders -- they need edit access to Order to Dispatch: %', v_bad;
  end if;

  if v_type is not null and v_type not in ('local','transport') then
    raise exception 'Dispatch type must be Local or Transport';
  end if;
  if v_loc is not null and not exists (
       select 1 from public.mst_parties mp
        where mp.id = any (v_parties)
          and public.fms_dispatch_location_is_active_for_company(v_loc, mp.company_id))
  then
    raise exception 'That dispatch location is not an active site of any of the ticked ledgers'' companies';
  end if;

  if v_active then
    v_ready := public.fms_dispatch_customer_org_readiness(v_parties, v_notify, v_primary);
    if jsonb_array_length(v_ready->'missing') > 0 then
      select string_agg(
               case x when 'ledgers'        then 'no ledgers are ticked'
                      when 'primary_ledger' then 'no main ledger is chosen'
                      when 'recipients'     then 'nobody is set to be told about their orders'
                      when 'items'          then 'none of the ticked ledgers has a single item mapped to it, so their order screen would be empty'
                      else x end, '; ')
        into v_missing
        from jsonb_array_elements_text(v_ready->'missing') t(x);
      raise exception 'This customer is not ready to switch on: %', v_missing;
    end if;
  end if;

  if v_id is null then
    insert into public.fms_dispatch_customer_orgs (
      display_name, party_ids, primary_party_id, customer_location,
      notify_user_ids, default_location_id, default_dispatch_type, active,
      created_by, updated_by)
    values (
      v_name, v_parties, v_primary, nullif(trim(p->>'customer_location'), ''),
      v_notify, v_loc, v_type, v_active, v_uid, v_uid)
    returning id into v_id;
  else
    update public.fms_dispatch_customer_orgs
       set display_name          = v_name,
           party_ids             = v_parties,
           primary_party_id      = v_primary,
           customer_location     = nullif(trim(p->>'customer_location'), ''),
           notify_user_ids       = v_notify,
           default_location_id   = v_loc,
           default_dispatch_type = v_type,
           active                = v_active,
           updated_at            = now(),
           updated_by            = v_uid
     where id = v_id;
    if not found then raise exception 'That customer no longer exists'; end if;
  end if;

  return v_id;
end
$fn$;

drop function if exists public.fms_dispatch_customer_org_readiness(uuid[], uuid[]);

commit;
