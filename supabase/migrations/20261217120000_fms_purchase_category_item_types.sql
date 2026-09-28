-- ===========================================================================
-- Purchase categories learn which Tally item TYPES they cover.
--
-- WHY
--   Purchase is moving its items onto Central Masters (mst_items), which Tally
--   feeds. Until now a purchase item carried its own category_id, and picking a
--   category on a requisition line narrowed the item picker to that category.
--   A Tally stock item has no purchase category, so that link is lost in the
--   move - but it has an item_type (Ink, Heads, Spare Parts, Raw Material, ...)
--   filled from the Inventory Mapping sheet, and the two agree almost exactly.
--   Measured on 2026-09-10 against every purchase item that matches Tally:
--
--     INK              -> ink               181 of 181
--     PACKING MATERIAL -> packing_material  122 of 122
--     RAW MATERIAL     -> raw_material       57 of 63  (5 'other', 1 untyped)
--     SPARE PARTS      -> spare_parts        17 of 18
--     CARTRIDGE/FILTER -> cartage            21 of 21  ('cartage' is the sheet's
--                                                       word for cartridge)
--     FIXED ASSET      -> other               9 of 9
--     OTHERS PURCHASE  -> other               4 of 4
--
--   So a category now names the item types it covers, and the item picker
--   shows the requisition company's Tally items of those types. No list of
--   items is kept by hand.
--
-- WHAT DOES NOT CHANGE
--   qc_required. Whether goods go to QC after the Tally entry is still decided
--   by the line's category, exactly as before. This column only narrows a
--   picker; nothing on the server reads it except the master-request approval,
--   which uses it to type a brand-new item.
--
-- EMPTY MEANS "NO NARROWING". A category with no types offers every item in the
-- company's book - the right default for a new category nobody has set up yet,
-- and what Consumables gets today (it has no items to learn from).
--
-- Additive only: one new column with a default. The deployed frontend reads
-- categories with select * and simply ignores it.
--
-- Reversal: 20261217120001_fms_purchase_category_item_types_rollback.sql
-- ===========================================================================

alter table public.fms_purchase_categories
  add column if not exists item_types text[] not null default '{}';

comment on column public.fms_purchase_categories.item_types is
  'Tally item types (mst_items.item_type) this category offers on a requisition line. Empty = every item of the company. Narrows the picker only; QC is still qc_required.';

-- Seeded by NAME, case-insensitively, so the case-duplicate categories
-- (Head / HEAD, Machine / MACHINE, ...) both get the same answer.
update public.fms_purchase_categories c
   set item_types = s.types
  from (values
    ('INK',              array['ink', 'provision_ink', 'other_ink']),
    ('HEAD',             array['head']),
    ('MACHINE',          array['machine']),
    ('SPARE PARTS',      array['spare_parts']),
    ('RAW MATERIAL',     array['raw_material']),
    ('PACKING MATERIAL', array['packing_material']),
    ('CARTRIDGE/FILTER', array['cartage']),
    ('CARTRIDGE-FILTER', array['cartage']),
    ('FIXED ASSET',      array['other']),
    ('OTHERS PURCHASE',  array['other'])
  ) as s(name, types)
 where upper(trim(c.name)) = s.name
   and c.item_types = '{}';

do $check$
declare v_bad int;
begin
  -- Every seeded value must be a type mst_items can actually hold, or the
  -- picker would filter on a word no item carries and quietly show nothing.
  select count(*) into v_bad
    from public.fms_purchase_categories c, unnest(c.item_types) t
   where t not in ('ink','spare_parts','head','machine','other','paper','raw_material',
                   'packing_material','cartage','software','provision_ink','other_ink',
                   'service_expense');
  if v_bad > 0 then
    raise exception 'ABORT: % seeded item type(s) are not valid mst_items.item_type values', v_bad;
  end if;
end
$check$;
