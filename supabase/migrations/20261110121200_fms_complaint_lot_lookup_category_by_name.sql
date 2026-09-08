-- ===========================================================================
-- Complaint (RM/FG) FMS — INK CATEGORY BY NAME (Phase 10c).
--
-- 20261110120900 joined the ink category through `item_id`:
--
--   left join public.mst_items it on it.id = i.item_id
--
-- and item_id is filled only where the item name resolves UNAMBIGUOUSLY to one
-- `mst_items` row. That guard is correct for a foreign key and WRONG for the
-- category, because items are stored PER COMPANY BOOK:
--
--   'RI G6 REACTIVE INK PRO YELLOW'  ->  4 rows in mst_items
--                                        1 distinct category: 'REACTIVE INK'
--
-- So the guard skipped it, item_id stayed null, and the join yielded null —
-- leaving the source sheet's CATEGORY OF INK column blank on exactly the items
-- the module is mostly about. Measured after the first load: 8,058 of 31,852
-- index rows had an item_id.
--
-- THE FIX: resolve the category BY NAME, and only when every same-named active
-- item AGREES on it. Ambiguity about WHICH ROW is not ambiguity about WHAT THE
-- CATEGORY IS — four rows that all say 'REACTIVE INK' answer the question
-- perfectly well, while four rows that disagree must stay null and be typed.
--
-- ⚠ item_id KEEPS THE STRICT RULE. Pointing a complaint's FK at an arbitrary
--   company's item row would be a quiet lie in the analytics, and the form does
--   not need it: `item_name` is frozen onto the complaint anyway.
--
-- ⚠ STILL NOT mst_items.group_id. `category` is a PORTAL-owned column, 96 values
--   hand-maintained from the Inventory Mapping sheet; only 858 of 13k rows agree
--   with their own stock group, and just 40 of the 96 names are group names.
--
-- Reversal: re-apply the lookup definition from 20261110120900.
-- ===========================================================================

begin;

create or replace function public.fms_complaint_lot_lookup(p_lot text, p_direction text default null)
returns table (
  direction    text,
  voucher_no   text,
  voucher_date date,
  voucher_type text,
  party_name   text,
  party_id     uuid,
  item_name    text,
  item_id      uuid,
  category     text,
  ink_type     text,
  batch_name   text,
  godown       text,
  qty          text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.direction,
    i.voucher_no,
    i.voucher_date,
    i.voucher_type,
    i.party_name,
    i.party_id,
    i.item_name,
    i.item_id,
    cat.category,
    cat.ink_type,
    i.batch_name,
    i.godown,
    i.qty
  from public.fms_complaint_lot_index i
  -- Resolved by NAME, not by item_id — see the header. `min(...) filter` plus the
  -- count(distinct) check is "every same-named item agrees, so take it";
  -- disagreement yields null and the user types it.
  left join lateral (
    select
      case when count(distinct it.category) = 1 then min(it.category) end as category,
      case when count(distinct it.ink_type) = 1 then min(it.ink_type) end as ink_type
    from public.mst_items it
    where it.active
      and it.category is not null
      and lower(btrim(it.name)) = lower(btrim(i.item_name))
  ) cat on true
  where i.lot_key = btrim(coalesce(p_lot, ''))
    and (p_direction is null or i.direction = p_direction)
  order by i.voucher_date desc nulls last, i.voucher_no
  limit 100;   -- a lot on 581 lines is real; nobody picks from 581 rows
$$;

comment on function public.fms_complaint_lot_lookup(text, text) is
  'Every shipment a LOT was on, newest first, optionally narrowed to sales or purchase, with the ink category resolved live from mst_items BY NAME (only where every same-named item agrees). Returns a LIST — a lot number is not a unique key.';
grant execute on function public.fms_complaint_lot_lookup(text, text) to authenticated;

do $mig$
declare v_cat text;
begin
  -- The regression this migration exists to prevent: a well-known ink whose four
  -- company rows all agree must now resolve.
  select category into v_cat
    from public.fms_complaint_lot_lookup('26081377', 'sales') limit 1;
  if v_cat is null then
    raise exception 'Complaint: the ink category still does not resolve for a known lot';
  end if;
  raise notice 'Complaint: ink category resolves (%).', v_cat;
end $mig$;

commit;
