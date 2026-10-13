-- Daily Report — bank figures are typed in RUPEES; the tables keep LAKHS.
--
-- WHAT WENT WRONG. The Bank balances form labelled every box "₹ L", and the
-- figures were typed in rupees anyway, straight off the bank portal. So
-- ₹2,11,61,000 was stored as 2,11,61,000 LAKHS, and the report's Bank balance
-- tile read "₹2,26,66,000.00 L" beside cards that all read in lakhs.
--
-- THE FIX. The boxes now take rupees and the app divides by 1,00,000 before it
-- saves (frontend, same PR). This migration does the two things that needs:
--
--   1. Widens every typed figure from numeric(14,2) to numeric(19,7). Two
--      decimals of a LAKH is ₹1,000, so a rupee figure saved at (14,2) would come
--      back rounded — ₹2,11,61,234 would re-open as ₹2,11,61,000. Seven decimals
--      of a lakh is one paisa, so what is typed is what is stored.
--   2. Converts the rows already typed in rupees to lakhs (÷ 1,00,000).
--
-- ⚠ RUN THIS TOGETHER WITH THE FRONTEND MERGE, NOT DAYS APART. Every row present
--   when it runs is treated as rupees. A row saved through the NEW form before
--   this runs would be divided twice.
--
-- No view or routine depends on these column types: the write routines cast to
-- plain `numeric`, and the >= 0 checks on daily_report_cc_limits carry over.

begin;

-- ---------------------------------------------------------------- 1. widen --
alter table public.daily_report_bank_balances
  alter column closing_balance_lacs type numeric(19,7),
  alter column lc_bc_utilised_lacs  type numeric(19,7);

alter table public.daily_report_cc_limits
  alter column cc_limit_lacs       type numeric(19,7),
  alter column lc_bc_limit_lacs    type numeric(19,7),
  alter column lc_bc_utilised_lacs type numeric(19,7),
  alter column hold_by_bank_lacs   type numeric(19,7);

-- -------------------------------------------------------------- 2. convert --
-- updated_at is left alone (neither table has an update trigger): nobody re-typed
-- these figures, only the unit they are read in changed.
update public.daily_report_bank_balances
   set closing_balance_lacs = closing_balance_lacs / 100000,
       lc_bc_utilised_lacs  = lc_bc_utilised_lacs  / 100000;

update public.daily_report_cc_limits
   set cc_limit_lacs       = cc_limit_lacs       / 100000,
       lc_bc_limit_lacs    = lc_bc_limit_lacs    / 100000,
       lc_bc_utilised_lacs = lc_bc_utilised_lacs / 100000,
       hold_by_bank_lacs   = hold_by_bank_lacs   / 100000;

comment on column public.daily_report_bank_balances.closing_balance_lacs is
  'Closing balance in ₹ LAKHS, to the paisa (7 dp). Typed on the form in rupees and divided by 1,00,000 by the app.';

commit;
