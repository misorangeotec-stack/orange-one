/**
 * purchaseRegister.ts — data layer for the Purchase Register, the purchase-side twin of salesRegister.ts.
 *
 * WHAT IT IS
 * One row per purchase voucher LINE across every company — GST purchases (goods and inward service),
 * purchase returns and purchase debit/credit notes. GST DEBIT NOTE is a customer note and belongs to the
 * Sales Register; the rule that keeps it out is in supabase/connectwave/rpt_purchase_register.sql.
 *
 * WHERE THE NUMBERS COME FROM
 * ConnectWave `rpt_purchase_register`, built by rpt_purchase_register_rebuild. That table is NOT APPLIED
 * YET (branch Bushra-Purchase-Register). Until it is, set VITE_PURCHASE_REGISTER_SOURCE=local in
 * frontend/.env.local and build the stand-in with
 *
 *     python tools/build_purchase_register_snapshot.py
 *
 * which writes the same rows to frontend/public/dev-data/rpt_purchase_register.json (gitignored).
 *
 * Everything after the read is shared with the Sales Register: winning FY-split books (rpt_sales_book),
 * company/location from ext_company_map, and the Related/Branch class shown as the company.
 *
 * NO PARTY SCOPE. The salesperson scope restricts CUSTOMERS; a purchase party is a vendor, so the
 * catalogue entry is scoping "none".
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { fetchCompanyMap, makeCompanyResolver } from "./companyMap";
import { fysInRange, registerCompanyLabel, winningBooks } from "./salesRegister";

export interface PurchaseRegisterRow {
  tenant_id: string;
  fy: string;
  line_no: number;
  voucher_guid: string;
  /** 'item' — a stock item line; 'ledger' — a voucher with no items, one line per purchase/expense ledger. */
  kind: string;
  /** Raw, name-derived location on the table ('SURAT'). Display `location_name` instead. */
  location: string;
  /** Counterparty class ('ORANGE O TEC BRANCH', …) the TYPE prefix is built from. */
  company_label: string;
  company: string;
  location_name: string;
  company_display: string;
  /**
   * 'Purchase' · 'Purchase Return' · 'Purchase Debit Note' · 'Purchase Credit Note', each maybe
   * 'Branch '/'Related '. Service bills are plain 'Purchase' — goods vs service is the Purchase-Type.
   */
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
  /** Ex-GST. Positive for a purchase, negative for a return or debit note. */
  amount: number;
}

type RawRow = Omit<PurchaseRegisterRow, "company" | "location_name" | "company_display">;

const SELECT_COLS =
  "tenant_id,fy,line_no,voucher_guid,kind,location,company_label,type,date_display,vch_date," +
  "party,particulars,voucher_type,voucher_no,gstin,quantity,rate,amount";

const RELATED_OR_BRANCH = /^(related|branch)\b/i;

/* ------------------------------------------------------------ localhost snapshot */

export const PURCHASE_REGISTER_LOCAL = import.meta.env.VITE_PURCHASE_REGISTER_SOURCE === "local";

interface Snapshot { from: string; to: string; built_at: string; rows: RawRow[] }

let snapshot: Promise<Snapshot> | null = null;

/** The local file, read once per page load. */
export function loadPurchaseSnapshot(): Promise<Snapshot> {
  snapshot ??= fetch(`${import.meta.env.BASE_URL}dev-data/rpt_purchase_register.json`, { cache: "no-store" })
    .then(async (res) => {
      // Vite answers a missing public file with index.html, so check the type as well as the status.
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
        throw new Error("No local purchase snapshot — run: python tools/build_purchase_register_snapshot.py");
      }
      return (await res.json()) as Snapshot;
    })
    .catch((e) => { snapshot = null; throw e; });
  return snapshot;
}

async function readRaw(tenants: string[], from: string, to: string): Promise<RawRow[]> {
  if (PURCHASE_REGISTER_LOCAL) {
    const snap = await loadPurchaseSnapshot();
    const wanted = new Set(tenants);
    return snap.rows.filter((r) => wanted.has(r.tenant_id) && r.vch_date >= from && r.vch_date <= to);
  }
  const cw = getConnectwaveSupabase();
  const PAGE = 1000;
  const out: RawRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await cw
      .from("rpt_purchase_register")
      .select(SELECT_COLS)
      .in("tenant_id", tenants)
      .gte("vch_date", from)
      .lte("vch_date", to)
      .order("vch_date", { ascending: true })
      .order("tenant_id", { ascending: true })
      .order("voucher_no", { ascending: true })
      // voucher_guid makes the order UNIQUE (the key is tenant, guid, line). Without it, two vouchers
      // sharing a date and number — Tally numbers each voucher type apart, and purchase bills often
      // carry blank or manual numbers — tie, and a tie across a 1,000-row page boundary can come back
      // on both pages or on neither.
      .order("voucher_guid", { ascending: true })
      .order("line_no", { ascending: true })
      .range(offset, offset + PAGE - 1)
      .returns<RawRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/* ------------------------------------------------------------------ main read */

/** Every purchase register line for [from,to] (YYYYMMDD), all companies merged. */
export async function loadPurchaseRegister(from: string, to: string): Promise<PurchaseRegisterRow[]> {
  const books = await winningBooks(fysInRange(from, to));
  if (!books.length) return [];
  const tenants = [...new Set(books.map((b) => b.tenant_id))];
  const winningPair = new Set(books.map((b) => `${b.tenant_id}|${b.fy}`));

  const [mapRows, raw] = await Promise.all([fetchCompanyMap(), readRaw(tenants, from, to)]);
  const resolve = makeCompanyResolver(mapRows);
  return raw
    .filter((r) => winningPair.has(`${r.tenant_id}|${r.fy}`))
    .sort((a, b) =>
      a.vch_date.localeCompare(b.vch_date) || a.tenant_id.localeCompare(b.tenant_id) ||
      (a.voucher_no ?? "").localeCompare(b.voucher_no ?? "") || a.line_no - b.line_no)
    .map((r) => {
      const id = resolve(r.tenant_id, r.company_label);
      const company = RELATED_OR_BRANCH.test(r.type) ? r.company_label : id.company || r.company_label;
      const location = id.location || r.location;
      return {
        ...r,
        party: r.party ?? "",
        particulars: r.particulars ?? "",
        voucher_no: r.voucher_no ?? "",
        company,
        location_name: location,
        company_display: registerCompanyLabel(company, location),
      };
    });
}
