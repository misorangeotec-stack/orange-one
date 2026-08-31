-- ===========================================================================
-- Travel Desk FMS — THE TRAVEL ADVANCE (Phase 5).
--
--   fms_travel_outstanding_advance          — what one person still owes
--   fms_travel_outstanding_advance_by_code  — the same, by employee_code
--   fms_travel_approve_advance              — Finance sets the amount
--   fms_travel_disburse_advance             — the money leaves, the step closes
--   fms_travel_record_advance_recovery      — money handed back
--
-- ⚠ §11.2 IS THE POINT OF THIS PHASE. "No second travel advance shall be issued
--   to an employee who has an outstanding unreconciled advance" is the policy's
--   hardest rule and it has been unenforceable, because nothing in the business
--   could answer "what does this person still owe?". A rule nobody can evaluate
--   is a rule nobody follows. `fms_travel_outstanding_advance` is that answer,
--   and it is checked in TWO places for two different reasons:
--
--     at SUBMIT      — so a traveller is told before they plan around money they
--                      are not going to get. This refuses the submission with the
--                      amount and the trip it belongs to, so the fix is obvious:
--                      untick the advance, or settle the old one.
--     at DISBURSE    — the real backstop. Weeks pass between the two, and the
--                      state can change in between. Checking only at submit would
--                      mean a trip approved in March could draw a second advance
--                      in April against an advance that went unreconciled in the
--                      meantime.
--
-- ⚠ A CANCELLED TRIP'S ADVANCE STAYS OUTSTANDING. It has to: the money left the
--   company and no settlement is coming, because a cancelled trip never reaches
--   the claim. Without `record_advance_recovery` such a person would be blocked
--   from every future advance for ever, which is why that RPC lands here rather
--   than waiting for phase 9's settlement.
--
-- Additive: 3 nullable columns, 5 functions. Reversal (reverse order):
--   drop function if exists public.fms_travel_record_advance_recovery(uuid, numeric, text);
--   drop function if exists public.fms_travel_disburse_advance(uuid, numeric, date, text, text);
--   drop function if exists public.fms_travel_approve_advance(uuid, numeric, text);
--   drop function if exists public.fms_travel_outstanding_advance_by_code(text, date);
--   drop function if exists public.fms_travel_outstanding_advance(uuid, date);
--   alter table public.fms_travel_trips
--     drop column if exists advance_recovered_amount,
--     drop column if exists advance_recovered_at,
--     drop column if exists advance_recovered_ref;
-- ===========================================================================

begin;

alter table public.fms_travel_trips
  add column if not exists adv_note                 text,
  add column if not exists advance_recovered_amount numeric(14,2),
  add column if not exists advance_recovered_at     timestamptz,
  add column if not exists advance_recovered_ref    text;

comment on column public.fms_travel_trips.advance_recovered_amount is
  'Advance handed back rather than netted against a claim - the cancelled-trip case. Without it a cancelled trip that drew money would block that person from every future advance for ever under §11.2.';


-- ===========================================================================
-- WHAT THIS PERSON STILL OWES.
--
-- ⚠ "OUTSTANDING" MEANS PAID AND NOT YET RECONCILED, WHICH IS NOT THE SAME AS
--   "ON AN OPEN TRIP". A cancelled trip that drew ₹12,000 owes ₹12,000; a
--   settled trip owes nothing however recently it closed. So the test is on the
--   MONEY (`advance_paid_amount` less anything recovered) and on whether the
--   settlement step has stamped — never on the trip's status.
--
-- `p_as_at` exists for the hr-exit hand-off: a leaver's clearance asks what they
-- owed on their last working day, not what they owe today.
-- ===========================================================================
create or replace function public.fms_travel_outstanding_advance(
  p_user  uuid,
  p_as_at date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
           greatest(coalesce(t.advance_paid_amount, 0) - coalesce(t.advance_recovered_amount, 0), 0)
         ), 0)::numeric
    from public.fms_travel_trips t
   where t.traveller_id = p_user
     and coalesce(t.advance_paid_amount, 0) > 0
     and t.advance_paid_at::date <= p_as_at
     -- Settled means the settlement step netted it. Anything else still owes.
     and (t.st_at is null or t.st_at::date > p_as_at);
$$;

comment on function public.fms_travel_outstanding_advance(uuid, date) is
  'What this person still owes in unreconciled travel advance as at a date. §11.2 refuses a second advance while this is above zero. Reads the MONEY, not the trip status - a cancelled trip that drew an advance still owes it.';
grant execute on function public.fms_travel_outstanding_advance(uuid, date) to authenticated;

