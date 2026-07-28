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
 * So `material_status` is anchored on `sales_order` (order RECEIPT — not on the
 * credit confirmation, which is the step immediately before it) and uses the
 * shared `same_day_cutoff` unit with `days: 0`. `anchorOptions("material_status")`
 * returns ["sales_order", "credit_check"], so the stored-anchor guard in
 * resolveStepSla accepts it if an admin ever re-saves the map.
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
