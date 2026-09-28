-- TM-1 · A HOD can assign a one-off task to another HOD, and that work is scored on its own.
--
-- WHY
--   Today a HOD can only hand work DOWN their own tree. The client asked (07-09-2026) for a HOD to
--   be able to give a one-off task to ANOTHER HOD, and for that peer-to-peer work to be scored in a
--   block of its own rather than folded into either person's team numbers.
--
--   The database ALREADY permits a HOD -> HOD task: tasks_insert is `created_by = auth.uid()` and
--   nothing else, and select/update/delete all carry `assigned_to = uid` / `created_by = uid` arms.
--   notify_task_assignee() is hierarchy-agnostic and already notifies. So this is NOT a permissions
--   build. It needs one thing the database cannot infer: a durable marker saying "a HOD chose
--   another HOD from the peer picker".
--
-- WHY A STAMPED FLAG AND NOT A DERIVED RULE
--   🔴 The obvious derived rule -- "the creator is not above the assignee" -- is WRONG here, and the
--      client's own words are what kill it. An admin handing a task to a HOD is ORDINARY DOWNWARD
--      WORK, never peer work ("in the future as well these kinds of tasks will again come"). That
--      shape already exists 183 times as of 10-09-2026, up 49 in three days. A derived rule matches
--      all 183 perfectly and would sweep up every future one -- the exact opposite of the ask.
--      Only a flag stamped at creation can tell the two apart.
--   🔴 The hierarchy is also MUTABLE. user_hods rows are edited from the admin User form, so a
--      derived rule would silently reclassify a year of history and move numbers in weeks that were
--      signed off months ago.
--
--   The module already took this decision once and wrote down the reasoning -- tasks.from_recurring
--   is the same shape: "stamped at generation time and never cleared". This is its twin.
--
-- WHAT CHANGES
--   1. tasks gains `is_peer_assignment boolean not null default false`.
--   2. shift_task_to_week() carries that flag onto the continuation task it creates.
--
--   Nothing else. No policy is touched. hod_downline(), is_hod_of() and user_hods are UNTOUCHED,
--   deliberately -- a peer grant is a LATERAL edge, and mapping HOD B under HOD A would hand A
--   B's entire downline to read, assign, score and plan for, retroactively.
--
-- 🟢 NOTHING ALREADY REPORTED MOVES. default false + NO BACKFILL, ever. The 183 admin -> HOD tasks
--    stay exactly where they are, scored the way they were scored last week. There are ZERO
--    HOD -> HOD tasks in the database today, so on the day this ships not one number changes.
--    If the client ever wants those reclassified that is a separate, deliberate backfill -- and one
--    that must carry the ORIGINAL dates rather than now(), or it corrupts the Master Report.
--
-- ⚠ WHY shift_task_to_week IS AMENDED, when the brief said "one column, nothing else".
--    A forward reschedule does not move a task. It marks the old one 'shifted' and INSERTS A FRESH
--    COPY for the new week, copying from_recurring by name. A new column would default to false on
--    that copy, so the moment a receiver pushed a peer task to next week it would silently become
--    their own ordinary one-off work and land in their own weekly RYG -- the one outcome the client
--    ruled out. The insert here is the same precedent from_recurring already set.
--
-- ⚠ THE CONTINUATION'S CREATOR BECOMES THE SHIFTER, AND THAT CANNOT BE HELPED.
--    This function is NOT security definer, so it runs as the caller and tasks_insert's
--    `with check (created_by = auth.uid())` forces v_actor. Carrying the ORIGINAL creator across
--    would be refused by RLS. The frontend therefore defines the "Given" peer board as
--    peer AND created-by-me AND NOT assigned-to-me, so a receiver's own continuation stays on their
--    Received board and never appears as something they handed out.
--
-- 🟢 EVERY OTHER SERVER-SIDE READER IS DELIBERATELY LEFT ALONE, having been checked:
--      * generate_recurring_tasks / generate_recurring_task_now -- peer recurring is out of scope
--        for round one, so a default of false is correct there.
--      * user_snapshot() and the work-snapshot bundle -- a WORKLIST. Peer work is work the receiver
--        owes, so it must keep showing as due. The two cross-check each other (work-snapshot carries
--        SQL's count as `tasks_sql` precisely to catch drift), so if an exclusion is ever added to
--        one it MUST be added to both.
--      * master_report_snapshot() / user_module_usage() -- ADOPTION and USAGE reports, not scores.
--        They already count personal and not-applicable rows. A peer task is genuine human usage
--        and should count.
--      * notify_description_mentions() -- an @mention inside a peer task should notify. It does.
--
-- ⚠ DEPLOY ORDERING: apply this BEFORE the frontend that reads the column, per the repo rule.
--    The reverse order is harmless here (the frontend maps a missing column to false), but the
--    stamp would be silently dropped on every task created in the gap.
--
-- Reversal: 20261116120000_tm1_a_hod_can_assign_to_another_hod_rollback.sql
--   (it restores the function FIRST, then drops the column -- not the other way round).

-- ---------------------------------------------------------------------------
-- 0 · Pre-conditions. ABOVE the DDL on purpose: a check that runs after the
--     ALTER holds ACCESS EXCLUSIVE on tasks for its whole duration.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_n bigint;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'shift_task_to_week'
  ) then
    raise exception 'TM-1 pre 1: shift_task_to_week() is missing -- this migration amends it and cannot';
  end if;

  -- Safe to re-run, but never over rows that already carry the flag.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'is_peer_assignment'
  ) then
    execute 'select count(*) from public.tasks where is_peer_assignment' into v_n;
    if v_n > 0 then
      raise exception 'TM-1 pre 2: % task(s) already carry is_peer_assignment -- this has run and been used', v_n;
    end if;
  end if;
