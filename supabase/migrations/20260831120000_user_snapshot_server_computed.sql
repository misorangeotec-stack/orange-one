-- ===========================================================================
-- PERSONAL DAILY SNAPSHOT — the figures now come from the app's own code.
--
-- WHAT CHANGED AND WHY
--   The mail could only ever count Task Management, because that is the only
--   module whose "open" and "overdue" are answerable in SQL: it stores both the
--   assignee and a real due_date. Every FMS module DERIVES its step due dates in
--   TypeScript from working-day SLAs (shared/lib/stepSla.ts + fms_*_config) and
--   stores nothing, so no query here can see them.
--
--   Re-implementing those rules in SQL was the obvious move and the wrong one —
--   it is a second source of truth, and it produced two reports that disagreed
--   with the screen about the same person. Instead the `work-snapshot` edge
--   function runs the app's REAL queue logic server-side (supabase/worksnapshot/,
--   compiled by build.mjs) and writes the finished figures into the outbox
--   payload. Postgres' job is now to decide WHO and WHEN, not WHAT.
--
-- ⚠ THIS FILE ALSO WRITES DOWN FOUR FUNCTIONS THAT WERE ONLY EVER APPLIED LIVE.
--   set_user_snapshot_settings, user_snapshot_apply_schedule,
--   user_snapshot_enqueue_daily and queue_user_snapshot_email existed in the
--   database with no migration behind them, so the repo disagreed with
--   production and a fresh environment would have come up missing the feature.
--   They are restated here as they ran, with the two behavioural changes below
--   marked in place.
--
-- Reversal: re-apply 20260830121000, then
--   select cron.schedule('user-snapshot-daily', '30 3 * * *',
--     $$ set local statement_timeout = '170s'; select public.user_snapshot_enqueue_daily(); $$);
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Where work-snapshot lives.
--
-- Derived from the send-email URL rather than stored again: they are two
-- functions on one deployment, and a second hand-maintained URL is a second
-- thing to get wrong on the day someone changes domains. Both URL shapes
-- (…functions.supabase.co/send-email and …supabase.co/functions/v1/send-email)
-- differ only in the last segment.
-- ---------------------------------------------------------------------------
create or replace function private.work_snapshot_url()
returns text
language sql
stable
security definer
set search_path = private, public
as $$
  select regexp_replace(c.function_url, '/[^/]+$', '/work-snapshot')
    from private.email_dispatch_config c
   where c.function_url is not null
   limit 1;
$$;

revoke all on function private.work_snapshot_url() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The daily send — now a hand-off, not a computation.
--
-- ⚠ RETURNS THE pg_net REQUEST ID, NOT A RECIPIENT COUNT. The work happens in
--   the edge function, asynchronously; there is no count to return at the moment
--   this returns. `select * from net._http_response where id = <that>` is how you
--   see what it did. The old signature returned int and this returns bigint on
--   purpose, so a caller reading it as "how many were mailed" fails loudly rather
--   than reporting 1.
--
-- ⚠ NO SEND LOG HERE. Idempotency moved into work-snapshot, which skips anyone
--   who already has an outbox row for that date — a check the enqueuer cannot do
--   correctly any more, since it no longer knows who will be skipped for having
--   nothing open.
-- ---------------------------------------------------------------------------
-- Dropped, not replaced: Postgres refuses to change a function's return type in
-- place, and this one goes from int (recipients mailed) to bigint (a pg_net
-- request id). The type change is the point — see the note above.
drop function if exists public.user_snapshot_enqueue_daily(date);

create or replace function public.user_snapshot_enqueue_daily(p_for_date date default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_for_date, (now() at time zone 'Asia/Kolkata')::date);
  v_url  text := private.work_snapshot_url();
  v_sec  text;
  v_req  bigint;
