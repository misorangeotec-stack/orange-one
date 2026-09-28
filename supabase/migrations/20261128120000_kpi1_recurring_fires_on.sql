-- KPI-1 · recurring_fires_on — the generator's own "does this template fire on this date?"
--
-- WHY. The KRA / KPI scorecard shows next week's PLANNED Task Management work, and next
-- week is almost empty in `tasks`: `generate-recurring-daily` (00:30 UTC) mints recurring
-- instances ONE DAY AT A TIME, so on 18-09-2026 the week of 21–27 Sep held 13 tasks against
-- 415 in the running week. The plan has to be projected from `recurring_tasks` — by asking
-- exactly the question the generator asks. That question lived INLINE in
-- generate_recurring_tasks(p_date); a second copy for the projection is how the two would
-- drift. So it moves into one function, and the generator calls it.
--
-- A REFACTOR, NOT A CHANGE. The test below is the live generator's inline block, moved
-- verbatim — built from pg_proc.prosrc on 18-09-2026, NOT from an older migration file (the
-- live copy can be ahead of the repo). The generator is re-created with that block replaced
-- by one call, and is otherwise identical: same declarations, same dedup, same insert, same
-- location copy, same count. Two changes only, both forced by the move:
--   · `r` is declared as a recurring_tasks row instead of `record`, so it can be passed to
--     a function taking that row type;
--   · the date parts the old block used (dow, isodow, day, last day, quarter end) are now
--     computed inside recurring_fires_on. The generator keeps v_isodow and v_week_start,
--     which the insert still needs.
--
-- PROVED BEFORE IT WAS APPLIED, in rolled-back transactions on live, 18-09-2026:
--   · the old inline test (verbatim, as a scratch function) and recurring_fires_on agree for
--     EVERY template × every day from 120 days back to 120 days ahead;
--   · the old generator and this one, each run for the next 45 days, insert the identical set
--     of tasks (template, due date, title, description, assignee, department, week, creator).
--   See WORKLIST.md → KPI-1 for the figures.
--
-- Additive otherwise. Rollback: …_kpi1_recurring_fires_on_rollback.sql restores the generator
-- from the same prosrc, verbatim, and drops the function.

create or replace function public.recurring_fires_on(r public.recurring_tasks, p_date date)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_dow int := extract(dow from p_date)::int;       -- 0=Sun..6=Sat
  v_isodow int := extract(isodow from p_date)::int; -- 1=Mon..7=Sun
  v_day int := extract(day from p_date)::int;       -- day of month
  v_last_day date := (date_trunc('month', p_date) + interval '1 month' - interval '1 day')::date;
  v_q_end date := (date_trunc('quarter', p_date) + interval '3 months' - interval '1 day')::date;
begin
  -- Does this template fire on p_date?
  if r.recurrence_type = 'daily' then
    if v_isodow > 6 then return false; end if;                 -- Mon–Sat (skip Sunday)
  elsif r.recurrence_type = 'when' then
    if v_isodow > 6 then return false; end if;                 -- Mon–Sat (skip Sunday)
  elsif r.recurrence_type = 'weekly' then
    if not (v_dow = any(coalesce(r.weekly_days, '{}'::int[]))) then return false; end if;
  elsif r.recurrence_type = 'monthly' then
    if r.monthly_weekday is not null then
      -- Nth-weekday mode: the date is the Nth <weekday> when its dow matches and
      -- it falls in the Nth 7-day block of the month (days 1–7 = 1st, 8–14 = 2nd…).
      if not (v_dow = r.monthly_weekday and ((v_day - 1) / 7 + 1) = r.monthly_nth) then return false; end if;
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
      ) then return false; end if;
    else
      -- Day-of-month mode, exact date (no preponing).
      if not (
        v_day = any(coalesce(r.monthly_days, '{}'::int[]))
        or (32 = any(coalesce(r.monthly_days, '{}'::int[])) and p_date = v_last_day)
      ) then return false; end if;
    end if;
  elsif r.recurrence_type = 'quarterly' then
    if p_date <> (v_q_end - 7) then return false; end if;       -- 7 days before quarter-end
  else
    return false;                                               -- unknown type
  end if;
  return true;
end $$;

comment on function public.recurring_fires_on(public.recurring_tasks, date) is
  'Does this recurring template fire on this date? The ONE copy of the rule: generate_recurring_tasks '
  'mints tasks with it, and the KRA / KPI scorecard (kpi_report) projects next period''s planned work '
  'with it. It does not look at `active`; callers filter that. KPI-1, 18-09-2026.';

revoke all on function public.recurring_fires_on(public.recurring_tasks, date) from public, anon, authenticated;

create or replace function public.generate_recurring_tasks(p_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r public.recurring_tasks;
  v_task_id uuid;
  v_isodow int := extract(isodow from p_date)::int; -- 1=Mon..7=Sun
  v_week_start date := (p_date - (v_isodow - 1))::date;
begin
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  for r in select * from public.recurring_tasks where active loop
    -- Does this template fire on p_date? (The rule lives in recurring_fires_on — KPI-1.)
    if not public.recurring_fires_on(r, p_date) then
      continue;
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
