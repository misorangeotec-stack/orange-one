-- ===========================================================================
-- PHASE 9 — FINANCE REVIEW AND SETTLEMENT.
--
-- ⚠ FINANCE IS NOT A SECOND AUTHOR OF THE CAPS. Every cap in §7, §9, §10 and
--   §15 was applied by `fms_travel_check_claim` before the claim ever reached
--   here, and Finance may not edit `allowed_amount` — that column is the
--   engine's answer and stays the engine's answer for ever. What Finance can do
--   is record a DIFFERENT figure beside it, with a reason:
--
--     * settle a line LOWER than the engine allowed — a judgement no rule can
--       make ("this dinner was not business"), or a receipt that turned out to
--       be illegible.
--     * settle a line HIGHER than the engine allowed, up to what was claimed —
--       the §7.3 exception path, once the evidence is actually in the file.
--
--   Both land in `finance_amount` + `finance_reason`, exactly as Finance's DA
--   override lands in `override_amount` + `override_reason`. The engine's answer
--   and the human's answer sit side by side on the row, and the difference
--   between them is the Policy Exceptions report.
--
-- ⚠ A LINE MAY NEVER BE SETTLED ABOVE WHAT WAS CLAIMED. You cannot reimburse
--   somebody more than they spent, and a CHECK says so rather than a comment.
--
-- ⚠ AN ADVANCE LARGER THAN THE CLAIM IS A RECOVERABLE, NOT A NEGATIVE PAYMENT.
--   `fms_travel_settle` refuses to record a payment on a trip whose net is
--   negative and vice versa — they are two different events with two different
--   pieces of evidence, and a payment of −4,390 is a row nobody can reconcile
--   against a bank statement.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- Finance's per-line answer, beside the engine's.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_claim_lines
  add column if not exists finance_amount numeric(12,2),
  add column if not exists finance_reason text,
  add column if not exists finance_by     uuid references auth.users on delete set null,
  add column if not exists finance_at     timestamptz;

comment on column public.fms_travel_claim_lines.finance_amount is
  'What FINANCE settled this line at, which may differ from the engine''s allowed_amount in either direction. NULL means Finance did not touch it and the engine''s figure stands. allowed_amount is never overwritten - the pair is what the Policy Exceptions report reads.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'fms_travel_claim_finance_needs_a_reason') then
    alter table public.fms_travel_claim_lines
      add constraint fms_travel_claim_finance_needs_a_reason check (
        finance_amount is null
        or nullif(btrim(coalesce(finance_reason, '')), '') is not null);
  end if;

  -- You cannot reimburse somebody more than they spent.
  if not exists (select 1 from pg_constraint
                  where conname = 'fms_travel_claim_finance_within_claimed') then
    alter table public.fms_travel_claim_lines
      add constraint fms_travel_claim_finance_within_claimed check (
        finance_amount is null or (finance_amount >= 0 and finance_amount <= amount));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- What settlement records.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_trips
  add column if not exists fr_note      text,
  add column if not exists settled_mode text,
  add column if not exists settled_note text;

comment on column public.fms_travel_trips.settled_amount is
  'What moved at settlement, SIGNED. Positive was paid to the traveller; negative came back from them. Storing the sign is what lets one register answer "what did travel cost this month" without a second table for recoveries.';


