-- ===========================================================================
-- Import Purchase FMS — reset the master catalogue from the vendor-wise sheet.
--
-- The import masters were seeded in July as a verbatim clone of the DOMESTIC
-- purchase masters (20260716140000_seed_fms_import_masters_from_purchase.sql),
-- IDs and all. That clone was a placeholder: it carried categories import has
-- no use for (SPARE PARTS, PACKING MATERIAL, HEAD, CARTRIDGE/FILTER) and
-- casing-duplicate categories (RAW MATERIAL / Raw Material, MACHINE / Machine).
--
-- This migration replaces categories, item groups and items with the real
-- import catalogue from `Misc/Vendor wise item list.xlsx`, and — for the first
-- time — populates fms_import_vendor_item_prices, which is what makes an item
-- selectable for a vendor on a request (see NewRequest.tsx itemOptions).
--
-- KEPT: fms_import_companies (untouched).
-- The domestic fms_purchase_* tables are NOT touched — separate table family.
--
-- Rates land at 0 (no price list supplied yet); the buyer types the real rate
-- per request line. Units default to KGS. Re-runnable (ON CONFLICT DO NOTHING),
-- though the DELETE at the top means a re-run re-creates the tree from scratch.
-- ===========================================================================

begin;

-- --------------------------------------------------------------------------
-- 0. Preflight: this wipe is only safe while no document references a master.
--    Every FK below is ON DELETE RESTRICT, so a stray document would abort the
--    delete anyway — this just fails loudly with a readable message instead.
-- --------------------------------------------------------------------------
do $$
declare
  n_req  int; n_po int; n_qt int; n_grn int; n_pi int; n_pay int;
begin
  select count(*) into n_req  from public.fms_import_requests;
  select count(*) into n_po   from public.fms_import_pos;
  select count(*) into n_qt   from public.fms_import_quotations;
  select count(*) into n_grn  from public.fms_import_grns;
  select count(*) into n_pi   from public.fms_import_pis;
  select count(*) into n_pay  from public.fms_import_payments;
  if n_req + n_po + n_qt + n_grn + n_pi + n_pay > 0 then
    raise exception
      'Import FMS already has documents (requests=%, pos=%, quotations=%, grns=%, pis=%, payments=%) — a master wipe would destroy the catalogue they reference. Aborting.',
      n_req, n_po, n_qt, n_grn, n_pi, n_pay;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 1. Wipe the cloned tree. Deleting categories is enough: item_groups cascade
--    from categories, items cascade from item_groups, and vendor_item_prices
--    cascade from items. Companies and vendors are deliberately left alone.
-- --------------------------------------------------------------------------
delete from public.fms_import_categories;

-- --------------------------------------------------------------------------
-- 2. Vendors. The one existing row IS the sheet's LANYU under its full legal
--    name — rename it in place so its Yiwu address, GSTIN and USD currency
--    survive. The other three are new; address/contact to be filled in later.
-- --------------------------------------------------------------------------
update public.fms_import_vendors
   set name = 'LANYU', updated_at = now()
 where name = 'ZHEJIANG LANYU DIGITAL TECHNOLOGY';

insert into public.fms_import_vendors (name, gstin, default_currency, active) values
  ('HANGLORY', 'IMPORT', 'USD', true),
  ('MARKEM IMAGE', 'IMPORT', 'USD', true),
  ('INKBANK', 'IMPORT', 'USD', true)
on conflict (name) do nothing;

-- --------------------------------------------------------------------------
-- 3. Categories (sheet column "Item Group").
-- --------------------------------------------------------------------------
insert into public.fms_import_categories (name, active, sort_order) values
  ('INK', true, 1),
  ('RAW MATERIAL', true, 2)
on conflict (name) do nothing;

-- --------------------------------------------------------------------------
-- 4. Item groups (sheet column "Item Category"), resolved to their category
--    by name. Each group is sourced from exactly one vendor.
-- --------------------------------------------------------------------------
insert into public.fms_import_item_groups (category_id, name, active, sort_order)
select c.id, v.name, true, v.sort_order
from (values
  ('INK', 'H-SERIES', 1),
  ('INK', 'F-SERIES', 2),
  ('INK', 'KY DISPERSE', 3),
  ('INK', 'KY DISPERSE ULTRA', 4),
  ('INK', 'PIGMENT', 5),
  ('INK', 'DIGISTAR BIB', 6),
  ('INK', 'S3200', 7),
  ('INK', 'RICHO PIGMENT', 8),
  ('INK', 'MEDIUM DTF', 9),
  ('INK', 'PREMIUM DTF', 10),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 11),
  ('RAW MATERIAL', 'SLURRY', 12),
  ('RAW MATERIAL', 'REACTIVE POWDER', 13),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 14)
) as v(category, name, sort_order)
join public.fms_import_categories c on c.name = v.category
on conflict (category_id, name) do nothing;

