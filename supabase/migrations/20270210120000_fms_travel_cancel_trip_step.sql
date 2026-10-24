-- ===========================================================================
-- Travel Desk — CANCEL TRIP becomes its own step (user, 2026-10-23).
--
-- Before: the booker cancelled a closed trip in one go — tickets, reason and
-- credit note together (20270124120000).
--
-- Now two people, two moments:
--
--   1. The person who raised the trip clicks "Cancel booking", chooses the
--      ticket(s) and writes the REASON. Nothing is cancelled yet; the trip goes
--      to `cancel_pending` and waits at the new step `cancel_trip`.
--   2. Whoever owns "Cancel Trip" in Settings opens it from the Cancel Trip
--      bucket, uploads the CREDIT NOTE and types its NUMBER and AMOUNT. Only
--      then are the tickets cancelled. One ticket → the trip goes back to
--      `closed`; the last ticket → `cancelled`.
--
-- The Cancel Trip step shows on a trip's pipeline only once a cancellation has
-- been asked for, and stays until it is completed.
--
-- ⚠ `fms_travel_cancel_booking` (one-step) is kept, not dropped, but nobody may
--   call it any more — every cancellation now goes through the bucket.
--
-- Additive: 1 status value, 4 trip columns, 3 cancellation columns,
-- 2 new functions, 1 replaced function (hold), grants.
-- Reversal: 20270210120000_fms_travel_cancel_trip_step_rollback.sql
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The new status: a cancellation asked for, waiting on the Cancel Trip owner.
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
    'cancelled_pending_claim',
    'cancel_pending',
    'awaiting_claim_review',
    'awaiting_finance_review',
    'awaiting_settlement',
    'closed',
    'on_hold',
    'cancelled'));

-- When the latest cancellation was asked for / completed, and by whom — what
-- the pipeline dates the Cancel Trip step with.
alter table public.fms_travel_trips
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by uuid references auth.users on delete set null,
  add column if not exists cancel_done_at      timestamptz,
  add column if not exists cancel_done_by      uuid references auth.users on delete set null;


-- ---------------------------------------------------------------------------
-- A cancellation row now exists from the REQUEST; the credit note arrives later.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_cancellations
  add column if not exists status       text not null default 'completed',
  add column if not exists requested_by uuid references auth.users on delete set null,
  add column if not exists requested_at timestamptz not null default now();

alter table public.fms_travel_cancellations
  drop constraint if exists fms_travel_cancellations_status_check;
alter table public.fms_travel_cancellations
  add constraint fms_travel_cancellations_status_check
  check (status in ('requested', 'completed'));

alter table public.fms_travel_cancellations
  alter column credit_note_no     drop not null,
  alter column credit_note_amount drop not null,
  alter column credit_note_path   drop not null,
  alter column cancelled_at       drop not null,
  alter column cancelled_at       drop default;

-- A completed cancellation always carries its credit note.
alter table public.fms_travel_cancellations
  drop constraint if exists fms_travel_cancellations_completed_has_credit_note;
alter table public.fms_travel_cancellations
  add constraint fms_travel_cancellations_completed_has_credit_note
  check (status = 'requested' or (
    credit_note_no is not null and credit_note_amount is not null
    and credit_note_path is not null and cancelled_at is not null));


