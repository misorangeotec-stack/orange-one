/**
 * Office Supplies FMS instance of the shared step-SLA model.
 *
 * All three queue steps default to 1 working day (the sheet's "Day 1"). The live map
 * is stored in fms_supplies_config under `step_sla` and merged over the defaults.
 *
 * The anchors are chosen so the SKIP PATH is never born overdue (see lib/queues.ts):
 *   first_approval  → request submission + 1
 *   second_approval → first approval      + 1
 *   handover        → second approval      + 1  (falls back to submission for the
 *                     skip path, where second_approved_at is null — the generic
 *                     `exitStepCompletedIso(anchor) ?? submittedAt` fallback handles it)
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
  first_approval: { anchor: "request", days: 1 },
  second_approval: { anchor: "first_approval", days: 1 },
  handover: { anchor: "second_approval", days: 1 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
