-- Stage B — add MONTHLY recurrence (generation part).
--
-- Replaces both generators so they fire monthly templates. A monthly template
-- fires on p_date when extract(day from p_date) is in monthly_days, OR when
-- monthly_days contains 32 (the "last day" sentinel) and p_date is the last day
-- of its month. Monthly fires on the exact calendar date, weekends included
-- (unlike daily, which is weekdays only) — a specific day-of-month is the point.
--
-- Dedup and the location-checklist copy are unchanged. Apply AFTER 0009 (which
-- adds the 'monthly' enum value + monthly_days column) — and apply 0009 in a
-- separate run first (see its header). Purely additive: this is create-or-replace
-- of the two existing functions, no schema/data mutation.
--
-- Reversal: re-apply 0006 (restores generate_recurring_tasks without monthly) and
-- 0008 (restores generate_recurring_task_now without monthly).

-- ---------------------------------------------------------------------------
-- 1. Bulk daily job (cron) — now also fires monthly templates.
-- ---------------------------------------------------------------------------
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
  v_day int := extract(day from p_date)::int;       -- day of month
  v_week_start date := (p_date - (v_isodow - 1))::date;
  v_last_day date := (date_trunc('month', p_date) + interval '1 month' - interval '1 day')::date;
begin
  for r in select * from public.recurring_tasks where active loop
    -- Does this template fire on p_date?
    if r.recurrence_type = 'daily' then
      if v_isodow > 5 then continue; end if;                 -- weekdays only
    elsif r.recurrence_type = 'weekly' then
      if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then continue; end if;
    elsif r.recurrence_type = 'monthly' then
      if not (
        v_day = any(coalesce(r.monthly_days, '{}'::int[]))
        or (32 = any(coalesce(r.monthly_days, '{}'::int[])) and p_date = v_last_day)
      ) then continue; end if;
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

-- ---------------------------------------------------------------------------
-- 2. On-demand single-template generation — monthly added to the firing check.
--    Forced calls (the "Generate now" button) still bypass the firing check.
-- ---------------------------------------------------------------------------
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
  v_day int := extract(day from current_date)::int;       -- day of month
  v_week_start date := (current_date - (extract(isodow from current_date)::int - 1))::date;
  v_last_day date := (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date;
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
    elsif r.recurrence_type = 'monthly' then
      if not (
        v_day = any(coalesce(r.monthly_days, '{}'::int[]))
        or (32 = any(coalesce(r.monthly_days, '{}'::int[])) and v_date = v_last_day)
      ) then return null; end if;
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
