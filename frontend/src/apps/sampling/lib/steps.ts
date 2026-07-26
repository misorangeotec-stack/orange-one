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
 *   outward:                  request → send_sample → confirm_receipt → testing → result → result_handover
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
 * `receive_sample` is LEGACY: it is how inward requests started before the lab gate
 * existed. Nothing routes into it any more, but rows raised then still sit in it, so
 * it stays wired and its queue self-hides once they drain.
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
  { key: "send_sample", index: 8, title: "Sample Sent", short: "Sent", scope: "request", branches: ["outward"] },
  { key: "confirm_receipt", index: 9, title: "Receipt Confirmed", short: "Confirmed", scope: "request", branches: ["outward"] },
  { key: "testing", index: 10, title: "Testing", short: "Testing", scope: "request", branches: ["outward"] },
  { key: "result", index: 11, title: "Result", short: "Result", scope: "request", branches: ["outward"] },
  { key: "result_handover", index: 12, title: "Result Handover", short: "Handover", scope: "request", branches: ["outward"] },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

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
  { label: "Lab — Process", keys: ["lab_process"] },
  { label: "Lab — Result Received", keys: ["result_received"] },
  { label: "Outward — Movement", keys: ["send_sample", "confirm_receipt"] },
  { label: "Outward — Testing & Result", keys: ["testing", "result", "result_handover"] },
];
