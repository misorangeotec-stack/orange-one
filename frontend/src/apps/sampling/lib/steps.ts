import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Sampling FMS steps (code-defined, 1-based display index). `key` is the
 * stable identifier used by fms_sampling_step_owners, the SLA config and the
 * queue logic.
 *
 * TWO PATHS through the same row, chosen by `direction`:
 *   inward  : request → receive_sample → testing → result
 *   outward : request → send_sample → confirm_receipt → testing → result
 * They converge at `testing`. A step that doesn't apply to a request's direction
 * is simply never its current_step, so its queue never shows it — the queue reads
 * `status`, so a skipped step never appears.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in RequestStatus
 * (types/index.ts), never here.
 */
export type StepKey = "request" | "receive_sample" | "send_sample" | "confirm_receipt" | "testing" | "result";

/** One scope — a request is one entity from raise to result. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Request Raised", short: "Request", scope: "request", noQueue: true },
  { key: "receive_sample", index: 2, title: "Sample Received", short: "Received", scope: "request" },
  { key: "send_sample", index: 3, title: "Sample Sent", short: "Sent", scope: "request" },
  { key: "confirm_receipt", index: 4, title: "Receipt Confirmed", short: "Confirmed", scope: "request" },
  { key: "testing", index: 5, title: "Testing", short: "Testing", scope: "request" },
  { key: "result", index: 6, title: "Result", short: "Result", scope: "request" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The stages the scoreboard rolls the steps into. Two screens read this — the
 * Control Center strip and the cross-FMS scoreboard row — so it lives here.
 * `request` is `noQueue`, so it never holds work and is absent.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Movement", keys: ["receive_sample", "send_sample", "confirm_receipt"] },
  { label: "Testing", keys: ["testing"] },
  { label: "Result", keys: ["result"] },
];
