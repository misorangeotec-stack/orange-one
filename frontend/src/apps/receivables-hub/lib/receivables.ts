/**
 * receivables.ts — single source of truth for receivables aggregation conventions.
 *
 * Every "Total Outstanding" figure shown anywhere in the app (dashboard KPI tile,
 * the Outstanding-by-Risk-Level chart, the risk donut, the Customer Risk Register,
 * the Salesperson view and the Excel exports) MUST compute its totals through the
 * helpers in this file. That guarantees a customer in credit is treated identically
 * everywhere, so two screens can never silently show different totals again.
 *
 * History: before this module existed, the chart skipped credit-balance customers
 * (`if (c.outstanding <= 0) continue`) while every other figure summed them in, so
 * the KPI tile read ₹72.27 Cr while the chart read ₹78.90 Cr for the same data.
 */

/**
 * How ONE customer's balance contributes to a "Total Outstanding" total.
 *
 * Convention (locked 2026-05-26): NET. We add up ALL balances, so a customer in
 * credit (overpaid / holding advances → negative `outstanding`) SUBTRACTS from the
 * total. The headline Total Outstanding therefore reads the net receivable position
 * (≈ ₹72.27 Cr), and a stacked risk chart nets those credits inside whichever risk
 * band the credit customer falls in (almost always "low", since a credit customer
 * has no overdue and low utilisation).
 *
 * ┌─ TO SWITCH THE ENTIRE APP TO GROSS ─────────────────────────────────────────┐
 * │ Change the single line below to:   return Math.max(0, c.outstanding);        │
 * │ Then every KPI, chart, register, donut and export flips to "count only what  │
 * │ customers actually owe" (≈ ₹78.90 Cr), with credit balances surfaced only via │
 * │ the separate Advance Balance figure. No other file needs to change.          │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */
export const outstandingContribution = (c: { outstanding: number }): number =>
  c.outstanding;

/**
 * Sum of Total Outstanding across a set of customers / rows, using the locked
 * convention above. Use this instead of `rows.reduce((s, c) => s + c.outstanding, 0)`
 * so the convention stays in exactly one place.
 */
export const sumOutstanding = <T extends { outstanding: number }>(
  rows: readonly T[],
): number => rows.reduce((s, c) => s + outstandingContribution(c), 0);

/**
 * Credit-limit utilisation %, computed ONE way everywhere (consolidate-by-name,
 * group rollup, customer-detail page). Convention: only positive outstanding
 * utilises credit — a customer in credit is 0% utilised, never negative — and
 * the result is rounded to 1 decimal. Mirrors the Python backend exactly
 * (`round(max(0, outstanding) / credit_limit * 100, 1)`), so the figure agrees
 * across the dashboard, risk register and customer-detail page.
 */
export const utilizationPct = (c: { outstanding: number; creditLimit: number }): number =>
  c.creditLimit > 0 ? Math.round((Math.max(0, c.outstanding) / c.creditLimit) * 1000) / 10 : 0;

/** The four risk bands, low → critical, in display order. */
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Count customers per risk band — the ONE way the whole app counts risk.
 *
 * Convention (locked 2026-05-26): EVERY in-view customer is counted in exactly
 * one band; there is no "outstanding > 0" exposure gate. So the four band counts
 * always sum to the total number of in-view customers, and the risk donut, the
 * risk-count chart and the KPI count tiles agree by construction. (A customer
 * with a zero or credit balance lands in "low" — correct: no overdue, no
 * utilisation.) Pair this with `outstandingContribution` so amounts and counts
 * are always taken over the same customer universe.
 */
export const countByRisk = <T extends { risk: string }>(
  rows: readonly T[],
): Record<RiskLevel, number> => {
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const c of rows) {
    if (c.risk in counts) counts[c.risk as RiskLevel]++;
  }
  return counts;
};
