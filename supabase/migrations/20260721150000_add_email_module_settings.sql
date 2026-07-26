-- Email Alerts — per-module ON/OFF switch.
--
-- WHY
--   Email should only flow for a module an admin has explicitly enabled. Task
--   Management is the first; the same table will gate every FMS app later (one row
--   per module, keyed by the app's manifest id: 'task-management', 'import',
--   'procurement', 'hr-recruitment', 'hr-exit', 'office-supplies', ...).
--
-- WHAT
--   * public.email_module_settings — one row per module, `enabled` boolean.
--   * public.email_module_enabled(module) — the cheap check the enqueue uses.
--   * public.set_email_module_enabled(module, enabled) — admin-only write (the
--     Settings toggle calls this).
--   * Re-issues notify_task_assignee() and add_task_remark() so the EMAIL enqueue
--     is wrapped in `email_module_enabled('task-management')`. The bell notification
--     is UNCHANGED — only email is gated.
--
-- DEFAULT OFF: task-management is seeded disabled, so no email goes out until an
-- admin flips it on in Task Management → Settings. (The delivery infra stays on;
-- this is the business switch layered above it.)
--
-- Additive + reversible: drop the two new functions + table, then re-apply
-- 20260721140000_add_email_outbox_and_task_email.sql to restore the un-gated bodies.

-- ===========================================================================
-- 1. Settings table
-- ===========================================================================
create table if not exists public.email_module_settings (
  module_id  text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.email_module_settings enable row level security;

-- Anyone signed in may READ the flags (not sensitive; the UI shows the toggle state).
drop policy if exists email_module_settings_read on public.email_module_settings;
create policy email_module_settings_read on public.email_module_settings
  for select to authenticated using (true);
-- No direct writes — writes go through the admin-checked RPC below.

-- Seed the pilot module, OFF by default.
insert into public.email_module_settings (module_id, enabled)
values ('task-management', false)
on conflict (module_id) do nothing;

-- ===========================================================================
-- 2. Read helper (used by the enqueue path)
-- ===========================================================================
create or replace function public.email_module_enabled(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from public.email_module_settings where module_id = p_module),
    false
  );
$$;
grant execute on function public.email_module_enabled(text) to authenticated;

-- ===========================================================================
-- 3. Admin-only write (the Settings toggle calls this)
-- ===========================================================================
create or replace function public.set_email_module_enabled(p_module text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only admins can change email settings';
  end if;
  insert into public.email_module_settings (module_id, enabled, updated_at, updated_by)
  values (p_module, p_enabled, now(), auth.uid())
  on conflict (module_id) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.set_email_module_enabled(text, boolean) from public, anon;
grant execute on function public.set_email_module_enabled(text, boolean) to authenticated;

-- ===========================================================================
-- 4. Re-issue notify_task_assignee() — email enqueue now gated
-- ===========================================================================
create or replace function public.notify_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := coalesce(auth.uid(), new.created_by);
  v_notified uuid;
  v_email    text;
begin
  if new.assigned_to is null
     or new.assigned_to = new.created_by
     or new.assigned_to = v_actor
     or coalesce(new.is_personal, false)
     or coalesce(new.from_recurring, false)
     or new.recurring_task_id is not null
     or new.shifted_from_task_id is not null
  then
    return new;
  end if;

  begin
    insert into public.notifications (user_id, type, task_id, actor_id)
    select new.assigned_to, 'assigned', new.id, v_actor
    where not exists (
      select 1 from public.notifications n
      where n.user_id = new.assigned_to and n.task_id = new.id and n.type = 'assigned'
    )
    returning user_id into v_notified;
  exception when others then
    v_notified := null;
  end;

  -- Email only when a fresh notification was created AND email is enabled for the module.
  if v_notified is not null and public.email_module_enabled('task-management') then
    begin
      v_email := coalesce(
        (select nullif(btrim(p.email), '') from public.profiles p where p.id = v_notified),
        (select nullif(btrim(u.email), '') from auth.users  u where u.id = v_notified)
      );
      insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id)
      values ('task_assigned', v_notified, v_email, v_actor, new.id);
    exception when others then null;
    end;
  end if;

  return new;
end $$;

-- ===========================================================================
-- 5. Re-issue add_task_remark() — mention email enqueue now gated
-- ===========================================================================
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
  v_actor       uuid := auth.uid();
  v_activity_id uuid;
  v_uid         uuid;
  v_ins_uid     uuid;
  v_email       text;
  v_email_on    boolean;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'remark note must not be empty';
  end if;

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

  v_email_on := public.email_module_enabled('task-management');

  if p_mentioned is not null then
    foreach v_uid in array p_mentioned loop
      if v_uid is distinct from v_actor
         and exists (select 1 from public.profiles p where p.id = v_uid) then
        v_ins_uid := null;
        insert into public.notifications (user_id, type, task_id, activity_id, actor_id)
        select v_uid, 'mention', p_task_id, v_activity_id, v_actor
        where not exists (
          select 1 from public.notifications n
          where n.user_id = v_uid and n.activity_id = v_activity_id
        )
        returning user_id into v_ins_uid;

        if v_ins_uid is not null and v_email_on then
          begin
            v_email := coalesce(
              (select nullif(btrim(p.email), '') from public.profiles p where p.id = v_uid),
              (select nullif(btrim(u.email), '') from auth.users  u where u.id = v_uid)
            );
            insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
            values ('task_mention', v_uid, v_email, v_actor, p_task_id,
                    jsonb_build_object('note', p_note));
          exception when others then null;
          end;
        end if;
      end if;
    end loop;
  end if;

  return v_activity_id;
end;
$$;

revoke all on function public.add_task_remark(uuid, text, uuid[]) from public;
revoke execute on function public.add_task_remark(uuid, text, uuid[]) from anon;
grant execute on function public.add_task_remark(uuid, text, uuid[]) to authenticated;
