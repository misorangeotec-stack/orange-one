-- ===========================================================================
-- OD-17 — THE CUSTOMER PICKS WHICH OF THEIR OWN FIRMS IS ORDERING, NOT OUR BOOK,
--         AND SEES ONLY THE ITEMS WE CHOSE FOR THEM.
--
-- 1. OD-14 had the customer choose one of OUR companies ("O-tec - Surat"), and
--    OD-16 only renamed it to a form. The company is not the customer's question
--    at all: it is chosen at our end, on Complete Customer Order. What the
--    customer DOES choose is which of THEIR firms the order is for — the ledgers
--    ticked for them in Setup → Customer Logins, which Setup now ticks by
--    CUSTOMER GROUP (the receivables-hub muster in ConnectWave), machine ledgers
--    excluded.
--
-- 2. Their item list was `mst_party_items` — a SHARED mapping that the Sales
--    Register sync fills with everything a customer has ever bought (heads,
--    spare parts, inks). Setup was editing that same list, so "only these inks"
--    could not be expressed without also hiding items from our own staff's
--    sales-order picker. The Order Desk now has its OWN list per customer:
--    `fms_dispatch_customer_orgs.portal_item_ids`, set only in Setup.
--    `mst_party_items` is no longer read or written by anything here.
--
-- ⚠ Q11 IS DELIBERATELY REVERSED, IN PART. The customer now reads their own
--   ledger NAMES — their own firm names, which they already know. They still
--   never see which of our books each one sits in or how many there are.
--
-- ⚠ ONE OPTION PER NAME, NOT PER LEDGER. "GANGA FASHION PVT LTD" is a separate
--   ledger in every book that bills them; to the customer it is one firm. The
--   option carries one representative party id and every server function
--   expands it back with `fms_dispatch_org_ledger_parties`.
--
-- ⚠ DEPLOY TOGETHER WITH THE FRONTEND. The customer side stays backward
--   compatible (`submit` still accepts `company_id`, `my_items(p_company)` still
--   answers, `my_orders` only gains columns), but the item list moves: until
--   Setup has ticked items into `portal_item_ids`, a customer's screen is empty
--   and Setup reports them "not ready". Existing customers start EMPTY on
--   purpose — the old list is exactly what is being replaced.
--
-- What changes:
--   0. fms_dispatch_customer_orgs.portal_item_ids   new column
--   1. fms_dispatch_org_ledger_parties   new  — ticked ledgers sharing a name
--   2. fms_dispatch_customer_org_ledgers new  — the customer's firms
--   3. fms_dispatch_my_ledgers           new  — the same, for the caller
--   4. fms_dispatch_my_items             reads portal_item_ids; +p_ledger
--   5. fms_dispatch_submit_customer_order  accepts ledger_id; company stays NULL
--   6. fms_dispatch_replace_customer_lines items checked against portal_item_ids
--   7. fms_dispatch_complete_customer_order the company must bill THAT firm
--   8. fms_dispatch_customer_intake_options only THAT firm's companies
--   9. fms_dispatch_my_orders            +ledger_id, +ledger_name
--  10. fms_dispatch_customer_org_readiness(uuid[],uuid[],uuid[])  new overload
--  11. fms_dispatch_customer_orgs_admin  +portal_item_ids, counts the new list
--  12. fms_dispatch_my_customer_profile  counts the new list
--  13. fms_dispatch_save_customer_org    saves item_ids; machine ledgers refused;
--                                        one ledger per book PER NAME
-- ===========================================================================

begin;

-- ===========================================================================
-- 0. THE ORDER DESK'S OWN ITEM LIST
--
-- Ids of mst_items, any book's copy; everything matches by name across books,
-- exactly as the old mapping did. An array on the org rather than a table: it
-- is only ever read and written whole, by the one save that also checks it.
-- ===========================================================================
alter table public.fms_dispatch_customer_orgs
  add column if not exists portal_item_ids uuid[] not null default '{}'::uuid[];

-- ===========================================================================
-- 1. THE TICKED LEDGERS THAT ARE THE SAME FIRM AS p_party
--
-- Empty when p_party is not one of this org's ticked ledgers — which is how a
-- forged or stale id is refused: every caller treats empty as "not yours".
-- Internal only; never granted to a browser role.
-- ===========================================================================
create or replace function public.fms_dispatch_org_ledger_parties(p_org uuid, p_party uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(mp.id order by mp.id), '{}'::uuid[])
    from public.fms_dispatch_customer_orgs g
    join public.mst_parties me on me.id = p_party and me.id = any (g.party_ids)
    join public.mst_parties mp on mp.id = any (g.party_ids)
                              and upper(trim(mp.name)) = upper(trim(me.name))
   where g.id = p_org;
