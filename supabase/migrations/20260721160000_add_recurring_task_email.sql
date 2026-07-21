-- Email Alerts — recurring-task assignment email ("once, when assigned").
--
-- WHY A SEPARATE TRIGGER (not notify_task_assignee)
--   Recurring INSTANCES land in public.tasks and are deliberately excluded from
--   notify_task_assignee (from_recurring / recurring_task_id / shifted_from) so the
--   6 AM daily generator never floods inboxes. But the person SHOULD be told once,
--   when they're put on the recurring template. That template lives in a different
--   table (public.recurring_tasks), so it needs its own trigger.
--
-- WHEN IT FIRES (the "newly assigned + live" moments only)
--   * INSERT of an active template that has an assignee.
--   * UPDATE where the assignee CHANGED, or the template just became active
--     (was inactive → now active). Plain edits (title/schedule) to an already-
--     active, same-assignee template do NOT re-email.
--   Self-assignments (assignee = creator/actor) are skipped, matching the one-off
--   rule. Gated by email_module_enabled('task-management'); email only (recurring
--   templates have no bell-notification row to mirror).
--
-- Additive + reversible:
--   drop trigger if exists trg_recurring_notify_assignee on public.recurring_tasks;
--   drop function if exists public.notify_recurring_assignee();

create or replace function public.notify_recurring_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_email text;
  v_recur text;
begin
  -- Only a live template with a real assignee is worth an email.
  if new.assigned_to is null or not coalesce(new.active, false) then
    return new;
  end if;
  -- Never email a self-assignment.
  if new.assigned_to = new.created_by or new.assigned_to = v_actor then
    return new;
  end if;
  -- On UPDATE, only fire when the assignee is NEWLY assigned-and-active:
  -- assignee unchanged AND it was already active => nothing to announce.
  if tg_op = 'UPDATE'
     and new.assigned_to is not distinct from old.assigned_to
     and coalesce(old.active, false) = true then
    return new;
  end if;

  if not public.email_module_enabled('task-management') then
    return new;
  end if;

  v_recur := case new.recurrence_type::text
    when 'daily'     then 'Repeats every working day (Mon–Sat)'
    when 'weekly'    then 'Repeats weekly'
    when 'monthly'   then 'Repeats monthly'
    when 'quarterly' then 'Repeats quarterly'
    when 'when'      then 'As and when required'
    else 'Recurring task'
  end;

  -- Isolated so an email problem can never roll back the template write.
  begin
    v_email := coalesce(
      (select nullif(btrim(p.email), '') from public.profiles p where p.id = new.assigned_to),
      (select nullif(btrim(u.email), '') from auth.users  u where u.id = new.assigned_to)
    );
    insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
    values ('task_recurring_assigned', new.assigned_to, v_email, v_actor, new.id,
            jsonb_build_object('title', new.title, 'recurrence', v_recur));
  exception when others then null;
  end;

  return new;
end $$;

drop trigger if exists trg_recurring_notify_assignee on public.recurring_tasks;
create trigger trg_recurring_notify_assignee
  after insert or update on public.recurring_tasks
  for each row execute function public.notify_recurring_assignee();
