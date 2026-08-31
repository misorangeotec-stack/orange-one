-- ===========================================================================
-- Travel Desk FMS — THE MONEY ENGINE (Phase 7).
--
--   fms_travel_da_rules          — every threshold in §8/§13/§14 as CONFIG
--   fms_travel_city_on_day       — which city the traveller was in, per day
--   fms_travel_compute_da        — one row per calendar day, each with its reason
--   fms_travel_da_days           — the frozen result
--   fms_travel_freeze_da         — materialise it at claim time
--   fms_travel_check_claim       — every cap in §7, §9, §10, §11.3, §15
--   fms_travel_preview_claim     — what the form calls; the SAME code submit runs
--   fms_travel_class_excess      — §16, booked above entitlement
--
-- ⚠ THE HIGHEST-RISK PIECE IN THE MODULE, AND IT HAS EXACTLY ONE AUTHOR.
--   There is deliberately NO TypeScript copy of any rule below. OCPI enforces
--   its branch rules in both the form and SQL and accepts two copies that must
--   move together; money rules must not have two authors, because the day they
--   disagree they disagree about somebody's reimbursement. The form asks the
--   server for its preview and renders the answer.
--
-- ⚠ H2 — THE HALF-DA RULE IS IMPOSSIBLE AS WRITTEN, AND THIS IS THE READING.
--   §8.1: "If the employee departs after 2 PM and returns before 2 PM ON THE
--   SAME CALENDAR DAY, half DA is paid." Nothing can satisfy that: a departure
--   after 14:00 and a return before 14:00 cannot both fall on one day. It also
--   collides with the NO-DA rule immediately above it, which already covers a
--   same-day return.
--
--   The only reading that makes the sentence do work is a trip SPANNING TWO
--   calendar days — out after 14:00, back before 14:00 the next day, i.e. a
--   short overnight. That is what is implemented, and every number in it
--   (14:00, 18:00, the halves) is a CONFIG value in `da_rules`, so answering H2
--   the other way is a settings change and a recompute, never a migration.
--
--   ⚠ AND EVERY DAY STORES ITS OWN `factor` AND `factor_reason`. That is what
--     makes a later correction survivable: you can see which rule produced which
--     figure on which day, re-run the engine, and diff. A single roll-up number
--     would leave nothing to check the correction against.
--
-- ⚠ §13 GIVES 50%, NOT ZERO, AND THE SPECIFIC BEATS THE GENERAL. §8.1 says "DA
--   is not paid for travel days where all meals are arranged by the company";
--   §13's own row for a company-organised conference says "Employee receives 50%
--   DA only (since meals are covered)". The narrower rule wins, and the wider
--   sentence is served by the customer-hosted reduction instead.
--
-- ⚠ §14's FOURTH ROW IS NOT IN THE PROJECT CHECKLIST AND IS IMPLEMENTED ANYWAY:
--   "DA is discontinued after 90 days." A deputation that ran past 90 days would
--   otherwise have kept paying 50% for ever.
--
-- ⚠ §14.1's FAMILY EXEMPTION IS KEYED ON THE BAND NUMBER, NOT THE CATEGORY.
--   It says "applies from Band 1 to Band 7. TC-A (Band 8 & 9) employees are
--   exempted" — which is itself another sighting of the H1 contradiction, since
--   it puts band 8 in TC-A. Band numbers are stated unambiguously; the category
--   is not. Keying on the band means this rule does not wait on H1.
--
-- Additive: 1 table, 6 nullable trip columns, 1 leg column, 1 config key,
-- 7 functions. Reversal in reverse order at the foot of this comment block:
--   drop function if exists public.fms_travel_class_excess(uuid);
--   drop function if exists public.fms_travel_preview_claim(uuid, jsonb);
--   drop function if exists public.fms_travel_check_claim(uuid, jsonb);
--   drop function if exists public.fms_travel_freeze_da(uuid);
--   drop function if exists public.fms_travel_compute_da(uuid);
--   drop function if exists public.fms_travel_city_on_day(uuid, date);
--   drop function if exists public.fms_travel_da_rules();
--   drop table if exists public.fms_travel_da_days;
--   delete from public.fms_travel_config where key = 'da_rules';
--   alter table public.fms_travel_legs drop column if exists entitled_fare;
--   alter table public.fms_travel_trips
--     drop column if exists actual_departure_time, drop column if exists actual_return_time,
--     drop column if exists customer_provided, drop column if exists is_company_conference,
--     drop column if exists family_joined_from, drop column if exists family_joined_to;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- What the DA needs that the trip does not yet carry.
-- ---------------------------------------------------------------------------
alter table public.fms_travel_trips
  add column if not exists actual_departure_time time,
  add column if not exists actual_return_time    time,
  -- §8.3 — what the customer laid on.
  add column if not exists customer_provided text
    check (customer_provided is null
           or customer_provided in ('none', 'accommodation', 'meals', 'both')),
  -- §13 — a company-organised conference where meals are covered.
  add column if not exists is_company_conference boolean not null default false,
  -- §14.1 — the window the family was present.
  add column if not exists family_joined_from date,
  add column if not exists family_joined_to   date;

