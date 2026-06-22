-- Stage B — durable "this task came from a recurring template" flag.
--
-- PROBLEM: a generated task instance is recognised as "recurring" only by its
-- tasks.recurring_task_id FK back to the template. That FK is ON DELETE SET NULL,
-- so deleting a recurring template AFTER its instances were generated nulls the
-- link on those instances — and they silently reclassify as one-off (e.g. tasks
-- already created for the week, then the template was removed). The Weekly
-- Scorecard's recurring-vs-one-off split then mis-buckets them.
--
-- FIX: stamp a durable boolean on each task at generation time. Deleting the
-- template later cannot flip it, so a task that was born recurring stays counted
-- as recurring forever (including completed ones we keep for history).
--
-- Two additive pieces + a behaviour-preserving re-create of the two generators:
--   1. tasks.from_recurring boolean default false
--   2. generate_recurring_tasks() / generate_recurring_task_now() — copied VERBATIM
--      from 0020; the ONLY change is the INSERT now also sets from_recurring = true.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Existing rows keep the
-- default false; the frontend treats a task as recurring when from_recurring is true
-- OR recurring_task_id is still set, so live-template instances are unaffected in the
-- interim (only template-deleted orphans created BEFORE this migration stay one-off,
-- which is unrecoverable — the link is already gone).
--
-- Apply on the Orange One identity project (ref coshondiqdhorwvibrwu).
--
-- Reversal:
--   alter table public.tasks drop column if exists from_recurring;
--   -- then re-apply 0020 to restore the generators.

-- ---------------------------------------------------------------------------
-- 1. Durable provenance flag on generated tasks.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists from_recurring boolean not null default false;

comment on column public.tasks.from_recurring is
  'True when this task was generated from a recurring template. Set once at generation time and never cleared, so the task stays classified as recurring even if its template (and the recurring_task_id link) is later deleted.';

-- ---------------------------------------------------------------------------
-- 2a. Bulk daily job (cron) — copied verbatim from 0020; the ONLY change is the
--     INSERT column list / values gain from_recurring = true.
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
      if v_isodow > 5 then continue; end if;                 -- weekdays only (Mon–Fri)
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
      (title, description, assigned_to, department_id, due_date, week_start, created_by, status, recurring_task_id, from_recurring)
    values
      (r.title, r.description, r.assigned_to, r.department_id, p_date, v_week_start, r.created_by, 'pending', r.id, true)
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
-- 2b. On-demand single-template generation — copied verbatim from 0020; the ONLY
--     change is the INSERT column list / values gain from_recurring = true.
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
      if v_isodow > 5 then return null; end if;               -- weekdays only (Mon–Fri)
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
    (title, description, assigned_to, department_id, due_date, week_start, created_by, status, recurring_task_id, from_recurring)
  values
    (r.title, r.description, r.assigned_to, r.department_id, v_date, v_week_start, r.created_by, 'pending', r.id, true)
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

-- ---------------------------------------------------------------------------
-- 3. Shift-to-next-week — copied verbatim from 0002; the ONLY change is the
--    continuation task inherits the source task's from_recurring, so shifting a
--    recurring task keeps the continuation classified as recurring. (We do NOT
--    copy recurring_task_id — that stays null so the continuation never collides
--    with the template's per-date generation dedup.)
-- ---------------------------------------------------------------------------
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
    (title, description, assigned_to, department_id, due_date, week_start, created_by, status, shifted_from_task_id, from_recurring)
  values
    (v_task.title, v_task.description, v_task.assigned_to, v_task.department_id,
     p_new_due_date, v_target_week, v_actor, 'pending', p_task_id, v_task.from_recurring)
  returning id into v_new_id;

  update public.tasks
     set status = 'shifted', shifted_to_task_id = v_new_id
   where id = p_task_id;

  return v_new_id;
end $$;

revoke all on function public.shift_task_to_week(uuid, date) from public;
revoke execute on function public.shift_task_to_week(uuid, date) from anon;
grant execute on function public.shift_task_to_week(uuid, date) to authenticated;
