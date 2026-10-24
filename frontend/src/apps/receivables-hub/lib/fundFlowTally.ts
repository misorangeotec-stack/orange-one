/**
 * fundFlowTally.ts — what Fund Flow reads from Tally (the ConnectWave mirror). Read-only.
 *
 * 1. VENDORS DUE (user, 24-Oct-2026): every Sundry Creditor with bills due on or before the month
 *    end, all five companies, so the Other Vendor list is pulled rather than typed. Read from
 *    `rpt_payables_report` — the stored nightly payables snapshot the Payables report uses — and
 *    never from a live voucher scan: the browser reads ConnectWave as `anon` with a ~3 s statement
 *    timeout (CONNECTWAVE-READ-COST.md), one call per company.
 * 2. TALLY PAID: for a line linked to a vendor ledger, that ledger's bank payments in the month,
 *    via `ledger_txn_by_id` (the per-ledger RPC Ledger Vouchers uses, ~0.2 s). Matched by the
 *    ledger GUID — never by name, because the mirror's names lag Tally renames.
 *
 * Every figure comes back with the time it was read, and the page saves that figure WITH its time
 * on the line, so a closed month never changes when Tally does.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { loadLedgerVouchers } from "./ledgerVouchers";
import { loadPayablesLastRefresh } from "./payablesReport";
import type { FfCompany } from "./fundFlowCalc";

export interface FfBook {
  tenant: string;
  companyGuid: string;
  companyName: string;
  company: FfCompany;
  location: "Surat" | "Noida";
}

export interface VendorBill { billRef: string; billDate: string; dueDate: string | null; pending: number }

export interface VendorDue {
  book: FfBook;
  ledger: string;
  bills: VendorBill[];
  /** Σ pending of bills due on or before the month end. */
  due: number;
  /** Σ pending of the bills more than 30 days past due at the month end — what is budgeted. */
  dueOver30: number;
  /** Oldest due date among those bills, yyyymmdd. */
  oldestDue: string;
  /** Days past due of the oldest bill, at the month end. */
  oldestDays: number;
  /** Money paid to this vendor and settling no bill (an advance / on-account debit), from the party row. */
  advance: number;
  /** Credit balance with no bill-wise detail. Shown, never ticked by default. */
  onAccount: number;
}

export interface VendorDueResult {
  vendors: VendorDue[];
  /** Companies that could not be read, with the reason. Never folded into the list as zero. */
  failed: { book: FfBook; error: string }[];
  /** Last payables snapshot rebuild per company (the 21:00 IST nightly, or a manual refresh). */
  refreshedAt: { book: FfBook; at: string | null }[];
  readAt: string;
}

/** "2026-10-01" → "2026-27". */
export function fyOfMonth(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}

function bookOf(tenant: string, companyGuid: string, name: string): FfBook {
  const up = name.toUpperCase();
  const company: FfCompany = /COLORIX/.test(up) ? "Colorix" : /ENTERPRISE/.test(up) ? "Enterprises" : "O Tec";
  return { tenant, companyGuid, companyName: name, company, location: /NOIDA/.test(up) ? "Noida" : "Surat" };
}

/** The five books for a financial year (rpt_sales_book gives the FY's tenant per company). */
export async function loadBooks(fy: string): Promise<FfBook[]> {
  const cw = getConnectwaveSupabase();
  const [books, names] = await Promise.all([
    cw.from("rpt_sales_book").select("tenant_id,company_guid,fy").eq("fy", fy),
    cw.from("v_company").select("tenant_id,company_name"),
  ]);
  if (books.error) throw new Error(books.error.message);
  if (names.error) throw new Error(names.error.message);
  const nameOf = new Map((names.data as { tenant_id: string; company_name: string }[]).map((r) => [r.tenant_id, r.company_name]));
  return (books.data as { tenant_id: string; company_guid: string }[])
    .map((b) => bookOf(b.tenant_id, b.company_guid, nameOf.get(b.tenant_id) ?? b.tenant_id))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
}

const isTimeout = (msg: string) => /57014|statement timeout|canceling statement/i.test(msg);

async function payablesFor(book: FfBook, fy: string, asOn: string) {
  const cw = getConnectwaveSupabase();
  const start = Number(fy.slice(0, 4));
  const args = { p_tenant: book.tenant, p_fy_from: `${start}0401`, p_as_on: asOn, p_fy_to: `${start + 1}0331`, p_parties: null, p_groups: null };
  let res = await cw.rpc("rpt_payables_report", args);
  // One retry on a statement timeout: those come from colliding with ConnectWave's 5-minute
  // rebuild cron and clear on the next try (CONNECTWAVE-READ-COST.md).
  if (res.error && isTimeout(res.error.message)) res = await cw.rpc("rpt_payables_report", args);
  if (res.error) throw new Error(res.error.message);
  return res.data as {
    bills: { ledger: string; bill_ref: string; bill_date: string; due_date: string | null; pending: number }[];
    parties: { ledger: string; advance: number; on_account: number }[];
  };
}

