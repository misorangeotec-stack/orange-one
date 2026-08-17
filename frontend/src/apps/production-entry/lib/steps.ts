import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Production Entry FMS steps (code-defined, 1-based display index). `key` is
 * the stable identifier used by fms_production_step_owners, the SLA config and the
 * queue logic.
 *
 * A mostly LINEAR chain with ONE branch (additional_issue_slip). The order:
 *   issue_slip → material_handover → rm_transfer → quality_check →
 *   transfer_slip(log book) → production_entry → mc_testing → pm_transfer →
 *   packing_entry → ready_to_dispatch → fg_transfer → closed
 * QC reject branches to additional_issue_slip, which re-enters material_handover.
 *
 * `issue_slip` is the origin (raising the job card) and holds no queue; every
 * other step owns a queue. Queue membership reads `status`, so a held / closed /
 * cancelled card leaves every queue.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in ProductionStatus
 * (types/index.ts), never here.
 */
export type StepKey =
  | "issue_slip"
  | "material_handover"
  | "rm_transfer"
  | "quality_check"
  | "additional_issue_slip"
  | "transfer_slip"
  | "production_entry"
  | "mc_testing"
  | "pm_transfer"
  | "packing_entry"
  | "ready_to_dispatch"
  | "fg_transfer";

/** One scope — a job card is one entity from issue slip to finished-good transfer. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "issue_slip", index: 1, title: "Generate Issue Slip", short: "Issue Slip", scope: "request", noQueue: true },
  { key: "material_handover", index: 2, title: "Material Handover Confirmation", short: "Handover", scope: "request" },
  { key: "rm_transfer", index: 3, title: "RM Transfer to Production (Tally)", short: "RM Transfer", scope: "request" },
  { key: "quality_check", index: 4, title: "Quality Checking", short: "Quality", scope: "request" },
  { key: "additional_issue_slip", index: 5, title: "Generate Additional Issue Slip", short: "Add'l Issue Slip", scope: "request" },
  { key: "transfer_slip", index: 6, title: "Log Book Entry", short: "Log Book", scope: "request" },
  { key: "production_entry", index: 7, title: "Production Entry (Tally)", short: "Production", scope: "request" },
  { key: "mc_testing", index: 8, title: "Testing of M/C", short: "M/C Testing", scope: "request" },
  { key: "pm_transfer", index: 9, title: "Packing Material Transfer (Tally)", short: "PM Transfer", scope: "request" },
  { key: "packing_entry", index: 10, title: "Packing Entry (Tally)", short: "Packing", scope: "request" },
  { key: "ready_to_dispatch", index: 11, title: "Ready to Dispatch", short: "Dispatch", scope: "request" },
  { key: "fg_transfer", index: 12, title: "FG Transfer to Godown (Tally)", short: "FG Transfer", scope: "request" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The steps a REPACKAGING card never runs. A traded FG is imported ready-made and
 * only repacked, so there is no material to hand over, transfer, test, log or
 * produce. Such a card is raised straight into `pm_transfer` and runs the tail —
 * pm_transfer → packing_entry → ready_to_dispatch → fg_transfer — unchanged.
 *
 * ⚠ Presentation only. Queue membership is driven by `status`, which the intake
 * RPC sets to `awaiting_pm_transfer`, so a bypassed step can never hold a
 * repackaging card regardless of this list. It exists so the rail and the detail
 * page can SAY the steps don't apply rather than showing them as merely pending.
 */
export const REPACK_BYPASSED_STEPS: StepKey[] = [
  "material_handover",
  "rm_transfer",
  "quality_check",
  "additional_issue_slip",
  "transfer_slip",
  "production_entry",
  "mc_testing",
];

/** Does this card type run this step? */
export const stepAppliesTo = (cardType: "production" | "repackaging", key: StepKey): boolean =>
  cardType !== "repackaging" || !REPACK_BYPASSED_STEPS.includes(key);

/**
 * The stages the scoreboard rolls the ten steps into. Two screens read this — the
 * Control Center strip and the cross-FMS scoreboard row — so it lives here.
 * `issue_slip` is `noQueue`, so it never holds work and is absent.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Handover & QC", keys: ["material_handover", "rm_transfer", "quality_check", "additional_issue_slip"] },
  { label: "Log Book & Production", keys: ["transfer_slip", "production_entry"] },
  { label: "M/C Testing", keys: ["mc_testing"] },
  { label: "Packing", keys: ["pm_transfer", "packing_entry"] },
  { label: "Dispatch", keys: ["ready_to_dispatch", "fg_transfer"] },
];
