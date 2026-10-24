-- Training Videos — a shared list of training video LINKS, one row per video.
--
-- WHAT THIS IS
--   The portal's own "Training Videos" group in the left menu. Each row is a title, the
--   portal module it teaches, and a link to the recording on OneDrive / SharePoint. Clicking
--   it opens the video in a new tab. The videos themselves are never stored here — a video in
--   Supabase storage has a real cost, and OneDrive already holds them (see WORKLIST PF-11).
--
-- ⚠ LINKS, NOT FILES — AND MICROSOFT, NOT GOOGLE OR YOUTUBE. The company is on Microsoft 365
--   and Google is blocked on its network (02-10-2026). The app refuses YouTube and Google
--   Drive links on the way in; this table only insists on an http(s) URL, so the rule can be
--   changed later without a migration.
--
-- ACCESS (asked for 03-10-2026)
--   The Training Videos menu is open to every member of staff (the app is universal,
--   apps/universal.ts), but each person reads only the videos of the modules THEY hold:
--   granted Order to Dispatch, they see the Order to Dispatch videos and nothing else.
--
--   Read:  staff only (is_staff — a customer login reads nothing), and then any one of
--            · an admin                                   — every video;
--            · a grant on the video's module at any level — module_level() <> 'none';
--            · a video of a UNIVERSAL module, which every member of staff already holds.
--   Write: admins only, via is_admin().
--
--   ⚠ TWO LISTS HERE MIRROR THE FRONTEND, and must move with it:
--     · the universal ids — apps/universal.ts. module_level() knows nothing about that file
--       and answers 'none' for them, so without this list nobody but an admin would see a
--       KRA / KPI or Help Desk video.
--     · reports -> outstanding-dashboard — Reports rides that grant (reports/meta.tsx
--       accessAppId), mirrored as ACCESS_ALIAS in apps/training-videos/lib/videos.ts.
--
--   Every policy is DROP-then-CREATE, so re-running this file over an earlier copy of it
--   simply replaces those policies.
--
-- Purely ADDITIVE: one new table, nothing existing altered. Reuses public.set_updated_at(),
-- public.is_staff(uuid), public.is_admin(uuid) and public.module_level(uuid, text). Apply in
-- the Orange One *identity* project.

create table if not exists public.training_videos (
  id          uuid primary key default gen_random_uuid(),
  -- The portal module the video teaches, as its app id ('order-to-dispatch', 'procurement', …)
  -- — the same id app_access grants. It decides who may see the video.
  app_id      text not null check (length(trim(app_id)) > 0),
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

-- An earlier draft of this file named the column `module`. If that draft was ever run, carry
-- the column across rather than leave the table without the one the app reads. A rename,
-- never a drop: no row is lost.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'training_videos' and column_name = 'module')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'training_videos' and column_name = 'app_id') then
    alter table public.training_videos rename column module to app_id;
  end if;
end $$;

create index if not exists training_videos_app_id_idx on public.training_videos (app_id);

comment on table public.training_videos is
  'Training Videos: one row per training video LINK (OneDrive / SharePoint). The video itself lives on OneDrive, never here. Staff read the videos of the modules they hold (admins read all); admins write. See 20270104120000.';
comment on column public.training_videos.app_id is
  'The portal module the video teaches, as its app id — the same id app_access grants. A person sees the video only if they hold that module (or are an admin).';

drop trigger if exists trg_training_videos_updated on public.training_videos;
create trigger trg_training_videos_updated
  before update on public.training_videos
  for each row execute function public.set_updated_at();

alter table public.training_videos enable row level security;

drop policy if exists training_videos_select on public.training_videos;
create policy training_videos_select
  on public.training_videos for select
  to authenticated
  using (
    (select public.is_staff((select auth.uid())))
    and (
      (select public.is_admin((select auth.uid())))
      -- the universal apps (apps/universal.ts): every member of staff holds them
      or app_id in ('kra-kpi', 'hr-reports', 'learning-development', 'help-desk', 'training-videos')
      or public.module_level(
           (select auth.uid()),
           case app_id when 'reports' then 'outstanding-dashboard' else app_id end
         ) <> 'none'
    )
  );

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
--
-- Who would see a given module's videos (replace the id):
--
--   select p.name from public.profiles p
--    where coalesce(p.is_external, false) = false
--      and (public.is_admin(p.id) or public.module_level(p.id, 'order-to-dispatch') <> 'none')
--    order by 1;
-- ============================================================================
