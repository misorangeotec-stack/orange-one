/**
 * salesReport.ts — the data layer for Master Reports → Sales Report.
 *
 * WHERE THE NUMBERS COME FROM
 * A single ConnectWave RPC, `rpt_sales_report`, which returns every panel already
 * aggregated as one jsonb payload. The browser reads ConnectWave as `anon`, which has a
 * ~3s statement timeout, and the largest book carries 43k sales lines for one FY — so
 * neither a live scan nor shipping raw rows is possible. The RPC reads the precomputed
 * `rpt_sales_line` / `rpt_sales_item` / `rpt_sales_bill` tables (see
 * "Orange One Supabase Connect"/db/rpt/rpt_sales_report.sql) and answers in milliseconds.
 *
 * WHAT "SALES" MEANS HERE
 * The net amount posted to ledgers under the **Sales Accounts** group, over ACCOUNTING
 * vouchers only, ex-GST. It includes branch and related-party sales, and is net of credit
 * notes, sales returns and the discount/rate-difference ledgers. Reconciled against
 * Talligence for Orange O Tec Noida: PYTD ₹8.2139 Cr, PY total ₹25.9954 Cr.
 *
 * FY-SPLIT BOOKS
 * Tally splits a company every April but both books stay in use and OVERLAP — one company's
 * old book holds 564 FY26-27 vouchers, 429 of them the same vouchers as the new book.
 * Never union a company's tenants; `rpt_sales_book` resolves the ONE winning book per
 * (company, FY) and `tenantForFy()` below reads it.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";

/* ---------------------------------------------------------------- palette */

/**
 * Master Reports owns its chart palette outright.
 *
 * NOT lib/chartColors — that module was written for the C-Level dashboard, which is being
 * reworked; these reports must not shift when it changes. Values are Orange One's brand
 * tokens (see the Tailwind config inlined in vite.config.ts): brand orange #FF6A1F for the
 * current year, a muted slate for the prior year so the comparison never competes with it.
 */
export const SALES_CURRENT = "#FF6A1F";  // brand orange — current FY
export const SALES_PRIOR   = "#94A0B8";  // muted slate  — prior FY
export const SALES_ACCENT  = "#0B1B40";  // navy/ink     — single-series emphasis

/** Categorical ramp for the quarter donut and the product charts. */
export const SALES_CATS = [
  "#FF6A1F", // orange
  "#0B1B40", // navy
  "#2EC4B6", // teal
  "#F8B62B", // yellow
  "#3B82F6", // blue
  "#9957DB", // violet
  "#27AE60", // green
  "#E5484D", // red
] as const;

export const salesCat = (i: number) => SALES_CATS[i % SALES_CATS.length];

/* ------------------------------------------------------------------ money */

/**
 * Talligence's money format: ₹ 8.05 Cr / ₹ 12.13 L / ₹ 78.5 K / ₹ 0.
 *
 * Deliberately NOT fmtINRMoney (lib/utils) — that has no K branch, so ₹16,000 renders
 * "₹0.16 L" where the report we are mirroring shows "₹ 16 K". Trailing zeros are trimmed
 * so a round crore reads "₹ 26 Cr", not "₹ 26.00 Cr", exactly as on the source screen.
 */
export function fmtSales(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (Math.abs(v) < 0.5) return "₹ 0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const trim = (x: number) => String(Number(x.toFixed(2)));
  if (abs >= 1e7) return `${sign}₹ ${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹ ${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹ ${trim(abs / 1e3)} K`;
  return `${sign}₹ ${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Short axis tick — no ₹, no space, so the labels stay narrow. */
export function tickSales(n: number): string {
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1e7) return `${Number((n / 1e7).toFixed(1))}Cr`;
  if (a >= 1e5) return `${Number((n / 1e5).toFixed(0))}L`;
  return `${Number((n / 1e3).toFixed(0))}K`;
}

/**
 * Percent change PYTD → YTD, matching Talligence's column.
 * Returns null when there is no prior base to compare against (Talligence prints "-").
 * A prior of zero with a current value is 100%, which is what the source screen shows
 * for Tamil Nadu (₹0 → ₹4.39 L → "100 %").
 */
export function pctChange(current: number, prior: number): number | null {
  if (!prior) return current ? 100 : null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

/* --------------------------------------------------------------- FY logic */

/** "2026-27" → { from: "20260401", to: "20270331" }. Indian FY, Apr→Mar. */
export function fyBounds(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}0401`, to: `${start + 1}0331` };
}

