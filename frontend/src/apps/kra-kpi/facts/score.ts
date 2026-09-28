/**
 * The client's weekly MIS arithmetic (KPI-1) — the only place it is written down.
 *
 * The sheet has two rows per task, each ending in "Actual %" = (G − F) ÷ F × 100:
 *
 *   Row 1 · "All work should be done"          F = work GIVEN   G = work DONE
 *   Row 2 · "All work should be done on time"  F = work DONE    G = done ON TIME
 *
 * ⚠ ROW 2 DIVIDES BY WORK DONE, NOT WORK GIVEN. The sheet's own figures prove it:
 *   127 given / 118 done / 110 on time gives −7.09 and −6.78; against given the
 *   second would be −13.39. "Issue PO" agrees: 919 / 871 / 785 → −5.22 and −9.87.
 *   Reproduced exactly, so the numbers people already know still match.
 *
 * The score out of 100 is CC-1's rule, so the hub has one: on time 1, late ½, not
 * done 0, ÷ given — (110 + 8 × ½) ÷ 127 = 89.8 on the sheet's figures. Pooled
 * across every row (volume-weighted), never an average of per-row scores.
 *
 * No base, no percentage: zero given (row 1, the score) or zero done (row 2) returns
 * null, which every caller shows as "—". Never 0% and never −100%.
 */

export interface Counts {
  given: number;
  done: number;
  onTime: number;
}

const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** Row 1, "% work not done": (done − given) ÷ given × 100, two decimals. */
export const pctNotDone = (c: Pick<Counts, "given" | "done">): number | null =>
  c.given > 0 ? round(((c.done - c.given) / c.given) * 100, 2) : null;

/** Row 2, "% work not done on time": (on time − done) ÷ done × 100, two decimals. */
export const pctNotOnTime = (c: Pick<Counts, "done" | "onTime">): number | null =>
  c.done > 0 ? round(((c.onTime - c.done) / c.done) * 100, 2) : null;

/** Score out of 100: (on time + ½ late) ÷ given × 100, one decimal. Late = done − on time. */
export const scoreOf = (c: Counts): number | null =>
  c.given > 0 ? round(((c.onTime + (c.done - c.onTime) / 2) / c.given) * 100, 1) : null;

/** "−7.09", "0.00", or "—". A U+2212 minus, as the sheet prints it in a report. */
export const fmtPct = (x: number | null): string =>
  x === null ? "—" : `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}`;

export const fmtScore = (x: number | null): string => (x === null ? "—" : x.toFixed(1));

/**
 * The sheet's own figures. There is no test runner here, so the `kpi-facts` job calls
 * this before every run, beside its IST clock check, and writes nothing if the
 * arithmetic ever stops reproducing them.
 */
export function assertSheetArithmetic(): void {
  const sheet = { given: 127, done: 118, onTime: 110 };
  const issuePo = { given: 919, done: 871, onTime: 785 };
  const checks: [string, number | null, number][] = [
    ["row 1 (127/118)", pctNotDone(sheet), -7.09],
    ["row 2 (118/110)", pctNotOnTime(sheet), -6.78],
    ["score (127/118/110)", scoreOf(sheet), 89.8],
    ["Issue PO row 1", pctNotDone(issuePo), -5.22],
    ["Issue PO row 2", pctNotOnTime(issuePo), -9.87],
  ];
  for (const [name, got, want] of checks) {
    if (got !== want) throw new Error(`KPI arithmetic: ${name} gave ${got}, the client's sheet says ${want}`);
  }
  if (pctNotDone({ given: 0, done: 0 }) !== null || pctNotOnTime({ done: 0, onTime: 0 }) !== null) {
    throw new Error("KPI arithmetic: a zero base must give no percentage");
  }
}
