-- Speed up the task-domain RLS policies.
--
-- WHY
-- ---
-- `tasks_select` called `is_admin(auth.uid())` and `is_hod_of(auth.uid(), …)` INLINE, so
-- Postgres re-evaluated them PER ROW. `is_hod_of` is not a lookup -- it is a recursive CTE
-- walking the HOD tree to depth 10 (db/migrations/0017_transitive_hod_visibility.sql), and
-- tasks_select called it TWICE per row. `task_locations_rw` / `task_activity_select` nest
-- that same predicate inside a per-row EXISTS on tasks, paying it again.
--
-- Measured on this database (3,691 tasks / 14,955 task_locations), predicate in isolation:
--     admin  472 ms -> 10 ms
--     HOD    892 ms -> 12 ms
--   full task_locations scan  ~14 s -> 44 ms
-- That cost was paid on EVERY request, and `authenticated` has statement_timeout = 8s, so
-- with the tasks table growing ~2,400 rows/month this was trending to hard timeouts.
--
-- WHAT
-- ----
-- Three value-preserving substitutions, applied to USING and WITH CHECK alike. The boolean
-- structure of every policy is otherwise unchanged:
--     auth.uid()                -> (select auth.uid())
--     is_admin(auth.uid())      -> (select public.is_admin((select auth.uid())))
--     has_role(auth.uid(), R)   -> (select public.has_role((select auth.uid()), R))
--     is_hod_of(auth.uid(), X)  -> X in (select id from public.hod_downline((select auth.uid())))
-- Wrapping a STABLE call whose arguments are query-constant in `(select …)` turns it into an
-- InitPlan: evaluated ONCE per query instead of once per row. The value cannot change.
--
-- EQUIVALENCE (verified before this was applied)
-- ---------------------------------------------
--  * is_hod_of(a,b) == b IN hod_downline(a) checked across ALL 49x49 = 2,401 user pairs:
--    2,401 identical, 0 mismatches. Those are the only arguments the expression can take,
--    so this is a total proof, not a sample.
--  * Every visible-row set compared per table per user (49 users) -- 0 mismatches.
--  * No is_hod_of call site is negated, so the NULL-vs-false difference between
--    `is_hod_of(u,NULL)` (false) and `NULL IN (...)` (NULL) cannot change a result: every
--    site sits in a plain OR chain, and weekly_plans.doer_id / tasks.created_by are NOT
--    NULL while tasks.assigned_to sites are all guarded by an explicit IS NOT NULL.
--  * No RESTRICTIVE policies exist on any of these tables, so permissive-OR logic is intact.
--
-- SAFETY
-- ------
-- Policies only. No table, column or row is touched -- nothing is added, altered or deleted,
-- so this respects the additive-only rule in CLAUDE.md. The whole swap runs in ONE
-- transaction, so no table is ever left unprotected.
-- Rollback: 20260730130001_speed_up_task_rls_rollback.sql (verbatim original policies).
--
-- The policy bodies below were GENERATED from pg_policies by mechanical substitution, not
-- hand-transcribed -- several of these policies had been re-issued more than once, so the
-- migration history was not a reliable source for their current form.

begin;

