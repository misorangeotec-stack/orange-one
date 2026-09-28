-- ROLLBACK for 20261116120000 -- removes tasks.is_peer_assignment and un-teaches
-- shift_task_to_week about it.
--
-- 🔴 ROLL THE FRONTEND BACK FIRST, OR WITH IT. A frontend that reads the column
--    against a database without it does not fail loudly: the insert errors on
--    every Create Task, and the peer board goes blank. If the app is live, ship
--    the frontend revert before running this.
--
-- 🔴 THIS DESTROYS THE CLASSIFICATION, AND IT CANNOT BE REBUILT.
--    "Which HOD -> HOD tasks were peer work" exists ONLY in this column. It
--    cannot be re-derived afterwards, because the rule that would derive it
--    ("the creator is not above the assignee") also matches every admin -> HOD
--    task -- 183 of them as of 10-09-2026 -- which the client explicitly said is
--    ordinary downward work. That is the whole reason the flag was stamped
--    rather than computed.
--
--    Run this FIRST and keep the output if the tasks may ever need reinstating:
--
--      select id, title, created_by, assigned_to, week_start, created_at
--        from public.tasks
--       where is_peer_assignment
--       order by created_at;
--
--    The guard below refuses to run while any such row exists, so an accidental
--    rollback cannot quietly erase live peer work.
--
-- ⚠ NOTE THE ORDER: the function is restored BEFORE the column is dropped. The
--   other way round leaves a function body referencing a column that no longer
--   exists, which fails at the next reschedule rather than here.
--
-- 🟢 It puts NOTHING else back, because nothing else was taken. No policy, no
--    other function, and no row's data was touched by the forward migration.

begin;

-- ---------------------------------------------------------------------------
-- 0 · Refuse to destroy live classification.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_n bigint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'is_peer_assignment'
  ) then
    raise notice 'TM-1 rollback: the column is already gone -- nothing to do';
    return;
  end if;

  select count(*) into v_n from public.tasks where is_peer_assignment;
  if v_n > 0 then
    raise exception
      'TM-1 rollback: % task(s) are classified as peer work and would lose that permanently. Record them with the select in this file''s header, then comment out this guard.', v_n;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 1 · shift_task_to_week stops carrying the flag. Inverse of the forward
--     transform, and read back out of pg_proc for the same reason.
-- ---------------------------------------------------------------------------
do $fn$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shift_task_to_week';

  if v_src is null then
    raise exception 'TM-1 rollback 1: shift_task_to_week() is missing';
  end if;

  v_new := replace(
             replace(v_src,
               'shifted_from_task_id, from_recurring, is_peer_assignment)',
               'shifted_from_task_id, from_recurring)'),
             'p_task_id, v_task.from_recurring, v_task.is_peer_assignment)',
             'p_task_id, v_task.from_recurring)');

  if v_new = v_src then
    raise notice 'TM-1 rollback 1: shift_task_to_week does not mention the flag -- already reverted';
  else
    execute v_new;
  end if;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · The column.
-- ---------------------------------------------------------------------------
alter table public.tasks drop column if exists is_peer_assignment;

-- ---------------------------------------------------------------------------
-- 3 · Post-conditions: gone, and nothing else disturbed.
-- ---------------------------------------------------------------------------
do $post$
declare
  v_src text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'is_peer_assignment'
  ) then
    raise exception 'TM-1 rollback post 1: the column is still there';
  end if;

  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shift_task_to_week';
  if v_src like '%is_peer_assignment%' then
    raise exception 'TM-1 rollback post 2: shift_task_to_week still references the dropped column';
  end if;

  -- The two neighbours the forward migration deliberately did not touch.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks'
       and column_name in ('from_recurring', 'is_personal')
     having count(*) = 2
  ) then
    raise exception 'TM-1 rollback post 3: from_recurring / is_personal are not both intact';
  end if;
end
$post$;

commit;
