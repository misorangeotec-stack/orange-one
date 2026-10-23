import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";

/** dd-mm-yyyy, or blank (never a dash) when there is no date. */
export const dmy = (iso: string | null | undefined): string => (iso ? formatDateDMY(iso) : "");

/** dd-mm-yyyy HH:MM, or blank. */
export const dmyTime = (iso: string | null | undefined): string => (iso ? formatDateTimeDMY(iso) : "");

const IST_OFFSET_MS = 330 * 60 * 1000;

/**
 * The current week in India time, Monday 00:00 to the next Monday 00:00, as UTC
 * instants plus the dd-mm-yyyy dates to print beside the count. A dashboard figure
 * that says "this week" has to say which days it means.
 */
export function thisWeekIst(now = new Date()): { from: Date; to: Date; label: string } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const mondayIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow);
  const from = new Date(mondayIst - IST_OFFSET_MS);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const d = (t: number) => {
    const x = new Date(t);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(x.getUTCDate())}-${p(x.getUTCMonth() + 1)}-${x.getUTCFullYear()}`;
  };
  return { from, to, label: `${d(mondayIst)} to ${d(mondayIst + 6 * 86_400_000)}` };
}

/** "City, State" from the two parts, skipping a blank one. */
export const place = (city: string | null | undefined, state: string | null | undefined): string =>
  [city, state].filter((x) => x && x.trim()).join(", ");
