-- ===========================================================================
-- Purchase FMS (import) — a step's owners may span SEVERAL departments.
--
-- fms_import_step_owners.department_id held a single department, but people
-- from two different departments can co-own one process step. Adds a
-- department_ids uuid[] (backfilled from the single column) that the Setup screen
-- now reads/writes. The old department_id column is KEPT (additive-only rule) but
-- is dormant — nothing reads it any more.
--
-- department_ids is purely a UI filter for choosing employees; authorization
-- still comes solely from employee_ids (see fms_import_is_step_owner).
-- ===========================================================================

alter table public.fms_import_step_owners
  add column if not exists department_ids uuid[] not null default '{}';

-- Backfill the array from the legacy single department.
update public.fms_import_step_owners
   set department_ids = array[department_id]
 where department_id is not null
   and cardinality(department_ids) = 0;

comment on column public.fms_import_step_owners.department_ids is
  'Departments whose employees may own this step (UI filter). Authorization comes from employee_ids.';