/** "2026-27" → "2025-26". */
export function priorFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/**
 * The four dates every panel is cut on.
 *
 * `asOn` is today, clamped to the FY end so a closed year shows the whole year rather than
 * nothing. `priorAsOn` is the SAME calendar day one year earlier — that is what makes PYTD
 * comparable to YTD, and it is how Talligence's ₹8.21 Cr was reproduced exactly.
 */
export function salesPeriod(fy: string, today = new Date()) {
  const cur = fyBounds(fy);
  const prev = fyBounds(priorFy(fy));
  const t = ymd(today);
  const asOn = t > cur.to ? cur.to : t < cur.from ? cur.from : t;
  const priorAsOn = `${Number(asOn.slice(0, 4)) - 1}${asOn.slice(4)}`;
  return { from: cur.from, to: cur.to, asOn, pFrom: prev.from, pTo: prev.to, pAsOn: priorAsOn };
}

/** The FYs the report offers, newest first. Matches the chips on the source screen. */
export function salesFyOptions(today = new Date()): string[] {
  const y = today.getFullYear();
  const startYear = today.getMonth() >= 3 ? y : y - 1; // month is 0-based; 3 = April
  return [0, 1, 2].map((back) => {
    const s = startYear - back;
    return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  });
}

/* ------------------------------------------------------------------ types */

export interface SalesKpi { ytd: number; pytd: number; py_total: number; cy_total: number }
export interface MonthPoint { fy: "cy" | "py"; m: number; amt: number }
export interface WeekPoint { fy: "cy" | "py"; wk: number; amt: number }
export interface GeoRow { state: string; ytd: number; pytd: number }
export interface SaleTypeRow { sale_type: string; amt: number }
export interface CustomerRow { party: string; state: string; cy: number; pytd: number; py: number }
export interface ProductRow { item: string; amt: number }
export interface GroupRow { grp: string; amt: number }
export interface AgeBucket { bucket: string; amt: number }
export interface AgeCustomer { ledger: string; amt: number }
export interface BillRow {
  ledger: string; bill_ref: string; bill_date: string; due_date: string;
  amount: number; pending: number; overdue_days: number;
  /** Only set when several companies are combined — the book the bill came from. */
  company?: string;
}

/** One line of the "Sales by Company" panel, present only on a combined payload. */
export interface CompanySalesRow {
  company: string; ytd: number; pytd: number; py_total: number; cy_total: number;
}

export interface SalesReportData {
  kpi: SalesKpi;
  monthly: MonthPoint[];
  weekly: WeekPoint[];
  geography: GeoRow[];
  sale_types: SaleTypeRow[];
  customers: CustomerRow[];
  products: ProductRow[];
  groups: GroupRow[];
  ageing: { buckets: AgeBucket[]; customers: AgeCustomer[]; total: number };
  bills: BillRow[];
  filters: {
    sale_types: string[]; states: string[]; parties: string[];
    groups: string[]; items: string[];
  };
  /** Set only when the payload is a merge of several companies (see mergeSalesReports). */
  by_company?: CompanySalesRow[];
}

export interface SalesFilters {
  saleTypes?: string[];
  states?: string[];
  parties?: string[];
  groups?: string[];
  items?: string[];
}

/** Human labels for the sale_type codes held in the `sale_type` master. */
export const SALE_TYPE_LABELS: Record<string, string> = {
  ink: "Ink",
  spare_parts: "Spare Parts",
  machine: "Machine",
  head: "Head",
  other: "Other",
  non_product: "Non-product income",
};

export const saleTypeLabel = (code: string) => SALE_TYPE_LABELS[code] ?? code;

/* ------------------------------------------------------------------ reads */

/**
 * The winning tenant for a (company, FY) — see the FY-split note in the file header.
 * Falls back to the bare tenant so a company with no rows still renders empty rather
 * than throwing.
 */
