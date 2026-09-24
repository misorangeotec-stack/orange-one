-- KPI-1 · The KRA / KPI scorecard: facts, runs, and the one report function.
--
-- WHAT IT ANSWERS. For any person and any period (a week by default, a month, or any
-- From–To range): per module and per task / step, the client's two KPIs — work DONE and
-- work done ON TIME — the same for the previous period, what is planned for the next,
-- and a score out of 100. It replaces the weekly MIS sheet the client keeps by hand.
-- Every rule below was settled by the user on 18-09-2026 (WORKLIST.md → KPI-1).
--
-- WHERE THE NUMBERS COME FROM. Not from SQL. No FMS step's due date is stored anywhere;
-- each is derived in TypeScript by its own module. So the `kpi-facts` edge function runs
-- the modules' own code nightly — CC-1's scorers for the FMS steps, Task Management's own
-- fetcher and predicates for the tasks — and writes ONE ROW PER (person, piece of work)
-- here, with its due date and whether and when it was done. Nothing about any period is
-- stored: `kpi_report` places each fact in the period of its DUE date, so one table answers
-- every week, month and range. SQL only adds up.
--
-- THE RULES kpi_report applies (A = the as-of IST date of the current run):
--   given    due in the period AND (closed, or due before A). Work due later in the running
--            period and not yet done is not held against anyone yet — it is "still due".
--   done     closed, at any time up to the as-of. Clearing old backlog still raises the week
--            it was due in; that is always worth doing.
--   on time  closed on or before the due date, as IST days, AND never revised. A revision
--            overwrites the due date, so without that rule a deadline pushed back three
--            times reads as met.
--   score    (on time + ½ late) ÷ given × 100 — CC-1's rule, so the hub has one. Computed
--            by the screen from these counts (apps/kra-kpi/facts/score.ts).
--
-- NEVER HALF-WRITTEN. A run writes its rows under its own run_id and becomes `current`
-- only in kpi_finish, which checks every module's row count first and then, in the same
-- transaction, retires the previous run and deletes its rows. The report reads the
-- current run only, so a reader sees last night's facts or tonight's, never a mixture.
--
-- PRIVACY IS THE SERVER'S JOB. Neither table is readable by a non-admin. Everyone reads
-- through kpi_report, which checks the caller itself: their own report, a report down
-- their reporting chain (the same test as the tasks_select policy), or anyone's for an
-- admin. A policy is evaluated as the caller; this function runs as its owner, so the
-- check has to live inside it.
--
-- Depends on recurring_fires_on (…120000_kpi1_recurring_fires_on.sql) for next period's
-- projected Task Management work. ADDITIVE ONLY: new tables, new functions. The nightly
-- schedule is a SEPARATE migration (…_kpi1_facts_nightly.sql), applied only on the user's
-- say-so. Rollback: …_kpi1_facts_rollback.sql.

-- ── 0. Checks first, outside any lock ─────────────────────────────────────────
do $$
begin
  if to_regclass('public.kpi_facts') is not null then
    raise exception 'KPI-1: kpi_facts already exists — this migration has been applied';
  end if;
  if to_regprocedure('public.recurring_fires_on(public.recurring_tasks, date)') is null then
    raise exception 'KPI-1: apply 20261128120000_kpi1_recurring_fires_on.sql first';
  end if;
  if to_regprocedure('private.fms_ranking_url()') is null then
    raise exception 'KPI-1: CC-1''s private.fms_ranking_url() is missing — the kick below mirrors it';
  end if;
end $$;

-- ── 1. Runs ───────────────────────────────────────────────────────────────────
-- One row per nightly run, kept as the log: what each module wrote, what it dropped and
-- why, how long it took. At most one run is `current`, and it is the only one with facts.
create table public.kpi_runs (
  run_id      uuid primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- The moment the facts describe, and its IST date (A in the rules above).
  as_of       timestamptz not null,
  as_of_date  date not null,
  status      text not null default 'writing'
              check (status in ('writing', 'current', 'superseded', 'failed')),
  -- The modules the conductor asked for. kpi_finish refuses a run missing any of them.
  expected    text[] not null,
  -- Modules switched out of CC-1's ranking (fms_rank_modules), and so out of this report.
  skipped     jsonb not null default '[]'::jsonb,
  -- Per module: its stats (facts, closed, open, dropped by reason, excluded) and timings.
  modules     jsonb not null default '{}'::jsonb,
  note        text
);
create unique index kpi_runs_one_current on public.kpi_runs ((true)) where status = 'current';