comment on column public.fms_travel_trips.customer_provided is
  '§8.3 - what the customer arranged. accommodation only leaves DA whole (meals are not covered); meals reduce it 50%; both reduce it 75%.';

alter table public.fms_travel_legs
  -- §16 — what the compliant option would have cost, so the excess can be named.
  add column if not exists entitled_fare numeric(14,2);

comment on column public.fms_travel_legs.entitled_fare is
  '§16 - what the band-entitled option would have cost. Only meaningful where the booked class exceeds the entitlement; the difference is the employee personal share. Null means nobody has established a comparable, and the engine says so rather than inventing one.';


-- ---------------------------------------------------------------------------
-- Every threshold, as config.
-- ---------------------------------------------------------------------------
insert into public.fms_travel_config (key, value)
values ('da_rules', jsonb_build_object(
  -- H2: the hour after which a departure makes the trip a "short overnight".
  'half_day_cutoff_hour',   14,
  -- §8.1: a return later than this makes the return day a FULL day.
  'full_return_hour',       18,
  'short_overnight_factor', 0.5,
  'partial_return_factor',  0.5,
  -- §8.3
  'hosted_meals_factor',    0.5,
  'hosted_both_factor',     0.25,
  -- §13
  'conference_factor',      0.5,
  -- §14
  'taper1_from_day',        8,  'taper1_factor', 0.75,
  'taper2_from_day',        31, 'taper2_factor', 0.5,
  'stop_after_day',         90,
  -- §14.1
  'family_min_days',        15, 'family_factor', 0.75, 'family_exempt_from_band', 8
))
on conflict (key) do nothing;

create or replace function public.fms_travel_da_rules()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.fms_travel_config where key = 'da_rules'),
    '{}'::jsonb);
$$;
grant execute on function public.fms_travel_da_rules() to authenticated;


-- ===========================================================================
-- WHERE WAS THE TRAVELLER ON THIS DAY?
--
-- ⚠ THE DAY'S OWN CITY, NOT THE TRIP'S HEADLINE DESTINATION. A trip that takes
--   in Mumbai (Tier 1) and Nashik (Tier 3) is priced at two different rates, and
--   pricing every day at the headline destination would over-pay half of it and
--   under-pay the other half.
--
-- The hotel is the best evidence of where somebody slept, so it wins. Failing
-- that, the last transport leg that had started by this day says where they had
-- travelled to. Failing that, the trip's declared destination.
-- ===========================================================================
create or replace function public.fms_travel_city_on_day(p_trip uuid, p_day date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.to_city_id from public.fms_travel_legs l
      where l.trip_id = p_trip and l.kind = 'hotel' and l.to_city_id is not null
        and l.start_on is not null and p_day >= l.start_on
        and (l.end_on is null or p_day < l.end_on)
      order by l.start_on desc limit 1),
    (select l.to_city_id from public.fms_travel_legs l
      where l.trip_id = p_trip and l.kind <> 'hotel' and l.to_city_id is not null
        and l.start_on is not null and l.start_on <= p_day
      order by l.start_on desc, l.sort_order desc limit 1),
    (select t.destination_city_id from public.fms_travel_trips t where t.id = p_trip));
$$;

comment on function public.fms_travel_city_on_day(uuid, date) is
  'Which city the traveller was in on this day - the hotel first (it is the best evidence of where somebody slept), then the last transport leg to have started, then the trip declared destination. A multi-city trip is priced day by day on its own tiers.';
grant execute on function public.fms_travel_city_on_day(uuid, date) to authenticated;


