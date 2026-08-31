-- ===========================================================================
-- COLLECTION REPORT — the watchdog learns to see a HALF-delivered send.
--
-- WHAT IT COULD NOT SEE, AND WHY THAT WAS THE WORST CASE
--
--   `collections_report_watchdog` (migration 20261022120000) speaks when a slot
--   passes UNSERVED. That catches a dead timer, an expired token, a GitHub
--   outage, a runner that never woke — every case where nobody got the report.
--
--   It could not catch the case where SOME people got it. The sender mails the
--   book, then each salesperson in turn, and an upload failure escapes the
--   per-recipient try/catch and kills the run — so everyone still queued gets
--   nothing. The `finally` then claims the slot anyway, because `queued > 0`
--   and the ones already mailed must never be re-sent. So the send log gains a
--   row, the watchdog sees a row and stays quiet, and thirty-three people are
--   simply missing a report that the system records as delivered.
--
--   Half looks exactly like success. That is the same silent-failure shape the
--   watchdog was built for, one level in.
--
--   Not hypothetical: observed 29-Aug-2026, `could not upload …: <none>` — an
--   error carrying no message — after the book had already gone out. The retry
--   in `entry.ts` (same change) handles the blip; this handles the case where
--   retrying was not enough.
--
-- HOW IT KNOWS
--   `collections_report_mark_sent` already writes the failures into the log's
--   note: "239 listed · 62 mails · 135.0s · 1 FAILED: NAKUL JI/x@y: …". So the
--   evidence was being recorded all along and simply never read. A row whose
--   note contains FAILED is a partial send; any other row is a clean one.
--
-- ⚠ THE ALERT'S WORDING IS CARRIED IN `reason`, ON PURPOSE.
--   The deployed `send-email` renderer for `collections_report_missed` prints a
--   fixed headline ("was not sent") and shows `reason` in its facts list. Rather
--   than redeploy that function — which currently also carries another session's
--   unmerged work — the partial case says what it is INSIDE `reason` and in the
--   subject line, both of which are authored here. A tighter headline is worth
--   doing the next time the mailer is deployed for its own reasons.
--
-- Additive: replaces one function body. No table, no schedule, no data touched.
--
-- Reversal: re-apply the `collections_report_watchdog` body from 20261022120000.
-- ===========================================================================

create or replace function public.collections_report_watchdog()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg      record;
  v_ist    timestamp := now() at time zone 'Asia/Kolkata';
  v_date   date      := (now() at time zone 'Asia/Kolkata')::date;
  v_grace  int;
  v_sched  record;
  v_slot   timestamp;
  v_today  boolean;
  v_log    record;
  v_partial boolean := false;
  v_subject text;
  v_reason  text;
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

  select * into v_log from public.collections_report_send_log l
   where l.report_key = 'zero-collections' and l.sent_for_date = v_date;

  if found then
    -- A row exists, so the slot is claimed and nothing more will be sent for it. The only
    -- question left is whether it was claimed on a COMPLETE send.
    if coalesce(v_log.note, '') !~ 'FAILED' then
      return;                                  -- it went out cleanly; nothing to say
    end if;
    v_partial := true;
    v_subject := format('Collection report only PARTLY sent - %s', to_char(v_date, 'DD Mon'));
    -- Said in full here because this string is what the recipient actually reads.
    v_reason  := format(
      'PARTLY SENT and the slot is already claimed, so it will NOT retry. %s mail(s) went out; '
      || 'the rest did not. Log note: %s', coalesce(v_log.queued, 0), v_log.note);
  else
    -- No row. Still inside the window means it may yet go out — not a failure yet.
    if v_ist <= v_slot + make_interval(mins => coalesce(v_grace, 120)) then
      return;
    end if;
    v_subject := format('Collection report was NOT sent - %s', to_char(v_date, 'DD Mon'));
    v_reason  := coalesce(public.collections_report_due() ->> 'reason', 'unknown');
  end if;

  insert into public.email_outbox (kind, to_email, to_name, subject, payload)
  values (
    'collections_report_missed',
    cfg.alert_email,
    'Orange One',
    v_subject,
    jsonb_build_object(
      'for_date',      v_date,
      'slot_ist',      to_char(v_slot, 'HH24:MI'),
      'grace_minutes', coalesce(v_grace, 120),
      'checked_at',    to_char(v_ist, 'DD Mon HH24:MI'),
      'partial',       v_partial,
      'queued',        coalesce(v_log.queued, 0),
      'reason',        v_reason,
      'last_kick_at',  case when cfg.last_kick_at is null then null
                            else to_char(cfg.last_kick_at at time zone 'Asia/Kolkata',
                                         'DD Mon HH24:MI') end)
  );

  update private.collections_report_kick_config
     set last_alert_date = v_date, updated_at = now()
   where id = 1;
end $$;

revoke all on function public.collections_report_watchdog() from public, anon, authenticated;


-- ============================================================== asserts ====

do $check$
begin
  if to_regprocedure('public.collections_report_watchdog()') is null then
    raise exception 'collections watchdog: the function is missing';
  end if;
  -- The whole point of this migration: the body must READ the note, not merely
  -- test for the row's existence.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'collections_report_watchdog') !~ 'FAILED' then
    raise exception 'collections watchdog: it still cannot see a partial send';
  end if;
  if has_function_privilege('anon', 'public.collections_report_watchdog()', 'execute') then
    raise exception 'collections watchdog: anon can execute it';
  end if;
end $check$;
