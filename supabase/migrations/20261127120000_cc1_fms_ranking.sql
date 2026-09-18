-- CC-1 · A monthly ranking on the FMS Control Center.
--
-- WHAT IT SCORES. FMS steps. Every step a person is given is worth one point: closed on
-- time = 1, closed late = ½, not closed = 0. Score = points ÷ steps given, as a
-- percentage, to one decimal, and the ladder is ranked on that same one-decimal value
-- (equal scores share a rank: 1, 2, 2, 4). One company-wide ladder, 10 steps to be
-- ranked, calendar months, and each month's top three are the employees of the month.
-- All decided by the user on 18-09-2026 (WORKLIST.md → CC-1).
--
-- WHERE THE NUMBERS COME FROM. Not from SQL. No FMS step's due date is stored anywhere:
-- each is derived in TypeScript by its own module, and SQL copies of those rules drifted
-- from the screen three times for the morning mail. So the `fms-ranking` edge function
-- runs the modules' own code (supabase/ranking/entry.ts) and writes one row per scored
-- step here. SQL only ADDS THEM UP — `fms_rank_rescore` — and decides who is ranked.
--
-- FROZEN MEANS FROZEN. A finished month is frozen once and never recomputed, so an
-- employee of the month cannot change afterwards. That is enforced here, by triggers,
-- not by the job's good behaviour: once `frozen_at` is set, no row of that month in
-- fms_rank_steps / fms_rank_scores / fms_rank_months can be inserted, changed or deleted.
--
-- PRIVACY IS THE SERVER'S JOB. No table here is readable by a non-admin. Everyone reads
-- through `fms_rank_board`, which hands out names only for the top five, the caller and
-- the employees of the month, and nobody's per-process split but the caller's own.
--
-- ADDITIVE ONLY: new tables and new functions. Rollback: the _rollback.sql beside this.
-- The nightly schedule is a SEPARATE migration (…_cc1_fms_ranking_nightly.sql), applied
-- only once the user has seen the ladders and said yes.

-- ── 0. Checks first, outside any lock ─────────────────────────────────────────
do $$
begin
  if (select count(*) from public.profiles where email in ('qc@orangeotec.com', 'qa@orangeotec.com')) <> 2 then
    raise exception 'CC-1: expected the two shared QC / QA logins to seed the exclusion list';
  end if;
  if to_regclass('public.fms_rank_steps') is not null then
    raise exception 'CC-1: fms_rank_steps already exists — this migration has been applied';
  end if;
end $$;

