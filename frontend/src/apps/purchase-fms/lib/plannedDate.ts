import type { PurchaseEntry } from "../types";
import { PURCHASE_STAGES } from "../config/stages";

/**
 * Planned-date engine for Purchase FMS (Phase 3).
 *
 * Rule: a stage's planned date = +24 working hours after the previous stage's
 * actual completion, counted Mon–Sat (only Sunday is skipped). Exceptions:
 *   • follow_up (stage 6) — the working day BEFORE the vendor's material dispatch
 *     date (captured in the share_po stage), when that date is known.
 *   • final_payment (stage 9) — uses the standard rule (the payment due date is
 *     only captured AT stage 9, so it isn't known when stage 8 completes).
 *
 * Computed client-side and passed to the fms_complete_stage RPC. Dates are
 * yyyy-mm-dd; display goes through formatDate (dd-mm-yyyy) at the screen.
 */

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

const dayOf = (iso: string): number => new Date(iso + "T00:00:00Z").getUTCDay(); // 0=Sun

const shiftDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Add n working days (Mon–Sat; skip Sunday). */
export function addWorkingDays(iso: string, n: number): string {
  let d = iso;
  let added = 0;
  while (added < n) {
    d = shiftDays(d, 1);
    if (dayOf(d) !== 0) added++; // skip Sunday
  }
  return d;
}

/** Subtract n working days (Mon–Sat; skip Sunday). */
export function subWorkingDays(iso: string, n: number): string {
  let d = iso;
  let removed = 0;
  while (removed < n) {
    d = shiftDays(d, -1);
    if (dayOf(d) !== 0) removed++; // skip Sunday
  }
  return d;
}

const isDateStr = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

/**
 * The planned date for the stage at `nextStageIndex` (0-based), computed when the
 * preceding stage is completed. Falls back to the standard rule outside the
 * follow_up exception.
 */
export function nextPlannedDate(entry: PurchaseEntry, nextStageIndex: number): string {
  const standard = addWorkingDays(todayIso(), 1);
  const nextKey = PURCHASE_STAGES[nextStageIndex]?.key;

  if (nextKey === "follow_up") {
    const dispatch = entry.stages.find((s) => s.key === "share_po")?.values?.materialDispatchDate;
    if (isDateStr(dispatch)) {
      // The working day before the vendor's dispatch date.
      return subWorkingDays(dispatch.slice(0, 10), 1);
    }
  }

  return standard;
}
