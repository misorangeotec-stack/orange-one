-- ===========================================================================
-- COMPANY LOCATIONS — a fifth master, and the order records which one it
-- dispatches from.
--
-- WHY
--   The module has no idea WHERE a consignment leaves from. Everything is one
--   undifferentiated queue, so a gate-out owner in Ahmedabad sees Vapi's orders
--   and vice versa. This migration puts the fact on the order; the NEXT one
--   turns it into a permission boundary.
--
-- ⚠ THIS IS NOT `customer_location`, AND THE TWO MUST NOT BE CONFLATED.
--     customer_location — free text, where the CUSTOMER takes delivery. A fact
--                         about the consignment, deliberately not an FK so a
--                         master rename cannot rewrite history.
--     location_id       — OUR site the goods leave from. A real FK to a real
--                         master, because it is going to decide who may see and
--                         act on the order.
--
-- ⚠ THE LOCATION IS REQUIRED ONLY WHERE ONE EXISTS. A company with no locations
--   configured asks nothing extra of the person raising the order — otherwise
--   adding a company would silently block order entry until somebody remembered
--   to add a site under it. Once a company HAS active locations, picking one is
--   compulsory. The rule is enforced here, and the form mirrors it.
--
-- Additive: one new table, one nullable column on the order and its archive.
-- ===========================================================================

-- ------------------------------------------------------------- the master --

create table if not exists public.fms_dispatch_company_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- RESTRICT, not cascade: a location with orders against it is history, and
  -- deleting the company must not silently take that history with it.
  company_id  uuid not null references public.fms_dispatch_companies on delete restrict,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Scoped to the company, not global: two companies may both have a "Unit 1".
  unique (company_id, name)
);

comment on table public.fms_dispatch_company_locations is
  'Our own sites, per selling company - the place a consignment leaves from. Distinct from fms_dispatch_orders.customer_location, which is where the CUSTOMER takes delivery.';

create index if not exists fms_dispatch_company_locations_company_idx
  on public.fms_dispatch_company_locations (company_id);

drop trigger if exists set_updated_at on public.fms_dispatch_company_locations;
create trigger set_updated_at before update on public.fms_dispatch_company_locations
  for each row execute function public.set_updated_at();

alter table public.fms_dispatch_company_locations enable row level security;

drop policy if exists fms_dispatch_company_locations_select on public.fms_dispatch_company_locations;
create policy fms_dispatch_company_locations_select
  on public.fms_dispatch_company_locations for select using (true);

/*
  ⚠ EVERY CALL WRAPPED IN (select …). Unwrapped, Postgres treats
    is_admin(auth.uid()) as row-dependent and re-runs it FOR EVERY ROW; wrapped,
    it is hoisted into a one-shot InitPlan. Same form as the customer-item
    mapping's policy, for the same reason.
*/
drop policy if exists fms_dispatch_company_locations_write on public.fms_dispatch_company_locations;
create policy fms_dispatch_company_locations_write
  on public.fms_dispatch_company_locations for all
  using (
    (select public.is_admin((select auth.uid())))
    or (select public.fms_dispatch_is_master_manager('company_location', (select auth.uid())))
  )
  with check (
    (select public.is_admin((select auth.uid())))
    or (select public.fms_dispatch_is_master_manager('company_location', (select auth.uid())))
  );

