-- ===========================================================================
-- HELP DESK — ARM THE NIGHTLY AUTO-CLOSE (D9).
--
-- ⚠ APPLY THIS ONLY ON THE USER'S SAY-SO. It is a separate migration from the
--   function it schedules for exactly that reason: HD-5 can be live and
--   reviewed for as long as anybody likes before anything starts closing
--   tickets on its own. The house pattern (…_kpi1_facts_nightly.sql,
--   …_cc1_fms_ranking_nightly.sql).
--
-- ⚠ IT CLOSES REAL PEOPLE'S TICKETS. `auto_close_enabled` in
--   fms_help_config.policy is the second switch, and it installs TRUE — so
--   arming the cron IS the decision. Set that key false first if you want the
--   job scheduled but inert.
--
-- ── THE TIME, AND WHY IT IS NOT A ROUND NUMBER ──────────────────────────────
-- pg_cron runs in UTC. 19:12 UTC is 00:42 IST, so the job runs just after
-- midnight Indian time and a ticket's window is measured against the IST date
-- that has just begun.
--
-- ⚠ THE ODD MINUTE IS DELIBERATE. Schedules on this database collide by
--   arithmetic — anything on a round */5 or */15 lands on the same tick as the
--   ConnectWave sync, which has no free offset of its own. 00:42 IST is between
--   CC-1's ranking run (00:52) and KPI-1's facts (01:07), and shares a minute
--   with neither.
--
-- Reversal:
--   select cron.unschedule('help-desk-auto-close');
-- ===========================================================================

do $pre$
begin
  if to_regprocedure('public.fms_help_auto_close()') is null then
    raise exception 'apply 20261221120000_hd5_help_desk_confirm_reopen.sql first';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not installed';
  end if;
  if exists (select 1 from cron.job where jobname = 'help-desk-auto-close') then
    raise exception 'help-desk-auto-close is already scheduled';
  end if;
  -- Nobody else may be on this minute. See the ⚠ above.
  if exists (select 1 from cron.job where schedule = '12 19 * * *') then
    raise exception 'another job already runs at 19:12 UTC — pick a different minute';
  end if;
end $pre$;

select cron.schedule('help-desk-auto-close', '12 19 * * *', $$select public.fms_help_auto_close();$$);

do $post$
begin
  if not exists (select 1 from cron.job where jobname = 'help-desk-auto-close') then
    raise exception 'the job did not schedule';
  end if;
end $post$;
