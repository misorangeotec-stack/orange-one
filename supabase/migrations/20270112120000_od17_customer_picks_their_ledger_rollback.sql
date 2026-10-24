-- Rollback for 20270112120000_od17_customer_picks_their_ledger.sql
-- Restores the nine functions exactly as they were on live before OD-17
-- (captured with pg_get_functiondef on 2026-10-08), drops the new ones and the
-- portal_item_ids column. Orders placed under OD-17 keep company_id NULL until
-- completed; the restored OD-14 complete function resolves the ledger by company.

begin;

drop function if exists public.fms_dispatch_my_ledgers();
drop function if exists public.fms_dispatch_customer_org_ledgers(uuid);
drop function if exists public.fms_dispatch_my_items(uuid, uuid);
drop function if exists public.fms_dispatch_my_orders();
drop function if exists public.fms_dispatch_customer_orgs_admin();
drop function if exists public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid[]);

CREATE OR REPLACE FUNCTION public.fms_dispatch_complete_customer_order(p_order uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_customer_intake_options(p_order uuid)
 RETURNS TABLE(company_id uuid, company_name text, default_location_id uuid, default_dispatch_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select mp.company_id,
         coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
         g.default_location_id,
         g.default_dispatch_type
    from public.fms_dispatch_orders o
    join public.fms_dispatch_customer_orgs g
      on g.id = public.fms_dispatch_customer_org_of_login(o.raised_by)
    join public.mst_parties mp on mp.id = any (g.party_ids)
    join public.mst_companies c on c.id = mp.company_id
   where o.id = p_order
     and o.intake_source = 'customer'
     and c.active
     and public.fms_dispatch_can_act('credit_check', p_order, auth.uid())
   order by 2;
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_customer_orgs_admin()
 RETURNS TABLE(id uuid, display_name text, party_ids uuid[], party_names text[], primary_party_id uuid, primary_party_name text, customer_location text, notify_user_ids uuid[], notify_names text[], default_location_id uuid, default_dispatch_type text, active boolean, login_count integer, item_count integer, missing text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select public.fms_dispatch_customer_org_readiness(g.party_ids, g.notify_user_ids) as value
    ) r
   where public.fms_dispatch_is_coordinator(auth.uid())
   order by g.display_name;
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_my_customer_profile()
 RETURNS TABLE(display_name text, customer_location text, item_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select g.display_name, g.customer_location,
         (select count(distinct i.name)::integer
            from public.mst_party_items pi join public.mst_items i on i.id = pi.item_id
           where pi.party_id = any (g.party_ids) and pi.active and i.active)
    from public.fms_dispatch_customer_orgs g
   where g.id = public.fms_dispatch_customer_org_of(auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_my_items(p_company uuid DEFAULT NULL::uuid)
 RETURNS TABLE(item_id uuid, name text, unit text, item_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with src as (
    select i.id, i.name, i.item_type, i.unit_id
      from public.fms_dispatch_customer_orgs g
      join public.mst_party_items pi on pi.party_id = any (g.party_ids) and pi.active
      join public.mst_items i        on i.id = pi.item_id and i.active
     where p_company is null
       and g.id = public.fms_dispatch_customer_org_of(auth.uid())
    union all
    select tgt.id, tgt.name, tgt.item_type, tgt.unit_id
      from public.fms_dispatch_customer_orgs g
      join public.mst_parties mp     on mp.id = any (g.party_ids) and mp.company_id = p_company
      join public.mst_party_items pi on pi.party_id = mp.id and pi.active
      join public.mst_items s        on s.id = pi.item_id and s.active
      join public.mst_items tgt      on tgt.company_id = p_company and tgt.active
                                    and upper(trim(tgt.name)) = upper(trim(s.name))
     where p_company is not null
       and g.id = public.fms_dispatch_customer_org_of(auth.uid())
  )
  select distinct on (src.name) src.id, src.name, u.name, src.item_type
    from src
    left join public.mst_units u on u.id = src.unit_id
   order by src.name, src.id;
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_my_orders()
 RETURNS TABLE(id uuid, order_no text, order_date date, order_remarks text, status_key text, can_change boolean, placed_at timestamp with time zone, company_id uuid, company_label text, form_name text, dispatch_notes jsonb, lines jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id, o.order_no, o.order_date, o.order_remarks,
         /*
           THE FOUR WORDS, AND THE ORDER OF THESE ARMS IS THE LOGIC.

           ⚠ `closed` MUST BE TESTED BEFORE THE GATE ARM. A delivered order has a
             `go_at` — it went out to get delivered — so the gate arm would claim
             every finished order and nothing would ever read "Delivered".

           ⚠ THE GATE ARM READS THE ROUND TABLE AS WELL AS THE HEADER, and missing
             that is how a part-dispatched order goes backwards on screen. When a
             round closes, the header's `go_at` is WIPED for the next one; the
             consignment the customer is holding lives in `fms_dispatch_rounds`.
             Header alone, an order that shipped half and looped back would drop
             from "Out for delivery" to "Accepted" while the goods sat in their
             yard.

           ⚠ `on_hold` FALLS THROUGH TO 'accepted' DELIBERATELY (decision Q6 — the
             customer is never told a hold happened). It is not an oversight that
             there is no arm for it; adding one would be the bug.

           ⚠ `awaiting_sales_return` IS OURS UNWINDING A CANCELLATION, so it reads
             'cancelled'. To the customer the order is gone; the invoice work left
             behind is not theirs to watch.
         */
         case
           when o.status in ('cancelled', 'awaiting_sales_return') then 'cancelled'
           when o.status = 'closed'                                then 'delivered'
           when o.go_at is not null
             or exists (select 1 from public.fms_dispatch_rounds r
                         where r.order_id = o.id and r.go_at is not null)
                                                                   then 'out_for_delivery'
           -- The same function that gates cancel and change, so the word on screen
           -- and the buttons under it can never disagree about whether we have
           -- taken the order on.
           when public.fms_dispatch_customer_window_open(o.id)      then 'request_raised'
           else 'accepted'
         end,
         public.fms_dispatch_customer_window_open(o.id),
         o.submitted_at,
         o.company_id,
         (select coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, '')
            from public.mst_companies c where c.id = o.company_id),
         -- The form for the ledger this caller is ticked into for THIS order's
         -- book — the same derivation `fms_dispatch_customer_org_companies` uses,
         -- so the name on the history matches the one they ordered under.
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
         ), '[]'::jsonb)
    from public.fms_dispatch_orders o
   where public.fms_dispatch_customer_org_of(auth.uid()) is not null
     and public.fms_dispatch_customer_org_of_login(o.raised_by)
         = public.fms_dispatch_customer_org_of(auth.uid())
   order by o.submitted_at desc nulls last, o.order_no desc;
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_replace_customer_lines(p_order uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- ⚠ BY NAME, NOT BY ID (OD-14). The customer now picks the book first and the
    --   picker hands them THAT BOOK'S copy of each mapped item -- which, where the
    --   mapping was made against another book's copy, is a different mst_items row
    --   with the same name. Checking the id would refuse an item this system had
    --   just offered, and say "not on your list" about something that is.
    if not exists (
      select 1
        from public.mst_party_items ci
        join public.mst_items src on src.id = ci.item_id and src.active
        join public.mst_items tgt on tgt.id = v_item
       where ci.party_id = any (v_parties) and ci.active
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
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_save_customer_org(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid := nullif(trim(p->>'id'), '')::uuid;
  v_name     text := nullif(trim(p->>'display_name'), '');
  v_parties  uuid[];
  v_notify   uuid[];
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
    raise exception 'This ledger has no billing company, so the customer could never order from it: %', v_bad;
  end if;

  -- ⚠ STILL LOAD-BEARING, AND MORE SO THAN BEFORE. Two ticked ledgers in one book
  --   used to make credit check's choice ambiguous; now it makes the CUSTOMER's
  --   choice ambiguous, because the company they pick has to resolve to exactly
  --   one ledger.
  select string_agg(c.name, ', ') into v_bad
    from (select mp.company_id, count(*) n
            from public.mst_parties mp
           where mp.id = any (v_parties)
           group by mp.company_id having count(*) > 1) d
    join public.mst_companies c on c.id = d.company_id;
  if v_bad is not null then
    raise exception 'Two ticked ledgers belong to the same billing company (%). Tick only one per company, or an order for that company cannot tell them apart.', v_bad;
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
    v_ready := public.fms_dispatch_customer_org_readiness(v_parties, v_notify);
    if jsonb_array_length(v_ready->'missing') > 0 then
      select string_agg(
               case x when 'ledgers'    then 'no ledgers are ticked'
                      when 'recipients' then 'nobody is set to be told about their orders'
                      when 'items'      then 'none of the ticked ledgers has a single item mapped to it, so their order screen would be empty'
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
      created_by, updated_by)
    values (
      v_name, v_parties, nullif(trim(p->>'customer_location'), ''),
      v_notify, v_loc, v_type, v_active, v_uid, v_uid)
    returning id into v_id;
  else
    -- ⚠ `primary_party_id` is deliberately NOT in this list. The form stops sending
    --   the field, so an UPDATE that still set it would quietly null the column on
    --   every existing customer the first time anyone edited them. The column stays
    --   (changes here are additive-only) and nothing reads it after OD-14.
    update public.fms_dispatch_customer_orgs
       set display_name          = v_name,
           party_ids             = v_parties,
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
$function$;

CREATE OR REPLACE FUNCTION public.fms_dispatch_submit_customer_order(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_org is null then raise exception 'This login is not set up to place orders'; end if;
  if not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'This login is not allowed to place orders';
  end if;

  select * into v_g from public.fms_dispatch_customer_orgs where id = v_org;

  -- The customer picks the company (OD-14). A missing one is refused, never
  -- guessed: a guess would bill under a company they did not choose. The
  -- transitional fallback that used to pick one was removed 14-09-2026.
  if v_company is null then
    if not exists (select 1 from public.fms_dispatch_customer_org_companies(v_org)) then
      raise exception 'Your account is not finished being set up. Please call us.';
    end if;
    raise exception 'Please choose which company this order is for.';
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
$function$;

drop function if exists public.fms_dispatch_org_ledger_parties(uuid, uuid);

alter table public.fms_dispatch_customer_orgs drop column if exists portal_item_ids;

revoke all on function public.fms_dispatch_my_items(uuid) from public;
grant execute on function public.fms_dispatch_my_items(uuid) to anon, authenticated;
revoke all on function public.fms_dispatch_my_orders() from public;
grant execute on function public.fms_dispatch_my_orders() to anon, authenticated;
revoke all on function public.fms_dispatch_customer_orgs_admin() from public;
grant execute on function public.fms_dispatch_customer_orgs_admin() to authenticated;

commit;
