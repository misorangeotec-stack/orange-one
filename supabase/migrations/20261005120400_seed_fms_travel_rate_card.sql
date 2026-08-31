-- ===========================================================================
-- Travel Desk FMS — SEED THE FIRST RATE CARD (Phase 2).
--
-- Every figure below is QUOTED from OOT_Domestic_Travel_Policy_V1.0_Final.docx,
-- with the section it came from in the row's `notes`. Nothing here is invented.
--
-- ⚠ THE CARD INSTALLS AS A **DRAFT**, AND MUST. Annexure C of the policy says:
--   "No rate or amount in this policy is final until the Directors sign off on
--   this table. HR Head to schedule a 60-minute rate-confirmation meeting with
--   both Directors before publishing." Roughly thirty figures carry a
--   "[⚠ CONFIRM]" flag.
--
--   A draft card PRICES EVERYTHING — the module is completely usable — but its
--   caps only ADVISE. A claim over cap is flagged, not refused. That is what
--   lets the build finish while the Directors are still deciding, without ever
--   pretending a proposal is a rule.
--
-- ── THREE ROWS ARE SEEDED `disputed` ────────────────────────────────────────
-- Not "uncertain" — CONTRADICTORY. In each case the source policy gives two
-- different answers in two different places, and no reading of the document
-- settles it. fms_travel_confirm_rate_card() refuses to sign off a card while
-- any disputed row remains, so these cannot be quietly inherited.
--
--   band 3 → TC-C     §2 table 2 + §4.1, §5.1, §6.2, §6.3, §7.2, §8.2, §10 say
--                     TC-C. §2 table 1 + Annexure A say TC-D. 17 employees —
--                     the largest band, and the field staff who travel most.
--   band 8 → TC-B     §2 table 2 and the rate tables say TC-B. §2 table 1,
--                     Annexure A and §14.1 say TC-A. 6 employees.
--   TC-D air minimum  §2 table 2 says "> 4 hours". §4.1 says "> 16 hrs AND a
--                     Tier 1 destination". Annexure A says "> 16 hr" for bands
--                     2-3 and "> 18hr" for band 1. Three different thresholds.
--
-- The value seeded in each case is the MAJORITY reading — the one the rate
-- tables themselves use, since those are what the figures are actually indexed
-- by. It is a provisional default, not a decision, and the row says so.
--
-- ── TWO PLACES WHERE THE POLICY IS INCOMPLETE RATHER THAN CONTRADICTORY ──────
-- Noted on the rows, but NOT marked disputed, because signing the card off is
-- itself the act of resolving them:
--
--   HOTEL CAPS ARE RANGES, not figures ("propose ₹3000 to ₹5000/night"), and
--   §7.2 gives Tier 1 and Tier 2 the SAME range in every row. The midpoint is
--   seeded and the range is recorded in `notes`.
--
--   DAILY ALLOWANCE HAS NO CITY DIMENSION. §8 is titled "Band-wise & City-wise"
--   and Annexure A's column header reads "DA (Tier 1/day)", but §8.2's table has
--   no city column — and proposes the SAME ₹1,000 for all four categories,
--   which also contradicts §2's own "Highest / High / Mid / Base" ladder. Seeded
--   with a NULL city_tier (one rate for every tier), which is what §8.2 as
--   written actually says.
--
-- Additive and idempotent — seeds only if no card exists. Reversal:
--   delete from public.fms_travel_rate_cards where label like 'Policy V1.0%';
--   (rates cascade)
-- ===========================================================================

begin;

do $seed$
declare
  v_card uuid;
