-- @mention tagging in a task's DESCRIPTION -> bell notification + email.
--
-- WHY A TRIGGER, NOT A CLIENT CALL
-- --------------------------------
-- Remarks fan out inside the `add_task_remark` SECURITY DEFINER RPC. Descriptions have no such
-- hook: they are written by plain client INSERT/UPDATE (taskWrites.ts insertTask / updateTask),
-- and `notifications` has no client INSERT policy by design. The same argument the
-- notify_task_assignee header makes (20260721120100:9-19) applies here: a trigger sees EVERY
-- path that writes a description -- insertTask, updateTask, shift_task_to_week, both
-- generate_recurring_* functions -- and is atomic with the write, so a task can never end up
-- committed with the tagged person silently never told.
--
-- ADDITIVE ONLY
-- -------------
-- CREATE FUNCTION x2 (both new names), CREATE TRIGGER x1, GRANT. No ALTER TABLE, no DROP, no
-- DELETE, no UPDATE of any existing row. At runtime this only ever INSERTs into `notifications`
-- and `email_outbox`; task descriptions are read, never rewritten.

begin;

-- ---------------------------------------------------------------------------
-- 1. Resolve "@Full Name" occurrences in free text to profile ids.
--
-- Mentions are stored as PLAIN TEXT (`@Ravi Kumar`) -- there is no marker syntax and no embedded
-- uuid anywhere in this app, which is why descriptions stay safe to render raw in the task table,
-- dashboard, My Work and the xlsx export.
--
-- LONGEST NAME FIRST + MASK. The naive `position('@'||name in text) > 0` that RemarkComposer uses
-- today is wrong whenever one name prefixes another: this directory contains both "Bharat" and
-- "Bharat Singh", so tagging @Bharat Singh notifies BOTH of them. Matching longest-first and
-- blanking each hit out of a working copy fixes it, and still handles the honest case:
--     '@Bharat Singh'             -> Singh only
--     '@Bharat'                   -> Bharat only
--     '@Bharat and @Bharat Singh' -> both
--
-- The blank-name guard is not theoretical: '@' || '' matches EVERY description containing an "@",
-- so a single profile saved with an empty name would mass-notify the whole org.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_mentions(p_text text, p_exclude uuid default null)
returns uuid[]
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_text text := coalesce(p_text, '');
  v_ids  uuid[] := '{}';
  r      record;
begin
  if btrim(v_text) = '' or position('@' in v_text) = 0 then
    return v_ids;
  end if;

  for r in
    select p.id, p.name
    from public.profiles p
    where nullif(btrim(p.name), '') is not null
      and (p_exclude is null or p.id <> p_exclude)
    order by length(p.name) desc, p.name
  loop
    if position('@' || r.name in v_text) > 0 then
      v_ids := v_ids || r.id;
      -- Blank this name out so a shorter name that prefixes it can't also match.
      v_text := replace(v_text, '@' || r.name, ' ');
    end if;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.resolve_mentions(text, uuid) from public;
revoke execute on function public.resolve_mentions(text, uuid) from anon;
grant execute on function public.resolve_mentions(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fan out a bell (+ optional email) to everyone tagged in a task description.
--
-- Reuses notification type 'mention' DELIBERATELY. The three *_select_mentioned RLS policies
-- (20260730130000_speed_up_task_rls.sql) key on exactly that label, so the tagged person gains
-- read access to the task, its remark thread and its checklist -- which they need in order to
-- open the notification at all. Two consequences, both already true of remark mentions:
--   * tagging someone GRANTS them read access to that task;
--   * removing the tag later does NOT revoke it (the notification row persists).
-- A new enum label would avoid the grant but produce a bell the recipient cannot open.
-- ---------------------------------------------------------------------------
create or replace function public.notify_description_mentions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor    uuid := coalesce(auth.uid(), new.created_by);  -- auth.uid() is null under pg_cron
  v_ids      uuid[];
  v_uid      uuid;
  v_ins_uid  uuid;
  v_email    text;
  v_email_on boolean;
begin
  -- Same skip list as notify_task_assignee. The recurring guards are what stop the 06:00 pg_cron
  -- run (194 templates, ~67 generated tasks/day) from re-notifying every tagged person EVERY
  -- MORNING, and shifted_from_task_id stops a shift continuation -- which copies the description
  -- verbatim -- from re-firing. Personal tasks are self-assigned and excluded everywhere else too.
  if new.description is null
     or btrim(new.description) = ''
     or coalesce(new.is_personal, false)
     or coalesce(new.from_recurring, false)
     or new.recurring_task_id is not null
     or new.shifted_from_task_id is not null
  then
    return new;
  end if;

  -- On UPDATE, only when the text actually changed (the trigger is already scoped to statements
  -- that mention the column, so completeTask/startTask never reach here at all).
  if tg_op = 'UPDATE' and new.description is not distinct from old.description then
    return new;
  end if;

  v_ids := public.resolve_mentions(new.description, v_actor);
  if v_ids is null or array_length(v_ids, 1) is null then
    return new;
  end if;

  v_email_on := public.email_module_enabled('task-management');

  foreach v_uid in array v_ids loop
    v_ins_uid := null;

    -- Dedup on (user, task, mention, activity_id IS NULL). This is what makes edits notify only
    -- NEWLY added tags: someone already tagged on this task is never told twice, so fixing a typo
    -- is silent. Remark mentions carry a non-null activity_id, so the two paths never collide.
    insert into public.notifications (user_id, type, task_id, activity_id, actor_id)
    select v_uid, 'mention', new.id, null, v_actor
    where not exists (
      select 1 from public.notifications n
      where n.user_id = v_uid
        and n.task_id = new.id
        and n.type = 'mention'
        and n.activity_id is null
    )
    returning user_id into v_ins_uid;

    -- Email only when a FRESH bell was created and the module is switched on. Isolated so a
    -- failure here can never roll back the task write.
    if v_ins_uid is not null and v_email_on then
      begin
        v_email := coalesce(
          (select nullif(btrim(p.email), '') from public.profiles p where p.id = v_uid),
          (select nullif(btrim(u.email), '') from auth.users  u where u.id = v_uid)
        );
        insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
        values ('task_description_mention', v_uid, v_email, v_actor, new.id,
                jsonb_build_object('description', new.description));
      exception when others then null;
      end;
    end if;
  end loop;

  return new;
end;
$$;

-- `UPDATE OF description` means the trigger is only considered when that column appears in the
-- statement's SET list, so status-only writes (complete / start / reopen / N-A) skip it entirely.
drop trigger if exists trg_tasks_description_mentions on public.tasks;
create trigger trg_tasks_description_mentions
after insert or update of description on public.tasks
for each row execute function public.notify_description_mentions();

commit;
