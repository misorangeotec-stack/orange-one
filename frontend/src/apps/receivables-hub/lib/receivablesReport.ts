/**
 * receivablesReport.ts — the data layer for Master Reports → Finance → Receivables.
 *
 * A faithful rebuild of the Talligence "Master Report – Finance – Receivables" screen
 * (Misc/Talligence-Inputs/Master Report - Finance - Receivables.pdf). Every panel comes
 * from ONE ConnectWave RPC, `rpt_receivables_report`, which reads the precomputed
 * rpt_receivables_bill / rpt_receivables_ledger snapshot (see "Orange One Supabase
 * Connect"/db/rpt/rpt_receivables_report.sql). The browser reads ConnectWave as `anon`
 * (~3s timeout) so a live per-ledger bill scan (~8s for Noida) is impossible.
 *
 * WHAT THE FIGURES MEAN (reconciled for Orange O Tec Noida FY2026-27, to the rupee)
 *   Outstanding  = Σ max(0, ledger closing)                      → ties to Tally (5.18 Cr)
 *   On Account   = Σ max(0, Σ named pending − closing)           → ties to Tally (20.25 L)
 *   Bills Recv.  = Σ open Dr bills                               → Tally-true gross
 *   Overdue      = Σ open Dr bills past their due date
 *   Advance      = Σ open Cr (advance) bills
 * NOTE: the source Talligence report shows GROSS / un-netted Bills-Receivable, Advance and
 * Overdue that do NOT tie to the Tally ledger closing (its columns don't subtract to
 * Outstanding). We deliberately ship the Tally-consistent figures instead — Outstanding and
 * On Account match Talligence exactly; the rest are the honest Tally numbers.
 *
 * The pure money / FY helpers and `tenantForFy` (the generic rpt_sales_book resolver) are
 * shared with the Sales Report and re-exported so the page has a single import source.
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
export const fmtRecv = fmtSales;
export const tickRecv = tickSales;
export const recvCat = salesCat;
export const recvPeriod = salesPeriod;
export const recvFyOptions = salesFyOptions;
export const RECV_CURRENT = SALES_CURRENT;
export const RECV_PRIOR = SALES_PRIOR;

/* ------------------------------------------------------------------ types */

export interface RecvKpi {
  outstanding: number;
  bills_receivable: number;
  overdue: number;
  on_account: number;
  advance: number;
  overdue_pct: number | null;
}
export interface MonthPoint { m: number; amt: number }
export interface ArPoint { ym: string; amt: number }
export interface AgeBucket { bucket: string; amt: number }
export interface PartyRow {
  ledger: string;
  days_receivable: number | null;
  days_clearance: number | null;
  receivable: number;
  on_account: number;
  advance: number;
  outstanding: number;
}
export interface RecvBillRow {
  ledger: string; bill_ref: string; bill_date: string; due_date: string;
  amount: number; pending: number; due_in_days: number | null;
}

export interface ReceivablesReportData {
  kpi: RecvKpi;
  monthly: MonthPoint[];
  accounts_receivable: ArPoint[];
  ageing: { buckets: AgeBucket[]; total: number };
  parties: PartyRow[];
  bills: RecvBillRow[];
  filters: { parties: string[]; groups: string[] };
}

export interface ReceivablesFilters {
  parties?: string[];
  groups?: string[];
}

/* ------------------------------------------------------------------ reads */

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadReceivablesReport(
  companyGuid: string,
  fy: string,
  filters: ReceivablesFilters = {},
): Promise<ReceivablesReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = recvPeriod(fy);

  const { data, error } = await cw.rpc("rpt_receivables_report", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_parties: arr(filters.parties),
    p_groups: arr(filters.groups),
  });
  if (error) throw new Error(error.message);
  return data as ReceivablesReportData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; bills?: number; ledgers?: number; bills_deferred?: boolean;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild this company's receivables snapshot (current open bills) — the same work the
 * 20:30 IST cron does nightly, scoped to what is on screen. Rate-limited to one run per
 * company per two minutes; books with more than 600 debtor ledgers defer to the nightly.
 */
export async function refreshReceivablesCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_receivables_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; bills: number | null;
  ledgers: number | null; seconds: number | null; error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the progress-bar ETA. */
export async function loadReceivablesLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_receivables_refresh_log")
    .select("ran_at,tenant_id,bills,ledgers,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}
