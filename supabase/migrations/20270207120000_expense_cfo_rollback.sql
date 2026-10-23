-- Rollback of 20270207120000_expense_cfo.sql. Drops only the three Expense Analysis (CFO) tables.
drop table if exists public.expense_cfo_tie;
drop table if exists public.expense_cfo_line;
drop table if exists public.expense_cfo_load;
