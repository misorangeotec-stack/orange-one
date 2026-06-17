-- Stage B — Sunday/public-holiday PREPONING for dated monthly recurring tasks.
--
-- Some recurring tasks have a fixed due day-of-month (e.g. TDS on the 7th, GST on
-- the 21st). When that calendar day falls on a Sunday or a public holiday, the due
-- date must move BACKWARD to the nearest earlier working day. Saturday counts as a
-- working day (only Sundays + listed holidays are skipped).
--
-- This is opt-in per template via the new recurring_tasks.prepone_off_holidays flag,
-- so existing monthly templates (incl. the 1st/15th "physical stock" ones) are
-- unaffected — they keep firing on the exact calendar date.
--
-- Three additive pieces + a behaviour-preserving re-create of the two generators:
--   1. public_holidays            — admin-managed holiday list (seeded for 2026-27)
--   2. public.prev_working_day(d) — walk back over Sundays + holidays
--   3. recurring_tasks.prepone_off_holidays boolean default false
--   4. generate_recurring_tasks() / generate_recurring_task_now() — only the monthly
--      day-of-month branch changes; everything else is copied verbatim from 0016.
--
-- Purely ADDITIVE: no existing table/column/row is mutated. Reuses public.is_admin().
-- Apply on the Orange One identity project (ref coshondiqdhorwvibrwu) in ONE run —
-- the functions reference public_holidays, so the table must exist first.
--
-- Reversal:
--   alter table public.recurring_tasks drop column if exists prepone_off_holidays;
--   drop function if exists public.prev_working_day(date);
--   drop table if exists public.public_holidays;
--   -- then re-apply 0016 to restore the generators.

-- ---------------------------------------------------------------------------
-- 1. public_holidays — admin-managed master list of non-working days.
-- ---------------------------------------------------------------------------
create table if not exists public.public_holidays (
  id            uuid primary key default gen_random_uuid(),
  holiday_date  date not null unique,
  name          text,
  created_at    timestamptz not null default now()
);

comment on table public.public_holidays is
  'Non-working public holidays. A due date landing on one of these (or a Sunday) is preponed to the previous working day for templates with prepone_off_holidays = true.';

alter table public.public_holidays enable row level security;

-- Everyone signed in can read it (the generator runs SECURITY DEFINER and bypasses
-- RLS, but a read policy is useful for any future admin UI). Only admins may write.
drop policy if exists public_holidays_select_all on public.public_holidays;
create policy public_holidays_select_all on public.public_holidays
  for select to authenticated
  using (true);

drop policy if exists public_holidays_write_admin on public.public_holidays;
create policy public_holidays_write_admin on public.public_holidays
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Seed FY 2026-27 (Apr 2026 -> Mar 2027) holidays. ⚠️ REVIEW & CORRECT: festival
-- dates are lunar/observation-based and vary by year and by state/bank list. The
-- fixed-date national holidays are reliable; the rest are best-effort estimates and
-- MUST be verified before the team relies on the preponing. Re-runnable (idempotent).
insert into public.public_holidays (holiday_date, name) values
  ('2026-05-01', 'Maharashtra Day / Labour Day'),       -- fixed
  ('2026-05-27', 'Bakri Id / Eid al-Adha (VERIFY)'),    -- lunar — verify
  ('2026-08-15', 'Independence Day'),                    -- fixed
  ('2026-08-26', 'Raksha Bandhan (VERIFY)'),             -- lunar — verify
  ('2026-09-04', 'Janmashtami (VERIFY)'),                -- lunar — verify
  ('2026-09-14', 'Ganesh Chaturthi (VERIFY)'),           -- lunar — verify
  ('2026-10-02', 'Gandhi Jayanti'),                      -- fixed
  ('2026-10-20', 'Dussehra / Vijayadashami (VERIFY)'),   -- lunar — verify
  ('2026-11-08', 'Diwali (VERIFY)'),                     -- lunar — verify
  ('2026-11-09', 'Govardhan Puja (VERIFY)'),             -- lunar — verify
  ('2026-11-10', 'Bhai Dooj (VERIFY)'),                  -- lunar — verify
  ('2026-12-25', 'Christmas'),                           -- fixed
  ('2027-01-26', 'Republic Day'),                        -- fixed
  ('2027-03-02', 'Holi (VERIFY)')                        -- lunar — verify
on conflict (holiday_date) do nothing;

-- ---------------------------------------------------------------------------
-- 2. prev_working_day — walk backward over Sundays (dow=0) and holidays.
--    Saturday (dow=6) is a working day, so it is a valid landing day.
-- ---------------------------------------------------------------------------
create or replace function public.prev_working_day(d date)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v date := d;
begin
  -- Bounded loop (max ~14 steps) guards against a pathological run of holidays.
  for i in 1..14 loop
    if extract(dow from v)::int = 0                                   -- Sunday
       or exists (select 1 from public.public_holidays h where h.holiday_date = v) then
      v := v - 1;
    else
      return v;
    end if;
  end loop;
  return v;
end $$;

comment on function public.prev_working_day(date) is
  'Returns the given date, or the nearest earlier working day if it is a Sunday or a public_holidays entry. Saturday counts as a working day.';

-- ---------------------------------------------------------------------------
-- 3. Opt-in flag on recurring templates.
-- ---------------------------------------------------------------------------
alter table public.recurring_tasks
  add column if not exists prepone_off_holidays boolean not null default false;

comment on column public.recurring_tasks.prepone_off_holidays is
  'Monthly day-of-month templates only: when true, a due day that lands on a Sunday/public holiday is preponed to the previous working day. Default false = fire on the exact calendar date.';

-- ---------------------------------------------------------------------------
-- 4a. Bulk daily job (cron) — copied verbatim from 0016; only the monthly
--     day-of-month branch gains the prepone path.
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
-- 4b. On-demand single-template generation — copied verbatim from 0016; only the
--     monthly day-of-month branch gains the prepone path. Forced calls (the
--     "Generate now" button) still bypass the firing check entirely.
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
