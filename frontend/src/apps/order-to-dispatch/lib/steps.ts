import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The Order to Dispatch FMS steps (code-defined, 1-based display index). `key` is
 * the stable identifier used by fms_dispatch_step_owners, the SLA config and the
 * queue logic.
 *
 * A LINEAR chain THAT CAN REPEAT:
 *   sales_order → credit_check → material_status → sales_bill → gate_out →
 *   dispatch_confirm → (back to material_status for the next round, or closed)
 *
 * `sales_order` is the origin (raising the order) and holds no queue; every other
 * step owns one. Queue membership reads `status`, so a held / closed / cancelled
 * order leaves every queue, and an order that loops re-enters the material-status
 * queue as round N+1.
 *
 * Statuses are NOT step keys — closed / on_hold / cancelled live in DispatchStatus
 * (types/index.ts), never here.
 *
 * The old fourth step, "Confirm LOT No. & Final Qty", was folded into
 * material_status in the 2026-08 reshape: picking which lines go out, how much of
 * each and from which LOT is one decision made at one moment by one person, and
 * splitting it across two steps made partial dispatch impossible to express.
 *
 * ⚠ The ARRAY ORDER is semantic — `createStepSlaModel` derives each step's default
 *   anchor from the position of the one before it. Renumbering `index` is
 *   cosmetic; reordering this array is not.
 */
export type StepKey =
  | "sales_order"
  | "credit_check"
  | "material_status"
  | "sales_bill"
  | "gate_out"
  | "dispatch_confirm";

/** One scope — an order is one entity from receipt to delivery. */
export type StepScope = "order";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "sales_order",      index: 1, title: "Sales Order",              short: "Order",      scope: "order", noQueue: true },
  { key: "credit_check",     index: 2, title: "Confirm Credit Limit",     short: "Credit",     scope: "order" },
  { key: "material_status",  index: 3, title: "Check Material Status",    short: "Stock",      scope: "order" },
  { key: "sales_bill",       index: 4, title: "Generate Sales Bill",      short: "Sales Bill", scope: "order" },
  { key: "gate_out",         index: 5, title: "Gate Outward Entry",       short: "Gate Out",   scope: "order" },
  { key: "dispatch_confirm", index: 6, title: "Confirmation on Dispatch", short: "Delivered",  scope: "order" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The stages the scoreboards roll the five queue steps into. Two screens read
 * this — this app's Control Center strip and the cross-FMS scoreboard row — so it
 * lives here. `sales_order` is `noQueue`, never holds work, and is absent.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Credit",         keys: ["credit_check"] },
  { label: "Stock",          keys: ["material_status"] },
  { label: "Billing & Gate", keys: ["sales_bill", "gate_out"] },
  { label: "Delivery",       keys: ["dispatch_confirm"] },
];
