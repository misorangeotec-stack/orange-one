/**
 * One row of the KRA / KPI scorecard's facts (KPI-1): one person, one piece of work.
 *
 * ── What a fact is ────────────────────────────────────────────────────────────
 * A piece of work that has a due date and an owner, and whether it has been done.
 * Nothing about any week, month or range is stored: the report (`kpi_report` in
 * SQL) places each fact in the period of its DUE date, so one table answers any
 * week, any month and any From–To range, and the next period too.
 *
 * ── Where the facts come from ─────────────────────────────────────────────────
 *  · FMS steps — CC-1's scorers (apps/fms-control-center/ranking/modules/), which
 *    compose each module's own completed-step builders, due-date function and My
 *    Work rule. Nothing here re-derives a due date. See fmsFacts.ts.
 *  · Task Management — the `tasks` table, through Task Management's own fetcher and
 *    its own predicates (`countsTowardMetrics`, `isRecurringTask`). See taskFacts.ts.
 *
 * Written nightly by the `kpi-facts` edge function (supabase/kpi/entry.ts). The
 * shape below is exactly the `kpi_facts` table's.
 *
 * Pure: bundled into that edge function. No React, no `window`, no `import.meta.env`.
 */

/** Which half of the report a fact belongs to. */
export type FactSource = "fms" | "task";

/**
 * Why a fact is stored but never scored.
 *
 *  bulk_close  a task closed by one of the two admin bulk sweeps
 *              (`task_bulk_close_20260630`, `task_bulk_close_af_20260909`). Its
 *              completion time is the sweep's, not anyone's work, so it would read
 *              as a late completion nobody made. The user decided on 18-09-2026 that
 *              these count for nothing; they are kept only so the report can say how
 *              many it left out of each person's period.
 */
export type FactExclusion = "bulk_close";

export interface KpiFact {
  source: FactSource;
  /** CC-1's module key ("purchase", "order-to-dispatch" …), or "task-management". */
  module: string;
  /** The module's display name, from apps/appInfo.ts. */
  module_name: string;
  /**
   * The grid row this fact lands in, stable across nights: an FMS step key, a
   * recurring template's id, `title:<title>` for a recurring task whose template was
   * deleted, or `one-off`.
   */
  row_key: string;
  /** What that row is called on screen and in the export. */
  row_label: string;
  /** Whose report this fact is in. */
  user_id: string;
  /** Unique within (module, user): the step id, or the task id. */
  item_id: string;
  entity_id: string;
  /** What a reader recognises in the drill-down: an order no, a PO no, a task title. */
  ref: string;
  round_no: number;
  /** IST yyyy-mm-dd. Never null — work with no due date counts for nobody. */
  due_date: string;
  /** The ORIGINAL completion time, never an edit stamp. Null while open. */
  done_at: string | null;
  /** The IST calendar day of `done_at`. On time = this is on or before `due_date`. */
  done_date_ist: string | null;
  basis: "closed" | "open";
  /**
   * The due date was pushed back after the work was given (Task Management's
   * `revision_count > 0`). A revision OVERWRITES `due_date`, so without this a
   * deadline moved three times and then met would read as on time. Done, but never
   * on time — decided 18-09-2026. Always false for FMS steps, whose due dates are
   * computed, not stored.
   */
  revised: boolean;
  excluded: FactExclusion | null;
}

/**
 * What one module contributed to a run, kept in `kpi_runs.modules` so that nothing
 * is dropped silently. `dropped` counts each piece of work once, not once per owner.
 */
export interface KpiModuleStats {
  source: FactSource;
  /** Facts written (scored + excluded). */
  facts: number;
  closed: number;
  open: number;
  /** Reason → count. FMS: CC-1's DropReason. Task Management: see taskFacts.ts. */
  dropped: Record<string, number>;
  /** Stored but not scored, by reason (Task Management's bulk-closed tasks). */
  excluded: Record<string, number>;
}

export const emptyStats = (source: FactSource): KpiModuleStats => ({
  source,
  facts: 0,
  closed: 0,
  open: 0,
  dropped: {},
  excluded: {},
});

export const bump = (counts: Record<string, number>, why: string): void => {
  counts[why] = (counts[why] ?? 0) + 1;
};
