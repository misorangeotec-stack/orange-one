-- ===========================================================================
-- ROLLBACK of 20270124120000_fms_travel_close_at_booking.sql
--
-- Restores complete_booking (→ `booked`, claim follows), the old cancel_trip
-- (traveller may cancel at any open status) and the old save_draft (advance
-- allowed), and removes the cancel-with-credit-note RPC and its table.
--
-- ⚠ Trips that closed at booking while the forward migration was live stay
--   `closed`; their credit-note rows are dropped with the table (the files stay
--   in storage under <trip>/cancellation/). Export them first if needed.
-- ===========================================================================

begin;

drop function if exists public.fms_travel_cancel_booking(uuid, uuid[], text, text, numeric, text);

alter table public.fms_travel_legs drop column if exists cancellation_id;
drop table if exists public.fms_travel_cancellations;
alter table public.fms_travel_trips drop column if exists closed_at_booking;

create or replace function public.fms_travel_complete_booking(p_trip uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t     record;
  v_n   int;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'awaiting_booking' then
    raise exception 'This trip is %, not awaiting booking', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('booking', p_trip, v_uid) then
    raise exception 'You are not authorized to book this trip';
  end if;

  select count(*) into v_n from public.fms_travel_legs where trip_id = p_trip;
  if v_n = 0 then
    raise exception 'Record what was booked first — a trip cannot be marked booked with nothing on it.';
  end if;

  /*
    ⚠ UPLOADING THE TICKET IS WHAT SHARES IT. The source PRD lists `Booked` and
      `Ticket Shared` as separate statuses; the upload is what puts the document
      where the traveller can fetch it AND what notifies them, so a second step
      would be one that is always already done. This is the notification.
  */
  update public.fms_travel_trips
     set status = 'booked', current_step = 'claim',
         bk_at = now(), bk_by = v_uid
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_booked',
    coalesce(t.trip_no, 'The trip') || ' is booked — ' || v_n ||
      case when v_n = 1 then ' booking' else ' bookings' end || ' on file',
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('legs', v_n));

  return 'booked';
end $$;

comment on function public.fms_travel_complete_booking(uuid) is
  'Close the booking step. Refuses a trip with no legs on it - "booked" with nothing recorded is a claim nobody can check.';
grant execute on function public.fms_travel_complete_booking(uuid) to authenticated;

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

commit;
