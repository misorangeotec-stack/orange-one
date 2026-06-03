-- Task Management / Identity — per-user "last active" timestamp.
--
-- Lets admins (Users + Hierarchy tabs) and HODs (Team Tasks, scoped to their
-- direct reports) see when each user last opened the portal — a simple usage
-- signal for "who is actually using this app".
--
-- Capture: the frontend calls public.touch_last_active() once per app open /
-- login (auth.tsx). That stamps profiles.last_active_at = now() for the caller
-- only. We use a SECURITY DEFINER function (mirroring public.add_task_remark)
-- so a user can update their OWN row without needing a new RLS UPDATE policy on
-- profiles — the function self-authorizes via auth.uid().
--
-- Read: last_active_at rides on the existing RLS-gated profiles SELECT the live
-- directory already loads, so no new read policy is needed. Admins see all
-- profiles; a HOD sees their team; an employee sees no admin/team surface.
--
-- Purely ADDITIVE (see the additive-only Supabase rule): one new nullable
-- column + one function. No existing table/column/row is mutated. Apply in the
-- Orange One project (ref coshondiqdhorwvibrwu) via the SQL editor or
-- `supabase db push`, BEFORE the frontend ships (the directory load selects the
-- new column; the RPC no-ops harmlessly if the frontend is older).
--
-- NOTE: if profiles has an updated_at auto-touch trigger, this bumps updated_at
-- on every login too. That is harmless and intentional (out of scope to exclude).
--
-- Reversal:
--   drop function if exists public.touch_last_active();
--   alter table public.profiles drop column if exists last_active_at;

-- ---------------------------------------------------------------------------
-- 1. Column — when the user last opened the app (null = never seen since this shipped).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_active_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. RPC — stamp the caller's own last_active_at. Self-authorized via auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.touch_last_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles set last_active_at = now() where id = v_uid;
end $$;

revoke execute on function public.touch_last_active() from anon;
grant execute on function public.touch_last_active() to authenticated;
