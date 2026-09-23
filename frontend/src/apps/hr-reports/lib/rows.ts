/**
 * Framework + actuals + what a reader typed → the scored rows (KPI-3, read-only).
 *
 * One derivation for the grid, the KRA roll-up, the coverage meter and the export, so
 * the screen and the spreadsheet cannot disagree. The arithmetic itself is in
 * achievement.ts and nowhere else.
 */
import type { Framework, KpiLine } from "../framework/types";
import type { LabData } from "../data/actuals";
import { fromKpiReport, noData, type Measured } from "../data/actuals";
import { achievementOf, totalsOf, weightedOf, type KraTotals, type ScoredLine, type Totals } from "./achievement";
import type { ManualMap } from "./manual";

/**
 * Which number a line is asking a reader for.
 *
 *  param        the sheet states no target (or needs a query parameter) — type it and
 *               the live figure becomes scorable
 *  achievement  no data can reach this line at all — type the mark out of 100
 *  none         fully specified and fully measured; nothing to type
 */
export function asksFor(line: KpiLine): "param" | "achievement" | "none" {
  if (line.param) return "param";
  if (line.target === null) return "param";
  if (line.source.kind === "none") return "achievement";
  return "none";
}

function measure(line: KpiLine, data: LabData, param: number | null): Measured {
  const s = line.source;
  if (s.kind === "kpiFacts") return fromKpiReport(data.report, s.module, s.rowKeys, s.basis);
  if (s.kind === "hr") {
    if (data.hrError) return noData("The recruitment tables would not open for this login.");
    if (s.metric === "closure_within_tat" && (param === null || param <= 0)) {
      return noData("Type the approved TAT in days to measure this.");
    }
    return data.hr[s.metric] ?? noData("Not read.");
  }
  return noData(line.gap ?? "Nothing in the hub records this.");
}

export function scoreLines(framework: Framework, data: LabData, manual: ManualMap): ScoredLine[] {
  return framework.lines.map((line): ScoredLine => {
    const entry = manual[line.code] ?? {};
    const asks = asksFor(line);
    const typedParam = asks === "param" ? (entry.param ?? null) : null;

    // A line with no source takes the reader's mark directly; there is nothing to read.
    if (asks === "achievement") {
      const a = entry.achievement ?? null;
      return {
        line,
        actual: a,
        detail: a === null ? (line.gap ?? null) : "Typed in the lab — not evidence.",
        target: line.target,
        targetTyped: false,
        actualTyped: a !== null,
        achievement: achievementOf("judgement", a, line.target),
        weighted: weightedOf(achievementOf("judgement", a, line.target), line.weight),
      };
    }

    const m = measure(line, data, typedParam);
    // With a `param` the sheet's own target stands and the typed number feeds the query;
    // without one, the typed number IS the missing target.
    const target = line.param ? line.target : (line.target ?? typedParam);
    const achievement = achievementOf(line.measure, m.value, target);
    return {
      line,
      actual: m.value,
      detail: m.detail,
      target,
      targetTyped: !line.param && line.target === null && typedParam !== null,
      actualTyped: false,
      achievement,
      weighted: weightedOf(achievement, line.weight),
    };
  });
}

export function kraTotals(framework: Framework, scored: ScoredLine[]): KraTotals[] {
  return framework.kras.map((k) => ({
    code: k.code,
    title: k.title,
    weight: k.weight,
    ...totalsOf(scored.filter((s) => s.line.kra === k.code)),
  }));
}

export const overallTotals = (scored: ScoredLine[]): Totals => totalsOf(scored);

/**
 * The live scorecard's own figures for the same person and period, for the comparison
 * tab. Task Management plus every FMS module — the whole of what KPI-1 scores, which is
 * deliberately a wider net than the framework's KRA 3.
 */
export function kpi1Counts(data: LabData): { given: number; done: number; onTime: number } {
  const rows = data.report?.rows ?? [];
  return {
    given: rows.reduce((s, r) => s + r.given, 0),
    done: rows.reduce((s, r) => s + r.done, 0),
    onTime: rows.reduce((s, r) => s + r.on_time, 0),
  };
}
