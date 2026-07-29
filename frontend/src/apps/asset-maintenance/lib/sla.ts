/**
 * Asset Maintenance FMS instance of the shared step-SLA model.
 *
 * The live map is stored in fms_asset_config under `step_sla` and merged over
 * these defaults, so an unset or unknown step falls back and behaviour never
 * silently disappears.
 *
 * ONE STEP IS DIFFERENT, and it is the one that matters.
 *
 *   `service_done` is due on THE JOB'S OWN DUE DATE, not N days after the step
 *   before it. Every other FMS measures a step from the previous step because
 *   work arrives unpredictably; here the deadline was known months in advance —
 *   it is the day the insurance lapses or the service falls due. A job scheduled
 *   three weeks early must not therefore be "late" three weeks early, and a job
 *   scheduled the day before its expiry must not look comfortable.
 *
 *   So its rule is `days: 0`, and lib/queues.ts anchors it on the job's
 *   `dueDate` rather than on a step completion (see ANCHOR_AT there — that map,
 *   not the stored `anchor`, is what actually picks the timestamp, exactly as in
 *   Order to Dispatch's `material_status`).
 *
 * `schedule` gets 2 working days rather than the usual 1: booking a garage or a
 * broker means waiting on someone outside the company, and a 1-day SLA on that
 * would show permanently red for reasons nobody inside can fix.
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
  schedule: { anchor: "service_due", days: 2 },
  service_done: { anchor: "schedule", days: 0 },
});

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
