-- ===========================================================================
-- MASTERS SYNC · MOVE OUR CLOCK OFF ConnectWave's, AND CHECK FIVE TIMES AS OFTEN
--
-- WHY
-- Three scheduled pulls failed between 09-09 and 11-09-2026, all with SQLSTATE
-- 57014 (statement timeout) reading the ConnectWave mirror, ~18s in, writing
-- nothing. Measured across all 91 runs in mst_sync_runs:
--
--   run started, after the mirror watermark moved | runs | failures
--   ----------------------------------------------+------+---------
--   under 3 minutes                               |  15  |    3
--   3 to 6 minutes                                |  13  |    0
--   6 to 15 minutes                               |  24  |    0
--   over 15 minutes                               |  39  |    0
--
-- Three of three inside one narrow window; 76 later-starting runs clean. The
-- window is dangerous because ConnectWave runs FOUR rebuild jobs of its own on a
-- five-minute cron. They no-op while Tally is quiet, but the moment the connector
-- writes they all wake and rebuild whole financial years with DELETE + INSERT,
-- carrying their own statement_timeout of 30 minutes. One of them rebuilds
-- rpt_sales_register, which masters-sync reads.
--
-- ⚠ AND OUR CLOCK LINED UP WITH THEIRS EXACTLY. '*/15' fires at minutes 0, 15,
--   30 and 45 - every one a multiple of five - so masters-sync started in the
--   SAME MINUTE as those rebuilds on every single tick. It only hurt when their
--   jobs had work to do, which is precisely where all three failures fell.
--
-- WHAT THIS DOES
--   1. Moves the watcher to minutes 3, 8, 13 ... 58. Never a multiple of five,
--      so we no longer collide; and the gap between checks drops 15 min -> 5 min.
--   2. Moves the daily forced pull off minute 30 for the same reason.
--   3. Gives the scheduled call a real timeout, so net._http_response records
--      what actually happened instead of a 5-second give-up.
--
-- ⚠ WHY MINUTE 3 AND NOT MINUTE 1 OR 2. Their rebuilds run for minutes, not
--   seconds, so a one- or two-minute gap is not enough. Three minutes is where
--   the measured failures stop, so the offset is set to the evidence rather than
--   to a round number.
--
-- WHY MORE CHECKING IS NOT MORE LOAD. A check whose watermark is unchanged does
-- ONE rpc against the mirror and one select here, and writes NOTHING - skipped
-- runs are not recorded (91 rows in 4 weeks against 2,688 ticks). Actual pulls
-- stay at 5-7 a day, because a pull still only happens when Tally has moved.
--
-- SAFETY. Schedule-only. No table, column, policy or row is touched, and the
-- function body of masters_sync_tick is unchanged apart from the timeout arg.
--
-- Reversal: run 20261121120000_masters_sync_offset_schedule_rollback.sql
-- ===========================================================================

-- ======================================================== preflight ========
-- Above the DDL: prove the jobs are where we think before altering anything.

do $pre$
declare v_n int;
begin
  select count(*) into v_n from cron.job
   where jobname in ('masters-sync-watch', 'masters-sync-daily-force');
  if v_n <> 2 then
    raise exception 'masters-sync: expected both cron jobs, found % - refusing to guess', v_n;
  end if;
end $pre$;

-- ========================================================= the clock =======

select cron.alter_job(
  (select jobid from cron.job where jobname = 'masters-sync-watch'),
  schedule := '3-59/5 * * * *');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'masters-sync-daily-force'),
  schedule := '33 5 * * *');

-- ================================================= the scheduled call ======
--
-- ⚠ THE ONLY CHANGE IS timeout_milliseconds. pg_net defaults to 5s, so the
--   scheduler gave up long before a ~26s pull returned and net._http_response
--   recorded a timeout rather than the outcome. pg_net is asynchronous - giving
--   up does NOT cancel the Edge Function, which is why this was invisible rather
--   than fatal - but it meant the one place a human might look for "what did the
--   scheduler see?" was always wrong.

create or replace function public.masters_sync_tick(p_force boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cfg record;
begin
  select function_url, service_key into cfg
    from private.masters_sync_config where id = 1;

  -- Not configured yet -> no-op, not an error.
  if cfg.function_url is null or cfg.service_key is null then
    return;
  end if;

  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || cfg.service_key),
    body    := jsonb_build_object('trigger', 'schedule', 'force', coalesce(p_force, false)),
    -- A full pull measured 25.0-27.2s on 2026-09-11, worst ever 90s. 120s leaves
    -- room without waiting on a function that has already been killed.
    timeout_milliseconds := 120000
  );
end $function$;

comment on function public.masters_sync_tick(boolean) is
  'Wakes the masters-sync Edge Function. Scheduled at minutes 3,8,13..58 - deliberately NEVER a '
  'multiple of five, because ConnectWave runs its own rebuild jobs every five minutes and a '
  'collision is what caused the 57014 read timeouts of 09-09 to 11-09-2026. See 20261121120000.';

-- ========================================================== asserts ========
--
-- Catalogue lookups only; no table is read.

do $check$
declare v_watch text; v_force text;
begin
  select schedule into v_watch from cron.job where jobname = 'masters-sync-watch';
  select schedule into v_force from cron.job where jobname = 'masters-sync-daily-force';

  if v_watch <> '3-59/5 * * * *' then
    raise exception 'masters-sync: watcher schedule is %, expected 3-59/5 * * * *', v_watch;
  end if;
  if v_force <> '33 5 * * *' then
    raise exception 'masters-sync: daily force schedule is %, expected 33 5 * * *', v_force;
  end if;

  -- The whole point: neither may start on a multiple of five.
  if (split_part(v_force, ' ', 1))::int % 5 = 0 then
    raise exception 'masters-sync: the daily force is back on a multiple of five';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'masters_sync_tick'
       and p.prosrc like '%timeout_milliseconds%') then
    raise exception 'masters-sync: masters_sync_tick lost its explicit timeout';
  end if;
end $check$;
