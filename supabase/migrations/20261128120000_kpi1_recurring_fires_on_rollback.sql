-- ROLLBACK for 20261128120000_kpi1_recurring_fires_on.sql
--
-- Restores generate_recurring_tasks(p_date) EXACTLY as it was on live before KPI-1: the body
-- between the $fn$ markers below is pg_proc.prosrc as read on 18-09-2026 (md5 of the body
-- 86b031240b6f267a869f9d4de64c81d4), written here by script, not retyped. Then drops
-- recurring_fires_on, which nothing else calls once the generator no longer does.
--
-- ⚠ kpi_report (…_kpi1_facts.sql) also calls recurring_fires_on, and a plpgsql body records
--   no dependency, so nothing stops the drop below: roll that migration back FIRST, or the
--   report fails at its next call.

create or replace function public.generate_recurring_tasks(p_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
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
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;
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
end $fn$;

drop function if exists public.recurring_fires_on(public.recurring_tasks, date);
