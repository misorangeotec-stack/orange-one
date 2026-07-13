/**
 * supabaseFetcher.ts — Backend-swap layer for useAppData.
 *
 * Fetches the same shapes that the JSON loader produces, but from Supabase
 * tables instead of static JSON files. Active when VITE_DATA_SOURCE=supabase.
 *
 * Pagination: PostgREST defaults to a 1000-row max per request. Each table
 * fetch paginates via .range() until the page is short. The 4 top-level
 * loaders (dashboard / customers / invoices / customer_groups) are called
 * in parallel by useAppData.
 */
import { getSupabase } from "./receivablesSupabase";
import type {
  Customer, CustomerDetail, DashboardData, CustomerGroupMap,
  Invoice, MonthlyTrend, ReceiptTransaction, OtherPaymentTransaction, CreditNoteTransaction,
  DebitNoteTransaction, JournalTransaction, TrendPoint,
} from "./types";

const PAGE = 1000;

function fySuffixToFy(suffix: string): string {
  if (suffix === "_fy2526") return "fy2526";
  if (suffix === "_fy2627") return "fy2627";
  return "default";
}

const MONTH_INDEX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// "Apr-25" → 2025*12 + 3. Unknown labels sort last.
function monthLabelToOrdinal(label: string): number {
  const [mon, yy] = label.split("-");
  const m = MONTH_INDEX[mon];
  const y = Number(yy);
  if (m === undefined || Number.isNaN(y)) return Number.MAX_SAFE_INTEGER;
  return (2000 + y) * 12 + m;
}

/**
 * Page through a table with .range(), under a STABLE TOTAL ORDER.
 *
 * ── Why `orderBy` is required, and why it must be UNIQUE ──────────────────────────────
 *
 * Postgres makes NO guarantee about row order without an ORDER BY. Paginating an unordered
 * query is therefore not "probably fine" — it is a lottery re-run for every page: the planner
 * is free to hand back rows in a different order on the very next request, so page 2 can repeat
 * rows page 1 already returned and skip others entirely. Nothing errors. You just get the wrong
 * number, sometimes.
 *
 * MEASURED on the live book (13-Jul-2026), fetching `customer_trend` (28,480 rows / 29 pages)
 * four times with the identical unordered query: three runs came back clean, and one returned
 * 2,064 DUPLICATE rows while silently dropping 2,064 others — inflating total receipts from
 * ₹355.72 cr to ₹402.76 cr. A 13% error, on a random page load, on every screen in this app.
 *
 * The order key must be a UNIQUE column (or a unique combination). Ordering by a non-unique
 * column re-introduces the same bug for the ties, which can straddle a page boundary.
 *
 * Small tables (< PAGE rows) never paginate and so were never at risk — but they are ordered
 * too, because "it fits in one page today" is not a property worth relying on.
 */
async function fetchAllRows<T>(
  makeQuery: () => any,   // a builder factory — re-invoked each page
  orderBy: string[],      // UNIQUE key. Required — see above.
): Promise<T[]> {
  // Walk pages until we receive a short one. We deliberately don't trust
  // PostgREST's count header here: chaining `.select(*, { count: "exact" })`
  // after `.range()` returned `count: null` in practice (anon-key + chained
  // builder), which made the early-return fire and silently truncated the
  // result to PAGE rows. Stopping on a short page is robust regardless.
  const result: T[] = [];
  let from = 0;
  for (;;) {
    let q = makeQuery();
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    result.push(...rows);
    if (rows.length < PAGE) return result;
    from += PAGE;
  }
}

// ── customers ───────────────────────────────────────────────────────────────

interface CustomerRow {
  id: string; name: string; company: string; location: string;
  sales_person: string | null;
  category: string | null;
  credit_period: number; credit_limit: number;
  proposed_credit_limit_3m: number;
  proposed_credit_limit_3m_delta_pct: number | null;
  proposed_credit_limit_ai: number;
  proposed_credit_limit_ai_delta_pct: number | null;
  proposed_credit_limit_reason: any;
  opening_balance: number; remaining_opening_balance: number;
  ob_receipts_applied: number; ob_credit_notes_applied: number;
  advance_balance: number; advance_breakdown: any;
  sales: number; receipts: number; other_payments: number | null; receipts_3m: number;
  credit_notes: number; debit_notes: number;
  journal_dr: number; journal_cr: number; journal_adjustments: number;
  check_returns: number;
  outstanding: number; overdue: number;
  max_overdue_days: number; utilization: number; risk: string;
  aging_buckets: any; aging_buckets_by_type: any;
  sales_by_type: any; receipts_by_type: any; credit_notes_by_type: any;
  debit_notes_by_type: any; journal_by_type: any;
  outstanding_by_type: any; overdue_by_type: any;
  opening_balance_by_type: any;
}