const ymd = (iso: string) => iso.replace(/-/g, "");
const daysBetween = (a: string, b: string) => {
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return Math.round((d(b) - d(a)) / 86_400_000);
};

/**
 * Vendors with bills due on or before `monthEndIso`, every company.
 * A bill with no due date is treated as due on its bill date (Tally's own default when a ledger
 * carries no credit period).
 */
/**
 * Our own group: Orange O Tec Pvt Ltd / Enterprises, Colorix, and branch / division accounts —
 * inter-company and inter-branch balances, not vendor payments (user, 24-Oct-2026).
 */
const GROUP_COMPANY = /ORANGE\s*-?\s*O\s*-?\s*TEC|COLORIX|\bBRANCH(ES)?\b|\bDIVISIONS?\b/i;

export async function loadVendorsDue(monthIso: string, monthEndIso: string): Promise<VendorDueResult> {
  const fy = fyOfMonth(monthIso);
  const books = await loadBooks(fy);
  const end = ymd(monthEndIso);
  const today = ymd(new Date().toISOString().slice(0, 10));
  const asOn = today < end ? today : end;
  const vendors: VendorDue[] = [];
  const failed: VendorDueResult["failed"] = [];
  const refreshedAt: VendorDueResult["refreshedAt"] = [];

  await Promise.all(books.map(async (book) => {
    try {
      const [data, last] = await Promise.all([
        payablesFor(book, fy, asOn),
        loadPayablesLastRefresh(book.companyGuid, fy).catch(() => null),
      ]);
      refreshedAt.push({ book, at: last?.ran_at ?? null });
      const party = new Map(data.parties.map((p) => [p.ledger, p]));
      const byLedger = new Map<string, VendorBill[]>();
      for (const b of data.bills) {
        const due = b.due_date || b.bill_date;
        if (!due || due > end || !(Math.abs(b.pending) > 0.5)) continue;
        const list = byLedger.get(b.ledger) ?? [];
        list.push({ billRef: b.bill_ref, billDate: b.bill_date, dueDate: b.due_date, pending: Math.abs(b.pending) });
        byLedger.set(b.ledger, list);
      }
      for (const [ledger, bills] of byLedger) {
        // Our own group companies are inter-company balances, not vendor payments: never listed
        // (user, 24-Oct-2026: "remove Orange O Tec and Enterprises", then Colorix and branches too).
        if (GROUP_COMPANY.test(ledger)) continue;
        const oldest = bills.map((x) => x.dueDate || x.billDate).sort()[0];
        const p = party.get(ledger);
        vendors.push({
          book, ledger, bills,
          due: bills.reduce((s, x) => s + x.pending, 0),
          dueOver30: bills.filter((x) => daysBetween(x.dueDate || x.billDate, end) > 30).reduce((s, x) => s + x.pending, 0),
          oldestDue: oldest, oldestDays: daysBetween(oldest, end),
          advance: p?.advance ?? 0, onAccount: p?.on_account ?? 0,
        });
      }
    } catch (e) {
      failed.push({ book, error: e instanceof Error ? e.message : String(e) });
    }
  }));

  vendors.sort((a, b) => b.due - a.due);
  return { vendors, failed, refreshedAt, readAt: new Date().toISOString() };
}

/** Age bucket of a vendor's oldest due bill at the month end. Over 180 is unticked by default. */
export function ageBucket(days: number): "0-30" | "31-90" | "91-180" | "180+" {
  return days <= 30 ? "0-30" : days <= 90 ? "31-90" : days <= 180 ? "91-180" : "180+";
}

/** The GUID of a ledger in a book, by its exact name (once, when a line is first linked). */
export async function ledgerGuidOf(tenant: string, ledger: string): Promise<string | null> {
  const cw = getConnectwaveSupabase();
  const { data, error } = await cw.from("v_ledger_detail").select("guid").eq("tenant_id", tenant).eq("ledger", ledger).limit(1);
  if (error) throw new Error(error.message);
  return (data as { guid: string }[] | null)?.[0]?.guid ?? null;
}

/**
 * Bank payments to one vendor ledger inside the month: the Dr lines of payment vouchers.
 * Journals and purchases are not payments and are left out.
 */
export async function tallyPaidInMonth(tenant: string, ledgerGuid: string, monthIso: string, monthEndIso: string) {
  const rows = await loadLedgerVouchers(tenant, ledgerGuid);
  const from = ymd(monthIso);
  const to = ymd(monthEndIso);
  let paid = 0;
  const vouchers: { date: string; no: string | null; amount: number; bank: string | null }[] = [];
  for (const r of rows) {
    const d = r.date ?? "";
    if (d < from || d > to) continue;
    if (r.amount <= 0 || !/payment/i.test(r.voucherType ?? "")) continue;
    paid += r.amount;
    vouchers.push({ date: d, no: r.voucherNo, amount: r.amount, bank: r.particulars });
  }
  return { paid, vouchers, readAt: new Date().toISOString() };
}
