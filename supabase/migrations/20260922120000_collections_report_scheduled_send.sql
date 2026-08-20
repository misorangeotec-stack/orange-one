-- ===========================================================================
-- COLLECTION REPORT — the parts of the scheduled send that live in the database.
--
-- WHY THERE IS NO pg_cron JOB IN THIS FILE, WHEN EVERY OTHER SCHEDULED THING HERE HAS ONE
--   Because this report cannot be built inside Postgres OR inside an Edge Function, and the
--   reason is measured, not assumed. On 20-Aug-2026 a throwaway function (`cpu-probe`) burned
--   straight-line CPU on the live runtime:
--
--       1s of computation  -> 200 OK
--       3s of computation  -> 546 WORKER_RESOURCE_LIMIT
--       8s, yielding to the event loop every 200ms -> 546 as well
--
--   The documented ceiling is 2s of CPU per request and the budget is CUMULATIVE — awaiting a
--   timer does not reset it. Drawing this report is 37 seconds of solid CPU (101 pages, ~250
--   customers, a 1.5 MB workbook). That is not a factor of two out; it is a factor of eighteen,
--   and splitting it per salesperson does not save it either — one rep's 18-page extract is
--   already over the limit.
--
--   So the drawing happens on a GitHub Actions runner, which has no such cap and runs the app's
--   OWN TypeScript (see .github/workflows/collections-report.yml and supabase/collectionsreport/).
--   What stays here is everything that decides: the schedule, the recipients, the switches, and
--   the log that stops a slot being served twice.
--
-- THE JOB ASKS; IT DOES NOT DECIDE.
--   `collections_report_due()` is the single answer to "should anything go out right now, and to
--   whom". The runner calls it, and if the answer is no it stops. Putting that judgement in the
--   database rather than in the workflow means the settings screen an admin edits and the rule the
--   sender obeys are the same thing, and a change takes effect at the next tick with no deploy.
--
-- FOUR SWITCHES MUST ALL BE ON. They are separate on purpose:
--   collections_report_config.armed          — NEW. "may this send by itself?" Ships OFF.
--   report_email_settings('zero-collections')— the report's own switch, which also gates the
--                                              Export -> Email button an admin presses by hand
--   email_module_settings('outstanding-dashboard')
--                                            — the module gate every other module has
--   report_email_recipients.enabled          — per person
--
--   The first exists because the other three were already true-ish for MANUAL sending: the report
--   switch is on today so admins can mail it themselves. Without a dedicated lever, finishing this
--   feature would have armed an unattended send as a side effect of code landing. It must be a
--   deliberate act, and this is the thing to flip.
--
-- ⚠ A RUN THAT REACHES NOBODY DELIBERATELY DOES NOT LOG.
--   Straight from the master-report precedent: logging a zero-recipient run burns the slot, so an
--   admin who adds the first recipient an hour later would get nothing until the next occurrence.
--   Sending to nobody is not a send.
--
-- Reversal:
--   update private.collections_report_config set armed = false;   -- stops it, keeps the history
--   drop function if exists public.collections_report_due(text, timestamptz);
--   drop function if exists public.collections_report_mark_sent(text, date, int, text);
--   drop function if exists public.set_collections_report_armed(boolean);
--   drop table if exists public.collections_report_send_log;
--   drop table if exists private.collections_report_config;
-- ===========================================================================

create schema if not exists private;

