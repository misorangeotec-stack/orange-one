-- ===========================================================================
-- Travel Desk — THE TRIP CLOSES AT BOOKING.
--
-- The new, shorter process (doc: Travel-Desk-Current-vs-New, 2026-10-14):
--
--   Request → Manager approval → Director approval (Band 6+) → Booking → CLOSED
--
-- No expense claim, no claim approval, no finance verification, no settlement,
-- and no travel advance on new requests (D2). After the booking the trip can
-- still be cancelled — one ticket or the whole trip (D8) — but only by whoever
-- holds the booking right, and only with a reason AND a credit note (file,
-- number and amount, D4). The traveller can cancel only before booking (D3).
--
-- ⚠ TRIPS ALREADY PAST BOOKING KEEP THE OLD FLOW (D7). `booked`, the claim,
--   finance and settlement statuses and their RPCs are untouched, so a trip that
--   is mid-claim today finishes exactly as it would have. Only
--   `fms_travel_complete_booking` changes what happens next, and only for a trip
--   that reaches it from now on — those carry `closed_at_booking = true`.
--
-- ⚠ THE CREDIT NOTE IS A REFUND, so its amount is written into the cancelled
--   legs' `refund_amount`. `net_cost` and the trip's `booking_total` then say
--   what the company is actually out of pocket, with no second figure for the
--   reports to remember to subtract. One credit note covering several tickets
--   is split across them in proportion to what each cost.
--
-- Additive: 1 table, 2 columns, 1 new function, 3 replaced functions.
-- Reversal: 20270124120000_fms_travel_close_at_booking_rollback.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Which trips closed at booking — the only ones the new cancel applies to.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_trips
  add column if not exists closed_at_booking boolean not null default false;

comment on column public.fms_travel_trips.closed_at_booking is
  'True when the trip closed at the booking step (new process, 2026-10). Such a trip has no claim or settlement; the booker may still cancel its tickets with a credit note.';


-- ---------------------------------------------------------------------------
-- One row per cancellation: the reason and the credit note that came with it.
-- A cancellation covers one ticket or several (the whole trip).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_travel_cancellations (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references public.fms_travel_trips on delete cascade,
  leg_ids            uuid[] not null,
  whole_trip         boolean not null default false,
  reason             text not null check (btrim(reason) <> ''),
  credit_note_no     text not null check (btrim(credit_note_no) <> ''),
  credit_note_amount numeric(14,2) not null check (credit_note_amount >= 0),
  credit_note_path   text not null check (btrim(credit_note_path) <> ''),
  cancelled_by       uuid references auth.users on delete set null,
  cancelled_at       timestamptz not null default now()
);

create index if not exists fms_travel_cancellations_trip_idx
  on public.fms_travel_cancellations (trip_id);

alter table public.fms_travel_cancellations enable row level security;

-- Rides on the trip's visibility, like the legs. No write policy: the RPC is the door.
drop policy if exists fms_travel_cancellations_select on public.fms_travel_cancellations;
create policy fms_travel_cancellations_select
  on public.fms_travel_cancellations for select to authenticated
  using (exists (select 1 from public.fms_travel_trips t
                  where t.id = fms_travel_cancellations.trip_id));

grant select on public.fms_travel_cancellations to authenticated;

alter table public.fms_travel_legs
  add column if not exists cancellation_id uuid
    references public.fms_travel_cancellations on delete set null;


-- ===========================================================================
-- BOOKING CLOSES THE TRIP.
-- ===========================================================================
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

  -- ⚠ CLOSED, NOT `booked`. The claim, finance and settlement steps are no
  --   longer part of the process; booking is the last thing that happens.
  update public.fms_travel_trips
     set status = 'closed', current_step = 'booking', closed_at_booking = true,
         bk_at = now(), bk_by = v_uid
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_booked',
    coalesce(t.trip_no, 'The trip') || ' is booked and closed — ' || v_n ||
      case when v_n = 1 then ' booking' else ' bookings' end || ' on file',
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('legs', v_n));

  return 'closed';
end $$;

comment on function public.fms_travel_complete_booking(uuid) is
  'Close the booking step AND the trip (new process, 2026-10): no claim or settlement follows. Refuses a trip with no legs on it.';
grant execute on function public.fms_travel_complete_booking(uuid) to authenticated;


