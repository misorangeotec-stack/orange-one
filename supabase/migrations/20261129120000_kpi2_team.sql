-- KPI-2 · The team summary: kpi_team, on ONE copy of the scoring rules.
--
-- Admins and HODs asked (19-09-2026) to see everyone's KRA / KPI figures side by side instead of
-- opening each person's scorecard. kpi_team returns one line per person the caller may see.
--
-- ONE DEFINITION OF THE RULES. "Given", "on time", the period arithmetic and the whole-week trend
-- were written inside kpi_report. They move into four small SQL functions (section 1) and
-- kpi_report is re-pointed at them (section 2) — generated from 20261128123000's function by
-- anchored edits only, so nothing else in it moves. kpi_team (section 3) uses the same four, so the
-- team page and a person's own scorecard cannot disagree about any figure.
--
-- PROVED before it was applied, in a rolled-back transaction on live: kpi_report returns
-- byte-identical output before and after for real people and every kind of period; kpi_team's
-- figures for a person equal that person's own kpi_report; the caller check holds for an admin, a
-- HOD, a sub-HOD, an employee (refused) and no login (refused). See WORKLIST.md → KPI-2.
--
-- Additive otherwise. Rollback: …_kpi2_team_rollback.sql restores kpi_report verbatim.

-- ── 1. The rules, in one place ──────────────────────────────────────────────────
-- Until now they were written inside kpi_report. A second reader (kpi_team) must not carry a
-- second copy, so they move here and BOTH functions call them. Each is a one-line SQL function,
-- which Postgres inlines — no cost per row.

