-- =============================================================================
--  OD-15 · One shipment, several lots — the LOT box holds a split it cannot record
-- =============================================================================
--
--  At Check Material Status the store keeper picks ONE lot per item line. When
--  100 KGS goes out as 60 from one lot and 40 from another there is nowhere to
--  say so — so for months people have said it anyway, by hand, in the free-text
--  box that OD-12 deliberately kept open.
--
--  Measured on this database 11-09-2026, over 4,454 round-item rows:
--
--      holding a '/'                                    99
--        — print-head serial numbers, not lots          26
--        — real multi-lot splits                        92
--      lines with no lot at all                        117
--      distinct values typed                           771
--      rows spelling the quantity with 'kg'             52
--      in-flight order lines carrying a typed split      8
--
--  ⚠ THEY ARE NOT WRITING A LIST. THEY ARE WRITING AN ALLOCATION, AND IT SUMS:
--
--      26081298/975kg/26081284/485kg/26071232/40kg      ship_qty 1500
--      26061043/990kg/26071139/280kg/26061044/80kg/2604841/80kg      1430
--      26051500311/1260/26051400271/740                          2000
--      26061041-120/2603699-20/2604749-10                         150
--
--    So the feature is not "tick several lots". It is "split the shipped
--    quantity across lots", and the users invented the convention themselves
--    because the field would not hold it. One split already runs to FOUR lots,
--    which is why this is a child table and not lot_no_2 / lot_no_3.
--
-- =============================================================================
--  ⚠⚠ WHAT THE WORK-LIST ENTRY GOT WRONG, AND IT CHANGES THE SHAPE
-- =============================================================================
--
--  OD-15 says all three RPCs write fms_dispatch_round_items.lot_no. Half right.
--
--    fms_dispatch_apply_ship_lines writes fms_dispatch_ORDER_items.lot_no — the
--    IN-FLIGHT round's staging row. A round item does not exist yet. It is
--    fms_dispatch_archive_round that later copies the staged value into
--    fms_dispatch_round_items and then wipes the staging fields.
--
--  Hence TWO child tables, one per parent, and a copy at archive time. A single
--  table hung off round items would have nowhere to hold the split while the
--  round is still open — which is the entire time the store keeper is typing it.
--
-- =============================================================================
--  ⚠⚠ THESE THREE BODIES WERE TAKEN FROM pg_proc.prosrc, NOT FROM THE
--     MIGRATION FILES. READ THIS BEFORE EDITING ANY OF THEM.
-- =============================================================================
--
--  The live database is AHEAD of supabase/migrations/ for all three functions.
--  bill_qty is a live column on both fms_dispatch_order_items and
--  fms_dispatch_round_items and is written by the live fms_dispatch_amend_round,
--  yet the string 'bill_qty' appears in NO migration file in this repo and in NO
--  row of supabase_migrations.schema_migrations. The same drift shows in the
--  other two: live apply_ship_lines and archive_round resolve item names from
--  mst_items, where the newest files on disk still read fms_dispatch_items.
--
--  Rebuilding any of these from the file on disk would silently revert the
--  bill-quantity feature on live dispatch records. Everything below is the live
--  body plus the marked OD-15 additions, so the repo now carries the truth.
--
-- =============================================================================
--  ⚠⚠ THE 92 HISTORIC VALUES ARE NOT BACKFILLED, AND MUST NOT BE
-- =============================================================================
--
--  They cannot be parsed, and these are real dispatch records:
--    · '/' separates BOTH lot-from-quantity AND pair-from-pair, in one string —
--      '26040200106 /40/26042100606/160'
--    · '-' is a separator AND occurs inside lot numbers —
--      'T12604180088-30/T12604010005-20'
--    · one row separates with a full stop — '2605864.250kg/26071267.50kg'
--    · 26 are not lots at all, and one — '#1660/#1661-26071182' — is a serial
--      pair and a lot in the same string
--
--  History stays text. These tables start EMPTY and fill going forward. The
--  frontend never parses a stored string: a line with no children seeds ONE row
--  holding the whole value verbatim, so re-saving one of the 8 in-flight typed
--  splits round-trips it byte for byte.
--
-- =============================================================================
--  ⚠⚠ lot_no STAYS, AND BECOMES A RENDERED SUMMARY OF THE CHILDREN
-- =============================================================================
--
--  Written on save by fms_dispatch_lot_text below. Three load-bearing reasons:
--
--    · 4,454 historic rows have no children and must display exactly as they do
--      now — hence the single-lot rule, which returns the bare lot name;
--    · SIX readers keep working untouched — OrderRefPanel, OrderDetail twice,
--      the Order Register export, lib/rounds.ts, and
--      supabase/functions/_shared/workSnapshot.bundle.js, which the entry does
--      not list;
--    · the Order Register keeps its column.
--
--  Dropping lot_no, or leaving it stale while the children carry the truth,
--  orphans every one of them.
--
-- =============================================================================
--  ROLLBACK: 20261122120000_od15_one_shipment_several_lots_rollback.sql
--
--  ⚠ IT DOES NOT DROP THE TABLES, AND THAT IS DELIBERATE. The frontend reads the
--    children through a PostgREST embed; dropping the tables under a deployed
--    frontend 400s the whole dispatch fetch, taking the module blank rather than
--    just the lots. The rollback restores the four function bodies and leaves
--    both tables standing, unread and harmless.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · The two child tables
--
-- ⚠ qty IS NULLABLE ON PURPOSE. It is the store keeper's own reading of what
--   physically went out, not a figure this module can derive, and OD-12's rule
--   stands: the Tally balance is advisory and a dispatch is never held up by a
--   paper figure. A lot with no quantity against it is recorded as a lot.
--
-- ⚠ on delete cascade MATCHES THE EXISTING CHAIN (orders -> rounds ->
--   round_items). Nothing in this repo ever deletes a round or a round item —
--   rounds are archived, never deleted — so this fires only when an order goes.
-- ---------------------------------------------------------------------------

