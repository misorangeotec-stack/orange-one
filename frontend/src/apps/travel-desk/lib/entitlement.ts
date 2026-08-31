import type { TravelRate, TravelCategory, CityTier, RateType } from "../types";

/**
 * What the policy allows THIS traveller, read off THIS rate card.
 *
 * ⚠ THIS IS A READ-OUT, NOT AN ENFORCER, AND THE DISTINCTION IS THE WHOLE POINT
 *   OF THE FILE. Nothing here decides what may be paid. It answers "what does
 *   the policy say you are entitled to" so the request form can show it BEFORE
 *   anything is booked — which is the difference between a traveller knowing
 *   their hotel cap in advance and finding out when Finance disallows the
 *   excess six weeks later.
 *
 *   The money rules — caps applied, excess disallowed, DA computed — live in
 *   SQL and ONLY in SQL (phase 7). A cap that is enforced in two languages is a
 *   cap with two authors, and on a reimbursement the two will eventually
 *   disagree about somebody's money. So this file may READ a cap to display it;
 *   it may never APPLY one.
 *
 * ⚠ MIRRORS fms_travel_resolve_rate's WALK, and must keep mirroring it. The
 *   lookup is most-specific-first: a row naming a travel category beats one that
 *   does not, then a row naming a tier, then a row naming a key. That is what
 *   lets §10 say "TC-B is 1,500 in Tier 1 and 1,000 everywhere else" as three
 *   rows instead of twelve, and what lets "no cap for TC-A" be a row with a NULL
 *   amount rather than a missing row.
 */

/** One figure off the card. A row with a NULL `amount` is a DELIBERATE no-cap. */
export interface ResolvedRate {
  amount: number | null;
  textValue: string | null;
  /** The source policy gives two different answers for this figure. */
  disputed: boolean;
  notes: string | null;
}

export interface RateQuery {
  tc?: TravelCategory | null;
  tier?: CityTier | null;
  key?: string | null;
}

/**
 * A resolver bound to one card.
 *
 * Returns `null` when NOTHING is configured — which is different from a row
 * whose amount is null. "Nobody has set this" and "the policy deliberately sets
 * no limit" must not render the same way, and on the Rate Cards screen they
 * already do not.
 */
export type RateResolver = (type: RateType, q?: RateQuery) => ResolvedRate | null;

export function makeRateResolver(rates: TravelRate[], cardId: string | null): RateResolver {
  return (type, q) => {
    const tc = q?.tc ?? null;
    const tier = q?.tier ?? null;
    const key = q?.key ?? null;
    if (!cardId) return null;

    const candidates = rates.filter(
      (r) =>
        r.rateCardId === cardId &&
        r.rateType === type &&
        (r.travelCategory === tc || r.travelCategory === null) &&
        (r.cityTier === tier || r.cityTier === null) &&
        (r.key === key || r.key === null),
    );
    if (!candidates.length) return null;

    // Most specific first — the same three-key ordering the SQL uses.
    const score = (r: TravelRate) =>
      (r.travelCategory !== null ? 4 : 0) + (r.cityTier !== null ? 2 : 0) + (r.key !== null ? 1 : 0);
    const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));

    return {
      amount: best.amount,
      textValue: best.textValue,
      disputed: best.disputed,
      notes: best.notes,
    };
  };
}

/**
 * Which travel category a band falls into ON THIS CARD.
 *
 * ⚠ BANDS 3 AND 8 ARE DISPUTED IN THE SOURCE POLICY — §2's two tables disagree
 *   one row apart, and 23 of 59 live employees sit in those two bands. The
 *   answer therefore comes from the card, never from a constant here, and the
 *   `disputed` flag rides along so the form can say so out loud rather than
 *   quoting a figure that may be wrong by ₹1,500 a night.
 */
export function categoryForBand(
  resolve: RateResolver,
  bandNo: number | null,
): { category: TravelCategory | null; disputed: boolean; note: string | null } {
  if (bandNo === null || bandNo === undefined) return { category: null, disputed: false, note: null };
  const row = resolve("band_category", { key: String(bandNo) });
  if (!row) return { category: null, disputed: false, note: null };
  return {
    category: (row.textValue as TravelCategory | null) ?? null,
    disputed: row.disputed,
    note: row.notes,
  };
}

/**
 * §3.2 — bands 1 to 5 need their reporting manager; 6 to 9 also need a Director.
 *
 * ⚠ ROUTED ON THE BAND NUMBER, NOT ON THE TRAVEL CATEGORY. §3.2 is unambiguous
 *   about this even though the band-to-category mapping is still disputed, so
 *   the approval chain does not depend on that answer being settled. Mirrored in
 *   SQL by fms_travel_submit_trip's `v_skip_dir := v_band_no <= 5`.
 */
export const needsDirectorApproval = (bandNo: number | null): boolean =>
  bandNo !== null && bandNo !== undefined && bandNo >= 6;

export interface Entitlement {
  category: TravelCategory | null;
  categoryDisputed: boolean;
  categoryNote: string | null;

  /** Per night including GST, for the destination's tier (§7.2). */
  hotelCap: ResolvedRate | null;
  /** Per calendar day away from the base city (§8). */
  da: ResolvedRate | null;
  /** Per day at the destination (§10). A null amount means uncapped. */
  conveyanceCap: ResolvedRate | null;
  /** Per trip, without a receipt (§10). Only TC-C and TC-D have one. */
  conveyanceSelfDec: ResolvedRate | null;
  /** Full-day vehicle hire including driver (§10.1). */
  rentalCap: ResolvedRate | null;

