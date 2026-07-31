-- ===========================================================================
-- ORDER TO DISPATCH — THREE MASTERS: CUSTOMER, ITEM, AND WHAT EACH MAY ORDER.
--
-- The module keeps five masters today (company · customer · item · unit ·
-- category). Two of those are not lists anybody maintains:
--
--   • UNIT is one word per item. A separate table meant picking a unit on every
--     order line for a value the item already implies — and the line picker let
--     you pick a DIFFERENT one, so KGS could be ordered in BOX. It becomes a
--     text column on the item, snapshotted onto the line at order time.
--
--   • CATEGORY was read by exactly one thing: a display column on the Masters
--     items tab. Nothing in the order flow ever looked at it.
--
-- And one master is missing: WHICH ITEMS A CUSTOMER MAY ORDER. Every customer
-- buys a handful of the catalogue; the order form offered all of it.
--
-- After this: company (billing only, not an ordering list) · customer · item ·
-- customer-item mapping.
--
-- ⚠ THE UNIT IS PRESERVED, NOT DISCARDED. Both backfills run BEFORE the columns
--   are dropped, so an existing line keeps the unit it was raised with. Reversing
--   the order here would silently blank every unit in the book.
--
-- ⚠ ORDERING IS LOAD-BEARING throughout. The retired master_type rows are deleted
--   BEFORE the new CHECK is added — `add constraint … check` validates existing
--   rows and would otherwise fail on the very rows it is meant to retire.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. UNIT MOVES ONTO THE ITEM, AS TEXT
-- ===========================================================================

alter table public.fms_dispatch_items       add column if not exists unit text;
alter table public.fms_dispatch_order_items add column if not exists unit text;

comment on column public.fms_dispatch_items.unit is
  'How this item is measured (KGS, LTR, PCS, BOX). Free text — there is no unit master.';
comment on column public.fms_dispatch_order_items.unit is
  'The item''s unit AS AT the moment the order was raised. A snapshot, so renaming an item''s unit later does not rewrite history.';

-- Backfill from the master that is about to be dropped. `is null` guards make
-- the whole migration safe to re-run.
update public.fms_dispatch_items i
   set unit = u.name
  from public.fms_dispatch_units u
 where i.unit_id = u.id and i.unit is null;

update public.fms_dispatch_order_items li
   set unit = u.name
  from public.fms_dispatch_units u
 where li.unit_id = u.id and li.unit is null;

-- fms_dispatch_round_items already carries `unit_name` as its own text snapshot,
-- so an archived round needs no backfill — only its now-dangling id column goes.

alter table public.fms_dispatch_items       drop column if exists unit_id;
alter table public.fms_dispatch_items       drop column if exists category_id;
alter table public.fms_dispatch_order_items drop column if exists unit_id;
alter table public.fms_dispatch_round_items drop column if exists unit_id;

drop table if exists public.fms_dispatch_units;
drop table if exists public.fms_dispatch_categories;

-- ===========================================================================
-- 2. THE CUSTOMER↔ITEM MAPPING
-- ===========================================================================

create table if not exists public.fms_dispatch_customer_items (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.fms_dispatch_customers(id) on delete cascade,
  item_id     uuid not null references public.fms_dispatch_items(id)     on delete cascade,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One row per pair. The Excel load leans on this: 1,983 sheet rows carry 82
  -- duplicates, and an upsert on this key collapses them without a pre-pass.
  unique (customer_id, item_id)
);

comment on table public.fms_dispatch_customer_items is
  'Which items a customer may order. A row here is what makes an item selectable on that customer''s sales order; no row means the item is not offered to them.';

create index if not exists idx_fms_dispatch_customer_items_customer
  on public.fms_dispatch_customer_items(customer_id) where active;
create index if not exists idx_fms_dispatch_customer_items_item
  on public.fms_dispatch_customer_items(item_id);

