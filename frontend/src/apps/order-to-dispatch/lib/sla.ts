/**
 * Order to Dispatch FMS instance of the shared step-SLA model.
 *
 * Every queue step defaults to 1 working day after the step before it — which the
 * source sheet's "When: 1 Day" rows confirm for steps 2 and 4–7. The live map is
 * stored in fms_dispatch_config under `step_sla` and merged over these defaults.
 *
 * ONE STEP IS DIFFERENT. The sheet's rule for the store keeper's material check is
 * an hour-of-day cut-off, not a day count:
 *
 *   "Order received before 12PM - same Day Dispatch /// After 12PM - Next day Dispatch"
 *
 * So `material_status` uses the shared `same_day_cutoff` unit with `days: 0`.
 *
 * ⚠ WHAT IT MEASURES CHANGED WITH ROUNDS. The clock runs from the moment the
 *   order entered the STORE'S queue for the round in progress — `roundStartedAt`,
 *   not the original order receipt. For round 1 those are the same instant, so
 *   single-consignment behaviour is unchanged and the sheet's rule reads exactly
 *   as written. For round 2 onward the cut-off applies to when the balance came
 *   back to the store, which is the only reading under which "same day / next
 *   day" means anything: anchoring a third round on an order received six weeks
 *   ago would just mark it permanently late.
 *
 *   `lib/queues.ts` ANCHOR_AT is where that actually happens — it is a second,
 *   independent statement of the same fact, and the two must stay in step. The
 *   `anchor` recorded here is what Setup → Due Dates displays.
 *
 * The cut-off hour is admin-editable in Setup → Due Dates; `resolveStepSla` only
 * merges `cutoffHour` for a step whose DEFAULT unit is already `same_day_cutoff`,
 * so config can change the hour but never what the step measures.
 */
import {
  createStepSlaModel,
  type StepSla as StepSlaBase,
  type StepSlaMap as StepSlaMapBase,
} from "@/shared/lib/stepSla";
import { STEPS, type StepKey } from "./steps";

export type StepSla = StepSlaBase<StepKey>;
export type StepSlaMap = StepSlaMapBase<StepKey>;

const model = createStepSlaModel<StepKey>(STEPS, {
  material_status: { anchor: "sales_order", days: 0, unit: "same_day_cutoff", cutoffHour: 12 },
});

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom, DEFAULT_CUTOFF_HOUR } from "@/shared/lib/stepSla";
