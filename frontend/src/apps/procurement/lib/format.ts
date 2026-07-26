import type { LineStatus } from "../types";

/** ₹ amount in Indian grouping. */
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Sum a set of line quantities for a "Total Qty" display. A currency is uniform
 * per requisition but UNITS ARE NOT — a line carries its own unit (KGS, PCS, …),
 * so a bare sum across mixed units would be misleading. Convention (shared with
 * the queue "Total Qty" columns): sum the numbers, show the unit when every line
 * shares one, otherwise label the total "mixed" with a hover listing the units.
 * Rounded to 3 dp so fractional quantities don't show float noise.
 */
export interface QtyEntry {
  qty: number;
  unit?: string | null;
}
export interface QtyTotalValue {
  total: number;
  label: string;
  title?: string;
}
export const sumQty = (entries: QtyEntry[]): QtyTotalValue => {
  const total = Math.round(entries.reduce((sum, e) => sum + (e.qty || 0), 0) * 1000) / 1000;
  const units = [...new Set(entries.map((e) => e.unit).filter(Boolean))] as string[];
  if (units.length === 1) return { total, label: units[0] };
  if (units.length === 0) return { total, label: "" };
  return { total, label: "mixed", title: `Different units: ${units.join(", ")}` };
};

/** `sumQty` rendered as a plain string ("3000 KGS", "3500 mixed") — e.g. a Kpi hint. */
export const qtyText = (entries: QtyEntry[]): string => {
  const q = sumQty(entries);
  return q.label ? `${q.total} ${q.label}` : `${q.total}`;
};

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  sourcing: "Sourcing",
  approval: "Awaiting Approval",
  on_hold: "On Hold",
  approved_pending_po: "Approved · Pool",
  po: "On PO",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const LINE_STATUS_CLASS: Record<LineStatus, string> = {
  sourcing: "text-blue bg-[#EAF1FE]",
  approval: "text-orange bg-orange-soft",
  on_hold: "text-yellow bg-[#FFF7E6]",
  approved_pending_po: "text-teal bg-[#E6F8F6]",
  po: "text-ryg-green bg-[#E9F8EF]",
  rejected: "text-ryg-red bg-[#FDECEC]",
  cancelled: "text-grey-2 bg-page",
};

/**
 * The PO's single state axis is `current_stage` — one coloured badge everywhere
 * (there is no separate PO "status" anymore). Covers the six workflow stages
 * plus the two terminal stages (`closed`, `cancelled`) the old status carried.
 */
export const PO_STAGE_LABEL: Record<string, string> = {
  share_po: "Share PO",
  collect_pi: "Collect PI",
  advance_payment: "Advance",
  follow_up: "Follow-up",
  inward: "Inward",
  tally: "Tally",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const PO_STAGE_CLASS: Record<string, string> = {
  share_po: "text-blue bg-[#EAF1FE]",
  collect_pi: "text-orange bg-orange-soft",
  advance_payment: "text-yellow bg-[#FFF7E6]",
  follow_up: "text-orange bg-orange-soft",
  inward: "text-teal bg-[#E6F8F6]",
  tally: "text-teal bg-[#E6F8F6]",
  closed: "text-ryg-green bg-[#E9F8EF]",
  cancelled: "text-grey-2 bg-page",
};

const pill = "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5";
export const lineBadge = (s: LineStatus) => `${pill} ${LINE_STATUS_CLASS[s]}`;
export const poStageBadge = (stage: string) => `${pill} ${PO_STAGE_CLASS[stage] ?? "text-grey-2 bg-page"}`;