drop trigger if exists trg_fms_dispatch_customer_items_updated on public.fms_dispatch_customer_items;
create trigger trg_fms_dispatch_customer_items_updated
  before update on public.fms_dispatch_customer_items
  for each row execute function public.set_updated_at();

alter table public.fms_dispatch_customer_items enable row level security;

drop policy if exists fms_dispatch_customer_items_select on public.fms_dispatch_customer_items;
create policy fms_dispatch_customer_items_select
  on public.fms_dispatch_customer_items for select using (true);

/*
  ⚠ EVERY CALL IS WRAPPED IN (select …). Unwrapped, Postgres treats
    is_admin(auth.uid()) as row-dependent and re-runs it FOR EVERY ROW; wrapped,
    it is hoisted into a one-shot InitPlan. This table is the biggest one in the
    module — ~1,900 rows from the first Excel load alone — so it is exactly where
    the per-row form hurts.
*/
drop policy if exists fms_dispatch_customer_items_write on public.fms_dispatch_customer_items;
create policy fms_dispatch_customer_items_write
  on public.fms_dispatch_customer_items for all
  using (
    (select public.is_admin((select auth.uid())))
    or (select public.fms_dispatch_is_master_manager('customer_item', (select auth.uid())))
  )
  with check (
    (select public.is_admin((select auth.uid())))
    or (select public.fms_dispatch_is_master_manager('customer_item', (select auth.uid())))
  );

-- Whatever is already on the books stays orderable. Without this the one seeded
-- order could not be edited: replace_lines below refuses an unmapped item.
insert into public.fms_dispatch_customer_items (customer_id, item_id)
select distinct o.customer_id, li.item_id
  from public.fms_dispatch_order_items li
  join public.fms_dispatch_orders o on o.id = li.order_id
on conflict (customer_id, item_id) do nothing;

-- ===========================================================================
-- 3. THE MASTER-TYPE VOCABULARY
-- ===========================================================================

-- Retire owners and pending requests for the two masters that no longer exist.
-- Must happen BEFORE the new CHECK is added — see the header note.
delete from public.fms_dispatch_master_managers where master_type in ('unit', 'category');
delete from public.fms_dispatch_master_requests where master_type in ('unit', 'category');

alter table public.fms_dispatch_master_managers
  drop constraint if exists fms_dispatch_master_managers_master_type_check;
alter table public.fms_dispatch_master_managers
  add constraint fms_dispatch_master_managers_master_type_check
  check (master_type = any (array['company', 'customer', 'item', 'customer_item']));

alter table public.fms_dispatch_master_requests
  drop constraint if exists fms_dispatch_master_requests_master_type_check;
alter table public.fms_dispatch_master_requests
  add constraint fms_dispatch_master_requests_master_type_check
  check (master_type = any (array['company', 'customer', 'item', 'customer_item']));

-- ===========================================================================
-- 4. LINES: THE UNIT COMES FROM THE ITEM, AND THE ITEM MUST BE MAPPED
-- ===========================================================================

