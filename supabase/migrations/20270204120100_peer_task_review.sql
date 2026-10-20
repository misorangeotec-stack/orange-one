-- Peer task review · 2 of 2. APPLY AFTER 20270204120000 (the two notification types).
--
-- WHY
--   A peer task (a HOD / Sub-HOD handing one-off work SIDEWAYS, TM-1) closed the moment
--   the assignee clicked Mark complete. The client asked (20-10-2026) for it to go back
--   to the person who GAVE it for review instead:
--     assignee completes  → it waits for the giver's review (the giver is notified)
--     giver closes it     → done
--     giver reopens it    → back to the same assignee, In Progress (they are notified),
--                           and round the same loop again.
--
-- WHAT CHANGES
--   1. tasks gains peer_closed_at / peer_closed_by. "Awaiting review" is not a status:
--      it is is_peer_assignment + completed + peer_closed_at null — the same shape the
--      KRA review already uses (completed + kra + no rating), so every scorecard keeps
--      reading a completed peer task exactly as it does today.
--   2. guard_task_peer_review (BEFORE UPDATE): only the giver (or an admin) may close,
--      never the assignee; a closed task can be reopened only by the giver / an admin;
--      reopening clears the close. The stamp is always now() / auth.uid().
--   3. notify_task_peer_review (AFTER UPDATE OF status): bell rows for both hand-offs.
--   4. Peer tasks ALREADY completed before this runs are stamped closed (at their
--      completed_at, closed_by null), so nobody wakes up to a backlog of old reviews.
--
-- Nothing else: no policy changes (tasks_update already lets the creator update), no
-- status enum change, no change for any task that is not a peer task.
--
-- Reversal: 20270204120100_peer_task_review_rollback.sql

-- ---------------------------------------------------------------------------
-- 0 · Pre-conditions.
-- ---------------------------------------------------------------------------
do $assert$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'is_peer_assignment'
  ) then
    raise exception 'peer review pre 1: tasks.is_peer_assignment is missing (TM-1, 20261116120000)';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_type' and e.enumlabel = 'peer_review'
  ) or not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_type' and e.enumlabel = 'peer_reopened'
  ) then
    raise exception 'peer review pre 2: apply 20270204120000 (notification types) first';
  end if;
end
$assert$;

begin;

-- ---------------------------------------------------------------------------
-- 1 · The columns.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists peer_closed_at timestamptz,
  add column if not exists peer_closed_by uuid references auth.users on delete set null;

comment on column public.tasks.peer_closed_at is
  'Peer task review (20270204120100): when the person who gave this peer task reviewed and closed it. Null on a completed peer task = awaiting their review. Cleared on reopen. Always null on a non-peer task.';

-- The giver's review queue.
create index if not exists tasks_peer_awaiting_review_idx
  on public.tasks (created_by)
  where is_peer_assignment and status = 'completed' and peer_closed_at is null;

-- ---------------------------------------------------------------------------
-- 4 · (before the guard exists) Old completed peer tasks count as closed.
-- ---------------------------------------------------------------------------
update public.tasks
   set peer_closed_at = coalesce(completed_at, updated_at)
 where is_peer_assignment and status = 'completed' and peer_closed_at is null;

-- ---------------------------------------------------------------------------
-- 2 · The guard.
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_peer_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();   -- null for the service role / cron: trusted
begin
  if tg_op = 'INSERT' then
    new.peer_closed_at := null;
    new.peer_closed_by := null;
    return new;
  end if;

  if not old.is_peer_assignment then
    if new.peer_closed_at is distinct from old.peer_closed_at
       or new.peer_closed_by is distinct from old.peer_closed_by then
      raise exception 'Only a peer task is reviewed.';
    end if;
    return new;
  end if;

  -- Leaving completed = reopened. Once the giver has closed it, only they (or an
  -- admin) may reopen it — otherwise the assignee could undo the review.
  if new.status <> 'completed' then
    if old.status = 'completed' and old.peer_closed_at is not null and v_uid is not null
       and v_uid is distinct from old.created_by and not public.is_admin(v_uid) then
      raise exception 'This peer task has been reviewed and closed; only the person who gave it can reopen it.';
    end if;
    new.peer_closed_at := null;
    new.peer_closed_by := null;
    return new;
  end if;

  -- Just completed: it starts out awaiting review.
  if old.status <> 'completed' then
    new.peer_closed_at := null;
    new.peer_closed_by := null;
    return new;
  end if;

  -- Completed → completed: the only legal change is closing it, once.
  if new.peer_closed_at is distinct from old.peer_closed_at then
    if old.peer_closed_at is not null or new.peer_closed_at is null then
      raise exception 'A closed peer task is reopened, not un-closed.';
    end if;
    if v_uid is not null then
      if v_uid = old.assigned_to then
        raise exception 'You cannot review your own work; the person who gave this task closes it.';
      end if;
      if v_uid is distinct from old.created_by and not public.is_admin(v_uid) then
        raise exception 'Only the person who gave this peer task can close it.';
      end if;
    end if;
    new.peer_closed_at := now();
    new.peer_closed_by := v_uid;
  else
    new.peer_closed_by := old.peer_closed_by;
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_guard_peer_review on public.tasks;
create trigger trg_tasks_guard_peer_review
  before insert or update on public.tasks
  for each row execute function public.guard_task_peer_review();

-- ---------------------------------------------------------------------------
-- 3 · The bell, for both hand-offs.
-- ---------------------------------------------------------------------------
create or replace function public.notify_task_peer_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not new.is_peer_assignment
     or new.assigned_to is null
     or new.created_by is null
     or new.assigned_to = new.created_by   -- a legacy shift copy: nobody else to tell
  then
    return new;
  end if;

  -- Isolated so a notification failure can never roll back the status change.
  begin
    if new.status = 'completed' and old.status <> 'completed'
       and v_actor is distinct from new.created_by then
      insert into public.notifications (user_id, type, task_id, actor_id)
      values (new.created_by, 'peer_review', new.id, coalesce(v_actor, new.assigned_to));
    elsif old.status = 'completed' and new.status <> 'completed'
       and v_actor is distinct from new.assigned_to then
      insert into public.notifications (user_id, type, task_id, actor_id)
      values (new.assigned_to, 'peer_reopened', new.id, coalesce(v_actor, new.created_by));
    end if;
  exception when others then
    null;
  end;

  return new;
end $$;

drop trigger if exists trg_tasks_notify_peer_review on public.tasks;
create trigger trg_tasks_notify_peer_review
  after update of status on public.tasks
  for each row execute function public.notify_task_peer_review();

-- ---------------------------------------------------------------------------
-- 5 · Post-conditions.
-- ---------------------------------------------------------------------------
do $post$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.tasks
   where is_peer_assignment and status = 'completed' and peer_closed_at is null;
  if v_n <> 0 then
    raise exception 'peer review post 1: % old completed peer task(s) were not stamped closed', v_n;
  end if;

  select count(*) into v_n from public.tasks
   where not is_peer_assignment and (peer_closed_at is not null or peer_closed_by is not null);
  if v_n <> 0 then
    raise exception 'peer review post 2: % non-peer task(s) carry a peer close', v_n;
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_tasks_guard_peer_review')
     or not exists (select 1 from pg_trigger where tgname = 'trg_tasks_notify_peer_review') then
    raise exception 'peer review post 3: a trigger is missing';
  end if;
end
$post$;

commit;
