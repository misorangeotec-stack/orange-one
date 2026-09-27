/**
 * HR Recruitment's instance of the shared step-SLA model.
 *
 * The model itself (defaults, anchor options, the stored-map merge) lives in
 * `@/shared/lib/stepSla`, shared with Purchase FMS. This file is the HR-specific
 * instantiation: its defaults, its trigger steps, and its inert steps.
 *
 * A step's due date = the anchor step's completion + `days`, counted in working
 * days (Mon–Sat, only Sunday is skipped) — EXCEPT the probation reviews, which are
 * counted in calendar MONTHS from the joining date. That is the one thing HR needs
 * that Purchase does not: "one month after they joined" is not "26 working days".
 *
 * The live map is stored in `fms_hr_config` under the key `step_sla` and merged
 * over {@link DEFAULT_STEP_SLA}.
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
 * Non-default seed rules.
 *
 * The two approvals get 2 working days each (the TAT in the recruitment workflow
 * doc). The probation steps are month-anchored on the joining date — expressed as
 * `unit: "months"` so `dueIsoFrom` adds calendar months, and anchored on
 * `onboarding` (whose completion IS the joining).
 */
const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  // Anchored on ITSELF because its clock starts on a domain event, not on an earlier
  // step: `requisitionStepCompletedIso` maps this key straight to `sentBackAt`. Anchor
  // it on anything else and a freshly sent-back MRF is dated from its original
  // submission — i.e. born overdue. See TRIGGER_STEPS below.
  mrf_resubmit: { anchor: "mrf_resubmit", days: 2 },
  hr_head_approval: { anchor: "mrf", days: 2 },
  mgmt_approval: { anchor: "hr_head_approval", days: 2 },
  job_posting: { anchor: "mgmt_approval", days: 1 },
  resume_upload: { anchor: "job_posting", days: 7 },
  hr_shortlist: { anchor: "resume_upload", days: 2 },
  // Anchored on HR's shortlist, because that IS the handover now — the day
  // `hod_share` used to be allotted was a day spent waiting for a button press.
  hod_shortlist: { anchor: "hr_shortlist", days: 2 },
  telephonic_screening: { anchor: "hod_shortlist", days: 2 },
  // Anchored on the telephonic screen (the default previous stage). If the screen was
  // skipped its timestamp is null, and candidateDueIso falls back to the last completed
  // stage — so a skipped-into Round 1 is never born overdue.
  interview_1: { anchor: "telephonic_screening", days: 2 },
  interview_2: { anchor: "interview_1", days: 2 },
  interview_3: { anchor: "interview_2", days: 2 },
  final_decision: { anchor: "interview_3", days: 2 },
  onboarding: { anchor: "final_decision", days: 7 },
  // NR-10 · the Day 7/15/30/60/90 cadence. `days` here is DISPLAY ONLY — the real
  // due date is stamped on the check-in row (`due_on`) when the probation opens,
  // in CALENDAR days from the joining date, and lib/queues.ts reads it from there.
  //
  // ⚠ It cannot be expressed in this model at all: a day-unit SLA counts WORKING
  // days (Mon–Sat), so `days: 7` would land Day 7 on the 8th calendar day. That
  // is exactly why the cadence is stamped in SQL and only mirrored here.
  probation_d7: { anchor: "onboarding", days: 7 },
  probation_d15: { anchor: "onboarding", days: 15 },
  probation_d30: { anchor: "onboarding", days: 30 },
  probation_d60: { anchor: "onboarding", days: 60 },
  probation_d90: { anchor: "onboarding", days: 90 },
  probation_final: { anchor: "onboarding", days: 3, unit: "months" },
  probation_extension: { anchor: "onboarding", days: 4, unit: "months" },
  // Retired by NR-10; kept so an old row still resolves.
  probation_m1: { anchor: "onboarding", days: 1, unit: "months" },
  probation_m2: { anchor: "onboarding", days: 2, unit: "months" },
  probation_m3: { anchor: "onboarding", days: 3, unit: "months" },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

/**
 * Steps whose clock starts on a domain EVENT rather than an earlier step's
 * completion. `days` stays admin-configurable; `anchor` is inert and never read.
 *
 * All five probation steps hang off the joining date, so the Due Dates screen
 * shows a static "Joining date" and keeps the number input live — exactly the
 * treatment Purchase gives `tally`.
 */
export const TRIGGER_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string; unit?: "months" }>> = {
  mrf_resubmit: {
    dueAfter: "Sent-back date",
    rule: "The requester has this long to revise and resubmit an MRF that was sent back.",
  },
  probation_d7: { dueAfter: "Joining date", rule: "Day 7 — calendar days after the person actually joined. Fixed by the cadence, not configurable here." },
  probation_d15: { dueAfter: "Joining date", rule: "Day 15 — calendar days after joining." },
  probation_d30: { dueAfter: "Joining date", rule: "Day 30 — calendar days after joining." },
  probation_d60: { dueAfter: "Joining date", rule: "Day 60 — calendar days after joining." },
  probation_d90: { dueAfter: "Joining date", rule: "Day 90 — the confirmation review. The DECISION that follows it is a separate step." },
  probation_m1: { dueAfter: "Joining date", rule: "Retired by NR-10 — the monthly cadence was replaced by Day 7/15/30/60/90.", unit: "months" },
  probation_m2: { dueAfter: "Joining date", rule: "Reviewed two months after joining.", unit: "months" },
  probation_m3: { dueAfter: "Joining date", rule: "Reviewed three months after joining.", unit: "months" },
  probation_final: { dueAfter: "Joining date", rule: "Confirm / reject / extend, once the three monthly reviews are in.", unit: "months" },
  probation_extension: { dueAfter: "Joining date", rule: "Only when the 3-month decision was 'Extend by 1 month'.", unit: "months" },
};

/**
 * Steps that never sit in a queue, so no SLA of their own applies. The Due Dates
 * screen renders these greyed out with an explanation.
 */
export const INERT_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string }>> = {
  mrf: {
    dueAfter: "Not applicable",
    rule: "Raising the requisition is the event — it never waits in a queue. Later steps anchor on it.",
  },
};

export { addWorkingDays, addMonths, dueState, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
