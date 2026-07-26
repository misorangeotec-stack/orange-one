import type { PackingBomLine, ProductionRequest, ProductionStatus } from "../types";

export const STATUS_LABEL: Record<ProductionStatus, string> = {
  awaiting_material_handover: "Awaiting material handover",
  awaiting_rm_transfer: "Awaiting RM transfer to production",
  awaiting_quality: "Awaiting quality checking",
  awaiting_additional_issue_slip: "Awaiting additional issue slip",
  awaiting_transfer_slip: "Awaiting log book entry",
  awaiting_production: "Awaiting production entry",
  awaiting_mc_testing: "Awaiting M/C testing",
  awaiting_pm_handover: "Awaiting PM handover",
  awaiting_pm_transfer: "Awaiting PM transfer",
  awaiting_packing: "Awaiting packing entry",
  awaiting_ready_to_dispatch: "Ready to dispatch",
  awaiting_fg_transfer: "Awaiting FG transfer",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** Tailwind text/bg classes per status (mirrors the portal's status-pill palette). */
export const STATUS_TONE: Record<ProductionStatus, string> = {
  awaiting_material_handover: "text-orange bg-orange-soft",
  awaiting_rm_transfer: "text-orange bg-orange-soft",
  awaiting_quality: "text-navy bg-navy/[0.06]",
  awaiting_additional_issue_slip: "text-ryg-red bg-[#FDECEC]",
  awaiting_transfer_slip: "text-orange bg-orange-soft",
  awaiting_production: "text-navy bg-navy/[0.06]",
  awaiting_mc_testing: "text-navy bg-navy/[0.06]",
  awaiting_pm_handover: "text-navy bg-navy/[0.06]",
  awaiting_pm_transfer: "text-navy bg-navy/[0.06]",
  awaiting_packing: "text-navy bg-navy/[0.06]",
  awaiting_ready_to_dispatch: "text-navy bg-navy/[0.06]",
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

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The FINAL packaging quantity to display everywhere packaging is shown (PM
 * Transfer, Packing Entry, Batch Card): base qty + extra, i.e. the server-computed
 * line `total`. Falls back to qty+extra for any legacy row written before the
 * total column existed; null only when neither qty nor extra is set.
 */
export const packFinalQty = (l: PackingBomLine): number | null =>
  l.total != null ? l.total : l.qty != null || l.extra != null ? round3((l.qty ?? 0) + (l.extra ?? 0)) : null;

/**
 * From per-unit subtotals (a Map of unitName → summed qty), produce the display
 * bits used wherever a multi-unit quantity is totalled:
 *   • perUnit — "10 KGS · 5 LTR" (each unit's own subtotal)
 *   • grand   — the numeric sum across ALL units (10 + 5 = 15)
 *   • multiUnit — true when more than one unit is present, so callers only add the
 *     grand total when it actually differs from a single per-unit total.
 */
export function qtyTotals(totals: Map<string, number>): { perUnit: string; grand: number; multiUnit: boolean } {
  const perUnit = [...totals.entries()].map(([u, q]) => `${round3(q)} ${u}`).join(" · ");
  const grand = round3([...totals.values()].reduce((a, b) => a + b, 0));
  return { perUnit, grand, multiUnit: totals.size > 1 };
}
