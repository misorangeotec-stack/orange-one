-- Rollback of 20270120120000_add_report_dashboard_full_view.sql.
-- Drops the guard and the column; every Report Dashboard viewer goes back to their salesperson scope.

drop trigger if exists trg_profiles_guard_report_full_view on public.profiles;
drop function if exists public.guard_profile_report_full_view();
alter table public.profiles drop column if exists report_dashboard_full_view;
