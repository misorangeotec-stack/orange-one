-- ONE PRODUCT, ONE RECORD — retiring the old Dispatch item entries that duplicate Tally's.
--
-- THE FACT UNDERNEATH. Tally files a separate stock item in every company book
-- that stocks it, so the same ink is several rows. When Order to Dispatch's
-- hand-typed customer-item list moved into Central Masters, 1,582 of its pairs
-- landed with the customer matched to one book's ledger and the item matched to
-- a DIFFERENT book's twin. Tally's own 6,064 pairs never cross books; every one
-- of these came from the old list.
--
-- 684 of those 1,582 are true duplicates: the customer already has the same
-- product through its own book's item as well. Those 684 are what this retires.
--
-- ⚠ THE OTHER 898 ARE NOT TOUCHED, and must never be. They are the ONLY route by
--   which that customer can order that product — most of the catalogue is filed
--   under one company's book while both firms sell it, which is exactly why the
--   order form does not filter items by the item's own book. Deleting them would
--   take the product away from the customer entirely.
--
-- WHAT MAKES THE SWAP SAFE, measured on the live data rather than assumed:
--   * all 684 have EXACTLY ONE target in the customer's own book — none ambiguous
--   * zero of the 684 differ from their target on unit or HSN, so nothing that
--     reaches an order, a gate pass or an invoice changes
--   * zero of the 684 have ever been sold against (sale_count = 0, no last_sold_on)
--   * no order carries both twins, so repointing cannot merge two lines into one
--
-- ⚠ THIS IS THE FIRST OPERATION IN CENTRAL MASTERS THAT CHANGES EXISTING ROWS.
--   Everything before it only ever added. 575 order lines across 159 already-raised
--   orders are repointed from the old item to Tally's. Authorised explicitly by the
--   user on 2026-08-18, on the understanding that it is the same product either way.
--
-- ⚠ fms_dispatch_round_items IS DELIBERATELY LEFT ALONE. It is the archive of what
--   physically went out, and it carries its own frozen item_name / unit_name. Its
--   item_id resolves to an item with an identical name and unit, so nothing renders
--   differently; rewriting it would be editing a photograph for no visible gain.
--
-- Installed as procedures so the dry run, the rehearsal and the real run are the
-- SAME CODE. Phase 1 taught that a rollback which is only read does not work.

create schema if not exists private;

/* --------------------------------------------------------------- the plan -- */

create table if not exists private.itemswap_plan (
  mapping_id   uuid primary key,
  party_id     uuid not null,
  old_item_id  uuid not null,
  new_item_id  uuid not null,
  built_at     timestamptz not null default now()
);

/* Full copies of every mst_party_items row removed, so the rollback can put
   them back byte for byte rather than reconstructing them. */
create table if not exists private.itemswap_pairs_before (
  like public.mst_party_items including defaults
);

create table if not exists private.itemswap_lines_before (
  order_item_id uuid primary key,
  old_item_id   uuid not null,
  old_unit      text
);


/* ------------------------------------------------------------------- run -- */

create or replace function private.itemswap_run()
returns text
language plpgsql
as $fn$
declare
  v_orders_0 int; v_lines_0 int; v_rounds_0 int; v_rlines_0 int; v_qty_0 numeric;
  v_orders_1 int; v_lines_1 int; v_rounds_1 int; v_rlines_1 int; v_qty_1 numeric;
  v_pairs_0 int; v_pairs_1 int;
  v_unmapped_0 int; v_unmapped_1 int;
  v_dupline_0 int;
  v_del int; v_upd int; v_n int;
