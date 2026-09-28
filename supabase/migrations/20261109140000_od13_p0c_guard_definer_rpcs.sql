-- OD-13 · P0c — SECURITY DEFINER functions that ask nobody's permission.
--
-- Applied to the live database on 04-09-2026 in three parts, recorded as
--   od13_p0c1_org_directory_excludes_external
--   od13_p0c2_guard_unprotected_definer_rpcs
--   od13_p0c3_revoke_public_execute_on_guarded_rpcs
-- This file is the three of them together, with the reasoning, for anyone rebuilding.
--
-- WHY
-- ---
-- P0a closed 207 table policies. It does nothing for these: a SECURITY DEFINER function
-- runs as postgres and bypasses RLS by definition. Measured on 04-09-2026, 684 functions in
-- `public` are SECURITY DEFINER and executable by `authenticated`, and ~205 of them contain
-- no permission test of any kind -- no is_admin, no module_can_edit, no step-owner check,
-- no auth.uid() comparison. Four read in full to be certain, and they really have none:
--
--     fms_purchase_submit_request    raise a purchase requisition
--     fms_import_record_payment      record a payment against a purchase order
--     mst_refresh_party_companies    mutate the central party master
--     fms_ocpi_last_contact_for      read ANOTHER customer's address, email, mobile, GSTIN
--
-- ⚠ TWO I HAD FLAGGED ARE NOT ACTUALLY OPEN, and are left alone: pc_step_owner_contacts()
--   raises unless pc_is_coordinator(), and leads_dashboard_salespeople() filters on
--   leads_dashboard_can_read(). The regex that found the ~205 does not see a guard that
--   lives in a WHERE clause. Read each one before guarding it.
--
-- THREE THINGS THIS HAD TO GET RIGHT, EACH OF WHICH WOULD HAVE BROKEN SOMETHING
-- ----------------------------------------------------------------------------
-- 1 · NOT the 46 functions an RLS policy calls. A `raise` inside a policy predicate
--     hard-errors the whole query instead of returning false, so guarding is_admin,
--     same_department, hod_downline, fms_exit_is_* and the rest would break reads for
--     exactly the accounts it is meant to restrict. The loop re-checks pg_policies per
--     function rather than trusting the list.
--
-- 2 · NOT anything named fms_dispatch_*. Those sit on the path a customer will legitimately
--     call once the Orange Order Desk exists (submit -> next_seq -> replace_lines ->
--     announce). auth.uid() inside a nested SECURITY DEFINER call is still the CUSTOMER's
--     uid, not the definer's, so guarding them would refuse the customer their own order.
--     They are handled in P3, when that call path is built and known exactly.
--
-- 3 · THE GUARD IS `auth.uid() is not null and not is_staff(...)`, NOT `not is_staff(...)`.
--     pg_cron is installed and jobs 2, 3, 4, 7, 21 and 30 run generate_recurring_tasks,
--     fms_asset_generate_jobs, fms_asset_send_reminders, master_report_enqueue_daily,
--     user_snapshot_enqueue_daily and mst_refresh_party_companies / _item_companies as
--     `postgres` with no JWT. auth.uid() is NULL there. The plain form would have failed
--     every one of those nightly, silently, and the first symptom would have been a report
--     that stopped arriving.
--
-- AND THE PART THAT LOOKED DONE BUT WAS NOT
-- -----------------------------------------
-- 🔴 `revoke execute … from anon` DID NOTHING. Postgres grants EXECUTE to PUBLIC by default
--    and these functions carried `=X/postgres` in their ACL -- that leading empty grantee IS
--    the PUBLIC grant -- so anon inherited EXECUTE and revoking its (never-held) direct
--    grant changed nothing. Combined with point 3 above that was worse than a no-op: an
--    anon PostgREST call has no sub claim, so auth.uid() is NULL, so the new guard waves it
--    through. Until the PUBLIC grant was revoked, anyone holding the anon key that ships in
--    the frontend bundle could still call fms_purchase_submit_request with no login at all.
--    The guard closes the signed-in-but-external case; only REVOKE … FROM PUBLIC closes anon.
--
-- ⚠ STILL OPEN AND LARGER THAN THIS TASK. 611 other SECURITY DEFINER functions in `public`
--   remain executable by anon through the same default PUBLIC grant, and they bypass RLS by
--   definition. Closing them is right but needs its own pass: "which RPCs does the signed-out
--   landing page legitimately need" must be tested, not assumed. Recorded in WORKLIST.md.
--
-- SAFETY
-- ------
-- Function bodies only, plus grants. No table, column or row is touched. The injection is
-- GENERATED from pg_get_functiondef and anchored on the opening BEGIN, and it aborts if that
-- anchor is not found rather than writing a mangled body. Re-running is a no-op: the loop
-- skips any function whose body already contains the guard.
--
-- VERIFIED AFTER APPLYING, against the live database:
--   * staff caller  -> list_org_people() returns all 64 people (was 64)
--   * caller with no profiles row -> 0 rows (is_staff fails closed)
--   * a profile flagged is_external -> 0 rows, AND is absent from what staff see
--     (tested by flipping a real row inside a transaction and forcing a rollback)
--   * null-uid (the cron path) -> guarded function still runs
--   * external caller -> guarded function raises
--   * anon -> EXECUTE removed on all 50 touched functions

