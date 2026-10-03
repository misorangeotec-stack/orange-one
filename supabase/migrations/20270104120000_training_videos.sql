-- Training Videos — a shared list of training video LINKS, one row per video.
--
-- WHAT THIS IS
--   The portal's own "Training Videos" group in the left menu. Each row is a title, the
--   module it teaches, and a link to the recording on OneDrive / SharePoint. Clicking it
--   opens the video in a new tab. The videos themselves are never stored here — a video in
--   Supabase storage has a real cost, and OneDrive already holds them (see WORKLIST PF-11).
--
-- ⚠ LINKS, NOT FILES — AND MICROSOFT, NOT GOOGLE OR YOUTUBE. The company is on Microsoft 365
--   and Google is blocked on its network (02-10-2026). The app refuses YouTube and Google
--   Drive links on the way in; this table only insists on an http(s) URL, so the rule can be
--   changed later without a migration.
--
-- ACCESS -- like Announcements: everyone watches, admins maintain (asked for 03-10-2026).
--   Read:  every member of staff, via is_staff(), so a customer login (is_external) reads
--          nothing. No grant is needed: the app is universal (apps/universal.ts).
--   Write: admins only, via is_admin().
--   NOT module_level(): it knows nothing about universal apps and would answer 'none' for
--   every non-admin, hiding the videos from the very people they are for.
--
--   Every policy is DROP-then-CREATE, so re-running this file over an earlier copy of it
--   (one that gated on module_level) simply replaces those policies.
--
-- Purely ADDITIVE: one new table, nothing existing altered. Reuses public.set_updated_at(),
-- public.is_staff(uuid) and public.is_admin(uuid). Apply in the Orange One *identity* project.

create table if not exists public.training_videos (
  id          uuid primary key default gen_random_uuid(),
  -- The module or topic the video teaches — the page groups videos under it.
  module      text not null check (length(trim(module)) > 0),
  title       text not null check (length(trim(title)) > 0),
  url         text not null check (url ~* '^https?://'),
  description text,
  -- Position within its module; ties fall back to title.
  sort_order  integer not null default 100,
  created_by  uuid references auth.users on delete set null,
  updated_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.training_videos is
  'Training Videos: one row per training video LINK (OneDrive / SharePoint). The video itself lives on OneDrive, never here. Read by all staff; written by admins only. See 20270104120000.';

drop trigger if exists trg_training_videos_updated on public.training_videos;
create trigger trg_training_videos_updated
  before update on public.training_videos
  for each row execute function public.set_updated_at();

alter table public.training_videos enable row level security;

drop policy if exists training_videos_select on public.training_videos;
create policy training_videos_select
  on public.training_videos for select
  to authenticated
  using ((select public.is_staff((select auth.uid()))));

drop policy if exists training_videos_insert on public.training_videos;
create policy training_videos_insert
  on public.training_videos for insert
  to authenticated
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists training_videos_update on public.training_videos;
create policy training_videos_update
  on public.training_videos for update
  to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists training_videos_delete on public.training_videos;
create policy training_videos_delete
  on public.training_videos for delete
  to authenticated
  using ((select public.is_admin((select auth.uid()))));

-- ---------------------------------------------------------------- verify --
--
--   select relrowsecurity from pg_class where oid = 'public.training_videos'::regclass;
--   select policyname, cmd from pg_policies where tablename = 'training_videos' order by cmd;
--
-- Expected: true, and four policies (DELETE, INSERT, SELECT, UPDATE).
-- ============================================================================
