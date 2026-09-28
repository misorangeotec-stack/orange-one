-- ===========================================================================
-- DAILY REPORT (DR-3) — the WAKING, and the watchdog that notices when it fails.
--
-- Follows 20261212120000, which added the gate. That file decides WHETHER to send; this one decides
-- WHEN to ask, and tells somebody when the answer never got asked.
--
-- ── WHY pg_cron AND NOT GITHUB'S OWN SCHEDULER ───────────────────────────────────────────────
--   Because GitHub's scheduler does not keep time on this repository, and that is measured. Against
--   48 ticks a day expected from `*/30`, the Collection report's workflow actually fired:
--
--       22-Aug 40 · 23-Aug 39 · 24-Aug 29 · 25-Aug 31 · 26-Aug 18 · 27-Aug 3 · 28-Aug 2 · 29-Aug 1
--
--   On Saturday 29-Aug-2026 the 08:00 IST slot was MISSED OUTRIGHT: the last tick before it ran at
--   06:53 IST and the next never came, so a 120-minute grace window had ZERO opportunities. Nothing
--   was misconfigured — replaying the gate at 08:05 returned due:true and 63 mails. Meanwhile
--   pg_cron's `master-report-daily`, scheduled for the same minute, fired at 08:00:00 IST (+/-40 ms)
--   on nine consecutive days including that one.
--
--   So the DECISION stays in `daily_report_email_due()` and the WAKING lives here. GitHub's own
--   `*/30` cron is deliberately left in the workflow as a free backstop; it cannot double-send,
--   because the runner re-asks the gate and the send log claims the slot.
--
-- ── FOUR WAYS A DISPATCH DOES NOTHING AND REPORTS SUCCESS ────────────────────────────────────
--   Every one of these has been hit on the Collection report. All four are silent.
--     1. The body omits `inputs.mode`. The workflow input DEFAULTS to `dry-run`, so the whole report
--        is built and nothing is posted — and the run is green. `mode` is therefore ALWAYS sent.
--     2. `ref` is not `master`. `workflow_dispatch` needs a ref, and a scheduled workflow only
--        exists on the default branch; a ref without this workflow is a 404 nobody reads.
--     3. The request has no `User-Agent`. GitHub rejects it and pg_net adds none.
--     4. The token is not `misorangeotec-stack`'s. This repo lives under that account (see the
--        github-account-per-project note); a token from the other account 404s.
--
-- ── THE TOKEN GETS ITS OWN ROW, AND DOES NOT HAVE TO BE THE COLLECTION REPORT'S ──────────────
--   `private.collections_report_kick_config` currently holds a BORROWED credential: the `gh` CLI's
--   own OAuth token rather than a purpose-made PAT. Sharing it would mean one revocation, or one
--   `gh auth logout`, silently stopping TWO reports at once and neither of them saying why. So this
--   job has its own config row. Setting it to the same string is allowed and is a decision somebody
--   can make; inheriting it by accident is not.
--
--   ⚠ NOT VAULT. Secrets here live in a `private.*_config` table, following
--     private.masters_sync_config and private.collections_report_kick_config. `private` is not
--     exposed through PostgREST and the setter below is service-role only, so the token never passes
--     through a SQL editor transcript or this migration file.
--
-- ── THE CRON MINUTES ARE CHOSEN, NOT DEFAULTED, AND HERE IS THE ARITHMETIC ───────────────────
--   `*/15` would have been the obvious copy of the Collection report's kick and is exactly wrong:
--   it lands on minute 0 alongside `collections-report-kick`, `collections-report-watchdog` and
--   `email-outbox-sweep`. Checked against all 17 jobs live on 28-09-2026:
--
--       email-outbox-sweep          */3         0,3,6,9,...
--       masters-sync-watch          3-59/5      3,8,13,18,...
--       backup-kick                 1-59/15     1,16,31,46
--       collections-report-kick     */15        0,15,30,45
--       collections-report-watchdog */30        0,30
--       mst-refresh-company-links   5,20,35,50
--
--   `7-59/15`  -> 7, 22, 37, 52   collides with none of them.
--   `11-59/30` -> 11, 41          collides with none of them.
--
--   ⚠ THE COLLISION IS ARITHMETIC, NOT A NAME CLASH, so it is invisible in `cron.job`. Two jobs on
--     the same minute contend for the same worker; a 30s statement timeout then turns a busy minute
--     into a skipped tick. Anything added later must redo this sum.
--
-- Additive: one private table, four functions, two cron jobs. Nothing existing is altered.
--
-- Reversal:
--   select cron.unschedule('daily-report-email-kick');
--   select cron.unschedule('daily-report-email-watchdog');
--   drop function if exists public.daily_report_email_watchdog(timestamptz);
--   drop function if exists public.daily_report_email_kick();
--   drop function if exists public.daily_report_email_dispatch(text, text, text);
--   drop function if exists public.set_daily_report_email_kick_pat(text, text);
--   drop table if exists private.daily_report_email_kick_config;
--
-- ⚠ THE CRON JOBS CREATED HERE ARE HARMLESS UNTIL THE REPORT IS ARMED. Every tick asks
--   `daily_report_email_due()`, which answers "automatic sending is not armed" and does no HTTP.
-- ===========================================================================

