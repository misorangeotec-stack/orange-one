-- ===========================================================================
-- OD-14 PHASE 2 — THE CUSTOMER PICKS WHICH ORANGE COMPANY THEY ARE BUYING FROM.
--
-- Today an order arrives with no billing company and credit check chooses one
-- (decision Q1), because "the company comes from the customer" could not work:
-- a customer is one ledger PER TALLY BOOK, all carrying the identical name, and
-- both named customers split roughly 50/50 across two books.
--
-- That reasoning was about a GUESS. The customer answering directly is not a
-- guess, and it is a question they can answer — they already know which Orange
-- company invoices them, and the five books reduce to three readable names
-- through `mst_companies.alias` + `.location`: O-tec, Enterprise, Colorix.
--
-- ⚠ Q11 IS NOT REVERSED. The customer still never sees the ticked LEDGER list,
--   and still reads no table — only RPCs, which is how Q11 is honoured. What they
--   now see is our COMPANY names, which are on every invoice we send them.
--
-- ⚠ WHAT THIS BUYS, BEYOND THE OBVIOUS: THE LINE RE-POINT STOPS BEING A GUESS.
--   `fms_dispatch_complete_customer_intake` moves each line, best effort, to the
--   same-name item in whichever book credit check chose — 59 of 62 lines on
--   Bishen's primary book but only 8 of 62 on Colorix. Once the customer picks
--   the book first, the picker hands them that book's OWN item ids and there is
--   nothing left to move.
--
-- ⚠ AND THE ONE THING THAT MAKES OR BREAKS IT: THE PICKER AND THE VALIDATOR HAVE
--   TO AGREE. Nothing constrains a mapping to the item's own book, so a customer's
--   Enterprise ledger carries plenty of O-tec stock items — 19 of Bishen's 36 and
--   28 of Kalahansh's 53. Offering "the chosen book's copy, matched by name" while
--   `fms_dispatch_replace_customer_lines` still checks the exact item ID would
--   refuse, in the customer's face, an item it had just offered them. Both move to
--   the name, in this migration, together.
--
--   Measured: matching by name rather than by book recovers most of the loss.
--     Bishen    · Enterprise Surat : 36 mapped -> 17 by book -> 25 by name
--     Kalahansh · Enterprise Surat : 53 mapped -> 25 by book -> 38 by name
--   What is left out genuinely is not sold by that company at all.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. WHICH OF OUR COMPANIES THIS CUSTOMER MAY BUY FROM
-- ===========================================================================
-- ⚠ ONLY BOOKS THAT CAN ACTUALLY SUPPLY THEM. Kalahansh is ticked into Colorix
--   and Colorix maps them nothing, so offering it would be offering an empty
--   order screen. Richest book first, because that is the one they almost always
--   want and it saves the commonest customer a decision.
--
-- ⚠ THE LABEL IS alias + location, NEVER `mst_companies.name`. The raw name is a
--   Tally book string — "ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)" —
--   and the financial year in it is meaningless to a customer and changes yearly.
--   Same formula `fms_dispatch_customer_intake_options` already uses.
-- The logic, taking an org id, so `fms_dispatch_submit_customer_order` can reuse
-- it rather than restating the same five joins and drifting from them later.
-- NOT granted to anyone: it takes an org id and would answer for any customer.
create or replace function public.fms_dispatch_customer_org_companies(p_org uuid)
returns table(company_id uuid, label text, item_count integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select mp.company_id,
         coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, ''),
         count(distinct upper(trim(tgt.name)))::integer
    from public.fms_dispatch_customer_orgs g
    join public.mst_parties mp        on mp.id = any (g.party_ids)
    join public.mst_companies c       on c.id = mp.company_id and c.active
    join public.mst_party_items pi    on pi.party_id = mp.id and pi.active
    join public.mst_items src         on src.id = pi.item_id and src.active
    join public.mst_items tgt         on tgt.company_id = mp.company_id and tgt.active
                                     and upper(trim(tgt.name)) = upper(trim(src.name))
   where g.id = p_org
   group by mp.company_id, 2
   order by 3 desc, 2;
$fn$;

revoke all on function public.fms_dispatch_customer_org_companies(uuid) from public, authenticated;

