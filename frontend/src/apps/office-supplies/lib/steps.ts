import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The four canonical Office Supplies FMS steps (code-defined, 1-based display index).
 * `key` is the stable identifier used by fms_supplies_step_owners, the SLA config and
 * the queue logic.
 *
 * The workflow is CONDITIONAL: a request that needs no approval (Stationery / Office
 * Maintenance categories, or any Services/Maintenance request) skips first_approval and
 * second_approval and starts at handover. That is handled by the request's `status`
 * (set at submit) — the queue reads status, so a skipped step simply never appears.
 *
 * Statuses are NOT step keys — on_hold / cancelled / rejected / delivered live in
 * RequestStatus (types/index.ts), never here.
 */
export type StepKey = "request" | "first_approval" | "second_approval" | "handover";

/** One scope — a request is one entity from raise to handover. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Request Raised", short: "Request", scope: "request", noQueue: true },
  { key: "first_approval", index: 2, title: "First Approval (HOD)", short: "First Approval", scope: "request" },
  { key: "second_approval", index: 3, title: "Second Approval (Management)", short: "Second Approval", scope: "request" },
  { key: "handover", index: 4, title: "Final Confirmation / Handover", short: "Handover", scope: "request" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The stages the scoreboard rolls the steps into. Two screens read this — the Control
 * Center strip and the cross-FMS scoreboard row — so it lives here, in one place.
 * `request` is `noQueue`, so it never holds work and is absent.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Approval", keys: ["first_approval", "second_approval"] },
  { label: "Handover", keys: ["handover"] },
];
