-- Rollback of 20270115120000_bushra_orange_customer_overrides.sql.
-- ⚠ Drops every bucket the business set by hand; the dashboard falls back to its rule.
drop table if exists public.bushra_orange_customer_overrides;