-- ── The arming switch ──────────────────────────────────────────────────────
-- One row, forced by the `id` primary key defaulting to true with a check — the same shape
-- master_report_settings uses. `private` because nothing in the browser needs to read it; the
-- RPCs below are the only door.
create table if not exists private.collections_report_config (
  id            boolean primary key default true check (id),
  armed         boolean not null default false,
  -- How late a missed slot may still be served. A runner that was down at 08:00 should still send
  -- at 08:40; it should NOT send at 19:00, and arming the schedule at lunchtime should not fire
  -- this morning's report on the spot.
  grace_minutes int not null default 120 check (grace_minutes between 5 and 720),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
insert into private.collections_report_config (id) values (true) on conflict (id) do nothing;

-- ── The dedup ──────────────────────────────────────────────────────────────
-- A log table, not a `last_sent_on` column, for the reason the master report already wrote down:
-- a column cannot tell "already sent today" from "due again" when a run is retried or caught up
-- by hand. The (report, date) primary key IS the dedup.
create table if not exists public.collections_report_send_log (
  report_key    text not null,
  sent_for_date date not null,
  run_at        timestamptz not null default now(),
  queued        int  not null default 0,
  note          text,
  primary key (report_key, sent_for_date)
);

alter table public.collections_report_send_log enable row level security;

-- Readable by admins so the settings screen can one day say "last sent on ...". Nothing may write
-- through the API: the only writer is the SECURITY DEFINER function below, called by the runner.
drop policy if exists collections_report_send_log_admin_read on public.collections_report_send_log;
create policy collections_report_send_log_admin_read
  on public.collections_report_send_log for select
  using (public.is_admin(auth.uid()));

-- ── Is anything due right now, and for whom? ───────────────────────────────
create or replace function public.collections_report_due(
  p_report_key text default 'zero-collections',
  p_now        timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- The report is "for" an IST calendar day. A UTC date would label an 08:00 IST send with
  -- yesterday, which is exactly the bug that makes a dedup key useless.
  v_ist     timestamp := p_now at time zone 'Asia/Kolkata';
  v_date    date      := v_ist::date;
  v_armed   boolean;
  v_grace   int;
  v_sched   record;
  v_slot    timestamp;
  v_today   boolean;
  v_book    jsonb;
  v_reps    jsonb;
  v_unclaimed jsonb;
  v_count   int;
begin
  select c.armed, c.grace_minutes into v_armed, v_grace
    from private.collections_report_config c where c.id;

  if not coalesce(v_armed, false) then
    return jsonb_build_object('due', false, 'reason', 'automatic sending is not armed');
  end if;

  if not public.report_email_enabled(p_report_key) then
    return jsonb_build_object('due', false, 'reason',
      format('emailing is switched off for %s', p_report_key));
  end if;

  if not public.email_module_enabled('outstanding-dashboard') then
    return jsonb_build_object('due', false, 'reason',
      'the Outstanding Dashboard email module is switched off');
  end if;

  select * into v_sched from public.report_email_schedule s where s.report_key = p_report_key;
  if not found or v_sched.frequency = 'off' then
    return jsonb_build_object('due', false, 'reason', 'no schedule is set');
  end if;

  -- Is TODAY one of this schedule's days?
  --   extract(dow) is 0 = Sunday, which is the same numbering days_of_week carries from the
  --   screen, so no translation is needed here or there.
  v_today := case v_sched.frequency
               when 'daily'   then true
               when 'weekly'  then extract(dow from v_date)::int = any(
                                     coalesce(v_sched.days_of_week,
                                              array[v_sched.day_of_week]::int[]))
               when 'monthly' then extract(day from v_date)::int = v_sched.day_of_month
               else false
             end;
  if not coalesce(v_today, false) then
    return jsonb_build_object('due', false, 'reason', 'not a send day');
  end if;

  v_slot := v_date + make_interval(hours => v_sched.hour_ist, mins => v_sched.minute_ist);

  if v_ist < v_slot then
    return jsonb_build_object('due', false, 'reason',
      format('not yet — due at %s IST', to_char(v_slot, 'HH24:MI')));
  end if;

  -- Past the grace window the slot is gone rather than served late. See grace_minutes above.
  if v_ist > v_slot + make_interval(mins => v_grace) then
    return jsonb_build_object('due', false, 'reason',
      format('missed — %s IST was more than %s minutes ago',
             to_char(v_slot, 'HH24:MI'), v_grace));
  end if;

  if exists (select 1 from public.collections_report_send_log l
              where l.report_key = p_report_key and l.sent_for_date = v_date) then
    return jsonb_build_object('due', false, 'reason', 'already sent today');
  end if;

  -- ── Who ──
  -- The book: addresses typed into the screen. They need not be portal users.
  select coalesce(jsonb_agg(jsonb_build_object('email', r.email, 'name', r.name)
                            order by r.email), '[]'::jsonb)
    into v_book
    from public.report_email_recipients r
   where r.report_key = p_report_key and r.scope = 'book' and r.enabled
     and nullif(btrim(coalesce(r.email, '')), '') is not null;

  -- The reps: a NAME is stored, never an address. Who it reaches is resolved here, at send time,
  -- from the tag in Admin > Users — so a rep who loses the tag stops receiving, and one whose
  -- address changes keeps receiving, without anybody editing this list. Same mapping the settings
  -- screen shows, and the same one the manual send dialog uses.
  select coalesce(jsonb_agg(jsonb_build_object(
                    'salesperson', x.salesperson, 'email', x.email, 'name', x.name,
                    'covers', x.covers)
                            order by x.salesperson, x.email), '[]'::jsonb)
    into v_reps
    from (
      select r.salesperson, p.email, p.name,
             -- How many salesperson names this person carries. One is a rep; thirteen is credit
             -- control watching everybody, and mailing them one rep's book is a mistake dressed
             -- up as a feature. The send DIALOG shows this number so a human can choose which
             -- addresses to tick; a schedule has no human at send time, so the number travels to
             -- the run log instead, to be read before the list is signed off.
             (select count(*) from unnest(coalesce(p.receivables_salespersons, '{}')) s
               where btrim(s) <> '')::int as covers
        from public.report_email_recipients r
        join public.profiles p
          on btrim(r.salesperson) = any(
               select btrim(s) from unnest(coalesce(p.receivables_salespersons, '{}')) s)
       where r.report_key = p_report_key and r.scope = 'salesperson' and r.enabled
         and nullif(btrim(coalesce(p.email, '')), '') is not null
    ) x;

  -- Ticked, but nobody carries the tag. Reported rather than silently skipped: this is the
  -- failure that otherwise looks exactly like success.
  select coalesce(jsonb_agg(r.salesperson order by r.salesperson), '[]'::jsonb)
    into v_unclaimed
    from public.report_email_recipients r
   where r.report_key = p_report_key and r.scope = 'salesperson' and r.enabled
     and not exists (
       select 1 from public.profiles p
        where nullif(btrim(coalesce(p.email, '')), '') is not null
          and btrim(r.salesperson) = any(
                select btrim(s) from unnest(coalesce(p.receivables_salespersons, '{}')) s));

  v_count := jsonb_array_length(v_book) + jsonb_array_length(v_reps);
  if v_count = 0 then
    return jsonb_build_object('due', false, 'reason', 'nobody to send to',
                              'unclaimed', v_unclaimed);
  end if;

  return jsonb_build_object(
    'due',        true,
    'reportKey',  p_report_key,
    'forDate',    v_date,
    'slotIst',    to_char(v_slot, 'YYYY-MM-DD HH24:MI'),
    'book',       v_book,
    'salespersons', v_reps,
    'unclaimed',  v_unclaimed
  );
end $$;

-- ── Claim the slot, once the mail is actually queued ───────────────────────
-- Called AFTER the outbox rows exist, matching the master report: a queued mail has been handed
-- to the sender and cannot be unqueued, whereas a build that dies half way should leave the slot
-- open for a retry. Overlapping runners are prevented upstream by the workflow's concurrency
-- group; the primary key is the backstop, and `on conflict do nothing` makes a second claim a
-- no-op rather than an error the runner would report as a failed send.
create or replace function public.collections_report_mark_sent(
  p_report_key text,
  p_for_date   date,
  p_queued     int,
  p_note       text default null
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
    -- See the header: a run that reached nobody is not a send and must not burn the slot.
    return false;
  end if;

  insert into public.collections_report_send_log (report_key, sent_for_date, queued, note)
  values (p_report_key, p_for_date, p_queued, p_note)
  on conflict (report_key, sent_for_date) do nothing;

  get diagnostics v_claimed = row_count;
  return v_claimed;
end $$;

-- ── The lever ──────────────────────────────────────────────────────────────
-- Admin-only, so arming can be wired to a switch on the settings screen later without a second
-- rule. Flipping it in SQL does the same thing.
create or replace function public.set_collections_report_armed(p_armed boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can arm the automatic Collection report';
  end if;
  update private.collections_report_config
     set armed = coalesce(p_armed, false), updated_at = now(), updated_by = auth.uid()
   where id;
  return coalesce(p_armed, false);
end $$;

-- The runner calls `collections_report_due` and `collections_report_mark_sent` with the service
-- role, which bypasses these grants; they are here so an admin can also ask the same questions
-- from the SQL editor or the dashboard without a second implementation.
revoke all on function public.collections_report_due(text, timestamptz) from public;
revoke all on function public.collections_report_mark_sent(text, date, int, text) from public;
grant execute on function public.collections_report_due(text, timestamptz) to authenticated;
grant execute on function public.set_collections_report_armed(boolean) to authenticated;

comment on table public.collections_report_send_log is
  'One row per (report, IST date) actually sent. The primary key is what stops a retry or a manual catch-up double-sending.';
comment on function public.collections_report_due(text, timestamptz) is
  'Should the Collection report go out right now, and to whom? The scheduled runner asks this and obeys the answer.';
