-- ===========================================================================
-- PF-16 — THE NIGHTLY BACKUP: its clock, its run log and its watchdog.
--
-- WHAT THE BACKUP IS (decided with the client 18-09-2026)
--   Destination: Google Drive of backup@orangeonehub.com (company Workspace),
--   folder "Orange One Backup", readable by support@orangeonehub.com only.
--
--     Orange One database   every night ~03:00 IST   keep the newest 7
--     Orange One files      every night, NEW files   never deleted
--     Tally (ConnectWave)   every Sunday ~03:00 IST  keep the newest 4
--
--   Tally is weekly, not nightly, because a full copy moves ~6 GB out of
--   Supabase. Nightly would take the org to ~225 of its 250 GB/month egress, and
--   the org runs with the spend cap ON — crossing it RESTRICTS the live projects
--   rather than billing. Measured 18-09: 11.2 GB used in the first 8 days.
--
-- WHO DOES WHAT — the collection report's shape, copied on purpose
--   pg_cron decides and pokes (backup_kick -> backup_due -> backup_dispatch).
--   A GitHub runner does the work (.github/workflows/backup.yml + supabase/
--   backup/run.sh): pg_dump, age, rclone. It cannot be an Edge Function — 2s of
--   CPU against minutes of dumping. The runner REPORTS BACK through
--   backup_run_start / backup_run_finish, and backup_watchdog alerts on the
--   ABSENCE of a success, because a dispatch that never arrives fails silently.
--
-- ⚠ THE RETENTION RULE IS COUNT-BASED AND SUCCESS-GATED — in run.sh, not here.
--   "Keep the newest 7" is applied only after tonight's dump is uploaded and its
--   md5 matches. An age rule ("delete older than 7 days") would, after a week of
--   failures, delete every copy there is.
--
-- ⚠ THE FILES ARE NEVER PRUNED. Each file is uploaded once, the night it first
--   appears. Pointing the 7-night rule at them would delete almost the whole
--   backup. keep_app_dumps / keep_tally_dumps apply to the database dumps ONLY.
--
-- ⚠ THE SAME FOUR SILENT-DISPATCH TRAPS AS 20261022120000 apply here: mode is
--   always sent (the workflow input defaults to dry-run) · ref = master · a
--   User-Agent header · a token of misorangeotec-stack.
--
-- STARTS SWITCHED OFF. `enabled` defaults to false and there is no token, so
-- nothing is dispatched until both are set by hand after the first supervised
-- run. Alerts go through the existing `receivables_collections_report` mail
-- renderer (payload-driven subject/headline/body), so send-email is NOT touched.
--
-- Additive: one private table, one public table (admin read only), six
-- functions, two cron jobs. Nothing existing is altered.
--
-- Reversal: see 20261126120000_pf16_backup_schedule_and_run_log_rollback.sql
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists private;


-- ----------------------------------------------------------------- config --

create table if not exists private.backup_config (
  id                   int primary key default 1 check (id = 1),
  enabled              boolean not null default false,
  -- The nightly slot, IST. The runner starts a minute or two after.
  hour_ist             int  not null default 3  check (hour_ist between 0 and 23),
  minute_ist           int  not null default 0  check (minute_ist between 0 and 59),
  -- No automatic start after this. A retry at 10 AM would dump a MICRO-compute
  -- database in business hours; a person can still dispatch by hand.
  latest_start_ist     time not null default '06:30',
  -- 0 = Sunday (extract(dow)). The Tally dump and the full file re-check run
  -- on this day; a missed Sunday is caught up the next night.
  tally_dow            int  not null default 0  check (tally_dow between 0 and 6),
  keep_app_dumps       int  not null default 7  check (keep_app_dumps between 1 and 60),
  keep_tally_dumps     int  not null default 4  check (keep_tally_dumps between 1 and 60),
  max_attempts         int  not null default 3  check (max_attempts between 1 and 10),
  -- backup@ sits in the org unit "Orange O Tec", whose per-user cap is 15 GB.
  -- Drive's API reports the POOL (40 GB), not this cap, so it is tracked here.
  drive_limit_gb       numeric not null default 15 check (drive_limit_gb > 0),
  warn_at_pct          int  not null default 80 check (warn_at_pct between 1 and 100),
  github_pat           text,
  repo                 text not null default 'misorangeotec-stack/orange-one',
  workflow             text not null default 'backup.yml',
  git_ref              text not null default 'master',
  -- A first run is ~40 min; a nightly one a few. Never poke twice inside this.
  min_gap_minutes      int  not null default 90,
  -- NULL = do not alert. A watchdog that cannot name a recipient stays quiet.
  alert_email          text,
  -- The watchdog's verdict time, IST. After latest_start_ist + a full run.
  alert_after_ist      time not null default '07:00',
  last_kick_at         timestamptz,
  last_request_id      bigint,
  last_alert_date      date,
  last_space_alert_date date,
  updated_at           timestamptz not null default now()
);