begin
  -- The switches are still read here, so a disabled feature costs nothing and
  -- never wakes the function up.
  if not coalesce((select s.enabled from public.user_snapshot_settings s where s.id), false) then
    return null;
  end if;
  if not public.email_module_enabled('user-snapshot') then
    return null;
  end if;

  select c.dispatch_secret into v_sec from private.email_dispatch_config c limit 1;
  if v_url is null or nullif(btrim(coalesce(v_sec, '')), '') is null then
    -- Same silent-no-op rule as email dispatch: an unconfigured environment must
    -- not raise every morning.
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', v_sec),
    body    := jsonb_build_object('enqueue', true, 'forDate', v_date),
    timeout_milliseconds := 250000
  ) into v_req;

  return v_req;
end $$;

revoke all on function public.user_snapshot_enqueue_daily(date) from public, anon;

comment on function public.user_snapshot_enqueue_daily(date) is
  'Asks the work-snapshot edge function to compute and queue every eligible person''s daily snapshot. Returns the pg_net request id, not a count.';

-- ---------------------------------------------------------------------------
-- 3. "Send mine now" — same hand-off, one person.
--
-- ⚠ REWRITTEN RATHER THAN DROPPED. Its old body built the payload from
--   public.user_snapshot(), which no longer carries the per-module figures — so
--   left alone it would have quietly mailed a report full of zeroes. That is the
--   worst possible failure for this feature and the reason it is rewritten here
--   rather than deprecated in a comment.
--
--   Returns the pg_net request id for the same reason as above: the outbox row
--   is created by the edge function, after this has already returned.
-- ---------------------------------------------------------------------------
drop function if exists public.queue_user_snapshot_email(uuid, text, text, text);

create or replace function public.queue_user_snapshot_email(
  p_user_id  uuid,
  p_to_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_url text := private.work_snapshot_url();
  v_sec text;
  v_req bigint;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if v_uid <> p_user_id and not public.is_admin(v_uid) then
    raise exception 'you may only send your own snapshot';
  end if;
  if not public.email_module_enabled('user-snapshot') then
    raise exception 'email is switched off for the personal snapshot';
  end if;

  select c.dispatch_secret into v_sec from private.email_dispatch_config c limit 1;
  if v_url is null or nullif(btrim(coalesce(v_sec, '')), '') is null then
    raise exception 'email dispatch is not configured on this environment';
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', v_sec),
    body    := jsonb_build_object(
                 'userId', p_user_id,
                 'sendTo', nullif(btrim(coalesce(p_to_email, '')), '')),
    timeout_milliseconds := 250000
  ) into v_req;

  return v_req;
end $$;

revoke all on function public.queue_user_snapshot_email(uuid, text) from public, anon;
grant execute on function public.queue_user_snapshot_email(uuid, text) to authenticated;

comment on function public.queue_user_snapshot_email(uuid, text) is
  'Send one person''s snapshot now, optionally to a different address (a test copy). Yourself or an admin.';