begin
  -- Idempotent: never seed a second card over a live one.
  if exists (select 1 from public.fms_travel_rate_cards) then
    return;
  end if;

  insert into public.fms_travel_rate_cards (label, effective_from, status, notes)
  values (
    'Policy V1.0 — proposed figures (awaiting Director sign-off)',
    date '2026-04-01',
    'draft',
    'Seeded verbatim from OOT_Domestic_Travel_Policy_V1.0_Final.docx. Roughly thirty amounts carry a [CONFIRM] flag; Annexure C requires both Directors to sign off before any of them is final. Three rows are marked disputed because the document gives two different answers - this card cannot be confirmed until they are resolved.'
  )
  returning id into v_card;

  -- ===================================================== band -> category ==
  -- §2. THE MAJORITY READING (the one the rate tables index by). Bands 3 and 8
  -- are disputed; see the header.
  insert into public.fms_travel_rates (rate_card_id, rate_type, key, text_value, disputed, notes, sort_order) values
    (v_card, 'band_category', '1', 'TC-D', false, 'Support Staff. §2 - both tables agree.', 10),
    (v_card, 'band_category', '2', 'TC-D', false, 'Administrative Support. §2 - both tables agree.', 20),
    (v_card, 'band_category', '3', 'TC-C', true,
     'DISPUTED. §2 table 2 and every rate table (§4.1, §5.1, §6.2, §6.3, §7.2, §8.2, §10) place band 3 in TC-C. §2 table 1 and Annexure A place it in TC-D. 17 employees sit in this band - the largest, and the field staff who travel most. Seeded as TC-C (the majority reading). MUST BE DECIDED BEFORE SIGN-OFF.', 30),
    (v_card, 'band_category', '4', 'TC-C', false, 'Senior Executive Level. §2 - both tables agree.', 40),
    (v_card, 'band_category', '5', 'TC-C', false, 'Team Lead / Supervisor. §2 - both tables agree.', 50),
    (v_card, 'band_category', '6', 'TC-B', false, 'Management. §2 - both tables agree.', 60),
    (v_card, 'band_category', '7', 'TC-B', false, 'Senior Management. §2 - both tables agree.', 70),
    (v_card, 'band_category', '8', 'TC-B', true,
     'DISPUTED. §2 table 2 and the rate tables place band 8 in TC-B. §2 table 1, Annexure A and §14.1 place it in TC-A. 6 employees. Seeded as TC-B (the majority reading). MUST BE DECIDED BEFORE SIGN-OFF.', 80),
    (v_card, 'band_category', '9', 'TC-A', false, 'Top Leadership. §2 - both tables agree.', 90);

  -- ========================================================== hotel caps ==
  -- §7.2, per night including GST. Proposals are RANGES; the midpoint is seeded
  -- and the range recorded. Tier 1 and Tier 2 carry the same proposal in every
  -- row of the source table.
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, city_tier, amount, notes, sort_order) values
    (v_card, 'hotel_cap', 'TC-A', 1, 4000, '§7.2 proposes a range of 3,000-5,000/night for Tier 1. Midpoint seeded.', 110),
    (v_card, 'hotel_cap', 'TC-A', 2, 4000, '§7.2 gives Tier 2 the same 3,000-5,000 range as Tier 1. Midpoint seeded.', 111),
    (v_card, 'hotel_cap', 'TC-A', 3, 2500, '§7.2 proposes 2,500/night for Tier 3.', 112),
    (v_card, 'hotel_cap', 'TC-B', 1, 2500, '§7.2 proposes a range of 2,000-3,000/night. Midpoint seeded.', 120),
    (v_card, 'hotel_cap', 'TC-B', 2, 2500, '§7.2 gives Tier 2 the same range as Tier 1. Midpoint seeded.', 121),
    (v_card, 'hotel_cap', 'TC-B', 3, 2000, '§7.2 proposes 2,000/night for Tier 3.', 122),
    (v_card, 'hotel_cap', 'TC-C', 1, 1750, '§7.2 proposes a range of 1,500-2,000/night. Midpoint seeded.', 130),
    (v_card, 'hotel_cap', 'TC-C', 2, 1750, '§7.2 gives Tier 2 the same range as Tier 1. Midpoint seeded.', 131),
    (v_card, 'hotel_cap', 'TC-C', 3, 1500, '§7.2 proposes 1,500/night for Tier 3.', 132),
    (v_card, 'hotel_cap', 'TC-D', 1, 1500, '§7.2 proposes a range of 1,000-2,000/night. Midpoint seeded.', 140),
    (v_card, 'hotel_cap', 'TC-D', 2, 1500, '§7.2 gives Tier 2 the same range as Tier 1. Midpoint seeded.', 141),
    (v_card, 'hotel_cap', 'TC-D', 3, 1000, '§7.2 proposes 1,000/night for Tier 3.', 142);

  -- ==================================================== daily allowance ==
  -- §8.2, per day. NO city tier - see the header.
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, amount, notes, sort_order) values
    (v_card, 'da', 'TC-A', 1000, '§8.2 proposes 1,000/day. The section is titled "City-wise" but its table has no city column, and all four categories are proposed at the same figure - which contradicts §2 own Highest/High/Mid/Base ladder. Seeded as written.', 210),
    (v_card, 'da', 'TC-B', 1000, '§8.2 proposes 1,000/day. Same figure as every other category - see the TC-A note.', 220),
    (v_card, 'da', 'TC-C', 1000, '§8.2 proposes 1,000/day. Same figure as every other category - see the TC-A note.', 230),
    (v_card, 'da', 'TC-D', 1000, '§8.2 proposes 1,000/day. Same figure as every other category - see the TC-A note.', 240);

  -- ================================================= local conveyance ==
  -- §10, daily cap at the destination. TC-A is deliberately UNCAPPED: the row
  -- exists with a null amount, which resolve_rate distinguishes from "no row".
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, city_tier, amount, notes, sort_order) values
    (v_card, 'conveyance_cap', 'TC-A', null, null, '§10 proposes NO CAP for TC-A - actuals with a receipt. A null amount here means uncapped, not unconfigured.', 310),
    (v_card, 'conveyance_cap', 'TC-B', 1, 1500, '§10 proposes 1,500/day for Tier 1.', 320),
    (v_card, 'conveyance_cap', 'TC-B', 2, 1000, '§10 proposes 1,000/day for Tier 2 and Tier 3.', 321),
    (v_card, 'conveyance_cap', 'TC-B', 3, 1000, '§10 proposes 1,000/day for Tier 2 and Tier 3.', 322),
    (v_card, 'conveyance_cap', 'TC-C', 1, 800,  '§10 proposes 800/day for Tier 1.', 330),
    (v_card, 'conveyance_cap', 'TC-C', 2, 500,  '§10 proposes 500/day for Tier 2 and Tier 3.', 331),
    (v_card, 'conveyance_cap', 'TC-C', 3, 500,  '§10 proposes 500/day for Tier 2 and Tier 3.', 332),
    (v_card, 'conveyance_cap', 'TC-D', 1, 400,  '§10 proposes 400/day for Tier 1.', 340),
    (v_card, 'conveyance_cap', 'TC-D', 2, 250,  '§10 proposes 250/day for Tier 2 and Tier 3.', 341),
    (v_card, 'conveyance_cap', 'TC-D', 3, 250,  '§10 proposes 250/day for Tier 2 and Tier 3.', 342);

  -- Self-declaration without a receipt, per trip. §10 gives one only to TC-C and
  -- TC-D; the other two are actuals-with-receipt, so they have no row.
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, amount, notes, sort_order) values
    (v_card, 'conveyance_self_dec', 'TC-C', 'per_trip', 200, '§10 - up to 200 per trip without a receipt.', 350),
    (v_card, 'conveyance_self_dec', 'TC-D', 'per_trip', 100, '§10 - up to 100 per trip without a receipt.', 360);

  -- ======================================================== own vehicle ==
  -- §6.3, per kilometre. TC-A and TC-B have no two-wheeler rate: the policy says
  -- "N/A (company vehicle or cab preferred)".
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, amount, notes, sort_order) values
    (v_card, 'mileage', 'TC-A', 'four_wheeler', 14, '§6.3 proposes 14/km for bands 6-9.', 410),
    (v_card, 'mileage', 'TC-B', 'four_wheeler', 14, '§6.3 proposes 14/km for bands 6-9.', 420),
    (v_card, 'mileage', 'TC-C', 'four_wheeler', 12, '§6.3 proposes 12/km. HOD approval required.', 430),
    (v_card, 'mileage', 'TC-C', 'two_wheeler',   6, '§6.3 proposes 6/km. HOD approval required.', 431),
    (v_card, 'mileage', 'TC-D', 'four_wheeler', 10, '§6.3 proposes 10/km. HOD approval required.', 440),
    (v_card, 'mileage', 'TC-D', 'two_wheeler',   5, '§6.3 proposes 5/km. HOD approval required.', 441);

  -- ============================================================= meals ==
  -- §9. Business and team meals vary by category; refreshments and the
  -- late-night meal are the same for everyone, so they are ONE row each with a
  -- null category.
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, amount, notes, sort_order) values
    (v_card, 'meal_cap', 'TC-A', 'business', 3000, '§9 - business meal with customers, pre-approved by HOD above this. Guest names required on the claim.', 510),
    (v_card, 'meal_cap', 'TC-B', 'business', 3000, '§9 - business meal with customers.', 511),
    (v_card, 'meal_cap', 'TC-C', 'business', 2000, '§9 - business meal with customers.', 512),
    (v_card, 'meal_cap', 'TC-D', 'business', 2000, '§9 - business meal with customers.', 513),
    (v_card, 'meal_cap', 'TC-A', 'team',      500, '§9 - team meal, per person per meal, no external guests.', 520),
    (v_card, 'meal_cap', 'TC-B', 'team',      500, '§9 - team meal, per person per meal.', 521),
    (v_card, 'meal_cap', 'TC-C', 'team',      300, '§9 - team meal, per person per meal.', 522),
    (v_card, 'meal_cap', 'TC-D', 'team',      300, '§9 - team meal, per person per meal.', 523);

  insert into public.fms_travel_rates (rate_card_id, rate_type, key, amount, notes, sort_order) values
    (v_card, 'meal_cap', 'refreshment', 200, '§9 - refreshments while waiting at an airport or station. Self-declaration up to this; above it, a receipt. Same for all bands.', 530),
    (v_card, 'meal_cap', 'late_night',  300, '§9 - late-night meal when required to work past 10 PM at the destination. No receipt needed. Same for all bands.', 540);

  -- ====================================================== rental vehicle ==
  -- §10.1, full day including driver. Pre-approved by HOD.
  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, amount, notes, sort_order) values
    (v_card, 'rental_cap', 'TC-A', 5000, '§10.1 proposes 4,000-6,000/day for an AC sedan in Tier 1, proportionally less elsewhere. Midpoint seeded.', 610),
    (v_card, 'rental_cap', 'TC-B', 3000, '§10.1 proposes 3,000/day.', 620),
    (v_card, 'rental_cap', 'TC-C', 2000, '§10.1 proposes 2,000/day.', 630),
    (v_card, 'rental_cap', 'TC-D', 1500, '§10.1 proposes 1,500/day.', 640);

  -- ========================================================= air travel ==
  -- §4.1. The general rules first (no category - they apply to everyone).
  insert into public.fms_travel_rates (rate_card_id, rate_type, key, amount, text_value, notes, sort_order) values
    (v_card, 'air_entitlement', 'min_distance_km',   500, null, '§4.1 - air travel is permitted only when the destination is more than 500 km from the base city, OR the train journey exceeds 8 hours.', 710),
    (v_card, 'air_entitlement', 'min_train_hours',     8, null, '§4.1 - the alternative test to the 500 km rule.', 711),
    (v_card, 'air_entitlement', 'advance_booking_days', 7, null, '§4.1 - tickets must be booked at least 7 days ahead. A later booking needs HOD/Director approval with a documented reason.', 712);

  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, text_value, notes, sort_order) values
    (v_card, 'air_entitlement', 'TC-A', 'class',        'Economy — Business permitted', '§4.1 - class of travel is Economy, but the upgrade rule permits Business and reimburses it. §2 table 2 says bare "Economy"; §4.1 and Annexure A are fuller and are used here.', 720),
    (v_card, 'air_entitlement', 'TC-A', 'booking_type', 'Flexi / refundable', '§4.1.', 721),
    (v_card, 'air_entitlement', 'TC-A', 'upgrade',      'Business class permitted; the upgrade is reimbursed', '§4.1.', 722),
    (v_card, 'air_entitlement', 'TC-B', 'class',        'Economy', '§4.1.', 730),
    (v_card, 'air_entitlement', 'TC-B', 'booking_type', 'Flexi / refundable preferred', '§4.1.', 731),
    (v_card, 'air_entitlement', 'TC-B', 'upgrade',      'May upgrade to Business at personal expense; the difference is not reimbursed', '§4.1.', 732),
    (v_card, 'air_entitlement', 'TC-C', 'class',        'Economy — Saver fare', '§4.1.', 740),
    (v_card, 'air_entitlement', 'TC-C', 'booking_type', 'Saver / lowest available at booking time', '§4.1.', 741),
    (v_card, 'air_entitlement', 'TC-C', 'upgrade',      'No upgrade — Economy only', '§4.1.', 742),
    (v_card, 'air_entitlement', 'TC-D', 'class',        'Economy — Saver fare', '§4.1.', 750),
    (v_card, 'air_entitlement', 'TC-D', 'booking_type', 'Saver / lowest available', '§4.1.', 751),
    (v_card, 'air_entitlement', 'TC-D', 'upgrade',      'No upgrade — Economy only', '§4.1.', 752);

  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, amount, disputed, notes, sort_order) values
    (v_card, 'air_entitlement', 'TC-D', 'min_journey_hours', 16, true,
     'DISPUTED. §2 table 2 says TC-D may fly only if the journey exceeds 4 HOURS. §4.1 says more than 16 HOURS and a Tier 1 destination. Annexure A says more than 16 hr for bands 2-3 and more than 18 hr for band 1. Three different thresholds for the same rule. Seeded as 16 (§4.1, the section that actually defines air entitlements). MUST BE DECIDED BEFORE SIGN-OFF.', 753);

  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, text_value, notes, sort_order) values
    (v_card, 'air_entitlement', 'TC-D', 'destination_restriction', 'Tier 1 cities only', '§4.1 - TC-D air travel is limited to Tier 1 destinations. See the disputed min_journey_hours row.', 754);

  -- ======================================================= train travel ==
  -- §5.1.
  insert into public.fms_travel_rates (rate_card_id, rate_type, key, amount, notes, sort_order) values
    (v_card, 'train_entitlement', 'preferred_min_km',  150,  '§5.1 - train is the preferred mode between 150 km and 1,200 km.', 810),
    (v_card, 'train_entitlement', 'preferred_max_km', 1200,  '§5.1 - train is the preferred mode between 150 km and 1,200 km.', 811);

  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, text_value, notes, sort_order) values
    (v_card, 'train_entitlement', 'TC-A', 'class',     'AC First Class (1A) / AC 2-tier (2A)', '§5.1.', 820),
    (v_card, 'train_entitlement', 'TC-A', 'overnight', 'AC First Class sleeper', '§5.1.', 821),
    (v_card, 'train_entitlement', 'TC-A', 'tatkal',    'Yes — fully reimbursed', '§5.1.', 822),
    (v_card, 'train_entitlement', 'TC-B', 'class',     'AC 3-tier (3A) or AC 2-tier (2A)', '§5.1. §2 table 2 says AC 2-tier only; §5.1 allows either and is used here.', 830),
    (v_card, 'train_entitlement', 'TC-B', 'overnight', 'AC 2-tier sleeper', '§5.1.', 831),
    (v_card, 'train_entitlement', 'TC-B', 'tatkal',    'Yes — reimbursed with HOD approval', '§5.1.', 832),
    (v_card, 'train_entitlement', 'TC-C', 'class',     'AC 3-tier (3A)', '§5.1.', 840),
    (v_card, 'train_entitlement', 'TC-C', 'overnight', 'AC 3-tier sleeper', '§5.1.', 841),
    (v_card, 'train_entitlement', 'TC-C', 'tatkal',    'Yes — reimbursed with HOD approval', '§5.1.', 842),
    (v_card, 'train_entitlement', 'TC-D', 'class',     'AC 3-tier (3A) / Sleeper Class (SL)', '§5.1.', 850),
    (v_card, 'train_entitlement', 'TC-D', 'overnight', 'Sleeper Class', '§5.1.', 851),
    (v_card, 'train_entitlement', 'TC-D', 'tatkal',    'Field roles with a Service Engineer designation only — HOD approval required', '§5.1.', 852);

  -- ======================================================== road travel ==
  -- §6.2 and §6.4.
  insert into public.fms_travel_rates (rate_card_id, rate_type, key, amount, notes, sort_order) values
    (v_card, 'road_entitlement', 'own_vehicle_max_km', 200, '§6.4 - personal vehicle may not be used beyond 200 km without explicit Director approval. Beyond 200 km also needs HOD + HR Head approval before travel.', 910);

  insert into public.fms_travel_rates (rate_card_id, rate_type, travel_category, key, text_value, notes, sort_order) values
    (v_card, 'road_entitlement', 'TC-A', 'mode', 'AC Sedan or higher (Ola Prime, Uber Premier)', '§6.2 - actuals with a receipt or ride screenshot.', 920),
    (v_card, 'road_entitlement', 'TC-B', 'mode', 'AC Sedan (Ola, Uber Go or equivalent)', '§6.2 - actuals with a receipt.', 930),
    (v_card, 'road_entitlement', 'TC-C', 'mode', 'Standard cab or metered auto-rickshaw', '§6.2.', 940),
    (v_card, 'road_entitlement', 'TC-D', 'mode', 'Auto-rickshaw / local bus / metro', '§6.2.', 950);
