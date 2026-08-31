import type { TripStatus, TravelCategory, CityTier, LegKind } from "../types";

/**
 * How Travel Desk values are worded and shaped on screen.
 *
 * One place, because the same status appears on the dashboard, three lists,
 * eight queues and the register export — and "Awaiting approval" in one and
 * "Pending approval" in another reads as two different states to somebody
 * scanning a column.
 */

/**
 * Money, in rupees, as a FULL FIGURE.
 *
 * ⚠ DO NOT REUSE receivables' `fmtINRMoney`. That one renders lakhs and crores
 *   (₹80,000 becomes "₹0.80 L"), which is right for an outstanding-ledger
 *   headline and wrong here twice over. First, travel amounts are ₹4,850 and
 *   ₹300 — abbreviating them destroys the figure. Second, the Domestic Travel
 *   Policy says so in as many words on its own cover page: "All monetary amounts
 *   in this policy are in Indian Rupees (INR) and are shown as full figures
 *   without Lakh/Crore abbreviation."
 *
 * ⚠ NULL RENDERS AS AN EM DASH, NOT AS ZERO. On a settlement that is a real
 *   distinction: "—" says nobody has worked this out yet; "₹0" says they worked
 *   it out and the answer was nothing. Same reasoning as hr-exit's F&F money().
 *
 * There is deliberately no currency argument. Policy §11.3: "Expenses in foreign
 * currency are NOT covered under this policy." A trip is priced in rupees or it
 * is not this module's business.
 */
export const money = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Days, as the policy counts them. `2.5` stays `2.5`; `2.00` reads as `2`. */
export const days = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `${Number(n)} day${Number(n) === 1 ? "" : "s"}`;

export const STATUS_LABEL: Record<TripStatus, string> = {
  draft: "Draft",
  awaiting_manager_approval: "Awaiting manager approval",
  awaiting_director_approval: "Awaiting Director approval",
  returned: "Sent back for clarification",
  rejected: "Rejected",
  awaiting_advance: "Awaiting travel advance",
  awaiting_booking: "Awaiting booking",
  booked: "Booked — claim due after return",
  cancellation_requested: "Cancellation requested",
  cancelled_pending_claim: "Cancelled — charges to settle",
  awaiting_claim_review: "Claim awaiting approval",
  awaiting_finance_review: "Claim with Finance",
  awaiting_settlement: "Awaiting payment",
  closed: "Settled",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/**
 * The tone each status carries in a pill.
 *
 * `booked` is deliberately NEUTRAL rather than positive: the trip is arranged,
 * but the claim is still to come and the advance is still outstanding. Colouring
 * it green would tell a coordinator the row is finished when it is halfway.
 */
export const STATUS_TONE: Record<TripStatus, "neutral" | "amber" | "green" | "red" | "muted"> = {
  draft: "muted",
  awaiting_manager_approval: "amber",
  awaiting_director_approval: "amber",
  returned: "red",
  rejected: "red",
  awaiting_advance: "amber",
  awaiting_booking: "amber",
  booked: "neutral",
  cancellation_requested: "amber",
  // ⚠ AMBER, NOT MUTED. The journey is off, but somebody still owes a claim and
  //   the company may still be owed an advance. Greying it out would file it
  //   with the finished trips, which is exactly how the money gets forgotten.
  cancelled_pending_claim: "amber",
  awaiting_claim_review: "amber",
  awaiting_finance_review: "amber",
  awaiting_settlement: "amber",
  closed: "green",
  on_hold: "muted",
  cancelled: "muted",
};

export const CATEGORY_LABEL: Record<TravelCategory, string> = {
  "TC-A": "TC-A · Executive",
  "TC-B": "TC-B · Senior Management",
  "TC-C": "TC-C · Management",
  "TC-D": "TC-D · Executive Staff",
};

export const TIER_LABEL: Record<CityTier, string> = {
  1: "Tier 1 · Metro",
  2: "Tier 2 · State capital / industrial",
  3: "Tier 3 · Other",
};

export const LEG_LABEL: Record<LegKind, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  cab: "Cab",
  hotel: "Hotel",
};

/**
 * The trip reference, or a readable stand-in.
 *
 * A draft has no number — numbers are minted on submit so an abandoned draft
 * cannot burn one — so it is shown by whose trip it is. Printing an empty cell
 * would make a draft list look broken.
 */
export const tripRef = (tripNo: string | null, travellerName: string): string =>
  tripNo ?? `Draft · ${travellerName}`;
