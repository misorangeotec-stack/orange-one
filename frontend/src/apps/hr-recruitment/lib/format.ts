import type { RequisitionStatus } from "../types";

/** ₹ with Indian digit grouping, no decimals. */
export const inr = (n: number): string =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * The salary band as HR should read it.
 *
 * The note is the truth — the sheet really does say "If fresh (Zero to two years)
 * 15000/-". The numbers exist only so an offer can be flagged as over-range, so
 * they are shown as a fallback, never instead of what the requester wrote.
 */
export function salaryLabel(min: number | null, max: number | null, note: string | null): string {
  if (note) return note;
  if (min !== null && max !== null) return `${inr(min)} – ${inr(max)}`;
  if (min !== null) return `${inr(min)}+`;
  if (max !== null) return `up to ${inr(max)}`;
  return "—";
}

export const REQ_STATUS_LABEL: Record<RequisitionStatus, string> = {
  hr_review: "Awaiting HR Head",
  mgmt_review: "Awaiting Management",
  sent_back: "Sent back",
  rejected: "Rejected",
  posting: "Ready to post",
  sourcing: "Collecting CVs",
  on_hold: "On hold",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const REQ_STATUS_CLASS: Record<RequisitionStatus, string> = {
  hr_review: "bg-[#FFF7E6] text-yellow",
  mgmt_review: "bg-[#FFF7E6] text-yellow",
  sent_back: "bg-[#FDECEC] text-ryg-red",
  rejected: "bg-[#FDECEC] text-ryg-red",
  posting: "bg-orange/10 text-orange",
  sourcing: "bg-[#E8F3FF] text-navy",
  on_hold: "bg-page text-grey-2",
  closed: "bg-[#E9F7EF] text-ryg-green",
  cancelled: "bg-page text-grey-2",
};
