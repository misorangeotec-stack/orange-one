-- ===========================================================================
-- Travel Desk FMS — WHAT WAS ACTUALLY BOOKED (Phase 6).
--
--   fms_travel_legs                  — one row per flight, train, bus, cab, hotel
--   fms_travel_save_leg / remove_leg — the coordinator's edits
--   fms_travel_complete_booking      — the step closes, the trip is booked
--   fms_travel_request_cancellation  — the traveller asks
--   fms_travel_process_cancellation  — the desk records refunds and decides
--
-- ⚠ ONE TRIP, MANY LEGS — deliberately NOT the source PRD's "one travel service
--   per requisition". A Mumbai visit is a flight out, three nights in a hotel and
--   a train back; filing that as three requisitions means three approvals, three
--   numbers and three claims for one journey, and nothing can then answer "what
--   did that trip cost".
--
-- ⚠ `net_cost` IS A GENERATED COLUMN, NOT AN RPC'S ARITHMETIC. ticket + other
--   charges − refund is the definition of what a leg cost, and a definition that
--   lives in three RPCs eventually disagrees with itself. Postgres computes it,
--   so no code path can produce a different answer, and the trip's booking_total
--   is a trigger-maintained sum of exactly this.
--
-- ⚠ A CANCELLED TRIP MUST STILL BE ABLE TO REACH A CLAIM, and that is why this
--   migration adds a STATUS rather than reusing `cancelled`. §4.1 makes
--   cancellation charges reimbursable when the reason is business — the customer
--   moved the meeting, the plant shut — and not when it is personal. A trip that
--   went straight to `cancelled` would take those charges, and any outstanding
--   advance, out of every queue and every report in the module. `cancelled_pending_claim`
--   is the honest state: the journey is off, the money is not.
--
-- Additive: 1 table, 1 status value, 1 trigger, 6 functions.
-- Reversal (reverse order):
--   drop function if exists public.fms_travel_process_cancellation(uuid, text, text, text);
--   drop function if exists public.fms_travel_request_cancellation(uuid, text);
--   drop function if exists public.fms_travel_complete_booking(uuid);
--   drop function if exists public.fms_travel_remove_leg(uuid);
--   drop function if exists public.fms_travel_save_leg(uuid, jsonb, uuid);
--   drop trigger  if exists trg_fms_travel_legs_rollup on public.fms_travel_legs;
--   drop function if exists public.fms_travel_recalc_booking_total();
--   drop table    if exists public.fms_travel_legs;
--   (the status CHECK is widened, not narrowed — reverting it would orphan rows)
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The new status.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_trips drop constraint if exists fms_travel_trips_status_check;
alter table public.fms_travel_trips add constraint fms_travel_trips_status_check
  check (status in (
    'draft',
    'awaiting_manager_approval',
    'awaiting_director_approval',
    'returned',
    'rejected',
    'awaiting_advance',
    'awaiting_booking',
    'booked',
    'cancellation_requested',
    -- The journey is off but the money is not: cancellation charges to claim,
    -- or an advance to recover. It sits at the `claim` step like any other
    -- returned traveller.
    'cancelled_pending_claim',
    'awaiting_claim_review',
    'awaiting_finance_review',
    'awaiting_settlement',
    'closed',
    'on_hold',
    'cancelled'));