-- ===========================================================================
-- THE DAILY ALLOWANCE.
--
-- One row per calendar day, each carrying the rate it was priced at, the factor
-- applied and the SENTENCE explaining that factor. Nothing here writes; the
-- claim freezes the result separately.
-- ===========================================================================
create or replace function public.fms_travel_compute_da(p_trip uuid)
returns table (
  day           date,
  city_id       uuid,
  city_tier     smallint,
  da_rate       numeric,
  factor        numeric,
  factor_reason text,
  amount        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t          record;
  r          jsonb := public.fms_travel_da_rules();
  v_from     date;
  v_to       date;
  v_dep_t    time;
  v_ret_t    time;
  v_same_day boolean;
  v_short    boolean;
  v_cut      int  := coalesce((r->>'half_day_cutoff_hour')::int, 14);
  v_fullret  int  := coalesce((r->>'full_return_hour')::int, 18);
  v_band     int;
  d          date;
  v_n        int;
  v_city     uuid;
  v_tier     smallint;
  v_rate     numeric;
  v_f        numeric;
  v_why      text[];
begin
  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then return; end if;

  v_from  := coalesce(t.actual_departure_date, t.planned_departure_date);
  v_to    := coalesce(t.actual_return_date, t.planned_return_date, v_from);
  if v_from is null then return; end if;

  v_dep_t := t.actual_departure_time;
  v_ret_t := t.actual_return_time;
  v_band  := coalesce(t.snap_band_no, 0);

  -- §8.1 — a same-day round trip earns no DA at all.
  v_same_day := (v_to = v_from);

  /*
    H2 — the short overnight. See the file header: the only reading under which
    §8.1's half-DA sentence can ever be true is a trip spanning two calendar
    days. Both hours are config.
  */
  v_short := (v_to = v_from + 1)
             and v_dep_t is not null and v_ret_t is not null
             and extract(hour from v_dep_t) >= v_cut
             and extract(hour from v_ret_t) < v_cut;

  v_n := 0;
  d := v_from;
  while d <= v_to loop
    v_n := v_n + 1;
    v_why := array[]::text[];
    v_f := 1.0;

    v_city := public.fms_travel_city_on_day(p_trip, d);
    select c.tier into v_tier from public.fms_travel_cities c where c.id = v_city;

    select coalesce(rr.amount, 0) into v_rate
      from public.fms_travel_resolve_rate(t.snap_rate_card_id, 'da', t.snap_travel_category, v_tier, null) rr;
    v_rate := coalesce(v_rate, 0);

    -- ---- the shape of the trip -----------------------------------------
    if v_same_day then
      v_f := 0;
      v_why := array_append(v_why, 'No DA — the traveller returned to base the same day (§8.1).');
    elsif v_short then
      -- Half a day in total, carried entirely on the departure day so the two
      -- rows sum to the half the policy names.
      if d = v_from then
        v_f := coalesce((r->>'short_overnight_factor')::numeric, 0.5);
        v_why := array_append(v_why, format(
          'Half DA — departed after %s:00 and returned before %s:00 the next day (§8.1, as read; see H2).',
          v_cut, v_cut));
      else
        v_f := 0;
        v_why := array_append(v_why, 'Covered by the half day paid on the departure date (§8.1).');
      end if;
    elsif d = v_to and v_ret_t is not null and extract(hour from v_ret_t) < v_fullret then
      v_f := coalesce((r->>'partial_return_factor')::numeric, 0.5);
      v_why := array_append(v_why, format(
        'Half DA — the return day counts in full only when travel extends past %s:00 (§8.1).', v_fullret));
    else
      v_why := array_append(v_why, 'Full DA — a complete calendar day away from the base city (§8.1).');
    end if;

    -- ---- §14 long duration ---------------------------------------------
    if v_n > coalesce((r->>'stop_after_day')::int, 90) then
      v_f := 0;
      v_why := array_append(v_why, format('DA is discontinued beyond day %s of a deputation (§14).',
                               (r->>'stop_after_day')::int));
    elsif v_n >= coalesce((r->>'taper2_from_day')::int, 31) then
      v_f := v_f * coalesce((r->>'taper2_factor')::numeric, 0.5);
      v_why := array_append(v_why, format('Day %s — reduced to %s%% from day %s (§14).',
                               v_n, round(coalesce((r->>'taper2_factor')::numeric, 0.5) * 100),
                               (r->>'taper2_from_day')::int));
    elsif v_n >= coalesce((r->>'taper1_from_day')::int, 8) then
      v_f := v_f * coalesce((r->>'taper1_factor')::numeric, 0.75);
      v_why := array_append(v_why, format('Day %s — reduced to %s%% from day %s (§14).',
                               v_n, round(coalesce((r->>'taper1_factor')::numeric, 0.75) * 100),
                               (r->>'taper1_from_day')::int));
    end if;

    -- ---- §8.3 customer-hosted -------------------------------------------
    if t.customer_provided = 'meals' then
      v_f := v_f * coalesce((r->>'hosted_meals_factor')::numeric, 0.5);
      v_why := array_append(v_why, 'The customer provided all meals — DA reduced by 50% (§8.3).');
    elsif t.customer_provided = 'both' then
      v_f := v_f * coalesce((r->>'hosted_both_factor')::numeric, 0.25);
      v_why := array_append(v_why, 'The customer provided accommodation and all meals — DA reduced by 75% (§8.3).');
    elsif t.customer_provided = 'accommodation' then
      v_why := array_append(v_why, 'The customer provided accommodation only — DA is unchanged, since meals are not covered (§8.3).');
    end if;

    -- ---- §13 company conference -----------------------------------------
    if t.is_company_conference then
      v_f := v_f * coalesce((r->>'conference_factor')::numeric, 0.5);
      v_why := array_append(v_why, 'Company-organised conference — 50% DA, as meals are provided (§13).');
    end if;

    -- ---- §14.1 family joining -------------------------------------------
    if t.family_joined_from is not null
       and d >= t.family_joined_from
       and d <= coalesce(t.family_joined_to, v_to)
       and (coalesce(t.family_joined_to, v_to) - t.family_joined_from + 1)
             > coalesce((r->>'family_min_days')::int, 15)
       and v_band < coalesce((r->>'family_exempt_from_band')::int, 8)
    then
      v_f := v_f * coalesce((r->>'family_factor')::numeric, 0.75);
      v_why := array_append(v_why, 'The family was present for more than 15 consecutive days — DA reduced by 25% (§14.1).');
    end if;

    day           := d;
    city_id       := v_city;
    city_tier     := v_tier;
    da_rate       := v_rate;
    factor        := round(v_f, 4);
    factor_reason := array_to_string(v_why, ' ');
    amount        := round(v_rate * v_f, 2);
    return next;

    d := d + 1;
  end loop;
end $$;

comment on function public.fms_travel_compute_da(uuid) is
  'One row per calendar day of a trip, each priced on ITS OWN city tier and carrying the factor applied and the sentence explaining it. Pure - it writes nothing. H2 (the impossible half-DA rule) is read as a two-day short overnight and every threshold is config, so a correction is a recompute rather than a migration.';
grant execute on function public.fms_travel_compute_da(uuid) to authenticated;


-- ===========================================================================
-- THE FROZEN RESULT.
-- ===========================================================================
create table if not exists public.fms_travel_da_days (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.fms_travel_trips on delete cascade,
  day           date not null,
  city_id       uuid references public.fms_travel_cities on delete set null,
  city_tier     smallint,
  da_rate       numeric(14,2) not null default 0,
  factor        numeric(6,4)  not null default 1,
  /** ⚠ THE SENTENCE, NOT A CODE. A day showing 250 instead of 1,000 has to say
      why on its own row, or the first person to query it has to re-derive the
      whole engine to check one figure. */
  factor_reason text,
  amount        numeric(14,2) not null default 0,
  -- Finance may overrule a day, but never silently.
  override_amount numeric(14,2),
  override_reason text,
  override_by     uuid references auth.users on delete set null,
  override_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (trip_id, day),
  constraint fms_travel_da_override_needs_a_reason check (
    override_amount is null
    or nullif(btrim(coalesce(override_reason, '')), '') is not null)
);

comment on table public.fms_travel_da_days is
  'The daily allowance as computed and frozen at claim time - one row per calendar day with its rate, factor and the reason for that factor. Finance may override a day, and the CHECK makes it impossible to do so without saying why.';

create index if not exists fms_travel_da_days_trip_idx on public.fms_travel_da_days (trip_id);

alter table public.fms_travel_da_days enable row level security;

drop policy if exists fms_travel_da_days_select on public.fms_travel_da_days;
create policy fms_travel_da_days_select
  on public.fms_travel_da_days for select to authenticated
  using (exists (select 1 from public.fms_travel_trips t
                  where t.id = fms_travel_da_days.trip_id));

/**
 * Freeze the computed DA onto the trip.
 *
 * ⚠ IT REPLACES, AND IT KEEPS EVERY OVERRIDE. Recomputing after a correction to
 *   the return time must not silently discard Finance's decision on day 4 — that
 *   decision is a human judgement the engine cannot reproduce. The override and
 *   its reason are carried across; only the computed side is refreshed.
 */
create or replace function public.fms_travel_freeze_da(p_trip uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_total numeric;
begin
  create temp table if not exists _da_keep (
    day date primary key, override_amount numeric, override_reason text,
    override_by uuid, override_at timestamptz) on commit drop;
  delete from _da_keep;

  insert into _da_keep
  select d.day, d.override_amount, d.override_reason, d.override_by, d.override_at
    from public.fms_travel_da_days d
   where d.trip_id = p_trip and d.override_amount is not null;

  delete from public.fms_travel_da_days where trip_id = p_trip;

  insert into public.fms_travel_da_days
    (trip_id, day, city_id, city_tier, da_rate, factor, factor_reason, amount,
     override_amount, override_reason, override_by, override_at)
  select p_trip, c.day, c.city_id, c.city_tier, c.da_rate, c.factor, c.factor_reason, c.amount,
         k.override_amount, k.override_reason, k.override_by, k.override_at
    from public.fms_travel_compute_da(p_trip) c
    left join _da_keep k on k.day = c.day;

  select coalesce(sum(coalesce(override_amount, amount)), 0) into v_total
    from public.fms_travel_da_days where trip_id = p_trip;

  update public.fms_travel_trips set da_total = v_total where id = p_trip;
  return v_total;
end $$;

comment on function public.fms_travel_freeze_da(uuid) is
  'Recompute and store the DA for a trip, CARRYING FORWARD any Finance override - that is a human judgement the engine cannot reproduce, and a recompute must not silently discard it.';
grant execute on function public.fms_travel_freeze_da(uuid) to authenticated;

-- ===========================================================================
-- THE CLAIM CHECKER — every cap in §7, §9, §10, §11.3, §15 and §16.
--
-- ⚠ EVERY DISALLOWANCE CARRIES A SENTENCE, NEVER A CONSTRAINT NAME. A claim
--   line reduced from 4,200 to 1,750 has to say, on its own row, that the TC-C
--   hotel cap in a Tier 1 city is 1,750 a night and where that comes from —
--   otherwise the first thing the traveller does is ask, and the first thing
--   Finance does is re-derive the whole engine to answer.
--
-- ⚠ IT WRITES NOTHING. The same function serves the form's live preview and the
--   submit path, so the figure a traveller is shown while typing is by
--   construction the figure that gets stored. That is the whole reason there is
--   no TypeScript copy.
--
-- ⚠ EVERYTHING IS PRICED ON THE TRIP'S FROZEN `snap_rate_card_id`. A card
--   superseded between the journey and the claim must not re-price the journey.
-- ===========================================================================
create or replace function public.fms_travel_check_claim(p_trip uuid, p jsonb)
returns table (
  line_id         text,
  category_id     uuid,
  category_name   text,
  claimed         numeric,
  allowed         numeric,
  cap_applied     numeric,
  disallowed      numeric,
  disallow_reason text,
  note            text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t        record;
  pol      jsonb;
  ln       jsonb;
  cat      record;
  v_amt    numeric;
  v_allow  numeric;
  v_cap    numeric;
  v_reason text[];
  v_note   text[];
  v_tier   smallint;
  v_city   uuid;
  v_date   date;
  v_rate   numeric;
  v_txt    text;
  v_days   int;
  v_nights int;
  v_persons int;
  v_km     numeric;
  v_hard   numeric;
  v_stop   int;
  v_travel_end date;
begin
  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then raise exception 'Trip not found'; end if;

  select value into pol from public.fms_travel_config where key = 'policy';
  v_hard := coalesce((pol->>'hotel_cap_hard_multiple')::numeric, 1.5);
  v_stop := coalesce((pol->>'claim_hard_stop_days')::int, 30);
  v_travel_end := coalesce(t.actual_return_date, t.planned_return_date,
                           t.actual_departure_date, t.planned_departure_date);

  for ln in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    v_reason := array[]::text[];
    v_note   := array[]::text[];

    v_amt    := coalesce(nullif(btrim(coalesce(ln->>'amount', '')), '')::numeric, 0);
    v_city   := nullif(btrim(coalesce(ln->>'city_id', '')), '')::uuid;
    v_date   := nullif(btrim(coalesce(ln->>'date', '')), '')::date;
    v_days   := coalesce(nullif(btrim(coalesce(ln->>'days', '')), '')::int, 1);
    v_nights := coalesce(nullif(btrim(coalesce(ln->>'nights', '')), '')::int, 1);
    v_persons:= coalesce(nullif(btrim(coalesce(ln->>'persons', '')), '')::int, 1);
    v_km     := coalesce(nullif(btrim(coalesce(ln->>'km', '')), '')::numeric, 0);
    v_allow  := v_amt;
    v_cap    := null;

    select * into cat from public.fms_travel_expense_categories
     where id = nullif(btrim(coalesce(ln->>'category_id', '')), '')::uuid;

    -- The day's own city decides the tier, falling back to the trip's.
    if v_city is null and v_date is not null then
      v_city := public.fms_travel_city_on_day(p_trip, v_date);
    end if;
    select c.tier into v_tier from public.fms_travel_cities c where c.id = coalesce(v_city, t.destination_city_id);

    if cat.id is null then
      v_allow := 0;
      v_reason := array_append(v_reason, 'This line has no expense category, so nothing can price it.');
    else

      -- ---- §15 — the category itself refuses ---------------------------
      if not coalesce(cat.reimbursable, true) then
        v_allow := 0;
        v_reason := array_append(v_reason, coalesce(
          cat.refusal_note,
          format('%s is not reimbursable under any circumstances (§15).', cat.name)));

      else
        -- ---- §11.3 — older than the hard stop ---------------------------
        if v_travel_end is not null
           and current_date - v_travel_end > v_stop
           and not coalesce((ln->>'director_approved')::boolean, false) then
          v_allow := 0;
          v_reason := array_append(v_reason, format(
            'The travel ended %s days ago. §11.3 does not reimburse a claim more than %s days after the travel date without written Director approval.',
            current_date - v_travel_end, v_stop));
        else

          -- ---- the cap for this kind -----------------------------------
          if cat.kind = 'hotel' then
            select rr.amount into v_rate from public.fms_travel_resolve_rate(
              t.snap_rate_card_id, 'hotel_cap', t.snap_travel_category, v_tier, null) rr;
            if v_rate is not null then
              v_cap := round(v_rate * greatest(v_nights, 1), 2);
              if v_amt > v_cap then
                if coalesce((ln->>'over_cap_evidence')::boolean, false)
                   and coalesce((ln->>'hod_approved')::boolean, false) then
                  if v_amt > v_cap * v_hard then
                    v_allow := round(v_cap * v_hard, 2);
                    v_reason := array_append(v_reason, format(
                      '§7.3 allows an over-cap hotel with evidence and HOD approval, but in no case above %sx the cap — %s for %s night(s) at Tier %s. The rest needs written Director approval.',
                      v_hard, to_char(round(v_cap * v_hard, 2), 'FM999999999.00'), v_nights, v_tier));
                  else
                    v_note := array_append(v_note, format(
                      'Over the %s cap, allowed under §7.3 on the evidence of unavailability plus HOD approval.',
                      to_char(v_cap, 'FM999999999.00')));
                  end if;
                else
                  v_allow := v_cap;
                  v_reason := array_append(v_reason, format(
                    'The hotel cap for %s in a Tier %s city is %s a night, so %s for %s night(s) (§7.2). Going above it needs evidence that nothing within cap was available plus HOD approval (§7.3).',
                    t.snap_travel_category, v_tier,
                    to_char(v_rate, 'FM999999999.00'), to_char(v_cap, 'FM999999999.00'), v_nights));
                end if;
              end if;
            end if;

          elsif cat.kind = 'conveyance' then
            select rr.amount into v_rate from public.fms_travel_resolve_rate(
              t.snap_rate_card_id, 'conveyance_cap', t.snap_travel_category, v_tier, null) rr;
            if v_rate is not null then
              v_cap := round(v_rate * greatest(v_days, 1), 2);
              if v_amt > v_cap then
                v_allow := v_cap;
                v_reason := array_append(v_reason, format(
                  'Local conveyance is capped at %s a day for %s in a Tier %s city (§10), so %s for %s day(s).',
                  to_char(v_rate, 'FM999999999.00'), t.snap_travel_category, v_tier,
                  to_char(v_cap, 'FM999999999.00'), v_days));
              end if;
            else
              v_note := array_append(v_note, 'No daily conveyance cap applies at this category — actuals with a receipt (§10).');
            end if;

          elsif cat.kind = 'meal' then
            v_txt := coalesce(nullif(btrim(coalesce(ln->>'meal_kind', '')), ''), 'business');
            select rr.amount into v_rate from public.fms_travel_resolve_rate(
              t.snap_rate_card_id, 'meal_cap', t.snap_travel_category, null, v_txt) rr;
            if v_rate is not null then
              -- A team meal is capped PER PERSON PER MEAL (§9).
              v_cap := round(v_rate * (case when v_txt = 'team' then greatest(v_persons, 1) else 1 end), 2);
              if v_amt > v_cap then
                v_allow := v_cap;
                v_reason := array_append(v_reason, case
                  when v_txt = 'team' then format(
                    'A team meal is capped at %s per person per meal for %s (§9), so %s for %s people.',
                    to_char(v_rate, 'FM999999999.00'), t.snap_travel_category,
                    to_char(v_cap, 'FM999999999.00'), v_persons)
                  else format('%s meals are capped at %s for %s (§9).',
                    initcap(replace(v_txt, '_', ' ')), to_char(v_rate, 'FM999999999.00'),
                    t.snap_travel_category) end);
              end if;
            end if;
            if v_txt = 'business' and coalesce(nullif(btrim(coalesce(ln->>'guests', '')), ''), '') = '' then
              v_note := array_append(v_note, '§9.1 requires the guests and the purpose to be stated on a business meal.');
            end if;

          elsif cat.kind = 'mileage' then
            v_txt := coalesce(nullif(btrim(coalesce(ln->>'vehicle_type', '')), ''), 'four_wheeler');
            select rr.amount into v_rate from public.fms_travel_resolve_rate(
              t.snap_rate_card_id, 'mileage', t.snap_travel_category, null, v_txt) rr;
            if v_rate is null then
              v_allow := 0;
              v_reason := array_append(v_reason, format(
                'No per-km rate is set for a %s at %s (§6.3), so this cannot be priced.',
                replace(v_txt, '_', '-'), t.snap_travel_category));
            elsif v_km <= 0 then
              v_allow := 0;
              v_reason := array_append(v_reason,
                'Own-vehicle travel is paid per kilometre against a mileage log with start and end odometer readings (§6.3). No distance was given.');
            else
              v_cap := round(v_km * v_rate, 2);
              if v_amt > v_cap then
                v_allow := v_cap;
                v_reason := array_append(v_reason, format(
                  '%s km at %s per km is %s (§6.3).',
                  to_char(v_km, 'FM999999999.0'), to_char(v_rate, 'FM999999999.00'),
                  to_char(v_cap, 'FM999999999.00')));
              end if;
            end if;

          elsif cat.kind = 'transfer' and coalesce((ln->>'full_day_rental')::boolean, false) then
            select rr.amount into v_rate from public.fms_travel_resolve_rate(
              t.snap_rate_card_id, 'rental_cap', t.snap_travel_category, null, null) rr;
            if v_rate is not null then
              v_cap := round(v_rate * greatest(v_days, 1), 2);
              if v_amt > v_cap then
                v_allow := v_cap;
                v_reason := array_append(v_reason, format(
                  'A full-day vehicle hire including driver is capped at %s a day for %s (§10.1).',
                  to_char(v_rate, 'FM999999999.00'), t.snap_travel_category));
              end if;
            end if;
          end if;

          -- ---- §11.3 — the receipt ---------------------------------------
          --
          -- ⚠ APPLIED AFTER THE CAP, ON WHAT THE CAP ALLOWED. Testing the
          --   claimed figure would refuse a 4,200 hotel for want of a receipt
          --   covering 4,200 when only 1,750 was ever going to be paid.
          if not coalesce((ln->>'has_receipt')::boolean, false) then
            if cat.receipt_required_above is null then
              -- Null means ALWAYS required (air, train, hotel).
              if coalesce(cat.self_declaration_cap, 0) > 0 then
                if v_allow > cat.self_declaration_cap then
                  v_allow := cat.self_declaration_cap;
                  v_reason := array_append(v_reason, format(
                    'Without a receipt this is limited to the self-declaration cap of %s (§11.3).',
                    to_char(cat.self_declaration_cap, 'FM999999999.00')));
                end if;
              else
                v_allow := 0;
                v_reason := array_append(v_reason, format(
                  'An original receipt is mandatory for %s (§11.3).', cat.name));
              end if;
            elsif v_allow > cat.receipt_required_above then
              if coalesce(cat.self_declaration_cap, 0) > 0
                 and cat.self_declaration_cap >= cat.receipt_required_above then
                v_allow := cat.self_declaration_cap;
                v_reason := array_append(v_reason, format(
                  'Above %s a receipt is required; without one this is limited to the self-declaration cap of %s (§11.3).',
                  to_char(cat.receipt_required_above, 'FM999999999.00'),
                  to_char(cat.self_declaration_cap, 'FM999999999.00')));
              else
                v_allow := cat.receipt_required_above;
                v_reason := array_append(v_reason, format(
                  'Without a receipt this is limited to %s (§11.3).',
                  to_char(cat.receipt_required_above, 'FM999999999.00')));
              end if;
            end if;
          end if;

          if coalesce(cat.needs_guest_details, false)
             and coalesce(nullif(btrim(coalesce(ln->>'guests', '')), ''), '') = '' then
            v_note := array_append(v_note, 'The number of guests and the purpose have to be stated on this line (§9.1).');
          end if;
        end if;
      end if;
    end if;

    v_allow := greatest(round(coalesce(v_allow, 0), 2), 0);

    line_id         := coalesce(ln->>'id', '');
    category_id     := cat.id;
    category_name   := cat.name;
    claimed         := round(v_amt, 2);
    allowed         := v_allow;
    cap_applied     := v_cap;
    disallowed      := round(greatest(v_amt - v_allow, 0), 2);
    disallow_reason := nullif(array_to_string(v_reason, ' '), '');
    note            := nullif(array_to_string(v_note, ' '), '');
    return next;
  end loop;
end $$;

comment on function public.fms_travel_check_claim(uuid, jsonb) is
  'Price a set of proposed claim lines against the trip FROZEN rate card. Writes nothing, and is the same code the submit path runs - so the figure shown while typing is by construction the figure that gets stored. Every disallowance carries a sentence, never a constraint name.';
grant execute on function public.fms_travel_check_claim(uuid, jsonb) to authenticated;


-- ===========================================================================
-- §16 — BOOKED ABOVE BAND ENTITLEMENT.
--
-- "Reimbursement capped at applicable band entitlement. Employee bears the
-- difference personally."
--
-- ⚠ THE ENGINE CAPS AUTOMATICALLY ONCE SOMEBODY ESTABLISHES THE COMPARABLE, AND
--   SAYS SO PLAINLY WHEN NOBODY HAS. The rate card holds the entitled CLASS as
--   words — "Economy — Saver fare" — not as a price, so there is no figure to
--   cap against until a human records what the compliant option would have cost
--   (`fms_travel_legs.entitled_fare`). Inventing one would be inventing the size
--   of a deduction from somebody's salary.
-- ===========================================================================
create or replace function public.fms_travel_class_excess(p_trip uuid)
returns table (
  leg_id          uuid,
  kind            text,
  booked_class    text,
  entitled_class  text,
  net_cost        numeric,
  entitled_fare   numeric,
  personal_excess numeric,
  note            text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t   record;
  l   record;
  v_e text;
begin
  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then return; end if;

  for l in select * from public.fms_travel_legs where trip_id = p_trip order by sort_order loop
    v_e := null;
    if l.kind in ('flight', 'train') then
      select rr.text_value into v_e from public.fms_travel_resolve_rate(
        t.snap_rate_card_id, l.kind || '_entitlement', t.snap_travel_category, null, 'class') rr;
    elsif l.kind = 'cab' then
      select rr.text_value into v_e from public.fms_travel_resolve_rate(
        t.snap_rate_card_id, 'road_entitlement', t.snap_travel_category, null, 'mode') rr;
    end if;

    leg_id         := l.id;
    kind           := l.kind;
    booked_class   := l.travel_class;
    entitled_class := v_e;
    net_cost       := l.net_cost;
    entitled_fare  := l.entitled_fare;

    if l.entitled_fare is not null then
      personal_excess := round(greatest(l.net_cost - l.entitled_fare, 0), 2);
      note := case
        when l.net_cost > l.entitled_fare then format(
          '§16 — booked above the %s entitlement (%s). The company reimburses %s; the difference of %s is the employee''s own.',
          t.snap_travel_category, coalesce(v_e, 'band entitlement'),
          to_char(l.entitled_fare, 'FM999999999.00'),
          to_char(l.net_cost - l.entitled_fare, 'FM999999999.00'))
        else 'Within the band entitlement.' end;
    else
      personal_excess := 0;
      note := case
        when v_e is null then null
        else format('Entitlement at %s is %s. No comparable fare has been recorded, so no §16 excess can be calculated — record what the entitled option would have cost if this was booked above it.',
                    t.snap_travel_category, v_e) end;
    end if;
    return next;
  end loop;
end $$;

comment on function public.fms_travel_class_excess(uuid) is
  '§16 - what a leg booked above the band entitlement costs the employee. The rate card holds the entitled CLASS as words, not a price, so the excess is calculable only once somebody records what the compliant option would have cost. It says so rather than inventing the size of a salary deduction.';
grant execute on function public.fms_travel_class_excess(uuid) to authenticated;


-- ===========================================================================
-- WHAT THE FORM CALLS.
--
-- One round trip returning the lines, the daily allowance, the §16 excess and
-- the totals — so the claim screen renders a server-computed answer rather than
-- re-deriving anything.
-- ===========================================================================
create or replace function public.fms_travel_preview_claim(p_trip uuid, p jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lines   jsonb;
  v_da      jsonb;
  v_excess  jsonb;
  v_claimed numeric;
  v_allowed numeric;
  v_da_tot  numeric;
  v_pers    numeric;
  t         record;
begin
  select * into t from public.fms_travel_trips where id = p_trip;
  if t.id is null then raise exception 'Trip not found'; end if;
  if not public.fms_travel_can_see_trip(auth.uid(), t.raised_by, t.traveller_id, t.status, t.approver_manager_ids) then
    raise exception 'You are not authorized to see this trip';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb),
         coalesce(sum(c.claimed), 0), coalesce(sum(c.allowed), 0)
    into v_lines, v_claimed, v_allowed
    from public.fms_travel_check_claim(p_trip, p) c;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb), coalesce(sum(d.amount), 0)
    into v_da, v_da_tot
    from public.fms_travel_compute_da(p_trip) d;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb), coalesce(sum(x.personal_excess), 0)
    into v_excess, v_pers
    from public.fms_travel_class_excess(p_trip) x;

  return jsonb_build_object(
    'lines', v_lines,
    'da', v_da,
    'class_excess', v_excess,
    'totals', jsonb_build_object(
      'claimed',        round(v_claimed, 2),
      'allowed',        round(v_allowed, 2),
      'disallowed',     round(v_claimed - v_allowed, 2),
      'da',             round(v_da_tot, 2),
      'personal_excess', round(v_pers, 2),
      -- What the company would pay: the allowed lines plus DA, less what has
      -- already been advanced. Negative means the traveller owes money back.
      'advance_paid',   coalesce(t.advance_paid_amount, 0),
      'net_payable',    round(v_allowed + v_da_tot - coalesce(t.advance_paid_amount, 0), 2)),
    'rate_card', (select label from public.fms_travel_rate_cards where id = t.snap_rate_card_id),
    'travel_category', t.snap_travel_category);
end $$;

comment on function public.fms_travel_preview_claim(uuid, jsonb) is
  'The claim screen live preview: lines, daily allowance, §16 excess and totals in one call. The SAME code the submit path runs, which is why there is no TypeScript copy of any of it.';
grant execute on function public.fms_travel_preview_claim(uuid, jsonb) to authenticated;


commit;
