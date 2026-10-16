-- ===========================================================================
-- DIRECTOR KRA TASKS — a Director gives a task as "KRA" without choosing which
-- KRA; the KRA is picked later by the person who knows the work.
--
-- THE RULE (client, 14-10-2026)
--   * On Create Task a Director (admin + designation "Director": Karan Toshniwal
--     and Aayush Rathi today) gets a Task category with two options: Others, or
--     KRA. No list of KRAs.
--   * Whoever does the task picks, at "Mark complete", which of THEIR OWN KRAs
--     it belongs to — completing is refused until they do.
--   * Given to a HOD or Sub-HOD: the 1-10 review then goes to the Director who
--     gave it.
--   * Given to an employee: the review goes to their DIRECT HOD, who sees the
--     KRA the employee picked and may change it before rating. The HOD's review
--     is final.
--   * Once the KRA is picked the task is an ordinary KRA task: weights are
--     snapshotted then, score = C + (rating/10) × (W − C).
--
-- COLUMNS
--   tasks.kra_open        true = given as "KRA" by a Director; kra_id stays null
--                         until the assignee picks it at completion.
--   tasks.kra_reviewer_id who gives the 1-10 review. Null = the assignee's
--                         direct HOD (every KRA task until now, and the employee
--                         path here). The Director, on the HOD / Sub-HOD path.
--   Both are stamped by the trigger at insert and never change afterwards.
--
-- ⚠ guard_task_kra IS REPLACED WHOLE, not text-patched: the change touches
--   every branch. The body below is the live one (20270107130000 + the
--   20270123120000 recurring exception) with the Director paths added; the
--   assert refuses to run if the live body is not that one. The rollback puts
--   the previous body back verbatim.
--
-- ⚠ A SHIFT KEEPS IT. shift_task_to_week copies kra_id only; the guard fills a
--   continuation's kra_open / kra_reviewer_id / weights from its source, so the
--   function itself is not touched.
--
-- Additive: two columns (one with a default), one helper, one function
-- replaced. No existing row changes meaning (kra_open false, reviewer null).
-- Reversal: 20270130120000_kra_director_tasks_rollback.sql
-- ===========================================================================

do $assert$
declare
  v_src text;
begin
  select pg_get_functiondef('public.guard_task_kra'::regproc) into v_src;
  if position('rt.created_by = new.created_by' in v_src) = 0 or position('kra_open' in v_src) > 0 then
    raise exception 'Director KRA pre 1: guard_task_kra is not the 20270123120000 body -- read the live body before replacing it';
  end if;
  if to_regprocedure('public.has_role(uuid, app_role)') is null then
    raise exception 'Director KRA pre 2: has_role(uuid, app_role) is missing';
  end if;
end
$assert$;

begin;

-- ---------------------------------------------------------------------------
-- 1 · Columns.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists kra_open boolean not null default false,
  add column if not exists kra_reviewer_id uuid references auth.users on delete set null;

comment on column public.tasks.kra_open is
  'Given as "KRA" by a Director without choosing the KRA. kra_id stays null until it is picked: by the assignee before completing (HOD / Sub-HOD), or by their direct HOD at review (employee).';
comment on column public.tasks.kra_reviewer_id is
  'Who gives the 1-10 KRA review. Null = the assignee''s direct HOD. Set to the Director on a Director KRA task given to a HOD / Sub-HOD. Stamped at insert, never changed.';

-- ---------------------------------------------------------------------------
-- 2 · Who is a Director: an admin whose designation (the master) is Director.
-- ---------------------------------------------------------------------------
create or replace function public.is_director(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user, 'admin')
     and exists (
       select 1 from public.profiles p
         join public.designations d on d.id = p.designation_id
        where p.id = _user and lower(trim(d.name)) = 'director'
     );
$$;

