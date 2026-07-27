/**
 * salesDashboard.ts — the data layer for Dashboards → Sales Dashboard.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_sales_dashboard`, returns all 13 panels already aggregated as one
 * jsonb payload (the browser reads ConnectWave as `anon`, ~3s statement timeout). See
 * "Orange One Supabase Connect"/db/rpt/rpt_sales_dashboard.sql.
 *
 * WHAT MAKES THIS ONE DIFFERENT
 * Every master report before it sat on ONE spine. This is a COMPOSITE screen — sales, income,
 * expense and receivables on one page — and those four snapshots refresh on FOUR SEPARATE crons.
 * So the RPC returns `meta.tie_geo / tie_cust / tie_sp`: the delta between each panel's total and
 * the sales KPI. They are 0 when the spines agree. The page surfaces them rather than quietly
 * showing two panels that disagree with each other.
 *
 * THE ONE PRECOMPUTED THING — AR HISTORY
 * Accounts Receivable at a PAST date is readable nowhere: rpt_receivables_* is a point-in-time
 * snapshot with no history, so it has to be walked from the ledger. Two traps, both of which cost
 * real debugging (a naive walk was out by ₹2.26 Cr on Noida):
 *   • the party-leg `amount` carries Tally's RAW orientation — BANK RECEIPT reads +785.84 L and
 *     GST SALES reads −605.58 L — so the movement must be NEGATED;
 *   • order / delivery-challan / receipt-note vouchers are NON-ACCOUNTING and never move a ledger
 *     balance, but they do carry party legs (−₹1.29 Cr of phantom movement on Noida).
 * Both live in the SQL; this module just reads the result.
 *
 * RECONCILIATION (Orange O Tec Noida, FY 2026-27, as-on 24-Jul-2026 = Talligence's sync):
 * Sales PYTD ₹8.2139 Cr / PY ₹25.9954 Cr and Expense YTD ₹6.9849 Cr / PYTD ₹8.3440 Cr all EXACT;
 * AR month-ends Apr ₹4.8243 / May ₹5.1555 / Jun ₹5.5968 Cr all EXACT; 8 of 10 customer rows to the
 * paisa. Income PYTD is ₹3.9 L below theirs and is NOT reproducible at any as-on date — see §11 of
 * Misc/Talligence-Inputs/sales-dashboard-reconciliation.md. Ours ships; the page footnotes it.
 *
 * Like Income/Expense/Sales Gain, this reuses the Sales Report's money / FY / tenant helpers and
 * palette outright rather than re-deriving them.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, salesPeriod, salesFyOptions, priorFy, tenantForFy,
  salesCat, SALES_CURRENT, SALES_PRIOR, SALES_ACCENT,
} from "./salesReport";

/* Re-export the shared primitives under Dashboard-flavoured names, so the page reads cleanly. */
export {
  fmtSales as fmtDash,
  tickSales as tickDash,
  pctChange,
  salesPeriod as dashPeriod,
  salesFyOptions as dashFyOptions,
  priorFy,
  tenantForFy,
  salesCat as dashCat,
  SALES_CURRENT as DASH_CURRENT,
  SALES_PRIOR as DASH_PRIOR,
  SALES_ACCENT as DASH_ACCENT,
};

/* ------------------------------------------------------------------ types */

export interface DashKpi {
  ytd: number; pytd: number; py_total: number; cy_total: number;
}
export interface DashMonthPoint { fy: "cy" | "py"; m: number; amt: number }

/** Income / Expense share one shape: a KPI pair plus the twelve-month CY-vs-PY line. */
export interface DashSeries {
  ytd: number; pytd: number; monthly: DashMonthPoint[];
}

export interface DashGeoRow { state: string; ytd: number; pytd: number }
export interface DashCustomerRow { party: string; sales: number }
export interface DashSalespersonRow { name: string; ytd: number; pytd: number }

/**
 * One row per item that moved in either year. `py_ytd_qty` is the SAME PERIOD last year and
 * `py_full_qty` the WHOLE prior FY — both are returned so the Emerging / Non-Performing basis
 * toggle costs nothing. Talligence uses py_full, which compares ~4 months against 12; we default
 * to the like-for-like window and offer theirs.
 */
export interface DashProductRow {
  item: string; base_unit: string;
  cy_qty: number; py_ytd_qty: number; py_full_qty: number;
  cy_sales: number;
}

export interface DashAr {
  current: number | null; pytd: number | null; monthly: DashMonthPoint[];
}

export interface DashMeta {
  tenant: string; as_on: string; prior_as_on: string;
  ar_built_at: string | null; sales_built_at: string | null; gain_built_at: string | null;
  /** Panel total − sales KPI. Non-zero means two separately-refreshed spines have drifted apart. */
  tie_geo: number; tie_cust: number; tie_sp: number;
}

export interface SalesDashboardData {
  kpi: DashKpi;
  monthly: DashMonthPoint[];
  income: DashSeries;
  expense: DashSeries;
  geography: DashGeoRow[];
  customers: DashCustomerRow[];
  salespersons: DashSalespersonRow[];
  products: DashProductRow[];
  ar: DashAr;
  meta: DashMeta;
}

/* ------------------------------------------------------------------ reads */

