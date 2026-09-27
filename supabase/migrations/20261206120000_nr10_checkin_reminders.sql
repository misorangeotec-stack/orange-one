-- ===========================================================================
-- NR-10 · The reminder, one day before each check-in.
--
-- To the head of department and to the new joiner — whichever of them has not
-- answered yet — with HR copied, because HR carries the score for it.
--
-- BELL NOW, EMAIL DISARMED. The rows for email are written only when
-- `email_module_enabled('hr-recruitment')` is true, and it has been FALSE since
-- 04-08-2026. So this ships doing exactly what it will do on the day the switch
-- is flipped, and sends nothing until somebody flips it. The same pattern NR-1's
-- interview mails already sit in.
--
-- ⚠ BEFORE THAT SWITCH IS EVER FLIPPED: `send-email` must learn the kind
--   `hr-recruitment_checkin_reminder`, or the running renderer will treat it as
--   master-data governance and print the wrong footer. That redeploy is already
--   parked in NR-1 for the same reason.
--
-- ADDITIVE ONLY: one nullable column, one function, one schedule.
-- ===========================================================================

alter table public.fms_hr_probation_checkins
  add column if not exists reminder_sent_at timestamptz;

comment on column public.fms_hr_probation_checkins.reminder_sent_at is
  'NR-10. When the day-before reminder went out. Stamped so a second run of the job on the same day cannot send it twice - the job is idempotent on this column, not on the schedule.';

create or replace function public.fms_hr_send_checkin_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_tomorrow date;
  v_email_on boolean := public.email_module_enabled('hr-recruitment');
  r          record;
  u          uuid;
  v_sent     integer := 0;
  v_people   uuid[];
  v_hr       uuid[];
  v_text     text;
  v_addr     text;
begin
  -- ⚠ IST, computed here rather than inherited. pg_cron fires in UTC and this
  -- database's `current_date` is UTC too, so "tomorrow" for a person in Surat is
  -- not "tomorrow" for the server for five and a half hours of every day.
  v_tomorrow := ((now() at time zone 'Asia/Kolkata')::date) + 1;

  v_hr := coalesce(public.fms_hr_step_owner_ids('onboarding'), '{}'::uuid[]);

  for r in
    select k.id, k.probation_id, k.day_no, k.due_on,
           k.hod_at, k.joiner_at,
           p.requisition_id, p.candidate_id,
           o.employee_user_id,
           c.name as candidate_name,
           req.hiring_manager_ids
      from public.fms_hr_probation_checkins k
      join public.fms_hr_probations p   on p.id = k.probation_id
      join public.fms_hr_onboardings o  on o.id = p.onboarding_id
      join public.fms_hr_candidates c   on c.id = p.candidate_id
      join public.fms_hr_requisitions req on req.id = p.requisition_id
     where k.due_on = v_tomorrow
       and k.completed_at is null
       and k.reminder_sent_at is null
       and p.final_status is null
  loop
    -- Only the side that still owes an answer is asked for one.
    v_people := '{}'::uuid[];
    if r.hod_at is null then
      v_people := coalesce(r.hiring_manager_ids, '{}'::uuid[])
                  || coalesce(public.fms_hr_step_owner_ids('probation_d' || r.day_no), '{}'::uuid[]);
    end if;
    if r.joiner_at is null and r.employee_user_id is not null then
      v_people := v_people || array[r.employee_user_id];
    end if;
    -- HR is copied whatever is outstanding: the line they are scored on is
    -- whether BOTH sides arrived, so they need to see it coming.
    v_people := v_people || v_hr;

    v_text := 'Day-' || r.day_no || ' check-in for ' || coalesce(r.candidate_name, 'a new joiner')
              || ' is due tomorrow (' || to_char(r.due_on, 'DD-MM-YYYY') || ')';

    foreach u in array v_people loop
      if u is null then continue; end if;
      -- One row per person, deduplicated: a hiring manager who is also a step
      -- owner must not get the same reminder twice.
      if exists (
        select 1 from public.fms_hr_notifications n
         where n.user_id = u and n.entity_id = r.id and n.type = 'checkin_reminder'
      ) then continue; end if;

      insert into public.fms_hr_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, 'checkin_reminder', 'probation', r.id, v_text, null);

      if v_email_on then
        begin
          v_addr := coalesce(
            (select nullif(btrim(pr.email), '') from public.profiles pr where pr.id = u),
            (select nullif(btrim(au.email), '') from auth.users au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('hr-recruitment_checkin_reminder', u, v_addr, null, r.id,
                  jsonb_build_object('text', v_text, 'entity_type', 'probation',
                                     'day_no', r.day_no, 'due_on', r.due_on));
        exception when others then null;   -- a bad address must not stop the rest
        end;
      end if;

      v_sent := v_sent + 1;
    end loop;

    update public.fms_hr_probation_checkins
       set reminder_sent_at = now() where id = r.id;
  end loop;

  return v_sent;
end
$fn$;

revoke all on function public.fms_hr_send_checkin_reminders() from public;
grant execute on function public.fms_hr_send_checkin_reminders() to service_role;

-- ── the schedule ───────────────────────────────────────────────────────────
-- 02:47 UTC = 08:17 IST — in the morning for the people being reminded, and on a
-- minute that collides with NOTHING already running. Checked against all fifteen
-- jobs: 47 is not hit by */3, by 3-59/5, by 1-59/15, by */15, by */30, or by the
-- hourly 5,20,35,50. This project has had two jobs land on the same tick before.
select cron.unschedule('hr-checkin-reminders')
 where exists (select 1 from cron.job where jobname = 'hr-checkin-reminders');

select cron.schedule(
  'hr-checkin-reminders',
  '47 2 * * *',
  $cron$ select public.fms_hr_send_checkin_reminders(); $cron$
);
