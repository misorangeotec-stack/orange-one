import type { ProductionRequest, ProductionStatus } from "../types";

export const STATUS_LABEL: Record<ProductionStatus, string> = {
  awaiting_material_handover: "Awaiting material handover",
  awaiting_transfer_slip: "Awaiting transfer slip",
  awaiting_production: "Awaiting production entry",
  awaiting_quality: "Awaiting quality checking",
  awaiting_mc_testing: "Awaiting M/C testing",
  awaiting_pm_handover: "Awaiting PM handover",
  awaiting_pm_transfer: "Awaiting PM transfer",
  awaiting_packing: "Awaiting packing entry",
  awaiting_fg_transfer: "Awaiting FG transfer",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** Tailwind text/bg classes per status (mirrors the portal's status-pill palette). */
export const STATUS_TONE: Record<ProductionStatus, string> = {
  awaiting_material_handover: "text-orange bg-orange-soft",
  awaiting_transfer_slip: "text-orange bg-orange-soft",
  awaiting_production: "text-navy bg-navy/[0.06]",
  awaiting_quality: "text-navy bg-navy/[0.06]",
  awaiting_mc_testing: "text-navy bg-navy/[0.06]",
  awaiting_pm_handover: "text-navy bg-navy/[0.06]",
  awaiting_pm_transfer: "text-navy bg-navy/[0.06]",
  awaiting_packing: "text-navy bg-navy/[0.06]",
  awaiting_fg_transfer: "text-orange bg-orange-soft",
  closed: "text-ryg-green bg-[#E9F8EF]",
  on_hold: "text-grey bg-page",
  cancelled: "text-grey-2 bg-page",
};

/** yyyy-mm-dd → dd-mm-yyyy (numeric, per the portal convention). */
export const dmy = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10).split("-").reverse().join("-") : "—";

/** A short one-line label for the job card, for tables. */
export const requestSubject = (r: ProductionRequest): string => r.jobcardNo || r.reqNo;

/** A number → string for display; blank for null. */
export const numOrDash = (n: number | null | undefined): string => (n != null ? String(n) : "—");
