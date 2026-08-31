-- ===========================================================================
-- Travel Desk FMS — THE APPROVAL CHAIN (Phase 4).
--
--   fms_travel_approval_matrix   — which bands need what, as CONFIG not code
--   fms_travel_next_stop         — THE ONE ROUTER. Every transition asks it
--   fms_travel_decide_manager    — approve / reject / return for clarification
--   fms_travel_decide_director   — the same, for bands the matrix sends there
--   fms_travel_hold / _resume / _cancel_trip
--
-- ⚠ ROUTING IS ON THE BAND NUMBER, NOT ON THE TRAVEL CATEGORY. §3.2 is
--   unambiguous about this even though the band-to-category mapping is still
--   disputed (H1), which is exactly why the approval chain does not wait on that
--   answer. Nothing here reads snap_travel_category.
--
-- ⚠ ONE ROUTER, CALLED FROM FOUR PLACES. submit, the two decisions and resume
--   all ask fms_travel_next_stop where a trip goes next. That is not tidiness:
--   20260905120000 (General Purchase) documents THREE separate defects that all
--   came from the same root — different code paths each deciding for themselves
--   which step comes next, and disagreeing about a step that had been SKIPPED.
--   Its defect (F) is precisely "holding and resuming a skipped request would
--   silently reroute it to the step it skipped". A single router cannot do that,
--   because resume asks the same question submit did and gets the same answer.
--
-- ⚠ A SKIPPED STEP CANNOT BE DECIDED. That is defect (E) from the same file:
--   editability keyed on STATUS alone let an approver "correct" a decision that
--   was never made. Both decision RPCs here test the skip flag, not merely the
--   status.
--
-- Additive: 3 nullable columns, 1 config key, 7 functions, 2 replaced functions.
-- Reversal (reverse order):
--   drop function if exists public.fms_travel_cancel_trip(uuid, text);
--   drop function if exists public.fms_travel_resume_trip(uuid);
--   drop function if exists public.fms_travel_hold_trip(uuid, text);
--   drop function if exists public.fms_travel_decide_director(uuid, text, text);
--   drop function if exists public.fms_travel_decide_manager(uuid, text, text);
--   drop function if exists public.fms_travel_next_stop(uuid, text);
--   drop function if exists public.fms_travel_approval_matrix();
--   delete from public.fms_travel_config where key = 'approval_matrix';
--   alter table public.fms_travel_trips
--     drop column if exists manager_approval_skipped,
--     drop column if exists tc_downgraded_from,
--     drop column if exists tc_downgraded_at;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- New columns.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_trips
  add column if not exists manager_approval_skipped boolean not null default false,
  add column if not exists tc_downgraded_from text,
  add column if not exists tc_downgraded_at   timestamptz;

comment on column public.fms_travel_trips.manager_approval_skipped is
  'The approval matrix sent this band straight to a Director. Off by default - §3.2 leaves "[CONFIRM if HOD is also needed]" open for bands 6-8 (H10), and the default answer is that BOTH are needed.';
comment on column public.fms_travel_trips.tc_downgraded_from is
  'The travel category this trip was frozen at before §3.5 downgraded it to TC-D for being regularised late. Null on every trip that was not downgraded.';


-- ---------------------------------------------------------------------------
-- The approval matrix, as config.
--
-- ⚠ H10 LIVES HERE. §3.2 sends bands 6-9 to a Director and then leaves
--   "[⚠ CONFIRM if HOD is also needed]" hanging for bands 6-8. The default is
--   BOTH — the safer reading, and the one that cannot lose an approval nobody
--   meant to drop. Answering H10 the other way is a setting, not a deploy.
-- ---------------------------------------------------------------------------
insert into public.fms_travel_config (key, value)
values ('approval_matrix', jsonb_build_object(
  'director_from_band', 6,
  'manager_also_for_director_bands', true))
on conflict (key) do nothing;