-- ===========================================================================
-- 1. THE RAISER ASKS — tickets and reason only.
-- ===========================================================================
create or replace function public.fms_travel_request_cancel_booking(
  p_trip    uuid,
  p_leg_ids uuid[],
  p_reason  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_legs uuid[];
  v_n    int;
  v_cid  uuid;
  v_whole boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not (t.status = 'closed' and t.closed_at_booking) then
    raise exception 'Only a booked and closed trip can be cancelled here. This one is %.',
      replace(t.status, '_', ' ');
  end if;
  if not public.module_can_edit(v_uid, 'travel-desk') then
    raise exception 'You are not authorized to cancel this trip';
  end if;
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)) then
    raise exception 'Only the person who raised this trip can ask for it to be cancelled';
  end if;
  if v_why is null then raise exception 'Say why the booking is being cancelled'; end if;

  select array_agg(distinct x) into v_legs
    from unnest(coalesce(p_leg_ids, '{}'::uuid[])) x;
  v_n := coalesce(array_length(v_legs, 1), 0);
  if v_n = 0 then raise exception 'Choose which ticket(s) to cancel'; end if;
  if (select count(*) from public.fms_travel_legs
       where id = any(v_legs) and trip_id = p_trip and cancelled_at is null) <> v_n then
    raise exception 'A chosen ticket does not belong to this trip or is already cancelled';
  end if;

  v_whole := not exists (select 1 from public.fms_travel_legs
                          where trip_id = p_trip and cancelled_at is null
                            and not (id = any(v_legs)));

  insert into public.fms_travel_cancellations
    (trip_id, leg_ids, whole_trip, reason, status, requested_by, requested_at)
  values (p_trip, v_legs, v_whole, v_why, 'requested', v_uid, now())
  returning id into v_cid;

  update public.fms_travel_trips
     set status = 'cancel_pending', current_step = 'cancel_trip',
         cancel_requested_at = now(), cancel_requested_by = v_uid,
         cancel_done_at = null, cancel_done_by = null
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'cancellation_requested',
    coalesce(t.trip_no, 'The trip') || ' — cancellation asked for ('
      || case when v_whole then 'whole trip' else v_n || case when v_n = 1 then ' ticket' else ' tickets' end end
      || '): ' || v_why || '. Waiting for the credit note.',
    public.fms_travel_step_owner_ids('cancel_trip')
      || array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('cancellation_id', v_cid, 'legs', v_n, 'whole_trip', v_whole));

  return v_cid;
end $$;

comment on function public.fms_travel_request_cancel_booking(uuid, uuid[], text) is
  'Step 1 of a cancellation: the raiser (or traveller / coordinator / admin) chooses the ticket(s) and gives the reason. The trip goes to cancel_pending and waits at the Cancel Trip step for the credit note.';
revoke all on function public.fms_travel_request_cancel_booking(uuid, uuid[], text) from public, anon;
grant execute on function public.fms_travel_request_cancel_booking(uuid, uuid[], text) to authenticated;


