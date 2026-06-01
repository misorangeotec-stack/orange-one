-- Stage B / B4 — @mention remarks + notification fan-out.
--
-- The `notifications` table has RLS enabled with only SELECT/UPDATE policies
-- (no INSERT), so the anon/authenticated client cannot insert notification rows
-- directly. This SECURITY DEFINER function performs the whole remark write
-- atomically and bypasses RLS for the notification fan-out + last_remark_at bump,
-- while still guarding access with the same visibility rule as the tasks SELECT
-- policy (so a caller can only comment on tasks they can see).
--
-- Additive + reversible: `drop function public.add_task_remark(uuid, text, uuid[]);`
--
-- Returns the new task_activity row id (the remark).

create or replace function public.add_task_remark(
  p_task_id uuid,
  p_note text,
  p_mentioned uuid[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_activity_id uuid;
  v_uid uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'remark note must not be empty';
  end if;

  -- Mirror the tasks SELECT policy: only let the caller comment on a task they
  -- can actually see (assignee, creator, admin, HOD of assignee, HOD of creator).
  if not exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (
        t.assigned_to = v_actor
        or t.created_by = v_actor
        or public.is_admin(v_actor)
        or (t.assigned_to is not null and public.is_hod_of(v_actor, t.assigned_to))
        or (t.created_by is not null and public.is_hod_of(v_actor, t.created_by))
      )
  ) then
    raise exception 'not allowed to comment on this task';
  end if;

  insert into public.task_activity (task_id, type, actor_id, note)
  values (p_task_id, 'remark', v_actor, p_note)
  returning id into v_activity_id;

  update public.tasks set last_remark_at = now() where id = p_task_id;

  -- Fan out a notification to each mentioned user that exists and isn't the
  -- author. De-duplicated so the same user mentioned twice gets one notice.
  if p_mentioned is not null then
    foreach v_uid in array p_mentioned loop
      if v_uid is distinct from v_actor
         and exists (select 1 from public.profiles p where p.id = v_uid) then
        insert into public.notifications (user_id, type, task_id, activity_id, actor_id)
        select v_uid, 'mention', p_task_id, v_activity_id, v_actor
        where not exists (
          select 1 from public.notifications n
          where n.user_id = v_uid and n.activity_id = v_activity_id
        );
      end if;
    end loop;
  end if;

  return v_activity_id;
end;
$$;

-- Only authenticated users may call it; revoke the default public/anon grants
-- (anon has no auth.uid() so it would be rejected anyway — this is defense-in-depth).
revoke all on function public.add_task_remark(uuid, text, uuid[]) from public;
revoke execute on function public.add_task_remark(uuid, text, uuid[]) from anon;
grant execute on function public.add_task_remark(uuid, text, uuid[]) to authenticated;
