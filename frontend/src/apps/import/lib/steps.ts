/**
 * The canonical Import Purchase FMS workflow steps (code-defined, 1-based
 * display index). step_key is the stable identifier used by fms_import_step_owners
 * and the stage logic. Stages 1–2 act on the request/item-line; 3–7 on the PO.
 *
 * Import is a PURE QUANTITY REQUISITION: there is no rate, no exchange rate, no
 * value, and NO money-side steps. `sourcing`, `collect_pi` and `advance_payment`
 * are kept in the StepKey union so the shared queue/SLA plumbing type-checks, but
 * they are absent from STEPS — so no queue, nav entry, or stepper node is ever
 * shown for them, and no line/PO ever routes into them (submit_request enters
 * lines directly at `approval`; share_po advances straight to `follow_up`).
 *
 * The flow ends at `tally`, and a PO closes on goods received (GRN) + Tally.
 */
import type { StepDefBase } from "@/shared/lib/fmsQueue";

export type StepKey =
  | "request"
  | "sourcing"
  | "approval"
  | "po"
  | "share_po"
  | "collect_pi"
  | "advance_payment"
  | "follow_up"
  | "inward"
  | "tally";

/** Import's instance of the shared step shape (see `@/shared/lib/fmsQueue`). */
export type StepDef = StepDefBase<StepKey, "request" | "po">;

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Generate Order (Request)", short: "Request", scope: "request", noQueue: true },
  { key: "approval", index: 2, title: "Purchase Approval", short: "Approval", scope: "request" },
  { key: "po", index: 3, title: "Generate PO", short: "PO", scope: "request" },
  { key: "share_po", index: 4, title: "Share PO", short: "Share PO", scope: "po" },
  { key: "follow_up", index: 5, title: "Follow-up", short: "Follow-up", scope: "po" },
  { key: "inward", index: 6, title: "Inward (GRN)", short: "Inward", scope: "po" },
  { key: "tally", index: 7, title: "System Entry (Tally)", short: "Tally", scope: "po" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * Maps a PO-detail *stepper stage* to the workflow *step* whose owners are
 * responsible for it. The two lists are deliberately different: the stepper is
 * a PO-lifecycle view, so it opens on `generated` (the PO already exists) and
 * closes on `closed` (past the last real step).
 *
 *   generated → `po`   — the step that PRODUCES this PO; its owners are the
 *                        people who raised it.
 *   closed    → null   — no step tracks it; the flow ends at `tally`.
 *
 * Everything in between maps 1:1. Unknown stages (including a legacy PO parked
 * on the retired `collect_pi`/`advance_payment` stages) resolve to null rather
 * than throwing, matching how `activeIndex` degrades in PoStepper.
 */
export const stageStepKey = (stage: string): StepKey | null => {
  if (stage === "generated") return "po";
  if (stage === "closed") return null;
  return stepByKey(stage)?.key ?? null;
};
