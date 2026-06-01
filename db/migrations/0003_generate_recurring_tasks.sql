-- Stage B / B4 — recurring-instance generation.
--
-- Materializes real task rows from active recurring templates for a given date.
-- Daily templates fire on weekdays (Mon–Fri); weekly templates fire on the days
-- in weekly_days (0=Sun..6=Sat). Dedup: a template won't double-generate for the
-- same date (keyed on recurring_task_id + due_date), so re-runs are safe.
--
-- SECURITY DEFINER: pg_cron runs with no auth.uid(), so the function inserts on
-- the template owner's behalf (created_by = template.created_by) bypassing RLS.
-- The log_task_activity trigger then logs 'created' with the owner as actor.
--
-- Restricted to postgres / service_role (scheduled job + admin trigger only).
-- Returns the number of tasks created.

create or replace function public.generate_recurring_tasks(p_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
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
      (r.title, r.description, r.assigned_to, r.department_id, p_date, v_week_start, r.created_by, 'pending', r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.generate_recurring_tasks(date) from public;
revoke execute on function public.generate_recurring_tasks(date) from anon, authenticated;
