-- 0022_org_people_directory.sql
--
-- Org-wide, name-only people directory for @mentions in task remarks / activity.
--
-- Problem: the profiles_select RLS policy only exposes a non-admin's
--   self + downline (is_hod_of) + same-department peers (same_department).
-- So a HOD — or anyone — could NOT @mention their senior in another department,
-- nor any cross-department colleague, in a remark: those people never reached the
-- browser, so the mention autocomplete had no name to suggest. (The
-- add_task_remark RPC already fans a notification out to ANY existing user, so the
-- only gap was the client not knowing who exists.)
--
-- Fix (additive, logic-only): a SECURITY DEFINER reader that returns ONLY
-- non-sensitive identity fields (id, name, designation, department_id,
-- avatar_color, role) for EVERY profile, so the whole org is mentionable. It
-- deliberately omits phone and email — a user's phone doubles as their initial
-- login password, so it must never be exposed org-wide. The profiles_select
-- policy itself is left untouched; this is a narrow read for the mention picker
-- only, and grants nothing to anon.
--
-- Reversible:  drop function public.list_org_people();

begin;

create or replace function public.list_org_people()
returns table (
  id uuid,
  name text,
  designation text,
  department_id uuid,
  avatar_color text,
  role text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.designation,
    p.department_id,
    p.avatar_color,
    coalesce(
      (
        select r.role::text
        from public.user_roles r
        where r.user_id = p.id
        order by case r.role
                   when 'admin'   then 4
                   when 'hod'     then 3
                   when 'sub_hod' then 2
                   else 1
                 end desc
        limit 1
      ),
      'employee'
    ) as role
  from public.profiles p
  where auth.uid() is not null   -- authenticated callers only
  order by p.name;
$$;

revoke all on function public.list_org_people() from public;
revoke execute on function public.list_org_people() from anon;
grant execute on function public.list_org_people() to authenticated;

commit;