-- ===========================================================================
-- THE LEGS.
--
-- ⚠ THE DATE COLUMNS ARE NEUTRAL ON PURPOSE. `start_on` / `end_on` mean
--   departure and arrival on a flight, train, bus or cab, and check-in and
--   check-out on a hotel. Five kinds with their own column pairs would be five
--   sets of nulls on every row and five places for the money engine to look for
--   "how many nights was this".
-- ===========================================================================
create table if not exists public.fms_travel_legs (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.fms_travel_trips on delete cascade,

  kind        text not null check (kind in ('flight', 'train', 'bus', 'cab', 'hotel')),
  -- Which half of the journey this is. `local` covers a cab at the destination
  -- and a hotel, neither of which is outbound or return.
  direction   text not null default 'local'
                check (direction in ('outbound', 'return', 'local')),

  from_city_id uuid references public.fms_travel_cities on delete set null,
  -- For a hotel this is the city stayed in — the tier that prices the cap.
  to_city_id   uuid references public.fms_travel_cities on delete set null,

  start_on    date,
  start_time  time,
  end_on      date,
  end_time    time,

  -- Whichever of these applies to `kind`; `carrier_other` covers a train, a cab
  -- firm or an airline nobody has added to the master yet.
  airline_id      uuid references public.fms_travel_airlines on delete set null,
  hotel_id        uuid references public.fms_travel_hotels on delete set null,
  bus_operator_id uuid references public.fms_travel_bus_operators on delete set null,
  carrier_other   text,

  booking_ref  text,   -- PNR, confirmation number
  travel_class text,   -- Economy Saver, 3A, AC Sedan …

  ticket_cost   numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  refund_amount numeric(14,2) not null default 0,

  -- ⚠ GENERATED, so no code path can disagree about what a leg cost.
  net_cost numeric(14,2)
    generated always as (
      coalesce(ticket_cost, 0) + coalesce(other_charges, 0) - coalesce(refund_amount, 0)
    ) stored,

  cancelled_at       timestamptz,
  -- §4.1 — business or personal decides whether the charge is reimbursable at
  -- all. Nullable because most legs are never cancelled.
  cancel_reason_kind text check (cancel_reason_kind is null
                                 or cancel_reason_kind in ('business', 'personal')),
  cancel_reason      text,

  doc_path    text,
  /**
   * What the extractor read off the ticket, kept verbatim.
   *
   * ⚠ EVIDENCE, NOT DATA. Every field above is typed by a human who confirmed
   *   it; this is the machine's unedited reading, kept so a later dispute can
   *   see what the document actually said versus what was entered. Nothing
   *   reads it to make a decision.
   */
  ai_extracted jsonb,
  notes       text,

  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now(),

  constraint fms_travel_legs_end_after_start check (
    end_on is null or start_on is null or end_on >= start_on
  ),
  constraint fms_travel_legs_amounts_not_negative check (
    coalesce(ticket_cost, 0) >= 0 and coalesce(other_charges, 0) >= 0
    and coalesce(refund_amount, 0) >= 0
  ),
  -- A refund bigger than what was paid is a data-entry slip, and it would make
  -- the trip's booking total negative.
  constraint fms_travel_legs_refund_within_paid check (
    coalesce(refund_amount, 0) <= coalesce(ticket_cost, 0) + coalesce(other_charges, 0)
  )
);

comment on table public.fms_travel_legs is
  'One booked leg of a trip - a flight, train, bus, cab or hotel. start_on/end_on are departure/arrival for transport and check-in/check-out for a hotel. net_cost is GENERATED so no code path can disagree about what a leg cost.';

create index if not exists fms_travel_legs_trip_idx  on public.fms_travel_legs (trip_id);
create index if not exists fms_travel_legs_kind_idx  on public.fms_travel_legs (kind);
create index if not exists fms_travel_legs_start_idx on public.fms_travel_legs (start_on);

drop trigger if exists trg_fms_travel_legs_updated on public.fms_travel_legs;
create trigger trg_fms_travel_legs_updated
  before update on public.fms_travel_legs
  for each row execute function public.set_updated_at();

alter table public.fms_travel_legs enable row level security;

-- Legs ride on their trip's visibility. No write policy: the RPCs are the door.
drop policy if exists fms_travel_legs_select on public.fms_travel_legs;
create policy fms_travel_legs_select
  on public.fms_travel_legs for select to authenticated
  using (exists (select 1 from public.fms_travel_trips t
                  where t.id = fms_travel_legs.trip_id));


-- ===========================================================================
-- THE ROLL-UP.
--
-- ⚠ A TRIGGER, NOT A LINE IN EACH RPC. `booking_total` is read by the dashboard,
--   the register, the settlement and the Master Report; if it were maintained by
--   whichever RPC happened to touch a leg, the one that forgot would leave a
--   figure that is quietly wrong for ever. Here it cannot drift from the rows it
--   sums, whatever writes them.
-- ===========================================================================
create or replace function public.fms_travel_recalc_booking_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_trip uuid := coalesce(new.trip_id, old.trip_id);
begin
  update public.fms_travel_trips t
     set booking_total = (select coalesce(sum(l.net_cost), 0)
                            from public.fms_travel_legs l where l.trip_id = v_trip)
   where t.id = v_trip;
  return null;
end $$;

drop trigger if exists trg_fms_travel_legs_rollup on public.fms_travel_legs;
create trigger trg_fms_travel_legs_rollup
  after insert or update or delete on public.fms_travel_legs
  for each row execute function public.fms_travel_recalc_booking_total();


