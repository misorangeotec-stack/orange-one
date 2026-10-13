-- Per-user "full company view" on the Report Dashboard.
--
-- The Report Dashboard (Reports → Bushra dashboards and the Sales Register they open) narrows
-- every non-admin to their salesperson tags (profiles.receivables_salespersons). That is right
-- for a salesperson, who must see only their own bucket. It is wrong for a viewer such as an HOD
-- or accounts, who must see the whole sheet exactly as an admin does — the tags cannot tell the
-- two apart, because the same tags also drive the Outstanding Dashboard.
--
--   NULL / false -> the salesperson / collection-team scope applies, as before (the default)
--   true         -> Report Dashboard pages ignore the scope and show every party
--
-- Outstanding Dashboard and every other screen are untouched by this column.
--
-- ⚠ GUARDED. profiles_update_own lets a user PATCH their own row, so without the trigger below
--   anyone could switch this on for themselves through PostgREST. Only an admin (or the service
--   role, auth.uid() null) may change it.
--
-- Purely ADDITIVE. Apply in the Orange One project (ref coshondiqdhorwvibrwu).
-- Rollback: 20270120120000_add_report_dashboard_full_view_rollback.sql

alter table public.profiles
  add column if not exists report_dashboard_full_view boolean;

comment on column public.profiles.report_dashboard_full_view is
  'Report Dashboard: true = see every party like an admin, ignoring receivables_salespersons / receivables_collection_teams. NULL/false = scoped. Admin-only to change.';

create or replace function public.guard_profile_report_full_view()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or (select public.is_admin((select auth.uid()))) then
    return new;
  end if;

  if new.report_dashboard_full_view is distinct from old.report_dashboard_full_view then
    raise exception 'Report Dashboard full view is set by an administrator.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_report_full_view() is
  'Column-level guard for profiles.report_dashboard_full_view: non-admins may never change it.';

drop trigger if exists trg_profiles_guard_report_full_view on public.profiles;
create trigger trg_profiles_guard_report_full_view
  before update on public.profiles
  for each row execute function public.guard_profile_report_full_view();
