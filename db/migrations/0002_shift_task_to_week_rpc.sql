-- Stage B / B4 — atomic shift-to-next-week.
--
-- The client previously did the shift as two separate writes (insert the
-- continuation task, then mark the original 'shifted'). This wraps both in one
-- function = one transaction, so a failure can't leave a half-applied shift.
--
-- SECURITY INVOKER (default): RLS still applies to the INSERT (with_check
-- created_by = auth.uid()) and the UPDATE (caller must own/admin/HOD the task),
-- so no privilege escalation — the function only adds atomicity. The
-- log_task_activity trigger fires for both rows (created + shifted) as usual.
--
-- Additive + reversible: `drop function public.shift_task_to_week(uuid, date);`
-- Returns the new continuation task id.

create or replace function public.shift_task_to_week(p_task_id uuid, p_new_due_date date)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_target_week date := (p_new_due_date - ((extract(isodow from p_new_due_date)::int) - 1))::date;
  v_new_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'task not found or not visible';
  end if;

  insert into public.tasks
    (title, description, assigned_to, department_id, due_date, week_start, created_by, status, shifted_from_task_id)
  values
    (v_task.title, v_task.description, v_task.assigned_to, v_task.department_id,
     p_new_due_date, v_target_week, v_actor, 'pending', p_task_id)
  returning id into v_new_id;

  update public.tasks
     set status = 'shifted', shifted_to_task_id = v_new_id
   where id = p_task_id;

  return v_new_id;
end $$;

revoke all on function public.shift_task_to_week(uuid, date) from public;
revoke execute on function public.shift_task_to_week(uuid, date) from anon;
grant execute on function public.shift_task_to_week(uuid, date) to authenticated;
