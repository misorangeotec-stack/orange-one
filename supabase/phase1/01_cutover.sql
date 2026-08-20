-- ===========================================================================
-- PHASE 1 — move Order to Dispatch onto the Central Masters.
--
-- ⚠ NOT IN supabase/migrations/ ON PURPOSE. This runs by hand, inside an
--   agreed freeze window, after 00_rollback.sql has been read. Dropping it in
--   the migrations folder would let a stray `db push` fire it unannounced.
--
-- WHAT MOVES              customers (327), items (234), customer-item map (3,168)
-- WHAT DOES NOT           companies and locations - see the note at the bottom
--
-- THE ONE IDEA THAT MAKES THIS SAFE
--   Dispatch's rows are copied into mst_* KEEPING THEIR IDS. So every order
--   keeps the exact customer_id and item_id it has today, and repointing the
--   foreign keys validates instantly against data that is already correct.
--   No order is rewritten. Nothing on screen changes except a name that Tally
--   spells differently.
--
-- WHERE A RECONCILE DECISION SAYS "SAME FIRM"
--   The Dispatch row survives and ABSORBS its Tally twin: it takes the twin's
--   guid and Tally-owned fields, the twin's catalogue rows are repointed onto
--   it, and the twin is deleted. One row where there were two.
--
-- ⚠ THREE CONSTRAINTS DICTATE THE ORDER OF EVERYTHING BELOW
--   1. mst_party_items CASCADES from both party_id and item_id. Delete a twin
--      before repointing its catalogue and 5,991 rows of "who buys what" quietly
--      vanish. So: repoint first, delete second. Always.
--   2. tally_guid is UNIQUE on parties and items. The guid can only be written
--      onto the Dispatch row AFTER the twin holding it is gone.
--   3. mst_party_items is UNIQUE(party_id, item_id). Repointing can collide with
--      a pair that already exists, so collisions are dropped, not raised.
--
-- Every deleted or altered row is copied into private.dispatch_cutover_* first.
-- That is what makes 00_rollback.sql able to put the world back.
-- ===========================================================================

set lock_timeout = '3s';   -- fail fast rather than stall the app mid-freeze

begin;

-- ---------------------------------------------------------------------------
-- 0. Backup tables. Structure copied from the live tables so a restore is a
--    plain INSERT ... SELECT with no column list to drift.
-- ---------------------------------------------------------------------------
create schema if not exists private;

drop table if exists private.dispatch_cutover_parties;
drop table if exists private.dispatch_cutover_items;
drop table if exists private.dispatch_cutover_party_items;

create table private.dispatch_cutover_parties (like public.mst_parties including all);
create table private.dispatch_cutover_items   (like public.mst_items   including all);
create table private.dispatch_cutover_party_items as
  select pi.*, false as was_inserted, false as was_deleted from public.mst_party_items pi where false;

-- ⚠ THE SIX FUNCTION BODIES, CAPTURED BEFORE ANY OF THEM IS REPLACED.
--   Without this the rollback has nothing to restore from, and after a rollback
--   the RPCs would read mst_* while the foreign keys point back at
--   fms_dispatch_* — every order-line save would fail. Captured here, at the
--   top, because by section 7 they have already been overwritten.
drop table if exists private.dispatch_cutover_functions;
create table private.dispatch_cutover_functions as
  select p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_dispatch_replace_lines', 'fms_dispatch_email_payload',
                       'fms_dispatch_amend_round', 'fms_dispatch_apply_ship_lines',
                       'fms_dispatch_archive_round', 'fms_dispatch_resolve_master_request');

do $check$
begin
  if (select count(*) from private.dispatch_cutover_functions) <> 6 then
    raise exception 'cutover: expected 6 function bodies to back up, captured %',
      (select count(*) from private.dispatch_cutover_functions);
  end if;
end $check$;


-- ---------------------------------------------------------------------------
-- 1. Copy Dispatch's masters in, keeping their ids.
--
--    source='portal' marks them as ours until a reconcile decision hands them a
--    Tally guid in step 4. modules={'order-to-dispatch'} is what puts them back
--    in Dispatch's own dropdowns - without it the module would open empty.
-- ---------------------------------------------------------------------------
insert into public.mst_parties
  (id, name, code, gstin, contact_name, phone, email, location,
   is_customer, is_vendor, source, modules, active, sort_order, created_at, updated_at)
