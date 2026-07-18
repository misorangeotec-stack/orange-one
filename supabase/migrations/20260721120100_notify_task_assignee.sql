-- Task Management — notify the assignee when a task is assigned to them (2 of 2).
-- APPLY AFTER 20260721120000_add_assigned_notification_type.sql, which adds the
-- 'assigned' enum label this file inserts with.
--
-- Until now, being assigned a task told you nothing: the tasks INSERT trigger
-- wrote an 'assigned' ACTIVITY row, but nothing ever wrote a NOTIFICATION row, so
-- the bell (which has existed all along) only ever lit up for @mentions.
--
-- WHY A TRIGGER, NOT A CLIENT-SIDE RPC:
--   * insertTask (frontend .../data/taskWrites.ts) is a plain client INSERT, and
--     `notifications` has no client INSERT policy by design. A client-side design
--     therefore needs a SECOND, non-atomic round trip after the task has already
--     committed — and when that call fails, the task exists and the assignee is
--     silently never told. The notice IS the feature here, so that is not a
--     tradeoff worth taking.
--   * insertTask is not the only creation path. generate_recurring_tasks,
--     generate_recurring_task_now and shift_task_to_week (0021) all INSERT into
--     tasks server-side. Only a trigger sees every path, so the exclusion rules
--     below live in exactly one place instead of being re-implemented per caller.
--
-- WHY A NEW FUNCTION RATHER THAN EDITING log_task_activity():
--   That function already computes the "assigned to someone else" condition, so
--   folding this in is tempting — but its body exists only inside a database dump
--   (backups/identity_2026-06-09_1547.sql), not in either migrations folder.
--   Re-issuing it would replay a possibly-stale June body over whatever is
--   actually live. A separate trigger is additive and carries no drift risk.
--   Both are AFTER triggers and we deliberately leave activity_id NULL, so the
--   firing order between them does not matter.
--
-- NO BACKFILL. Only assignments made from here on notify. Backfilling would mark
-- every historical task unread for everyone at once.
--
-- Reversal:
--   drop trigger if exists trg_tasks_notify_assignee on public.tasks;
--   drop function if exists public.notify_task_assignee();
--   -- and re-apply db/migrations/0011_tagged_task_visibility.sql to restore the
--   -- untyped visibility policies re-created at the bottom of this file.

-- ---------------------------------------------------------------------------
-- 1. Trigger function
-- ---------------------------------------------------------------------------
create or replace function public.notify_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Server-side generators (pg_cron) run without an auth context; fall back to
  -- the row's creator so actor_id is never silently NULL.
  v_actor uuid := coalesce(auth.uid(), new.created_by);
begin
  -- Every exclusion below is a requirement, not a defensive guard:
  --   * unassigned                -> nobody to notify.
  --   * assigned_to = created_by  -> you assigned it to yourself.
  --   * assigned_to = v_actor     -> ditto, when the actor is not the creator.
  --   * is_personal               -> personal scratch tasks are self-assigned by
  --                                  definition and excluded from every metric.
  --   * from_recurring / recurring_task_id -> auto-generated instances are not a
  --       new assignment. Both are checked: 0021 stamps from_recurring on both
  --       generators, but rows created by an older path may carry only the FK.
  --   * shifted_from_task_id      -> a shift-to-next-week continuation. NOTE this
  --       one is load-bearing: shift_task_to_week (0021) inserts the new row with
  --       created_by = the SHIFTER, so a manager shifting an employee's task WOULD
  --       otherwise satisfy assigned_to <> created_by and re-notify. The assignee
  --       already owned the original; re-notifying every carry-forward is noise.
  if new.assigned_to is null
     or new.assigned_to = new.created_by
     or new.assigned_to = v_actor
     or coalesce(new.is_personal, false)
     or coalesce(new.from_recurring, false)
     or new.recurring_task_id is not null
     or new.shifted_from_task_id is not null
  then
    return new;
  end if;

  -- Isolated so a notification failure can never roll back a committed task
  -- insert. The task is the user's work; the notice about it is not.
  begin
    insert into public.notifications (user_id, type, task_id, actor_id)
    select new.assigned_to, 'assigned', new.id, v_actor
    where not exists (
      select 1 from public.notifications n
      where n.user_id = new.assigned_to
        and n.task_id = new.id
        and n.type = 'assigned'
    );
  exception when others then
    null;
  end;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Trigger
-- ---------------------------------------------------------------------------
drop trigger if exists trg_tasks_notify_assignee on public.tasks;
create trigger trg_tasks_notify_assignee
  after insert on public.tasks
  for each row execute function public.notify_task_assignee();

-- ---------------------------------------------------------------------------
-- 3. Scope 0011's three visibility policies back to mentions.
--
-- db/migrations/0011_tagged_task_visibility.sql grants SELECT on a task, its
-- activity and its location checklist to anyone holding ANY notifications row for
-- that task — that is how the Tagged view works.
--
-- An 'assigned' notification is a no-op the moment it is created: the assignee
-- already passes tasks_select via assigned_to = auth.uid(). But the row is
-- PERMANENT, so once the task is reassigned away, the stale notification would
-- keep the EX-assignee reading the task, its entire remark thread and its
-- checklist forever. 0011 reasoned about that persistence for mentions; it was
-- never reasoned about for assignments, where reassignment is routine.
--
-- Adding `and n.type = 'mention'` restores 0011's stated intent exactly. Net
-- access versus TODAY is unchanged — this removes only the grant that this very
-- migration would otherwise introduce. Re-creating existing policies with
-- drop-if-exists + create is what 0011 itself does.
-- ---------------------------------------------------------------------------
drop policy if exists tasks_select_mentioned on public.tasks;
create policy tasks_select_mentioned on public.tasks
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n
      where n.task_id = tasks.id and n.user_id = auth.uid() and n.type = 'mention'
    )
  );

drop policy if exists task_activity_select_mentioned on public.task_activity;
create policy task_activity_select_mentioned on public.task_activity
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n
      where n.task_id = task_activity.task_id and n.user_id = auth.uid() and n.type = 'mention'
    )
  );

drop policy if exists task_locations_select_mentioned on public.task_locations;
create policy task_locations_select_mentioned on public.task_locations
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n
      where n.task_id = task_locations.task_id and n.user_id = auth.uid() and n.type = 'mention'
    )
  );
