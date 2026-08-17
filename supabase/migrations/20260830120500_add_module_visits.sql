-- ===========================================================================
-- MODULE VISITS — measuring whether a module is OPENED, not just written to.
--
-- WHY THIS EXISTS
--   Every metric the Master Report had was a row count. That works for the
--   FMS modules, where using the app means creating and moving entries. It is
--   structurally blind to a READ-ONLY module.
--
--   The Outstanding Dashboard is exactly that. Its real data lives in a
--   DIFFERENT Supabase project (the Tally -> Sheets -> Python pipeline), which
--   a cron job in this database cannot reach, so the report was pointed at
--   receivables_followups — the only human-entered receivables table on this
--   side. That table holds 3 rows, all written on 12 Jul 2026, so the report
--   called the app DORMANT while it was being used every day. The count was
--   right; the question was wrong. No amount of re-pointing fixes it: people
--   OPEN that app, they do not write to it, so there is nothing to count.
--
--   So this adds the missing signal. One upsert per user per module per IST
--   day, from the RequireModule gate that already wraps every mounted app.
--   It mirrors public.touch_last_active() (db/migrations/0012), which does the
--   same thing one level up — portal-wide instead of per-module.
--
--   The benefit is not limited to receivables: "12 people opened it this week,
--   nobody created anything" and "nobody has opened it in 40 days" are two very
--   different kinds of unused, and row counts could not tell them apart.
--
-- Reversal:
--   drop function if exists public.touch_module_visit(text);
--   drop table if exists public.module_visits;
--   alter table public.master_report_modules drop column if exists usage_from_visits;
--   alter table public.master_report_settings drop column if exists visits_since;
--   (then re-apply the 20260830120300 master_report_snapshot definition)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table. One row per (user, module, IST day) — deliberately NOT one row
--    per page view: this answers "who used what, on which days", and a
--    per-view log would grow without bound to say the same thing.
-- ---------------------------------------------------------------------------
create table if not exists public.module_visits (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  app_id     text        not null,
  visited_on date        not null,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  hits       integer     not null default 1,
  primary key (user_id, app_id, visited_on)
);

comment on table public.module_visits is
  'One row per user per module per IST day. Written only by public.touch_module_visit(); the Master Report reads it to measure modules that are read rather than written.';
comment on column public.module_visits.visited_on is
  'IST calendar day, matching every other day boundary in the Master Report.';
comment on column public.module_visits.hits is
  'Opens that day. Useful for spotting a module someone lives in versus one they glanced at once.';

create index if not exists module_visits_app_last_idx
  on public.module_visits (app_id, last_at desc);
create index if not exists module_visits_day_idx
  on public.module_visits (visited_on desc);

-- Reads: yourself, or an admin. The Master Report does not read through this
-- policy at all — master_report_snapshot is SECURITY DEFINER and returns
-- aggregate counts only, never a row naming who opened what.
alter table public.module_visits enable row level security;

drop policy if exists "module visits read own or admin" on public.module_visits;
create policy "module visits read own or admin"
  on public.module_visits for select to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- No insert/update/delete policies. Writes go through the function below, so a
-- client can only ever stamp ITS OWN visit and cannot forge someone else's.