create or replace function public.fms_dispatch_replace_lines(p_order uuid, p_lines jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  l jsonb; v_n integer := 0; v_cust uuid; v_item uuid; v_unit text; v_item_name text;
begin
  if exists (select 1 from public.fms_dispatch_rounds where order_id = p_order) then
    raise exception 'The items cannot be changed - a dispatch has already gone out on this order';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'At least one item line is required';
  end if;

  select customer_id into v_cust from public.fms_dispatch_orders where id = p_order;

  delete from public.fms_dispatch_order_items where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    -- Skip the trailing blank row the shared LineGrid always keeps at the bottom.
    if coalesce(trim(l->>'item_id'), '') = '' then continue; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then
      raise exception 'Every item line needs a quantity greater than zero';
    end if;

    v_item := (l->>'item_id')::uuid;

    /*
      THE MAPPING IS ENFORCED HERE, not only in the picker. The order form shows a
      customer only their mapped items, but the payload is just JSON — an edit
      that changes the customer after the lines were chosen would otherwise slip
      an unmapped item straight through.
    */
    if not exists (
      select 1 from public.fms_dispatch_customer_items ci
       where ci.customer_id = v_cust and ci.item_id = v_item and ci.active
    ) then
      select name into v_item_name from public.fms_dispatch_items where id = v_item;
      raise exception 'This customer is not mapped to %. Add the pair in Masters -> Customer-Item Mapping first.',
        coalesce(v_item_name, 'that item');
    end if;

    -- The unit is READ FROM THE ITEM, never taken from the payload: it is a
    -- property of what is being sent, not a per-line choice.
    select unit into v_unit from public.fms_dispatch_items where id = v_item;

    v_n := v_n + 1;
    insert into public.fms_dispatch_order_items (order_id, line_no, item_id, quantity, unit, line_remark)
    values (
      p_order, v_n,
      v_item,
      (l->>'quantity')::numeric,
      v_unit,
      nullif(trim(l->>'line_remark'), '')
    );
  end loop;

  if v_n = 0 then raise exception 'At least one item line is required'; end if;
  return v_n;
end $function$;

-- ===========================================================================
-- 5. MASTER REQUESTS: ITEM LOSES ITS TWO PARENTS, MAPPING GAINS AN ARM
-- ===========================================================================

create or replace function public.fms_dispatch_resolve_master_request(
  p_request_id uuid, p_approve boolean, p_payload jsonb default null::jsonb, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      if nullif(trim(v_payload->>'company_id'),'') is null then
        raise exception 'Pick the company that bills this customer before approving';
      end if;
      insert into public.fms_dispatch_customers
        (name, company_id, code, gstin, contact_name, phone, email, created_by)
      values (v_name,
              (v_payload->>'company_id')::uuid,
              nullif(trim(v_payload->>'code'),''),
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
end $function$;

-- ===========================================================================
-- 6. THE TWO READERS THAT STILL JOINED THE UNIT MASTER
--
-- archive_round and email_payload each join fms_dispatch_units for one label.
-- Both are long and otherwise untouched, so rather than re-transcribe ~250 lines
-- (and risk a typo in code that mails customers and archives consignments) the
-- edit is applied to the LIVE definition and re-executed.
--
-- ⚠ EVERY SUBSTITUTION IS ASSERTED. If a marker is not found the migration
--   raises instead of quietly installing a function that still references a table
--   this same migration has dropped.
-- ===========================================================================

do $mig$
declare
  v_def text;
  v_before text;
begin
  -- ---- archive_round -----------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round';
  if v_def is null then raise exception 'fms_dispatch_archive_round not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'round_id, order_item_id, line_no, item_id, item_name, unit_name, unit_id,',
    'round_id, order_item_id, line_no, item_id, item_name, unit_name,');
  if v_def = v_before then raise exception 'archive_round: insert column list marker not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'coalesce(it.name, ''Item''), un.name, li.unit_id,',
    'coalesce(it.name, ''Item''), li.unit,');
  if v_def = v_before then raise exception 'archive_round: select list marker not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'left join public.fms_dispatch_units un on un.id = li.unit_id',
    '');
  if v_def = v_before then raise exception 'archive_round: units join marker not found'; end if;

  execute v_def;

  -- ---- email_payload -----------------------------------------------------
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_email_payload';
  if v_def is null then raise exception 'fms_dispatch_email_payload not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'case when coalesce(un.name,'''') <> '''' then '' '' || un.name else '''' end',
    'case when coalesce(li.unit,'''') <> '''' then '' '' || li.unit else '''' end');
  if v_def = v_before then raise exception 'email_payload: unit label marker not found'; end if;

  v_before := v_def;
  v_def := replace(v_def,
    'left join public.fms_dispatch_units un on un.id = li.unit_id',
    '');
  if v_def = v_before then raise exception 'email_payload: units join marker not found'; end if;

  execute v_def;
end $mig$;

commit;
