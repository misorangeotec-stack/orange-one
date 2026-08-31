-- ===========================================================================
-- PHASE 8 — THE EXPENSE CLAIM.
--
-- The money engine (20261005121700) decides every figure. Nothing in this file
-- re-derives a cap, a rate or a DA day; it stores lines, hands them to
-- `fms_travel_check_claim`, and writes back what came out.
--
-- ⚠ THE ROW CARRIES EVERY INPUT THE ENGINE READ, not just the amount. Nights,
--   persons, kilometres, whether a receipt exists, whether §7.3 evidence and HOD
--   approval were produced — all of it. A claim line that stores only "4,200"
--   cannot be re-priced later, so the first correction to a rate card or a
--   return date would silently change the answer with no way to see why.
--
-- ⚠ `cap_applied`, `allowed_amount`, `disallow_reason` AND `engine_note` ARE
--   WRITTEN BY THE SERVER, NEVER BY THE BROWSER. `save_claim_draft` ignores them
--   if they are sent. They exist so Finance and audit can read what the engine
--   decided at the moment of submission without re-running it — which is the
--   same reason the rate card is frozen on the trip.
--
-- ⚠ SUBMIT RE-PRICES; THE PREVIEW NEVER DECIDES. The form calls
--   `fms_travel_preview_claim` as the traveller types, and submit calls the very
--   same `check_claim` again on the stored rows. Because it is one function, the
--   two cannot disagree — but the authority is the submit-time run.
-- ===========================================================================
begin;

create table if not exists public.fms_travel_claim_lines (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.fms_travel_trips on delete cascade,
  category_id  uuid references public.fms_travel_expense_categories on delete restrict,

  /** The hotel cap is per night PER CITY (§7.2), so a multi-city trip prices
      each night on the tier of the city it was spent in — not on the trip's
      headline destination. Null falls back to where the traveller was that day,
      which `fms_travel_city_on_day` reads off the legs. */
  city_id      uuid references public.fms_travel_cities on delete set null,
  spent_on     date,
  description  text,

  amount       numeric(12,2) not null default 0,
  gst_amount   numeric(12,2) not null default 0,
  vendor       text,
  gstin        text,
  invoice_no   text,

  -- ---- what the engine reads, stored so the line can be re-priced ---------
  has_receipt        boolean not null default false,
  self_declared      boolean not null default false,
  nights             integer,
  persons            integer,
  days               integer,
  km                 numeric(10,2),
  /** §7.3 — going above the hotel cap needs BOTH: evidence that nothing within
      cap was available, and HOD approval. Two flags, because producing one
      without the other is the common case and the engine must be able to say
      which is missing. */
  over_cap_evidence  boolean not null default false,
  hod_approved       boolean not null default false,
  /** §11.3 — a claim later than the hard stop needs written Director approval. */
  director_approved  boolean not null default false,
  /** ⚠ THESE NAMES MATCH THE ENGINE'S JSON KEYS EXACTLY, and that is the point.
      `fms_travel_check_claim` reads `guests`, `meal_kind`, `vehicle_type` and
      `full_day_rental`; a column called `guest_details` mapped to a key called
      `guests` is precisely the mismatch that broke §16 in 20261005121800, where
      a leg's `flight` was concatenated into a rate type the card calls `air`.
      One word, one meaning, both ends. */
  guests             text,
  meal_kind          text,
  vehicle_type       text,
  full_day_rental    boolean not null default false,

  doc_path     text,
  ai_extracted jsonb,

  -- ---- engine-written; see the header ------------------------------------
  cap_applied     numeric(12,2),
  allowed_amount  numeric(12,2),
  disallow_reason text,
  engine_note     text,
  priced_at       timestamptz,

  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users on delete set null,
  updated_at   timestamptz not null default now(),

  constraint fms_travel_claim_amounts_not_negative check (
    amount >= 0 and gst_amount >= 0),
  /** A tax component larger than the bill is a typing slip, and it would flow
      straight into the ITC register as a credit the company cannot claim. */
  constraint fms_travel_claim_gst_within_amount check (gst_amount <= amount),
  constraint fms_travel_claim_counts_positive check (
    (nights is null or nights >= 0) and (persons is null or persons >= 0)
    and (days is null or days >= 0) and (km is null or km >= 0))
);

