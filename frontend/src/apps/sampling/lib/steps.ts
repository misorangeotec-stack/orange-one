import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Sampling FMS steps (code-defined, 1-based display index). `key` is the
 * stable identifier used by fms_sampling_step_owners, the SLA config and the
 * queue logic.
 *
 * PATHS through the same row, chosen by `direction` (and, for inward, by
 * `lab_testing_required`):
 *   inward + NO lab testing:  request → sample_collect → sample_received (close)
 *   inward + lab testing:     request → sample_collect → sample_to_lab → lab_process → result_received (close)
 *   outward:                  request → send_sample → confirm_receipt → result (Result Received) → result_handover
 *
 * BOTH inward branches start at `sample_collect` — who collects and whom they hand
 * to is the same question either way. They diverge at the handover receipt: the
 * no-lab branch closes there, the lab branch sends the sample on.
 *
 * `lab_process` is ONE step with TWO passes (it merges what used to be testing +
 * result + result_handover on the inward path):
 *   pass 1 → the tentative result date from the lab; saving it IS the signal the
 *            lab has the sample. The request does NOT move.
 *   pass 2 → testing done: comments + lab report (both required) + whom the result
 *            goes to. THAT advances to result_received.
 * Both passes share one status (`awaiting_lab_process`) because they are one step;
 * `labStartedAt` is what tells them apart. A second status would have split one
 * step across two queues.
 *
 * A step that doesn't apply to a request is simply never its current_step, so its
 * queue never shows it — the queue reads `status`.
 *
 * `receive_sample` and `testing` are both LEGACY. `receive_sample` is how inward
 * requests started before the lab gate existed; `testing` is the step those same
 * legacy rows run next, and it USED to sit on the outward path too until outward
 * dropped it (confirm_receipt now advances straight to `result`). Nothing routes
 * into either any more, but rows raised earlier still sit in them, so both stay
 * wired and their queues self-hide once those rows drain. Both are filed under the
 * `lab` branch, which is where a legacy inward row belongs — and they are ORDERED
 * with it, `receive_sample` then `testing`, so the two Setup screens (which render
 * STEPS as one flat list) don't strand `testing` in the middle of the outward
 * steps it no longer belongs to.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in RequestStatus
 * (types/index.ts), never here.
 */
export type StepKey =
  | "request"
  | "receive_sample"
  | "sample_collect"
  | "sample_received"
  | "sample_to_lab"
  | "lab_process"
  | "result_received"
  | "send_sample"
  | "confirm_receipt"
  | "testing"
  | "result"
  | "result_handover";

/** One scope — a request is one entity from raise to close. */
export type StepScope = "request";

/**
 * WHICH BRANCH A STEP SERVES — the single definition the sidebar, the branch
 * request lists, the Control Center and the dashboard all read, so the split can
 * never be spelled two different ways.
 *
 * A LIST, not one value: `sample_collect` genuinely serves both inward branches
 * and is listed under both sidebar headings. `request` is common to everything and
 * carries none.
 */
export type StepBranch = "no_lab" | "lab" | "outward";

export const BRANCH_LABEL: Record<StepBranch, string> = {
  no_lab: "No Lab Testing",
  lab: "Lab Testing",
  outward: "Outward",
};

