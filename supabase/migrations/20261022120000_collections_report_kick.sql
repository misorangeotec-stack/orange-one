-- ===========================================================================
-- COLLECTION REPORT — move the WAKING onto the clock that actually works.
--
-- WHAT BROKE, MEASURED RATHER THAN ASSUMED
--
--   The report is DECIDED by this database and SENT by a GitHub Actions runner.
--   It has to be: drawing it is ~40s of CPU (101-page PDF + 1.5 MB workbook)
--   against a 2s Edge Function ceiling. See the header of collections-report.yml.
--
--   GitHub's own `schedule` trigger is the only part that failed, and it failed
--   progressively. Scheduled ticks actually fired, against 48/day expected from
--   the workflow's `*/30`:
--
--       22-Aug  40      26-Aug  18      28-Aug   2
--       23-Aug  39      27-Aug   3      29-Aug   1
--
--   On Saturday 29-Aug-2026 the 08:00 IST slot was MISSED. The last tick before
--   it ran at 01:23:56Z (06:53 IST, 67 minutes early) and the next never came,
--   so the 120-minute grace window expired at 10:00 IST having had ZERO
--   opportunities. Nothing was misconfigured: replaying the gate at 08:05 IST
--   returns due=true with 4 book recipients and 59 rep copies.
--
--   Meanwhile pg_cron's `master-report-daily` is scheduled for 08:00 IST — THE
--   SAME MINUTE — and fired at 08:00:00 IST (+-40ms) on nine consecutive days
--   including 29-Aug, 9/9 succeeded. Same building, two clocks, one of them
--   keeps time.
--
--   So: pg_cron decides and pokes; the runner still draws and sends. GitHub's
--   `*/30` cron is deliberately LEFT IN PLACE as a free backstop — entry.ts
--   re-asks the gate on every run and the send log's (report_key, sent_for_date)
--   key makes a double-send impossible.
--
-- WHY A `private` TABLE AND NOT VAULT
--   supabase_vault is installed but holds zero secrets and is used nowhere in
--   this project. The established shape is a private singleton config table —
--   private.leads_push_config, private.masters_sync_config — which PostgREST
--   never exposes because the schema is not in its search path. Following the
--   odd one out would be the mistake.
--
-- ⚠ THE FOUR THINGS THAT EACH BREAK THIS SILENTLY IF GOT WRONG
--   1. The body MUST carry inputs.mode = 'scheduled'. The workflow's `mode`
--      input DEFAULTS TO 'dry-run' — omit it and the runner builds the whole
--      report and posts NOTHING, reporting success.
--   2. `ref` must be master. workflow_dispatch requires a ref and scheduled
--      workflows only exist on the default branch.
--   3. GitHub's API REJECTS a request with no User-Agent, and pg_net does not
--      add one. It is set explicitly below.
--   4. The token must belong to an account with write access to the repo —
--      misorangeotec-stack, not neplhub (fine-grained: Actions read+write;
--      classic: repo + workflow).
--
-- ⚠ ONE MANUAL STEP after applying this migration — the token is NOT in this
--   file and must not be. As the service role:
--
--     select public.set_collections_report_kick_pat('<token>', '<alert email>');
--
--   Until that row carries a token, collections_report_kick() is a deliberate
--   no-op: it returns without calling anything, rather than raising every 15
--   minutes until somebody pastes a key.
--
-- Additive: one private table, three functions, two cron jobs. No existing
-- object is altered or dropped; collections_report_due(), the send log and the
-- workflow file are all untouched.
--
-- Reversal:
--   select cron.unschedule('collections-report-kick');
--   select cron.unschedule('collections-report-watchdog');
--   drop function if exists public.collections_report_kick();
--   drop function if exists public.collections_report_watchdog();
--   drop function if exists public.collections_report_dispatch(text, text);
--   drop function if exists public.set_collections_report_kick_pat(text, text);
--   drop table if exists private.collections_report_kick_config;
--   -- GitHub's own cron is untouched, so this falls back to today's behaviour.
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;


