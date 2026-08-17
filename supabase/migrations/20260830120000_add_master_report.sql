-- ===========================================================================
-- MASTER REPORT — the cross-module adoption snapshot for directors.
--
-- THE QUESTION THIS ANSWERS
--   Orange One has fourteen modules and keeps growing. Nothing today tells a
--   director which of them are actually being USED. At the time of writing,
--   Employee Exit has 0 cases and Asset Maintenance has 0 jobs — both fully
--   built, neither ever used — and that fact is invisible on every screen.
--
--   This is deliberately NOT the FMS Control Center. That answers "what work is
--   due today" by re-running each app's full data fetch in the browser (~25
--   table reads x 9 apps). This answers "is this module alive?", and must be
--   cheap enough for an unattended 08:00 cron job that has no browser at all.
--
-- ONE FUNCTION, TWO CONSUMERS
--   master_report_snapshot() is called by the page AND by the daily mailer. If
--   the counts were computed client-side the email could never reproduce them,
--   and the two would drift apart the first time either changed.
--
-- WHY THE MODULE LIST IS A TABLE AND NOT A CASE STATEMENT
--   Adding module #15 must stay a one-line INSERT, matching how
--   apps/fms-control-center/adapters/registry.ts keeps adding an FMS small.
--   The snapshot function loops this table and builds dynamic SQL, so it never
--   needs editing again.
--
-- ⚠ closed_statuses IS A DENY-LIST, ON PURPOSE.
--   The TypeScript status unions and the live data already disagree:
--   fms_purchase_requests declares open|closed|cancelled but only 'open' and
--   'cancelled' exist so far. An ALLOW-list of open statuses would silently
--   drop any status added later, under-reporting the exact backlog this report
--   exists to expose. Listing the TERMINAL states instead makes anything new
--   default to open — visible, not invisible.
--
-- ⚠ EVERY DAY BOUNDARY IS Asia/Kolkata, NOT UTC.
--   created_at is timestamptz. A UTC "today" reports everything entered before
--   05:30 IST as yesterday. shared/lib/dueBuckets.ts carries the same warning
--   for the frontend (todayLocalIso, never the UTC todayIso).
--
-- Reversal:
--   drop function if exists public.set_master_report_recipients(jsonb);
--   drop function if exists public.set_master_report_settings(boolean, int, int, text[]);
--   drop function if exists public.master_report_snapshot(int);
--   drop table if exists public.master_report_send_log;
--   drop table if exists public.master_report_recipients;
--   drop table if exists public.master_report_settings;
--   drop table if exists public.master_report_modules;
--   delete from public.email_module_settings where module_id = 'master-report';
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Which modules the report covers
-- ---------------------------------------------------------------------------
create table if not exists public.master_report_modules (
  app_id           text primary key,
  label            text not null,
  head_table       text not null,
  created_column   text not null default 'created_at',
  -- NULL when the module has no workflow status at all (leads, receivables
  -- follow-ups). Those rows report entries and activity but never "open".
  status_column    text,
  closed_statuses  text[] not null default '{}',
  -- Raw SQL predicate appended to every count, e.g. soft-delete filters.
  extra_filter     text,
  activity_table   text,
  -- Head-table actor, used only when there is no activity_table.
  actor_column     text,
  detail_path      text,
  enabled          boolean not null default true,
  sort_order       int not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.master_report_modules is
  'Drives master_report_snapshot(). Adding a module to the director report is one INSERT here — the function needs no edit.';
comment on column public.master_report_modules.closed_statuses is
  'DENY-list of terminal statuses. Anything not listed counts as open, so a newly added status is never silently dropped.';

-- ---------------------------------------------------------------------------
-- 2. Settings — one row, using the workspace_settings singleton trick
-- ---------------------------------------------------------------------------
create table if not exists public.master_report_settings (
  id                  boolean primary key default true check (id),
  enabled             boolean not null default false,
  -- Local send time. The cron job itself is scheduled in UTC; this is what the
  -- admin screen shows and what a future reschedule reads.
  send_hour_ist       int not null default 8 check (send_hour_ist between 0 and 23),
  dormant_after_days  int not null default 7 check (dormant_after_days between 1 and 365),
  -- NULL = every enabled module. Otherwise an explicit allow-list of app_ids.
  include_modules     text[],
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users
);
insert into public.master_report_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.master_report_recipients (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  name       text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (email)
);
comment on table public.master_report_recipients is
  'Who gets the 08:00 mail. External addresses are allowed — email_outbox accepts a bare to_email (20260801120300).';

-- Dedup for the daily job. A column on settings could only remember the last
-- send; this distinguishes "already sent today" from "due again" so a cron
-- retry or a manual catch-up after an outage mails nobody twice.
create table if not exists public.master_report_send_log (
  sent_for_date   date primary key,
  sent_at         timestamptz not null default now(),
  recipient_count int not null default 0
);

alter table public.master_report_modules    enable row level security;
alter table public.master_report_settings   enable row level security;
alter table public.master_report_recipients enable row level security;
alter table public.master_report_send_log   enable row level security;

-- Readable by any signed-in user (the page needs the labels and paths); every
-- write goes through the SECURITY DEFINER RPCs below, which re-check is_admin.
do $$
declare t text;
begin
  foreach t in array array['master_report_modules','master_report_settings','master_report_recipients','master_report_send_log']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Seed the thirteen modules
--
-- fms-control-center is deliberately absent: it owns no tables, it is a lens
-- over the others, and a row for it would double-count.
--
-- Every head_table / created_column / status vocabulary below was read off the
-- live database, not off the TypeScript types (which are stale by ~78 tables).
-- ---------------------------------------------------------------------------
insert into public.master_report_modules
  (app_id, label, head_table, created_column, status_column, closed_statuses, extra_filter, activity_table, actor_column, detail_path, sort_order)
values
  -- tasks.status is an ENUM (task_status), not text — the snapshot casts to text.
  ('task-management','Task Management','tasks','created_at','status',
     array['completed','shifted'], null, 'task_activity', 'created_by', '/task-management/tasks', 10),

  ('procurement','Purchase RM Domestic','fms_purchase_requests','created_at','status',
     array['closed','cancelled'], null, 'fms_purchase_activity', null, '/procurement/monitoring', 20),

  ('import','Purchase RM Import','fms_import_requests','created_at','status',
     array['closed','cancelled'], null, 'fms_import_activity', null, '/import/monitoring', 30),

  ('office-supplies','General Purchase','fms_supplies_requests','created_at','status',
     array['delivered','rejected','cancelled'], null, 'fms_supplies_activity', 'raised_by', '/general-purchase/monitoring', 40),

  ('sampling','Ink / RM Sampling','fms_sampling_requests','created_at','status',
     array['closed','cancelled'], null, 'fms_sampling_activity', 'raised_by', '/sampling/monitoring', 50),

  ('production-entry','Production Entry','fms_production_requests','created_at','status',
     array['closed','cancelled'], null, 'fms_production_activity', 'raised_by', '/production-entry/monitoring', 60),

  ('order-to-dispatch','Order to Dispatch','fms_dispatch_orders','created_at','status',
     array['closed','cancelled'], null, 'fms_dispatch_activity', 'raised_by', '/order-to-dispatch/monitoring', 70),

  ('customer-onboarding','New Customer Onboarding','fms_customer_requests','created_at','status',
     array['completed','rejected','cancelled'], null, 'fms_customer_activity', 'raised_by', '/customer-onboarding/all', 80),

  -- Measured on JOBS, not on fms_asset_assets: the asset register is permanent
  -- and never closes, so counting it would report a healthy module that has in
  -- fact never raised a single piece of work.
  ('asset-maintenance','Asset Maintenance','fms_asset_jobs','created_at','status',
     array['closed','cancelled'], null, 'fms_asset_activity', 'raised_by', '/asset-maintenance/monitoring', 90),

  ('hr-recruitment','New Recruitment','fms_hr_requisitions','created_at','status',
     array['closed','cancelled','rejected'], null, 'fms_hr_activity', null, '/hr-recruitment/monitoring', 100),

  ('hr-exit','Employee Exit','fms_exit_cases','created_at','status',
     array['archived','withdrawn','rejected'], null, 'fms_exit_activity', 'raised_by', '/hr-exit/monitoring', 110),

  -- No workflow status and a soft-delete flag; captured_on is the natural anchor.
  ('leads-dashboard','Leads Dashboard','app_leads','captured_on',null,
     '{}', 'deleted is not true', null, 'user_id', '/leads-dashboard', 120),

  -- The follow-up trail is the only human activity the portal database holds for
  -- receivables; the deep Tally reports live in a different Supabase project
  -- that a cron job in THIS database cannot reach.
  ('outstanding-dashboard','Outstanding Dashboard','receivables_followups','created_at',null,
     '{}', null, null, 'created_by', '/outstanding-dashboard', 130)
on conflict (app_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The snapshot
--
-- Returns { generated_at, dormant_after_days, window_days, modules: [...] }.
--
-- Each module costs two aggregate scans (head + activity). One bad config row
-- (a table renamed out from under it) degrades that one module to an "error"
-- state rather than failing the whole report — a director opening this at 08:00
-- should not get a blank page because module #9 moved a table.
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
  v_days     int := greatest(1, least(coalesce(p_days, 30), 365));
  m          record;
  v_sql      text;
  v_head     jsonb;
  v_act      jsonb;
  v_open     text;
  v_created  text;
  v_tbl      text;
  v_filter   text;
  v_last     timestamptz;
  v_state    text;
  v_rows     jsonb := '[]'::jsonb;
begin
  -- Called by the cron job as the table owner, where auth.uid() is null. A
  -- signed-in caller must hold the module; admins bypass as everywhere else.
  if v_uid is not null then
    select public.is_admin(v_uid)
        or exists (select 1 from public.app_access a
                    where a.user_id = v_uid and a.app_id = 'master-report')
      into v_allowed;
    if not coalesce(v_allowed, false) then
      raise exception 'you do not have access to the Master Report';
    end if;
  end if;

  select coalesce(s.dormant_after_days, 7), s.include_modules
    into v_dormant, v_include
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

    -- No status column => nothing can be "open"; the module reports flow only.
    v_open := case
      when m.status_column is null then 'false'
      else format('coalesce(%I::text, '''') <> all (%L::text[])',
                  m.status_column, m.closed_statuses)
    end;

    begin
      -- now() is transaction-stable, so every module in one snapshot shares the
      -- same "today" — no risk of a row landing either side of midnight IST.
      v_sql := format(
        'select jsonb_build_object('
        ||   '''total'', count(*),'
        ||   '''open'', count(*) filter (where %2$s),'
        ||   '''new_today'', count(*) filter (where (%1$s at time zone ''Asia/Kolkata'')::date'
        ||                   ' = (now() at time zone ''Asia/Kolkata'')::date),'
        ||   '''new_7d'', count(*) filter (where %1$s >= now() - interval ''7 days''),'
        ||   '''new_window'', count(*) filter (where %1$s >= now() - make_interval(days => %5$s)),'
        ||   '''ageing_open_gt_7d'', count(*) filter (where %2$s and %1$s < now() - interval ''7 days''),'
        ||   '''oldest_open_days'', coalesce(max(case when %2$s'
        ||                   ' then (extract(epoch from (now() - %1$s)) / 86400)::int end), 0)'
        || ') from public.%3$s where %4$s',
        v_created, v_open, v_tbl, v_filter, v_days);
      execute v_sql into v_head;

      if m.activity_table is not null then
        -- All ten fms_*_activity tables share one shape (actor_id, created_at);
        -- task_activity matches on those two columns too. So this is generic.
        v_sql := format(
          'select jsonb_build_object('
          ||   '''last_activity_at'', max(created_at),'
          ||   '''active_users_7d'', count(distinct actor_id)'
          ||                   ' filter (where created_at >= now() - interval ''7 days'')'
          || ') from public.%1$s',
          quote_ident(m.activity_table));
      else
        -- Fall back to the head table. Purchase / Import / HR head tables carry
        -- no actor column at all, which is exactly why activity is preferred:
        -- it counts who WORKED an item, not just who opened it.
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

      v_state := case
        when coalesce((v_head ->> 'total')::bigint, 0) = 0 then 'dormant'
        when v_last is null or v_last < now() - make_interval(days => v_dormant) then 'dormant'
        when coalesce((v_head ->> 'new_window')::bigint, 0) = 0 then 'quiet'
        else 'active'
      end;

      v_rows := v_rows || jsonb_build_array(
        jsonb_build_object(
          'app_id',      m.app_id,
          'label',       m.label,
          'detail_path', m.detail_path,
          'state',       v_state,
          -- Leads and receivables follow-ups have no workflow status, so their
          -- open/ageing counts are meaningless rather than zero. The UI reads
          -- this to print an em dash instead of a "0" that would be taken as
          -- "nothing pending".
          'tracks_status', m.status_column is not null
        ) || v_head || v_act);

    exception when others then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'app_id',      m.app_id,
        'label',       m.label,
        'detail_path', m.detail_path,
        'state',       'error',
        'error',       sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'generated_at',       now(),
    'window_days',        v_days,
    'dormant_after_days', v_dormant,
    'modules',            v_rows);
end $$;

revoke all on function public.master_report_snapshot(int) from public, anon;
grant execute on function public.master_report_snapshot(int) to authenticated;
comment on function public.master_report_snapshot(int) is
  'Cross-module adoption snapshot for the Master Report page and the daily mailer. Requires the master-report module or admin.';

-- ---------------------------------------------------------------------------
-- 5. Admin writes — the set_email_module_enabled pattern (re-check server-side,
--    so it is an access control and not a hidden button)
-- ---------------------------------------------------------------------------
create or replace function public.set_master_report_settings(
  p_enabled            boolean default null,
  p_send_hour_ist      int     default null,
  p_dormant_after_days int     default null,
  p_include_modules    text[]  default null,
  p_clear_include      boolean default false
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

  update public.master_report_settings
     set enabled            = coalesce(p_enabled, enabled),
         send_hour_ist      = coalesce(p_send_hour_ist, send_hour_ist),
         dormant_after_days = coalesce(p_dormant_after_days, dormant_after_days),
         -- NULL means "leave alone"; clearing back to all-modules needs its own
         -- flag, since NULL is also the value that MEANS all modules.
         include_modules    = case when p_clear_include then null
                                   else coalesce(p_include_modules, include_modules) end,
         updated_at         = now(),
         updated_by         = auth.uid()
   where id;
end $$;

revoke all on function public.set_master_report_settings(boolean, int, int, text[], boolean) from public, anon;
grant execute on function public.set_master_report_settings(boolean, int, int, text[], boolean) to authenticated;

-- Whole-list replace: the admin screen edits a list, and a diff-based API would
-- need add/remove/rename endpoints for what is at most a dozen rows.
create or replace function public.set_master_report_recipients(p_recipients jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  delete from public.master_report_recipients;

  for r in select * from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb))
  loop
    if nullif(btrim(coalesce(r ->> 'email', '')), '') is null then
      continue;
    end if;
    insert into public.master_report_recipients (email, name, enabled)
    values (
      lower(btrim(r ->> 'email')),
      nullif(btrim(coalesce(r ->> 'name', '')), ''),
      coalesce((r ->> 'enabled')::boolean, true)
    )
    on conflict (email) do update
      set name = excluded.name, enabled = excluded.enabled;
  end loop;
end $$;

revoke all on function public.set_master_report_recipients(jsonb) from public, anon;
grant execute on function public.set_master_report_recipients(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The module switch — WITHOUT THIS ROW THE FEATURE IS A SILENT NO-OP.
--
-- Every enqueue in this repo is gated on public.email_module_enabled(<module>),
-- which returns FALSE when the module has no row at all. Mail would be dropped
-- with no error anywhere. Seeded OFF like every other module; an admin turns it
-- on in Admin -> Master Report.
-- ---------------------------------------------------------------------------
insert into public.email_module_settings (module_id, enabled)
values ('master-report', false)
on conflict (module_id) do nothing;
