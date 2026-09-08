import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Complaint (RM/FG) FMS steps. `key` is the stable identifier used by
 * fms_complaint_step_owners, the SLA config and the queue logic.
 *
 *   raise
 *     → PLANT       check it, do the corrective action, remarks + attachment
 *     → SERVICE     requisition, remarks, conclusion,
 *                   "Commercial call taken?"  Yes / No
 *          Yes → APPROVAL   management, on the commercial-call remarks
 *                   → BACK TO SERVICE, who work on it and close
 *          No  → the service team closes there, remarks MANDATORY
 *     → MANAGEMENT REVIEW   one click, "Review done"
 *     → closed
 *
 * ⚠ FIVE STEPS, FOUR QUEUES. `raise` is `noQueue` — raising IS the step — but it
 *   still gets a step_owners row, which is what lets Setup restrict who may raise.
 *
 * ⚠ SERVICE IS ONE BUCKET ENTERED TWICE, and is deliberately ONE step key with
 *   two statuses (`awaiting_service`, `awaiting_service_close`) rather than two
 *   steps. It is the same desk both times; a second key would put a near-duplicate
 *   entry in the sidebar and split one team's work across two queues.
 *
 * ⚠ THIS CHAIN ROUTES TO BUCKETS, NOT TO NAMED PEOPLE. The earlier seven-step
 *   design had each step nominate the next actor; this one does not, so
 *   authorization is entirely the step's owners in Setup. That is what makes
 *   `fms_complaint_can_act` three lines long.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in RequestStatus
 * (types/index.ts), never here.
 */
export type StepKey =
  | "raise"
  | "plant"
  | "service"
  | "approval"
  | "management_review";

/** One scope — a complaint is one entity from raise to close. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * ⚠ `index` is CONTIGUOUS by contract — the pipeline prints it, so a gap reads
 *   as 1,2,3,5.
 * ⚠ ARRAY ORDER is what the default SLA anchor keys off (shared/lib/stepSla), so
 *   re-ordering is a behaviour change even though renumbering is not.
 */
export const STEPS: StepDef[] = [
  { key: "raise", index: 1, title: "Complaint Raised", short: "Raised", scope: "request", noQueue: true },
  { key: "plant", index: 2, title: "Plant Action", short: "Plant", scope: "request" },
  { key: "service", index: 3, title: "Service Team", short: "Service", scope: "request" },
  // CONDITIONAL: only reached when the service team answers "yes" to the
  // commercial call. A step that does not apply is simply never the row's
  // current_step, so its queue never shows it.
  { key: "approval", index: 4, title: "Management Approval", short: "Approval", scope: "request" },
  { key: "management_review", index: 5, title: "Management Review", short: "Review", scope: "request" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/** The steps that can hold work — everything the sidebar offers a queue for. */
export const QUEUE_STEPS: StepKey[] = STEPS.filter((s) => !s.noQueue).map((s) => s.key);

/**
 * The stages the scoreboard rolls the steps into.
 *
 * ⚠ EVERY QUEUE STEP MUST APPEAR IN EXACTLY ONE STAGE. `snapshotFrom` files an
 *   unclaimed step under a trailing "Other" — the loud signal that a step was
 *   added above and forgotten here.
 *
 * One stage per step: the chain is short enough that grouping would hide rather
 * than summarise.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Plant", keys: ["plant"] },
  { label: "Service", keys: ["service"] },
  { label: "Approval", keys: ["approval"] },
  { label: "Management Review", keys: ["management_review"] },
];
