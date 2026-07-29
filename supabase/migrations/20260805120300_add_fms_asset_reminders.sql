-- ===========================================================================
-- ASSET MAINTENANCE FMS — THE REMINDER ENGINE (Phase 4).
--
-- This is the only genuinely new machinery in the module. Everything else reuses
-- the existing FMS engine; nothing in the repo could already answer "tell me
-- before this lapses".
--
-- TWO JOBS, TWO CONCERNS, DELIBERATELY SEPARATE
--   06:00 IST  fms_asset_generate_jobs()   — OPEN a service job when a track
--                                            enters its reminder window.
--   09:00 IST  fms_asset_send_reminders()  — NAG about jobs already open.
--
--   Kept apart because they fail differently and are re-run differently. Opening
--   a job is guarded by a unique index and is safely repeatable at any time;
--   nagging is guarded by a log table and must never double-mail. Fusing them
--   would mean one bug in either could silence both.
--
-- WHY A LOG TABLE RATHER THAN A "last_reminded_on" COLUMN
--   A column can only remember the LAST reminder, so a same-day re-run (a cron
--   retry, a manual catch-up after an outage) cannot tell "already sent" from
--   "due again". The log records (job, date, tier) and the unique constraint does
--   the deduplication — a re-run inserts nothing and mails nobody.
--
-- Reversal:
--   select cron.unschedule('fms-asset-send-reminders');
--   select cron.unschedule('fms-asset-generate-jobs');
--   drop function if exists public.fms_asset_send_reminders(date);
--   drop function if exists public.fms_asset_generate_jobs(date);
--   drop table if exists public.fms_asset_reminder_log;
-- ===========================================================================

create extension if not exists pg_cron;

create table if not exists public.fms_asset_reminder_log (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.fms_asset_jobs on delete cascade,
  reminder_on date not null,
  -- 'raise'   — the job was opened (open_job already announced; logged so the
  --             ladder does not immediately say the same thing again)
  -- 'd<N>'    — a ladder tier, N days before due
  -- 'overdue' — past due; fires every day until the job leaves the queue
  tier        text not null,
  created_at  timestamptz not null default now(),
  unique (job_id, reminder_on, tier)
);
comment on table public.fms_asset_reminder_log is
  'One row per reminder actually sent. The unique (job, date, tier) is the dedup: a re-run of send_reminders inserts nothing and mails nobody.';
create index if not exists fms_asset_reminder_log_job_idx on public.fms_asset_reminder_log (job_id);

alter table public.fms_asset_reminder_log enable row level security;
drop policy if exists fms_asset_reminder_log_select on public.fms_asset_reminder_log;
create policy fms_asset_reminder_log_select on public.fms_asset_reminder_log
  for select to authenticated using (true);
-- No write policy: only the SECURITY DEFINER cron functions write here.

-- ===========================================================================
-- fms_asset_generate_jobs — open jobs whose reminder window has arrived.
--
-- "Window arrived" = next_due_date - lead_days <= today. So a 45-day insurance
-- lead opens its job six weeks out; a 15-day service lead opens a fortnight out.
--
-- IDEMPOTENT twice over: fms_asset_open_job returns NULL when the track already
-- has an open job, and the partial unique index catches any race that slips past
-- the pre-check. Re-running this function on the same day is a no-op.
--
-- ⚠ FIRST RUN AFTER A BULK IMPORT will open a job for every track whose due date
--   is already in the past — potentially hundreds, all overdue, all announcing.
--   That is correct behaviour, and it is why the go-live sequence says to run
--   this by hand with the email module still OFF and look at the result first.
-- ===========================================================================
create or replace function public.fms_asset_generate_jobs(p_date date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_date, public.fms_asset_today_ist());
  v_count integer := 0;
  v_job   uuid;
  r       record;
begin
  for r in
    select sc.id
      from public.fms_asset_schedules sc
      join public.fms_asset_assets a on a.id = sc.asset_id
     where sc.active
       and a.active
       and sc.next_due_date is not null
       and sc.next_due_date - coalesce(sc.lead_days, 15) <= v_today
       and not exists (
         select 1 from public.fms_asset_jobs j
          where j.schedule_id = sc.id
            and j.status not in ('closed','cancelled','skipped')
       )
     order by sc.next_due_date
  loop
    v_job := public.fms_asset_open_job(r.id, 'auto');
    if v_job is not null then
      v_count := v_count + 1;
      -- Logged so the ladder does not repeat, on the same day, what opening the
      -- job already announced.
      insert into public.fms_asset_reminder_log (job_id, reminder_on, tier)
      values (v_job, v_today, 'raise')
      on conflict do nothing;
    end if;
  end loop;

  return v_count;
end $$;
comment on function public.fms_asset_generate_jobs(date) is
  'Open a service job for every active track whose reminder window has arrived. Idempotent — safe to re-run any number of times on the same day.';
revoke execute on function public.fms_asset_generate_jobs(date) from anon, authenticated;

