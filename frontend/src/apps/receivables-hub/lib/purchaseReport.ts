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
  /** Only set when several companies are combined — the book the bill came from. */
  company?: string;
}

/** One line of the "Purchase by Company" panel, present only on a combined payload. */
export interface CompanyPurchaseRow {
  company: string; ytd: number; pytd: number; py_total: number; cy_total: number;
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
  /** Set only when the payload is a merge of several companies (see mergePurchaseReports). */
  by_company?: CompanyPurchaseRow[];
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

/* -------------------------------------------------------- many companies */

/** A company the report is being run for. The label only shows up on merged bill rows. */
export interface PurchaseCompanyRef { guid: string; label: string }

/**
 * The ageing buckets in the order `rpt_purchase_report` emits them — the RPC sorts by an
 * explicit `ord` column, which is lost once the payloads are merged. Keep in step with the
 * CASE in db/rpt/rpt_purchase_report.sql.
 */
const AGE_BUCKET_ORDER = [
  "<=30 Days", "31 to 60 Days", "61 to 90 Days", "91 to 120 Days",
  "121 to 180 Days", "181 to 365 Days", ">365 Days",
];

const n = (v: unknown) => Number(v) || 0;

/**
 * Combine several companies' payloads into one report — the purchase-side twin of
 * mergeSalesReports, with the same reasoning (see salesReport.ts for the full note).
 *
 * Everything sums; a vendor, product or state that appears in two books becomes ONE row
 * carrying the total. Two honest approximations carry over: `categories` / `products` /
 * `groups` arrive capped at each company's top 25 and `bills` at each company's most recent
 * 2000, so the merged top-10 charts are unions of those caps rather than a true re-rank.
 */
export function mergePurchaseReports(
  parts: { label: string; data: PurchaseReportData }[],
): PurchaseReportData {
  const kpi: PurchaseKpi = { ytd: 0, pytd: 0, py_total: 0, cy_total: 0 };
  const monthly = new Map<string, MonthPoint>();
  const weekly = new Map<string, WeekPoint>();
  const geography = new Map<string, GeoRow>();
  const categories = new Map<string, CategoryRow>();
  const vendors = new Map<string, VendorRow>();
  const products = new Map<string, ProductRow>();
  const groups = new Map<string, GroupRow>();
  const ageBuckets = new Map<string, AgeBucket>();
  const ageVendors = new Map<string, AgeVendor>();
  const bills: BillRow[] = [];
  const byCompany: CompanyPurchaseRow[] = [];
  let ageTotal = 0;

  const filterSets = {
    categories: new Set<string>(), states: new Set<string>(), parties: new Set<string>(),
    groups: new Set<string>(), items: new Set<string>(),
  };

  for (const { label, data } of parts) {
    kpi.ytd += n(data.kpi?.ytd);
    kpi.pytd += n(data.kpi?.pytd);
    kpi.py_total += n(data.kpi?.py_total);
    kpi.cy_total += n(data.kpi?.cy_total);
    byCompany.push({
      company: label,
      ytd: n(data.kpi?.ytd), pytd: n(data.kpi?.pytd),
      py_total: n(data.kpi?.py_total), cy_total: n(data.kpi?.cy_total),
    });

    for (const r of data.monthly ?? []) {
      const k = `${r.fy}|${r.m}`;
      const hit = monthly.get(k) ?? { fy: r.fy, m: r.m, amt: 0 };
      hit.amt += n(r.amt);
      monthly.set(k, hit);
    }
    for (const r of data.weekly ?? []) {
      const k = `${r.fy}|${r.wk}`;
      const hit = weekly.get(k) ?? { fy: r.fy, wk: r.wk, amt: 0 };
      hit.amt += n(r.amt);
      weekly.set(k, hit);
    }
    for (const r of data.geography ?? []) {
      const hit = geography.get(r.state) ?? { state: r.state, ytd: 0, pytd: 0 };
      hit.ytd += n(r.ytd);
      hit.pytd += n(r.pytd);
      geography.set(r.state, hit);
    }
    for (const r of data.categories ?? []) {
      const hit = categories.get(r.category) ?? { category: r.category, amt: 0 };
      hit.amt += n(r.amt);
      categories.set(r.category, hit);
    }
    for (const r of data.vendors ?? []) {
      // Keyed on the vendor name alone: the same supplier billing two books is one vendor.
      const hit = vendors.get(r.party) ?? { party: r.party, state: r.state ?? "", cy: 0, pytd: 0, py: 0 };
      if (!hit.state && r.state) hit.state = r.state;
      hit.cy += n(r.cy);
      hit.pytd += n(r.pytd);
      hit.py += n(r.py);
      vendors.set(r.party, hit);
    }
    for (const r of data.products ?? []) {
      const hit = products.get(r.item) ?? { item: r.item, amt: 0 };
      hit.amt += n(r.amt);
      products.set(r.item, hit);
    }
    for (const r of data.groups ?? []) {
      const hit = groups.get(r.grp) ?? { grp: r.grp, amt: 0 };
      hit.amt += n(r.amt);
      groups.set(r.grp, hit);
    }
    for (const r of data.ageing?.buckets ?? []) {
      const hit = ageBuckets.get(r.bucket) ?? { bucket: r.bucket, amt: 0 };
      hit.amt += n(r.amt);
      ageBuckets.set(r.bucket, hit);
    }
    for (const r of data.ageing?.vendors ?? []) {
      const hit = ageVendors.get(r.ledger) ?? { ledger: r.ledger, amt: 0 };
      hit.amt += n(r.amt);
      ageVendors.set(r.ledger, hit);
    }
    ageTotal += n(data.ageing?.total);

    // A bill number is only unique within a company, so each row keeps its book.
    for (const b of data.bills ?? []) bills.push({ ...b, company: label });

    for (const v of data.filters?.categories ?? []) filterSets.categories.add(v);
    for (const v of data.filters?.states ?? []) filterSets.states.add(v);
    for (const v of data.filters?.parties ?? []) filterSets.parties.add(v);
    for (const v of data.filters?.groups ?? []) filterSets.groups.add(v);
    for (const v of data.filters?.items ?? []) filterSets.items.add(v);
  }

  const desc = <T>(rows: T[], amt: (r: T) => number) => rows.sort((a, b) => amt(b) - amt(a));
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));

  return {
    kpi,
    monthly: [...monthly.values()].sort((a, b) => a.fy.localeCompare(b.fy) || a.m - b.m),
    weekly: [...weekly.values()].sort((a, b) => a.fy.localeCompare(b.fy) || a.wk - b.wk),
    geography: desc([...geography.values()], (r) => r.ytd),
    categories: desc([...categories.values()], (r) => r.amt).slice(0, 25),
    vendors: desc([...vendors.values()], (r) => r.cy),
    products: desc([...products.values()], (r) => r.amt).slice(0, 25),
    groups: desc([...groups.values()], (r) => r.amt).slice(0, 25),
    ageing: {
      buckets: [...ageBuckets.values()].sort(
        (a, b) => AGE_BUCKET_ORDER.indexOf(a.bucket) - AGE_BUCKET_ORDER.indexOf(b.bucket),
      ),
      vendors: [...ageVendors.values()].sort((a, b) => a.ledger.localeCompare(b.ledger)),
      total: ageTotal,
    },
    bills: bills.sort((a, b) => (a.bill_date < b.bill_date ? 1 : a.bill_date > b.bill_date ? -1 : 0)),
    filters: {
      categories: sorted(filterSets.categories),
      states: sorted(filterSets.states),
      parties: sorted(filterSets.parties),
      groups: sorted(filterSets.groups),
      items: sorted(filterSets.items),
    },
    by_company: desc(byCompany, (r) => r.ytd),
  };
}

