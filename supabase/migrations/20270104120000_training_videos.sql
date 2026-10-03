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
-- ACCESS — the portal's own module grant, nothing invented.
--   Read:  any grant on 'training-videos' ('view' or 'edit'), and every admin.
--   Write: 'edit' only — that grant IS the right to add, change or remove a link.
--   `module_level` (20260906120000) is the one place that answers this, and admins always
--   read 'edit' there, so they are covered without being named.
--
-- Purely ADDITIVE: one new table, nothing existing altered. Reuses public.set_updated_at()
-- and public.module_level(uuid, text). Apply in the Orange One *identity* project.

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
  'Training Videos: one row per training video LINK (OneDrive / SharePoint). The video itself lives on OneDrive, never here. Read with any training-videos grant; written with an edit grant. See 20270104120000.';

drop trigger if exists trg_training_videos_updated on public.training_videos;
create trigger trg_training_videos_updated
  before update on public.training_videos
  for each row execute function public.set_updated_at();

alter table public.training_videos enable row level security;

drop policy if exists training_videos_select on public.training_videos;
create policy training_videos_select
  on public.training_videos for select
  to authenticated
  using (public.module_level(auth.uid(), 'training-videos') <> 'none');

drop policy if exists training_videos_insert on public.training_videos;
create policy training_videos_insert
  on public.training_videos for insert
  to authenticated
  with check (public.module_level(auth.uid(), 'training-videos') = 'edit');

drop policy if exists training_videos_update on public.training_videos;
create policy training_videos_update
  on public.training_videos for update
  to authenticated
  using (public.module_level(auth.uid(), 'training-videos') = 'edit')
  with check (public.module_level(auth.uid(), 'training-videos') = 'edit');

drop policy if exists training_videos_delete on public.training_videos;
create policy training_videos_delete
  on public.training_videos for delete
  to authenticated
  using (public.module_level(auth.uid(), 'training-videos') = 'edit');

-- ---------------------------------------------------------------- verify --
--
--   select relrowsecurity from pg_class where oid = 'public.training_videos'::regclass;
--   select policyname, cmd from pg_policies where tablename = 'training_videos' order by cmd;
--
-- Expected: true, and four policies (DELETE, INSERT, SELECT, UPDATE).
-- ============================================================================