create schema if not exists private;

-- ----------------------------------------------------------------- config --

create table if not exists private.daily_report_email_kick_config (
  id               int primary key default 1 check (id = 1),
  github_pat       text,
  repo             text not null default 'misorangeotec-stack/orange-one',
  workflow         text not null default 'daily-report.yml',
  git_ref          text not null default 'master',
  -- A real run is about 60-90s (checkout, npm ci, bundle, 3s of reads, 2s of drawing). Without a
  -- gap a 15-minute tick could poke twice before the first run has claimed the slot. The second
  -- would exit harmlessly on the gate, but it would still spend a minute of runner time doing so.
  min_gap_minutes  int  not null default 20,
  -- NULL means "do not alert". Safe by default: a watchdog that cannot name a recipient must stay
  -- quiet rather than guess one.
  alert_email      text,
  last_kick_at     timestamptz,
  last_request_id  bigint,
  -- IST date of the last watchdog alert, so a missed slot is reported ONCE and not every half hour
  -- for the rest of the day.
  last_alert_date  date,
  updated_at       timestamptz not null default now()
);

insert into private.daily_report_email_kick_config (id) values (1) on conflict (id) do nothing;

comment on table private.daily_report_email_kick_config is
  'Singleton. How pg_cron reaches the GitHub runner that draws the Daily Report. In the `private` schema so PostgREST never exposes the token. Populated by hand once: select set_daily_report_email_kick_pat(...).';

revoke all on private.daily_report_email_kick_config from public, anon, authenticated;


-- ----------------------------------------------------------------- setter --
--
-- Exists so the token can be written WITHOUT passing through a SQL editor transcript or a migration
-- file. Service role only: unlike set_daily_report_email_armed there is no is_admin(auth.uid())
-- test, because auth.uid() is null on a service-role call and the grant below is the control.

