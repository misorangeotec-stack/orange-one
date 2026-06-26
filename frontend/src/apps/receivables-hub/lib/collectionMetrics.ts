/**
 * Pure helpers for the Monthly Collection Report (v2) and its snapshot capture.
 *
 * These replicate the EXACT "open due" + "start-of-month opening" math used by the
 * existing Salesperson Collection Report (pages/SalespersonCollectionReport.tsx,
 * metricsForMonth + startMonthOutstanding) so the frozen snapshot reconciles to that
 * report. They are extracted here (rather than refactoring the existing report) so both
 * the capture action and the v2 report's fallback path share one definition.
 *
 * All amounts are in RUPEES (trend amounts are stored in lakhs → ×100_000).
 */
import type { Customer, CustomerDetail } from "@hub/lib/types";

const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** "Jun-26" → Date for the last calendar day of that month (local, end-of-day). */
export function monthLabelToEndDate(label: string): Date {
  const [mon, yy] = label.split("-");
  const monthIdx = MONTH_IDX[mon] ?? 0;
  const year = 2000 + parseInt(yy, 10);
  return new Date(year, monthIdx + 1, 0, 23, 59, 59, 999);
}

/** ISO date "2025-08-15" → trend month label "Aug-25" (matches trend.month). */
export function isoToMonthLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTH_ABBR[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

/**
 * Bills due by month-end still OPEN ("still to collect"), split into the already-overdue
 * portion and the not-yet-overdue "coming due before month-end" portion (`dueSoon`).
 *
 *  - Current/as-of month: live invoice pending + the pipeline's canonical overdue
 *    (c.overdue — reconciles to the dashboard, already capped ≤ outstanding & advance-aware).
 *  - Past months: the stored month-end snapshot (trend.overdue); no coming-due split.
 *
 * Mirrors SalespersonCollectionReport.tsx metricsForMonth (the `openDue` / `dueSoon` block).
 */
export function computeOpenDue(
  c: Customer,
  detail: CustomerDetail | undefined,
  month: string,
  asOfMonth: string,
  asOfDate: string,
): { due: number; dueSoon: number } {
  if (month === asOfMonth) {
    const monthEnd = monthLabelToEndDate(month);
    const asOf = new Date(asOfDate);
    let dueSoon = 0;
    for (const inv of detail?.invoices ?? []) {
      if (inv.pending > 0 && (inv.overdueDays ?? 0) <= 0) {
        const dd = new Date(inv.dueDate);
        if (dd > asOf && dd <= monthEnd) dueSoon += inv.pending;
      }
    }
    return { due: c.overdue + dueSoon, dueSoon };
  }
  const mt = detail?.trend.find((t) => t.month === month);
  return { due: (mt?.overdue ?? 0) * 100_000, dueSoon: 0 };
}

/** This month's collections (rupees, unprojected) = Tally receipts + manual other payments. */
export function receivedForMonth(detail: CustomerDetail | undefined, month: string): number {
  const receipts = (detail?.trend.find((t) => t.month === month)?.receipts ?? 0) * 100_000;
  let other = 0;
  for (const o of detail?.otherPaymentTransactions ?? []) {
    if (o.date && isoToMonthLabel(o.date) === month) other += o.amount;
  }
  return receipts + other;
}

/**
 * Frozen month-START opening = the start-of-month balance, reconstructed the SAME way the
 * existing report does: max(outstanding + this-month's receipts, due). This reconciles to
 * the dashboard's net (advance-aware) balance — captured on the 1st, receipts ≈ 0 so it
 * equals that day's outstanding; captured mid-month, it adds the month's collections back.
 *
 *  - Current/as-of month: live net balance (c.outstanding).
 *  - Past months: that month's stored month-end balance (trend.outstanding).
 *
 * Do NOT use the previous month's trend.outstanding directly — summed across the base it
 * does not apply the dashboard's net convention and over-states the total.
 */
export function startMonthOpening(
  c: Customer,
  detail: CustomerDetail | undefined,
  month: string,
  asOfMonth: string,
  asOfDate: string,
): number {
  const outstanding = month === asOfMonth
    ? c.outstanding
    : (detail?.trend.find((t) => t.month === month)?.outstanding ?? 0) * 100_000;
  const received = receivedForMonth(detail, month);
  const { due } = computeOpenDue(c, detail, month, asOfMonth, asOfDate);
  return Math.max(outstanding + received, due);
}