-- --------------------------------------------------------------------------
-- 5. Items, resolved to their group via category+group name. Unit = KGS for
--    all of them (inks and raw materials are weight-based); correct any
--    exceptions individually in the Masters screen.
-- --------------------------------------------------------------------------
insert into public.fms_import_items (item_group_id, name, unit, active, sort_order)
select g.id, v.name, 'KGS', true, v.sort_order
from (values
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES H6K BLACK', 1),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES BLACK', 2),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES BLUE', 3),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES CYAN', 4),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES GREY', 5),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES MAGENTA', 6),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES ORANGE', 7),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES RED', 8),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES YELLOW', 9),
  ('INK', 'H-SERIES', 'REACTIVE INK H-SERIES LIGHT MAGENTA', 10),
  ('INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES BLACK', 1),
  ('INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES CYAN', 2),
  ('INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES MAGENTA', 3),
  ('INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES YELLOW', 4),
  ('INK', 'KY DISPERSE', 'KY DISPERSE INK BLACK PRO', 1),
  ('INK', 'KY DISPERSE', 'KY DISPERSE INK BLUE', 2),
  ('INK', 'KY DISPERSE', 'KY DISPERSE INK CYAN', 3),
  ('INK', 'KY DISPERSE', 'KY DISPERSE INK MAGENTA', 4),
  ('INK', 'KY DISPERSE', 'KY DISPERSE INK ORANGE', 5),
  ('INK', 'KY DISPERSE', 'KY DISPERSE INK YELLOW', 6),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA BLACK', 1),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA BLUE', 2),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA CYAN', 3),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA MAGENTA', 4),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA ORANGE', 5),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA YELLOW', 6),
  ('INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA RED', 7),
  ('INK', 'PIGMENT', 'PIGMENT INK BLACK', 1),
  ('INK', 'PIGMENT', 'PIGMENT INK BLUE', 2),
  ('INK', 'PIGMENT', 'PIGMENT INK CYAN', 3),
  ('INK', 'PIGMENT', 'PIGMENT INK GREEN', 4),
  ('INK', 'PIGMENT', 'PIGMENT INK GREY', 5),
  ('INK', 'PIGMENT', 'PIGMENT INK MAGENTA', 6),
  ('INK', 'PIGMENT', 'PIGMENT INK RED', 7),
  ('INK', 'PIGMENT', 'PIGMENT INK YELLOW', 8),
  ('INK', 'PIGMENT', 'PIGMENT INK ORANGE', 9),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB CYAN', 1),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB GREY', 2),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB MAGENTA', 3),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB ORANGE', 4),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB RED', 5),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB YELLOW', 6),
  ('INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB DEEP BLACK', 7),
  ('INK', 'S3200', 'SUBLIMATION INK BLACK-S3200', 1),
  ('INK', 'S3200', 'SUBLIMATION INK CYAN-S3200', 2),
  ('INK', 'S3200', 'SUBLIMATION INK MAGENTA-S3200', 3),
  ('INK', 'S3200', 'SUBLIMATION INK YELLOW-S3200', 4),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK BLACK', 1),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK BLUE', 2),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK CYAN', 3),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK GREEN', 4),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK GREY', 5),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK MAGENTA', 6),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK RED', 7),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK YELLOW', 8),
  ('INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK ORANGE', 9),
  ('INK', 'MEDIUM DTF', 'MEDIUM DTF INK BLACK', 1),
  ('INK', 'MEDIUM DTF', 'MEDIUM DTF INK CYAN', 2),
  ('INK', 'MEDIUM DTF', 'MEDIUM DTF INK MAGENTA', 3),
  ('INK', 'MEDIUM DTF', 'MEDIUM DTF INK WHITE', 4),
  ('INK', 'MEDIUM DTF', 'MEDIUM DTF INK YELLOW', 5),
  ('INK', 'PREMIUM DTF', 'PREMIUM DTF INK BLACK', 1),
  ('INK', 'PREMIUM DTF', 'PREMIUM DTF INK CYAN', 2),
  ('INK', 'PREMIUM DTF', 'PREMIUM DTF INK MAGENTA', 3),
  ('INK', 'PREMIUM DTF', 'PREMIUM DTF INK WHITE', 4),
  ('INK', 'PREMIUM DTF', 'PREMIUM DTF INK YELLOW', 5),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 1', 1),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 2', 2),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 3', 3),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 4', 4),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID C', 5),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID G', 6),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID F', 7),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID KY', 8),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID KY BLACK', 9),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID HD', 10),
  ('RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID SUPER HD', 11),
  ('RAW MATERIAL', 'SLURRY', 'KY SUBLIMATION BLACK SLURRY', 1),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE 49-AMT', 1),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE 49-LANYU', 2),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE PRO 15-LANYU', 3),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE 72-LANYU', 4),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE SLURRY BLUE 72-LANYU', 5),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLACK (VS)-LANYU', 6),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLACK MCT-LANYU', 7),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE CONCENTARTE BROWN 11 (BR)-LANYU', 8),
  ('RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE CONCENTRATE GREY-LANYU', 9),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD BLACK', 1),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD CYAN', 2),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD MAGENTA', 3),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD YELLOW', 4),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD BLACK', 5),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD CYAN', 6),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD MAGENTA', 7),
  ('RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD YELLOW', 8)
) as v(category, item_group, name, sort_order)
join public.fms_import_categories c on c.name = v.category
join public.fms_import_item_groups g on g.category_id = c.id and g.name = v.item_group
on conflict (item_group_id, name) do nothing;