-- The downline as a SET, so the planner hashes it once instead of re-walking the tree per
-- row. Identical recursion, depth cap, volatility and search_path to public.is_hod_of,
-- which is deliberately left in place: 140+ other policies and RPCs across the FMS apps
-- still call it.
create or replace function public.hod_downline(_hod uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive downline(id, depth) as (
    select employee_id, 1
    from public.user_hods
    where hod_id = _hod
    union all
    select uh.employee_id, d.depth + 1
    from public.user_hods uh
    join downline d on uh.hod_id = d.id
    where d.depth < 10
  )
  select id from downline;
$$;

grant execute on function public.hod_downline(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 29 task-domain policies across 8 tables: tasks, task_locations, task_activity,
-- recurring_tasks, recurring_task_locations, weekly_plans, locations, workspace_settings.
-- (profiles / user_hods / user_roles are deliberately NOT touched -- 49/30/50 rows, so the
-- per-row penalty there is ~2 ms and they are used by every app in the portal.)
-- ---------------------------------------------------------------------------

drop policy if exists locations_delete_admin on public.locations;
create policy locations_delete_admin on public.locations as permissive for delete to authenticated
  using ((select public.is_admin((select auth.uid()))));

drop policy if exists locations_insert_admin on public.locations;
create policy locations_insert_admin on public.locations as permissive for insert to authenticated
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists locations_select_all on public.locations;
create policy locations_select_all on public.locations as permissive for select to authenticated
  using (true);

drop policy if exists locations_update_admin on public.locations;
create policy locations_update_admin on public.locations as permissive for update to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists recurring_task_locations_select on public.recurring_task_locations;
create policy recurring_task_locations_select on public.recurring_task_locations as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM recurring_tasks r
  WHERE ((r.id = recurring_task_locations.recurring_task_id) AND ((r.assigned_to = (select auth.uid())) OR (r.created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((r.assigned_to IS NOT NULL) AND r.assigned_to in (select id from public.hod_downline((select auth.uid())))))))));

drop policy if exists recurring_task_locations_write on public.recurring_task_locations;
create policy recurring_task_locations_write on public.recurring_task_locations as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM recurring_tasks r
  WHERE ((r.id = recurring_task_locations.recurring_task_id) AND ((r.created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((r.assigned_to IS NOT NULL) AND r.assigned_to in (select id from public.hod_downline((select auth.uid())))))))))
  with check ((EXISTS ( SELECT 1
   FROM recurring_tasks r
  WHERE ((r.id = recurring_task_locations.recurring_task_id) AND ((r.created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((r.assigned_to IS NOT NULL) AND r.assigned_to in (select id from public.hod_downline((select auth.uid())))))))));

drop policy if exists recurring_delete on public.recurring_tasks;
create policy recurring_delete on public.recurring_tasks as permissive for delete to authenticated
  using (((created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid())))));

drop policy if exists recurring_insert on public.recurring_tasks;
create policy recurring_insert on public.recurring_tasks as permissive for insert to authenticated
  with check ((created_by = (select auth.uid())));

drop policy if exists recurring_select on public.recurring_tasks;
create policy recurring_select on public.recurring_tasks as permissive for select to authenticated
  using (((assigned_to = (select auth.uid())) OR (created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((assigned_to IS NOT NULL) AND assigned_to in (select id from public.hod_downline((select auth.uid()))))));

drop policy if exists recurring_update on public.recurring_tasks;
create policy recurring_update on public.recurring_tasks as permissive for update to authenticated
  using (((created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((assigned_to IS NOT NULL) AND assigned_to in (select id from public.hod_downline((select auth.uid()))))))
  with check (((created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((assigned_to IS NOT NULL) AND assigned_to in (select id from public.hod_downline((select auth.uid()))))));

drop policy if exists task_activity_delete_admin on public.task_activity;
create policy task_activity_delete_admin on public.task_activity as permissive for delete to authenticated
  using ((select public.is_admin((select auth.uid()))));

drop policy if exists task_activity_insert_self on public.task_activity;
create policy task_activity_insert_self on public.task_activity as permissive for insert to authenticated
  with check ((actor_id = (select auth.uid())));

drop policy if exists task_activity_select on public.task_activity;
create policy task_activity_select on public.task_activity as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_activity.task_id) AND ((t.assigned_to = (select auth.uid())) OR (t.created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((t.assigned_to IS NOT NULL) AND t.assigned_to in (select id from public.hod_downline((select auth.uid())))))))));

drop policy if exists task_activity_select_mentioned on public.task_activity;
create policy task_activity_select_mentioned on public.task_activity as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.task_id = task_activity.task_id) AND (n.user_id = (select auth.uid())) AND (n.type = 'mention'::notification_type)))));