begin
  -- Everything below runs inside ONE transaction, so these before-counts are a
  -- consistent snapshot even while people are raising orders.
  select count(*) into v_orders_0 from public.fms_dispatch_orders;
  select count(*) into v_lines_0  from public.fms_dispatch_order_items;
  select count(*) into v_rounds_0 from public.fms_dispatch_rounds;
  select count(*) into v_rlines_0 from public.fms_dispatch_round_items;
  select coalesce(sum(quantity),0) into v_qty_0 from public.fms_dispatch_order_items;
  select count(*) into v_pairs_0  from public.mst_party_items;

  -- How many existing order lines the server would REFUSE today, because the
  -- customer has no active mapping to that item. The swap must not raise this.
  select count(*) into v_unmapped_0
    from public.fms_dispatch_order_items oi
    join public.fms_dispatch_orders o on o.id = oi.order_id
   where not exists (select 1 from public.mst_party_items m
                      where m.party_id = o.customer_id and m.item_id = oi.item_id and m.active);

  -- Orders that ALREADY carry two lines of one item. Recorded before the change
  -- so the "did repointing merge anything" test compares like with like.
  select count(*) into v_dupline_0 from (
    select order_id, item_id from public.fms_dispatch_order_items
    group by 1,2 having count(*) > 1) z;

  /* ---- build the plan, from live data at this instant ---- */
  delete from private.itemswap_plan;
  insert into private.itemswap_plan (mapping_id, party_id, old_item_id, new_item_id)
  select w.id, w.party_id, w.item_id, t.item_id
  from (
    select pi.id, pi.party_id, pi.item_id, p.company_id as party_book, upper(i.name) nm
    from public.mst_party_items pi
    join public.mst_parties p on p.id = pi.party_id
    join public.mst_items  i on i.id = pi.item_id
    where pi.active and pi.source = 'portal'
      and i.company_id is distinct from p.company_id
  ) w
  join lateral (
    select pi2.item_id
    from public.mst_party_items pi2
    join public.mst_items i2 on i2.id = pi2.item_id
    where pi2.party_id = w.party_id and pi2.active
      and upper(i2.name) = w.nm
      and i2.company_id is not distinct from w.party_book
  ) t on true;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'itemswap: the plan is empty - nothing matches, refusing to proceed';
  end if;

  /* ---- pre-flight, all of it fatal ---- */

  -- ONE target each. A second candidate means two different items share a name
  -- inside one book, and picking either would be a guess. The primary key on
  -- mapping_id would already have refused the insert, so this is belt and braces.
  select count(*) into v_n from (
    select mapping_id from private.itemswap_plan group by 1 having count(*) > 1) z;
  if v_n > 0 then raise exception 'itemswap: % mappings have more than one target', v_n; end if;

  -- The product must be the same in every respect that reaches a document.
  select count(*) into v_n
    from private.itemswap_plan p
    join public.mst_items a on a.id = p.old_item_id
    join public.mst_items b on b.id = p.new_item_id
   where upper(a.name) is distinct from upper(b.name)
      or a.unit_id is distinct from b.unit_id
      or coalesce(a.hsn_code,'') is distinct from coalesce(b.hsn_code,'')
      or not b.active;
  if v_n > 0 then raise exception 'itemswap: % targets differ on name, unit or HSN, or are inactive', v_n; end if;

  -- Nothing being retired has ever been sold against.
  select count(*) into v_n
    from private.itemswap_plan p join public.mst_party_items m on m.id = p.mapping_id
   where coalesce(m.sale_count,0) <> 0 or m.last_sold_on is not null;
  if v_n > 0 then raise exception 'itemswap: % of the mappings carry sales - not duplicates', v_n; end if;

  -- The customer must already hold the target mapping, or the swap would leave
  -- an order line the server refuses.
  select count(*) into v_n
    from private.itemswap_plan p
   where not exists (select 1 from public.mst_party_items m
                      where m.party_id = p.party_id and m.item_id = p.new_item_id and m.active);
  if v_n > 0 then raise exception 'itemswap: % targets are not mapped to the customer', v_n; end if;

  -- Repointing must not merge two lines of one order into the same item.
  select count(*) into v_n from (
    select oi.order_id, coalesce(p.new_item_id, oi.item_id) as final_item
    from public.fms_dispatch_order_items oi
    join public.fms_dispatch_orders o on o.id = oi.order_id
    left join private.itemswap_plan p
           on p.party_id = o.customer_id and p.old_item_id = oi.item_id
    group by 1,2 having count(*) > 1) z;
  if v_n > v_dupline_0 then
    raise exception 'itemswap: repointing would merge lines on an order (% -> %)', v_dupline_0, v_n;
  end if;

  /* ---- snapshot, then change ---- */

  delete from private.itemswap_pairs_before;
  insert into private.itemswap_pairs_before
  select m.* from public.mst_party_items m
   where m.id in (select mapping_id from private.itemswap_plan);

  delete from private.itemswap_lines_before;
  insert into private.itemswap_lines_before (order_item_id, old_item_id, old_unit)
  select oi.id, oi.item_id, oi.unit
    from public.fms_dispatch_order_items oi
    join public.fms_dispatch_orders o on o.id = oi.order_id
    join private.itemswap_plan p on p.party_id = o.customer_id and p.old_item_id = oi.item_id;

  -- ORDER LINES FIRST. The mapping is what authorises the line; removing it
  -- before the line moves would leave the row unauthorised in between.
  update public.fms_dispatch_order_items oi
     set item_id = p.new_item_id
    from public.fms_dispatch_orders o, private.itemswap_plan p
   where o.id = oi.order_id
     and p.party_id = o.customer_id
     and p.old_item_id = oi.item_id;
  get diagnostics v_upd = row_count;

  delete from public.mst_party_items m
   where m.id in (select mapping_id from private.itemswap_plan);
  get diagnostics v_del = row_count;

  /* ---- proofs ---- */

  select count(*) into v_orders_1 from public.fms_dispatch_orders;
  select count(*) into v_lines_1  from public.fms_dispatch_order_items;
  select count(*) into v_rounds_1 from public.fms_dispatch_rounds;
  select count(*) into v_rlines_1 from public.fms_dispatch_round_items;
  select coalesce(sum(quantity),0) into v_qty_1 from public.fms_dispatch_order_items;
  select count(*) into v_pairs_1  from public.mst_party_items;

  if (v_orders_1, v_lines_1, v_rounds_1, v_rlines_1, v_qty_1)
     is distinct from (v_orders_0, v_lines_0, v_rounds_0, v_rlines_0, v_qty_0) then
    raise exception 'itemswap: an order, line, round or quantity count moved';
  end if;

  if v_pairs_1 <> v_pairs_0 - v_del then
    raise exception 'itemswap: mapping count moved by more than the % deleted', v_del;
  end if;

  select count(*) into v_n from public.fms_dispatch_order_items where unit is null;
  if v_n > 0 then raise exception 'itemswap: % order lines lost their unit', v_n; end if;

  -- THE ONE THAT MATTERS: no order line may become unsaveable. It should FALL.
  select count(*) into v_unmapped_1
    from public.fms_dispatch_order_items oi
    join public.fms_dispatch_orders o on o.id = oi.order_id
   where not exists (select 1 from public.mst_party_items m
                      where m.party_id = o.customer_id and m.item_id = oi.item_id and m.active);
  if v_unmapped_1 > v_unmapped_0 then
    raise exception 'itemswap: % order lines became unsaveable (was %)', v_unmapped_1, v_unmapped_0;
  end if;

  return format(
    'itemswap OK - %s mappings retired, %s order lines repointed; orders %s, lines %s, rounds %s, round lines %s, qty %s all unchanged; unsaveable lines %s -> %s',
    v_del, v_upd, v_orders_1, v_lines_1, v_rounds_1, v_rlines_1, v_qty_1, v_unmapped_0, v_unmapped_1);