insert into private.backup_config (id) values (1) on conflict (id) do nothing;

comment on table private.backup_config is
  'PF-16 singleton. Schedule, retention counts and how pg_cron reaches the GitHub runner that takes the nightly backup. private so PostgREST never exposes the token. See 20261126120000.';

revoke all on private.backup_config from public, anon, authenticated;


-- ---------------------------------------------------------------- run log --

create table if not exists public.backup_runs (
  id                bigint generated always as identity primary key,
  -- The IST date the run belongs to (a 03:00 run belongs to that same date).
  for_date          date not null,
  mode              text not null check (mode in ('scheduled', 'full', 'dry-run')),
  include_tally     boolean not null default false,
  full_files        boolean not null default false,
  status            text not null default 'running'
                      check (status in ('running', 'success', 'failed')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  runner_url        text,
  files_copied      int,
  files_bytes       bigint,
  app_dump_bytes    bigint,
  tally_dump_bytes  bigint,
  -- The whole "Orange One Backup" folder after this run — what the space
  -- warning compares against drive_limit_gb.
  backup_bytes      bigint,
  details           jsonb not null default '{}'::jsonb,
  error             text
);

create index if not exists backup_runs_for_date_idx
  on public.backup_runs (for_date desc, started_at desc);

comment on table public.backup_runs is
  'PF-16. One row per backup run, written ONLY by the runner through backup_run_start / backup_run_finish (service role). Read by admins and by backup_due / backup_watchdog.';

alter table public.backup_runs enable row level security;

-- Hoisted form on purpose: see memory "pg_policies prints the wrapping away".
drop policy if exists backup_runs_admin_read on public.backup_runs;
create policy backup_runs_admin_read on public.backup_runs
  for select to authenticated
  using ((select public.is_admin((select auth.uid()))));

revoke all on public.backup_runs from anon;
revoke insert, update, delete, truncate on public.backup_runs from authenticated;


-- -------------------------------------------------------------------- due --
--
-- The one place that decides whether tonight's run should start. Asked by the
-- kick (before poking GitHub) and again by backup_run_start (before the runner
-- does anything), so a duplicate dispatch cannot produce a duplicate run.

create or replace function public.backup_due(p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg       record;
  v_ist     timestamp := p_at at time zone 'Asia/Kolkata';
  v_date    date      := (p_at at time zone 'Asia/Kolkata')::date;
  v_slot    timestamp;
  v_tries   int;
begin
  select * into cfg from private.backup_config where id = 1;
  if not found or not cfg.enabled then
    return jsonb_build_object('due', false, 'reason', 'switched off');
  end if;

  v_slot := v_date + make_interval(hours => cfg.hour_ist, mins => cfg.minute_ist);
  if v_ist < v_slot then
    return jsonb_build_object('due', false, 'reason', 'before tonight''s slot', 'for_date', v_date);
  end if;
  if v_ist::time > cfg.latest_start_ist then
    return jsonb_build_object('due', false, 'reason', 'past the latest automatic start', 'for_date', v_date);
  end if;

  if exists (select 1 from public.backup_runs r
              where r.for_date = v_date and r.mode <> 'dry-run' and r.status = 'success') then
    return jsonb_build_object('due', false, 'reason', 'already backed up', 'for_date', v_date);
  end if;

  if exists (select 1 from public.backup_runs r
              where r.mode <> 'dry-run' and r.status = 'running'
                and r.started_at > p_at - interval '3 hours') then
    return jsonb_build_object('due', false, 'reason', 'a run is in progress', 'for_date', v_date);
  end if;

  select count(*) into v_tries from public.backup_runs r
   where r.for_date = v_date and r.mode <> 'dry-run';
  if v_tries >= cfg.max_attempts then
    return jsonb_build_object('due', false, 'reason',
             format('gave up after %s attempts', v_tries), 'for_date', v_date);
  end if;

  return jsonb_build_object('due', true, 'reason', 'due', 'for_date', v_date);
end $$;

revoke all on function public.backup_due(timestamptz) from public, anon, authenticated;


-- ------------------------------------------------------------- run start --
--
-- Called by the runner first thing. For a scheduled run it re-asks backup_due
-- and hands back go=false if the answer is no. It also decides what tonight
-- includes, so the schedule lives in one place:
--   · Tally: on tally_dow, or whenever the last good Tally dump is > 7 days old
--     (so a failed Sunday is caught up on Monday).
--   · Full file re-check: the same rule; otherwise only recent files are looked at.

create or replace function public.backup_run_start(
  p_mode       text,
  p_runner_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg        record;
  v_due      jsonb;
  v_date     date := (now() at time zone 'Asia/Kolkata')::date;
  v_dow      int  := extract(dow from (now() at time zone 'Asia/Kolkata'))::int;
  v_tally    boolean;
  v_full     boolean;
  v_id       bigint;
begin
  if p_mode not in ('scheduled', 'full', 'dry-run') then
    raise exception 'backup: unknown mode %', p_mode;
  end if;

  select * into cfg from private.backup_config where id = 1;

  if p_mode = 'scheduled' then
    v_due := public.backup_due();
    if not coalesce((v_due ->> 'due')::boolean, false) then
      return jsonb_build_object('go', false, 'reason', v_due ->> 'reason');
    end if;
  end if;

  v_tally := p_mode = 'full'
          or v_dow = cfg.tally_dow
          or not exists (select 1 from public.backup_runs r
                          where r.status = 'success' and r.mode <> 'dry-run'
                            and coalesce(r.tally_dump_bytes, 0) > 0
                            and r.started_at > now() - interval '7 days');
  v_full  := p_mode = 'full'
          or v_dow = cfg.tally_dow
          or not exists (select 1 from public.backup_runs r
                          where r.status = 'success' and r.mode <> 'dry-run'
                            and r.full_files
                            and r.started_at > now() - interval '7 days');

  insert into public.backup_runs (for_date, mode, include_tally, full_files, runner_url)
  values (v_date, p_mode, v_tally, v_full, p_runner_url)
  returning id into v_id;

  return jsonb_build_object(
    'go',            true,
    'run_id',        v_id,
    'for_date',      v_date,
    'include_tally', v_tally,
    'full_files',    v_full,
    'keep_app',      cfg.keep_app_dumps,
    'keep_tally',    cfg.keep_tally_dumps);
end $$;

revoke all on function public.backup_run_start(text, text) from public, anon, authenticated;


-- ------------------------------------------------------------ run finish --

create or replace function public.backup_run_finish(
  p_run_id  bigint,
  p_status  text,
  p_details jsonb default '{}'::jsonb,
  p_error   text  default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if p_status not in ('success', 'failed') then
    raise exception 'backup: a run finishes as success or failed, not %', p_status;
  end if;

  update public.backup_runs
     set status           = p_status,
         finished_at      = now(),
         files_copied     = nullif(d ->> 'files_copied', '')::int,
         files_bytes      = nullif(d ->> 'files_bytes', '')::bigint,
         app_dump_bytes   = nullif(d ->> 'app_dump_bytes', '')::bigint,
         tally_dump_bytes = nullif(d ->> 'tally_dump_bytes', '')::bigint,
         backup_bytes     = nullif(d ->> 'backup_bytes', '')::bigint,
         details          = d,
         error            = nullif(btrim(coalesce(p_error, '')), '')
   where id = p_run_id;

  if not found then
    raise exception 'backup: no run %', p_run_id;
  end if;
  return format('run %s -> %s', p_run_id, p_status);
end $$;

revoke all on function public.backup_run_finish(bigint, text, jsonb, text) from public, anon, authenticated;


-- --------------------------------------------------------------- dispatch --
--
--   select public.backup_dispatch('dry-run');   -- checks every connection, uploads nothing
--   select public.backup_dispatch('full');      -- everything now: all files, both dumps
--
-- The token is read inside the function, so a test never prints it.

create or replace function public.backup_dispatch(p_mode text default 'scheduled')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg   record;
  v_req bigint;
begin
  if p_mode not in ('scheduled', 'full', 'dry-run') then
    raise exception 'backup: unknown mode %', p_mode;
  end if;

  select * into cfg from private.backup_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.github_pat, '')), '') is null then
    return null;                          -- not configured: a quiet no-op
  end if;

  select net.http_post(
    url     := format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                      cfg.repo, cfg.workflow),
    -- mode is ALWAYS sent: the workflow input defaults to dry-run.
    body    := jsonb_build_object('ref', cfg.git_ref,
                                  'inputs', jsonb_build_object('mode', p_mode)),
    headers := jsonb_build_object(
                 'Content-Type',         'application/json',
                 'Accept',               'application/vnd.github+json',
                 'X-GitHub-Api-Version', '2022-11-28',
                 'User-Agent',           'orange-one-backup',
                 'Authorization',        'Bearer ' || cfg.github_pat),
    timeout_milliseconds := 20000
  ) into v_req;

  update private.backup_config
     set last_kick_at = now(), last_request_id = v_req, updated_at = now()
   where id = 1;

  return v_req;