-- ---------------------------------------------------------------------------
-- 4. public.user_snapshot — trimmed to what SQL genuinely knows.
--
-- ⚠ `sources` AND `sources_covered` ARE REMOVED. They described Task Management
--   only, under the same key names the computed payload now uses. Two arrays
--   called "sources" meaning different things is precisely how the mail and the
--   screen came apart before; one of them has to go, and it is this one.
--
--   `tasks` STAYS, and work-snapshot carries it through as `tasks_sql`. It is the
--   independent cross-check: if that count ever disagrees with the computed
--   "Task Management" row, one of the two filters has drifted and the report is
--   lying. Keeping a second opinion is worth one extra query.
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
begin
  -- Yourself, an admin, or the trusted server path (cron has no session user).
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
  --
  --   The four conditions, and why each is there:
  --     assigned_to = the user  — RLS hands an HOD their whole downline, so
  --                               without this a manager's list fills with the
  --                               team's work (the provider says so too).
  --     not not_applicable      — countsTowardMetrics(); dropped from every
  --     not is_personal         — other dashboard metric as well.
  --     status not in (completed, shifted) — a shifted task moved to another
  --                               day and is not outstanding work today.
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

  -- Their modules, and whether THEY have opened each one. Admins bypass access
  -- entirely, so for them this is every enabled module rather than their grants.
  select coalesce(jsonb_agg(m order by m.sort_order), '[]'::jsonb)
    into v_modules
  from (
    select mr.sort_order as sort_order, mr.app_id as app_id, mr.label as label,
           mr.detail_path as detail_path, v.last_at as last_opened_at,
           coalesce(v.hits_7d, 0) as opens_7d
      from public.master_report_modules mr
      left join lateral (
        select max(mv.last_at) as last_at,
               sum(mv.hits) filter (where mv.visited_on > v_today - 7) as hits_7d
          from public.module_visits mv
         where mv.user_id = p_user_id and mv.app_id = mr.app_id
      ) v on true
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

comment on function public.user_snapshot(uuid) is
  'The parts of one person''s daily snapshot that SQL can answer exactly: their profile, their Task Management position, and the modules they hold. The per-module work figures come from the work-snapshot edge function.';

-- ---------------------------------------------------------------------------
-- 5. The two settings functions, restated so the repo matches the database.
--    Unchanged behaviour — they were correct, they were simply never committed.
-- ---------------------------------------------------------------------------
create or replace function public.user_snapshot_apply_schedule()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour int;
  v_mins int;
  v_cron text;
begin
  select coalesce(s.send_hour_ist, 9) into v_hour from public.user_snapshot_settings s where s.id;
  v_hour := greatest(0, least(coalesce(v_hour, 9), 23));
  -- Cron runs in UTC; IST is UTC+5:30 with no DST, so every schedule lands on a
  -- :30 and any hour before 05:30 IST wraps to the previous UTC day.
  v_mins := ((v_hour * 60) - 330 + 1440) % 1440;
  v_cron := format('%s %s * * *', v_mins % 60, v_mins / 60);

  perform cron.schedule(
    'user-snapshot-daily',
    v_cron,
    $cmd$ set local statement_timeout = '170s'; select public.user_snapshot_enqueue_daily(); $cmd$
  );
  return v_cron;
end $$;

revoke all on function public.user_snapshot_apply_schedule() from public, anon;

create or replace function public.set_user_snapshot_settings(
  p_enabled         boolean default null,
  p_send_hour_ist   integer default null,
  p_skip_when_empty boolean default null,
  p_include_users   uuid[]  default null,
  p_clear_include   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  if p_send_hour_ist is not null and (p_send_hour_ist < 0 or p_send_hour_ist > 23) then
    raise exception 'send hour must be between 0 and 23';
  end if;

  update public.user_snapshot_settings
     set enabled         = coalesce(p_enabled, enabled),
         send_hour_ist   = coalesce(p_send_hour_ist, send_hour_ist),
         skip_when_empty = coalesce(p_skip_when_empty, skip_when_empty),
         include_users   = case when p_clear_include then null
                                else coalesce(p_include_users, include_users) end,
         updated_at      = now(),
         updated_by      = auth.uid()
   where id;

  -- ⚠ SAME TRANSACTION AS THE WRITE. The Master Report shipped with an hour
  --   picker that nothing read — the cron was hard-coded — and it went unnoticed
  --   because saving looked like it worked. Rescheduling here is what stops the
  --   setting and the schedule ever being two different facts.
  perform public.user_snapshot_apply_schedule();
end $$;

revoke all on function public.set_user_snapshot_settings(boolean, integer, boolean, uuid[], boolean) from public, anon;
grant execute on function public.set_user_snapshot_settings(boolean, integer, boolean, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Re-apply the schedule so the cron command points at the new body.
-- ---------------------------------------------------------------------------
select public.user_snapshot_apply_schedule();

-- A live read-back of the schedule, so the admin screen shows what cron actually
-- holds rather than what the settings table wishes it held.
create or replace function public.user_snapshot_schedule_info()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'jobname',  j.jobname,
           'schedule', j.schedule,
           'active',   j.active,
           'hour_ist', (select s.send_hour_ist from public.user_snapshot_settings s where s.id))
    from cron.job j
   where j.jobname = 'user-snapshot-daily';
$$;

revoke all on function public.user_snapshot_schedule_info() from public, anon;
grant execute on function public.user_snapshot_schedule_info() to authenticated;
