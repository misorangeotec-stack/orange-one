-- Stage B — add a `force` flag to generate_recurring_task_now.
--
-- 0007 only generated today's instance when the template fires today (daily =
-- weekdays only, weekly = its weekly_days). That's right for the automatic
-- save/activate paths, but the manual "Generate now" button needs to work ANY
-- day / ANY time — e.g. an admin generating a daily template's task on a weekend.
--
-- This replaces the function with a 2-arg version: p_force defaults to false, so
-- the existing automatic callers (which pass only p_recurring_id) are unchanged
-- and still respect the schedule. When p_force = true the firing-day check is
-- skipped and today's instance is generated regardless of the day of week. The
-- permission guard, the active check, and the dedup are unchanged either way — a
-- forced call on a paused template still no-ops, and it never double-creates.
--
-- create or replace cannot change the parameter list, so drop the 1-arg version
-- (from 0007) first. Apply AFTER 0007. Purely additive.
--
-- Reversal: drop function if exists public.generate_recurring_task_now(uuid, boolean);
--           then re-apply 0007 to restore the 1-arg version.

drop function if exists public.generate_recurring_task_now(uuid);

create or replace function public.generate_recurring_task_now(
  p_recurring_id uuid,
  p_force boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_task_id uuid;
  v_date date := current_date;
  v_dow int := extract(dow from current_date)::int;       -- 0=Sun..6=Sat
  v_isodow int := extract(isodow from current_date)::int; -- 1=Mon..7=Sun
  v_week_start date := (current_date - (extract(isodow from current_date)::int - 1))::date;
begin
  select * into r from public.recurring_tasks where id = p_recurring_id;
  if not found then
    return null;
  end if;

  -- Permission guard (SECURITY DEFINER bypasses RLS, so enforce it here): only the
  -- template's creator, an admin, or the assignee's HOD may trigger generation.
  if not (
    r.created_by = auth.uid()
    or public.is_admin(auth.uid())
    or (r.assigned_to is not null and public.is_hod_of(auth.uid(), r.assigned_to))
  ) then
    raise exception 'Not authorized to generate this recurring task';
  end if;

  -- A paused template never generates, even when forced.
  if not r.active then
    return null;
  end if;

  -- Does this template fire today? Skipped entirely when forced (the manual
  -- "Generate now" button is allowed to create today's task on any day).
  if not p_force then
    if r.recurrence_type = 'daily' then
      if v_isodow > 5 then return null; end if;               -- weekdays only
    elsif r.recurrence_type = 'weekly' then
      if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then return null; end if;
    else
      return null;                                             -- unknown type
    end if;
  end if;

  -- Idempotent: reuse today's instance if the cron job or a prior call made it.
  select id into v_task_id
  from public.tasks
  where recurring_task_id = r.id and due_date = v_date
  limit 1;
  if found then
    return v_task_id;
  end if;

  insert into public.tasks
    (title, description, assigned_to, department_id, due_date, week_start, created_by, status, recurring_task_id)
  values
    (r.title, r.description, r.assigned_to, r.department_id, v_date, v_week_start, r.created_by, 'pending', r.id)
  returning id into v_task_id;

  -- Copy the template's locations onto the generated task as a checklist.
  insert into public.task_locations (task_id, location_id)
  select v_task_id, rtl.location_id
  from public.recurring_task_locations rtl
  where rtl.recurring_task_id = r.id;

  return v_task_id;
end $$;

revoke all on function public.generate_recurring_task_now(uuid, boolean) from public;
grant execute on function public.generate_recurring_task_now(uuid, boolean) to authenticated;
