-- ===========================================================================
-- PHASE 1 ROLLBACK — put Order to Dispatch back on its own master tables.
--
-- ⚠ THE FIRST VERSION OF THIS FILE COULD NOT RUN. It is worth saying why,
--   because the reason is the whole lesson of this cutover:
--
--     It deleted the copied rows `where source = 'portal'` — but the cutover
--     sets source = 'tally' on every row that absorbed a twin. So it skipped
--     312 of 327 parties and ALL 234 items, then tried to re-insert the twins,
--     which collided with the UNIQUE tally_guid those survivors were now
--     holding. `on conflict (id)` does not catch a conflict on a DIFFERENT
--     index. The block aborted and restored nothing.
--
--   A rollback nobody has run is not a rollback. This one is rehearsed before
--   the cutover, against real data, as a gate.
--
-- ORDER MATTERS HERE EXACTLY AS IT DOES IN THE CUTOVER
--   mst_party_items CASCADES from both party_id and item_id. Deleting the
--   Dispatch-origin rows while catalogue rows still point at them destroys
--   those rows — the same trap the cutover was built around, in reverse.
--   So: repoint the catalogue OFF them first, delete them last.
--
-- SAFE TO RUN TWICE — every step is idempotent or guarded.
-- ===========================================================================

do $rollback$
declare
  v_orders int; v_lines int; v_fn int := 0;
  r record;
begin
  if to_regclass('private.dispatch_cutover_parties') is null
     or to_regclass('private.dispatch_cutover_functions') is null then
    raise exception 'ROLLBACK ABORTED: backup tables missing - the cutover never ran, or they were dropped';
  end if;

  select count(*) into v_orders from public.fms_dispatch_orders;
  select count(*) into v_lines  from public.fms_dispatch_order_items;

  -- ------------------------------------------------- 1. foreign keys back --
  --    ON DELETE RESTRICT restored explicitly: it is what they were before.
  alter table public.fms_dispatch_orders      drop constraint if exists fms_dispatch_orders_customer_id_fkey;
  alter table public.fms_dispatch_order_items drop constraint if exists fms_dispatch_order_items_item_id_fkey;
  alter table public.fms_dispatch_round_items drop constraint if exists fms_dispatch_round_items_item_id_fkey;

  alter table public.fms_dispatch_orders
    add constraint fms_dispatch_orders_customer_id_fkey
    foreign key (customer_id) references public.fms_dispatch_customers(id) on delete restrict;
  alter table public.fms_dispatch_order_items
    add constraint fms_dispatch_order_items_item_id_fkey
    foreign key (item_id) references public.fms_dispatch_items(id) on delete restrict;
  alter table public.fms_dispatch_round_items
    add constraint fms_dispatch_round_items_item_id_fkey
    foreign key (item_id) references public.fms_dispatch_items(id) on delete restrict;

  -- The two fms_dispatch_customer_items FKs were never repointed, by design.
  -- Nothing to undo.

  -- ------------------------------- 2. drop the catalogue rows we inserted --
  delete from public.mst_party_items pi
   where exists (select 1 from private.dispatch_cutover_party_items b
                  where b.id = pi.id and b.was_inserted);

  -- ---------------- 3. free the unique index BEFORE restoring the twins --
  --    The survivors are holding the twins' guids. Until that is released the
  --    twin re-insert cannot succeed. This is the step whose absence made the
  --    first version unrunnable.
  update public.mst_parties keep set tally_guid = null
    from public.mst_reconcile_links l
   where l.legacy_table='fms_dispatch_customers' and l.status='linked' and keep.id = l.legacy_id;
  update public.mst_items keep set tally_guid = null
    from public.mst_reconcile_links l
   where l.legacy_table='fms_dispatch_items' and l.status='linked' and keep.id = l.legacy_id;

  -- ------------------------------------------- 4. restore the twin rows --
  insert into public.mst_parties select * from private.dispatch_cutover_parties
  on conflict (id) do nothing;
  insert into public.mst_items   select * from private.dispatch_cutover_items
  on conflict (id) do nothing;

  -- --------------- 5. point the catalogue back at the twins it came from --
  --    Must happen while the Dispatch-origin rows still exist, so that the
  --    delete in step 6 has nothing left pointing at it to cascade.
  update public.mst_party_items pi
     set party_id = b.party_id, item_id = b.item_id
    from private.dispatch_cutover_party_items b
   where b.id = pi.id and not b.was_inserted and not b.was_deleted;

  insert into public.mst_party_items
    (id, party_id, item_id, active, sort_order, created_by, created_at, updated_at, source, last_sold_on, sale_count)
  select b.id, b.party_id, b.item_id, b.active, b.sort_order, b.created_by, b.created_at, b.updated_at,
         b.source, b.last_sold_on, b.sale_count
    from private.dispatch_cutover_party_items b
   where b.was_deleted
  on conflict (id) do nothing;

  -- ------------------------- 6. NOW remove the Dispatch-origin rows --------
  --    No `source` filter: the cutover rewrote source to 'tally' on every row
  --    that absorbed a twin, which is precisely what the old filter missed.
  --    Identity is the id, and the id came from the Dispatch table.
  delete from public.mst_parties p where p.id in (select id from public.fms_dispatch_customers);
  delete from public.mst_items   i where i.id in (select id from public.fms_dispatch_items);

  -- --------------------------- 7. restore the six function bodies ----------
  --    Without this the RPCs read mst_* while the FKs point at fms_dispatch_*,
  --    and EVERY order line save fails.
  for r in select definition from private.dispatch_cutover_functions loop
    execute r.definition;
    v_fn := v_fn + 1;
  end loop;
  if v_fn <> 6 then
    raise exception 'ROLLBACK FAILED: restored % function(s), expected 6', v_fn;
  end if;

  -- ---------------------------------------------------- 8. assertions ------
  select count(*) into v_orders from public.fms_dispatch_orders;
  select count(*) into v_lines  from public.fms_dispatch_order_items;

  if exists (select 1 from public.fms_dispatch_orders o
              where not exists (select 1 from public.fms_dispatch_customers c where c.id = o.customer_id)) then
    raise exception 'ROLLBACK FAILED: an order points at a customer that does not exist';
  end if;
  if exists (select 1 from public.fms_dispatch_order_items oi
              where not exists (select 1 from public.fms_dispatch_items i where i.id = oi.item_id)) then
    raise exception 'ROLLBACK FAILED: an order line points at an item that does not exist';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public' and p.prokind='f'
                and p.proname like 'fms_dispatch%'
                and pg_get_functiondef(p.oid) ~ '\ymst_(parties|items|party_items)\y') then
    raise exception 'ROLLBACK FAILED: a dispatch function still reads the central tables';
  end if;

  raise notice 'rollback complete: % orders / % lines intact, Dispatch back on its own masters',
    v_orders, v_lines;
end $rollback$;


-- ===========================================================================
-- AFTER RUNNING THIS
--   Redeploy the PREVIOUS frontend build. The current one reads mst_* and
--   filters on `modules`, which the restored world does not populate — leave it
--   deployed and every Dispatch picker opens empty.
--
-- WHAT THIS DOES NOT RESTORE
--   `updated_at` on the ~546 absorbed rows. The cutover's UPDATEs fire
--   set_updated_at, and there is no way back to the original stamp. Provenance
--   only; no behaviour depends on it.
-- ===========================================================================
