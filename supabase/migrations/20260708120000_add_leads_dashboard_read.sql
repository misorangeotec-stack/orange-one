-- Orange One LEADS DASHBOARD — cross-user read access (web portal).
--
-- The Leads Dashboard is an admin/sales-head analytics view over ALL captured
-- leads. But app_leads SELECT is owner-scoped (app_leads_select_own:
-- user_id = auth.uid()), so a manager would see only their own leads. This adds
-- an ADDITIVE permissive SELECT policy: Postgres OR-combines permissive policies,
-- so the existing owner policy is untouched (owners still see their own; the
-- mobile app is unaffected) and dashboard-authorized users additionally see ALL.
--
-- "Dashboard-authorized" = admin OR granted the `leads-dashboard` module
-- (app_access.app_id = 'leads-dashboard') — mirrors app_mobile_has_access() from
-- 20260707120000. True server-side isolation: a non-authorized employee still
-- gets only their own rows even via the browser client.
--
-- Purely ADDITIVE (new functions + new policy; nothing existing is mutated).
-- Apply in the identity project (ref coshondiqdhorwvibrwu) before the UI ships.
--
-- Reversal:
--   drop policy if exists app_leads_select_dashboard on public.app_leads;
--   drop function if exists public.leads_dashboard_can_read();
--   drop function if exists public.leads_dashboard_salespeople();

-- Who may read the whole leads dataset.
create or replace function public.leads_dashboard_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(auth.uid())
      or exists (
        select 1 from public.app_access a
        where a.user_id = auth.uid() and a.app_id = 'leads-dashboard'
      );
$$;

grant execute on function public.leads_dashboard_can_read() to authenticated;

-- Additive read policy: dashboard-authorized users see every lead.
drop policy if exists app_leads_select_dashboard on public.app_leads;
create policy app_leads_select_dashboard on public.app_leads
  for select using (public.leads_dashboard_can_read());

-- Salesperson id → name/email for EVERY user who has captured a lead, but only
-- for dashboard-authorized callers. Lets the "by salesperson" analysis resolve
-- names even when the caller's own profiles RLS scope is narrower (e.g. a sales
-- head who can't otherwise see the whole directory). Scoped + safe.
create or replace function public.leads_dashboard_salespeople()
returns table (id uuid, name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.email
  from public.profiles p
  where public.leads_dashboard_can_read()
    and p.id in (select distinct user_id from public.app_leads);
$$;

grant execute on function public.leads_dashboard_salespeople() to authenticated;
