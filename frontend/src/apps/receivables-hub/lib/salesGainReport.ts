/**
 * salesGainReport.ts — the data layer for Master Reports → Finance → Sales Gain Report.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_sales_gain_report`, returns every panel already aggregated as one
 * jsonb payload (the browser reads ConnectWave as `anon`, ~3s statement timeout). It reads the
 * precomputed `rpt_sales_gain_voucher` + `rpt_sales_gain_item` snapshots (see
 * "Orange One Supabase Connect"/db/rpt/rpt_sales_gain_report.sql).
 *
 * WHAT "GAIN" MEANS HERE — read this before trusting the number
 * Gain = sales − cost of goods sold. Tally stores NO cost anywhere: a sales voucher's inventory
 * entries carry item / qty / rate / amount and nothing else, so cost is DERIVED, per item, from the
 * item's own VALUATIONMETHOD:
 *   • `At Zero Price` → 0 (the item genuinely has no cost)
 *   • `Std. Price`    → weighted-average ACTUAL purchase rate
 *   • otherwise       → Tally's CLOSINGRATE (a real average cost), falling back to purchase
 * The middle case is the important one and covers 82% of the book. On a `Std. Price` item Tally's
 * closing rate is a CONFIGURED STANDARD, not a cost — REACTIVE INK H-SERIES GREY is bought at
 * ₹393.92/kg and valued at ₹321.65/kg — so using it would overstate gain by ~13 points.
 *
 * WHY THIS DOES NOT MATCH TALLIGENCE'S HEADLINE, DELIBERATELY
 * Talligence prints TWO irreconcilable gains on one screen for the same period: 40.59% on its KPI
 * row and 22.70% on its own All Products table. Each basis reproduces exactly one of them —
 * closing-rate-everywhere gives 39.22%, this method-aware rule gives 24.99%. Their KPI books a
 * standard selling price as cost. We ship the defensible one, and every panel here ties to every
 * other panel by construction.
 *
 * RECONCILIATION (Orange O Tec Noida, FY 2026-27) — the sales spine ties exactly:
 * PYTD ₹8.2139 Cr and PY ₹25.9954 Cr against Talligence's ₹8.21 Cr / ₹26 Cr; 7 of its 10 visible
 * customer rows to the paisa; 89 customers vs its "1–10 of 89"; PRINTING BELT at 11.36 / 5.36 /
 * 47.19%. YTD runs ₹8.9 L ABOVE Talligence because its 24-Jul sync is stale, the same way Purchase
 * and Expense already are. Full write-up: Misc/Talligence-Inputs/sales-gain-reconciliation.md.
 *
 * Like Income/Expense, this reuses the Sales Report's money / FY / tenant helpers and palette
 * outright rather than re-deriving them.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, salesPeriod, salesFyOptions, priorFy, tenantForFy,
  salesCat, SALES_CURRENT, SALES_PRIOR, SALES_ACCENT,
} from "./salesReport";

/* Re-export the shared primitives under Gain-flavoured names, so the page reads cleanly. */
export {
  fmtSales as fmtGain,
  tickSales as tickGain,
  pctChange,
  salesPeriod as gainPeriod,
  salesFyOptions as gainFyOptions,
  priorFy,
  tenantForFy,
  salesCat as gainCat,
  SALES_CURRENT as GAIN_CURRENT,
  SALES_PRIOR as GAIN_PRIOR,
  SALES_ACCENT as GAIN_ACCENT,
};

/* ------------------------------------------------------------------ types */

export interface GainKpi {
  ytd_sales: number; ytd_gain: number;
  pytd_sales: number; pytd_gain: number;
  py_sales: number; py_gain: number;
  cy_sales: number; cy_gain: number;
}
export interface GainYearPoint  { fy: "cy" | "py"; sales: number; gain: number }
export interface GainMonthPoint { fy: "cy" | "py"; m: number; sales: number; gain: number }
/** `wk` is an FY WEEK (1..53) counted from 1 April — NOT an ISO week. See the RPC header. */
export interface GainWeekPoint  { fy: "cy" | "py"; wk: number; sales: number; gain: number }

export interface GainGeoRow {
  state: string;
  ytd_sales: number; pytd_sales: number; ytd_gain: number; pytd_gain: number;
}
export interface GainSalespersonRow {
  name: string;
  ytd_sales: number; pytd_sales: number; ytd_gain: number; pytd_gain: number;
}
export interface GainCustomerRow { party: string; sales: number; gain: number }

