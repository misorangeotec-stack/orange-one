-- Stage B — on-demand generation of TODAY's instance for one recurring template.
--
-- Problem this solves: creating (or re-activating) a recurring template only
-- inserts the template row. Real task rows are materialised by the daily pg_cron
-- job (generate_recurring_tasks, see 0003/0004) at 06:00 IST. So a template made
-- AFTER that run produces nothing until the next morning, and feels broken.
--
-- This function lets the app generate the current day's instance for a single
-- template immediately on save/activate. Same firing rules and dedup as the bulk
-- job; idempotent — if today's instance already exists (cron or a prior call) it
-- returns that task's id instead of inserting a duplicate.
--
-- Unlike generate_recurring_tasks (cron/service-role only), this is callable by
-- authenticated users, so it is SECURITY DEFINER with an EXPLICIT permission
-- guard mirroring the recurring_tasks write RLS (owner / admin / HOD-of-assignee)
-- — the definer rights bypass RLS, so the guard must be in the body.
--
-- The generated task keeps created_by = template owner (matching the cron job, so
-- the log_task_activity trigger attributes 'created' to the owner), and copies the
-- template's recurring_task_locations into task_locations as the checklist.
--
-- Returns the task id (new or pre-existing), or null when the template does not
-- fire today / is inactive / is unknown.
--
-- Apply AFTER 0006_generate_recurring_tasks_locations.sql and
-- 20260602090000_add_task_locations.sql (references task_locations +
-- recurring_task_locations). Purely additive.
--
-- Reversal:  drop function if exists public.generate_recurring_task_now(uuid);

create or replace function public.generate_recurring_task_now(p_recurring_id uuid)
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

  if not r.active then
    return null;
  end if;

  -- Does this template fire today? (same rules as generate_recurring_tasks)
  if r.recurrence_type = 'daily' then
    if v_isodow > 5 then return null; end if;                 -- weekdays only
  elsif r.recurrence_type = 'weekly' then
    if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then return null; end if;
  else
    return null;                                               -- unknown type
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

revoke all on function public.generate_recurring_task_now(uuid) from public;
grant execute on function public.generate_recurring_task_now(uuid) to authenticated;
