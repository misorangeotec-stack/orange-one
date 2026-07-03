import type { LineStatus } from "../types";

/** ₹ amount in Indian grouping. */
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

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
 * (there is no separate PO "status" anymore). Covers the seven workflow stages
 * plus the two terminal stages (`closed`, `cancelled`) the old status carried.
 */
export const PO_STAGE_LABEL: Record<string, string> = {
  share_po: "Share PO",
  collect_pi: "Collect PI",
  advance_payment: "Advance",
  follow_up: "Follow-up",
  inward: "Inward",
  tally: "Tally",
  final_payment: "Final Pay",
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
  final_payment: "text-teal bg-[#E6F8F6]",
  closed: "text-ryg-green bg-[#E9F8EF]",
  cancelled: "text-grey-2 bg-page",
};

const pill = "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5";
export const lineBadge = (s: LineStatus) => `${pill} ${LINE_STATUS_CLASS[s]}`;
export const poStageBadge = (stage: string) => `${pill} ${PO_STAGE_CLASS[stage] ?? "text-grey-2 bg-page"}`;