end $$;

revoke all on function public.backup_dispatch(text) from public, anon, authenticated;


-- ------------------------------------------------------------------- kick --

create or replace function public.backup_kick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
begin
  select * into cfg from private.backup_config where id = 1;
  if not found or not cfg.enabled
     or nullif(btrim(coalesce(cfg.github_pat, '')), '') is null then
    return;
  end if;

  if not coalesce((public.backup_due() ->> 'due')::boolean, false) then
    return;
  end if;

  if cfg.last_kick_at is not null
     and cfg.last_kick_at > now() - make_interval(mins => cfg.min_gap_minutes) then
    return;
  end if;

  perform public.backup_dispatch('scheduled');
end $$;

revoke all on function public.backup_kick() from public, anon, authenticated;


-- --------------------------------------------------------------- watchdog --
--
-- ⚠ It watches for the ABSENCE of a success, not for an error. A token that
--   expired, a dispatch GitHub dropped, a runner that died mid-way: all of them
--   end the same way — no success row for today — and none of them raises.
--
-- Also warns once a week when the backup folder passes warn_at_pct of
-- drive_limit_gb, so the space is bought before an upload fails.
--
-- Mail goes out through the existing payload-driven renderer
-- (receivables_collections_report: subject / headline / body), so the shared
-- send-email function needs no change and no deploy. Its chrome says
-- "Receivables"; a dedicated backup_ renderer can replace it later.