end
$assert$;

begin;

-- ---------------------------------------------------------------------------
-- 1 · The column. Additive, defaulted, never backfilled.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists is_peer_assignment boolean not null default false;

comment on column public.tasks.is_peer_assignment is
  'TM-1: true when a HOD assigned this one-off task to ANOTHER HOD from the peer picker. Stamped at creation and never cleared -- the twin of from_recurring. Scored in the peer block ONLY, and excluded from the assignee''s own weekly RYG. An ADMIN assigning to a HOD is ordinary downward work and must NEVER set this (the admin picker has no peer group, so it cannot). Never backfilled.';

-- ---------------------------------------------------------------------------
-- 2 · shift_task_to_week carries the flag onto the continuation task.
--     The body is read back out of pg_proc and transformed, never retyped -- so
--     this cannot silently revert an unrelated change made since.
-- ---------------------------------------------------------------------------
do $fn$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shift_task_to_week';

  v_new := replace(
             replace(v_src,
               'shifted_from_task_id, from_recurring)',
               'shifted_from_task_id, from_recurring, is_peer_assignment)'),
             'p_task_id, v_task.from_recurring)',
             'p_task_id, v_task.from_recurring, v_task.is_peer_assignment)');

  if v_new = v_src then
    raise exception 'TM-1 step 2: the insert in shift_task_to_week did not match the expected shape -- read the live body and update this transform rather than forcing it';
  end if;

  execute v_new;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · Post-conditions.
-- ---------------------------------------------------------------------------
do $post$
declare
  v_src  text;
  v_n    bigint;
  v_flag bigint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks'
       and column_name = 'is_peer_assignment'
       and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'TM-1 post 1: is_peer_assignment is missing, nullable, or not defaulted to false';
  end if;

  select count(*) into v_flag from public.tasks where is_peer_assignment;
  if v_flag <> 0 then
    raise exception 'TM-1 post 2: % task(s) carry the flag -- nothing may be backfilled', v_flag;
  end if;

  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'shift_task_to_week';
  if v_src not like '%is_peer_assignment)%' or v_src not like '%v_task.is_peer_assignment)%' then
    raise exception 'TM-1 post 3: shift_task_to_week does not carry the flag onto the continuation';
  end if;

  -- The shape this task exists to enable must still be countable, and the shape it must NEVER
  -- touch must be unchanged. 183 admin -> HOD tasks as of 10-09-2026; the count may legitimately
  -- grow, so this only proves none of them acquired the flag (post 2 already did) and that the
  -- join still resolves.
  select count(*) into v_n
    from public.tasks t
    join public.user_roles ra on ra.user_id = t.assigned_to and ra.role = 'hod'
    join public.user_roles rc on rc.user_id = t.created_by and rc.role = 'admin';
  raise notice 'TM-1: % admin -> HOD tasks, all still scored as ordinary downward work', v_n;
end
$post$;

commit;