-- ── 2. Facts ──────────────────────────────────────────────────────────────────
-- One row per (person, piece of work). The shape is apps/kra-kpi/facts/types.ts → KpiFact.
create table public.kpi_facts (
  run_id        uuid not null references public.kpi_runs(run_id) on delete cascade,
  source        text not null check (source in ('fms', 'task')),
  module        text not null,
  module_name   text not null,
  row_key       text not null,
  row_label     text not null,
  user_id       uuid not null,
  item_id       text not null,
  entity_id     text not null,
  ref           text not null,
  round_no      integer not null default 0,
  due_date      date not null,
  done_at       timestamptz,
  done_date_ist date,
  basis         text not null check (basis in ('closed', 'open')),
  revised       boolean not null default false,
  -- Stored, never scored: a task closed by an admin bulk sweep. Kept only so the report
  -- can say how many it left out of a person's period.
  excluded      text check (excluded in ('bulk_close')),
  primary key (run_id, module, user_id, item_id),
  check ((basis = 'closed') = (done_at is not null)),
  check ((done_at is null) = (done_date_ist is null))
);
-- A person's period: the report's only access path.
create index kpi_facts_person_due on public.kpi_facts (run_id, user_id, due_date);
-- "Has this template already produced its task for this date?" — the projection's dedup.
create index kpi_facts_row_due on public.kpi_facts (run_id, row_key, due_date);

alter table public.kpi_runs enable row level security;
alter table public.kpi_facts enable row level security;

-- Admins may read both directly, for support. Nobody else: kpi_report is the only door.
-- Nobody writes but the job, through the functions below (service role).
create policy kpi_runs_admin_read on public.kpi_runs
  for select to authenticated using ((select public.is_admin((select auth.uid()))));
create policy kpi_facts_admin_read on public.kpi_facts
  for select to authenticated using ((select public.is_admin((select auth.uid()))));

-- ── 3. Writing a run (the kpi-facts edge function, service role only) ─────────

create or replace function public.kpi_run_begin(p_run uuid, p_as_of timestamptz, p_expected text[], p_skipped jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_run is null or p_as_of is null or coalesce(array_length(p_expected, 1), 0) = 0 then
    raise exception 'KPI facts: a run needs an id, an as-of and at least one module';
  end if;
  insert into public.kpi_runs (run_id, as_of, as_of_date, expected, skipped)
  values (p_run, p_as_of, (p_as_of at time zone 'Asia/Kolkata')::date, p_expected, coalesce(p_skipped, '[]'::jsonb));
end $$;

-- One chunk of rows. Called as many times as a module needs; refuses a run that is not
-- being written, so a late chunk can never land in a run that is already current.
create or replace function public.kpi_put_rows(p_run uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.kpi_runs where run_id = p_run and status = 'writing') then
    raise exception 'KPI facts: run % is not being written', p_run;
  end if;
  insert into public.kpi_facts
    (run_id, source, module, module_name, row_key, row_label, user_id, item_id, entity_id, ref,
     round_no, due_date, done_at, done_date_ist, basis, revised, excluded)
  select p_run, r.source, r.module, r.module_name, r.row_key, r.row_label, r.user_id, r.item_id,
         r.entity_id, r.ref, coalesce(r.round_no, 0), r.due_date, r.done_at, r.done_date_ist, r.basis,
         coalesce(r.revised, false), r.excluded
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      source text, module text, module_name text, row_key text, row_label text, user_id uuid,
      item_id text, entity_id text, ref text, round_no integer, due_date date, done_at timestamptz,
      done_date_ist date, basis text, revised boolean, excluded text);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- A module is done: record its stats. kpi_finish checks its row count against them.
