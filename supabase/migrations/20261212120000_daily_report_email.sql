-- ===========================================================================
-- DAILY REPORT (DR-3) — the parts of the evening send that live in the database.
--
-- The ask, from Ritesh Bhai on 16-09-2026: send the Daily Report every evening,
-- the way the Collection report already goes out. The four shape decisions were
-- taken on 28-09-2026:
--
--     every evening, 20:30 IST · PDF only · one report, all locations
--     send at the fixed time REGARDLESS of whether the bank balances are typed
--
-- ── WHAT THIS FILE IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────
--   It is the DECISION: the switch, the arming lever, the dedup and one gate
--   function that answers "should the Daily Report go out right now, and to
--   whom". It creates NO cron job and it cannot send anything.
--
--   The waking is the next migration. The DRAWING is neither here nor in an Edge
--   Function, and that is measured rather than preferred — see below.
--
-- ── WHY THE CONFIG TABLES ARE REUSED RATHER THAN COPIED ──────────────────────
--   `report_email_settings`, `report_email_schedule` and `report_email_recipients`
--   (migrations 20260903120300 / 120400) are keyed on a free-text `report_key`.
--   Nothing in them is receivables-specific, so this report is a new KEY in the
--   existing tables — `'daily-report'` — and its frequency and distribution list
--   are written by the SAME admin-only RPCs the Collection report uses:
--
--       select set_report_email_enabled('daily-report', true);
--       select set_report_email_schedule('daily-report', 'daily', null, null, 20, 30);
--       select set_report_email_recipients('daily-report',
--                '[{"scope":"book","email":"...","name":"..."}]'::jsonb);
--
--   A second set of tables would mean two screens, two write paths and two
--   vocabularies for one question. It also means per-location copies, if they are
--   ever wanted, cost a KEY rather than a schema change: 'daily-report:surat'
--   carries its own schedule and its own list with nothing altered here.
--
-- ⚠ THIS REPORT HAS NO SALESPERSON VERSION, AND THE GATE MUST NOT INVENT ONE.
--   `report_email_recipients.scope = 'salesperson'` resolves a NAME through
--   `profiles.receivables_salespersons` — which is a receivables VISIBILITY
--   SCOPE, not an identity (three accounts carry all thirteen names). It has
--   nothing to do with the Daily Report. The gate below reads `scope = 'book'`
--   only, and REPORTS any salesperson row it finds under this key rather than
--   quietly ignoring it: a row an admin can see in a list but that never receives
--   anything is the failure that looks exactly like success.
--
-- ── FOUR SWITCHES ON THE COLLECTION REPORT, TWO HERE, AND WHY THE DIFFERENCE ──
--   The Collection report also consults `email_module_enabled('outstanding-
--   dashboard')`. That is a survival from the module-wide switch which migration
--   20260903120300 replaced, and its own header states the rule this file
--   follows instead: ONE gate, deliberately, not two — a report switched ON while
--   a second switch on a different screen keeps it silent is precisely the quiet
--   no-op to avoid. So:
--
--     1. private.daily_report_email_config.armed   — the unattended-send lever,
--        ships FALSE, and flipping it is a deliberate act by a person.
--     2. report_email_settings('daily-report')     — the report's own switch,
--        no row = off, edited on the Daily Report's settings screen.
--
-- ── THE BANK BALANCES ARE TYPED BY HAND, AND THE SEND DOES NOT WAIT ──────────
--   Eleven closing balances and the credit-facility block are typed into
--   /daily-report/bank-balances each evening. Asked on 28-09-2026 whether the
--   send should wait for them, the answer was NO: a fixed time, every evening,
--   whatever has been typed.
--
--   So completeness is NOT a gate — but it IS reported. `balances` travels in the
--   due answer, the runner prints it, the send log stores it and the mail states
--   it, because a Bank page reading "0 of 11 accounts entered" must never look
--   like a broken report. Measured 28-09-2026: the table holds ZERO rows and
--   `app_access` holds ZERO grants for this module, so until somebody is granted
--   the module and types an evening, every send will say 0 of 11. That is honest,
--   and it is the reason the figure is in the payload rather than assumed.
--
-- ── IT DOES NOT RUN IN AN EDGE FUNCTION, AND THE REASON IS MEASURED ──────────
--   Ceiling: 2 seconds of CPU per request, CUMULATIVE — awaiting does not reset
--   it (measured 20-Aug-2026: 1s -> 200, 3s -> 546 WORKER_RESOURCE_LIMIT, 8s
--   with a yield every 200ms -> 546).
--
--   MEASURED FOR THIS REPORT on 28-09-2026, on the desk: the 6-page PDF draws in
--   1.6s on a quiet day (7 sale lines) and 1.8-2.0s on a busy one (259 sale
--   lines, 91 money rows). That is ON the ceiling, not over it — and the
--   cumulative budget also has to cover parsing several hundred register rows of
--   JSON and embedding two Poppins faces. The fonts are load-bearing rather than
--   decorative: built-in Helvetica is WinAnsi and has no rupee sign, so without
--   Identity-H every money cell comes out a blank box.
--
--   ⚠ A FIGURE SITTING EXACTLY AT THE LIMIT IS WORSE THAN ONE CLEARLY OVER IT.
--     It fails intermittently, on the busiest days, at 20:30, while every run
--     still reports success. Anyone revisiting this should measure a December
--     day, not a September one.
--
--   So the drawing happens on a GitHub Actions runner, which has no such cap and
--   has the repository checked out — so the mail is built by the app's OWN
--   TypeScript (`lib/reportInput.ts` -> `dailyReportPdfBlob`), the same functions
--   the screen renders from, rather than a second implementation that would drift
--   away from it. See supabase/dailyreport/ and .github/workflows/daily-report.yml.
--
-- Additive: one private table, one public table, three functions. Nothing
-- existing is altered, and no row in any existing table is touched.
--
-- Reversal:
--   select cron.unschedule('daily-report-email-kick');      -- if the next migration ran
--   select cron.unschedule('daily-report-email-watchdog');
--   drop function if exists public.set_daily_report_email_armed(boolean);
--   drop function if exists public.daily_report_email_mark_sent(text, date, int, text, int, int);
--   drop function if exists public.daily_report_email_due(text, timestamptz);
--   drop table if exists public.daily_report_email_send_log;
--   drop table if exists private.daily_report_email_config;
--
-- To stop it at any time without losing the schedule or the list:
--   update private.daily_report_email_config set armed = false;
-- ===========================================================================

