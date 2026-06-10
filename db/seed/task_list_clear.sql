-- Clear the stale Ritesh-loaded delegation set before reloading from the new
-- "Delegation work" sheets. Scoped strictly to the bulk-load marker
-- created_by = Ritesh Tulsyan ('79174071-1f03-46dd-bdf7-a6a7d3699877').
--
-- Order matters: delete the GENERATED task instances first (while their
-- recurring_task_id link still exists) -- tasks.recurring_task_id is ON DELETE
-- SET NULL, so deleting templates first would orphan them. Deleting the task
-- rows cascades to task_locations / task_activity / notifications. Deleting the
-- templates cascades to recurring_task_locations. The 3 standalone locations
-- (Ink Jet / Colorix / Personal Accounts) are KEPT and reused by the reload.
begin;

-- 1. task instances materialised from the old templates
delete from public.tasks
 where recurring_task_id in (
   select id from public.recurring_tasks
   where created_by = '79174071-1f03-46dd-bdf7-a6a7d3699877');

-- 2. the old recurring-task templates themselves
delete from public.recurring_tasks
 where created_by = '79174071-1f03-46dd-bdf7-a6a7d3699877';

commit;
