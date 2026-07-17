-- ============================================================================
-- HR Exit + HR Recruitment + Office Supplies — scoped dummy-data cleanup
-- ============================================================================
-- The companion to fms_purchase_dummy_cleanup.sql, which cleared the Purchase
-- FMS on 17-Jul-2026. This clears the other three live FMS apps.
--
-- Unlike Purchase, these three hold NO real documents -- every document is demo
-- (verified 17-Jul-2026: 16/16 exit cases EXIT-DEMO-*, 12/12 requisitions
-- MRF-DEMO-*, 56/56 supply requests SUPPLY-DEMO-*, 0 non-demo in any). Import
-- Purchase (fms_import_*) is already empty and is not touched.
--
-- DELETED:
--   exit     : 16 cases EXIT-DEMO-01..16 + cascaded children + activity/notifications
--              + all 3 master_requests (see note below)
--   hr       : 12 requisitions MRF-DEMO-01..12 + cascaded candidates/interviews/
--              onboardings/probations/reviews/platforms + activity/notifications
--   supplies : 56 requests SUPPLY-DEMO-0001..0056 (its activity/notifications
--              tables are empty -- the supplies demo rows were inserted raw, with
--              no audit trail -- but the deletes are kept for correctness)
--
-- SURVIVES -- deliberately. These are real configuration, NOT demo data. The
-- demo seeds wrote them, but they are what the business actually runs on:
--   *_step_owners     : who owns each workflow step (Bushra, Rohan, Karan, ...).
--                       NOTE fms_supplies_step_owners is legitimately EMPTY (0
--                       rows) -- office supplies has never had owners assigned.
--   *_config          : due-date rules, approval settings
--   *_master_managers : who owns each master
--   *_counters        : document numbering (left alone; see note 4)
--   all master tables : reasons, payroll_heads, clearance_items, asset_types,
--                       document_types, job_platforms, job_types, locations,
--                       categories, items, departments, companies, service_types
--
-- WHY BY DOCUMENT, NOT BY ACTOR: same rule as the Purchase cleanup. The demo
-- cases name real employees (Sagar Rathod, Vinit Solanki) and real approvers
-- (SUHEL YUSUF TOORAWA, Yash Agarwal). Deleting by actor would hit real people's
-- rows elsewhere. Every delete below is scoped by document number.
--
-- ON THE 3rd EXIT MASTER REQUEST: two are flagged proposed_payload->>'_demo'='exit'
-- (from fms_exit_demo_seed.sql). The third -- an approved 'Sabbatical' reason,
-- raised by Tanisha Tikde, approved by Yash Agarwal at 14:55 on 14-Jul, 33 min
-- BEFORE the seed ran at 15:28 -- carries no flag. It is identical in shape to
-- what the seed creates (same master_type/name/requester) and 'Sabbatical' is
-- absent from fms_exit_reasons, so it reads as residue from an earlier seed run
-- predating the _demo flag. User confirmed on 17-Jul-2026: delete it too.
-- Hence this script empties fms_exit_master_requests rather than filtering on
-- the flag (which is what fms_exit_demo_teardown.sql does).
--
-- Usage:
--   dry run : psql "$SUPABASE_DB_URL" -v commit=0 -f supabase/seed/fms_other_dummy_cleanup.sql
--   commit  : psql "$SUPABASE_DB_URL" -v commit=1 -f supabase/seed/fms_other_dummy_cleanup.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------------
-- 1. Resolve the demo document sets ONCE, by explicit scope.
-- ---------------------------------------------------------------------------
create temp table _demo_cases on commit drop as
select id, exit_no from public.fms_exit_cases where exit_no like 'EXIT-DEMO-%';

create temp table _demo_reqs on commit drop as
select id, mrf_no from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%';

create temp table _demo_supply on commit drop as
select id, req_no from public.fms_supplies_requests where req_no like 'SUPPLY-DEMO-%';

