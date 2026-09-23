-- ===========================================================================
-- LD-3 … LD-8 VERIFICATION — one training walked from approval to closure.
--
-- No test runner in this repo, so this is the proof that the delivery RPCs do
-- what they claim. 26 checks, driven as the REAL people at each step (Saloni,
-- Riya, Karan, two nominees and a nominee's own HOD) because admins and
-- coordinators short-circuit fms_ld_can_act_session and an admin-only pass
-- proves nothing about the gates.
--
-- ⚠ RUN WRAPPED IN A TRANSACTION THAT ROLLS BACK:
--       begin; \i this_file.sql  rollback;
--   It writes step owners, a trainer, two requests, a session, nominations,
--   attendance, an assignment, feedback and effectiveness reviews, and it
--   CLOSES a training record.
--
-- Two defects it caught on first run, both now fixed in the migration:
--   • Sending invitations checked the `invitation` step, which is ROW-OWNED by
--     the nominee — so HR was refused outright. It checks nomination_approval.
--   • fms_ld_close_attendance declared a record variable `a` that shadowed the
--     table alias `a` in an earlier subquery: "record \"a\" is not assigned yet",
--     at runtime only.
-- ===========================================================================

-- LD-3 … LD-8 verification: one training walked from approval to closure, driven
-- as the REAL people at each step. Asserts with `raise exception 'FAIL: …'` and
-- returns one line per check.
--
-- ⚠ RUN WRAPPED IN A TRANSACTION THAT ROLLS BACK. It creates a request, a
--   session, nominations, attendance, an assignment, feedback and effectiveness
--   reviews, and it CLOSES a training record.
create temp table ld_log (seq serial primary key, line text) on commit drop;
create or replace function pg_temp.log(p text) returns void
language sql as $f$ insert into ld_log(line) values (p) $f$;

create or replace function pg_temp.be(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  saloni uuid := 'f8871325-841b-4f8a-98c8-efeb7cbd27ae';  -- HR/L&D Executive
  riya   uuid := '1b0deef0-fbcf-40eb-b3d4-b00f8a87e3b7';  -- HR Head
  karan  uuid := 'e3977634-30a3-4a1e-9d5f-4db93b327457';  -- Management
  aadil  uuid := 'bcf4b9d4-e0f7-4219-86d2-636e0f90e131';  -- nominee, HOD = Vivek Boid
  abhi   uuid := 'afc6b3c5-70d0-413f-b121-a4491bc37665';  -- nominee, HOD = Rajneesh Kumar
  vivek  uuid := '66586379-f066-4e83-8188-3db942cadf44';  -- Aadil's HOD
  rid uuid; sid uuid; aid uuid; tid uuid; nid uuid; eid uuid; subid uuid;
  st text; err text; n int; res jsonb;
begin
  -- The delivery steps need owners, exactly as Setup would name them. Doing it
  -- here keeps the test self-contained rather than dependent on live config.
  insert into fms_ld_step_owners (step_key, employee_ids) values
    ('need_validation',array[saloni]), ('proposal',array[saloni]),
    ('hr_head_approval',array[riya]),  ('mgmt_approval',array[karan]),
    ('trainer_finalization',array[saloni]), ('session_scheduling',array[saloni]),
    ('nomination',array[saloni]), ('nomination_approval',array[saloni]),
    ('pre_material',array[saloni]), ('conducted',array[saloni]),
    ('attendance',array[saloni]), ('assignment_issue',array[saloni]),
    ('assignment_review',array[saloni]), ('session_review',array[saloni]),
    ('effectiveness',array[saloni]), ('followup_decision',array[saloni]),
    ('closure',array[saloni])
  on conflict (step_key) do update set employee_ids = excluded.employee_ids;

  -- ---- set the stage: an approved request with a trainer ------------------
  perform pg_temp.be(aadil);
  rid := fms_ld_create_request(jsonb_build_object(
    'title','VERIFY delivery chain','objective','x','target_group','y',
    'required_by',(current_date + 20)::text,'submit',true));
  perform pg_temp.be(saloni);
  perform fms_ld_validate_request(rid, true, '{}'::jsonb, 'ok');
  perform fms_ld_submit_proposal(rid, jsonb_build_object('priority','high','proposed_cost','5000'));
  perform pg_temp.be(riya);
  perform fms_ld_approve_request(rid, 'hr_head', 'approve', '{}'::jsonb, 'ok');
  insert into fms_ld_trainers (name, trainer_type, agency)
  values ('VERIFY Agency','external','VERIFY') returning id into tid;
  perform pg_temp.be(saloni);
  perform fms_ld_finalise_trainer(rid, jsonb_build_object('trainer_id', tid::text));
  sid := fms_ld_create_session(jsonb_build_object(
    'request_id', rid::text,'title','VERIFY delivery chain',
    'session_date',(current_date + 3)::text,'hours','6','capacity','2'));
  perform pg_temp.log('setup             -> session created');

  -- ---- 9 · nominate; capacity is enforced ---------------------------------
  n := fms_ld_nominate(sid, array[aadil, abhi], 'hr');
  perform pg_temp.log(format('9  nominate        -> %s nominated (auto-approved by HR)', n));
  if n <> 2 then raise exception 'FAIL: nominate'; end if;

  begin
    perform fms_ld_nominate(sid, array[riya], 'hr');
    raise exception 'FAIL: capacity of 2 was exceeded';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('9b capacity        -> third nominee refused');
  end;

  -- a non-participant cannot RSVP
  perform pg_temp.be(riya);
  begin
    perform fms_ld_rsvp(sid, true, null);
    raise exception 'FAIL: a non-nominee was allowed to RSVP';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('11a outsider RSVP  -> refused');
  end;

  -- ---- 11 · invitations and RSVP ------------------------------------------
  perform pg_temp.be(saloni);
  n := fms_ld_send_invitations(sid);
  perform pg_temp.log(format('11 invitations     -> %s sent', n));
  if n <> 2 then raise exception 'FAIL: invitations'; end if;

  perform pg_temp.be(aadil);
  perform fms_ld_rsvp(sid, true, null);
  perform pg_temp.be(abhi);
  begin
    perform fms_ld_rsvp(sid, false, null);
    raise exception 'FAIL: declined with no reason';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('11b decline reason -> required');
  end;
  perform fms_ld_rsvp(sid, false, 'On leave that week');
  select count(*) into n from fms_ld_nominations where session_id = sid and rsvp = 'accepted';
  perform pg_temp.log(format('11c RSVP           -> %s accepted, 1 declined with a reason', n));

  -- ---- 12 · readiness is blocked with no material -------------------------
  perform pg_temp.be(saloni);
  begin
    perform fms_ld_confirm_readiness(sid);
    raise exception 'FAIL: ready with no material';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('12a readiness      -> blocked with no material');
  end;
  perform fms_ld_add_material(sid, jsonb_build_object('title','Agenda','kind','agenda'));
  perform fms_ld_confirm_readiness(sid);
  select status into st from fms_ld_sessions where id = sid;
  perform pg_temp.log(format('12 material        -> status=%s', st));
  if st <> 'ready' then raise exception 'FAIL: readiness'; end if;

  -- ---- 13 · conduct; a cancellation needs a reason -------------------------
  begin
    perform fms_ld_record_conduct(sid, jsonb_build_object('outcome','cancelled'));
    raise exception 'FAIL: cancelled with no reason';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('13a cancel reason  -> required');
  end;
  perform fms_ld_record_conduct(sid, jsonb_build_object(
    'outcome','conducted','trainer_attended', true,
    'actual_start', (now() - interval '6 hours')::text, 'actual_end', now()::text));
  select status into st from fms_ld_sessions where id = sid;
  perform pg_temp.log(format('13 conducted       -> status=%s', st));

  -- ---- 14 · attendance; closing is blocked while anyone is unmarked -------
  begin
    perform fms_ld_close_attendance(sid);
    raise exception 'FAIL: attendance closed with nobody marked';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('14a close          -> blocked, nominees unmarked');
  end;

  n := fms_ld_mark_attendance(sid, jsonb_build_array(
    jsonb_build_object('employee_id', aadil::text, 'status','present'),
    jsonb_build_object('employee_id', abhi::text,  'status','absent', 'reason','On leave')));
  perform pg_temp.log(format('14 attendance      -> %s marked', n));

  res := fms_ld_close_attendance(sid);
  perform pg_temp.log(format('14b closed         -> hod_tasks=%s no_reviewer=%s',
    res->>'hod_tasks', res->>'no_reviewer'));
  if (res->>'hod_tasks')::int < 1 then raise exception 'FAIL: no effectiveness task created'; end if;

  -- ---- 15/16/17 · the assignment ------------------------------------------
  aid := fms_ld_issue_assignment(sid, jsonb_build_object('title','Write up one change you will make'));
  -- A row per ATTENDEE, not per nominee: Abhishekh was absent, so he owes nothing.
  select count(*) into n from fms_ld_assignment_submissions where assignment_id = aid;
  perform pg_temp.log(format('15 assignment      -> %s submission row(s) pre-created (attendees only)', n));
  if n <> 1 then raise exception 'FAIL: submission rows should cover attendees only'; end if;

  -- somebody who was not there cannot submit
  perform pg_temp.be(abhi);
  begin
    perform fms_ld_submit_assignment(aid, jsonb_build_object('note','me too'));
    raise exception 'FAIL: an absentee submitted an assignment';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('16a absentee       -> cannot submit');
  end;

  perform pg_temp.be(aadil);
  perform fms_ld_submit_assignment(aid, jsonb_build_object('note','Will automate the reconciliation'));
  select id into subid from fms_ld_assignment_submissions where assignment_id = aid and employee_id = aadil;
  perform pg_temp.log('16 submitted       -> ok');

  perform pg_temp.be(saloni);
  begin
    perform fms_ld_review_submission(subid, 'needs_rework', null);
    raise exception 'FAIL: needs_rework with no remarks';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('17a rework         -> remarks required');
  end;
  perform fms_ld_review_submission(subid, 'accepted', 'Good');
  perform pg_temp.log('17 reviewed        -> accepted');

  -- ---- 18 · feedback -------------------------------------------------------
  perform pg_temp.be(aadil);
  perform fms_ld_submit_feedback(sid, jsonb_build_object(
    'overall_rating','4','trainer_rating','5','content_rating','4','comment','Useful'));
  select count(*) into n from fms_ld_feedback where session_id = sid;
  perform pg_temp.log(format('18 feedback        -> %s response(s)', n));

  -- ---- 19 · HR session review ---------------------------------------------
  perform pg_temp.be(saloni);
  perform fms_ld_review_session(sid, jsonb_build_object(
    'review_note','Went well','action_points','Repeat next quarter','actual_cost','4800'));
  perform pg_temp.log('19 session review  -> recorded');

  -- ---- 20 · the HOD's 30-day note -----------------------------------------
  select id into eid from fms_ld_effectiveness where session_id = sid and hod_id = vivek;
  if eid is null then raise exception 'FAIL: no effectiveness task for the attendee''s HOD'; end if;

  -- somebody else's review is not yours to write
  perform pg_temp.be(abhi);
  begin
    perform fms_ld_submit_effectiveness(eid, jsonb_build_object('outcome','effective'));
    raise exception 'FAIL: wrote another HOD''s review';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('20a wrong HOD      -> refused');
  end;

  perform pg_temp.be(vivek);
  perform fms_ld_submit_effectiveness(eid, jsonb_build_object(
    'outcome','effective','rating','4','application_observed','Reconciliation is faster'));
  perform pg_temp.log('20 effectiveness   -> submitted by the attendee''s own HOD');

  -- ---- 22 · closure --------------------------------------------------------
  perform pg_temp.be(saloni);
  perform fms_ld_close_request(rid, jsonb_build_object('final_outcome','Effective','actual_cost','4800'));
  select status into st from fms_ld_requests where id = rid;
  perform pg_temp.log(format('22 closure         -> status=%s', st));
  if st <> 'closed' then raise exception 'FAIL: closure'; end if;

  -- closing again must be refused
  begin
    perform fms_ld_close_request(rid, '{}'::jsonb);
    raise exception 'FAIL: closed twice';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log('22a double close   -> refused');
  end;

  -- ---- closure is blocked while a review is outstanding --------------------
  perform pg_temp.be(aadil);
  rid := fms_ld_create_request(jsonb_build_object(
    'title','VERIFY blocked closure','objective','x','target_group','y',
    'required_by',(current_date + 20)::text,'submit',true));
  perform pg_temp.be(saloni);
  perform fms_ld_validate_request(rid, true, '{}'::jsonb, 'ok');
  perform fms_ld_submit_proposal(rid, jsonb_build_object('priority','low','proposed_cost','1000'));
  perform pg_temp.be(riya);
  perform fms_ld_approve_request(rid, 'hr_head', 'approve', '{}'::jsonb, 'ok');
  perform pg_temp.be(saloni);
  perform fms_ld_finalise_trainer(rid, jsonb_build_object('trainer_id', tid::text));
  sid := fms_ld_create_session(jsonb_build_object(
    'request_id', rid::text,'title','VERIFY blocked closure','session_date',(current_date + 2)::text));
  begin
    perform fms_ld_close_request(rid, '{}'::jsonb);
    raise exception 'FAIL: closed with attendance still open';
  exception when others then
    err := SQLERRM; if err like 'FAIL:%' then raise; end if;
    perform pg_temp.log(format('X  closure gate    -> refused (%s)', left(err, 60)));
  end;

  perform pg_temp.log('ALL CHECKS PASSED');
end $$;

select line from ld_log order by seq;
