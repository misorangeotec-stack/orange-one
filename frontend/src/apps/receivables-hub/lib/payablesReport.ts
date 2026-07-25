/**
 * payablesReport.ts — the data layer for Master Reports → Finance → Payables.
 *
 * A faithful rebuild of the Talligence "Master Report – Finance – Payables" screen
 * (Misc/Talligence-Inputs/Master Report - Finance - Payables.pdf) — the sign-mirror of
 * receivablesReport.ts, reading Sundry CREDITORS. Every panel comes from ONE ConnectWave
 * RPC, `rpt_payables_report`, which reads the precomputed rpt_payables_bill /
 * rpt_payables_ledger snapshot (see "Orange One Supabase Connect"/db/rpt/rpt_payables_report.sql).
 * The browser reads ConnectWave as `anon` (~3s timeout) so a live per-ledger bill scan is
 * impossible.
 *
 * WHAT THE FIGURES MEAN (reconciled for Orange O Tec Noida FY2026-27)
 *   Outstanding  = -Σ ledger closing (NET)            → ties to Talligence exactly (-18.45 L)
 *   On Account   = Σ max(0, closing − Σ named pending) → ties to Talligence exactly (5.90 L)
 *   Bills Payable= Σ |named Cr bills|                  → Tally-true gross
 *   Overdue      = Σ |named Cr bills past due|
 *   Advance      = Σ named Dr bills                    → Tally-true (incl. inter-company debit)
 * NOTE: unlike Receivables (Outstanding = Σ max(0, closing)), Payables uses the NET — vendor
 * advances / debit balances genuinely reduce what we owe, so a net-advance book shows a
 * NEGATIVE outstanding, exactly as the source does. The source's Advance (₹4.41 L) is a stale
 * phantom (its advance parties have ₹0 current balance) — we ship the honest Tally number.
 *
 * The pure money / FY helpers and `tenantForFy` are shared with the Sales Report and
 * re-exported so the page has a single import source.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, fyBounds, priorFy, salesPeriod, salesFyOptions,
  salesCat, tenantForFy, SALES_CURRENT, SALES_PRIOR, SALES_ACCENT, SALES_CATS,
} from "./salesReport";

export {
  fmtSales, tickSales, pctChange, fyBounds, priorFy, salesFyOptions, salesCat, tenantForFy,
  SALES_CURRENT, SALES_PRIOR, SALES_ACCENT, SALES_CATS,
};
export const fmtPay = fmtSales;
export const tickPay = tickSales;
export const payCat = salesCat;
export const payPeriod = salesPeriod;
export const payFyOptions = salesFyOptions;
export const PAY_CURRENT = SALES_CURRENT;
export const PAY_PRIOR = SALES_PRIOR;

/* ------------------------------------------------------------------ types */

export interface PayKpi {
  outstanding: number;
  bills_payable: number;
  overdue: number;
  on_account: number;
  advance: number;
  overdue_pct: number | null;
}
export interface MonthPoint { m: number; amt: number }
export interface ApPoint { ym: string; amt: number }
export interface AgeBucket { bucket: string; amt: number }
export interface PartyRow {
  ledger: string;
  days_payable: number | null;
  days_clearance: number | null;
  payable: number;
  on_account: number;
  advance: number;
  outstanding: number;
}
export interface PayBillRow {
  ledger: string; bill_ref: string; bill_date: string; due_date: string;
  amount: number; pending: number; due_in_days: number | null;
}

export interface PayablesReportData {
  kpi: PayKpi;
  monthly: MonthPoint[];
  accounts_payable: ApPoint[];
  ageing: { buckets: AgeBucket[]; total: number };
  parties: PartyRow[];
  bills: PayBillRow[];
  filters: { parties: string[]; groups: string[] };
}

export interface PayablesFilters {
  parties?: string[];
  groups?: string[];
}

/* ------------------------------------------------------------------ reads */

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadPayablesReport(
  companyGuid: string,
  fy: string,
  filters: PayablesFilters = {},
): Promise<PayablesReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = payPeriod(fy);

  const { data, error } = await cw.rpc("rpt_payables_report", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_parties: arr(filters.parties),
    p_groups: arr(filters.groups),
  });
  if (error) throw new Error(error.message);
  return data as PayablesReportData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; bills?: number; ledgers?: number; bills_deferred?: boolean;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild this company's payables snapshot (current open bills) — the same work the
 * 21:00 IST cron does nightly, scoped to what is on screen. Rate-limited to one run per
 * company per two minutes; books with more than 600 creditor ledgers defer to the nightly.
 */
export async function refreshPayablesCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_payables_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; bills: number | null;
  ledgers: number | null; seconds: number | null; error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the progress-bar ETA. */
export async function loadPayablesLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_payables_refresh_log")
    .select("ran_at,tenant_id,bills,ledgers,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}
