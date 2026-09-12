import { SCOPE_ALL, isEmptyScope, type PartyScope } from "@hub/lib/scopeParties";

/**
 * soaRegister.ts — data layer for Tally Reports → Books & Registers → SOA Sales Register.
 *
 * WHAT IT IS
 * The sales-on-approval ledger. Stock sent to a customer on approval is not a sale: it is either
 * billed later, sent back, or still lying with them. This report follows each approval line until
 * it closes, and the four views the finance team asked for are four filters over the same rows —
 * All, Converted to invoice, Rejected, and Pending.
 *
 * These lines used to sit in the Sales Register as `type='SOA'` carrying full value (₹12.48 cr in
 * FY 26-27). They are now excluded there (see the .neq("type","SOA") in lib/salesRegister.ts) and
 * live here instead.
 *
 * WHERE THE NUMBERS COME FROM
 * The precomputed ConnectWave table `rpt_soa_register`, one row per (book, tracking number, item),
 * rebuilt per book by `rpt_soa_register_fill()` ~5 min after each Tally sync. The transform walks
 * two nested jsonb arrays over a book's whole history and cannot be run live — see
 * supabase/connectwave/soa_register.sql.
 *
 * PENDING IS TALLY'S OWN NUMBER
 * `pending_qty = issued − billed − rejected` reproduces Tally's **Sales Bills Pending** report
 * ("Goods Delivered but Bills not Made"). Verified against it for the FY 26-27 Enterprise book:
 * same 5 rows, ₹75,33,000.00 exactly.
 *
 * THE ROW KEY IS (BOOK, TRACKING NUMBER, ITEM)
 * Not the tracking number alone. Tally reuses a tracking number across years and items —
 * 'MC/SOA/2526/1' carries a machine rejected in Jun-25, another billed, and a third still pending
 * from Aug-26. Keyed on the number alone they cancel out and a ₹73,00,000 pending machine vanishes.
 *
 * THE WINDOW FILTERS THE ISSUE DATE, NOT THE LEDGER
 * The ledger is netted over the book's full history inside the database; `from`/`to` here only
 * choose which approval issues you are looking at. Netting within a window instead would strand
 * bills whose challan predates it, and show phantom negatives.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";
import { fysInRange, winningBooks, registerCompanyLabel } from "./salesRegister";

export interface SoaRow {
  tenant_id: string;
  fy: string;
  tracking_no: string;
  item: string;
  soa_date: string;          // YYYYMMDD
  soa_date_display: string;  // DD-MM-YYYY
  soa_voucher_no: string | null;
  soa_voucher_type: string | null;
  party: string | null;
  rate: number;
  /** Tally's "Initial Quantity" — what went out on approval. */
  issued_qty: number;
  billed_qty: number;
  rejected_qty: number;
  /** Tally's "Pending Quantity" — issued − billed − rejected. */
  pending_qty: number;
  issued_value: number;
  pending_value: number;
  billed_voucher_no: string | null;
  billed_date_display: string | null;
  rejected_voucher_no: string | null;
  rejected_date_display: string | null;
  status: string;
  /** Resolved from ext_company_map, exactly as the Sales Register does it. */
  company: string;
  location_name: string;
  company_display: string;
}

type RawSoaRow = Omit<SoaRow, "company" | "location_name" | "company_display">;

const SELECT_COLS =
  "tenant_id,fy,tracking_no,item,soa_date,soa_date_display,soa_voucher_no,soa_voucher_type," +
  "party,rate,issued_qty,billed_qty,rejected_qty,pending_qty,issued_value,pending_value," +
  "billed_voucher_no,billed_date_display,rejected_voucher_no,rejected_date_display,status";

/** The four views the report offers. They OVERLAP — see `soaTabPredicate`. */
export type SoaTab = "all" | "converted" | "rejected" | "pending";

export const SOA_TABS: { key: SoaTab; label: string }[] = [
  { key: "all", label: "All SOA" },
  { key: "converted", label: "Converted to invoice" },
  { key: "rejected", label: "Rejected" },
  { key: "pending", label: "Pending" },
];

