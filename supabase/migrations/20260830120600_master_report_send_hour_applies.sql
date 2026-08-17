-- ===========================================================================
-- MASTER REPORT — make the "send hour" setting actually move the send.
--
-- THE BUG THIS FIXES
--   master_report_settings.send_hour_ist was written by the admin screen, read
--   back by the admin screen, and printed to the admin as "It goes to N
--   recipients at 8:00 AM IST" — but NOTHING ever read it. The cron job was
--   pinned to the literal '30 2 * * *' in 20260830120200. Changing the picker
--   to 10 AM updated the label and left the mail arriving at 08:00.
--
--   That is worse than having no control at all: a dead switch that reports
--   success teaches the admin to trust a number that is not true.
--
-- THE FIX
--   One function owns the conversion and the scheduling, and set_master_report_
--   settings calls it on every save. Because both happen in one transaction, a
--   failure to reschedule ROLLS BACK the saved hour — the stored setting and
--   the live cron job can never disagree, which is the property that was
--   missing.
--
-- ⚠ cron.schedule IS UTC AND NOTHING IN POSTGRES WILL CONVERT IT FOR YOU.
--   IST is UTC+5:30, so every valid schedule lands on :30 past the hour, and
--   any hour before 05:30 IST wraps to the PREVIOUS UTC day. 00:00 IST is
--   '30 18 * * *' — which looks wrong at a glance and is correct. The wrap is
--   why this is arithmetic on minutes rather than a subtraction of hours.
--
-- ⚠ NO DST. India does not observe it, so the offset is a constant. This would
--   need rethinking for any other timezone.
--
-- Reversal:
--   drop function if exists public.master_report_schedule_info();
--   drop function if exists public.master_report_apply_schedule();
--   (then re-apply the set_master_report_settings body from 20260830120000)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Hour (IST) -> cron expression (UTC), and reschedule the job.
--    Returns the expression it installed so a caller can assert on it.
-- ---------------------------------------------------------------------------
create or replace function public.master_report_apply_schedule()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour int;
  v_mins int;
  v_cron text;
begin
  select coalesce(s.send_hour_ist, 8) into v_hour
    from public.master_report_settings s
   where s.id;

  v_hour := greatest(0, least(coalesce(v_hour, 8), 23));

  -- Minutes-since-IST-midnight, shifted back 5h30m into UTC, wrapped into the
  -- day. The +1440 before the modulo is what makes 00:00-05:00 IST land on the
  -- previous UTC day instead of going negative.
  v_mins := ((v_hour * 60) - 330 + 1440) % 1440;
  v_cron := format('%s %s * * *', v_mins % 60, v_mins / 60);

  -- cron.schedule(name, ...) REPLACES a job of the same name, so this is safe
  -- to call on every settings save, including when nothing changed.
  perform cron.schedule(
    'master-report-daily',
    v_cron,
    $cmd$ set local statement_timeout = '110s'; select public.master_report_enqueue_daily(); $cmd$
  );

  return v_cron;
end $$;

revoke all on function public.master_report_apply_schedule() from public, anon;

comment on function public.master_report_apply_schedule() is
  'Rewrites the master-report-daily cron job from master_report_settings.send_hour_ist. IST is UTC+5:30 with no DST, so every schedule is at :30 and hours before 05:30 IST wrap to the previous UTC day.';

-- ---------------------------------------------------------------------------
-- 2. Read back what is ACTUALLY scheduled.
--
--    Exists so the admin screen can show the live cron job rather than the
--    value it just typed. The original bug was invisible precisely because the
--    screen only ever echoed its own input back to itself.
-- ---------------------------------------------------------------------------
create or replace function public.master_report_schedule_info()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sched  text;
  v_active boolean;
  v_min    int;
  v_hour   int;
  v_ist    int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select j.schedule, j.active
    into v_sched, v_active
    from cron.job j
   where j.jobname = 'master-report-daily';

  if v_sched is null then
    return jsonb_build_object('scheduled', false);
  end if;

  -- Only a plain "<min> <hour> * * *" can be turned back into a wall-clock
  -- hour. Anything else (a range, a step, a list) is reported as-is rather
  -- than guessed at.
  if v_sched ~ '^\d{1,2} \d{1,2} \* \* \*$' then
    v_min  := split_part(v_sched, ' ', 1)::int;
    v_hour := split_part(v_sched, ' ', 2)::int;
    v_ist  := ((v_hour * 60 + v_min + 330) % 1440) / 60;
  end if;

  return jsonb_build_object(
    'scheduled',    true,
    'cron',         v_sched,
    'active',       coalesce(v_active, false),
    'hour_ist',     v_ist);
end $$;

revoke all on function public.master_report_schedule_info() from public, anon;
grant execute on function public.master_report_schedule_info() to authenticated;

comment on function public.master_report_schedule_info() is
  'The LIVE cron schedule for the daily Master Report, so the admin screen can show what is really installed instead of echoing back what was typed.';

-- ---------------------------------------------------------------------------
-- 3. Wire it into the save.
--
--    Same body as 20260830120000 plus the reschedule. Deliberately NOT
--    conditional on the hour having changed: an unconditional call also heals a
--    job that was unscheduled or edited by hand.
-- ---------------------------------------------------------------------------
create or replace function public.set_master_report_settings(
  p_enabled            boolean default null,
  p_send_hour_ist      integer default null,
  p_dormant_after_days integer default null,
  p_include_modules    text[]  default null,
  p_clear_include      boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  if p_send_hour_ist is not null and (p_send_hour_ist < 0 or p_send_hour_ist > 23) then
    raise exception 'send hour must be between 0 and 23';
  end if;

  update public.master_report_settings
     set enabled            = coalesce(p_enabled, enabled),
         send_hour_ist      = coalesce(p_send_hour_ist, send_hour_ist),
         dormant_after_days = coalesce(p_dormant_after_days, dormant_after_days),
         include_modules    = case when p_clear_include then null
                                   else coalesce(p_include_modules, include_modules) end,
         updated_at         = now(),
         updated_by         = auth.uid()
   where id;

  -- In the SAME transaction as the update above. If this raises, the saved hour
  -- rolls back with it, so the stored setting and the live job cannot diverge —
  -- which is exactly how the label came to lie in the first place.
  perform public.master_report_apply_schedule();
end $$;

-- Bring the live job in line with whatever is already stored.
select public.master_report_apply_schedule();
