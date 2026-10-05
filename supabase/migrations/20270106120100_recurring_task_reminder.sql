-- Recurring-task reminder · 2 of 2 — "Notification required: Yes, N days before".
--
-- WHAT. On a recurring template the owner can now switch on a reminder: the assignee is
-- told N days BEFORE each date the template fires ("Monthly GST return is due on
-- 10-11-2026, in 3 days"). The task itself still lands on the day, as today — the 06:00 IST
-- generator mints instances one day at a time and is NOT changed here.
--
-- HOW.
--   · recurring_tasks gets notify_required (default false) + notify_days_before (1..30).
--     Existing templates are untouched: default false = no reminder, exactly as before.
--   · notifications gets recurring_task_id + reminder_date, so a reminder row (which has no
--     task yet, task_id null) can say which template and which date. Both nullable; every
--     existing writer and row is unaffected.
--   · send_recurring_reminders(p_date) — for each active template with a reminder on and an
--     assignee, asks recurring_fires_on(r, p_date + N): the ONE copy of the generator's rule
--     (KPI-1), so the reminder can never disagree with the day the task actually appears.
--     If yes, one bell row for the assignee (+ an email when Task Management emails are on).
--     Dedup on (template, assignee, reminder_date), so a re-run or a retried cron is harmless.
--   · Only weekly / monthly / quarterly templates. Daily and "As and When" fire every working
--     day, so a reminder N days ahead would just be a second daily ping; the form does not
--     offer it for them and the function skips them.
--   · cron 'recurring-task-reminders' 00:35 UTC = 06:05 IST, just after the generator.
--
-- Touches nothing else: no change to tasks, to the generator, to RLS on recurring_tasks
-- (the same creator/admin/HOD rule already governs who can edit a template, so it governs
-- who can switch its reminder on), or to any other module.
--
-- Rollback: 20270106120100_recurring_task_reminder_rollback.sql.

-- ---------------------------------------------------------------------------
-- 1. The two template fields.
-- ---------------------------------------------------------------------------
alter table public.recurring_tasks
  add column if not exists notify_required boolean not null default false,
  add column if not exists notify_days_before smallint;

alter table public.recurring_tasks
  drop constraint if exists recurring_tasks_notify_days_before_check;
alter table public.recurring_tasks
  add constraint recurring_tasks_notify_days_before_check
  check (
    notify_days_before is null or notify_days_before between 1 and 30
  );

comment on column public.recurring_tasks.notify_required is
  'Remind the assignee before each fire date (Recurring form: "Notification required"). Default false.';
comment on column public.recurring_tasks.notify_days_before is
  'How many days before the fire date the reminder goes out (1..30). Used only when notify_required.';

-- ---------------------------------------------------------------------------
-- 2. What a reminder row points at.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists recurring_task_id uuid
    references public.recurring_tasks(id) on delete cascade,
  add column if not exists reminder_date date;

comment on column public.notifications.recurring_task_id is
  'Set on task_recurring_reminder rows only: the template being reminded about.';
comment on column public.notifications.reminder_date is
  'Set on task_recurring_reminder rows only: the date the task will appear (the fire date).';

create index if not exists notifications_recurring_reminder_idx
  on public.notifications (recurring_task_id, reminder_date)
  where recurring_task_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The daily sender.
-- ---------------------------------------------------------------------------
create or replace function public.send_recurring_reminders(
  p_date date default (now() at time zone 'Asia/Kolkata')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.recurring_tasks;
  v_fire date;
  v_count int := 0;
  v_email text;
  v_send_mail boolean := public.email_module_enabled('task-management');
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  for r in
    select * from public.recurring_tasks
    where active
      and notify_required
      and assigned_to is not null
      and notify_days_before between 1 and 30
      and recurrence_type::text in ('weekly', 'monthly', 'quarterly')
  loop
    v_fire := p_date + r.notify_days_before;

    if not public.recurring_fires_on(r, v_fire) then
      continue;
    end if;

    -- Already reminded for this date (re-run, retry, or the template was re-saved).
    if exists (
      select 1 from public.notifications n
      where n.recurring_task_id = r.id
        and n.reminder_date = v_fire
        and n.user_id = r.assigned_to
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, type, task_id, actor_id, recurring_task_id, reminder_date)
    values (r.assigned_to, 'task_recurring_reminder', null, r.created_by, r.id, v_fire);
    v_count := v_count + 1;

    -- Email: isolated so a mail problem can never undo the bell row.
    if v_send_mail then
      begin
        v_email := coalesce(
          (select nullif(btrim(p.email), '') from public.profiles p where p.id = r.assigned_to),
          (select nullif(btrim(u.email), '') from auth.users  u where u.id = r.assigned_to)
        );
        insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
        values ('task_recurring_reminder', r.assigned_to, v_email, r.created_by, r.id,
                jsonb_build_object(
                  'title', r.title,
                  'fire_date', to_char(v_fire, 'DD-MM-YYYY'),
                  'days_before', r.notify_days_before));
      exception when others then null;
      end;
    end if;
  end loop;

  return v_count;
end $$;

comment on function public.send_recurring_reminders(date) is
  'Bell (+ email) reminders N days before a recurring template fires, for templates with '
  'notify_required. Run daily by cron recurring-task-reminders (06:05 IST). Deduped per '
  'template/assignee/fire date.';

revoke all on function public.send_recurring_reminders(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Schedule. cron is UTC: 00:35 UTC = 06:05 IST, five minutes after the
--    generate-recurring-daily run (00:30 UTC). Re-runnable (replaces by name).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'recurring-task-reminders',
  '35 0 * * *',
  $$set local statement_timeout = '110s'; select public.send_recurring_reminders();$$
);