comment on table public.fms_travel_claim_lines is
  'One expense line on a trip claim. Carries every input the money engine read - not just the amount - so the line can be re-priced and audited. cap_applied / allowed_amount / disallow_reason / engine_note are written by the server only.';
comment on column public.fms_travel_claim_lines.allowed_amount is
  'What the engine allowed at submit time. NEVER accepted from the browser.';
comment on column public.fms_travel_claim_lines.ai_extracted is
  'The extractor''s unedited reading, kept beside the human-typed fields as evidence of what the document actually said.';

create index if not exists fms_travel_claim_lines_trip_idx
  on public.fms_travel_claim_lines (trip_id, sort_order);
create index if not exists fms_travel_claim_lines_category_idx
  on public.fms_travel_claim_lines (category_id);

drop trigger if exists fms_travel_claim_lines_touch on public.fms_travel_claim_lines;
create trigger fms_travel_claim_lines_touch
  before update on public.fms_travel_claim_lines
  for each row execute function public.set_updated_at();

alter table public.fms_travel_claim_lines enable row level security;

/** Read-only to the browser, and only for a trip the reader can already see —
    the subquery runs under the reader's own RLS on fms_travel_trips.
    THERE IS NO WRITE POLICY. The RPCs below are the only door. */
drop policy if exists fms_travel_claim_lines_select on public.fms_travel_claim_lines;
create policy fms_travel_claim_lines_select
  on public.fms_travel_claim_lines for select to authenticated
  using (exists (select 1 from public.fms_travel_trips t
                  where t.id = fms_travel_claim_lines.trip_id));


-- ===========================================================================
-- THE ROUTER, EXTENDED THROUGH THE CLAIM.
--
-- 20261005121000 stopped at booking because phases 6-9 did not exist yet, and
-- left every trip past it sitting at `booked`. The claim, its review, Finance
-- and settlement are added here as further arms of THE SAME function, so submit,
-- both decisions, the claim decision and resume still cannot disagree about
-- where a trip goes next.
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
  v_needs_mgr := (not v_needs_dir) or v_mgr_also;

  if p_after in ('request', 'resume')
     and v_needs_mgr and not t.manager_approval_skipped and t.ma_at is null then
    return query select 'awaiting_manager_approval', 'manager_approval';
    return;
  end if;

  if p_after in ('request', 'resume', 'manager_approval')
     and v_needs_dir and not t.director_approval_skipped and t.da_at is null then
    return query select 'awaiting_director_approval', 'director_approval';
    return;
  end if;

  if p_after in ('request', 'resume', 'manager_approval', 'director_approval')
     and t.advance_requested and not t.advance_skipped and t.adv_at is null then
    return query select 'awaiting_advance', 'advance';
    return;
  end if;

  if p_after in ('request', 'resume', 'manager_approval', 'director_approval', 'advance')
     and t.bk_at is null then
    return query select 'awaiting_booking', 'booking';
    return;
  end if;

  -- ---- the claim half ----------------------------------------------------
  /* A claim that has not been filed leaves the trip at `booked`, sitting on the
     claim step. That is not a queue nobody owns: the TRAVELLER owns it, and
     fms_travel_can_act already grants them their own claim step. */
  if t.cl_at is null then
    return query select
      case when t.status = 'cancelled_pending_claim' then 'cancelled_pending_claim'
           else 'booked' end,
      'claim';
    return;
  end if;

  if t.cr_at is null or coalesce(t.cr_decision, '') <> 'approve' then
    return query select 'awaiting_claim_review', 'claim_review';
    return;
  end if;

  if t.fr_at is null then
    return query select 'awaiting_finance_review', 'finance_review';
    return;
  end if;

  if t.st_at is null then
    return query select 'awaiting_settlement', 'settlement';
    return;
  end if;

  return query select 'closed', 'settlement';
