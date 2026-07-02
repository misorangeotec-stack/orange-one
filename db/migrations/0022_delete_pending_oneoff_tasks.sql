-- Task Management — delete a PENDING one-off task.
--
-- The tasks table has no client DELETE policy except the narrow
-- tasks_delete_personal (creator's own is_personal rows), so a standard assigned
-- one-off task cannot be deleted from the client at all. This adds a guard-railed
-- delete for genuine one-off tasks that nobody has started yet — a cleanup path
-- for mistakenly-created / no-longer-needed tasks.
--
-- Guards (all enforced here at the DB level, not just in the UI):
--   * status = 'pending'          — once in_progress/completed/revised/shifted, delete is denied
--   * is_personal = false         — personal "Other" tasks keep their own delete (tasks_delete_personal)
--   * recurring_task_id is null
--     and from_recurring = false  — recurring-generated instances are not deletable this way
--   * creator OR assignee OR admin — only these three may delete
--
-- Purely ADDITIVE: one new DELETE policy, no column/table/row mutation. Postgres
-- ORs permissive DELETE policies, so tasks_delete_personal is unaffected. Apply in
-- the Orange One identity Supabase project (ref coshondiqdhorwvibrwu) BEFORE the
-- frontend goes live, or the delete call errors under RLS.
--
-- Reversal:
--   drop policy if exists tasks_delete_pending on public.tasks;

drop policy if exists tasks_delete_pending on public.tasks;
create policy tasks_delete_pending on public.tasks
  for delete using (
    status = 'pending'
    and is_personal = false
    and recurring_task_id is null
    and from_recurring = false
    and (
      created_by = auth.uid()
      or assigned_to = auth.uid()
      or public.is_admin(auth.uid())
    )
  );
