-- ===========================================================================
-- Import Purchase FMS — seed the shared masters from the domestic Purchase FMS.
--
-- Import buys the same companies / categories / item groups / items as domestic;
-- only the vendors (foreign) and the vendor-item price catalogue are import-
-- specific and are entered fresh. This one-time copy saves re-keying the whole
-- item hierarchy. IDs are preserved so the category → group → item FK chain
-- stays intact across the two table families.
--
-- Idempotent (ON CONFLICT DO NOTHING) — never deletes or overwrites an import
-- row. Order respects FKs: categories → item_groups → items; companies
-- independent.
--
-- ⚠ SUPERSEDED 18-Jul-2026 — DO NOT RE-RUN THE CATEGORY/GROUP/ITEM INSERTS.
-- 20260718180000_reset_fms_import_masters_from_vendor_sheet.sql replaced this
-- clone with the real import catalogue from `Misc/Vendor wise item list.xlsx`
-- (2 categories, 14 item groups, 95 items). Re-running lines 25-40 below would
-- dump all ~431 domestic items straight back into that curated tree.
-- The COMPANIES insert is still safe — companies remain shared.
-- Left executable on purpose: it is the only way to restore the old clone if
-- the reset ever has to be rolled back. Nothing re-runs it automatically
-- (version already recorded in supabase_migrations, and there is no CI).
-- ===========================================================================

insert into public.fms_import_companies (id, name, location, active, sort_order, created_by, created_at)
select id, name, location, active, sort_order, created_by, created_at
from public.fms_purchase_companies
on conflict do nothing;

insert into public.fms_import_categories (id, name, active, sort_order, created_by, created_at)
select id, name, active, sort_order, created_by, created_at
from public.fms_purchase_categories
on conflict do nothing;

insert into public.fms_import_item_groups (id, category_id, name, active, sort_order, created_by, created_at)
select id, category_id, name, active, sort_order, created_by, created_at
from public.fms_purchase_item_groups
on conflict do nothing;

insert into public.fms_import_items (id, item_group_id, name, unit, active, sort_order, created_by, created_at)
select id, item_group_id, name, unit, active, sort_order, created_by, created_at
from public.fms_purchase_items
on conflict do nothing;