function toCustomer(r: CustomerRow): Customer {
  return {
    id: r.id, name: r.name, company: r.company, location: r.location,
    salesPerson: r.sales_person ?? "",
    category: r.category ?? "",
    creditPeriod: r.credit_period,
    creditLimit: Number(r.credit_limit),
    proposedCreditLimit3M: Number(r.proposed_credit_limit_3m),
    proposedCreditLimit3MDeltaPct: r.proposed_credit_limit_3m_delta_pct === null
      ? null : Number(r.proposed_credit_limit_3m_delta_pct),
    proposedCreditLimitAI: Number(r.proposed_credit_limit_ai),
    proposedCreditLimitAIDeltaPct: r.proposed_credit_limit_ai_delta_pct === null
      ? null : Number(r.proposed_credit_limit_ai_delta_pct),
    proposedCreditLimitReason: r.proposed_credit_limit_reason ?? {},
    openingBalance: Number(r.opening_balance),
    openingDrCr: Number(r.opening_balance) < 0 ? 'Cr' : 'Dr',
    remainingOpeningBalance: Number(r.remaining_opening_balance),
    obReceiptsApplied: Number(r.ob_receipts_applied),
    obCreditNotesApplied: Number(r.ob_credit_notes_applied),
    advanceBalance: Number(r.advance_balance),
    advanceBreakdown: r.advance_breakdown ?? { onAccount: 0, agstRefExcess: 0, creditNotes: 0, otherPayment: 0 },
    sales: Number(r.sales),
    receipts: Number(r.receipts),
    otherPayments: Number(r.other_payments ?? 0),
    receipts1M: 0, receipts3M: Number(r.receipts_3m), receipts6M: 0,
    monthlyReceipts: {},
    creditNotes: Number(r.credit_notes),
    debitNotes: Number(r.debit_notes),
    journalDr: Number(r.journal_dr),
    journalCr: Number(r.journal_cr),
    journalAdjustments: Number(r.journal_adjustments),
    openingBalanceAdjustment: 0,
    checkReturns: Number(r.check_returns),
    outstanding: Number(r.outstanding),
    overdue: Number(r.overdue),
    maxOverdueDays: r.max_overdue_days,
    utilization: Number(r.utilization),
    risk: r.risk as Customer["risk"],
    agingBuckets: r.aging_buckets ?? {},
    agingBucketsByType: r.aging_buckets_by_type ?? {},
    salesByType: r.sales_by_type ?? {},
    receiptsByType: r.receipts_by_type ?? {},
    creditNotesByType: r.credit_notes_by_type ?? {},
    debitNotesByType: r.debit_notes_by_type ?? {},
    journalByType: r.journal_by_type ?? {},
    outstandingByType: r.outstanding_by_type ?? {},
    overdueByType: r.overdue_by_type ?? {},
    openingBalanceByType: r.opening_balance_by_type ?? {},
    lastReceiptDate: null,
    daysSinceLastReceipt: null,
    consecutiveNoPaymentMonths: 0,
    paymentActiveMonths: 0,
  } as Customer;
}

export async function fetchCustomersFromSupabase(fySuffix: string): Promise<Customer[]> {
  const sb = getSupabase();
  const fy = fySuffixToFy(fySuffix);
  const rows = await fetchAllRows<CustomerRow>(
    () => sb.from("customers").select("*").eq("fiscal_year", fy),
    ["id"],   // unique within a fiscal_year (the ledger id)
  );
  return rows.map(toCustomer);
}

/**
 * Normalised set of every invoice/bill number this customer (or set of grouped
 * customers) has across ALL fiscal years. Used by Customer Detail to classify a
 * receipt / credit-note / etc. as settling a *current-period invoice* vs an
 * *opening-balance* bill: a bill reference NOT present in this universe predates
 * the dashboard's period (≤ 31-Mar-2025) and so belongs to the opening balance.
 *
 * Deliberately FY-agnostic (no `.eq("fiscal_year", …)`): the per-FY "default"
 * bundle drops fully-paid early bills, which would mislabel their receipts as
 * opening balance. Selects only `number` to stay cheap.
 */
