import type { CaseStatus, CaseType, ManagerRecommendation } from "../types";

/**
 * How an exit case's status reads to a human, and the chip it wears.
 *
 * These are STATUSES, never StepKeys — the two lists are deliberately disjoint (see
 * types/index.ts). `on_hold` is grey, not red: a parked case is not late work, and
 * colouring it as though it were is how a hold silently becomes an alarm nobody can
 * act on.
 */
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  manager_review: "With the manager",
  hr_review: "With HR",
  head_approval: "Awaiting HR Head",
  clearance: "Exit & clearance",
  settlement: "Settlement",
  closure: "Closure",
  on_hold: "On hold",
  withdrawn: "Withdrawn",
  rejected: "Rejected",
  archived: "Archived",
};

export const CASE_STATUS_CLASS: Record<CaseStatus, string> = {
  manager_review: "bg-[#FFF7E6] text-yellow",
  hr_review: "bg-[#FFF7E6] text-yellow",
  head_approval: "bg-[#FFF7E6] text-yellow",
  clearance: "bg-orange/10 text-orange",
  settlement: "bg-[#E8F3FF] text-navy",
  closure: "bg-[#E8F3FF] text-navy",
  on_hold: "bg-page text-grey-2",
  withdrawn: "bg-page text-grey-2",
  rejected: "bg-[#FDECEC] text-ryg-red",
  archived: "bg-[#E9F7EF] text-ryg-green",
};

/**
 * Absconding / termination / retirement are a CASE TYPE, not a workflow branch. The
 * real-world holes they open (an absconder has no handover; a terminated employee
 * gets no relieving letter) are covered by skipping the step, with a reason.
 */
export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  absconding: "Absconding",
  end_of_contract: "End of contract",
};

/** The manager's answer. A recommendation — never a veto. */
export const RECOMMENDATION_LABEL: Record<ManagerRecommendation, string> = {
  accept: "Accepted",
  reject: "Would not accept",
  discuss: "Wants to discuss",
};

export const RECOMMENDATION_CLASS: Record<ManagerRecommendation, string> = {
  accept: "bg-[#E9F7EF] text-ryg-green",
  reject: "bg-[#FDECEC] text-ryg-red",
  discuss: "bg-[#FFF7E6] text-yellow",
};

/** "30 days · waived" — the notice period as HR reads it. */
export function noticeLabel(days: number | null, waived: boolean): string {
  if (days === null) return waived ? "Waived" : "—";
  return waived ? `${days} days · waived` : `${days} days`;
}

/**
 * ₹ with Indian digit grouping.
 *
 * `null` renders as an em dash, and on the F&F that is a REAL VALUE, not a gap to be
 * papered over with a zero: `fnf_amount` is nullable because the portal holds no salary
 * data, so payroll may simply not have stated a net figure yet. "—" says that. "₹0" says
 * they settled for nothing.
 */
export const money = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? "—"
    : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Days, as payroll writes them. `2.5` stays `2.5`; `2.00` reads as `2`. */
export const days = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `${Number(n)} day${Number(n) === 1 ? "" : "s"}`;
