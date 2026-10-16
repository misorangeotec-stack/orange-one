-- Reverses 20270130120000_kra_director_tasks.sql.
-- ⚠ Refuses while any Director KRA task exists: dropping kra_open would turn them
--   into ordinary tasks silently. Decide what they become first.

do $assert$
begin
  if exists (select 1 from public.tasks where kra_open) then
    raise exception 'Rollback: Director KRA tasks exist (tasks.kra_open) -- decide what they become first';
  end if;
end
$assert$;

begin;

drop index if exists public.tasks_kra_open_awaiting_idx;

-- guard_task_kra exactly as it was live before 20270130120000.
CREATE OR REPLACE FUNCTION public.guard_task_kra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

drop function if exists public.is_director(uuid);

alter table public.tasks
  drop column if exists kra_reviewer_id,
  drop column if exists kra_open;

commit;
