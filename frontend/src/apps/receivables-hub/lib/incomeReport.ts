/**
 * incomeReport.ts — the data layer for Master Reports → Finance → Income.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_income_report`, returns every panel already aggregated as one
 * jsonb payload (the browser reads ConnectWave as `anon`, ~3s statement timeout). It reads the
 * precomputed `rpt_income_line` snapshot (see
 * "Orange One Supabase Connect"/db/rpt/rpt_income_report.sql).
 *
 * WHAT "INCOME" MEANS HERE
 * The net amount posted to ledgers whose TOP-LEVEL group is an income group
 * {Sales Accounts, Direct Incomes, Indirect Incomes}, over ACCOUNTING vouchers only,
 * credit-positive, net of returns / credit notes / discount ledgers. The Sales Accounts slice is
 * exactly the Sales Report's basis, so it reproduces that report to the rupee. Reconciled against
 * Talligence for Orange O Tec Noida: Sales Accounts PYTD ₹8.2139 Cr / PY ₹25.9954 Cr and total
 * income PYTD ₹8.29 Cr / PY ₹26.18 Cr / Direct Incomes YTD ₹2.9 L all tie exactly.
 *
 * This is the P&L-movement twin of the Sales Report — it reuses that module's money / FY / tenant
 * helpers and palette outright rather than re-deriving them.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, salesPeriod, salesFyOptions, priorFy, tenantForFy,
  salesCat, SALES_CURRENT, SALES_PRIOR,
} from "./salesReport";

/* Re-export the shared primitives under Income-flavoured names, so the page reads cleanly. */
export {
  fmtSales as fmtInc,
  tickSales as tickInc,
  pctChange,
  salesPeriod as incPeriod,
  salesFyOptions as incFyOptions,
  priorFy,
  tenantForFy,
  salesCat as incCat,
  SALES_CURRENT as INC_CURRENT,
  SALES_PRIOR as INC_PRIOR,
};

/* ------------------------------------------------------------------ types */

export interface IncomeKpi { ytd: number; pytd: number; py_total: number; cy_total: number }
export interface IncMonthPoint { fy: "cy" | "py"; m: number; amt: number }
export interface IncGroupRow { grp: string; ytd: number; pytd: number; py: number }
export interface IncSubGroupRow { grp: string; sub: string; ytd: number; pytd: number; py: number }
export interface IncLedgerRow {
  grp: string; sub: string; ledger: string; ledger_id: string;
  ytd: number; pytd: number; py: number;
}

export interface IncomeReportData {
  kpi: IncomeKpi;
  monthly: IncMonthPoint[];
  groups: IncGroupRow[];
  subgroups: IncSubGroupRow[];
  ledgers: IncLedgerRow[];
  filters: { groups: string[]; subgroups: string[] };
}

export interface IncomeFilters {
  groups?: string[];
  subgroups?: string[];
}

/* ------------------------------------------------------------------ reads */

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadIncomeReport(
  companyGuid: string,
  fy: string,
  filters: IncomeFilters = {},
): Promise<IncomeReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = salesPeriod(fy);

  const { data, error } = await cw.rpc("rpt_income_report", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_pfy_from: p.pFrom,
    p_pas_on: p.pAsOn,
    p_pfy_to: p.pTo,
    p_groups: arr(filters.groups),
    p_subgroups: arr(filters.subgroups),
  });
  if (error) throw new Error(error.message);
  return data as IncomeReportData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; lines?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/** Rebuild the current-FY income snapshot for ONE company — the same work the 21:15 IST cron does. */
export async function refreshIncomeCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_income_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; lines: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the ETA. */
export async function loadIncomeLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_income_refresh_log")
    .select("ran_at,tenant_id,lines,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* --------------------------------------------------- KPI / movement helpers */

/** A group with its YoY change worked out — the raw material for the four KPI cards. */
export interface GroupStat extends IncGroupRow {
  change: number | null;   // pctChange(ytd, pytd); null when there is no prior base
  absDelta: number;        // |ytd − pytd|, for "Highest Change"
}

export function groupStats(groups: IncGroupRow[]): GroupStat[] {
  return groups.map((g) => ({
    ...g,
    change: pctChange(g.ytd, g.pytd),
    absDelta: Math.abs((Number(g.ytd) || 0) - (Number(g.pytd) || 0)),
  }));
}

/**
 * The three "mover" cards, mirroring Talligence's Income screen:
 *  - highestChange   = the group whose rupee movement is largest (the dominant income line);
 *  - highestIncrease = the group with the greatest YoY % rise (a flat 0→0 group counts as +100%,
 *                      which is exactly what Talligence shows for a dormant Indirect Incomes);
 *  - lowestChange    = the group with the most negative YoY % change.
 * Any card can be null when there are no income groups at all.
 */
export function movers(stats: GroupStat[]): {
  highestChange: GroupStat | null;
  highestIncrease: GroupStat | null;
  lowestChange: GroupStat | null;
} {
  if (!stats.length) return { highestChange: null, highestIncrease: null, lowestChange: null };

  const highestChange = stats.reduce((a, b) => (b.absDelta > a.absDelta ? b : a));

  // Rank increases: a null change (no prior base, e.g. 0→0) reads as +100%, as on the source screen.
  const incVal = (s: GroupStat) => (s.change == null ? 100 : s.change);
  const highestIncrease = stats.reduce((a, b) => (incVal(b) > incVal(a) ? b : a));

  // Lowest change ignores the null (no-base) groups — a dormant group is not "the biggest drop".
  const withChange = stats.filter((s) => s.change != null);
  const lowestChange = withChange.length
    ? withChange.reduce((a, b) => ((b.change as number) < (a.change as number) ? b : a))
    : null;

  return { highestChange, highestIncrease, lowestChange };
}
