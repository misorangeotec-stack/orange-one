-- ===========================================================================
-- "YOU LAST USED" — answer it from work done, not from page opens.
--
-- ⚠ THE BUG THIS FIXES. The personal snapshot's module list read `module_visits`
--   alone and reported **Never** for every module, for everybody. It was not a
--   rendering fault: `module_visits` is written by `touch_module_visit()`, called
--   from the portal shell, and that code is not live yet — so the table is empty
--   except for one developer's testing. A column sourced from a counter nobody is
--   feeding can only ever say Never, and Never looked exactly like a fact.
--
--   It was demonstrably wrong: one user shown "Never" on all nine of her modules
--   had 706 task_activity rows that same morning, plus Import in August and
--   General Purchase in July.
--
-- ── What it reads instead ─────────────────────────────────────────────────────
--   Every module already keeps an activity log (`master_report_modules.
--   activity_table`), and every one of them has `actor_id` + `created_at`. That
--   is a real, populated, per-person record of work done, and it has been there
--   the whole time.
--
--   Visits are still merged in, not dropped: they are the ONLY signal for a
--   read-only module. Outstanding Dashboard is looked at daily and written to
--   almost never, which is exactly why `usage_from_visits` exists — judging it by
--   rows created would call a heavily-used module dormant. So the answer is the
--   LATER of the two, and the mail says "used", not "opened", because that is now
--   what it means.
--
-- ⚠ Dynamic SQL over config-named tables, like master_report_snapshot. Every
--   identifier goes through %I, and every table and column is checked for
--   existence first — a module row naming a table that was never created must
--   leave one blank cell, not break the morning mail for everyone.
-- ===========================================================================

create or replace function public.user_module_usage(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_out  jsonb := '{}'::jsonb;
  v_last timestamptz;
  v_work timestamptz;
  v_seen timestamptz;
  r      record;
begin
  -- Yourself, an admin, or the trusted server path (cron has no session user).
  if v_uid is not null and v_uid <> p_user_id and not public.is_admin(v_uid) then
    raise exception 'you may only read your own usage';
  end if;

  for r in
    select m.app_id, m.activity_table, m.head_table, m.created_column, m.actor_column
      from public.master_report_modules m
     where m.enabled
  loop
    v_work := null;

    -- 1. The module's activity log: who did something, and when. Uniform across
    --    every FMS — actor_id + created_at — so no per-module configuration.
    if r.activity_table is not null
       and to_regclass('public.' || quote_ident(r.activity_table)) is not null
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.activity_table
                      and c.column_name = 'actor_id')
    then
      execute format('select max(created_at) from public.%I where actor_id = $1', r.activity_table)
        into v_work using p_user_id;
    end if;

    -- 2. Modules with no activity log (Leads, Outstanding) fall back to their own
    --    head table's author column, which is what the Master Report counts too.
    if v_work is null
       and r.head_table is not null and r.actor_column is not null and r.created_column is not null
       and to_regclass('public.' || quote_ident(r.head_table)) is not null
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.head_table
                      and c.column_name = r.actor_column)
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.head_table
                      and c.column_name = r.created_column)
    then
      execute format('select max(%I) from public.%I where %I = $1',
                     r.created_column, r.head_table, r.actor_column)
        into v_work using p_user_id;
    end if;

    -- 3. Page opens. Empty until the portal shell ships the ping, and that is
    --    fine — it can only ever move the answer forward, never back to Never.
    select max(mv.last_at) into v_seen
      from public.module_visits mv
     where mv.user_id = p_user_id and mv.app_id = r.app_id;

    v_last := greatest(v_work, v_seen);   -- greatest() ignores NULLs in Postgres

    if v_last is not null then
      v_out := v_out || jsonb_build_object(
        r.app_id,
        jsonb_build_object(
          'last_at', v_last,
          -- Which signal answered, so a reader chasing a surprising date knows
          -- whether to look at the activity log or the visit counter.
          'source', case when v_seen is not null and (v_work is null or v_seen >= v_work)
                         then 'visit' else 'work' end));
    end if;
  end loop;

  return v_out;
end $$;

revoke all on function public.user_module_usage(uuid) from public, anon;
grant execute on function public.user_module_usage(uuid) to authenticated;

comment on function public.user_module_usage(uuid) is
  'When one person last USED each module — the later of their last activity-log entry and their last recorded page open. Keyed by app_id.';

-- ---------------------------------------------------------------------------
-- Fold it into the snapshot. Only the modules block changes.
-- ---------------------------------------------------------------------------
create or replace function public.user_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_user    jsonb;
  v_tasks   jsonb;
  v_modules jsonb;
  v_usage   jsonb;
begin
  if v_uid is not null and v_uid <> p_user_id and not public.is_admin(v_uid) then
    raise exception 'you may only read your own snapshot';
  end if;

  select jsonb_build_object(
           'id', p.id, 'name', p.name, 'email', p.email,
           'department', coalesce(d.name, ''), 'designation', p.designation,
           'last_active_at', p.last_active_at)
    into v_user
    from public.profiles p
    left join public.departments d on d.id = p.department_id
   where p.id = p_user_id;

  if v_user is null then raise exception 'no such user'; end if;

  -- ⚠ THIS PREDICATE MIRRORS core/workspace/mywork/providers/tasks.ts EXACTLY.
  --   It got that wrong once: filtering only `completed` reported 14 items and
  --   11 overdue for a user whose screen said 8 and 6.
  select jsonb_build_object(
           'open',        count(*),
           'overdue',     count(*) filter (where t.due_date is not null and t.due_date < v_today),
           'due_today',   count(*) filter (where t.due_date = v_today),
           'due_2d',      count(*) filter (where t.due_date between v_today + 1 and v_today + 2),
           'no_date',     count(*) filter (where t.due_date is null),
           'oldest_days', coalesce(max(case when t.due_date is not null and t.due_date < v_today
                                            then v_today - t.due_date end), 0))
    into v_tasks
    from public.tasks t
   where t.assigned_to = p_user_id
     and coalesce(t.not_applicable, false) = false
     and coalesce(t.is_personal, false) = false
     and t.status::text not in ('completed', 'shifted');

  v_usage := public.user_module_usage(p_user_id);

  select coalesce(jsonb_agg(m order by m.sort_order), '[]'::jsonb)
    into v_modules
  from (
    select mr.sort_order as sort_order, mr.app_id as app_id, mr.label as label,
           mr.detail_path as detail_path,
           (v_usage -> mr.app_id ->> 'last_at')::timestamptz as last_opened_at,
           v_usage -> mr.app_id ->> 'source'                 as last_source,
           coalesce(vis.hits_7d, 0)                          as opens_7d
      from public.master_report_modules mr
      left join lateral (
        select sum(mv.hits) filter (where mv.visited_on > v_today - 7) as hits_7d
          from public.module_visits mv
         where mv.user_id = p_user_id and mv.app_id = mr.app_id
      ) vis on true
     where mr.enabled
       and (public.is_admin(p_user_id)
            or exists (select 1 from public.app_access a
                        where a.user_id = p_user_id and a.app_id = mr.app_id))
  ) m;

  return jsonb_build_object(
    'generated_at', now(), 'for_date', v_today, 'user', v_user,
    'tasks', v_tasks, 'modules', v_modules);
end $$;

revoke all on function public.user_snapshot(uuid) from public, anon;
grant execute on function public.user_snapshot(uuid) to authenticated;