-- ===========================================================================
-- THE BOOKER CANCELS — one ticket, several, or all of them.
-- ===========================================================================
create or replace function public.fms_travel_cancel_booking(
  p_trip      uuid,
  p_leg_ids   uuid[],
  p_reason    text,
  p_cn_no     text,
  p_cn_amount numeric,
  p_cn_path   text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  t        record;
  v_why    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_no     text := nullif(btrim(coalesce(p_cn_no, '')), '');
  v_path   text := nullif(btrim(coalesce(p_cn_path, '')), '');
  v_legs   uuid[];
  v_paid   numeric;
  v_left   numeric;
  v_share  numeric;
  v_i      int := 0;
  v_n      int;
  v_cid    uuid;
  v_whole  boolean;
  l        record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not (t.status = 'closed' and t.closed_at_booking) then
    raise exception 'Only a trip that closed at booking is cancelled here. This one is %.',
      replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('booking', p_trip, v_uid) then
    raise exception 'Only the person who can book this trip can cancel it';
  end if;

  if v_why  is null then raise exception 'Say why the booking is being cancelled'; end if;
  if v_path is null then raise exception 'Upload the credit note — it is required'; end if;
  if v_no   is null then raise exception 'Enter the credit note number'; end if;
  if p_cn_amount is null or p_cn_amount < 0 then
    raise exception 'Enter the credit note amount';
  end if;
  if v_path not like p_trip::text || '/cancellation/%' then
    raise exception 'The credit note must be filed on this trip';
  end if;

  select array_agg(distinct x) into v_legs
    from unnest(coalesce(p_leg_ids, '{}'::uuid[])) x;
  v_n := coalesce(array_length(v_legs, 1), 0);
  if v_n = 0 then raise exception 'Choose which ticket(s) to cancel'; end if;

  if (select count(*) from public.fms_travel_legs
       where id = any(v_legs) and trip_id = p_trip and cancelled_at is null) <> v_n then
    raise exception 'A chosen ticket does not belong to this trip or is already cancelled';
  end if;

  select coalesce(sum(ticket_cost + other_charges), 0) into v_paid
    from public.fms_travel_legs where id = any(v_legs);
  if p_cn_amount > v_paid then
    raise exception 'The credit note (%) is more than was paid for the chosen tickets (%)',
      to_char(p_cn_amount, 'FM999999999.00'), to_char(v_paid, 'FM999999999.00');
  end if;

  v_whole := not exists (select 1 from public.fms_travel_legs
                          where trip_id = p_trip and cancelled_at is null
                            and not (id = any(v_legs)));

  insert into public.fms_travel_cancellations
    (trip_id, leg_ids, whole_trip, reason, credit_note_no, credit_note_amount,
     credit_note_path, cancelled_by)
  values (p_trip, v_legs, v_whole, v_why, v_no, p_cn_amount, v_path, v_uid)
  returning id into v_cid;

  -- The credit note is the refund. Split it by what each ticket cost; the last
  -- one takes the rounding so the parts add up to the note exactly.
  v_left := p_cn_amount;
  for l in
    select id, ticket_cost + other_charges as paid
      from public.fms_travel_legs where id = any(v_legs)
     order by ticket_cost + other_charges, id
  loop
    v_i := v_i + 1;
    if v_i = v_n then
      v_share := least(v_left, l.paid);
    elsif v_paid = 0 then
      v_share := 0;
    else
      v_share := least(round(p_cn_amount * l.paid / v_paid, 2), l.paid, v_left);
    end if;
    v_left := v_left - v_share;

    update public.fms_travel_legs
       set cancelled_at = now(),
           cancel_reason = v_why,
           cancellation_id = v_cid,
           refund_amount = v_share
     where id = l.id;
  end loop;

  if v_whole then
    update public.fms_travel_trips
       set status = 'cancelled', current_step = null,
           cancelled_at = now(), cancel_reason = v_why
     where id = p_trip;
  end if;

  perform public.fms_travel_announce('trip', p_trip, 'trip_cancelled',
    coalesce(t.trip_no, 'The trip') ||
      case when v_whole then ' was cancelled — '
           else ' — ' || v_n || case when v_n = 1 then ' ticket' else ' tickets' end
                || ' cancelled — ' end
      || v_why || ' (credit note ' || v_no || ')',
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('cancellation_id', v_cid, 'legs', v_n, 'whole_trip', v_whole));

  return case when v_whole then 'cancelled' else 'closed' end;
end $$;

comment on function public.fms_travel_cancel_booking(uuid, uuid[], text, text, numeric, text) is
  'The booker cancels one or more tickets of a trip that closed at booking. Reason, credit note file, number and amount are all mandatory; the amount is written into the legs'' refund. When no ticket is left the trip becomes cancelled.';
grant execute on function public.fms_travel_cancel_booking(uuid, uuid[], text, text, numeric, text) to authenticated;


-- ===========================================================================
-- THE TRAVELLER CANCELS ONLY BEFORE BOOKING (D3).
--
-- Once tickets exist, cancelling means a credit note, and that is the desk's
-- job. Coordinators and admins keep the direct cancel for old-flow trips.
-- ===========================================================================
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
  if t.bk_at is not null
     and not (public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)) then
    raise exception 'The tickets are already booked. Only the Travel Desk can cancel now, with the credit note.';
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


-- ===========================================================================
-- NO ADVANCE ON A NEW REQUEST (D2).
--
-- With no claim there is nowhere to adjust an advance against, so the request
-- can no longer ask for one. Forced off here, not only hidden on the form.
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

  perform public.fms_travel_write_trip(v_trip, p || '{"advance_requested": false}'::jsonb);
  return v_trip;
end $$;

comment on function public.fms_travel_save_draft(jsonb, uuid) is
  'Create or update a trip request while it is a DRAFT or has been RETURNED for clarification. A travel advance is never requested (new process, 2026-10).';
grant execute on function public.fms_travel_save_draft(jsonb, uuid) to authenticated;

commit;
