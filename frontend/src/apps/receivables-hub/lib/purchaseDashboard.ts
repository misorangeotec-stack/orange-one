/**
 * purchaseDashboard.ts — the data layer for Dashboards → Purchase Dashboard.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_purchase_dashboard`, returns all 10 panels already aggregated as
 * one jsonb payload (the browser reads ConnectWave as `anon`, ~3s statement timeout). See
 * "Orange One Supabase Connect"/db/rpt/rpt_purchase_dashboard.sql. Measured: 202 ms on Noida,
 * 1.87 s on the largest book — faster than its sales twin, which does the same job in 2.34 s.
 *
 * THE ONE PRECOMPUTED THING — AP HISTORY
 * Accounts Payable at a PAST date is readable nowhere: rpt_payables_ledger is a point-in-time
 * snapshot with no history, and rpt_payables_report ships `accounts_payable` as a hardcoded `[]`
 * precisely because no month-end payable source existed. `rpt_purchase_dashboard_ap` IS that
 * source — a daily Sundry-Creditor movement walk anchored on the CLOSING, not the opening.
 *
 * THE SIGN — PAYABLE-POSITIVE, RESOLVED IN THE SQL
 * Talligence prints AP negative (−₹18.46 L on Noida) and so does our own Finance → Payables report
 * (`kpi.outstanding = -sum(closing)`, verified −18,45,632.65). The walk therefore stores
 * payable-positive so the running balance lands on that number directly, and NOTHING in this
 * module or the page negates anything. If you find yourself adding a minus sign here, the bug is
 * upstream.
 *
 * WHY THERE IS ONLY ONE TIE CHECK
 * The sales dashboard reports `tie_geo / tie_cust / tie_sp` because its geography and salesperson
 * panels ride a DIFFERENT spine (rpt_sales_gain_voucher) from its KPI. Here geography and vendors
 * both ride `rpt_purchase_line`, the same table as the KPI, so those deltas are zero by
 * construction — a check that can never fire is worse than no check. `meta.tie_ap` is the real
 * one: the AP ledger walk (this dashboard's 22:15 cron) against the payables bill snapshot
 * (rpt_payables_ledger, a separate 21:00 cron).
 *
 * RECONCILIATION (Orange O Tec Noida, FY 2026-27, as-on 24-Jul-2026 = Talligence's sync):
 * Purchase PYTD ₹7.6963 Cr / PY ₹23.1433 Cr, Expense YTD ₹6.9937 Cr / PYTD ₹8.3440 Cr, and
 * AP ₹−18.46 L / PYTD ₹−95.16 L are all EXACT; all twelve prior-year monthly bars match; the AP
 * walk reproduces their chart (Apr +1.60 / May −14.72 / Jun −19.96 / Jul −18.46 L).
 * TWO KNOWN DIVERGENCES, both deliberate and footnoted on the page:
 *   • Purchase YTD ₹6.4129 Cr vs their ₹3.71 Cr — THEIR current year is stale (proven six ways
 *     when rpt_purchase_report was built; their PY ties to the rupee). We ship truth, as that
 *     report already does, so our two purchase screens agree.
 *   • Income PYTD ₹8.2910 Cr vs their ₹8.33 Cr — unreproducible at any as-on date; identical to
 *     the Sales Dashboard, which carries the same footnote.
 *
 * Like Income/Expense/Sales Gain, this reuses the Purchase Report's money / FY / tenant helpers
 * and palette outright rather than re-deriving them.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, purchasePeriod, purchaseFyOptions, priorFy, tenantForFy,
  purchaseCat, PURCHASE_CURRENT, PURCHASE_PRIOR, SALES_ACCENT,
} from "./purchaseReport";
// GEO_BANDS / geoBand / achievementPct are sales-agnostic; sharing them keeps the two dashboards
// shading and gauging on identical rules.
import { GEO_BANDS, geoBand, achievementPct } from "./salesDashboard";

/* Re-export the shared primitives under the SAME Dashboard-flavoured names the Sales Dashboard
   uses, so PurchaseDashboard.tsx reads as a clean diff of SalesDashboard.tsx. */