end $seed$;


-- ===========================================================================
-- WHAT STANDS BETWEEN THIS CARD AND SIGN-OFF.
--
-- Extracted from fms_travel_confirm_rate_card so it is answerable WITHOUT
-- attempting the sign-off itself. Two consumers need that:
--
--   • the Rate Cards screen, which must say "3 things to resolve before this can
--     be signed off" rather than making an admin discover it by clicking
--     Confirm and reading an error;
--   • the assertion below, which cannot call confirm() at all — inside a
--     migration auth.uid() is NULL, so confirm() would refuse on the
--     "not signed in" arm and never reach the dispute check it is meant to
--     prove.
-- ===========================================================================
create or replace function public.fms_travel_rate_card_blockers(p_card uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.fms_travel_rates
   where rate_card_id = p_card and disputed
$$;

comment on function public.fms_travel_rate_card_blockers(uuid) is
  'How many disputed figures still stand between this card and sign-off. Zero means fms_travel_confirm_rate_card will accept it.';
grant execute on function public.fms_travel_rate_card_blockers(uuid) to authenticated;


-- ===========================================================================
-- ASSERTIONS — the seed landed, and landed UNCONFIRMED with the dispute intact.
-- ===========================================================================
do $mig$
declare
  v_card     uuid;
  v_rows     int;
  v_disputed int;
  v_status   text;
begin
  select id, status into v_card, v_status
    from public.fms_travel_rate_cards order by created_at limit 1;

  if v_card is null then
    raise exception 'Travel Desk: no rate card was seeded';
  end if;

  if v_status <> 'draft' then
    raise exception 'Travel Desk: the seeded rate card must be a DRAFT until the Directors sign it off, but it is %', v_status;
  end if;

  select count(*) into v_rows from public.fms_travel_rates where rate_card_id = v_card;
  if v_rows < 80 then
    raise exception 'Travel Desk: expected the full policy on the card, found only % rows', v_rows;
  end if;

  select count(*) into v_disputed
    from public.fms_travel_rates where rate_card_id = v_card and disputed;
  if v_disputed <> 3 then
    raise exception 'Travel Desk: expected exactly 3 disputed rows (band 3, band 8, TC-D air threshold), found %', v_disputed;
  end if;

  -- The card must be UNSIGNABLE while the contradiction stands. This is the
  -- whole mechanism, so it is proved here rather than assumed — through the
  -- blockers helper, because confirm() itself would refuse on "not signed in"
  -- inside a migration and never reach the check being proved.
  if public.fms_travel_rate_card_blockers(v_card) <> 3 then
    raise exception
      'Travel Desk: the seeded card must report 3 blockers, so it cannot be signed off while the policy still contradicts itself. It reports %.',
      public.fms_travel_rate_card_blockers(v_card);
  end if;

  -- The lookup resolves through all four specificity levels.
  if (select text_value from public.fms_travel_resolve_rate(v_card, 'band_category', null, null, '3')) <> 'TC-C' then
    raise exception 'Travel Desk: band 3 did not resolve to its seeded category';
  end if;
  if (select amount from public.fms_travel_resolve_rate(v_card, 'hotel_cap', 'TC-C', 1::smallint)) <> 1750 then
    raise exception 'Travel Desk: the TC-C Tier 1 hotel cap did not resolve';
  end if;
  -- A category-varying figure with no tier dimension.
  if (select amount from public.fms_travel_resolve_rate(v_card, 'da', 'TC-B', 3::smallint)) <> 1000 then
    raise exception 'Travel Desk: the DA rate must resolve for any tier, since §8.2 has no city dimension';
  end if;
  -- A row that exists and deliberately holds no number.
  if not (select has_row from public.fms_travel_resolve_rate(v_card, 'conveyance_cap', 'TC-A', 1::smallint)) then
    raise exception 'Travel Desk: TC-A conveyance must resolve as an UNCAPPED row, not as a miss';
  end if;
  if (select amount from public.fms_travel_resolve_rate(v_card, 'conveyance_cap', 'TC-A', 1::smallint)) is not null then
    raise exception 'Travel Desk: TC-A conveyance is uncapped in §10 and must carry a null amount';
  end if;
end $mig$;

commit;
