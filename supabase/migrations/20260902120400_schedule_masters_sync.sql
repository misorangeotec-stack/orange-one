-- ===========================================================================
-- CENTRAL MASTERS — the 15-minute watcher, and a daily forced pull.
--
-- Follows 20260703180000_add_leads_google_push_trigger.sql (private config table
-- + pg_net) and 20260830120200_schedule_master_report.sql (cron.schedule is UTC;
-- a named job REPLACES one of the same name, so this file is safe to re-run).
--
-- WHY TWO JOBS AND NOT ONE
--
--   THE WATCHER (every 15 min) asks masters-sync to run; the function itself
--   compares the Tally mirror's receivables_last_sync() watermark against the
--   newest successful run and returns in ~1.5s having done nothing when they
--   match. A pull, when one is due, takes ~25s. So the quiet tick is genuinely
--   cheap and this can run all day.
--
--   THE DAILY FORCE (05:30 UTC = 11:00 IST) exists because THE WATERMARK IS NOT
--   A COMPLETE CHANGE SIGNAL — measured, not assumed. Across three pulls taken
--   at an identical watermark of "2026-08-14T10:17", the mirror returned 13,397
--   then 13,397 then 13,893 stock items. The connector writes into tally_object
--   continuously, but tally_sync_run.finished_at only moves when a run closes,
--   so item changes can land while the watermark sits still. Watermark-gating
--   alone would miss them until the next time a run happened to close.
--
--   Hence: cheap watcher for the common case, one unconditional pull a day so
--   nothing can drift indefinitely, and the "Sync now" button for urgency.
--
-- ⚠ THE SERVICE KEY IS NOT IN THIS FILE, and must not be.
--   masters-sync is deployed with verify_jwt = true and treats a bearer token
--   equal to the service role key as "the scheduler". pg_net therefore has to
--   send it. It is read at call time from private.masters_sync_config, which
--   lives in the `private` schema precisely so PostgREST never exposes it — the
--   same shape private.leads_push_config uses for its push secret.
--
--   ONE MANUAL STEP after applying this migration (service role, SQL editor):
--
--     insert into private.masters_sync_config (id, function_url, service_key)
--     values (1,
--             'https://icutjkrqkbzwvmnfbzpr.supabase.co/functions/v1/masters-sync',
--             '<the identity project SERVICE ROLE key>')
--     on conflict (id) do update
--        set function_url = excluded.function_url,
--            service_key  = excluded.service_key;
--
--   Until that row exists both jobs are a deliberate no-op — they return without
--   calling anything, rather than erroring every 15 minutes.
--
-- Additive: one private table, one function, two cron jobs. No existing object
-- is read or altered.
--
-- Reversal:
--   select cron.unschedule('masters-sync-watch');
--   select cron.unschedule('masters-sync-daily-force');
--   drop function if exists public.masters_sync_tick(boolean);
--   drop table if exists private.masters_sync_config;
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;

create table if not exists private.masters_sync_config (
  id           int primary key default 1 check (id = 1),
  function_url text,
  service_key  text,
  updated_at   timestamptz not null default now()
);

comment on table private.masters_sync_config is
  'Singleton. How the scheduler reaches masters-sync. In the `private` schema so PostgREST never exposes the service key - same shape as private.leads_push_config. Populated by hand once; see the header of 20260902120400.';

-- No RLS needed: the `private` schema is not in PostgREST's search path and is
-- not granted to anon/authenticated. Belt and braces anyway.
revoke all on private.masters_sync_config from public, anon, authenticated;


create or replace function public.masters_sync_tick(p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
begin
  select function_url, service_key into cfg
    from private.masters_sync_config where id = 1;

  -- Not configured yet -> no-op, not an error. A cron job that raises every 15
  -- minutes until somebody pastes a key is worse than one that waits quietly.
  if cfg.function_url is null or cfg.service_key is null then
    return;
  end if;

  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('trigger', 'schedule', 'force', coalesce(p_force, false))
  );
end $$;

comment on function public.masters_sync_tick(boolean) is
  'Fires masters-sync over pg_net. p_force skips the watermark check - used by the once-daily job, because the mirror''s watermark does not move for every change.';

-- The function is the scheduler's, not the app's. The app calls the Edge
-- Function directly with the user's own JWT.
revoke all on function public.masters_sync_tick(boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------- schedule --
--
-- cron.schedule is UTC. 05:30 UTC = 11:00 IST, converted by hand and stated
-- here because nothing in Postgres will convert it for you. 11:00 IST is chosen
-- so a human is at a desk if the forced pull surfaces a problem.

select cron.schedule(
  'masters-sync-watch',
  '*/15 * * * *',
  $cron$ select public.masters_sync_tick(false); $cron$
);

select cron.schedule(
  'masters-sync-daily-force',
  '30 5 * * *',
  $cron$ select public.masters_sync_tick(true); $cron$
);


-- ============================================================== asserts ====

do $check$
declare
  v_missing text;
begin
  if to_regclass('private.masters_sync_config') is null then
    raise exception 'masters sync: private.masters_sync_config was not created';
  end if;
  if to_regprocedure('public.masters_sync_tick(boolean)') is null then
    raise exception 'masters sync: masters_sync_tick was not created';
  end if;

  select string_agg(j.name, ', ') into v_missing
    from (values ('masters-sync-watch'), ('masters-sync-daily-force')) as j(name)
   where not exists (select 1 from cron.job c where c.jobname = j.name);
  if v_missing is not null then
    raise exception 'masters sync: cron job(s) not scheduled: %', v_missing;
  end if;

  -- The watcher must be cheap-and-often, the force must be once-a-day. Swapping
  -- these would pull ~27,000 rows every fifteen minutes.
  if (select schedule from cron.job where jobname = 'masters-sync-watch') <> '*/15 * * * *' then
    raise exception 'masters sync: the watcher is not on a 15-minute schedule';
  end if;
  if (select schedule from cron.job where jobname = 'masters-sync-daily-force') <> '30 5 * * *' then
    raise exception 'masters sync: the forced pull is not once daily';
  end if;

  if has_function_privilege('anon', 'public.masters_sync_tick(boolean)', 'execute') then
    raise exception 'masters sync: anon can execute masters_sync_tick';
  end if;
end $check$;
