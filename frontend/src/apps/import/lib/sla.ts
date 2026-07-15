/**
 * Purchase FMS's instance of the shared step-SLA model.
 *
 * The model itself (defaults, anchor options, the stored-map merge) lives in
 * `@/shared/lib/stepSla` because HR Recruitment uses the identical rules; this
 * file is only the Purchase-specific instantiation plus its trigger steps.
 *
 * A step's due date = the anchor step's completion + `days` working days (Mon–Sat,
 * only Sunday is skipped). The live map is stored in `fms_import_config` under
 * the key `step_sla` and merged over {@link DEFAULT_STEP_SLA}.
 *
 * Three steps are exceptions to the anchor rule:
 *   • `follow_up` — its due date is the vendor's promised dispatch date (captured
 *     at Share PO), not an SLA. See `dispatchDueForPo` in queues.ts.
 *   • `inward` — untimed: receiving can never be late, so it has no due date at all.
 *   • `tally` — trigger-anchored, see {@link TRIGGER_STEPS}.
 * Their `anchor` entries are inert, as is `days` for the first two.
 */
import { createStepSlaModel, type StepSla as StepSlaBase, type StepSlaMap as StepSlaMapBase } from "@/shared/lib/stepSla";
import { STEPS, type StepKey } from "./steps";

export type StepSla = StepSlaBase<StepKey>;
export type StepSlaMap = StepSlaMapBase<StepKey>;

const model = createStepSlaModel<StepKey>(STEPS);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

/**
 * Steps whose clock starts on a domain EVENT, not on an earlier step's completion.
 * `days` stays admin-configurable; `anchor` is inert and never read.
 *
 * Each GRN is its own invoice, so `tally` keys off the oldest one still unbooked.
 */
export const TRIGGER_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string }>> = {
  tally: {
    dueAfter: "Oldest unbooked goods receipt (GRN)",
    rule: "Each GRN is its own invoice; the oldest unbooked one sets the deadline.",
  },
};

// The date math moved to shared/lib/workingDays. Re-exported so this module stays
// the single import site for everything due-date-related inside Purchase FMS.
export { addWorkingDays, dueState, localDateIso } from "@/shared/lib/workingDays";
