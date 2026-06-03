-- Task Management — "Tagged" task visibility.
--
-- Lets a user READ any task they have been @mentioned in (tagged in a remark),
-- so the new "Tagged" view can list those tasks and the user can open them to
-- read the remark that tagged them — even when they are neither the assignee,
-- the creator, an admin, nor an HOD of either (the only cases the existing
-- *_select policies allow).
--
-- The @mention fan-out (public.add_task_remark) writes one public.notifications
-- row per mentioned user, carrying task_id and scoped by RLS to that user. Those
-- rows are the source of truth here: a notification linking the caller to a task
-- grants the caller read on that task, its activity (the remark thread) and its
-- location checklist. The row persists after the bell marks it read (only
-- read_at is set), so the tagged task stays visible.
--
-- Purely ADDITIVE (see the additive-only Supabase rule): Postgres ORs multiple
-- permissive SELECT policies, so these only WIDEN visibility — the existing
-- tasks_select / task_activity_select / task_locations_rw policies are untouched,
-- and no table/column/row is mutated. Apply in the Orange One project
-- (ref coshondiqdhorwvibrwu) via the SQL editor or `supabase db push`, before the
-- frontend ships (soft: if unapplied, the Tagged view just shows fewer rows).
--
-- Reversal:
--   drop policy if exists tasks_select_mentioned on public.tasks;
--   drop policy if exists task_activity_select_mentioned on public.task_activity;
--   drop policy if exists task_locations_select_mentioned on public.task_locations;

-- ---------------------------------------------------------------------------
-- 1. tasks — read a task you've been mentioned in.
-- ---------------------------------------------------------------------------
drop policy if exists tasks_select_mentioned on public.tasks;
create policy tasks_select_mentioned on public.tasks
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n
      where n.task_id = tasks.id and n.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. task_activity — read the remark thread of a task you've been mentioned in.
-- ---------------------------------------------------------------------------
drop policy if exists task_activity_select_mentioned on public.task_activity;
create policy task_activity_select_mentioned on public.task_activity
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n
      where n.task_id = task_activity.task_id and n.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. task_locations — render the checklist on a task you've been mentioned in.
-- ---------------------------------------------------------------------------
drop policy if exists task_locations_select_mentioned on public.task_locations;
create policy task_locations_select_mentioned on public.task_locations
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n
      where n.task_id = task_locations.task_id and n.user_id = auth.uid()
    )
  );