-- ---------------------------------------------------------------------------
-- 2. The ping.
--
--    Returns quietly instead of raising on a missing uid/app_id: this is
--    telemetry hanging off a route guard, and a failed stamp must never be
--    able to interrupt navigation. The caller fires and forgets.
-- ---------------------------------------------------------------------------
create or replace function public.touch_module_visit(p_app_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_app text := nullif(btrim(coalesce(p_app_id, '')), '');
begin
  if v_uid is null or v_app is null then
    return;
  end if;

  insert into public.module_visits (user_id, app_id, visited_on)
  values (v_uid, v_app, (now() at time zone 'Asia/Kolkata')::date)
  on conflict (user_id, app_id, visited_on) do update
    set last_at = now(),
        hits    = public.module_visits.hits + 1;
end $$;

revoke execute on function public.touch_module_visit(text) from public, anon;
grant execute on function public.touch_module_visit(text) to authenticated;

comment on function public.touch_module_visit(text) is
  'Records that the calling user opened a module today (IST). Self-authorized via auth.uid(); a caller cannot stamp anyone else.';

-- ---------------------------------------------------------------------------
-- 3. Config: which modules are judged on opens rather than on entries.
-- ---------------------------------------------------------------------------
alter table public.master_report_modules
  add column if not exists usage_from_visits boolean not null default false;

comment on column public.master_report_modules.usage_from_visits is
  'True for read-only modules that people OPEN but never write to. Their Active/Quiet/Dormant state is decided by module_visits instead of by row counts, because a row count for such a module can only ever say zero.';

update public.master_report_modules
   set usage_from_visits = true
 where app_id = 'outstanding-dashboard';

-- When tracking began. Without it, "0 people opened this" is ambiguous between
-- "nobody uses it" and "we only started counting an hour ago", and the report
-- would slander every module on the day it ships.
alter table public.master_report_settings
  add column if not exists visits_since timestamptz;

update public.master_report_settings
   set visits_since = now()
 where visits_since is null;

-- ---------------------------------------------------------------------------
-- 4. The snapshot, reissued with the opens.
--
--    New per-module keys: visitors_today, visitors_7d, opens_7d, last_visit_at,
--    last_signal_at (the later of an entry and an open), usage_from_visits.
--    New root key: visits_since.
-- ---------------------------------------------------------------------------
create or replace function public.master_report_snapshot(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_allowed  boolean;
  v_dormant  int;
  v_include  text[];
  v_since    timestamptz;
  v_days     int := greatest(1, least(coalesce(p_days, 30), 365));
  m          record;
  v_sql      text;
  v_head     jsonb;
  v_act      jsonb;
  v_vis      jsonb;
  v_open     text;
  v_overdue  text;
  v_system   text;
  v_created  text;
  v_tbl      text;
  v_filter   text;
  v_last     timestamptz;
  v_visit    timestamptz;
  v_signal   timestamptz;
  v_state    text;
  v_today    date := (now() at time zone 'Asia/Kolkata')::date;
  v_rows     jsonb := '[]'::jsonb;
begin
  if v_uid is not null then
    select public.is_admin(v_uid)
        or exists (select 1 from public.app_access a
                    where a.user_id = v_uid and a.app_id = 'master-report')
      into v_allowed;
    if not coalesce(v_allowed, false) then
      raise exception 'you do not have access to the Master Report';
    end if;
  end if;

  select coalesce(s.dormant_after_days, 7), s.include_modules, s.visits_since
    into v_dormant, v_include, v_since
    from public.master_report_settings s
   where s.id;
  v_dormant := coalesce(v_dormant, 7);

  for m in
    select * from public.master_report_modules
     where enabled
       and (v_include is null or app_id = any(v_include))
     order by sort_order, app_id
  loop
    v_created := quote_ident(m.created_column);
    v_tbl     := quote_ident(m.head_table);
    v_filter  := coalesce(nullif(btrim(coalesce(m.extra_filter, '')), ''), 'true');

    -- Opens are static SQL over one known table, so they are resolved OUTSIDE
    -- the guarded block below: a module whose head table was renamed still
    -- reports who opened it.
    select jsonb_build_object(
             'visitors_today', count(distinct v.user_id) filter (where v.visited_on = v_today),
             'visitors_7d',    count(distinct v.user_id) filter (where v.visited_on > v_today - 7),
             'opens_7d',       coalesce(sum(v.hits) filter (where v.visited_on > v_today - 7), 0),
             'last_visit_at',  max(v.last_at))
      into v_vis
      from public.module_visits v
     where v.app_id = m.app_id;

    v_visit := nullif(v_vis ->> 'last_visit_at', '')::timestamptz;

    v_open := case
      when m.status_column is null then 'false'
      else format('coalesce(%I::text, '''') <> all (%L::text[])',
                  m.status_column, m.closed_statuses)
    end;

    -- Compared against the IST calendar day, like every other boundary here.
    v_overdue := case
      when m.due_column is null then 'false'
      else format('%I is not null and %I < (now() at time zone ''Asia/Kolkata'')::date',
                  m.due_column, m.due_column)
    end;

    -- `not (false)` is true, so a module with no rule counts everything as human.
    v_system := coalesce(nullif(btrim(coalesce(m.system_filter, '')), ''), 'false');

    begin
      v_sql := format(
        'select jsonb_build_object('
        ||   '''total'', count(*),'
        ||   '''open'', count(*) filter (where %2$s),'
        ||   '''overdue'', count(*) filter (where %2$s and %6$s),'
        ||   '''new_today'', count(*) filter (where (%1$s at time zone ''Asia/Kolkata'')::date'
        ||                   ' = (now() at time zone ''Asia/Kolkata'')::date and not (%7$s)),'
        ||   '''new_today_system'', count(*) filter (where (%1$s at time zone ''Asia/Kolkata'')::date'
        ||                   ' = (now() at time zone ''Asia/Kolkata'')::date and (%7$s)),'
        ||   '''new_7d'', count(*) filter (where %1$s >= now() - interval ''7 days'' and not (%7$s)),'
        ||   '''new_7d_system'', count(*) filter (where %1$s >= now() - interval ''7 days'' and (%7$s)),'
        ||   '''new_window'', count(*) filter (where %1$s >= now() - make_interval(days => %5$s)),'
        ||   '''ageing_open_gt_7d'', count(*) filter (where %2$s and %1$s < now() - interval ''7 days''),'
        ||   '''oldest_open_days'', coalesce(max(case when %2$s'
        ||                   ' then (extract(epoch from (now() - %1$s)) / 86400)::int end), 0)'
        || ') from public.%3$s where %4$s',
        v_created, v_open, v_tbl, v_filter, v_days, v_overdue, v_system);
      execute v_sql into v_head;

      if m.activity_table is not null then
        v_sql := format(
          'select jsonb_build_object('
          ||   '''last_activity_at'', max(created_at),'
          ||   '''active_users_7d'', count(distinct actor_id)'
          ||                   ' filter (where created_at >= now() - interval ''7 days'')'
          || ') from public.%1$s',
          quote_ident(m.activity_table));
      else
        v_sql := format(
          'select jsonb_build_object('
          ||   '''last_activity_at'', max(%1$s),'
          ||   '''active_users_7d'', %2$s'
          || ') from public.%3$s where %4$s',
          v_created,
          case when m.actor_column is null then '0'
               else format('count(distinct %I) filter (where %s >= now() - interval ''7 days'')',
                           m.actor_column, v_created)
          end,
          v_tbl, v_filter);
      end if;
      execute v_sql into v_act;

      v_last := nullif(v_act ->> 'last_activity_at', '')::timestamptz;
      -- PostgreSQL's greatest() ignores NULLs and returns NULL only when every
      -- argument is NULL, which is exactly the semantics wanted here.
      v_signal := greatest(v_last, v_visit);

      -- Adoption state still counts EVERY new row, generated or not: a module
      -- whose cron is filling it is not dormant, it is simply not being typed
      -- into. The human/system split is reported in the columns, not here.
      --
      -- A read-only module is judged purely on opens. For everything else an
      -- open can keep a module OUT of dormant (someone is in there) but cannot
      -- promote it past 'quiet' — "worked, but nothing new was created in N
      -- days" stays a true and useful thing to say about a write module.
      if m.usage_from_visits then
        v_state := case
          -- You cannot assert "nothing in 7 days" after watching for 3. Until
          -- the counter has run for the full dormancy window, an unopened
          -- read-only module is 'tracking', not dormant — otherwise every such
          -- module is libelled on the morning this ships.
          when v_visit is null
               and (v_since is null or v_since > now() - make_interval(days => v_dormant))
            then 'tracking'
          when v_visit is null or v_visit < now() - make_interval(days => v_dormant) then 'dormant'
          when coalesce((v_vis ->> 'visitors_7d')::bigint, 0) = 0 then 'quiet'
          else 'active'
        end;
      else
        v_state := case
          when coalesce((v_head ->> 'total')::bigint, 0) = 0
               and coalesce((v_vis ->> 'visitors_7d')::bigint, 0) = 0 then 'dormant'
          when v_signal is null or v_signal < now() - make_interval(days => v_dormant) then 'dormant'
          when coalesce((v_head ->> 'new_window')::bigint, 0) = 0 then 'quiet'
          else 'active'
        end;
      end if;

      v_rows := v_rows || jsonb_build_array(
        jsonb_build_object(
          'app_id',            m.app_id,
          'label',             m.label,
          'detail_path',       m.detail_path,
          'state',             v_state,
          'tracks_status',     m.status_column is not null,
          -- Lets the UI print a true overdue where one exists and an em dash
          -- where the module simply cannot produce it.
          'tracks_due',        m.due_column is not null,
          'has_system',        nullif(btrim(coalesce(m.system_filter, '')), '') is not null,
          'usage_from_visits', m.usage_from_visits,
          'last_signal_at',    v_signal
        ) || v_head || v_act || v_vis);

    exception when others then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'app_id',      m.app_id,
        'label',       m.label,
        'detail_path', m.detail_path,
        'state',       'error',
        'error',       sqlerrm) || coalesce(v_vis, '{}'::jsonb));
    end;
  end loop;

  return jsonb_build_object(
    'generated_at',       now(),
    'window_days',        v_days,
    'dormant_after_days', v_dormant,
    'visits_since',       v_since,
    'modules',            v_rows);
end $$;
