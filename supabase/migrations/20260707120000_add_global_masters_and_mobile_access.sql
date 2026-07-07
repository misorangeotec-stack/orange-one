-- Orange One — admin-managed GLOBAL lead masters + Mobile App access gate.
--
-- Two additive capabilities that let the web-portal admin govern the mobile
-- Leads app (identity project, ref coshondiqdhorwvibrwu — same accounts as the
-- web portal):
--
--   1. app_lead_masters_global  — ONE shared, org-wide master set (categories,
--      interest levels, asked-about, follow-up actions) as jsonb. Admins edit it
--      from the web admin; every signed-in user reads it. Replaces the per-user
--      app_lead_masters as the source of truth (that table is kept, now inert).
--
--   2. app_mobile_has_access()  — the mobile app calls this after login to decide
--      whether the user may use the app. True for admins (always) OR any user
--      holding the 'mobile-app' grant in app_access. SECURITY DEFINER so it can
--      read app_access without widening that table's RLS.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Apply in the Orange
-- One identity project via the SQL editor or `supabase db push`.
--
-- Reversal:
--   drop function if exists public.app_mobile_has_access();
--   drop table if exists public.app_lead_masters_global;

-- ===================== app_lead_masters_global =====================
create table if not exists public.app_lead_masters_global (
  id          text primary key default 'global',
  masters     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

comment on table public.app_lead_masters_global is
  'Orange One Leads: the single org-wide master set (categories/interest/asked-about/follow-up). Admin-writable, all-readable. Source of truth for the mobile app.';

alter table public.app_lead_masters_global enable row level security;

-- Any signed-in user reads the shared lists.
drop policy if exists app_lead_masters_global_select on public.app_lead_masters_global;
create policy app_lead_masters_global_select on public.app_lead_masters_global
  for select using (auth.uid() is not null);

-- Only admins create/update them.
drop policy if exists app_lead_masters_global_insert on public.app_lead_masters_global;
create policy app_lead_masters_global_insert on public.app_lead_masters_global
  for insert with check (public.is_admin(auth.uid()));

drop policy if exists app_lead_masters_global_update on public.app_lead_masters_global;
create policy app_lead_masters_global_update on public.app_lead_masters_global
  for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Seed the single 'global' row with the app's default lists (mirrors
-- mobile/src/lib/leads/masters.ts defaultMasters()) so first read is never empty.
insert into public.app_lead_masters_global (id, masters, updated_at)
values (
  'global',
  '{
    "categories": [
      {"id": "m1", "label": "Manufacturer", "order": 1},
      {"id": "m2", "label": "Distributor", "order": 2},
      {"id": "m3", "label": "Retailer", "order": 3},
      {"id": "m4", "label": "Wholesaler", "order": 4},
      {"id": "m5", "label": "Others", "order": 5}
    ],
    "interestLevels": [
      {"id": "m6", "label": "Not interested", "color": "#E5484D", "order": 6},
      {"id": "m7", "label": "Slightly interested", "color": "#F8B62B", "order": 7},
      {"id": "m8", "label": "Very interested", "color": "#3B82F6", "order": 8},
      {"id": "m9", "label": "Ready to buy", "color": "#27AE60", "order": 9}
    ],
    "askedAbout": [
      {"id": "m10", "label": "Product demo", "order": 10},
      {"id": "m11", "label": "Pricing", "order": 11},
      {"id": "m12", "label": "Catalogue", "order": 12},
      {"id": "m13", "label": "Samples", "order": 13},
      {"id": "m14", "label": "Partnership", "order": 14}
    ],
    "followUpActions": [
      {"id": "m15", "label": "Call back today", "order": 15},
      {"id": "m16", "label": "Send quote", "order": 16},
      {"id": "m17", "label": "Book a demo", "order": 17},
      {"id": "m18", "label": "Share catalogue", "order": 18},
      {"id": "m19", "label": "No action", "order": 19}
    ]
  }'::jsonb,
  now()
)
on conflict (id) do nothing;

-- ===================== app_mobile_has_access() =====================
-- Login gate for the mobile app. Admins always pass; everyone else needs the
-- 'mobile-app' grant in app_access. SECURITY DEFINER reads app_access without
-- exposing it via table RLS.
create or replace function public.app_mobile_has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(auth.uid())
      or exists (
        select 1 from public.app_access a
        where a.user_id = auth.uid() and a.app_id = 'mobile-app'
      );
$$;

comment on function public.app_mobile_has_access() is
  'True if the current user may use the mobile Leads app: admins always, otherwise requires the mobile-app grant in app_access.';

grant execute on function public.app_mobile_has_access() to authenticated;