export async function tenantForFy(companyGuid: string, fy: string): Promise<string> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_sales_book")
    .select("tenant_id")
    .eq("company_guid", companyGuid)
    .eq("fy", fy)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { tenant_id: string } | null)?.tenant_id ?? `acct_orange::${companyGuid}`;
}

const arr = (v?: string[]) => (v && v.length ? v : null);

export async function loadSalesReport(
  companyGuid: string,
  fy: string,
  filters: SalesFilters = {},
): Promise<SalesReportData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const p = salesPeriod(fy);

  const { data, error } = await cw.rpc("rpt_sales_report", {
    p_tenant: tenant,
    p_fy_from: p.from,
    p_as_on: p.asOn,
    p_fy_to: p.to,
    p_pfy_from: p.pFrom,
    p_pas_on: p.pAsOn,
    p_pfy_to: p.pTo,
    p_sale_types: arr(filters.saleTypes),
    p_states: arr(filters.states),
    p_parties: arr(filters.parties),
    p_groups: arr(filters.groups),
    p_items: arr(filters.items),
  });
  if (error) throw new Error(error.message);
  return data as SalesReportData;
}

/* -------------------------------------------------------- many companies */

/** A company the report is being run for. The label only shows up on merged bill rows. */
export interface SalesCompanyRef { guid: string; label: string }

/**
 * The ageing buckets in the order `rpt_sales_report` emits them — the RPC sorts by an
 * explicit `ord` column, which is lost once the payloads are merged, so the order has to be
 * restated here. Keep in step with the CASE in db/rpt/rpt_sales_report.sql.
 */
const AGE_BUCKET_ORDER = [
  "<=30 Days", "31 to 60 Days", "61 to 90 Days", "91 to 120 Days",
  "121 to 180 Days", "181 to 365 Days", ">365 Days",
];

const n = (v: unknown) => Number(v) || 0;

/**
 * Combine several companies' payloads into one report.
 *
 * WHY IT IS DONE IN THE BROWSER
 * `rpt_sales_report` answers for ONE tenant, and a tenant is one (company, FY) book — the
 * FY-split resolution in `tenantForFy` is per company, so a multi-tenant RPC would have to
 * re-do that per row anyway. The RPC already returns everything pre-aggregated and answers
 * in milliseconds, so N companies is N parallel calls plus this fold, which is cheaper than
 * a new server function and keeps the single-company numbers byte-identical.
 *
 * EVERYTHING SUMS, WITH TWO HONEST APPROXIMATIONS
 * A customer/product/state that appears in two books becomes ONE row carrying the total —
 * that is the point of the feature. But `products` and `groups` arrive capped at each
 * company's top 25, and `bills` at each company's most recent 2000, so the merged top-10
 * charts and the bill table are unions of those caps rather than a true re-rank of every
 * line. At the sizes these caps sit at, nothing that could reach a merged top 10 is
 * excluded; the bill list is the last 2000 per company, not the last 2000 overall.
 */
