import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Production Entry FMS steps (code-defined, 1-based display index). `key` is
 * the stable identifier used by fms_production_step_owners, the SLA config and the
 * queue logic.
 *
 * A STRICTLY LINEAR chain — one job card moves through the ten steps in order:
 *   issue_slip → material_handover → transfer_slip → production_entry →
 *   quality_check → mc_testing → pm_handover → pm_transfer → packing_entry →
 *   fg_transfer → closed
 *
 * `issue_slip` is the origin (raising the job card) and holds no queue; steps 2–10
 * each own a queue. Queue membership reads `status`, so a held / closed / cancelled
 * card leaves every queue.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in ProductionStatus
 * (types/index.ts), never here.
 */
export type StepKey =
  | "issue_slip"
  | "material_handover"
  | "rm_transfer"
  | "transfer_slip"
  | "production_entry"
  | "quality_check"
  | "mc_testing"
  | "pm_handover"
  | "pm_transfer"
  | "packing_entry"
  | "fg_transfer";

/** One scope — a job card is one entity from issue slip to finished-good transfer. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "issue_slip", index: 1, title: "Generate Issue Slip", short: "Issue Slip", scope: "request", noQueue: true },
  { key: "material_handover", index: 2, title: "Material Handover Confirmation", short: "Handover", scope: "request" },
  { key: "rm_transfer", index: 3, title: "RM Transfer to Production", short: "RM Transfer", scope: "request" },
  { key: "transfer_slip", index: 4, title: "Log Book Entry", short: "Log Book", scope: "request" },
  { key: "production_entry", index: 5, title: "Production Entry", short: "Production", scope: "request" },
  { key: "quality_check", index: 6, title: "Quality Checking", short: "Quality", scope: "request" },
  { key: "mc_testing", index: 7, title: "Testing of M/C", short: "M/C Testing", scope: "request" },
  { key: "pm_handover", index: 8, title: "Packing Material Handover", short: "PM Handover", scope: "request" },
  { key: "pm_transfer", index: 9, title: "Packing Material Transfer", short: "PM Transfer", scope: "request" },
  { key: "packing_entry", index: 10, title: "Packing Entry", short: "Packing", scope: "request" },
  { key: "fg_transfer", index: 11, title: "FG Transfer to Hojiwala", short: "FG Transfer", scope: "request" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The stages the scoreboard rolls the ten steps into. Two screens read this — the
 * Control Center strip and the cross-FMS scoreboard row — so it lives here.
 * `issue_slip` is `noQueue`, so it never holds work and is absent.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Handover & Log Book", keys: ["material_handover", "rm_transfer", "transfer_slip"] },
  { label: "Production", keys: ["production_entry"] },
  { label: "Quality", keys: ["quality_check", "mc_testing"] },
  { label: "Packing", keys: ["pm_handover", "pm_transfer", "packing_entry"] },
  { label: "Dispatch", keys: ["fg_transfer"] },
];
