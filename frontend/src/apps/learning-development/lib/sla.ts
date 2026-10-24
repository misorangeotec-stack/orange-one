/**
 * Learning & Development's instance of the shared step-SLA model.
 *
 * The model itself (defaults, anchor options, the stored-map merge) lives in
 * `@/shared/lib/stepSla`, shared with Purchase, HR and the rest. This file is the
 * L&D-specific instantiation.
 *
 * THE NUMBERS BELOW ARE §3'S RECOMMENDED TATs, AND THEY ARE SEEDS, NOT RULES. §1
 * of the source document says so in as many words: the L&D timelines "are
 * recommended configuration values and may be changed by HR before development
 * sign-off". Every one of them is editable in Setup → Due Dates, and the live map
 * is stored in `fms_ld_config` under `step_sla` and merged over these defaults.
 *
 * Counted in working days (Mon–Sat; only Sunday is skipped), EXCEPT the steps
 * listed in {@link TRIGGER_STEPS} below, whose clocks start on a domain event
 * rather than on an earlier step's completion.
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
 * Non-default seed rules, one per §3 of the source document.
 *
 * ⚠ `need_resubmit` IS ANCHORED ON ITSELF, deliberately. Its clock starts on a
 *   domain event — the moment HR sent it back — not on an earlier step's
 *   completion. Anchor it on the original submission and a freshly returned
 *   request is dated from the day it was first raised, i.e. born overdue. Same
 *   treatment recruitment gives `mrf_resubmit`.
 *
 * ⚠ THE PARTICIPANT STEPS ARE ANCHORED ON THE SESSION, NOT ON EACH OTHER.
 *   `assignment_submit` is due N days after the assignment was ISSUED, and
 *   `feedback` is due 2 days (the document's 48 hours) after the session was
 *   CONDUCTED — not after the person ahead of them in the list did their bit.
 *   Chaining them would make one slow colleague make everybody else late.
 */
const OVERRIDES: Partial<Record<StepKey, Partial<StepSla>>> = {
  need_resubmit: { anchor: "need_resubmit", days: 2 },
  need_validation: { anchor: "need_raised", days: 2 },
  proposal: { anchor: "need_validation", days: 2 },
  hr_head_approval: { anchor: "proposal", days: 3 },
  mgmt_approval: { anchor: "hr_head_approval", days: 3 },
  trainer_finalization: { anchor: "mgmt_approval", days: 3 },
  session_scheduling: { anchor: "trainer_finalization", days: 2 },
  nomination: { anchor: "session_scheduling", days: 3 },
  nomination_approval: { anchor: "nomination", days: 1 },
  invitation: { anchor: "nomination_approval", days: 3 },
  pre_material: { anchor: "invitation", days: 1 },
  conducted: { anchor: "pre_material", days: 1 },
  attendance: { anchor: "conducted", days: 1 },
  // §3 step 12 → "within 24 hours of session completion" for circulating it.
  assignment_issue: { anchor: "conducted", days: 1 },
  assignment_submit: { anchor: "assignment_issue", days: 7 },
  assignment_review: { anchor: "assignment_submit", days: 7 },
  // §3 step 13 → "within 48 hours".
  feedback: { anchor: "conducted", days: 2 },
  session_review: { anchor: "feedback", days: 3 },
  // §3 step 15 → the HOD gets 7 working days once the task lands. WHEN it lands
  // is not this number — see TRIGGER_STEPS.
  effectiveness: { anchor: "conducted", days: 7 },
  followup_decision: { anchor: "effectiveness", days: 2 },
  closure: { anchor: "followup_decision", days: 2 },
};

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

/**
 * Steps whose clock starts on a domain EVENT rather than on an earlier step's
 * completion. `days` above stays admin-configurable and is still read; the
 * `anchor` is inert and is never followed.
 *
 * The Due Dates screen renders `dueAfter` as static text beside a live number
 * input — the same treatment Purchase gives `tally` and HR gives its probation
 * reviews — so an admin can change how long somebody gets without being offered
 * an anchor that would do nothing.
 *
 * ⚠ THERE IS NO "CALENDAR DAYS" UNIT in the shared SLA model — only
 *   `working_days`, `months` and `same_day_cutoff` (see `SLA_UNITS`). The 30-day
 *   effectiveness window is therefore NOT expressed here at all: it is a calendar
 *   gap and it lives in `fms_ld_config.effectiveness.days_after_session`, read by
 *   LD-8's queue logic when it creates the task. What `effectiveness.days` above
 *   controls is the separate, working-day SLA the HOD gets once that task exists.
 *   Two different numbers that both sound like "the effectiveness deadline" — do
 *   not collapse them.
 */
export const TRIGGER_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string }>> = {
  need_resubmit: {
    dueAfter: "Sent-back date",
    rule: "Starts when HR sends the request back, not when it was first raised — otherwise a freshly returned request is born overdue.",
  },
  effectiveness: {
    dueAfter: "Effectiveness task created",
    rule: "The task itself is created 30 calendar days after the session (Setup → Effectiveness). This number is how long the HOD then has to answer it.",
  },
};

export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
export { dueIsoFrom } from "@/shared/lib/stepSla";