create schema if not exists private;

-- ── The arming switch ──────────────────────────────────────────────────────
-- One row, forced by the `id` primary key defaulting to true with a check — the
-- same shape as private.collections_report_config. `private` because nothing in
-- the browser needs to read it; the RPCs are the only door.
create table if not exists private.daily_report_email_config (
  id            boolean primary key default true check (id),
  armed         boolean not null default false,
  -- How late a missed slot may still be served.
  --
  -- 60 rather than the Collection report's 120, and the reason is the report
  -- rather than the plumbing: this one is a snapshot of a day that has just
  -- ended, read the same evening. A 20:30 slot served at 22:30 has lost most of
  -- its point, whereas a Saturday morning book keeps until lunchtime. The kick
  -- ticks every 15 minutes, so 60 still allows four attempts.
  grace_minutes int not null default 60 check (grace_minutes between 5 and 720),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
insert into private.daily_report_email_config (id) values (true) on conflict (id) do nothing;

revoke all on private.daily_report_email_config from public, anon, authenticated;

comment on table private.daily_report_email_config is
  'Singleton. `armed` is the unattended-send lever for the Daily Report and ships FALSE; set it with set_daily_report_email_armed(true). Private so PostgREST never exposes it.';

-- ── The dedup ──────────────────────────────────────────────────────────────
-- A log table, not a `last_sent_on` column: a column cannot tell "already sent
-- today" from "due again" when a run is retried or caught up by hand. The
-- (report, IST date) primary key IS the dedup.
create table if not exists public.daily_report_email_send_log (
  report_key       text not null,
  sent_for_date    date not null,
  run_at           timestamptz not null default now(),
  queued           int  not null default 0,
  -- How complete the hand-typed bank figures were AT SEND TIME. Kept because it
  -- is unrecoverable afterwards: somebody typing the balances the next morning
  -- would make a report that went out on 0 of 11 look as though it went out on
  -- 11 of 11, and the one question asked about a thin Bank page is "was it
  -- typed yet?".
  balances_entered int,
  balances_expected int,
  note             text,
  primary key (report_key, sent_for_date)
);

alter table public.daily_report_email_send_log enable row level security;

-- Readable by admins so the settings screen can say "last sent on …". Nothing
-- may write through the API: the only writer is the SECURITY DEFINER function
-- below, called by the runner with the service role.
drop policy if exists daily_report_email_send_log_admin_read on public.daily_report_email_send_log;
create policy daily_report_email_send_log_admin_read
  on public.daily_report_email_send_log for select
  using (public.is_admin(auth.uid()));

comment on table public.daily_report_email_send_log is
  'One row per (report, IST date) actually sent. The primary key is what stops a retry or a manual catch-up double-sending.';

-- ── Is the Daily Report due right now, and to whom? ────────────────────────
create or replace function public.daily_report_email_due(
  p_report_key text default 'daily-report',
  p_now        timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- The report is "for" an IST calendar day — the day that is ending. A UTC date
  -- would label a 20:30 IST send with the same day only by luck (20:30 IST is
  -- 15:00 UTC, so it happens to agree) and would be wrong the moment the slot
  -- moves past 05:30 IST. Computed in Asia/Kolkata so it means what it says.
  v_ist      timestamp := p_now at time zone 'Asia/Kolkata';
  v_date     date      := v_ist::date;
  v_armed    boolean;
  v_grace    int;
  v_sched    record;
  v_slot     timestamp;
  v_today    boolean;
  v_book     jsonb;
  v_strays   jsonb;
  v_bal      jsonb;
  v_count    int;
begin
  -- ⚠ RESOLVED FIRST, SO IT TRAVELS ON EVERY ANSWER — INCLUDING THE EARLY ONES.
  --   A salesperson row under this key reaches nobody: this report has no per-salesperson version.
  --   The first cut built this list down beside the recipients, which meant it appeared only on the
  --   `due` and `nobody to send to` answers — so on 364 evenings out of 365 the gate returned
  --   'not yet' or 'already sent today' and the stray was invisible, which is exactly the silence
  --   the field exists to break. The workflow's gate step prints it on every tick.
  select coalesce(jsonb_agg(r.salesperson order by r.salesperson), '[]'::jsonb)
    into v_strays
    from public.report_email_recipients r
   where r.report_key = p_report_key and r.scope = 'salesperson';

  select c.armed, c.grace_minutes into v_armed, v_grace
    from private.daily_report_email_config c where c.id;

  if not coalesce(v_armed, false) then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason', 'automatic sending is not armed');
  end if;

  if not public.report_email_enabled(p_report_key) then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason',
      format('emailing is switched off for %s', p_report_key));
  end if;

  select * into v_sched from public.report_email_schedule s where s.report_key = p_report_key;
  if not found or v_sched.frequency = 'off' then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason', 'no schedule is set');
  end if;

  -- Is TODAY one of this schedule's days?
  --   extract(dow) is 0 = Sunday, the same numbering days_of_week carries from
  --   the settings screen, so nothing is translated here or there.
  v_today := case v_sched.frequency
               when 'daily'   then true
               when 'weekly'  then extract(dow from v_date)::int = any(
                                     coalesce(v_sched.days_of_week,
                                              array[v_sched.day_of_week]::int[]))
               when 'monthly' then extract(day from v_date)::int = v_sched.day_of_month
               else false
             end;
  if not coalesce(v_today, false) then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason', 'not a send day');
  end if;

  v_slot := v_date + make_interval(hours => v_sched.hour_ist, mins => v_sched.minute_ist);

  if v_ist < v_slot then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason',
      format('not yet — due at %s IST', to_char(v_slot, 'HH24:MI')));
  end if;

  -- Past the grace window the slot is GONE rather than served late. Without this,
  -- arming the switch at midnight would fire the previous evening's report on the
  -- spot, and a runner that was down all night would send a stale day at dawn.
  if v_ist > v_slot + make_interval(mins => v_grace) then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason',
      format('missed — %s IST was more than %s minutes ago',
             to_char(v_slot, 'HH24:MI'), v_grace));
  end if;

  if exists (select 1 from public.daily_report_email_send_log l
              where l.report_key = p_report_key and l.sent_for_date = v_date) then
    return jsonb_build_object('due', false, 'strays', v_strays, 'reason', 'already sent today');
  end if;

  -- ── Who ──
  -- Book recipients only, and addresses typed into the screen: they need not be
  -- portal users. See the header on why scope='salesperson' is not read here.
  select coalesce(jsonb_agg(jsonb_build_object('email', r.email, 'name', r.name)
                            order by r.email), '[]'::jsonb)
    into v_book
    from public.report_email_recipients r
   where r.report_key = p_report_key and r.scope = 'book' and r.enabled
     and nullif(btrim(coalesce(r.email, '')), '') is not null;

  -- ── How complete the hand-typed figures are ──
  -- REPORTED, NOT GATED. Asked and answered 28-09-2026: a fixed time every
  -- evening, whatever has been typed. Never throws: a completeness caption must
  -- not be able to stop a send.
  begin
    v_bal := public.daily_report_balance_status(v_date);
  exception when others then
    v_bal := null;
  end;

  v_count := jsonb_array_length(v_book);
  if v_count = 0 then
    -- Sending to nobody is not a send, so this does NOT claim the slot: adding
    -- the first recipient twenty minutes late must still get today's report.
    return jsonb_build_object('due', false, 'reason', 'nobody to send to',
                              'strays', v_strays);
  end if;

  return jsonb_build_object(
    'due',       true,
    'reportKey', p_report_key,
    'forDate',   v_date,
    'slotIst',   to_char(v_slot, 'YYYY-MM-DD HH24:MI'),
    'book',      v_book,
    'strays',    v_strays,
    'balances',  jsonb_build_object(
                   'expected', coalesce((v_bal ->> 'expected')::int, 0),
                   'entered',  coalesce((v_bal ->> 'entered')::int, 0))
  );