  air: {
    travelClass: ResolvedRate | null;
    bookingType: ResolvedRate | null;
    upgrade: ResolvedRate | null;
    /** §4.1 — flying is permitted beyond this distance… */
    minDistanceKm: ResolvedRate | null;
    /** …or when the train would take longer than this. */
    minTrainHours: ResolvedRate | null;
    advanceBookingDays: ResolvedRate | null;
    /** TC-D only: where it may fly at all, and the disputed hours threshold. */
    destinationRestriction: ResolvedRate | null;
    minJourneyHours: ResolvedRate | null;
  };
  train: {
    travelClass: ResolvedRate | null;
    overnight: ResolvedRate | null;
    tatkal: ResolvedRate | null;
    preferredMinKm: ResolvedRate | null;
    preferredMaxKm: ResolvedRate | null;
  };
  road: {
    mode: ResolvedRate | null;
    ownVehicleMaxKm: ResolvedRate | null;
  };
  mileage: { fourWheeler: ResolvedRate | null; twoWheeler: ResolvedRate | null };
  meals: {
    business: ResolvedRate | null;
    team: ResolvedRate | null;
    refreshment: ResolvedRate | null;
    lateNight: ResolvedRate | null;
  };

  /** True when ANY figure shown carries the §2 contradiction. */
  anyDisputed: boolean;
}

/**
 * Everything the request form shows beside the fields.
 *
 * `tier` is the DESTINATION's tier, not the base city's: the hotel cap and the
 * conveyance cap are properties of where you are staying, and a Surat-based
 * engineer in Mumbai is on Mumbai's Tier 1 figures. Pass null before a
 * destination is chosen — the tier-free figures still resolve, so the form is
 * useful from the first keystroke.
 */
export function resolveEntitlement(
  rates: TravelRate[],
  cardId: string | null,
  bandNo: number | null,
  tier: CityTier | null,
): Entitlement {
  const resolve = makeRateResolver(rates, cardId);
  const { category, disputed, note } = categoryForBand(resolve, bandNo);
  const tc = category;

  const e: Entitlement = {
    category,
    categoryDisputed: disputed,
    categoryNote: note,

    hotelCap: resolve("hotel_cap", { tc, tier }),
    da: resolve("da", { tc }),
    conveyanceCap: resolve("conveyance_cap", { tc, tier }),
    conveyanceSelfDec: resolve("conveyance_self_dec", { tc, key: "per_trip" }),
    rentalCap: resolve("rental_cap", { tc }),

    air: {
      travelClass: resolve("air_entitlement", { tc, key: "class" }),
      bookingType: resolve("air_entitlement", { tc, key: "booking_type" }),
      upgrade: resolve("air_entitlement", { tc, key: "upgrade" }),
      minDistanceKm: resolve("air_entitlement", { key: "min_distance_km" }),
      minTrainHours: resolve("air_entitlement", { key: "min_train_hours" }),
      advanceBookingDays: resolve("air_entitlement", { key: "advance_booking_days" }),
      destinationRestriction: resolve("air_entitlement", { tc, key: "destination_restriction" }),
      minJourneyHours: resolve("air_entitlement", { tc, key: "min_journey_hours" }),
    },
    train: {
      travelClass: resolve("train_entitlement", { tc, key: "class" }),
      overnight: resolve("train_entitlement", { tc, key: "overnight" }),
      tatkal: resolve("train_entitlement", { tc, key: "tatkal" }),
      preferredMinKm: resolve("train_entitlement", { key: "preferred_min_km" }),
      preferredMaxKm: resolve("train_entitlement", { key: "preferred_max_km" }),
    },
    road: {
      mode: resolve("road_entitlement", { tc, key: "mode" }),
      ownVehicleMaxKm: resolve("road_entitlement", { key: "own_vehicle_max_km" }),
    },
    mileage: {
      fourWheeler: resolve("mileage", { tc, key: "four_wheeler" }),
      twoWheeler: resolve("mileage", { tc, key: "two_wheeler" }),
    },
    meals: {
      business: resolve("meal_cap", { tc, key: "business" }),
      team: resolve("meal_cap", { tc, key: "team" }),
      refreshment: resolve("meal_cap", { key: "refreshment" }),
      lateNight: resolve("meal_cap", { key: "late_night" }),
    },

    anyDisputed: false,
  };

  /**
   * Walk everything we just resolved and report whether ANY of it is disputed.
   *
   * Done by inspection rather than by listing the fields again: a figure added
   * to the shape above and forgotten here would be a disputed cap displayed as
   * settled, which is the one failure this flag exists to prevent.
   */
  const seen: ResolvedRate[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if ("disputed" in (v as Record<string, unknown>)) {
      seen.push(v as ResolvedRate);
      return;
    }
    for (const child of Object.values(v as Record<string, unknown>)) walk(child);
  };
  walk({ ...e, category: null, categoryNote: null });
  e.anyDisputed = disputed || seen.some((r) => r.disputed);

  return e;
}

/**
 * §4.1's own test, stated rather than applied.
 *
 * The form shows this so a traveller asking for a flight to a city 180 km away
 * learns why it will be questioned — at request time, not at claim time. It
 * deliberately returns a SENTENCE and no verdict: distances between cities are
 * not in this portal, so the module cannot know the answer and must not pretend
 * to. Phase 6 asks the booker for the distance when it matters.
 */
export function airRuleSentence(e: Entitlement): string | null {
  const km = e.air.minDistanceKm?.amount;
  const hrs = e.air.minTrainHours?.amount;
  if (km === null || km === undefined) return null;
  const base = `Air travel is for destinations beyond ${km} km${
    hrs ? `, or where the train would take more than ${hrs} hours` : ""
  }.`;
  const restriction = e.air.destinationRestriction?.textValue;
  return restriction ? `${base} At your category: ${restriction.toLowerCase()}.` : base;
}
