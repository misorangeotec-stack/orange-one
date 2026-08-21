-- ===========================================================================
-- A dispatch order's updated_at now moves when its CHILDREN move.
--
-- WHY
--   The client is about to stop re-downloading the whole module after every
--   save and ask "what changed since I last looked?" instead. That question can
--   only be asked of the ORDER: fms_dispatch_rounds has no timestamp column at
--   all — no created_at, no updated_at — and round_items has only created_at, so
--   neither can answer it for itself.
--
-- ⚠ AND THE ORDER CANNOT ANSWER IT EITHER, TODAY. Measured before writing this:
--   447 rows of fms_dispatch_order_items are NEWER than their parent order's
--   updated_at. The step RPCs update the order, but the helpers that rewrite its
--   children — fms_dispatch_replace_lines, fms_dispatch_apply_ship_lines,
--   fms_dispatch_recalc_dispatched — do not always touch the order row on the
--   way past. A delta built on that assumption would silently miss line edits
--   and show stale quantities in a queue.
--
--   So this stops assuming the invariant and enforces it.
--
-- WHAT THIS DOES
--   One trigger function, wired to fms_dispatch_order_items, fms_dispatch_rounds
--   and fms_dispatch_round_items: whenever child rows are inserted, updated or
--   deleted, the parent order's updated_at is bumped to now(). Nothing else
--   changes — no column, no table, no row of business data. `updated_at` is not
--   read or displayed anywhere in the app (checked), so this is invisible.
--
-- ⚠ STATEMENT-LEVEL, NOT ROW-LEVEL, and that is the point of the transition
--   tables. fms_dispatch_replace_lines DELETEs every line of an order and
--   re-INSERTs them; a FOR EACH ROW trigger would update the same order row once
--   per line, twice over. FOR EACH STATEMENT collapses that to one UPDATE per
--   statement no matter how many lines moved.
--
-- ⚠ NINE TRIGGERS, NOT THREE, AND POSTGRES LEAVES NO CHOICE. A trigger carrying
--   transition tables may name only ONE event, so INSERT / UPDATE / DELETE each
--   need their own. They all share one function: each trigger names its
--   transition table `affected`, so the function reads the same relation
--   whichever way it was called (NEW TABLE for insert/update, OLD TABLE for
--   delete).
--
-- ⚠ NO RECURSION. Updating fms_dispatch_orders fires only that table's own
--   BEFORE UPDATE set_updated_at trigger, which touches no child table.
-- ===========================================================================

create or replace function public.fms_dispatch_touch_parent_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- tg_argv[0] names how the changed rows reach an order:
  --   'order_id' — the transition rows carry it directly (order_items, rounds)
  --   'round_id' — one hop through fms_dispatch_rounds (round_items)
  if tg_argv[0] = 'order_id' then
    update public.fms_dispatch_orders o
       set updated_at = now()
      from (select distinct a.order_id as oid from affected a where a.order_id is not null) x
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

comment on function public.fms_dispatch_touch_parent_order() is
  'Bumps a dispatch order''s updated_at when its lines / rounds / round items change, so an incremental "what changed since?" fetch can be keyed on the order alone. See 20260926120000.';

-- ---------------------------------------------------------------------------
-- fms_dispatch_order_items → order_id
-- ---------------------------------------------------------------------------
drop trigger if exists trg_dispatch_order_items_touch_ins on public.fms_dispatch_order_items;
create trigger trg_dispatch_order_items_touch_ins
  after insert on public.fms_dispatch_order_items
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_id');

drop trigger if exists trg_dispatch_order_items_touch_upd on public.fms_dispatch_order_items;
create trigger trg_dispatch_order_items_touch_upd
  after update on public.fms_dispatch_order_items
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_id');

drop trigger if exists trg_dispatch_order_items_touch_del on public.fms_dispatch_order_items;
create trigger trg_dispatch_order_items_touch_del
  after delete on public.fms_dispatch_order_items
  referencing old table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_id');

-- ---------------------------------------------------------------------------
-- fms_dispatch_rounds → order_id
-- ---------------------------------------------------------------------------
drop trigger if exists trg_dispatch_rounds_touch_ins on public.fms_dispatch_rounds;
create trigger trg_dispatch_rounds_touch_ins
  after insert on public.fms_dispatch_rounds
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_id');

drop trigger if exists trg_dispatch_rounds_touch_upd on public.fms_dispatch_rounds;
create trigger trg_dispatch_rounds_touch_upd
  after update on public.fms_dispatch_rounds
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_id');

drop trigger if exists trg_dispatch_rounds_touch_del on public.fms_dispatch_rounds;
create trigger trg_dispatch_rounds_touch_del
  after delete on public.fms_dispatch_rounds
  referencing old table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('order_id');

-- ---------------------------------------------------------------------------
-- fms_dispatch_round_items → round_id → order_id
--
-- ⚠ The DELETE arm resolves the round from fms_dispatch_rounds, so it finds
--   nothing if the round itself has already gone. Rounds are archived
--   (archived_at), never deleted, so that path does not arise today — and if it
--   ever does, the rounds trigger above has already touched the order.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_dispatch_round_items_touch_ins on public.fms_dispatch_round_items;
create trigger trg_dispatch_round_items_touch_ins
  after insert on public.fms_dispatch_round_items
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('round_id');

drop trigger if exists trg_dispatch_round_items_touch_upd on public.fms_dispatch_round_items;
create trigger trg_dispatch_round_items_touch_upd
  after update on public.fms_dispatch_round_items
  referencing new table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('round_id');

drop trigger if exists trg_dispatch_round_items_touch_del on public.fms_dispatch_round_items;
create trigger trg_dispatch_round_items_touch_del
  after delete on public.fms_dispatch_round_items
  referencing old table as affected
  for each statement execute function public.fms_dispatch_touch_parent_order('round_id');

-- ---------------------------------------------------------------------------
-- ASSERTION — nine triggers, or the delta cannot be trusted.
-- ---------------------------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and c.relname in ('fms_dispatch_order_items','fms_dispatch_rounds','fms_dispatch_round_items')
     and t.tgname like 'trg_dispatch_%_touch_%';
  if v_count <> 9 then
    raise exception 'REFUSING: expected 9 parent-touch triggers, found %.', v_count;
  end if;
end $$;

-- ===========================================================================
-- ROLLBACK — drop the nine triggers and the function. Nothing else to undo:
-- this migration writes no data and alters no structure.
--
-- --8<-- BEGIN ROLLBACK --8<--
-- drop trigger if exists trg_dispatch_order_items_touch_ins on public.fms_dispatch_order_items;
-- drop trigger if exists trg_dispatch_order_items_touch_upd on public.fms_dispatch_order_items;
-- drop trigger if exists trg_dispatch_order_items_touch_del on public.fms_dispatch_order_items;
-- drop trigger if exists trg_dispatch_rounds_touch_ins on public.fms_dispatch_rounds;
-- drop trigger if exists trg_dispatch_rounds_touch_upd on public.fms_dispatch_rounds;
-- drop trigger if exists trg_dispatch_rounds_touch_del on public.fms_dispatch_rounds;
-- drop trigger if exists trg_dispatch_round_items_touch_ins on public.fms_dispatch_round_items;
-- drop trigger if exists trg_dispatch_round_items_touch_upd on public.fms_dispatch_round_items;
-- drop trigger if exists trg_dispatch_round_items_touch_del on public.fms_dispatch_round_items;
-- drop function if exists public.fms_dispatch_touch_parent_order();
-- --8<-- END ROLLBACK --8<--
-- ===========================================================================
