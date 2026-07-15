-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — DEMO TEARDOWN.
--
-- Removes EXACTLY what fms_exit_demo_seed.sql created, and nothing else.
--
-- The scope is one predicate: `exit_no like 'EXIT-DEMO-%'`. Every clearance check,
-- asset, handover, exit interview, settlement, payroll line, document and step-skip
-- hangs off a case by ON DELETE CASCADE, so deleting those sixteen rows removes the
-- whole demo. The activity trail and the notifications do NOT cascade (they are keyed by
-- a loose entity_id, and that id may be a case OR one of its satellites), so their ids
-- are collected BEFORE the delete and removed by id.
--
-- It cannot touch real exit data: a real case is numbered EXIT-<FY>-nnnn and can never
-- match 'EXIT-DEMO-%'.
--
-- It also removes the TWO PENDING MASTER REQUESTS the seed raised — and only those: they
-- carry `proposed_payload->>'_demo' = 'exit'`, so a real request from a real person is
-- never touched, even if it happens to propose the same name.
--
-- WHAT IT DELIBERATELY DOES *NOT* REMOVE — because it is real configuration the module
-- needs, not demo content:
--   • fms_exit_step_owners       (who owns each workflow step)
--   • fms_exit_config            (the process coordinators, the SLA rules, the policy)
--   • fms_exit_master_managers   (who owns each master — M8)
--   • the masters themselves, INCLUDING the owner_ids the seed wrote onto the eight
--     clearance checklist rows (that is who actually does the clearing)
-- Clear those by hand in Setup / Masters if you really want the module back to bare.
--
-- ⚠ The counter is NOT touched either: the seed already handed the real series back
--   (it deletes its own fms_exit_counters row), so there is nothing here to undo.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed/fms_exit_demo_teardown.sql
-- ===========================================================================

do $$
declare
  v_cases   uuid[];
  v_ids     uuid[];   -- the cases AND every satellite an activity row could be keyed on
  v_checks  integer;
  v_assets  integer;
  v_docs    integer;
  v_setts   integer;
  v_skips   integer;
  v_reqs    integer;
begin
  select coalesce(array_agg(id), '{}') into v_cases
    from public.fms_exit_cases where exit_no like 'EXIT-DEMO-%';

  -- The master requests are removed even if the cases are already gone — they are the
  -- other half of the demo, and leaving a stray "Sabbatical" pending in someone's review
  -- queue after a teardown is exactly the kind of residue this file exists to prevent.
  delete from public.fms_exit_master_requests where proposed_payload->>'_demo' = 'exit';
  get diagnostics v_reqs = row_count;

  if cardinality(v_cases) = 0 then
    raise notice 'No HR Exit demo cases found (no EXIT-DEMO-%% rows). Removed % demo master request(s).', v_reqs;
    return;
  end if;

  select count(*) into v_checks from public.fms_exit_clearance_checks where case_id = any(v_cases);
  select count(*) into v_assets from public.fms_exit_assets            where case_id = any(v_cases);
  select count(*) into v_docs   from public.fms_exit_documents         where case_id = any(v_cases);
  select count(*) into v_setts  from public.fms_exit_settlements       where case_id = any(v_cases);
  select count(*) into v_skips  from public.fms_exit_step_skips        where case_id = any(v_cases);

  -- An activity / notification row is keyed on the entity it is ABOUT — which for this
  -- module is the case for most events, but the CHECK, the ASSET or the DOCUMENT for
  -- others. Collect every one of those ids, or the trail is left orphaned.
  select v_cases
       || coalesce((select array_agg(id) from public.fms_exit_clearance_checks where case_id = any(v_cases)), '{}')
       || coalesce((select array_agg(id) from public.fms_exit_assets            where case_id = any(v_cases)), '{}')
       || coalesce((select array_agg(id) from public.fms_exit_documents         where case_id = any(v_cases)), '{}')
    into v_ids;

  delete from public.fms_exit_notifications where entity_id = any(v_ids);
  delete from public.fms_exit_activity      where entity_id = any(v_ids);

  -- One delete. Everything else cascades:
  --   case → clearance_checks, assets, handover, interviews, settlements,
  --          payroll_lines, documents, step_skips
  delete from public.fms_exit_cases where id = any(v_cases);

  raise notice 'HR Exit demo removed: % cases, % clearance rows, % assets, % documents, % settlements, % waived steps, % master requests.',
    cardinality(v_cases), v_checks, v_assets, v_docs, v_setts, v_skips, v_reqs;
  raise notice 'Step owners, coordinators, master owners, the masters and the clearance-row owners were left in place (they are real config, not demo data).';
end $$;
