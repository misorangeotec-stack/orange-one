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

export interface DayKpiBest {
  date: string | null;
  amt: number;
  /** Only set on a merged payload — which book that best day belongs to. */
  company?: string;
}
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
  /** Only set when several companies are combined — the book the voucher came from. */
  company?: string;
}
export interface DayPlRow { group: string; amount: number }
export interface DayProduct { item: string; qty: number; unit: string | null; rate: number; amount: number }
export interface DaySalesPerson { salesperson: string; amount: number }

/** One line of the "By Company" panel, present only on a combined payload. */
export interface CompanyDayRow {
  company: string; sales: number; purchase: number; collection: number; payment: number; vouchers: number;
}

export interface DayBookData {
  date: string;
  kpi: DayKpi;
  vouchers: DayVoucher[];
  income: DayPlRow[];
  expense: DayPlRow[];
  sales_products: DayProduct[];
  purchase_products: DayProduct[];
  sales_persons: DaySalesPerson[];
  /** Set only when the payload is a merge of several companies (see mergeDayBooks). */
  by_company?: CompanyDayRow[];
}

/* ------------------------------------------------------------------ reads */

export async function loadDayBook(companyGuid: string, dateYmd: string): Promise<DayBookData> {
  const cw = getConnectwaveSupabase();
  const tenant = await tenantForFy(companyGuid, fyOfDate(dateYmd));
  const { data, error } = await cw.rpc("rpt_day_book", { p_tenant: tenant, p_date: dateYmd });
  if (error) throw new Error(error.message);
  return data as DayBookData;
}

/* -------------------------------------------------------- many companies */

/** A company the day book is being read for. The label shows up on merged voucher rows. */
export interface DayCompanyRef { guid: string; label: string }

const n = (v: unknown) => Number(v) || 0;

/**
 * Combine several companies' day books into one.
 *
 * WHY IN THE BROWSER: `rpt_day_book` answers for ONE tenant, and a tenant is one (company, FY)
 * book that `tenantForFy` resolves per company. The payload is already aggregated and the call
 * is milliseconds, so N companies is N parallel calls plus this fold.
 *
 * Everything sums — the day's sales, purchase, collection, payment, the Income/Expense groups,
 * the product tables (per item AND unit, so a shared item is one line) and the salesperson
 * roll-up. Vouchers are concatenated and keep their book.
 *
 * ⚠ THE ONE FIGURE THAT CANNOT BE SUMMED: "Best day in the month". The RPC returns each
 * company's own best day, not a daily series, so a true combined best day is not derivable
 * from these payloads. The merge therefore reports the STRONGEST SINGLE BOOK-DAY — the largest
 * of the per-company bests — and tags it with the company it belongs to, which the page states
 * on screen. Do not relabel it as a combined figure.
 */
