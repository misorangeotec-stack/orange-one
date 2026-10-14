-- Reverses 20270123120000_recurring_kra.sql.
-- Tasks already generated keep their KRA (they are ordinary KRA tasks by then).

begin;

-- 4 · Generators back to the plain insert.
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
                 'created_by, status, recurring_task_id, kra_id)',
                 'created_by, status, recurring_task_id)'),
               '''pending'', r.id,
       (select k.id from public.org_kras k
         where k.id = r.kra_id and k.active and k.profile_id = r.assigned_to))',
               '''pending'', r.id)');

    if v_new = v_src then
      raise exception 'Rollback: % did not carry the recurring KRA patch', v_name;
    end if;
    execute v_new;
  end loop;
end
$fn$;

-- 3 · guard_task_kra without the recurring exception.
do $fn$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_task_kra';

  v_new := replace(v_src,
    'if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to)
       and not exists (select 1 from public.recurring_tasks rt
                        where rt.id = new.recurring_task_id and rt.kra_id = new.kra_id
                          and rt.created_by = new.created_by) then',
    'if v_uid is not null and not public.is_direct_hod_of(v_uid, new.assigned_to) then');

  if v_new = v_src then
    raise exception 'Rollback: guard_task_kra did not carry the recurring KRA patch';
  end if;
  execute v_new;
end
$fn$;

-- 2 · Template guard.
drop trigger if exists trg_recurring_guard_kra on public.recurring_tasks;
drop function if exists public.guard_recurring_kra();

-- 1 · Column.
alter table public.recurring_tasks drop column if exists kra_id;

commit;