create table if not exists public.fms_dispatch_order_item_lots (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.fms_dispatch_order_items on delete cascade,
  lot_no        text not null,
  qty           numeric(14,3) check (qty is null or qty >= 0),
  seq           integer not null,
  created_at    timestamptz not null default now(),
  unique (order_item_id, seq)
);

comment on table public.fms_dispatch_order_item_lots is
  'OD-15 · which lots the IN-FLIGHT round draws on for one order line, and how much from each. Copied into fms_dispatch_round_item_lots when the round is archived, then cleared with the rest of the staging fields. fms_dispatch_order_items.lot_no is the rendered summary of these rows.';

create index if not exists fms_dispatch_order_item_lots_line_idx
  on public.fms_dispatch_order_item_lots (order_item_id);

create table if not exists public.fms_dispatch_round_item_lots (
  id            uuid primary key default gen_random_uuid(),
  round_item_id uuid not null references public.fms_dispatch_round_items on delete cascade,
  lot_no        text not null,
  qty           numeric(14,3) check (qty is null or qty >= 0),
  seq           integer not null,
  created_at    timestamptz not null default now(),
  unique (round_item_id, seq)
);

comment on table public.fms_dispatch_round_item_lots is
  'OD-15 · which lots one round actually drew on for one line, and how much from each. Frozen at archive time. Empty for every line dispatched before OD-15 shipped — those carry their lot as text on fms_dispatch_round_items.lot_no and are never parsed.';

create index if not exists fms_dispatch_round_item_lots_item_idx
  on public.fms_dispatch_round_item_lots (round_item_id);

-- ---------------------------------------------------------------------------
-- 2 · RLS — copied from the parents, hoisted form included
--
-- ⚠ `to authenticated` IS LOAD-BEARING. anon holds the table grants (Supabase
--   default, and the parents are the same), so the policy is the only gate.
--
-- ⚠ THE ADMIN PREDICATE IS WRITTEN HOISTED — (select public.is_admin((select
--   auth.uid()))). Retyping it from pg_policies un-hoists it, and that cost this
--   module 15ms -> 1.4s the last time it happened.
--
-- Visibility is inherited transitively, exactly as round_items -> rounds ->
-- orders already does: the real predicate is stated once, on the order.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.fms_dispatch_order_item_lots to anon, authenticated;
grant select, insert, update, delete on public.fms_dispatch_round_item_lots to anon, authenticated;

alter table public.fms_dispatch_order_item_lots enable row level security;
alter table public.fms_dispatch_round_item_lots enable row level security;

drop policy if exists fms_dispatch_order_item_lots_select on public.fms_dispatch_order_item_lots;
create policy fms_dispatch_order_item_lots_select
  on public.fms_dispatch_order_item_lots
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fms_dispatch_order_items li
       where li.id = fms_dispatch_order_item_lots.order_item_id
    )
  );

drop policy if exists fms_dispatch_order_item_lots_write_admin on public.fms_dispatch_order_item_lots;
create policy fms_dispatch_order_item_lots_write_admin
  on public.fms_dispatch_order_item_lots for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_dispatch_round_item_lots_select on public.fms_dispatch_round_item_lots;
create policy fms_dispatch_round_item_lots_select
  on public.fms_dispatch_round_item_lots
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fms_dispatch_round_items ri
       where ri.id = fms_dispatch_round_item_lots.round_item_id
    )
  );

drop policy if exists fms_dispatch_round_item_lots_write_admin on public.fms_dispatch_round_item_lots;
create policy fms_dispatch_round_item_lots_write_admin
  on public.fms_dispatch_round_item_lots for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- 3 · The parent-touch triggers, so a lot edit reaches the incremental fetch
--
-- The function gains two arms. The existing two are untouched, verbatim from
-- pg_proc.prosrc.
--
-- ⚠ THE DELETE ARMS RESOLVE THE ORDER THROUGH THE PARENT ROW, so they find
--   nothing once the parent has already gone in a cascade — the same caveat
--   20260926120000 records for round_items, and harmless for the same reason:
--   the parent's own trigger has already touched the order.
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_touch_parent_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- tg_argv[0] names how the changed rows reach an order:
  --   'order_id'      — the transition rows carry it directly (order_items, rounds)
  --   'order_item_id' — one hop through fms_dispatch_order_items (OD-15 lots)
  --   'round_item_id' — two hops, round_items then rounds (OD-15 lots)
  --   'round_id'      — one hop through fms_dispatch_rounds (round_items)
  if tg_argv[0] = 'order_id' then
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (select distinct a.order_id as oid from affected a where a.order_id is not null) x
     where o.id = x.oid;
  elsif tg_argv[0] = 'order_item_id' then
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (
        select distinct li.order_id as oid
          from affected a
          join public.fms_dispatch_order_items li on li.id = a.order_item_id
      ) x
     where o.id = x.oid;
  elsif tg_argv[0] = 'round_item_id' then
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (
        select distinct r.order_id as oid
          from affected a
          join public.fms_dispatch_round_items ri on ri.id = a.round_item_id
          join public.fms_dispatch_rounds r on r.id = ri.round_id
      ) x
     where o.id = x.oid;
  else
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (
        select distinct r.order_id as oid
          from affected a
          join public.fms_dispatch_rounds r on r.id = a.round_id
      ) x
     where o.id = x.oid;
  end if;
  return null;
