-- Per-collection-team scoping for the Outstanding Dashboard (RC-11).
--
-- The twin of receivables_salespersons, added 10-09-2026. Tags an Orange One login with the
-- collection team name(s) — exactly as they appear in ext_collection_team_master on ConnectWave —
-- whose customers the user may see. The dashboard reads it and restricts the view:
--   admin                    -> sees everything (ignores this column, as it does the salesperson one)
--   non-admin, names present -> sees only the customers those teams chase
--   non-admin, NULL / empty  -> this dimension does not restrict
--
-- ⚠ THE TWO SCOPES ARE MUTUALLY EXCLUSIVE, and that is enforced in the ADMIN FORM, not here.
--   A user is tagged by salesperson OR by collection team, never both (the client's decision,
--   09-09-2026). A check constraint was considered and rejected: it would reject a legitimate
--   intermediate state while an admin edits, and the column must stay additive. The reader
--   (lib/useAppData.ts) still intersects if both are somehow set, so the failure direction is
--   NARROWER, never wider.
--
-- ⚠ NOTE THE POLARITY DIFFERENCE FROM receivables_salespersons. There, an empty list on a non-admin
--   means "sees NOTHING" — it is the only dimension, so untagged means untrusted. Here, an empty
--   list means "this dimension is not in use for this person", because otherwise every existing
--   salesperson-scoped user would go blank the moment this column shipped. liveDirectory maps NULL
--   to [] as it does for the twin; lib/scope.tsx is where the two polarities are resolved.
--
-- Purely ADDITIVE: a new nullable column. No existing column, row or policy is touched.
-- Writes stay admin-only under the existing profiles RLS — this column is role-adjacent, like the
-- salesperson tag, and must never become writable by the user it scopes.
--
-- Reversal:
--   alter table public.profiles drop column if exists receivables_collection_teams;

alter table public.profiles
  add column if not exists receivables_collection_teams text[];

comment on column public.profiles.receivables_collection_teams is
  'Outstanding Dashboard scope: collection team names this user may see (ext_collection_team_master on ConnectWave). NULL/empty = this dimension does not restrict; admins bypass. Mutually exclusive with receivables_salespersons, enforced in the admin form.';
