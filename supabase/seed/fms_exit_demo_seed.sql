-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — DEMO SEED.
--
-- Parks one exit case at EVERY stage of the workflow, so every screen, every queue,
-- every panel and every dashboard tile has something real in it, and the module can be
-- clicked through end to end — including the paths that are supposed to REFUSE.
--
-- ---------------------------------------------------------------------------
-- HOW THIS IS BUILT, AND WHY IT MATTERS
--
-- Every state change below goes through THE REAL RPC, called AS THE REAL PERSON
-- (`set_config('request.jwt.claims', …)` makes `auth.uid()` answer, so
-- `fms_exit_can_act()` is genuinely exercised). Nothing is inserted straight into a
-- workflow table. Running this file is therefore itself an end-to-end test of the
-- module: if an authorization rule or a transition guard is wrong, THE SEED FAILS
-- rather than quietly manufacturing a state the app could never reach.
--
-- Raw UPDATEs are used for TWO things only:
--   1. RENUMBERING the cases to the EXIT-DEMO-nn series (the RPC issues the real
--      EXIT-<FY>-nnnn number, because that is what really happens);
--   2. BACKDATING the timestamps the RPCs stamped with now(), so the demo looks aged
--      and some items are genuinely overdue.
-- No workflow state is written by hand.
--
-- ---------------------------------------------------------------------------
-- ⭐ THE MANAGER STEPS, AND WHY THE CAST IS BUILT THE WAY IT IS
--
-- `manager_review`, `asset_return` and `handover` route PER CASE to the case's own
-- `reporting_manager_ids` — there is NO global owner row to impersonate. So every demo
-- case below names, as its reporting manager, somebody who is ALSO in the demo cast
-- (sandbox/personas.ts reads the managers off the visible cases). Without that, three of
-- the sixteen steps would be undemoable no matter how the switcher was written.
--
-- ⚠ TWO OF THE CLEARANCE OWNERS ARE PORTAL ADMINS. Yash Agarwal (CAIO → IT clearance) and
--   Shweta Chanchad (EA → Admin clearance) are the RIGHT people in production, but an
--   admin persona sees everything, so impersonating them does not demonstrate the
--   isolation. Demo that with TANISHA TIKDE (Travel Desk): a non-admin who owns NO
--   workflow step, owns exactly one clearance row, and can see that row and nothing else.
--
-- ---------------------------------------------------------------------------
-- IDENTIFIABLE + REVERSIBLE. Every demo case is numbered EXIT-DEMO-nn.
-- `fms_exit_demo_teardown.sql` deletes exactly those and nothing else, so it can never
-- touch a real exit (which is numbered EXIT-<FY>-nnnn and can never match).
--
-- RE-RUNNABLE: it clears its own EXIT-DEMO-% rows first.
--
-- WHAT IT ALSO WRITES (deliberately, and the teardown deliberately KEEPS):
--   • fms_exit_step_owners     — who owns each workflow step
--   • fms_exit_config          — the process coordinators
--   • fms_exit_clearance_items — the owner_ids on the 8 seeded checklist rows
--   • fms_exit_master_managers — who owns each master (M8)
-- All four are real configuration the module needs to route anything at all. Without
-- them every queue is empty and no non-admin can act. They are left in place on teardown.
--
-- It also leaves TWO PENDING MASTER REQUESTS so the governance review queue is not empty.
-- Those DO carry the demo marker in their payload and ARE removed by the teardown.
--
-- ⚠ THE COUNTER IS HANDED BACK. The RPCs consume EXIT-<FY>-0001…nnnn; the last step of
--   this file DELETES that counter row, so the user's first REAL case is still
--   EXIT-2627-0001 and not EXIT-2627-0017.
--
-- DEPARTMENTS: only departments that already exist are used. Nothing here creates a
-- department, a user, a master row or an app_access grant.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed/fms_exit_demo_seed.sql
-- ===========================================================================