-- ===========================================================================
-- fms_asset_send_reminders — the ladder.
--
-- For every OPEN job: days_to_due = due_date - today.
--   days_to_due > 0   → fire if it matches a ladder tier AND that tier is within
--                       this track's own lead_days.
--   days_to_due <= 0  → fire the 'overdue' tier, every day, until the job is
--                       actioned. Escalation by persistence, which is the whole
--                       point of the module.
--
-- ⚠ THE `tier <= lead_days` GUARD IS LOAD-BEARING. Without it a 45-day insurance
--   lead would open its job at T-45 and then say nothing until T-15 (because the
--   ladder's first tier below 45 is 30 — which it would also have to skip), while
--   a 15-day service lead would keep testing a T-45 tier it can never reach. The
--   ladder is a global preference; lead_days is the per-track truth, and it wins.
--
-- Recipients: the asset's custodian + the owners of the step the job is actually
-- sitting on — so a job stuck at verification nags the verifier, not the person
-- who already did the work.
-- ===========================================================================
create or replace function public.fms_asset_send_reminders(p_date date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date := coalesce(p_date, public.fms_asset_today_ist());
  v_ladder integer[];
  v_count  integer := 0;
  v_tier   text;
  v_days   integer;
  v_text   text;
  r        record;
begin
  select coalesce(
           (select array_agg(x::integer order by x::integer desc)
              from jsonb_array_elements_text(
                     coalesce((select value->'days' from public.fms_asset_config where key = 'reminder_ladder'),
                              '[]'::jsonb)) as t(x)),
           array[45,30,15,7,1])
    into v_ladder;

  for r in
    select j.id, j.job_no, j.due_date, j.current_step, j.status,
           sc.lead_days,
           a.asset_no, a.name as asset_name, a.custodian_user_id,
           st.name as type_name
      from public.fms_asset_jobs j
      join public.fms_asset_schedules sc on sc.id = j.schedule_id
      join public.fms_asset_assets a on a.id = j.asset_id
      left join public.fms_asset_schedule_types st on st.id = j.schedule_type_id
     where j.status in ('awaiting_schedule','awaiting_service','awaiting_verification')
       and j.due_date is not null
       -- A job opened today has already announced itself via open_job; the
       -- ladder picks up from tomorrow.
       and (j.created_at at time zone 'Asia/Kolkata')::date < v_today
     order by j.due_date
  loop
    v_days := r.due_date - v_today;

    if v_days > 0 then
      if not (v_days = any(v_ladder) and v_days <= coalesce(r.lead_days, 15)) then
        continue;
      end if;
      v_tier := 'd' || v_days::text;
      v_text := coalesce(r.type_name, 'Service') || ' for ' || coalesce(r.asset_no || ' ', '')
                || r.asset_name || ' is due in ' || v_days::text
                || case when v_days = 1 then ' day' else ' days' end
                || ' (' || to_char(r.due_date, 'DD-MM-YYYY') || ').';
    else
      v_tier := 'overdue';
      v_text := coalesce(r.type_name, 'Service') || ' for ' || coalesce(r.asset_no || ' ', '')
                || r.asset_name || ' was due on ' || to_char(r.due_date, 'DD-MM-YYYY')
                || case when v_days = 0 then ' - it is due TODAY.'
                        else ' - ' || abs(v_days)::text
                             || case when abs(v_days) = 1 then ' day' else ' days' end || ' overdue.' end;
    end if;

    -- Claim the reminder FIRST. If another run already sent it, the unique
    -- constraint makes this a no-op and nobody is mailed twice.
    begin
      insert into public.fms_asset_reminder_log (job_id, reminder_on, tier)
      values (r.id, v_today, v_tier);
    exception when unique_violation then
      continue;
    end;

    perform public.fms_asset_announce(
      'job', r.id,
      case when v_tier = 'overdue' then 'job_overdue' else 'job_due_soon' end,
      v_text,
      (select array_remove(
         public.fms_asset_step_owner_ids(coalesce(r.current_step, 'schedule')) || r.custodian_user_id,
         null)),
      jsonb_build_object('job_no', r.job_no, 'asset_no', r.asset_no, 'asset_name', r.asset_name,
                         'schedule_type', r.type_name, 'due_date', r.due_date,
                         'days_to_due', v_days, 'tier', v_tier));

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;
comment on function public.fms_asset_send_reminders(date) is
  'Push the reminder ladder for every open service job. Deduplicated by fms_asset_reminder_log — re-running on the same day sends nothing.';
revoke execute on function public.fms_asset_send_reminders(date) from anon, authenticated;

-- ===========================================================================
-- SCHEDULING
--
-- cron.schedule() is UTC. The IST time is converted BY HAND in the expression
-- and stated here, which is this repo's convention (db/migrations/0004).
--
-- ⚠ statement_timeout is set INSIDE THE COMMAND, not on the function. A
--   function-level `set statement_timeout` does nothing for pg_cron, and when a
--   cron statement is killed the function's own log is EMPTY — diagnose from
--   cron.job_run_details, not from the application.
--
-- ⚠ Neither function may COMMIT. pg_cron aborts the job if its command commits
--   mid-flight; both are single-transaction by construction.
--
-- cron.schedule(name, …) replaces a job of the same name, so this file is
-- re-runnable.
-- ===========================================================================

-- 00:30 UTC = 06:00 IST — before the working day, so the day's work is waiting.
select cron.schedule(
  'fms-asset-generate-jobs',
  '30 0 * * *',
  $$set local statement_timeout = '110s'; select public.fms_asset_generate_jobs();$$
);

-- 03:30 UTC = 09:00 IST — as people start work, three hours after the generator,
-- so a job opened this morning is already in place to be reminded about.
select cron.schedule(
  'fms-asset-send-reminders',
  '30 3 * * *',
  $$set local statement_timeout = '110s'; select public.fms_asset_send_reminders();$$
);
