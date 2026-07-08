/**
 * Portal date formatting. PROJECT RULE: all displayed dates are numeric
 * dd-mm-yyyy — use these helpers, never toLocaleDateString with a locale that
 * might reorder the parts. Accepts an ISO string, Date, or null.
 */

function parts(input: string | Date | null | undefined): { d: number; m: number; y: number; hh: number; mm: number } | null {
  if (!input) return null;
  const date = typeof input === "string" ? new Date(input) : input;
  if (isNaN(date.getTime())) return null;
  return { d: date.getDate(), m: date.getMonth() + 1, y: date.getFullYear(), hh: date.getHours(), mm: date.getMinutes() };
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** dd-mm-yyyy, or "—" when the date is missing/invalid. */
export function formatDateDMY(input: string | Date | null | undefined): string {
  const p = parts(input);
  return p ? `${pad(p.d)}-${pad(p.m)}-${p.y}` : "—";
}

/** dd-mm-yyyy HH:MM (24h), or "—". */
export function formatDateTimeDMY(input: string | Date | null | undefined): string {
  const p = parts(input);
  return p ? `${pad(p.d)}-${pad(p.m)}-${p.y} ${pad(p.hh)}:${pad(p.mm)}` : "—";
}

/** yyyy-mm-dd key for grouping/bucketing by day (stable, sortable). */
export function dayKey(input: string | Date | null | undefined): string | null {
  const p = parts(input);
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
}
