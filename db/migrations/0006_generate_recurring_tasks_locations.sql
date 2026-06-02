-- Stage B — recurring-instance generation now copies the template's locations.
--
-- `create or replace` of public.generate_recurring_tasks (original def in
-- db/migrations/0003_generate_recurring_tasks.sql). Unchanged behaviour for
-- firing/dedup; the only addition is: after inserting a generated task, copy the
-- template's recurring_task_locations into task_locations so the new task carries
-- its location checklist. Templates with no locations generate plain tasks as before.
--
-- SECURITY DEFINER (pg_cron has no auth.uid()), so the task_locations inserts
-- bypass RLS — fine, the function only ever copies the template's own locations.
-- Restricted to postgres / service_role (scheduled job + admin trigger only).
-- Returns the number of tasks created.
--
-- Apply AFTER 20260602090000_add_task_locations.sql (it references task_locations
-- and recurring_task_locations).

create or replace function public.generate_recurring_tasks(p_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
  v_task_id uuid;
  v_dow int := extract(dow from p_date)::int;       -- 0=Sun..6=Sat
  v_isodow int := extract(isodow from p_date)::int; -- 1=Mon..7=Sun
  v_week_start date := (p_date - (v_isodow - 1))::date;
begin
  for r in select * from public.recurring_tasks where active loop
    -- Does this template fire on p_date?
    if r.recurrence_type = 'daily' then
      if v_isodow > 5 then continue; end if;                 -- weekdays only
    elsif r.recurrence_type = 'weekly' then
      if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then continue; end if;
    else
      continue;                                               -- unknown type
    end if;

    -- Dedup: skip if this template already generated a task for this date.
    if exists (select 1 from public.tasks where recurring_task_id = r.id and due_date = p_date) then
      continue;
    end if;

    insert into public.tasks
      (title, description, assigned_to, department_id, due_date, week_start, created_by, status, recurring_task_id)
    values
      (r.title, r.description, r.assigned_to, r.department_id, p_date, v_week_start, r.created_by, 'pending', r.id)
    returning id into v_task_id;

    -- Copy the template's locations onto the generated task as a checklist.
    insert into public.task_locations (task_id, location_id)
    select v_task_id, rtl.location_id
    from public.recurring_task_locations rtl
    where rtl.recurring_task_id = r.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.generate_recurring_tasks(date) from public;
revoke execute on function public.generate_recurring_tasks(date) from anon, authenticated;