-- Given = closed, or its due date has passed (A = the run's as-of IST date). Work due later in a
-- running period is not held against anyone yet.
create or replace function public.kpi_is_given(p_basis text, p_due date, p_as_of date)
returns boolean
language sql
immutable
as $$ select p_basis = 'closed' or p_due < p_as_of $$;

-- On time = closed on or before the due date (IST days) and never revised: a revision overwrites
-- the due date, so without the second test a deadline pushed back three times reads as met.
create or replace function public.kpi_is_on_time(p_basis text, p_revised boolean, p_done date, p_due date)
returns boolean
language sql
immutable
as $$ select p_basis = 'closed' and not p_revised and p_done <= p_due $$;

-- A period's neighbours and its trend's first day. Last / next = the previous / next ISO week for
-- a week, the previous / next calendar month for a calendar month, else the same number of days;
-- the trend starts eight weeks back for a week, else at the period's own first day.
create or replace function public.kpi_period(
  p_from date, p_to date,
  out kind text, out last_from date, out last_to date, out next_from date, out next_to date, out trend_from date
)
language sql
stable
as $$
  with x as (
    select p_to - p_from + 1 as len,
           (p_from = date_trunc('month', p_from)::date
            and p_to = (date_trunc('month', p_from) + interval '1 month' - interval '1 day')::date) as is_month,
           (extract(isodow from p_from) = 1 and p_to - p_from + 1 = 7) as is_week
  )
  select case when is_week then 'week' when is_month then 'month' else 'custom' end,
         case when is_month then (p_from - interval '1 month')::date else p_from - len end,
         p_from - 1,
         p_to + 1,
         case when is_month then ((p_to + 1) + interval '1 month' - interval '1 day')::date else p_to + len end,
         case when is_week then p_from - 49 else p_from end
    from x
$$;

-- The trend's buckets: whole Monday–Sunday weeks from the trend's first day, never one that has
-- not started (the user, 18-09-2026: a future week has no score, only work finished early).
create or replace function public.kpi_trend_weeks(p_from date, p_to date, p_as_of date)
returns table (week_start date, b_from date, b_to date)
language sql
stable
as $$
  select w::date, w::date, w::date + 6
    from generate_series(
           date_trunc('week', (public.kpi_period(p_from, p_to)).trend_from)::date,
           least(p_to, p_as_of),
           interval '7 days') w
$$;

revoke all on function public.kpi_is_given(text, date, date) from public, anon;
revoke all on function public.kpi_is_on_time(text, boolean, date, date) from public, anon;
revoke all on function public.kpi_period(date, date) from public, anon;
revoke all on function public.kpi_trend_weeks(date, date, date) from public, anon;

-- ── 2. kpi_report, re-pointed at the shared rules ───────────────────────────────
create or replace function public.kpi_report(p_person uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_run   public.kpi_runs;
  a       date;
  v_kind  text;
  v_lf date; v_lt date;   -- last period
  v_nf date; v_nt date;   -- next period
  v_tf date;              -- trend from
  v_rows  jsonb;
  v_items jsonb;
  v_trend jsonb;
begin
  if v_uid is null then
    raise exception 'KPI report: not signed in' using errcode = '42501';
  end if;
  if p_person is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'KPI report: a person and a From–To range are required';
  end if;
  if p_to - p_from > 370 then
    raise exception 'KPI report: a range can be at most a year';
  end if;
  -- The caller, checked HERE: this function runs as its owner, so no policy protects it.
  -- Self, anyone below them in the reporting chain (the tasks_select test), or an admin.
  if not (p_person = v_uid
          or public.is_admin(v_uid)
          or p_person in (select d.id from public.hod_downline(v_uid) d)) then
    raise exception 'KPI report: you can see your own report and your team''s, not this person''s'
      using errcode = '42501';
  end if;

  select * into v_run from public.kpi_runs where status = 'current';
  if not found then
    return jsonb_build_object('as_of', null);
  end if;
  a := v_run.as_of_date;

  -- Last, next and the trend's first day: one definition, shared with kpi_team (KPI-2).
  select p.kind, p.last_from, p.last_to, p.next_from, p.next_to, p.trend_from
    into v_kind, v_lf, v_lt, v_nf, v_nt, v_tf
    from public.kpi_period(p_from, p_to) p;

  with f as (
    select k.*,
           case when k.due_date between p_from and p_to then 'cur'
                when k.due_date between v_lf and v_lt then 'last'
                when k.due_date between v_nf and v_nt then 'next' end as per,
           public.kpi_is_given(k.basis, k.due_date, a) as is_given,
           public.kpi_is_on_time(k.basis, k.revised, k.done_date_ist, k.due_date) as is_on_time
      from public.kpi_facts k
     where k.run_id = v_run.run_id
       and k.user_id = p_person
       -- Wide enough for the trend's whole weeks, which can start before the period and end after it.
       and k.due_date between least(v_lf, date_trunc('week', v_tf)::date) and greatest(v_nt, date_trunc('week', p_to)::date + 6)
       and k.excluded is null
  ),
  proj as (
    select r.id::text as row_key, r.title, r.description, g::date as due_date,
           case when g::date <= p_to then 'cur' else 'next' end as per
      from public.recurring_tasks r
      cross join generate_series(greatest(p_from, a), v_nt, interval '1 day') g
     where r.active
       and r.assigned_to = p_person
       and public.recurring_fires_on(r, g::date)
       -- Already a fact (any assignee, scored or bulk-closed): it is counted, not projected.
       and not exists (select 1 from public.kpi_facts k
                        where k.run_id = v_run.run_id and k.row_key = r.id::text and k.due_date = g::date)
       -- Generated and marked Not Applicable: the generator will not make it again.
       and not exists (select 1 from public.tasks t
                        where t.recurring_task_id = r.id and t.due_date = g::date and t.not_applicable)
  ),
  agg as (
    select source, module, row_key,
           max(module_name) as module_name,
           max(row_label) as row_label,
           count(*) filter (where per = 'cur'  and is_given)                        as given,
           count(*) filter (where per = 'cur'  and is_given and basis = 'closed')   as done,
           count(*) filter (where per = 'cur'  and is_on_time)                      as on_time,
           count(*) filter (where per = 'cur'  and not is_given)                    as still_due,
           count(*) filter (where per = 'last' and is_given)                        as last_given,
           count(*) filter (where per = 'last' and is_given and basis = 'closed')   as last_done,
           count(*) filter (where per = 'last' and is_on_time)                      as last_on_time,
           count(*) filter (where per = 'next')                                     as next_planned
      from f
     where per is not null
     group by source, module, row_key
  ),
  pagg as (
    select row_key, max(title) as title, max(description) as description,
           count(*) filter (where per = 'cur')  as still_due_projected,
           count(*) filter (where per = 'next') as next_projected
      from proj
     group by row_key
  ),
  keyed as (
    select coalesce(g.source, 'task') as source,
           coalesce(g.module, 'task-management') as module,
           coalesce(g.row_key, p.row_key) as row_key,
           g.module_name, g.row_label, p.title as tpl_title, p.description as tpl_description,
           coalesce(g.given, 0) as given, coalesce(g.done, 0) as done, coalesce(g.on_time, 0) as on_time,
           coalesce(g.still_due, 0) as still_due, coalesce(p.still_due_projected, 0) as still_due_projected,
           coalesce(g.last_given, 0) as last_given, coalesce(g.last_done, 0) as last_done,
           coalesce(g.last_on_time, 0) as last_on_time,
           coalesce(g.next_planned, 0) as next_planned, coalesce(p.next_projected, 0) as next_projected
      from agg g
      full join pagg p on g.source = 'task' and g.module = 'task-management' and g.row_key = p.row_key
  ),
  items as (
    select per, source, module, row_key, item_id, entity_id, ref, round_no, due_date, done_at, done_date_ist, revised,
           case when basis = 'closed' then case when is_on_time then 'on_time' else 'late' end
                when is_given then 'missed' else 'due' end as outcome,
           case when basis = 'closed' then greatest(done_date_ist - due_date, 0)
                when is_given then a - due_date end as days_late
      from f where per is not null
    union all
    select per, 'task', 'task-management', row_key, null, null, title, 0, due_date, null, null, false, 'projected', null
      from proj
  ),
  weeks as (
    -- Whole Monday–Sunday weeks, never one that has not started: kpi_trend_weeks, shared with kpi_team.
    select * from public.kpi_trend_weeks(p_from, p_to, a)
  )
  select
    (select jsonb_agg(jsonb_build_object(
              'source', k.source, 'module', k.module, 'module_name', k.module_name,
              'row_key', k.row_key, 'row_label', k.row_label,
              'tpl_title', k.tpl_title, 'tpl_description', k.tpl_description,
              'given', k.given, 'done', k.done, 'on_time', k.on_time,
              'still_due', k.still_due, 'still_due_projected', k.still_due_projected,
              'last_given', k.last_given, 'last_done', k.last_done, 'last_on_time', k.last_on_time,
              'next_planned', k.next_planned, 'next_projected', k.next_projected,
              'upto', exists (select 1 from public.recurring_tasks rt
                               where k.source = 'task' and rt.id::text = k.row_key and rt.recurrence_type = 'when'))
            order by k.module, k.row_label)
       from keyed k),
    (select jsonb_agg(to_jsonb(i) order by i.due_date, i.ref) from items i),
    (select jsonb_agg(jsonb_build_object(
              'week_start', w.week_start, 'from', w.b_from, 'to', w.b_to,
              'iso_week', extract(week from w.week_start)::int, 'iso_year', extract(isoyear from w.week_start)::int,
              'partial', (w.b_to - w.b_from + 1) < 7,
              'given',   (select count(*) from f where f.due_date between w.b_from and w.b_to and f.is_given),
              'done',    (select count(*) from f where f.due_date between w.b_from and w.b_to and f.is_given and f.basis = 'closed'),
              'on_time', (select count(*) from f where f.due_date between w.b_from and w.b_to and f.is_on_time))
            order by w.week_start)
       from weeks w)
    into v_rows, v_items, v_trend;

  return jsonb_build_object(
    'run_id',      v_run.run_id,
    'as_of',       v_run.as_of,
    'as_of_date',  a,
    'finished_at', v_run.finished_at,
    'period', jsonb_build_object('from', p_from, 'to', p_to,
                                 'kind', v_kind),
    'last',   jsonb_build_object('from', v_lf, 'to', v_lt),
    'next',   jsonb_build_object('from', v_nf, 'to', v_nt),
    'rows',   coalesce(v_rows, '[]'::jsonb),
    'items',  coalesce(v_items, '[]'::jsonb),
    'trend',  coalesce(v_trend, '[]'::jsonb),
    'footer', jsonb_build_object(
      'bulk_closed', (select count(*) from public.kpi_facts k
                       where k.run_id = v_run.run_id and k.user_id = p_person
                         and k.excluded = 'bulk_close' and k.due_date between p_from and p_to),
      'bulk_closed_last', (select count(*) from public.kpi_facts k
                            where k.run_id = v_run.run_id and k.user_id = p_person
                              and k.excluded = 'bulk_close' and k.due_date between v_lf and v_lt),
      -- Company-wide and all-time, from the run log: what each module counted for nobody.
      'dropped', (select coalesce(jsonb_object_agg(m.key, jsonb_build_object(
                          'name', m.value ->> 'name', 'dropped', m.value -> 'dropped')), '{}'::jsonb)
                    from jsonb_each(v_run.modules) m),
      'skipped', v_run.skipped));
end $$;

-- ── 3. kpi_team: everyone's figures, one line each ──────────────────────────────
-- The Team page (KPI-2). WHO: an admin sees every staff login; anyone else sees the people below
-- them in the reporting chain (hod_downline — the same test as kpi_report and tasks_select), not
-- themselves; someone with no team is refused. Checked HERE, because this runs as its owner.
--
-- WHAT: per person, this period's and last period's given / done / on time — by the shared rules
-- above, so this page and each person's own scorecard cannot disagree — the modules they worked,
-- and their counts per trend week, so the page can pool the team's trend over whoever it shows.
-- Admins and the shared logins CC-1 excludes are FLAGGED, not dropped: the page hides them by
-- default and shows them on request (the user, 19-09-2026).
--
-- Only people with work in the window come back; `without_work` counts the rest.
create or replace function public.kpi_team(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_run    public.kpi_runs;
  a        date;
  v_p      record;
  v_people uuid[];
  v_rows   jsonb;
  v_weeks  jsonb;
  v_none   integer;
begin
  if v_uid is null then
    raise exception 'KPI team: not signed in' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'KPI team: a From–To range is required';
  end if;
  if p_to - p_from > 370 then
    raise exception 'KPI team: a range can be at most a year';
  end if;

  if public.is_admin(v_uid) then
    select array_agg(p.id) into v_people from public.profiles p where not coalesce(p.is_external, false);
  else
    select array_agg(d.id) into v_people
      from public.hod_downline(v_uid) d
      join public.profiles p on p.id = d.id
     where not coalesce(p.is_external, false) and d.id <> v_uid;
    if v_people is null then
      raise exception 'KPI team: there is no one in your reporting chain to summarise' using errcode = '42501';
    end if;
  end if;

  select * into v_run from public.kpi_runs where status = 'current';
  if not found then
    return jsonb_build_object('as_of', null);
  end if;
  a := v_run.as_of_date;
  select * into v_p from public.kpi_period(p_from, p_to);

  with f as (
    select k.user_id, k.module_name, k.due_date,
           case when k.due_date between p_from and p_to then 'cur'
                when k.due_date between v_p.last_from and v_p.last_to then 'last' end as per,
           public.kpi_is_given(k.basis, k.due_date, a) as is_given,
           k.basis = 'closed' as is_done,
           public.kpi_is_on_time(k.basis, k.revised, k.done_date_ist, k.due_date) as is_on_time
      from public.kpi_facts k
     where k.run_id = v_run.run_id
       and k.user_id = any(v_people)
       and k.excluded is null
       and k.due_date between least(v_p.last_from, date_trunc('week', v_p.trend_from)::date) and p_to
  ),
  weeks as (
    select * from public.kpi_trend_weeks(p_from, p_to, a)
  ),
  totals as (
    select user_id,
           count(*) filter (where per = 'cur'  and is_given)                as given,
           count(*) filter (where per = 'cur'  and is_given and is_done)    as done,
           count(*) filter (where per = 'cur'  and is_on_time)              as on_time,
           count(*) filter (where per = 'last' and is_given)                as last_given,
           count(*) filter (where per = 'last' and is_given and is_done)    as last_done,
           count(*) filter (where per = 'last' and is_on_time)              as last_on_time,
           coalesce(jsonb_agg(distinct module_name) filter (where per = 'cur' and is_given), '[]'::jsonb) as modules
      from f
     group by user_id
  ),
  -- One pass: each fact joined to the (at most 53) weeks, counted per person and week. A week
  -- with no work for someone is simply absent; the page reads it as zero.
  per_week as (
    select c.user_id,
           jsonb_agg(jsonb_build_object(
             'week_start', c.week_start,
             'given', c.given, 'done', c.done, 'on_time', c.on_time) order by c.week_start) as weeks
      from (
        select x.user_id, w.week_start,
               count(*) filter (where x.is_given)                as given,
               count(*) filter (where x.is_given and x.is_done)  as done,
               count(*) filter (where x.is_on_time)              as on_time
          from weeks w
          join f x on x.due_date between w.b_from and w.b_to
         group by x.user_id, w.week_start
      ) c
     group by c.user_id
  )
  select jsonb_agg(jsonb_build_object(
           'user_id', p.id,
           'name', p.name,
           'designation', p.designation,
           'department', d.name,
           'role', (select r.role::text from public.user_roles r where r.user_id = p.id
                     order by case r.role::text when 'admin' then 0 when 'hod' then 1 when 'sub_hod' then 2 else 3 end
                     limit 1),
           'reports_to', (select string_agg(h.name, ', ' order by h.name)
                            from public.user_hods uh join public.profiles h on h.id = uh.hod_id
                           where uh.employee_id = p.id),
           'is_admin', public.is_admin(p.id),
           'is_excluded', exists (select 1 from public.fms_rank_exclusions e where e.user_id = p.id),
           'given', t.given, 'done', t.done, 'on_time', t.on_time,
           'last_given', t.last_given, 'last_done', t.last_done, 'last_on_time', t.last_on_time,
           'modules', t.modules,
           'weeks', coalesce(pw.weeks, '[]'::jsonb))
         order by p.name)
    into v_rows
    from totals t
    join public.profiles p on p.id = t.user_id
    left join public.departments d on d.id = p.department_id
    left join per_week pw on pw.user_id = t.user_id;

  select jsonb_agg(jsonb_build_object(
           'week_start', w.week_start, 'from', w.b_from, 'to', w.b_to,
           'iso_week', extract(week from w.week_start)::int, 'iso_year', extract(isoyear from w.week_start)::int)
         order by w.week_start)
    into v_weeks
    from public.kpi_trend_weeks(p_from, p_to, a) w;

  select count(*) into v_none
    from unnest(v_people) u(id)
   where not exists (select 1 from public.kpi_facts k
                      where k.run_id = v_run.run_id and k.user_id = u.id and k.excluded is null
                        and k.due_date between p_from and p_to
                        and public.kpi_is_given(k.basis, k.due_date, a));

  return jsonb_build_object(
    'run_id',       v_run.run_id,
    'as_of',        v_run.as_of,
    'as_of_date',   a,
    'period',       jsonb_build_object('from', p_from, 'to', p_to, 'kind', v_p.kind),
    'last',         jsonb_build_object('from', v_p.last_from, 'to', v_p.last_to),
    'weeks',        coalesce(v_weeks, '[]'::jsonb),
    'people',       coalesce(v_rows, '[]'::jsonb),
    'without_work', v_none);
end $$;

comment on function public.kpi_team(date, date) is
  'KRA / KPI team summary (KPI-2): one line per person the caller may see — everyone for an admin, '
  'their reporting chain for anyone else. Built on the same rule functions as kpi_report.';

revoke all on function public.kpi_team(date, date) from public, anon;
grant execute on function public.kpi_team(date, date) to authenticated;
