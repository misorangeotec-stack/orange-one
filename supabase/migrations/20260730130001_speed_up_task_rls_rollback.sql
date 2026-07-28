-- ROLLBACK for 20260730130000_speed_up_task_rls.sql
--
-- Restores all 29 task-domain policies to their exact pre-migration form (captured verbatim
-- from pg_policies before the change). Apply this ONLY to undo that migration.
--
-- Note: this deliberately does NOT drop public.hod_downline(uuid). Leaving the function in
-- place is harmless once nothing references it, and dropping it would fail if any policy
-- still did. To remove it too, run afterwards:
--     drop function if exists public.hod_downline(uuid);
--
-- Reverting reinstates the per-row recursive HOD walk, i.e. the ~470-890 ms per-request
-- penalty and the 8s-statement_timeout exposure this migration removed.

begin;

drop policy if exists locations_delete_admin on public.locations;
create policy locations_delete_admin on public.locations as permissive for delete to authenticated
  using (is_admin(auth.uid()));

drop policy if exists locations_insert_admin on public.locations;
create policy locations_insert_admin on public.locations as permissive for insert to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists locations_select_all on public.locations;
create policy locations_select_all on public.locations as permissive for select to authenticated
  using (true);

drop policy if exists locations_update_admin on public.locations;
create policy locations_update_admin on public.locations as permissive for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists recurring_task_locations_select on public.recurring_task_locations;
create policy recurring_task_locations_select on public.recurring_task_locations as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM recurring_tasks r
  WHERE ((r.id = recurring_task_locations.recurring_task_id) AND ((r.assigned_to = auth.uid()) OR (r.created_by = auth.uid()) OR is_admin(auth.uid()) OR ((r.assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), r.assigned_to)))))));

drop policy if exists recurring_task_locations_write on public.recurring_task_locations;
create policy recurring_task_locations_write on public.recurring_task_locations as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM recurring_tasks r
  WHERE ((r.id = recurring_task_locations.recurring_task_id) AND ((r.created_by = auth.uid()) OR is_admin(auth.uid()) OR ((r.assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), r.assigned_to)))))))
  with check ((EXISTS ( SELECT 1
   FROM recurring_tasks r
  WHERE ((r.id = recurring_task_locations.recurring_task_id) AND ((r.created_by = auth.uid()) OR is_admin(auth.uid()) OR ((r.assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), r.assigned_to)))))));

drop policy if exists recurring_delete on public.recurring_tasks;
create policy recurring_delete on public.recurring_tasks as permissive for delete to authenticated
  using (((created_by = auth.uid()) OR is_admin(auth.uid())));

drop policy if exists recurring_insert on public.recurring_tasks;
create policy recurring_insert on public.recurring_tasks as permissive for insert to authenticated
  with check ((created_by = auth.uid()));

drop policy if exists recurring_select on public.recurring_tasks;
create policy recurring_select on public.recurring_tasks as permissive for select to authenticated
  using (((assigned_to = auth.uid()) OR (created_by = auth.uid()) OR is_admin(auth.uid()) OR ((assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), assigned_to))));

drop policy if exists recurring_update on public.recurring_tasks;
create policy recurring_update on public.recurring_tasks as permissive for update to authenticated
  using (((created_by = auth.uid()) OR is_admin(auth.uid()) OR ((assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), assigned_to))))
  with check (((created_by = auth.uid()) OR is_admin(auth.uid()) OR ((assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), assigned_to))));

drop policy if exists task_activity_delete_admin on public.task_activity;
create policy task_activity_delete_admin on public.task_activity as permissive for delete to authenticated
  using (is_admin(auth.uid()));

drop policy if exists task_activity_insert_self on public.task_activity;
create policy task_activity_insert_self on public.task_activity as permissive for insert to authenticated
  with check ((actor_id = auth.uid()));

drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_activity.task_id) AND ((t.assigned_to = auth.uid()) OR (t.created_by = auth.uid()) OR is_admin(auth.uid()) OR ((t.assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), t.assigned_to)))))));

