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
 * The precomputed ConnectWave table `rpt_sales_register`, which ports generate_sales_register.py onto
 * the Tally mirror. The browser reads it as `anon`, so we page it in blocks and never run the
 * transform live.
 *
 * WHEN IT REBUILDS
 * `rpt_sales_register_refresh_if_stale()` runs every 5 minutes (cron `rpt-sales-register-after-sync`)
 * and rebuilds only the books whose `tally_sync_state.last_sync_at` is newer than their last entry in
 * `rpt_sales_register_refresh_log` — so the register follows the sync instead of a wall clock. The
 * 20:00 IST `rpt_sales_register_refresh_nightly()` stays on as an unconditional backstop, and
 * refreshRegisterCompany() below is the per-company manual path. Same shape as the Stock Summary.
 *
 * FY-SPLIT BOOKS
 * Enterprise (Surat & Noida) each keep two Tally books that share a company GUID and overlap around
 * 1-Apr. `rpt_sales_book` names the ONE winning book per (company, FY); we resolve the winning books
 * for the FY(s) the date window touches and keep only rows whose (tenant, fy) is a winning pair, so
 * an old book's stray next-FY vouchers never double-count.
 *
 * COMPANY & LOCATION ARE RESOLVED HERE, NOT READ FROM THE TABLE
 * `rpt_sales_register.company_label` is NOT the company — it is the sale's counterparty class
 * ('ORANGE O TEC' / 'ORANGE O TEC BRANCH' / 'ORANGE O TEC RELATED', 'ORANGE ENT BRANCH', …), built
 * inside rpt_sales_register_rebuild by matching the PARTY name, and its only real job is to drive
 * the TYPE column ('SALE' / 'BRANCH SALE' / 'Related Credit Note' / …). Rendering it under a
 * "COMPANY" heading showed readers sister-entity buckets where they expected the book's owner.
 * `location` on the same table is likewise guessed from the raw Tally book name (`ilike '%NOIDA%'`),
 * the name-based heuristic companyMap.ts exists to retire — Tally mints a new book name every April.
 *
 * So both are resolved per row from `ext_company_map` (GUID-keyed, admin-editable in Settings →
 * Masters), giving 'O-tec' / 'Surat' — the same pair every other Tally report shows via
 * TallyReportFrame.companyLabel. Nothing is lost: BRANCH / RELATED still reads off TYPE.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";

export interface RegisterRow {
  tenant_id: string;
  fy: string;
  line_no: number;
  /** Raw, name-derived location on the table ('SURAT'). Display `location_name` instead. */
  location: string;
  /** Counterparty class the TYPE column is built from — NOT the company. Never display it. */
  company_label: string;
  /** The book's owning company from ext_company_map: 'O-tec' | 'Enterprise' | 'Colorix'. */
  company: string;
  /** The book's location from the same map: 'Surat' | 'Noida'. */
  location_name: string;
  /** 'O-tec — Surat' — the app-wide company label, used by the filter and the chips. */
  company_display: string;
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

/** The company/location columns the table stores, before ext_company_map is applied. */
type RawRegisterRow = Omit<RegisterRow, "company" | "location_name" | "company_display">;

/** 'O-tec — Surat', or just the company when the map carries no location. */
export const registerCompanyLabel = (company: string, location: string) =>
  location ? `${company} — ${location}` : company;

/**
 * Every register line for [from,to] (YYYYMMDD), all companies merged. Paged in 1,000-row blocks
 * (anon-safe) and filtered to winning (tenant, fy) books so FY-split overlap can't double-count.
 * Each row's company/location are resolved from ext_company_map (see the header note), falling back
 * to the table's own columns for a book nobody has tagged yet.
 */
export async function loadSalesRegister(from: string, to: string): Promise<RegisterRow[]> {
  const books = await winningBooks(fysInRange(from, to));
  if (!books.length) return [];
  const tenants = [...new Set(books.map((b) => b.tenant_id))];
  const winningPair = new Set(books.map((b) => `${b.tenant_id}|${b.fy}`));

  const cw = getConnectwaveSupabase();
  const resolve = makeCompanyResolver(await fetchCompanyMap());
  const PAGE = 1000;
  const out: RawRegisterRow[] = [];
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
      .returns<RawRegisterRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out
    .filter((r) => winningPair.has(`${r.tenant_id}|${r.fy}`))
    .map((r) => {
      // An untagged book falls back to what the table already held — never worse than before.
      const id = resolve(r.tenant_id, r.company_label);
      const company = id.company || r.company_label;
      const location = id.location || r.location;
      return { ...r, company, location_name: location, company_display: registerCompanyLabel(company, location) };
    });
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
    const label = registerCompanyLabel(id.company, id.location) || b.company_guid;
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
