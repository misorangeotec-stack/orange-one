import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Asset Maintenance FMS steps (code-defined, 1-based display index). `key` is
 * the stable identifier used by fms_asset_step_owners, the SLA config and the
 * queue logic.
 *
 * A STRICTLY LINEAR chain:
 *   service_due → schedule → service_done → verify_close → closed
 *
 * ⚠ THE WORKFLOW ENTITY IS THE JOB, NOT THE ASSET. An asset never "completes" —
 *   it lives for years and throws off work repeatedly. What runs this chain is a
 *   SERVICE JOB: one trip through the steps for one dated track on one asset.
 *   Assets and their schedules are the register (types/index.ts); only the job
 *   has steps, owners, a queue and an SLA.
 *
 * `service_due` is the origin — a job is BORN at this step, opened by the nightly
 * generator when a track enters its reminder window (or by a meter reading, or by
 * hand). It holds no queue; every other step owns one. Queue membership reads
 * `status`, so a held / closed / cancelled / skipped job leaves every queue.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled / skipped live in
 * JobStatus (types/index.ts), never here. In particular there is no step for
 * "rework": a failed verification sends the job BACK to `service_done`, which is
 * a status move, not a fourth stage.
 *
 * ⚠ The ARRAY ORDER is semantic — `createStepSlaModel` derives each step's default
 *   anchor from the position of the one before it. Renumbering `index` is
 *   cosmetic; reordering this array is not.
 */
export type StepKey = "service_due" | "schedule" | "service_done" | "verify_close";

/** One scope — a job is one entity from raised to closed. */
export type StepScope = "job";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "service_due",  index: 1, title: "Service Due",       short: "Due",      scope: "job", noQueue: true },
  { key: "schedule",     index: 2, title: "Schedule Service",  short: "Schedule", scope: "job" },
  { key: "service_done", index: 3, title: "Record Service",    short: "Service",  scope: "job" },
  { key: "verify_close", index: 4, title: "Verify & Close",    short: "Verify",   scope: "job" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The stages the scoreboards roll the three queue steps into. Two screens read
 * this — this app's Control Center strip and the cross-FMS scoreboard row — so it
 * lives here. `service_due` is `noQueue`, never holds work, and is absent.
 *
 * One step per stage: the chain is short enough that grouping would hide rather
 * than summarise.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Scheduling",   keys: ["schedule"] },
  { label: "Service",      keys: ["service_done"] },
  { label: "Verification", keys: ["verify_close"] },
];