end $fn$;


/* -------------------------------------------------------------- rollback -- */

create or replace function private.itemswap_rollback()
returns text
language plpgsql
as $fn$
declare v_lines int; v_pairs int; v_n int;
begin
  if not exists (select 1 from private.itemswap_pairs_before) then
    raise exception 'itemswap_rollback: no snapshot - nothing to undo';
  end if;

  -- LINES FIRST, mirroring the run in reverse: put the order back on its old
  -- item while that item's mapping is still absent, then restore the mapping.
  update public.fms_dispatch_order_items oi
     set item_id = b.old_item_id, unit = b.old_unit
    from private.itemswap_lines_before b
   where b.order_item_id = oi.id;
  get diagnostics v_lines = row_count;

  insert into public.mst_party_items
  select * from private.itemswap_pairs_before
  on conflict (id) do nothing;
  get diagnostics v_pairs = row_count;

  select count(*) into v_n
    from private.itemswap_lines_before b
    join public.fms_dispatch_order_items oi on oi.id = b.order_item_id
   where oi.item_id is distinct from b.old_item_id;
  if v_n > 0 then raise exception 'itemswap_rollback: % lines did not go back', v_n; end if;

  select count(*) into v_n
    from private.itemswap_pairs_before b
   where not exists (select 1 from public.mst_party_items m where m.id = b.id);
  if v_n > 0 then raise exception 'itemswap_rollback: % mappings did not come back', v_n; end if;

  return format('itemswap rolled back - %s lines restored, %s mappings reinstated', v_lines, v_pairs);
end $fn$;
