-- ===========================================================================
-- Travel Desk FMS — freeze the employee code at submit (Phase 5, corrective).
--
-- ⚠ THE SNAPSHOT MUST BE COMPLETE REGARDLESS OF WHO FILLED THE FORM.
--   `fms_travel_write_trip` copies `traveller_employee_code` only if the caller
--   sends it. The web form does, so this looked fine — but a coordinator or a
--   script calling `fms_travel_save_draft` without it left the column NULL, and
--   `fms_travel_outstanding_advance_by_code` then had nothing but the profile to
--   fall back on.
--
--   That matters precisely when it is used. The Employee Exit module looks a
--   leaver up BY CODE (its clearance rows carry a nullable user id), and a
--   leaver's profile is the record most likely to have been tidied up by the
--   time the clearance asks. Freezing the code onto the trip removes the
--   dependency entirely.
--
--   Found by the phase-5 verification: `outstanding_advance` returned 18,000 by
--   id and 0 by code for the same person on the same trip.
--
-- Additive: one helper, plus one `perform` line inside submit.
-- Reversal: 20261005121300's definition of fms_travel_submit_trip, and
--   drop function if exists public.fms_travel_freeze_employee_code(uuid);
-- ===========================================================================

begin;

create or replace function public.fms_travel_freeze_employee_code(p_trip uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.fms_travel_trips t
     set traveller_employee_code = coalesce(
           nullif(btrim(coalesce(t.traveller_employee_code, '')), ''),
           (select nullif(btrim(coalesce(p.employee_code, '')), '')
              from public.profiles p where p.id = t.traveller_id))
   where t.id = p_trip;
$$;

comment on function public.fms_travel_freeze_employee_code(uuid) is
  'Fill the trip frozen employee code from the profile when the caller did not send one. Called by submit - the exit hand-off looks a leaver up BY CODE, and their profile is the thing most likely to have been tidied by then.';


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
  v_owing     numeric;
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

  -- ---- §11.2, said early rather than at the counter ----------------------
  if coalesce(v_advance, false) then
    select public.fms_travel_outstanding_advance(v_traveller) into v_owing;
    if coalesce(v_owing, 0) > 0 then
      raise exception 'Policy §11.2 — % of travel advance is still unreconciled for this traveller, so a second advance cannot be issued. Either settle that first, or untick the advance and submit the trip without one.',
        to_char(v_owing, 'FM999999999.00');
    end if;
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
  perform public.fms_travel_freeze_employee_code(p_trip);

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
  'Freeze the traveller snapshot, mint TRV-<fy>-0001 and route to whichever step the approval matrix puts first. Applies §3.5 at submit (the rule measures how late the REQUEST was) and refuses an advance under §11.2 while an earlier one is unreconciled.';
grant execute on function public.fms_travel_submit_trip(uuid) to authenticated;

commit;