create or replace function public.set_daily_report_email_kick_pat(
  p_pat         text,
  p_alert_email text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update private.daily_report_email_kick_config
     set github_pat  = nullif(btrim(coalesce(p_pat, '')), ''),
         alert_email = coalesce(nullif(btrim(coalesce(p_alert_email, '')), ''), alert_email),
         updated_at  = now()
   where id = 1;

  -- Deliberately returns a fingerprint, never the token.
  return format('stored: %s chars, alert -> %s',
                (select coalesce(length(github_pat), 0)
                   from private.daily_report_email_kick_config where id = 1),
                coalesce((select alert_email
                            from private.daily_report_email_kick_config where id = 1),
                         '(none)'));
end $$;

revoke all on function public.set_daily_report_email_kick_pat(text, text)
  from public, anon, authenticated;


-- --------------------------------------------------------------- dispatch --
--
-- The raw poke. Split out from the gate so a mode can be forced BY HAND for testing without
-- touching the schedule, the switches or the send log:
--
--   select public.daily_report_email_dispatch('dry-run');                       -- builds, sends nothing
--   select public.daily_report_email_dispatch('sample', 'you@example.com');     -- one address, slot NOT claimed
--   select public.daily_report_email_dispatch('dry-run', null, '2026-09-16');   -- a past evening
--
-- Verify with: select status_code from net._http_response order by id desc limit 1;  -- GitHub: 204
--
-- The token is read inside the function, so a test never prints it.

create or replace function public.daily_report_email_dispatch(
  p_mode      text default 'scheduled',
  p_sample_to text default null,
  p_for_date  text default null
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
  -- ⚠ EVERY ARGUMENT IS VALIDATED BEFORE THE CONFIG IS READ, AND THE ORDER IS THE POINT.
  --   The first cut checked the date below, AFTER the "no token yet" early return — so on an
  --   unconfigured database `dispatch('scheduled', null, '2026-09-16')` returned NULL and looked
  --   accepted. Caught by rehearsing this migration on 28-09-2026. A validation that only fires once
  --   a secret is present is a validation that is absent exactly when someone is still learning the
  --   function, which is when it is most needed.
  if p_mode not in ('dry-run', 'sample', 'scheduled') then
    raise exception 'daily report: unknown mode %', p_mode;
  end if;

  if p_mode = 'sample' and nullif(btrim(coalesce(p_sample_to, '')), '') is null then
    raise exception 'daily report: MODE=sample needs an address';
  end if;

  if nullif(btrim(coalesce(p_for_date, '')), '') is not null then
    -- Refused for a scheduled run here as well as in the runner: the send log is keyed on the date
    -- the GATE chose, so building a different day and claiming that slot would file one evening's
    -- figures under another's.
    if p_mode = 'scheduled' then
      raise exception 'daily report: a scheduled run may not be given a date; the gate chooses it';
    end if;
    if btrim(p_for_date) !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'daily report: for_date must be YYYY-MM-DD (got %)', p_for_date;
    end if;
  end if;

  select * into cfg from private.daily_report_email_kick_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.github_pat, '')), '') is null then
    return null;                      -- not configured: a quiet no-op, not an error
  end if;

  -- ⚠ mode is ALWAYS sent. The workflow input defaults to dry-run, so leaving it out would silently
  --   build the whole report, post nothing, and report success. Trap 1 in the header.
  v_in := jsonb_build_object('mode', p_mode);

  -- Validated above; this is assembly only.
  if p_mode = 'sample' then
    v_in := v_in || jsonb_build_object('sample_to', btrim(p_sample_to));
  end if;
  if nullif(btrim(coalesce(p_for_date, '')), '') is not null then
    v_in := v_in || jsonb_build_object('for_date', btrim(p_for_date));
  end if;

  select net.http_post(
    url     := format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                      cfg.repo, cfg.workflow),
    body    := jsonb_build_object('ref', cfg.git_ref, 'inputs', v_in),
    headers := jsonb_build_object(
                 'Content-Type',         'application/json',
                 'Accept',               'application/vnd.github+json',
                 'X-GitHub-Api-Version', '2022-11-28',
                 -- GitHub rejects a request with no User-Agent and pg_net adds none. Trap 3.
                 'User-Agent',           'orange-one-daily-report',
                 'Authorization',        'Bearer ' || cfg.github_pat)
  ) into v_req;

  update private.daily_report_email_kick_config
     set last_kick_at = now(), last_request_id = v_req, updated_at = now()
   where id = 1;

  return v_req;
end $$;

revoke all on function public.daily_report_email_dispatch(text, text, text)
  from public, anon, authenticated;


-- ------------------------------------------------------------------- kick --
--
-- The scheduled path. Asks the SAME gate the runner asks, so the settings screen an admin edits and
-- the rule that decides remain one object. No HTTP happens on a tick that is not due, which is 95
-- of the 96 daily ticks.

create or replace function public.daily_report_email_kick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg   record;
  v_due jsonb;
begin
  select * into cfg from private.daily_report_email_kick_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.github_pat, '')), '') is null then
    return;
  end if;

  v_due := public.daily_report_email_due();
  if not coalesce((v_due ->> 'due')::boolean, false) then
    return;
  end if;

  -- A run may already be in flight; see min_gap_minutes above.
  if cfg.last_kick_at is not null
     and cfg.last_kick_at > now() - make_interval(mins => cfg.min_gap_minutes) then
    return;
  end if;

  perform public.daily_report_email_dispatch('scheduled');
end $$;

revoke all on function public.daily_report_email_kick() from public, anon, authenticated;


