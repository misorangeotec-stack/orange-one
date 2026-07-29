/**
 * Track helpers that are neither queue logic nor formatting.
 *
 * The one real piece of thinking here is `estimateNextDue`, used ONLY when an
 * asset is created with tracks ticked and no dates yet. It is an ESTIMATE and the
 * UI says so — the real date comes off the document or the last service record.
 */
import { addMonths } from "@/shared/lib/workingDays";
import type { AssetSchedule, FrequencyUnit } from "../types";

const localIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const advance = (iso: string, value: number, unit: FrequencyUnit): string | null => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime()) || value <= 0) return null;
  if (unit === "days") { d.setDate(d.getDate() + value); return localIso(d); }
  if (unit === "months") return localIso(addMonths(d, value));
  if (unit === "years") return localIso(addMonths(d, value * 12));
  return null; // one_time never advances
};

/**
 * A first guess at when a new track is next due.
 *
 * Anchored on the purchase date where we have one — a machine bought in January
 * on a six-month cycle is due in July, not six months after somebody happened to
 * type it into the register. Rolled forward until it is in the future, so a
 * five-year-old asset does not open twenty overdue jobs the moment it is entered.
 *
 * Returns null when nothing sensible can be derived (a one-time track, or no
 * frequency) — the caller must then ask for the date outright.
 */
export function estimateNextDue(
  purchaseDate: string | null,
  todayIso: string,
  value: number | null,
  unit: FrequencyUnit,
): string | null {
  if (unit === "one_time" || !value || value <= 0) return null;
  let cur = purchaseDate && purchaseDate <= todayIso ? purchaseDate : todayIso;
  for (let i = 0; i < 200; i += 1) {
    const next = advance(cur, value, unit);
    if (!next) return null;
    if (next > todayIso) return next;
    cur = next;
  }
  return null;
}

/** Tracks that actually drive reminders — inactive or undated ones do nothing. */
export const liveTracks = (rows: AssetSchedule[]): AssetSchedule[] =>
  rows.filter((r) => r.active && !!r.nextDueDate);

/** The soonest thing due on an asset, or null if nothing is scheduled. */
export function soonestDue(rows: AssetSchedule[]): AssetSchedule | null {
  const live = liveTracks(rows);
  if (!live.length) return null;
  return live.reduce((a, b) => ((a.nextDueDate as string) <= (b.nextDueDate as string) ? a : b));
}
