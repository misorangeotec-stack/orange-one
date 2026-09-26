import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Complaint (RM/FG) FMS steps. `key` is the stable identifier used by
 * fms_complaint_step_owners, the SLA config and the queue logic.
 *
 * TWO CHAINS SHARE ONE LIST, forked at the raise panel.
 *
 *   FINISHED GOOD
 *     raise
 *       → PLANT       check it, do the corrective action, remarks + attachment
 *       → SERVICE     remarks, conclusion, "Commercial call taken?" Yes / No
 *            Yes → APPROVAL  management, on the commercial-call remarks
 *                     → BACK TO SERVICE, who work on it and close
 *            No  → the service team closes there, remarks MANDATORY
 *       → MANAGEMENT REVIEW   one click, "Review done"
 *       → closed
 *
 *   RAW MATERIAL · DOMESTIC        (`rmOrigin === "domestic"`)
 *     raise → PURCHASE            remarks, submit
 *           → MANAGEMENT REVIEW   review + close
 *
 *   RAW MATERIAL · IMPORT          (`rmOrigin === "import"`)
 *     raise → RM-COMPLAINT VIEW (MGT)   remarks → close,  OR  reassign to a person
 *           → ASSIGNEE                  that person's remarks, submit
 *           → MANAGEMENT REVIEW         review + close
 *
 * ⚠ THE RAW-MATERIAL BRANCH SKIPS THE PLANT AND THE SERVICE TEAM ENTIRELY, and
 *   that is the point of it: a finished-good complaint is a customer complaining
 *   to us, so our plant has something to answer for; a raw-material complaint is
 *   US complaining to a supplier, and the desk that owns it is Purchase or
 *   Management. A step that does not apply is simply never the row's
 *   `current_step`, so its queue never shows it — no per-branch filtering is
 *   needed anywhere.
 *
 * ⚠ `raise` is `noQueue` — raising IS the step — but it still gets a
 *   step_owners row, which is what lets Setup restrict who may raise.
 *
 * ⚠ SERVICE IS ONE BUCKET ENTERED TWICE — one step key (`service`) with two
 *   statuses, because it is the same desk asked the same kind of question.
 *   lib/queues.ts `servicePass` is what tells the modal which pass it is.
 *
 * ⚠ MANAGEMENT IS **TWO** STEPS, NOT ONE, AND THAT WAS A DELIBERATE REVERSAL.
 *   It was first built the way `service` is — one key, two statuses — on the
 *   reasoning that management is one desk. The user asked for them split, and
 *   they are right: the two passes are not the same job. `rm_management` is
 *   WORK — read an imported-material complaint, answer it or hand it to
 *   somebody. `management_review` is a SIGN-OFF — one click on something already
 *   settled. Folding them together meant one queue mixing "decide this" with
 *   "acknowledge that", and one Setup row that could not staff them separately.
 *   They also carry different SLAs for the same reason.
 *
 * ⚠ `assignee` IS THE ONE STEP THAT ROUTES TO A NAMED PERSON. Every other step
 *   routes to a BUCKET whose members are the step's owners in Setup; `assignee`
 *   is owned by whoever management put on the row (`rmAssigneeId`), which is why
 *   `fms_complaint_can_act` — and its mirror in store.tsx — carries one
 *   per-request arm. Do NOT configure owners for it in Setup; there is nobody to
 *   configure.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in RequestStatus
 * (types/index.ts), never here.
 */
export type StepKey =
  | "raise"
  | "plant"
  | "service"
  | "approval"
  | "purchase"
  | "rm_management"
  | "assignee"
  | "management_review";

/** One scope — a complaint is one entity from raise to close. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * ⚠ `index` is CONTIGUOUS by contract — the pipeline prints it, so a gap reads
 *   as 1,2,3,5.
 * ⚠ ARRAY ORDER IS A CONTRACT TOO: `anchorOptions` (shared/lib/stepSla) only
 *   lets a step be anchored on a STRICTLY EARLIER one, so `rm_management` must
 *   precede `assignee` (which anchors on it) and `management_review` comes last,
 *   as every chain's terminus. The array is the SLA's ordering, not the rail's —
 *   the per-complaint rail is ComplaintStepper's own FLOW, which knows about the
 *   branches.
 * ⚠ It is also what the default SLA anchor keys off, so re-ordering is a
 *   behaviour change even though renumbering is not.
 */
export const STEPS: StepDef[] = [
  { key: "raise", index: 1, title: "Complaint Raised", short: "Raised", scope: "request", noQueue: true },
  /* --- the finished-good chain --- */
  { key: "plant", index: 2, title: "Plant Action", short: "Plant", scope: "request" },
  { key: "service", index: 3, title: "Service Team", short: "Service", scope: "request" },
  // CONDITIONAL: only reached when the service team answers "yes" to the
  // commercial call. A step that does not apply is simply never the row's
  // current_step, so its queue never shows it.
  { key: "approval", index: 4, title: "Management Approval", short: "Approval", scope: "request" },
  /* --- the raw-material branch --- */
  // Domestic material only.
  { key: "purchase", index: 5, title: "Purchase Department", short: "Purchase", scope: "request" },
  // Imported material only. Management READ the complaint here and either answer
  // it or hand it on — work, not a sign-off. Named as the user named it.
  { key: "rm_management", index: 6, title: "RM-Complaint View (MGT)", short: "Review", scope: "request" },
  // Imported material that management handed to somebody. Owned by the person on
  // the row, not by Setup — see the header.
  { key: "assignee", index: 7, title: "Assigned to Me", short: "Respond", scope: "request" },
  /* --- shared terminus --- */
  // The final sign-off EVERY chain ends on, FG and RM alike.
  { key: "management_review", index: 8, title: "Management Review", short: "Review", scope: "request" },
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
  { label: "Purchase", keys: ["purchase"] },
  { label: "RM (MGT)", keys: ["rm_management"] },
  { label: "Assigned", keys: ["assignee"] },
  { label: "Management Review", keys: ["management_review"] },
];
