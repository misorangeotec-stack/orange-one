/**
 * execDashboard.ts — the data layer for Dashboards → C-Level Dashboard.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_clevel_dashboard(tenant, fy)`, returns all 22 panels as one
 * jsonb payload. Unlike its sales and purchase siblings that RPC does NOT compute — it reads a
 * row out of `rpt_clevel_dashboard_cache`, materialised nightly at 22:30 IST. See
 * "Orange One Supabase Connect"/db/rpt/rpt_clevel_dashboard.sql.
 *
 * WHY A CACHE, WHEN THE OTHER TWO DASHBOARDS COMPUTE LIVE
 * This screen spans six spines instead of four, and the computing function measures 1,530 ms on
 * Noida but 6,185 ms on the largest book (a4e100d1: 8,232 stock items, 5,074 ledgers, 44k income
 * lines) — twice the ~3 s statement timeout the browser gets as `anon`. Four companies out of
 * five is not a working screen. Materialised, the same book reads in 2 ms.
 *
 * WHAT THAT COSTS, AND WHY IT IS FINE
 * The payload is only as fresh as the last nightly (or the last Refresh press). That is not a
 * regression: the mirror itself only moves when the connector syncs, and `meta.stock_as_of`
 * already pins the balance-sheet family to a sync date. `cache.built_at` is surfaced on the page.
 *
 * THIS REPLACES the 2026-07-23 dashboard built on `clevel_pl_monthly` / `mv_clevel_ledger`, whose
 * only refresh cron was found DISABLED — that page was frozen at ₹8.0028 Cr of Noida sales
 * against a live ₹8.2473 Cr. Three of its panels were also simply the wrong metric; see the
 * reconciliation write-up.
 *
 * RECONCILIATION (Orange O Tec NOIDA, FY 2026-27) — full table in
 * Misc/Talligence-Inputs/clevel-dashboard-reconciliation.md. The headline finding is that
 * Talligence serves this screen from TWO CACHES OF DIFFERENT AGES: its header says 23-Jul-2026
 * and its turnover/P&L panels reconcile there, but its balance-sheet panels are two days older —
 * bank ties EXACTLY at ₹14.3870 L on 21-Jul, not at 23-Jul (₹24.34 L). Ours is internally
 * consistent at one as-on date, which is strictly better than the artefact being cloned.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, salesPeriod, salesFyOptions, priorFy, tenantForFy,
  SALES_CURRENT, SALES_PRIOR, SALES_ACCENT,
} from "./salesReport";
import { achievementPct } from "./salesDashboard";

/* Re-exported under Dashboard-flavoured names so ExecDashboard.tsx reads like its two siblings
   rather than re-deriving money / FY / palette helpers that already exist. */
export {
  fmtSales as fmtDash,
  tickSales as tickDash,
  pctChange,
  salesPeriod as dashPeriod,
  salesFyOptions as dashFyOptions,
  priorFy,
  tenantForFy,
  SALES_CURRENT as DASH_CURRENT,
  SALES_PRIOR as DASH_PRIOR,
  SALES_ACCENT as DASH_ACCENT,
  achievementPct,
};

/* ------------------------------------------------------------------ types */

/** The month-point shape shared by every series on this page. THE KEY IS `amt`, ALWAYS. */
export interface DashMonthPoint { fy: "cy" | "py"; m: number; amt: number }

/**
 * The Apr→Mar aligned point the `components/clevel/` primitives consume.
 * Exported from here rather than the old `clevelDashboard.ts` so that file can be deleted
 * without touching MetricTrendCard.
 */
export interface MonthPoint {
  month: string;
  current: number | null;
  prior: number | null;
}

export interface DashKpi { ytd: number; pytd: number; py_total: number; cy_total: number }

/** Purchase / Income / Expense share one shape: a KPI pair plus the CY-vs-PY twelve-month line. */
export interface DashSeries { ytd: number; pytd: number; monthly: DashMonthPoint[] }

/**
 * The P&L block.
 *
 * `gp` / `np` carry the stock term and are EXACT — but only at the sync date, because Tally gives
 * opening and closing stock at that date and nowhere else. `gp_ex` / `np_ex` / `py_gp_ex` /
 * `py_np_ex` drop the term, and are the ONLY basis on which the two years may be compared.
 * NEVER put a with-stock CY beside an ex-stock PY.
 *
 * Reconstructing stock at a past date was tried and does not work: walking purchase inward value
 * minus COGS yields −₹1.22 L against an actual ΔStock of −₹48.82 L over Noida's FY, because stock
 * also moves through stock journals / manufacturing / transfers and `cost_amount` is derived
 * (Tally stores no cost).
 */
export interface DashPl {
  sales: number; direct_incomes: number; indirect_incomes: number;
  purchase: number; direct_expenses: number; indirect_expenses: number;
  opening_stock: number; closing_stock: number; stock_delta: number;
  gp: number; np: number;
  gp_ex: number; np_ex: number; py_gp_ex: number; py_np_ex: number;
}

export interface DashRatios {
  current_assets: number; current_liabilities: number; closing_stock: number;
  bank: number; cash: number; loans: number; equity: number;
  current_ratio: number | null;
  quick_ratio: number | null;
  debt_to_equity: number | null;
  roe: number | null;
  oer: number | null;
}

/** One quarter of the FY. `oer` is per-quarter and EX-STOCK — see DashPl. */
export interface DashQuarter {
  fy: "cy" | "py"; q: number;
  income: number; expense: number;
  oer: number | null; np_cum: number; equity: number;
  roe: number | null; debt_to_equity: number | null;
}

