import type { StepKey } from "./steps";

/**
 * Default per-step SLA in days. A queue entry's **due date** = when it entered
 * the step (we use created_at) + this SLA. The normal case is **24 hours (1 day)
 * after the previous step** — that is the default for every step. Give a step a
 * different value here only for a specific, deliberate scenario. If the computed
 * due date lands on a Sunday (holiday) it rolls forward to Monday (see dueInfo).
 *
 * These are code defaults for now — no per-entry due date is stored yet; this is
 * the single place to later wire an admin-configurable SLA (Setup) or a true
 * stage-entry timestamp.
 */
export const STEP_SLA_DAYS: Record<StepKey, number> = {
  request: 1,
  sourcing: 1,
  approval: 1,
  po: 1,
  share_po: 1,
  collect_pi: 1,
  advance_payment: 1,
  follow_up: 1,
  inward: 1,
  tally: 1,
  final_payment: 1,
};

export interface DueInfo {
  due: Date;
  /** Whole days until due at day granularity (negative = overdue). */
  days: number;
  overdue: boolean;
  dueToday: boolean;
}

/** Compute the due date + overdue state for an entry sitting in `step`. */
export function dueInfo(createdIso: string, step: string): DueInfo {
  const due = new Date(createdIso);
  due.setDate(due.getDate() + (STEP_SLA_DAYS[step as StepKey] ?? 1));
  // Sunday is a holiday — a due date landing on Sunday rolls forward to Monday.
  if (due.getDay() === 0) due.setDate(due.getDate() + 1);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86_400_000);

  return { due, days, overdue: days < 0, dueToday: days === 0 };
}
