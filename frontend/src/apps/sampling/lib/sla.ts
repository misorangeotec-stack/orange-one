/**
 * Sampling FMS instance of the shared step-SLA model.
 *
 * All queue steps default to 1 working day. The live map is stored in
 * fms_sampling_config under `step_sla` and merged over the defaults.
 *
 * The anchors below are for the DUE-DATE DISPLAY (Setup → Due Dates) and the
 * default clock. The actual "from" timestamp per step is resolved in
 * lib/queues.ts `samplingDueIso`, which disambiguates `testing` on `direction`
 * (its predecessor is receive_sample for inward, confirm_receipt for outward) —
 * so a step that doesn't apply to a request is never born overdue.
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
  receive_sample: { anchor: "request", days: 1 },
  send_sample: { anchor: "request", days: 1 },
  confirm_receipt: { anchor: "send_sample", days: 1 },
  testing: { anchor: "request", days: 1 },
  result: { anchor: "testing", days: 1 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