export async function loadSalesDashboard(companyGuid: string, fy: string): Promise<SalesDashboardData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = salesPeriod(fy);

  const { data, error } = await cw.rpc("rpt_sales_dashboard", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_pfy_from: p.pFrom,
    p_pas_on: p.pAsOn,
    p_pfy_to: p.pTo,
  });
  if (error) throw new Error(error.message);
  return data as SalesDashboardData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; days?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the AR walk for ONE company — the same work the 22:00 IST cron does. Only AR is
 * precomputed, so this is all the page can refresh; the sales / income / expense spines have
 * their own Refresh on their own reports.
 */
export async function refreshSalesDashboardCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_sales_dashboard_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; days: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

export async function loadSalesDashboardLastRefresh(
  companyGuid: string, fy: string,
): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_sales_dashboard_refresh_log")
    .select("ran_at,tenant_id,days,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* ------------------------------------------------------------- derivations */

/** Which prior-year window the product charts compare against. */
export type ProductBasis = "pytd" | "pyfull";

export const PRODUCT_BASIS_LABEL: Record<ProductBasis, string> = {
  pytd: "Same period last year",
  pyfull: "Full prior year (Talligence)",
};

const priorQty = (r: DashProductRow, basis: ProductBasis) =>
  basis === "pyfull" ? Number(r.py_full_qty) || 0 : Number(r.py_ytd_qty) || 0;

export interface ProductMovementRow {
  item: string; cyQty: number; pyQty: number; delta: number;
}

/**
 * Top 5 Emerging Products — biggest quantity GAIN against the chosen prior window.
 *
 * Sorting on the delta (not on CY) is what reproduces Talligence's own row order: its bars run
 * 11.2 / 8.9 / 5.2 / 6.8 / 4.1 K, which is not monotonic in CY and only makes sense as a growth
 * ranking.
 */
export function emergingProducts(rows: DashProductRow[], basis: ProductBasis, n = 5): ProductMovementRow[] {
  return rows
    .map((r) => {
      const cyQty = Number(r.cy_qty) || 0;
      const pyQty = priorQty(r, basis);
      return { item: r.item, cyQty, pyQty, delta: cyQty - pyQty };
    })
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, n);
}

/**
 * Top 5 Non-Performing Products — biggest quantity DROP.
 *
 * `cyQty > 0` is a real rule, not a tidy-up: on raw decline our ranking puts EP SUBLIMATION INK
 * YELLOW third (prior 15 640, current 0) but Talligence omits it. An item with no current-year
 * movement at all is discontinued rather than declining, and a list meant to be acted on should
 * not be topped by products nobody sells any more.
 */
export function nonPerformingProducts(rows: DashProductRow[], basis: ProductBasis, n = 5): ProductMovementRow[] {
  return rows
    .map((r) => {
      const cyQty = Number(r.cy_qty) || 0;
      const pyQty = priorQty(r, basis);
      return { item: r.item, cyQty, pyQty, delta: pyQty - cyQty };
    })
    .filter((r) => r.delta > 0 && r.cyQty > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, n);
}

export interface ProductTableRow {
  item: string; qty: number; baseUnit: string; sales: number;
}

/** Top 5 by current-year quantity / revenue — the two tables under the charts. */
export function topProductsByQty(rows: DashProductRow[], n = 5): ProductTableRow[] {
  return rows
    .map((r) => ({ item: r.item, qty: Number(r.cy_qty) || 0, baseUnit: r.base_unit, sales: Number(r.cy_sales) || 0 }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, n);
}

export function topProductsByRevenue(rows: DashProductRow[], n = 5): ProductTableRow[] {
  return rows
    .map((r) => ({ item: r.item, qty: Number(r.cy_qty) || 0, baseUnit: r.base_unit, sales: Number(r.cy_sales) || 0 }))
    .filter((r) => r.sales > 0)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, n);
}

/**
 * Share of the India total, and the band Talligence shades the choropleth by.
 * Reproduced from the source screen: Punjab 38.07 % → the 30-40 % band, which is the one clearly
 * darkest state on its map.
 */
export const GEO_BANDS = [
  { min: 60, label: "60-100%" }, { min: 50, label: "50-60%" }, { min: 40, label: "40-50%" },
  { min: 30, label: "30-40%" }, { min: 20, label: "20-30%" }, { min: 10, label: "10-20%" },
  { min: 0.0001, label: "0-10%" }, { min: -Infinity, label: "0%" },
] as const;

export const geoBand = (sharePct: number) =>
  GEO_BANDS.find((b) => sharePct >= b.min)?.label ?? "0%";

/**
 * The untagged bucket is a first-class row, not a rounding error: on Noida it is ₹199.18 L, a
 * quarter of YTD sales. A Top-5 that hides it would not tie to the KPI.
 */
export const UNTAGGED = "(Untagged)";

export const isUntagged = (name: string) => name === UNTAGGED;

/** Sales achievement against the same period last year — what the gauge needle reads. */
export function achievementPct(ytd: number, pytd: number): number | null {
  const base = Number(pytd) || 0;
  if (base <= 0) return null;
  return ((Number(ytd) || 0) / base) * 100;
}

/** True when any panel has drifted from the sales KPI — the spines refresh on separate crons. */
export function tieBroken(meta?: DashMeta | null, tolerance = 1): boolean {
  if (!meta) return false;
  return [meta.tie_geo, meta.tie_cust, meta.tie_sp].some((d) => Math.abs(Number(d) || 0) > tolerance);
}
