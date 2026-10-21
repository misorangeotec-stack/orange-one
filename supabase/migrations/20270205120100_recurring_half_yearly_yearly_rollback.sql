-- Rollback of 20270205120100_recurring_half_yearly_yearly.sql.
--
-- Restores recurring_fires_on to its 20261128120000 body (verbatim), takes the two types back
-- out of send_recurring_reminders and generate_recurring_task_now, and drops yearly_month.
-- The enum values from 20270205120000 stay (Postgres cannot drop them). Any template still
-- saved as half_yearly / yearly then never fires (recurring_fires_on → "unknown type") —
-- edit or pause those first:
--   select id, title, recurrence_type from public.recurring_tasks
--    where recurrence_type::text in ('half_yearly', 'yearly');

begin;

do $fn$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_recurring_reminders';
  v_new := replace(v_src,
             'recurrence_type::text in (''weekly'', ''monthly'', ''quarterly'', ''half_yearly'', ''yearly'')',
             'recurrence_type::text in (''weekly'', ''monthly'', ''quarterly'')');
  if v_src is null or v_new = v_src then
    raise exception 'Rollback: send_recurring_reminders is not in the shape 20270205120100 left it';
  end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'generate_recurring_task_now';
  v_new := replace(v_src,
             'elsif r.recurrence_type::text in (''half_yearly'', ''yearly'') then
      if not public.recurring_fires_on((select rt from public.recurring_tasks rt where rt.id = r.id), v_date) then return null; end if;
    elsif r.recurrence_type = ''quarterly'' then',
             'elsif r.recurrence_type = ''quarterly'' then');
  if v_src is null or v_new = v_src then
    raise exception 'Rollback: generate_recurring_task_now is not in the shape 20270205120100 left it';
  end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_recurring_assignee';
  v_new := replace(v_src,
             'when ''quarterly'' then ''Repeats quarterly''
    when ''half_yearly'' then ''Repeats half-yearly''
    when ''yearly''    then ''Repeats yearly''',
             'when ''quarterly'' then ''Repeats quarterly''');
  if v_src is null or v_new = v_src then
    raise exception 'Rollback: notify_recurring_assignee is not in the shape 20270205120100 left it';
  end if;
  execute v_new;
end
$fn$;

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

alter table public.recurring_tasks drop constraint if exists recurring_tasks_yearly_month_check;
alter table public.recurring_tasks drop column if exists yearly_month;

commit;