end
$function$;

drop trigger if exists trg_dispatch_order_item_lots_touch_ins on public.fms_dispatch_order_item_lots;
create trigger trg_dispatch_order_item_lots_touch_ins
  after insert on public.fms_dispatch_order_item_lots
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_item_id');

drop trigger if exists trg_dispatch_order_item_lots_touch_upd on public.fms_dispatch_order_item_lots;
create trigger trg_dispatch_order_item_lots_touch_upd
  after update on public.fms_dispatch_order_item_lots
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_item_id');

drop trigger if exists trg_dispatch_order_item_lots_touch_del on public.fms_dispatch_order_item_lots;
create trigger trg_dispatch_order_item_lots_touch_del
  after delete on public.fms_dispatch_order_item_lots
  referencing old table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_item_id');

drop trigger if exists trg_dispatch_round_item_lots_touch_ins on public.fms_dispatch_round_item_lots;
create trigger trg_dispatch_round_item_lots_touch_ins
  after insert on public.fms_dispatch_round_item_lots
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('round_item_id');

drop trigger if exists trg_dispatch_round_item_lots_touch_upd on public.fms_dispatch_round_item_lots;
create trigger trg_dispatch_round_item_lots_touch_upd
  after update on public.fms_dispatch_round_item_lots
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('round_item_id');

drop trigger if exists trg_dispatch_round_item_lots_touch_del on public.fms_dispatch_round_item_lots;
create trigger trg_dispatch_round_item_lots_touch_del
  after delete on public.fms_dispatch_round_item_lots
  referencing old table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('round_item_id');

-- ---------------------------------------------------------------------------
-- 4 · Normalise, and the ONE house format
--
-- ⚠ A TYPED QUANTITY THAT IS NOT A NUMBER BECOMES NULL RATHER THAN AN ERROR.
--   The quantity box is a free text input, and this module's standing rule is
--   that a paper figure never stops a dispatch. 'abc' is recorded as "a lot with
--   no quantity", which is exactly what it is. A negative goes the same way, so
--   the CHECK above can never be tripped from the payload.
--
-- ⚠ THE SINGLE-LOT RULE IS WHY 4,354 ROWS STAY BYTE-IDENTICAL. One lot covering
--   the whole line renders as the bare lot number — no brackets, no quantity —
--   so an ordinary dispatch reads exactly as it did before OD-15, and so do the
--   26 print-head serial rows, whose slashes make them one lot as far as this is
--   concerned.
--
-- ⚠⚠ THE NUMBER MASK IS FM999999990.999, NOT THE FM999999990.### THIS
--    MODULE USES EVERYWHERE ELSE, AND THE DIFFERENCE IS NOT COSMETIC.
--
--    '#' IS NOT A DIGIT PLACEHOLDER in a to_char numeric template. Postgres
--    recognises 9 and 0; '#' is not one, so 'FM999999990.###' names NO
--    fractional digits and rounds to a whole number. Measured on this database:
--
--      to_char(0.5,  'FM999999990.###')  ->  '1'
--      to_char(1.25, 'FM999999990.###')  ->  '1'
--      to_char(0.5,  'FM999999990.999')  ->  '0.5'
--
--    qty is numeric(14,3) and half a kilogram is a real draw, so the ### mask
--    would have written a WRONG QUANTITY into lot_no -- a column six readers
--    render and the Order Register exports. The rtrim drops the lone trailing
--    point that FM leaves on a whole number ('1500.' -> '1500').
--
--    ⚠ THE FIVE OTHER ### MASKS IN THIS FILE ARE LEFT EXACTLY AS THEY WERE.
--      They are pre-existing exception messages, copied verbatim from the live
--      bodies. They have the same rounding flaw and it is not this change's to
--      fix -- an error message saying 1 where it meant 0.5 is a different
--      decision, on a different day, with the client in the room.
--
-- ⚠ STABLE, NOT IMMUTABLE. to_char(numeric, text) depends on lc_numeric.
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_lots_normalise(p_lots jsonb)
returns jsonb
language sql
stable
set search_path to 'public'
as $fn$
  select coalesce(
    jsonb_agg(jsonb_build_object('lot_no', lot_no, 'qty', qty, 'seq', seq) order by seq),
    '[]'::jsonb)
  from (
    select lot_no, qty, row_number() over (order by ord) as seq
      from (
        -- One row per lot number, keeping the FIRST occurrence: a lot repeated
        -- on one line is a slip, and silently summing two entries would invent
        -- an allocation nobody typed.
        select distinct on (lower(trim(l->>'lot_no')))
               trim(l->>'lot_no') as lot_no,
               case when (l->>'qty') ~ '^\s*\d+(\.\d+)?\s*$'
                    then (trim(l->>'qty'))::numeric else null end as qty,
               ord
          from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) with ordinality as t(l, ord)
         where coalesce(trim(l->>'lot_no'), '') <> ''
         order by lower(trim(l->>'lot_no')), ord
      ) d
     order by ord
  ) s;
$fn$;