select d.id, d.name, d.code, d.gstin, d.contact_name, d.phone, d.email, d.location,
       true, false, 'portal', array['order-to-dispatch'], d.active, d.sort_order,
       d.created_at, d.updated_at
  from public.fms_dispatch_customers d
on conflict (id) do nothing;

insert into public.mst_items
  (id, name, code, hsn_code, unit_id, source, modules, active, sort_order, created_at, updated_at)
select d.id, d.name, d.code, d.hsn_code,
       (select u.id from public.mst_units u
         where upper(trim(u.name)) = upper(trim(coalesce(d.unit,''))) limit 1),
       'portal', array['order-to-dispatch'], d.active, d.sort_order, d.created_at, d.updated_at
  from public.fms_dispatch_items d
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 2. Repoint the Tally catalogue off every twin, BEFORE anything is deleted.
--    (Constraint 1. This step is the whole reason the cutover is in this order.)
-- ---------------------------------------------------------------------------
insert into private.dispatch_cutover_party_items
select pi.*, false, false from public.mst_party_items pi
 where pi.party_id in (select p.id from public.mst_parties p
                        join public.mst_reconcile_links l on l.tally_guid = p.tally_guid
                       where l.legacy_table='fms_dispatch_customers' and l.status='linked')
    or pi.item_id in (select i.id from public.mst_items i
                       join public.mst_reconcile_links l on l.tally_guid = i.tally_guid
                      where l.legacy_table='fms_dispatch_items' and l.status='linked');

-- party side
update public.mst_party_items pi
   set party_id = l.legacy_id
  from public.mst_reconcile_links l, public.mst_parties twin
 where l.legacy_table='fms_dispatch_customers' and l.status='linked'
   and twin.tally_guid = l.tally_guid and pi.party_id = twin.id
   and not exists (select 1 from public.mst_party_items x
                    where x.party_id = l.legacy_id and x.item_id = pi.item_id);

-- item side
update public.mst_party_items pi
   set item_id = l.legacy_id
  from public.mst_reconcile_links l, public.mst_items twin
 where l.legacy_table='fms_dispatch_items' and l.status='linked'
   and twin.tally_guid = l.tally_guid and pi.item_id = twin.id
   and not exists (select 1 from public.mst_party_items x
                    where x.item_id = l.legacy_id and x.party_id = pi.party_id);

-- whatever could not move was a duplicate pair; record it, then let it go
insert into private.dispatch_cutover_party_items
select pi.*, false, true from public.mst_party_items pi
 where pi.party_id in (select p.id from public.mst_parties p
                        join public.mst_reconcile_links l on l.tally_guid = p.tally_guid
                       where l.legacy_table='fms_dispatch_customers' and l.status='linked')
    or pi.item_id in (select i.id from public.mst_items i
                       join public.mst_reconcile_links l on l.tally_guid = i.tally_guid
                      where l.legacy_table='fms_dispatch_items' and l.status='linked');


-- ---------------------------------------------------------------------------
-- 3. Carry the twin's Tally-owned values onto the surviving Dispatch row,
--    while the twin still exists to read them from. The guid waits for step 4
--    (constraint 2).
-- ---------------------------------------------------------------------------
-- ⚠ `modules` and `is_vendor` are UNIONED, never overwritten. Both are zero on
--   every twin today, so this is latent — but it costs one operator and it makes
--   the absorb non-destructive if anyone ticks a twin into another module, or
--   Tally reclassifies a ledger as also-a-vendor, between now and the freeze.
-- ⚠ `tally_tenant` must come across: masters-sync writes it on every pull and
--   company_id is derived from it. Without it, 546 rows sit tenant-less until
--   the next sync heals them.
update public.mst_parties keep
   set name         = twin.name,
       gstin        = coalesce(twin.gstin, keep.gstin),
       sub_group    = twin.sub_group,
       group_chain  = twin.group_chain,
       credit_limit = twin.credit_limit,
       credit_period= twin.credit_period,
       company_id   = twin.company_id,
       is_vendor    = keep.is_vendor or twin.is_vendor,
       modules      = (select coalesce(array_agg(distinct m), '{}')
                         from unnest(keep.modules || twin.modules) m),
       source       = 'tally',
       tally_synced_at = twin.tally_synced_at
  from public.mst_reconcile_links l
  join public.mst_parties twin on twin.tally_guid = l.tally_guid
 where l.legacy_table='fms_dispatch_customers' and l.status='linked'
   and keep.id = l.legacy_id;

