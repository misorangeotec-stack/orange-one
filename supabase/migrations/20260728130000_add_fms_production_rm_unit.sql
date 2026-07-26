-- ===========================================================================
-- PRODUCTION ENTRY FMS — RAW MATERIAL CARRIES ITS OWN UNIT.
--
-- A raw material has a fixed unit of measure (KGS, LTR, PCS …). Rather than have
-- the user pick a unit per line on the issue slip, the unit now lives on the raw-
-- material master and is shown automatically when the material is selected.
--
-- Additive: one nullable column referencing the existing units master. Existing
-- raw materials get NULL until an admin/owner sets each one's unit; the issue slip
-- shows "—" for an unset unit and stores null. Reversal:
--   alter table public.fms_production_raw_materials drop column if exists unit_id;
-- ===========================================================================

alter table public.fms_production_raw_materials
  add column if not exists unit_id uuid references public.fms_production_units on delete set null;

comment on column public.fms_production_raw_materials.unit_id is
  'The raw material''s own unit of measure (from fms_production_units). Shown automatically when the material is picked on a job card, so the user no longer selects a unit per line. NULL until set.';