-- Snapshot every config/master table BEFORE touching anything. Section 6 asserts
-- these are byte-for-byte unchanged. Stronger than asserting "> 0": some of these
-- are legitimately empty (fms_supplies_step_owners has never been configured), so
-- a "> 0" guard would both false-alarm there and miss a partial wipe elsewhere.
create temp table _config_before on commit drop as
select 'exit_step_owners' t, count(*) n from public.fms_exit_step_owners
union all select 'exit_config',         count(*) from public.fms_exit_config
union all select 'exit_master_managers',count(*) from public.fms_exit_master_managers
union all select 'exit_reasons',        count(*) from public.fms_exit_reasons
union all select 'exit_payroll_heads',  count(*) from public.fms_exit_payroll_heads
union all select 'exit_clearance_items',count(*) from public.fms_exit_clearance_items
union all select 'exit_asset_types',    count(*) from public.fms_exit_asset_types
union all select 'exit_document_types', count(*) from public.fms_exit_document_types
union all select 'hr_step_owners',      count(*) from public.fms_hr_step_owners
union all select 'hr_config',           count(*) from public.fms_hr_config
union all select 'hr_master_managers',  count(*) from public.fms_hr_master_managers
union all select 'hr_job_platforms',    count(*) from public.fms_hr_job_platforms
union all select 'hr_job_types',        count(*) from public.fms_hr_job_types
union all select 'hr_locations',        count(*) from public.fms_hr_locations
union all select 'hr_onboarding_items', count(*) from public.fms_hr_onboarding_items
union all select 'hr_disq_reasons',     count(*) from public.fms_hr_disqualification_reasons
union all select 'sup_step_owners',     count(*) from public.fms_supplies_step_owners
union all select 'sup_config',          count(*) from public.fms_supplies_config
union all select 'sup_master_managers', count(*) from public.fms_supplies_master_managers
union all select 'sup_categories',      count(*) from public.fms_supplies_categories
union all select 'sup_items',           count(*) from public.fms_supplies_items
union all select 'sup_departments',     count(*) from public.fms_supplies_departments
union all select 'sup_companies',       count(*) from public.fms_supplies_companies
union all select 'sup_service_types',   count(*) from public.fms_supplies_service_types;

-- ---------------------------------------------------------------------------
-- 2. Guard: nothing outside the demo scope may be caught, and the scope must
--    cover the whole table (these apps are 100% demo -- if a real document has
--    since been raised, ABORT so a human can re-scope).
-- ---------------------------------------------------------------------------
do $$
declare n_extra int;
begin
  select count(*) into n_extra from public.fms_exit_cases where exit_no not like 'EXIT-DEMO-%';
  if n_extra > 0 then raise exception 'ABORT: % non-demo exit case(s) exist -- re-scope before running', n_extra; end if;

  select count(*) into n_extra from public.fms_hr_requisitions where mrf_no not like 'MRF-DEMO-%';
  if n_extra > 0 then raise exception 'ABORT: % non-demo requisition(s) exist -- re-scope before running', n_extra; end if;

  select count(*) into n_extra from public.fms_supplies_requests where req_no not like 'SUPPLY-DEMO-%';
  if n_extra > 0 then raise exception 'ABORT: % non-demo supply request(s) exist -- re-scope before running', n_extra; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. HR EXIT.
--    activity/notifications are polymorphic (entity_id has no FK), so nothing
--    cascades to them -- delete explicitly, including the child entity ids.
-- ---------------------------------------------------------------------------
-- Only the children with their OWN id can be an activity/notification entity.
-- settlements / interviews / handover / step_skips are 1:1 on case_id (no id of
-- their own), so their activity rows are keyed by the case id, already covered.
create temp table _exit_ids on commit drop as
select id from _demo_cases
union all select id from public.fms_exit_clearance_checks where case_id in (select id from _demo_cases)
union all select id from public.fms_exit_assets            where case_id in (select id from _demo_cases)
union all select id from public.fms_exit_documents         where case_id in (select id from _demo_cases)
union all select id from public.fms_exit_payroll_lines     where case_id in (select id from _demo_cases);

delete from public.fms_exit_notifications where entity_id in (select id from _exit_ids);
delete from public.fms_exit_activity      where entity_id in (select id from _exit_ids);