do $$
declare
  -- ---- the cast (real Orange O Tec directory users) --------------------------
  u_riya    uuid := '1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7'; -- Riya Kumari        · HR Head      (HR Head approval · exit interview · COORDINATOR)
  u_khushi  uuid := '9fbe5bd8-e7b3-4e98-a65f-e32df2df9270'; -- Khushi Soni        · HR Executive (HR verification · LWD · clearance · documents · archive)  ← NOT an admin
  u_dharmi  uuid := 'dc36e3ad-e4c6-4b79-8a76-69f5fbd8bcb6'; -- Dharmishtha P.     · HR Executive (HR's asset + handover signature · leave verification)
  u_ritesh  uuid := '79174071-1f03-46dd-bdf7-a6a7d3699877'; -- Ritesh Tulsyan     · CFA          (F&F APPROVAL · Accounts clearance)
  u_bushra  uuid := 'a43038e5-1c05-45b0-b316-9e87bbb2b11b'; -- Bushra             · MIS Head     (payroll inputs · F&F preparation · Payroll clearance)
  u_jyoti   uuid := '261ae1c1-9389-427a-9fa3-1c8df7326f73'; -- Jyoti              · Accounts     (F&F payment)

  -- clearance owners who own NO WORKFLOW STEP AT ALL — the whole point of per-row owners
  u_yash    uuid := '7cd18ada-d6a7-4636-9edd-2f6aeeedd373'; -- Yash Agarwal   · CAIO       → IT clearance      (⚠ portal ADMIN)
  u_shweta  uuid := 'a92994f8-9a5a-44a2-a486-682aad7e934c'; -- Shweta Chanchad· EA         → Admin clearance   (⚠ portal ADMIN)
  u_tanisha uuid := 'e7d30aca-5518-4322-873d-6d5146536c49'; -- Tanisha Tikde  · Travel Desk→ Travel clearance  (⭐ NOT an admin — demo the isolation with her)

  -- reporting managers — they own manager_review / asset_return / handover PER CASE
  u_hari    uuid := '4994aff7-c5c9-48c3-aaa6-2621347d4180'; -- Hariomsharan Dave  · GM, Sales
  u_suhel   uuid := 'a17e65cd-5081-4849-924c-dfa2bb7c175c'; -- Suhel Toorawa      · Dy GM, After Sales service
  u_amit    uuid := 'ad6a594c-0e44-4567-9fbf-2a8842ef87c4'; -- Amit Sharma        · Dy GM, Supply Chain
  u_gorakh  uuid := 'bf873525-22cc-4756-b644-ab5643ca7b01'; -- Gorakh Pawar       · Inventory
  u_hukum   uuid := 'a15ceada-964b-4b8f-a9cc-af74b7177b81'; -- Hukumsingh Rathore · Purchase
  u_pinkesh uuid := '4cad32bb-c836-45b8-a187-ab6b2f10bae3'; -- Pinkesh Shah       · Dy GM, Marketing

  -- the one exiting employee who HAS a portal login — so "My Resignation" is demoable
  u_kaushal uuid := '297d04d9-0b93-48cf-ab27-bb84d472db53'; -- Kaushal Pawar · Jr. Marketing Executive

  -- ---- departments (they must already exist — department_id is a RESTRICT FK) ----
  d_sales   uuid := 'c5664e4b-d573-44f1-9fd0-04fe9d0a388f';
  d_asvc    uuid := '4fbb5659-dca6-4a6a-9fa2-55bdf8a5fe6c';
  d_fin     uuid := 'f64dfa08-103d-45bd-ba29-1079d774b526';
  d_supply  uuid := '1d84dbfa-6c43-4764-8ae5-e7179b42078d';
  d_inv     uuid := 'c5eacc07-5fbf-4717-b2e0-bdc82653d178';
  d_purch   uuid := '9a153c5f-4fc0-4d59-8293-43a8889d558f';
  d_mkt     uuid := '17d0d517-5458-4bfb-a20d-84c1114fc393';

  -- ---- masters (already seeded by M1 — this file creates none) ----------------
  rs_better  uuid; rs_reloc uuid; rs_health uuid; rs_comp uuid; rs_mgr uuid;
  rs_absc    uuid; rs_term  uuid; rs_person uuid;
  ph_notice  uuid; ph_loan  uuid; ph_leave  uuid; ph_incent uuid;

  -- ---- the cases --------------------------------------------------------------
  x01 uuid; x02 uuid; x03 uuid; x04 uuid; x05 uuid; x06 uuid; x07 uuid; x08 uuid;
  x09 uuid; x10 uuid; x11 uuid; x12 uuid; x13 uuid; x14 uuid; x15 uuid; x16 uuid;

  v_fy    text := public.fms_exit_fy_code(current_date);
  rec     record;
  v_doc   uuid;
begin
  -- =========================================================================
  -- 0 · CLEAR ANY PREVIOUS DEMO. Scoped strictly to EXIT-DEMO-%.
  -- =========================================================================
  create temp table _demo_case on commit drop as
    select id from public.fms_exit_cases where exit_no like 'EXIT-DEMO-%';

  -- Activity + notifications are keyed by a LOOSE entity_id (no FK), so nothing would
  -- cascade them — they go first, by id. The entity may be the case OR one of its
  -- satellites, so collect every id that hangs off a demo case.
  delete from public.fms_exit_notifications
   where entity_id in (
     select id from _demo_case
     union select id from public.fms_exit_clearance_checks where case_id in (select id from _demo_case)
     union select id from public.fms_exit_assets            where case_id in (select id from _demo_case)
     union select id from public.fms_exit_documents         where case_id in (select id from _demo_case));
  delete from public.fms_exit_activity
   where entity_id in (
     select id from _demo_case
     union select id from public.fms_exit_clearance_checks where case_id in (select id from _demo_case)
     union select id from public.fms_exit_assets            where case_id in (select id from _demo_case)
     union select id from public.fms_exit_documents         where case_id in (select id from _demo_case));

  -- Everything else hangs off the case by ON DELETE CASCADE.
  delete from public.fms_exit_cases where id in (select id from _demo_case);
  drop table _demo_case;

  -- The demo's own pending master requests (marked, so real ones are never touched).
  delete from public.fms_exit_master_requests where proposed_payload->>'_demo' = 'exit';

  -- =========================================================================
  -- 1 · RESOLVE THE MASTERS (all seeded by M1 — this file creates none).
  -- =========================================================================
  select id into rs_better from public.fms_exit_reasons where name = 'Better opportunity';
  select id into rs_reloc  from public.fms_exit_reasons where name = 'Relocation';
  select id into rs_health from public.fms_exit_reasons where name = 'Health reasons';
  select id into rs_comp   from public.fms_exit_reasons where name = 'Compensation';
  select id into rs_mgr    from public.fms_exit_reasons where name = 'Manager / team';
  select id into rs_person from public.fms_exit_reasons where name = 'Personal reasons';
  select id into rs_absc   from public.fms_exit_reasons where name = 'Absconding';
  select id into rs_term   from public.fms_exit_reasons where name = 'Termination';

  select id into ph_notice from public.fms_exit_payroll_heads where name = 'Notice Recovery';
  select id into ph_loan   from public.fms_exit_payroll_heads where name = 'Loan Recovery';
  select id into ph_leave  from public.fms_exit_payroll_heads where name = 'Leave Encashment';
  select id into ph_incent from public.fms_exit_payroll_heads where name = 'Incentive';

  if rs_better is null or ph_notice is null then
    raise exception 'HR Exit masters are missing — apply 20260714120000_add_fms_exit_foundations.sql first';
  end if;
  if not exists (select 1 from public.fms_exit_clearance_items where active) then
    raise exception 'The clearance checklist master is empty — nothing would be seeded onto a case';
  end if;

  -- =========================================================================
  -- 2 · STEP OWNERS + THE PROCESS COORDINATOR.
  --
  -- Without these NOTHING routes: every queue is empty and no non-admin can act.
  --
  -- ⚠ `resignation` IS ABSENT, and it must be: the DB CHECKs the row away, because
  --   fms_exit_is_exit_staff() — the PII read gate — is "owns any step". Every employee
  --   may raise their own exit; if that were expressed as step ownership, the gate would
  --   be true for the whole company and hand out everyone's salary and exit interview.
  --
  -- ⚠ The three MANAGER steps (manager_review / asset_return / handover) ARE listed, and
  --   that is not a contradiction: access to them is ADDITIVE (the case's own manager OR
  --   the configured owner). asset_return needs an HOD sign AND an HR sign; handover
  --   needs both confirmations; and a manager who never answers must not wedge the case.
  -- =========================================================================
  insert into public.fms_exit_step_owners (step_key, employee_ids) values
    ('manager_review',     array[u_riya]),                 -- co-owner: HR can unblock a silent manager
    ('hr_verification',    array[u_khushi]),
    ('hr_head_approval',   array[u_riya]),
    ('lwd_confirm',        array[u_khushi]),
    ('clearance',          array[u_khushi]),               -- chases the whole list
    ('asset_return',       array[u_dharmi]),               -- HR's signature completes it
    ('handover',           array[u_dharmi]),               -- HR's confirmation completes it
    ('exit_interview',     array[u_riya]),                 -- HR-confidential
    ('leave_verification', array[u_dharmi]),
    ('payroll_inputs',     array[u_bushra]),
    ('fnf_generate',       array[u_bushra]),
    ('fnf_approve',        array[u_ritesh]),
    ('fnf_payment',        array[u_jyoti]),
    ('documents',          array[u_khushi]),
    ('archive',            array[u_khushi])
  on conflict (step_key) do update
    set employee_ids = excluded.employee_ids, updated_at = now();

  -- The HR Head oversees the whole process (Control Center + can unblock any step).
  insert into public.fms_exit_config (key, value)
  values ('process_coordinators', jsonb_build_object('user_ids', to_jsonb(array[u_riya])))
  on conflict (key) do update set value = excluded.value;

  -- =========================================================================
  -- 3 · THE CLEARANCE-ROW OWNERS — the people who own NO WORKFLOW STEP.
  --
  -- This is the config that makes the IT / Admin / Travel-Desk story real: they own one
  -- ROW of a checklist, they appear in no step-owner table, and each of their outstanding
  -- rows is its own queue entry. `manager_kt` is left alone — it routes per case to the
  -- leaver's own reporting manager (owner_is_reporting_manager), which no user id can
  -- express.
  -- =========================================================================
  update public.fms_exit_clearance_items set owner_ids = array[u_yash]    where key = 'it_assets';
  update public.fms_exit_clearance_items set owner_ids = array[u_shweta]  where key = 'admin_assets';
  update public.fms_exit_clearance_items set owner_ids = array[u_tanisha] where key = 'travel_advance';
  update public.fms_exit_clearance_items set owner_ids = array[u_khushi]  where key = 'hr_policy';
  update public.fms_exit_clearance_items set owner_ids = array[u_bushra]  where key = 'payroll_inputs';
  update public.fms_exit_clearance_items set owner_ids = array[u_ritesh]  where key = 'accounts_recovery';
  update public.fms_exit_clearance_items set owner_ids = array[u_dharmi]  where key = 'training_material';

  -- =========================================================================
  -- 4 · MASTER GOVERNANCE (M8) — owners, and a live review queue.
  --
  -- ⭐ KHUSHI SONI IS NOT AN ADMIN. She owns Exit Reasons and the Clearance Checklist, so
  --    she can open the Masters page, edit those two, and resolve Exit Reason requests —
  --    and the other three tabs render read-only, because RLS says so.
  -- ⭐ All FIVE masters are OWNABLE. Only FOUR are REQUESTABLE: the clearance checklist
  --    feeds no dropdown, so it is excluded by the CHECK on fms_exit_master_requests.
  -- =========================================================================
  insert into public.fms_exit_master_managers (master_type, manager_user_id) values
    ('reason',         u_khushi),
    ('clearance_item', u_khushi),   -- ownable, NOT requestable — she edits it on Masters
    ('asset_type',     u_yash),
    ('document_type',  u_riya),
    ('payroll_head',   u_ritesh)
  on conflict (master_type, manager_user_id) do nothing;

  -- Two PENDING requests, so the review queue and the nav badge have something in them.
  -- `_demo` marks them for the teardown; the resolve RPC ignores unknown keys.
  insert into public.fms_exit_master_requests (master_type, proposed_payload, requested_by) values
    ('reason',       jsonb_build_object('name', 'Sabbatical', '_demo', 'exit'),                        u_tanisha),
    ('payroll_head', jsonb_build_object('name', 'Retention Bonus', 'kind', 'addition', '_demo', 'exit'), u_hari);

  -- =========================================================================
  -- 5 · THE CASES — one parked at every stage.
  --     Each is raised BY A REAL PERSON, through fms_exit_raise_case().
  -- =========================================================================

  -- ---- 01 · AWAITING THE REPORTING MANAGER — and OVERDUE (due in 2 working days).
  --      ⭐ SELF-SERVICE, by a portal user who owns no step and manages nobody. This is
  --      the case "My Resignation" renders, and the reason the app is `universal`.
  perform set_config('request.jwt.claims', json_build_object('sub', u_kaushal)::text, true);
  x01 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_user_id', u_kaushal, 'employee_code', 'OOT-2526-0142',
    'employee_name', 'Kaushal Pawar', 'department_id', d_mkt,
    'designation', 'Jr. Marketing Executive', 'date_of_joining', (current_date - 700)::text,
    'reporting_manager_ids', jsonb_build_array(u_pinkesh),
    'reason_id', rs_better,
    'reason_note', 'Offered a brand role at a D2C company in Ahmedabad. Nothing wrong here — it is a step up in scope.'
  ));

  -- ---- 02 · AWAITING HR VERIFICATION (the manager has answered "discuss").
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  x02 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0088', 'employee_name', 'Rakesh Panchal', 'department_id', d_sales,
    'designation', 'Sales Engineer', 'date_of_joining', (current_date - 1100)::text,
    'reporting_manager_ids', jsonb_build_array(u_hari),
    'reason_id', rs_comp, 'reason_note', 'Counter-offer from a competitor at +35%.'
  ));
  perform public.fms_exit_manager_review(x02, 'discuss',
    'Worth a conversation before we let this go — he carries the Pandesara belt. Give me a week.');

  -- ---- 03 · AWAITING THE HR HEAD'S APPROVAL (HR has verified; proposed LWD set).
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  x03 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0061', 'employee_name', 'Sagar Rathod', 'department_id', d_asvc,
    'designation', 'Field Service Technician', 'date_of_joining', (current_date - 500)::text,
    'reporting_manager_ids', jsonb_build_array(u_suhel),
    'reason_id', rs_reloc, 'reason_note', 'Moving back to Delhi for family reasons.'
  ));
  perform public.fms_exit_manager_review(x03, 'accept', 'Accepted. He has been commuting from Delhi since March.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x03, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date + 21)::text,
    'hr_remarks', '30 days from the resignation date. He has 6 days of leave to adjust.'
  ));

  -- ---- 04 · APPROVED — AWAITING THE LAST WORKING DAY (nothing is seeded until it is set).
  perform set_config('request.jwt.claims', json_build_object('sub', u_gorakh)::text, true);
  x04 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0035', 'employee_name', 'Bhavesh Chavda', 'department_id', d_inv,
    'designation', 'Store Keeper', 'date_of_joining', (current_date - 820)::text,
    'reporting_manager_ids', jsonb_build_array(u_gorakh),
    'reason_id', rs_person
  ));
  perform public.fms_exit_manager_review(x04, 'accept', 'Accepted.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x04, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date + 26)::text, 'hr_remarks', 'Standard 30 days.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x04, 'approve', 'Approved. Confirm the last working day and start clearance.');

  -- ---- 05 · MID-CLEARANCE. Some rows ticked, some OVERDUE, one not-applicable, one
  --      pending with a reason. The LWD is in 4 days, so the −1/−2 day rows are red.
  perform set_config('request.jwt.claims', json_build_object('sub', u_amit)::text, true);
  x05 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0104', 'employee_name', 'Nikita Bhalodia', 'department_id', d_supply,
    'designation', 'Dispatch Executive', 'date_of_joining', (current_date - 640)::text,
    'reporting_manager_ids', jsonb_build_array(u_amit),
    'reason_id', rs_better
  ));
  perform public.fms_exit_manager_review(x05, 'accept', 'Accepted, reluctantly.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x05, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date + 4)::text, 'hr_remarks', 'Serving her full notice.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x05, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x05, current_date + 4);   -- ⭐ seeds checks + assets + documents

  -- Each row ticked BY ITS OWN OWNER — which is the point of per-row ownership.
  perform set_config('request.jwt.claims', json_build_object('sub', u_yash)::text, true);
  perform public.fms_exit_toggle_clearance_check(
    (select id from public.fms_exit_clearance_checks where case_id = x05 and item_key = 'it_assets'),
    true, null, null, null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', u_tanisha)::text, true);
  perform public.fms_exit_toggle_clearance_check(
    (select id from public.fms_exit_clearance_checks where case_id = x05 and item_key = 'travel_advance'),
    true, null, null, null, null);
  -- Training material — "if applicable", and it is not: the sheet's own escape hatch.
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_set_clearance_na(
    (select id from public.fms_exit_clearance_checks where case_id = x05 and item_key = 'training_material'),
    'She never attended a training programme — there is nothing issued to return.');
  -- …and one still outstanding, WITH the reason (the sheet's "Reason (If Pending)").
  perform set_config('request.jwt.claims', json_build_object('sub', u_shweta)::text, true);
  perform public.fms_exit_toggle_clearance_check(
    (select id from public.fms_exit_clearance_checks where case_id = x05 and item_key = 'admin_assets'),
    false, null, null, null,
    'Access card handed back; the locker key is with her and she is on leave until Thursday.');

  -- ---- 06 · ASSETS PART-RETURNED. HOD has signed; HR cannot, because one asset is
  --      still pending. One asset is LOST, with a recovery amount against it.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hukum)::text, true);
  x06 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0077', 'employee_name', 'Chirag Bhatt', 'department_id', d_purch,
    'designation', 'Purchase Executive', 'date_of_joining', (current_date - 900)::text,
    'reporting_manager_ids', jsonb_build_array(u_hukum),
    'reason_id', rs_better
  ));
  perform public.fms_exit_manager_review(x06, 'accept', 'Accepted.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x06, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date + 6)::text, 'hr_remarks', 'Full notice.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x06, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x06, current_date + 6);

  -- The manager records what came back. (asset_return is a MANAGER step — he owns it
  -- through reporting_manager_ids, not through the step-owner table.)
  perform set_config('request.jwt.claims', json_build_object('sub', u_hukum)::text, true);
  for rec in
    select a.id, a.name from public.fms_exit_assets a where a.case_id = x06 order by a.sort_order
  loop
    if rec.name = 'Laptop' then
      perform public.fms_exit_update_asset(rec.id, jsonb_build_object(
        'status', 'returned', 'returned_on', (current_date - 1)::text,
        'condition', 'Working. Screen has a scratch on the bezel.'));
    elsif rec.name = 'Mobile' then
      -- ⭐ LOST — and the RPC REFUSES it without an amount or an explicit remark.
      perform public.fms_exit_update_asset(rec.id, jsonb_build_object(
        'status', 'lost', 'recovery_amount', '8500',
        'remarks', 'Handset lost on site in April. Recovering the depreciated value from the F&F.'));
    elsif rec.name in ('ID Card', 'Access Card', 'SIM') then
      perform public.fms_exit_update_asset(rec.id, jsonb_build_object(
        'status', 'returned', 'returned_on', (current_date - 1)::text));
    elsif rec.name = 'Keys' then
      -- STILL PENDING → this is what stops HR signing. Try it: the RPC names the count.
      null;
    else
      perform public.fms_exit_update_asset(rec.id, jsonb_build_object('status', 'not_applicable'));
    end if;
  end loop;
  perform public.fms_exit_sign_assets(x06, 'hod',
    'Everything back except the cabinet keys — he says they are in his drawer.');

  -- ---- 07 · AWAITING THE EXIT INTERVIEW, and the handover awaiting HR's confirmation.
  --      Assets are fully signed off, so the Admin + IT clearance rows AUTO-TICKED.
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  x07 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0019', 'employee_name', 'Vinit Solanki', 'department_id', d_asvc,
    'designation', 'Service Engineer', 'date_of_joining', (current_date - 1300)::text,
    'reporting_manager_ids', jsonb_build_array(u_suhel),
    'reason_id', rs_mgr, 'reason_note', 'Says the shift roster has been unmanageable since January.'
  ));
  perform public.fms_exit_manager_review(x07, 'reject',
    'I would rather keep him — he is the only one certified on the Kyocera heads. But it is his call.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x07, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date + 2)::text, 'hr_remarks', 'Notice served in full.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x07, 'approve', 'Approved. Flag the roster point at the exit interview.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x07, current_date + 2);

  -- assets: everything back → HOD signs → HR signs → ⭐ Admin + IT clearance AUTO-TICK.
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  for rec in select id from public.fms_exit_assets where case_id = x07 loop
    perform public.fms_exit_update_asset(rec.id,
      jsonb_build_object('status', 'returned', 'returned_on', (current_date - 1)::text));
  end loop;
  perform public.fms_exit_sign_assets(x07, 'hod', 'All returned and checked.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_sign_assets(x07, 'hr', 'Verified against the issue register.');

  -- handover: the manager records it and confirms; HR has NOT confirmed → the step is
  -- still open, and the Reporting-Manager clearance row is still outstanding.
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  perform public.fms_exit_record_handover(x07, jsonb_build_object(
    'handover_to_name', 'Afrin Saiyed', 'kt_done', true,
    'kt_remarks', 'Two days of joint calls on the Sachin belt. He has written up the printhead SOP.',
    'notes', 'Open calls transferred: 14. Two AMC renewals due this month are flagged.'));
  perform public.fms_exit_confirm_handover(x07, 'manager', 'Work is with Afrin. Nothing left hanging.');

  -- =========================================================================
  -- 6 · THE SETTLEMENT LADDER — one case parked at each rung.
  --     A shared helper would hide the guards; each is walked explicitly.
  -- =========================================================================

  -- ---- 08 · AWAITING THE F&F (leave verified, payroll recorded — its inputs exist).
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  x08 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0052', 'employee_name', 'Devang Modi', 'department_id', d_sales,
    'designation', 'Area Sales Manager', 'date_of_joining', (current_date - 1500)::text,
    'reporting_manager_ids', jsonb_build_array(u_hari), 'reason_id', rs_better));
  perform public.fms_exit_manager_review(x08, 'accept', 'Accepted.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x08, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date - 5)::text, 'hr_remarks', 'Full notice served.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x08, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x08, current_date - 5);   -- he has already left
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_verify_leave(x08, jsonb_build_object(
    'leave_balance_days', '11.5', 'lwp_days', '0', 'encashable_days', '11.5',
    'leave_remarks', 'Balance as at the last working day. Nothing carried from last year.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x08, jsonb_build_object(
    'lwp_completed', true, 'notice_recovery_days', '0', 'incentive_amount', '18000',
    'loan_recovery_amount', '0', 'other_deductions', '0',
    'payroll_remarks', 'Q1 incentive was approved but unpaid — it belongs in the F&F.',
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_leave::text,  'head_name', 'Leave Encashment', 'kind', 'addition',  'amount', '26450', 'remarks', '11.5 days'),
      jsonb_build_object('head_id', ph_incent::text, 'head_name', 'Incentive',        'kind', 'addition',  'amount', '18000', 'remarks', 'Q1, approved'))));

  -- ---- 09 · F&F GENERATED, AWAITING APPROVAL (the CFA's queue).
  perform set_config('request.jwt.claims', json_build_object('sub', u_gorakh)::text, true);
  x09 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0028', 'employee_name', 'Alpesh Vaghela', 'department_id', d_inv,
    'designation', 'Inventory Assistant', 'date_of_joining', (current_date - 1000)::text,
    'reporting_manager_ids', jsonb_build_array(u_gorakh), 'reason_id', rs_health));
  perform public.fms_exit_manager_review(x09, 'accept', 'Accepted — health grounds.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x09, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', true, 'policy_applicable', true,
    'proposed_lwd', (current_date - 12)::text,
    'hr_remarks', 'Notice waived on medical grounds — see the certificate on file.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x09, 'approve', 'Approved, notice waived.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x09, current_date - 12);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_verify_leave(x09, jsonb_build_object(
    'leave_balance_days', '4', 'lwp_days', '3', 'encashable_days', '4', 'leave_remarks', '3 days LWP in June.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x09, jsonb_build_object(
    'lwp_completed', true, 'notice_recovery_days', '0', 'loan_recovery_amount', '12000',
    'payroll_remarks', 'Staff advance of ₹12,000 outstanding.',
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_leave::text, 'head_name', 'Leave Encashment', 'kind', 'addition',  'amount', '6200'),
      jsonb_build_object('head_id', ph_loan::text,  'head_name', 'Loan Recovery',    'kind', 'deduction', 'amount', '12000', 'remarks', 'Staff advance, Feb'))));
  perform public.fms_exit_generate_fnf(x09, jsonb_build_object(
    'fnf_amount', '31400', 'fnf_remarks', 'Net payable after the advance recovery. Working attached.'));

  -- ---- 10 · F&F APPROVED, AWAITING PAYMENT. ⭐ The leaver can now read their own
  --      settlement (and could not, five minutes ago).
  perform set_config('request.jwt.claims', json_build_object('sub', u_amit)::text, true);
  x10 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'end_of_contract',
    'employee_code', 'OOT-2526-0091', 'employee_name', 'Manali Trivedi', 'department_id', d_supply,
    'designation', 'Logistics Coordinator (Contract)', 'date_of_joining', (current_date - 380)::text,
    'reporting_manager_ids', jsonb_build_array(u_amit), 'reason_id', rs_person,
    'reason_note', 'Fixed-term contract; not being renewed.'));
  perform public.fms_exit_manager_review(x10, 'accept', 'Contract ends. Nothing to review.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x10, jsonb_build_object(
    'notice_period_days', '0', 'notice_waived', false, 'policy_applicable', false,
    'policy_na_reason', 'Fixed-term contract — the notice policy does not apply to a non-renewal.',
    'proposed_lwd', (current_date - 20)::text, 'hr_remarks', 'Contract end date.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x10, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x10, current_date - 20);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_verify_leave(x10, jsonb_build_object(
    'leave_balance_days', '2', 'lwp_days', '0', 'encashable_days', '2'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x10, jsonb_build_object(
    'lwp_completed', true,
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_leave::text, 'head_name', 'Leave Encashment', 'kind', 'addition', 'amount', '3800'))));
  perform public.fms_exit_generate_fnf(x10, jsonb_build_object(
    'fnf_amount', '48300', 'fnf_remarks', 'Final month + leave encashment.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_ritesh)::text, true);
  perform public.fms_exit_approve_fnf(x10, true, 'Checked against the contract. Approved for release.');

  -- ---- 11 · F&F PAID, AWAITING THE DOCUMENTS.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hukum)::text, true);
  x11 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0044', 'employee_name', 'Rohan Mehta', 'department_id', d_purch,
    'designation', 'Purchase Assistant', 'date_of_joining', (current_date - 1250)::text,
    'reporting_manager_ids', jsonb_build_array(u_hukum), 'reason_id', rs_better));
  perform public.fms_exit_manager_review(x11, 'accept', 'Accepted.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x11, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date - 30)::text));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x11, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x11, current_date - 30);
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_verify_leave(x11, jsonb_build_object(
    'leave_balance_days', '7', 'lwp_days', '0', 'encashable_days', '7'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x11, jsonb_build_object('lwp_completed', true,
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_leave::text, 'head_name', 'Leave Encashment', 'kind', 'addition', 'amount', '14200'))));
  perform public.fms_exit_generate_fnf(x11, jsonb_build_object('fnf_amount', '52700'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_ritesh)::text, true);
  perform public.fms_exit_approve_fnf(x11, true, 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_jyoti)::text, true);
  -- ⭐ The employee's own copy goes under share/ — the RPC refuses any other prefix.
  perform public.fms_exit_release_fnf_payment(x11, jsonb_build_object(
    'fnf_payment_mode', 'NEFT', 'fnf_payment_ref', 'HDFC/N123456789',
    'fnf_paid_on', (current_date - 6)::text,
    'final_fnf_path', 'cases/' || x11::text || '/share/final-fnf-rohan-mehta.pdf',
    'final_fnf_name', 'Full & Final Statement — Rohan Mehta.pdf'));

  -- ---- 12 · ⭐ DOCUMENTS ISSUED, ONE ACKNOWLEDGEMENT STILL MISSING → **ARCHIVE REFUSES**.
  --      This is the commonest real failure of an exit — letters out, signature never
  --      back — and it is the whole reason `documents` and `archive` are two steps.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  x12 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0013', 'employee_name', 'Priyanka Shah', 'department_id', d_sales,
    'designation', 'Inside Sales Executive', 'date_of_joining', (current_date - 1600)::text,
    'reporting_manager_ids', jsonb_build_array(u_hari), 'reason_id', rs_reloc));
  perform public.fms_exit_manager_review(x12, 'accept', 'Accepted.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x12, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date - 45)::text));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x12, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x12, current_date - 45);
  -- Clearance fully done, and the assets signed off — so the ONLY thing the archive can
  -- refuse on is the acknowledgement that never came back. That is the point of the case.
  for rec in select id from public.fms_exit_clearance_checks where case_id = x12 loop
    perform public.fms_exit_toggle_clearance_check(rec.id, true, null, null, null, null);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  for rec in select id from public.fms_exit_assets where case_id = x12 loop
    perform public.fms_exit_update_asset(rec.id,
      jsonb_build_object('status', 'returned', 'returned_on', (current_date - 46)::text));
  end loop;
  perform public.fms_exit_sign_assets(x12, 'hod', 'All returned.');
  perform public.fms_exit_record_handover(x12, jsonb_build_object(
    'handover_to_name', 'Sneha Ramani', 'kt_done', true, 'kt_remarks', 'Account list and open quotations handed over.'));
  perform public.fms_exit_confirm_handover(x12, 'manager', 'Confirmed.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_sign_assets(x12, 'hr', 'Verified.');
  perform public.fms_exit_confirm_handover(x12, 'hr', 'Confirmed.');
  perform public.fms_exit_verify_leave(x12, jsonb_build_object(
    'leave_balance_days', '9', 'lwp_days', '0', 'encashable_days', '9'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x12, jsonb_build_object('lwp_completed', true,
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_leave::text, 'head_name', 'Leave Encashment', 'kind', 'addition', 'amount', '19800'))));
  perform public.fms_exit_generate_fnf(x12, jsonb_build_object('fnf_amount', '61200'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_ritesh)::text, true);
  perform public.fms_exit_approve_fnf(x12, true, 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_jyoti)::text, true);
  perform public.fms_exit_release_fnf_payment(x12, jsonb_build_object(
    'fnf_payment_mode', 'NEFT', 'fnf_payment_ref', 'HDFC/N987654321',
    'fnf_paid_on', (current_date - 20)::text,
    'final_fnf_path', 'cases/' || x12::text || '/share/final-fnf-priyanka-shah.pdf',
    'final_fnf_name', 'Full & Final Statement — Priyanka Shah.pdf'));

  -- HR issues every letter…
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_issue_documents(x12, jsonb_build_object(
    'documents', (
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'issued_on', (current_date - 15)::text,
        -- ⭐ share/ — the ONE prefix the leaver can read. The RPC refuses any other.
        'file_path', 'cases/' || x12::text || '/share/' || d.id::text || '.pdf',
        'file_name', d.name || ' — Priyanka Shah.pdf'))
      from public.fms_exit_documents d where d.case_id = x12)));
  -- …and the acknowledgement comes back for all but ONE. Archive will name it.
  for rec in
    select id, name from public.fms_exit_documents where case_id = x12 and name <> 'Relieving Letter'
  loop
    perform public.fms_exit_record_ack(x12, rec.id, jsonb_build_object(
      'handed_over_on', (current_date - 12)::text,
      'ack_signed_path', 'cases/' || x12::text || '/share/ack-' || rec.id::text || '.pdf',
      'ack_signed_name', 'Signed acknowledgement — ' || rec.name || '.pdf'));
  end loop;

  -- ---- 13 · FULLY ARCHIVED — every guard satisfied, and it leaves every queue.
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  x13 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2425-0007', 'employee_name', 'Jignesh Rathod', 'department_id', d_asvc,
    'designation', 'Senior Service Engineer', 'date_of_joining', (current_date - 2200)::text,
    'reporting_manager_ids', jsonb_build_array(u_suhel), 'reason_id', rs_better));
  perform public.fms_exit_manager_review(x13, 'accept', 'Accepted.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x13, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', true,
    'proposed_lwd', (current_date - 90)::text));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x13, 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x13, current_date - 90);

  -- every clearance row done (the step owner may tick the whole list — that is their job)
  for rec in select id from public.fms_exit_clearance_checks where case_id = x13 loop
    perform public.fms_exit_toggle_clearance_check(rec.id, true, null, null, null, null);
  end loop;
  -- assets in, both signatures
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  for rec in select id from public.fms_exit_assets where case_id = x13 loop
    perform public.fms_exit_update_asset(rec.id,
      jsonb_build_object('status', 'returned', 'returned_on', (current_date - 91)::text));
  end loop;
  perform public.fms_exit_sign_assets(x13, 'hod', 'All returned.');
  perform public.fms_exit_record_handover(x13, jsonb_build_object(
    'handover_to_name', 'Vinit Mishra', 'kt_done', true, 'kt_remarks', 'Full KT over two weeks.'));
  perform public.fms_exit_confirm_handover(x13, 'manager', 'Confirmed.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_sign_assets(x13, 'hr', 'Verified.');
  perform public.fms_exit_confirm_handover(x13, 'hr', 'Confirmed.');
  -- the exit interview (HR-confidential — the manager cannot read a word of it)
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_record_interview(x13, jsonb_build_object(
    'conducted_by', u_riya::text, 'conducted_on', (current_date - 92)::text,
    'primary_reason_id', rs_comp::text,   -- ⭐ NOT the reason on the letter. The gap is the finding.
    'would_rehire', 'true',
    'remarks', 'Says the letter reason was "better opportunity" but it was really the money — he had asked twice.',
    'feedback', jsonb_build_object('ratings', jsonb_build_object('manager', 4, 'workload', 3, 'growth', 2),
                                   'what_would_have_kept', 'A revision at the two-year mark.'),
    'portal_feedback_done', true));
  -- the settlement
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_verify_leave(x13, jsonb_build_object(
    'leave_balance_days', '14', 'lwp_days', '0', 'encashable_days', '14'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x13, jsonb_build_object('lwp_completed', true,
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_leave::text, 'head_name', 'Leave Encashment', 'kind', 'addition', 'amount', '38900'))));
  perform public.fms_exit_generate_fnf(x13, jsonb_build_object('fnf_amount', '96400'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_ritesh)::text, true);
  perform public.fms_exit_approve_fnf(x13, true, 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_jyoti)::text, true);
  perform public.fms_exit_release_fnf_payment(x13, jsonb_build_object(
    'fnf_payment_mode', 'NEFT', 'fnf_payment_ref', 'HDFC/N445566778',
    'fnf_paid_on', (current_date - 75)::text,
    'final_fnf_path', 'cases/' || x13::text || '/share/final-fnf-jignesh-rathod.pdf',
    'final_fnf_name', 'Full & Final Statement — Jignesh Rathod.pdf'));
  -- the letters out, every acknowledgement back → archive is finally allowed
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_issue_documents(x13, jsonb_build_object(
    'documents', (
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'issued_on', (current_date - 70)::text,
        'file_path', 'cases/' || x13::text || '/share/' || d.id::text || '.pdf',
        'file_name', d.name || ' — Jignesh Rathod.pdf'))
      from public.fms_exit_documents d where d.case_id = x13)));
  for rec in select id, name from public.fms_exit_documents where case_id = x13 loop
    perform public.fms_exit_record_ack(x13, rec.id, jsonb_build_object(
      'handed_over_on', (current_date - 66)::text,
      'ack_signed_path', 'cases/' || x13::text || '/share/ack-' || rec.id::text || '.pdf',
      'ack_signed_name', 'Signed acknowledgement — ' || rec.name || '.pdf'));
  end loop;
  perform public.fms_exit_archive_case(x13,
    jsonb_build_object('remarks', 'Closed. Records filed; system access revoked on the LWD.'));

  -- ---- 14 · ON HOLD. ⭐ A STATUS, NEVER A STEP: it leaves every queue and every red
  --      count, and shows on the Dashboard's held strip with a days-parked count.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  x14 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0066', 'employee_name', 'Hardik Solanki', 'department_id', d_sales,
    'designation', 'Key Account Manager', 'date_of_joining', (current_date - 950)::text,
    'reporting_manager_ids', jsonb_build_array(u_hari), 'reason_id', rs_comp));
  perform public.fms_exit_manager_review(x14, 'discuss', 'Management want to counter-offer. Hold it.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_hold_case(x14, true,
    'Parked at the Directors'' request while a counter-offer is put together. Review on the 25th.');

  -- ---- 15 · WITHDRAWN. The employee changed their mind — a terminal status, and the
  --      employee_code is freed (the one-open-case index excludes withdrawn).
  perform set_config('request.jwt.claims', json_build_object('sub', u_gorakh)::text, true);
  x15 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'resignation',
    'employee_code', 'OOT-2526-0031', 'employee_name', 'Ankit Chauhan', 'department_id', d_inv,
    'designation', 'Warehouse Assistant', 'date_of_joining', (current_date - 430)::text,
    'reporting_manager_ids', jsonb_build_array(u_gorakh), 'reason_id', rs_person));
  perform public.fms_exit_manager_review(x15, 'reject', 'I would rather he stayed. Let me talk to him.');
  perform public.fms_exit_withdraw_case(x15,
    'Withdrew after the conversation with Gorakh — the shift issue has been sorted out.');

  -- ---- 16 · ⭐ ABSCONDING — the case_type that opens real holes, closed by SKIPS.
  --      No handover (he is not here to give one), no exit interview (he will not sit
  --      one), no relieving letter. A SKIPPED STEP IS COMPLETE-WITH-A-REASON: it leaves
  --      the queues, greys out on the stepper, and SATISFIES the downstream guards — so
  --      the case archives cleanly instead of being wedged open forever.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hukum)::text, true);
  x16 := public.fms_exit_raise_case(jsonb_build_object(
    'case_type', 'absconding',
    'employee_code', 'OOT-2526-0099', 'employee_name', 'Farhan Shaikh', 'department_id', d_purch,
    'designation', 'Purchase Assistant', 'date_of_joining', (current_date - 260)::text,
    'reporting_manager_ids', jsonb_build_array(u_hukum), 'reason_id', rs_absc,
    'reason_note', 'Last present on the 14th. No contact since; two registered letters returned.'));
  perform public.fms_exit_manager_review(x16, 'accept', 'Absconding. Last day present was the 14th.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_hr_verify(x16, jsonb_build_object(
    'notice_period_days', '30', 'notice_waived', false, 'policy_applicable', false,
    'policy_na_reason', 'Absconding — the notice policy cannot be served on someone who is not here.',
    'proposed_lwd', (current_date - 55)::text,
    'hr_remarks', 'LWD = the last day he was actually present.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_decide_case(x16, 'approve', 'Approved as an absconding exit.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_exit_confirm_lwd(x16, current_date - 55);

  -- The skips — each one a real hole, each one waived by the coordinator WITH A REASON.
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_skip_step(x16, 'handover',       'He never came back — there is nobody to hand over from.');
  perform public.fms_exit_skip_step(x16, 'exit_interview', 'Absconding. No contact since the 14th; two letters returned undelivered.');
  perform public.fms_exit_skip_step(x16, 'clearance',      'Nothing can be cleared with him — the assets are written off below.');
  perform public.fms_exit_skip_step(x16, 'asset_return',   'Assets not recoverable; the laptop is being recovered from the F&F.');
  perform public.fms_exit_skip_step(x16, 'fnf_payment',    'Nothing is payable — the recovery exceeds the dues. No payment to release.');

  -- The money is still worked out (there is a recovery), and the documents are still
  -- issued — but only the ones that apply: no relieving letter for an absconder.
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_exit_verify_leave(x16, jsonb_build_object(
    'leave_balance_days', '0', 'lwp_days', '18', 'encashable_days', '0',
    'leave_remarks', '18 days LWP from the 14th to the last-working-day cut-off.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_bushra)::text, true);
  perform public.fms_exit_record_payroll_inputs(x16, jsonb_build_object(
    'lwp_completed', true, 'notice_recovery_days', '30', 'notice_recovery_amount', '24000',
    'payroll_remarks', 'Notice recovery + the laptop. Nothing is payable; a demand letter has gone out.',
    'lines', jsonb_build_array(
      jsonb_build_object('head_id', ph_notice::text, 'head_name', 'Notice Recovery', 'kind', 'deduction', 'amount', '24000'),
      jsonb_build_object('head_name', 'Asset Loss Recovery', 'kind', 'deduction', 'amount', '35000', 'remarks', 'Laptop, not returned'))));
  perform public.fms_exit_generate_fnf(x16, jsonb_build_object(
    'fnf_amount', '0', 'fnf_remarks', 'Nil payable — recoveries of ₹59,000 exceed the dues. Demand letter issued.'));
  perform set_config('request.jwt.claims', json_build_object('sub', u_ritesh)::text, true);
  perform public.fms_exit_approve_fnf(x16, true, 'Approved. Nil settlement; the recovery goes to Legal.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  -- Only the F&F statement + NOC go out. The relieving letter never issues, and the
  -- archive does NOT demand an acknowledgement for a letter that was never sent.
  perform public.fms_exit_issue_documents(x16, jsonb_build_object(
    'documents', (
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'issued_on', (current_date - 30)::text,
        'file_path', 'cases/' || x16::text || '/share/' || d.id::text || '.pdf',
        'file_name', d.name || ' — Farhan Shaikh.pdf',
        'remarks', 'Posted to the address on file.'))
      from public.fms_exit_documents d
      where d.case_id = x16 and d.name in ('Full & Final Statement', 'NOC'))));
  -- …so `documents` is NOT complete (two letters carry no date) — which is honest. The
  -- archive would name them, so the step itself is waived, with the reason.
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_exit_skip_step(x16, 'documents',
    'No experience or relieving letter is issued to an absconding employee. The F&F statement and NOC were posted.');
  -- The acks for what WAS issued still have to come back — they did, by post.
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  for rec in select id, name from public.fms_exit_documents where case_id = x16 and issued_on is not null loop
    perform public.fms_exit_record_ack(x16, rec.id, jsonb_build_object(
      'handed_over_on', (current_date - 24)::text,
      'ack_signed_path', 'cases/' || x16::text || '/share/ack-' || rec.id::text || '.pdf',
      'ack_signed_name', 'Postal acknowledgement — ' || rec.name || '.pdf'));
  end loop;
  perform public.fms_exit_archive_case(x16, jsonb_build_object(
    'remarks', 'Archived as absconding. Recovery of ₹59,000 handed to Legal; access revoked on the LWD.'));

  -- =========================================================================
  -- 7 · RENUMBER TO THE DEMO SERIES + BACKDATE.
  --
  -- Everything above was stamped now() by the RPCs, because that is what really
  -- happened. Here — and ONLY here — the demo is aged with raw UPDATEs, so the overdue
  -- paths and the SLA colours have something to show. No workflow state is written.
  -- =========================================================================
  update public.fms_exit_cases c set
    exit_no      = t.no,
    submitted_at = t.sub,
    created_at   = t.sub,
    -- Every other stamp is shifted by the same interval, so the ORDER of events is
    -- preserved exactly as the RPCs recorded it. A per-column table would be 20 columns
    -- wide and would drift from the guards the moment one of them changed.
    manager_reviewed_at    = c.manager_reviewed_at    - (now() - t.sub),
    discussed_at           = c.discussed_at           - (now() - t.sub),
    hr_verified_at         = c.hr_verified_at         - (now() - t.sub),
    approved_at            = c.approved_at            - (now() - t.sub),
    lwd_confirmed_at       = c.lwd_confirmed_at       - (now() - t.sub),
    clearance_completed_at = c.clearance_completed_at - (now() - t.sub),
    assets_hod_signed_at   = c.assets_hod_signed_at   - (now() - t.sub),
    assets_hr_signed_at    = c.assets_hr_signed_at    - (now() - t.sub),
    assets_returned_at     = c.assets_returned_at     - (now() - t.sub),
    handover_completed_at  = c.handover_completed_at  - (now() - t.sub),
    interview_done_at      = c.interview_done_at      - (now() - t.sub),
    leave_verified_at      = c.leave_verified_at      - (now() - t.sub),
    payroll_done_at        = c.payroll_done_at        - (now() - t.sub),
    fnf_generated_at       = c.fnf_generated_at       - (now() - t.sub),
    fnf_approved_at        = c.fnf_approved_at        - (now() - t.sub),
    fnf_paid_at            = c.fnf_paid_at            - (now() - t.sub),
    documents_issued_at    = c.documents_issued_at    - (now() - t.sub),
    archived_at            = c.archived_at            - (now() - t.sub),
    withdrawn_at           = c.withdrawn_at           - (now() - t.sub),
    hold_at                = c.hold_at                - (now() - t.sub)
  from (values
    -- id    no               submitted_at (the resignation date)
    (x01, 'EXIT-DEMO-01', now() -   6 * interval '1 day'),   -- manager review — OVERDUE (2-day TAT)
    (x02, 'EXIT-DEMO-02', now() -   4 * interval '1 day'),   -- HR verification
    (x03, 'EXIT-DEMO-03', now() -   9 * interval '1 day'),   -- HR Head approval
    (x04, 'EXIT-DEMO-04', now() -   4 * interval '1 day'),   -- LWD confirmation
    (x05, 'EXIT-DEMO-05', now() -  26 * interval '1 day'),   -- mid-clearance
    (x06, 'EXIT-DEMO-06', now() -  24 * interval '1 day'),   -- assets part-returned
    (x07, 'EXIT-DEMO-07', now() -  28 * interval '1 day'),   -- interview + handover open
    (x08, 'EXIT-DEMO-08', now() -  35 * interval '1 day'),   -- awaiting the F&F
    (x09, 'EXIT-DEMO-09', now() -  42 * interval '1 day'),   -- F&F awaiting approval
    (x10, 'EXIT-DEMO-10', now() -  50 * interval '1 day'),   -- F&F awaiting payment
    (x11, 'EXIT-DEMO-11', now() -  60 * interval '1 day'),   -- awaiting the documents
    (x12, 'EXIT-DEMO-12', now() -  75 * interval '1 day'),   -- ⭐ archive REFUSES (no ack)
    (x13, 'EXIT-DEMO-13', now() - 120 * interval '1 day'),   -- archived
    (x14, 'EXIT-DEMO-14', now() -  18 * interval '1 day'),   -- ON HOLD (18 days parked)
    (x15, 'EXIT-DEMO-15', now() -  12 * interval '1 day'),   -- withdrawn
    (x16, 'EXIT-DEMO-16', now() -  85 * interval '1 day')    -- absconding, archived
  ) as t(id, no, sub)
  where c.id = t.id;

  -- The satellites follow their case, so the trail reads in order.
  update public.fms_exit_clearance_checks k set
    created_at = c.lwd_confirmed_at,
    done_at    = case when k.done_at is null then null
                      else c.lwd_confirmed_at + (k.sort_order * interval '8 hours') end
  from public.fms_exit_cases c
  where c.id = k.case_id and c.exit_no like 'EXIT-DEMO-%' and c.lwd_confirmed_at is not null;

  update public.fms_exit_assets a set created_at = c.lwd_confirmed_at
  from public.fms_exit_cases c
  where c.id = a.case_id and c.exit_no like 'EXIT-DEMO-%' and c.lwd_confirmed_at is not null;

  update public.fms_exit_documents d set created_at = c.lwd_confirmed_at
  from public.fms_exit_cases c
  where c.id = d.case_id and c.exit_no like 'EXIT-DEMO-%' and c.lwd_confirmed_at is not null;

  update public.fms_exit_handover h set
    manager_confirmed_at = h.manager_confirmed_at - (now() - c.submitted_at),
    hr_confirmed_at      = h.hr_confirmed_at      - (now() - c.submitted_at)
  from public.fms_exit_cases c
  where c.id = h.case_id and c.exit_no like 'EXIT-DEMO-%';

  -- The activity trail + the bell, so nothing is dated in the future of its own case.
  update public.fms_exit_activity a set created_at = c.submitted_at + interval '1 hour'
  from public.fms_exit_cases c
  where c.exit_no like 'EXIT-DEMO-%'
    and a.entity_id in (
      select c.id
      union select k.id from public.fms_exit_clearance_checks k where k.case_id = c.id
      union select s.id from public.fms_exit_assets s            where s.case_id = c.id
      union select d.id from public.fms_exit_documents d         where d.case_id = c.id);

  -- =========================================================================
  -- 8 · HAND THE REAL SERIES BACK.
  --
  -- The RPCs consumed EXIT-<FY>-0001…0016. Nothing is left holding one of those numbers
  -- (every demo case was renamed above), so DROP the counter: the user's first REAL exit
  -- case is numbered EXIT-<FY>-0001, not EXIT-<FY>-0017.
  -- =========================================================================
  delete from public.fms_exit_counters where scope = 'EXIT-' || v_fy;

  raise notice 'HR Exit demo seeded: 16 cases (EXIT-DEMO-01 … EXIT-DEMO-16), % clearance rows, % assets, % documents.',
    (select count(*) from public.fms_exit_clearance_checks k join public.fms_exit_cases c on c.id = k.case_id where c.exit_no like 'EXIT-DEMO-%'),
    (select count(*) from public.fms_exit_assets a            join public.fms_exit_cases c on c.id = a.case_id where c.exit_no like 'EXIT-DEMO-%'),
    (select count(*) from public.fms_exit_documents d         join public.fms_exit_cases c on c.id = d.case_id where c.exit_no like 'EXIT-DEMO-%');
  raise notice 'Step owners, coordinators, clearance-row owners and master owners were written and are LEFT IN PLACE on teardown (they are real config).';
  raise notice 'The EXIT-%% counter was reset — the first real case will still be EXIT-%-0001.', v_fy;
end $$;
