/**
 * Complaint (RM/FG) FMS instance of the shared step-SLA model.
 *
 * The live map is stored in fms_complaint_config under `step_sla` and merged over
 * the defaults below, so an unset or unknown step falls back to its default and
 * behaviour never silently disappears.
 *
 * The anchors here drive the DUE-DATE DISPLAY (Setup → Due Dates) and the default
 * clock. The actual "from" timestamp per step is resolved in lib/queues.ts
 * `complaintDueIso`, which falls back to the complaint's submission when an anchor
 * never ran — so a step is never born overdue.
 *
 * WHY THESE NUMBERS. The plant and the service team each get two working days —
 * enough to look at the goods and to raise a requisition. The approval gets one:
 * it is a decision, not work. The final review gets two, because it is a batch
 * activity somebody does when they sit down to it rather than on the hour.
 */
import {
  createStepSlaModel,
  type StepSla as StepSlaBase,
  type StepSlaMap as StepSlaMapBase,
} from "@/shared/lib/stepSla";
import { STEPS, type StepKey } from "./steps";

export type StepSla = StepSlaBase<StepKey>;
export type StepSlaMap = StepSlaMapBase<StepKey>;

/**
 * ⚠ EVERY QUEUE STEP IS LISTED, even where the value equals what the default
 *   would have computed. The default anchor is "whatever now precedes this step
 *   in STEPS", so an unpinned step silently re-anchors if the array is ever
 *   re-ordered — the trap sampling's `testing` step had to be pinned out of.
 */
const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  plant: { anchor: "raise", days: 2 },
  service: { anchor: "plant", days: 2 },
  // Management signing off a commercial call: one day. The customer has already
  // been told something is coming.
  approval: { anchor: "service", days: 1 },
  management_review: { anchor: "service", days: 2 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
