/**
 * Production Entry FMS instance of the shared step-SLA model.
 *
 * Every queue step defaults to 1 working day after the step before it. The live
 * map is stored in fms_production_config under `step_sla` and merged over the
 * defaults. The chain is strictly linear, so the default "previous step + 1 day"
 * anchor is exactly right — no overrides needed.
 */
import {
  createStepSlaModel,
  type StepSla as StepSlaBase,
  type StepSlaMap as StepSlaMapBase,
} from "@/shared/lib/stepSla";
import { STEPS, type StepKey } from "./steps";

export type StepSla = StepSlaBase<StepKey>;
export type StepSlaMap = StepSlaMapBase<StepKey>;

const model = createStepSlaModel<StepKey>(STEPS);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
