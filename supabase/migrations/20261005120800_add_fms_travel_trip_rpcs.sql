-- ===========================================================================
-- Travel Desk FMS — RAISING A TRIP (Phase 3).
--
--   fms_travel_save_draft   — create or update a draft. Private to its author.
--   fms_travel_delete_draft — throw one away.
--   fms_travel_submit_trip  — FREEZE the snapshot, mint the number, send it for
--                             approval.
--
-- ⚠ SUBMIT IS WHERE EVERYTHING IS DECIDED, AND IT HAPPENS ONCE.
--   The traveller's band, their travel category, their department, their base
--   city, the rate card that prices the trip and the people who will approve it
--   are all resolved and WRITTEN ONTO THE ROW at this moment. Nothing downstream
--   re-derives any of them.
--
--   That is not caution for its own sake. The band 3 / band 8 contradiction is
--   still open: if the travel category were derived at read time, answering it
--   would silently re-price every trip ever taken, including ones already paid.
--
-- ⚠ THE NUMBER IS MINTED HERE AND NOWHERE ELSE. A draft carries no trip number,
--   so an abandoned draft cannot burn one. TRV-<fy>-0001, FY-scoped.
--
-- Additive. Reversal (reverse order):
--   drop function if exists public.fms_travel_submit_trip(uuid);
--   drop function if exists public.fms_travel_delete_draft(uuid);
--   drop function if exists public.fms_travel_save_draft(jsonb, uuid);
--   drop function if exists public.fms_travel_write_trip(uuid, jsonb);
--   drop function if exists public.fms_travel_default_approvers(uuid);
-- ===========================================================================

begin;

-- ===========================================================================
-- Who would approve this person's trip, from the portal's own reporting links.
--
-- ⚠ 19 OF 60 PEOPLE HAVE NO user_hods ROW. Most are top-of-tree and correctly
--   have none; two are ordinary staff whose manager edge is simply missing. An
--   empty array is therefore a NORMAL answer, not an error — submit records it
--   and the step falls through to the configured owners, so a trip is never
--   blocked by a gap in the org chart.
-- ===========================================================================
create or replace function public.fms_travel_default_approvers(p_user uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(h.hod_id), '{}'::uuid[])
    from public.user_hods h
   where h.employee_id = p_user;
$$;

comment on function public.fms_travel_default_approvers(uuid) is
  'The reporting managers a trip for this person should route to, read from user_hods. An empty array is normal - 19 of 60 people have no row, and submit falls back to the step owners.';
grant execute on function public.fms_travel_default_approvers(uuid) to authenticated;