-- ===========================================================================
-- 2. THE CANCEL TRIP OWNER COMPLETES IT — credit note file, number, amount.
-- ===========================================================================
create or replace function public.fms_travel_complete_cancel_booking(
  p_cancellation uuid,
  p_cn_no        text,
  p_cn_amount    numeric,
  p_cn_path      text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  x       record;
  t       record;
  v_no    text := nullif(btrim(coalesce(p_cn_no, '')), '');
  v_path  text := nullif(btrim(coalesce(p_cn_path, '')), '');
  v_n     int;
  v_paid  numeric;
  v_left  numeric;
  v_share numeric;
  v_i     int := 0;
  v_whole boolean;
  l       record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into x from public.fms_travel_cancellations where id = p_cancellation for update;
  if x.id is null then raise exception 'Cancellation not found'; end if;
  if x.status <> 'requested' then raise exception 'This cancellation is already completed'; end if;

  select * into t from public.fms_travel_trips where id = x.trip_id for update;
  if t.status <> 'cancel_pending' then
    raise exception 'This trip is %, not waiting for a cancellation', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('cancel_trip', t.id, v_uid) then
    raise exception 'Only the Cancel Trip team can complete a cancellation';
  end if;

  if v_path is null then raise exception 'Upload the credit note — it is required'; end if;
  if v_no   is null then raise exception 'Enter the credit note number'; end if;
  if p_cn_amount is null or p_cn_amount < 0 then raise exception 'Enter the credit note amount'; end if;
  if v_path not like t.id::text || '/cancellation/%' then
    raise exception 'The credit note must be filed on this trip';
  end if;

  v_n := coalesce(array_length(x.leg_ids, 1), 0);
  if (select count(*) from public.fms_travel_legs
       where id = any(x.leg_ids) and trip_id = t.id and cancelled_at is null) <> v_n then
    raise exception 'A ticket on this request was changed or already cancelled — ask for it again';
  end if;

  select coalesce(sum(ticket_cost + other_charges), 0) into v_paid
    from public.fms_travel_legs where id = any(x.leg_ids);
  if p_cn_amount > v_paid then
    raise exception 'The credit note (%) is more than was paid for these tickets (%)',
      to_char(p_cn_amount, 'FM999999999.00'), to_char(v_paid, 'FM999999999.00');
  end if;

  update public.fms_travel_cancellations
     set status = 'completed', credit_note_no = v_no, credit_note_amount = p_cn_amount,
         credit_note_path = v_path, cancelled_by = v_uid, cancelled_at = now()
   where id = x.id;

  -- The credit note is the refund, split by what each ticket cost; the last one
  -- takes the rounding so the parts add up to the note exactly.
  v_left := p_cn_amount;
  for l in
    select id, ticket_cost + other_charges as paid
      from public.fms_travel_legs where id = any(x.leg_ids)
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
       set cancelled_at = now(), cancel_reason = x.reason,
           cancellation_id = x.id, refund_amount = v_share
     where id = l.id;
  end loop;

  v_whole := not exists (select 1 from public.fms_travel_legs
                          where trip_id = t.id and cancelled_at is null);

  if v_whole then
    update public.fms_travel_trips
       set status = 'cancelled', current_step = null,
           cancelled_at = now(), cancel_reason = x.reason,
           cancel_done_at = now(), cancel_done_by = v_uid
     where id = t.id;
  else
    update public.fms_travel_trips
       set status = 'closed', current_step = 'booking',
           cancel_done_at = now(), cancel_done_by = v_uid
     where id = t.id;
  end if;

  perform public.fms_travel_announce('trip', t.id, 'trip_cancelled',
    coalesce(t.trip_no, 'The trip') ||
      case when v_whole then ' was cancelled — '
           else ' — ' || v_n || case when v_n = 1 then ' ticket' else ' tickets' end
                || ' cancelled — ' end
      || x.reason || ' (credit note ' || v_no || ')',
    array_remove(array[t.raised_by, t.traveller_id, x.requested_by], null),
    jsonb_build_object('cancellation_id', x.id, 'legs', v_n, 'whole_trip', v_whole));

  return case when v_whole then 'cancelled' else 'closed' end;
end $$;

comment on function public.fms_travel_complete_cancel_booking(uuid, text, numeric, text) is
  'Step 2 of a cancellation: the Cancel Trip owner files the credit note (file, number, amount). The tickets are cancelled, the amount becomes their refund, and the trip goes back to closed — or to cancelled when no ticket is left.';
revoke all on function public.fms_travel_complete_cancel_booking(uuid, text, numeric, text) from public, anon;
grant execute on function public.fms_travel_complete_cancel_booking(uuid, text, numeric, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The one-step cancel is kept but closed off: every cancellation now goes
-- through the Cancel Trip bucket.
-- ---------------------------------------------------------------------------
revoke all on function public.fms_travel_cancel_booking(uuid, uuid[], text, text, numeric, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- A pending cancellation cannot be put on hold: resuming it would re-route the
-- trip by the old router, which knows nothing of the Cancel Trip step.
-- (Verbatim from 20261005121100 except the status list.)
-- ---------------------------------------------------------------------------
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
  if t.status in ('draft', 'on_hold', 'closed', 'cancelled', 'rejected', 'cancel_pending') then
    raise exception 'A trip that is % cannot be put on hold', replace(t.status, '_', ' ');
  end if;
  -- The same list that may CANCEL, plus whoever currently owes the step.
  if not (t.raised_by = v_uid or t.traveller_id = v_uid
          or public.fms_travel_is_coordinator(v_uid) or public.is_admin(v_uid)
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

commit;
