-- Per-REPORT access for the Outstanding Dashboard (Receivables Control).
--
-- Until now report visibility was all-or-nothing: one `reports` key in
-- profiles.receivables_hidden_menus gated ~31 live reports at once, and
-- profiles.receivables_admin_menus added a second "full access" tier that unlocked the
-- Dashboards + Insights categories. There was no way to grant one user just the Aging
-- Report. This column replaces that coarse gate with an explicit per-report grant.
--
--   receivables_allowed_reports = {'aging','overdue-aging','finance-receivables'}
--
-- Values are report ids from the frontend catalogue (lib/reportCatalog.ts REPORTS[].id),
-- which are documented there as stable and never renamed. CATEGORY ids are deliberately
-- NOT storable here: if a category were the grant, a report added to it later would be
-- silently granted to everyone who held it — the exact problem this solves. The admin
-- screens offer category tick-boxes purely as a bulk-select over the report ids.
--
-- ── Why an ALLOW-list, when receivables_hidden_menus is a DENY-list ──
-- The polarities are opposite on purpose, and the difference is load-bearing:
--
--   menus   deny-list  -> a newly shipped MENU reaches everyone without an admin acting
--   reports allow-list -> a newly shipped REPORT reaches NOBODY until an admin acts
--
-- Reports carry finance data whose audience is narrower than the app's, and this module
-- gains reports steadily, so "new thing is invisible until granted" is the safe default.
--
-- ── NO BACKFILL, deliberately ──
-- NULL and '{}' both mean "no reports". Every existing non-admin therefore starts with
-- ZERO reports the moment the frontend ships, and an admin assigns them by hand in
-- Settings -> Permissions (or Admin -> Users). This is the requested behaviour, not an
-- oversight: the point of the change is that access becomes something explicitly given.
-- Admins bypass the column entirely and keep seeing everything.
--
-- ⚠ Plan the rollout: decide who-gets-what BEFORE deploying the frontend, then configure
--   in one sitting. Between the deploy and that configuration, non-admin users have no
--   reports.
--
-- Purely ADDITIVE: one new nullable column. No existing column, row or policy is touched
-- — including the now-vestigial 'reports' entries left inside receivables_admin_menus,
-- which the frontend simply ignores rather than mutating out (that column is still live
-- for the 'settings' key, which the muster-write Edge Function checks for authz).
--
-- Apply in the Orange One identity project (ref icutjkrqkbzwvmnfbzpr) via the SQL editor
-- or the session pooler BEFORE the frontend goes live — the directory read-model selects
-- this column, so a missing column breaks the whole user list, not just this feature.

alter table public.profiles
  add column if not exists receivables_allowed_reports text[];

comment on column public.profiles.receivables_allowed_reports is
  'Outstanding Dashboard per-report grants: report ids from lib/reportCatalog.ts REPORTS[].id. ALLOW-list — NULL or {} means no reports at all. Admins bypass it. Category ids are never stored here; the admin UI expands a category tick into its report ids.';