end $$;

comment on function public.fms_travel_next_stop(uuid, text) is
  'THE ONE ROUTER, now running the whole lifecycle. submit, every decision, the claim decision and resume all ask this, so no two of them can disagree about a step that was skipped - the root of all three defects 20260905120000 documents.';
grant execute on function public.fms_travel_next_stop(uuid, text) to authenticated;


-- ===========================================================================
-- WHAT ACTUALLY HAPPENED.
--
-- The DA is computed from the ACTUAL dates and times, and until the traveller
-- records them the engine is pricing a plan. `compute_da` falls back to the
-- planned dates so the entitlement panel can show an estimate before departure,
-- but a CLAIM priced on a guess is a claim nobody can defend, so submit insists
-- on the actual ones.
--
-- The four DA inputs that only the traveller knows live here too: whether the
-- customer provided meals or a room (§8.3), whether this was a company
-- conference (§13), and the dates family joined (§14.1).
-- ===========================================================================
create or replace function public.fms_travel_record_actual_travel(p_trip uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t     record;
  v_dep date := nullif(btrim(coalesce(p->>'actual_departure_date', '')), '')::date;
  v_ret date := nullif(btrim(coalesce(p->>'actual_return_date', '')), '')::date;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not public.fms_travel_can_act('claim', p_trip, v_uid) then
    raise exception 'You are not authorized to record this trip''s travel';
  end if;
  if t.status in ('draft', 'closed', 'cancelled', 'rejected') then
    raise exception 'A trip that is % cannot have its travel dates edited',
      replace(t.status, '_', ' ');
  end if;

  if v_dep is not null and v_ret is not null and v_ret < v_dep then
    raise exception 'The return is before the departure. Check the dates.';
  end if;

  update public.fms_travel_trips set
    actual_departure_date = coalesce(v_dep, actual_departure_date),
    actual_return_date    = coalesce(v_ret, actual_return_date),
    actual_departure_time = coalesce(nullif(btrim(coalesce(p->>'actual_departure_time', '')), '')::time,
                                     actual_departure_time),
    actual_return_time    = coalesce(nullif(btrim(coalesce(p->>'actual_return_time', '')), '')::time,
                                     actual_return_time),
    customer_provided     = case when p ? 'customer_provided'
                                 then nullif(btrim(coalesce(p->>'customer_provided', '')), '')
                                 else customer_provided end,
    is_company_conference = coalesce((p->>'is_company_conference')::boolean, is_company_conference),
    family_joined_from    = case when p ? 'family_joined_from'
                                 then nullif(btrim(coalesce(p->>'family_joined_from', '')), '')::date
                                 else family_joined_from end,
    family_joined_to      = case when p ? 'family_joined_to'
                                 then nullif(btrim(coalesce(p->>'family_joined_to', '')), '')::date
                                 else family_joined_to end,
    edited_at = now(), edited_by = v_uid
  where id = p_trip;
end $$;

comment on function public.fms_travel_record_actual_travel(uuid, jsonb) is
  'The traveller records what actually happened - dates, times, and the four DA inputs only they know (customer-hosted, conference, family dates). The claim cannot be submitted on planned dates.';
grant execute on function public.fms_travel_record_actual_travel(uuid, jsonb) to authenticated;


-- ===========================================================================
-- THE CLAIM LINES.
--
-- Replaced whole, like the passenger list: the form holds a small editable
-- table and sending a diff would mean the client deciding what changed, which
-- is how a deleted row survives. The line ids are preserved where the client
-- sends them back, so an uploaded receipt is not orphaned by a re-save.
-- ===========================================================================
create or replace function public.fms_travel_save_claim_draft(p_trip uuid, p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  ln     jsonb;
  v_id   uuid;
  v_keep uuid[] := '{}';
  v_n    int := 0;
  v_i    int := 0;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not public.fms_travel_can_act('claim', p_trip, v_uid) then
    raise exception 'You are not authorized to file this trip''s claim';
  end if;

  /* Open while the claim is the traveller's to make: after booking, and again
     after a reviewer sends it back. A submitted claim is the reviewer's until
     they return it — otherwise the figures under review could move while
     somebody is reading them. */
  if t.status not in ('booked', 'cancelled_pending_claim') then
    raise exception 'This trip is %, so its claim is not open for editing.',
      replace(t.status, '_', ' ');
  end if;

  for ln in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_id := nullif(btrim(coalesce(ln->>'id', '')), '')::uuid;

    if v_id is not null and not exists (
         select 1 from public.fms_travel_claim_lines
          where id = v_id and trip_id = p_trip) then
      raise exception 'That claim line does not belong to this trip';
    end if;

    if v_id is null then
      insert into public.fms_travel_claim_lines (trip_id, created_by) values (p_trip, v_uid)
      returning id into v_id;
    end if;

    update public.fms_travel_claim_lines set
      category_id       = nullif(btrim(coalesce(ln->>'category_id', '')), '')::uuid,
      city_id           = nullif(btrim(coalesce(ln->>'city_id', '')), '')::uuid,
      spent_on          = nullif(btrim(coalesce(ln->>'spent_on', '')), '')::date,
      description       = nullif(btrim(coalesce(ln->>'description', '')), ''),
      amount            = coalesce(nullif(btrim(coalesce(ln->>'amount', '')), '')::numeric, 0),
      gst_amount        = coalesce(nullif(btrim(coalesce(ln->>'gst_amount', '')), '')::numeric, 0),
      vendor            = nullif(btrim(coalesce(ln->>'vendor', '')), ''),
      gstin             = upper(nullif(btrim(coalesce(ln->>'gstin', '')), '')),
      invoice_no        = nullif(btrim(coalesce(ln->>'invoice_no', '')), ''),
      has_receipt       = coalesce((ln->>'has_receipt')::boolean, false),
      self_declared     = coalesce((ln->>'self_declared')::boolean, false),
      nights            = nullif(btrim(coalesce(ln->>'nights', '')), '')::int,
      persons           = nullif(btrim(coalesce(ln->>'persons', '')), '')::int,
      days              = nullif(btrim(coalesce(ln->>'days', '')), '')::int,
      km                = nullif(btrim(coalesce(ln->>'km', '')), '')::numeric,
      over_cap_evidence = coalesce((ln->>'over_cap_evidence')::boolean, false),
      hod_approved      = coalesce((ln->>'hod_approved')::boolean, false),
      director_approved = coalesce((ln->>'director_approved')::boolean, false),
      guests            = nullif(btrim(coalesce(ln->>'guests', '')), ''),
      meal_kind         = nullif(btrim(coalesce(ln->>'meal_kind', '')), ''),
      vehicle_type      = nullif(btrim(coalesce(ln->>'vehicle_type', '')), ''),
      full_day_rental   = coalesce((ln->>'full_day_rental')::boolean, false),
      doc_path          = nullif(btrim(coalesce(ln->>'doc_path', '')), ''),
      ai_extracted      = case when ln ? 'ai_extracted' then ln->'ai_extracted' else ai_extracted end,
      sort_order        = v_i * 10
      -- cap_applied / allowed_amount / disallow_reason / engine_note are NOT
      -- listed here on purpose. See the file header.
    where id = v_id;

    v_keep := v_keep || v_id;
    v_n := v_n + 1;
  end loop;

  delete from public.fms_travel_claim_lines
   where trip_id = p_trip and not (id = any(v_keep));

  return v_n;
end $$;

comment on function public.fms_travel_save_claim_draft(uuid, jsonb) is
  'Replace a trip''s claim lines whole. Ignores the engine-written columns however hard the caller tries - the allowed amount is the server''s answer, not the browser''s.';
grant execute on function public.fms_travel_save_claim_draft(uuid, jsonb) to authenticated;


-- ===========================================================================
-- PRICE AND FILE.
--
-- Reads the stored rows, hands them to the SAME `check_claim` the live preview
-- runs, writes back what came out, freezes the DA, rolls up the totals and asks
-- the router where the trip goes.
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
  v_da      numeric := 0;
  r         record;
begin
  -- Every stored input, in the shape the engine reads.
  select coalesce(jsonb_agg(jsonb_build_object(
           -- ⚠ THE KEY IS `id`. fms_travel_check_claim echoes `ln->>'id'` back
           --   as its `line_id` OUTPUT column, so sending `line_id` here would
           --   hand it an empty string and the write-back below would fail on
           --   ''::uuid. The phase 7 fixtures sent `line_id` and never noticed,
           --   because they only ever read the money columns.
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

  v_da := public.fms_travel_freeze_da(p_trip);

  update public.fms_travel_trips set
    claim_total      = round(v_claimed, 2),
    disallowed_total = round(v_claimed - v_allowed, 2),
    da_total         = round(v_da, 2),
    /* What the company owes: allowed lines plus DA, less what has already been
       advanced. NEGATIVE MEANS THE TRAVELLER OWES MONEY BACK, and it must stay
       negative rather than being floored at zero — that figure is the whole
       point of §11.2 and of the hr-exit `travel_advance` clearance row. */
    net_payable      = round(v_allowed + v_da - coalesce(advance_paid_amount, 0), 2)
  where id = p_trip;

  return jsonb_build_object(
    'claimed',    round(v_claimed, 2),
    'allowed',    round(v_allowed, 2),
    'disallowed', round(v_claimed - v_allowed, 2),
    'da',         round(v_da, 2));
end $$;

comment on function public.fms_travel_price_claim(uuid) is
  'Re-price a trip''s stored claim lines through the money engine and roll up the totals. Called at submit and again whenever Finance changes something. net_payable stays NEGATIVE when the traveller owes money back.';
grant execute on function public.fms_travel_price_claim(uuid) to authenticated;


create or replace function public.fms_travel_submit_claim(p_trip uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  t       record;
  v_n     int;
  v_sum   jsonb;
  v_next  record;
  v_to    uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not public.fms_travel_can_act('claim', p_trip, v_uid) then
    raise exception 'You are not authorized to file this trip''s claim';
  end if;
  if t.status not in ('booked', 'cancelled_pending_claim') then
    raise exception 'This trip is %, so there is no claim to file here.',
      replace(t.status, '_', ' ');
  end if;

  /* A claim priced on planned dates is a claim priced on a guess, and DA is the
     largest line on most trips. */
  if t.actual_departure_date is null or t.actual_return_date is null then
    raise exception 'Record when the travel actually happened first — the daily allowance is computed from the real dates, not the planned ones.';
  end if;

  select count(*) into v_n from public.fms_travel_claim_lines where trip_id = p_trip;
  if v_n = 0 then
    raise exception 'There are no expense lines. If there is nothing to claim, use Nothing to claim — it still settles the daily allowance and any advance.';
  end if;

  if exists (select 1 from public.fms_travel_claim_lines
              where trip_id = p_trip and category_id is null) then
    raise exception 'Every line needs an expense category — a line with none cannot be priced.';
  end if;

  v_sum := public.fms_travel_price_claim(p_trip);

  update public.fms_travel_trips
     set cl_at = now(), cl_by = v_uid,
         -- A resubmission after a return is a fresh claim, not the old one.
         cr_at = null, cr_by = null, cr_decision = null, cr_note = null,
         returned_at = null, returned_stage = null, returned_reason = null
   where id = p_trip;

  select * into v_next from public.fms_travel_next_stop(p_trip, 'claim');
  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  v_to := coalesce(t.approver_manager_ids, '{}')
          || public.fms_travel_step_owner_ids('claim_review');

  perform public.fms_travel_announce('trip', p_trip, 'claim_submitted',
    coalesce(t.trip_no, 'A trip') || ' — expense claim filed, ' ||
      to_char((v_sum->>'claimed')::numeric, 'FM999999999.00') || ' claimed, ' ||
      to_char((v_sum->>'allowed')::numeric, 'FM999999999.00') || ' allowed plus ' ||
      to_char((v_sum->>'da')::numeric, 'FM999999999.00') || ' daily allowance',
    v_to, v_sum || jsonb_build_object('lines', v_n));

  return v_next.next_status;
end $$;

comment on function public.fms_travel_submit_claim(uuid) is
  'File the claim. Re-prices every stored line through the money engine and freezes the DA, so the stored figures are the server''s answer at submit time - the live preview never decides.';
grant execute on function public.fms_travel_submit_claim(uuid) to authenticated;


-- ===========================================================================
-- NOTHING TO CLAIM.
--
-- ⚠ ROUTED BY THE MONEY, NOT BY THE REQUEST — the same reasoning as a cancelled
--   trip in 20261005121500. "I have no receipts" is not "the company owes
--   nothing": the daily allowance is an entitlement that needs no receipt at
--   all, and an advance already paid has to come back. Only when BOTH are zero
--   is there genuinely nothing left to do, and only then does this close the
--   trip outright.
-- ===========================================================================
create or replace function public.fms_travel_no_claim(p_trip uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_da   numeric;
  v_adv  numeric;
  v_next record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not public.fms_travel_can_act('claim', p_trip, v_uid) then
    raise exception 'You are not authorized to file this trip''s claim';
  end if;
  if t.status not in ('booked', 'cancelled_pending_claim') then
    raise exception 'This trip is %, so there is no claim to close here.',
      replace(t.status, '_', ' ');
  end if;
  if exists (select 1 from public.fms_travel_claim_lines where trip_id = p_trip) then
    raise exception 'There are expense lines on this claim. Remove them first, or submit the claim.';
  end if;

  -- The DA is still owed even with no receipts, so it is still computed.
  if t.actual_departure_date is not null then
    v_da := public.fms_travel_freeze_da(p_trip);
  else
    v_da := 0;
  end if;
  v_adv := coalesce(t.advance_paid_amount, 0) - coalesce(t.advance_recovered_amount, 0);

  update public.fms_travel_trips set
    claim_total = 0, disallowed_total = 0, da_total = round(coalesce(v_da, 0), 2),
    net_payable = round(coalesce(v_da, 0) - v_adv, 2),
    cl_at = now(), cl_by = v_uid,
    cr_at = null, cr_by = null, cr_decision = null, cr_note = null,
    returned_at = null, returned_stage = null, returned_reason = null
  where id = p_trip;

  if coalesce(v_da, 0) = 0 and v_adv = 0 then
    update public.fms_travel_trips set
      status = 'closed', current_step = 'settlement',
      cr_at = now(), cr_by = v_uid, cr_decision = 'approve',
      cr_note = coalesce(v_why, 'Nothing to claim.'),
      fr_at = now(), fr_by = v_uid,
      st_at = now(), st_by = v_uid, settled_amount = 0, settled_at = now()
    where id = p_trip;

    perform public.fms_travel_announce('trip', p_trip, 'trip_closed_no_claim',
      coalesce(t.trip_no, 'A trip') || ' closed — nothing to claim, no allowance due and no advance outstanding',
      array_remove(array[t.raised_by, t.traveller_id], null),
      jsonb_build_object('reason', v_why));
    return 'closed';
  end if;

  select * into v_next from public.fms_travel_next_stop(p_trip, 'claim');
  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'claim_submitted',
    coalesce(t.trip_no, 'A trip') || ' — no expenses claimed, but ' ||
      case when coalesce(v_da, 0) > 0 and v_adv > 0
             then to_char(v_da, 'FM999999999.00') || ' daily allowance is due and ' ||
                  to_char(v_adv, 'FM999999999.00') || ' of advance is outstanding'
           when coalesce(v_da, 0) > 0
             then to_char(v_da, 'FM999999999.00') || ' daily allowance is due'
           else to_char(v_adv, 'FM999999999.00') || ' of advance is outstanding' end,
    coalesce(t.approver_manager_ids, '{}') || public.fms_travel_step_owner_ids('claim_review'),
    jsonb_build_object('da', v_da, 'advance_outstanding', v_adv, 'reason', v_why));

  return v_next.next_status;
end $$;

comment on function public.fms_travel_no_claim(uuid, text) is
  'Close a trip with no expenses. Routed by the MONEY, not by the request - the daily allowance needs no receipt and an advance still has to come back, so this only closes the trip outright when both are zero.';
grant execute on function public.fms_travel_no_claim(uuid, text) to authenticated;


-- ===========================================================================
-- THE HOD'S DECISION ON THE CLAIM.
-- ===========================================================================
create or replace function public.fms_travel_decide_claim(
  p_trip     uuid,
  p_decision text,
  p_note     text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  t      record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next record;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approve', 'return') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select * into t from public.fms_travel_trips where id = p_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  if t.status <> 'awaiting_claim_review' then
    raise exception 'This trip is %, not awaiting claim review', replace(t.status, '_', ' ');
  end if;
  if not public.fms_travel_can_act('claim_review', p_trip, v_uid) then
    raise exception 'You are not authorized to decide this claim';
  end if;

  /* ⚠ NOBODY APPROVES THEIR OWN CLAIM, INCLUDING A COORDINATOR AND AN ADMIN —
     the same guard as the approval steps, and for a stronger reason: this one
     releases money to the person deciding. The test is on the TRAVELLER. */
  if t.traveller_id = v_uid then
    raise exception 'You cannot approve your own expense claim. It has to be decided by somebody else — your reporting manager, or whoever is named on this step in Settings.';
  end if;

  if p_decision = 'return' and v_note is null then
    raise exception 'Say what needs fixing. A claim sent back without a reason leaves its author nothing to act on.';
  end if;

  update public.fms_travel_trips
     set cr_at = now(), cr_by = v_uid, cr_decision = p_decision, cr_note = v_note
   where id = p_trip;

  if p_decision = 'return' then
    update public.fms_travel_trips set
      /* Back to the traveller. `cl_at` is CLEARED so the router reads the claim
         as not filed and puts the trip back on the claim step — the same state
         it was in before, which is the only state in which the lines are
         editable. `returned_stage` is what tells the screen this is a claim
         coming back rather than a claim never made. */
      cl_at = null, cl_by = null,
      returned_at = now(), returned_stage = 'claim_review', returned_reason = v_note
    where id = p_trip;

    select * into v_next from public.fms_travel_next_stop(p_trip, 'claim_review');
    update public.fms_travel_trips
       set status = v_next.next_status, current_step = v_next.next_step
     where id = p_trip;

    perform public.fms_travel_announce('trip', p_trip, 'claim_returned',
      coalesce(t.trip_no, 'A trip') || ' — the expense claim was sent back: ' || v_note,
      array_remove(array[t.raised_by, t.traveller_id], null),
      jsonb_build_object('reason', v_note));

    return v_next.next_status;
  end if;

  select * into v_next from public.fms_travel_next_stop(p_trip, 'claim_review');
  update public.fms_travel_trips
     set status = v_next.next_status, current_step = v_next.next_step
   where id = p_trip;

  perform public.fms_travel_announce('trip', p_trip, 'claim_approved',
    coalesce(t.trip_no, 'A trip') || ' — the expense claim was approved and is with Finance',
    array_remove(array[t.raised_by, t.traveller_id], null)
      || public.fms_travel_step_owner_ids('finance_review'),
    jsonb_build_object('claim_total', t.claim_total, 'note', v_note));

  return v_next.next_status;
end $$;

comment on function public.fms_travel_decide_claim(uuid, text, text) is
  'The reporting manager approves or returns the expense claim. A return CLEARS cl_at so the router puts the trip back on the claim step, which is the only state in which the lines are editable again.';
grant execute on function public.fms_travel_decide_claim(uuid, text, text) to authenticated;

commit;