-- ── 1. Which modules count ────────────────────────────────────────────────────
-- The switch the user asked for on 18-09-2026: a module not in use yet is left out
-- of everyone's score until an admin switches it on. Keys are the Control Center's
-- adapter keys (apps/fms-control-center/adapters/registry.ts).
create table public.fms_rank_modules (
  module     text primary key,
  active     boolean not null,
  note       text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

insert into public.fms_rank_modules (module, active, note) values
  ('purchase',          true,  null),
  ('import',            true,  null),
  ('hr',                true,  null),
  ('hr-exit',           false, 'Not in use: 0 cases ever on 18-09-2026. Needs a scorer before it can count.'),
  ('travel-desk',       false, 'On hold at the client''s request: no grants, no step owners on 18-09-2026.'),
  ('office-supplies',   true,  null),
  ('sampling',          true,  null),
  ('production-entry',  true,  null),
  ('order-to-dispatch', true,  null),
  ('asset-maintenance', false, 'Not in use yet: one job ever and no step owners on 18-09-2026.'),
  ('ocpi',              true,  null);

-- ── 2. Who is never ranked ────────────────────────────────────────────────────
-- Admins are never ranked (they bypass every gate, and one admin login is the test
-- account) — that is a rule in fms_rank_rescore, not a row here. This list is for the
-- rest: shared logins and developer or test accounts. Kept by admins.
create table public.fms_rank_exclusions (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  reason   text not null check (length(btrim(reason)) > 0),
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

insert into public.fms_rank_exclusions (user_id, reason)
select id, 'Shared login: several people work under it'
  from public.profiles
 where email in ('qc@orangeotec.com', 'qa@orangeotec.com');

-- ── 3. Months ─────────────────────────────────────────────────────────────────
create table public.fms_rank_months (
  month          date primary key check (month = date_trunc('month', month)::date),
  computed_at    timestamptz,
  frozen_at      timestamptz,
  ladder_size    integer,
  -- The modules that counted when it froze, for anyone reading it a year later.
  active_modules text[],
  -- Per module: the job's own stats for this month (what it dropped and why), its run
  -- id and when it wrote. Nothing is dropped silently.
  modules        jsonb not null default '{}'::jsonb
);

-- ── 4. One row per scored step ────────────────────────────────────────────────
-- The answer to "why is my score 72%?". Written by the job, per module, per month.
-- `upcoming` rows are NOT scored: they are the viewer's own open steps not yet due,
-- for the what-if on the board.
create table public.fms_rank_steps (
  month      date not null references public.fms_rank_months(month),
  module     text not null,
  user_id    uuid not null,
  step_id    text not null,
  entity_id  text not null,
  ref        text not null,
  step_key   text not null,
  step_label text not null,
  round_no   integer not null default 0,
  outcome    text not null check (outcome in ('on_time', 'late', 'missed', 'upcoming')),
  due_date   date,
  done_at    timestamptz,
  days_late  integer,
  basis      text not null check (basis in ('closed', 'open', 'closed_after')),
  primary key (month, user_id, module, step_id)
);
create index fms_rank_steps_month_module on public.fms_rank_steps (month, module);

-- ── 5. One row per person per month ───────────────────────────────────────────
create table public.fms_rank_scores (
  month       date not null references public.fms_rank_months(month),
  user_id     uuid not null,
  given       integer not null,
  on_time     integer not null,
  late        integer not null,
  missed      integer not null,
  points      numeric(10, 1) not null,
  score       numeric(4, 1) not null,
  rank        integer,
  ranked      boolean not null,
  not_ranked  text check (not_ranked in ('admin', 'excluded', 'external', 'under_minimum')),
  by_module   jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (month, user_id),
  check (given = on_time + late + missed),
  check (ranked = (not_ranked is null)),
  check ((rank is null) = (not ranked))
);

-- ── 6. Each night's standing, for "your month so far" ─────────────────────────
create table public.fms_rank_history (
  as_of   date not null,
  month   date not null,
  user_id uuid not null,
  given   integer not null,
  points  numeric(10, 1) not null,
  score   numeric(4, 1) not null,
  rank    integer,
  ranked  boolean not null,
  primary key (as_of, user_id)
);

-- ── 7. Frozen is frozen ───────────────────────────────────────────────────────
create or replace function public.fms_rank_frozen_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old date := case when tg_op in ('UPDATE', 'DELETE') then old.month end;
  v_new date := case when tg_op in ('INSERT', 'UPDATE') then new.month end;
begin
  if exists (select 1 from public.fms_rank_months m
              where m.month in (v_old, v_new) and m.frozen_at is not null) then
    raise exception 'FMS ranking: % is frozen and can never be rewritten',
      to_char(coalesce(v_old, v_new), 'Mon YYYY');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger fms_rank_steps_frozen before insert or update or delete on public.fms_rank_steps
  for each row execute function public.fms_rank_frozen_guard();
create trigger fms_rank_scores_frozen before insert or update or delete on public.fms_rank_scores
  for each row execute function public.fms_rank_frozen_guard();

create or replace function public.fms_rank_month_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.frozen_at is not null then
    raise exception 'FMS ranking: % is frozen and can never be rewritten', to_char(old.month, 'Mon YYYY');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger fms_rank_months_frozen before update or delete on public.fms_rank_months
  for each row execute function public.fms_rank_month_guard();

-- TRUNCATE fires no row trigger, so it gets its own.
create or replace function public.fms_rank_truncate_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.fms_rank_months where frozen_at is not null) then
    raise exception 'FMS ranking: frozen months exist — % cannot be truncated', tg_table_name;
  end if;
  return null;
end $$;

create trigger fms_rank_steps_no_truncate before truncate on public.fms_rank_steps
  for each statement execute function public.fms_rank_truncate_guard();
create trigger fms_rank_scores_no_truncate before truncate on public.fms_rank_scores
  for each statement execute function public.fms_rank_truncate_guard();
create trigger fms_rank_months_no_truncate before truncate on public.fms_rank_months
  for each statement execute function public.fms_rank_truncate_guard();

-- ── 8. Nobody but admins reads a table directly ───────────────────────────────
alter table public.fms_rank_modules    enable row level security;
alter table public.fms_rank_exclusions enable row level security;
alter table public.fms_rank_months     enable row level security;
alter table public.fms_rank_steps      enable row level security;
alter table public.fms_rank_scores     enable row level security;
alter table public.fms_rank_history    enable row level security;

create policy fms_rank_modules_admin_read    on public.fms_rank_modules    for select to authenticated using ((select public.is_admin((select auth.uid()))));
create policy fms_rank_exclusions_admin_read on public.fms_rank_exclusions for select to authenticated using ((select public.is_admin((select auth.uid()))));
create policy fms_rank_months_admin_read     on public.fms_rank_months     for select to authenticated using ((select public.is_admin((select auth.uid()))));
create policy fms_rank_steps_admin_read      on public.fms_rank_steps      for select to authenticated using ((select public.is_admin((select auth.uid()))));
create policy fms_rank_scores_admin_read     on public.fms_rank_scores     for select to authenticated using ((select public.is_admin((select auth.uid()))));
create policy fms_rank_history_admin_read    on public.fms_rank_history    for select to authenticated using ((select public.is_admin((select auth.uid()))));

revoke insert, update, delete, truncate on
  public.fms_rank_modules, public.fms_rank_exclusions, public.fms_rank_months,
  public.fms_rank_steps, public.fms_rank_scores, public.fms_rank_history
  from anon, authenticated;
revoke all on
  public.fms_rank_modules, public.fms_rank_exclusions, public.fms_rank_months,
  public.fms_rank_steps, public.fms_rank_scores, public.fms_rank_history
  from anon;

-- ── 9. The job's writes (service role only) ───────────────────────────────────

-- One module's rows for one month, replacing what it wrote before. Refuses a frozen month.
create or replace function public.fms_rank_put_module(
  p_month date, p_module text, p_rows jsonb, p_stats jsonb, p_run uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'FMS ranking: a month is its first day, got %', p_month;
  end if;
  insert into public.fms_rank_months (month) values (p_month) on conflict (month) do nothing;
  if exists (select 1 from public.fms_rank_months where month = p_month and frozen_at is not null) then
    raise exception 'FMS ranking: % is frozen and can never be rewritten', to_char(p_month, 'Mon YYYY');
  end if;

  delete from public.fms_rank_steps where month = p_month and module = p_module;

  insert into public.fms_rank_steps
    (month, module, user_id, step_id, entity_id, ref, step_key, step_label, round_no,
     outcome, due_date, done_at, days_late, basis)
  select p_month, p_module, r.user_id, r.step_id, r.entity_id, r.ref, r.step_key, r.step_label,
         coalesce(r.round_no, 0), r.outcome, r.due_date, r.done_at, r.days_late, r.basis
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      user_id uuid, step_id text, entity_id text, ref text, step_key text, step_label text,
      round_no integer, outcome text, due_date date, done_at timestamptz, days_late integer, basis text);
  get diagnostics v_n = row_count;

  update public.fms_rank_months
     set modules = modules || jsonb_build_object(
           p_module,
           coalesce(p_stats, '{}'::jsonb) || jsonb_build_object('run', p_run, 'rows', v_n, 'at', now()))
   where month = p_month;
  return v_n;
end $$;

-- Add a month up. Who is ranked is decided HERE, so an exclusion or a module switch
-- takes effect on the running month at once, without waiting for the night's run.
create or replace function public.fms_rank_rescore(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if exists (select 1 from public.fms_rank_months where month = p_month and frozen_at is not null) then
    raise exception 'FMS ranking: % is frozen and can never be rewritten', to_char(p_month, 'Mon YYYY');
  end if;

  delete from public.fms_rank_scores where month = p_month;

  with per_module as (
    select st.user_id, st.module,
           count(*) filter (where st.outcome = 'on_time') as on_time,
           count(*) filter (where st.outcome = 'late')    as late,
           count(*) filter (where st.outcome = 'missed')  as missed
      from public.fms_rank_steps st
      join public.fms_rank_modules m on m.module = st.module and m.active
     where st.month = p_month
       and st.outcome <> 'upcoming'
     group by st.user_id, st.module
  ), per_person as (
    select user_id,
           sum(on_time)::integer as on_time,
           sum(late)::integer    as late,
           sum(missed)::integer  as missed,
           jsonb_object_agg(module, jsonb_build_object(
             'given',   on_time + late + missed,
             'on_time', on_time,
             'late',    late,
             'missed',  missed,
             'score',   round((on_time + late * 0.5) / (on_time + late + missed) * 100, 1))) as by_module
      from per_module
     group by user_id
  ), tagged as (
    select pp.*,
           pp.on_time + pp.late + pp.missed as given,
           (pp.on_time + pp.late * 0.5)::numeric(10, 1) as points,
           round((pp.on_time + pp.late * 0.5) / (pp.on_time + pp.late + pp.missed) * 100, 1) as score,
           case
             when public.is_admin(pp.user_id) then 'admin'
             when exists (select 1 from public.fms_rank_exclusions e where e.user_id = pp.user_id) then 'excluded'
             when coalesce((select pr.is_external from public.profiles pr where pr.id = pp.user_id), false) then 'external'
             -- The user's minimum: 10 steps in the month to be ranked.
             when pp.on_time + pp.late + pp.missed < 10 then 'under_minimum'
           end as not_ranked
      from per_person pp
  )
  insert into public.fms_rank_scores
    (month, user_id, given, on_time, late, missed, points, score, rank, ranked, not_ranked, by_module)
  select p_month, t.user_id, t.given, t.on_time, t.late, t.missed, t.points, t.score,
         case when t.not_ranked is null
              then rank() over (partition by t.not_ranked is null order by t.score desc) end,
         t.not_ranked is null, t.not_ranked, t.by_module
    from tagged t;
  get diagnostics v_n = row_count;

  update public.fms_rank_months
     set ladder_size = (select count(*) from public.fms_rank_scores where month = p_month and ranked),
         computed_at = now()
   where month = p_month;
  return v_n;
end $$;

-- Close a run for one month. A finished month freezes ONLY if every module the run
-- expected wrote its rows in THIS run; otherwise it stays open and the next night tries
-- again — so a failed or missed run on the 1st can never lose a month.
create or replace function public.fms_rank_finish(
  p_month date, p_freeze boolean, p_run uuid, p_expected text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text[];
  v_as_of   date;
  v_rows    integer;
begin
  select array_agg(x order by x) into v_missing
    from unnest(coalesce(p_expected, '{}'::text[])) as x
   where not exists (
     select 1 from public.fms_rank_months m
      where m.month = p_month and m.modules -> x ->> 'run' = p_run::text);

  if p_freeze and v_missing is not null then
    return jsonb_build_object('month', p_month, 'frozen', false, 'missing', v_missing);
  end if;

  v_rows := public.fms_rank_rescore(p_month);

  if p_freeze then
    update public.fms_rank_months
       set frozen_at = now(),
           active_modules = (select array_agg(module order by module) from public.fms_rank_modules where active)
     where month = p_month;
  else
    -- One point on the trend a night. "As of" is the working day the figures
    -- describe: a run at 00:52 IST describes the day before.
    v_as_of := ((now() at time zone 'Asia/Kolkata') - interval '6 hours')::date;
    if v_as_of >= p_month then
      delete from public.fms_rank_history where as_of = v_as_of;
      insert into public.fms_rank_history (as_of, month, user_id, given, points, score, rank, ranked)
      select v_as_of, month, user_id, given, points, score, rank, ranked
        from public.fms_rank_scores where month = p_month;
    end if;
  end if;

  return jsonb_build_object('month', p_month, 'frozen', p_freeze, 'scored', v_rows, 'missing', v_missing);
end $$;

revoke all on function public.fms_rank_put_module(date, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.fms_rank_rescore(date) from public, anon, authenticated;
revoke all on function public.fms_rank_finish(date, boolean, uuid, text[]) from public, anon, authenticated;
grant execute on function public.fms_rank_put_module(date, text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.fms_rank_rescore(date) to service_role;
grant execute on function public.fms_rank_finish(date, boolean, uuid, text[]) to service_role;

-- ── 10. What a viewer may read ────────────────────────────────────────────────

-- Staff who hold the FMS Control Center (any level), and admins. The grant decides who
-- sees the ranking at all — the user's call, after launch — and it is checked here as
-- well as by the route, because a policy or a route is not what the RPC runs under.
create or replace function public.fms_rank_can_view(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and public.is_staff(p_uid)
     and (public.is_admin(p_uid) or public.module_level(p_uid, 'fms-control-center') <> 'none');
$$;

-- The whole board for one month, cut to what the caller may see.
create or replace function public.fms_rank_board(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_admin    boolean;
  v_current  date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  v_month    date;
  v_m        public.fms_rank_months%rowtype;
  v_me       public.fms_rank_scores%rowtype;
  v_size     integer;
  v_above    numeric;
  v_above_rk integer;
  v_t        numeric;
  v_k        integer;
  v_gap      jsonb;
  v_eotm     date;
  v_out      jsonb;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_rank_can_view(v_uid) then raise exception 'Not authorized'; end if;
  v_admin := public.is_admin(v_uid);
  v_month := coalesce(date_trunc('month', p_month)::date, v_current);

  select * into v_m from public.fms_rank_months where month = v_month;
  select * into v_me from public.fms_rank_scores where month = v_month and user_id = v_uid;
  v_size := coalesce(v_m.ladder_size, 0);

  -- "N more on-time steps to move up." Closing k more steps on time makes the score
  -- (points + k) / (given + k); it passes the next score up once that rounds above it,
  -- i.e. once it reaches (above + 0.05)%. Someone above on 100% can only be drawn level
  -- with, never passed — and only by reaching 99.95%.
  if v_me.ranked then
    select min(score) into v_above from public.fms_rank_scores
     where month = v_month and ranked and score > v_me.score;
    if v_above is not null then
      select min(rank) into v_above_rk from public.fms_rank_scores
       where month = v_month and ranked and score = v_above;
      v_t := case when v_above >= 100 then 0.9995 else (v_above + 0.05) / 100 end;
      v_k := greatest(1, ceil((v_t * v_me.given - v_me.points) / (1 - v_t)))::integer;
      v_gap := jsonb_build_object(
        'above_rank', v_above_rk, 'above_score', v_above,
        'steps', v_k, 'draw_level_only', v_above >= 100);
    end if;
  end if;

  -- Employees of the month: the last frozen month before the one being viewed (for the
  -- running month, that is last month).
  select max(month) into v_eotm from public.fms_rank_months
   where frozen_at is not null and month < greatest(v_month, v_current);
  if v_month < v_current and v_m.frozen_at is not null then
    v_eotm := v_month;
  end if;

  v_out := jsonb_build_object(
    'month', v_month,
    'current_month', v_current,
    'is_current', v_month = v_current,
    'frozen', v_m.frozen_at is not null,
    'frozen_at', v_m.frozen_at,
    'computed_at', v_m.computed_at,
    'ladder_size', v_size,
    'is_admin', v_admin,
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', month, 'frozen', frozen_at is not null) order by month)
                          from public.fms_rank_months), '[]'::jsonb),
    'modules', coalesce((select jsonb_agg(jsonb_build_object('module', module, 'active', active) order by module)
                           from public.fms_rank_modules), '[]'::jsonb),
    -- The top five, named. Ties can make it six.
    'top', coalesce((select jsonb_agg(jsonb_build_object(
                        'rank', s.rank, 'name', p.name, 'score', s.score, 'given', s.given,
                        'on_time', s.on_time, 'late', s.late, 'missed', s.missed, 'is_me', s.user_id = v_uid)
                        order by s.rank, s.given desc, p.name)
                       from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                      where s.month = v_month and s.ranked and s.rank <= 5), '[]'::jsonb),
    -- Everyone's score with no name attached, for "watch your rank move" on the what-if.
    'ladder_scores', coalesce((select jsonb_agg(score order by score desc)
                                 from public.fms_rank_scores where month = v_month and ranked), '[]'::jsonb),
    'me', case when v_me.user_id is null then null else jsonb_build_object(
            'given', v_me.given, 'on_time', v_me.on_time, 'late', v_me.late, 'missed', v_me.missed,
            'points', v_me.points, 'score', v_me.score, 'rank', v_me.rank,
            'ranked', v_me.ranked, 'not_ranked', v_me.not_ranked, 'by_module', v_me.by_module,
            'ahead_pct', case when v_me.ranked and v_size > 1 then round(100.0 *
                (select count(*) from public.fms_rank_scores o
                  where o.month = v_month and o.ranked and o.score < v_me.score) / (v_size - 1)) end,
            'gap', v_gap) end,
    'me_name', (select name from public.profiles where id = v_uid),
    'excluded_reason', (select reason from public.fms_rank_exclusions where user_id = v_uid),
    -- The caller's OWN open steps this month: overdue (scored 0) and not yet due.
    'my_open', coalesce((select jsonb_agg(jsonb_build_object(
                           'module', st.module, 'step', st.step_label, 'ref', st.ref,
                           'due_date', st.due_date, 'outcome', st.outcome)
                           order by st.due_date, st.ref)
                          from public.fms_rank_steps st
                          join public.fms_rank_modules m on m.module = st.module and m.active
                         where st.month = v_month and st.user_id = v_uid
                           and st.basis = 'open' and st.outcome in ('missed', 'upcoming')), '[]'::jsonb),
    'my_trend', coalesce((select jsonb_agg(jsonb_build_object('as_of', as_of, 'score', score, 'rank', rank, 'given', given)
                            order by as_of)
                           from public.fms_rank_history where month = v_month and user_id = v_uid), '[]'::jsonb),
    'my_history', coalesce((select jsonb_agg(jsonb_build_object(
                              'month', s.month, 'score', s.score, 'rank', s.rank, 'ranked', s.ranked,
                              'given', s.given, 'ladder_size', m.ladder_size, 'frozen', m.frozen_at is not null)
                              order by s.month)
                             from public.fms_rank_scores s join public.fms_rank_months m on m.month = s.month
                            where s.user_id = v_uid), '[]'::jsonb),
    'eotm', case when v_eotm is null then null else jsonb_build_object(
              'month', v_eotm,
              'podium', coalesce((select jsonb_agg(jsonb_build_object(
                           'rank', s.rank, 'name', p.name, 'score', s.score, 'given', s.given, 'is_me', s.user_id = v_uid)
                           order by s.rank, s.given desc, p.name)
                          from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                         where s.month = v_eotm and s.ranked and s.rank <= 3), '[]'::jsonb)) end
  );

  if v_admin then
    v_out := v_out || jsonb_build_object('admin', jsonb_build_object(
      'ladder', coalesce((select jsonb_agg(jsonb_build_object(
                    'user_id', s.user_id, 'name', p.name, 'rank', s.rank, 'score', s.score,
                    'given', s.given, 'on_time', s.on_time, 'late', s.late, 'missed', s.missed,
                    'points', s.points, 'ranked', s.ranked, 'not_ranked', s.not_ranked, 'by_module', s.by_module)
                    order by s.ranked desc, s.rank nulls last, s.score desc, p.name)
                   from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                  where s.month = v_month), '[]'::jsonb),
      'exclusions', coalesce((select jsonb_agg(jsonb_build_object(
                        'user_id', e.user_id, 'name', p.name, 'reason', e.reason,
                        'added_by', a.name, 'added_at', e.added_at) order by p.name)
                       from public.fms_rank_exclusions e
                       join public.profiles p on p.id = e.user_id
                       left join public.profiles a on a.id = e.added_by), '[]'::jsonb),
      'modules', coalesce((select jsonb_agg(jsonb_build_object(
                     'module', m.module, 'active', m.active, 'note', m.note,
                     'changed_by', p.name, 'changed_at', m.changed_at) order by m.module)
                    from public.fms_rank_modules m left join public.profiles p on p.id = m.changed_by), '[]'::jsonb),
      'run', v_m.modules,
      'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.name) order by p.name)
                   from public.profiles p where not coalesce(p.is_external, false)), '[]'::jsonb)
    ));
  end if;

  return v_out;
end $$;

-- Every frozen month's podium — the employees-of-the-month wall.
create or replace function public.fms_rank_wall()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.fms_rank_can_view(auth.uid()) then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'month', m.month, 'ladder_size', m.ladder_size,
             'podium', coalesce((select jsonb_agg(jsonb_build_object(
                          'rank', s.rank, 'name', p.name, 'score', s.score, 'given', s.given,
                          'is_me', s.user_id = auth.uid())
                          order by s.rank, s.given desc, p.name)
                         from public.fms_rank_scores s join public.profiles p on p.id = s.user_id
                        where s.month = m.month and s.ranked and s.rank <= 3), '[]'::jsonb))
             order by m.month desc)
      from public.fms_rank_months m where m.frozen_at is not null), '[]'::jsonb);
