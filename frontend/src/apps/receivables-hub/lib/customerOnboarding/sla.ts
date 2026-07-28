/**
 * Customer Creation FMS instance of the shared step-SLA model.
 *
 * The live map lives in fms_customer_config under `step_sla` and is merged over
 * these defaults, so an admin can retune the clock without a deploy.
 *
 * The numbers reflect what each step actually costs: verifying a GST number and
 * ringing two trade references is a day's work; a grading call is same-day; a
 * director looks at a batch; creating a ledger is minutes once approved.
 *
 * Anchors may only point at strictly EARLIER steps — the shared model enforces
 * that, which is what makes a cycle impossible by construction.
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
  accounts_verification: { anchor: "submission", days: 2 },
  sales_head_approval:   { anchor: "accounts_verification", days: 1 },
  director_approval:     { anchor: "sales_head_approval", days: 2 },
  tally_creation:        { anchor: "director_approval", days: 1 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
