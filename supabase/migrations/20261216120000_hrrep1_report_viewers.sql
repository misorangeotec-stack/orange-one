-- HRREP-1 · Who may open SOMEBODY ELSE'S HR report.
--
-- The HR Reports app is universal: every employee opens their OWN scorecard and their
-- own weekly review with no grant, exactly as the live KRA / KPI Scorecard does. Two
-- things widen that by themselves and need no list —
--
--   an admin            sees everyone, as everywhere else in the hub
--   a head (hod/sub_hod) sees the people who report to them, via the reporting chain
--
-- and this table is the third: named people, decided by an admin on the app's Settings
-- screen, who may read EVERYONE regardless of the reporting line. It exists because
-- "Management" is not a role the platform knows — the hub has admin / hod / sub_hod /
-- employee and nothing else — so the CFO or a director who heads no department would
-- otherwise see only themselves.
--
-- Additive only: a new table, no column touched, no data moved.

create table if not exists public.hr_report_viewers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Kept so the Settings screen can say who opened the door and when. A permission
  -- nobody can trace is a permission nobody will ever dare remove.
  added_by   uuid references auth.users (id) on delete set null,
  added_at   timestamptz not null default now()
);

comment on table public.hr_report_viewers is
  'HRREP-1 · People who may read EVERY person''s HR report (PMS scorecard, weekly review), '
  'on top of admins and each head''s own reporting line. Managed on HR Reports > Settings.';

alter table public.hr_report_viewers enable row level security;

-- ── Read ────────────────────────────────────────────────────────────────────
-- Everyone may read their OWN row, because the app has to ask "am I a viewer?" before
-- it decides whose reports to offer, and it runs as the caller. Admins read the whole
-- list, because the Settings screen has to show it.
--
-- ⚠ A policy is evaluated AS THE CALLER, so anything it reads meets that caller's own
--   RLS. `is_admin()` is SECURITY DEFINER for exactly this reason — reading user_roles
--   inline here would be checked against the caller again and quietly return false.
drop policy if exists hr_report_viewers_select on public.hr_report_viewers;
create policy hr_report_viewers_select on public.hr_report_viewers
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

-- ── Write ───────────────────────────────────────────────────────────────────
-- Admins only, and the same rule on both sides of an update so a row can never be
-- edited into a state its author could not have inserted.
drop policy if exists hr_report_viewers_insert on public.hr_report_viewers;
create policy hr_report_viewers_insert on public.hr_report_viewers
  for insert to authenticated
  with check (public.is_admin((select auth.uid())));

drop policy if exists hr_report_viewers_update on public.hr_report_viewers;
create policy hr_report_viewers_update on public.hr_report_viewers
  for update to authenticated
  using (public.is_admin((select auth.uid())))
  with check (public.is_admin((select auth.uid())));

drop policy if exists hr_report_viewers_delete on public.hr_report_viewers;
create policy hr_report_viewers_delete on public.hr_report_viewers
  for delete to authenticated
  using (public.is_admin((select auth.uid())));

grant select, insert, update, delete on public.hr_report_viewers to authenticated;
