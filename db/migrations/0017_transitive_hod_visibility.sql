-- 0017_transitive_hod_visibility.sql
--
-- Make HOD visibility transitive (full downline), not just direct reports.
--
-- Problem: an HOD (e.g. Ritesh) could only see the people reporting *directly*
-- to her. Everyone nested under her sub-HODs (e.g. Dimple's employees) was
-- invisible — their profiles, tasks, recurring tasks and weekly plans were all
-- hidden by RLS. The frontend's downline walk is already transitive; the gap was
-- entirely in the database, in two places:
--
--   1. public.is_hod_of(_hod, _employee) tested a SINGLE user_hods edge, so it was
--      true only for direct reports. It is used by profiles_select, tasks_select,
--      task_activity, task_locations, recurring_* and weekly_plans_* policies plus
--      the add_task_remark / generate_recurring_task_now RPCs — so every one of
--      those stopped at one level.
--   2. user_hods_select only exposed edges where the viewer was the hod_id or the
--      employee_id, so the browser never received the (sub-HOD -> employee) edges
--      and the frontend's BFS had nothing to traverse past the first level.
--
-- Fix (additive / logic-only — no table or data changes):
--   * Redefine is_hod_of to walk the reporting chain (recursive CTE, like the
--     existing is_in_subtree helper), so it is true for ANY descendant. This alone
--     fixes profiles, tasks, recurring, activity, locations and weekly plans, since
--     they all already call is_hod_of.
--   * Widen user_hods_select so an HOD can also read every edge inside their
--     downline, letting the frontend reconstruct the full subtree.
--
-- Self is excluded (the walk starts at the HOD's direct reports), preserving the
-- old invariant that a person is never their own HOD. depth < 10 guards cycles.

begin;

create or replace function public.is_hod_of(_hod uuid, _employee uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive downline(id, depth) as (
    -- direct reports of _hod
    select employee_id, 1
    from public.user_hods
    where hod_id = _hod
    union all
    -- ...and everyone nested under them, transitively
    select uh.employee_id, d.depth + 1
    from public.user_hods uh
    join downline d on uh.hod_id = d.id
    where d.depth < 10
  )
  select exists (select 1 from downline where id = _employee);
$$;

-- Let an HOD read the reporting edges for their whole downline (not just the
-- edges that point straight at them), so the frontend can rebuild the subtree.
drop policy if exists user_hods_select on public.user_hods;
create policy user_hods_select on public.user_hods
  for select to authenticated
  using (
    employee_id = auth.uid()
    or hod_id = auth.uid()
    or public.is_hod_of(auth.uid(), hod_id)   -- any edge whose HOD is in my downline
    or public.is_admin(auth.uid())
  );

commit;