$$;

revoke all on function public.fms_dispatch_org_ledger_parties(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. THE CUSTOMER'S FIRMS — one row per distinct ledger name
--
-- Machine ledgers never appear (Tally group MACHINE DEBTORS, or the naming
-- convention), even on an org saved before Setup refused them. `item_count` is
-- the org's list — the same for every firm, since the list is per customer.
-- ===========================================================================
create or replace function public.fms_dispatch_customer_org_ledgers(p_org uuid)
returns table (ledger_id uuid, ledger_name text, item_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select (array_agg(mp.id order by mp.id))[1],
         min(trim(mp.name)),
         (select count(distinct upper(trim(i.name)))::integer
            from public.mst_items i
           where i.id = any (g.portal_item_ids) and i.active)
    from public.fms_dispatch_customer_orgs g
    join public.mst_parties mp  on mp.id = any (g.party_ids)
    join public.mst_companies c on c.id = mp.company_id and c.active
   where g.id = p_org
     and not coalesce(mp.group_chain @> array['MACHINE DEBTORS'], false)
     and upper(mp.name) !~ '\mMACHINES?\M'
   group by g.portal_item_ids, upper(trim(mp.name))
   order by 2;
$$;

revoke all on function public.fms_dispatch_customer_org_ledgers(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. THE CALLER'S OWN FIRMS
-- ===========================================================================
create or replace function public.fms_dispatch_my_ledgers()
returns table (ledger_id uuid, ledger_name text, item_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.fms_dispatch_customer_org_ledgers(
    public.fms_dispatch_customer_org_of(auth.uid()));
$$;

revoke all on function public.fms_dispatch_my_ledgers() from public, anon;
grant execute on function public.fms_dispatch_my_ledgers() to authenticated;

-- ===========================================================================
-- 4. WHAT THEY MAY ORDER — the Order Desk's own list, nothing else
--
-- With no company (a new order; the company is still ours to choose) the ids
-- are the listed rows themselves. With a company (an order we have written
-- up) each listed name resolves to THAT BOOK'S copy, so a change cannot add a
-- line the billing book cannot supply. `p_ledger` is accepted for the firm the
-- order is for; the list is per customer, so it does not narrow it today.
-- ===========================================================================
drop function if exists public.fms_dispatch_my_items(uuid);

create function public.fms_dispatch_my_items(p_company uuid default null, p_ledger uuid default null)
returns table (item_id uuid, name text, unit text, item_type text)
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select o.portal_item_ids as ids
      from public.fms_dispatch_customer_orgs o
     where o.id = public.fms_dispatch_customer_org_of(auth.uid())
  ), src as (
    select i.id, i.name, i.item_type, i.unit_id
      from g
      join public.mst_items i on i.id = any (g.ids) and i.active
     where p_company is null
    union all
    select tgt.id, tgt.name, tgt.item_type, tgt.unit_id
      from g
      join public.mst_items s   on s.id = any (g.ids) and s.active
      join public.mst_items tgt on tgt.company_id = p_company and tgt.active
                               and upper(trim(tgt.name)) = upper(trim(s.name))
     where p_company is not null
  )
  select distinct on (src.name) src.id, src.name, u.name, src.item_type
    from src
    left join public.mst_units u on u.id = src.unit_id
   order by src.name, src.id;
$$;

revoke all on function public.fms_dispatch_my_items(uuid, uuid) from public, anon;
grant execute on function public.fms_dispatch_my_items(uuid, uuid) to authenticated;

-- ===========================================================================
-- 5. PLACING AN ORDER — the customer names their firm, we choose the company
--
-- `ledger_id` is the new path: the order is stored against that ledger
-- (`customer_id`, NOT NULL) with `company_id` NULL until Complete Customer
-- Order fills it in. `company_id` is the OD-14 path, kept so the frontend
-- already on live keeps working until the new one is deployed.
-- ===========================================================================
create or replace function public.fms_dispatch_submit_customer_order(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_g       public.fms_dispatch_customer_orgs%rowtype;
  v_ledger  uuid := nullif(trim(p->>'ledger_id'), '')::uuid;
  v_company uuid := nullif(trim(p->>'company_id'), '')::uuid;
  v_party   uuid;
  v_id      uuid;
  v_no      text;
  v_seq     integer;
  v_fy      text := public.fms_dispatch_fy_code(current_date);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  v_org := public.fms_dispatch_customer_org_of(v_uid);
  if v_org is null then raise exception 'This login is not set up to place orders'; end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'This login is not allowed to place orders';
  end if;

  select * into v_g from public.fms_dispatch_customer_orgs where id = v_org;

  if v_ledger is not null then
    -- OD-17: their firm, not our book. The company is chosen at our end.
    if cardinality(public.fms_dispatch_org_ledger_parties(v_org, v_ledger)) = 0 then
      raise exception 'Sorry - we cannot take an order for that account. Please call us.';
    end if;
    v_party   := v_ledger;
    v_company := null;
  elsif v_company is not null then
    -- OD-14 path, for the frontend that still sends a company.
    select mp.id into v_party
      from public.mst_parties mp
     where mp.id = any (v_g.party_ids) and mp.company_id = v_company;
    if v_party is null then
      raise exception 'Sorry - we cannot take an order for that company on your account. Please call us.';
    end if;
    if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
      raise exception 'Sorry - we cannot take an order for that company just now. Please call us.';
    end if;
  else
    if not exists (select 1 from public.fms_dispatch_customer_org_ledgers(v_org)) then
      raise exception 'Your account is not finished being set up. Please call us.';
    end if;
    raise exception 'Please choose which of your companies this order is for.';
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
    'awaiting_order_completion', 'sales_order', now(),
    1, now(), 'customer'
  ) returning id into v_id;

  perform public.fms_dispatch_replace_customer_lines(v_id, p->'lines');

  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'New customer order ' || v_no || ' from ' || v_g.display_name ||
    ' - open it under New Customer Orders and complete the details.',
    v_g.notify_user_ids,
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end
$$;

-- ===========================================================================
-- 6. LINES — checked against the Order Desk's own list, by name
--
-- By name because the picker hands out the book's copy once an order has a
-- company, which can be a different mst_items row from the one Setup listed.
-- Completion calls this too, so a staff-side edit is held to the same list.
-- ===========================================================================
create or replace function public.fms_dispatch_replace_customer_lines(p_order uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l jsonb;
  v_n integer := 0;
  v_org uuid;
  v_items uuid[];
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
  select g.portal_item_ids into v_items from public.fms_dispatch_customer_orgs g where g.id = v_org;

  delete from public.fms_dispatch_order_items where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(trim(l->>'item_id'), '') = '' then continue; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then
      raise exception 'Every item needs a quantity greater than zero';
    end if;

    v_item := (l->>'item_id')::uuid;

    if not exists (
      select 1
        from public.mst_items src
        join public.mst_items tgt on tgt.id = v_item
       where src.id = any (v_items) and src.active
         and upper(trim(src.name)) = upper(trim(tgt.name))
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
$$;

-- ===========================================================================
-- 7. COMPLETING — the company we choose must bill THE FIRM THEY ORDERED FOR
--
-- Without this, an account with two firms in two books would let the clerk
-- pick the other firm's book and bill the wrong firm without a word.
-- ===========================================================================
create or replace function public.fms_dispatch_complete_customer_order(p_order uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := nullif(trim(p->>'company_id'), '')::uuid;
  v_loc     uuid := nullif(trim(p->>'location_id'), '')::uuid;
  v_type    text := nullif(lower(trim(p->>'dispatch_type')), '');
  v_date    date := nullif(trim(p->>'order_date'), '')::date;
  v_src     text;
  v_status  text;
  v_raiser  uuid;
  v_cur     uuid;
  v_org     uuid;
  v_firm    uuid[];
  v_party   uuid;
  v_repointed integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select o.intake_source, o.status, o.raised_by, o.customer_id
    into v_src, v_status, v_raiser, v_cur
    from public.fms_dispatch_orders o where o.id = p_order for update;
  if v_src is null then raise exception 'Sales order not found'; end if;
  if v_src <> 'customer' then
    raise exception 'This order was raised by our own team - edit it on the order form instead';
  end if;
  if v_status <> 'awaiting_order_completion' then
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

  v_firm := public.fms_dispatch_org_ledger_parties(v_org, v_cur);
  if cardinality(v_firm) = 0 then
    select g.party_ids into v_firm from public.fms_dispatch_customer_orgs g where g.id = v_org;
  end if;

  select mp.id into v_party
    from public.mst_parties mp
   where mp.id = any (v_firm) and mp.company_id = v_company;
  if v_party is null then
    raise exception 'That company does not bill the firm this order is for. Choose one of the companies offered.';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

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
     set company_id          = v_company,
         location_id         = v_loc,
         dispatch_type       = v_type,
         customer_id         = v_party,
         order_date          = coalesce(v_date, order_date),
         customer_po_no      = nullif(trim(p->>'customer_po_no'), ''),
         order_remarks       = nullif(trim(p->>'order_remarks'), ''),
         customer_location   = coalesce(nullif(trim(p->>'customer_location'), ''), customer_location),
         intake_completed_at = now(),
         status              = 'awaiting_credit_check',
         current_step        = 'credit_check',
         edited_at           = now(),
         edited_by           = v_uid
   where id = p_order;

  perform public.fms_dispatch_assert_customer_of_company(v_party, v_company);

  if p ? 'lines' then
    perform public.fms_dispatch_replace_customer_lines(p_order, p->'lines');
  end if;

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
$$;

-- ===========================================================================
-- 8. THE CLERK'S COMPANY LIST — only the books that bill the ordering firm
-- ===========================================================================
create or replace function public.fms_dispatch_customer_intake_options(p_order uuid)
returns table (company_id uuid, company_name text, default_location_id uuid, default_dispatch_type text)
language sql
stable
security definer
set search_path = public
as $$
  with o as (
    select o.id, o.customer_id,
           public.fms_dispatch_customer_org_of_login(o.raised_by) as org
      from public.fms_dispatch_orders o
     where o.id = p_order
       and o.intake_source = 'customer'
       and public.fms_dispatch_can_act('credit_check', p_order, auth.uid())
  ), firm as (
    select o.org,
           coalesce(nullif(public.fms_dispatch_org_ledger_parties(o.org, o.customer_id), '{}'::uuid[]),
                    g.party_ids) as ids
      from o
      join public.fms_dispatch_customer_orgs g on g.id = o.org
  )
  select mp.company_id,
         coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
         g.default_location_id,
         g.default_dispatch_type
    from firm
    join public.fms_dispatch_customer_orgs g on g.id = firm.org
    join public.mst_parties mp  on mp.id = any (firm.ids)
    join public.mst_companies c on c.id = mp.company_id
   where c.active
   order by 2;
$$;

-- ===========================================================================
-- 9. THEIR ORDERS — now with the firm each was placed for
--
-- Body identical to the live definition apart from the two new trailing
-- columns. Columns are only ADDED, so the frontend already on live (which maps
-- by name) is unaffected.
-- ===========================================================================
drop function if exists public.fms_dispatch_my_orders();

create function public.fms_dispatch_my_orders()
returns table (
  id uuid, order_no text, order_date date, order_remarks text, status_key text,
  can_change boolean, placed_at timestamp with time zone, company_id uuid,
  company_label text, form_name text, dispatch_notes jsonb, lines jsonb,
  ledger_id uuid, ledger_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.order_no, o.order_date, o.order_remarks,
         -- The four words; arm order is the logic — see OD-16 for the reasoning.
         case
           when o.status in ('cancelled', 'awaiting_sales_return') then 'cancelled'
           when o.status = 'closed'                                then 'delivered'
           when o.go_at is not null
             or exists (select 1 from public.fms_dispatch_rounds r
                         where r.order_id = o.id and r.go_at is not null)
                                                                   then 'out_for_delivery'
           when public.fms_dispatch_customer_window_open(o.id)      then 'request_raised'
           else 'accepted'
         end,
         public.fms_dispatch_customer_window_open(o.id),
         o.submitted_at,
         o.company_id,
         (select coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, '')
            from public.mst_companies c where c.id = o.company_id),
         (select f.form_name
            from public.fms_dispatch_customer_orgs g
            join public.mst_parties mp on mp.id = any (g.party_ids)
                                      and mp.company_id = o.company_id
            join public.fms_dispatch_ledger_forms f on f.party_id = mp.id and f.active
           where g.id = public.fms_dispatch_customer_org_of(auth.uid())
           limit 1),
         coalesce((
           select jsonb_agg(n order by n->>'sent_on', n->>'round_no')
             from (
               select jsonb_build_object(
                        'round_no', r.round_no,
                        'sent_on',  r.go_actual_date,
                        'note',     r.go_customer_remark) as n
                 from public.fms_dispatch_rounds r
                where r.order_id = o.id
                  and r.go_at is not null
                  and nullif(trim(r.go_customer_remark), '') is not null
               union all
               select jsonb_build_object(
                        'round_no', o.round_no,
                        'sent_on',  o.go_actual_date,
                        'note',     o.go_customer_remark)
                where o.go_at is not null
                  and nullif(trim(o.go_customer_remark), '') is not null
             ) s
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'line_no', li.line_no, 'item_id', li.item_id, 'name', i.name,
                    'quantity', li.quantity, 'unit', li.unit, 'line_remark', li.line_remark)
                  order by li.line_no)
             from public.fms_dispatch_order_items li
             join public.mst_items i on i.id = li.item_id
            where li.order_id = o.id
         ), '[]'::jsonb),
         o.customer_id,
         (select trim(mp.name) from public.mst_parties mp where mp.id = o.customer_id)
    from public.fms_dispatch_orders o
   where public.fms_dispatch_customer_org_of(auth.uid()) is not null
     and public.fms_dispatch_customer_org_of_login(o.raised_by)
         = public.fms_dispatch_customer_org_of(auth.uid())
   order by o.submitted_at desc nulls last, o.order_no desc;
$$;

revoke all on function public.fms_dispatch_my_orders() from public, anon;
grant execute on function public.fms_dispatch_my_orders() to authenticated;

-- ===========================================================================
-- 10. READINESS — against the Order Desk's own list
--
-- A NEW 3-argument overload; the 2-argument one is left in place (changes here
-- are additive) and nothing in this migration calls it any more.
-- ===========================================================================
create or replace function public.fms_dispatch_customer_org_readiness(
  p_party_ids uuid[], p_notify_user_ids uuid[], p_item_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'missing', coalesce(jsonb_agg(m order by m), '[]'::jsonb),
    'item_count', (
      select count(distinct upper(trim(i.name)))
        from public.mst_items i
       where i.id = any (coalesce(p_item_ids, '{}'::uuid[])) and i.active
    )
  )
  from (
    select 'ledgers' as m where coalesce(cardinality(p_party_ids), 0) = 0
    union all
    select 'recipients' where coalesce(cardinality(p_notify_user_ids), 0) = 0
    union all
    select 'items' where not exists (
       select 1 from public.mst_items i
        where i.id = any (coalesce(p_item_ids, '{}'::uuid[])) and i.active)
  ) s;
$$;

revoke all on function public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid[]) to authenticated;

-- ===========================================================================
-- 11. SETUP'S GRID — counts the new list and hands it to the edit dialog
--
-- Body as live, apart from the readiness call and the trailing column.
-- ===========================================================================
drop function if exists public.fms_dispatch_customer_orgs_admin();

create function public.fms_dispatch_customer_orgs_admin()
returns table (
  id uuid, display_name text, party_ids uuid[], party_names text[],
  primary_party_id uuid, primary_party_name text, customer_location text,
  notify_user_ids uuid[], notify_names text[], default_location_id uuid,
  default_dispatch_type text, active boolean, login_count integer,
  item_count integer, missing text[], portal_item_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
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
         (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r.value->'missing') t(x)),
         g.portal_item_ids
    from public.fms_dispatch_customer_orgs g
    cross join lateral (
      select public.fms_dispatch_customer_org_readiness(
               g.party_ids, g.notify_user_ids, g.portal_item_ids) as value
    ) r
   where public.fms_dispatch_is_coordinator(auth.uid())
   order by g.display_name;
$$;

revoke all on function public.fms_dispatch_customer_orgs_admin() from public, anon;
grant execute on function public.fms_dispatch_customer_orgs_admin() to authenticated;

-- ===========================================================================
-- 12. THE CUSTOMER'S OWN PROFILE — counts the new list
-- ===========================================================================
create or replace function public.fms_dispatch_my_customer_profile()
returns table (display_name text, customer_location text, item_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select g.display_name, g.customer_location,
         (select count(distinct upper(trim(i.name)))::integer
            from public.mst_items i
           where i.id = any (g.portal_item_ids) and i.active)
    from public.fms_dispatch_customer_orgs g
   where g.id = public.fms_dispatch_customer_org_of(auth.uid());
$$;

-- ===========================================================================
-- 13. SAVING A CUSTOMER — items, machine ledgers, and a looser book rule
--
-- Body as live, with three changes:
--   • `item_ids` is the Order Desk list. Saved with the org in ONE call, so the
--     readiness check sees the list this same save is writing. Absent key =
--     keep what is stored (an edit from a client that does not send it).
--   • Machine ledgers (Tally group MACHINE DEBTORS) are refused — a customer
--     group pulls in its machine ledger too, and those are not for ordering ink.
--   • Two ticked ledgers may share a book if their NAMES differ. Since OD-17 the
--     order carries which firm it is for, so a book resolves to one ledger
--     per firm; only two same-named ledgers in one book stay ambiguous.
-- ===========================================================================
create or replace function public.fms_dispatch_save_customer_org(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid := nullif(trim(p->>'id'), '')::uuid;
  v_name     text := nullif(trim(p->>'display_name'), '');
  v_parties  uuid[];
  v_notify   uuid[];
  v_items    uuid[];
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

  if p ? 'item_ids' then
    select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_items
      from jsonb_array_elements_text(coalesce(p->'item_ids', '[]'::jsonb)) t(x);
  elsif v_id is not null then
    select g.portal_item_ids into v_items from public.fms_dispatch_customer_orgs g where g.id = v_id;
  end if;
  v_items := coalesce(v_items, '{}'::uuid[]);

  select string_agg(x::text, ', ') into v_bad
    from unnest(v_items) x
   where not exists (select 1 from public.mst_items i where i.id = x and i.active);
  if v_bad is not null then
    raise exception 'One of the chosen items is no longer an active item (%)', v_bad;
  end if;

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
    raise exception 'This ledger has no billing company, so the customer could never order from it: %', v_bad;
  end if;

  select string_agg(mp.name, ', ') into v_bad
    from public.mst_parties mp
   where mp.id = any (v_parties)
     and coalesce(mp.group_chain @> array['MACHINE DEBTORS'], false);
  if v_bad is not null then
    raise exception 'Machine ledgers cannot order on the Order Desk -- untick: %', v_bad;
  end if;

  select string_agg(d.name || ' in ' || c.name, ', ') into v_bad
    from (select mp.company_id, min(trim(mp.name)) as name
            from public.mst_parties mp
           where mp.id = any (v_parties)
           group by mp.company_id, upper(trim(mp.name)) having count(*) > 1) d
    join public.mst_companies c on c.id = d.company_id;
  if v_bad is not null then
    raise exception 'Two ticked ledgers have the same name in the same billing company (%). Tick only one of them.', v_bad;
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
    v_ready := public.fms_dispatch_customer_org_readiness(v_parties, v_notify, v_items);
    if jsonb_array_length(v_ready->'missing') > 0 then
      select string_agg(
               case x when 'ledgers'    then 'no ledgers are ticked'
                      when 'recipients' then 'nobody is set to be told about their orders'
                      when 'items'      then 'no items are chosen for them, so their order screen would be empty'
                      else x end, '; ')
        into v_missing
        from jsonb_array_elements_text(v_ready->'missing') t(x);
      raise exception 'This customer is not ready to switch on: %', v_missing;
    end if;
  end if;

  if v_id is null then
    insert into public.fms_dispatch_customer_orgs (
      display_name, party_ids, customer_location,
      notify_user_ids, default_location_id, default_dispatch_type, active,
      portal_item_ids, created_by, updated_by)
    values (
      v_name, v_parties, nullif(trim(p->>'customer_location'), ''),
      v_notify, v_loc, v_type, v_active, v_items, v_uid, v_uid)
    returning id into v_id;
  else
    -- `primary_party_id` deliberately not here — see OD-14.
    update public.fms_dispatch_customer_orgs
       set display_name          = v_name,
           party_ids             = v_parties,
           customer_location     = nullif(trim(p->>'customer_location'), ''),
           notify_user_ids       = v_notify,
           default_location_id   = v_loc,
           default_dispatch_type = v_type,
           active                = v_active,
           portal_item_ids       = v_items,
           updated_at            = now(),
           updated_by            = v_uid
     where id = v_id;
    if not found then raise exception 'That customer no longer exists'; end if;
  end if;

  return v_id;
end
$$;

commit;
