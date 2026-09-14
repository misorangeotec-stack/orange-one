import { SCOPE_ALL, isEmptyScope, type PartyScope } from "@hub/lib/scopeParties";

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
 * TallyReportFrame.companyLabel.
 *
 * EXCEPT on a Related / Branch line. There, finance asked (2026-09-10) for COMPANY to show the
 * counterparty class itself — 'ORANGE O TEC RELATED', 'ORANGE ENT RELATED', 'ORANGE O TEC BRANCH',
 * 'ORANGE ENT BRANCH' — so `company_label` IS displayed, but only when TYPE starts with Related or
 * Branch. On every other line it stays hidden for the reason above. `company_display` (the Company
 * FILTER) is still the book either way: it answers "whose books", which a class does not.
 *
 * TYPE and the class are built in rpt_sales_register_rebuild — see
 * supabase/connectwave/rpt_sales_register_rebuild.sql for the related-party list (Colorix
 * included) and the delivery-challan rule (APPROVAL in the voucher-type name → SOA, else FOC SALE).
 *
 * SOA (SALES ON APPROVAL) — ONLY THE PENDING LINES APPEAR HERE
 * Stock sent out on approval is not a sale. A `type='SOA'` line is kept only while it is still
 * pending — nothing billed against it and nothing returned. Once it is billed, its INVOICE line is
 * already in this register, so keeping the challan line too would count the same goods twice; once
 * it is rejected it never became a sale at all. The full picture — issued, billed, rejected,
 * pending — lives in Tally Reports → SOA Sales Register (lib/soaRegister.ts). `loadPendingSoaKeys`
 * below is where the narrowing happens, and it is done HERE rather than in
 * rpt_sales_register_rebuild because masters-sync reads the same table to learn which customer buys
 * which item; dropping the rows at source would erase that evidence.
 *
 * DESPATCH DETAILS COME FROM A SIDECAR, NOT FROM rpt_sales_register
 * Delivery Note No. & Date, Despatch Doc No., Despatch Through, Destination and Vehicle No. are the
 * voucher's own Tally despatch block (BASICSHIPDELIVERYNOTE / BASICSHIPPINGDATE /
 * BASICSHIPDOCUMENTNO / BASICSHIPPEDBY / BASICFINALDESTINATION / BASICSHIPVESSELNO). They live on
 * `rpt_sales_despatch`, one row per VOUCHER, joined here on (tenant_id, voucher_guid) — see
 * supabase/connectwave/sales_register_despatch.sql for why they are a sidecar rather than columns
 * on the register itself. Only vouchers that carry at least one of the six are stored, so a missing
 * row is the normal case for an invoice with an empty despatch block, not a gap in the data.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";

/** The voucher's Tally despatch block, merged onto every line of that voucher. */
export interface DespatchDetail {
  /** BASICSHIPDELIVERYNOTE — Tally's "Delivery Note No." */
  delivery_note_no: string | null;
  /** BASICSHIPPINGDATE, already formatted DD-MM-YYYY — the "& Date" half of the same column. */
  delivery_note_date_display: string | null;
  /** BASICSHIPDOCUMENTNO */
  despatch_doc_no: string | null;
  /** BASICSHIPPEDBY */
  despatch_through: string | null;
  /** BASICFINALDESTINATION */
  destination: string | null;
  /** BASICSHIPVESSELNO */
  vehicle_no: string | null;
}

