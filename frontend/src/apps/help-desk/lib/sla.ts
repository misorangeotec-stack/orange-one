/**
 * Help Desk's instance of the shared per-step due-date model.
 *
 * The model itself (defaults, anchor options, the stored-map merge) lives in
 * `@/shared/lib/stepSla`. This file is the Help-Desk-specific instantiation.
 *
 * The live map is stored in `fms_help_config` under `step_sla` and merged over
 * {@link DEFAULT_STEP_SLA}; an admin edits it in Settings → Due dates.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ONE STEP DOES NOT GET ITS NUMBER FROM HERE, AND CANNOT.
 *
 * `resolve` is timed by the TICKET'S OWN CATEGORY (`fms_help_categories.tat_days`),
 * not by a module-wide number. That is the whole point of the category master:
 * an attendance correction is due in 1 working day and a PMS query in 3, and
 * both are `resolve`.
 *
 * So {@link CATEGORY_TIMED_STEPS} names it, `ticketDueIso()` in lib/queues.ts
 * reads the category, and the Due Dates screen renders `resolve` as "set per
 * category" with a link to Masters rather than offering a number that would be
 * silently ignored. The entry that remains in OVERRIDES below is the FALLBACK
 * for a ticket whose category has somehow lost its TAT — never the live rule.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ FIVE CATEGORIES ARE DELIBERATELY UNTIMED — "As per Exit Policy", "As per
 *   Calendar", "As per Training Calendar", "As per POSH Policy", "As per Case".
 *   `tat_days` is null on those rows and `ticketDueIso` returns **null**, which
 *   the engine already means as "can never be late" (`QueueEntryBase.dueIso`).
 *   Do NOT substitute a default: inventing a date for a POSH complaint would put
 *   it in somebody's overdue list on a schedule nobody agreed to. The SLA report
 *   states how many tickets were untimed instead of shrinking its denominator.
 *
 * ── THE HOURS TRAP — READ BEFORE "FIXING" THE FRT ───────────────────────────
 *
 * The source PDF's headline KPI is **First Response Time ≤ 30 minutes**, and its
 * step 5 says "Within 4 Working Hours". There is deliberately NO hours unit in
 * `shared/lib/stepSla`, and adding one would be wrong here specifically:
 * everything downstream of `dueIsoFrom` is date-granular — `bucketOf` compares
 * dates, `dueState` zeroes the clock, `DueCell` renders a day — so an hours SLA
 * renders "due today" while the real deadline passed at 14:00.
 *
 *   THE DUE DATE for `acknowledge` is therefore SAME WORKING DAY (days = 0).
 *   THE KPI is computed separately as `acknowledged_at − raised_at` in MINUTES
 *   and reported by the First Response report against
 *   `fms_help_config.policy.frt_target_minutes` (30).
 *
 * One is a deadline the queue can colour honestly; the other is a measurement.
 * Conflating them is what would make the queue lie.
 *
 * ⚠ NOTHING HERE IS ENFORCED. A due date colours a cell and sorts a queue; no
 *   RPC refuses anything for being late. Decision D8 is explicit that a breached
 *   TAT notifies nobody — it counts as a miss in the SLA and ageing reports, and
 *   that is all. Escalation is driven by REOPENS (D3), never by this file.
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
  // PDF step 3 — the acknowledgement is "Instant", and step 5 gives the owner
  // four working hours to validate. Same working day is the honest date-grained
  // expression of both; the minutes are measured, not deadlined. See the header.
  acknowledge: { anchor: "raise", days: 0 },

  // PDF step 6 — "If additional information is required, employee is notified
  // through the system … Within 1 Working Day". The clock is on the PERSON WHO
  // WAS ASKED, and it starts when they were asked, which is not a step
  // completion — so lib/queues.ts reads `info_requested_at` off the row. This
  // entry is its magnitude.
  awaiting_info: { anchor: "acknowledge", days: 1 },

  // ⚠ FALLBACK ONLY. The live number is the ticket's category TAT. See the ⚠⚠
  //   block at the head of this file.
  resolve: { anchor: "raise", days: 1 },

  // PDF step 9 — "Employee receives notification and confirms satisfaction …
  // Within 2 Working Days". Anchored on the resolution, which is what the
  // employee is being asked to accept.
  confirm: { anchor: "resolve", days: 2 },
};

/**
 * Steps whose `days` comes from the ticket's CATEGORY rather than from the
 * module's step_sla map. The Due Dates screen greys these out and points at
 * Masters; `ticketDueIso()` reads the category for them.
 */
export const CATEGORY_TIMED_STEPS: StepKey[] = ["resolve"];

export const isCategoryTimed = (key: StepKey): boolean => CATEGORY_TIMED_STEPS.includes(key);

/**
 * Steps whose clock starts at an EVENT on the row rather than at another step's
 * completion. `dueAfter` is the label the Due Dates screen prints so an admin
 * knows what the number is measured from.
 *
 * ⚠ EVERY ENTRY HERE NEEDS ITS OWN CASE IN `ticketDueIso()` (lib/queues.ts).
 *   One that falls through to the generic "anchor step's completion" path is
 *   BORN OVERDUE — New Recruitment's onboarding clock was wrong in exactly this
 *   way, and Travel Desk's sla.ts carries the same warning.
 */
export const TRIGGER_STEPS: Partial<Record<StepKey, { dueAfter: string; rule: string }>> = {
  awaiting_info: {
    dueAfter: "The moment the question was asked",
    rule:
      "This many working days after the owner asked for more information, not after the ticket was raised. " +
      "PDF step 6. The clock is on whoever was tagged, which may be the employee or an HOD.",
  },
};

export const isTriggerStep = (key: StepKey): boolean => key in TRIGGER_STEPS;

/**
 * Steps that never hold a work-item, so no SLA of their own applies. The Due
 * Dates screen renders these greyed out with an explanation.
 */
export const INERT_STEPS: StepKey[] = STEPS.filter((s) => s.noQueue).map((s) => s.key);

const model = createStepSlaModel<StepKey>(STEPS, OVERRIDES);

export const DEFAULT_STEP_SLA: StepSlaMap = model.DEFAULT_STEP_SLA;
export const anchorOptions = model.anchorOptions;
export const resolveStepSla = model.resolveStepSla;

export { dueIsoFrom } from "@/shared/lib/stepSla";
export { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