/**
 * Run the report over one or many companies. A single company takes the plain path and is
 * byte-identical to what it always was; several fan out in parallel and fold together.
 */
export async function loadPurchaseReportMulti(
  companies: PurchaseCompanyRef[],
  fy: string,
  filters: PurchaseFilters = {},
): Promise<PurchaseReportData> {
  if (!companies.length) throw new Error("Select at least one company.");
  if (companies.length === 1) return loadPurchaseReport(companies[0].guid, fy, filters);
  const parts = await Promise.all(
    companies.map(async (c) => ({ label: c.label, data: await loadPurchaseReport(c.guid, fy, filters) })),
  );
  return mergePurchaseReports(parts);
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

/**
 * Refresh every selected company, ONE AT A TIME — the server takes an advisory lock per run
 * and rate-limits to one run per company per two minutes, so firing them together would just
 * queue. A company inside its cooldown is reported, not treated as a failure.
 */
export async function refreshPurchaseCompanies(
  companyGuids: string[],
  fy: string,
): Promise<{ guid: string; result: RefreshResult }[]> {
  const out: { guid: string; result: RefreshResult }[] = [];
  for (const guid of companyGuids) {
    try {
      out.push({ guid, result: await refreshPurchaseCompany(guid, fy) });
    } catch (e) {
      out.push({ guid, result: { status: "error", message: e instanceof Error ? e.message : String(e) } });
    }
  }
  return out;
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

/**
 * The "Last refreshed" stamp for a set of companies: the OLDEST of their last runs, since
 * the screen is only as fresh as its stalest book. `seconds` is the SUM, because Refresh
 * rebuilds them one after another and that is what the progress bar estimates against.
 */
export async function loadPurchaseLastRefreshMany(
  companyGuids: string[],
  fy: string,
): Promise<RefreshLogRow | null> {
  if (!companyGuids.length) return null;
  if (companyGuids.length === 1) return loadPurchaseLastRefresh(companyGuids[0], fy);
  const rows = (await Promise.all(companyGuids.map((g) => loadPurchaseLastRefresh(g, fy))))
    .filter((r): r is RefreshLogRow => !!r?.ran_at);
  if (!rows.length) return null;
  const oldest = rows.reduce((a, b) => (a.ran_at <= b.ran_at ? a : b));
  return { ...oldest, seconds: rows.reduce((s, r) => s + (Number(r.seconds) || 0), 0) };
}
