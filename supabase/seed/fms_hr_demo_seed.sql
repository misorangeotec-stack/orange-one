-- ===========================================================================
-- HR Recruitment FMS — DEMO SEED.
--
-- Parks one requisition at EVERY stage of the workflow so that every screen,
-- every queue, every Kanban column and every dashboard panel has something real
-- in it, and so the module can be clicked through end to end.
--
-- ---------------------------------------------------------------------------
-- HOW THIS IS BUILT, AND WHY IT MATTERS
--
-- Every state change below goes through THE REAL RPC, called AS THE REAL PERSON
-- (`set_config('request.jwt.claims', …)` makes `auth.uid()` answer, so
-- `fms_hr_can_act()` is genuinely exercised). Nothing is inserted straight into a
-- workflow table. That means running this file is itself an end-to-end test of the
-- module: if an authorization rule or a transition guard is wrong, the seed fails
-- rather than quietly manufacturing a state the app could never reach.
--
-- Raw UPDATEs are used for ONE thing only: BACKDATING the timestamps the RPCs
-- stamped with now(), so the demo looks aged and some items are genuinely overdue.
-- Everything else is the workflow doing its own work.
-- ---------------------------------------------------------------------------
--
-- IDENTIFIABLE + REVERSIBLE. Every demo requisition is numbered MRF-DEMO-nn and
-- every demo candidate CAN-DEMO-nn. `fms_hr_demo_teardown.sql` deletes exactly
-- those and nothing else, so it can never touch real recruitment data.
--
-- RE-RUNNABLE: it clears its own MRF-DEMO-% rows first.
--
-- WHAT IT ALSO WRITES (deliberately, and the teardown deliberately KEEPS):
--   • fms_hr_step_owners     — who owns each step
--   • fms_hr_config          — the process coordinators
-- Both are real configuration the module needs to route anything at all. Without
-- them every queue is empty. They are left in place on teardown.
--
-- DEPARTMENTS: only departments that already exist are used (Sales, After Sales
-- service, Accounting & Finance, Quality Lab, Supply Chain, Inventory, Purchase).
-- Nothing here creates a department, a location, a user or an app_access grant.
-- ===========================================================================

do $$
declare
  -- ---- the cast (real Orange O Tec directory users) --------------------------
  u_riya    uuid := '1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7'; -- Riya Kumari        · HR Head        (approves the MRF, runs Round 1, makes the offer)
  u_khushi  uuid := '9fbe5bd8-e7b3-4e98-a65f-e32df2df9270'; -- Khushi Soni        · HR Executive   (posts the job, collects CVs, shares with the HOD)
  u_dharmi  uuid := 'dc36e3ad-e4c6-4b79-8a76-69f5fbd8bcb6'; -- Dharmishtha P.     · HR Executive   (screens CVs, runs onboarding)
  u_karan   uuid := 'e3977634-30a3-4a1e-9d5f-4db93b327457'; -- Karan Toshniwal    · Director       (Management approval)
  u_aayush  uuid := '853f57a4-fd21-4730-9666-09c2855fc815'; -- Aayush Rathi       · Director       (Management approval)
  u_nakul   uuid := '2d75ca4e-dac9-45e2-82bc-d379bc5d6fc4'; -- Nakuleshwar Sharma · Director-Sales (Round 3)

  -- hiring managers — the HOD who raises the MRF owns every HOD step ON IT
  u_hari    uuid := '4994aff7-c5c9-48c3-aaa6-2621347d4180'; -- Hariomsharan Dave  · GM, Sales
  u_suhel   uuid := 'a17e65cd-5081-4849-924c-dfa2bb7c175c'; -- Suhel Toorawa      · Dy GM, After Sales service
  u_ritesh  uuid := '79174071-1f03-46dd-bdf7-a6a7d3699877'; -- Ritesh Tulsyan     · CFA, Accounting & Finance
  u_sushil  uuid := 'b529fd21-b0a9-4952-9ffe-e96f487a410f'; -- Sushil Thakre      · Quality Lab
  u_amit    uuid := 'ad6a594c-0e44-4567-9fbf-2a8842ef87c4'; -- Amit Sharma        · Dy GM, Supply Chain
  u_gorakh  uuid := 'bf873525-22cc-4756-b644-ab5643ca7b01'; -- Gorakh Pawar       · Inventory
  u_hukum   uuid := 'a15ceada-964b-4b8f-a9cc-af74b7177b81'; -- Hukumsingh Rathore · Purchase

  -- ---- masters ---------------------------------------------------------------
  d_sales   uuid := 'c5664e4b-d573-44f1-9fd0-04fe9d0a388f';
  d_asvc    uuid := '4fbb5659-dca6-4a6a-9fa2-55bdf8a5fe6c';
  d_fin     uuid := 'f64dfa08-103d-45bd-ba29-1079d774b526';
  d_qlab    uuid := '995a7fea-0bf5-49ea-8bab-2ae9546a56a6';
  d_supply  uuid := '1d84dbfa-6c43-4764-8ae5-e7179b42078d';
  d_inv     uuid := 'c5eacc07-5fbf-4717-b2e0-bdc82653d178';
  d_purch   uuid := '9a153c5f-4fc0-4d59-8293-43a8889d558f';

  l_althan  uuid; l_sachin uuid; l_delhi uuid;
  jt_full   uuid; jt_contract uuid;
  pf_portal uuid; pf_career uuid; pf_linkedin uuid; pf_naukri uuid; pf_referral uuid; pf_consult uuid;
  dq_salary uuid; dq_failed uuid; dq_skills uuid;

  -- ---- requisitions ----------------------------------------------------------
  r01 uuid; r02 uuid; r03 uuid; r04 uuid; r05 uuid; r06 uuid;
  r07 uuid; r08 uuid; r09 uuid; r10 uuid; r11 uuid; r12 uuid;

  -- ---- candidates ------------------------------------------------------------
  c01 uuid; c02 uuid; c03 uuid; c04 uuid; c05 uuid; c06 uuid; c07 uuid;
  c08 uuid; c09 uuid; c10 uuid; c11 uuid; c12 uuid; c13 uuid;
  c14 uuid; c15 uuid; c16 uuid;
  c17 uuid; c18 uuid; c19 uuid; c20 uuid; c21 uuid; c22 uuid;

  o_id  uuid;
  p_id  uuid;
  rec   record;
