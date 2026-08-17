-- ===========================================================================
-- MASTER REPORT — the 08:00 IST daily send.
--
-- Follows 20260805120300_add_fms_asset_reminders.sql, which documents the house
-- rules this file obeys:
--   · cron.schedule is UTC. 02:30 UTC = 08:00 IST (UTC+5:30). Converted by hand
--     and stated here, because nothing in Postgres will convert it for you.
--   · `set local statement_timeout` goes INSIDE the scheduled command, not on
--     the function.
--   · the function never COMMITs.
--   · cron.schedule(name, ...) REPLACES a job of the same name, so this file is
--     safe to re-run.
--
-- WHY A LOG TABLE AND NOT A last_sent_on COLUMN
--   A column remembers only the last send, so a same-day re-run (a cron retry,
--   a manual catch-up after an outage) cannot tell "already sent" from "due
--   again". master_report_send_log's date primary key IS the dedup.
--
-- ⚠ A ZERO-RECIPIENT RUN DELIBERATELY DOES NOT LOG.
--   Logging it would burn today's slot: an admin who adds the first recipient
--   at 09:00 would get nothing until tomorrow. Sending to nobody is not a send.
--
-- THREE SWITCHES MUST ALL BE ON, and they are separate on purpose:
--   master_report_settings.enabled            — "is the daily report a thing?"
--   email_module_enabled('master-report')     — the standard per-module email
--                                               gate every other module has
--   master_report_recipients.enabled          — per person
--
-- Reversal:
--   select cron.unschedule('master-report-daily');
--   drop function if exists public.master_report_enqueue_daily(date);
-- ===========================================================================

create extension if not exists pg_cron;

create or replace function public.master_report_enqueue_daily(p_for_date date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The report is "for" an IST calendar day. Using a UTC date would label the
  -- 08:00 IST send with the previous day's date.
  v_date     date := coalesce(p_for_date, (now() at time zone 'Asia/Kolkata')::date);
  v_enabled  boolean;
  v_snapshot jsonb;
  v_count    int := 0;
  r          record;
begin
  select s.enabled into v_enabled from public.master_report_settings s where s.id;
  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  if not public.email_module_enabled('master-report') then
    return 0;
  end if;

  if exists (select 1 from public.master_report_send_log l where l.sent_for_date = v_date) then
    return 0;
  end if;

  -- auth.uid() is null under cron, which master_report_snapshot treats as the
  -- trusted server path and lets through.
  v_snapshot := public.master_report_snapshot(30);

  for r in select * from public.master_report_recipients where enabled order by email
  loop
    insert into public.email_outbox (kind, to_email, to_name, subject, payload)
    values (
      'master_report_daily',
      r.email,
      r.name,
      'Orange One — module snapshot, ' || to_char(v_date, 'DD Mon YYYY'),
      jsonb_build_object(
        'snapshot',    v_snapshot,
        'for_date',    v_date,
        'attachments', '[]'::jsonb
      )
    );
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.master_report_send_log (sent_for_date, recipient_count)
    values (v_date, v_count)
    on conflict (sent_for_date) do nothing;
  end if;

  return v_count;
end $$;

revoke all on function public.master_report_enqueue_daily(date) from public, anon;
comment on function public.master_report_enqueue_daily(date) is
  'Queues the daily Master Report mail, once per IST day. Idempotent: a second call the same day returns 0 and mails nobody.';

-- 02:30 UTC == 08:00 IST.
select cron.schedule(
  'master-report-daily',
  '30 2 * * *',
  $$ set local statement_timeout = '110s'; select public.master_report_enqueue_daily(); $$
);