end $$;

-- "Why is my score 72%?" — the caller's own scored steps for a month. An admin may ask
-- about anyone.
create or replace function public.fms_rank_my_steps(p_month date, p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_user uuid;
begin
  if not public.fms_rank_can_view(v_uid) then raise exception 'Not authorized'; end if;
  v_user := coalesce(p_user, v_uid);
  if v_user <> v_uid and not public.is_admin(v_uid) then raise exception 'Not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'module', st.module, 'step', st.step_label, 'ref', st.ref, 'round', st.round_no,
             'outcome', st.outcome, 'due_date', st.due_date, 'done_at', st.done_at,
             'days_late', st.days_late, 'basis', st.basis)
             order by coalesce(st.done_at::date, st.due_date) desc, st.ref)
      from public.fms_rank_steps st
      join public.fms_rank_modules m on m.module = st.module and m.active
     where st.month = date_trunc('month', p_month)::date and st.user_id = v_user
       and st.outcome <> 'upcoming'), '[]'::jsonb);
end $$;

-- ── 11. What an admin may change ──────────────────────────────────────────────

-- The running month, if it exists and is not frozen yet — what an admin change re-adds.
create or replace function public.fms_rank_rescore_current()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
begin
  if exists (select 1 from public.fms_rank_months where month = v_current and frozen_at is null) then
    perform public.fms_rank_rescore(v_current);
  end if;