-- ⚠ item_type IS RE-DERIVED, NOT INHERITED BLIND.
--   Step 1 inserts with no group_id, so the mst_items_guess_type BEFORE INSERT
--   trigger has already fired against the DISPATCH spelling with a NULL group —
--   its weakest possible input. 36 of the 234 twins carry item_type IS NULL, so
--   a plain coalesce(twin.item_type, keep.item_type) would make that blind guess
--   permanent: the trigger is INSERT-only and never re-runs. Re-deriving from the
--   twin's real name AND its real group is the whole point.
update public.mst_items keep
   set name       = twin.name,
       company_id = twin.company_id,
       group_id   = twin.group_id,
       unit_id    = coalesce(twin.unit_id, keep.unit_id),
       hsn_code   = coalesce(twin.hsn_code, keep.hsn_code),
       item_type  = coalesce(
                      twin.item_type,
                      public.mst_guess_item_type(
                        twin.name,
                        (select g.name from public.mst_item_groups g where g.id = twin.group_id))),
       tally_tenant = coalesce(twin.tally_tenant, keep.tally_tenant),
       modules    = (select coalesce(array_agg(distinct m), '{}')
                       from unnest(keep.modules || twin.modules) m),
       source     = 'tally',
       tally_synced_at = twin.tally_synced_at
  from public.mst_reconcile_links l
  join public.mst_items twin on twin.tally_guid = l.tally_guid
 where l.legacy_table='fms_dispatch_items' and l.status='linked'
   and keep.id = l.legacy_id;


-- ---------------------------------------------------------------------------
-- 4. Back the twins up, delete them, then move their guid across.
-- ---------------------------------------------------------------------------
insert into private.dispatch_cutover_parties
select twin.* from public.mst_parties twin
  join public.mst_reconcile_links l on l.tally_guid = twin.tally_guid
 where l.legacy_table='fms_dispatch_customers' and l.status='linked';

insert into private.dispatch_cutover_items
select twin.* from public.mst_items twin
  join public.mst_reconcile_links l on l.tally_guid = twin.tally_guid
 where l.legacy_table='fms_dispatch_items' and l.status='linked';

delete from public.mst_parties twin
 using public.mst_reconcile_links l
 where l.legacy_table='fms_dispatch_customers' and l.status='linked'
   and twin.tally_guid = l.tally_guid and twin.id <> l.legacy_id;

delete from public.mst_items twin
 using public.mst_reconcile_links l
 where l.legacy_table='fms_dispatch_items' and l.status='linked'
   and twin.tally_guid = l.tally_guid and twin.id <> l.legacy_id;

update public.mst_parties keep set tally_guid = l.tally_guid
  from public.mst_reconcile_links l
 where l.legacy_table='fms_dispatch_customers' and l.status='linked' and keep.id = l.legacy_id;

update public.mst_items keep set tally_guid = l.tally_guid
  from public.mst_reconcile_links l
 where l.legacy_table='fms_dispatch_items' and l.status='linked' and keep.id = l.legacy_id;


-- ---------------------------------------------------------------------------
-- 5. The customer-item mapping, keeping its ids too.
-- ---------------------------------------------------------------------------
insert into private.dispatch_cutover_party_items
select ci.id, ci.customer_id, ci.item_id, ci.active, ci.sort_order, ci.created_by,
       ci.created_at, ci.updated_at, 'portal', null, 0, true, false
  from public.fms_dispatch_customer_items ci;

insert into public.mst_party_items
  (id, party_id, item_id, active, sort_order, created_by, created_at, updated_at, source)
select ci.id, ci.customer_id, ci.item_id, ci.active, ci.sort_order, ci.created_by,
       ci.created_at, ci.updated_at, 'portal'
  from public.fms_dispatch_customer_items ci
on conflict (party_id, item_id) do nothing;


