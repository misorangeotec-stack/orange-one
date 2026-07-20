import type { AgingBuckets, Customer, CustomerGroupMap, SaleType } from "./types";
import { groupNameOf } from "./customerGroups";
import { utilizationPct } from "./receivables";

/**
 * Top Credit-Exposure & Overdue aggregation — pure, UI-free.
 *
 * Backs the "Top 50 Credit Exposure & Overdue Accounts" report (Live/Tally only).
 * One ExposureRow per customer ledger, ranked by outstanding (credit exposure) or
 * overdue. The same rows feed the Aging-style group-by roll-up via buildGroupTree
 * (lib/groupTree.ts) with ExposureMetrics as the per-node accumulator.
 *
 * The incoming `Customer[]` is already sale-type-PROJECTED by useAppData when a Sale
 * Type filter is active (Mechanism A), so `outstanding` / `overdue` here are the
 * in-type figures — this is what makes the Sale Type filter re-rank the whole list.
 * Credit limit / period are per-customer master data (never split by sale type), so
 * they pass through unchanged.
 */

/* ── Row ───────────────────────────────────────────────────────────────────── */

export interface ExposureRow {
  id: string;
  customer: string;
  salesPerson: string;
  company: string;
  location: string;
  category: string;
  /** Parent customer group (muster), or the customer's own name when unmapped. */
  group: string;
  creditPeriod: number;
  creditLimit: number;
  /** Credit exposure = net outstanding (sale-type-projected when a filter is on). */
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  /** outstanding ÷ creditLimit × 100 (0 when no limit set). */
  utilization: number;
  /** Aging split (already sale-type-projected by useAppData) — for the aging chart. */
  agingBuckets: AgingBuckets;
  /** Outstanding split by sale type — for the sale-type chart. Full 5-type record even under a
   *  Sale Type filter, so the chart builder must restrict it to the active types. */
  outstandingByType: Record<SaleType, number>;
  overdueByType: Record<SaleType, number>;
}

export function toExposureRow(c: Customer, groupMap: CustomerGroupMap): ExposureRow {
  return {
    id: c.id,
    customer: c.name,
    salesPerson: c.salesPerson || "Unassigned",
    company: c.company || "—",
    location: c.location || "—",
    category: c.category || "",
    group: groupNameOf(c, groupMap),
    creditPeriod: c.creditPeriod ?? 0,
    creditLimit: c.creditLimit ?? 0,
    outstanding: c.outstanding,
    overdue: c.overdue,
    maxOverdueDays: c.maxOverdueDays ?? 0,
    utilization: utilizationPct({ outstanding: c.outstanding, creditLimit: c.creditLimit ?? 0 }),
    agingBuckets: c.agingBuckets,
    outstandingByType: c.outstandingByType,
    overdueByType: c.overdueByType,
  };
}

/* ── Ranking ───────────────────────────────────────────────────────────────── */

export type RankBy = "outstanding" | "overdue";

/** Sort a copy of the rows by the ranking metric, biggest first. */
export function rankRows(rows: ExposureRow[], by: RankBy): ExposureRow[] {
  return [...rows].sort((a, b) => b[by] - a[by]);
}

/* ── Group-by roll-up (for buildGroupTree<ExposureRow, ExposureMetrics>) ─────── */

export interface ExposureMetrics {
  creditLimit: number;
  outstanding: number;
  overdue: number;
  /** MAX across the node's customers — never summed. */
  maxOverdueDays: number;
  count: number;
}

export function emptyExposureMetrics(): ExposureMetrics {
  return { creditLimit: 0, outstanding: 0, overdue: 0, maxOverdueDays: 0, count: 0 };
}

export function metricsOfRow(r: ExposureRow): ExposureMetrics {
  return {
    creditLimit: r.creditLimit,
    outstanding: r.outstanding,
    overdue: r.overdue,
    maxOverdueDays: r.maxOverdueDays,
    count: 1,
  };
}

export function addExposureMetrics(acc: ExposureMetrics, m: ExposureMetrics): void {
  acc.creditLimit += m.creditLimit;
  acc.outstanding += m.outstanding;
  acc.overdue += m.overdue;
  acc.maxOverdueDays = Math.max(acc.maxOverdueDays, m.maxOverdueDays);
  acc.count += m.count;
}

/**
 * Utilisation is a RATIO — recompute it from summed outstanding / summed credit
 * limit at every roll-up level. Never sum a percentage.
 */
export function utilizationOf(m: ExposureMetrics): number {
  return utilizationPct({ outstanding: m.outstanding, creditLimit: m.creditLimit });
}

/* ── Dimensions ────────────────────────────────────────────────────────────── */

export type ExposureDimension =
  | "salesperson"
  | "category"
  | "group"
  | "company"
  | "location"
  | "customer";

export const EXPOSURE_DIMENSIONS: { key: ExposureDimension; label: string }[] = [
  { key: "salesperson", label: "Salesperson" },
  { key: "category", label: "Customer Category" },
  { key: "group", label: "Customer Group" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "customer", label: "Customer" },
];

/** Composite separator kept out of any real value (same idea as agingReport's KEY_SEP). */
const KEY_SEP = " ||| ";

/**
 * Bucket value + display label (+ optional sub-label) for a row on a dimension —
 * the `dimValue` callback for buildGroupTree. The `customer` dimension keys per
 * ledger (name · company · location) so same-name ledgers never club.
 */
export function dimValueOf(
  row: ExposureRow,
  dim: string,
): { value: string; label: string; sub?: string } {
  switch (dim as ExposureDimension) {
    case "salesperson":
      return { value: row.salesPerson, label: row.salesPerson };
    case "category":
      return { value: row.category || "Uncategorized", label: row.category || "Uncategorized" };
    case "group":
      return { value: row.group, label: row.group };
    case "company":
      return { value: row.company, label: row.company };
    case "location":
      return { value: row.location, label: row.location };
    case "customer": {
      const value = `${row.customer}${KEY_SEP}${row.company}${KEY_SEP}${row.location}`;
      const sub = [row.company, row.location].filter((s) => s && s !== "—").join(" · ");
      return { value, label: row.customer, sub: sub || undefined };
    }
    default:
      return { value: "—", label: "—" };
  }
}