-- --------------------------------------------------------------------------
-- 6. Vendor → item links. THIS is what the sheet uniquely contributes: without
--    a row here an item is invisible on a request for that vendor. Rate 0 is a
--    placeholder (0 passes both the client and RPC validation) — replace via
--    the Vendor-Item Price master once a real price list exists.
-- --------------------------------------------------------------------------
insert into public.fms_import_vendor_item_prices (vendor_id, item_id, currency, rate, active, sort_order)
select ven.id, i.id, 'USD', 0, true, v.sort_order
from (values
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES H6K BLACK', 1),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES BLACK', 2),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES BLUE', 3),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES CYAN', 4),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES GREY', 5),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES MAGENTA', 6),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES ORANGE', 7),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES RED', 8),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES YELLOW', 9),
  ('HANGLORY', 'INK', 'H-SERIES', 'REACTIVE INK H-SERIES LIGHT MAGENTA', 10),
  ('HANGLORY', 'INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES BLACK', 11),
  ('HANGLORY', 'INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES CYAN', 12),
  ('HANGLORY', 'INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES MAGENTA', 13),
  ('HANGLORY', 'INK', 'F-SERIES', 'SUBLIMATION INK F-SERIES YELLOW', 14),
  ('LANYU', 'INK', 'KY DISPERSE', 'KY DISPERSE INK BLACK PRO', 15),
  ('LANYU', 'INK', 'KY DISPERSE', 'KY DISPERSE INK BLUE', 16),
  ('LANYU', 'INK', 'KY DISPERSE', 'KY DISPERSE INK CYAN', 17),
  ('LANYU', 'INK', 'KY DISPERSE', 'KY DISPERSE INK MAGENTA', 18),
  ('LANYU', 'INK', 'KY DISPERSE', 'KY DISPERSE INK ORANGE', 19),
  ('LANYU', 'INK', 'KY DISPERSE', 'KY DISPERSE INK YELLOW', 20),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA BLACK', 21),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA BLUE', 22),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA CYAN', 23),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA MAGENTA', 24),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA ORANGE', 25),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA YELLOW', 26),
  ('LANYU', 'INK', 'KY DISPERSE ULTRA', 'KY DISPERSE INK ULTRA RED', 27),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK BLACK', 28),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK BLUE', 29),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK CYAN', 30),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK GREEN', 31),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK GREY', 32),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK MAGENTA', 33),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK RED', 34),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK YELLOW', 35),
  ('HANGLORY', 'INK', 'PIGMENT', 'PIGMENT INK ORANGE', 36),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB CYAN', 37),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB GREY', 38),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB MAGENTA', 39),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB ORANGE', 40),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB RED', 41),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB YELLOW', 42),
  ('MARKEM IMAGE', 'INK', 'DIGISTAR BIB', 'DIGISTAR BELLAGIO BIB DEEP BLACK', 43),
  ('LANYU', 'INK', 'S3200', 'SUBLIMATION INK BLACK-S3200', 44),
  ('LANYU', 'INK', 'S3200', 'SUBLIMATION INK CYAN-S3200', 45),
  ('LANYU', 'INK', 'S3200', 'SUBLIMATION INK MAGENTA-S3200', 46),
  ('LANYU', 'INK', 'S3200', 'SUBLIMATION INK YELLOW-S3200', 47),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK BLACK', 48),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK BLUE', 49),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK CYAN', 50),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK GREEN', 51),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK GREY', 52),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK MAGENTA', 53),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK RED', 54),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK YELLOW', 55),
  ('INKBANK', 'INK', 'RICHO PIGMENT', 'RICHO G5/G6 PIGMENT INK ORANGE', 56),
  ('INKBANK', 'INK', 'MEDIUM DTF', 'MEDIUM DTF INK BLACK', 57),
  ('INKBANK', 'INK', 'MEDIUM DTF', 'MEDIUM DTF INK CYAN', 58),
  ('INKBANK', 'INK', 'MEDIUM DTF', 'MEDIUM DTF INK MAGENTA', 59),
  ('INKBANK', 'INK', 'MEDIUM DTF', 'MEDIUM DTF INK WHITE', 60),
  ('INKBANK', 'INK', 'MEDIUM DTF', 'MEDIUM DTF INK YELLOW', 61),
  ('INKBANK', 'INK', 'PREMIUM DTF', 'PREMIUM DTF INK BLACK', 62),
  ('INKBANK', 'INK', 'PREMIUM DTF', 'PREMIUM DTF INK CYAN', 63),
  ('INKBANK', 'INK', 'PREMIUM DTF', 'PREMIUM DTF INK MAGENTA', 64),
  ('INKBANK', 'INK', 'PREMIUM DTF', 'PREMIUM DTF INK WHITE', 65),
  ('INKBANK', 'INK', 'PREMIUM DTF', 'PREMIUM DTF INK YELLOW', 66),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 1', 67),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 2', 68),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 3', 69),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID 4', 70),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID C', 71),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID G', 72),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID F', 73),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID KY', 74),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID KY BLACK', 75),
  ('LANYU', 'RAW MATERIAL', 'SLURRY', 'KY SUBLIMATION BLACK SLURRY', 76),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE 49-AMT', 77),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE 49-LANYU', 78),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE PRO 15-LANYU', 79),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLUE 72-LANYU', 80),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE SLURRY BLUE 72-LANYU', 81),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLACK (VS)-LANYU', 82),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE POWDER BLACK MCT-LANYU', 83),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE CONCENTARTE BROWN 11 (BR)-LANYU', 84),
  ('LANYU', 'RAW MATERIAL', 'REACTIVE POWDER', 'REACTIVE CONCENTRATE GREY-LANYU', 85),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID HD', 86),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD BLACK', 87),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD CYAN', 88),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD MAGENTA', 89),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION HD YELLOW', 90),
  ('LANYU', 'RAW MATERIAL', 'COMBINATION LIQUID', 'COMBINATION LIQUID SUPER HD', 91),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD BLACK', 92),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD CYAN', 93),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD MAGENTA', 94),
  ('LANYU', 'RAW MATERIAL', 'SUBLIMATION DISPERSION', 'SUBLIMATION DISPERSION SUPER HD YELLOW', 95)
) as v(vendor, category, item_group, item, sort_order)
join public.fms_import_vendors ven on ven.name = v.vendor
join public.fms_import_categories c on c.name = v.category
join public.fms_import_item_groups g on g.category_id = c.id and g.name = v.item_group
join public.fms_import_items i on i.item_group_id = g.id and i.name = v.item
on conflict (vendor_id, item_id) do nothing;

-- --------------------------------------------------------------------------
-- 7. Postflight: fail the transaction if the sheet did not land whole.
-- --------------------------------------------------------------------------
do $$
declare n_cat int; n_grp int; n_item int; n_ven int; n_price int; n_shared int;
begin
  select count(*) into n_cat   from public.fms_import_categories;
  select count(*) into n_grp   from public.fms_import_item_groups;
  select count(*) into n_item  from public.fms_import_items;
  select count(*) into n_ven   from public.fms_import_vendors;
  select count(*) into n_price from public.fms_import_vendor_item_prices;
  select count(*) into n_shared
    from public.fms_import_items i join public.fms_purchase_items p on p.id = i.id;
  if n_cat <> 2 or n_grp <> 14 or n_item <> 95 or n_ven <> 4 or n_price <> 95 then
    raise exception 'Import master reset landed wrong: categories=% (want 2), groups=% (want 14), items=% (want 95), vendors=% (want 4), prices=% (want 95)',
      n_cat, n_grp, n_item, n_ven, n_price;
  end if;
  if n_shared <> 0 then
    raise exception 'Import items still share % id(s) with domestic purchase items — the clone was not fully cleared', n_shared;
  end if;
end $$;

commit;
