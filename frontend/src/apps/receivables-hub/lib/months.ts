/**
 * months.ts — the trend "month label" vocabulary, shared.
 *
 * Every receivables screen keys monthly data by a label like "Apr-25" (see
 * MonthlyTrend.month / TrendPoint.month). These helpers convert between that
 * label, ISO dates and display dates. They lived as private copies inside
 * SalespersonCollectionReport; lifted here so a third report doesn't make a
 * fourth copy.
 */

export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** "May-26" → Date for the FIRST calendar day of that month (local, start-of-day). */
export function monthLabelToStartDate(label: string): Date {
  const [mon, yy] = label.split("-");
  return new Date(2000 + parseInt(yy, 10), MONTH_IDX[mon] ?? 0, 1);
}

/** "May-26" → Date for the LAST calendar day of that month (local, end-of-day). */
export function monthLabelToEndDate(label: string): Date {
  const [mon, yy] = label.split("-");
  return new Date(2000 + parseInt(yy, 10), (MONTH_IDX[mon] ?? 0) + 1, 0, 23, 59, 59, 999);
}

/** Format a JS Date as DD-MM-YYYY (project standard: numeric, dashes). */
export function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** "May-26" → "01-05-2026" (first day of that month). */
export function monthStartLong(label: string): string {
  return ddmmyyyy(monthLabelToStartDate(label));
}

/** "May-26" → "31-05-2026" (last day of that month). */
export function monthEndLong(label: string): string {
  return ddmmyyyy(monthLabelToEndDate(label));
}

/** ISO date "2025-08-15" → trend month label "Aug-25" (matches MonthlyTrend.month). */
export function isoToMonthLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTH_ABBR[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

/** "Apr-25" → a sortable ordinal (2025*12 + 3). Unknown labels sort last. */
export function monthLabelToOrdinal(label: string): number {
  const [mon, yy] = label.split("-");
  const m = MONTH_IDX[mon];
  const y = Number(yy);
  if (m === undefined || Number.isNaN(y)) return Number.MAX_SAFE_INTEGER;
  return (2000 + y) * 12 + m;
}
