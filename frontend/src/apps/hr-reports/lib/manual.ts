/**
 * What a reader types into the lab (KPI-3, read-only).
 *
 * ⚠ THIS NEVER REACHES THE DATABASE, AND THAT IS THE POINT. Two thirds of Saloni's
 *   sheet cannot be scored from the hub yet. If the lab wrote those figures somewhere they would
 *   look like records, be read by someone later, and there would now be an appraisal
 *   number in the hub that nobody can trace to any evidence. They live in this browser
 *   and nowhere else, so the page can be demonstrated end to end while the gap stays
 *   a gap.
 *
 * Kept per person and per period, because a figure typed for September is not a figure
 * for October. Every read and write is wrapped: private windows and blocked site data
 * throw on access, and the page must render regardless.
 */

/** What a reader may supply for one line. Which of the two is asked for is the line's. */
export interface ManualEntry {
  /** A missing target (1A.2, 1A.3) or a query parameter (1A.5's TAT). */
  param?: number;
  /** The achievement itself, 0–100, for a line no data can reach. */
  achievement?: number;
}

export type ManualMap = Record<string, ManualEntry>;

const keyOf = (frameworkId: string, person: string, from: string, to: string) =>
  `kpi-lab:${frameworkId}:${person}:${from}:${to}`;

export function loadManual(frameworkId: string, person: string, from: string, to: string): ManualMap {
  try {
    const raw = localStorage.getItem(keyOf(frameworkId, person, from, to));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ManualMap) : {};
  } catch {
    return {};
  }
}

export function saveManual(frameworkId: string, person: string, from: string, to: string, map: ManualMap): void {
  try {
    localStorage.setItem(keyOf(frameworkId, person, from, to), JSON.stringify(map));
  } catch {
    // A full or blocked store must not take the page down; the figures simply do not persist.
  }
}

export function clearManual(frameworkId: string, person: string, from: string, to: string): void {
  try {
    localStorage.removeItem(keyOf(frameworkId, person, from, to));
  } catch {
    /* nothing to undo */
  }
}

/** How many lines a reader has filled in — the page says so beside the score. */
export const typedCount = (map: ManualMap): number =>
  Object.values(map).filter((e) => e && (e.param !== undefined || e.achievement !== undefined)).length;