export async function fetchInvoiceNumbersForCustomers(customerIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const sb = getSupabase();
  const rows = await fetchAllRows<{ number: string | null }>(
    () => sb.from("invoices").select("number,pk").in("customer_id", ids),
    ["pk"],   // the table's real primary key (`id` repeats across fiscal years)
  );
  const set = new Set<string>();
  for (const r of rows) {
    const n = (r.number ?? "").trim().toUpperCase();
    if (n) set.add(n);
  }
  return set;
}

/**
 * Distinct salesperson names from the receivables data, for the admin
 * "salesperson access" picker in Orange One. Returns exactly the strings the
 * dashboard scopes on (customers.sales_person), so tagged values match 1:1.
 * Reads the combined ("default") fiscal-year customer set.
 */
export async function fetchSalespersonNames(): Promise<string[]> {
  const sb = getSupabase();
  const rows = await fetchAllRows<{ sales_person: string | null }>(
    () => sb.from("customers").select("sales_person,id").eq("fiscal_year", "default"),
    ["id"],
  );
  const names = new Set<string>();
  for (const r of rows) {
    const n = (r.sales_person ?? "").trim();
    if (n) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ── dashboard ───────────────────────────────────────────────────────────────

export async function fetchDashboardFromSupabase(fySuffix: string): Promise<DashboardData> {
  const sb = getSupabase();
  const fy = fySuffixToFy(fySuffix);

  const [metaRes, trendRows] = await Promise.all([
    sb.from("dashboard_meta").select("*").eq("fiscal_year", fy).maybeSingle(),
    fetchAllRows<{ month: string; sales: number; receipts: number; credit_notes: number; debit_notes: number; journal_adjustments: number; outstanding: number }>(
      // `month` is only the PAGE-STABILITY key here, not the display order: sorting it in SQL is
      // an alphabetical string sort (Apr-25, Apr-26, Aug-25, …), so the chronological sort still
      // happens client-side below. It is unique per fiscal_year, which is all pagination needs.
      () => sb.from("dashboard_trend").select("*").eq("fiscal_year", fy),
      ["month"],
    ),
  ]);

  if (metaRes.error) throw metaRes.error;

  trendRows.sort((a, b) => monthLabelToOrdinal(a.month) - monthLabelToOrdinal(b.month));

  const trend: TrendPoint[] = trendRows.map((t) => ({
    month: t.month,
    sales: Number(t.sales),
    receipts: Number(t.receipts),
    outstanding: Number(t.outstanding),
    // creditNotes / debitNotes / journalAdjustments are present on the row but
    // not declared on TrendPoint; rendered components read them via any-cast.
    ...(t.credit_notes !== undefined ? { creditNotes: Number(t.credit_notes) } : {}),
    ...(t.debit_notes !== undefined ? { debitNotes: Number(t.debit_notes) } : {}),
    ...(t.journal_adjustments !== undefined ? { journalAdjustments: Number(t.journal_adjustments) } : {}),
  } as TrendPoint));

  return {
    asOfDate: metaRes.data?.as_of_date ?? "",
    lastUpdated: metaRes.data?.last_updated ?? "",
    refreshMetadata: metaRes.data?.refresh_metadata ?? undefined,
    trend,
    // Fields the hook recomputes client-side OR feature dropped in Supabase mode.
    // Frontend reads via optional chaining and won't break on empties.
    alerts: [],
    riskTrend: [],
    aging: [],
    riskSegmentation: [],
    topRiskyCustomers: [],
  } as unknown as DashboardData;
}

// ── customer_groups ─────────────────────────────────────────────────────────

export async function fetchCustomerGroupsFromSupabase(): Promise<CustomerGroupMap> {
  const sb = getSupabase();
  // 1,190 rows — this one DOES paginate, so it was exposed to the same bug.
  const rows = await fetchAllRows<{ tally_name: string; group_name: string }>(
    () => sb.from("customer_groups").select("*"),
    ["tally_name"],
  );
  const mapping: Record<string, string> = {};
  const groups: Record<string, string[]> = {};
  for (const r of rows) {
    mapping[r.tally_name] = r.group_name;
    (groups[r.group_name] ??= []).push(r.tally_name);
  }
  return { mapping, groups };
}

// ── invoices (per-customer bundle: invoices + trend + 4 transaction types) ──

export async function fetchInvoicesFromSupabase(fySuffix: string): Promise<Record<string, CustomerDetail>> {
  const sb = getSupabase();
  const fy = fySuffixToFy(fySuffix);

  const [invs, trends, rcpts, ops, cns, dns, jns] = await Promise.all([
    // Every key below is UNIQUE. customer_trend has no id column — (customer_id, month) is its
    // natural key, and the pair is unique within a fiscal_year.
    fetchAllRows<any>(() => sb.from("invoices").select("*").eq("fiscal_year", fy), ["pk"]),
    fetchAllRows<any>(() => sb.from("customer_trend").select("*").eq("fiscal_year", fy), ["customer_id", "month"]),
    fetchAllRows<any>(() => sb.from("receipt_transactions").select("*").eq("fiscal_year", fy), ["id"]),
    fetchAllRows<any>(() => sb.from("other_payment_transactions").select("*").eq("fiscal_year", fy), ["id"]),
    fetchAllRows<any>(() => sb.from("credit_note_transactions").select("*").eq("fiscal_year", fy), ["id"]),
    fetchAllRows<any>(() => sb.from("debit_note_transactions").select("*").eq("fiscal_year", fy), ["id"]),
    fetchAllRows<any>(() => sb.from("journal_transactions").select("*").eq("fiscal_year", fy), ["id"]),
  ]);

  const result: Record<string, CustomerDetail> = {};
  const ensure = (cid: string): CustomerDetail => (result[cid] ??= {
    invoices: [], trend: [],
    receiptTransactions: [], otherPaymentTransactions: [], creditNoteTransactions: [],
    debitNoteTransactions: [], journalTransactions: [],
  });

  for (const r of invs) {
    ensure(r.customer_id).invoices.push({
      id: r.id, number: r.number, date: r.date,
      amount: Number(r.amount),
      receiptAdj: Number(r.receipt_adj),
      creditNoteAdj: 0, debitNoteAdj: 0, journalAdj: 0,
      otherPaymentAdj: Number(r.other_payment_adj ?? 0),
      pending: Number(r.pending),
      dueDate: r.due_date ?? "",
      overdueDays: r.overdue_days,
      status: r.status as Invoice["status"],
      voucherType: r.voucher_type as Invoice["voucherType"],
    } as Invoice);
  }
  trends.sort((a, b) => monthLabelToOrdinal(a.month) - monthLabelToOrdinal(b.month));
  for (const r of trends) {
    ensure(r.customer_id).trend.push({
      month: r.month,
      sales: Number(r.sales),
      receipts: Number(r.receipts),
      creditNotes: Number(r.credit_notes),
      debitNotes: Number(r.debit_notes),
      journalAdjustments: Number(r.journal_adjustments),
      checkReturns:       Number(r.check_returns),
      outstanding: Number(r.outstanding),
      overdue: Number(r.overdue),
      maxOverdueDays: r.max_overdue_days,
      risk: r.risk ?? "low",
      outstandingByType: r.outstanding_by_type ?? {},
      maxOverdueDaysByType: r.max_overdue_days_by_type ?? {},
      receiptsByType: r.receipts_by_type ?? {},
      salesByType: r.sales_by_type ?? {},
    } as MonthlyTrend);
  }
  for (const r of rcpts) {
    ensure(r.customer_id).receiptTransactions.push({
      date: r.date, amount: Number(r.amount), type: r.type, refInvoice: r.ref_invoice,
      saleType: r.sale_type ?? null,
    } as ReceiptTransaction);
  }
  for (const r of ops) {
    ensure(r.customer_id).otherPaymentTransactions!.push({
      date: r.date, amount: Number(r.amount), type: r.type,
      refInvoice: r.ref_invoice, paymentRef: r.payment_ref ?? null,
      remark: r.remark ?? null,
    } as OtherPaymentTransaction);
  }
  for (const r of cns) {
    ensure(r.customer_id).creditNoteTransactions!.push({
      date: r.date ?? "", voucherNo: r.voucher_no ?? "",
      amount: Number(r.amount), refInvoice: r.ref_invoice, narration: r.narration ?? "",
      saleType: r.sale_type ?? null,
    } as CreditNoteTransaction);
  }
  for (const r of dns) {
    ensure(r.customer_id).debitNoteTransactions!.push({
      date: r.date ?? "", voucherNo: r.voucher_no ?? "",
      amount: Number(r.amount), refInvoice: r.ref_invoice, narration: r.narration ?? "",
      saleType: r.sale_type ?? null,
    } as DebitNoteTransaction);
  }
  for (const r of jns) {
    ensure(r.customer_id).journalTransactions!.push({
      date: r.date ?? "", voucherNo: r.voucher_no ?? "",
      amount: Number(r.amount), type: r.type as JournalTransaction["type"],
      signedAmount: Number(r.signed_amount),
      refInvoice: r.ref_invoice, narration: r.narration ?? "",
      saleType: r.sale_type ?? null,
    } as JournalTransaction);
  }
  return result;
}