-- ------------------------------------------------- the master-type vocabulary --
--
-- Both CHECKs must learn the word, or owning the master and requesting a new one
-- are impossible. No DELETE pass is needed here (unlike 20260811120000's cut):
-- this widens the vocabulary rather than narrowing it, so nothing existing can
-- violate the new constraint.

alter table public.fms_dispatch_master_managers
  drop constraint if exists fms_dispatch_master_managers_master_type_check;
alter table public.fms_dispatch_master_managers
  add constraint fms_dispatch_master_managers_master_type_check
  check (master_type = any (array['company', 'customer', 'item', 'customer_item', 'company_location']));

alter table public.fms_dispatch_master_requests
  drop constraint if exists fms_dispatch_master_requests_master_type_check;
alter table public.fms_dispatch_master_requests
  add constraint fms_dispatch_master_requests_master_type_check
  check (master_type = any (array['company', 'customer', 'item', 'customer_item', 'company_location']));

-- ------------------------------------------------------ the order carries it --

alter table public.fms_dispatch_orders
  add column if not exists location_id uuid
    references public.fms_dispatch_company_locations on delete restrict;

alter table public.fms_dispatch_rounds
  add column if not exists location_id uuid
    references public.fms_dispatch_company_locations on delete restrict;

comment on column public.fms_dispatch_orders.location_id is
  'Which of OUR sites this order dispatches from. Chosen at intake, true for every round. Left nullable so no legacy row can fail a write; presence is enforced in fms_dispatch_submit_order, and only where the chosen company actually has locations.';

create index if not exists fms_dispatch_orders_location_idx
  on public.fms_dispatch_orders (location_id);

-- ------------------------------------------------------------------- seed --
--
-- One location per existing company, so the picker is never empty on day one and
-- every order already on the books can be tagged. Named "Main" rather than
-- guessed: an admin renaming one honest placeholder beats reverse-engineering a
-- site list from company names.
--
-- Guarded on NOT EXISTS so a re-run cannot double-seed, and so a company that has
-- already been given real locations is left alone.
insert into public.fms_dispatch_company_locations (name, company_id)
select 'Main', c.id
  from public.fms_dispatch_companies c
 where not exists (select 1 from public.fms_dispatch_company_locations l
                    where l.company_id = c.id);

update public.fms_dispatch_orders o
   set location_id = (select l.id from public.fms_dispatch_company_locations l
                       where l.company_id = o.company_id and l.active
                       order by l.sort_order, l.name limit 1)
 where o.location_id is null and o.company_id is not null;

update public.fms_dispatch_rounds r
   set location_id = (select o.location_id from public.fms_dispatch_orders o where o.id = r.order_id)
 where r.location_id is null;

-- ===========================================================================
-- THE ARCHIVE — carries the location, and must never wipe it.
-- ===========================================================================
create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id, location_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name, sb_remarks, sb_at, sb_by,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name, dc_remarks, dc_at, dc_by,
    edited_at, edited_by, archived_reason
  )
  select
    o.id, o.round_no, o.round_started_at, o.company_id, o.location_id,
    -- ONLY the decision this round actually made. When credit approved enough to
    -- cover several rounds, the later ones inherit that decision and must archive
    -- NOTHING - otherwise one decision appears once per round it happened to
    -- cover, in the Completed tab and in the register.
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

  -- WIPE.
  --
  -- ⚠ company_id AND location_id ARE BOTH DELIBERATELY ABSENT. Both are chosen
  --   once at intake and are true for every round of the order, so wiping either
  --   would blank it the instant a round closed - and the header, the queues, the
  --   register, the emails and (next migration) the row-level security predicate
  --   all read them. The archive keeps its own copies above, which is what makes
  --   a historic round self-describing.
  --
  -- ⚠ THE cc_ BLOCK IS ABSENT for a third reason: whether the credit decision
  --   survives into the next round depends on whether any headroom is left, which
  --   only the caller has worked out.
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
-- INTAKE — the location is asked alongside the company, and validated against it.
-- ===========================================================================
create or replace function public.fms_dispatch_submit_order(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
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
  if not exists (select 1 from public.fms_dispatch_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- THE SITE THIS LEAVES FROM. Required only where the chosen company actually
  -- has locations: a company nobody has added sites to must not silently become
  -- unusable for order entry.
  v_location := nullif(trim(p->>'location_id'), '')::uuid;
  if v_location is not null then
    if not exists (select 1 from public.fms_dispatch_company_locations l
                    where l.id = v_location and l.company_id = v_company and l.active) then
      raise exception 'That location is not an active location of the selected company';
    end if;
  elsif exists (select 1 from public.fms_dispatch_company_locations l
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
end $$;
grant execute on function public.fms_dispatch_submit_order(jsonb) to authenticated;

-- Carried from 20260818120000 (which added the "already dispatched" guard) with
-- the location threaded through on the same presence-check idiom as the company.
create or replace function public.fms_dispatch_update_order(p_order uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_cc timestamptz; v_raiser uuid; v_no text;
  v_uid uuid := auth.uid();
  v_type text := lower(coalesce(trim(p->>'dispatch_type'), ''));
  v_cust uuid; v_company uuid; v_location uuid; v_held boolean;
begin
  select status, cc_at, raised_by, order_no, cc_status = 'credit_hold'
    into v_status, v_cc, v_raiser, v_no, v_held
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

  v_cust := coalesce(nullif(p->>'customer_id','')::uuid,
                     (select customer_id from public.fms_dispatch_orders where id = p_order));

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
  if not exists (select 1 from public.fms_dispatch_companies c where c.id = v_company and c.active) then
    raise exception 'That billing company is not an active company master';
  end if;

  -- The same rule as intake, against whatever the row would end up holding: a
  -- location must belong to the company, and is compulsory once that company has
  -- any. Changing the company to one with different sites therefore forces a
  -- matching location rather than leaving a stale one pointing elsewhere.
  if v_location is not null then
    if not exists (select 1 from public.fms_dispatch_company_locations l
                    where l.id = v_location and l.company_id = v_company and l.active) then
      raise exception 'That location is not an active location of the selected company';
    end if;
  elsif exists (select 1 from public.fms_dispatch_company_locations l
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
end $$;
grant execute on function public.fms_dispatch_update_order(uuid, jsonb) to authenticated;

-- ===========================================================================
-- MASTER-REQUEST INTAKE — the new type gets an arm.
--
-- ⚠ WIRE CONTRACT. The keys read below are the keys `lib/masterFields.ts` puts
--   into proposed_payload. `company_id` joins the company_location arm here at
--   the same time it joins that file - a field added on one side only is
--   silently dropped on approve.
-- ===========================================================================
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

    elsif v_type = 'company_location' then
      -- A location without its company is not a location, it is a word.
      if nullif(trim(v_payload->>'company_id'),'') is null then
        raise exception 'A location needs the company it belongs to';
      end if;
      insert into public.fms_dispatch_company_locations (name, company_id, created_by)
      values (v_name, (v_payload->>'company_id')::uuid, auth.uid())
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
--   comments above deliberately name the very identifiers being tested. Each
--   test below matches a token sequence that can only occur in executable SQL.

do $check$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round'
     and pg_get_function_identity_arguments(p.oid) = 'p_order uuid, p_reason text';
  if v_def is null then raise exception 'archive_round missing after replace'; end if;
  -- The location must SURVIVE a round, exactly as the company does.
  if v_def like '%location_id = null%' then raise exception 'archive_round wipes location_id - it is an intake field'; end if;
  if v_def like '%company_id = null%' then raise exception 'archive_round still wipes company_id - it is an intake field now'; end if;
  if v_def not like '%o.company_id, o.location_id%' then raise exception 'archive_round does not archive the location'; end if;
  -- Carried forward from 20260817120100 / 20260818120000 - still true, still guarded.
  if v_def not like '%o.ms_tempo_no, o.ms_porter%' then raise exception 'archive_round does not archive the tempo/porter'; end if;
  if v_def not like '%o.cc_approved_qty else null%' then raise exception 'archive_round lost the credit block'; end if;
  if v_def like '%li.unit_id%' then raise exception 'archive_round still selects li.unit_id'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_submit_order';
  if v_def not like '%p->>''location_id''%' then raise exception 'submit_order does not read the location'; end if;
  if v_def not like '%p->>''company_id''%' then raise exception 'submit_order does not read a company'; end if;
  if v_def not like '%customer_location%' then raise exception 'submit_order does not read the customer location'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_update_order';
  if v_def not like '%p ? ''location_id''%' then raise exception 'update_order does not presence-check the location'; end if;
  if v_def not like '%fms_dispatch_rounds where order_id = p_order%' then raise exception 'update_order lost the already-dispatched guard'; end if;
  if v_def like '%c.company_id into v_company%' then raise exception 'update_order still resolves the company from the customer master'; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_resolve_master_request';
  if v_def not like '%fms_dispatch_company_locations (name, company_id, created_by)%'
    then raise exception 'approving a company_location request would not insert one'; end if;
  if v_def not like '%name, code, location, gstin%' then raise exception 'approving a customer request would drop the location'; end if;
end $check$;
