-- Close the Accounting & Finance recurring backlog: every open recurring-generated
-- task due on or before 9 Sep 2026.
--
-- The department has never worked its recurring queue. The daily generator has minted
-- an instance per template per day since 1 Jul and almost none were ticked off, so
-- 1,567 rows sit pending/in_progress forever. Measured 10-Sep-2026: the department
-- holds 1,631 of the 1,784 open tasks org-wide -- 91% of the company's backlog -- so
-- the Master Report's "Open now" (1,784 -> 217) and "Overdue" (1,700 -> 133) tiles are
-- effectively a picture of this one department.
--
-- Recurring only, per the ask. One-off tasks are real work somebody still owes and are
-- left alone. See the exclusions below: each one is deliberate, not an oversight.
--
-- Second run of the pattern established by 20260901120000_close_pre_golive_task_backlog,
-- which closed the 638 pre-go-live rows due on or before 30 Jun. No overlap: that run is
-- why nothing here is open before 1 Jul.
--
-- Additive only, per CLAUDE.md: nothing is dropped and nothing is deleted. The two
-- snapshot tables below are the undo path and are meant to be kept.
-- Rollback: 20260910120000_close_accounting_finance_recurring_backlog_rollback.sql
--
-- Idempotent: once the target rows are 'completed' they no longer match the predicate,
-- so a re-run is a no-op.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps this file in its own transaction.
-- The mutating steps all live inside one DO block, which is a single statement and
-- therefore atomic on its own even in a bare SQL editor.

-- Undo record: what each task looked like before it was closed.
create table if not exists public.task_bulk_close_af_20260909 (
  task_id            uuid primary key references public.tasks (id) on delete cascade,
  prior_status       public.task_status not null,
  prior_completed_at timestamptz,
  closed_at          timestamptz not null
);

-- Only the location rows THIS migration flips to N/A. Rows that were already N/A for
-- legitimate reasons must not be cleared by a rollback, so they stay out.
create table if not exists public.task_location_bulk_na_af_20260909 (
  task_location_id uuid primary key references public.task_locations (id) on delete cascade
);

-- No policies: service-role access only. Every other public table has RLS on, and a bare
-- table would otherwise be readable with the anon key.
alter table public.task_bulk_close_af_20260909       enable row level security;
alter table public.task_location_bulk_na_af_20260909 enable row level security;

do $$
declare
  -- The Master Admin service account. A bulk system operation should not be attributed
  -- to a real person; actorById() resolves this id through the org-wide people list, so
  -- the UI shows "Master Admin", not "Someone".
  v_actor uuid := '7c82f7b4-cb51-4304-89bc-5754c8f17cdc';
  -- Accounting & Finance. The only department matching finance/accounting; HR's sheet
  -- calls the same team "Finance", but that is departments.hr_sheet_name, not a second row.
  v_dept  uuid := 'f64dfa08-103d-45bd-ba29-1079d774b526';
  -- One timestamp for every write, so completed_at / na_at / closed_at agree and the
  -- rollback can date itself off closed_at instead of a hand-typed literal.
  v_now   timestamptz := now();
  v_tasks int;
  v_locs  int;