begin
  -- =========================================================================
  -- 0 · CLEAR ANY PREVIOUS DEMO. Scoped strictly to MRF-DEMO-% / CAN-DEMO-%.
  -- =========================================================================
  create temp table _demo_req on commit drop as
    select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%';
  create temp table _demo_cand on commit drop as
    select id from public.fms_hr_candidates where requisition_id in (select id from _demo_req);
  create temp table _demo_onb on commit drop as
    select id from public.fms_hr_onboardings where requisition_id in (select id from _demo_req);
  create temp table _demo_prob on commit drop as
    select id from public.fms_hr_probations where requisition_id in (select id from _demo_req);

  delete from public.fms_hr_notifications where entity_id in (
    select id from _demo_req union select id from _demo_cand
    union select id from _demo_onb union select id from _demo_prob);
  delete from public.fms_hr_activity where entity_id in (
    select id from _demo_req union select id from _demo_cand
    union select id from _demo_onb union select id from _demo_prob);
  -- Everything else hangs off the requisition by ON DELETE CASCADE.
  delete from public.fms_hr_requisitions where id in (select id from _demo_req);

  drop table _demo_req; drop table _demo_cand; drop table _demo_onb; drop table _demo_prob;

  -- =========================================================================
  -- 1 · RESOLVE MASTERS (already seeded — this file creates none).
  -- =========================================================================
  select id into l_althan from public.fms_hr_locations where name = 'Althan Office';
  select id into l_sachin from public.fms_hr_locations where name = 'Sachin Office';
  select id into l_delhi  from public.fms_hr_locations where name = 'Delhi Office';
  select id into jt_full     from public.fms_hr_job_types where name = 'Full-Time';
  select id into jt_contract from public.fms_hr_job_types where name = 'Contract';
  select id into pf_portal   from public.fms_hr_job_platforms where name = 'Job Portal';
  select id into pf_career   from public.fms_hr_job_platforms where name = 'Career Page';
  select id into pf_linkedin from public.fms_hr_job_platforms where name = 'LinkedIn';
  select id into pf_naukri   from public.fms_hr_job_platforms where name = 'Naukri';
  select id into pf_referral from public.fms_hr_job_platforms where name = 'Employee Referral';
  select id into pf_consult  from public.fms_hr_job_platforms where name = 'Consultancy';
  select id into dq_salary from public.fms_hr_disqualification_reasons where name = 'Salary expectation too high';
  select id into dq_failed from public.fms_hr_disqualification_reasons where name = 'Failed the interview';
  select id into dq_skills from public.fms_hr_disqualification_reasons where name = 'Not a skills match';

  if l_althan is null or pf_linkedin is null or dq_salary is null then
    raise exception 'HR masters are missing — run the Phase-0/2 master seed first';
  end if;

  -- =========================================================================
  -- 2 · STEP OWNERS + PROCESS COORDINATOR.
  --
  -- Without these NOTHING routes: every queue is empty and no non-admin can act.
  -- The HOD steps (hod_shortlist, interview_2, probation_*) are deliberately NOT
  -- listed — they are owned per-requisition by whoever raised the MRF, which is
  -- exactly what fms_hr_can_act() enforces. The `mrf` list is the set of people
  -- allowed to raise a requisition (and it is what lights the HOD queue links in
  -- the sidebar for them).
  -- =========================================================================
  insert into public.fms_hr_step_owners (step_key, employee_ids) values
    ('mrf',              array[u_hari, u_suhel, u_ritesh, u_sushil, u_amit, u_gorakh, u_hukum]),
    ('hr_head_approval', array[u_riya]),
    ('mgmt_approval',    array[u_karan, u_aayush]),
    ('job_posting',      array[u_khushi]),
    ('resume_upload',    array[u_khushi, u_dharmi]),
    ('hr_shortlist',     array[u_dharmi]),
    ('hod_share',        array[u_khushi]),
    ('interview_1',      array[u_riya, u_khushi]),
    ('interview_3',      array[u_nakul, u_aayush, u_karan]),
    ('final_decision',   array[u_riya]),
    ('onboarding',       array[u_dharmi, u_khushi])
  on conflict (step_key) do update
    set employee_ids = excluded.employee_ids, updated_at = now();

  -- The HR Head oversees the whole process (Control Center + can unblock any step).
  insert into public.fms_hr_config (key, value)
  values ('process_coordinators', jsonb_build_object('user_ids', to_jsonb(array[u_riya])))
  on conflict (key) do update set value = excluded.value;

  -- =========================================================================
  -- 3 · THE REQUISITIONS — one parked at every stage.
  --     Each is raised BY ITS OWN HOD through fms_hr_submit_mrf().
  -- =========================================================================

  -- ---- MRF-DEMO-01 · AWAITING HR HEAD APPROVAL — and OVERDUE ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  r01 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Service Engineer — Digital Textile Printers',
    'department_id', d_asvc, 'location_id', l_sachin, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 2,
    'expected_start_date', (current_date + 30)::text,
    'salary_min', '22000', 'salary_max', '30000',
    'salary_note', '22–30K depending on printhead experience; 25K+ only if they have handled Kyocera heads',
    'why_needed', 'Two engineers resigned in June and the Surat install base has grown to 140 machines.',
    'business_contribution', 'Faster call closure keeps AMC renewals from slipping.',
    'impact_if_unfilled', 'Breakdown response is already at 3 days against a 24-hour SLA.',
    'key_responsibilities', 'Installation, preventive maintenance and breakdown support at customer sites across South Gujarat.',
    'required_skills', 'Printhead handling, basic electronics, RIP software, willingness to travel.',
    'preferred_experience', '2–4 years on digital textile or wide-format printers.',
    'reporting_to_note', 'Suhel Toorawa'
  ));

  -- ---- MRF-DEMO-02 · AWAITING MANAGEMENT APPROVAL ---------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  r02 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Area Sales Manager — North India',
    'department_id', d_sales, 'location_id', l_delhi, 'job_type_id', jt_full,
    'position_kind', 'replacement', 'previous_employee_name', 'Rajeev Malhotra',
    'positions_required', 1,
    'expected_start_date', (current_date + 45)::text,
    'salary_min', '55000', 'salary_max', '75000', 'salary_note', '55–75K + travel + incentive on collections',
    'why_needed', 'Replacement — the incumbent has resigned and the Ludhiana/Panipat belt is uncovered.',
    'business_contribution', 'The North accounts for 30% of digital printer enquiries.',
    'impact_if_unfilled', 'Enquiries from Panipat are going unanswered for a week.',
    'key_responsibilities', 'Own the North territory, dealer network, demo scheduling and collections.',
    'required_skills', 'Capital-equipment selling, textile industry contacts, Hindi.',
    'preferred_experience', '5+ years selling machinery into textile processors.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r02, 'hr', 'approve', 'Replacement is budgeted. Sending to Management.');

  -- ---- MRF-DEMO-03 · SENT BACK to the requester -----------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_sushil)::text, true);
  r03 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Lab Chemist — Dyeing & Fastness',
    'department_id', d_qlab, 'location_id', l_sachin, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '28000', 'salary_max', '34000',
    'why_needed', 'Fastness testing is queued behind production and holding up dispatch approvals.',
    'impact_if_unfilled', 'QC sign-off is adding two days to every export lot.',
    'required_skills', 'Wet-lab testing, ISO 105 fastness methods, spectrophotometer.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r03, 'hr', 'send_back',
    'The 28–34K band is above the approved grade for a Lab Chemist. Please re-raise at 18–24K, and say whether the role is single shift or rotating.');

  -- ---- MRF-DEMO-04 · REJECTED (by Management) -------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_gorakh)::text, true);
  r04 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Warehouse Assistant — Spares',
    'department_id', d_inv, 'location_id', l_sachin, 'job_type_id', jt_contract,
    'position_kind', 'new', 'positions_required', 2,
    'salary_min', '14000', 'salary_max', '17000',
    'why_needed', 'Spares picking is being done by the store keeper alone.',
    'impact_if_unfilled', 'Spares dispatch to service engineers slips by a day.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r04, 'hr', 'approve', 'Contract hire, within budget.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r04, 'mgmt', 'reject',
    'Headcount for stores is frozen until the Sachin racking project is commissioned. Re-raise in Q3 with the post-racking manpower plan.');

  -- ---- MRF-DEMO-05 · APPROVED, AWAITING JOB POSTING (overdue) ---------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_amit)::text, true);
  r05 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Logistics Coordinator — Exports',
    'department_id', d_supply, 'location_id', l_althan, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '25000', 'salary_max', '32000',
    'why_needed', 'Export volumes to Bangladesh and Sri Lanka have doubled; documentation is the bottleneck.',
    'business_contribution', 'Faster BL and shipping-bill turnaround pulls collections forward.',
    'required_skills', 'Shipping bills, BL, CHA coordination, Incoterms.',
    'preferred_experience', '3+ years in an export desk.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r05, 'hr', 'approve', 'Agreed — the export desk is single-manned.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_hr_decide_mrf(r05, 'mgmt', 'approve', 'Approved. Post it this week.');

  -- ---- MRF-DEMO-06 · POSTED AND SOURCING — the full candidate board ---------
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  r06 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Sales Engineer — Digital Printing (Surat)',
    'department_id', d_sales, 'location_id', l_althan, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 2,
    'expected_start_date', (current_date + 20)::text,
    'salary_min', '35000', 'salary_max', '50000', 'salary_note', '35–50K + incentive; freshers at 20K if they are strong on textiles',
    'why_needed', 'Surat enquiry flow needs two more feet on the street to cover the Pandesara and Sachin belts.',
    'business_contribution', 'Each engineer is expected to carry a 2-machine-a-quarter demo pipeline.',
    'impact_if_unfilled', 'Demo requests are waiting 10+ days, and competitors are getting there first.',
    'key_responsibilities', 'Territory coverage, demos, quotations, follow-up until PO, collection support.',
    'required_skills', 'Technical selling, textile process knowledge, Gujarati + Hindi.',
    'preferred_experience', '2–5 years selling into textile processing houses.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r06, 'hr', 'approve', 'Both seats are in the approved manpower plan.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r06, 'mgmt', 'approve', 'Approved — hire both.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r06, array[pf_linkedin, pf_naukri, pf_career], current_date - 29);

  -- ---- MRF-DEMO-07 · SOURCING — the offer that was DECLINED ------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_ritesh)::text, true);
  r07 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Accounts Executive — Receivables',
    'department_id', d_fin, 'location_id', l_althan, 'job_type_id', jt_full,
    'position_kind', 'replacement', 'previous_employee_name', 'Hetal Prajapati',
    'positions_required', 1,
    'salary_min', '20000', 'salary_max', '26000',
    'why_needed', 'Replacement. Bill-wise follow-up on 400+ live debtors is not a part-time job.',
    'required_skills', 'Tally Prime, bill-wise outstanding, customer follow-up, MS Excel.',
    'preferred_experience', '2+ years in a receivables desk.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r07, 'hr', 'approve', 'Straight replacement.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r07, 'mgmt', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r07, array[pf_naukri, pf_career], current_date - 43);

  -- ---- MRF-DEMO-08 · a CLOSED vacancy — the hire who was CONFIRMED -----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_hukum)::text, true);
  r08 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Purchase Executive — Spares & Consumables',
    'department_id', d_purch, 'location_id', l_sachin, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '24000', 'salary_max', '30000',
    'why_needed', 'Spares procurement has outgrown one person.',
    'required_skills', 'Vendor negotiation, Tally, GRN discipline.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r08, 'hr', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r08, 'mgmt', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r08, array[pf_linkedin, pf_naukri], current_date - 165);

  -- ---- MRF-DEMO-09 · CLOSED — the hire currently IN PROBATION ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_gorakh)::text, true);
  r09 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Store Keeper — Sachin Plant',
    'department_id', d_inv, 'location_id', l_sachin, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '18000', 'salary_max', '22000',
    'why_needed', 'The plant store has no dedicated keeper; issue slips are going unrecorded.',
    'required_skills', 'Stores discipline, GRN, Tally stock entries.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r09, 'hr', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_aayush)::text, true);
  perform public.fms_hr_decide_mrf(r09, 'mgmt', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r09, array[pf_naukri], current_date - 145);

  -- ---- MRF-DEMO-10 · CLOSED — the hire whose probation was EXTENDED ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_amit)::text, true);
  r10 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Dispatch Executive',
    'department_id', d_supply, 'location_id', l_althan, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '18000', 'salary_max', '24000',
    'why_needed', 'Dispatch documentation is being done by the logistics coordinator on top of her own desk.',
    'required_skills', 'E-way bills, LR, packing lists, transporter coordination.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r10, 'hr', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r10, 'mgmt', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r10, array[pf_referral], current_date - 190);

  -- ---- MRF-DEMO-11 · CLOSED — the hire who FAILED probation ------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  r11 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Field Service Technician — Delhi',
    'department_id', d_asvc, 'location_id', l_delhi, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '20000', 'salary_max', '26000',
    'why_needed', 'North India install base has no local engineer; every call is a flight from Surat.',
    'required_skills', 'Printer servicing, customer handling, Hindi.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r11, 'hr', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r11, 'mgmt', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r11, array[pf_consult], current_date - 175);

  -- ---- MRF-DEMO-12 · SOURCING — a hire MID-ONBOARDING ------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  r12 := public.fms_hr_submit_mrf(jsonb_build_object(
    'job_title', 'Inside Sales Executive — Tele-prospecting',
    'department_id', d_sales, 'location_id', l_althan, 'job_type_id', jt_full,
    'position_kind', 'new', 'positions_required', 1,
    'salary_min', '18000', 'salary_max', '25000', 'salary_note', 'If fresh (zero to two years) 18000/-',
    'why_needed', 'Field engineers are spending half their week on cold calls.',
    'required_skills', 'Tele-calling, CRM hygiene, Gujarati/Hindi/English.'
  ));
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_decide_mrf(r12, 'hr', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_karan)::text, true);
  perform public.fms_hr_decide_mrf(r12, 'mgmt', 'approve', 'Approved.');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_post_job(r12, array[pf_career, pf_naukri], current_date - 35);

  -- =========================================================================
  -- 4 · THE BOARD ON MRF-DEMO-06 — a card in every column.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_add_candidates(r06, jsonb_build_array(
    jsonb_build_object('name','Rohit Bhagat',   'phone','+91 98250 41120','email','rohit.bhagat@example.com',  'current_company','Colorjet India',   'experience_years','3',  'skills', jsonb_build_array('Technical sales','Textile printing','Demo'),               'source_platform_id', pf_linkedin::text, 'parse_status','ok'),
    jsonb_build_object('name','Sneha Ramani',   'phone','+91 99048 77321','email','sneha.ramani@example.com',  'current_company','Jaysynth Dyestuff','experience_years','2',  'skills', jsonb_build_array('Inside sales','Textile chemicals'),                          'source_platform_id', pf_naukri::text,   'parse_status','ok'),
    jsonb_build_object('name','Kiran Vasani',   'phone','+91 97129 55410','email','kiran.vasani@example.com',  'current_company','Freelance',        'experience_years','1',  'skills', jsonb_build_array('Sales'),                                                     'parse_status','manual', 'notes','Walk-in CV at the Althan office — source not recorded.'),
    jsonb_build_object('name','Devang Modi',    'phone','+91 90999 21874','email','devang.modi@example.com',   'current_company','Monotech Systems', 'experience_years','4',  'skills', jsonb_build_array('Capital equipment','RIP software','Territory sales'),        'source_platform_id', pf_naukri::text,   'parse_status','ok'),
    jsonb_build_object('name','Priyanka Shah',  'phone','+91 98795 33218','email','priyanka.shah@example.com', 'current_company','Epson India',      'experience_years','5',  'skills', jsonb_build_array('Wide-format','Channel sales','Demos'),                        'source_platform_id', pf_linkedin::text, 'parse_status','ok'),
    jsonb_build_object('name','Mihir Desai',    'phone','+91 91733 60042','email','mihir.desai@example.com',   'current_company','Kornit (partner)', 'experience_years','3.5','skills', jsonb_build_array('Digital textile','Pre-sales','Gujarati'),                     'source_platform_id', pf_career::text,   'parse_status','ok'),
    jsonb_build_object('name','Ankit Chauhan',  'phone','+91 94270 18855','email','ankit.chauhan@example.com', 'current_company','Aditya Dyeing',    'experience_years','2.5','skills', jsonb_build_array('Textile process','Sales support'),                            'source_platform_id', pf_linkedin::text, 'parse_status','ok'),
    jsonb_build_object('name','Nisha Patel',    'phone','+91 99786 04412','email','nisha.patel@example.com',   'current_company','Roland DG dealer', 'experience_years','4',  'skills', jsonb_build_array('Demos','Quotations','Follow-up'),                             'source_platform_id', pf_naukri::text,   'parse_status','ok'),
    jsonb_build_object('name','Jignesh Rathod', 'phone','+91 98240 77190','email','jignesh.rathod@example.com','current_company','Negi Sign Systems','experience_years','6',  'skills', jsonb_build_array('Machinery sales','Collections','Dealer network'),             'source_platform_id', pf_linkedin::text, 'parse_status','ok'),
    jsonb_build_object('name','Hardik Solanki', 'phone','+91 97250 66003','email','hardik.solanki@example.com','current_company','Garware Technical','experience_years','5',  'skills', jsonb_build_array('Technical selling','Textiles','Key accounts'),                'source_platform_id', pf_referral::text, 'parse_status','ok', 'notes','Referred by Hariomsharan Dave.'),
    jsonb_build_object('name','Manali Trivedi', 'phone','+91 96019 34477','email','manali.trivedi@example.com','current_company','SPGPrints India',  'experience_years','4.5','skills', jsonb_build_array('Rotary + digital printing','Solution selling'),               'source_platform_id', pf_consult::text,  'parse_status','ok'),
    jsonb_build_object('name','Rakesh Panchal', 'phone','+91 90163 20099','email','rakesh.panchal@example.com','current_company','DCC Print Vision', 'experience_years','8',  'skills', jsonb_build_array('Print machinery','Regional head'),                            'source_platform_id', pf_naukri::text,   'parse_status','ok'),
    jsonb_build_object('name','Alpesh Vaghela', 'phone','+91 93288 71160','email','alpesh.vaghela@example.com','current_company','Sun Chemical',     'experience_years','3',  'skills', jsonb_build_array('Inks','Field sales'),                                         'source_platform_id', pf_linkedin::text, 'parse_status','ok')
  ));

  select id into c01 from public.fms_hr_candidates where requisition_id = r06 and name = 'Rohit Bhagat';
  select id into c02 from public.fms_hr_candidates where requisition_id = r06 and name = 'Sneha Ramani';
  select id into c03 from public.fms_hr_candidates where requisition_id = r06 and name = 'Kiran Vasani';
  select id into c04 from public.fms_hr_candidates where requisition_id = r06 and name = 'Devang Modi';
  select id into c05 from public.fms_hr_candidates where requisition_id = r06 and name = 'Priyanka Shah';
  select id into c06 from public.fms_hr_candidates where requisition_id = r06 and name = 'Mihir Desai';
  select id into c07 from public.fms_hr_candidates where requisition_id = r06 and name = 'Ankit Chauhan';
  select id into c08 from public.fms_hr_candidates where requisition_id = r06 and name = 'Nisha Patel';
  select id into c09 from public.fms_hr_candidates where requisition_id = r06 and name = 'Jignesh Rathod';
  select id into c10 from public.fms_hr_candidates where requisition_id = r06 and name = 'Hardik Solanki';
  select id into c11 from public.fms_hr_candidates where requisition_id = r06 and name = 'Manali Trivedi';
  select id into c12 from public.fms_hr_candidates where requisition_id = r06 and name = 'Rakesh Panchal';
  select id into c13 from public.fms_hr_candidates where requisition_id = r06 and name = 'Alpesh Vaghela';

  -- HR screens the CVs (Dharmishtha owns hr_shortlist).
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_hr_move_candidate(c04, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c05, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c06, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c07, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c08, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c09, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c10, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c11, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c12, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c13, 'hr_shortlisted');

  -- HR shares a batch with the HOD (Khushi owns hod_share) — the sheet's "5–10 CVs at a time".
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_share_candidates_with_hod(array[c05, c06, c07, c08, c09, c10, c11, c12, c13]);

  -- The HOD (Hariomsharan — he raised this MRF, so the HOD steps are his) decides.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  perform public.fms_hr_hod_decide(array[c06, c07, c08, c09, c10, c11, c13], true);
  -- …and drops one himself. (A HOD disqualifying a CV they are reviewing is exactly
  -- the case the Phase-4 authz bug got wrong; doing it here re-proves the fix.)
  perform public.fms_hr_hod_decide(array[c12], false, dq_salary,
    'Wants 85K — nearly double the band, and he is looking for a regional-head title.');

  -- Round 1 (HR). Riya books and conducts.
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_move_candidate(c07, 'interview_1', jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', (current_date + 1)::text));
  perform public.fms_hr_move_candidate(c08, 'interview_1', jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', (current_date - 2)::text));
  perform public.fms_hr_move_candidate(c09, 'interview_1', jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', (current_date - 8)::text));
  perform public.fms_hr_move_candidate(c10, 'interview_1', jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', (current_date - 12)::text));
  perform public.fms_hr_move_candidate(c11, 'interview_1', jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', (current_date - 14)::text));
  perform public.fms_hr_move_candidate(c13, 'interview_1', jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', (current_date - 10)::text));
  -- c07 stays BOOKED but not held — "scheduled" is not "conducted".
  perform public.fms_hr_record_interview_result(c08, 1, 'selected', 'Good product grip; ask the HOD to test her on the Pandesara belt.');
  perform public.fms_hr_record_interview_result(c09, 1, 'selected', 'Strong on dealer handling.');
  perform public.fms_hr_record_interview_result(c10, 1, 'selected', 'Referral — knows our machines already.');
  perform public.fms_hr_record_interview_result(c11, 1, 'selected', 'Best communication of the lot.');
  perform public.fms_hr_record_interview_result(c13, 1, 'selected', 'Worth a technical round.');

  -- Round 2 (the HOD's round). Selected R1 candidates land here unscheduled — Hari books them.
  perform set_config('request.jwt.claims', json_build_object('sub', u_hari)::text, true);
  perform public.fms_hr_schedule_interview(c08, 2, u_hari, null, current_date + 2);   -- booked, not yet held
  perform public.fms_hr_schedule_interview(c09, 2, u_hari, null, current_date - 5);
  perform public.fms_hr_schedule_interview(c10, 2, u_hari, null, current_date - 9);
  perform public.fms_hr_schedule_interview(c11, 2, u_hari, null, current_date - 11);
  perform public.fms_hr_schedule_interview(c13, 2, u_hari, null, current_date - 7);
  perform public.fms_hr_record_interview_result(c09, 2, 'selected', 'Technically sound. Send to the Director.');
  perform public.fms_hr_record_interview_result(c10, 2, 'selected', 'Ready to run a territory on day one.');
  perform public.fms_hr_record_interview_result(c11, 2, 'selected', 'Confident on solution selling.');
  perform public.fms_hr_record_interview_result(c13, 2, 'rejected', 'Ink sales background does not carry over to machine selling; could not size a job.');

  -- Round 3 (Director).
  perform set_config('request.jwt.claims', json_build_object('sub', u_nakul)::text, true);
  perform public.fms_hr_schedule_interview(c09, 3, u_nakul, null, current_date + 1);  -- booked, not yet held
  perform public.fms_hr_schedule_interview(c10, 3, u_nakul, null, current_date - 4);
  perform public.fms_hr_schedule_interview(c11, 3, u_nakul, null, current_date - 6);
  perform public.fms_hr_record_interview_result(c10, 3, 'selected', 'Yes. Make the offer at the top of the band.');
  perform public.fms_hr_record_interview_result(c11, 3, 'selected', 'Yes.');

  -- Final decision / offer (Riya owns final_decision).
  perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
  perform public.fms_hr_move_candidate(c11, 'finalized', jsonb_build_object('offered_ctc', '480000'));
  -- c10 is left sitting in Final Decision — the second seat is still being decided.

  -- =========================================================================
  -- 5 · MRF-DEMO-07 — the DECLINED offer (and sourcing restarted).
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_add_candidates(r07, jsonb_build_array(
    jsonb_build_object('name','Poonam Jain',   'phone','+91 98253 11902','email','poonam.jain@example.com',  'current_company','Garden Silk Mills','experience_years','3', 'skills', jsonb_build_array('Tally Prime','Receivables','Excel'), 'source_platform_id', pf_naukri::text, 'parse_status','ok'),
    jsonb_build_object('name','Zeel Kapadia',  'phone','+91 90333 47781','email','zeel.kapadia@example.com', 'current_company','Shivam Textiles',  'experience_years','2', 'skills', jsonb_build_array('Accounts payable','Tally'),          'source_platform_id', pf_career::text, 'parse_status','ok'),
    jsonb_build_object('name','Farhan Shaikh', 'phone','+91 99137 22065','email','farhan.shaikh@example.com','current_company','Laxmipati Sarees', 'experience_years','4', 'skills', jsonb_build_array('Receivables','Collections','GST'),   'source_platform_id', pf_naukri::text, 'parse_status','ok')
  ));
  select id into c14 from public.fms_hr_candidates where requisition_id = r07 and name = 'Poonam Jain';
  select id into c15 from public.fms_hr_candidates where requisition_id = r07 and name = 'Zeel Kapadia';
  select id into c16 from public.fms_hr_candidates where requisition_id = r07 and name = 'Farhan Shaikh';

  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_hr_move_candidate(c14, 'hr_shortlisted');
  perform public.fms_hr_move_candidate(c15, 'hr_shortlisted');   -- still with HR — sourcing resumed

  -- =========================================================================
  -- 6 · The FAST-TRACK hires. Same board path, driven by the right owners:
  --     Poonam (declined), plus the four people who actually joined, plus the
  --     one mid-onboarding.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_add_candidates(r08, jsonb_build_array(
    jsonb_build_object('name','Chirag Bhatt',  'phone','+91 98241 55031','email','chirag.bhatt@example.com', 'current_company','Ashima Dyecot',   'experience_years','4', 'skills', jsonb_build_array('Vendor negotiation','Tally','GRN'),      'source_platform_id', pf_linkedin::text, 'parse_status','ok')));
  perform public.fms_hr_add_candidates(r09, jsonb_build_array(
    jsonb_build_object('name','Bhavesh Chavda','phone','+91 97267 80144','email','bhavesh.chavda@example.com','current_company','Sahjanand Laser','experience_years','5', 'skills', jsonb_build_array('Stores','GRN','Tally stock'),            'source_platform_id', pf_naukri::text,   'parse_status','ok')));
  perform public.fms_hr_add_candidates(r10, jsonb_build_array(
    jsonb_build_object('name','Nikita Bhalodia','phone','+91 90811 30975','email','nikita.bhalodia@example.com','current_company','Welspun India','experience_years','3', 'skills', jsonb_build_array('E-way bill','LR','Transporter coordination'),'source_platform_id', pf_referral::text, 'parse_status','ok')));
  perform public.fms_hr_add_candidates(r11, jsonb_build_array(
    jsonb_build_object('name','Sagar Rathod',  'phone','+91 98118 44720','email','sagar.rathod@example.com',  'current_company','Delhi Print Hub','experience_years','2', 'skills', jsonb_build_array('Printer servicing','Hindi'),             'source_platform_id', pf_consult::text,  'parse_status','ok')));
  perform public.fms_hr_add_candidates(r12, jsonb_build_array(
    jsonb_build_object('name','Krupa Mehta',   'phone','+91 94088 61230','email','krupa.mehta@example.com',   'current_company','Fresher',        'experience_years','0.5','skills', jsonb_build_array('Tele-calling','CRM','English'),          'source_platform_id', pf_career::text,   'parse_status','ok'),
    jsonb_build_object('name','Divya Chauhan', 'phone','+91 99099 27714','email','divya.chauhan@example.com', 'current_company','Aarvi Encon',    'experience_years','1.5','skills', jsonb_build_array('Inside sales','Lead qualification'),     'source_platform_id', pf_linkedin::text, 'parse_status','ok')));

  select id into c17 from public.fms_hr_candidates where requisition_id = r08 and name = 'Chirag Bhatt';
  select id into c18 from public.fms_hr_candidates where requisition_id = r09 and name = 'Bhavesh Chavda';
  select id into c19 from public.fms_hr_candidates where requisition_id = r10 and name = 'Nikita Bhalodia';
  select id into c20 from public.fms_hr_candidates where requisition_id = r11 and name = 'Sagar Rathod';
  select id into c21 from public.fms_hr_candidates where requisition_id = r12 and name = 'Krupa Mehta';
  select id into c22 from public.fms_hr_candidates where requisition_id = r12 and name = 'Divya Chauhan';

  -- Divya stays with the HOD — a live backup while Krupa is onboarding.
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
  perform public.fms_hr_move_candidate(c22, 'hr_shortlisted');
  perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
  perform public.fms_hr_share_candidates_with_hod(array[c22]);

  -- The full path for each of the six, run by that requisition's own owners.
  create temp table _track(cand uuid, hm uuid, ctc numeric) on commit drop;
  insert into _track values
    (c14, u_ritesh, 360000),   -- Poonam Jain   → will DECLINE the offer
    (c17, u_hukum,  330000),   -- Chirag Bhatt  → joined, probation CONFIRMED
    (c18, u_gorakh, 240000),   -- Bhavesh Chavda→ joined, probation IN PROGRESS
    (c19, u_amit,   264000),   -- Nikita Bhalodia→ joined, probation EXTENDED
    (c20, u_suhel,  288000),   -- Sagar Rathod  → joined, probation REJECTED
    (c21, u_hari,   300000);   -- Krupa Mehta   → MID-ONBOARDING

  for rec in select * from _track loop
    -- HR screens (Poonam is already shortlisted; the move is a no-op if so).
    perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);
    if (select stage from public.fms_hr_candidates where id = rec.cand) = 'resume_uploaded' then
      perform public.fms_hr_move_candidate(rec.cand, 'hr_shortlisted');
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', u_khushi)::text, true);
    perform public.fms_hr_share_candidates_with_hod(array[rec.cand]);
    perform set_config('request.jwt.claims', json_build_object('sub', rec.hm)::text, true);
    perform public.fms_hr_hod_decide(array[rec.cand], true);

    perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
    perform public.fms_hr_move_candidate(rec.cand, 'interview_1',
      jsonb_build_object('interviewer_id', u_riya::text, 'scheduled_on', current_date::text));
    perform public.fms_hr_record_interview_result(rec.cand, 1, 'selected', 'Cleared the HR round.');

    perform set_config('request.jwt.claims', json_build_object('sub', rec.hm)::text, true);
    perform public.fms_hr_schedule_interview(rec.cand, 2, rec.hm, null, current_date);
    perform public.fms_hr_record_interview_result(rec.cand, 2, 'selected', 'Technically fit for the role.');

    perform set_config('request.jwt.claims', json_build_object('sub', u_nakul)::text, true);
    perform public.fms_hr_schedule_interview(rec.cand, 3, u_nakul, null, current_date);
    perform public.fms_hr_record_interview_result(rec.cand, 3, 'selected', 'Approved. Roll out the offer.');

    perform set_config('request.jwt.claims', json_build_object('sub', u_riya)::text, true);
    perform public.fms_hr_move_candidate(rec.cand, 'finalized',
      jsonb_build_object('offered_ctc', rec.ctc::text));
  end loop;
  drop table _track;

  -- =========================================================================
  -- 7 · ONBOARDING.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_dharmi)::text, true);

  -- ---- Poonam Jain — offer DECLINED. The seat goes back to MRF-DEMO-07. ------
  select id into o_id from public.fms_hr_onboardings where candidate_id = c14;
  perform public.fms_hr_set_onboarding_date(o_id, current_date - 2);
  perform public.fms_hr_set_offer_status(o_id, 'declined',
    'Accepted a counter-offer from her current employer on the same day she was to sign.');

  -- ---- Krupa Mehta — MID-ONBOARDING (joins next week) ------------------------
  select id into o_id from public.fms_hr_onboardings where candidate_id = c21;
  perform public.fms_hr_set_onboarding_date(o_id, current_date + 4);
  perform public.fms_hr_set_offer_status(o_id, 'accepted');
  perform public.fms_hr_set_employee_code(o_id, 'OOT-2627-0188');
  perform public.fms_hr_toggle_onboarding_check(
    (select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'offer_letter_sent'),
    true, 'demo/offer-letters/krupa-mehta.pdf', 'Offer Letter — Krupa Mehta.pdf', null, null);
  perform public.fms_hr_toggle_onboarding_check(
    (select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'documents_collection'),
    true, null, null, 'https://drive.google.com/drive/folders/demo-krupa-mehta-docs', null);
  perform public.fms_hr_toggle_onboarding_check(
    (select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'onboarding_form'),
    true, null, null, null, null);
  -- …and one still pending, with the reason (the sheet's "Reason (If Pending)").
  perform public.fms_hr_toggle_onboarding_check(
    (select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'police_verification'),
    false, null, null, null,
    'Form submitted at Umra police station on 06-07; verification not returned yet. Followed up 10-07.');

  -- ---- The four who actually JOINED. Every box ticked → the vacancy closes. ---
  for rec in
    select * from (values
      (c17, (current_date - 125)::date, 'OOT-2526-0117'::text),
      (c18, (current_date - 100)::date, 'OOT-2627-0004'),
      (c19, (current_date - 130)::date, 'OOT-2526-0121'),
      (c20, (current_date - 140)::date, 'OOT-2526-0109')
    ) as t(cand, joining, code)
  loop
    select id into o_id from public.fms_hr_onboardings where candidate_id = rec.cand;
    perform public.fms_hr_set_onboarding_date(o_id, rec.joining);
    perform public.fms_hr_set_offer_status(o_id, 'accepted');
    perform public.fms_hr_set_employee_code(o_id, rec.code);
    perform public.fms_hr_toggle_onboarding_check(
      (select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'offer_letter_sent'),
      true, 'demo/offer-letters/' || rec.code || '.pdf', 'Offer Letter.pdf', null, null);
    perform public.fms_hr_toggle_onboarding_check((select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'documents_collection'), true, null, null, null, null);
    perform public.fms_hr_toggle_onboarding_check((select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'police_verification'),  true, null, null, null, null);
    perform public.fms_hr_toggle_onboarding_check((select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'filing_of_records'),    true, null, null, null, null);
    perform public.fms_hr_toggle_onboarding_check((select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'onboarding_form'),      true, null, null, null, null);
    -- the last tick completes the onboarding → they JOINED → the requisition CLOSES
    perform public.fms_hr_toggle_onboarding_check((select id from public.fms_hr_onboarding_checks where onboarding_id = o_id and item_key = 'seating_system_sim'),   true, null, null, null, null);
  end loop;

  -- =========================================================================
  -- 8 · PROBATION — reviews written by each hire's own hiring manager.
  -- =========================================================================

  -- ---- Chirag Bhatt (Purchase) — CONFIRMED ----------------------------------
  select p.id into p_id from public.fms_hr_probations p where p.candidate_id = c17;
  perform set_config('request.jwt.claims', json_build_object('sub', u_hukum)::text, true);
  perform public.fms_hr_record_probation_review(p_id, 1, 'satisfactory',      'Picked up the vendor list quickly.');
  perform public.fms_hr_record_probation_review(p_id, 2, 'satisfactory',      'Running the consumables reorder cycle on his own now.');
  perform public.fms_hr_record_probation_review(p_id, 3, 'satisfactory',      'Negotiated 6% off the filter contract. Confirm him.');
  perform public.fms_hr_decide_probation(p_id, 'approve', 'Clear confirm.', (current_date - 35), 'OOT-2526-0117');

  -- ---- Bhavesh Chavda (Inventory) — IN PROBATION, month-3 review OVERDUE ------
  select p.id into p_id from public.fms_hr_probations p where p.candidate_id = c18;
  perform set_config('request.jwt.claims', json_build_object('sub', u_gorakh)::text, true);
  perform public.fms_hr_record_probation_review(p_id, 1, 'satisfactory',      'Store is finally in order.');
  perform public.fms_hr_record_probation_review(p_id, 2, 'needs_improvement', 'Issue slips still going out without a signature — pulled him up on it.');
  -- month 3 deliberately NOT recorded: it was due at the start of July and is late.

  -- ---- Nikita Bhalodia (Supply Chain) — EXTENDED by a month ------------------
  select p.id into p_id from public.fms_hr_probations p where p.candidate_id = c19;
  perform set_config('request.jwt.claims', json_build_object('sub', u_amit)::text, true);
  perform public.fms_hr_record_probation_review(p_id, 1, 'needs_improvement', 'E-way bills are going out late in the evening rush.');
  perform public.fms_hr_record_probation_review(p_id, 2, 'needs_improvement', 'Better, but two LRs were raised against the wrong transporter.');
  perform public.fms_hr_record_probation_review(p_id, 3, 'needs_improvement', 'Improving, but dispatch accuracy is still short of target.');
  perform public.fms_hr_decide_probation(p_id, 'extend',
    'Give her one more month — the trend is right, the accuracy is not there yet.');
  -- the month-4 review is now due, and it too is late.

  -- ---- Sagar Rathod (After Sales, Delhi) — probation REJECTED -----------------
  select p.id into p_id from public.fms_hr_probations p where p.candidate_id = c20;
  perform set_config('request.jwt.claims', json_build_object('sub', u_suhel)::text, true);
  perform public.fms_hr_record_probation_review(p_id, 1, 'needs_improvement', 'Still needs a call with Surat on every job.');
  perform public.fms_hr_record_probation_review(p_id, 2, 'needs_improvement', 'Two repeat visits on the same head-clog complaint.');
  perform public.fms_hr_record_probation_review(p_id, 3, 'unsatisfactory',    'Cannot close a service call independently. Delhi customers are escalating.');
  perform public.fms_hr_decide_probation(p_id, 'reject',
    'Three months in and he still cannot close a call on his own. Repeat escalations from the Delhi install base.');

  -- =========================================================================
  -- 9 · BACKDATING.
  --
  -- Everything above was stamped now() by the RPCs, because that is what really
  -- happened. Here — and ONLY here — the demo is aged with raw UPDATEs, so the
  -- overdue paths, the SLA colours and the time-to-hire chart have something to
  -- show. No workflow state is written here; only the clock is moved.
  -- =========================================================================

  -- ---- requisitions ---------------------------------------------------------
  update public.fms_hr_requisitions r set
    mrf_no          = t.no,
    request_date    = t.submitted::date,
    submitted_at    = t.submitted,
    hr_approved_at  = t.hr_at,
    mgmt_approved_at= t.mgmt_at,
    sent_back_at    = t.back_at,
    rejected_at     = t.rej_at,
    posted_at       = t.post_at,
    closed_at       = case when r.status = 'closed' then t.closed_at else r.closed_at end,
    created_at      = t.submitted
  from (values
    (r01, 'MRF-DEMO-01', now() -   8 * interval '1 day', null::timestamptz,               null::timestamptz,              null::timestamptz,             null::timestamptz,             null::timestamptz,              null::timestamptz),
    (r02, 'MRF-DEMO-02', now() -   6 * interval '1 day', now() -   1 * interval '1 day',  null,                           null,                          null,                          null,                           null),
    (r03, 'MRF-DEMO-03', now() -   9 * interval '1 day', null,                            null,                           now() -  3 * interval '1 day', null,                          null,                           null),
    (r04, 'MRF-DEMO-04', now() -  14 * interval '1 day', now() -  12 * interval '1 day',  null,                           null,                          now() -  9 * interval '1 day', null,                           null),
    (r05, 'MRF-DEMO-05', now() -  11 * interval '1 day', now() -   9 * interval '1 day',  now() -  5 * interval '1 day',  null,                          null,                          null,                           null),
    (r06, 'MRF-DEMO-06', now() -  34 * interval '1 day', now() -  32 * interval '1 day',  now() - 30 * interval '1 day',  null,                          null,                          now() - 29 * interval '1 day',  null),
    (r07, 'MRF-DEMO-07', now() -  48 * interval '1 day', now() -  46 * interval '1 day',  now() - 44 * interval '1 day',  null,                          null,                          now() - 43 * interval '1 day',  null),
    (r08, 'MRF-DEMO-08', now() - 170 * interval '1 day', now() - 168 * interval '1 day',  now() -166 * interval '1 day',  null,                          null,                          now() -165 * interval '1 day',  now() - 125 * interval '1 day'),
    (r09, 'MRF-DEMO-09', now() - 150 * interval '1 day', now() - 148 * interval '1 day',  now() -146 * interval '1 day',  null,                          null,                          now() -145 * interval '1 day',  now() - 100 * interval '1 day'),
    (r10, 'MRF-DEMO-10', now() - 195 * interval '1 day', now() - 193 * interval '1 day',  now() -191 * interval '1 day',  null,                          null,                          now() -190 * interval '1 day',  now() - 130 * interval '1 day'),
    (r11, 'MRF-DEMO-11', now() - 180 * interval '1 day', now() - 178 * interval '1 day',  now() -176 * interval '1 day',  null,                          null,                          now() -175 * interval '1 day',  now() - 140 * interval '1 day'),
    (r12, 'MRF-DEMO-12', now() -  40 * interval '1 day', now() -  38 * interval '1 day',  now() - 36 * interval '1 day',  null,                          null,                          now() - 35 * interval '1 day',  null)
  ) as t(id, no, submitted, hr_at, mgmt_at, back_at, rej_at, post_at, closed_at)
  where r.id = t.id;

  -- ---- candidates: one row per card, with the stage timestamps it really has --
  update public.fms_hr_candidates c set
    uploaded_at       = t.up,
    hr_shortlisted_at = case when c.hr_shortlisted_at is null then null else t.hrsl end,
    shared_to_hod_at  = case when c.shared_to_hod_at  is null then null else t.shr  end,
    hod_decided_at    = case when c.hod_decided_at    is null then null else t.hod  end,
    interview1_at     = case when c.interview1_at     is null then null else t.iv1  end,
    interview2_at     = case when c.interview2_at     is null then null else t.iv2  end,
    interview3_at     = case when c.interview3_at     is null then null else t.iv3  end,
    final_decision_at = case when c.final_decision_at is null then null else t.fd   end,
    finalized_at      = case when c.finalized_at      is null then null else t.fin  end,
    disqualified_at   = case when c.disqualified_at   is null then null else t.disq end,
    joined_at         = case when c.joined_at         is null then null else t.joinat end,
    created_at        = t.up
  from (values
    -- MRF-DEMO-06                up                     hrsl                    shr                     hod                     iv1                     iv2                     iv3                     fd                      fin                     disq                    joinat
    (c01, now()-  1*interval '1d', null::timestamptz,     null::timestamptz,      null::timestamptz,      null::timestamptz,      null::timestamptz,      null::timestamptz,      null::timestamptz,      null::timestamptz,      null::timestamptz,      null::timestamptz),
    (c02, now()-  7*interval '1d', null,                  null,                   null,                   null,                   null,                   null,                   null,                   null,                   null,                   null),
    (c03, now()-  5*interval '1d', null,                  null,                   null,                   null,                   null,                   null,                   null,                   null,                   null,                   null),
    (c04, now()- 12*interval '1d', now()-  1*interval '1d', null,                 null,                   null,                   null,                   null,                   null,                   null,                   null,                   null),
    (c05, now()- 14*interval '1d', now()- 10*interval '1d', now()-  6*interval '1d', null,               null,                   null,                   null,                   null,                   null,                   null,                   null),
    (c06, now()- 16*interval '1d', now()- 13*interval '1d', now()- 11*interval '1d', now()-  1*interval '1d', null,               null,                   null,                   null,                   null,                   null,                   null),
    (c07, now()- 18*interval '1d', now()- 15*interval '1d', now()- 13*interval '1d', now()-  3*interval '1d', null,               null,                   null,                   null,                   null,                   null,                   null),
    (c08, now()- 20*interval '1d', now()- 17*interval '1d', now()- 15*interval '1d', now()-  5*interval '1d', now()-  2*interval '1d', null,               null,                   null,                   null,                   null,                   null),
    (c09, now()- 24*interval '1d', now()- 21*interval '1d', now()- 19*interval '1d', now()-  9*interval '1d', now()-  8*interval '1d', now()-  5*interval '1d', null,               null,                   null,                   null,                   null),
    (c10, now()- 26*interval '1d', now()- 23*interval '1d', now()- 21*interval '1d', now()- 13*interval '1d', now()- 12*interval '1d', now()-  9*interval '1d', now()-  4*interval '1d', now()-  4*interval '1d', null,               null,                   null),
    (c11, now()- 26*interval '1d', now()- 23*interval '1d', now()- 21*interval '1d', now()- 15*interval '1d', now()- 14*interval '1d', now()- 11*interval '1d', now()-  6*interval '1d', now()-  6*interval '1d', now()-  1*interval '1d', null,               null),
    (c12, now()- 22*interval '1d', now()- 20*interval '1d', now()- 18*interval '1d', null,               null,                   null,                   null,                   null,                   null,                   now()- 16*interval '1d', null),
    (c13, now()- 21*interval '1d', now()- 19*interval '1d', now()- 17*interval '1d', now()- 11*interval '1d', now()- 10*interval '1d', now()-  7*interval '1d', null,               null,                   null,                   now()-  7*interval '1d', null),
    -- MRF-DEMO-07
    (c14, now()- 40*interval '1d', now()- 37*interval '1d', now()- 34*interval '1d', now()- 30*interval '1d', now()- 26*interval '1d', now()- 22*interval '1d', now()- 18*interval '1d', now()- 18*interval '1d', now()- 14*interval '1d', null,               null),
    (c15, now()-  6*interval '1d', now()-  4*interval '1d', null,                   null,                   null,                   null,                   null,                   null,                   null,                   null,                   null),
    (c16, now()-  3*interval '1d', null,                  null,                   null,                   null,                   null,                   null,                   null,                   null,                   null,                   null),
    -- the four who joined
    (c17, now()-160*interval '1d', now()-157*interval '1d', now()-154*interval '1d', now()-150*interval '1d', now()-146*interval '1d', now()-142*interval '1d', now()-136*interval '1d', now()-136*interval '1d', now()-132*interval '1d', null,               now()-125*interval '1d'),
    (c18, now()-140*interval '1d', now()-137*interval '1d', now()-134*interval '1d', now()-130*interval '1d', now()-125*interval '1d', now()-120*interval '1d', now()-112*interval '1d', now()-112*interval '1d', now()-107*interval '1d', null,               now()-100*interval '1d'),
    (c19, now()-183*interval '1d', now()-180*interval '1d', now()-176*interval '1d', now()-170*interval '1d', now()-163*interval '1d', now()-155*interval '1d', now()-145*interval '1d', now()-145*interval '1d', now()-137*interval '1d', null,               now()-130*interval '1d'),
    (c20, now()-168*interval '1d', now()-165*interval '1d', now()-162*interval '1d', now()-158*interval '1d', now()-155*interval '1d', now()-152*interval '1d', now()-148*interval '1d', now()-148*interval '1d', now()-145*interval '1d', null,               now()-140*interval '1d'),
    -- MRF-DEMO-12
    (c21, now()- 30*interval '1d', now()- 27*interval '1d', now()- 24*interval '1d', now()- 20*interval '1d', now()- 17*interval '1d', now()- 14*interval '1d', now()- 11*interval '1d', now()- 11*interval '1d', now()-  9*interval '1d', null,               null),
    (c22, now()- 20*interval '1d', now()- 16*interval '1d', now()- 12*interval '1d', null,               null,                   null,                   null,                   null,                   null,                   null,                   null)
  ) as t(id, up, hrsl, shr, hod, iv1, iv2, iv3, fd, fin, disq, joinat)
  where c.id = t.id;

  -- Interviews: `held_at` follows the round's stamp on the candidate.
  update public.fms_hr_interviews i set
    held_at = case i.round when 1 then c.interview1_at when 2 then c.interview2_at else c.interview3_at end,
    created_at = case i.round when 1 then c.hod_decided_at when 2 then c.interview1_at else c.interview2_at end
  from public.fms_hr_candidates c
  where c.id = i.candidate_id
    and c.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%')
    and i.status <> 'scheduled';   -- a booked-but-not-held round keeps held_at NULL

  -- ---- onboardings + their checklists ----------------------------------------
  update public.fms_hr_onboardings o set
    created_at          = c.finalized_at,
    joining_date_set_at = c.finalized_at + interval '1 day',
    offer_decided_at    = case
                            when o.offer_status = 'declined' then now() - 8 * interval '1 day'
                            else c.finalized_at + interval '2 days'
                          end,
    employee_code_at    = case when o.employee_code is null then null else c.finalized_at + interval '2 days' end,
    completed_at        = case when o.completed_at is null then null else c.joined_at end
  from public.fms_hr_candidates c
  where c.id = o.candidate_id
    and c.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%');

  update public.fms_hr_onboarding_checks k set
    created_at = o.joining_date_set_at,
    done_at    = case when k.done then o.joining_date_set_at + (k.sort_order * interval '12 hours') else null end
  from public.fms_hr_onboardings o
  where o.id = k.onboarding_id
    and o.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%');

  -- ---- probations + reviews ---------------------------------------------------
  -- A review lands a few days after the calendar month it was due; the decision a
  -- couple of days after the month-3 (or month-4) review.
  update public.fms_hr_probations p set
    opened_at            = c.joined_at,
    created_at           = c.joined_at,
    outcome_at           = case when p.outcome is null then null
                                else (p.joining_date + interval '3 months 4 days')::timestamptz end,
    extension_outcome_at = case when p.extension_outcome is null then null
                                else (p.joining_date + interval '4 months 4 days')::timestamptz end,
    final_status_at      = case when p.final_status is null then null
                                else (p.joining_date + interval '3 months 4 days')::timestamptz end
  from public.fms_hr_candidates c
  where c.id = p.candidate_id
    and p.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%');

  update public.fms_hr_probation_reviews rv set
    reviewed_at = (p.joining_date + make_interval(months => rv.month) + interval '2 days')::timestamptz,
    created_at  = (p.joining_date + make_interval(months => rv.month) + interval '2 days')::timestamptz
  from public.fms_hr_probations p
  where p.id = rv.probation_id
    and p.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%');

  -- =========================================================================
  -- 10 · DOCUMENT NUMBERS + THE ACTIVITY TRAIL.
  -- =========================================================================

  -- Candidate numbers → the demo series, in board order.
  with numbered as (
    select c.id, row_number() over (order by c.uploaded_at, c.name) rn
      from public.fms_hr_candidates c
     where c.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%')
  )
  update public.fms_hr_candidates c
     set candidate_no = 'CAN-DEMO-' || lpad(n.rn::text, 2, '0')
    from numbered n where n.id = c.id;

  -- Hand the real FY series back: nothing is left holding an MRF-2627 / CAN-2627
  -- number, so the user's first REAL requisition is numbered 0001, not 0013.
  delete from public.fms_hr_counters
   where scope in ('MRF-' || public.fms_hr_fy_code(current_date), 'CAN-' || public.fms_hr_fy_code(current_date));

  -- The requisition + candidate RPCs do not announce (the frontend store does it,
  -- right after the write). Mirror that here, with honest timestamps, so the MRF
  -- timeline and the bell are not empty.
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'submitted', r.requester_id,
         'Requisition raised: ' || r.job_title, r.submitted_at
    from public.fms_hr_requisitions r where r.mrf_no like 'MRF-DEMO-%';
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'approve', r.hr_approver_id,
         r.mrf_no || ' approved' || coalesce(' — ' || r.hr_remarks, ''), r.hr_approved_at
    from public.fms_hr_requisitions r where r.mrf_no like 'MRF-DEMO-%' and r.hr_approved_at is not null;
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'approve', r.mgmt_approver_id,
         r.mrf_no || ' approved' || coalesce(' — ' || r.mgmt_remarks, ''), r.mgmt_approved_at
    from public.fms_hr_requisitions r where r.mrf_no like 'MRF-DEMO-%' and r.mgmt_approved_at is not null;
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'send_back', r.decided_by,
         r.mrf_no || ' sent back — ' || r.sent_back_reason, r.sent_back_at
    from public.fms_hr_requisitions r where r.mrf_no like 'MRF-DEMO-%' and r.sent_back_at is not null;
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'reject', r.decided_by,
         r.mrf_no || ' rejected — ' || r.reject_reason, r.rejected_at
    from public.fms_hr_requisitions r where r.mrf_no like 'MRF-DEMO-%' and r.rejected_at is not null;
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'posted', u_khushi,
         r.mrf_no || ' posted on ' || (select count(*) from public.fms_hr_requisition_platforms rp where rp.requisition_id = r.id) || ' platform(s)',
         r.posted_at
    from public.fms_hr_requisitions r where r.mrf_no like 'MRF-DEMO-%' and r.posted_at is not null;
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'requisition', r.id, 'cvs_added', u_khushi,
         (select count(*) from public.fms_hr_candidates c where c.requisition_id = r.id) || ' CVs added to ' || r.mrf_no,
         r.posted_at + interval '1 day'
    from public.fms_hr_requisitions r
   where r.mrf_no like 'MRF-DEMO-%' and r.posted_at is not null
     and exists (select 1 from public.fms_hr_candidates c where c.requisition_id = r.id);
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, created_at)
  select 'candidate', c.id, 'moved_' || c.stage, c.hr_shortlisted_by,
         c.name || ' → ' || replace(c.stage, '_', ' '),
         coalesce(c.finalized_at, c.disqualified_at, c.final_decision_at, c.interview3_at,
                  c.interview2_at, c.interview1_at, c.hod_decided_at, c.shared_to_hod_at,
                  c.hr_shortlisted_at, c.uploaded_at)
    from public.fms_hr_candidates c
   where c.requisition_id in (select id from public.fms_hr_requisitions where mrf_no like 'MRF-DEMO-%')
     and c.stage <> 'resume_uploaded';

  -- The onboarding / probation RPCs DO announce, so those rows exist — just with a
  -- now() timestamp. Move them onto the fact they describe.
  update public.fms_hr_activity a set created_at = o.completed_at
    from public.fms_hr_onboardings o
   where a.entity_id = o.id and a.type = 'joined' and o.completed_at is not null;
  update public.fms_hr_activity a set created_at = o.offer_decided_at
    from public.fms_hr_onboardings o
   where a.entity_id = o.id and a.type like 'offer_%' and o.offer_decided_at is not null;
  update public.fms_hr_activity a set created_at = p.opened_at
    from public.fms_hr_probations p where a.entity_id = p.id and a.type = 'opened';
  update public.fms_hr_activity a set created_at = rv.reviewed_at
    from public.fms_hr_probations p
    join public.fms_hr_probation_reviews rv on rv.probation_id = p.id
   where a.entity_id = p.id and a.type = 'review_m' || rv.month;
  update public.fms_hr_activity a set created_at = coalesce(p.extension_outcome_at, p.outcome_at)
    from public.fms_hr_probations p
   where a.entity_id = p.id and a.type in ('confirmed','rejected','extended');

  -- Notifications follow their activity row's clock.
  update public.fms_hr_notifications n set created_at = a.created_at
    from public.fms_hr_activity a
   where a.entity_id = n.entity_id and a.type = n.type and a.entity_type = n.entity_type;

  raise notice 'HR demo seeded: 12 requisitions (MRF-DEMO-01..12), 22 candidates (CAN-DEMO-01..22).';
end $$;