export function mergeSalesReports(parts: { label: string; data: SalesReportData }[]): SalesReportData {
  const kpi: SalesKpi = { ytd: 0, pytd: 0, py_total: 0, cy_total: 0 };
  const monthly = new Map<string, MonthPoint>();
  const weekly = new Map<string, WeekPoint>();
  const geography = new Map<string, GeoRow>();
  const saleTypes = new Map<string, SaleTypeRow>();
  const customers = new Map<string, CustomerRow>();
  const products = new Map<string, ProductRow>();
  const groups = new Map<string, GroupRow>();
  const ageBuckets = new Map<string, AgeBucket>();
  const ageCustomers = new Map<string, AgeCustomer>();
  const bills: BillRow[] = [];
  const byCompany: CompanySalesRow[] = [];
  let ageTotal = 0;

  const filterSets = {
    sale_types: new Set<string>(), states: new Set<string>(), parties: new Set<string>(),
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
    for (const r of data.sale_types ?? []) {
      const hit = saleTypes.get(r.sale_type) ?? { sale_type: r.sale_type, amt: 0 };
      hit.amt += n(r.amt);
      saleTypes.set(r.sale_type, hit);
    }
    for (const r of data.customers ?? []) {
      // Keyed on the party name alone: the same customer billed from two books is one
      // customer, and its state is whatever the first book that knows one says.
      const hit = customers.get(r.party) ?? { party: r.party, state: r.state ?? "", cy: 0, pytd: 0, py: 0 };
      if (!hit.state && r.state) hit.state = r.state;
      hit.cy += n(r.cy);
      hit.pytd += n(r.pytd);
      hit.py += n(r.py);
      customers.set(r.party, hit);
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
    for (const r of data.ageing?.customers ?? []) {
      const hit = ageCustomers.get(r.ledger) ?? { ledger: r.ledger, amt: 0 };
      hit.amt += n(r.amt);
      ageCustomers.set(r.ledger, hit);
    }
    ageTotal += n(data.ageing?.total);

    // Bills stay one row per bill and carry their book, because a bill number is only
    // unique within a company — merging them would silently drop the namesakes.
    for (const b of data.bills ?? []) bills.push({ ...b, company: label });

    for (const v of data.filters?.sale_types ?? []) filterSets.sale_types.add(v);
    for (const v of data.filters?.states ?? []) filterSets.states.add(v);
    for (const v of data.filters?.parties ?? []) filterSets.parties.add(v);
    for (const v of data.filters?.groups ?? []) filterSets.groups.add(v);
    for (const v of data.filters?.items ?? []) filterSets.items.add(v);
  }

  const desc = <T>(rows: T[], amt: (r: T) => number) => rows.sort((a, b) => amt(b) - amt(a));
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));

  return {
    kpi,
    // Sorted the way the RPC sorts each panel, so the merged payload is a drop-in.
    monthly: [...monthly.values()].sort((a, b) => a.fy.localeCompare(b.fy) || a.m - b.m),
    weekly: [...weekly.values()].sort((a, b) => a.fy.localeCompare(b.fy) || a.wk - b.wk),
    geography: desc([...geography.values()], (r) => r.ytd),
    sale_types: desc([...saleTypes.values()], (r) => r.amt),
    customers: desc([...customers.values()], (r) => r.cy),
    products: desc([...products.values()], (r) => r.amt).slice(0, 25),
    groups: desc([...groups.values()], (r) => r.amt).slice(0, 25),
    ageing: {
      buckets: [...ageBuckets.values()].sort(
        (a, b) => AGE_BUCKET_ORDER.indexOf(a.bucket) - AGE_BUCKET_ORDER.indexOf(b.bucket),
      ),
      customers: [...ageCustomers.values()].sort((a, b) => a.ledger.localeCompare(b.ledger)),
      total: ageTotal,
    },
    bills: bills.sort((a, b) => (a.bill_date < b.bill_date ? 1 : a.bill_date > b.bill_date ? -1 : 0)),
    filters: {
      sale_types: sorted(filterSets.sale_types),
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
 * byte-identical to what it always was; several fan out in parallel and fold through
 * mergeSalesReports.
 */
export async function loadSalesReportMulti(
  companies: SalesCompanyRef[],
  fy: string,
  filters: SalesFilters = {},
): Promise<SalesReportData> {
  if (!companies.length) throw new Error("Select at least one company.");
  if (companies.length === 1) return loadSalesReport(companies[0].guid, fy, filters);
  const parts = await Promise.all(
    companies.map(async (c) => ({ label: c.label, data: await loadSalesReport(c.guid, fy, filters) })),
  );
  return mergeSalesReports(parts);
}

/**
 * Salesperson tags. Talligence prints "Data for this segment was not found in Tally"
 * because Tally carries no salesperson dimension — we fill the panel from our own
 * `ext_ledger_tags`, the same muster that drives receivables scoping.
 * Returns a party-name → salesperson map.
 */
export async function loadSalespersonByParty(): Promise<Record<string, string>> {
  const cw = getConnectwaveSupabase();
  const [tags, names] = await Promise.all([
    cw.from("ext_ledger_tags").select("ledger_id,salesperson"),
    cw.from("ext_ledger_group").select("ledger_id,tally_name"),
  ]);
  if (tags.error) throw new Error(tags.error.message);
  if (names.error) throw new Error(names.error.message);

  const nameOf = new Map<string, string>();
  for (const r of (names.data ?? []) as { ledger_id: string; tally_name: string }[]) {
    if (r.ledger_id && r.tally_name) nameOf.set(r.ledger_id, r.tally_name);
  }
  const out: Record<string, string> = {};
  for (const r of (tags.data ?? []) as { ledger_id: string; salesperson: string | null }[]) {
    const nm = nameOf.get(r.ledger_id);
    if (nm && r.salesperson) out[nm] = r.salesperson;
  }
  return out;
}

/** Roll the customer rows up by salesperson tag. Untagged customers are dropped. */
export function salespersonRollup(
  customers: CustomerRow[],
  byParty: Record<string, string>,
): { name: string; ytd: number; pytd: number }[] {
  const acc = new Map<string, { name: string; ytd: number; pytd: number }>();
  for (const c of customers) {
    const sp = byParty[c.party];
    if (!sp) continue;
    const hit = acc.get(sp) ?? { name: sp, ytd: 0, pytd: 0 };
    hit.ytd += c.cy;
    hit.pytd += c.pytd;
    acc.set(sp, hit);
  }
  return [...acc.values()].sort((a, b) => b.ytd - a.ytd);
}

/* --------------------------------------------------------------- refresh */

export interface RefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; lines?: number; items?: number; bills?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the snapshot for ONE company, current FY — the same work the 20:00 IST cron does
 * nightly, just scoped to what is on screen. Server-side it is rate-limited to one run per
 * company per two minutes and guarded by an advisory lock, because the anon key ships in
 * the browser bundle.
 */
export async function refreshSalesCompany(companyGuid: string, fy: string): Promise<RefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw.rpc("rpt_sales_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as RefreshResult;
}

/**
 * Refresh every selected company, ONE AT A TIME.
 *
 * Deliberately sequential: the server takes an advisory lock per run and the snapshot
 * rebuild is the heaviest thing the anon key can trigger, so firing five at once would
 * simply queue them behind each other while holding five browser connections open.
 * Each company's own result is returned, cooldowns and all — a company that was refreshed
 * a minute ago does not fail the batch.
 */
export async function refreshSalesCompanies(
  companyGuids: string[],
  fy: string,
): Promise<{ guid: string; result: RefreshResult }[]> {
  const out: { guid: string; result: RefreshResult }[] = [];
  for (const guid of companyGuids) {
    try {
      out.push({ guid, result: await refreshSalesCompany(guid, fy) });
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

/** Last refresh for a company — drives the "Last refreshed" stamp and the ETA. */
export async function loadLastRefresh(companyGuid: string, fy: string): Promise<RefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fy);
  const { data, error } = await cw
    .from("rpt_sales_refresh_log")
    .select("ran_at,tenant_id,lines,items,bills,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RefreshLogRow | undefined) ?? null;
}

/**
 * The "Last refreshed" stamp for a set of companies.
 *
 * Reports the OLDEST of their last runs — the stamp has to describe the staleness of the
 * whole screen, and the screen is only as fresh as its stalest book. `seconds` is the SUM,
 * because Refresh now rebuilds them one after another and that is what the progress bar is
 * estimating against. Companies that have never been snapshotted are skipped, so one
 * unrefreshed book does not blank the stamp for the rest.
 */
export async function loadLastRefreshMany(
  companyGuids: string[],
  fy: string,
): Promise<RefreshLogRow | null> {
  if (!companyGuids.length) return null;
  if (companyGuids.length === 1) return loadLastRefresh(companyGuids[0], fy);
  const rows = (await Promise.all(companyGuids.map((g) => loadLastRefresh(g, fy))))
    .filter((r): r is RefreshLogRow => !!r?.ran_at);
  if (!rows.length) return null;
  const oldest = rows.reduce((a, b) => (a.ran_at <= b.ran_at ? a : b));
  return { ...oldest, seconds: rows.reduce((s, r) => s + (Number(r.seconds) || 0), 0) };
}