-- ===========================================================================
-- RE-PRICING, WITH FINANCE'S ANSWER HONOURED.
--
-- Two changes from 20261005121900, both of them corrections:
--
--   1. The roll-up reads `coalesce(finance_amount, allowed_amount)`, so a line
--      Finance settled differently is reflected in the trip's totals.
--   2. The advance is netted at what is still OUTSTANDING, not at what was
--      gross paid. A cancelled trip whose advance was handed back in cash
--      already has `advance_recovered_amount` set, and netting the gross figure
--      would take it off the traveller twice.
-- ===========================================================================
create or replace function public.fms_travel_price_claim(p_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lines   jsonb;
  v_claimed numeric := 0;
  v_allowed numeric := 0;
  v_settled numeric := 0;
  v_da      numeric := 0;
  r         record;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                l.id::text,
           'category_id',       l.category_id::text,
           'city_id',           l.city_id::text,
           'date',              l.spent_on::text,
           'amount',            l.amount::text,
           'has_receipt',       l.has_receipt,
           'self_declared',     l.self_declared,
           'nights',            l.nights::text,
           'persons',           l.persons::text,
           'days',              l.days::text,
           'km',                l.km::text,
           'guests',            l.guests,
           'meal_kind',         l.meal_kind,
           'vehicle_type',      l.vehicle_type,
           'full_day_rental',   l.full_day_rental,
           'over_cap_evidence', l.over_cap_evidence,
           'hod_approved',      l.hod_approved,
           'director_approved', l.director_approved
         ) order by l.sort_order), '[]'::jsonb)
    into v_lines
    from public.fms_travel_claim_lines l where l.trip_id = p_trip;

  for r in select * from public.fms_travel_check_claim(p_trip, v_lines) loop
    update public.fms_travel_claim_lines set
      cap_applied     = r.cap_applied,
      allowed_amount  = r.allowed,
      disallow_reason = r.disallow_reason,
      engine_note     = r.note,
      priced_at       = now()
    where id = r.line_id::uuid;

    v_claimed := v_claimed + coalesce(r.claimed, 0);
    v_allowed := v_allowed + coalesce(r.allowed, 0);
  end loop;

  -- What is actually being settled, line by line: Finance's figure where there
  -- is one, the engine's where there is not.
  select coalesce(sum(coalesce(l.finance_amount, l.allowed_amount, 0)), 0)
    into v_settled
    from public.fms_travel_claim_lines l where l.trip_id = p_trip;

  v_da := public.fms_travel_freeze_da(p_trip);

  update public.fms_travel_trips set
    claim_total      = round(v_claimed, 2),
    -- ⚠ MEASURED AGAINST WHAT IS BEING SETTLED, not against the engine's
    --   allowance, so a line Finance cut further shows up as disallowed rather
    --   than quietly vanishing out of both totals.
    disallowed_total = round(v_claimed - v_settled, 2),
    da_total         = round(v_da, 2),
    net_payable      = round(
                         v_settled + v_da
                         - greatest(coalesce(advance_paid_amount, 0)
                                    - coalesce(advance_recovered_amount, 0), 0), 2)
  where id = p_trip;

  return jsonb_build_object(
    'claimed',    round(v_claimed, 2),
    'allowed',    round(v_allowed, 2),
    'settled',    round(v_settled, 2),
    'disallowed', round(v_claimed - v_settled, 2),
    'da',         round(v_da, 2));
end $$;

comment on function public.fms_travel_price_claim(uuid) is
  'Re-price a trip''s stored claim lines through the money engine and roll up the totals. Honours Finance''s per-line figure where there is one, and nets the advance at what is still OUTSTANDING rather than at what was gross paid. net_payable stays NEGATIVE when the traveller owes money back.';
grant execute on function public.fms_travel_price_claim(uuid) to authenticated;