comment on function public.fms_dispatch_lots_normalise(jsonb) is
  'OD-15 · trims a lots payload, drops blanks, de-duplicates on the lot number keeping the first, and numbers seq from 1. Used by apply_ship_lines and amend_round so both doors agree.';

create or replace function public.fms_dispatch_lot_text(p_lots jsonb, p_qty numeric)
returns text
language sql
stable
set search_path to 'public'
as $fn$
  with r as (
    select trim(l->>'lot_no') as lot_no,
           nullif(l->>'qty', '')::numeric as qty,
           ord
      from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) with ordinality as t(l, ord)
     where coalesce(trim(l->>'lot_no'), '') <> ''
  )
  select case
    when (select count(*) from r) = 0 then null
    -- One lot covering the line: the bare number, exactly as it has always read.
    when (select count(*) from r) = 1
     and coalesce((select qty from r), p_qty) is not distinct from p_qty
      then (select lot_no from r)
    else (
      select string_agg(
               lot_no || case when qty is null then ''
                              else ' (' || rtrim(trim(to_char(qty, 'FM999999990.999')), '.') || ')' end,
               ', ' order by ord)
        from r)
  end;
$fn$;

comment on function public.fms_dispatch_lot_text(jsonb, numeric) is
  'OD-15 · the ONE house format for a lot allocation, rendered into fms_dispatch_order_items.lot_no and fms_dispatch_round_items.lot_no. One lot covering the line gives the bare number so historic rows and the single-lot majority are unchanged; two or more give "26081298 (975), 26081284 (485)". Change the Order Register column HERE and nowhere else.';

-- ---------------------------------------------------------------------------
-- 5 · fms_dispatch_apply_ship_lines — live body + the OD-15 arms
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_apply_ship_lines(p_order uuid, p_lines jsonb)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  l jsonb; v_id uuid; v_qty numeric; v_pending numeric; v_item text; v_total numeric := 0;
  v_ceiling numeric; v_done numeric; v_allow numeric;
  v_lots jsonb;
begin
  -- A payload carrying NO line data must return before the blanket clear below.
  -- The credit ceiling is not applied on this path either: nothing changed, so
  -- an order already over its ceiling (only reachable by a coordinator's
  -- correction) must not become unsaveable for a remark.
  --
  -- ⚠ OD-15: THE LOT CHILDREN MUST NOT BE CLEARED HERE EITHER. A remarks-only
  --   save would otherwise empty the split while leaving ship_qty standing.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    select coalesce(sum(ship_qty), 0) into v_total
      from public.fms_dispatch_order_items where order_id = p_order;
    return v_total;
  end if;

  -- A line ABSENT from the payload is a line NOT going out this round. Clearing
  -- first is what makes that expressible at all -- and OD-15's children are part
  -- of what gets cleared, for exactly the same reason.
  delete from public.fms_dispatch_order_item_lots
   where order_item_id in (
     select id from public.fms_dispatch_order_items where order_id = p_order);

  update public.fms_dispatch_order_items
     set ship_qty = null, lot_no = null
   where order_id = p_order;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_id := nullif(l->>'id','')::uuid;
    if v_id is null then continue; end if;
    v_qty := coalesce(nullif(l->>'ship_qty','')::numeric, 0);
    if v_qty <= 0 then continue; end if;

    select greatest(li.quantity - li.dispatched_qty, 0), coalesce(it.name, 'this item')
      into v_pending, v_item
      from public.fms_dispatch_order_items li
      left join public.mst_items it on it.id = li.item_id
     where li.id = v_id and li.order_id = p_order;

    if v_pending is null then continue; end if;
    if v_qty > v_pending then
      raise exception 'Cannot send % of %: only % is still pending on that line',
        trim(to_char(v_qty, 'FM999999990.###')), v_item, trim(to_char(v_pending, 'FM999999990.###'));
    end if;

    -- OD-15 · 'lots' when the client sends it, otherwise the flat lot_no read as
    -- a single lot. The fallback is what keeps a browser tab loaded before this
    -- deploy working, and it is also the path every pre-OD-15 payload takes.
    if jsonb_typeof(l->'lots') = 'array' then
      v_lots := public.fms_dispatch_lots_normalise(l->'lots');
    elsif coalesce(trim(l->>'lot_no'), '') <> '' then
      v_lots := public.fms_dispatch_lots_normalise(
                  jsonb_build_array(jsonb_build_object('lot_no', trim(l->>'lot_no'))));
    else
      v_lots := '[]'::jsonb;
    end if;

    -- ONE LOT MEANS 100% OF IT. The screen asks for no quantity in that case --
    -- the overwhelming majority of dispatches -- so the figure is filled in here
    -- rather than left blank, and the record says how much came from that lot.
    if jsonb_array_length(v_lots) = 1 and (v_lots->0->>'qty') is null then
      v_lots := jsonb_build_array(jsonb_set(v_lots->0, '{qty}', to_jsonb(v_qty)));
    end if;

    update public.fms_dispatch_order_items
       set ship_qty = v_qty,
           lot_no   = public.fms_dispatch_lot_text(v_lots, v_qty)
     where id = v_id and order_id = p_order;

    insert into public.fms_dispatch_order_item_lots (order_item_id, lot_no, qty, seq)
    select v_id, x->>'lot_no', nullif(x->>'qty','')::numeric, (x->>'seq')::integer
      from jsonb_array_elements(v_lots) x;

    v_total := v_total + v_qty;
  end loop;

  -- ⚠ NO EXCEPTION IS RAISED WHEN THE SPLIT DOES NOT SUM TO ship_qty, AND NONE
  --   WHEN A LOT IS DRAWN PAST ITS TALLY BALANCE. Both are warnings on the
  --   screen and both save. That is OD-12's rule, restated: the balance is
  --   Tally's paper trail, ~3.6% of lots do not resolve to a clean figure, and a
  --   reporting mirror must never stop a real dispatch. To make either a block,
  --   raise here -- and nowhere else.

  -- THE CREDIT CEILING. Order-level, because credit approves a quantity for the
  -- consignment and leaves the split across lines to whoever can see the stock.
  -- Checked after the loop for that reason - no single line can breach it, only
  -- the sum can. A null cc_approved_qty is UNCAPPED, not "zero approved".
  select o.cc_approved_qty into v_ceiling
    from public.fms_dispatch_orders o where o.id = p_order;

  if v_ceiling is not null then
    select coalesce(sum(li.dispatched_qty), 0) into v_done
      from public.fms_dispatch_order_items li where li.order_id = p_order;
    v_allow := greatest(v_ceiling - v_done, 0);

    if v_total > v_allow then
      raise exception 'Credit has authorised % on this order and % has already gone out, so only % may be sent. Reduce the quantities going out.',
        trim(to_char(v_ceiling, 'FM999999990.###')),
        trim(to_char(v_done, 'FM999999990.###')),
        trim(to_char(v_allow, 'FM999999990.###'));
    end if;
  end if;

  return v_total;
