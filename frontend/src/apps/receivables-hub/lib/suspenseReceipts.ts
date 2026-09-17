/**
 * SUSPENSE RECEIPTS — money received into the SUSPENSE ledgers, which name no customer (RC-18).
 *
 * The foot of the Advances report. Accounts work it as one block; there is no customer to scope it by
 * and no salesperson to group it under.
 *
 * ── Three things the customer path gets wrong for these, all handled here ──
 *  1. THE LEDGERS ARE NOT CUSTOMERS. Orange O Tec's SUSPENSE A/C is filed under Sundry Debtors yet is
 *     absent from collection_customer_snapshot, so it never arrives through useAppData. They are read
 *     from v_ledger_detail by NAME. Ledgers named "…ADVANCE…" are money WE paid out or capital-goods
 *     suppliers, so they are excluded explicitly rather than trusted not to match.
 *  2. THE TENANT MUST BE THE REAL ONE. loadOnAccountEntries rebuilds `acct_orange::<company>` from the
 *     ledger guid, which drops a closed financial year's `~20250401` suffix and sends the lookup to
 *     the current book — where it silently finds nothing. On 17-09-2026 ₹1.20 L of the ₹2.20 L sat in
 *     exactly such a book. So the routine is called per v_ledger_detail.tenant_id here.
 *  3. MONEY IN ONLY. The routine returns every line with no bill allocation, debits included, and the
 *     two large SUSPENSE A/C balances (₹2.11 Cr, ₹1.29 Cr) are DEBITS — payments and opening entries,
 *     not advances received. Only positive (credit) lines are kept.
 *
 * FY-split sibling books overlap by about three months, so one voucher can come back from both. A line
 * is dropped only when an identical one (date, type, number, narration, amount) came from a DIFFERENT
 * book of the same company, and the current book's copy is kept. Lines within one book are never
 * merged: two identical receipts on one day are two receipts.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { companyGuidOf, fetchCompanyMap, makeCompanyResolver } from "./companyMap";

export interface SuspenseReceipt {
  /** Unique within the list. */
  key: string;
  tenantId: string;
  /** The Tally book's own name — it carries the financial year, which is the point for a closed book. */
  book: string;
  company: string;
  location: string;
  ledger: string;
  /** ISO yyyy-mm-dd; "" when Tally carried no date. */
  date: string;
  voucherType: string;
  voucherNo: string | null;
  narration: string | null;
  amount: number;
}

interface LedgerRow { tenant_id: string; guid: string; ledger: string }
interface RawEntry {
  ledger_id: string;
  vch_date: string | null;
  voucher_no: string | null;
  voucher_type: string | null;
  narration: string | null;
  amount: number | string | null;
}

/** "20260327" → "2026-03-27"; anything else → "". */
function isoOf(yyyymmdd: string | null): string {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return "";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Throws when the ledgers or any book's lines cannot be read — the block says so rather than showing a short list. */
export async function loadSuspenseReceipts(): Promise<SuspenseReceipt[]> {
  const cw = getConnectwaveSupabase();
  const [ledgerRes, bookRes, companyRows] = await Promise.all([
    cw.from("v_ledger_detail")
      .select("tenant_id,guid,ledger")
      .ilike("ledger", "%suspense%")
      .order("tenant_id", { ascending: true })
      .order("guid", { ascending: true }),
    cw.from("v_company").select("tenant_id,company_name"),
    fetchCompanyMap(),
  ]);
  if (ledgerRes.error) throw new Error(ledgerRes.error.message);
  // Book names are a label; an unreadable v_company degrades to the tenant id, it does not hide money.
  if (bookRes.error) console.warn("[suspenseReceipts] could not read v_company; showing tenant ids as book names", bookRes.error);
  const bookName = new Map(
    ((bookRes.data ?? []) as { tenant_id: string; company_name: string }[]).map((b) => [b.tenant_id, b.company_name]),
  );
  const resolveCompany = makeCompanyResolver(companyRows);

  const ledgers = ((ledgerRes.data ?? []) as LedgerRow[]).filter((l) => !/advance/i.test(l.ledger));
  const byTenant = new Map<string, LedgerRow[]>();
  for (const l of ledgers) {
    const list = byTenant.get(l.tenant_id);
    if (list) list.push(l);
    else byTenant.set(l.tenant_id, [l]);
  }

  // One call per book, with that book's own tenant (see 2 in the header). A handful of small calls.
  const perBook = await Promise.all([...byTenant].map(async ([tenant, rows]) => {
    const { data, error } = await cw.rpc("on_account_entries_by_id", {
      p_tenant: tenant,
      p_ledger_guids: rows.map((r) => r.guid),
    });
    if (error) throw new Error(`${bookName.get(tenant) ?? tenant}: ${error.message}`);
    const ledgerName = new Map(rows.map((r) => [r.guid, r.ledger]));
    const book = bookName.get(tenant) ?? tenant;
    const { company, location } = resolveCompany(tenant, book);
    return ((data ?? []) as RawEntry[])
      .map((r, i): SuspenseReceipt => ({
        key: `${tenant}#${r.ledger_id}#${i}`,
        tenantId: tenant,
        book,
        company,
        location,
        ledger: ledgerName.get(r.ledger_id) ?? "",
        date: isoOf(r.vch_date),
        voucherType: r.voucher_type ?? "",
        voucherNo: r.voucher_no?.trim() || null,
        narration: r.narration?.trim() || null,
        amount: Number(r.amount) || 0,
      }))
      .filter((r) => r.amount > 0);
  }));

  // Drop a line only when a sibling book of the same company returned the same voucher.
  const all = perBook.flat();
  const sameVoucher = (r: SuspenseReceipt) =>
    [companyGuidOf(r.tenantId), r.date, r.voucherType, r.voucherNo ?? "", r.narration ?? "", r.amount.toFixed(2)].join("|");
  const byVoucher = new Map<string, SuspenseReceipt[]>();
  for (const r of all) {
    const k = sameVoucher(r);
    const list = byVoucher.get(k);
    if (list) list.push(r);
    else byVoucher.set(k, [r]);
  }
  const kept: SuspenseReceipt[] = [];
  for (const list of byVoucher.values()) {
    const books = [...new Set(list.map((r) => r.tenantId))];
    if (books.length === 1) { kept.push(...list); continue; }
    // The current book is the one without a `~<fy start>` suffix; failing that, the latest year.
    const keep = books.find((t) => !t.includes("~")) ?? books.sort()[books.length - 1];
    kept.push(...list.filter((r) => r.tenantId === keep));
  }
  return kept.sort((a, b) => a.date.localeCompare(b.date) || a.book.localeCompare(b.book));
}