-- ===========================================================================
-- FINANCE'S PER-LINE DECISION.
-- ===========================================================================
create or replace function public.fms_travel_set_line_settlement(
  p_line   uuid,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  l      record;
  t      record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into l from public.fms_travel_claim_lines where id = p_line;
  if l.id is null then raise exception 'Claim line not found'; end if;

  select * into t from public.fms_travel_trips where id = l.trip_id for update;
  if not public.fms_travel_can_act('finance_review', t.id, v_uid) then
    raise exception 'You are not authorized to verify this claim';
  end if;
  if t.status <> 'awaiting_finance_review' then
    raise exception 'This trip is %, not awaiting Finance verification', replace(t.status, '_', ' ');
  end if;

  /* ⚠ CLEARING IS ALLOWED AND IS NOT THE SAME AS SETTLING AT ZERO. Passing NULL
     puts the line back to whatever the engine said; passing 0 is Finance
     deciding the line is worth nothing, which needs a reason like any other
     figure. */
  if p_amount is not null then
    if v_why is null then
      raise exception 'Say why. A figure Finance changed without a reason is one nobody can explain to the traveller, and it is what the Policy Exceptions report has to print.';
    end if;
    if p_amount > l.amount then
      raise exception 'This line claimed %, so it cannot be settled at %. The company does not reimburse more than was spent.',
        to_char(l.amount, 'FM999999999.00'), to_char(p_amount, 'FM999999999.00');
    end if;
    if p_amount < 0 then raise exception 'A settled amount cannot be negative'; end if;
  end if;

  update public.fms_travel_claim_lines set
    finance_amount = p_amount,
    finance_reason = case when p_amount is null then null else v_why end,
    finance_by     = case when p_amount is null then null else v_uid end,
    finance_at     = case when p_amount is null then null else now() end
  where id = p_line;

  return public.fms_travel_price_claim(l.trip_id);
end $$;

comment on function public.fms_travel_set_line_settlement(uuid, numeric, text) is
  'Finance settles one claim line at a figure of its own, in either direction, with a mandatory reason. It never touches allowed_amount - the engine''s answer and the human''s sit side by side, and the gap between them IS the Policy Exceptions report. Passing NULL clears the override.';
grant execute on function public.fms_travel_set_line_settlement(uuid, numeric, text) to authenticated;


-- ===========================================================================
-- FINANCE'S PER-DAY DECISION ON THE ALLOWANCE.
-- ===========================================================================
create or replace function public.fms_travel_override_da_day(
  p_day    uuid,
  p_amount numeric,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  d     record;
  t     record;
  v_why text := nullif(btrim(coalesce(p_reason, '')), '');
  v_tot numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into d from public.fms_travel_da_days where id = p_day;
  if d.id is null then raise exception 'That allowance day was not found'; end if;

  select * into t from public.fms_travel_trips where id = d.trip_id for update;
  if not public.fms_travel_can_act('finance_review', t.id, v_uid) then
    raise exception 'You are not authorized to verify this claim';
  end if;
  if t.status <> 'awaiting_finance_review' then
    raise exception 'This trip is %, not awaiting Finance verification', replace(t.status, '_', ' ');
  end if;

  if p_amount is not null then
    if v_why is null then
      raise exception 'Say why this day differs from the computed allowance. The engine printed its own reason on the row; overruling it silently leaves two figures and no explanation.';
    end if;
    if p_amount < 0 then raise exception 'A daily allowance cannot be negative'; end if;
  end if;

  update public.fms_travel_da_days set
    override_amount = p_amount,
    override_reason = case when p_amount is null then null else v_why end,
    override_by     = case when p_amount is null then null else v_uid end,
    override_at     = case when p_amount is null then null else now() end
  where id = p_day;

  select coalesce(sum(coalesce(override_amount, amount)), 0) into v_tot
    from public.fms_travel_da_days where trip_id = d.trip_id;

  update public.fms_travel_trips set
    da_total    = round(v_tot, 2),
    net_payable = round(
      (select coalesce(sum(coalesce(l.finance_amount, l.allowed_amount, 0)), 0)
         from public.fms_travel_claim_lines l where l.trip_id = d.trip_id)
      + v_tot
      - greatest(coalesce(advance_paid_amount, 0)
                 - coalesce(advance_recovered_amount, 0), 0), 2)
  where id = d.trip_id;

  return v_tot;
end $$;

comment on function public.fms_travel_override_da_day(uuid, numeric, text) is
  'Finance overrules one day of the daily allowance, with a mandatory reason. It does NOT call price_claim - a recompute would carry the override forward correctly, but re-running the whole engine to change one day is work nobody asked for.';
grant execute on function public.fms_travel_override_da_day(uuid, numeric, text) to authenticated;


-- ===========================================================================
-- CLOSING THE FINANCE STEP.
-- ===========================================================================
create or replace function public.fms_travel_complete_finance_review(
  p_trip uuid,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_next record;
  v_sum  jsonb;
  v_net  numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'awaiting_finance_review' then
    raise exception 'This trip is %, not awaiting Finance verification', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('finance_review', p_trip, v_uid) then
    raise exception 'You are not authorized to verify this claim';
  end if;

  /* ⚠ RE-PRICED ONE LAST TIME BEFORE THE FIGURES ARE HANDED TO SETTLEMENT.
     Finance may have changed a line or a day since the claim was filed, and the
     person paying reads `net_payable` — so it has to be current at the moment
     the step closes, not at the moment the traveller submitted. */
  v_sum := public.fms_travel_price_claim(p_trip);

  update public.fms_travel_trips
     set fr_at = now(), fr_by = v_uid,
         fr_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_trip;

  select * into v_next from public.fms_travel_next_stop(p_trip, 'finance_review');
  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  select net_payable into v_net from public.fms_travel_trips where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'claim_verified',
    coalesce(t.trip_no, 'A trip') || ' — Finance verified the claim; ' ||
      case when v_net < 0
             then to_char(abs(v_net), 'FM999999999.00') || ' is recoverable from the traveller'
           else to_char(v_net, 'FM999999999.00') || ' is payable' end,
    array_remove(array[t.raised_by, t.traveller_id], null)
      || public.fms_travel_step_owner_ids('settlement'),
    v_sum);

  return v_next.next_status;
end $$;

comment on function public.fms_travel_complete_finance_review(uuid, text) is
  'Close the Finance verification step. Re-prices one last time so the figure handed to settlement is current, not the one the traveller submitted.';
grant execute on function public.fms_travel_complete_finance_review(uuid, text) to authenticated;


-- ===========================================================================
-- SETTLEMENT — WHERE THE MONEY ACTUALLY MOVES.
--
-- ⚠ THE SCOPE STOPS HERE, DELIBERATELY. Nothing writes to Tally or to payroll;
--   the ConnectWave mirror is read-only and there is no payroll integration.
--   Settlement records what Finance did — amount, date, mode, reference — and
--   closes the trip. That was the confirmed scope, and pretending otherwise
--   would put a figure in this system that no ledger agrees with.
-- ===========================================================================
create or replace function public.fms_travel_settle(p_trip uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  t        record;
  v_amount numeric := nullif(btrim(coalesce(p->>'amount', '')), '')::numeric;
  v_on     date    := coalesce(nullif(btrim(coalesce(p->>'paid_on', '')), '')::date, current_date);
  v_mode   text    := nullif(btrim(coalesce(p->>'mode', '')), '');
  v_ref    text    := nullif(btrim(coalesce(p->>'reference', '')), '');
  v_note   text    := nullif(btrim(coalesce(p->>'note', '')), '');
  v_net    numeric;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'awaiting_settlement' then
    raise exception 'This trip is %, not awaiting settlement', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('settlement', p_trip, v_uid) then
    raise exception 'You are not authorized to settle this claim';
  end if;

  v_net := round(coalesce(t.net_payable, 0), 2);

  if v_on > current_date then
    raise exception 'A settlement cannot be dated in the future.';
  end if;

  -- ---- nothing moves ----------------------------------------------------
  if v_net = 0 then
    update public.fms_travel_trips set
      status = 'closed', current_step = 'settlement',
      st_at = now(), st_by = v_uid,
      settled_amount = 0, settled_at = v_on,
      settled_mode = v_mode, settled_ref = v_ref,
      settled_note = coalesce(v_note, 'The claim and the advance cancelled each other out.')
    where id = p_trip;

    perform public.fms_travel_announce('trip', p_trip, 'trip_settled',
      coalesce(t.trip_no, 'A trip') || ' is settled and closed — the claim and the advance came to the same figure, so nothing moved',
      array_remove(array[t.raised_by, t.traveller_id], null),
      jsonb_build_object('net', 0));
    return 'closed';
  end if;

  /*
    ⚠ A PAYMENT AND A RECOVERY ARE TWO DIFFERENT EVENTS, and the RPC refuses to
      confuse them. They have different evidence behind them — a bank transfer
      reference versus a payroll deduction or a cash receipt — and a payment
      recorded as −4,390 is a row nobody can tie to a bank statement.
  */
  if v_amount is null then
    raise exception 'Record how much actually moved.';
  end if;
  if v_amount < 0 then
    raise exception 'Enter the amount as a positive figure. Whether it is a payment or a recovery is decided by the claim, not by a minus sign.';
  end if;

  if v_net > 0 then
    -- ---- paying the traveller -------------------------------------------
    if v_ref is null then
      raise exception 'A payment needs a reference — the UTR, cheque number or voucher it can be traced to.';
    end if;
    if v_amount <> v_net and v_note is null then
      raise exception 'This claim settles at %, and % is being recorded. Say why they differ.',
        to_char(v_net, 'FM999999999.00'), to_char(v_amount, 'FM999999999.00');
    end if;

    update public.fms_travel_trips set
      status = 'closed', current_step = 'settlement',
      st_at = now(), st_by = v_uid,
      settled_amount = v_amount, settled_at = v_on,
      settled_mode = v_mode, settled_ref = v_ref, settled_note = v_note
    where id = p_trip;

    perform public.fms_travel_announce('trip', p_trip, 'trip_settled',
      coalesce(t.trip_no, 'A trip') || ' is settled — ' ||
        to_char(v_amount, 'FM999999999.00') || ' paid on ' || to_char(v_on, 'DD-MM-YYYY'),
      array_remove(array[t.raised_by, t.traveller_id], null),
      jsonb_build_object('net', v_net, 'paid', v_amount, 'ref', v_ref));
    return 'closed';
  end if;

  -- ---- recovering from the traveller ------------------------------------
  /*
    ⚠ IT IS RECORDED AS A RECOVERY AGAINST THE ADVANCE, not as a negative
      payment, and `advance_recovered_amount` is what moves. That column is what
      §11.2 and the Employee Exit `travel_advance` clearance row read; leaving it
      untouched would settle the trip while the ledger still said the money was
      out, and the traveller would be refused their next advance for ever.

    ⚠ `settled_amount` IS STORED NEGATIVE. The sign is what lets one register
      answer "what did travel cost this month" without a second table.
  */
  if v_ref is null then
    raise exception 'A recovery needs a reference — the payroll deduction, the receipt or the voucher it can be traced to.';
  end if;
  if v_amount <> abs(v_net) and v_note is null then
    raise exception 'This trip has % to come back, and % is being recorded. Say why they differ.',
      to_char(abs(v_net), 'FM999999999.00'), to_char(v_amount, 'FM999999999.00');
  end if;

  update public.fms_travel_trips set
    status = 'closed', current_step = 'settlement',
    st_at = now(), st_by = v_uid,
    settled_amount = -v_amount, settled_at = v_on,
    settled_mode = v_mode, settled_ref = v_ref, settled_note = v_note,
    advance_recovered_amount = coalesce(advance_recovered_amount, 0) + v_amount,
    advance_recovered_at = now(),
    advance_recovered_ref = v_ref
  where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'trip_settled',
    coalesce(t.trip_no, 'A trip') || ' is settled — ' ||
      to_char(v_amount, 'FM999999999.00') || ' recovered from the traveller on ' ||
      to_char(v_on, 'DD-MM-YYYY') || ', because the advance was larger than the claim',
    array_remove(array[t.raised_by, t.traveller_id], null),
    jsonb_build_object('net', v_net, 'recovered', v_amount, 'ref', v_ref));

  return 'closed';
end $$;

comment on function public.fms_travel_settle(uuid, jsonb) is
  'Record what actually moved and close the trip. A payment and a recovery are two different events with two different kinds of evidence, so the RPC refuses to record one as the other; a recovery also credits advance_recovered_amount, which is what §11.2 and the Employee Exit clearance row read. Stops at Finance-marked Paid - nothing writes to Tally or payroll.';
grant execute on function public.fms_travel_settle(uuid, jsonb) to authenticated;

commit;