-- ----------------------------------------------------------------- config --

create table if not exists private.collections_report_kick_config (
  id               int primary key default 1 check (id = 1),
  github_pat       text,
  repo             text not null default 'misorangeotec-stack/orange-one',
  workflow         text not null default 'collections-report.yml',
  git_ref          text not null default 'master',
  -- A real build takes ~135s ("239 listed - 62 mails - 135.0s" in the send log).
  -- Without a gap, a 15-minute tick could poke twice before the first run has
  -- claimed the slot. The second run would exit harmlessly on the gate, but it
  -- would still spend two minutes of runner time finding that out.
  min_gap_minutes  int  not null default 20,
  -- NULL means "do not alert". Safe by default: a watchdog that cannot name a
  -- recipient must stay quiet rather than guess one.
  alert_email      text,
  last_kick_at     timestamptz,
  last_request_id  bigint,
  -- IST date of the last watchdog alert, so a missed slot is reported ONCE and
  -- not every thirty minutes for the rest of the day.
  last_alert_date  date,
  updated_at       timestamptz not null default now()
);

insert into private.collections_report_kick_config (id) values (1)
  on conflict (id) do nothing;

comment on table private.collections_report_kick_config is
  'Singleton. How pg_cron reaches the GitHub runner that draws the Collection report. In the `private` schema so PostgREST never exposes the token - same shape as private.masters_sync_config. Populated by hand once; see the header of 20261022120000.';

revoke all on private.collections_report_kick_config from public, anon, authenticated;


-- ----------------------------------------------------------------- setter --
--
-- Exists so the token can be written WITHOUT it passing through a SQL editor
-- transcript or a migration file. Service role only: unlike
-- set_collections_report_armed there is no is_admin(auth.uid()) test, because
-- auth.uid() is null on a service-role call and the grant below is the control.

create or replace function public.set_collections_report_kick_pat(
  p_pat         text,
  p_alert_email text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update private.collections_report_kick_config
     set github_pat  = nullif(btrim(coalesce(p_pat, '')), ''),
         alert_email = coalesce(nullif(btrim(coalesce(p_alert_email, '')), ''), alert_email),
         updated_at  = now()
   where id = 1;

  -- Deliberately returns a fingerprint, never the token.
  return format('stored: %s chars, alert -> %s',
                (select coalesce(length(github_pat), 0)
                   from private.collections_report_kick_config where id = 1),
                coalesce((select alert_email
                            from private.collections_report_kick_config where id = 1),
                         '(none)'));
end $$;

revoke all on function public.set_collections_report_kick_pat(text, text)
  from public, anon, authenticated;


-- --------------------------------------------------------------- dispatch --
--
-- The raw poke. Split out from the gate so a mode can be forced BY HAND for
-- testing without touching the schedule, the switches or the send log:
--
--   select public.collections_report_dispatch('dry-run');                  -- builds, sends nothing
--   select public.collections_report_dispatch('sample', 'you@example.com');-- mails one address, slot NOT claimed
--
-- The token is read inside the function, so a test never prints it.

create or replace function public.collections_report_dispatch(
  p_mode      text default 'scheduled',
  p_sample_to text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg    record;
  v_req  bigint;
  v_in   jsonb;
begin
  if p_mode not in ('dry-run', 'sample', 'scheduled') then
    raise exception 'collections report: unknown mode %', p_mode;
  end if;

  select * into cfg from private.collections_report_kick_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.github_pat, '')), '') is null then
    return null;                      -- not configured: a quiet no-op, not an error
  end if;

  -- mode is ALWAYS sent. The workflow input defaults to dry-run, so leaving it
  -- out would silently build the whole report and post nothing.
  v_in := jsonb_build_object('mode', p_mode);
  if p_mode = 'sample' then
    if nullif(btrim(coalesce(p_sample_to, '')), '') is null then
      raise exception 'collections report: MODE=sample needs an address';
    end if;
    v_in := v_in || jsonb_build_object('sample_to', btrim(p_sample_to));
  end if;

  select net.http_post(
    url     := format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                      cfg.repo, cfg.workflow),
    body    := jsonb_build_object('ref', cfg.git_ref, 'inputs', v_in),
    headers := jsonb_build_object(
                 'Content-Type',         'application/json',
                 'Accept',               'application/vnd.github+json',
                 'X-GitHub-Api-Version', '2022-11-28',
                 -- GitHub rejects a request with no User-Agent and pg_net adds none.
                 'User-Agent',           'orange-one-collections-report',
                 'Authorization',        'Bearer ' || cfg.github_pat)
  ) into v_req;

  update private.collections_report_kick_config
     set last_kick_at = now(), last_request_id = v_req, updated_at = now()
   where id = 1;

  return v_req;
