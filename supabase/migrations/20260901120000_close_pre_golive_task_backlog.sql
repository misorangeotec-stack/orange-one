-- Close the pre-go-live task backlog: every open task due on or before 30 Jun 2026.
--
-- Task Management was adopted on 1 Jul 2026, but `tasks` has been populated since
-- 25 May 2026 -- mostly by the recurring generator minting daily instances before
-- anyone was working the queue. Those 638 rows were never actioned, so they sit
-- pending/in_progress forever and inflate "Open now" and "Overdue" on the Master
-- Report (2,106 / 2,055 at the time of writing -> 1,468 / 1,417 after this runs).
--
-- Additive only, per CLAUDE.md: nothing is dropped and nothing is deleted. The two
-- snapshot tables below are the undo path and are meant to be kept.
--
-- Idempotent: once the target rows are 'completed' they no longer match the
-- predicate, so a re-run is a no-op.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps this file in its own
-- transaction. The mutating steps all live inside one DO block, which is a single
-- statement and therefore atomic on its own even in a bare SQL editor.

-- Undo record: what each task looked like before it was closed.
create table if not exists public.task_bulk_close_20260630 (
  task_id            uuid primary key references public.tasks (id) on delete cascade,
  prior_status       public.task_status not null,
  prior_completed_at timestamptz,
  closed_at          timestamptz not null
);

-- Only the location rows THIS migration flips to N/A. Rows that were already N/A
-- for legitimate reasons must not be cleared by a rollback, so they stay out.
create table if not exists public.task_location_bulk_na_20260630 (
  task_location_id uuid primary key references public.task_locations (id) on delete cascade
);

-- No policies: service-role access only. Every other public table has RLS on, and
-- a bare table would otherwise be readable with the anon key.
alter table public.task_bulk_close_20260630        enable row level security;
alter table public.task_location_bulk_na_20260630  enable row level security;

do $$
declare
  -- The Master Admin service account. A bulk system operation should not be
  -- attributed to a real person; actorById() resolves this id through the
  -- org-wide people list, so the UI shows "Master Admin", not "Someone".
  v_actor uuid := '7c82f7b4-cb51-4304-89bc-5754c8f17cdc';
  -- One timestamp for every write, so completed_at / na_at / closed_at agree and
  -- the rollback can date itself off closed_at instead of a hand-typed literal.
  v_now   timestamptz := now();
  v_tasks int;
  v_locs  int;
begin
  -- Step 0: capture the target set BEFORE anything is modified.
  insert into public.task_bulk_close_20260630 (task_id, prior_status, prior_completed_at, closed_at)
  select t.id, t.status, t.completed_at, v_now
  from public.tasks t
  where t.status not in ('completed', 'shifted')
    and t.due_date <= date '2026-06-30'
  on conflict (task_id) do nothing;

  -- Step 1: resolve the location checklists that would otherwise block the update.
  -- trg_tasks_locations_gate raises if any task_locations row for the task has
  -- neither completed_at nor na_at. N/A is the truthful resolution: these locations
  -- were never visited because nobody was using the system yet.
  insert into public.task_location_bulk_na_20260630 (task_location_id)
  select tl.id
  from public.task_locations tl
  where tl.task_id in (select task_id from public.task_bulk_close_20260630)
    and tl.completed_at is null
    and tl.na_at is null
  on conflict (task_location_id) do nothing;

  update public.task_locations tl
  set na_at = v_now, na_by = v_actor
  where tl.id in (select task_location_id from public.task_location_bulk_na_20260630)
    and tl.completed_at is null
    and tl.na_at is null;
  get diagnostics v_locs = row_count;

  -- Step 2: close the tasks.
  -- The SET list is exactly these two columns. Do NOT add `description` --
  -- trg_tasks_description_mentions is scoped `UPDATE OF description` and would
  -- re-scan every task for @mentions and generate spurious notifications.
  -- updated_at is left to trg_tasks_updated.
  update public.tasks t
  set status = 'completed', completed_at = v_now
  where t.id in (select task_id from public.task_bulk_close_20260630)
    and t.status <> 'completed';
  get diagnostics v_tasks = row_count;

  -- Step 3: attribute the completion events that trg_tasks_activity_log just wrote.
  -- log_task_activity() stamps actor_id from auth.uid(), which is null outside a
  -- request context, and a null actor renders as the literal "Someone" in the UI.
  -- Scoped to actor_id is null so pre-existing legitimate rows are untouched.
  update public.task_activity a
  set actor_id = v_actor
  where a.type = 'completed'
    and a.actor_id is null
    and a.task_id in (select task_id from public.task_bulk_close_20260630);

  -- Step 4: the audit note, so the history explains itself rather than implying
  -- 638 tasks were genuinely worked. Inserted after step 2 so it sorts alongside
  -- the completion event on the task timeline.
  insert into public.task_activity (task_id, type, actor_id, note)
  select s.task_id,
         'remark',
         v_actor,
         'Bulk-closed by admin: pre-go-live backlog. This task was due on or before '
         || '30 Jun 2026; Task Management was adopted on 1 Jul 2026, so it was never '
         || 'actioned in the system.'
  from public.task_bulk_close_20260630 s
  where not exists (
    select 1 from public.task_activity a
    where a.task_id = s.task_id and a.type = 'remark' and a.created_at >= s.closed_at
  );

  raise notice 'pre-go-live backlog closed: % tasks, % location rows marked N/A', v_tasks, v_locs;
end $$;
