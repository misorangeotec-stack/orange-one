-- ===========================================================================
-- ROLLBACK of 20261125120000_dr1_cc_limits.sql
--
-- DESTROYS EVERY TYPED CREDIT-LIMIT BLOCK. Those figures are read off the bank
-- portal and exist nowhere else. Export before running:
--
--   copy (select * from public.daily_report_cc_limits
--          order by balance_date, entity_alias, bank)
--     to stdout with csv header;
--
-- The frontend that reads this table must be rolled back FIRST, or the Bank
-- balances screen and the Daily Report error on load.
--
-- Touches nothing the forward migration did not create: the per-account limit
-- columns and set_bank_daily_balance(s) are left as they are.
-- ===========================================================================

drop function if exists public.set_daily_report_evening(jsonb, jsonb);
drop function if exists public.set_cc_daily_limits(jsonb);
drop function if exists public.set_cc_daily_limit(text, text, date, numeric, numeric, numeric, numeric);

drop table if exists public.daily_report_cc_limits;

do $check$
begin
  if to_regclass('public.daily_report_cc_limits') is not null then
    raise exception 'DR-1 CC rollback: daily_report_cc_limits survived the drop';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('set_cc_daily_limit', 'set_cc_daily_limits', 'set_daily_report_evening')) then
    raise exception 'DR-1 CC rollback: a writer survived the drop';
  end if;
  if to_regprocedure('public.set_bank_daily_balances(jsonb)') is null then
    raise exception 'DR-1 CC rollback: set_bank_daily_balances is gone - this rollback must not touch it';
  end if;
end $check$;
