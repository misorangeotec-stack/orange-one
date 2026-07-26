import type { AgingBuckets, SaleType } from "./types";
import type { ExposureRow } from "./topExposure";

/**
 * Analytics for the Top-Exposure report's "Analysis" tab — pure, UI-free.
 *
 * Every series is derived from the SAME `capped` Top-N ExposureRow[] the List tab
 * shows, so the charts and the AI narrative always match the call-list. Kept out of
 * the component so the maths is testable-by-build and the tab stays thin.
 */

/* ── Colours (match the app's existing chart conventions) ─────────────────────── */

/** Aging ramp green→red, mirroring CustomerCategoryReport's bucket hexes. */
export const AGING_COLORS: Record<keyof AgingBuckets, string> = {
  "0_30": "#86efac",
  "31_60": "#fde047",
  "61_90": "#fbbf24",
  "91_120": "#fb923c",
  "121_180": "#ef4444",
  "180_plus": "#b91c1c",
};

export const AGING_LABELS: Record<keyof AgingBuckets, string> = {
  "0_30": "0-30",
  "31_60": "31-60",
  "61_90": "61-90",
  "91_120": "91-120",
  "121_180": "121-180",
  "180_plus": "180+",
};

const AGING_ORDER: (keyof AgingBuckets)[] = ["0_30", "31_60", "61_90", "91_120", "121_180", "180_plus"];

export const SALE_TYPE_META: { key: SaleType; label: string; color: string }[] = [
  { key: "ink", label: "Ink", color: "hsl(28,80%,52%)" },
  { key: "spare_parts", label: "Spare Parts", color: "hsl(220,45%,35%)" },
  { key: "machine", label: "Machine", color: "hsl(199,89%,48%)" },
  { key: "head", label: "Head", color: "hsl(280,60%,55%)" },
  { key: "other", label: "Other", color: "hsl(220,10%,60%)" },
];

/* ── Concentration (Pareto) ───────────────────────────────────────────────────── */

export interface ConcentrationPoint {
  name: string;
  outstanding: number;
}
export interface ConcentrationSeries {
  rows: ConcentrationPoint[];
  /** Share of the set's total exposure held by the top 5 / top 10 accounts (%). */
  top5Pct: number;
  top10Pct: number;
  total: number;
}

/** Top `limit` accounts by outstanding, plus how concentrated the exposure is. */
export function concentrationSeries(rows: ExposureRow[], limit = 10): ConcentrationSeries {
  const sorted = [...rows].sort((a, b) => b.outstanding - a.outstanding);
  const total = sorted.reduce((s, r) => s + Math.max(0, r.outstanding), 0);
  const shareOfTop = (n: number) =>
    total > 0 ? (sorted.slice(0, n).reduce((s, r) => s + Math.max(0, r.outstanding), 0) / total) * 100 : 0;
  return {
    rows: sorted.slice(0, limit).map((r) => ({ name: r.customer, outstanding: r.outstanding })),
    top5Pct: shareOfTop(5),
    top10Pct: shareOfTop(10),
    total,
  };
}

/* ── Overdue aging mix ────────────────────────────────────────────────────────── */

export interface AgingPoint {
  bucket: string;
  amount: number;
  color: string;
}

/** Sum each row's (already sale-type-projected) aging buckets into one series. */
export function agingSeries(rows: ExposureRow[]): AgingPoint[] {
  const totals = AGING_ORDER.map((k) => ({
    bucket: AGING_LABELS[k],
    amount: rows.reduce((s, r) => s + (r.agingBuckets?.[k] ?? 0), 0),
    color: AGING_COLORS[k],
  }));
  return totals;
}

/* ── Exposure by sale type ────────────────────────────────────────────────────── */

export interface SaleTypePoint {
  type: string;
  amount: number;
  color: string;
}

/**
 * Outstanding by sale type. `outstandingByType` stays the full 5-type record even
 * under a Sale Type filter, so restrict to `activeSaleTypes` (empty / all = all five)
 * — otherwise the donut would show filtered-out types and its total wouldn't tie to
 * the shown exposure.
 */