-- All 3 master requests (2 flagged demo + Tanisha's unflagged Sabbatical).
delete from public.fms_exit_master_requests;

-- Children cascade off the case (assets, clearance_checks, documents, handover,
-- interviews, payroll_lines, settlements, step_skips -- all FK ON DELETE CASCADE).
delete from public.fms_exit_cases where id in (select id from _demo_cases);

-- ---------------------------------------------------------------------------
-- 4. HR RECRUITMENT.
-- ---------------------------------------------------------------------------
create temp table _hr_ids on commit drop as
select id from _demo_reqs
union all select id from public.fms_hr_candidates   where requisition_id in (select id from _demo_reqs)
union all select id from public.fms_hr_onboardings  where requisition_id in (select id from _demo_reqs)
union all select id from public.fms_hr_probations   where requisition_id in (select id from _demo_reqs);

delete from public.fms_hr_notifications where entity_id in (select id from _hr_ids);
delete from public.fms_hr_activity      where entity_id in (select id from _hr_ids);

-- No HR master requests exist (verified 0), but keep the app consistent with exit.
delete from public.fms_hr_master_requests;

-- candidates -> interviews/onboardings/probations -> checks/reviews all cascade.
delete from public.fms_hr_requisitions where id in (select id from _demo_reqs);

-- ---------------------------------------------------------------------------
-- 5. OFFICE SUPPLIES.
--    fms_supplies_requests has no child tables -- every field is inline.
-- ---------------------------------------------------------------------------
delete from public.fms_supplies_notifications where entity_id in (select id from _demo_supply);
delete from public.fms_supplies_activity      where entity_id in (select id from _demo_supply);
delete from public.fms_supplies_master_requests;
delete from public.fms_supplies_requests where id in (select id from _demo_supply);

-- ---------------------------------------------------------------------------
-- 6. Final assertion: every demo document gone, every config row intact.
-- ---------------------------------------------------------------------------
create temp table _config_after on commit drop as
select 'exit_step_owners' t, count(*) n from public.fms_exit_step_owners
union all select 'exit_config',         count(*) from public.fms_exit_config
union all select 'exit_master_managers',count(*) from public.fms_exit_master_managers
union all select 'exit_reasons',        count(*) from public.fms_exit_reasons
union all select 'exit_payroll_heads',  count(*) from public.fms_exit_payroll_heads
union all select 'exit_clearance_items',count(*) from public.fms_exit_clearance_items
union all select 'exit_asset_types',    count(*) from public.fms_exit_asset_types
union all select 'exit_document_types', count(*) from public.fms_exit_document_types
union all select 'hr_step_owners',      count(*) from public.fms_hr_step_owners
union all select 'hr_config',           count(*) from public.fms_hr_config
union all select 'hr_master_managers',  count(*) from public.fms_hr_master_managers
union all select 'hr_job_platforms',    count(*) from public.fms_hr_job_platforms
union all select 'hr_job_types',        count(*) from public.fms_hr_job_types
union all select 'hr_locations',        count(*) from public.fms_hr_locations
union all select 'hr_onboarding_items', count(*) from public.fms_hr_onboarding_items
union all select 'hr_disq_reasons',     count(*) from public.fms_hr_disqualification_reasons
union all select 'sup_step_owners',     count(*) from public.fms_supplies_step_owners
union all select 'sup_config',          count(*) from public.fms_supplies_config
union all select 'sup_master_managers', count(*) from public.fms_supplies_master_managers
union all select 'sup_categories',      count(*) from public.fms_supplies_categories
union all select 'sup_items',           count(*) from public.fms_supplies_items
union all select 'sup_departments',     count(*) from public.fms_supplies_departments
union all select 'sup_companies',       count(*) from public.fms_supplies_companies
union all select 'sup_service_types',   count(*) from public.fms_supplies_service_types;

do $$
declare
  n_cases int; n_reqs int; n_supply int;
  n_mr_e int; n_mr_h int; n_mr_s int;
  bad text;
begin
  -- Every demo document must be gone.
  select count(*) into n_cases  from public.fms_exit_cases;
  select count(*) into n_reqs   from public.fms_hr_requisitions;
  select count(*) into n_supply from public.fms_supplies_requests;
  if n_cases  <> 0 then raise exception 'ABORT: % exit case(s) left',      n_cases;  end if;
  if n_reqs   <> 0 then raise exception 'ABORT: % requisition(s) left',    n_reqs;   end if;
  if n_supply <> 0 then raise exception 'ABORT: % supply request(s) left', n_supply; end if;

  select count(*) into n_mr_e from public.fms_exit_master_requests;
  select count(*) into n_mr_h from public.fms_hr_master_requests;
  select count(*) into n_mr_s from public.fms_supplies_master_requests;
  if n_mr_e + n_mr_h + n_mr_s <> 0 then raise exception 'ABORT: master requests left'; end if;

  -- Every config/master table must be EXACTLY as it was before.
  select string_agg(format('%s: %s -> %s', b.t, b.n, a.n), ', ')
    into bad
  from _config_before b join _config_after a using (t)
  where b.n is distinct from a.n;

  if bad is not null then
    raise exception 'ABORT: configuration/master data changed -- %', bad;
  end if;

  raise notice 'OK: 0 documents left; all 24 config/master tables unchanged.';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Commit only when -v commit=1 was passed.
-- ---------------------------------------------------------------------------
\if :commit
  commit;
  \echo '>>> COMMITTED'
\else
  rollback;
  \echo '>>> DRY RUN -- rolled back, nothing changed'
\endif
