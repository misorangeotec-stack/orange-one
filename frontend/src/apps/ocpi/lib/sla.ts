import {
  createStepSlaModel,
  type StepSla as StepSlaBase,
  type StepSlaMap as StepSlaMapBase,
} from "@/shared/lib/stepSla";
import { STEPS, type StepKey } from "./steps";

/**
 * OCPI's instance of the shared per-step due-date model.
 *
 * A step is due N working days (Mon–Sat) after its anchor step completed. The
 * live map lives in `fms_ocpi_config` under `step_sla`, merged over these
 * defaults, and an admin edits it in Settings → Due dates.
 *
 * ⚠ THE DEFAULTS ARE NOT ALL 1, and that is the whole judgement in this file.
 *   The shared model's default is "one working day after the step before" —
 *   right for an approval somebody can do from their phone, and wrong for two of
 *   these steps:
 *
 *     customer_signoff    7 days — this one is NOT OURS TO HURRY. The document
 *                                  is printed, carried or couriered to a
 *                                  customer, signed by whoever signs, and
 *                                  brought back. A one-day target would paint
 *                                  the whole queue red by Tuesday and the colour
 *                                  would stop meaning anything.
 *
 *   Both are only defaults; the point of the settings screen is that whoever
 *   runs this process can say what the real targets are.
 *
 * ⚠ NOTHING HERE IS ENFORCED. A due date colours a cell and sorts a queue; no
 *   RPC refuses anything for being late. Lateness in this module is information
 *   for the people chasing, not a gate.
 */

export type StepSla = StepSlaBase<StepKey>;
export type StepSlaMap = StepSlaMapBase<StepKey>;

/**
 * ⚠ EVERY NON-ORIGIN STEP NAMES ITS ANCHOR EXPLICITLY, and that is load-bearing
 *   rather than tidy. The shared model derives a default anchor from ARRAY
 *   POSITION, so retiring a step would otherwise silently re-anchor whatever
 *   followed it — `customer_signoff` would start counting from a step nothing
 *   reaches, and the whole signature half of the queue would compute its due
 *   dates from a timestamp that is never stamped.
 */
const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  quotation_approval: { anchor: "quotation", days: 1 },
  // ⚠ RE-ANCHORED at the stage-F cutover: was `oc_approval`, a step that no
  //   longer completes. The Directors' approval of the quotation is now what
  //   puts the contract in the salesperson's hands.
  customer_signoff: { anchor: "quotation_approval", days: 7 },
  management_signoff: { anchor: "customer_signoff", days: 1 },
  // Carrying a signed contract to the Finance desk, and Finance saying they have
  // it. Both are a day's work at most; neither is anybody's negotiation.
  finance_handover: { anchor: "management_signoff", days: 1 },
  finance_receipt: { anchor: "finance_handover", days: 1 },
  // Retired, and still anchored: a deal parked at one of these must keep a due
  // date rather than suddenly reading as untimed.
  order_confirmation: { anchor: "quotation_approval", days: 2 },
  oc_approval: { anchor: "order_confirmation", days: 1 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { dueIsoFrom } from "@/shared/lib/stepSla";
export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