export interface DashFundLedger { bucket: "bank" | "cash" | "loans"; name: string; amount: number }
export interface DashFunds {
  bank: number; cash: number; loans: number;
  ledgers: DashFundLedger[];
}

export interface DashPartyRow { party: string; sales: number }
export interface DashVendorRow { party: string; purchase: number }
export interface DashBalance { current: number | null; pytd: number | null; monthly: DashMonthPoint[] }
export interface DashStockGroup { stock_group: string; qty: number; value: number }
export interface DashMovementRow { item: string; qty: number; stock_group: string; base_unit: string }
export interface DashNonMovingRow { item: string; stock_group: string }
export interface DashDutyRow { tax_name: string; receivable: number; payable: number }

export interface DashMeta {
  tenant: string; as_on: string; prior_as_on: string;
  bs_built_at: string | null; sales_built_at: string | null;
  ar_built_at: string | null; ap_built_at: string | null;
  /** The date Tally's opening/closing stock pair was read. Pins gp / np / oer / the ratios. */
  stock_as_of: string | null;
  /** AR ledger walk − debtor closing. */
  tie_ar: number;
  /** AP ledger walk − payables bill snapshot (different crons). */
  tie_ap: number;
  /** Balance walk − the ledger master it is anchored on. Zero by construction at the sync date. */
  tie_bs: number;
}

/** Present on every payload, including the not-yet-built marker. */
export interface DashCache { built_at: string | null; as_on: string | null; fy: string }

export interface ExecDashboardData {
  kpi?: DashKpi;
  monthly?: DashMonthPoint[];
  purchase?: DashSeries;
  income?: DashSeries;
  expense?: DashSeries;
  pl?: DashPl;
  ratios?: DashRatios;
  quarters?: DashQuarter[];
  funds?: DashFunds;
  customers?: DashPartyRow[];
  vendors?: DashVendorRow[];
  ar?: DashBalance;
  ap?: DashBalance;
  stock_groups?: DashStockGroup[];
  movement?: { fast: DashMovementRow[]; slow: DashMovementRow[]; non_moving: DashNonMovingRow[] };
  duties?: DashDutyRow[];
  meta?: DashMeta;
  cache: DashCache;
}

/* ------------------------------------------------------------------ reads */

export async function loadExecDashboard(
  companyGuid: string, fy: string,
): Promise<ExecDashboardData> {
  const cw = getConnectwaveSupabase();
  // Never `acct_orange::${guid}`: two of the five companies have FY-split Tally books, and on a
  // prior year the bare GUID silently reads the wrong one. rpt_sales_book resolves the winner.
  const tenant = await tenantForFy(companyGuid, fy);

  const { data, error } = await cw.rpc("rpt_clevel_dashboard", { p_tenant: tenant, p_fy: fy });
  if (error) throw new Error(error.message);
  return data as ExecDashboardData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; days?: number; tenants?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the balance walk AND every FY's payload for ONE company — the same work the 22:30 IST
 * cron does for all of them. Unlike the sibling dashboards this genuinely re-derives the whole
 * screen, because the whole screen is materialised.
 */
export async function refreshExecDashboardCompany(
  companyGuid: string, fy: string,
): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_clevel_dashboard_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; days: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

export async function loadExecDashboardLastRefresh(
  companyGuid: string, fy: string,
): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_clevel_dashboard_refresh_log")
    .select("ran_at,tenant_id,days,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* ------------------------------------------------------------- derivations */

const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Align a cy/py series onto the Apr→Mar axis.
 *
 * Reads `amt` — and EVERY series in this payload emits `amt` for that reason. A key mismatch does
 * not error, it renders that chart as flat zeros and the build stays green; that shipped once
 * already on the sales dashboard's AR series.
 */
export function alignMonths(points: DashMonthPoint[] | undefined): MonthPoint[] {
  const m = new Map<string, number>();
  for (const p of points ?? []) m.set(`${p.fy}|${p.m}`, Number(p.amt) || 0);
  return FY_MONTHS.map((mo) => ({
    month: MONTH_LABEL[mo],
    current: m.has(`cy|${mo}`) ? m.get(`cy|${mo}`)! : null,
    prior: m.has(`py|${mo}`) ? m.get(`py|${mo}`)! : null,
  }));
}

/** The quarterly axis: Q1..Q4 with both years side by side. */
export interface QuarterPoint { quarter: string; current: number | null; prior: number | null }

export function alignQuarters(
  rows: DashQuarter[] | undefined,
  pick: (q: DashQuarter) => number | null,
): QuarterPoint[] {
  const m = new Map<string, number | null>();
  for (const r of rows ?? []) m.set(`${r.fy}|${r.q}`, pick(r));
  return [1, 2, 3, 4].map((q) => ({
    quarter: `Q${q}`,
    current: m.has(`cy|${q}`) ? m.get(`cy|${q}`)! : null,
    prior: m.has(`py|${q}`) ? m.get(`py|${q}`)! : null,
  }));
}

/** Share of the sales / purchase total, as Talligence's "Involvement (in %)" column. */
export function involvement(amount: number, total: number): number | null {
  if (!total) return null;
  return (amount / total) * 100;
}

/**
 * True when one of the six spines behind this screen has gone stale relative to another.
 *
 * Deliberately NOT imported from salesDashboard: that version reads tie_geo / tie_cust / tie_sp,
 * none of which exist in this payload. It would compile, type-check, run — and never fire.
 */
export function tieBroken(meta?: DashMeta | null, tolerance = 1): boolean {
  if (!meta) return false;
  return [meta.tie_ar, meta.tie_ap, meta.tie_bs]
    .some((t) => Math.abs(Number(t) || 0) > tolerance);
}

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
export function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}