end $$;

revoke all on function public.collections_report_dispatch(text, text)
  from public, anon, authenticated;


-- ------------------------------------------------------------------- kick --
--
-- The scheduled path. Asks the SAME gate the runner asks, so the settings screen
-- an admin edits and the rule that decides remain one object. No HTTP happens on
-- a tick that is not due, which is all but two or three ticks a week.

create or replace function public.collections_report_kick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg   record;
  v_due jsonb;
begin
  select * into cfg from private.collections_report_kick_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.github_pat, '')), '') is null then
    return;
  end if;

  v_due := public.collections_report_due();
  if not coalesce((v_due ->> 'due')::boolean, false) then
    return;
  end if;

  -- A run may already be in flight; see min_gap_minutes above.
  if cfg.last_kick_at is not null
     and cfg.last_kick_at > now() - make_interval(mins => cfg.min_gap_minutes) then
    return;
  end if;

  perform public.collections_report_dispatch('scheduled');
end $$;

revoke all on function public.collections_report_kick() from public, anon, authenticated;


-- --------------------------------------------------------------- watchdog --
--
-- ⚠ THE POINT OF THIS FUNCTION IS THAT THE FAILURE IT CATCHES IS INVISIBLE.
--   Every workflow run exits SUCCESS, because "not due" is a successful run, and
--   a dropped GitHub tick creates no run at all. On 29-Aug nothing anywhere went
--   red. Whatever the cause — a dead timer, an expired token, a revoked scope, a
--   GitHub outage, a runner failure — it ends the same way: the slot passed and
--   the send log has no row. That is the one thing worth watching.

create or replace function public.collections_report_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg     record;
  v_ist   timestamp := now() at time zone 'Asia/Kolkata';
  v_date  date      := (now() at time zone 'Asia/Kolkata')::date;
  v_grace int;
  v_sched record;
  v_slot  timestamp;
  v_today boolean;
