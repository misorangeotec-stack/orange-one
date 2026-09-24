/**
 * The "Data updated as of …" stamp in the top strip, formatted without timezone drift.
 *
 * Extracted from layouts/UserLayout.tsx when Reports moved to its own app
 * (apps/reports/ReportsLayout.tsx): two shells now print the same stamp, and two copies of
 * a rule this fiddly is two chances to disagree about what time the pipeline ran.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format an ISO date ("2026-05-28") as "28 May 2026" without timezone drift. */
export function formatAsOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/**
 * Format the last-refresh stamp as "28 May 2026, 2:30 PM" (12-hour).
 *
 * The pipeline writes the timestamp as IST wall-clock but tags it "+00:00" (e.g.
 * "2026-06-29T12:55:38+00:00" is actually 12:55 PM IST, not UTC). So we read the date/time
 * components LITERALLY via regex — no `new Date()`, no timezone conversion — which keeps the
 * displayed time identical to the wall clock the pipeline recorded.
 *
 * When the value carries no time component (e.g. a date-only as-of date), falls back to the
 * drift-free date-only `formatAsOf` so we never render a spurious "12:00 AM".
 */
export function formatAsOfDateTime(input: string): string {
  if (!input) return "";
  const s = String(input).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (m) {
    const hour = parseInt(m[4], 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 || 12;
    return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}, ${h12}:${m[5]} ${ampm}`;
  }
  return formatAsOf(s);
}
