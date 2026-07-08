-- Orange One LEADS (mobile) — cloud sync tables + media storage.
--
-- Phase 2 of the Leads app: offline-first capture syncs to this identity project
-- (ref coshondiqdhorwvibrwu — same accounts as the web portal). Tables are
-- prefixed `app_lead*` so everything for this app is easy to identify (sibling
-- of the `app_devices` convention).
--
-- Tables (public, RLS-enabled, scoped to the owning user):
--   app_leads         — one row per captured lead (contact). Client-generated
--                       uuid PK → upsert-by-id is idempotent (no duplication).
--   app_lead_masters  — one row per user: their configurable lists (categories,
--                       interest levels, asked-about, follow-up actions) as jsonb.
-- Storage:
--   bucket `lead-media` (private) — card photos + voice audio, one folder per
--   user (`<user_id>/...`); RLS lets a user touch only their own folder.
--
-- IMPORTANT: `updated_at` is CLIENT-SUPPLIED (last-write-wins sync). Do NOT put a
-- set_updated_at trigger on these tables — the client's timestamp must win.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Apply in the Orange
-- One identity project via the SQL editor or `supabase db push`.
--
-- Reversal:
--   drop table if exists public.app_leads;
--   drop table if exists public.app_lead_masters;
--   delete from storage.buckets where id = 'lead-media';

-- ============================ app_leads ============================
create table if not exists public.app_leads (
  id                   uuid primary key,               -- client-generated
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_name          text,                           -- denormalized for search/sort
  company_name         text,
  interest_level_id    text,
  follow_up_action_id  text,
  captured_on          timestamptz,
  payload              jsonb not null default '{}'::jsonb,  -- full Contact (nested)
  deleted              boolean not null default false,
  updated_at           timestamptz not null,           -- client-supplied (LWW)
  created_at           timestamptz not null default now()
);

comment on table public.app_leads is
  'Orange One Leads (mobile): one captured lead per row. RLS-scoped to owner; updated_at is client-supplied for last-write-wins sync.';

create index if not exists app_leads_user_updated_idx on public.app_leads (user_id, updated_at);

alter table public.app_leads enable row level security;

drop policy if exists app_leads_select_own on public.app_leads;
create policy app_leads_select_own on public.app_leads
  for select using (user_id = auth.uid());

drop policy if exists app_leads_insert_own on public.app_leads;
create policy app_leads_insert_own on public.app_leads
  for insert with check (user_id = auth.uid());

drop policy if exists app_leads_update_own on public.app_leads;
create policy app_leads_update_own on public.app_leads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists app_leads_delete_own on public.app_leads;
create policy app_leads_delete_own on public.app_leads
  for delete using (user_id = auth.uid());

-- ========================= app_lead_masters =========================
create table if not exists public.app_lead_masters (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  masters     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null
);

comment on table public.app_lead_masters is
  'Orange One Leads (mobile): per-user configurable master lists (categories/interest/asked-about/follow-up) as jsonb.';

alter table public.app_lead_masters enable row level security;

drop policy if exists app_lead_masters_select_own on public.app_lead_masters;
create policy app_lead_masters_select_own on public.app_lead_masters
  for select using (user_id = auth.uid());

drop policy if exists app_lead_masters_insert_own on public.app_lead_masters;
create policy app_lead_masters_insert_own on public.app_lead_masters
  for insert with check (user_id = auth.uid());

drop policy if exists app_lead_masters_update_own on public.app_lead_masters;
create policy app_lead_masters_update_own on public.app_lead_masters
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ========================= storage: lead-media =========================
insert into storage.buckets (id, name, public)
values ('lead-media', 'lead-media', false)
on conflict (id) do nothing;

-- One folder per user: the first path segment must equal the user's id.
drop policy if exists app_lead_media_select_own on storage.objects;
create policy app_lead_media_select_own on storage.objects
  for select using (bucket_id = 'lead-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists app_lead_media_insert_own on storage.objects;
create policy app_lead_media_insert_own on storage.objects
  for insert with check (bucket_id = 'lead-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists app_lead_media_update_own on storage.objects;
create policy app_lead_media_update_own on storage.objects
  for update using (bucket_id = 'lead-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists app_lead_media_delete_own on storage.objects;
create policy app_lead_media_delete_own on storage.objects
  for delete using (bucket_id = 'lead-media' and (storage.foldername(name))[1] = auth.uid()::text);
