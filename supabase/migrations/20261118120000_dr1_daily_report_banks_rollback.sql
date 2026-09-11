-- ===========================================================================
-- ROLLBACK of 20261118120000_dr1_daily_report_banks.sql
--
-- DESTROYS EVERY HAND-TYPED BANK BALANCE. Those figures exist nowhere else —
-- they are read off the bank portal each evening and are not derivable from
-- Tally, whose book balance is a different number. Export before running:
--
--   copy (select a.short_label, a.account_no, b.*
--           from public.daily_report_bank_balances b
--           join public.daily_report_bank_accounts a on a.id = b.bank_account_id
--          order by b.balance_date, a.sort_order)
--     to stdout with csv header;
--
-- Drop order is the reverse of creation: the routines first (they reference the
-- tables), then balances (it references accounts), then accounts.
-- ===========================================================================

drop function if exists public.daily_report_balance_status(date);
drop function if exists public.set_bank_daily_balances(jsonb);
drop function if exists public.set_bank_daily_balance(uuid, date, numeric, numeric);

drop table if exists public.daily_report_bank_balances;
drop table if exists public.daily_report_bank_accounts;

do $check$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public'
                and table_name in ('daily_report_bank_accounts',
                                   'daily_report_bank_balances')) then
    raise exception 'DR-1 rollback: a bank table survived the drop';
  end if;
end $check$;
