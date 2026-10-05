-- ===========================================================================
-- KRA TASKS — a HOD gives a task against one of their direct report's KRAs,
-- and reviews it once it is done.
--
-- THE RULE (client, 05-10-2026)
--   * Create Task has a "Task Category": Others (the ordinary task, unchanged)
--     or one of the assignee's KRAs from Admin → Organisation → KRA Details.
--   * The task is worth the KRA's Wt% (W), split per KRA on KRA Details into
--     C "on completion" + (W - C) "on HOD review" — half and half unless
--     management moved it (e.g. 20% = 15 + 5).
--   * Completing it earns C. It then waits for the HOD, who rates it 1-10; the
--     rating earns that share of the rest:  score = C + (rating/10) × (W - C).
--       Learning & Development 40% (20+20), rating 3  →  20 + 6   = 26%.
--       A 10% KRA (5+5), rating 3                    →   5 + 1.5 = 6.5%.
--       A 20% KRA (15+5), rating 3                   →  15 + 1.5 = 16.5%.
--   * Late completion still earns the full completion share; lateness is the HOD's
--     call at review, through the rating.
--   * ONLY THE EMPLOYEE'S OWN HOD — a direct row in user_hods, NOT anyone
--     further up the chain and NOT an admin as such — may give a KRA task or
--     review one. Nobody else may see that person's KRAs.
--
-- ⚠ NO NEW task_status VALUE. "Awaiting review" is
--     status = 'completed' AND kra_id IS NOT NULL AND review_rating IS NULL.
--   A new enum value would reach ~25 places in the frontend, four SQL
--   functions, the KPI facts and the work snapshot, and every RYG would count it
--   red. Kept as columns, every existing scorecard reads a KRA task exactly as
--   it reads any other completed task.
--
-- ⚠ kra_weight AND kra_completion_weight ARE SNAPSHOTS. HR may change a KRA's
--   Wt% or its split next quarter; a task reviewed last month must keep the
--   weights it was given under.
--
-- ⚠ THE GUARD IS A TRIGGER, NOT A POLICY. tasks_update lets the assignee,
--   the creator and every upline HOD write ANY column. Without the trigger an
--   employee could rate their own task 10/10 from the browser console.
--
-- ⚠ shift_task_to_week() IS AMENDED, as TM-1 did for is_peer_assignment: a
--   forward reschedule inserts a fresh copy, which would otherwise drop the KRA.
--   The continuation is inserted by whoever shifted it — often the employee —
--   so the guard lets a continuation keep its source task's KRA and weight.
--
-- ⚠ org_kras SELECT IS NARROWED from everyone to: admin (the Organisation
--   screen), the employee themself, and their direct HOD(s).
--
-- Additive: six nullable columns, one trigger, one policy replaced, one
-- function body patched. No existing row changes.
-- Reversal: 20270106130000_kra_tasks_rollback.sql
-- ===========================================================================

do $assert$
begin
  if to_regclass('public.org_kras') is null then
    raise exception 'KRA tasks pre 1: org_kras is missing -- run 20270106120000_org_kras.sql first';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'shift_task_to_week'
  ) then
    raise exception 'KRA tasks pre 2: shift_task_to_week() is missing -- this migration amends it';
  end if;
end
$assert$;

begin;

-- ---------------------------------------------------------------------------
-- 1 · Columns.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists kra_id        uuid references public.org_kras on delete restrict,
  add column if not exists kra_weight    numeric(5,2),
  add column if not exists kra_completion_weight numeric(5,2),
  add column if not exists review_rating smallint check (review_rating between 1 and 10),
  add column if not exists reviewed_by   uuid references auth.users on delete set null,
  add column if not exists reviewed_at   timestamptz;

comment on column public.tasks.kra_id is
  'The assignee''s KRA this task was given against (Task Category). Null = "Others", the ordinary task. Only the assignee''s direct HOD may set it, at creation; never changed afterwards.';
comment on column public.tasks.kra_weight is
  'Snapshot of org_kras.weight when the task was given. The task is worth this much: kra_completion_weight on completion, the rest scaled by review_rating/10.';
comment on column public.tasks.kra_completion_weight is
  'Snapshot of org_kras.completion_weight when the task was given: the part of kra_weight earned by completing it.';
comment on column public.tasks.review_rating is
  'HOD''s 1-10 rating of a completed KRA task. Null while awaiting review. Cleared whenever the task leaves completed.';

create index if not exists tasks_kra_awaiting_review_idx
  on public.tasks (assigned_to)
  where kra_id is not null and status = 'completed' and review_rating is null;

