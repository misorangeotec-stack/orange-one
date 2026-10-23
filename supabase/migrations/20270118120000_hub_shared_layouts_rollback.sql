-- Rollback of 20270118120000_hub_shared_layouts.sql.
-- ⚠ Drops the layouts admins saved for everyone; each viewer keeps whatever their own browser holds.
drop table if exists public.hub_shared_layouts;