revoke all on function public.is_director(uuid) from public;
grant execute on function public.is_director(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · The guard, with the Director paths.
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
  v_reviewer uuid;
begin
  if tg_op = 'INSERT' then
    -- Review fields are never born filled in.
    new.review_rating := null;
    new.reviewed_by   := null;
    new.reviewed_at   := null;

    -- A forward reschedule's continuation keeps its source's KRA, weights and
    -- Director path, whoever does the shifting.
    if new.shifted_from_task_id is not null then
      select * into v_src from public.tasks where id = new.shifted_from_task_id;
      if found and (v_src.kra_open or (new.kra_id is not null and v_src.kra_id = new.kra_id)) then
        new.kra_id := v_src.kra_id;
        new.kra_weight := v_src.kra_weight;
        new.kra_completion_weight := v_src.kra_completion_weight;
        new.kra_open := v_src.kra_open;
        new.kra_reviewer_id := v_src.kra_reviewer_id;
        return new;
      end if;
    end if;

    -- Director KRA task: category "KRA", the KRA itself picked later.
    if new.kra_open then
      if new.is_personal then
        raise exception 'A personal task cannot be given as a KRA task.';
      end if;
      if v_uid is not null and not public.is_director(v_uid) then
        raise exception 'Only a Director can give a KRA task without choosing the KRA.';
      end if;
      new.kra_id := null;
      new.kra_weight := null;
      new.kra_completion_weight := null;
      -- HOD / Sub-HOD: they pick their own KRA, the Director reviews.
      -- Anyone else: their direct HOD picks and reviews (reviewer null).
      new.kra_reviewer_id := case
        when new.assigned_to is not null
         and (public.has_role(new.assigned_to, 'hod') or public.has_role(new.assigned_to, 'sub_hod'))
        then coalesce(v_uid, new.created_by)
        else null
      end;
      return new;
    end if;

    new.kra_reviewer_id := null;

    if new.kra_id is null then
      new.kra_weight := null;
      new.kra_completion_weight := null;
      return new;
    end if;

    if new.is_personal then
      raise exception 'A personal task cannot be given against a KRA.';
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
    if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to)
       and not exists (select 1 from public.recurring_tasks rt
                        where rt.id = new.recurring_task_id and rt.kra_id = new.kra_id
                          and rt.created_by = new.created_by) then
      raise exception 'Only this employee''s own HOD can give a KRA task.';
    end if;

    new.kra_weight := v_kra.weight;
    new.kra_completion_weight := v_kra.completion_weight;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------
  if v_uid is not null and (
       new.kra_open is distinct from old.kra_open
    or new.kra_reviewer_id is distinct from old.kra_reviewer_id
  ) then
    raise exception 'The KRA on a task is fixed when it is given and cannot be changed.';
  end if;

  -- The KRA on a Director KRA task: picked by the assignee (once, at
  -- completion); on the employee path their direct HOD may change it at review.
  if old.kra_open and new.kra_id is distinct from old.kra_id then
    if new.kra_id is null then
      raise exception 'A KRA task needs its KRA; pick another one instead.';
    end if;
    if v_uid is not null
       and not (old.kra_id is null and v_uid = old.assigned_to)
       and not (old.kra_reviewer_id is null and new.status = 'completed'
                and public.is_direct_hod_of(v_uid, old.assigned_to)) then
      raise exception '%', case
        when old.kra_id is null then 'Only the person doing this task picks its KRA.'
        when old.kra_reviewer_id is not null then 'The KRA is fixed once it is picked.'
        else 'Only this employee''s own HOD can change the KRA, at review.' end;
    end if;
    select * into v_kra from public.org_kras where id = new.kra_id;
    if not found then
      raise exception 'That KRA no longer exists.';
    end if;
    if v_kra.profile_id is distinct from old.assigned_to then
      raise exception 'That KRA belongs to a different employee.';
    end if;
    if not v_kra.active then
      raise exception 'That KRA is switched off.';
    end if;
    new.kra_weight := v_kra.weight;
    new.kra_completion_weight := v_kra.completion_weight;
  elsif v_uid is not null and (
       new.kra_id is distinct from old.kra_id
    or new.kra_weight is distinct from old.kra_weight
    or new.kra_completion_weight is distinct from old.kra_completion_weight
  ) then
    raise exception 'The KRA on a task is fixed when it is given and cannot be changed.';
  end if;

  if v_uid is not null and (old.kra_id is not null or old.kra_open)
     and new.assigned_to is distinct from old.assigned_to then
    raise exception 'The KRA on a task is fixed when it is given and cannot be changed.';
  end if;

  -- Who reviews this task.
  v_reviewer := old.kra_reviewer_id;

  if new.status <> 'completed' then
    -- Leaving completed (reopen) wipes the review. Once it is rated, only the
    -- reviewer may reopen it — otherwise reopen + complete would erase a
    -- rating the employee did not like.
    if old.review_rating is not null and v_uid is not null
       and not (case when v_reviewer is not null then v_uid = v_reviewer
                     else public.is_direct_hod_of(v_uid, old.assigned_to) end) then
      raise exception 'This task has been reviewed; only the reviewer can reopen it.';
    end if;
    new.review_rating := null;
    new.reviewed_by   := null;
    new.reviewed_at   := null;
    return new;
  end if;

  -- The KRA must be picked before the task is completed (both paths).
  if v_uid is not null and old.status <> 'completed'
     and new.kra_open and new.kra_id is null then
    raise exception 'Pick which of your KRAs this task belongs to before marking it complete.';
  end if;

  if new.review_rating is distinct from old.review_rating then
    if new.kra_id is null then
      raise exception '%', case when new.kra_open
        then 'Pick which KRA this task belongs to before rating it.'
        else 'Only a KRA task is reviewed.' end;
    end if;
    if v_uid is not null and not (case when v_reviewer is not null then v_uid = v_reviewer
                                       else public.is_direct_hod_of(v_uid, new.assigned_to) end) then
      raise exception '%', case when v_reviewer is not null
        then 'Only the Director who gave this task can review it.'
        else 'Only this employee''s own HOD can review a KRA task.' end;
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

create index if not exists tasks_kra_open_awaiting_idx
  on public.tasks (kra_reviewer_id)
  where kra_open and status = 'completed' and review_rating is null;

commit;
