import type { Trip } from "../types";

/**
 * The advance rules, as the SCREENS read them.
 *
 * ⚠ THIS IS A MIRROR, NOT THE ENFORCEMENT, and the distinction is the whole
 *   reason the file is this short. `fms_travel_outstanding_advance` and
 *   `fms_travel_disburse_advance` are what actually refuse a second advance and
 *   a figure above the cap. What lives here exists so a traveller is told BEFORE
 *   they plan around money they will not get, and so Finance sees the ceiling
 *   while typing rather than after pressing Save.
 *
 *   Where the two ever disagree, the database is right. That is not a
 *   theoretical caveat: this reads the trips the CURRENT USER can see, and the
 *   trips policy hands an ordinary employee only their own — so for anyone but a
 *   coordinator or an admin this figure can be an UNDERSTATEMENT. It may
 *   therefore warn, and must never be used to conclude that an advance is
 *   allowed.
 */

/**
 * What this person still owes.
 *
 * ⚠ "OUTSTANDING" IS ABOUT THE MONEY, NOT THE TRIP'S STATUS. A cancelled trip
 *   that drew ₹12,000 still owes ₹12,000 — no claim is coming to net it against.
 *   A settled trip owes nothing however recently it closed. Mirrors the SQL
 *   exactly: paid, less anything recovered, while the settlement step has not
 *   stamped.
 */
export function outstandingAdvanceFor(
  trips: Trip[],
  userId: string | null,
  excludeTripId: string | null = null,
): number {
  if (!userId) return 0;
  return trips
    .filter(
      (t) =>
        t.travellerId === userId &&
        t.id !== excludeTripId &&
        (t.advancePaidAmount ?? 0) > 0 &&
        t.stAt === null,
    )
    .reduce(
      (sum, t) => sum + Math.max((t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0), 0),
      0,
    );
}

/** §11.1 — the most that may be advanced on this trip. Null without an estimate. */
export function advanceCeiling(trip: Trip, maxPct: number): number | null {
  if (trip.estimatedCost === null || trip.estimatedCost === undefined) return null;
  return Math.round(((trip.estimatedCost * maxPct) / 100) * 100) / 100;
}

/** Every trip carrying money the company has not got back yet. */
export const tripsWithOutstandingAdvance = (trips: Trip[]): Trip[] =>
  trips.filter((t) => (t.advancePaidAmount ?? 0) > 0 && t.stAt === null &&
    (t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0) > 0);

/** What one trip still owes, after any recovery. */
export const stillOwed = (t: Trip): number =>
  Math.max((t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0), 0);