/** `cost_basis` surfaces WHICH rate priced this item — see the valuation note on the page. */
export type CostBasis = "zero" | "actual" | "valuation" | "none";
export interface GainProductRow {
  item: string; grp: string; parent_grp: string; category: string;
  cost_basis: CostBasis;
  cy_sales: number; py_sales: number; cy_gain: number; py_gain: number;
}

/**
 * Drives the honest empty state for a company that sells without inventory lines.
 * Gate on `value_pct`, not `pct` — Colorix Surat books 6 of 9 CY vouchers with items (66.7% by
 * count) but those 6 carry 100% of the ₹8.23 Cr, so a count-based gate would cry wolf. It would
 * equally stay quiet when a few large unpriced invoices dominate. Value is the honest measure.
 */
export interface GainCoverage {
  vouchers: number; with_items: number; pct: number | null;
  sales: number; sales_with_items: number; value_pct: number | null;
}

export interface SalesGainReportData {
  kpi: GainKpi;
  yearly: GainYearPoint[];
  monthly: GainMonthPoint[];
  weekly: GainWeekPoint[];
  geography: GainGeoRow[];
  salespersons: GainSalespersonRow[];
  customers: GainCustomerRow[];
  products: GainProductRow[];
  coverage: GainCoverage;
  filters: { states: string[]; groups: string[]; categories: string[] };
}

export interface SalesGainFilters {
  states?: string[];
  groups?: string[];
  categories?: string[];
}

/* ------------------------------------------------------------------ reads */

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadSalesGainReport(
  companyGuid: string,
  fy: string,
  filters: SalesGainFilters = {},
): Promise<SalesGainReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = salesPeriod(fy);

  const { data, error } = await cw.rpc("rpt_sales_gain_report", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_pfy_from: p.pFrom,
    p_pas_on: p.pAsOn,
    p_pfy_to: p.pTo,
    p_states: arr(filters.states),
    p_groups: arr(filters.groups),
    p_categories: arr(filters.categories),
  });
  if (error) throw new Error(error.message);
  return data as SalesGainReportData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; lines?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the current-FY gain snapshot for ONE company — the same work the 21:45 IST cron does.
 * The RPC rebuilds `rpt_sales_line` first, because the tie layer reads it for ledger-level sales.
 */
export async function refreshSalesGainCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_sales_gain_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; lines: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the ETA. */
export async function loadSalesGainLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_sales_gain_refresh_log")
    .select("ran_at,tenant_id,lines,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* ------------------------------------------------------------- derivations */

/** Gain as a % of sales. Null when there is no sales base to divide by. */
export function gainPct(gain: number, sales: number): number | null {
  const s = Number(sales) || 0;
  if (s === 0) return null;
  return ((Number(gain) || 0) / s) * 100;
}

export interface GainQuarterPoint { fy: "cy" | "py"; q: number; sales: number; gain: number }

/**
 * Quarterly is DERIVED here from `monthly`, never returned by SQL — the house convention across
 * every master report. Q1 = Apr–Jun, so calendar month 4 maps to q1 and month 1 (Jan) to q4.
 */
export function quarterly(monthly: GainMonthPoint[]): GainQuarterPoint[] {
  const acc = new Map<string, GainQuarterPoint>();
  for (const p of monthly) {
    const q = Math.floor(((Number(p.m) + 8) % 12) / 3) + 1;
    const key = `${p.fy}|${q}`;
    const cur = acc.get(key) ?? { fy: p.fy, q, sales: 0, gain: 0 };
    cur.sales += Number(p.sales) || 0;
    cur.gain += Number(p.gain) || 0;
    acc.set(key, cur);
  }
  return [...acc.values()].sort((a, b) => (a.fy === b.fy ? a.q - b.q : a.fy < b.fy ? -1 : 1));
}

/**
 * How much of the book's VALUE this company actually prices. Below this floor the gain columns
 * would be a fabricated margin over a book we cannot cost, so the page suppresses them and says so.
 */
export const COVERAGE_FLOOR = 60;
export const gainIsDerivable = (c?: GainCoverage | null) =>
  !!c && c.vouchers > 0 && Math.abs(Number(c.sales) || 0) > 0 && (c.value_pct ?? 0) >= COVERAGE_FLOOR;