-- ---------------------------------------------------------------------------
-- 6. Repoint the THREE foreign keys that carry live traffic. Instant: the ids
--    already match, so each validates against data that is already correct.
--
-- ⚠ ON DELETE RESTRICT IS NOT DECORATION. All three are RESTRICT today
--   (checked in pg_constraint). Re-adding them with no ON DELETE clause
--   silently downgrades them to NO ACTION — which still blocks the delete, but
--   defers the check to end-of-statement and, more to the point, quietly
--   changes a guarantee nobody asked to change.
--
-- ⚠ THE TWO fms_dispatch_customer_items FKs ARE DELIBERATELY LEFT ALONE.
--   After this cutover nothing reads or writes that table — it exists solely as
--   the rollback's source of truth. Repointing it at mst_* ON DELETE CASCADE
--   would mean that from the moment of commit, an admin deleting a party or an
--   item on the CENTRAL Masters screen — a different module, nothing to do with
--   Dispatch — silently eats rows out of the rollback snapshot. No error, no
--   counter. Pointed at the old tables, which are complete and frozen, the
--   snapshot stays immutable.
-- ---------------------------------------------------------------------------
alter table public.fms_dispatch_orders      drop constraint if exists fms_dispatch_orders_customer_id_fkey;
alter table public.fms_dispatch_order_items drop constraint if exists fms_dispatch_order_items_item_id_fkey;
alter table public.fms_dispatch_round_items drop constraint if exists fms_dispatch_round_items_item_id_fkey;

alter table public.fms_dispatch_orders
  add constraint fms_dispatch_orders_customer_id_fkey
  foreign key (customer_id) references public.mst_parties(id) on delete restrict;
alter table public.fms_dispatch_order_items
  add constraint fms_dispatch_order_items_item_id_fkey
  foreign key (item_id) references public.mst_items(id) on delete restrict;
alter table public.fms_dispatch_round_items
  add constraint fms_dispatch_round_items_item_id_fkey
  foreign key (item_id) references public.mst_items(id) on delete restrict;