export function mergeDayBooks(parts: { label: string; data: DayBookData }[]): DayBookData {
  const kpi: DayKpi = {
    today_sales: 0, yesterday_sales: 0, best_sales_day: { date: null, amt: 0 },
    today_purchase: 0, yesterday_purchase: 0, best_purchase_day: { date: null, amt: 0 },
    collection: 0, payment: 0,
  };
  const income = new Map<string, DayPlRow>();
  const expense = new Map<string, DayPlRow>();
  const salesProducts = new Map<string, DayProduct>();
  const purchaseProducts = new Map<string, DayProduct>();
  const salesPersons = new Map<string, DaySalesPerson>();
  const vouchers: DayVoucher[] = [];
  const byCompany: CompanyDayRow[] = [];

  const addPl = (into: Map<string, DayPlRow>, rows: DayPlRow[] | undefined) => {
    for (const r of rows ?? []) {
      const hit = into.get(r.group) ?? { group: r.group, amount: 0 };
      hit.amount += n(r.amount);
      into.set(r.group, hit);
    }
  };
  // Keyed on item AND base unit: the same item stocked in two units in two books must not
  // have its quantities added together. Rate is re-derived as amount / qty, so the merged
  // line shows the weighted average rate rather than one book's.
  const addProducts = (into: Map<string, DayProduct>, rows: DayProduct[] | undefined) => {
    for (const r of rows ?? []) {
      const k = `${r.item}|${r.unit ?? ""}`;
      const hit = into.get(k) ?? { item: r.item, qty: 0, unit: r.unit ?? null, rate: n(r.rate), amount: 0 };
      hit.qty += n(r.qty);
      hit.amount += n(r.amount);
      hit.rate = hit.qty ? hit.amount / hit.qty : n(r.rate);
      into.set(k, hit);
    }
  };

  for (const { label, data } of parts) {
    kpi.today_sales += n(data.kpi?.today_sales);
    kpi.yesterday_sales += n(data.kpi?.yesterday_sales);
    kpi.today_purchase += n(data.kpi?.today_purchase);
    kpi.yesterday_purchase += n(data.kpi?.yesterday_purchase);
    kpi.collection += n(data.kpi?.collection);
    kpi.payment += n(data.kpi?.payment);

    // Strongest single book-day, not a combined best — see the note above.
    const bs = data.kpi?.best_sales_day;
    if (bs && n(bs.amt) > kpi.best_sales_day.amt) {
      kpi.best_sales_day = { date: bs.date, amt: n(bs.amt), company: label };
    }
    const bp = data.kpi?.best_purchase_day;
    if (bp && n(bp.amt) > kpi.best_purchase_day.amt) {
      kpi.best_purchase_day = { date: bp.date, amt: n(bp.amt), company: label };
    }

    addPl(income, data.income);
    addPl(expense, data.expense);
    addProducts(salesProducts, data.sales_products);
    addProducts(purchaseProducts, data.purchase_products);

    for (const s of data.sales_persons ?? []) {
      const hit = salesPersons.get(s.salesperson) ?? { salesperson: s.salesperson, amount: 0 };
      hit.amount += n(s.amount);
      salesPersons.set(s.salesperson, hit);
    }

    for (const v of data.vouchers ?? []) vouchers.push({ ...v, company: label });

    byCompany.push({
      company: label,
      sales: n(data.kpi?.today_sales),
      purchase: n(data.kpi?.today_purchase),
      collection: n(data.kpi?.collection),
      payment: n(data.kpi?.payment),
      vouchers: (data.vouchers ?? []).length,
    });
  }

  const desc = <T>(rows: T[], amt: (r: T) => number) => rows.sort((a, b) => amt(b) - amt(a));

  return {
    date: parts[0]?.data.date ?? "",
    kpi,
    // The RPC orders vouchers by type then number; the book breaks ties so a company's run
    // of vouchers stays together.
    vouchers: vouchers.sort((a, b) =>
      (a.voucher_type ?? "").localeCompare(b.voucher_type ?? "") ||
      (a.company ?? "").localeCompare(b.company ?? "") ||
      (a.voucher_no ?? "").localeCompare(b.voucher_no ?? "")),
    income: desc([...income.values()], (r) => r.amount),
    expense: desc([...expense.values()], (r) => r.amount),
    sales_products: desc([...salesProducts.values()], (r) => r.amount),
    purchase_products: desc([...purchaseProducts.values()], (r) => r.amount),
    sales_persons: desc([...salesPersons.values()], (r) => r.amount),
    by_company: desc(byCompany, (r) => r.sales),
  };
}

/**
 * Read the day book for one or many companies. A single company takes the plain path and is
 * byte-identical to what it always was; several fan out in parallel and fold together.
 */
export async function loadDayBookMulti(
  companies: DayCompanyRef[],
  dateYmd: string,
): Promise<DayBookData> {
  if (!companies.length) throw new Error("Select at least one company.");
  if (companies.length === 1) return loadDayBook(companies[0].guid, dateYmd);
  const parts = await Promise.all(
    companies.map(async (c) => ({ label: c.label, data: await loadDayBook(c.guid, dateYmd) })),
  );
  return mergeDayBooks(parts);
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

/**
 * Refresh every selected company, ONE AT A TIME — the server takes an advisory lock per run
 * and rate-limits to one run per company per two minutes. A company inside its cooldown is
 * reported, not treated as a failure.
 */
export async function refreshDayBookCompanies(
  companyGuids: string[],
  dateYmd: string,
): Promise<{ guid: string; result: DayRefreshResult }[]> {
  const out: { guid: string; result: DayRefreshResult }[] = [];
  for (const guid of companyGuids) {
    try {
      out.push({ guid, result: await refreshDayBookCompany(guid, dateYmd) });
    } catch (e) {
      out.push({ guid, result: { status: "error", message: e instanceof Error ? e.message : String(e) } });
    }
  }
  return out;
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

/**
 * The "Last refreshed" stamp for a set of companies: the OLDEST of their last runs, since
 * the screen is only as fresh as its stalest book. `seconds` is the SUM, because Refresh
 * rebuilds them one after another and that is what the progress bar estimates against.
 */
export async function loadLastDayBookRefreshMany(
  companyGuids: string[],
  dateYmd: string,
): Promise<DayRefreshLogRow | null> {
  if (!companyGuids.length) return null;
  if (companyGuids.length === 1) return loadLastDayBookRefresh(companyGuids[0], dateYmd);
  const rows = (await Promise.all(companyGuids.map((g) => loadLastDayBookRefresh(g, dateYmd))))
    .filter((r): r is DayRefreshLogRow => !!r?.ran_at);
  if (!rows.length) return null;
  const oldest = rows.reduce((a, b) => (a.ran_at <= b.ran_at ? a : b));
  return { ...oldest, seconds: rows.reduce((s, r) => s + (Number(r.seconds) || 0), 0) };
}
