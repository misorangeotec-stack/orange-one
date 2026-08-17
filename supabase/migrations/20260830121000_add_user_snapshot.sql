-- ===========================================================================
-- PERSONAL DAILY SNAPSHOT — one mail per employee, about their own work.
--
-- WHAT IT IS
--   The Master Report answers "which modules are being used" for a director.
--   This answers "what is on my plate" for one person, mailed each morning.
--
-- ⚠ WHY IT IS NOT A SERVER-SIDE COPY OF "MY CONTROL CENTER"
--   That screen aggregates ten providers IN THE BROWSER
--   (core/workspace/mywork/providers/*). Each one fetches its module's whole
--   dataset and then applies queue predicates and owner rules written in
--   TypeScript — and the nine FMS modules DERIVE their step due dates in TS
--   (lib/sla.ts + fms_*_config) rather than storing them. None of that is
--   reachable from a cron job, and re-implementing it here would create a
--   second source of truth that drifts from the app silently.
--
--   So this covers what the database can answer EXACTLY and says so in the
--   mail rather than pretending to be the whole screen:
--     · Task Management — assigned_to + a real stored due_date. Complete.
--     · Module access + that person's own opens, from module_visits.
--   FMS step work is named as excluded, with a link to the live screen.
--   Adding a module here means storing its due date, not guessing it.
--
-- ⚠ IST EVERYWHERE. tasks.due_date is a DATE, and "overdue" must be measured
--   against the Indian calendar day; using UTC would mark everything due today
--   as overdue between 00:00 and 05:30 IST. Same trap the mywork/types.ts
--   header documents for the frontend.
--
-- Reversal:
--   select cron.unschedule('user-snapshot-daily');
--   drop function if exists public.user_snapshot_enqueue_daily(date);
--   drop function if exists public.queue_user_snapshot_email(uuid, text, text);
--   drop function if exists public.user_snapshot(uuid);
--   drop table if exists public.user_snapshot_settings;
--   delete from public.email_module_settings where module_id = 'user-snapshot';
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings — the same three-switch shape the Master Report uses.
-- ---------------------------------------------------------------------------
create table if not exists public.user_snapshot_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default false,
  send_hour_ist     integer not null default 9 check (send_hour_ist between 0 and 23),
  -- Mailing "you have nothing to do" to 40 people every morning is how a daily
  -- report gets filtered to trash. Off by default.
  skip_when_empty   boolean not null default true,
  -- Null = everyone with a login. Otherwise only these users.
  include_users     uuid[],
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id)
);

insert into public.user_snapshot_settings (id) values (true) on conflict (id) do nothing;

alter table public.user_snapshot_settings enable row level security;

drop policy if exists "user snapshot settings read" on public.user_snapshot_settings;
create policy "user snapshot settings read"
  on public.user_snapshot_settings for select to authenticated using (true);

comment on table public.user_snapshot_settings is
  'Singleton config for the personal daily snapshot mail. Writes go through set_user_snapshot_settings.';

-- ⚠ WITHOUT THIS ROW THE FEATURE IS A SILENT NO-OP: email_module_enabled()
--   returns false for a module with no row at all.
insert into public.email_module_settings (module_id, enabled)
values ('user-snapshot', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The snapshot for ONE person.
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
  v_items   jsonb;
  v_modules jsonb;
begin
  -- Yourself, an admin, or the trusted server path (cron has no session user).
  if v_uid is not null and v_uid <> p_user_id and not public.is_admin(v_uid) then
    raise exception 'you may only read your own snapshot';
  end if;

  select jsonb_build_object(
           'id',             p.id,
           'name',           p.name,
           'email',          p.email,
           'department',     coalesce(d.name, ''),
           'designation',    p.designation,
           'last_active_at', p.last_active_at)
    into v_user
    from public.profiles p
    left join public.departments d on d.id = p.department_id
   where p.id = p_user_id;

  if v_user is null then
    raise exception 'no such user';
  end if;

  -- Deny-list, per the house rule: a status added later counts as OPEN, so new
  -- work can never vanish from someone's own list without anyone noticing.
  select jsonb_build_object(
           'open',        count(*) filter (where t.status::text <> 'completed'),
           'overdue',     count(*) filter (where t.status::text <> 'completed'
                                             and t.due_date is not null and t.due_date < v_today),
           'due_today',   count(*) filter (where t.status::text <> 'completed' and t.due_date = v_today),
           'due_2d',      count(*) filter (where t.status::text <> 'completed'
                                             and t.due_date between v_today + 1 and v_today + 2),
           'later',       count(*) filter (where t.status::text <> 'completed' and t.due_date > v_today + 2),
           'no_date',     count(*) filter (where t.status::text <> 'completed' and t.due_date is null),
           'completed_7d',count(*) filter (where t.status::text = 'completed'
                                             and t.updated_at >= now() - interval '7 days'),
           'oldest_days', coalesce(max(case when t.status::text <> 'completed' and t.due_date is not null
                                            and t.due_date < v_today then v_today - t.due_date end), 0))
    into v_tasks
    from public.tasks t
   where t.assigned_to = p_user_id;

  -- The actual rows, worst first. Capped: a personal mail listing 300 tasks is
  -- not read by anyone, and the count above already states the true total.
  select coalesce(jsonb_agg(x order by x.sort_due, x.title), '[]'::jsonb)
    into v_items
  from (
    select t.due_date is null                       as undated,
           coalesce(t.due_date, '9999-12-31'::date) as sort_due,
           t.title                                  as title,
           t.due_date                               as due_date,
           t.status::text                           as status,
           coalesce(t.from_recurring, false)        as from_recurring,
           case when t.due_date is not null and t.due_date < v_today
                then v_today - t.due_date else 0 end as days_late
      from public.tasks t
     where t.assigned_to = p_user_id
       and t.status::text <> 'completed'
     order by coalesce(t.due_date, '9999-12-31'::date), t.title
     limit 40
  ) x;

  -- Their modules, and whether THEY have opened each one. Admins bypass access
  -- entirely, so for them this is every enabled module rather than their grants.
  select coalesce(jsonb_agg(m order by m.sort_order), '[]'::jsonb)
    into v_modules
  from (
    select mr.sort_order                as sort_order,
           mr.app_id                    as app_id,
           mr.label                     as label,
           mr.detail_path               as detail_path,
           v.last_at                    as last_opened_at,
           coalesce(v.hits_7d, 0)       as opens_7d
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
    'generated_at', now(),
    'for_date',     v_today,
    'user',         v_user,
    'tasks',        v_tasks,
    'task_items',   v_items,
    'modules',      v_modules);
end $$;

revoke all on function public.user_snapshot(uuid) from public, anon;
grant execute on function public.user_snapshot(uuid) to authenticated;

comment on function public.user_snapshot(uuid) is
  'One person''s daily work snapshot: their Task Management position and the modules they hold. Readable by that person, by an admin, or by the server (cron).';