create or replace function public.kpi_put_module(p_run uuid, p_module text, p_stats jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kpi_runs
     set modules = modules || jsonb_build_object(p_module, coalesce(p_stats, '{}'::jsonb) || jsonb_build_object('at', now()))
   where run_id = p_run and status = 'writing';
  if not found then
    raise exception 'KPI facts: run % is not being written', p_run;
  end if;
end $$;

-- Make a run current — only if every expected module reported, and reported exactly the
-- rows that arrived — then retire the previous run and delete every other run's rows, all
-- in this one transaction. Otherwise the run is marked failed, its rows deleted, and the
-- previous run stays current: a bad night leaves yesterday's report standing.
create or replace function public.kpi_finish(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.kpi_runs;
  v_problems text[] := '{}';
  v_mod text;
  v_want bigint;
  v_got bigint;
  v_total bigint;
  v_prev uuid;
begin
  -- One finisher at a time; a second conductor waits rather than interleaving.
  perform pg_advisory_xact_lock(hashtext('kpi_finish'));

  select * into v_run from public.kpi_runs where run_id = p_run for update;
  if not found or v_run.status <> 'writing' then
    raise exception 'KPI facts: run % is not being written', p_run;
  end if;

  foreach v_mod in array v_run.expected loop
    if not (v_run.modules ? v_mod) then
      v_problems := v_problems || format('%s did not report', v_mod);
      continue;
    end if;
    v_want := (v_run.modules -> v_mod ->> 'facts')::bigint;
    select count(*) into v_got from public.kpi_facts where run_id = p_run and module = v_mod;
    if v_want is distinct from v_got then
      v_problems := v_problems || format('%s reported %s rows, %s arrived', v_mod, v_want, v_got);
    end if;
  end loop;

  if cardinality(v_problems) > 0 then
    update public.kpi_runs
       set status = 'failed', finished_at = now(), note = array_to_string(v_problems, '; ')
     where run_id = p_run;
    delete from public.kpi_facts where run_id = p_run;
    return jsonb_build_object('ok', false, 'run', p_run, 'problems', to_jsonb(v_problems));
  end if;

  select run_id into v_prev from public.kpi_runs where status = 'current';
  update public.kpi_runs set status = 'superseded' where status = 'current';
  update public.kpi_runs set status = 'current', finished_at = now() where run_id = p_run;
  -- Every other run's rows: the one just retired, and any run that died half-written.
  delete from public.kpi_facts where run_id <> p_run;
  update public.kpi_runs set status = 'failed', note = coalesce(note, 'never finished')
   where status = 'writing' and run_id <> p_run;
  select count(*) into v_total from public.kpi_facts where run_id = p_run;
  return jsonb_build_object('ok', true, 'run', p_run, 'previous', v_prev, 'facts', v_total);
end $$;

-- A conductor that saw a module fail says so, and the run's rows go.
create or replace function public.kpi_run_fail(p_run uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kpi_runs set status = 'failed', finished_at = now(), note = p_note
   where run_id = p_run and status = 'writing';
  delete from public.kpi_facts where run_id = p_run;
end $$;

revoke all on function public.kpi_run_begin(uuid, timestamptz, text[], jsonb) from public, anon, authenticated;
revoke all on function public.kpi_put_rows(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.kpi_put_module(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.kpi_finish(uuid) from public, anon, authenticated;
revoke all on function public.kpi_run_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.kpi_run_begin(uuid, timestamptz, text[], jsonb) to service_role;
grant execute on function public.kpi_put_rows(uuid, jsonb) to service_role;
grant execute on function public.kpi_put_module(uuid, text, jsonb) to service_role;
grant execute on function public.kpi_finish(uuid) to service_role;
grant execute on function public.kpi_run_fail(uuid, text) to service_role;

-- ── 4. The report ─────────────────────────────────────────────────────────────
-- kpi_report(person, from, to): everything the scorecard screen and its export show, in
-- one call. See the header for the rules. Periods:
--   · last = the previous period of equal length — the previous ISO week for a week, the
--     previous calendar month for a calendar month, else the same number of days before;
--   · next = the same, after;
--   · trend = ISO weeks: the trailing 8 for a week, else every week the range touches,
--     clipped to it and marked `partial` when shorter than 7 days. A month's headline
--     figures come from its dates, never from adding weeks up.
-- Next period's PLANNED work is known work already due in it (any fact) plus, for Task
-- Management, the dates from the as-of on where one of the person's active templates fires
-- (recurring_fires_on, the generator's own test) and no task exists yet. The same
-- projection, over the rest of the running period, is added to "still due". Rows from a
-- `when` template are flagged `upto`: those can still be marked Not Applicable.
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
       and k.due_date between least(v_lf, v_tf) and v_nt
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
    select w::date as week_start, greatest(w::date, v_tf) as b_from, least(w::date + 6, p_to) as b_to
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

comment on function public.kpi_report(uuid, date, date) is
  'The KRA / KPI scorecard for one person and one period (KPI-1). The only way to read kpi_facts: '
  'checks the caller itself — self, their reporting chain (hod_downline), or an admin.';

revoke all on function public.kpi_report(uuid, date, date) from public, anon;
grant execute on function public.kpi_report(uuid, date, date) to authenticated;

-- ── 5. The nightly kick ───────────────────────────────────────────────────────
-- The same shared secret and base URL the morning mail and the ranking use. Called by the
-- cron job in …_kpi1_facts_nightly.sql, which is applied separately, on the user's say-so.
create or replace function private.kpi_facts_url()
returns text
language sql
stable
security definer
set search_path = private, public
as $$
  select regexp_replace(c.function_url, '/[^/]+$', '/kpi-facts')
    from private.email_dispatch_config c
   where c.function_url is not null
   limit 1;
$$;

create or replace function public.kpi_facts_kick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := private.kpi_facts_url();
  v_sec text;
  v_req bigint;
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  select c.dispatch_secret into v_sec from private.email_dispatch_config c limit 1;
  if v_url is null or nullif(btrim(coalesce(v_sec, '')), '') is null then
    return null;
  end if;
  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_sec),
    body    := jsonb_build_object('run', true),
    timeout_milliseconds := 150000
  ) into v_req;
  return v_req;
end $$;

revoke all on function private.kpi_facts_url() from public, anon, authenticated;
revoke all on function public.kpi_facts_kick() from public, anon, authenticated;
