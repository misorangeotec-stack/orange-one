-- ===========================================================================
-- A weekly report schedule can name MORE THAN ONE DAY.
--
-- WHY
--   `report_email_schedule` held a single `day_of_week`, so "every Saturday"
--   was expressible and "every Tuesday AND Saturday" was not. Twice a week is
--   the rhythm the collection report is actually wanted on. Rather than add a
--   'twice_weekly' frequency with a second day column — which buys exactly one
--   more day and needs doing again for a third — 'weekly' now carries a SET of
--   days. Mon/Wed/Fri costs nothing extra.
--
-- ADDITIVE ONLY, as everything here is.
--   `day_of_week` is NOT dropped and NOT retyped. It stays, and it keeps being
--   written with the FIRST selected day, for two reasons:
--
--     1. The existing check constraint `report_email_schedule_weekly_has_day`
--        requires it to be non-null on a weekly schedule. Leaving that
--        constraint alone means no window in which a half-migrated row is
--        illegal.
--     2. Anything reading the old column keeps working and sees a real day,
--        not a null. It is simply the first of possibly several.
--
--   `days_of_week` is the column to read from here on. `day_of_week` is kept in
--   step with it, never edited on its own.
--
-- ROLLBACK
--   alter table public.report_email_schedule drop column if exists days_of_week;
--   -- then restore the 6-argument set_report_email_schedule from 20260903120400.
--   -- Nothing else has to be undone: day_of_week was never stopped being written.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table public.report_email_schedule
  add column if not exists days_of_week int[];

comment on column public.report_email_schedule.days_of_week is
  'Days a weekly schedule fires on, 0 = Sunday. THE COLUMN TO READ. day_of_week is kept as the first of these so the older constraint and any older reader still hold.';

-- Backfill from the single day, so a schedule saved before this migration keeps
-- meaning exactly what it meant. Only touches weekly rows that have a day and no
-- array yet, so re-running this migration is harmless.
update public.report_email_schedule
   set days_of_week = array[day_of_week]
 where frequency = 'weekly'
   and day_of_week is not null
   and days_of_week is null;

-- A weekly schedule with an EMPTY array is not a schedule, and neither is one
-- carrying a day outside 0..6. Rejected here so no reader has to guess.
--
-- Note the null allowance: a non-weekly row has no days, and a weekly row is
-- separately guaranteed a `day_of_week` by the original constraint, so a weekly
-- row that somehow reaches here with a null array is still legible rather than
-- rejected outright. The RPC below never writes that shape.
alter table public.report_email_schedule
  drop constraint if exists report_email_schedule_days_sane;

alter table public.report_email_schedule
  add constraint report_email_schedule_days_sane
  check (
    days_of_week is null
    or (
      array_length(days_of_week, 1) between 1 and 7
      and days_of_week <@ array[0,1,2,3,4,5,6]
    )
  );

-- ---------------------------------------------------------------------------
-- 2. The write path
-- ---------------------------------------------------------------------------
-- A NEW overload rather than an edit: the 6-argument version stays callable, so
-- a browser still running yesterday's bundle keeps saving successfully instead
-- of erroring between the migration and the deploy. It writes a single-day array
-- so its rows are readable by the new reader too.
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
begin
  -- Delegates, so the two overloads cannot drift apart on permissions or on
  -- which fields a frequency nulls out.
  perform public.set_report_email_schedule(
    p_report_key,
    p_frequency,
    case when p_day_of_week is null then null else array[p_day_of_week] end,
    p_day_of_month,
    p_hour_ist,
    p_minute_ist
  );
end $$;

create or replace function public.set_report_email_schedule(
  p_report_key   text,
  p_frequency    text,
  p_days_of_week int[],
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
  v_uid  uuid := auth.uid();
  v_days int[];
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

  -- Sorted and de-duplicated on the way in, so "Sat, Tue" and "Tue, Sat" store
  -- identically and the screen always reads a week back in week order.
  if p_frequency = 'weekly' then
    select array_agg(d order by d) into v_days
      from (select distinct unnest(p_days_of_week) as d) s
     where d between 0 and 6;

    if v_days is null or array_length(v_days, 1) = 0 then
      raise exception 'a weekly schedule needs at least one day';
    end if;
  else
    v_days := null;
  end if;

  insert into public.report_email_schedule
    (report_key, frequency, day_of_week, days_of_week, day_of_month,
     hour_ist, minute_ist, updated_at, updated_by)
  values (
    btrim(p_report_key),
    coalesce(p_frequency, 'off'),
    -- The first selected day, so the original weekly_has_day constraint holds
    -- and an older reader still sees a real day. See the header.
    case when p_frequency = 'weekly' then v_days[1] end,
    v_days,
    -- Null out the field the chosen frequency does not use, so a schedule
    -- switched weekly -> daily cannot keep a stale date hanging off it.
    case when p_frequency = 'monthly' then p_day_of_month end,
    coalesce(p_hour_ist, 8),
    coalesce(p_minute_ist, 0),
    now(), v_uid
  )
  on conflict (report_key) do update
     set frequency    = excluded.frequency,
         day_of_week  = excluded.day_of_week,
         days_of_week = excluded.days_of_week,
         day_of_month = excluded.day_of_month,
         hour_ist     = excluded.hour_ist,
         minute_ist   = excluded.minute_ist,
         updated_at   = now(),
         updated_by   = excluded.updated_by;
end $$;

revoke all on function public.set_report_email_schedule(text, text, int[], int, int, int) from public, anon;
grant execute on function public.set_report_email_schedule(text, text, int[], int, int, int) to authenticated;
