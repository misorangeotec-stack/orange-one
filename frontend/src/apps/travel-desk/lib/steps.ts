import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The 9 canonical Travel Desk steps (code-defined, 1-based display index).
 * `key` is the stable identifier used by fms_travel_step_owners, the SLA config
 * and the queue logic.
 *
 * ONE SCOPE — a trip is one entity from the request to the settled claim, so
 * there is no cross-scope anchor walk (Recruitment needs one; this does not).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS CHAIN AND NOT THE ONE IN THE PRD
 *
 * The source PRD describes a BOOKING DESK — request, approve, book, share the
 * ticket, maybe cancel — and stops there. The Domestic Travel Policy describes
 * the other half: the entitlement that decides what may be booked, the advance
 * drawn before departure, the expense claim afterwards, and the settlement that
 * nets one against the other. Neither document mentions the other. This chain is
 * both halves, because they are one journey and one row.
 *
 * THREE STEPS THE PRD DOES NOT HAVE, and why each is a step rather than a field:
 *
 *   director_approval — Policy §3.2 sends bands 6-9 to a Director, not to their
 *                       HOD. Folding that into one approval step would either
 *                       spam the Directors with every field engineer's day trip
 *                       or quietly let a GM self-approve a Mumbai week.
 *   advance           — §11.1 gives it its own approver (Finance), its own
 *                       deadline (2 working days) and its own failure mode (the
 *                       money not arriving before departure). A field on the
 *                       trip owes nobody; a step owes Finance.
 *   finance_review    — §11.1 step 8 is a different person doing a different job
 *                       from the HOD in step 7: the HOD says "yes they went and
 *                       yes that is roughly right", Finance says "and here is
 *                       what policy actually allows". Merging them is how a cap
 *                       check becomes nobody's job.
 *
 * ONE STEP THE PRD HAS AND THIS DOES NOT:
 *
 *   ticket_shared     — the PRD lists `Booked` and `Ticket Shared` as separate
 *                       statuses, but uploading the ticket IS sharing it: the
 *                       upload is what notifies the traveller and what puts the
 *                       document where they can fetch it. A step whose
 *                       completion is another step's side effect is a queue row
 *                       that is always already done.
 *
 * AND THERE IS DELIBERATELY NO `travel` STEP. The trip happening is not work
 * anybody owes — a step no human can complete is a queue row owed by nobody,
 * for ever. "Upcoming travel" is a filter (`status = booked` and departure in
 * the future), not a queue. What the *claim* step needs from the journey is its
 * RETURN DATE, and lib/queues.ts reads that off the row.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Statuses are NOT step keys. draft / returned / rejected / on_hold / cancelled
 * live in TripStatus (types/index.ts): a status in the work queue flows silently
 * into the KPI tiles and the cross-FMS scoreboard as "work owed by Nobody".
 */
export type StepKey =
  /** noQueue: raising it IS the event. Exists only as the anchor step 2 points at. */
  | "request"
  | "manager_approval"
  | "director_approval"
  | "advance"
  | "booking"
  | "claim"
  | "claim_review"
  | "finance_review"
  | "settlement";

/** One scope — no cross-scope anchor walk. */
export type StepScope = "trip";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * `index` is display + sort only — nothing persists it (the DB stores step KEYS
 * as free text). What IS load-bearing is the ARRAY POSITION: `createStepSlaModel`
 * derives a step's default anchor from the step before it and offers only
 * strictly earlier steps as anchor options, which makes an anchor cycle
 * impossible by construction. The order below is a legal topological order —
 * verify that still holds against sla.ts's OVERRIDES before moving anything.
 *
 * `noQueue` marks a step that structurally never holds a work-item, so consumers
 * can tell "this step cannot hold work" apart from "this step happens to be
 * empty".
 *
 * ⚠ TWO OF THESE STEPS ARE SKIPPABLE — `director_approval` (bands 1-5 do not
 *   need one) and `advance` (most trips do not draw one). They are ordinary
 *   steps here; the trip carries a `*_skipped` flag, and sla.ts anchors the
 *   steps AFTER them past them so a skipped step never stalls the next clock.
 */
export const STEPS: StepDef[] = [
  { key: "request",           index: 1, title: "Trip Requested",             short: "Request",    scope: "trip", noQueue: true },
  { key: "manager_approval",  index: 2, title: "Reporting Manager Approval",  short: "Manager",    scope: "trip" },
  { key: "director_approval", index: 3, title: "Director Approval",           short: "Director",   scope: "trip" },
  { key: "advance",           index: 4, title: "Travel Advance",              short: "Advance",    scope: "trip" },
  { key: "booking",           index: 5, title: "Booking",                     short: "Booking",    scope: "trip" },
  { key: "claim",             index: 6, title: "Expense Claim",               short: "Claim",      scope: "trip" },
  { key: "claim_review",      index: 7, title: "Claim Approval",              short: "Claim Appr", scope: "trip" },
  { key: "finance_review",    index: 8, title: "Finance Verification",        short: "Finance",    scope: "trip" },
  { key: "settlement",        index: 9, title: "Settlement",                  short: "Settle",     scope: "trip" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The chain in four labelled runs, for `StepPipeline`'s grouped rail.
 *
 * Eight queue steps as one flat rail is twice the screen width and puts the
 * worst step off-screen — the very thing you opened the page to find. Grouped,
 * it wraps into stages a reader already has names for: getting permission,
 * getting arranged, getting the money back, getting paid.
 *
 * ⚠ EVERY QUEUE STEP MUST APPEAR IN EXACTLY ONE STAGE. A step named by no stage
 *   lands in a trailing "Other" group in the cross-FMS roll-up (see
 *   fms-control-center/lib/buckets.ts) — which is honest, but reads as a bug.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Approval",     keys: ["manager_approval", "director_approval"] },
  { label: "Arrangements", keys: ["advance", "booking"] },
  { label: "Claim",        keys: ["claim", "claim_review"] },
  { label: "Settlement",   keys: ["finance_review", "settlement"] },
];

/**
 * Steps an admin may assign owners to in Settings.
 *
 * ⚠ `request` IS INCLUDED, and that is what makes raising restrictable. No
 *   owners on `request` => anyone holding an edit grant may raise a trip; owners
 *   set => only them, plus admins and coordinators. Same semantics as OCPI's
 *   `quotation` and Order to Dispatch's origin step.
 *
 * ⚠ `manager_approval` and `claim_review` ARE ALSO INCLUDED even though they
 *   route per-trip to that trip's own reporting managers. Owners named here are
 *   ADDITIVE co-owners, not replacements — which is how HR gets the PRD's
 *   "same permissions as the HOD" without being named on every trip. hr-exit's
 *   fms_exit_can_act does exactly this and its comment is explicit that the
 *   manager arm must NOT early-return.
 */
export const OWNER_STEPS: StepKey[] = STEPS.map((s) => s.key);

/**
 * Steps whose owner set is the TRIP's own `approverManagerIds`, in addition to
 * whatever Settings names. Mirrored in SQL by fms_travel_can_act().
 *
 * There is no `departments.hod_id` in this portal and no HRIS, so "your
 * manager" is a snapshot taken from `user_hods` when the trip is submitted —
 * not a live lookup. A re-org must not silently re-route a trip somebody is
 * already waiting on.
 */
export const MANAGER_STEPS: StepKey[] = ["manager_approval", "claim_review"];

export const isManagerStep = (key: StepKey): boolean => MANAGER_STEPS.includes(key);