export function saleTypeSeries(rows: ExposureRow[], activeSaleTypes: string[]): SaleTypePoint[] {
  const active =
    activeSaleTypes.length > 0 && activeSaleTypes.length < SALE_TYPE_META.length
      ? new Set(activeSaleTypes)
      : null; // null = all types
  return SALE_TYPE_META.filter((m) => !active || active.has(m.key))
    .map((m) => ({
      type: m.label,
      amount: rows.reduce((s, r) => s + Math.max(0, r.outstandingByType?.[m.key] ?? 0), 0),
      color: m.color,
    }))
    .filter((p) => p.amount > 0.5);
}

/* ── Exposure by salesperson ──────────────────────────────────────────────────── */

export interface SalespersonPoint {
  salesPerson: string;
  outstanding: number;
  overdue: number;
}

/** Outstanding + overdue per salesperson, biggest exposure first, top `limit`. */
export function salespersonSeries(rows: ExposureRow[], limit = 10): SalespersonPoint[] {
  const by = new Map<string, SalespersonPoint>();
  for (const r of rows) {
    const key = r.salesPerson || "Unassigned";
    const p = by.get(key) ?? { salesPerson: key, outstanding: 0, overdue: 0 };
    p.outstanding += r.outstanding;
    p.overdue += r.overdue;
    by.set(key, p);
  }
  return [...by.values()].sort((a, b) => b.outstanding - a.outstanding).slice(0, limit);
}

/* ── AI payload ───────────────────────────────────────────────────────────────── */

export interface AiAccount {
  rank: number;
  customer: string;
  salesPerson: string;
  category: string;
  outstanding: number;
  overdue: number;
  creditLimit: number;
  utilizationPct: number;
  maxOverdueDays: number;
}

export interface AiPayload {
  context: { fyLabel: string; saleTypes: string[]; rankBy: string; shown: number };
  totals: {
    customers: number;
    exposure: number;
    overdue: number;
    overCreditLimit: number;
    top5Pct: number;
    top10Pct: number;
  };
  bySaleType: { type: string; amount: number }[];
  bySalesperson: { salesPerson: string; outstanding: number; overdue: number }[];
  agingMix: { bucket: string; amount: number }[];
  accounts: AiAccount[];
  remainingCount: number;
  remainingOutstanding: number;
}

/**
 * Compact JSON for the AI function. Per-account detail is capped at the top 50 by rank
 * (so "Top-N = All" can't send a huge payload); the tail is summarised.
 */
export function buildAiPayload(
  rows: ExposureRow[],
  ctx: { fyLabel: string; saleTypes: string[]; rankBy: "outstanding" | "overdue" },
): AiPayload {
  const conc = concentrationSeries(rows, 10);
  const overCreditLimit = rows.filter((r) => r.creditLimit > 0 && r.utilization > 100).length;
  const ACCOUNT_CAP = 50;
  const detailed = rows.slice(0, ACCOUNT_CAP);
  const tail = rows.slice(ACCOUNT_CAP);
  const round = (n: number) => Math.round(n);
  return {
    context: { fyLabel: ctx.fyLabel, saleTypes: ctx.saleTypes, rankBy: ctx.rankBy, shown: rows.length },
    totals: {
      customers: rows.length,
      exposure: round(rows.reduce((s, r) => s + r.outstanding, 0)),
      overdue: round(rows.reduce((s, r) => s + r.overdue, 0)),
      overCreditLimit,
      top5Pct: Math.round(conc.top5Pct),
      top10Pct: Math.round(conc.top10Pct),
    },
    bySaleType: saleTypeSeries(rows, ctx.saleTypes).map((p) => ({ type: p.type, amount: round(p.amount) })),
    bySalesperson: salespersonSeries(rows, 10).map((p) => ({
      salesPerson: p.salesPerson,
      outstanding: round(p.outstanding),
      overdue: round(p.overdue),
    })),
    agingMix: agingSeries(rows).map((p) => ({ bucket: p.bucket, amount: round(p.amount) })),
    accounts: detailed.map((r, i) => ({
      rank: i + 1,
      customer: r.customer,
      salesPerson: r.salesPerson,
      category: r.category || "—",
      outstanding: round(r.outstanding),
      overdue: round(r.overdue),
      creditLimit: round(r.creditLimit),
      utilizationPct: r.creditLimit > 0 ? Math.round(r.utilization) : 0,
      maxOverdueDays: r.maxOverdueDays,
    })),
    remainingCount: tail.length,
    remainingOutstanding: round(tail.reduce((s, r) => s + r.outstanding, 0)),
  };
}