export {
  fmtSales as fmtDash,
  tickSales as tickDash,
  pctChange,
  purchasePeriod as dashPeriod,
  purchaseFyOptions as dashFyOptions,
  priorFy,
  tenantForFy,
  purchaseCat as dashCat,
  PURCHASE_CURRENT as DASH_CURRENT,
  PURCHASE_PRIOR as DASH_PRIOR,
  SALES_ACCENT as DASH_ACCENT,
  GEO_BANDS,
  geoBand,
  achievementPct,
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

/**
 * One row per vendor active in EITHER year. `purchase` is the YTD figure the table ranks and
 * totals on; the roster deliberately keeps vendors at ₹0 YTD, because Talligence's own table shows
 * them (R.G. ELECTRICALS, FOURWAY INTERNATIONAL, HINDUSTAN RUBBER all sit at ₹0 / 0 %). Scoping
 * the roster to YTD-active instead would drop it from 31 rows to 10.
 */
export interface DashVendorRow {
  party: string; purchase: number; pytd: number; cy_total: number; py_total: number;
}

/** One row per item purchased this year, with the unit Tally bills it in. */
export interface DashProductRow {
  item: string; base_unit: string; cy_qty: number; cy_amt: number;
}

export interface DashAp {
  current: number | null; pytd: number | null; monthly: DashMonthPoint[];
}

export interface DashMeta {
  tenant: string; as_on: string; prior_as_on: string;
  ap_built_at: string | null; purchase_built_at: string | null; item_built_at: string | null;
  /** AP ledger walk − payables bill snapshot. Non-zero means one of two crons is behind. */
  tie_ap: number;
  /** Product-table coverage − purchase KPI. Structurally ≤ 0; a caption, not an alarm. */
  item_vs_line: number;
}

export interface PurchaseDashboardData {
  kpi: DashKpi;
  monthly: DashMonthPoint[];
  income: DashSeries;
  expense: DashSeries;
  geography: DashGeoRow[];
  vendors: DashVendorRow[];
  products: DashProductRow[];
  ap: DashAp;
  meta: DashMeta;
}

/* ------------------------------------------------------------------ reads */

export async function loadPurchaseDashboard(
  companyGuid: string, fy: string,
): Promise<PurchaseDashboardData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = purchasePeriod(fy);

  const { data, error } = await cw.rpc("rpt_purchase_dashboard", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_pfy_from: p.pFrom,
    p_pas_on: p.pAsOn,
    p_pfy_to: p.pTo,
  });
  if (error) throw new Error(error.message);
  return data as PurchaseDashboardData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; days?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the AP walk for ONE company — the same work the 22:15 IST cron does. Only AP is
 * precomputed, so this is all the page can refresh; the purchase / income / expense spines have
 * their own Refresh on their own reports.
 */
export async function refreshPurchaseDashboardCompany(
  companyGuid: string, fy: string,
): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_purchase_dashboard_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; days: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

export async function loadPurchaseDashboardLastRefresh(
  companyGuid: string, fy: string,
): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_purchase_dashboard_refresh_log")
    .select("ran_at,tenant_id,days,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* ------------------------------------------------------------- derivations */

export interface ProductTableRow {
  item: string; qty: number; baseUnit: string; amount: number;
}

const toTableRow = (r: DashProductRow): ProductTableRow => ({
  item: r.item,
  qty: Number(r.cy_qty) || 0,
  baseUnit: r.base_unit,
  amount: Number(r.cy_amt) || 0,
});

/** Top 5 by current-year quantity / amount — the two tables at the foot of the page. */
export function topProductsByQty(rows: DashProductRow[], n = 5): ProductTableRow[] {
  return rows.map(toTableRow).filter((r) => r.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, n);
}

export function topProductsByAmount(rows: DashProductRow[], n = 5): ProductTableRow[] {
  return rows.map(toTableRow).filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, n);
}

/**
 * True when the AP walk and the payables bill snapshot disagree — they are rebuilt by two
 * different nightly crons (22:15 and 21:00), so one can lag the other.
 *
 * Deliberately NOT imported from salesDashboard: that version reads tie_geo / tie_cust / tie_sp,
 * none of which exist in this payload. It would compile, type-check, run — and never fire.
 */
export function tieBroken(meta?: DashMeta | null, tolerance = 1): boolean {
  if (!meta) return false;
  return Math.abs(Number(meta.tie_ap) || 0) > tolerance;
}

/**
 * How much of the purchase KPI the two product tables actually cover.
 *
 * `rpt_purchase_item` ingests only 'GST PURCHASE'-nature vouchers while `rpt_purchase_line` also
 * takes Credit Note / Debit Note / Journal, so a shortfall is STRUCTURAL, not a fault — it is
 * rendered as a caption under the tables, never as a warning banner.
 */
export function productCoverage(meta?: DashMeta | null, kpiYtd?: number): number | null {
  const gap = Number(meta?.item_vs_line);
  const ytd = Number(kpiYtd) || 0;
  if (!meta || !Number.isFinite(gap) || ytd <= 0) return null;
  return ((ytd + gap) / ytd) * 100;
}