-- --------------------------------------------------------------- watchdog --
--
-- ⚠ THE POINT OF THIS FUNCTION IS THAT THE FAILURE IT CATCHES IS INVISIBLE.
--   Every workflow run exits SUCCESS, because "not due" is a successful run, and a dropped tick
--   creates no run at all. Whatever the cause — a dead timer, an expired token, a revoked scope, a
--   GitHub outage, a runner failure, this repo's scheduled workflows disabled after 60 quiet days —
--   it ends the same way: the slot passed and the send log has no row. Nothing anywhere goes red.
--   That is the one thing worth watching.
--
-- ⚠ IT DOES NOT FIRE FOR AN EMPTY DISTRIBUTION LIST, AND THAT IS DELIBERATE. With no recipients the
--   gate says "nobody to send to" rather than "due", so the slot is never claimed and this would
--   alert every single evening. Building it while the list is empty is the normal state during
--   DR-3's rollout; an alert that cries wolf nightly gets muted, and then the real one is missed.

--
-- ⚠ IT TAKES A CLOCK, UNLIKE `collections_report_watchdog`, AND THAT IS WHY THIS ONE IS TESTED.
--   The Collection report's watchdog reads `now()` internally, so the only way to see it fire is to
--   wait for a slot to be missed in real life — which is to say, it shipped unproven. `p_now`
--   defaults to `now()`, so pg_cron calls it exactly as before, and a rehearsal can wind the clock
--   past a slot inside a transaction it then rolls back. That is how the alert below was actually
--   observed rather than assumed.
create or replace function public.daily_report_email_watchdog(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg     record;
  v_ist   timestamp := p_now at time zone 'Asia/Kolkata';
  v_date  date      := (p_now at time zone 'Asia/Kolkata')::date;
  v_grace int;
  v_sched record;
  v_slot  timestamp;
  v_today boolean;
  v_due   jsonb;
  v_reason text;
begin
  select * into cfg from private.daily_report_email_kick_config where id = 1;
  if not found or nullif(btrim(coalesce(cfg.alert_email, '')), '') is null then
    return;                                    -- nobody to tell: stay quiet
  end if;

  -- Report once per IST day, not every tick for the rest of it.
  if cfg.last_alert_date = v_date then
    return;
  end if;

  if not coalesce((select armed from private.daily_report_email_config where id), false) then
    return;                                    -- switched off on purpose is not a failure
  end if;

  if not public.report_email_enabled('daily-report') then
    return;                                    -- likewise
  end if;

  select * into v_sched from public.report_email_schedule s where s.report_key = 'daily-report';
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

  select grace_minutes into v_grace from private.daily_report_email_config where id;
  v_slot := v_date + make_interval(hours => v_sched.hour_ist, mins => v_sched.minute_ist);

  -- Still inside the window: it may yet go out. Not a failure yet.
  if v_ist <= v_slot + make_interval(mins => coalesce(v_grace, 60)) then
    return;
  end if;

  if exists (select 1 from public.daily_report_email_send_log l
              where l.report_key = 'daily-report' and l.sent_for_date = v_date) then
    return;                                    -- it went out; nothing to say
  end if;

  -- The SAME clock, so the reason it reports describes the moment it is reporting on.
  -- ⚠ THE EMPTY LIST IS CHECKED DIRECTLY, NOT BY READING THE GATE'S `reason`, AND THE FIRST CUT
  --   GOT THIS WRONG. It tested `reason = 'nobody to send to'` — which the gate can never return
  --   once the window has closed, because it checks the grace window BEFORE it looks at the
  --   recipients and returns 'missed ...' instead. So the suppression was dead code, and a database
  --   with no distribution list would have mailed this alert every single night. Caught by
  --   rehearsing the watchdog against a wound clock on 28-09-2026, which is the whole reason
  --   `p_now` exists.
  if not exists (
    select 1 from public.report_email_recipients r
     where r.report_key = 'daily-report' and r.scope = 'book' and r.enabled
       and nullif(btrim(coalesce(r.email, '')), '') is not null
  ) then
    return;
  end if;

  v_due := public.daily_report_email_due('daily-report', p_now);
  v_reason := coalesce(v_due ->> 'reason', 'unknown');

  insert into public.email_outbox (kind, to_email, to_name, subject, payload)
  values (
    'daily_report_missed',
    cfg.alert_email,
    'Orange One',
    format('Daily Report was NOT sent - %s', to_char(v_date, 'DD Mon')),
    jsonb_build_object(
      'for_date',      v_date,
      'slot_ist',      to_char(v_slot, 'HH24:MI'),
      'grace_minutes', coalesce(v_grace, 60),
      'checked_at',    to_char(v_ist, 'DD Mon HH24:MI'),
      'reason',        v_reason,
      'last_kick_at',  case when cfg.last_kick_at is null then null
                            else to_char(cfg.last_kick_at at time zone 'Asia/Kolkata',
                                         'DD Mon HH24:MI') end)
  );

  update private.daily_report_email_kick_config
     set last_alert_date = v_date, updated_at = now()
   where id = 1;
end $$;

revoke all on function public.daily_report_email_watchdog(timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------- schedule --
--
-- cron.schedule is UTC; a named job REPLACES one of the same name, so this file is safe to re-run.
-- The minutes are chosen rather than defaulted — see the arithmetic in the header. Every 15 minutes
-- costs nothing on a quiet tick: the gate is one local call and no HTTP happens unless it says yes.

select cron.schedule(
  'daily-report-email-kick',
  '7-59/15 * * * *',
  $cron$ set local statement_timeout = '30s'; select public.daily_report_email_kick(); $cron$
);

-- Half-hourly rather than at one fixed time, because the slot and the grace are both editable on
-- the settings screen; the function works out whether the window has closed.
select cron.schedule(
  'daily-report-email-watchdog',
  '11-59/30 * * * *',
  $cron$ set local statement_timeout = '30s'; select public.daily_report_email_watchdog(); $cron$
);


-- ================================================================ asserts ==

do $check$
declare
  v_item    text;
  v_missing text;
  v_clash   text;
begin
  if to_regclass('private.daily_report_email_kick_config') is null then
    raise exception 'daily report kick: config table was not created';
  end if;
  if not exists (select 1 from private.daily_report_email_kick_config where id = 1) then
    raise exception 'daily report kick: the singleton row is missing';
  end if;

  foreach v_item in array array[
    'public.daily_report_email_kick()',
    'public.daily_report_email_watchdog(timestamptz)',
    'public.daily_report_email_dispatch(text, text, text)',
    'public.set_daily_report_email_kick_pat(text, text)'
  ] loop
    if to_regprocedure(v_item) is null then
      raise exception 'daily report kick: % was not created', v_item;
    end if;
  end loop;

  select string_agg(j.name, ', ') into v_missing
    from (values ('daily-report-email-kick'), ('daily-report-email-watchdog')) as j(name)
   where not exists (select 1 from cron.job c where c.jobname = j.name);
  if v_missing is not null then
    raise exception 'daily report kick: cron job(s) not scheduled: %', v_missing;
  end if;

  -- The gate must still be the thing that decides. If it stops existing the kick pokes blind.
  if to_regprocedure('public.daily_report_email_due(text, timestamptz)') is null then
    raise exception 'daily report kick: daily_report_email_due is missing (run 20261212120000 first)';
  end if;

  -- ⚠ THE SCHEDULE MUST STILL BE THE ONE THIS FILE REASONED ABOUT. Someone editing the cron
  --   expression to a `*/15` or `*/30` would reintroduce the collision the header works out, and
  --   nothing else in the system would notice.
  select string_agg(format('%s=%s', c.jobname, c.schedule), ', ') into v_clash
    from cron.job c
   where (c.jobname = 'daily-report-email-kick'     and c.schedule <> '7-59/15 * * * *')
      or (c.jobname = 'daily-report-email-watchdog' and c.schedule <> '11-59/30 * * * *');
  if v_clash is not null then
    raise exception 'daily report kick: unexpected schedule (%). See the cron arithmetic in this file''s header.', v_clash;
  end if;

  if has_function_privilege('anon', 'public.daily_report_email_dispatch(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.daily_report_email_dispatch(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.daily_report_email_watchdog(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.daily_report_email_watchdog(timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.set_daily_report_email_kick_pat(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.set_daily_report_email_kick_pat(text, text)', 'execute')
  then
    raise exception 'daily report kick: a client role can dispatch or set the token';
  end if;

  -- Nothing may arrive with a token, which would make the kick live the moment it is armed
  -- elsewhere without anybody having decided to wire it up.
  if exists (select 1 from private.daily_report_email_kick_config
              where nullif(btrim(coalesce(github_pat, '')), '') is not null) then
    raise exception 'daily report kick: a token arrived in the migration; set it with set_daily_report_email_kick_pat()';
  end if;
end $check$;
