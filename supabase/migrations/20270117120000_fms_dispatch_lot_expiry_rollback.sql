-- Rollback for 20270117120000_fms_dispatch_lot_expiry.sql
-- ⚠ Drops every typed lot expiry. The gate pass then falls back to Tally only.
begin;
drop function if exists public.fms_dispatch_set_lot_expiry(uuid, jsonb);
drop table if exists public.fms_dispatch_lot_expiry;
commit;