end $$;

comment on function public.daily_report_email_due(text, timestamptz) is
  'Should the Daily Report go out right now, and to whom? The scheduled runner asks this and obeys the answer. Bank-balance completeness is reported in `balances`, never gated on.';

-- ── Claim the slot, once the mail is actually queued ───────────────────────
-- Called AFTER the outbox rows exist: a queued mail has been handed to the
-- sender and cannot be unqueued, whereas a build that dies half way should leave
-- the slot open for a retry. Overlapping runners are prevented upstream by the
-- workflow's concurrency group; the primary key is the backstop, and
-- `on conflict do nothing` makes a second claim a no-op rather than an error the
-- runner would report as a failed send.
create or replace function public.daily_report_email_mark_sent(
  p_report_key text,
  p_for_date   date,
  p_queued     int,
  p_note       text default null,
  p_balances_entered  int default null,
  p_balances_expected int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  if coalesce(p_queued, 0) <= 0 then
    -- A run that reached nobody is not a send and must not burn the slot.
    return false;
  end if;

  insert into public.daily_report_email_send_log
    (report_key, sent_for_date, queued, note, balances_entered, balances_expected)
  values (p_report_key, p_for_date, p_queued, p_note, p_balances_entered, p_balances_expected)
  on conflict (report_key, sent_for_date) do nothing;

  get diagnostics v_claimed = row_count;
  return v_claimed;
end $$;

-- ── The lever ──────────────────────────────────────────────────────────────
-- Admin only, so arming can be wired to a switch on the settings screen without
-- a second rule. Flipping it in SQL does the same thing.
create or replace function public.set_daily_report_email_armed(p_armed boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can arm the automatic Daily Report';
  end if;
  update private.daily_report_email_config
     set armed = coalesce(p_armed, false), updated_at = now(), updated_by = auth.uid()
   where id;
  return coalesce(p_armed, false);
end $$;

-- The runner calls `daily_report_email_due` and `daily_report_email_mark_sent`
-- with the service role, which bypasses these grants. They are here so an admin
-- can ask the same questions from the SQL editor, and so the settings screen can
-- show "is it due" without a second implementation.
revoke all on function public.daily_report_email_due(text, timestamptz) from public, anon;
revoke all on function public.daily_report_email_mark_sent(text, date, int, text, int, int) from public, anon, authenticated;
revoke all on function public.set_daily_report_email_armed(boolean) from public, anon;
grant execute on function public.daily_report_email_due(text, timestamptz) to authenticated;
grant execute on function public.set_daily_report_email_armed(boolean) to authenticated;

-- ============================================================== asserts ====
--
-- ⚠ THE CHECKS THAT ONLY READ CATALOGUES ARE CHEAP AND SIT HERE, AT THE FOOT.
--   Anything that scans real data belongs ABOVE the DDL: an assertion at the
--   bottom runs inside the same transaction as the CREATEs, so it holds their
--   locks for as long as it takes. Nothing below touches a data table.
do $check$
begin
  if to_regclass('private.daily_report_email_config') is null then
    raise exception 'daily report email: the config table was not created';
  end if;
  if not exists (select 1 from private.daily_report_email_config where id) then
    raise exception 'daily report email: the singleton row is missing';
  end if;
  if to_regclass('public.daily_report_email_send_log') is null then
    raise exception 'daily report email: the send log was not created';
  end if;
  if to_regprocedure('public.daily_report_email_due(text, timestamptz)') is null then
    raise exception 'daily report email: daily_report_email_due was not created';
  end if;
  if to_regprocedure('public.daily_report_email_mark_sent(text, date, int, text, int, int)') is null then
    raise exception 'daily report email: daily_report_email_mark_sent was not created';
  end if;

  -- The reused config tables must exist, or the gate reads nothing and reports
  -- "no schedule is set" forever with no way to tell that from a real answer.
  if to_regclass('public.report_email_schedule') is null
     or to_regclass('public.report_email_recipients') is null
     or to_regprocedure('public.report_email_enabled(text)') is null then
    raise exception 'daily report email: the shared report_email_* config is missing (run 20260903120300 and 120400 first)';
  end if;

  -- The hard stops. Nothing may arrive armed, switched on, scheduled or listed,
  -- and this file must create no cron job.
  if (select armed from private.daily_report_email_config where id) then
    raise exception 'daily report email: it arrived ARMED; arming is a deliberate act';
  end if;
  if public.report_email_enabled('daily-report') then
    raise exception 'daily report email: the report switch arrived ON';
  end if;
  if exists (select 1 from public.report_email_schedule
              where report_key = 'daily-report' and frequency <> 'off') then
    raise exception 'daily report email: a schedule arrived switched on';
  end if;
  if exists (select 1 from public.report_email_recipients where report_key = 'daily-report') then
    raise exception 'daily report email: a recipient arrived on the list';
  end if;
  if exists (select 1 from cron.job where jobname like 'daily-report-email%') then
    raise exception 'daily report email: a cron job exists; this migration must not create one';
  end if;

  if has_function_privilege('anon', 'public.daily_report_email_due(text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.daily_report_email_mark_sent(text, date, int, text, int, int)', 'execute')
  then
    raise exception 'daily report email: a client role can read the gate or claim a slot';
  end if;
end $check$;