/*
  ⚠ BY EMPLOYEE CODE AS WELL, AND THAT IS NOT REDUNDANCY. The Employee Exit
    module keys its clearance rows on `employee_code` with a NULLABLE
    `employee_user_id`, because plenty of staff never had a portal login. Its
    `travel_advance` clearance row is ticked from memory today; this is what
    lets that tick become evidence-backed, and it cannot depend on the leaver
    having an auth account.
*/
create or replace function public.fms_travel_outstanding_advance_by_code(
  p_code  text,
  p_as_at date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
           greatest(coalesce(t.advance_paid_amount, 0) - coalesce(t.advance_recovered_amount, 0), 0)
         ), 0)::numeric
    from public.fms_travel_trips t
   where coalesce(t.advance_paid_amount, 0) > 0
     and t.advance_paid_at::date <= p_as_at
     and (t.st_at is null or t.st_at::date > p_as_at)
     -- The code on the TRIP is the one frozen at submit; fall back to the
     -- profile for a trip raised before the code was recorded.
     and (
          upper(btrim(coalesce(t.traveller_employee_code, ''))) = upper(btrim(coalesce(p_code, '')))
       or exists (select 1 from public.profiles p
                   where p.id = t.traveller_id
                     and upper(btrim(coalesce(p.employee_code, ''))) = upper(btrim(coalesce(p_code, ''))))
     )
     and nullif(btrim(coalesce(p_code, '')), '') is not null;
$$;

comment on function public.fms_travel_outstanding_advance_by_code(text, date) is
  'Outstanding advance for somebody identified by employee_code rather than by auth id - the Employee Exit hand-off, whose clearance rows carry a nullable user id.';
grant execute on function public.fms_travel_outstanding_advance_by_code(text, date) to authenticated;