-- ---------------------------------------------------------------------------
-- 2 · Is this user the employee's DIRECT HOD? Not transitive, on purpose.
-- ---------------------------------------------------------------------------
create or replace function public.is_direct_hod_of(_hod uuid, _employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_hods where hod_id = _hod and employee_id = _employee);
$$;

revoke all on function public.is_direct_hod_of(uuid, uuid) from public;
grant execute on function public.is_direct_hod_of(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · The guard.
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_kra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();   -- null for the service role / cron: trusted
  v_kra  public.org_kras%rowtype;
  v_src  public.tasks%rowtype;
begin
  if tg_op = 'INSERT' then
    -- Review fields are never born filled in.
    new.review_rating := null;
    new.reviewed_by   := null;
    new.reviewed_at   := null;

    if new.kra_id is null then
      new.kra_weight := null;
      new.kra_completion_weight := null;
      return new;
    end if;

    if new.is_personal then
      raise exception 'A personal task cannot be given against a KRA.';
    end if;

    -- A forward reschedule's continuation keeps its source's KRA and weight,
    -- whoever does the shifting.
    if new.shifted_from_task_id is not null then
      select * into v_src from public.tasks where id = new.shifted_from_task_id;
      if found and v_src.kra_id = new.kra_id then
        new.kra_weight := v_src.kra_weight;
        new.kra_completion_weight := v_src.kra_completion_weight;
        return new;
      end if;
    end if;

    select * into v_kra from public.org_kras where id = new.kra_id;
    if not found then
      raise exception 'That KRA no longer exists.';
    end if;
    if v_kra.profile_id is distinct from new.assigned_to then
      raise exception 'That KRA belongs to a different employee.';
    end if;
    if not v_kra.active then
      raise exception 'That KRA is switched off.';
    end if;
    if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to) then
      raise exception 'Only this employee''s own HOD can give a KRA task.';
    end if;

    new.kra_weight := v_kra.weight;
    new.kra_completion_weight := v_kra.completion_weight;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------
  if v_uid is not null and (
       new.kra_id is distinct from old.kra_id
    or new.kra_weight is distinct from old.kra_weight
    or new.kra_completion_weight is distinct from old.kra_completion_weight
    or (old.kra_id is not null and new.assigned_to is distinct from old.assigned_to)
  ) then
    raise exception 'The KRA on a task is fixed when it is given and cannot be changed.';
  end if;

  if new.status <> 'completed' then
    -- Leaving completed (reopen) wipes the review. Once a HOD has rated it,
    -- only that HOD may reopen it — otherwise reopen + complete would erase a
    -- rating the employee did not like.
    if old.review_rating is not null and v_uid is not null
       and not public.is_direct_hod_of(v_uid, old.assigned_to) then
      raise exception 'This task has been reviewed; only the HOD can reopen it.';
    end if;
    new.review_rating := null;
    new.reviewed_by   := null;
    new.reviewed_at   := null;
    return new;
  end if;

  if new.review_rating is distinct from old.review_rating then
    if new.kra_id is null then
      raise exception 'Only a KRA task is reviewed.';
    end if;
    if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to) then
      raise exception 'Only this employee''s own HOD can review a KRA task.';
    end if;
    new.reviewed_by := case when new.review_rating is null then null else v_uid end;
    new.reviewed_at := case when new.review_rating is null then null else now() end;
  else
    -- Stamps follow the rating; they are never written on their own.
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_guard_kra on public.tasks;
create trigger trg_tasks_guard_kra
  before insert or update on public.tasks
  for each row execute function public.guard_task_kra();

-- ---------------------------------------------------------------------------
-- 4 · Who may read a KRA: admin, the employee, their direct HOD(s).
-- ---------------------------------------------------------------------------
drop policy if exists org_kras_select on public.org_kras;
create policy org_kras_select on public.org_kras
  for select to authenticated
  using (
    (select public.is_admin((select auth.uid())))
    or profile_id = (select auth.uid())
    or public.is_direct_hod_of((select auth.uid()), profile_id)
  );

-- ---------------------------------------------------------------------------
-- 5 · shift_task_to_week carries the KRA onto the continuation task.
--     Read back out of pg_proc and transformed, never retyped (TM-1's method).
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
               'from_recurring, is_peer_assignment)',
               'from_recurring, is_peer_assignment, kra_id)'),
             'v_task.from_recurring, v_task.is_peer_assignment)',
             'v_task.from_recurring, v_task.is_peer_assignment, v_task.kra_id)');

  if v_new = v_src then
    raise exception 'KRA tasks step 5: the insert in shift_task_to_week did not match the expected shape -- read the live body and update this transform rather than forcing it';
  end if;

  execute v_new;
end
$fn$;

commit;
