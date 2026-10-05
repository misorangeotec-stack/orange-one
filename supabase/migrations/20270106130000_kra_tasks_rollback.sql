-- Rollback for 20270106130000_kra_tasks.sql
--
-- ⚠ THIS DROPS EVERY KRA TASK'S LINK AND EVERY HOD RATING. The tasks themselves
--   stay, as ordinary tasks. Take the ratings out first if they are wanted:
--     \copy (select id, assigned_to, kra_id, kra_weight, kra_completion_weight, review_rating, reviewed_by, reviewed_at
--              from public.tasks where kra_id is not null) to 'kra_tasks.csv' with (format csv, header);
--
-- The function is restored FIRST, then the columns go (the reverse order would
-- leave shift_task_to_week inserting into a column that no longer exists).

begin;

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
               'from_recurring, is_peer_assignment, kra_id)',
               'from_recurring, is_peer_assignment)'),
             'v_task.from_recurring, v_task.is_peer_assignment, v_task.kra_id)',
             'v_task.from_recurring, v_task.is_peer_assignment)');

  if v_new <> v_src then
    execute v_new;
  end if;
end
$fn$;

drop trigger if exists trg_tasks_guard_kra on public.tasks;
drop function if exists public.guard_task_kra();

drop index if exists public.tasks_kra_awaiting_review_idx;
alter table public.tasks
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists review_rating,
  drop column if exists kra_completion_weight,
  drop column if exists kra_weight,
  drop column if exists kra_id;

-- org_kras goes back to readable by every signed-in user.
drop policy if exists org_kras_select on public.org_kras;
create policy org_kras_select on public.org_kras
  for select to authenticated using (true);

drop function if exists public.is_direct_hod_of(uuid, uuid);

commit;