create or replace function public.fms_dispatch_my_companies()
returns table(company_id uuid, label text, item_count integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select * from public.fms_dispatch_customer_org_companies(
    public.fms_dispatch_customer_org_of(auth.uid()));
$fn$;

revoke all on function public.fms_dispatch_my_companies() from public;
grant execute on function public.fms_dispatch_my_companies() to authenticated;

comment on function public.fms_dispatch_my_companies() is
  'OD-14. The Orange companies the signed-in customer may order from, named as they would '
  'recognise them (alias + location, never the Tally book string), richest book first. A book '
  'that can supply them nothing is left out rather than offered as an empty order screen.';

-- ===========================================================================
-- 2. THEIR ITEMS, IN THE BOOK THEY CHOSE
-- ===========================================================================
-- ⚠ DROPPED AND RECREATED, NOT OVERLOADED. A no-arg function and a one-arg
--   function with a default are ambiguous when called with no arguments, and
--   PostgREST calls this one both ways. One function, one default.
--
--   The old zero-argument call keeps working through the default while the
--   frontend catches up, so this migration can be applied before the deploy.
drop function if exists public.fms_dispatch_my_items();

create or replace function public.fms_dispatch_my_items(p_company uuid default null)
returns table(item_id uuid, name text, unit text, item_type text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  -- ⚠ THE `distinct on` HAS TO SIT OUTSIDE THE UNION. Inside a branch it needs
  --   that branch's own ORDER BY, which a UNION arm cannot carry — and the dedupe
  --   is on the name either way, so it belongs once, at the end.
  with src as (
    -- No company named: every book, as before. Kept for the order-history screen,
    -- which resolves the names on lines already placed.
    select i.id, i.name, i.item_type, i.unit_id
      from public.fms_dispatch_customer_orgs g
      join public.mst_party_items pi on pi.party_id = any (g.party_ids) and pi.active
      join public.mst_items i        on i.id = pi.item_id and i.active
     where p_company is null
       and g.id = public.fms_dispatch_customer_org_of(auth.uid())
    union all
    -- A company named: what that book can supply them, as THAT BOOK'S OWN ITEM.
    -- Matched by name, because a mapping is not confined to the item's own book
    -- and the id they order has to be one that can be billed from this book.
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
$fn$;

revoke all on function public.fms_dispatch_my_items(uuid) from public;
grant execute on function public.fms_dispatch_my_items(uuid) to authenticated;

comment on function public.fms_dispatch_my_items(uuid) is
  'OD-14. What the signed-in customer may order. Given a company, returns that book''s own copy '
  'of everything mapped to their ledger there, matched by NAME because a mapping is not confined '
  'to the item''s own book. Given nothing, the union across every ticked ledger, as before.';

-- ===========================================================================
-- 3. THE VALIDATOR MOVES TO THE NAME TOO
-- ===========================================================================
-- Without this the picker offers the billing book's copy and the save refuses it,
-- in the customer's own words, for an item that IS on their list.
create or replace function public.fms_dispatch_replace_customer_lines(p_order uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
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

    -- The payload is just JSON, so the mapping is enforced here and not only in
    -- the picker.
    --
    -- ⚠ BY NAME, NOT BY ID (OD-14). The customer now picks the book first and the
    --   picker hands them THAT BOOK'S copy of each mapped item — which, where the
    --   mapping was made against another book's copy, is a different `mst_items`
    --   row with the same name. Checking the id would refuse an item this system
    --   had just offered, and say "not on your list" about something that is.
    if not exists (
      select 1
        from public.mst_party_items ci
        join public.mst_items src on src.id = ci.item_id and src.active
        join public.mst_items tgt on tgt.id = v_item
       where ci.party_id = any (v_parties) and ci.active
         and upper(trim(src.name)) = upper(trim(tgt.name))
    ) then
      select name into v_item_name from public.mst_items where id = v_item;
      -- Customer-facing wording: they cannot act on "add the pair in Central Masters".
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

-- ===========================================================================
-- 4. THE ORDER IS RAISED AGAINST THE BOOK THEY CHOSE
-- ===========================================================================
-- `customer_id` is NOT NULL and always was; `primary_party_id` existed only to
-- have something to put there. With the company chosen at order time the ledger
-- follows from it, so the provisional value has no job left.
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

  -- --- which of ours they are buying from ---------------------------------
  --
  -- ⚠ THE `is null` FALLBACK IS TRANSITIONAL AND MUST BE REMOVED. Expand first,
  --   contract later: this migration has to be applied BEFORE the frontend that
  --   sends `company_id` is deployed, and between those two moments the live
  --   Order Desk is still posting the old payload. Raising here instead would
  --   take ordering away from a real customer for the length of a deploy.
  --
  --   The fallback picks the book that can supply them most, which is the same
  --   book `fms_dispatch_my_companies` puts first and the one an old-frontend
  --   order would almost certainly have been billed to anyway. Their lines still
  --   validate, because `fms_dispatch_replace_customer_lines` now checks the name
  --   across every ticked ledger.
  --
  --   Tracked as OD-14 follow-up: drop this branch and raise instead, once the
  --   frontend carrying the company picker is live on master.
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
    -- Customer-facing: they cannot act on "that is not a ticked ledger".
    raise exception 'Sorry - we cannot take an order for that company on your account. Please call us.';
  end if;
  if not exists (select 1 from public.mst_companies c where c.id = v_company and c.active) then
    raise exception 'Sorry - we cannot take an order for that company just now. Please call us.';
  end if;

  v_seq := public.fms_dispatch_next_seq('order:' || v_fy);
  v_no  := 'SO-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  -- location_id and dispatch_type are still LEFT NULL on purpose (Q2): they are
  -- ours to know, and our team fills them in. company_id and customer_id are no
  -- longer among them — the customer answered that question.
  insert into public.fms_dispatch_orders (
    order_no, dispatch_type, company_id, location_id, customer_id,
    customer_location, order_date, order_remarks,
    raised_by, requester_name, status, current_step, submitted_at,
    round_no, round_started_at, intake_source
  ) values (
    v_no, null, v_company, null, v_party,
    v_g.customer_location,
    current_date,
    nullif(trim(p->>'order_remarks'), ''),
    v_uid, v_g.display_name,
    'awaiting_credit_check', 'credit_check', now(),
    1, now(), 'customer'
  )
  returning id into v_id;

  perform public.fms_dispatch_replace_customer_lines(v_id, p->'lines');

  -- ⚠ TO THE ORG'S NAMED RECIPIENTS, never to fms_dispatch_step_owner_ids('credit_check').
  --   That resolves to two people whom fms_dispatch_can_see_order refuses on a null-location
  --   order, so announce would drop both and the order would reach nobody (Correction 3).
  perform public.fms_dispatch_announce(
    'order', v_id, 'raised',
    'New order ' || v_no || ' from ' || v_g.display_name ||
    ' - fill in the dispatch site and dispatch type, then run the credit check.',
    v_g.notify_user_ids,
    jsonb_build_object('order_no', v_no)
  );

  return v_id;
end
$fn$;

-- ===========================================================================
-- 5. "MAIN LEDGER" IS NO LONGER A THING ANYONE HAS TO CHOOSE
-- ===========================================================================
-- ⚠ THE COLUMN STAYS. Supabase changes here are additive-only, and it holds real
--   history. Nothing reads it after this migration; a later cleanup can drop it
--   once that has been true for a while.
--
-- ⚠ AND `fms_dispatch_save_customer_org` NO LONGER WRITES IT. Not "writes null" —
--   does not touch it. The form stops sending the field, so an UPDATE that still
--   set `primary_party_id = v_primary` would quietly null the column on every
--   existing customer the first time anyone edited them. Leaving it out of the
--   UPDATE preserves what is there.

-- The readiness check loses its arm and its argument together. Two callers, both
-- rewritten below in the same migration, so no signature is ever half-applied.
create or replace function public.fms_dispatch_customer_org_readiness(
  p_party_ids uuid[], p_notify_user_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
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
    select 'recipients' where coalesce(cardinality(p_notify_user_ids), 0) = 0
    union all
    select 'items' where not exists (
       select 1 from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
        where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[]))
          and pi.active and i.active)
  ) s;
$fn$;

comment on function public.fms_dispatch_customer_org_readiness(uuid[], uuid[]) is
  'What is still missing before this customer can be switched on. Takes VALUES rather than an org '
  'id so the Setup screen can ask before saving and the save RPC can ask while saving, and the two '
  'can never disagree.';

create or replace function public.fms_dispatch_customer_orgs_admin()
returns table(id uuid, display_name text, party_ids uuid[], party_names text[],
              primary_party_id uuid, primary_party_name text, customer_location text,
              notify_user_ids uuid[], notify_names text[], default_location_id uuid,
              default_dispatch_type text, active boolean, login_count integer,
              item_count integer, missing text[])
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select g.id, g.display_name, g.party_ids,
         (select coalesce(array_agg(mp.name order by c.name), '{}')
            from public.mst_parties mp left join public.mst_companies c on c.id = mp.company_id
           where mp.id = any (g.party_ids)),
         -- Still returned so the shape does not change under a browser that has
         -- not reloaded yet. Nothing reads them.
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
$fn$;

create or replace function public.fms_dispatch_save_customer_org(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
    -- `primary_party_id` is deliberately NOT in this list. See the note above.
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
$fn$;

-- Last, so nothing is left pointing at it.
drop function if exists public.fms_dispatch_customer_org_readiness(uuid[], uuid[], uuid);

-- ===========================================================================
-- 6. THE CUSTOMER'S OWN ORDER LIST CARRIES THE BOOK
-- ===========================================================================
-- ⚠ NEEDED FOR CORRECTNESS, NOT DECORATION. "Change this order" re-renders the
--   item picker, and since OD-14 that picker is scoped to a BOOK. Without the
--   order's company the edit screen falls back to the union across every ticked
--   ledger and quietly lets the customer put an item on the order that the
--   billing book cannot supply — the exact cross-book line the rest of OD-14
--   exists to stop.
--
-- The label is alias + location, never `mst_companies.name`, for the same reason
-- as everywhere else on this side.
drop function if exists public.fms_dispatch_my_orders();

create or replace function public.fms_dispatch_my_orders()
returns table(id uuid, order_no text, order_date date, order_remarks text,
              status_key text, can_change boolean, placed_at timestamptz,
              company_id uuid, company_label text, lines jsonb)
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
         o.company_id,
         (select coalesce(nullif(trim(c.alias), ''), c.name) || coalesce(' - ' || c.location, '')
            from public.mst_companies c where c.id = o.company_id),
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

commit;
