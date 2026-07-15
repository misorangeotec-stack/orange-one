/**
 * HR Exit's instance of the shared step-SLA model.
 *
 * The model itself (defaults, anchor options, the stored-map merge) lives in
 * `@/shared/lib/stepSla`, shared with Purchase FMS and HR Recruitment. This file is
 * the exit-specific instantiation: its defaults, its trigger steps, its inert step.
 *
 * The live map is stored in `fms_exit_config` under the key `step_sla` and merged
 * over {@link DEFAULT_STEP_SLA}.
 *
 * ── THE NEGATIVE-OFFSET TRAP — READ BEFORE TOUCHING ANY NUMBER BELOW ─────────
 *
 * Five of this workflow's deadlines run BACKWARDS from an event: you cannot chase a
 * laptop after the person has walked out, so asset return is due *before* the last
 * working day. The shared engine cannot express that:
 *
 *   • `resolveStepSla` (shared/lib/stepSla.ts) does NOT clamp a negative `days` to
 *     zero — `Number.isFinite(days) && days >= 0 ? … : out[step.key].days` SILENTLY
 *     SUBSTITUTES THE STEP'S DEFAULT. Store `-3` and you do not get "3 days before";
 *     you get some unrelated default, with no error anywhere.
 *   • `addWorkingDays` separately clamps `n` to `max(0, n)`.
 *
 * So a "before the event" deadline is unrepresentable in config, and getting it
 * wrong fails SILENTLY rather than loudly. The only safe shape, therefore:
 *
 *   DIRECTION LIVES IN CODE (`before: true` in TRIGGER_STEPS).
 *   MAGNITUDE LIVES IN CONFIG, AND IS ALWAYS ≥ 0.
 *
 * The maths is done with `addWorkingDaysSigned` (shared/lib/workingDays.ts), never
 * `addWorkingDays`. StepDueDatesSection renders a "Due BEFORE" branch for these and
 * keeps its number input `min={0}`.
 *
 * ⚠ Every TRIGGER_STEPS entry needs its own case in `exitDueIso()` (lib/queues.ts,
 * Phase 2). One that falls through to the generic `dueIsoFrom(completedIso(anchor))`
 * path is BORN OVERDUE — a 60-day-notice resignation would go red on day 2 and stay
 * red for two months. That is exactly how HR's onboarding clock and `mrf_resubmit`
 * were wrong.
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
 * Non-default seed rules, from the source workflow's TAT column.
 *
 * The LWD-anchored block's `anchor` is INERT — those steps hang off the confirmed
 * last working day, a domain event, not off `lwd_confirm`'s completion timestamp
 * (which is when HR *typed* the date, not the date itself). See TRIGGER_STEPS.
 */
const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  manager_review: { anchor: "resignation", days: 2 }, // Within 2 working days
  hr_verification: { anchor: "manager_review", days: 1 }, // Within 1 working day
  hr_head_approval: { anchor: "hr_verification", days: 1 }, // Within 1 working day
  lwd_confirm: { anchor: "hr_head_approval", days: 0 }, // Same day

  // ---- LWD-anchored. `anchor` is INERT for these (see TRIGGER_STEPS). ----
  clearance: { anchor: "lwd_confirm", days: 0 }, // driven by its checklist items
  asset_return: { anchor: "lwd_confirm", days: 1 }, // Before 1 day of LWD → LWD − 1
  handover: { anchor: "lwd_confirm", days: 1 }, // Before 1 day of LWD → LWD − 1
  exit_interview: { anchor: "lwd_confirm", days: 1 }, // Before the LWD    → LWD − 1
  leave_verification: { anchor: "lwd_confirm", days: 1 }, // "Before F&F"  → LWD − 1
  payroll_inputs: { anchor: "lwd_confirm", days: 0 }, // Before the payroll cut-off
  fnf_generate: { anchor: "lwd_confirm", days: 15 }, // Day 15            → LWD + 15

  // ---- ordinary step anchors ----
  fnf_approve: { anchor: "fnf_generate", days: 2 }, // Within 2 working days
  fnf_payment: { anchor: "fnf_approve", days: 7 }, // "As per company policy" — editable
  // Anchored on F&F APPROVED, not paid: letters issue once the settlement is settled,
  // and bank transfers lag. Both are legal anchors, so Setup can move it.
  documents: { anchor: "fnf_approve", days: 2 },
  archive: { anchor: "documents", days: 0 }, // Same day
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

/**
 * Steps whose clock starts on a domain EVENT rather than an earlier step's
 * completion. `days` stays admin-configurable; `anchor` is inert and never read.
 *
 * `before: true` means the deadline falls BEFORE the event — the direction the
 * config cannot carry (see the file header). The magnitude is still the configured
 * `days`, and it is still ≥ 0; the sign is applied here, in code.
 *
 * "Before F&F" resolves to LWD − 1 working day: the engine forbids anchoring on a
 * later step, and the constraint is causal anyway — the leave balance is an INPUT to
 * the F&F and is only final once the person stops accruing.
 */
export const TRIGGER_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string; before?: true }>> = {
  clearance: {
    dueAfter: "Last working day",
    rule: "Due on its earliest outstanding checklist item — each item carries its own signed offset.",
  },
  asset_return: {
    dueAfter: "Last working day",
    before: true,
    rule: "This many working days BEFORE the last working day — you cannot chase a laptop after they have gone.",
  },
  handover: {
    dueAfter: "Last working day",
    before: true,
    rule: "This many working days BEFORE the last working day.",
  },
  exit_interview: {
    dueAfter: "Last working day",
    before: true,
    rule: "Held before the person leaves.",
  },
  leave_verification: {
    dueAfter: "Last working day",
    before: true,
    rule: "Only final once they stop accruing, and needed before the F&F can be generated.",
  },
  payroll_inputs: {
    dueAfter: "Payroll cut-off",
    rule: "The cut-off of the month the last working day falls in (Setup → Policy).",
  },
  fnf_generate: {
    dueAfter: "Last working day",
    rule: "This many working days AFTER the last working day.",
  },
};

/**
 * Steps that never sit in a queue, so no SLA of their own applies. The Due Dates
 * screen renders these greyed out with an explanation.
 */
export const INERT_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string }>> = {
  resignation: {
    dueAfter: "Not applicable",
    rule: "Raising the resignation is the event — it never waits in a queue. Later steps anchor on it.",
  },
};

export { addWorkingDays, addWorkingDaysSigned, dueState, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
