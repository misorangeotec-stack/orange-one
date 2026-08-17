-- ===========================================================================
-- WHEN a report goes out, and WHO it goes to.
--
-- Follows 20260903120300, which added the per-report on/off switch. This adds
-- the two things that switch needs to be useful: a time, and a recipient list.
--
-- ⚠ NOTHING IN THIS FILE SENDS ANYTHING, AND NO CRON JOB IS CREATED.
--   These are two tables and their write functions. The job that would read them
--   does not exist yet: the report is built in the BROWSER today (jsPDF over the
--   receivables project), so there is nothing a scheduler could call at 08:00.
--   That builder is the next piece of work. Storing the configuration first is
--   deliberate — the owner can set it up, look at exactly who is on the list and
--   check the salesperson mapping resolves, long before anything is capable of
--   posting it. See RECEIVABLES-SCHEDULED-EMAIL.md.
--
-- ── TWO KINDS OF RECIPIENT, AND WHY THEY ARE ONE TABLE ────────────────────
--   'book'        — a named person (a director, credit control). Receives the
--                   CONSOLIDATED report: every salesperson, the league table,
--                   both appendices.
--   'salesperson' — a salesperson NAME. The extract built from that name's rows
--                   alone goes to whichever portal users carry the name in
--                   profiles.receivables_salespersons.
--
--   One table because they are one question ("who is on the distribution list
--   for this report") and because a single ordered list is what an admin wants
--   to read. The scope column is what stops them ever being confused: a
--   salesperson row cannot carry an address, and a book row cannot carry a
--   salesperson, enforced by the check constraints below rather than by whoever
--   writes the next screen.
--
--   ⚠ A salesperson row stores the NAME, never a resolved address. The tag on a
--     profile is the single source of truth for who a salesperson is (it already
--     scopes what they can SEE in this app). Freezing an address here would mean
--     a rep who changes email quietly keeps receiving nothing, or worse, that
--     someone removed from the tag keeps receiving a book they should no longer
--     have.
--
-- ── THE CLOCK IS IST, STORED AS IST ───────────────────────────────────────
--   hour_ist/minute_ist are what the admin typed and what the screen shows back.
--   Converting to UTC is the scheduler's job, at the point it schedules, because
--   that is where the conversion can be stated and asserted (see the header of
--   20260830120200). Storing UTC here would mean the settings screen has to
--   convert back to display, and every reader of the table would need to know.
--
-- Additive: two new tables, three new functions. Nothing existing is altered.
--
-- Reversal:
--   drop function if exists public.set_report_email_recipients(text, jsonb);
--   drop function if exists public.set_report_email_schedule(text, text, int, int, int, int);
--   drop table if exists public.report_email_recipients;
--   drop table if exists public.report_email_schedule;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. When
-- ---------------------------------------------------------------------------
create table if not exists public.report_email_schedule (
  report_key   text primary key,
  -- 'off' is a real, stored value rather than the absence of a row: an admin who
  -- sets up a weekly send and then pauses it must not lose the day and time they
  -- chose. Deleting the row would be the destructive way to say "paused".
  frequency    text        not null default 'off'
                 check (frequency in ('off', 'daily', 'weekly', 'monthly')),
  day_of_week  int         check (day_of_week between 0 and 6),    -- 0 = Sunday, weekly only
  -- Capped at 28 on purpose. A "31st of the month" schedule silently skips four
  -- months a year, which is the kind of thing nobody notices until a quarter-end
  -- report never arrived.
  day_of_month int         check (day_of_month between 1 and 28),
  hour_ist     int         not null default 8  check (hour_ist between 0 and 23),
  minute_ist   int         not null default 0  check (minute_ist between 0 and 59),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references auth.users(id) on delete set null,

  -- A weekly schedule without a day, or a monthly one without a date, is not a
  -- schedule. Rejected here so no reader has to invent a default.
  constraint report_email_schedule_weekly_has_day
    check (frequency <> 'weekly' or day_of_week is not null),
  constraint report_email_schedule_monthly_has_date
    check (frequency <> 'monthly' or day_of_month is not null)
);

comment on table public.report_email_schedule is
  'When a report should be mailed. report_key is the reportCatalog id. Times are IST as typed; the scheduler converts. No row, or frequency=off, means it is not scheduled. NOTHING READS THIS YET.';

alter table public.report_email_schedule enable row level security;

drop policy if exists report_email_schedule_read on public.report_email_schedule;
create policy report_email_schedule_read on public.report_email_schedule
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Who
-- ---------------------------------------------------------------------------
create table if not exists public.report_email_recipients (
  id          uuid        primary key default gen_random_uuid(),
  report_key  text        not null,
  scope       text        not null check (scope in ('book', 'salesperson')),
  email       text,
  name        text,
  salesperson text,
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid        references auth.users(id) on delete set null,

  -- The two shapes, kept apart by the database rather than by convention. A book
  -- row is an address; a salesperson row is a name that is resolved to addresses
  -- at send time.
  constraint report_email_recipients_book_has_email
    check (scope <> 'book' or (nullif(btrim(coalesce(email, '')), '') is not null and salesperson is null)),
  constraint report_email_recipients_rep_has_name
    check (scope <> 'salesperson' or (nullif(btrim(coalesce(salesperson, '')), '') is not null and email is null))
);

comment on table public.report_email_recipients is
  'The distribution list for a report. scope=book carries an address and gets the consolidated report; scope=salesperson carries a NAME and gets that name''s extract, delivered to whoever is tagged with it. NOTHING READS THIS YET.';

-- One entry per address, and one per salesperson, per report. Partial indexes
-- rather than a composite unique, because only one of the two columns is ever
-- populated and a NULL would defeat an ordinary unique constraint.
create unique index if not exists report_email_recipients_book_uniq
  on public.report_email_recipients (report_key, lower(btrim(email)))
  where scope = 'book';

create unique index if not exists report_email_recipients_rep_uniq
  on public.report_email_recipients (report_key, salesperson)
  where scope = 'salesperson';

alter table public.report_email_recipients enable row level security;

drop policy if exists report_email_recipients_read on public.report_email_recipients;
create policy report_email_recipients_read on public.report_email_recipients
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. Writes — admin only, through SECURITY DEFINER, as every other switch here
-- ---------------------------------------------------------------------------
create or replace function public.set_report_email_schedule(
  p_report_key   text,
  p_frequency    text,
  p_day_of_week  int default null,
  p_day_of_month int default null,
  p_hour_ist     int default 8,
  p_minute_ist   int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_admin(v_uid) then
    raise exception 'only an admin can change a report schedule';
  end if;
  if nullif(btrim(coalesce(p_report_key, '')), '') is null then
    raise exception 'a report is required';
  end if;

  insert into public.report_email_schedule
    (report_key, frequency, day_of_week, day_of_month, hour_ist, minute_ist, updated_at, updated_by)
  values (
    btrim(p_report_key),
    coalesce(p_frequency, 'off'),
    -- Null out the field the chosen frequency does not use, so a schedule
    -- switched weekly -> daily cannot keep a stale day hanging off it.
    case when p_frequency = 'weekly'  then p_day_of_week  end,
    case when p_frequency = 'monthly' then p_day_of_month end,
    coalesce(p_hour_ist, 8),
    coalesce(p_minute_ist, 0),
    now(), v_uid
  )
  on conflict (report_key) do update
     set frequency    = excluded.frequency,
         day_of_week  = excluded.day_of_week,
         day_of_month = excluded.day_of_month,
         hour_ist     = excluded.hour_ist,
         minute_ist   = excluded.minute_ist,
         updated_at   = now(),
         updated_by   = excluded.updated_by;
end $$;

revoke all on function public.set_report_email_schedule(text, text, int, int, int, int) from public, anon;
grant execute on function public.set_report_email_schedule(text, text, int, int, int, int) to authenticated;

-- Replace-the-whole-list rather than add/remove one at a time. The screen edits a
-- list and saves a list; a diffing API would be a second model of the same thing
-- and a chance for the two to disagree about what "removed" means.
create or replace function public.set_report_email_recipients(
  p_report_key  text,
  p_recipients  jsonb default '[]'::jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_r   jsonb;
  v_n   int := 0;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_admin(v_uid) then
    raise exception 'only an admin can change a report distribution list';
  end if;
  if nullif(btrim(coalesce(p_report_key, '')), '') is null then
    raise exception 'a report is required';
  end if;

  delete from public.report_email_recipients where report_key = btrim(p_report_key);

  for v_r in select * from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb))
  loop
    insert into public.report_email_recipients
      (report_key, scope, email, name, salesperson, enabled, created_by)
    values (
      btrim(p_report_key),
      v_r ->> 'scope',
      nullif(btrim(coalesce(v_r ->> 'email', '')), ''),
      nullif(btrim(coalesce(v_r ->> 'name', '')), ''),
      nullif(btrim(coalesce(v_r ->> 'salesperson', '')), ''),
      coalesce((v_r ->> 'enabled')::boolean, true),
      v_uid
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

revoke all on function public.set_report_email_recipients(text, jsonb) from public, anon;
grant execute on function public.set_report_email_recipients(text, jsonb) to authenticated;

-- ============================================================== asserts ====
do $check$
begin
  if to_regclass('public.report_email_schedule') is null then
    raise exception 'report email: report_email_schedule was not created';
  end if;
  if to_regclass('public.report_email_recipients') is null then
    raise exception 'report email: report_email_recipients was not created';
  end if;

  if has_function_privilege('anon', 'public.set_report_email_schedule(text, text, int, int, int, int)', 'execute') then
    raise exception 'report email: anon can change a schedule';
  end if;
  if has_function_privilege('anon', 'public.set_report_email_recipients(text, jsonb)', 'execute') then
    raise exception 'report email: anon can change a distribution list';
  end if;

  -- The hard stop, restated: nothing arrives scheduled, and no cron job was
  -- created by this file. If either becomes false, a send could happen without
  -- anybody asking for one.
  if exists (select 1 from public.report_email_schedule where frequency <> 'off') then
    raise exception 'report email: a schedule arrived switched on; every schedule must start off';
  end if;
  if exists (select 1 from cron.job where jobname like 'report-email%') then
    raise exception 'report email: a cron job exists; this migration must not create one';
  end if;
end $check$;
