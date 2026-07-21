-- Email Alerts — step 1 of 2: the outbox + enqueue on the two Task Management
-- notification writers.
--
-- WHAT THIS DOES
--   * Adds public.email_outbox — a durable "emails to send" list (one row per
--     recipient per event). Nothing here SENDS mail; sending is a separate Edge
--     Function driven by the trigger/cron added in the companion migration
--     (20260721140100_add_email_dispatch.sql). Splitting enqueue from send is what
--     lets a mail outage never touch the task write, and gives us a record + retry.
--   * Re-issues public.notify_task_assignee() and public.add_task_remark() to ALSO
--     drop an outbox row whenever they insert a NEW bell notification — assigned
--     and @mention respectively. Everything else about those functions is carried
--     forward verbatim, so behaviour is unchanged except for the added enqueue.
--
-- WHY EMAIL IS ONLY ENQUEUED WHEN A NOTIFICATION IS ACTUALLY INSERTED
--   Both writers guard their insert with `where not exists (...)` (assigned: one
--   per task+user; mention: one per activity+user). We capture the inserted row
--   via `returning ... into` and enqueue email ONLY when a row came back, so a
--   re-fire (task edit, same mention twice) never re-emails. This mirrors the bell
--   exactly — email goes exactly where a new bell alert goes, and nowhere else.
--
-- WHY THE auth.users FALLBACK
--   profiles.email is the browser-readable mirror of the login address. If it was
--   ever left blank for a user, we fall back to the authoritative auth.users.email
--   (readable here because these are SECURITY DEFINER functions owned by postgres).
--   So no recipient is ever silently skipped for a missing profile mirror.
--
-- ISOLATION
--   Every email enqueue is wrapped in its own `begin ... exception when others
--   then null; end;` so an outbox problem can NEVER roll back the task insert or
--   the remark write. The work is the user's; the email about it is not.
--
-- Additive + reversible:
--   drop table if exists public.email_outbox;
--   -- then re-apply 20260721120100_notify_task_assignee.sql and
--   -- db/migrations/0001_add_task_remark_rpc.sql to restore the originals.

-- ===========================================================================
-- 1. The outbox
-- ===========================================================================
create table if not exists public.email_outbox (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                       -- 'task_assigned' | 'task_mention'
  to_user_id  uuid not null,                       -- recipient (profiles.id / auth.users.id)
  to_email    text,                                -- resolved at enqueue; null => sender marks 'skipped'
  actor_id    uuid,                                -- who caused it (for reply-to + "by X")
  entity_id   uuid,                                -- the task id
  payload     jsonb not null default '{}'::jsonb,  -- e.g. { "note": "<remark text>" }
  subject     text,                                -- filled by the sender when it goes out
  status      text not null default 'pending',     -- pending | sending | sent | failed | skipped
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- The sender polls this to find work; the partial index keeps that cheap.
create index if not exists email_outbox_due_idx
  on public.email_outbox (created_at)
  where status in ('pending', 'failed');

-- Writes only ever happen through the SECURITY DEFINER functions below and reads
-- only through the service-role sender, so lock the table to the client entirely.
alter table public.email_outbox enable row level security;
-- (No policies => no anon/authenticated access. Service role bypasses RLS.)

-- ===========================================================================
-- 2. Assigned → email (re-issue notify_task_assignee, body carried forward)
-- ===========================================================================
create or replace function public.notify_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := coalesce(auth.uid(), new.created_by);
  v_notified uuid;   -- set to the recipient iff a NEW 'assigned' notification was inserted
  v_email    text;
begin
  -- (unchanged) exclusion rules — see 20260721120100 for the full rationale.
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

  -- (unchanged) the notification insert, isolated so it can never roll back the
  -- task. Now also captures whether a row was actually inserted.
  begin
    insert into public.notifications (user_id, type, task_id, actor_id)
    select new.assigned_to, 'assigned', new.id, v_actor
    where not exists (
      select 1 from public.notifications n
      where n.user_id = new.assigned_to
        and n.task_id = new.id
        and n.type = 'assigned'
    )
    returning user_id into v_notified;
  exception when others then
    v_notified := null;
  end;

  -- (new) enqueue one email, only when a fresh notification was created.
  if v_notified is not null then
    begin
      v_email := coalesce(
        (select nullif(btrim(p.email), '') from public.profiles p where p.id = v_notified),
        (select nullif(btrim(u.email), '') from auth.users  u where u.id = v_notified)
      );
      insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id)
      values ('task_assigned', v_notified, v_email, v_actor, new.id);
    exception when others then
      null;
    end;
  end if;

  return new;
end $$;

-- ===========================================================================
-- 3. @mention → email (re-issue add_task_remark, body carried forward)
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
  v_ins_uid     uuid;   -- set when a NEW 'mention' notification was inserted this iteration
  v_email       text;
begin
  if v_actor is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(btrim(p_note), '') = '' then
    raise exception 'remark note must not be empty';
  end if;

  -- (unchanged) same visibility rule as the tasks SELECT policy.
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

  -- (unchanged) fan out a mention notification to each mentioned, real, non-author
  -- user, de-duplicated by activity. (new) also enqueue one email per fresh row.
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

        if v_ins_uid is not null then
          begin
            v_email := coalesce(
              (select nullif(btrim(p.email), '') from public.profiles p where p.id = v_uid),
              (select nullif(btrim(u.email), '') from auth.users  u where u.id = v_uid)
            );
            insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
            values ('task_mention', v_uid, v_email, v_actor, p_task_id,
                    jsonb_build_object('note', p_note));
          exception when others then
            null;
          end;
        end if;
      end if;
    end loop;
  end if;

  return v_activity_id;
end;
$$;

-- Grants are unchanged from the originals (create-or-replace keeps them), but
-- re-state add_task_remark's tightened grants for defence-in-depth.
revoke all on function public.add_task_remark(uuid, text, uuid[]) from public;
revoke execute on function public.add_task_remark(uuid, text, uuid[]) from anon;
grant execute on function public.add_task_remark(uuid, text, uuid[]) to authenticated;