-- ---------------------------------------------------------------------------
-- 1 · The org-wide directory: staff only, in and out.
-- ---------------------------------------------------------------------------
-- list_org_people() and list_org_people_detail() are the SECURITY DEFINER escape hatch the
-- FMS apps use because step owners and coordinators are org-wide appointments (orgPeople.ts
-- and PeoplePicker.tsx both say so). ~40 call sites across 16 files read them: the @mention
-- box, every step-owner / coordinator / master-owner picker, the HR interviewer pool, and
-- every layout's who-did-what lookup. Two clauses close all forty at the source:
--   * the CALLER must be staff -- a customer cannot enumerate our people;
--   * the RESULT excludes external accounts -- a customer never appears in a picker.
-- Empty rather than raising, deliberately: these feed pickers, and a picker that errors is a
-- broken screen while an empty one is correct for somebody who should not be picking people.
--
-- (Full bodies are in the applied migration od13_p0c1_org_directory_excludes_external; only
--  the WHERE clause changed from `auth.uid() is not null`.)

-- ---------------------------------------------------------------------------
-- 2 · The guard sweep.
-- ---------------------------------------------------------------------------
do $guard$
declare
  r record;
  v_old text;
  v_new text;
  v_guard constant text :=
    E'  if auth.uid() is not null and not public.is_staff(auth.uid()) then\n' ||
    E'    raise exception ''Not authorized'';\n' ||
    E'  end if;\n';
  n integer := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where ns.nspname = 'public'
       and l.lanname = 'plpgsql'
       and p.prosecdef
       and p.proname = any (array[
         'collections_report_due','collections_report_mark_sent',
         'fms_asset_generate_jobs','fms_asset_next_seq','fms_asset_open_job','fms_asset_send_reminders',
         'fms_customer_next_seq','fms_customer_write_form',
         'fms_exit_next_seq','fms_exit_seed_documents',
         'fms_hr_hod_decide','fms_hr_next_seq','fms_hr_open_probation',
         'fms_hr_sync_requisition_fill','fms_hr_try_complete_onboarding',
         'fms_import_add_pi','fms_import_next_seq','fms_import_record_payment',
         'fms_import_refresh_po','fms_import_submit_request',
         'fms_ocpi_next_seq','fms_ocpi_write_oc','fms_ocpi_write_quotation',
         'fms_production_next_batch_seq','fms_production_next_seq','fms_production_peek_batch_no',
         'fms_purchase_next_seq','fms_purchase_refresh_po','fms_purchase_submit_request',
         'fms_sampling_next_seq','fms_supplies_next_seq',
         'fms_travel_check_claim','fms_travel_class_excess','fms_travel_compute_da',
         'fms_travel_freeze_da','fms_travel_next_seq','fms_travel_next_stop',
         'fms_travel_price_claim','fms_travel_write_trip',
         'generate_recurring_tasks',
         'master_report_apply_schedule','master_report_enqueue_daily',
         'mst_refresh_item_companies','mst_refresh_party_companies',
         'user_snapshot_apply_schedule','user_snapshot_enqueue_daily'
       ])
       -- never guard something an RLS policy calls (point 1 in the header)
       and not exists (
         select 1 from pg_policies pp
          where coalesce(pp.qual,'') || ' ' || coalesce(pp.with_check,'') like '%' || p.proname || '(%'
       )
       -- idempotent
       and pg_get_functiondef(p.oid) not like '%not public.is_staff(auth.uid())%'
  loop
    v_old := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_old, '(AS \$function\$.*?\mbegin\M\s*\n)', '\1' || v_guard, 'i');

    -- Refuse to write a body we could not anchor, rather than mangling one.
    if v_new = v_old then
      raise exception 'OD-13 P0c: could not find the opening BEGIN of %', r.sig;
    end if;

    execute v_new;
    n := n + 1;
  end loop;

  raise notice 'OD-13 P0c: % definer functions guarded.', n;
end $guard$;

-- ---------------------------------------------------------------------------
-- 3 · And the grant, which is the half that actually closes anon.
-- ---------------------------------------------------------------------------
do $revoke$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prosecdef
       and (pg_get_functiondef(p.oid) like '%not public.is_staff(auth.uid())%'
            or p.proname in ('list_org_people','list_org_people_detail',
                             'fms_hr_module_user_ids','fms_ocpi_last_contact_for'))
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon',   r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $revoke$;

do $verify$
declare n_anon integer;
begin
  select count(*) into n_anon
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and (pg_get_functiondef(p.oid) like '%not public.is_staff(auth.uid())%'
          or p.proname in ('list_org_people','list_org_people_detail',
                           'fms_hr_module_user_ids','fms_ocpi_last_contact_for'))
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n_anon <> 0 then
    raise exception 'OD-13 P0c: anon can still execute % of the guarded functions', n_anon;
  end if;
  raise notice 'OD-13 P0c verified.';
end $verify$;
