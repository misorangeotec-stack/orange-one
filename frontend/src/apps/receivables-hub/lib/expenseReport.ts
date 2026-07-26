/**
 * expenseReport.ts — the data layer for Master Reports → Finance → Expense.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_expense_report`, returns every panel already aggregated as one
 * jsonb payload (the browser reads ConnectWave as `anon`, ~3s statement timeout). It reads the
 * precomputed `rpt_expense_line` snapshot (see
 * "Orange One Supabase Connect"/db/rpt/rpt_expense_report.sql).
 *
 * WHAT "EXPENSE" MEANS HERE
 * The net amount posted to ledgers whose TOP-LEVEL group is an expense group
 * {Direct Expenses, Indirect Expenses, Purchase Accounts}, over ACCOUNTING vouchers only,
 * DEBIT-positive (the snapshot stores −amt, the same orientation as rpt_purchase_line, so a plain
 * sum is positive expense), net of purchase returns / credit notes. This is the sign-mirror of the
 * Income report and the P&L-movement twin of the Purchase Report.
 *
 * RECONCILIATION (Orange O Tec Noida, FY 2026-27): every PY and PYTD figure ties to Talligence —
 * total PYTD ₹8.3440 Cr / PY ₹25.8557 Cr, Direct ₹-11.08 L / ₹-7.96 L, Indirect PYTD ₹75.85 L,
 * Purchase ₹7.6963 Cr / ₹23.1433 Cr. The CY column deliberately does NOT match: Talligence reads
 * ₹4.2 Cr where the books say ₹6.98 Cr, because its current-year sync is stale — the same staleness
 * proven when the Purchase Report was built (its ₹3.71 Cr vs the true ₹6.40 Cr). We ship Tally-true.
 *
 * Like the Income report, this reuses the Sales Report's money / FY / tenant helpers and palette
 * outright rather than re-deriving them.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, salesPeriod, salesFyOptions, priorFy, tenantForFy,
  salesCat, SALES_CURRENT, SALES_PRIOR,
} from "./salesReport";

/* Re-export the shared primitives under Expense-flavoured names, so the page reads cleanly. */
export {
  fmtSales as fmtExp,
  tickSales as tickExp,
  pctChange,
  salesPeriod as expPeriod,
  salesFyOptions as expFyOptions,
  priorFy,
  tenantForFy,
  salesCat as expCat,
  SALES_CURRENT as EXP_CURRENT,
  SALES_PRIOR as EXP_PRIOR,
};

/* ------------------------------------------------------------------ types */

export interface ExpenseKpi { ytd: number; pytd: number; py_total: number; cy_total: number }
export interface ExpMonthPoint { fy: "cy" | "py"; m: number; amt: number }
export interface ExpGroupRow { grp: string; ytd: number; pytd: number; py: number }
export interface ExpSubGroupRow { grp: string; sub: string; ytd: number; pytd: number; py: number }
export interface ExpLedgerRow {
  grp: string; sub: string; ledger: string; ledger_id: string;
  ytd: number; pytd: number; py: number;
}

export interface ExpenseReportData {
  kpi: ExpenseKpi;
  monthly: ExpMonthPoint[];
  groups: ExpGroupRow[];
  /** Drill table + Sub Group filter — keyed on the raw Tally sub-group. */
  subgroups: ExpSubGroupRow[];
  /**
   * Chart only. Keyed on the IMMEDIATE CHILD of the primary group, which is the sub-group when
   * there is one and the LEDGER when the ledger hangs straight off the primary group. That is what
   * Talligence's "Expense Sub Groups" chart plots — under Purchase Accounts it shows
   * GST BRANCH PURCHASE-INK / GST PURCHASE, not the single sub-group "Purchase Accounts".
   */
  subgroup_bars: ExpSubGroupRow[];
  ledgers: ExpLedgerRow[];
  filters: { groups: string[]; subgroups: string[] };
}

export interface ExpenseFilters {
  groups?: string[];
  subgroups?: string[];
}

/* ------------------------------------------------------------------ reads */

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadExpenseReport(
  companyGuid: string,
  fy: string,
  filters: ExpenseFilters = {},
): Promise<ExpenseReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = salesPeriod(fy);

  const { data, error } = await cw.rpc("rpt_expense_report", {
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
  return data as ExpenseReportData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; lines?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/** Rebuild the current-FY expense snapshot for ONE company — the same work the 21:30 IST cron does. */
export async function refreshExpenseCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_expense_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; lines: number | null;
  seconds: number | null; error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the ETA. */
export async function loadExpenseLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_expense_refresh_log")
    .select("ran_at,tenant_id,lines,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/* --------------------------------------------------- KPI / movement helpers */

/** A group with its YoY change worked out — the raw material for the four KPI cards. */
export interface GroupStat extends ExpGroupRow {
  change: number | null;   // pctChange(ytd, pytd); null when there is no prior base
  absDelta: number;        // |ytd − pytd|, for "Highest Change" / "Lowest Change"
}

export function groupStats(groups: ExpGroupRow[]): GroupStat[] {
  return groups.map((g) => ({
    ...g,
    change: pctChange(g.ytd, g.pytd),
    absDelta: Math.abs((Number(g.ytd) || 0) - (Number(g.pytd) || 0)),
  }));
}

/**
 * The three "mover" cards, mirroring Talligence's Expense screen:
 *  - highestChange   = the group whose rupee movement is largest (the dominant expense line);
 *  - highestIncrease = the group with the greatest YoY % rise (a flat 0→0 group counts as +100%);
 *  - lowestChange    = the group whose rupee movement is SMALLEST.
 *
 * NOTE the deliberate divergence from incomeReport.ts, which ranks `lowestChange` by the most
 * negative %. That does not reproduce the source screen here: on the reference PDF the three
 * groups move −51.76 / −36.89 / +109.21 %, so a %-ranking would pick Purchase Accounts, yet
 * Talligence shows Direct Expenses. Ranking by |Δ₹| explains it exactly (Direct ₹12.10 L,
 * Indirect ₹27.98 L, Purchase ₹399 L) and makes the card the clean mirror of "Highest Change" —
 * which is also why Direct legitimately appears on two cards rather than that being a glitch.
 * Verified against the live snapshot: the cards land on Purchase Accounts / Direct / Direct,
 * the same three groups as the PDF.
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

  const lowestChange = stats.reduce((a, b) => (b.absDelta < a.absDelta ? b : a));

  return { highestChange, highestIncrease, lowestChange };
}
