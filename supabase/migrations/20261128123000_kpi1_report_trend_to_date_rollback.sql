-- ROLLBACK for 20261128123000_kpi1_report_trend_to_date.sql — the trend runs to the period's end
-- again. The function below is kpi_report exactly as 20261128122000_kpi1_report_full_weeks.sql left it.

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
  v_len   integer;
  v_month boolean;
  v_week  boolean;
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

  v_len   := p_to - p_from + 1;
  v_month := p_from = date_trunc('month', p_from)::date
             and p_to = (date_trunc('month', p_from) + interval '1 month' - interval '1 day')::date;
  v_week  := extract(isodow from p_from) = 1 and v_len = 7;
  if v_month then
    v_lf := (p_from - interval '1 month')::date;
    v_lt := p_from - 1;
    v_nf := p_to + 1;
    v_nt := ((p_to + 1) + interval '1 month' - interval '1 day')::date;
  else
    v_lf := p_from - v_len;
    v_lt := p_from - 1;
    v_nf := p_to + 1;
    v_nt := p_to + v_len;
  end if;
  v_tf := case when v_week then p_from - 49 else p_from end;

  with f as (
    select k.*,
           case when k.due_date between p_from and p_to then 'cur'
                when k.due_date between v_lf and v_lt then 'last'
                when k.due_date between v_nf and v_nt then 'next' end as per,
           (k.basis = 'closed' or k.due_date < a) as is_given,
           (k.basis = 'closed' and not k.revised and k.done_date_ist <= k.due_date) as is_on_time
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
    -- WHOLE weeks, Monday to Sunday, even where one runs into the month before or after.
    select w::date as week_start, w::date as b_from, w::date + 6 as b_to
      from generate_series(date_trunc('week', v_tf)::date, p_to, interval '7 days') w
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
                                 'kind', case when v_week then 'week' when v_month then 'month' else 'custom' end),
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
