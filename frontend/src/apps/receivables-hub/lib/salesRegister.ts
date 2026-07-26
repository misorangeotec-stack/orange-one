/**
 * salesRegister.ts — data layer for Tally Reports → Books & Registers → Sales Register.
 *
 * WHAT IT IS
 * A flat, voucher-line sales register in the finance team's "Append1" layout (12 columns:
 * LOCATION, COMPANY, TYPE, DATE, PARTY NAME, PARTICULARS, VOUCHER TYPE, VOUCHER NO., GSTIN/UIN,
 * QUANTITY, RATE, REVENUE) covering every sale and sales-side daybook entry (delivery challans →
 * FOC/SOA, credit/debit notes, sales returns) across all five entities merged into one table.
 *
 * WHERE THE NUMBERS COME FROM
 * The precomputed ConnectWave table `rpt_sales_register` (rebuilt nightly at 20:00 IST + on demand),
 * which ports generate_sales_register.py onto the Tally mirror. The browser reads it as `anon`, so
 * we page it in blocks and never run the transform live.
 *
 * FY-SPLIT BOOKS
 * Enterprise (Surat & Noida) each keep two Tally books that share a company GUID and overlap around
 * 1-Apr. `rpt_sales_book` names the ONE winning book per (company, FY); we resolve the winning books
 * for the FY(s) the date window touches and keep only rows whose (tenant, fy) is a winning pair, so
 * an old book's stray next-FY vouchers never double-count.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";

export interface RegisterRow {
  tenant_id: string;
  fy: string;
  line_no: number;
  location: string;
  company_label: string;
  type: string;
  date_display: string; // DD-MM-YYYY
  vch_date: string;     // YYYYMMDD
  party: string;
  particulars: string;
  voucher_type: string;
  voucher_no: string;
  gstin: string | null;
  quantity: number;
  rate: number;
  revenue: number;
}

const SELECT_COLS =
  "tenant_id,fy,line_no,location,company_label,type,date_display,vch_date," +
  "party,particulars,voucher_type,voucher_no,gstin,quantity,rate,revenue";

/* --------------------------------------------------------------- dates / FY */

export const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
/** "20260701" → "2026-07-01" (for <input type="date">). */
export const ymdToIso = (s: string) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");
/** "2026-07-01" → "20260701". */
export const isoToYmd = (s: string) => s.replace(/-/g, "");

/** Indian FY start year for a YYYYMMDD date (Apr→Mar). */
function fyStartYear(ymdStr: string): number {
  const y = Number(ymdStr.slice(0, 4));
  const m = Number(ymdStr.slice(4, 6));
  return m >= 4 ? y : y - 1;
}
export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
export const currentFy = (today = new Date()) => fyLabel(fyStartYear(ymd(today)));

/** Every Indian FY the date window [from,to] touches (usually one). */
export function fysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = fyStartYear(from); y <= fyStartYear(to); y++) out.push(fyLabel(y));
  return out;
}

/** Default window: first of the current month → today. */
export function defaultRange(today = new Date()): { from: string; to: string } {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: ymd(first), to: ymd(today) };
}

/* ------------------------------------------------------- winning FY-split books */

interface Book { tenant_id: string; fy: string }

async function winningBooks(fys: string[]): Promise<Book[]> {
  if (!fys.length) return [];
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.from("rpt_sales_book").select("tenant_id,fy").in("fy", fys);
  if (error) throw new Error(error.message);
  return (data ?? []) as Book[];
}

/* ------------------------------------------------------------------ main read */

/**
 * Every register line for [from,to] (YYYYMMDD), all companies merged. Paged in 1,000-row blocks
 * (anon-safe) and filtered to winning (tenant, fy) books so FY-split overlap can't double-count.
 */
export async function loadSalesRegister(from: string, to: string): Promise<RegisterRow[]> {
  const books = await winningBooks(fysInRange(from, to));
  if (!books.length) return [];
  const tenants = [...new Set(books.map((b) => b.tenant_id))];
  const winningPair = new Set(books.map((b) => `${b.tenant_id}|${b.fy}`));

  const cw = getConnectwaveSupabase();
  const PAGE = 1000;
  const out: RegisterRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_sales_register")
      .select(SELECT_COLS)
      .in("tenant_id", tenants)
      .gte("vch_date", from)
      .lte("vch_date", to)
      .order("vch_date", { ascending: true })
      .order("tenant_id", { ascending: true })
      .order("voucher_no", { ascending: true })
      .order("line_no", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RegisterRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.filter((r) => winningPair.has(`${r.tenant_id}|${r.fy}`));
}

/* ------------------------------------------------- per-company manual refresh */

export interface RegisterCompany { tenantId: string; label: string }

/** The five companies (current-FY winning book each) for the Refresh selector. */
export async function loadRegisterCompanies(): Promise<RegisterCompany[]> {
  const cw = getConnectwaveSupabase();
  const [booksRes, mapRows] = await Promise.all([
    cw.from("rpt_sales_book").select("tenant_id,company_guid").eq("fy", currentFy()),
    fetchCompanyMap(),
  ]);
  if (booksRes.error) throw new Error(booksRes.error.message);
  const resolve = makeCompanyResolver(mapRows);
  const seen = new Set<string>();
  const out: RegisterCompany[] = [];
  for (const b of (booksRes.data ?? []) as { tenant_id: string; company_guid: string }[]) {
    if (seen.has(b.tenant_id)) continue;
    seen.add(b.tenant_id);
    const id = resolve(b.tenant_id, null);
    const label = id.location ? `${id.company} — ${id.location}` : id.company || b.company_guid;
    out.push({ tenantId: b.tenant_id, label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export interface RegisterRefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number;
  rows?: number;
  retry_after_seconds?: number;
  last_run?: string;
  message?: string;
}

/** Rebuild one company's current FY — the work the nightly cron does, scoped to one book. */
export async function refreshRegisterCompany(tenantId: string): Promise<RegisterRefreshResult> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.rpc("rpt_sales_register_refresh_company", { p_tenant: tenantId });
  if (error) throw new Error(error.message);
  return data as RegisterRefreshResult;
}

export interface RegisterRefreshLogRow {
  ran_at: string;
  tenant_id: string | null;
  row_count: number | null;
  seconds: number | null;
  error: string | null;
  source: string | null;
}

export async function loadLastRegisterRefresh(tenantId: string): Promise<RegisterRefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_sales_register_refresh_log")
    .select("ran_at,tenant_id,row_count,seconds,error,source")
    .eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as RegisterRefreshLogRow | undefined) ?? null;
}