create or replace function public.backup_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      record;
  v_ist    timestamp := now() at time zone 'Asia/Kolkata';
  v_date   date      := (now() at time zone 'Asia/Kolkata')::date;
  -- %rowtype, not record: a SELECT INTO that finds nothing then leaves NULL
  -- fields to test, instead of an unassigned record that raises on access.
  v_last   public.backup_runs%rowtype;
  v_good   public.backup_runs%rowtype;
  v_pct    numeric;
  v_body   text;
begin
  select * into cfg from private.backup_config where id = 1;
  if not found or not cfg.enabled
     or nullif(btrim(coalesce(cfg.alert_email, '')), '') is null then
    return;
  end if;
  if v_ist::time < cfg.alert_after_ist then
    return;                                   -- the night is not over yet
  end if;

  select * into v_good from public.backup_runs r
   where r.status = 'success' and r.mode <> 'dry-run'
   order by r.started_at desc limit 1;

  -- 1. No good backup for today.
  if cfg.last_alert_date is distinct from v_date
     and not exists (select 1 from public.backup_runs r
                      where r.for_date = v_date and r.mode <> 'dry-run' and r.status = 'success') then

    select * into v_last from public.backup_runs r
     where r.for_date = v_date and r.mode <> 'dry-run'
     order by r.started_at desc limit 1;

    v_body := case
      when v_last.id is null then
        'Last night''s backup did not start at all: no run reached the database. '
        || 'Most likely the wake-up call to GitHub failed (token expired or revoked) or GitHub dropped it. '
      else
        format('Last night''s backup started at %s IST and ended as %s. Error: %s. ',
               to_char(v_last.started_at at time zone 'Asia/Kolkata', 'HH24:MI'),
               v_last.status, coalesce(v_last.error, 'none recorded'))
    end
    || case when v_good.id is null then 'There is no successful backup yet.'
            else format('The last good backup is from %s.',
                        to_char(v_good.started_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'))
       end
    || ' Nothing has been deleted: old copies are only removed after a new one is safely saved.';

    insert into public.email_outbox (kind, to_email, to_name, subject, payload)
    values ('receivables_collections_report', cfg.alert_email, 'Orange One',
            format('Orange One backup did NOT complete - %s', to_char(v_date, 'DD Mon')),
            jsonb_build_object(
              'subject',  format('Orange One backup did NOT complete - %s', to_char(v_date, 'DD Mon')),
              'headline', 'Last night''s backup did not complete',
              'body',     v_body));

    update private.backup_config set last_alert_date = v_date, updated_at = now() where id = 1;
  end if;

  -- 2. Space running out.
  if v_good.id is not null and v_good.backup_bytes is not null then
    v_pct := round(100.0 * v_good.backup_bytes / (cfg.drive_limit_gb * 1024 * 1024 * 1024), 1);
    if v_pct >= cfg.warn_at_pct
       and (cfg.last_space_alert_date is null or cfg.last_space_alert_date <= v_date - 7) then
      insert into public.email_outbox (kind, to_email, to_name, subject, payload)
      values ('receivables_collections_report', cfg.alert_email, 'Orange One',
              format('Orange One backup space is %s%% full', v_pct),
              jsonb_build_object(
                'subject',  format('Orange One backup space is %s%% full', v_pct),
                'headline', 'The backup is running out of space',
                'body',     format('The backup folder now holds %s GB of the %s GB that backup@orangeonehub.com may use. '
                                   || 'Please raise that account''s storage limit in Google Admin (Storage) before it fills; '
                                   || 'when it is full, new backups will fail.',
                                   round(v_good.backup_bytes / 1073741824.0, 1), cfg.drive_limit_gb)));
      update private.backup_config set last_space_alert_date = v_date, updated_at = now() where id = 1;
    end if;
  end if;
end $$;

revoke all on function public.backup_watchdog() from public, anon, authenticated;


-- ---------------------------------------------------------------- schedule --
--
-- cron is UTC. Minutes 1,16,31,46 are clear of every job already here
-- (*/3 sweep, 3-59/5 masters watch, 5/20/35/50 company links, */15, */30).
-- The kick is one local query on every tick that is not due.

select cron.schedule(
  'backup-kick',
  '1-59/15 * * * *',
  $cron$ set local statement_timeout = '30s'; select public.backup_kick(); $cron$
);

-- 07:10 IST. The function itself also refuses before alert_after_ist.
select cron.schedule(
  'backup-watchdog',
  '40 1 * * *',
  $cron$ set local statement_timeout = '30s'; select public.backup_watchdog(); $cron$
);


-- ================================================================ asserts ==

do $check$
declare
  v_item    text;
  v_missing text;
begin
  if to_regclass('private.backup_config') is null
     or not exists (select 1 from private.backup_config where id = 1) then
    raise exception 'backup: config singleton missing';
  end if;
  if (select enabled from private.backup_config where id = 1) then
    raise exception 'backup: must start switched OFF';
  end if;
  if to_regclass('public.backup_runs') is null then
    raise exception 'backup: run log missing';
  end if;

  foreach v_item in array array[
    'public.backup_due(timestamptz)',
    'public.backup_run_start(text, text)',
    'public.backup_run_finish(bigint, text, jsonb, text)',
    'public.backup_dispatch(text)',
    'public.backup_kick()',
    'public.backup_watchdog()'
  ] loop
    if to_regprocedure(v_item) is null then
      raise exception 'backup: % was not created', v_item;
    end if;
    if has_function_privilege('anon', v_item, 'execute')
       or has_function_privilege('authenticated', v_item, 'execute') then
      raise exception 'backup: a client role can execute %', v_item;
    end if;
  end loop;

  select string_agg(j.name, ', ') into v_missing
    from (values ('backup-kick'), ('backup-watchdog')) as j(name)
   where not exists (select 1 from cron.job c where c.jobname = j.name);
  if v_missing is not null then
    raise exception 'backup: cron job(s) not scheduled: %', v_missing;
  end if;
end $check$;