-- ===========================================================================
-- The internal writer. NOT granted — save_draft is the only caller.
--
-- One writer, so the draft form and any later correction cannot disagree about
-- which columns a request owns. Note what it does NOT touch: the snapshot, the
-- number, the status, and every step stamp. Those belong to submit and to the
-- step RPCs, and a form must never be able to move them.
-- ===========================================================================
create or replace function public.fms_travel_write_trip(p_trip uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purpose  uuid := nullif(btrim(coalesce(p->>'purpose_id','')), '')::uuid;
  v_requires boolean := false;
begin
  if v_purpose is not null then
    select requires_remarks into v_requires from public.fms_travel_purposes where id = v_purpose;
  end if;

  update public.fms_travel_trips set
    traveller_id           = nullif(btrim(coalesce(p->>'traveller_id','')), '')::uuid,
    traveller_name         = nullif(btrim(coalesce(p->>'traveller_name','')), ''),
    traveller_employee_code= nullif(btrim(coalesce(p->>'traveller_employee_code','')), ''),
    purpose_id             = v_purpose,
    -- A purpose that does not demand a reason must not keep a stale one: a
    -- request switched from Others to Customer Visit should not still carry the
    -- sentence that explained Others.
    purpose_other_remarks  = case when coalesce(v_requires, false)
                                  then nullif(btrim(coalesce(p->>'purpose_other_remarks','')), '')
                                  else null end,
    destination_city_id    = nullif(btrim(coalesce(p->>'destination_city_id','')), '')::uuid,
    journey_type           = nullif(btrim(coalesce(p->>'journey_type','')), ''),
    preferred_slot         = nullif(btrim(coalesce(p->>'preferred_slot','')), ''),
    planned_departure_date = nullif(btrim(coalesce(p->>'planned_departure_date','')), '')::date,
    planned_return_date    = nullif(btrim(coalesce(p->>'planned_return_date','')), '')::date,
    accommodation_required = coalesce((p->>'accommodation_required')::boolean, false),
    estimated_cost         = nullif(btrim(coalesce(p->>'estimated_cost','')), '')::numeric,
    is_emergency           = coalesce((p->>'is_emergency')::boolean, false),
    emergency_reason       = case when coalesce((p->>'is_emergency')::boolean, false)
                                  then nullif(btrim(coalesce(p->>'emergency_reason','')), '')
                                  else null end,
    advance_requested      = coalesce((p->>'advance_requested')::boolean, false),
    advance_requested_amount = case when coalesce((p->>'advance_requested')::boolean, false)
                                    then nullif(btrim(coalesce(p->>'advance_requested_amount','')), '')::numeric
                                    else null end
  where id = p_trip;
end $$;

comment on function public.fms_travel_write_trip(uuid, jsonb) is
  'Internal writer for the request fields. NOT granted - fms_travel_save_draft is the only caller. Never touches the snapshot, the number, the status or any step stamp.';


-- ===========================================================================
-- SAVE A DRAFT.
--
-- ⚠ A DRAFT IS PRIVATE TO ITS AUTHOR. The SELECT policy hides it from everyone
--   else, and this refuses to let anyone else edit it. Somebody's unfinished
--   thinking about a trip they may not take is not the business's to read.
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
    if v_status <> 'draft' then
      raise exception 'This trip has already been submitted, so it can no longer be edited as a draft';
    end if;
    if v_owner is distinct from v_uid and not public.fms_travel_is_coordinator(v_uid) then
      raise exception 'This draft belongs to somebody else';
    end if;
  end if;

  perform public.fms_travel_write_trip(v_trip, p);
  return v_trip;
end $$;

comment on function public.fms_travel_save_draft(jsonb, uuid) is
  'Create or update a draft trip request. Drafts are private to their author and carry no trip number - the number is minted on submit, so an abandoned draft cannot burn one.';
grant execute on function public.fms_travel_save_draft(jsonb, uuid) to authenticated;


create or replace function public.fms_travel_delete_draft(p_trip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_owner  uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by into v_status, v_owner
    from public.fms_travel_trips where id = p_trip for update;

  if v_status is null then raise exception 'Trip not found'; end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft can be thrown away. A submitted trip is cancelled, not deleted, so the record survives.';
  end if;
  if v_owner is distinct from v_uid and not public.is_admin(v_uid) then
    raise exception 'This draft belongs to somebody else';
  end if;

  delete from public.fms_travel_trips where id = p_trip;
end $$;

comment on function public.fms_travel_delete_draft(uuid) is
  'Throw away a draft. Only a draft - a submitted trip is cancelled so the record survives.';
grant execute on function public.fms_travel_delete_draft(uuid) to authenticated;


-- ===========================================================================
-- SUBMIT — freeze the snapshot, mint the number, send it for approval.
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
  v_window    int;
  v_band_no   int;
  v_dept      uuid;
  v_desig     uuid;
  v_base_city uuid;
  v_card      uuid;
  v_tc        text;
  v_approvers uuid[];
  v_skip_dir  boolean;
  v_no        text;
  v_fy        text;
  v_next_step text;
  v_next_stat text;
  v_recipients uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select status, raised_by, traveller_id, planned_departure_date, purpose_id, purpose_other_remarks
    into v_status, v_owner, v_traveller, v_depart, v_purpose, v_remarks
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

  -- ---- the things a person must have answered ---------------------------
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

  -- PRD §5: the travel date must fall inside the booking window.
  select coalesce((value->>'booking_window_days')::int, 30) into v_window
    from public.fms_travel_config where key = 'policy';
  if v_depart > current_date + coalesce(v_window, 30) then
    raise exception 'Travel must be within the next % days. Raise it closer to the date.', coalesce(v_window, 30);
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

  -- The card is chosen by the DEPARTURE date, not by today: a trip raised in
  -- March for April travel is priced on April's card if one is in force.
  v_card := public.fms_travel_effective_rate_card(v_depart);
  if v_card is null then
    raise exception 'There is no rate card in force, so nothing can be priced. Ask an administrator to set one up.';
  end if;

  v_tc := public.fms_travel_category_for_band(v_card, v_band_no);
  if v_tc is null then
    raise exception 'The rate card does not say which travel category band % falls into.', v_band_no;
  end if;

  v_approvers := public.fms_travel_default_approvers(v_traveller);

  -- §3.2 — bands 1 to 5 need their manager; 6 to 9 also need a Director.
  -- Routed on BAND NUMBER, not on travel category, and that is deliberate:
  -- §3.2 is unambiguous on this even though the band-to-category mapping is
  -- still disputed, so the approval chain does not depend on that answer.
  v_skip_dir := v_band_no <= 5;

  if v_status = 'draft' then
    v_fy := public.fms_travel_fy_code(current_date);
    v_no := 'TRV-' || v_fy || '-' || lpad(public.fms_travel_next_seq('trip:' || v_fy)::text, 4, '0');
  else
    select trip_no into v_no from public.fms_travel_trips where id = p_trip;
  end if;

  v_next_step := 'manager_approval';
  v_next_stat := 'awaiting_manager_approval';

  update public.fms_travel_trips set
    trip_no                   = coalesce(trip_no, v_no),
    status                    = v_next_stat,
    current_step              = v_next_step,
    snap_band_no              = v_band_no,
    snap_travel_category      = v_tc,
    snap_department_id        = v_dept,
    snap_designation_id       = v_desig,
    snap_base_city_id         = v_base_city,
    snap_rate_card_id         = v_card,
    approver_manager_ids      = v_approvers,
    approver_manager_note     = case when array_length(v_approvers, 1) is null
                                     then 'No reporting manager is recorded for this traveller, so it routes to the configured approvers.'
                                     else null end,
    director_approval_skipped = v_skip_dir,
    -- ⚠ RE-STAMPED ON EVERY SUBMISSION, including after a return for
    --   clarification. Without this the approver's clock would still run from
    --   the FIRST submission, so a request that came back and went again would
    --   arrive already overdue. This is exactly what OCPI's 20260929121700 had
    --   to retrofit.
    submitted_at              = now(),
    returned_at               = null,
    returned_stage            = null,
    returned_reason           = null
  where id = p_trip;

  v_recipients := public.fms_travel_step_owner_ids('manager_approval');
  if array_length(v_approvers, 1) is not null then
    v_recipients := v_recipients || v_approvers;
  end if;

  perform public.fms_travel_announce(
    'trip', p_trip, 'trip_submitted',
    v_no || ' needs your approval',
    v_recipients,
    jsonb_build_object('trip_no', v_no, 'band', v_band_no, 'travel_category', v_tc));

  return v_no;
end $$;

comment on function public.fms_travel_submit_trip(uuid) is
  'Freeze the traveller snapshot, mint TRV-<fy>-0001 and send the trip for approval. The band, travel category, rate card and approvers are written ONCE here and never re-derived.';
grant execute on function public.fms_travel_submit_trip(uuid) to authenticated;


-- ===========================================================================
-- The Master Report can now count this module: its head_table exists.
-- ===========================================================================
update public.master_report_modules set enabled = true where app_id = 'travel-desk';


do $mig$
declare v_public int;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_travel_trips', 'fms_travel_passengers')
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'Travel Desk trips: % policy/policies scoped to {public}', v_public;
  end if;

  -- The trip must have NO write policy: the RPCs are the only door.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fms_travel_trips' and cmd <> 'SELECT'
  ) then
    raise exception 'Travel Desk: fms_travel_trips must have no write policy - every mutation goes through an RPC';
  end if;

  if not exists (
    select 1 from public.master_report_modules where app_id = 'travel-desk' and enabled
  ) then
    raise exception 'Travel Desk did not switch on in the Master Report';
  end if;

  -- The report points at a table that now exists.
  if exists (
    select 1 from public.master_report_modules m
     where m.app_id = 'travel-desk' and m.enabled
       and to_regclass('public.' || m.head_table) is null
  ) then
    raise exception 'Travel Desk is enabled in the Master Report but its head table is missing';
  end if;
end $mig$;

commit;
