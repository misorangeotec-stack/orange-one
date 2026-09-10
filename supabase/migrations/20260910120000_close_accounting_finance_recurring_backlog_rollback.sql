-- Rollback for 20260910120000_close_accounting_finance_recurring_backlog.sql
--
-- Undoes ALL FOUR effects of the bulk close, not just the status. A rollback that
-- restored only tasks.status would leave every reopened task carrying a "Master Admin
-- completed this task" line in its timeline for work that is open again.
--
-- Safe to run more than once: every step is scoped to the snapshot tables, and the
-- snapshot tables are emptied last.
--
-- Nothing here needs the locations gate or the activity trigger to be disabled:
--   * trg_tasks_locations_gate fires only when the NEW status is 'completed'.
--   * log_task_activity() inserts only on transitions TO completed/revised/shifted.
-- So restoring a task to pending/in_progress trips neither and writes no new history.
-- trg_tasks_updated will bump updated_at, which is harmless and correct.
--
-- The snapshot tables themselves are left in place by design (additive-only, per
-- CLAUDE.md). They are emptied, not dropped, so a re-run of the migration re-fills them.

do $$
declare
  v_actor uuid := '7c82f7b4-cb51-4304-89bc-5754c8f17cdc';  -- Master Admin
  v_tasks int;
  v_locs  int;
  v_comp  int;
  v_rem   int;
begin
  -- Step 1: restore task status and completion timestamp.
  update public.tasks t
  set status = s.prior_status, completed_at = s.prior_completed_at
  from public.task_bulk_close_af_20260909 s
  where t.id = s.task_id;
  get diagnostics v_tasks = row_count;

  -- Step 2: clear ONLY the location rows this migration flipped. Rows that were already
  -- N/A for legitimate reasons were never recorded, so they cannot be cleared here.
  update public.task_locations tl
  set na_at = null, na_by = null
  where tl.id in (select task_location_id from public.task_location_bulk_na_af_20260909);
  get diagnostics v_locs = row_count;

  -- Step 3: delete the 'completed' activity rows the migration caused.
  -- Triple-scoped -- the snapshot's task set, the Master Admin actor, and at/after the
  -- run's own closed_at -- so a genuine older completion on a reopened task survives.
  delete from public.task_activity a
  using public.task_bulk_close_af_20260909 s
  where a.task_id = s.task_id
    and a.type = 'completed'
    and a.actor_id = v_actor
    and a.created_at >= s.closed_at;
  get diagnostics v_comp = row_count;

  -- Step 4: delete the audit remark rows on the same scope.
  delete from public.task_activity a
  using public.task_bulk_close_af_20260909 s
  where a.task_id = s.task_id
    and a.type = 'remark'
    and a.actor_id = v_actor
    and a.created_at >= s.closed_at
    and a.note like 'Bulk-closed by admin: Accounting & Finance recurring backlog.%';
  get diagnostics v_rem = row_count;

  -- Step 5: empty the snapshot tables last, so a failure above leaves the undo path intact.
  -- `where true` is load-bearing: PostgREST runs with sql_safe_updates ON and refuses an
  -- unqualified DELETE, and that difference does not show up in an owner-run test.
  delete from public.task_location_bulk_na_af_20260909 where true;
  delete from public.task_bulk_close_af_20260909 where true;

  raise notice 'A&F rollback: % tasks restored, % location rows cleared, % completion rows and % remarks deleted',
    v_tasks, v_locs, v_comp, v_rem;
end $$;
