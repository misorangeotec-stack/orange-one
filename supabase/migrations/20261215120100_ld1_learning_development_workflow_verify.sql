-- ===========================================================================
-- LD-1 VERIFICATION — the request → session flow, walked as REAL USERS.
--
-- This repo has no test runner, so this is the proof that the RPCs in
-- 20261215120100_ld1_learning_development_workflow.sql do what they claim. It
-- asserts with `raise exception 'FAIL: …'` and returns one line per check.
--
-- ⚠ RUN IT WRAPPED IN A TRANSACTION THAT ROLLS BACK. It writes step owners, a
--   trainer, two requests and a session, and it MOVES THE APPROVAL RULE. Run it
--   unwrapped on the live database and you leave test data behind and Setup →
--   Approval Rules reading something nobody chose.
--
--     begin; \i this_file.sql  rollback;
--
--   Verified clean on 21-09-2026: after a rolled-back run, requests, sessions,
--   step owners, trainers, activity, notifications and the counter sequence were
--   all still at zero and approval_rule was still "never".
--
-- ⚠ DRIVEN AS NON-ADMIN EMPLOYEES ON PURPOSE. Admins and coordinators
--   short-circuit fms_ld_can_act, so an admin-only pass proves nothing about the
--   gates. Every actor below is a real `employee`.
--
-- ⚠ THIS IS NOT A SUBSTITUTE FOR DRIVING THE UI. It proves the database refuses
--   what it should; it says nothing about whether a screen offers the control to
--   the right person.
-- ===========================================================================

-- LD-1 end-to-end walkthrough, driven as REAL USERS (never as admin).
-- Wrapped in begin/rollback by runsql.py --rehearse: nothing survives.
--
-- Cast (all real, all non-admin employees):
--   requester = Aadil Shaikh            bcf4b9d4-e0f7-4219-86d2-636e0f90e131
--   ld_exec   = Ankita                  23e56054-0f43-4e3d-a13d-b33a82974dd9
--   hr_head   = BENI MADHAV MOHTA       fcc540e6-6b31-4b94-b5d6-01c4317b08dc
--   mgmt      = Bharat                  42653aeb-7c22-4be9-91a8-44513e2d291d
--   outsider  = Abhishekh Thakor        afc6b3c5-70d0-413f-b121-a4491bc37665