export interface RegisterRow extends DespatchDetail {
  tenant_id: string;
  fy: string;
  line_no: number;
  /** Tally voucher GUID — the key the despatch sidecar joins on. */
  voucher_guid: string;
  /** Raw, name-derived location on the table ('SURAT'). Display `location_name` instead. */
  location: string;
  /** Counterparty class the TYPE column is built from — NOT the company. Surfaces only via `company`. */
  company_label: string;
  /**
   * What the COMPANY column shows: the book's owner from ext_company_map ('O-tec' | 'Enterprise' |
   * 'Colorix'), or on a Related / Branch line the class itself ('ORANGE O TEC RELATED', …).
   */
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
  "tenant_id,fy,line_no,voucher_guid,location,company_label,type,date_display,vch_date," +
  "party,particulars,voucher_type,voucher_no,gstin,quantity,rate,revenue";

const DESPATCH_COLS =
  "tenant_id,voucher_guid,delivery_note_no,delivery_note_date_display," +
  "despatch_doc_no,despatch_through,destination,vehicle_no";

/** 'Related FOC', 'RELATED SALE', 'Branch FOC', 'BRANCH SALE', … — the inter-company TYPEs. */
const RELATED_OR_BRANCH = /^(related|branch)\b/i;

/** Every despatch field blank — what a voucher with no despatch block renders as. */
const NO_DESPATCH: DespatchDetail = {
  delivery_note_no: null,
  delivery_note_date_display: null,
  despatch_doc_no: null,
  despatch_through: null,
  destination: null,
  vehicle_no: null,
};

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

export interface Book { tenant_id: string; fy: string }

/** Exported for lib/soaRegister.ts, which needs the same FY-split protection. */
export async function winningBooks(fys: string[]): Promise<Book[]> {
  if (!fys.length) return [];
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.from("rpt_sales_book").select("tenant_id,fy").in("fy", fys);
  if (error) throw new Error(error.message);
  return (data ?? []) as Book[];
}

/* ------------------------------------------------------------------ main read */

/** The company/location columns the table stores, before ext_company_map is applied. */
type RawRegisterRow = Omit<RegisterRow, "company" | "location_name" | "company_display" | keyof DespatchDetail>;

type DespatchRow = DespatchDetail & { tenant_id: string; voucher_guid: string };

/** `${tenant_id}|${voucher_guid}` — the join key between a register line and its voucher. */
const despatchKey = (tenantId: string, voucherGuid: string) => `${tenantId}|${voucherGuid}`;

/**
 * The despatch block for every voucher in [from,to], keyed for the merge below.
 *
 * Read as its own query rather than as a PostgREST embed: `rpt_sales_despatch` is a plain sidecar
 * table with no foreign key to `rpt_sales_register` (the register is rebuilt by delete-and-insert,
 * so it has no stable row identity to point at), and PostgREST will not embed across a relationship
 * it cannot see. One extra ranged read of ~one row per voucher is cheaper than the alternative of
 * chunking thousands of GUIDs into `.in()` filters.
 *
 * `scope` is applied here too, on `party`, for the same reason it is applied to the register: a
 * viewer scoped to a few salespeople must not pull despatch details for everyone else's invoices.
 */
async function loadDespatchDetails(
  tenants: string[],
  from: string,
  to: string,
  scope: PartyScope,
): Promise<Map<string, DespatchDetail>> {
  const out = new Map<string, DespatchDetail>();
  if (!tenants.length) return out;

  const cw = getConnectwaveSupabase();
  const scopedParties = scope.kind === "only" ? scope.parties : null;
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = cw
      .from("rpt_sales_despatch")
      .select(DESPATCH_COLS)
      .in("tenant_id", tenants)
      .gte("vch_date", from)
      .lte("vch_date", to);
    if (scopedParties) q = q.in("party", scopedParties);
    const { data, error } = await q
      .order("vch_date", { ascending: true })
      .order("tenant_id", { ascending: true })
      .order("voucher_guid", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<DespatchRow[]>();
    // The register must still render if the sidecar is missing or unreadable — it is additive
    // detail, not the report. A failure leaves every despatch cell blank and nothing else.
    if (error) {
      console.warn("[salesRegister] despatch details unavailable:", error.message);
      return out;
    }
    const rows = data ?? [];
    for (const r of rows) {
      out.set(despatchKey(r.tenant_id, r.voucher_guid), {
        delivery_note_no: r.delivery_note_no,
        delivery_note_date_display: r.delivery_note_date_display,
        despatch_doc_no: r.despatch_doc_no,
        despatch_through: r.despatch_through,
        destination: r.destination,
        vehicle_no: r.vehicle_no,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** 'O-tec — Surat', or just the company when the map carries no location. */
export const registerCompanyLabel = (company: string, location: string) =>
  location ? `${company} — ${location}` : company;

/** `${tenant}|${challan voucher no}|${item}` — one approval line, as the register sees it. */
const soaKey = (tenantId: string, voucherNo: string, item: string) =>
  `${tenantId}|${voucherNo}|${item}`;

/**
 * The approval lines that are STILL PENDING — nothing billed and nothing returned yet.
 *
 * `rpt_soa_register` holds one row per (book, tracking number, item) with the running
 * issued/billed/rejected balance; this turns the pending ones back into the (voucher, item) keys a
 * register LINE carries. `soa_voucher_no` is ', '-joined because one (tracking, item) can be issued
 * on more than one challan, so it is split rather than compared whole — comparing whole would drop
 * every line of a multi-challan tracking number from the register, silently and in the direction
 * that hides stock.
 *
 * Read without a date filter on purpose: the register window already filters by voucher date, and
 * the pending flag is a property of the whole ledger, not of the window.
 *
 * A failure here must not take the register down — SOA is a slice of it, not the report. The set
 * comes back empty, which shows the register exactly as it looked before approval lines were added.
 */
async function loadPendingSoaKeys(tenants: string[], scope: PartyScope): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!tenants.length) return keys;
  const cw = getConnectwaveSupabase();
  const scopedParties = scope.kind === "only" ? scope.parties : null;
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = cw
      .from("rpt_soa_register")
      .select("tenant_id,soa_voucher_no,item,pending_qty")
      .in("tenant_id", tenants)
      .gt("pending_qty", 0);
    if (scopedParties) q = q.in("party", scopedParties);
    const { data, error } = await q
      .order("tenant_id", { ascending: true })
      .order("tracking_no", { ascending: true })
      .order("item", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<{ tenant_id: string; soa_voucher_no: string | null; item: string }[]>();
    if (error) {
      console.warn("[salesRegister] pending SOA unavailable:", error.message);
      return new Set();
    }
    const rows = data ?? [];
    for (const r of rows) {
      for (const vno of (r.soa_voucher_no ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        keys.add(soaKey(r.tenant_id, vno, r.item));
      }
    }
    if (rows.length < PAGE) break;
  }
  return keys;
}

/**
 * Every register line for [from,to] (YYYYMMDD), all companies merged. Paged in 1,000-row blocks
 * (anon-safe) and filtered to winning (tenant, fy) books so FY-split overlap can't double-count.
 * Each row's company/location are resolved from ext_company_map (see the header note), falling back
 * to the table's own columns for a book nobody has tagged yet.
 *
 * `scope` is the viewer's per-salesperson restriction (lib/scopeParties.ts). It is taken as the
 * PartyScope union rather than a `string[]` on purpose: this table is read through PostgREST, so
 * the filter is `.in("party", …)`, and a plain empty array would be indistinguishable from "the
 * caller had no filter" at a glance while meaning the opposite. `{ kind: "only", parties: [] }`
 * short-circuits to no rows, which is what a viewer scoped to nobody must see.
 */
export async function loadSalesRegister(
  from: string,
  to: string,
  scope: PartyScope = SCOPE_ALL,
): Promise<RegisterRow[]> {
  if (isEmptyScope(scope)) return [];
  const books = await winningBooks(fysInRange(from, to));
  if (!books.length) return [];
  const tenants = [...new Set(books.map((b) => b.tenant_id))];
  const winningPair = new Set(books.map((b) => `${b.tenant_id}|${b.fy}`));

  const cw = getConnectwaveSupabase();
  const [mapRows, despatch, pendingSoa] = await Promise.all([
    fetchCompanyMap(),
    loadDespatchDetails(tenants, from, to, scope),
    loadPendingSoaKeys(tenants, scope),
  ]);
  const resolve = makeCompanyResolver(mapRows);
  const PAGE = 1000;
  const out: RawRegisterRow[] = [];
  const scopedParties = scope.kind === "only" ? scope.parties : null;
  for (let offset = 0; ; offset += PAGE) {
    let q = cw
      .from("rpt_sales_register")
      .select(SELECT_COLS)
      .in("tenant_id", tenants)
      .gte("vch_date", from)
      .lte("vch_date", to);
    // Narrowed on the SERVER — out-of-scope lines never reach the browser.
    if (scopedParties) q = q.in("party", scopedParties);
    const { data, error } = await q
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
    // Approval stock: only what is STILL PENDING belongs in the sales register. Once a challan is
    // billed its invoice line is already here, and once it is rejected it never became a sale — in
    // either case keeping the challan line too would count the same goods twice.
    .filter((r) => r.type !== "SOA" || pendingSoa.has(soaKey(r.tenant_id, r.voucher_no, r.particulars)))
    .map((r) => {
      // An untagged book falls back to what the table already held — never worse than before.
      const id = resolve(r.tenant_id, r.company_label);
      // A Related or Branch line names the counterparty class instead of the book — 'ORANGE O TEC
      // RELATED', 'ORANGE ENT BRANCH' — because that is how finance read an inter-company line
      // (asked for 2026-09-10). Keyed on TYPE, which the rebuild derives from that same class, so
      // the two can never disagree. Every other line keeps the book's owner from ext_company_map.
      const company = RELATED_OR_BRANCH.test(r.type)
        ? r.company_label
        : id.company || r.company_label;
      const location = id.location || r.location;
      return {
        ...r,
        ...(despatch.get(despatchKey(r.tenant_id, r.voucher_guid)) ?? NO_DESPATCH),
        company,
        location_name: location,
        company_display: registerCompanyLabel(company, location),
      };
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

/**
 * Rebuild one company's current FY — the work the nightly cron does, scoped to one book.
 *
 * The despatch sidecar is filled straight after, so a manual refresh brings the delivery-note and
 * despatch columns with it instead of leaving them a poll behind. It is deliberately not awaited
 * into the result: the register is the report, and a sidecar that fails must not turn a successful
 * refresh into an error message. A cooldown/busy verdict skips it — nothing was rebuilt to follow.
 */
export async function refreshRegisterCompany(tenantId: string): Promise<RegisterRefreshResult> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.rpc("rpt_sales_register_refresh_company", { p_tenant: tenantId });
  if (error) throw new Error(error.message);
  const res = data as RegisterRefreshResult;
  if (res?.status === "ok") {
    // The guarded wrapper, not rpt_sales_despatch_fill itself — that one is revoked from anon.
    const { data: fill, error: fillErr } = await cw.rpc("rpt_sales_despatch_refresh_company", { p_tenant: tenantId });
    const fillStatus = (fill as { status?: string; message?: string } | null)?.status;
    if (fillErr) console.warn("[salesRegister] despatch fill failed:", fillErr.message);
    else if (fillStatus === "error") console.warn("[salesRegister] despatch fill failed:", (fill as { message?: string }).message);
  }
  return res;
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
