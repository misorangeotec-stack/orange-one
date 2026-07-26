/**
 * dayBook.ts — the data layer for Master Reports → Day Book.
 *
 * A single ConnectWave RPC, `rpt_day_book(p_tenant, p_date)`, returns the whole
 * single-day dashboard already aggregated as one jsonb payload: the 8 KPIs
 * (today/yesterday sales & purchase, best sales/purchase day in the month,
 * collection, payment), the day's voucher list, the Income/Expense split, the
 * Sales/Purchase product panels and the Sales-Person roll-up. It reads the
 * precomputed rpt_day_book_* snapshot (see "Orange One Supabase Connect"/db/rpt/
 * rpt_day_book.sql), so the browser (anon, ~3s statement timeout) answers instantly.
 *
 * WHAT THE NUMBERS MEAN (reconciled against the Talligence PDF, Noida 24-Jul-2026):
 *  - Sales   = net Sales-Accounts postings over ACCOUNTING vouchers (Sales ORDERS excluded
 *              by voucher NATURE — they post to a GST SALES ACCOUNTS ledger and would inflate
 *              the day). Today's Sales = ₹6,12,542.74, exactly the source screen.
 *  - Purchase= net Purchase-Accounts postings; branch purchases included.
 *  - Because purchases are routinely back-dated, this live snapshot can be MORE current than
 *    any point-in-time PDF — the Refresh button rebuilds the current FY on demand.
 *
 * FY-SPLIT BOOKS: the selected date's FY resolves to the ONE winning Tally book via
 * `tenantForFy` (reused from salesReport.ts, reads rpt_sales_book) — never union a company's
 * tenants or the overlap double-counts.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { tenantForFy } from "./salesReport";

/* ------------------------------------------------------------------ dates */

/** Date → "YYYYMMDD" (Tally's date form). */
export const ymdOf = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/** "YYYYMMDD" → "YYYY-MM-DD" for an <input type="date">. */
export const ymdToIso = (s: string) =>
  s && s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "";

/** "YYYY-MM-DD" → "YYYYMMDD". */
export const isoToYmd = (s: string) => s.replace(/-/g, "");

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
export function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}

/** "Tuesday, 14 July 2026" from Tally's YYYYMMDD — used on the Best-Day KPI hints. */
export function longDate(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** The Indian financial year a date falls in: "20260724" → "2026-27". */
export function fyOfDate(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const start = m >= 4 ? y : y - 1; // Apr → Mar
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ types */

export interface DayKpiBest { date: string | null; amt: number }
export interface DayKpi {
  today_sales: number;
  yesterday_sales: number;
  best_sales_day: DayKpiBest;
  today_purchase: number;
  yesterday_purchase: number;
  best_purchase_day: DayKpiBest;
  collection: number;
  payment: number;
}
export interface DayVoucher {
  date: string; party: string | null; voucher_no: string | null;
  voucher_type: string | null; kind: string; amount: number;
}
export interface DayPlRow { group: string; amount: number }
export interface DayProduct { item: string; qty: number; unit: string | null; rate: number; amount: number }
export interface DaySalesPerson { salesperson: string; amount: number }

export interface DayBookData {
  date: string;
  kpi: DayKpi;
  vouchers: DayVoucher[];
  income: DayPlRow[];
  expense: DayPlRow[];
  sales_products: DayProduct[];
  purchase_products: DayProduct[];
  sales_persons: DaySalesPerson[];
}

/* ------------------------------------------------------------------ reads */

export async function loadDayBook(companyGuid: string, dateYmd: string): Promise<DayBookData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fyOfDate(dateYmd));
  const { data, error } = await cw.rpc("rpt_day_book", { p_tenant: tenant, p_date: dateYmd });
  if (error) throw new Error(error.message);
  return data as DayBookData;
}

/* --------------------------------------------------------------- refresh */

export interface DayRefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number; vouchers?: number;
  retry_after_seconds?: number; last_run?: string; message?: string;
}

/**
 * Rebuild the day-book snapshot for ONE company, current FY — the same work the nightly
 * cron does, scoped to what is on screen. This is also the same-day / back-dated lever:
 * because purchases are often entered late, a Refresh is what pulls "today" fully in.
 * Server-side it is rate-limited to one run / company / two minutes + an advisory lock.
 */
export async function refreshDayBookCompany(companyGuid: string, dateYmd: string): Promise<DayRefreshResult> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fyOfDate(dateYmd));
  const { data, error } = await cw.rpc("rpt_day_book_refresh_company", { p_tenant: tenant });
  if (error) throw new Error(error.message);
  return data as DayRefreshResult;
}

export interface DayRefreshLogRow {
  ran_at: string; tenant_id: string | null;
  vouchers: number | null; seconds: number | null; error: string | null; source: string | null;
}

/** Last refresh for a company — drives the "Last refreshed" stamp and the progress ETA. */
export async function loadLastDayBookRefresh(companyGuid: string, dateYmd: string): Promise<DayRefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fyOfDate(dateYmd));
  const { data, error } = await cw
    .from("rpt_day_book_refresh_log")
    .select("ran_at,tenant_id,vouchers,seconds,error,source")
    .eq("tenant_id", tenant)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as DayRefreshLogRow | undefined) ?? null;
}
