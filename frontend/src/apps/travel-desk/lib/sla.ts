/**
 * Travel Desk's instance of the shared per-step due-date model.
 *
 * The model itself (defaults, anchor options, the stored-map merge) lives in
 * `@/shared/lib/stepSla`. This file is the travel-specific instantiation: its
 * defaults, its trigger steps, its skippable-step anchoring.
 *
 * The live map is stored in `fms_travel_config` under `step_sla` and merged over
 * {@link DEFAULT_STEP_SLA}; an admin edits it in Settings → Due dates.
 *
 * ── WHERE THESE NUMBERS COME FROM ───────────────────────────────────────────
 * Every default below is a figure from the Domestic Travel Policy, not a guess.
 * §12's timeline table is the whole back half of the chain:
 *
 *     Employee submits expense claim …… within 5 working days of return
 *     HOD approves or rejects ………………… within 2 working days
 *     Finance processes approved claim … within 5 working days of HOD approval
 *     Amount credited …………………………………… within 7 working days of HOD approval
 *     Total cycle …………………………………………… maximum 14 working days
 *
 * ⚠ NOTE `settlement` ANCHORS ON `claim_review`, NOT ON `finance_review`.
 *   That is not a slip. §12 measures the credit from HOD APPROVAL, so Finance
 *   taking its full five days does not buy the traveller's money another week.
 *   Anchoring it on the step before would let the 14-day promise drift.
 *
 * ── THE NEGATIVE-OFFSET TRAP — READ BEFORE TOUCHING `advance` ────────────────
 *
 * The advance deadline runs BACKWARDS: money that lands after departure has
 * missed the point entirely (§11.1 — "credited to employee bank account BEFORE
 * departure date"). The shared engine cannot express that:
 *
 *   • `resolveStepSla` does NOT clamp a negative `days` to zero — it SILENTLY
 *     SUBSTITUTES THE STEP'S DEFAULT. Store `-1` and you do not get "1 day
 *     before"; you get an unrelated default, with no error anywhere.
 *   • `addWorkingDays` separately clamps `n` to `max(0, n)`.
 *
 * So the only safe shape:
 *
 *     DIRECTION LIVES IN CODE (`before: true` in TRIGGER_STEPS).
 *     MAGNITUDE LIVES IN CONFIG, AND IS ALWAYS >= 0.
 *
 * The maths is done with `addWorkingDaysSigned`, never `addWorkingDays`.
 *
 * ⚠ EVERY TRIGGER_STEPS ENTRY NEEDS ITS OWN CASE IN `tripDueIso()`
 *   (lib/queues.ts). One that falls through to the generic
 *   `dueIsoFrom(stepCompletedIso(anchor))` path is BORN OVERDUE — a trip booked
 *   three weeks ahead would show its claim as three weeks late on the day it was
 *   booked. That is exactly how HR's onboarding clock was wrong.
 *
 * ── SKIPPABLE STEPS ─────────────────────────────────────────────────────────
 * `director_approval` (bands 1-5) and `advance` (most trips) are skipped often.
 * The shared model's default anchor is the PREVIOUS ARRAY ELEMENT, which for
 * `booking` is `advance` — skipped on most trips, so booking's clock would never
 * start from the right place. The OVERRIDES below re-anchor past them, and
 * `ANCHOR_AT` in lib/queues.ts picks the last approval that ACTUALLY happened.
 *
 * ⚠ NOTHING HERE IS ENFORCED. A due date colours a cell and sorts a queue; no
 *   RPC refuses anything for being late. Lateness in this module is information
 *   for the people chasing, not a gate. (The two things that ARE refused —
 *   a claim more than 30 days after travel, and a second advance while one is
 *   unreconciled — are policy rules enforced in SQL, not SLA rules.)
 */
import {
  createStepSlaModel,
  type StepSla as StepSlaBase,
  type StepSlaMap as StepSlaMapBase,
} from "@/shared/lib/stepSla";
import { STEPS, type StepKey } from "./steps";

export type StepSla = StepSlaBase<StepKey>;
export type StepSlaMap = StepSlaMapBase<StepKey>;

const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  // §3.2 / §11.1 step 2 — the HOD has a working day.
  manager_approval: { anchor: "request", days: 1 },
  director_approval: { anchor: "manager_approval", days: 1 },

  // §11.1 — a trigger step. `days` is the magnitude; the direction (BEFORE the
  // planned departure) lives in TRIGGER_STEPS and is applied in queues.ts.
  advance: { anchor: "manager_approval", days: 1 },

  // ⚠ ANCHORED ON manager_approval, NOT on `advance` (the array-order default).
  //   Most trips draw no advance, so the default anchor would never complete and
  //   booking would fall back to the trip's creation date — reading as weeks old
  //   the moment it was approved. ANCHOR_AT then prefers the DIRECTOR's approval
  //   where there was one, so a band-7 trip is measured from the real decision.
  booking: { anchor: "manager_approval", days: 2 },

  // §11.1 step 6 — a trigger step, measured from the trip's RETURN DATE rather
  // than from any step completion. The journey ending is what starts this clock.
  claim: { anchor: "booking", days: 5 },

  // §12.
  claim_review: { anchor: "claim", days: 2 },
  finance_review: { anchor: "claim_review", days: 5 },
  settlement: { anchor: "claim_review", days: 7 },
};

/**
 * Steps whose clock starts at an EVENT rather than at another step's completion.
 *
 * `dueAfter` is the label the Due Dates screen prints so an admin knows what the
 * number is measured from; `before: true` flips the direction.
 */
export const TRIGGER_STEPS: Partial<
  Record<StepKey, { dueAfter: string; rule: string; before?: true }>
> = {
  advance: {
    dueAfter: "Planned departure date",
    before: true,
    rule:
      "This many working days BEFORE departure. Policy §11.1 requires the advance to be credited before the employee leaves — money that lands afterwards has missed the point.",
  },
  claim: {
    dueAfter: "Return date",
    rule:
      "This many working days AFTER the trip returns (actual date if recorded, else planned). Policy §11.1: the claim is due within 5 working days of return.",
  },
};

export const isTriggerStep = (key: StepKey): boolean => key in TRIGGER_STEPS;

/**
 * Steps that never hold a work-item, so no SLA of their own applies. The Due
 * Dates screen renders these greyed out with an explanation.
 */
export const INERT_STEPS: StepKey[] = STEPS.filter((s) => s.noQueue).map((s) => s.key);

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { dueIsoFrom } from "@/shared/lib/stepSla";
export { addWorkingDays, addWorkingDaysSigned, localDateIso } from "@/shared/lib/workingDays";
