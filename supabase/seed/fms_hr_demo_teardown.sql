-- ===========================================================================
-- HR Recruitment FMS — DEMO TEARDOWN.
--
-- Removes EXACTLY what fms_hr_demo_seed.sql created and nothing else.
--
-- The scope is one predicate: `mrf_no like 'MRF-DEMO-%'`. Every candidate,
-- interview, onboarding, checklist item, probation and review hangs off a
-- requisition by ON DELETE CASCADE, so deleting those twelve rows removes the whole
-- demo. The activity trail and the notifications do NOT cascade (they are keyed by a
-- loose entity_id), so their ids are collected BEFORE the delete and removed by id.
--
-- It cannot touch real recruitment data: a real MRF is numbered MRF-<FY>-nnnn and
-- can never match 'MRF-DEMO-%'.
--
-- WHAT IT DELIBERATELY DOES *NOT* REMOVE — because it is real configuration the
-- module needs, not demo content:
--   • fms_hr_step_owners            (who owns each workflow step)
--   • fms_hr_config                 (the process coordinators, the SLA rules)
--   • the masters (platforms, locations, job types, checklist items, reasons)
-- Clear those by hand in Setup if you really want the module back to bare.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed/fms_hr_demo_teardown.sql
-- ===========================================================================

do $$
declare
  v_reqs  uuid[];
  v_cands uuid[];
  v_onbs  uuid[];
  v_probs uuid[];
  v_ivs   integer;
  v_checks integer;
  v_revs  integer;
begin
  select coalesce(array_agg(id), '{}') into v_reqs
    from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%';

  if cardinality(v_reqs) = 0 then
    raise notice 'No HR demo data found (no MRF-DEMO-%% requisitions). Nothing to do.';
    return;
  end if;

  select coalesce(array_agg(id), '{}') into v_cands
    from public.fms_hr_candidates where requisition_id = any(v_reqs);
  select coalesce(array_agg(id), '{}') into v_onbs
    from public.fms_hr_onboardings where requisition_id = any(v_reqs);
  select coalesce(array_agg(id), '{}') into v_probs
    from public.fms_hr_probations where requisition_id = any(v_reqs);

  select count(*) into v_ivs    from public.fms_hr_interviews        where candidate_id = any(v_cands);
  select count(*) into v_checks from public.fms_hr_onboarding_checks where onboarding_id = any(v_onbs);
  select count(*) into v_revs   from public.fms_hr_probation_reviews where probation_id = any(v_probs);

  -- Activity + notifications are keyed by a loose entity_id (no FK), so they must go
  -- first, by id — nothing would cascade them.
  delete from public.fms_hr_notifications
   where entity_id = any(v_reqs || v_cands || v_onbs || v_probs);
  delete from public.fms_hr_activity
   where entity_id = any(v_reqs || v_cands || v_onbs || v_probs);

  -- One delete. Everything else cascades:
  --   requisition → requisition_platforms, candidates, onboardings, probations
  --   candidate   → interviews
  --   onboarding  → onboarding_checks
  --   probation   → probation_reviews
  delete from public.fms_hr_requisitions where id = any(v_reqs);

  raise notice 'HR demo removed: % requisitions, % candidates, % interviews, % onboardings, % checklist items, % probations, % reviews.',
    cardinality(v_reqs), cardinality(v_cands), v_ivs, cardinality(v_onbs), v_checks, cardinality(v_probs), v_revs;
  raise notice 'Step owners, process coordinators, SLA rules and the masters were left in place (they are real config, not demo data).';
end $$;