drop policy if exists task_locations_rw on public.task_locations;
create policy task_locations_rw on public.task_locations as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_locations.task_id) AND ((t.assigned_to = (select auth.uid())) OR (t.created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((t.assigned_to IS NOT NULL) AND t.assigned_to in (select id from public.hod_downline((select auth.uid())))))))))
  with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_locations.task_id) AND ((t.assigned_to = (select auth.uid())) OR (t.created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((t.assigned_to IS NOT NULL) AND t.assigned_to in (select id from public.hod_downline((select auth.uid())))))))));

drop policy if exists task_locations_select_mentioned on public.task_locations;
create policy task_locations_select_mentioned on public.task_locations as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.task_id = task_locations.task_id) AND (n.user_id = (select auth.uid())) AND (n.type = 'mention'::notification_type)))));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks as permissive for delete to authenticated
  using (((created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid())))));

drop policy if exists tasks_delete_pending on public.tasks;
create policy tasks_delete_pending on public.tasks as permissive for delete to public
  using (((status = 'pending'::task_status) AND (is_personal = false) AND (recurring_task_id IS NULL) AND (from_recurring = false) AND ((created_by = (select auth.uid())) OR (assigned_to = (select auth.uid())) OR (select public.is_admin((select auth.uid()))))));

drop policy if exists tasks_delete_personal on public.tasks;
create policy tasks_delete_personal on public.tasks as permissive for delete to public
  using (((created_by = (select auth.uid())) AND (is_personal = true)));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks as permissive for insert to authenticated
  with check ((created_by = (select auth.uid())));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks as permissive for select to authenticated
  using (((assigned_to = (select auth.uid())) OR (created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((assigned_to IS NOT NULL) AND assigned_to in (select id from public.hod_downline((select auth.uid())))) OR ((created_by IS NOT NULL) AND created_by in (select id from public.hod_downline((select auth.uid()))))));

drop policy if exists tasks_select_mentioned on public.tasks;
create policy tasks_select_mentioned on public.tasks as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM notifications n
  WHERE ((n.task_id = tasks.id) AND (n.user_id = (select auth.uid())) AND (n.type = 'mention'::notification_type)))));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks as permissive for update to authenticated
  using (((assigned_to = (select auth.uid())) OR (created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((assigned_to IS NOT NULL) AND assigned_to in (select id from public.hod_downline((select auth.uid()))))))
  with check (((assigned_to = (select auth.uid())) OR (created_by = (select auth.uid())) OR (select public.is_admin((select auth.uid()))) OR ((assigned_to IS NOT NULL) AND assigned_to in (select id from public.hod_downline((select auth.uid()))))));

drop policy if exists weekly_plans_delete on public.weekly_plans;
create policy weekly_plans_delete on public.weekly_plans as permissive for delete to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)));

drop policy if exists weekly_plans_insert on public.weekly_plans;
create policy weekly_plans_insert on public.weekly_plans as permissive for insert to authenticated
  with check (((select public.has_role((select auth.uid()), 'admin'::app_role)) OR doer_id in (select id from public.hod_downline((select auth.uid())))));

drop policy if exists weekly_plans_select on public.weekly_plans;
create policy weekly_plans_select on public.weekly_plans as permissive for select to authenticated
  using (((doer_id = (select auth.uid())) OR (select public.has_role((select auth.uid()), 'admin'::app_role)) OR doer_id in (select id from public.hod_downline((select auth.uid())))));

drop policy if exists weekly_plans_update on public.weekly_plans;
create policy weekly_plans_update on public.weekly_plans as permissive for update to authenticated
  using (((select public.has_role((select auth.uid()), 'admin'::app_role)) OR doer_id in (select id from public.hod_downline((select auth.uid())))))
  with check (((select public.has_role((select auth.uid()), 'admin'::app_role)) OR doer_id in (select id from public.hod_downline((select auth.uid())))));

drop policy if exists workspace_select on public.workspace_settings;
create policy workspace_select on public.workspace_settings as permissive for select to authenticated
  using (true);

drop policy if exists workspace_update_admin on public.workspace_settings;
create policy workspace_update_admin on public.workspace_settings as permissive for update to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));


commit;
