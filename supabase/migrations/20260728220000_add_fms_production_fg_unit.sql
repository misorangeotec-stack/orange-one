-- ===========================================================================
-- PRODUCTION ENTRY FMS — FG ITEM CARRIES ITS OWN UNIT.
--
-- Like raw materials and packaging items, a finished-good item has a fixed unit
-- of measure (KGS, LTR, PCS …). It now lives on the FG-item master and is shown
-- automatically wherever the FG item appears on a job card.
--
-- Additive: one nullable column referencing the existing units master. Existing
-- FG items get NULL until an admin/owner sets each one's unit; display shows "—"
-- for an unset unit. Reversal:
--   alter table public.fms_production_fg_items drop column if exists unit_id;
-- ===========================================================================

alter table public.fms_production_fg_items
  add column if not exists unit_id uuid references public.fms_production_units on delete set null;

comment on column public.fms_production_fg_items.unit_id is
  'The FG item''s own unit of measure (from fms_production_units). Shown automatically wherever the FG item appears on a job card. NULL until set.';
