-- ===========================================================================
-- KRA ON RECURRING TASKS — the "Task category" box of Create Task, on the
-- recurring template too, so every task the template generates is a KRA task.
--
-- THE RULE (client, 13-10-2026)
--   * Task Management → Recurring → New / Edit has the same "Task category" as
--     Create Task: Others (unchanged) or one of the assignee's KRAs from
--     Admin → Organisation → KRA Details.
--   * Every task the template generates carries that KRA, and is scored exactly
--     like a KRA task given by hand (20270107130000): C on completion, plus
--     (rating/10) × (W − C) from the HOD's 1-10 review.
--   * Same WHO as Create Task: only the assignee's DIRECT HOD (user_hods row)
--     may put a KRA on a template.
--
-- ⚠ THE CHECK IS MADE WHEN THE TEMPLATE IS SAVED, NOT AT EACH GENERATION.
--   The cron run has no auth.uid() (trusted already), but "Generate now" and the
--   auto-generate after a save run as the clicking user — an admin, the template
--   creator, any upline HOD. guard_task_kra therefore lets a generated task keep
--   the KRA its template carries, exactly as it lets a shift continuation keep
--   its source's KRA. The exception holds only for a task stamped with the
--   template's own id, KRA and creator — exactly what the generators insert —
--   so a hand-made insert cannot borrow a template to skip the HOD check.
--
-- ⚠ A KRA THAT IS SWITCHED OFF, OR NO LONGER THE ASSIGNEE'S, IS DROPPED AT
--   GENERATION (the task is born "Others"), never raised: one exception inside
--   generate_recurring_tasks would abort the whole morning run for everybody.
--
-- ⚠ Weights are still snapshotted per generated task by guard_task_kra, so a
--   Wt% changed on KRA Details applies from the next generated task onward.
--
-- Additive: one nullable column, one trigger, three function bodies patched
-- (read back out of pg_proc and transformed, never retyped). No row changes.
-- Reversal: 20270123120000_recurring_kra_rollback.sql
-- ===========================================================================

do $assert$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'kra_id'
  ) then
    raise exception 'Recurring KRA pre 1: tasks.kra_id is missing -- run 20270107130000_kra_tasks.sql first';
  end if;
end
$assert$;

begin;

-- ---------------------------------------------------------------------------
-- 1 · The template's KRA. Deleting the KRA turns the template back to Others.
-- ---------------------------------------------------------------------------
alter table public.recurring_tasks
  add column if not exists kra_id uuid references public.org_kras on delete set null;

comment on column public.recurring_tasks.kra_id is
  'Task Category of the template: the assignee''s KRA every generated task is given against. Null = "Others". Only the assignee''s direct HOD may set it.';

-- ---------------------------------------------------------------------------
-- 2 · Guard on the template — same rules as giving a KRA task by hand.
-- ---------------------------------------------------------------------------
create or replace function public.guard_recurring_kra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();   -- null for the service role: trusted
  v_kra public.org_kras%rowtype;
begin
  if new.kra_id is null then
    return new;
  end if;

  -- An edit that leaves the KRA and the assignee alone (title, schedule, pause)
  -- is not re-checked: an admin or creator may still edit a HOD's KRA template.
  if tg_op = 'UPDATE'
     and new.kra_id is not distinct from old.kra_id
     and new.assigned_to is not distinct from old.assigned_to then
    return new;
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
  return new;
end;
$$;

drop trigger if exists trg_recurring_guard_kra on public.recurring_tasks;
create trigger trg_recurring_guard_kra
  before insert or update on public.recurring_tasks
  for each row execute function public.guard_recurring_kra();

-- ---------------------------------------------------------------------------
-- 3 · guard_task_kra: a generated task may keep its template's KRA, whoever
--     pressed the button (the HOD check was made on the template).
-- ---------------------------------------------------------------------------
do $fn$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_task_kra';

  v_new := replace(v_src,
    'if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to) then
      raise exception ''Only this employee''''s own HOD can give a KRA task.'';',
    'if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to)
       and not exists (select 1 from public.recurring_tasks rt
                        where rt.id = new.recurring_task_id and rt.kra_id = new.kra_id
                          and rt.created_by = new.created_by) then
      raise exception ''Only this employee''''s own HOD can give a KRA task.'';');

  if v_new = v_src then
    raise exception 'Recurring KRA step 3: guard_task_kra did not match the expected shape -- read the live body and update this transform rather than forcing it';
  end if;

  execute v_new;
end
$fn$;

-- ---------------------------------------------------------------------------
-- 4 · Both generators put the template's KRA on the task — only while it is
--     still active and still the assignee's (see the header).
-- ---------------------------------------------------------------------------
do $fn$
declare
  v_name text;
  v_src  text;
  v_new  text;
begin
  foreach v_name in array array['generate_recurring_tasks', 'generate_recurring_task_now'] loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;

    v_new := replace(
               replace(v_src,
                 'created_by, status, recurring_task_id)',
                 'created_by, status, recurring_task_id, kra_id)'),
               '''pending'', r.id)',
               '''pending'', r.id,
       (select k.id from public.org_kras k
         where k.id = r.kra_id and k.active and k.profile_id = r.assigned_to))');

    if v_new = v_src or v_new not like '%recurring_task_id, kra_id)%' or v_new not like '%k.id = r.kra_id%' then
      raise exception 'Recurring KRA step 4: % did not match the expected shape -- read the live body and update this transform rather than forcing it', v_name;
    end if;

    execute v_new;
  end loop;
end
$fn$;

commit;