-- ---------------------------------------------------------------------------
-- 7. Repoint the approve-a-master RPC. MUST BE IN THIS TRANSACTION.
--
--    ⚠ THE MOST DANGEROUS LINE IN THE WHOLE CUTOVER IS THE ONE NOBODY CHANGES.
--      This function inserts into fms_dispatch_customers / _items /
--      _customer_items by name. Leave it alone and approving a master request
--      still SUCCEEDS - it writes a row into a table the app no longer reads.
--      No error, no warning; the master manager approves, and the customer
--      simply never appears. Silent, and only noticed days later.
--
--    New rows are born portal-owned and already ticked into Dispatch, or the
--    thing someone just asked for would arrive invisible.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_resolve_master_request(
  p_request_id uuid, p_approve boolean, p_payload jsonb default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type text; v_status text; v_payload jsonb; v_new_id uuid; v_name text; v_party text;
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
    if v_name is null and v_type <> 'customer_item' then
      raise exception 'A name is required to approve a master request';
    end if;

    if v_type = 'company' then
      insert into public.fms_dispatch_companies (name, gstin, address, gate_pass_prefix, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'),''), nullif(trim(v_payload->>'address'),''),
              nullif(trim(v_payload->>'gate_pass_prefix'),''), auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer' then
      insert into public.mst_parties
        (name, code, location, gstin, contact_name, phone, email,
         is_customer, is_vendor, source, modules, created_by)
      values (v_name,
              nullif(trim(v_payload->>'code'),''),
              nullif(trim(v_payload->>'location'),''),
              nullif(trim(v_payload->>'gstin'),''),
              nullif(trim(v_payload->>'contact_name'),''),
              nullif(trim(v_payload->>'phone'),''),
              nullif(trim(v_payload->>'email'),''),
              true, false, 'portal', array['order-to-dispatch'], auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item' then
      -- No unit: mst_items points at mst_units and the unit is Tally's.
      insert into public.mst_items (name, code, hsn_code, source, modules, created_by)
      values (v_name, nullif(trim(v_payload->>'code'),''), nullif(trim(v_payload->>'hsn_code'),''),
              'portal', array['order-to-dispatch'], auth.uid())
      returning id into v_new_id;

    elsif v_type = 'customer_item' then
      -- `customer_id` is read as a fallback so requests raised BEFORE the
      -- cutover, still sitting pending, can be approved after it.
      v_party := coalesce(nullif(trim(v_payload->>'party_id'),''),
                          nullif(trim(v_payload->>'customer_id'),''));
      if v_party is null or nullif(trim(v_payload->>'item_id'),'') is null then
        raise exception 'A mapping needs both a customer and an item';
      end if;
      insert into public.mst_party_items (party_id, item_id, source, created_by)
      values (v_party::uuid, (v_payload->>'item_id')::uuid, 'portal', auth.uid())
      on conflict (party_id, item_id) do nothing
      returning id into v_new_id;

    elsif v_type = 'company_location' then
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
end $function$;


-- ---------------------------------------------------------------------------
-- 7b. fms_dispatch_replace_lines — the order-line saver. Rewritten in full,
--     because two of its three reads change MEANING, not just table name.
--
--     ⚠ THE `unit` READ IS THE WORST SILENT FAILURE IN THIS WHOLE CUTOVER.
--       mst_items has no `unit` column, only unit_id -> mst_units. Left pointing
--       at fms_dispatch_items it does not error: it reads the stale table, and
--       for any item created AFTER the cutover there is no row at all, so
--       v_unit is NULL. fms_dispatch_order_items.unit is nullable, and
--       fms_dispatch_archive_round copies it into round_items.unit_name. The
--       gate pass, the receiver copy and the dispatch email then print a
--       quantity with no unit, permanently, and nothing complains.
--
--     ⚠ The mapping guard moves to mst_party_items AND renames customer_id ->
--       party_id. Left alone it fails BOTH ways: a newly approved mapping is
--       refused (loud), and a mapping deactivated centrally is still accepted
--       (silent - the guard stops guarding).
-- ---------------------------------------------------------------------------
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
      select 1 from public.mst_party_items ci
       where ci.party_id = v_cust and ci.item_id = v_item and ci.active
    ) then
      select name into v_item_name from public.mst_items where id = v_item;
      raise exception 'This customer is not mapped to %. Add the pair in Central Masters -> Customer Items first.',
        coalesce(v_item_name, 'that item');
    end if;

    -- The unit is READ FROM THE ITEM, never taken from the payload: it is a
    -- property of what is being sent, not a per-line choice.
    -- LEFT join on purpose: a null unit_id is legitimate and the line must still save.
    select u.name into v_unit
      from public.mst_items i
      left join public.mst_units u on u.id = i.unit_id
     where i.id = v_item;

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


-- ---------------------------------------------------------------------------
-- 7c. The four remaining functions each change ONLY a table name — they join
--     for `it.id`, `it.name`, `c.id`, `c.name`, every one of which exists on the
--     central tables (checked). So they are repointed by substituting the table
--     name inside their own current definition.
--
--     ⚠ THIS IS DELIBERATE, NOT LAZY. Retyping ~800 lines of function body by
--       hand is how a `security definer` or a `set search_path` gets quietly
--       dropped — and a definer function that loses `security definer` starts
--       running as the caller, under the caller's RLS, silently returning less.
--       Rewriting the definition pg_get_functiondef gives back preserves every
--       attribute by construction and changes exactly the eight characters
--       intended.
--
--     Neither substring can collide: 'public.fms_dispatch_customer_items' does
--     not contain 'public.fms_dispatch_customers' nor 'public.fms_dispatch_items'.
-- ---------------------------------------------------------------------------
do $repoint$
declare
  r record;
  v_def text;
  v_done int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fms_dispatch_email_payload', 'fms_dispatch_amend_round',
                         'fms_dispatch_apply_ship_lines', 'fms_dispatch_archive_round')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, 'public.fms_dispatch_customers', 'public.mst_parties');
    v_def := replace(v_def, 'public.fms_dispatch_items',     'public.mst_items');
    execute v_def;
    v_done := v_done + 1;
  end loop;

  if v_done <> 4 then
    raise exception 'repoint: expected 4 functions, rewrote %', v_done;
  end if;
end $repoint$;