end
$fn$;

revoke all on function public.fms_dispatch_apply_ship_lines(uuid, jsonb) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 6 · fms_dispatch_archive_round — live body + the OD-15 copy and clear
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_archive_round(p_order uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_round_id uuid;
begin
  insert into public.fms_dispatch_rounds (
    order_id, round_no, round_started_at, company_id, location_id,
    cc_status, cc_approved_qty, cc_remarks, cc_at, cc_by,
    ms_actual_date, ms_tempo_no, ms_porter, ms_remarks, ms_at, ms_by,
    sb_actual_date, sb_invoice_no, sb_attachment_path, sb_attachment_name,
    sb_eway_path, sb_eway_name, sb_remarks, sb_at, sb_by,
    sb_hold_at, sb_hold_reason, sb_hold_by,
    gp_no,
    go_actual_date, go_outward_no, go_remarks, go_at, go_by,
    dc_actual_date, dc_status, dc_attachment_path, dc_attachment_name,
    dc_attachment_pages, dc_remarks, dc_at, dc_by,
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
    o.sb_actual_date, o.sb_invoice_no, o.sb_attachment_path, o.sb_attachment_name,
    o.sb_eway_path, o.sb_eway_name, o.sb_remarks, o.sb_at, o.sb_by,
    -- No round-ownership test, unlike the cc_ block: a hold belongs to the
    -- invoice this round did or did not raise, and the wipe below guarantees
    -- that whatever the header holds was set during THIS round.
    o.sb_hold_at, o.sb_hold_reason, o.sb_hold_by,
    -- Travels with the sb_ block, because it was issued for that invoice.
    o.gp_no,
    o.go_actual_date, o.go_outward_no, o.go_remarks, o.go_at, o.go_by,
    o.dc_actual_date, o.dc_status, o.dc_attachment_path, o.dc_attachment_name,
    o.dc_attachment_pages, o.dc_remarks, o.dc_at, o.dc_by,
    o.edited_at, o.edited_by, p_reason
  from public.fms_dispatch_orders o
  where o.id = p_order
  returning id into v_round_id;

  -- ⚠ THE FILTER STAYS ON ship_qty, NOT bill_qty. A line the store released but
  --   the biller did not invoice still physically left the building, and the
  --   round is the record of that. It archives with bill_qty = 0, so it settles
  --   nothing against the order and comes back as pending -- which is the point
  --   -- but it is not erased from the consignment's history.
  insert into public.fms_dispatch_round_items (
    round_id, order_item_id, line_no, item_id, item_name, unit_name,
    ordered_qty, ship_qty, bill_qty, lot_no)
  select
    v_round_id, li.id, li.line_no, li.item_id,
    -- ⚠ mst_items, THE LIVE MASTER. This read the frozen legacy master until
    --   2026-08-20 and therefore wrote 'Item' for every product dispatched
    --   after the Phase 1 cutover. See 20260921140000.
    coalesce(it.name, 'Item'), li.unit,
    li.quantity, li.ship_qty, li.bill_qty, li.lot_no
  from public.fms_dispatch_order_items li
  left join public.mst_items it on it.id = li.item_id
  where li.order_id = p_order and coalesce(li.ship_qty, 0) > 0
  order by li.line_no;

  -- OD-15 · FREEZE THE SPLIT ALONGSIDE THE LINE IT BELONGS TO.
  --
  -- ⚠ THIS MUST RUN BEFORE THE WIPE BELOW, which deletes the staging children.
  --   The join is on (round_id, order_item_id), which the round-items table
  --   already carries a UNIQUE index for, so one order line can only ever match
  --   the one round item just inserted for it.
  insert into public.fms_dispatch_round_item_lots (round_item_id, lot_no, qty, seq)
  select ri.id, ol.lot_no, ol.qty, ol.seq
    from public.fms_dispatch_order_item_lots ol
    join public.fms_dispatch_round_items ri
      on ri.round_id = v_round_id and ri.order_item_id = ol.order_item_id
   order by ri.id, ol.seq;

  -- WIPE.
  --
  -- ⚠ company_id AND location_id ARE BOTH DELIBERATELY ABSENT. Both are chosen
  --   once at intake and are true for every round of the order, so wiping either
  --   would blank it the instant a round closed - and the header, the queues, the
  --   register, the emails and the row-level security predicate all read them.
  --
  -- ⚠ THE cc_ BLOCK IS ABSENT for a third reason: whether the credit decision
  --   survives into the next round depends on whether any headroom is left, which
  --   only the caller has worked out.
  --
  -- ⚠ gp_no, THE sb_eway_ PAIR, THE sb_hold_ TRIO AND dc_attachment_pages ARE
  --   ALL PRESENT, which is the opposite of the two fields above and easy to get
  --   wrong by proximity. A new round raises a NEW invoice and is delivered
  --   against NEW paperwork.
  update public.fms_dispatch_orders set
    ms_actual_date = null, ms_tempo_no = null, ms_porter = null,
    ms_remarks = null, ms_at = null, ms_by = null,
    sb_actual_date = null, sb_invoice_no = null, sb_attachment_path = null,
    sb_attachment_name = null, sb_eway_path = null, sb_eway_name = null,
    sb_remarks = null, sb_at = null, sb_by = null,
    sb_hold_at = null, sb_hold_reason = null, sb_hold_by = null,
    gp_no = null,
    go_actual_date = null, go_outward_no = null, go_remarks = null, go_at = null, go_by = null,
    dc_actual_date = null, dc_status = null, dc_attachment_path = null,
    dc_attachment_name = null, dc_attachment_pages = null,
    dc_remarks = null, dc_at = null, dc_by = null,
    edited_at = null, edited_by = null
  where id = p_order;

  -- OD-15 · the children join ship_qty, bill_qty and lot_no in being cleared:
  -- they described THIS round, and they are now frozen on the round item.
  delete from public.fms_dispatch_order_item_lots
   where order_item_id in (
     select id from public.fms_dispatch_order_items where order_id = p_order);

  -- bill_qty joins ship_qty and lot_no: the next round raises its own invoice.
  update public.fms_dispatch_order_items
     set ship_qty = null, bill_qty = null, lot_no = null
   where order_id = p_order;

  return v_round_id;
end
$fn$;

revoke all on function public.fms_dispatch_archive_round(uuid, text) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 7 · fms_dispatch_amend_round — live body + the OD-15 presence contract
--
-- ⚠ THE PRESENCE CONTRACT IS THE WHOLE POINT OF THIS ARM, and it mirrors the
--   receiver-copy contract already in this function. 'lots' ABSENT keeps the
--   stored children and the stored summary untouched; 'lots' PRESENT replaces
--   both. Left writing a flat lot_no, the first correction would silently
--   flatten a split that was recorded correctly, and nobody would see it happen.
--
--   The old flat arm STAYS as the else branch, so a browser tab loaded before
--   this deploy still behaves exactly as it did.
-- ---------------------------------------------------------------------------

create or replace function public.fms_dispatch_amend_round(p_round uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_order uuid; v_no text; v_round integer; v_raiser uuid; v_status text; v_old text;
  v_uid uuid := auth.uid();
  v_dc text := nullif(trim(p->>'dc_status'), '');
  v_reason text := nullif(trim(p->>'amend_reason'), '');
  l jsonb; v_pending numeric; v_bad text; v_qty numeric;
  v_allow numeric; v_headroom numeric; v_to_credit boolean;
  v_doc_path text; v_doc_new boolean := p ? 'dc_attachment_path';
  v_lots jsonb;
begin
  select r.order_id, r.round_no, r.dc_status into v_order, v_round, v_old
    from public.fms_dispatch_rounds r where r.id = p_round for update;
  if v_order is null then raise exception 'That dispatch round was not found'; end if;
  if not public.fms_dispatch_is_coordinator(v_uid) then
    raise exception 'Only a coordinator or admin can correct a completed round';
  end if;
  if v_reason is null then raise exception 'A reason is required when correcting a round'; end if;

  select o.status, o.order_no, o.raised_by, o.cc_approved_qty
    into v_status, v_no, v_raiser, v_allow
    from public.fms_dispatch_orders o where o.id = v_order for update;
  if v_status = 'cancelled' then raise exception 'This order was cancelled - its rounds can no longer be corrected'; end if;
  if v_status = 'awaiting_sales_return' then
    raise exception 'This order is waiting on its sales return - record or withdraw that first';
  end if;
  if v_dc is not null and v_dc not in ('delivered','returned') then
    raise exception 'The outcome must be Delivered or Returned';
  end if;

  -- ⚠ THE PROOF CANNOT BE REMOVED, ONLY REPLACED. Same presence contract as
  --   everywhere else in this module: the key OMITTED keeps the stored document
  --   untouched, which is what a quantity-only correction sends. But a key that
  --   IS present and blank is not "clear it" here as it would be for an optional
  --   slot - a delivered round with no receiver copy is a delivery nobody can
  --   evidence, and record_dispatch_confirm refuses to create one.
  if v_doc_new and coalesce(trim(p->>'dc_attachment_path'), '') = '' then
    raise exception 'A round cannot be left without a receiver copy - attach the replacement before saving';
  end if;

  if p ? 'lines' and jsonb_typeof(p->'lines') = 'array' then
    for l in select * from jsonb_array_elements(p->'lines') loop
      if coalesce(trim(l->>'id'), '') = '' then continue; end if;
      v_qty := coalesce(nullif(l->>'bill_qty','')::numeric,
                        nullif(l->>'ship_qty','')::numeric, 0);
      if v_qty <= 0 then
        raise exception 'A corrected quantity must be greater than zero - remove the line instead';
      end if;

      -- OD-15 · null means "the payload said nothing about lots" — keep what is
      -- stored. An empty ARRAY is a real instruction and clears them.
      if jsonb_typeof(l->'lots') = 'array' then
        v_lots := public.fms_dispatch_lots_normalise(l->'lots');
        if jsonb_array_length(v_lots) = 1 and (v_lots->0->>'qty') is null then
          v_lots := jsonb_build_array(jsonb_set(v_lots->0, '{qty}', to_jsonb(v_qty)));
        end if;
      else
        v_lots := null;
      end if;

      update public.fms_dispatch_round_items
         set bill_qty = v_qty,
             lot_no   = case when v_lots is not null
                             -- Rendered against the CORRECTED quantity, so a
                             -- single lot cut from 100 to 90 still reads bare.
                             then public.fms_dispatch_lot_text(v_lots, v_qty)
                             else coalesce(nullif(trim(l->>'lot_no'), ''), lot_no) end
       where id = (l->>'id')::uuid and round_id = p_round;

      -- ⚠ ONLY AFTER THE GUARDED UPDATE MATCHED. The update carries
      --   `and round_id = p_round`; a bare delete on round_item_id would not,
      --   so a line id belonging to another round could have its lots rewritten.
      if found and v_lots is not null then
        delete from public.fms_dispatch_round_item_lots
         where round_item_id = (l->>'id')::uuid;
        insert into public.fms_dispatch_round_item_lots (round_item_id, lot_no, qty, seq)
        select (l->>'id')::uuid, x->>'lot_no', nullif(x->>'qty','')::numeric, (x->>'seq')::integer
          from jsonb_array_elements(v_lots) x;
      end if;
    end loop;
  end if;

  -- The primary this correction will leave behind - the new one when page one is
  -- being replaced, the stored one when only the extra pages are. It is what the
  -- normaliser must strip from the extra pages, or a replaced page one is stored
  -- twice: once as the primary and once as an extra.
  select case when v_doc_new then nullif(p->>'dc_attachment_path','') else r.dc_attachment_path end
    into v_doc_path from public.fms_dispatch_rounds r where r.id = p_round;

  update public.fms_dispatch_rounds set
    dc_status    = coalesce(v_dc, dc_status),
    dc_attachment_path  = case when p ? 'dc_attachment_path'  then nullif(p->>'dc_attachment_path','')  else dc_attachment_path  end,
    dc_attachment_name  = case when p ? 'dc_attachment_name'  then nullif(p->>'dc_attachment_name','')  else dc_attachment_name  end,
    dc_attachment_pages = case when p ? 'dc_attachment_pages'
                               then public.fms_dispatch_doc_pages(p->'dc_attachment_pages', v_doc_path)
                               else dc_attachment_pages end,
    amended_at   = now(), amended_by = v_uid, amend_reason = v_reason
  where id = p_round;

  -- Catch an over-delivery BEFORE the recalculation trips the table CHECK and
  -- surfaces as a constraint name nobody can read.
  select string_agg(it.name, ', ') into v_bad
    from public.fms_dispatch_order_items li
    left join public.fms_dispatch_items it on it.id = li.item_id
   where li.order_id = v_order
     and coalesce((select sum(coalesce(ri.bill_qty, ri.ship_qty)) from public.fms_dispatch_round_items ri
                   join public.fms_dispatch_rounds r on r.id = ri.round_id
                  where ri.order_item_id = li.id and r.order_id = v_order and r.dc_status = 'delivered'), 0)
         > li.quantity;
  if v_bad is not null then
    raise exception 'That correction would deliver more than was ordered on: %', v_bad;
  end if;

  perform public.fms_dispatch_recalc_dispatched(v_order);

  -- A correction that leaves something owing must re-open a closed order,
  -- otherwise the balance has nowhere to go.
  select coalesce(sum(greatest(quantity - dispatched_qty, 0)), 0),
         case when v_allow is null then null else v_allow - coalesce(sum(dispatched_qty), 0) end
    into v_pending, v_headroom
    from public.fms_dispatch_order_items where order_id = v_order;

  v_to_credit := (v_headroom is not null and v_headroom <= 0);

  if v_status = 'closed' and v_pending > 0 then
    update public.fms_dispatch_orders set
      round_no = round_no + 1, round_started_at = now(),
      status       = case when v_to_credit then 'awaiting_credit_check' else 'awaiting_material_status' end,
      current_step = case when v_to_credit then 'credit_check'          else 'material_status'          end,
      -- The same reset as the dispatch-confirm loop, for the same reason: the
      -- balance is unapproved, so the decision must be made again. Only the
      -- cumulative ceiling survives.
      cc_status     = case when v_to_credit then null else cc_status     end,
      cc_remarks    = case when v_to_credit then null else cc_remarks    end,
      cc_round_no   = case when v_to_credit then null else cc_round_no   end,
      cc_at         = case when v_to_credit then null else cc_at         end,
      cc_by         = case when v_to_credit then null else cc_by         end,
      cc_decided_at = case when v_to_credit then null else cc_decided_at end,
      cc_decided_by = case when v_to_credit then null else cc_decided_by end,
      cc_edited_at  = case when v_to_credit then null else cc_edited_at  end,
      cc_edited_by  = case when v_to_credit then null else cc_edited_by  end,
      closed_at = null
    where id = v_order;
    update public.fms_dispatch_rounds set archived_reason = 'looped'
      where id = p_round and archived_reason = 'closed';
  end if;

  -- ⚠ THE DOCUMENT SWAP IS ANNOUNCED. A correction that only replaces the
  --   receiver copy changes no quantity and no outcome, so without this clause
  --   the notification would read as though nothing happened and the swap would
  --   be invisible to everyone downstream.
  perform public.fms_dispatch_announce(
    'order', v_order, 'round_amended',
    'Round ' || v_round || ' of ' || coalesce(v_no,'an order') || ' was corrected'
      || case when v_dc is not null and v_dc is distinct from v_old
              then ' (' || v_old || ' -> ' || v_dc || ')' else '' end
      || case when v_doc_new then ' (receiver copy replaced)' else '' end
      || ': ' || v_reason
      || case when v_status = 'closed' and v_pending > 0
              then ' The order has re-opened with ' || trim(to_char(v_pending,'FM999999990.###'))
                   || ' still pending'
                   || case when v_to_credit then ', awaiting a fresh credit decision.' else '.' end
              else '' end,
    case when v_status = 'closed' and v_pending > 0
         then public.fms_dispatch_step_owner_ids(case when v_to_credit then 'credit_check' else 'material_status' end)
              || array_remove(array[v_raiser], null)
         else array_remove(array[v_raiser], null) end,
    jsonb_build_object('order_no', v_no, 'round_no', v_round, 'reason', v_reason)
  );
end
$fn$;

grant execute on function public.fms_dispatch_amend_round(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8 · ASSERTIONS — refuse rather than half-apply
-- ---------------------------------------------------------------------------

do $check$
declare v int; v_txt text;
begin
  -- The two tables, with RLS on.
  select count(*) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('fms_dispatch_order_item_lots','fms_dispatch_round_item_lots')
     and c.relrowsecurity;
  if v <> 2 then
    raise exception 'CHECK FAILED: expected 2 lot tables with RLS enabled, found %.', v;
  end if;

  -- Four policies, all scoped to authenticated and none to public.
  select count(*) into v from pg_policies
   where tablename in ('fms_dispatch_order_item_lots','fms_dispatch_round_item_lots');
  if v <> 4 then
    raise exception 'CHECK FAILED: expected 4 policies on the lot tables, found %.', v;
  end if;
  select count(*) into v from pg_policies
   where tablename in ('fms_dispatch_order_item_lots','fms_dispatch_round_item_lots')
     and roles::text not like '%authenticated%';
  if v <> 0 then
    raise exception 'CHECK FAILED: % lot-table policies are not scoped to authenticated.', v;
  end if;

  -- Six parent-touch triggers, or the incremental fetch cannot be trusted.
  select count(*) into v
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and c.relname in ('fms_dispatch_order_item_lots','fms_dispatch_round_item_lots')
     and t.tgname like 'trg_dispatch_%_touch_%';
  if v <> 6 then
    raise exception 'CHECK FAILED: expected 6 parent-touch triggers on the lot tables, found %.', v;
  end if;

  -- The touch function grew its two arms and kept the old two.
  select p.prosrc into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_touch_parent_order';
  if v_txt not like '%order_item_id%' or v_txt not like '%round_item_id%'
     or v_txt not like '%a.order_id%' or v_txt not like '%a.round_id%' then
    raise exception 'CHECK FAILED: fms_dispatch_touch_parent_order does not carry all four arms.';
  end if;

  -- All three writers go through the one house format.
  for v_txt in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fms_dispatch_apply_ship_lines','fms_dispatch_amend_round')
       and p.prosrc not like '%fms_dispatch_lot_text%'
  loop
    raise exception 'CHECK FAILED: % does not render lot_no through fms_dispatch_lot_text.', v_txt;
  end loop;

  select p.prosrc into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_archive_round';
  if v_txt not like '%fms_dispatch_round_item_lots%' then
    raise exception 'CHECK FAILED: fms_dispatch_archive_round does not freeze the lot children.';
  end if;

  -- ⚠ THE DRIFT GUARD. If either of these is missing, the body above was built
  --   from the stale migration file rather than from the live function, and the
  --   bill-quantity feature has just been reverted on live dispatch records.
  if v_txt not like '%li.bill_qty%' or v_txt not like '%mst_items%' then
    raise exception 'CHECK FAILED: archive_round lost bill_qty or mst_items - it was rebuilt from the stale file.';
  end if;
  select p.prosrc into v_txt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_amend_round';
  if v_txt not like '%bill_qty = v_qty%' then
    raise exception 'CHECK FAILED: amend_round lost its bill_qty write - it was rebuilt from the stale file.';
  end if;

  -- Nothing is backfilled -- this migration carries no INSERT into either table
  -- outside the three functions, and the 92 historic values stay as text. The
  -- count is REPORTED rather than asserted at zero on purpose: the documented
  -- recovery path is rollback -> fix -> re-apply, and by then real splits exist.
  -- A first application prints 0 / 0.
  raise notice 'OD-15 lot rows now: staging=%, frozen=%',
    (select count(*) from public.fms_dispatch_order_item_lots),
    (select count(*) from public.fms_dispatch_round_item_lots);
end $check$;

commit;
