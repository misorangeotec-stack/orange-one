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
 *     order_confirmation  2 days — part B is a dozen commercial terms, several
 *                                  of which the salesperson has to go and
 *                                  confirm with the customer. A one-day target
 *                                  would mark most of them late while somebody
 *                                  was doing the job properly.
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

const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  quotation_approval: { anchor: "quotation", days: 1 },
  order_confirmation: { anchor: "quotation_approval", days: 2 },
  oc_approval: { anchor: "order_confirmation", days: 1 },
  customer_signoff: { anchor: "oc_approval", days: 7 },
  management_signoff: { anchor: "customer_signoff", days: 1 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { dueIsoFrom } from "@/shared/lib/stepSla";
export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