create or replace function pg_temp.be(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

create temp table ld_log (seq serial primary key, line text) on commit drop;
create or replace function pg_temp.log(p text) returns void
language sql as $f$ insert into ld_log(line) values (p) $f$;

do $$
declare
  requester uuid := 'bcf4b9d4-e0f7-4219-86d2-636e0f90e131';
  ld_exec   uuid := '23e56054-0f43-4e3d-a13d-b33a82974dd9';
  hr_head   uuid := 'fcc540e6-6b31-4b94-b5d6-01c4317b08dc';
  mgmt      uuid := '42653aeb-7c22-4be9-91a8-44513e2d291d';
  outsider  uuid := 'afc6b3c5-70d0-413f-b121-a4491bc37665';
  rid uuid; sid uuid; st text; v_code text; mreq boolean; err text;
  n_act int;
begin
  -- Wire the step owners, as an admin would in Setup.
  insert into fms_ld_step_owners (step_key, employee_ids) values
    ('need_validation',      array[ld_exec]),
    ('proposal',             array[ld_exec]),
    ('hr_head_approval',     array[hr_head]),
    ('mgmt_approval',        array[mgmt]),
    ('trainer_finalization', array[ld_exec]),
    ('session_scheduling',   array[ld_exec]),
    ('nomination',           array[ld_exec])
  on conflict (step_key) do update set employee_ids = excluded.employee_ids;

  -- ---- 1 · raise, as the requester ---------------------------------------
  perform pg_temp.be(requester);
  rid := fms_ld_create_request(jsonb_build_object(
    'title','Advanced Tally for the accounts team',
    'objective','Close the month faster with fewer reversals',
    'target_group','Accounts executives',
    'required_by', (current_date + 45)::text,
    'skill_gap','Month-end close takes 6 days',
    'submit', true));
  select status, code into st, v_code from fms_ld_requests where id = rid;
  perform pg_temp.log(format('1 raise            -> status=%s code=%s', st, v_code));
  if st <> 'submitted' or v_code is null then raise exception 'FAIL: raise'; end if;

  -- ---- 1b · an outsider must not be able to validate ----------------------
  perform pg_temp.be(outsider);
  begin
    perform fms_ld_validate_request(rid, true, '{}'::jsonb, 'sneaking in');
    raise exception 'FAIL: outsider was allowed to validate';
  exception when others then
    err := SQLERRM;
    if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log(format('1b outsider        -> refused (%s)', left(err, 48)));
  end;

  -- ---- 2 · send back, then resubmit ---------------------------------------
  perform pg_temp.be(ld_exec);
  perform fms_ld_validate_request(rid, false, '{}'::jsonb, 'Name the 4 people, not the team');
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('2 send back        -> status=%s', st));
  if st <> 'returned' then raise exception 'FAIL: send back'; end if;

  -- a send-back with no reason must be refused
  begin
    perform fms_ld_validate_request(rid, false, '{}'::jsonb, null);
    raise exception 'FAIL: send back with no reason was allowed';
  exception when others then
    err := SQLERRM;
    if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('2b no reason       -> refused');
  end;

  -- ---- 3 · validate --------------------------------------------------------
  update fms_ld_requests set status = 'submitted' where id = rid;   -- the resubmit
  perform fms_ld_validate_request(rid, true,
    jsonb_build_object('is_mandatory', false, 'duplicate_checked', true,
                       'expected_outcome','Close in 3 days'), 'Genuine gap');
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('3 validate         -> status=%s', st));
  if st <> 'under_validation' then raise exception 'FAIL: validate'; end if;

  -- ---- 4 · proposal, under the seeded rule (mgmt = never) -----------------
  perform fms_ld_submit_proposal(rid, jsonb_build_object(
    'priority','high','delivery_mode','classroom',
    'proposed_trainer_type','external','proposed_cost','40000',
    'proposed_month', date_trunc('month', current_date + 60)::date::text));
  select status, mgmt_required into st, mreq from fms_ld_requests where id = rid;
  perform pg_temp.log(format('4 proposal         -> status=%s mgmt_required=%s', st, mreq));
  if st <> 'proposed' or mreq <> false then raise exception 'FAIL: proposal under rule=never'; end if;

  -- ---- 5 · HR Head approves; with mgmt not required it goes straight through
  perform pg_temp.be(hr_head);
  perform fms_ld_approve_request(rid, 'hr_head', 'approve',
    jsonb_build_object('approved_budget','38000'), 'Approved');
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('5 hr approve       -> status=%s (skipped mgmt)', st));
  if st <> 'approved' then raise exception 'FAIL: hr approve should reach approved'; end if;

  -- the skip must be STATED in the trail, not merely absent
  select count(*) into n_act from fms_ld_activity
   where entity_id = rid and type = 'ld_mgmt_not_required';
  perform pg_temp.log(format('5b skip recorded   -> %s activity row(s)', n_act));
  if n_act <> 1 then raise exception 'FAIL: the skipped gate was not recorded'; end if;

  -- management must not be able to approve what was never put to them
  perform pg_temp.be(mgmt);
  begin
    perform fms_ld_approve_request(rid, 'management', 'approve', '{}'::jsonb, 'me too');
    raise exception 'FAIL: management approved a request that never needed it';
  exception when others then
    err := SQLERRM;
    if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('5c mgmt blocked    -> refused');
  end;

  -- ---- 7 · trainer ---------------------------------------------------------
  insert into fms_ld_trainers (name, trainer_type, agency)
  values ('ZZ TEST Agency', 'external', 'ZZ TEST') returning id into sid;
  perform pg_temp.be(ld_exec);
  perform fms_ld_finalise_trainer(rid, jsonb_build_object('trainer_id', sid::text, 'trainer_terms','2 days on site'));
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('7 trainer          -> status=%s', st));
  if st <> 'trainer_finalised' then raise exception 'FAIL: trainer'; end if;

  -- ---- 8 · session ---------------------------------------------------------
  sid := fms_ld_create_session(jsonb_build_object(
    'request_id', rid::text,
    'title','Advanced Tally for the accounts team',
    'session_date', (current_date + 40)::text,
    'start_time','10:00','end_time','17:00','hours','6',
    'capacity','12','delivery_mode','classroom',
    'registration_cutoff', (current_date + 37)::text));
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('8 session          -> request=%s session=%s', st,
    (select code from fms_ld_sessions where id = sid)));
  if st <> 'scheduled' then raise exception 'FAIL: session did not move the request'; end if;

  -- a session may NOT be dated before its own registration cut-off
  begin
    perform fms_ld_create_session(jsonb_build_object(
      'title','bad dates','session_date',(current_date + 5)::text,
      'registration_cutoff',(current_date + 9)::text));
    raise exception 'FAIL: cut-off after the session date was accepted';
  exception when others then
    err := SQLERRM;
    if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('8b cutoff check    -> refused');
  end;

  -- ---- the conditional gate, the OTHER way round ---------------------------
  update fms_ld_config set value = '{"mgmt":"above","above_amount":25000}'::jsonb
   where key = 'approval_rule';
  perform pg_temp.be(requester);
  rid := fms_ld_create_request(jsonb_build_object(
    'title','ZZ TEST expensive course','objective','x','target_group','y',
    'required_by',(current_date + 30)::text,'submit', true));
  perform pg_temp.be(ld_exec);
  perform fms_ld_validate_request(rid, true, '{}'::jsonb, 'ok');
  perform fms_ld_submit_proposal(rid, jsonb_build_object('priority','medium','proposed_cost','90000'));
  select mgmt_required into mreq from fms_ld_requests where id = rid;
  perform pg_temp.log(format('R1 above/90000     -> mgmt_required=%s', mreq));
  if mreq <> true then raise exception 'FAIL: 90000 should need management'; end if;

  perform pg_temp.be(hr_head);
  perform fms_ld_approve_request(rid, 'hr_head', 'approve', '{}'::jsonb, 'ok');
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('R2 hr approve      -> status=%s (waits for mgmt)', st));
  if st <> 'hr_approved' then raise exception 'FAIL: should stop at hr_approved'; end if;

  -- moving the threshold now must NOT change this live request
  update fms_ld_config set value = '{"mgmt":"above","above_amount":100000}'::jsonb
   where key = 'approval_rule';
  select mgmt_required into mreq from fms_ld_requests where id = rid;
  perform pg_temp.log(format('R3 threshold moved -> mgmt_required still %s', mreq));
  if mreq <> true then raise exception 'FAIL: a live request changed gate when the rule moved'; end if;

  perform pg_temp.be(mgmt);
  perform fms_ld_approve_request(rid, 'management', 'approve',
    jsonb_build_object('approved_budget','88000'), 'Go ahead');
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('R4 mgmt approve    -> status=%s', st));
  if st <> 'approved' then raise exception 'FAIL: mgmt approve'; end if;

  -- ---- reads: an unrelated employee must not see the budget ----------------
  perform pg_temp.be(outsider);
  if fms_ld_can_read_request(rid, outsider) then
    raise exception 'FAIL: an unrelated employee can read a training request';
  end if;
  perform pg_temp.log('X1 read gate       -> outsider refused');
  if not fms_ld_can_read_request(rid, ld_exec) then
    raise exception 'FAIL: the L&D executive cannot read the request';
  end if;
  perform pg_temp.log('X2 read gate       -> L&D exec allowed');
  perform pg_temp.be(requester);
  if not fms_ld_can_read_request(rid, requester) then
    raise exception 'FAIL: the requester cannot read their own request';
  end if;
  perform pg_temp.log('X3 read gate       -> requester allowed');

  perform pg_temp.log('ALL CHECKS PASSED');
end $$;

select line from ld_log order by seq;
