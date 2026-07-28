/**
 * The 13 canonical Purchase FMS workflow steps (code-defined, 1-based display
 * index). step_key is the stable identifier used by fms_purchase_step_owners and
 * the stage logic. Stages 1–4 act on the request/item-line; 5–13 on the PO.
 *
 * Steps 12–13 are a BRANCH, not part of the happy path: they only ever hold work
 * when a QC inspection rejects something. An approved inspection closes the flow
 * at step 11, and a purchase with no QC-required category closes at step 10.
 *
 * Settling the vendor's balance is an accounts activity on the vendor's credit
 * terms, not a procurement work-item to chase in a queue — balance payments stay
 * *recordable* on PoDetail, but no step tracks them.
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
  | "tally"
  | "qc_inspection"
  | "purchase_return"
  | "gate_outward";

/** Purchase's instance of the shared step shape (see `@/shared/lib/fmsQueue`). */
export type StepDef = StepDefBase<StepKey, "request" | "po">;

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Generate Order (Request)", short: "Request", scope: "request", noQueue: true },
  { key: "sourcing", index: 2, title: "Sourcing — Quotations", short: "Sourcing", scope: "request" },
  { key: "approval", index: 3, title: "Vendor-Price Approval", short: "Approval", scope: "request" },
  { key: "po", index: 4, title: "Generate PO", short: "PO", scope: "request" },
  { key: "share_po", index: 5, title: "Share PO", short: "Share PO", scope: "po" },
  { key: "collect_pi", index: 6, title: "Collect PI(s)", short: "Collect PI", scope: "po" },
  { key: "advance_payment", index: 7, title: "Advance Payment", short: "Advance", scope: "po" },
  { key: "follow_up", index: 8, title: "Follow-up", short: "Follow-up", scope: "po" },
  { key: "inward", index: 9, title: "Inward (GRN)", short: "Inward", scope: "po" },
  { key: "tally", index: 10, title: "System Entry (Tally)", short: "Tally", scope: "po" },
  { key: "qc_inspection", index: 11, title: "QC Inspection", short: "QC", scope: "po" },
  { key: "purchase_return", index: 12, title: "Purchase Return Entry (Tally)", short: "Purchase Return", scope: "po" },
  { key: "gate_outward", index: 13, title: "Gate Register Outward", short: "Gate Outward", scope: "po" },
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
 * Everything in between maps 1:1. Unknown stages resolve to null rather than
 * throwing, matching how `activeIndex` degrades in PoStepper.
 */
export const stageStepKey = (stage: string): StepKey | null => {
  if (stage === "generated") return "po";
  if (stage === "closed") return null;
  return stepByKey(stage)?.key ?? null;
};