-- ---------------------------------------------------------------------------
-- 8. Prove it. Any failure rolls the whole transaction back untouched.
-- ---------------------------------------------------------------------------
do $verify$
declare v int;
begin
  select count(*) into v from public.fms_dispatch_orders o
   where not exists (select 1 from public.mst_parties p where p.id = o.customer_id);
  if v > 0 then raise exception 'VERIFY FAILED: % order(s) point at a missing customer', v; end if;

  select count(*) into v from public.fms_dispatch_order_items oi
   where not exists (select 1 from public.mst_items i where i.id = oi.item_id);
  if v > 0 then raise exception 'VERIFY FAILED: % order line(s) point at a missing item', v; end if;

  select count(*) into v from public.fms_dispatch_customers d
   where not exists (select 1 from public.mst_parties p where p.id = d.id);
  if v > 0 then raise exception 'VERIFY FAILED: % Dispatch customer(s) did not arrive', v; end if;

  select count(*) into v from public.fms_dispatch_items d
   where not exists (select 1 from public.mst_items i where i.id = d.id);
  if v > 0 then raise exception 'VERIFY FAILED: % Dispatch item(s) did not arrive', v; end if;

  -- every linked row must now carry its guid, and exactly once
  select count(*) into v from public.mst_reconcile_links l
   where l.status='linked' and l.legacy_table='fms_dispatch_customers'
     and not exists (select 1 from public.mst_parties p where p.id=l.legacy_id and p.tally_guid=l.tally_guid);
  if v > 0 then raise exception 'VERIFY FAILED: % linked customer(s) did not take their guid', v; end if;

  -- ⚠ THE ITEM SIDE NEEDS THE SAME CHECK, AND FOR A NASTIER REASON.
  --   If a linked item's legacy_id has disappeared from fms_dispatch_items since
  --   the decision was recorded, step 1 inserts nothing, but the delete still
  --   removes the Tally twin (twin.id <> l.legacy_id holds) and the guid UPDATE
  --   matches zero rows — so a Tally item AND its catalogue rows are destroyed
  --   with nothing to show for it. Zero today; the premise of a freeze is that
  --   state moves.
  select count(*) into v from public.mst_reconcile_links l
   where l.status='linked' and l.legacy_table='fms_dispatch_items'
     and not exists (select 1 from public.mst_items i where i.id=l.legacy_id and i.tally_guid=l.tally_guid);
  if v > 0 then raise exception 'VERIFY FAILED: % linked item(s) did not take their guid', v; end if;

  -- the customer-item catalogue must not have been thinned by a cascade
  if (select count(*) from public.mst_party_items) < 5000 then
    raise exception 'VERIFY FAILED: the customer-item catalogue collapsed to % rows',
      (select count(*) from public.mst_party_items);
  end if;

  -- ⚠ NOTHING MAY STILL READ THE OLD TABLES. This is the assertion that would
  --   have caught the five functions nobody thought to look for: they do not
  --   error after the cutover, they quietly read frozen data forever.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~ 'fms_dispatch_(customers|items|customer_items)\y'
  ) then
    raise exception 'VERIFY FAILED: a function still reads the old master tables: %',
      (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.prokind='f'
          and pg_get_functiondef(p.oid) ~ 'fms_dispatch_(customers|items|customer_items)\y');
  end if;

  -- A pair Dispatch had DEACTIVATED must not come back to life just because the
  -- sales register also knows about it. `on conflict do nothing` keeps the Tally
  -- row, including its `active` — so the merge can silently re-offer something
  -- somebody deliberately withdrew. Zero collisions today; that is luck, not design.
  select count(*) into v
    from public.fms_dispatch_customer_items ci
    join public.mst_party_items pi on pi.party_id = ci.customer_id and pi.item_id = ci.item_id
   where ci.active = false and pi.active = true;
  if v > 0 then
    raise exception 'VERIFY FAILED: % deactivated mapping(s) came back to life', v;
  end if;
end $verify$;

commit;


-- ===========================================================================
-- DELIBERATELY OUT OF SCOPE: companies and locations.
--
--   Dispatch models a site as COMPANY x LOCATION - "Orange O Tec Pvt Ltd" plus
--   "SURAT-HOJIWALA". Tally models the same thing as a SEPARATE COMPANY BOOK -
--   "O-tec Surat" and "O-tec Noida" are two companies, not one company with two
--   locations. So Dispatch's 2 company rows do not map 1:1 onto Central's 5;
--   it takes company AND location together to land on the right book.
--
--   Migrating them would therefore mean rewriting company_id on 277 orders and
--   163 rounds - a real change to live records, for no gain today. Customers and
--   items are the duplication that actually hurts. Companies are 2 rows.
--
--   Left for a follow-up, once we agree how company x location maps to a book.
--   Dispatch keeps fms_dispatch_companies and fms_dispatch_company_locations
--   until then, and orders keep their company_id and location_id untouched.
-- ===========================================================================