begin
  -- Step 0: capture the target set BEFORE anything is modified.
  --
  -- Deliberately OUT of scope, all five verified on the live data 10-Sep-2026:
  --   * one-off tasks (64) -- not recurring; real work somebody still owes.
  --   * 'shifted' (22)     -- each already has a successor via shifted_to_task_id, and
  --                           every chain terminates in a completed task. Shifted is a
  --                           closed state here; completing it would double-count.
  --   * not_applicable (349) -- renders as "N/A", not as open work. Overwriting somebody's
  --                           deliberate N/A with "completed" is a lie in the audit trail.
  --   * 'quarterly'        -- not a daily/weekly/monthly cadence and none are open anyway.
  --   * due_date >= 10 Sep -- "up to 9 September" read as inclusive of the 9th. The 06:00
  --                           IST generator mints tomorrow's rows outside this predicate,
  --                           so the target count cannot drift while this runs.
  -- Checked and clear: no is_personal task falls inside the predicate.
  insert into public.task_bulk_close_af_20260909 (task_id, prior_status, prior_completed_at, closed_at)
  select t.id, t.status, t.completed_at, v_now
  from public.tasks t
  join public.recurring_tasks rt on rt.id = t.recurring_task_id
  where t.department_id = v_dept
    and t.due_date <= date '2026-09-09'
    and rt.recurrence_type in ('daily', 'weekly', 'monthly', 'when')
    and t.status in ('pending', 'in_progress')
    and coalesce(t.not_applicable, false) = false
  on conflict (task_id) do nothing;

  -- Step 1: resolve the location checklists that would otherwise block the update.
  -- trg_tasks_locations_gate raises if any task_locations row for the task has neither
  -- completed_at nor na_at, and 1,561 of the 1,567 targets are blocked by it across 7,003
  -- rows. N/A is the truthful resolution: these locations were never visited.
  insert into public.task_location_bulk_na_af_20260909 (task_location_id)
  select tl.id
  from public.task_locations tl
  where tl.task_id in (select task_id from public.task_bulk_close_af_20260909)
    and tl.completed_at is null
    and tl.na_at is null
  on conflict (task_location_id) do nothing;

  update public.task_locations tl
  set na_at = v_now, na_by = v_actor
  where tl.id in (select task_location_id from public.task_location_bulk_na_af_20260909)
    and tl.completed_at is null
    and tl.na_at is null;
  get diagnostics v_locs = row_count;

  -- Step 2: close the tasks.
  -- The SET list is exactly these two columns. Do NOT add `description` --
  -- trg_tasks_description_mentions is scoped `UPDATE OF description` and would re-scan
  -- every task for @mentions and generate spurious notifications.
  -- updated_at is left to trg_tasks_updated.
  --
  -- completed_at is now(), not backdated to due_date. Nothing in the app buckets, charts,
  -- sorts or filters on it: every scorecard and RYG selector groups on week_start, and
  -- isOverdueTask compares due_date to today. Backdating would also desynchronise it from
  -- the task_activity row below, whose created_at is trigger-stamped and cannot follow.
  update public.tasks t
  set status = 'completed', completed_at = v_now
  where t.id in (select task_id from public.task_bulk_close_af_20260909)
    and t.status <> 'completed';
  get diagnostics v_tasks = row_count;

  -- Step 3: attribute the completion events that trg_tasks_activity_log just wrote.
  -- log_task_activity() stamps actor_id from auth.uid(), which is null outside a request
  -- context, and a null actor renders as the literal "Someone" in the UI. Scoped to
  -- actor_id is null so pre-existing legitimate rows are untouched.
  update public.task_activity a
  set actor_id = v_actor
  where a.type = 'completed'
    and a.actor_id is null
    and a.task_id in (select task_id from public.task_bulk_close_af_20260909);

  -- Step 4: the audit note, so the history explains itself rather than implying 1,567
  -- tasks were genuinely worked. Inserted after step 2 so it sorts alongside the
  -- completion event on the task timeline.
  insert into public.task_activity (task_id, type, actor_id, note)
  select s.task_id,
         'remark',
         v_actor,
         'Bulk-closed by admin: Accounting & Finance recurring backlog. This recurring '
         || 'task was generated on or before 9 Sep 2026 and was never actioned in the '
         || 'system. Closed on the department''s instruction; it does not mean the work '
         || 'was done.'
  from public.task_bulk_close_af_20260909 s
  where not exists (
    select 1 from public.task_activity a
    where a.task_id = s.task_id and a.type = 'remark' and a.created_at >= s.closed_at
  );

  raise notice 'A&F recurring backlog closed: % tasks, % location rows marked N/A', v_tasks, v_locs;
end $$;