drop policy if exists task_activity_select_mentioned on public.task_activity;
create policy task_activity_select_mentioned on public.task_activity as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.task_id = task_activity.task_id) AND (n.user_id = auth.uid()) AND (n.type = 'mention'::notification_type)))));

drop policy if exists task_locations_rw on public.task_locations;
create policy task_locations_rw on public.task_locations as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_locations.task_id) AND ((t.assigned_to = auth.uid()) OR (t.created_by = auth.uid()) OR is_admin(auth.uid()) OR ((t.assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), t.assigned_to)))))))
  with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_locations.task_id) AND ((t.assigned_to = auth.uid()) OR (t.created_by = auth.uid()) OR is_admin(auth.uid()) OR ((t.assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), t.assigned_to)))))));

drop policy if exists task_locations_select_mentioned on public.task_locations;
create policy task_locations_select_mentioned on public.task_locations as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.task_id = task_locations.task_id) AND (n.user_id = auth.uid()) AND (n.type = 'mention'::notification_type)))));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks as permissive for delete to authenticated
  using (((created_by = auth.uid()) OR is_admin(auth.uid())));

drop policy if exists tasks_delete_pending on public.tasks;
create policy tasks_delete_pending on public.tasks as permissive for delete to public
  using (((status = 'pending'::task_status) AND (is_personal = false) AND (recurring_task_id IS NULL) AND (from_recurring = false) AND ((created_by = auth.uid()) OR (assigned_to = auth.uid()) OR is_admin(auth.uid()))));

drop policy if exists tasks_delete_personal on public.tasks;
create policy tasks_delete_personal on public.tasks as permissive for delete to public
  using (((created_by = auth.uid()) AND (is_personal = true)));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks as permissive for insert to authenticated
  with check ((created_by = auth.uid()));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks as permissive for select to authenticated
  using (((assigned_to = auth.uid()) OR (created_by = auth.uid()) OR is_admin(auth.uid()) OR ((assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), assigned_to)) OR ((created_by IS NOT NULL) AND is_hod_of(auth.uid(), created_by))));

drop policy if exists tasks_select_mentioned on public.tasks;
create policy tasks_select_mentioned on public.tasks as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.task_id = tasks.id) AND (n.user_id = auth.uid()) AND (n.type = 'mention'::notification_type)))));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks as permissive for update to authenticated
  using (((assigned_to = auth.uid()) OR (created_by = auth.uid()) OR is_admin(auth.uid()) OR ((assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), assigned_to))))
  with check (((assigned_to = auth.uid()) OR (created_by = auth.uid()) OR is_admin(auth.uid()) OR ((assigned_to IS NOT NULL) AND is_hod_of(auth.uid(), assigned_to))));

drop policy if exists weekly_plans_delete on public.weekly_plans;
create policy weekly_plans_delete on public.weekly_plans as permissive for delete to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists weekly_plans_insert on public.weekly_plans;
create policy weekly_plans_insert on public.weekly_plans as permissive for insert to authenticated
  with check ((has_role(auth.uid(), 'admin'::app_role) OR is_hod_of(auth.uid(), doer_id)));

drop policy if exists weekly_plans_select on public.weekly_plans;
create policy weekly_plans_select on public.weekly_plans as permissive for select to authenticated
  using (((doer_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR is_hod_of(auth.uid(), doer_id)));

drop policy if exists weekly_plans_update on public.weekly_plans;
create policy weekly_plans_update on public.weekly_plans as permissive for update to authenticated
  using ((has_role(auth.uid(), 'admin'::app_role) OR is_hod_of(auth.uid(), doer_id)))
  with check ((has_role(auth.uid(), 'admin'::app_role) OR is_hod_of(auth.uid(), doer_id)));

drop policy if exists workspace_select on public.workspace_settings;
create policy workspace_select on public.workspace_settings as permissive for select to authenticated
  using (true);

drop policy if exists workspace_update_admin on public.workspace_settings;
create policy workspace_update_admin on public.workspace_settings as permissive for update to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));


commit;
