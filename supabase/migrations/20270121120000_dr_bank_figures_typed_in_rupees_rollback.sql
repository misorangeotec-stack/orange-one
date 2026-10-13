-- Rollback for 20270121120000_dr_bank_figures_typed_in_rupees.sql
-- ⚠ Puts the figures back in RUPEES-stored-as-lakhs (the old, wrong unit) and
--   rounds to (14,2). Only run it together with reverting the frontend.
begin;

update public.daily_report_bank_balances
   set closing_balance_lacs = closing_balance_lacs * 100000,
       lc_bc_utilised_lacs  = lc_bc_utilised_lacs  * 100000;

update public.daily_report_cc_limits
   set cc_limit_lacs       = cc_limit_lacs       * 100000,
       lc_bc_limit_lacs    = lc_bc_limit_lacs    * 100000,
       lc_bc_utilised_lacs = lc_bc_utilised_lacs * 100000,
       hold_by_bank_lacs   = hold_by_bank_lacs   * 100000;

alter table public.daily_report_bank_balances
  alter column closing_balance_lacs type numeric(14,2),
  alter column lc_bc_utilised_lacs  type numeric(14,2);

alter table public.daily_report_cc_limits
  alter column cc_limit_lacs       type numeric(14,2),
  alter column lc_bc_limit_lacs    type numeric(14,2),
  alter column lc_bc_utilised_lacs type numeric(14,2),
  alter column hold_by_bank_lacs   type numeric(14,2);

commit;
