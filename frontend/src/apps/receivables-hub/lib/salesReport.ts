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
