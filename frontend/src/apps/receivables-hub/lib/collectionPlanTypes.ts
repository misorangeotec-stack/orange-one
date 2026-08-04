/**
 * Monthly collection plan — shared types.
 *
 * A plan is what a salesperson INTENDS to collect from a customer in a given month, so the
 * Salesperson Collection Report can show plan-vs-actual next to the figure it is measured
 * against. One row per (month, customer): an amount, an optional expected date and a note.
 *
 * ENTITY KEY: like the follow-up log, a plan hangs off the customer/group NAME, never off
 * `Customer.id`. `Customer.id` is a pipeline surrogate ("C0001") that renumbers on every
 * reprocess and turns into a Tally GUID under the Live (Tally) source — anything keyed off it
 * would silently detach. The name is the hub's stable natural key.
 *
 * MONTH KEY: the hub's trend label, "MMM-YY" (e.g. "Aug-26") — the same vocabulary the Month
 * dropdown, `dashboard.trend` and lib/months.ts speak. It is a LABEL, not a date: it sorts
 * alphabetically, so it must never be used as a sort key. Sequence with monthLabelToOrdinal().
 *
 * SHARED CELL, NOT A PERSONAL ENTRY: unlike a follow-up, there is exactly one plan row per
 * (month, entity) and any signed-in user may revise it. `revision` / `updatedBy` exist so an
 * overwrite is visible in the UI rather than silent.
 */

import { MONTH_IDX } from "./months";

export type PlanEntityType = "customer" | "group";

export interface CollectionPlan {
  id: string;
  /** Trend month label, "MMM-YY". */
  month: string;
  entityType: PlanEntityType;
  entityName: string;
  /** Rupees. Always > 0 in practice — clearing a plan deletes the row (see CollectionPlanInput). */
  plannedAmount: number;
  /** null = "sometime this month". */
  expectedDate: string | null; // "YYYY-MM-DD"
  note: string | null;
  /** Frozen when last saved, so the plan still reads true after the pipeline moves the numbers. */
  salesperson: string | null;
  dueAtPlan: number | null;
  outstandingAtPlan: number | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string; // ISO timestamptz
  updatedBy: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
  /** Bumped on every revision — what makes a silent overwrite detectable. */
  revision: number;
}

/**
 * What the caller saves. `plannedAmount` of 0 is NOT written — the API deletes the row instead,
 * so "no row" is the single unambiguous representation of "unplanned" and a zero can never be
 * mistaken for a deliberate plan to collect nothing.
 */
export interface CollectionPlanInput {
  month: string;
  entityType: PlanEntityType;
  entityName: string;
  plannedAmount: number;
  expectedDate: string | null;
  note: string | null;
  salesperson: string | null;
  dueAtPlan: number | null;
  outstandingAtPlan: number | null;
}

/** Stable map key. MUST carry the month — the same entity has a different plan each month. */
export function planKey(month: string, type: PlanEntityType, name: string): string {
  return `${month}:${type}:${name}`;
}

/**
 * Guard for the "MMM-YY" vocabulary — the same shape the DB check constraint pins.
 *
 * Worth checking client-side because a bad month label writes SUCCESSFULLY and then renders as
 * "unplanned" forever: nothing on the read side will ever ask for that label again.
 */
export function isMonthLabel(s: string): boolean {
  const parts = s.split("-");
  if (parts.length !== 2) return false;
  const [mon, yy] = parts;
  // hasOwnProperty rather than `MONTH_IDX[mon] !== undefined`: the record is typed
  // Record<string, number>, so an unknown key types as `number` and the comparison reads as
  // always-true even though it isn't at runtime.
  return Object.prototype.hasOwnProperty.call(MONTH_IDX, mon) && /^\d{2}$/.test(yy);
}

/** planKey → row. Pure, so every consumer indexes identically. */
export function indexPlans(rows: CollectionPlan[]): Map<string, CollectionPlan> {
  const map = new Map<string, CollectionPlan>();
  for (const p of rows) map.set(planKey(p.month, p.entityType, p.entityName), p);
  return map;
}
