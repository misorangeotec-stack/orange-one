-- Purchase FMS — demo MASTER data (Phase 1). Idempotent (ON CONFLICT DO NOTHING)
-- and fully removable via fms_purchase_demo_teardown.sql. Safe to re-run.
-- Applies to the identity project (coshondiqdhorwvibrwu). created_by left null.

-- Companies (buyer companies; name+location unique)
insert into public.fms_purchase_companies (name, location, sort_order) values
  ('Orange O Tec Enterprise', 'Surat', 1),
  ('Orange O-tec', 'Surat', 2),
  ('Colorix', 'Surat', 3)
on conflict (name, location) do nothing;

-- Categories (name unique)
insert into public.fms_purchase_categories (name, sort_order) values
  ('Raw Material', 1),
  ('Packing Material', 2),
  ('Consumables', 3)
on conflict (name) do nothing;

-- Item groups (category_id + name unique)
insert into public.fms_purchase_item_groups (category_id, name, sort_order)
select c.id, g.name, g.ord
from (values
  ('Raw Material', 'Solvents', 1),
  ('Raw Material', 'Pigments', 2),
  ('Packing Material', 'Cartons', 1),
  ('Packing Material', 'Labels', 2),
  ('Consumables', 'Filters', 1)
) as g(cat, name, ord)
join public.fms_purchase_categories c on c.name = g.cat
on conflict (category_id, name) do nothing;

-- Items (item_group_id + name unique)
insert into public.fms_purchase_items (item_group_id, name, unit, sort_order)
select ig.id, i.name, i.unit, i.ord
from (values
  ('Solvents', 'Isopropyl Alcohol', 'KGS', 1),
  ('Solvents', 'Acetone', 'LTR', 2),
  ('Pigments', 'Blue Pigment', 'KGS', 1),
  ('Pigments', 'Red Pigment', 'KGS', 2),
  ('Cartons', '5-ply Carton', 'PCS', 1),
  ('Labels', 'Barcode Label', 'PCS', 1),
  ('Filters', 'Cartridge Filter', 'PCS', 1)
) as i(grp, name, unit, ord)
join public.fms_purchase_item_groups ig on ig.name = i.grp
on conflict (item_group_id, name) do nothing;

-- Vendors (name unique)
insert into public.fms_purchase_vendors (name, gstin, contact_name, phone, email) values
  ('Acme Chemicals Pvt Ltd', '24ABCDE1234F1Z5', 'R. Mehta', '9820011223', 'sales@acmechem.example'),
  ('BluePack Industries', '24BPACK5678G1Z3', 'S. Shah', '9820044556', 'orders@bluepack.example'),
  ('FilterPro Supplies', '24FPRO9012H1Z1', 'A. Khan', '9820077889', 'info@filterpro.example')
on conflict (name) do nothing;

-- Approval matrix — 3 default amount bands (only when none exist). Approvers are
-- real users (Yash / Ritesh / Aayush); change them in Setup → Approval Matrix.
insert into public.fms_purchase_approval_matrix (tier_label, min_amount, max_amount, approver_user_id, sort_order)
select v.tier_label, v.min_amount, v.max_amount, v.approver_user_id, v.sort_order
from (values
  ('L1 — Purchase Head',   0::numeric,        50000::numeric,    '7cd18ada-d6a7-4636-9edd-2f6aeeedd373'::uuid, 1),
  ('L2 — Department Head', 50000.01::numeric, 200000::numeric,   '79174071-1f03-46dd-bdf7-a6a7d3699877'::uuid, 2),
  ('Director',             200000.01::numeric, null::numeric,    '853f57a4-fd21-4730-9666-09c2855fc815'::uuid, 3)
) as v(tier_label, min_amount, max_amount, approver_user_id, sort_order)
where not exists (select 1 from public.fms_purchase_approval_matrix);

-- Amount basis setting (line value incl GST).
insert into public.fms_purchase_config (key, value) values
  ('amount_basis', '{"value":"line_incl_gst"}'::jsonb)
on conflict (key) do nothing;
