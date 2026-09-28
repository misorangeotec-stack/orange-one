-- ===========================================================================
-- ROLLBACK of 20261121120000_masters_sync_offset_schedule.sql
--
-- Puts the watcher back on '*/15' and the daily force back on minute 30, and
-- restores masters_sync_tick to its implicit 5-second pg_net timeout.
--
-- ⚠ THIS REINSTATES THE COLLISION. '*/15' fires at minutes 0/15/30/45, every one
--   a multiple of five, which is exactly the same minute ConnectWave's own
--   five-minute rebuild jobs fire. That alignment is what produced the 57014 read
--   timeouts of 09-09 to 11-09-2026 (3 failures, all within 1-2 minutes of the
--   mirror's watermark moving; 76 later-starting runs clean). It also puts the
--   average wait from mirror to portal back to ~14 minutes.
--
--   The retry added to the Edge Function in the same change stays, so the
--   failures would be caught rather than fatal - but do not roll this back
--   expecting the old behaviour to be harmless. It was not.
--
-- Nothing else is touched: no table, no data.
-- ===========================================================================

select cron.alter_job(
  (select jobid from cron.job where jobname = 'masters-sync-watch'),
  schedule := '*/15 * * * *');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'masters-sync-daily-force'),
  schedule := '30 5 * * *');

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
    body    := jsonb_build_object('trigger', 'schedule', 'force', coalesce(p_force, false))
  );
end $function$;

do $check$
declare v_watch text;
begin
  select schedule into v_watch from cron.job where jobname = 'masters-sync-watch';
  if v_watch <> '*/15 * * * *' then
    raise exception 'masters-sync rollback: watcher schedule is %, expected */15 * * * *', v_watch;
  end if;
end $check$;
