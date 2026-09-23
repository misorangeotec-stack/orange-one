/**
 * The lab's arithmetic (KPI-3, read-only) — the ONLY place it is written down.
 *
 * ── One line's achievement ────────────────────────────────────────────────────
 * Each of the five measure kinds turns an actual and a target into a single
 * "achievement", 0–100. Capped at 100 throughout: over-delivering on a 1% line must
 * not quietly pay for a missed 10% line, which is what an uncapped ratio would do.
 *
 *   sla        the actual IS the compliance %                    → actual
 *   count      15 of a target 20                                 → actual ÷ target
 *   ratio      72% against a target of 80%                       → actual ÷ target
 *   rating     4.2 against a target of 4 (out of 5)              → actual ÷ target
 *   judgement  a person types the achievement                    → as typed
 *
 * A line contributes `achievement ÷ 100 × weight` to the score.
 *
 * ── Two rival totals, and why the page shows both ─────────────────────────────
 * With most of Saloni's sheet unmeasurable, "score out of 100" has two honest readings
 * and they are far apart:
 *
 *   ON THE SHEET   every unmeasured line scores 0. The literal reading of a fixed
 *                  100% framework — and a catastrophic-looking number that says more
 *                  about the hub than about the person.
 *   ON WHAT WE HAVE   rescaled over the weight actually measured. The fair reading of
 *                  the person, and meaningless without the coverage figure beside it.
 *
 * Neither is "the" score. Printing one alone would mislead, so `totalsOf` returns both
 * and the page never shows one without the other.
 */
import type { Coverage, KpiLine, MeasureKind } from "../framework/types";

const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** 0–100, capped. Null when there is no actual, or no target to measure it against. */
export function achievementOf(measure: MeasureKind, actual: number | null, target: number | null): number | null {
  if (actual === null) return null;
  if (measure === "sla" || measure === "judgement") return round(Math.min(100, Math.max(0, actual)), 1);
  if (target === null || target <= 0) return null;
  return round(Math.min(100, Math.max(0, (actual / target) * 100)), 1);
}

/** What a line puts into the score out of 100. */
export const weightedOf = (achievement: number | null, weight: number): number | null =>
  achievement === null ? null : round((achievement / 100) * weight, 3);

export interface ScoredLine {
  line: KpiLine;
  /** The measured figure, in the line's own unit. Null when nothing could be read. */
  actual: number | null;
  /** What the actual was read from, for the row's tooltip. */
  detail: string | null;
  /** The target in force: the sheet's, or one typed in the lab. */
  target: number | null;
  /** True when the target came from the lab, not the sheet — the row says so. */
  targetTyped: boolean;
  /** True when the actual was typed in the lab rather than read from data. */
  actualTyped: boolean;
  achievement: number | null;
  weighted: number | null;
}

export interface Totals {
  /** Weight of the lines that produced an achievement. */
  scoredWeight: number;
  /** Weight of the lines that could not. */
  unscoredWeight: number;
  /** Σ weighted — the score with every unmeasured line counting 0. Out of 100. */
  onSheet: number;
  /** Σ weighted rescaled over `scoredWeight`. Null when nothing at all scored. */
  onWhatWeHave: number | null;
  /** How much of the 100 each coverage band carries, for the coverage meter. */
  coverage: Record<Coverage, number>;
  /** …and how much of each band actually produced a figure. */
  scoredByCoverage: Record<Coverage, number>;
  /** How many KPI lines sit in each band. A band's weight alone hides how many lines it is. */
  linesByCoverage: Record<Coverage, number>;
}

const emptyBands = (): Record<Coverage, number> => ({
  system: 0,
  partial: 0,
  "target-missing": 0,
  unused: 0,
  "not-released": 0,
  "no-data": 0,
  judgement: 0,
});

export function totalsOf(scored: ScoredLine[]): Totals {
  let scoredWeight = 0;
  let sum = 0;
  const coverage = emptyBands();
  const scoredByCoverage = emptyBands();
  const linesByCoverage = emptyBands();
  for (const s of scored) {
    coverage[s.line.coverage] += s.line.weight;
    linesByCoverage[s.line.coverage] += 1;
    if (s.weighted !== null) {
      scoredWeight += s.line.weight;
      scoredByCoverage[s.line.coverage] += s.line.weight;
      sum += s.weighted;
    }
  }
  const total = scored.reduce((a, s) => a + s.line.weight, 0);
  return {
    scoredWeight: round(scoredWeight, 2),
    unscoredWeight: round(total - scoredWeight, 2),
    onSheet: round(sum, 1),
    onWhatWeHave: scoredWeight > 0 ? round((sum / scoredWeight) * 100, 1) : null,
    coverage,
    scoredByCoverage,
    linesByCoverage,
  };
}

/** Per-KRA roll-up, in the sheet's own order. */
export interface KraTotals extends Totals {
  code: string;
  title: string;
  weight: number;
}

/**
 * The OTHER formula the document gives, and the live scorecard's, on the same data —
 * the comparison that settles which rule governs.
 *
 * The sheet's "Common Orange Hub Scoring Logic" reads
 *     Final KPI Score = (Task Completion % × 50%) + (On-Time Completion % × 50%)
 * while the live KRA / KPI Scorecard scores on time 1, late ½, not done 0, over given.
 * On the client's own MIS figures — 127 given, 118 done, 110 on time — these give
 * 93.07 and 89.8. Same data, three and a quarter points apart.
 */
export const docFiftyFifty = (given: number, done: number, onTime: number): number | null =>
  given > 0 && done > 0 ? round((done / given) * 50 + (onTime / done) * 50, 2) : null;

/** The live scorecard's rule, restated here only so the comparison is self-contained. */
export const kpi1Score = (given: number, done: number, onTime: number): number | null =>
  given > 0 ? round(((onTime + (done - onTime) / 2) / given) * 100, 1) : null;

export const fmt = (x: number | null, dp = 1): string => (x === null ? "—" : x.toFixed(dp));

/**
 * The worked examples from the client's own sheet. There is no test runner in this
 * repo, so the page calls this on mount and shows a banner if the arithmetic ever
 * stops reproducing the figures everyone already knows.
 */
export function checkArithmetic(): string[] {
  const bad: string[] = [];
  const eq = (name: string, got: number | null, want: number | null) => {
    if (got !== want) bad.push(`${name}: got ${got}, expected ${want}`);
  };
  eq("doc 50/50 on 127/118/110", docFiftyFifty(127, 118, 110), 93.07);
  eq("live rule on 127/118/110", kpi1Score(127, 118, 110), 89.8);
  eq("sla achievement passes through", achievementOf("sla", 87.5, 100), 87.5);
  eq("count 12 of 15", achievementOf("count", 12, 15), 80);
  eq("ratio 72 of 80", achievementOf("ratio", 72, 80), 90);
  eq("rating 4.2 of 4 caps at 100", achievementOf("rating", 4.2, 4), 100);
  eq("no target, no achievement", achievementOf("count", 9, null), null);
  eq("no actual, no achievement", achievementOf("ratio", null, 80), null);
  eq("weighted 80% of a 10% line", weightedOf(80, 10), 8);
  return bad;
}
