-- Rollback for 20270127120000_add_mr_salesperson_options.sql
-- Removes the one function it added. Nothing else depends on it in the database;
-- the Machine Resale salesperson picker stops loading until it is re-applied.
drop function if exists public.mr_salesperson_options();
