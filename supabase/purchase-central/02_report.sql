-- ===========================================================================
-- PURCHASE CUTOVER - the human check.
--
-- Run inside the rehearsal, after private.purchase_central_cutover() and
-- BEFORE the rollback, so the private.pcm_* maps exist:
--
--     begin;
--       select private.purchase_central_cutover();
--       \i 02_report.sql
--       select private.purchase_central_rollback();
--     rollback;
--
-- Every row answers "did this old name land on the right Tally record?". The
-- matching is by name, so a person should read the vendor list end to end
-- before the real run - especially the tally_ledger and portal_created rows.
-- ===========================================================================

-- 1. VENDORS - one row per (old vendor, company book) a transaction names.
select cm.book_label                          as company,
       fv.name                                as old_vendor,
       mp.name                                as central_vendor,
       vm.how,                                -- tally_vendor | tally_ledger | portal_created
       mp.gstin                               as central_gstin,
       fv.gstin                               as old_gstin
  from private.pcm_vendor_map vm
  join public.fms_purchase_vendors fv on fv.id = vm.legacy_vendor_id
  join public.mst_parties mp on mp.id = vm.target_id
  join (select distinct book_id, book_label from private.pcm_company_map) cm on cm.book_id = vm.book_id
 order by vm.how desc, cm.book_label, fv.name;

-- 2. ITEMS - one row per (old item, company book) a requisition line names.
select cm.book_label                          as company,
       fi.name                                as old_item,
       mi.name                                as central_item,
       im.how,                                -- same_book | other_book | portal_created
       (select coalesce(mc.alias, mc.name) || ' — ' || coalesce(mc.location, '')
          from public.mst_companies mc where mc.id = mi.company_id) as item_filed_under,
       mi.item_type
  from private.pcm_item_map im
  join public.fms_purchase_items fi on fi.id = im.legacy_item_id
  join public.mst_items mi on mi.id = im.target_id
  join (select distinct book_id, book_label from private.pcm_company_map) cm on cm.book_id = im.book_id
 order by im.how desc, cm.book_label, fi.name;

-- 3. NOT CARRIED - old vendors no transaction ever named AND Tally has no
--    ledger of that name in any book. Add them in Central Masters if wanted.
select fv.name as old_vendor_not_carried, fv.gstin, fv.phone, fv.email
  from public.fms_purchase_vendors fv
 where not exists (select 1 from private.pcm_vendor_use vu where vu.legacy_vendor_id = fv.id)
   and not exists (select 1 from public.mst_parties mp
                    where regexp_replace(lower(mp.name), '[^a-z0-9]', '', 'g')
                        = regexp_replace(lower(fv.name), '[^a-z0-9]', '', 'g'))
 order by 1;

-- 4. NOT CARRIED - the same for items.
with keys as (select distinct regexp_replace(lower(trim(name)), '\s+', ' ', 'g') k from public.mst_items)
select fi.name as old_item_not_carried, fi.unit, c.name as old_category
  from public.fms_purchase_items fi
  left join public.fms_purchase_categories c on c.id = fi.category_id
 where not exists (select 1 from private.pcm_item_use iu where iu.legacy_item_id = fi.id)
   and regexp_replace(lower(trim(fi.name)), '\s+', ' ', 'g') not in (select k from keys)
 order by 1;