begin
  select * into cfg from private.collections_report_kick_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.alert_email, '')), '') is null then
    return;                                    -- nobody to tell: stay quiet
  end if;

  -- Report once per IST day, not every tick for the rest of it.
  if cfg.last_alert_date = v_date then
    return;
  end if;

  if not coalesce((select armed from private.collections_report_config where id), false) then
    return;                                    -- switched off on purpose is not a failure
  end if;

  select * into v_sched from public.report_email_schedule s
   where s.report_key = 'zero-collections';
  if not found or v_sched.frequency = 'off' then
    return;
  end if;

  v_today := case v_sched.frequency
               when 'daily'   then true
               when 'weekly'  then extract(dow from v_date)::int = any(
                                     coalesce(v_sched.days_of_week,
                                              array[v_sched.day_of_week]::int[]))
               when 'monthly' then extract(day from v_date)::int = v_sched.day_of_month
               else false
             end;
  if not coalesce(v_today, false) then
    return;
  end if;

  select grace_minutes into v_grace from private.collections_report_config where id;
  v_slot := v_date + make_interval(hours => v_sched.hour_ist, mins => v_sched.minute_ist);

  -- Still inside the window: it may yet go out. Not a failure yet.
  if v_ist <= v_slot + make_interval(mins => coalesce(v_grace, 120)) then
    return;
  end if;

  if exists (select 1 from public.collections_report_send_log l
              where l.report_key = 'zero-collections' and l.sent_for_date = v_date) then
    return;                                    -- it went out; nothing to say
  end if;

  insert into public.email_outbox (kind, to_email, to_name, subject, payload)
  values (
    'collections_report_missed',
    cfg.alert_email,
    'Orange One',
    format('Collection report was NOT sent - %s', to_char(v_date, 'DD Mon')),
    jsonb_build_object(
      'for_date',      v_date,
      'slot_ist',      to_char(v_slot, 'HH24:MI'),
      'grace_minutes', coalesce(v_grace, 120),
      'checked_at',    to_char(v_ist, 'DD Mon HH24:MI'),
      'reason',        coalesce(public.collections_report_due() ->> 'reason', 'unknown'),
      'last_kick_at',  case when cfg.last_kick_at is null then null
                            else to_char(cfg.last_kick_at at time zone 'Asia/Kolkata',
                                         'DD Mon HH24:MI') end)
  );

  update private.collections_report_kick_config
     set last_alert_date = v_date, updated_at = now()
   where id = 1;
end $$;

revoke all on function public.collections_report_watchdog() from public, anon, authenticated;


-- ---------------------------------------------------------------- schedule --
--
-- cron.schedule is UTC; a named job REPLACES one of the same name, so this file
-- is safe to re-run. Every 15 minutes costs nothing on a quiet tick: the gate is
-- one local call and no HTTP happens unless it says yes. This matches
-- masters-sync-watch, which has run `*/15` all day since 02-Sep.

select cron.schedule(
  'collections-report-kick',
  '*/15 * * * *',
  $cron$ set local statement_timeout = '30s'; select public.collections_report_kick(); $cron$
);

-- Half-hourly rather than at one fixed time, because the slot and the grace are
-- both editable on the settings screen; the function works out whether the
-- window has closed.
select cron.schedule(
  'collections-report-watchdog',
  '*/30 * * * *',
  $cron$ set local statement_timeout = '30s'; select public.collections_report_watchdog(); $cron$
);


-- ================================================================ asserts ==

do $check$
declare
  v_item    text;
  v_missing text;
begin
  if to_regclass('private.collections_report_kick_config') is null then
    raise exception 'collections kick: config table was not created';
  end if;
  if not exists (select 1 from private.collections_report_kick_config where id = 1) then
    raise exception 'collections kick: the singleton row is missing';
  end if;

  foreach v_item in array array[
    'public.collections_report_kick()',
    'public.collections_report_watchdog()',
    'public.collections_report_dispatch(text, text)',
    'public.set_collections_report_kick_pat(text, text)'
  ] loop
    if to_regprocedure(v_item) is null then
      raise exception 'collections kick: % was not created', v_item;
    end if;
  end loop;

  select string_agg(j.name, ', ') into v_missing
    from (values ('collections-report-kick'), ('collections-report-watchdog')) as j(name)
   where not exists (select 1 from cron.job c where c.jobname = j.name);
  if v_missing is not null then
    raise exception 'collections kick: cron job(s) not scheduled: %', v_missing;
  end if;

  -- The gate must still be the thing that decides. If this ever stops existing
  -- the kick would be poking blind.
  if to_regprocedure('public.collections_report_due(text, timestamptz)') is null then
    raise exception 'collections kick: collections_report_due is missing';
  end if;

  if has_function_privilege('anon', 'public.collections_report_dispatch(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.collections_report_dispatch(text, text)', 'execute')
     or has_function_privilege('anon', 'public.set_collections_report_kick_pat(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_collections_report_kick_pat(text, text)', 'execute')
  then
    raise exception 'collections kick: a client role can dispatch or set the token';
  end if;
end $check$;