export type StepDef = StepDefBase<StepKey, StepScope> & { branches?: StepBranch[] };

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Request Raised", short: "Request", scope: "request", noQueue: true },
  { key: "sample_collect", index: 2, title: "Sample Collect & Handover", short: "Collect", scope: "request", branches: ["no_lab", "lab"] },
  { key: "sample_received", index: 3, title: "Sample Received (Handover)", short: "Sample Recd", scope: "request", branches: ["no_lab"] },
  { key: "sample_to_lab", index: 4, title: "Sample Received & Sent to Lab", short: "To Lab", scope: "request", branches: ["lab"] },
  { key: "lab_process", index: 5, title: "Lab Process", short: "Lab", scope: "request", branches: ["lab"] },
  { key: "result_received", index: 6, title: "Result Received", short: "Result Recd", scope: "request", branches: ["lab"] },
  { key: "receive_sample", index: 7, title: "Sample Received at Lab", short: "Received", scope: "request", branches: ["lab"] },
  // ORDER MATTERS HERE. `testing` sits with the lab block because that is the only
  // branch it still serves — it follows `receive_sample`, the step legacy inward
  // rows reach it from. Leaving it after confirm_receipt (where it used to live,
  // when outward still ran it) put "Testing — Lab Testing" between two outward
  // steps in Setup, which reads like an outward step and is not one.
  { key: "testing", index: 8, title: "Testing", short: "Testing", scope: "request", branches: ["lab"] },
  { key: "send_sample", index: 9, title: "Sample Sent", short: "Sent", scope: "request", branches: ["outward"] },
  { key: "confirm_receipt", index: 10, title: "Receipt Confirmed", short: "Confirmed", scope: "request", branches: ["outward"] },
  // "Result Received" is also the LAB branch's step 6 title. Two different keys,
  // deliberately the same name: on both branches this is the point the result
  // comes back to us. Everywhere they could appear together they are separated by
  // branch — the sidebar blocks, the STAGES below, and the branch shown beside the
  // title in Setup (StepOwnersSection / StepDueDatesSection).
  { key: "result", index: 11, title: "Result Received", short: "Result Recd", scope: "request", branches: ["outward"] },
  { key: "result_handover", index: 12, title: "Result Handover", short: "Handover", scope: "request", branches: ["outward"] },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * THE steps whose owners split by SOURCE — a Domestic dispatch and an Export one
 * are handled by different people, so Setup → Step Owners shows two rows for each
 * of these and the owners live in `fms_sampling_step_source_owners`.
 *
 * `result_handover` is deliberately NOT here: its actor is already chosen per
 * request ("Result handover to"), so a source split would be redundant.
 *
 * ⚠ MIRRORS the SQL function `fms_sampling_step_is_source_scoped(text)` and the
 * CHECK on `fms_sampling_step_source_owners.step_key`. Change one, change all
 * three in the same commit — the UI would otherwise offer an owner mapping the
 * server refuses to store, or hide one it still honours.
 */
export const SOURCE_SCOPED_STEPS = ["send_sample", "confirm_receipt", "result"] as const;

export const isSourceScoped = (key: string): boolean =>
  (SOURCE_SCOPED_STEPS as readonly string[]).includes(key);

/**
 * The branches a step serves, in words — for the two Setup screens that render
 * STEPS as ONE FLAT LIST and so cannot lean on a branch heading to tell rows
 * apart. That matters: `result_received` (lab) and `result` (outward) are both
 * titled "Result Received", and an admin assigning owners has to know which is
 * which. Empty for `request`, which serves every branch.
 */
export const branchLabelsOf = (s: StepDef): string =>
  (s.branches ?? []).map((b) => BRANCH_LABEL[b]).join(" · ");

/** The steps one branch runs through, in workflow order. */
export const stepsInBranch = (branch: StepBranch): StepDef[] =>
  STEPS.filter((s) => s.branches?.includes(branch));

/**
 * The stages the scoreboard rolls the steps into. Two screens read this — the
 * Control Center strip and the cross-FMS scoreboard row — so it lives here.
 * `request` is `noQueue`, so it never holds work and is absent.
 *
 * Grouped by branch, because that is now how the work is actually divided up
 * between people. EVERY queue step must appear in exactly one stage: `snapshotFrom`
 * files an unclaimed step under a trailing "Other", which is a loud signal that
 * something was added here and forgotten.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Collection", keys: ["sample_collect"] },
  { label: "No Lab — Received", keys: ["sample_received"] },
  { label: "Lab — To Lab", keys: ["sample_to_lab", "receive_sample"] },
  // `testing` rides with the lab process: it is the legacy inward equivalent, and
  // is no longer on the outward path at all.
  { label: "Lab — Process", keys: ["lab_process", "testing"] },
  { label: "Lab — Result Received", keys: ["result_received"] },
  { label: "Outward — Movement", keys: ["send_sample", "confirm_receipt"] },
  { label: "Outward — Result Received", keys: ["result", "result_handover"] },
];
