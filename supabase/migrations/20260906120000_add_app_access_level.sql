-- ===========================================================================
-- Module access gets a LEVEL: view-only, or view + edit.
--
-- WHY
--   A grant in app_access has always been all-or-nothing. One row means "this
--   person may open this app", and once inside they can raise, edit, approve
--   and manage masters subject only to per-step ownership. There was no way to
--   say "let them look at Procurement, but change nothing".
--
-- WHAT THIS DOES
--   A. app_access.access_level — 'view' or 'edit', DEFAULT 'edit'.
--   B. public.module_level(user_id, app_id) -> 'none' | 'view' | 'edit'.
--
-- ⚠ THE DEFAULT IS THE WHOLE BACKFILL, AND IT IS THE SAFE DIRECTION.
--   `not null default 'edit'` fills every existing row with 'edit' as the
--   column is added, so EVERY GRANT THAT EXISTS TODAY KEEPS FULL RIGHTS. No
--   separate UPDATE, no window where anyone is downgraded.
--
--   It also protects the deploy gap and any future caller. Nothing in this repo
--   may insert an app_access row without naming the column and thereby create an
--   accidental view-only grant: an insert that omits access_level lands on
--   'edit', which is exactly today's behaviour. The frontend bundle running in
--   an open tab, the admin-users Edge Function before it is redeployed, and the
--   20260803120000 customer-onboarding backfill all take that path. The unsafe
--   direction — silently restricting someone — is unreachable.
--
-- ⚠ WHY THE SIX EXISTING app_access GATES ARE LEFT ALONE.
--   app_mobile_has_access(), leads_dashboard_can_read(), master_report_snapshot(),
--   queue_master_report_email(), master_report_access_matrix() and user_snapshot()
--   each hand-write "is_admin(uid) or exists(app_access ...)". They are READ
--   gates — they answer "may this person OPEN the app", and a view-only user
--   must still pass every one of them. Rewriting them to use module_level()
--   would be a pure refactor with no behaviour change, on six load-bearing
--   functions, one of which (queue_master_report_email) is asserted against its
--   own source text by 20260830120800. Not worth the risk in this migration.
--
--   module_level() is added NOW because the follow-up that enforces 'view' at
--   the database — inside the nine <app>_is_step_owner and nine
--   <app>_is_master_manager helpers — needs one place to ask, or it becomes
--   eighteen more copies of the rule.
--
-- ⚠ app_access has NO CREATE TABLE anywhere in supabase/migrations/ — the table
--   was created out-of-band in Phase B1. Its shape and RLS live only in the live
--   database and in backups/identity_*.sql. This is the first migration to touch
--   it, so the alter below is written to be safe against a re-run.
--
-- ADDITIVE ONLY: one column with a safe default, one new function. No table,
-- column, row or policy is dropped or narrowed. app_access RLS is unchanged —
-- app_access_select (self or admin) and app_access_admin_write still apply, and
-- the new column inherits both.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. The column.
-- ---------------------------------------------------------------------------
alter table public.app_access
  add column if not exists access_level text not null default 'edit'
    check (access_level in ('view', 'edit'));

comment on column public.app_access.access_level is
  'How much of this app the grant carries: ''view'' = read-only, ''edit'' = view + change. Defaults to ''edit'' so an insert that omits it can never accidentally restrict someone.';

-- ---------------------------------------------------------------------------
-- B. One place to ask "what may this person do in this app?".
--
-- Mirrors session.tsx exactly: admins bypass every grant and always hold 'edit',
-- so their rows are absent by design and must not read as 'none'. Everyone else
-- is opt-in per app.
--
-- Returns text rather than a boolean so a caller can tell "no access" from
-- "read-only" — the Master Report and the admin screens need that distinction,
-- and a boolean would force a second function the first time they did.
--
-- STABLE, not IMMUTABLE: it reads a table. SECURITY DEFINER so it can be called
-- from RLS predicates and from RPCs that run as the definer, without needing
-- app_access_select to widen (a user may only select their OWN app_access rows).
-- ---------------------------------------------------------------------------
create or replace function public.module_level(_user_id uuid, _app_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _user_id is null or _app_id is null then 'none'
    when public.is_admin(_user_id) then 'edit'
    else coalesce(
      (select a.access_level
         from public.app_access a
        where a.user_id = _user_id
          and a.app_id = _app_id),
      'none')
  end;
$$;

comment on function public.module_level(uuid, text) is
  'Effective module access for a user: ''none'' | ''view'' | ''edit''. Admins are always ''edit'' (they hold no app_access rows). The one place to ask; see 20260906120000.';

revoke all on function public.module_level(uuid, text) from public, anon;
grant execute on function public.module_level(uuid, text) to authenticated;
