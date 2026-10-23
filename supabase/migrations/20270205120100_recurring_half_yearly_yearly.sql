-- Recurring Half-yearly / Yearly · 2 of 2 — the month, the rule, the reminder.
--
-- WHAT (the user, 21-10-2026). Task Management → Recurring → New gets two more frequencies,
-- Half-yearly and Yearly, each with the same "when" choices as Monthly — "On the Nth weekday"
-- (e.g. 1st Saturday) or "On specific dates" (incl. Last day of month) — plus a month, and the
-- same "Notification required" reminder.
--   · Yearly      — fires in ONE month a year:            yearly_month = 4  → April only.
--   · Half-yearly — fires in that month and 6 months on:  yearly_month = 4  → April + October.
--
-- HOW.
--   · recurring_tasks.yearly_month smallint (1..12). Null on every other frequency; existing
--     rows are untouched.
--   · recurring_fires_on gains ONE branch for half_yearly/yearly: the month must match, then
--     the day test is Monthly's, unchanged (Nth weekday / exact dates / prepone). Every other
--     branch is copied verbatim from 20261128120000 (the only definition since). Because the
--     cron generator AND send_recurring_reminders both ask recurring_fires_on, both pick the
--     new types up with no change to their own bodies.
--   · With prepone_off_holidays a target date can be preponed into the PREVIOUS month (1 Apr
--     on a Sunday → 31 Mar), so for the new types the prepone test looks at targets in p_date's
--     month and the next one, checking the month on the TARGET, never on p_date.
--   · send_recurring_reminders: the type filter gains the two values (text patch, shape-checked).
--   · generate_recurring_task_now (the on-save "is it today?" check, not forced): its inline
--     test returned null for any type it did not know; it now asks recurring_fires_on for the
--     two new ones (text patch, shape-checked). Its `r` is a `record`, so the row is re-read.
--   · notify_recurring_assignee: the assignment email says "Repeats half-yearly / yearly"
--     instead of falling back to "Recurring task" (text patch, shape-checked).
--
-- Run 20270205120000 (enum values) FIRST, on its own. The new values are compared as ::text
-- everywhere here, so this file never "uses" them in the enum sense and stays safe to test in
-- the same (rolled-back) transaction as the ADD VALUE.
-- Rollback: 20270205120100_recurring_half_yearly_yearly_rollback.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1 · The month.
-- ---------------------------------------------------------------------------
alter table public.recurring_tasks
  add column if not exists yearly_month smallint;

alter table public.recurring_tasks
  drop constraint if exists recurring_tasks_yearly_month_check;
alter table public.recurring_tasks
  add constraint recurring_tasks_yearly_month_check
  check (yearly_month is null or yearly_month between 1 and 12);

comment on column public.recurring_tasks.yearly_month is
  'Yearly: the month it fires in (1..12). Half-yearly: the first of its two months (it also fires '
  '6 months later). Null for every other frequency. The day inside the month uses monthly_days or '
  'monthly_nth + monthly_weekday, exactly as Monthly.';

-- ---------------------------------------------------------------------------
-- 2 · The rule.
-- ---------------------------------------------------------------------------
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
  v_month int := extract(month from p_date)::int;   -- 1..12
  v_last_day date := (date_trunc('month', p_date) + interval '1 month' - interval '1 day')::date;
  v_q_end date := (date_trunc('quarter', p_date) + interval '3 months' - interval '1 day')::date;
  v_period int;                                     -- 12 = yearly, 6 = half-yearly
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
  elsif r.recurrence_type::text in ('half_yearly', 'yearly') then
    -- Monthly's day test, in the template's month(s) only (yearly_month, and +6 for half-yearly).
    if r.yearly_month is null then return false; end if;
    v_period := case when r.recurrence_type::text = 'yearly' then 12 else 6 end;
    if r.monthly_weekday is not null then
      if (v_month - r.yearly_month + 12) % v_period <> 0 then return false; end if;
      if not (v_dow = r.monthly_weekday and ((v_day - 1) / 7 + 1) = r.monthly_nth) then return false; end if;
    elsif r.prepone_off_holidays then
      -- A target can be preponed back across a month end, so try targets in this month
      -- and the next, and check the month on the TARGET.
      if not exists (
        select 1
        from (values (date_trunc('month', p_date)::date),
                     ((date_trunc('month', p_date) + interval '1 month')::date)) as m(first_day)
        cross join lateral (
          select make_date(extract(year from m.first_day)::int, extract(month from m.first_day)::int, md) as target
          from unnest(coalesce(r.monthly_days, '{}'::int[])) as md
          where md between 1 and 31
            and md <= extract(day from (m.first_day + interval '1 month' - interval '1 day'))::int
          union all
          select (m.first_day + interval '1 month' - interval '1 day')::date
          where 32 = any(coalesce(r.monthly_days, '{}'::int[]))
        ) t
        where (extract(month from t.target)::int - r.yearly_month + 12) % v_period = 0
          and public.prev_working_day(t.target) = p_date
      ) then return false; end if;
    else
      if (v_month - r.yearly_month + 12) % v_period <> 0 then return false; end if;
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
  'with it. It does not look at `active`; callers filter that. KPI-1, 18-09-2026; half-yearly / '
  'yearly 21-10-2026.';

revoke all on function public.recurring_fires_on(public.recurring_tasks, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Reminders for the two new types, and Generate-now's on-save check.
--     Text patches on the LIVE bodies; each refuses to run if the shape is not
--     what this file expects.
-- ---------------------------------------------------------------------------
do $fn$
declare
  v_src text;
  v_new text;
begin
  -- 3a · send_recurring_reminders: the type filter.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_recurring_reminders';
  v_new := replace(v_src,
             'recurrence_type::text in (''weekly'', ''monthly'', ''quarterly'')',
             'recurrence_type::text in (''weekly'', ''monthly'', ''quarterly'', ''half_yearly'', ''yearly'')');
  if v_src is null or v_new = v_src then
    raise exception 'Half-yearly/Yearly step 3a: send_recurring_reminders did not match the expected shape -- read the live body and update this transform rather than forcing it';
  end if;
  execute v_new;

  -- 3b · generate_recurring_task_now: the non-forced firing check.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'generate_recurring_task_now';
  if v_src is null
     or (length(v_src) - length(replace(v_src, 'elsif r.recurrence_type = ''quarterly'' then', '')))
        <> length('elsif r.recurrence_type = ''quarterly'' then') then
    raise exception 'Half-yearly/Yearly step 3b: generate_recurring_task_now did not match the expected shape -- read the live body and update this transform rather than forcing it';
  end if;
  v_new := replace(v_src,
             'elsif r.recurrence_type = ''quarterly'' then',
             'elsif r.recurrence_type::text in (''half_yearly'', ''yearly'') then
      if not public.recurring_fires_on((select rt from public.recurring_tasks rt where rt.id = r.id), v_date) then return null; end if;
    elsif r.recurrence_type = ''quarterly'' then');
  execute v_new;

  -- 3c · notify_recurring_assignee: the "Repeats …" line of the assignment email.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_recurring_assignee';
  v_new := replace(v_src,
             'when ''quarterly'' then ''Repeats quarterly''',
             'when ''quarterly'' then ''Repeats quarterly''
    when ''half_yearly'' then ''Repeats half-yearly''
    when ''yearly''    then ''Repeats yearly''');
  if v_src is null or v_new = v_src then
    raise exception 'Half-yearly/Yearly step 3c: notify_recurring_assignee did not match the expected shape -- read the live body and update this transform rather than forcing it';
  end if;
  execute v_new;
end
$fn$;

commit;