end $$;
revoke all on function public.fms_rank_rescore_current() from public, anon, authenticated;

create or replace function public.fms_rank_exclude(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admins only'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason'; end if;
  insert into public.fms_rank_exclusions (user_id, reason, added_by)
  values (p_user, btrim(p_reason), auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, added_by = excluded.added_by, added_at = now();
  perform public.fms_rank_rescore_current();
end $$;

create or replace function public.fms_rank_include(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admins only'; end if;
  delete from public.fms_rank_exclusions where user_id = p_user;
  perform public.fms_rank_rescore_current();
end $$;

create or replace function public.fms_rank_set_module(p_module text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admins only'; end if;
  update public.fms_rank_modules
     set active = p_active, changed_by = auth.uid(), changed_at = now()
   where module = p_module;
  if not found then raise exception 'No such module: %', p_module; end if;
  perform public.fms_rank_rescore_current();
end $$;

revoke all on function public.fms_rank_can_view(uuid) from public, anon;
revoke all on function public.fms_rank_board(date) from public, anon;
revoke all on function public.fms_rank_wall() from public, anon;
revoke all on function public.fms_rank_my_steps(date, uuid) from public, anon;
revoke all on function public.fms_rank_exclude(uuid, text) from public, anon;
revoke all on function public.fms_rank_include(uuid) from public, anon;
revoke all on function public.fms_rank_set_module(text, boolean) from public, anon;
grant execute on function public.fms_rank_can_view(uuid) to authenticated;
grant execute on function public.fms_rank_board(date) to authenticated;
grant execute on function public.fms_rank_wall() to authenticated;
grant execute on function public.fms_rank_my_steps(date, uuid) to authenticated;
grant execute on function public.fms_rank_exclude(uuid, text) to authenticated;
grant execute on function public.fms_rank_include(uuid) to authenticated;
grant execute on function public.fms_rank_set_module(text, boolean) to authenticated;

-- ── 12. How the nightly schedule reaches the function ─────────────────────────
-- The same shared secret and base URL the morning mail uses. Called by the cron job in
-- …_cc1_fms_ranking_nightly.sql, which is applied separately, on the user's say-so.
create or replace function private.fms_ranking_url()
returns text
language sql
stable
security definer
set search_path = private, public
as $$
  select regexp_replace(c.function_url, '/[^/]+$', '/fms-ranking')
    from private.email_dispatch_config c
   where c.function_url is not null
   limit 1;
$$;

create or replace function public.fms_rank_kick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := private.fms_ranking_url();
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

revoke all on function private.fms_ranking_url() from public, anon, authenticated;
revoke all on function public.fms_rank_kick() from public, anon, authenticated;
