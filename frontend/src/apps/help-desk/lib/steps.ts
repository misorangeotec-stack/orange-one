import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The five Help Desk steps. `key` is the stable identifier used by
 * fms_help_step_owners, the SLA config, the queue logic and the ranking scorer.
 *
 * ONE SCOPE — a ticket is one entity from the question to the closure, so there
 * is no cross-scope anchor walk (New Recruitment needs one; this does not).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *   raise → acknowledge → [awaiting_info] → resolve → confirm → closed
 *                               ^               |         |
 *                               +---------------+         +→ reopen (escalates)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ FOUR OF THE FIVE ARE ROW-OWNED, and only one is configured in Setup:
 *
 *     acknowledge / resolve   the ticket's CATEGORY owners — or, once somebody
 *                             has reassigned it, the named assignee INSTEAD
 *     awaiting_info           the person the owner tagged
 *     confirm                 whoever raised it
 *
 *   Rows in fms_help_step_owners are ADDITIVE co-owners on top of those, which
 *   is how HR gets "the same rights as the process owner" without being named on
 *   thirty category rows. Mirrored in SQL by fms_help_can_act().
 *
 * ⚠ `close` IS NOT A STEP, and the source PDF makes it one (step 10, "HRMS / HR
 *   Executive, Same Day"). Closing is the side effect of the employee
 *   confirming, and a step whose completion is another step's side effect is a
 *   queue row that is always already done. Travel Desk dropped its
 *   `ticket_shared` step for exactly this reason. Confirmation closes the
 *   ticket; D9's auto-close is the other way out.
 *
 * ⚠ THERE IS NO `escalation` STEP EITHER. Decision D3 fires escalation on a
 *   REOPEN, and a reopen puts the ticket back on `resolve` with more people
 *   allowed to act on it. Escalation changes WHO owns a step, never WHICH step
 *   is owed — so it is a stamp on the row, not a queue nobody would ever clear.
 *
 * ⚠ TWO STEPS LOOP, and the loop is what `round_no` counts. A question asked
 *   (resolve → awaiting_info → resolve) and a reopen (confirm → resolve) both
 *   bump it, so the ranking scorer keys `stepId` on the round and round 2's
 *   resolve is a different scored step from round 1's. Order to Dispatch does
 *   the same.
 *
 * Statuses are NOT step keys. open / awaiting_info / resolved / closed /
 * cancelled / on_hold live in TicketStatus (types/index.ts): a status sitting in
 * the work queue flows silently into the KPI tiles and the cross-FMS scoreboard
 * as "work owed by Nobody".
 */
export type StepKey =
  /** noQueue: raising it IS the event. Exists only as the anchor the rest point at. */
  | "raise"
  | "acknowledge"
  | "awaiting_info"
  | "resolve"
  | "confirm";

/** One scope — no cross-scope anchor walk. */
export type StepScope = "ticket";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * `index` is display + sort only — nothing persists it (the DB stores step KEYS
 * as free text). What IS load-bearing is the ARRAY POSITION: `createStepSlaModel`
 * derives a step's default anchor from the step before it and offers only
 * strictly earlier steps as anchor options, which makes an anchor cycle
 * impossible by construction. Verify the order below still holds against
 * lib/sla.ts's OVERRIDES before moving anything.
 *
 * ⚠ `awaiting_info` SITS BEFORE `resolve` IN THIS ARRAY even though, in real
 *   life, it happens in the middle of resolving. It has to: the SLA model only
 *   lets a step anchor on a strictly earlier one, and putting it after `resolve`
 *   would make "resolve" unanchorable on anything sensible. The rail the reader
 *   sees is ComplaintStepper-style and knows about the loop; this array is the
 *   SLA's ordering, not the rail's.
 */
export const STEPS: StepDef[] = [
  { key: "raise",         index: 1, title: "Ticket Raised",          short: "Raised",  scope: "ticket", noQueue: true },
  { key: "acknowledge",   index: 2, title: "Acknowledge Receipt",    short: "Ack",     scope: "ticket" },
  { key: "awaiting_info", index: 3, title: "Waiting on the Employee", short: "Waiting", scope: "ticket" },
  { key: "resolve",       index: 4, title: "Resolve",                short: "Resolve", scope: "ticket" },
  { key: "confirm",       index: 5, title: "Employee Confirmation",  short: "Confirm", scope: "ticket" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/** The steps that can hold work — everything the sidebar offers a queue for. */
export const QUEUE_STEPS: StepKey[] = STEPS.filter((s) => !s.noQueue).map((s) => s.key);

/**
 * Steps an admin may assign owners to in Settings.
 *
 * ⚠ `raise` IS INCLUDED, and that is what makes raising restrictable. No owners
 *   on `raise` => anyone signed in may raise a ticket, which is what decision D2
 *   asks for; owners set => only them, plus admins and coordinators. Same
 *   semantics as Order to Dispatch's origin step and L&D's `need_raised`.
 *
 * ⚠ THE OTHER FOUR ARE ADDITIVE, NOT REPLACEMENTS. Naming somebody on `resolve`
 *   here does not take the ticket away from its category's owner — it adds them.
 *   See the header.
 */
export const OWNER_STEPS: StepKey[] = STEPS.map((s) => s.key);

/**
 * The chain in three labelled runs, for `StepPipeline`'s grouped rail and for
 * the cross-FMS roll-up.
 *
 * ⚠ EVERY QUEUE STEP MUST APPEAR IN EXACTLY ONE STAGE. A step named by no stage
 *   lands in a trailing "Other" group in the Control Center
 *   (fms-control-center/lib/buckets.ts) — honest, but it reads as a bug.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Received", keys: ["acknowledge"] },
  { label: "Working",  keys: ["awaiting_info", "resolve"] },
  { label: "Closing",  keys: ["confirm"] },
];
