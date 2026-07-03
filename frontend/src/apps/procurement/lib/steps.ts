/**
 * The 11 canonical Purchase FMS workflow steps (code-defined, 1-based display
 * index). step_key is the stable identifier used by fms_purchase_step_owners and
 * the stage logic. Stages 1–4 act on the request/item-line; 5–11 on the PO.
 */
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
  | "final_payment";

export interface StepDef {
  key: StepKey;
  index: number; // 1-based
  title: string;
  short: string;
  scope: "request" | "po";
}

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Generate Order (Request)", short: "Request", scope: "request" },
  { key: "sourcing", index: 2, title: "Sourcing — Quotations", short: "Sourcing", scope: "request" },
  { key: "approval", index: 3, title: "Vendor-Price Approval", short: "Approval", scope: "request" },
  { key: "po", index: 4, title: "Generate PO", short: "PO", scope: "request" },
  { key: "share_po", index: 5, title: "Share PO", short: "Share PO", scope: "po" },
  { key: "collect_pi", index: 6, title: "Collect PI(s)", short: "Collect PI", scope: "po" },
  { key: "advance_payment", index: 7, title: "Advance Payment", short: "Advance", scope: "po" },
  { key: "follow_up", index: 8, title: "Follow-up", short: "Follow-up", scope: "po" },
  { key: "inward", index: 9, title: "Inward (GRN)", short: "Inward", scope: "po" },
  { key: "tally", index: 10, title: "System Entry (Tally)", short: "Tally", scope: "po" },
  { key: "final_payment", index: 11, title: "Final Payment", short: "Final Pay", scope: "po" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);
