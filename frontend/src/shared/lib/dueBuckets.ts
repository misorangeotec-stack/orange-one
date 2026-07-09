/**
 * Due-date bucketing — shared by the Purchase FMS Control Center and the
 * cross-FMS scoreboard.
 *
 * Lives in `shared/lib` (a leaf) rather than inside either app: the
 * `fms-control-center` app already imports from `procurement`, so putting these
 * there and importing them back would create an app↔app cycle.
 */

/**
 * Which bucket a work-item lands in, keyed off its due date vs today.
 * `noDate` covers entries with no due date at all (a Purchase follow-up whose
 * vendor has never promised a dispatch date). Items due more than two days out
 * belong to no bucket — they exist, but the scoreboard doesn't show them.
 */
export type Bucket = "delayed" | "today" | "tomorrow" | "dayAfter" | "noDate";

export const EMPTY_COUNTS: Record<Bucket, number> = { delayed: 0, today: 0, tomorrow: 0, dayAfter: 0, noDate: 0 };

/**
 * Today as a LOCAL yyyy-mm-dd.
 *
 * Deliberately not `@/shared/lib/time`'s `todayIso()`, which is
 * `new Date().toISOString().slice(0,10)` — that is the **UTC** date. In IST
 * (UTC+5:30) the UTC date is still "yesterday" until 05:30 local, so before
 * dawn every due-today entry would be counted as delayed. The due dates we
 * compare against are built from local components (`localDateIso`), so the
 * reference day must be local too.
 */
export function todayLocalIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The local yyyy-mm-dd `offset` days after `iso`. */
export function addDaysIso(iso: string, offset: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + offset);
  return todayLocalIso(dt);
}

/**
 * Which bucket an entry belongs to. Buckets are strictly disjoint: a delayed
 * entry is NOT also counted in today. Returns null for anything due more than
 * two days out.
 */
export function bucketOf(dueIso: string | null, todayIso: string): Bucket | null {
  if (!dueIso) return "noDate";
  if (dueIso < todayIso) return "delayed";
  if (dueIso === todayIso) return "today";
  if (dueIso === addDaysIso(todayIso, 1)) return "tomorrow";
  if (dueIso === addDaysIso(todayIso, 2)) return "dayAfter";
  return null;
}