-- ===========================================================================
-- §11.1 — an advance may not exceed 90% of the estimated cost.
-- Kept as one function so submit, approve and disburse cannot disagree.
-- ===========================================================================
create or replace function public.fms_travel_advance_ceiling(p_trip uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
           when t.estimated_cost is null then null
           else round(t.estimated_cost * coalesce(
             (select (value->>'advance_max_pct')::numeric from public.fms_travel_config where key = 'policy'),
             90) / 100, 2)
         end
    from public.fms_travel_trips t where t.id = p_trip;
$$;
grant execute on function public.fms_travel_advance_ceiling(uuid) to authenticated;


-- ===========================================================================
-- FINANCE SETS THE AMOUNT.
--
-- Separate from disbursement on purpose: §11.1 gives the approval and the
-- payment different owners and different deadlines, and in practice the figure
-- is agreed days before the transfer goes out. Folding them together would mean
-- an advance could only be approved by somebody able to move money.
-- ===========================================================================
create or replace function public.fms_travel_approve_advance(
  p_trip   uuid,
  p_amount numeric,
  p_note   text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t     record;
  v_cap numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;

  if t.advance_skipped or not t.advance_requested then
    raise exception 'This trip did not ask for an advance, so there is nothing to approve here.';
  end if;
  if t.status <> 'awaiting_advance' then
    raise exception 'This trip is %, not awaiting an advance', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('advance', p_trip, v_uid) then
    raise exception 'You are not authorized to approve a travel advance';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount being approved';
  end if;

  v_cap := public.fms_travel_advance_ceiling(p_trip);
  if v_cap is not null and p_amount > v_cap then
    raise exception 'Policy §11.1 caps the advance at % of the estimate, which is % on this trip. Approve % or less, or ask for the estimate to be corrected.',
      coalesce((select value->>'advance_max_pct' from public.fms_travel_config where key = 'policy'), '90') || '%',
      to_char(v_cap, 'FM999999999.00'),
      to_char(v_cap, 'FM999999999.00');
  end if;

  update public.fms_travel_trips
     set advance_approved_amount = p_amount,
         adv_note                = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'advance_approved',
    coalesce(t.trip_no, 'The trip') || ' — advance of ' || to_char(p_amount, 'FM999999999.00') || ' approved',
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('amount', p_amount));

  return p_amount;
end $$;

comment on function public.fms_travel_approve_advance(uuid, numeric, text) is
  'Finance agrees the advance figure. Separate from disbursement because §11.1 gives the two different owners and different deadlines.';
grant execute on function public.fms_travel_approve_advance(uuid, numeric, text) to authenticated;


-- ===========================================================================
-- THE MONEY LEAVES.
-- ===========================================================================
create or replace function public.fms_travel_disburse_advance(
  p_trip    uuid,
  p_amount  numeric,
  p_paid_on date default current_date,
  p_mode    text default null,
  p_ref     text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  t       record;
  v_cap   numeric;
  v_owing numeric;
  v_next  record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;

  if t.advance_skipped or not t.advance_requested then
    raise exception 'This trip did not ask for an advance.';
  end if;
  if t.status <> 'awaiting_advance' then
    raise exception 'This trip is %, not awaiting an advance', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('advance', p_trip, v_uid) then
    raise exception 'You are not authorized to disburse a travel advance';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount actually paid';
  end if;

  v_cap := public.fms_travel_advance_ceiling(p_trip);
  if v_cap is not null and p_amount > v_cap then
    raise exception 'Policy §11.1 caps the advance at % on this trip.', to_char(v_cap, 'FM999999999.00');
  end if;

  /*
    ⚠ §11.2 CHECKED AGAIN HERE, AND THIS IS THE REAL GATE. Submit refuses the
      same thing weeks earlier so nobody plans around money they will not get —
      but weeks is exactly long enough for the answer to change, and the rule is
      about the moment the money is ISSUED. `p_trip` is excluded from the sum:
      this trip's own advance is what we are about to pay, not a prior debt.
  */
  select coalesce(sum(
           greatest(coalesce(x.advance_paid_amount, 0) - coalesce(x.advance_recovered_amount, 0), 0)
         ), 0)
    into v_owing
    from public.fms_travel_trips x
   where x.traveller_id = t.traveller_id
     and x.id <> p_trip
     and coalesce(x.advance_paid_amount, 0) > 0
     and x.st_at is null;

  if v_owing > 0 then
    raise exception 'Policy §11.2 — % of travel advance is still unreconciled for this traveller, so a second advance cannot be issued. Settle or recover that first.',
      to_char(v_owing, 'FM999999999.00');
  end if;

  update public.fms_travel_trips
     set advance_paid_amount = p_amount,
         advance_paid_at     = coalesce(p_paid_on, current_date)::timestamptz,
         advance_paid_ref    = nullif(btrim(coalesce(p_ref, '')), ''),
         advance_paid_mode   = nullif(btrim(coalesce(p_mode, '')), ''),
         -- The approved figure defaults to what was actually paid, so a desk
         -- that disburses without a separate approval step still leaves a
         -- coherent row rather than a null beside a payment.
         advance_approved_amount = coalesce(advance_approved_amount, p_amount),
         adv_at = now(),
         adv_by = v_uid
   where id = p_trip;

  select n.next_status, n.next_step into v_next
    from public.fms_travel_next_stop(p_trip, 'advance') n;

  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'advance_paid',
    coalesce(t.trip_no, 'The trip') || ' — advance of ' || to_char(p_amount, 'FM999999999.00') || ' paid',
    public.fms_travel_step_owner_ids(v_next.next_step)
      || array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('amount', p_amount, 'ref', p_ref, 'mode', p_mode));

  return v_next.next_status;
end $$;

comment on function public.fms_travel_disburse_advance(uuid, numeric, date, text, text) is
  'Record the advance actually paid and move the trip on. Enforces §11.1 (90% of the estimate) and §11.2 (no second advance while one is unreconciled) - the latter is checked HERE as well as at submit, because weeks pass between the two.';
grant execute on function public.fms_travel_disburse_advance(uuid, numeric, date, text, text) to authenticated;


-- ===========================================================================
-- MONEY HANDED BACK.
--
-- The cancelled-trip case: the advance left, the trip never happened, and no
-- claim is coming to net it against. Without this the traveller is blocked from
-- every future advance for ever by §11.2.
-- ===========================================================================
create or replace function public.fms_travel_record_advance_recovery(
  p_trip   uuid,
  p_amount numeric,
  p_ref    text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t     record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if coalesce(t.advance_paid_amount, 0) <= 0 then
    raise exception 'No advance was paid on this trip, so there is nothing to recover.';
  end if;
  if not (public.fms_travel_can_act('advance', p_trip, v_uid)
          or public.fms_travel_can_act('settlement', p_trip, v_uid)) then
    raise exception 'Only Finance can record an advance recovery';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount recovered';
  end if;
  if coalesce(t.advance_recovered_amount, 0) + p_amount > t.advance_paid_amount then
    raise exception 'That is more than the % still outstanding on this trip.',
      to_char(t.advance_paid_amount - coalesce(t.advance_recovered_amount, 0), 'FM999999999.00');
  end if;

  update public.fms_travel_trips
     set advance_recovered_amount = coalesce(advance_recovered_amount, 0) + p_amount,
         advance_recovered_at     = now(),
         advance_recovered_ref    = nullif(btrim(coalesce(p_ref, '')), '')
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'advance_recovered',
    coalesce(t.trip_no, 'The trip') || ' — ' || to_char(p_amount, 'FM999999999.00') || ' of advance recovered',
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('amount', p_amount, 'ref', p_ref));

  return coalesce(t.advance_recovered_amount, 0) + p_amount;
end $$;
grant execute on function public.fms_travel_record_advance_recovery(uuid, numeric, text) to authenticated;

commit;