create or replace function public.fms_travel_approval_matrix()
returns table (director_from_band integer, manager_also boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((value->>'director_from_band')::int, 6),
         coalesce((value->>'manager_also_for_director_bands')::boolean, true)
    from public.fms_travel_config where key = 'approval_matrix'
  union all
  select 6, true
   where not exists (select 1 from public.fms_travel_config where key = 'approval_matrix')
  limit 1;
$$;

comment on function public.fms_travel_approval_matrix() is
  'Which bands need a Director (§3.2), and whether those bands also need their reporting manager (H10, defaulting to yes). Config, not code - the answer changes by memo.';
grant execute on function public.fms_travel_approval_matrix() to authenticated;


-- ===========================================================================
-- THE ROUTER. Where does this trip go after `p_after` completes?
--
-- `p_after` is the step that has just finished: 'request' (i.e. submit),
-- 'manager_approval', 'director_approval' or 'advance'. Passing 'resume' asks
-- the question from scratch, reading only what has actually been stamped.
--
-- ⚠ IT READS THE SKIP FLAGS AND THE STAMPS, NEVER THE CURRENT STATUS. That is
--   what makes it safe to call from resume: a held trip's status is 'on_hold',
--   which says nothing about where it was going.
-- ===========================================================================
create or replace function public.fms_travel_next_stop(p_trip uuid, p_after text)
returns table (next_status text, next_step text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t          record;
  v_dir_from int;
  v_mgr_also boolean;
  v_needs_dir boolean;
  v_needs_mgr boolean;
begin
  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then raise exception 'Trip not found'; end if;

  select m.director_from_band, m.manager_also into v_dir_from, v_mgr_also
    from public.fms_travel_approval_matrix() m;

  v_needs_dir := coalesce(t.snap_band_no, 0) >= v_dir_from;
  -- A band below the Director threshold always needs its manager. A band at or
  -- above it needs one only while H10 is answered "both".
  v_needs_mgr := (not v_needs_dir) or v_mgr_also;

  -- Manager approval, if this trip has not had it and is not skipping it.
  if p_after in ('request', 'resume')
     and v_needs_mgr and not t.manager_approval_skipped and t.ma_at is null then
    return query select 'awaiting_manager_approval', 'manager_approval';
    return;
  end if;

  -- Director approval, likewise.
  if p_after in ('request', 'resume', 'manager_approval')
     and v_needs_dir and not t.director_approval_skipped and t.da_at is null then
    return query select 'awaiting_director_approval', 'director_approval';
    return;
  end if;

  -- The advance, if one was asked for and has not been paid.
  if p_after in ('request', 'resume', 'manager_approval', 'director_approval')
     and t.advance_requested and not t.advance_skipped and t.adv_at is null then
    return query select 'awaiting_advance', 'advance';
    return;
  end if;

  -- Otherwise the Travel Desk books it. Anything past booking is phases 6-9;
  -- until they land, a resumed trip that is already booked stays booked.
  if t.bk_at is null then
    return query select 'awaiting_booking', 'booking';
  else
    return query select 'booked', 'claim';
  end if;
end $$;

comment on function public.fms_travel_next_stop(uuid, text) is
  'THE ONE ROUTER. submit, both decisions and resume all ask this, so no two of them can disagree about a step that was skipped - the root of all three defects 20260905120000 documents.';
grant execute on function public.fms_travel_next_stop(uuid, text) to authenticated;


-- ===========================================================================
-- SUBMIT, replaced.
--
-- Three changes from 20261005120800, all of them consequences of the matrix:
--   1. `advance_skipped` is set from `advance_requested`. Without it the rail
--      showed the Advance step as PENDING for ever on the majority of trips
--      that never draw one — the exact "forever-pending" failure the skip flags
--      exist to prevent.
--   2. `manager_approval_skipped` is set from the matrix.
--   3. The first stop comes from the router rather than being hard-coded to
--      manager approval.
-- Plus §3.5's retrospective test, which can only be applied at submit — it is a
-- statement about how late the REQUEST was, not about how slow the approver is.
-- ===========================================================================
create or replace function public.fms_travel_submit_trip(p_trip uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_status    text;
  v_owner     uuid;
  v_traveller uuid;
  v_depart    date;
  v_purpose   uuid;
  v_requires  boolean;
  v_remarks   text;
  v_emergency boolean;
  v_window    int;
  v_hours     int;
  v_band_no   int;
  v_dept      uuid;
  v_desig     uuid;
  v_base_city uuid;
  v_card      uuid;
  v_tc        text;
  v_tc_from   text;
  v_approvers uuid[];
  v_dir_from  int;
  v_mgr_also  boolean;
  v_needs_dir boolean;
  v_skip_dir  boolean;
  v_skip_mgr  boolean;
  v_advance   boolean;
  v_no        text;
  v_fy        text;
  v_next      record;
  v_recipients uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, traveller_id, planned_departure_date, purpose_id,
         purpose_other_remarks, is_emergency, advance_requested
    into v_status, v_owner, v_traveller, v_depart, v_purpose,
         v_remarks, v_emergency, v_advance
    from public.fms_travel_trips where id = p_trip for update;

  if v_status is null then raise exception 'Trip not found'; end if;
  if v_status not in ('draft', 'returned') then
    raise exception 'This trip is already %', replace(v_status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('request', p_trip, v_uid) then
    raise exception 'You are not authorized to submit a trip request';
  end if;
  if v_owner is distinct from v_uid and not public.fms_travel_is_coordinator(v_uid) then
    raise exception 'This trip request belongs to somebody else';
  end if;

  if v_traveller is null then
    raise exception 'Say who is travelling — the trip is priced on their band and paid into their account';
  end if;
  if v_depart is null then
    raise exception 'Give a departure date';
  end if;

  if v_purpose is not null then
    select requires_remarks into v_requires from public.fms_travel_purposes where id = v_purpose;
    if coalesce(v_requires, false) and coalesce(btrim(coalesce(v_remarks, '')), '') = '' then
      raise exception 'This purpose needs a reason in writing';
    end if;
  end if;

  select coalesce((value->>'booking_window_days')::int, 30),
         coalesce((value->>'emergency_window_hours')::int, 24)
    into v_window, v_hours
    from public.fms_travel_config where key = 'policy';
  v_window := coalesce(v_window, 30);
  v_hours  := coalesce(v_hours, 24);

  if v_depart > current_date + v_window then
    raise exception 'Travel must be within the next % days. Raise it closer to the date.', v_window;
  end if;

  -- ---- FREEZE THE SNAPSHOT ------------------------------------------------
  select b.band_no, p.department_id, p.designation_id
    into v_band_no, v_dept, v_desig
    from public.profiles p
    left join public.bands b on b.id = p.band_id
   where p.id = v_traveller;

  if v_band_no is null then
    raise exception 'This traveller has no band on their profile, and the band is what decides every entitlement and cap. Ask an administrator to set it first.';
  end if;

  select base_city_id into v_base_city
    from public.fms_travel_employee_settings where user_id = v_traveller;

  v_card := public.fms_travel_effective_rate_card(v_depart);
  if v_card is null then
    raise exception 'There is no rate card in force, so nothing can be priced. Ask an administrator to set one up.';
  end if;

  v_tc := public.fms_travel_category_for_band(v_card, v_band_no);
  if v_tc is null then
    raise exception 'The rate card does not say which travel category band % falls into.', v_band_no;
  end if;

  /*
    §3.5 — EMERGENCY TRAVEL REGULARISED TOO LATE IS REIMBURSED AT TC-D.

    ⚠ THE TEST IS ON THE REQUEST, NOT ON THE APPROVAL, and that distinction is
      the whole fairness of the rule. §3.5 gives the EMPLOYEE a window to put an
      unplanned trip on the record; measuring it at approval time would punish
      the traveller for a manager who was on leave.

    ⚠ ONLY A TRIP THAT HAS ALREADY DEPARTED can be late in this sense. An
      emergency flagged in advance is not retrospective at all, so it is not
      downgraded — the flag then means only "this is urgent".

    The original category is kept in tc_downgraded_from. Overwriting it with no
    record would leave a band-9 Director silently on TC-D rates with nothing on
    the row to explain why.
  */
  if coalesce(v_emergency, false)
     and v_depart < current_date
     and now() > (v_depart::timestamp + make_interval(hours => v_hours)) then
    v_tc_from := v_tc;
    v_tc := 'TC-D';
  end if;

  v_approvers := public.fms_travel_default_approvers(v_traveller);

  select m.director_from_band, m.manager_also into v_dir_from, v_mgr_also
    from public.fms_travel_approval_matrix() m;
  v_needs_dir := v_band_no >= v_dir_from;
  v_skip_dir  := not v_needs_dir;
  v_skip_mgr  := v_needs_dir and not v_mgr_also;

  if v_status = 'draft' then
    v_fy := public.fms_travel_fy_code(current_date);
    v_no := 'TRV-' || v_fy || '-' || lpad(public.fms_travel_next_seq('trip:' || v_fy)::text, 4, '0');
  else
    select trip_no into v_no from public.fms_travel_trips where id = p_trip;
  end if;

  update public.fms_travel_trips set
    trip_no                   = coalesce(trip_no, v_no),
    snap_band_no              = v_band_no,
    snap_travel_category      = v_tc,
    snap_department_id        = v_dept,
    snap_designation_id       = v_desig,
    snap_base_city_id         = v_base_city,
    snap_rate_card_id         = v_card,
    tc_downgraded_from        = v_tc_from,
    tc_downgraded_at          = case when v_tc_from is not null then now() else null end,
    approver_manager_ids      = v_approvers,
    approver_manager_note     = case when array_length(v_approvers, 1) is null
                                     then 'No reporting manager is recorded for this traveller, so it routes to the configured approvers.'
                                     else null end,
    director_approval_skipped = v_skip_dir,
    manager_approval_skipped  = v_skip_mgr,
    -- ⚠ SET HERE, NOT DISCOVERED LATER. Most trips draw no advance, and without
    --   this the rail showed that step as pending for ever on all of them.
    advance_skipped           = not coalesce(v_advance, false),
    -- ⚠ RE-STAMPED ON EVERY SUBMISSION, including after a return for
    --   clarification, so a request that came back and went again does not
    --   arrive already overdue. OCPI's 20260929121700 had to retrofit this.
    submitted_at              = now(),
    returned_at               = null,
    returned_stage            = null,
    returned_reason           = null
  where id = p_trip;

  -- The router decides the first stop, exactly as it decides every later one.
  select n.next_status, n.next_step into v_next
    from public.fms_travel_next_stop(p_trip, 'request') n;

  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  v_recipients := public.fms_travel_step_owner_ids(v_next.next_step);
  if v_next.next_step = 'manager_approval' and array_length(v_approvers, 1) is not null then
    v_recipients := v_recipients || v_approvers;
  end if;

  perform public.fms_travel_announce(
    'trip', p_trip, 'trip_submitted',
    v_no || ' needs your approval',
    v_recipients,
    jsonb_build_object('trip_no', v_no, 'band', v_band_no, 'travel_category', v_tc,
                       'step', v_next.next_step));

  if v_tc_from is not null then
    perform public.fms_travel_announce(
      'trip', p_trip, 'tc_downgraded',
      v_no || ' was regularised more than ' || v_hours || ' hours after departure, so §3.5 reimburses it at TC-D instead of ' || v_tc_from,
      '{}'::uuid[],
      jsonb_build_object('from', v_tc_from, 'to', 'TC-D'));
  end if;

  return v_no;
end $$;

comment on function public.fms_travel_submit_trip(uuid) is
  'Freeze the traveller snapshot, mint TRV-<fy>-0001 and send the trip to whichever step the approval matrix puts first. Applies §3.5 retrospective downgrade at submit, because that rule measures how late the REQUEST was, not the approver.';
grant execute on function public.fms_travel_submit_trip(uuid) to authenticated;


-- ===========================================================================
-- SAVE DRAFT, replaced — a RETURNED trip is editable again.
--
-- ⚠ WITHOUT THIS, "RETURN FOR CLARIFICATION" IS A DEAD END. The approver sends
--   it back asking for a cheaper hotel or a corrected date, and the author finds
--   a form that refuses every change because the status is no longer 'draft'.
--   A returned trip is precisely a trip somebody has been ASKED to edit.
--
-- It keeps its number: the number was minted at the first submission and the
-- trip is the same trip. Only a never-submitted draft can still be thrown away.
-- ===========================================================================
create or replace function public.fms_travel_save_draft(p jsonb, p_trip uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_trip   uuid := p_trip;
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.fms_travel_can_act('request', null, v_uid) then
    raise exception 'You are not authorized to raise a trip request';
  end if;

  if v_trip is null then
    insert into public.fms_travel_trips (raised_by, status)
    values (v_uid, 'draft')
    returning id into v_trip;
  else
    select status, raised_by into v_status, v_owner
      from public.fms_travel_trips where id = v_trip for update;

    if v_status is null then raise exception 'Trip not found'; end if;
    if v_status not in ('draft', 'returned') then
      raise exception 'This trip has already been submitted, so it can no longer be edited. Ask the approver to send it back for clarification.';
    end if;
    if v_owner is distinct from v_uid and not public.fms_travel_is_coordinator(v_uid) then
      raise exception 'This draft belongs to somebody else';
    end if;
  end if;

  perform public.fms_travel_write_trip(v_trip, p);
  return v_trip;
end $$;

comment on function public.fms_travel_save_draft(jsonb, uuid) is
  'Create or update a trip request while it is a DRAFT or has been RETURNED for clarification. Anything else is locked - the approver decides on what they were shown.';
grant execute on function public.fms_travel_save_draft(jsonb, uuid) to authenticated;


-- ===========================================================================
-- THE TWO DECISIONS.
--
-- One body, two thin wrappers, because approve/reject/return mean exactly the
-- same three things at both gates and the only differences are which stamp
-- columns are written and which guard applies.
-- ===========================================================================
create or replace function public.fms_travel_decide(
  p_trip     uuid,
  p_step     text,
  p_decision text,
  p_note     text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  t       record;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_next  record;
  v_recipients uuid[];
  v_label text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve', 'reject', 'return') then
    raise exception 'Unknown decision: %', p_decision;
  end if;
  if p_step not in ('manager_approval', 'director_approval') then
    raise exception 'Unknown approval step: %', p_step;
  end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;

  /*
    ⚠ DEFECT (E) FROM 20260905120000, GUARDED HERE. That file records an
      approver being able to "correct" a decision that was never made, because
      editability was keyed on the STATUS alone and a skipped request sits at
      exactly the status the next step expects. Testing the skip flag is what
      stops a Director signing off a band-3 trip that never went near them.
  */
  if p_step = 'director_approval' and t.director_approval_skipped then
    raise exception 'Band % does not need Director approval (§3.2), so there is no decision here to make.',
      coalesce(t.snap_band_no::text, '—');
  end if;
  if p_step = 'manager_approval' and t.manager_approval_skipped then
    raise exception 'This trip skipped reporting-manager approval, so there is no decision here to make.';
  end if;

  if p_step = 'manager_approval' and t.status <> 'awaiting_manager_approval' then
    raise exception 'This trip is %, not awaiting manager approval', replace(t.status, '_', ' ');
  end if;
  if p_step = 'director_approval' and t.status <> 'awaiting_director_approval' then
    raise exception 'This trip is %, not awaiting Director approval', replace(t.status, '_', ' ');
  end if;

  if not public.fms_travel_can_act(p_step, p_trip, v_uid) then
    raise exception 'You are not authorized to decide this step';
  end if;

  /*
    ⚠ NOBODY APPROVES THEIR OWN TRAVEL, INCLUDING A COORDINATOR AND AN ADMIN.
      fms_travel_can_act lets a coordinator act on any step, which is right for
      booking and wrong for approving — it would let the Travel Desk raise a trip
      for themselves and wave it through. The test is on the TRAVELLER, not on
      who filed it: a coordinator raising a trip for somebody else is ordinary
      work, and that person's manager still decides.
  */
  if t.traveller_id = v_uid then
    raise exception 'You cannot approve your own travel. It has to be decided by somebody else — a second Director, or whoever is named on this step in Settings.';
  end if;

  -- A refusal and a request for changes are both instructions, and an
  -- instruction with no words is not one.
  if p_decision in ('reject', 'return') and v_note is null then
    raise exception 'Say why. A trip sent back or turned down without a reason leaves its author nothing to act on.';
  end if;

  v_label := case when p_step = 'director_approval' then 'Director' else 'Reporting manager' end;

  -- ---- write the decision -------------------------------------------------
  if p_step = 'manager_approval' then
    update public.fms_travel_trips
       set ma_at = now(), ma_by = v_uid, ma_decision = p_decision, ma_note = v_note
     where id = p_trip;
  else
    update public.fms_travel_trips
       set da_at = now(), da_by = v_uid, da_decision = p_decision, da_note = v_note
     where id = p_trip;
  end if;

  -- ---- move it ------------------------------------------------------------
  if p_decision = 'reject' then
    update public.fms_travel_trips
       set status = 'rejected', current_step = null,
           rejected_at = now(), rejected_stage = p_step, reject_reason = v_note
     where id = p_trip;

    perform public.fms_travel_announce('trip', p_trip, 'trip_rejected',
      coalesce(t.trip_no, 'The trip') || ' was turned down by the ' || lower(v_label) || ' — ' || v_note,
      array_remove(array[t.raised_by, t.traveller_id], null),
      jsonb_build_object('step', p_step));
    return 'rejected';
  end if;

  if p_decision = 'return' then
    /*
      ⚠ THE DECISION STAMP IS CLEARED ON THE WAY BACK. A returned trip is
        resubmitted through fms_travel_submit_trip, and the router asks "has this
        step been decided?" by looking at ma_at / da_at. Leaving the stamp in
        place would send a returned trip straight past the approver who returned
        it — they asked for a change and would never see the answer.
    */
    if p_step = 'manager_approval' then
      update public.fms_travel_trips set ma_at = null, ma_by = null where id = p_trip;
    else
      update public.fms_travel_trips set da_at = null, da_by = null where id = p_trip;
    end if;

    update public.fms_travel_trips
       set status = 'returned', current_step = 'request',
           returned_at = now(), returned_stage = p_step, returned_reason = v_note
     where id = p_trip;

    perform public.fms_travel_announce('trip', p_trip, 'trip_returned',
      coalesce(t.trip_no, 'The trip') || ' was sent back for clarification — ' || v_note,
      array_remove(array[t.raised_by, t.traveller_id], null),
      jsonb_build_object('step', p_step));
    return 'returned';
  end if;

  -- approve
  select n.next_status, n.next_step into v_next
    from public.fms_travel_next_stop(p_trip, p_step) n;

  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  /*
    ⚠ DEFECT (G) FROM 20260905120000: the notification pointed at a queue the
      recipient could not open. It is avoided by construction here — the
      recipients ARE the owners of the step the trip has just moved to, plus
      that trip's own approvers where the next step routes per-trip. Nobody is
      told to go and look at a list they cannot see.
  */
  v_recipients := public.fms_travel_step_owner_ids(v_next.next_step);
  if v_next.next_step in ('manager_approval', 'claim_review')
     and array_length(t.approver_manager_ids, 1) is not null then
    v_recipients := v_recipients || t.approver_manager_ids;
  end if;
  -- The traveller is told their trip moved, wherever it went.
  v_recipients := v_recipients || array_remove(array[t.raised_by, t.traveller_id], null);

  perform public.fms_travel_announce('trip', p_trip, 'trip_approved',
    coalesce(t.trip_no, 'The trip') || ' was approved by the ' || lower(v_label)
      || ' and is now ' || replace(v_next.next_status, '_', ' '),
    v_recipients,
    jsonb_build_object('step', p_step, 'next_step', v_next.next_step));

  return v_next.next_status;
end $$;

comment on function public.fms_travel_decide(uuid, text, text, text) is
  'Approve, reject or return a trip at either approval gate. Refuses a skipped step, refuses self-approval, and refuses a rejection or a return with no reason.';
grant execute on function public.fms_travel_decide(uuid, text, text, text) to authenticated;

create or replace function public.fms_travel_decide_manager(p_trip uuid, p_decision text, p_note text default null)
returns text language sql security definer set search_path = public as $$
  select public.fms_travel_decide(p_trip, 'manager_approval', p_decision, p_note);
$$;
grant execute on function public.fms_travel_decide_manager(uuid, text, text) to authenticated;

create or replace function public.fms_travel_decide_director(p_trip uuid, p_decision text, p_note text default null)
returns text language sql security definer set search_path = public as $$
  select public.fms_travel_decide(p_trip, 'director_approval', p_decision, p_note);
$$;
grant execute on function public.fms_travel_decide_director(uuid, text, text) to authenticated;


-- ===========================================================================
-- PARKING A TRIP.
--
-- ⚠ RESUME ASKS THE ROUTER, IT DOES NOT REPLAY hold_from_status BLINDLY —
--   and it never recomputes a "first" step of its own. This is defect (F) from
--   20260905120000: "holding and resuming a skipped request would silently
--   reroute it to the step it skipped". Because fms_travel_next_stop reads the
--   skip flags and the stamps rather than the status, the answer it gives on
--   resume is the same answer it gave on the way in.
-- ===========================================================================
create or replace function public.fms_travel_hold_trip(p_trip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_why is null then raise exception 'Say why this trip is being put on hold'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status in ('draft', 'on_hold', 'closed', 'cancelled', 'rejected') then
    raise exception 'A trip that is % cannot be put on hold', replace(t.status, '_', ' ');
  end if;
  if not (public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)
          or public.fms_travel_can_act(coalesce(t.current_step, 'request'), p_trip, v_uid)) then
    raise exception 'You are not authorized to hold this trip';
  end if;

  update public.fms_travel_trips
     set status = 'on_hold', hold_at = now(), hold_reason = v_why, hold_from_status = t.status
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_held',
    coalesce(t.trip_no, 'The trip') || ' was put on hold — ' || v_why,
    array_remove(array[t.raised_by, t.traveller_id], null));
end $$;
grant execute on function public.fms_travel_hold_trip(uuid, text) to authenticated;

create or replace function public.fms_travel_resume_trip(p_trip uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_next record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'on_hold' then
    raise exception 'This trip is not on hold';
  end if;
  if not (public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)) then
    raise exception 'Only the Travel Desk or an administrator can take a trip off hold';
  end if;

  select n.next_status, n.next_step into v_next
    from public.fms_travel_next_stop(p_trip, 'resume') n;

  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step,
         hold_at = null, hold_reason = null, hold_from_status = null
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_resumed',
    coalesce(t.trip_no, 'The trip') || ' came off hold and is ' || replace(v_next.next_status, '_', ' '),
    public.fms_travel_step_owner_ids(v_next.next_step)
      || array_remove(array[t.raised_by, t.traveller_id], null));

  return v_next.next_status;
end $$;
grant execute on function public.fms_travel_resume_trip(uuid) to authenticated;

create or replace function public.fms_travel_cancel_trip(p_trip uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t     record;
  v_why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if v_why is null then raise exception 'Say why this trip is being cancelled'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status in ('closed', 'cancelled', 'rejected') then
    raise exception 'This trip is already %', replace(t.status, '_', ' ');
  end if;
  if t.status = 'draft' then
    raise exception 'A draft is thrown away, not cancelled — there is no record to preserve.';
  end if;
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)) then
    raise exception 'You are not authorized to cancel this trip';
  end if;

  update public.fms_travel_trips
     set status = 'cancelled', current_step = null,
         cancelled_at = now(), cancel_reason = v_why
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_cancelled',
    coalesce(t.trip_no, 'The trip') || ' was cancelled — ' || v_why,
    array_remove(array[t.raised_by, t.traveller_id], null));
end $$;
grant execute on function public.fms_travel_cancel_trip(uuid, text) to authenticated;


do $mig$
declare v_dir int; v_also boolean;
begin
  select m.director_from_band, m.manager_also into v_dir, v_also
    from public.fms_travel_approval_matrix() m;
  if v_dir is null or v_also is null then
    raise exception 'fms_travel_approval_matrix returned nothing';
  end if;
  if v_dir <> 6 or v_also is not true then
    raise exception 'approval matrix did not default per §3.2 (got %, %)', v_dir, v_also;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'fms_travel_trips'
       and column_name = 'manager_approval_skipped'
  ) then
    raise exception 'manager_approval_skipped did not install';
  end if;

  -- Still no write policy on the trip: every one of these is an RPC.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_travel_trips' and cmd <> 'SELECT'
  ) then
    raise exception 'fms_travel_trips must have no write policy';
  end if;
end $mig$;

commit;
