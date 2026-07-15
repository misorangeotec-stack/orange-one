-- ===========================================================================
-- Import Purchase FMS — seed the shared masters from the domestic Purchase FMS.
--
-- Import buys the same companies / categories / item groups / items as domestic;
-- only the vendors (foreign) and the vendor-item price catalogue are import-
-- specific and are entered fresh. This one-time copy saves re-keying the whole
-- item hierarchy. IDs are preserved so the category → group → item FK chain
-- stays intact across the two table families.
--
-- Idempotent (ON CONFLICT DO NOTHING) — safe to re-run after the domestic
-- masters change to pull in new rows. Never deletes or overwrites an import row.
-- Order respects FKs: categories → item_groups → items; companies independent.
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
