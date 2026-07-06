-- Daily recurring tasks must fire on SATURDAY too.
--
-- Orange O Tec works a Mon–Sat week (only Sundays + listed public_holidays are
-- non-working — see prev_working_day() in 0020). But the 'daily' recurrence type
-- was generating tasks Mon–Fri only (isodow 1..5), so every daily template silently
-- skipped Saturdays. Staff saw daily/recurring tasks Monday–Friday and nothing on
-- Saturday.
--
-- Fix: 'daily' now fires Mon–Sat (skip only Sunday, isodow 7) — the same window as
-- the 'when' type. Everything else in both generators is copied verbatim from 0020
-- (holiday-prepone monthly branch, quarterly, weekly, dedup, location copy, perms).
--
-- Purely a function re-create: no table/column/row is touched. Idempotent; the
-- per-date dedup guard means re-running for a past date creates no duplicates.
-- Apply on the Orange One identity project (ref coshondiqdhorwvibrwu).
--
-- Reversal: re-apply 0020 to restore the Mon–Fri behaviour.

-- ---------------------------------------------------------------------------
-- Bulk daily job (cron).
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
  v_q_end date := (date_trunc('quarter', p_date) + interval '3 months' - interval '1 day')::date;
begin
  for r in select * from public.recurring_tasks where active loop
    -- Does this template fire on p_date?
    if r.recurrence_type = 'daily' then
      if v_isodow > 6 then continue; end if;                 -- Mon–Sat (skip Sunday)
    elsif r.recurrence_type = 'when' then
      if v_isodow > 6 then continue; end if;                 -- Mon–Sat (skip Sunday)
    elsif r.recurrence_type = 'weekly' then
      if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then continue; end if;
    elsif r.recurrence_type = 'monthly' then
      if r.monthly_weekday is not null then
        -- Nth-weekday mode: the date is the Nth <weekday> when its dow matches and
        -- it falls in the Nth 7-day block of the month (days 1–7 = 1st, 8–14 = 2nd…).
        if not (v_dow = r.monthly_weekday and ((v_day - 1) / 7 + 1) = r.monthly_nth) then continue; end if;
      elsif r.prepone_off_holidays then
        -- Day-of-month mode WITH preponing: fire when p_date is the previous working
        -- day of any target day-of-month for this month (Saturday is a working day).
        if not (
          exists (
            select 1 from unnest(coalesce(r.monthly_days, '{}'::int[])) as md
            where md between 1 and 31
              and md <= extract(day from v_last_day)::int
              and public.prev_working_day(
                    make_date(extract(year from p_date)::int, extract(month from p_date)::int, md)
                  ) = p_date
          )
          or (32 = any(coalesce(r.monthly_days, '{}'::int[]))
              and public.prev_working_day(v_last_day) = p_date)
        ) then continue; end if;
      else
        -- Day-of-month mode, exact date (no preponing).
        if not (
          v_day = any(coalesce(r.monthly_days, '{}'::int[]))
          or (32 = any(coalesce(r.monthly_days, '{}'::int[])) and p_date = v_last_day)
        ) then continue; end if;
      end if;
    elsif r.recurrence_type = 'quarterly' then
      if p_date <> (v_q_end - 7) then continue; end if;       -- 7 days before quarter-end
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
-- On-demand single-template generation.
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
  v_q_end date := (date_trunc('quarter', current_date) + interval '3 months' - interval '1 day')::date;
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
      if v_isodow > 6 then return null; end if;               -- Mon–Sat (skip Sunday)
    elsif r.recurrence_type = 'when' then
      if v_isodow > 6 then return null; end if;               -- Mon–Sat (skip Sunday)
    elsif r.recurrence_type = 'weekly' then
      if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then return null; end if;
    elsif r.recurrence_type = 'monthly' then
      if r.monthly_weekday is not null then
        if not (v_dow = r.monthly_weekday and ((v_day - 1) / 7 + 1) = r.monthly_nth) then return null; end if;
      elsif r.prepone_off_holidays then
        if not (
          exists (
            select 1 from unnest(coalesce(r.monthly_days, '{}'::int[])) as md
            where md between 1 and 31
              and md <= extract(day from v_last_day)::int
              and public.prev_working_day(
                    make_date(extract(year from current_date)::int, extract(month from current_date)::int, md)
                  ) = v_date
          )
          or (32 = any(coalesce(r.monthly_days, '{}'::int[]))
              and public.prev_working_day(v_last_day) = v_date)
        ) then return null; end if;
      else
        if not (
          v_day = any(coalesce(r.monthly_days, '{}'::int[]))
          or (32 = any(coalesce(r.monthly_days, '{}'::int[])) and v_date = v_last_day)
        ) then return null; end if;
      end if;
    elsif r.recurrence_type = 'quarterly' then
      if v_date <> (v_q_end - 7) then return null; end if;     -- 7 days before quarter-end
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
