/**
 * From kpi_report's rows to what the grid, the consolidated block and the export show.
 *
 * One derivation for all three, so the screen and the spreadsheet cannot disagree. The
 * arithmetic itself — the sheet's two percentages and the score — lives in
 * facts/score.ts and nowhere else.
 */
import { appName } from "@/apps/appInfo";
import { templateLabel, TASK_MODULE } from "../facts/taskFacts";
import { pctNotDone, pctNotOnTime, scoreOf, type Counts } from "../facts/score";
import type { ReportRow } from "../data/report";

export interface GridRow {
  key: string;
  source: "fms" | "task";
  module: string;
  moduleName: string;
  rowKey: string;
  label: string;
  given: number;
  done: number;
  onTime: number;
  late: number;
  missed: number;
  /** Still due later this period: open work, plus recurring dates not generated yet. */
  stillDue: number;
  stillDueProjected: number;
  /** Planned next period: known work, plus recurring dates not generated yet. */
  next: number;
  nextProjected: number;
  upto: boolean;
  /** Row 1 · % work not done, and the same for the previous period. */
  pct1: number | null;
  last1: number | null;
  /** Row 2 · % work not done on time (÷ done), and the same for the previous period. */
  pct2: number | null;
  last2: number | null;
  score: number | null;
}

export function toGridRows(rows: ReportRow[]): GridRow[] {
  return rows.map((r) => {
    const cur: Counts = { given: r.given, done: r.done, onTime: r.on_time };
    const last: Counts = { given: r.last_given, done: r.last_done, onTime: r.last_on_time };
    return {
      key: `${r.source}|${r.module}|${r.row_key}`,
      source: r.source,
      module: r.module,
      // Only a Task Management projection row arrives without one.
      moduleName: r.module_name ?? appName(TASK_MODULE),
      rowKey: r.row_key,
      // A projection-only row has no fact yet to carry its label; name it exactly as the
      // job names that template's facts, with the same function.
      label: r.row_label ?? templateLabel({ title: r.tpl_title ?? r.row_key, description: r.tpl_description }),
      given: r.given,
      done: r.done,
      onTime: r.on_time,
      late: r.done - r.on_time,
      missed: r.given - r.done,
      stillDue: r.still_due + r.still_due_projected,
      stillDueProjected: r.still_due_projected,
      next: r.next_planned + r.next_projected,
      nextProjected: r.next_projected,
      upto: r.upto,
      pct1: pctNotDone(cur),
      last1: pctNotDone(last),
      pct2: pctNotOnTime(cur),
      last2: pctNotOnTime(last),
      score: scoreOf(cur),
    };
  });
}

export interface Totals extends Counts {
  late: number;
  missed: number;
  stillDue: number;
  next: number;
  upto: boolean;
  pct1: number | null;
  pct2: number | null;
  last1: number | null;
  last2: number | null;
  score: number | null;
  lastScore: number | null;
}

/** Pooled — volume-weighted — never an average of per-row figures. */
export function totalsOf(rows: GridRow[], lastRows: ReportRow[] = []): Totals {
  const c = { given: 0, done: 0, onTime: 0, stillDue: 0, next: 0, upto: false };
  for (const r of rows) {
    c.given += r.given;
    c.done += r.done;
    c.onTime += r.onTime;
    c.stillDue += r.stillDue;
    c.next += r.next;
    c.upto ||= r.upto && r.next > 0;
  }
  const l = { given: 0, done: 0, onTime: 0 };
  for (const r of lastRows) {
    l.given += r.last_given;
    l.done += r.last_done;
    l.onTime += r.last_on_time;
  }
  return {
    ...c,
    late: c.done - c.onTime,
    missed: c.given - c.done,
    pct1: pctNotDone(c),
    pct2: pctNotOnTime(c),
    last1: pctNotDone(l),
    last2: pctNotOnTime(l),
    score: scoreOf(c),
    lastScore: scoreOf(l),
  };
}

export interface ModuleSplit extends Totals {
  module: string;
  moduleName: string;
}

/** One entry per module, in the order modules first appear, busiest first. */
export function moduleSplit(rows: GridRow[], raw: ReportRow[]): ModuleSplit[] {
  const names = new Map<string, string>();
  for (const r of rows) if (!names.has(r.module)) names.set(r.module, r.moduleName);
  return [...names.entries()]
    .map(([module, moduleName]) => ({
      module,
      moduleName,
      ...totalsOf(
        rows.filter((r) => r.module === module),
        raw.filter((r) => r.module === module),
      ),
    }))
    .sort((a, b) => b.given - a.given || a.moduleName.localeCompare(b.moduleName));
}
