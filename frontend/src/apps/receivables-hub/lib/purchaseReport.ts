/**
 * purchaseReport.ts — the data layer for Master Reports → Purchase Report.
 *
 * The purchase-side twin of salesReport.ts. Every panel comes from ONE ConnectWave RPC,
 * `rpt_purchase_report`, which reads the precomputed rpt_purchase_line / rpt_purchase_item /
 * rpt_purchase_bill snapshot (see "Orange One Supabase Connect"/db/rpt/rpt_purchase_report.sql)
 * and answers in milliseconds — the browser reads ConnectWave as `anon` (~3s timeout) and the
 * biggest book carries thousands of purchase lines for one FY, so a live scan is impossible.
 *
 * WHAT "PURCHASE" MEANS HERE
 * The net amount posted to ledgers under the **Purchase Accounts** group, over ACCOUNTING
 * vouchers only, ex-GST (input GST lives under Duties & Taxes, so it drops out by construction).
 * Includes branch and related-party purchases. Reconciled against Talligence for Orange O Tec
 * Noida: PYTD ₹7.6963 Cr and PY total ₹23.1433 Cr land exactly.
 *
 * The pure money / FY / palette helpers and `tenantForFy` (which reads the generic rpt_sales_book,
 * a book resolver over ALL vouchers) are shared with the Sales Report and imported — then
 * re-exported so the page has a single import source.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import {
  fmtSales, tickSales, pctChange, fyBounds, priorFy, salesPeriod, salesFyOptions,
  salesCat, tenantForFy, SALES_CURRENT, SALES_PRIOR, SALES_ACCENT, SALES_CATS,
} from "./salesReport";

// Re-export the shared, non-sales-specific helpers under purchase-flavoured names where it
// reads better, and verbatim otherwise. The page imports everything from here.
export {
  fmtSales, tickSales, pctChange, fyBounds, priorFy, salesFyOptions, salesCat, tenantForFy,
  SALES_CURRENT, SALES_PRIOR, SALES_ACCENT, SALES_CATS,
};
export const fmtPurchase = fmtSales;
export const tickPurchase = tickSales;
export const purchaseCat = salesCat;
/** The four cut-dates every panel uses — identical logic to the Sales Report. */
export const purchasePeriod = salesPeriod;
export const purchaseFyOptions = salesFyOptions;
export const PURCHASE_CURRENT = SALES_CURRENT;
export const PURCHASE_PRIOR = SALES_PRIOR;

/* ------------------------------------------------------------------ types */

export interface PurchaseKpi { ytd: number; pytd: number; py_total: number; cy_total: number }
export interface MonthPoint { fy: "cy" | "py"; m: number; amt: number }
export interface WeekPoint { fy: "cy" | "py"; wk: number; amt: number }
export interface GeoRow { state: string; ytd: number; pytd: number }
export interface CategoryRow { category: string; amt: number }
export interface VendorRow { party: string; state: string; cy: number; pytd: number; py: number }
export interface ProductRow { item: string; amt: number }
export interface GroupRow { grp: string; amt: number }
export interface AgeBucket { bucket: string; amt: number }
export interface AgeVendor { ledger: string; amt: number }
export interface BillRow {
  ledger: string; bill_ref: string; bill_date: string; due_date: string;
  amount: number; pending: number; overdue_days: number;
}

export interface PurchaseReportData {
  kpi: PurchaseKpi;
  monthly: MonthPoint[];
  weekly: WeekPoint[];
  geography: GeoRow[];
  categories: CategoryRow[];
  vendors: VendorRow[];
  products: ProductRow[];
  groups: GroupRow[];
  ageing: { buckets: AgeBucket[]; vendors: AgeVendor[]; total: number };
  bills: BillRow[];
  filters: {
    categories: string[]; states: string[]; parties: string[];
    groups: string[]; items: string[];
  };
}

export interface PurchaseFilters {
  categories?: string[];
  states?: string[];
  parties?: string[];
  groups?: string[];
  items?: string[];
}

/* ------------------------------------------------------------------ reads */

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadPurchaseReport(
  companyGuid: string,
  fy: string,
  filters: PurchaseFilters = {},
): Promise<PurchaseReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = purchasePeriod(fy);

  const { data, error } = await cw.rpc("rpt_purchase_report", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_pfy_from: p.pFrom,
    p_pas_on: p.pAsOn,
    p_pfy_to: p.pTo,
    p_categories: arr(filters.categories),
    p_states: arr(filters.states),
    p_parties: arr(filters.parties),
    p_groups: arr(filters.groups),
    p_items: arr(filters.items),
  });
  if (error) throw new Error(error.message);
  return data as PurchaseReportData;
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; lines?: number; items?: number; bills?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the snapshot for ONE company, current FY — the same work the 20:15 IST cron does
 * nightly, scoped to what is on screen. Rate-limited to one run per company per two minutes and
 * guarded by an advisory lock server-side (the anon key ships in the bundle). Bills are deferred
 * to the nightly cron for books with more than 600 payable ledgers.
 */
export async function refreshPurchaseCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_purchase_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

export interface RefreshLogRow {
  ran_at: string; tenant_id: string | null; lines: number | null;
  items: number | null; bills: number | null; seconds: number | null;
  error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the progress-bar ETA. */
export async function loadPurchaseLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_purchase_refresh_log")
    .select("ran_at,tenant_id,lines,items,bills,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}