-- ===========================================================================
-- SAVING A LEG.
-- ===========================================================================
create or replace function public.fms_travel_save_leg(
  p_trip uuid,
  p      jsonb,
  p_leg  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_leg  uuid := p_leg;
  v_kind text := nullif(btrim(coalesce(p->>'kind', '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then raise exception 'Trip not found'; end if;

  if not public.fms_travel_can_act('booking', p_trip, v_uid) then
    raise exception 'You are not authorized to book this trip';
  end if;

  /*
    ⚠ EDITABLE AFTER THE BOOKING STEP CLOSES, DELIBERATELY. A refund lands weeks
      later, an airline reissues a PNR, a hotel bill differs from the quote — and
      the claim is measured against what was actually booked. Locking the legs at
      `complete_booking` would force the desk to reopen a trip to record a
      refund, which is how refunds stop being recorded. It closes only when the
      trip does.
  */
  if t.status in ('draft', 'closed', 'cancelled', 'rejected') then
    raise exception 'A trip that is % cannot have its bookings edited',
      replace(t.status, '_', ' ');
  end if;

  if v_kind is null then raise exception 'Say what kind of booking this is'; end if;

  if v_leg is null then
    insert into public.fms_travel_legs (trip_id, kind, created_by, sort_order)
    values (p_trip, v_kind, v_uid,
            coalesce((select max(sort_order) + 10 from public.fms_travel_legs where trip_id = p_trip), 10))
    returning id into v_leg;
  else
    if not exists (select 1 from public.fms_travel_legs where id = v_leg and trip_id = p_trip) then
      raise exception 'That booking does not belong to this trip';
    end if;
  end if;

  update public.fms_travel_legs set
    kind            = v_kind,
    direction       = coalesce(nullif(btrim(coalesce(p->>'direction', '')), ''), 'local'),
    from_city_id    = nullif(btrim(coalesce(p->>'from_city_id', '')), '')::uuid,
    to_city_id      = nullif(btrim(coalesce(p->>'to_city_id', '')), '')::uuid,
    start_on        = nullif(btrim(coalesce(p->>'start_on', '')), '')::date,
    start_time      = nullif(btrim(coalesce(p->>'start_time', '')), '')::time,
    end_on          = nullif(btrim(coalesce(p->>'end_on', '')), '')::date,
    end_time        = nullif(btrim(coalesce(p->>'end_time', '')), '')::time,
    airline_id      = nullif(btrim(coalesce(p->>'airline_id', '')), '')::uuid,
    hotel_id        = nullif(btrim(coalesce(p->>'hotel_id', '')), '')::uuid,
    bus_operator_id = nullif(btrim(coalesce(p->>'bus_operator_id', '')), '')::uuid,
    carrier_other   = nullif(btrim(coalesce(p->>'carrier_other', '')), ''),
    booking_ref     = nullif(btrim(coalesce(p->>'booking_ref', '')), ''),
    travel_class    = nullif(btrim(coalesce(p->>'travel_class', '')), ''),
    ticket_cost     = coalesce(nullif(btrim(coalesce(p->>'ticket_cost', '')), '')::numeric, 0),
    other_charges   = coalesce(nullif(btrim(coalesce(p->>'other_charges', '')), '')::numeric, 0),
    refund_amount   = coalesce(nullif(btrim(coalesce(p->>'refund_amount', '')), '')::numeric, 0),
    doc_path        = nullif(btrim(coalesce(p->>'doc_path', '')), ''),
    ai_extracted    = case when p ? 'ai_extracted' then p->'ai_extracted' else ai_extracted end,
    notes           = nullif(btrim(coalesce(p->>'notes', '')), '')
  where id = v_leg;

  return v_leg;
end $$;

comment on function public.fms_travel_save_leg(uuid, jsonb, uuid) is
  'Create or update one booked leg. Editable until the trip closes - a refund lands weeks after the booking step, and locking it would be how refunds stop being recorded.';
grant execute on function public.fms_travel_save_leg(uuid, jsonb, uuid) to authenticated;


create or replace function public.fms_travel_remove_leg(p_leg uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_trip uuid;
  v_st   text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select l.trip_id, t.status into v_trip, v_st
    from public.fms_travel_legs l join public.fms_travel_trips t on t.id = l.trip_id
   where l.id = p_leg;
  if v_trip is null then raise exception 'Booking not found'; end if;

  if not public.fms_travel_can_act('booking', v_trip, v_uid) then
    raise exception 'You are not authorized to change this trip bookings';
  end if;
  if v_st in ('closed', 'cancelled', 'rejected') then
    raise exception 'A trip that is % cannot have its bookings edited', replace(v_st, '_', ' ');
  end if;

  delete from public.fms_travel_legs where id = p_leg;
end $$;
grant execute on function public.fms_travel_remove_leg(uuid) to authenticated;


-- ===========================================================================
-- THE BOOKING STEP CLOSES.
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


-- ===========================================================================
-- CANCELLATION.
-- ===========================================================================
create or replace function public.fms_travel_request_cancellation(p_trip uuid, p_reason text)
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
  if v_why is null then raise exception 'Say why the trip is being cancelled'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'booked' then
    raise exception 'Only a booked trip is cancelled through the desk. This one is %.',
      replace(t.status, '_', ' ');
  end if;
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)) then
    raise exception 'You are not authorized to cancel this trip';
  end if;

  update public.fms_travel_trips
     set status = 'cancellation_requested', current_step = 'booking',
         cancel_reason = v_why
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'cancellation_requested',
    coalesce(t.trip_no, 'The trip') || ' — cancellation requested: ' || v_why,
    public.fms_travel_step_owner_ids('booking')
      || array_remove(array[t.raised_by, t.traveller_id], null));
end $$;
grant execute on function public.fms_travel_request_cancellation(uuid, text) to authenticated;


/**
 * The desk cancels the bookings, records the refunds and decides where the trip
 * goes.
 *
 * ⚠ WHERE IT GOES IS DECIDED BY THE MONEY, NOT BY THE REQUEST. Three outcomes:
 *
 *   nothing left to settle   → `cancelled`. Fully refunded, no advance out.
 *   charges or an advance    → `cancelled_pending_claim`, which sits at the
 *                              CLAIM step. §4.1 makes a cancellation charge
 *                              reimbursable when the reason is BUSINESS, and an
 *                              advance has to come back either way. Sending this
 *                              trip to `cancelled` would take both out of every
 *                              queue and every report in the module.
 *   refused                  → back to `booked`. The trip is still on.
 *
 * ⚠ `p_kind` IS BUSINESS OR PERSONAL AND IT IS NOT COSMETIC. It is what phase 8
 *   reads to decide whether the charge may be claimed at all, so it is recorded
 *   on the trip and on every leg cancelled with it.
 */
create or replace function public.fms_travel_process_cancellation(
  p_trip     uuid,
  p_decision text,            -- 'cancel' | 'refuse'
  p_kind     text default null,  -- 'business' | 'personal'
  p_note     text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  t        record;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_charges numeric;
  v_owing  numeric;
  v_next   text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('cancel', 'refuse') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'cancellation_requested' then
    raise exception 'This trip is %, not awaiting a cancellation decision', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('booking', p_trip, v_uid) then
    raise exception 'Only the Travel Desk can process a cancellation';
  end if;

  if p_decision = 'refuse' then
    if v_note is null then
      raise exception 'Say why the cancellation is not being processed';
    end if;
    update public.fms_travel_trips
       set status = 'booked', current_step = 'claim', cancel_reason = null
     where id = p_trip;
    perform public.fms_travel_announce('trip', p_trip, 'cancellation_refused',
      coalesce(t.trip_no, 'The trip') || ' — cancellation not processed: ' || v_note,
      array_remove(array[t.raised_by, t.traveller_id], null));
    return 'booked';
  end if;

  if p_kind not in ('business', 'personal') then
    raise exception 'Say whether the cancellation is for a business or a personal reason — §4.1 makes the charge reimbursable only for the former.';
  end if;

  -- Mark every leg cancelled, carrying the reason down so a claim line can be
  -- judged against it later.
  update public.fms_travel_legs
     set cancelled_at = now(),
         cancel_reason_kind = p_kind,
         cancel_reason = coalesce(v_note, t.cancel_reason)
   where trip_id = p_trip and cancelled_at is null;

  select coalesce(sum(net_cost), 0) into v_charges
    from public.fms_travel_legs where trip_id = p_trip;
  v_owing := public.fms_travel_outstanding_advance(t.traveller_id);

  if v_charges > 0 or v_owing > 0 then
    v_next := 'cancelled_pending_claim';
    update public.fms_travel_trips
       set status = v_next, current_step = 'claim',
           cancelled_at = now(),
           cancel_reason = coalesce(v_note, t.cancel_reason)
     where id = p_trip;
  else
    v_next := 'cancelled';
    update public.fms_travel_trips
       set status = v_next, current_step = null,
           cancelled_at = now(),
           cancel_reason = coalesce(v_note, t.cancel_reason)
     where id = p_trip;
  end if;

  perform public.fms_travel_announce('trip', p_trip, 'trip_cancelled',
    coalesce(t.trip_no, 'The trip') || ' was cancelled (' || p_kind || ')'
      || case when v_next = 'cancelled_pending_claim'
              then ' — ' || to_char(v_charges, 'FM999999999.00') || ' of charges'
                   || case when v_owing > 0 then ' and an advance' else '' end
                   || ' still to settle'
              else '' end,
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('kind', p_kind, 'charges', v_charges, 'advance_owing', v_owing));

  return v_next;
end $$;

comment on function public.fms_travel_process_cancellation(uuid, text, text, text) is
  'Cancel the bookings and route the trip by what is left to settle. A trip with charges or an outstanding advance goes to cancelled_pending_claim, which sits at the CLAIM step - §4.1 makes a business-reason charge reimbursable, and an advance has to come back either way.';
grant execute on function public.fms_travel_process_cancellation(uuid, text, text, text) to authenticated;

commit;