/**
 * A row belongs to a tab if it carries ANY quantity of that kind, so one approval line that was
 * part billed, part returned and part still out appears under three tabs. That is the honest
 * reading of a partly-settled challan, and it is why the tab counts do not sum to the total.
 */
export function soaTabPredicate(tab: SoaTab): (r: SoaRow) => boolean {
  switch (tab) {
    case "converted": return (r) => r.billed_qty > 0;
    case "rejected":  return (r) => r.rejected_qty > 0;
    case "pending":   return (r) => r.pending_qty > 0;
    default:          return () => true;
  }
}

/** Default window: 1 April of the current Indian FY → today, matching how Tally is run. */
export function defaultSoaRange(today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const start = today.getMonth() >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
  const ymd = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return { from: ymd(start), to: ymd(today) };
}

/**
 * Every approval line issued in [from,to] (YYYYMMDD), all books merged.
 *
 * `scope` narrows on the SERVER by party, the same as the Sales Register — a viewer scoped to a few
 * salespeople must not pull other people's approval stock. An empty "only" scope short-circuits.
 */
export async function loadSoaRegister(
  from: string,
  to: string,
  scope: PartyScope = SCOPE_ALL,
): Promise<SoaRow[]> {
  if (isEmptyScope(scope)) return [];
  // Same FY-split protection as the Sales Register: an archive book that shares a company GUID can
  // hold stray next-FY vouchers, and without this they would double-count against the live book.
  const books = await winningBooks(fysInRange(from, to));
  if (!books.length) return [];
  const tenants = [...new Set(books.map((b) => b.tenant_id))];
  const winningPair = new Set(books.map((b) => `${b.tenant_id}|${b.fy}`));

  const cw = getConnectwaveSupabase();
  const resolve = makeCompanyResolver(await fetchCompanyMap());
  const scopedParties = scope.kind === "only" ? scope.parties : null;
  const PAGE = 1000;
  const out: RawSoaRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = cw
      .from("rpt_soa_register")
      .select(SELECT_COLS)
      .in("tenant_id", tenants)
      .gte("soa_date", from)
      .lte("soa_date", to);
    if (scopedParties) q = q.in("party", scopedParties);
    const { data, error } = await q
      .order("soa_date", { ascending: true })
      .order("tenant_id", { ascending: true })
      .order("tracking_no", { ascending: true })
      .order("item", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawSoaRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }

  return out
    .filter((r) => winningPair.has(`${r.tenant_id}|${r.fy}`))
    .map((r) => {
      const id = resolve(r.tenant_id, null);
      const company = id.company || r.tenant_id;
      const location = id.location || "";
      return {
        ...r,
        company,
        location_name: location,
        company_display: registerCompanyLabel(company, location),
      };
    });
}

/* ------------------------------------------------- per-company manual refresh */

export interface SoaRefreshResult {
  status: "ok" | "cooldown" | "busy" | "error";
  seconds?: number;
  rows?: number;
  retry_after_seconds?: number;
  message?: string;
}

/** Rebuild one book's approval ledger — the work the 5-minute poll does, scoped to one book. */
export async function refreshSoaCompany(tenantId: string): Promise<SoaRefreshResult> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.rpc("rpt_soa_register_refresh_company", { p_tenant: tenantId });
  if (error) throw new Error(error.message);
  return data as SoaRefreshResult;
}

export interface SoaRefreshLogRow {
  ran_at: string;
  tenant_id: string | null;
  row_count: number | null;
  seconds: number | null;
  error: string | null;
  source: string | null;
}

export async function loadLastSoaRefresh(tenantId: string): Promise<SoaRefreshLogRow | null> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw
    .from("rpt_soa_register_refresh_log")
    .select("ran_at,tenant_id,row_count,seconds,error,source")
    .eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as SoaRefreshLogRow | undefined) ?? null;
}
