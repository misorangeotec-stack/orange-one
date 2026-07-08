/**
 * connectwaveFetcher.ts — data source for the "Collection Report (Tally Live)" screen.
 *
 * Reads the pre-computed snapshot tables in the ConnectWave (TallyCopilot) Supabase
 * (filled by public.collection_refresh()) and maps them to the SAME shapes useAppData
 * consumes (Customer[] / CustomerDetail / DashboardData / CustomerGroupMap), so the
 * existing SalespersonCollectionReport renders unchanged — only the backend differs.
 *
 * Snapshot tables (see connector/supabase/collection_report.sql):
 *   collection_customer_snapshot  — one row per customer (current-month figures + FY activity)
 *   collection_invoice_snapshot   — one row per open bill (current + opening)
 *   collection_meta               — as-of stamp
 *   ext_customer_group            — customer → group muster
 *
 * v1 scope: current month only (the snapshot's month_label). Historical month-wise
 * trend is a later iteration, so each customer's `trend` carries a single month row.
 */
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import type {
  Customer, CustomerDetail, DashboardData, CustomerGroupMap,
  Invoice, MonthlyTrend, SaleType, TrendPoint, RiskCategory,
  AgingBuckets, ProposedCreditLimitReason,
} from "./types";

const PAGE = 1000;
const LAKH = 100_000;
const SALE_TYPES: SaleType[] = ["ink", "spare_parts", "machine", "head", "other"];

/** Same rule as useAppData.categorizeRisk — keep in sync so Live risk bands match the default source. */
function categorizeRisk(maxOD: number, util: number): RiskCategory {
  if (maxOD > 180 || util > 100) return "critical";
  if (maxOD > 90  || util > 75)  return "high";
  if (maxOD > 30  || util > 50)  return "medium";
  return "low";
}

const EMPTY_AGING = (): AgingBuckets => ({ "0_30": 0, "31_60": 0, "61_90": 0, "91_120": 0, "121_180": 0, "180_plus": 0 });
/** Coerce the snapshot's aging_buckets jsonb into a full AgingBuckets record (rupees). */
function toAging(j: any): AgingBuckets {
  const out = EMPTY_AGING();
  if (j && typeof j === "object")
    for (const k of Object.keys(out) as (keyof AgingBuckets)[]) out[k] = Number(j[k]) || 0;
  return out;
}

const MONTH_ABBR: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
/** "Apr-25" → sortable ordinal (chronological). Unknown labels sort last. */
function monthOrd(label: string): number {
  const [mon, yy] = label.split("-");
  const m = MONTH_ABBR[mon]; const y = Number(yy);
  if (m === undefined || Number.isNaN(y)) return Number.MAX_SAFE_INTEGER;
  return (2000 + y) * 12 + m;
}

interface RawAppData {
  dash: DashboardData;
  cust: Customer[];
  inv: Record<string, CustomerDetail>;
  grp: CustomerGroupMap;
}

async function fetchAll<T>(makeQuery: () => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    from += PAGE;
  }
}

/** yyyymmdd → "YYYY-MM-DD" (the report parses these with new Date()). "" when unparseable. */
function ymdToIso(s: string | null | undefined): string {
  if (!s || !/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Coerce a snapshot jsonb {type: amount} into a full Record<SaleType, number>
 *  (rupees). Unknown buckets (e.g. 'non_product') fold into 'other'. */
function toTypeRecord(j: any, scale = 1): Record<SaleType, number> {
  const out: Record<SaleType, number> = { ink: 0, spare_parts: 0, machine: 0, head: 0, other: 0 };
  if (j && typeof j === "object") {
    for (const [k, v] of Object.entries(j)) {
      const key = (SALE_TYPES as string[]).includes(k) ? (k as SaleType) : "other";
      out[key] += Number(v) * scale;
    }
  }
  return out;
}

/** A bill's product bucket → a valid SaleType (unknowns → "other"). */
function toSaleType(s: string | null | undefined): SaleType {
  return (SALE_TYPES as string[]).includes(s ?? "") ? (s as SaleType) : "other";
}

interface CustSnap {
  tenant_id: string; ledger_id: string; name: string; company: string; location: string;
  salesperson: string | null; category: string | null; group_name: string | null;
  credit_limit: number; credit_period: number; opening_balance: number;
  outstanding: number; overdue: number;
  month_label: string; month_sales: number; month_receipts: number;
  fy_sales: number; fy_receipts: number;
  outstanding_by_type: any; overdue_by_type: any; sales_by_type: any;
  monthly: any; // { 'Apr-25': { s, r, o, od }, ... } — rupees
  // full-dashboard enrichment (2026-07-07)
  max_overdue_days: number | null; aging_buckets: any; remaining_opening_balance: number | null;
  credit_notes: number | null; debit_notes: number | null; journal_dr: number | null; journal_cr: number | null;
  check_returns: number | null; receipts_3m: number | null; receipts_6m: number | null;
  last_receipt_date: string | null;
  proposed_3m: number | null; proposed_3m_delta: number | null;
  proposed_ai: number | null; proposed_ai_delta: number | null; proposed_reason: any;
}
interface InvSnap {
  tenant_id: string; ledger_id: string; bill_ref: string; bill_date: string | null;
  amount: number; pending: number; due_date: string | null; overdue_days: number;
  sale_type: string; is_opening: boolean;
}

const emptyTypeRec = (): Record<SaleType, number> => ({ ink: 0, spare_parts: 0, machine: 0, head: 0, other: 0 });

/** yyyymmdd → "YYYY-MM-DD"; whole-day difference from today (null when unparseable). */
function daysSince(ymd: string | null | undefined): { iso: string | null; days: number | null } {
  const iso = ymdToIso(ymd);
  if (!iso) return { iso: null, days: null };
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return { iso, days: null };
  return { iso, days: Math.max(0, Math.round((Date.now() - then) / 86_400_000)) };
}

function toCustomer(r: CustSnap): Customer {
  const outstanding = Number(r.outstanding);
  const creditLimit = Number(r.credit_limit) || 0;
  const maxOverdueDays = Number(r.max_overdue_days) || 0;
  const utilization = creditLimit > 0 ? Math.round(outstanding / creditLimit * 1000) / 10 : 0;
  const journalDr = Number(r.journal_dr) || 0;
  const journalCr = Number(r.journal_cr) || 0;
  const advanceBalance = outstanding < 0 ? -outstanding : 0;
  const { iso: lastReceiptDate, days: daysSinceLastReceipt } = daysSince(r.last_receipt_date);
  // Monthly receipts (rupees) keyed by month label — from the `monthly` jsonb (which stores lakhs).
  const monthlyReceipts: Record<string, number> = {};
  if (r.monthly && typeof r.monthly === "object")
    for (const [m, v] of Object.entries(r.monthly)) monthlyReceipts[m] = Number((v as any)?.r || 0);
  return {
    id: r.ledger_id,
    name: r.name ?? "",
    company: r.company ?? "",
    location: r.location ?? "",
    salesPerson: r.salesperson ?? "",
    category: r.category ?? "",
    creditPeriod: Number(r.credit_period) || 0,
    creditLimit,
    blocked: false,   // overridden downstream from the creditLimit===1 sentinel (see useAppData)
    openingBalance: Number(r.opening_balance) || 0,
    openingDrCr: (Number(r.opening_balance) || 0) < 0 ? "Cr" : "Dr",
    remainingOpeningBalance: Number(r.remaining_opening_balance) || 0,
    advanceBalance,
    advanceBreakdown: { onAccount: advanceBalance, agstRefExcess: 0, creditNotes: 0, otherPayment: 0 },
    // FY-to-date activity drives the "Active" customer-segment filter.
    sales: Number(r.fy_sales) || 0,
    receipts: Number(r.fy_receipts) || 0,
    otherPayments: 0,
    creditNotes: Number(r.credit_notes) || 0,
    debitNotes: Number(r.debit_notes) || 0,
    journalDr,
    journalCr,
    journalAdjustments: journalDr - journalCr,
    openingBalanceAdjustment: 0,
    checkReturns: Number(r.check_returns) || 0,
    outstanding,
    overdue: Number(r.overdue) || 0,
    maxOverdueDays,
    utilization,
    risk: categorizeRisk(maxOverdueDays, utilization),
    agingBuckets: toAging(r.aging_buckets),
    agingBucketsByType: {} as any,   // per-type aging deferred → frontend projects by sales mix
    salesByType: toTypeRecord(r.sales_by_type),
    receiptsByType: emptyTypeRec(),  // receipts-by-bill-type deferred (v1): totals are exact, split isn't
    creditNotesByType: emptyTypeRec(),
    outstandingByType: toTypeRecord(r.outstanding_by_type),
    overdueByType: toTypeRecord(r.overdue_by_type),
    openingBalanceByType: emptyTypeRec(),
    obReceiptsApplied: 0,
    obCreditNotesApplied: 0,
    lastReceiptDate,
    daysSinceLastReceipt,
    receipts1M: Number(r.month_receipts) || 0,
    receipts3M: Number(r.receipts_3m) || 0,
    receipts6M: Number(r.receipts_6m) || 0,
    monthlyReceipts,
    consecutiveNoPaymentMonths: 0,
    paymentActiveMonths: 0,
    proposedCreditLimit3M: Number(r.proposed_3m) || 0,
    proposedCreditLimit3MDeltaPct: r.proposed_3m_delta == null ? null : Number(r.proposed_3m_delta),
    proposedCreditLimitAI: Number(r.proposed_ai) || 0,
    proposedCreditLimitAIDeltaPct: r.proposed_ai_delta == null ? null : Number(r.proposed_ai_delta),
    proposedCreditLimitReason: (r.proposed_reason ?? {}) as ProposedCreditLimitReason,
  };
}

export async function loadFromConnectwave(): Promise<RawAppData> {
  const sb = getConnectwaveSupabase();
  const [custRows, invRows, metaRes, groupRows, tagRows] = await Promise.all([
    fetchAll<CustSnap>(() => sb.from("collection_customer_snapshot").select("*")),
    fetchAll<InvSnap>(() => sb.from("collection_invoice_snapshot").select("*")),
    sb.from("collection_meta").select("*").maybeSingle(),
    fetchAll<{ tally_name: string; group_name: string }>(() => sb.from("ext_ledger_group").select("tally_name,group_name")),
    fetchAll<{ ledger_id: string; salesperson: string | null; category: string | null }>(
      () => sb.from("ext_ledger_tags").select("ledger_id,salesperson,category")),
  ]);

  // Musters are read LIVE (small, editable) and applied over the snapshot by ledger GUID, so a
  // salesperson/category edit reflects on the next load without waiting for a full refresh.
  const tagByGuid = new Map(tagRows.map((t) => [t.ledger_id, t]));
  const cust = custRows.map(toCustomer).map((c) => {
    const t = tagByGuid.get(c.id);
    if (!t) return c;
    return { ...c, salesPerson: t.salesperson ?? c.salesPerson, category: t.category ?? c.category };
  });
  const monthLabel = custRows[0]?.month_label ?? "";

  // Per-customer detail: open invoices + a single current-month trend row.
  const inv: Record<string, CustomerDetail> = {};
  const ensure = (id: string): CustomerDetail =>
    (inv[id] ??= { invoices: [], trend: [], receiptTransactions: [], otherPaymentTransactions: [], creditNoteTransactions: [], debitNoteTransactions: [], journalTransactions: [] });

  for (const b of invRows) {
    const overdueDays = Number(b.overdue_days) || 0;
    ensure(b.ledger_id).invoices.push({
      id: `${b.ledger_id}:${b.bill_ref}`,
      number: b.bill_ref,
      billRefName: b.bill_ref,
      billType: "New Ref",
      date: ymdToIso(b.bill_date),
      amount: Number(b.amount) || 0,
      receiptAdj: 0, creditNoteAdj: 0, debitNoteAdj: 0, journalAdj: 0, otherPaymentAdj: 0,
      pending: Number(b.pending) || 0,
      dueDate: ymdToIso(b.due_date),
      overdueDays,
      status: overdueDays > 0 ? "overdue" : "pending",
      voucherType: toSaleType(b.sale_type),
      isCarryforward: !!b.is_opening,
    } as Invoice);
  }

  // Full per-month trend per customer, built from the `monthly` jsonb (amounts in LAKHS — the
  // report ×100k them). This powers the Month selector, Sales(prev)/Collection%(prev), and the
  // month-wise panel. The CURRENT month still reads live figures (c.outstanding/overdue) in the
  // main table; these trend rows feed month selection + the analysis panel.
  const dashAgg = new Map<string, { sales: number; receipts: number; outstanding: number }>();
  for (const r of custRows) {
    const m = r.monthly && typeof r.monthly === "object" ? r.monthly : {};
    const creditLimit = Number(r.credit_limit) || 0;
    const rows: MonthlyTrend[] = Object.entries(m).map(([month, v]: [string, any]) => {
      const s = Number(v?.s || 0) / LAKH, rc = Number(v?.r || 0) / LAKH;
      const o = Number(v?.o || 0) / LAKH, od = Number(v?.od || 0) / LAKH;
      const agg = dashAgg.get(month) ?? { sales: 0, receipts: 0, outstanding: 0 };
      agg.sales += s; agg.receipts += rc; agg.outstanding += o; dashAgg.set(month, agg);
      // Per-month risk is APPROXIMATE for history: we only have the month-end outstanding + an
      // approximate overdue, not the exact per-month max-overdue-days. Derive the band from
      // utilization (o vs credit limit); the CURRENT month is overridden by live data in the
      // month-on-month charts, so this only shades historical months.
      const utilM = creditLimit > 0 ? o * LAKH / creditLimit * 100 : 0;
      return {
        month, sales: s, receipts: rc,
        creditNotes: 0, debitNotes: 0, journalAdjustments: 0, checkReturns: 0,
        outstanding: o, overdue: od, maxOverdueDays: 0, risk: categorizeRisk(0, utilM),
        outstandingByType: emptyTypeRec(), maxOverdueDaysByType: {} as any, salesByType: emptyTypeRec(),
      } as MonthlyTrend;
    }).sort((a, b) => monthOrd(a.month) - monthOrd(b.month));
    ensure(r.ledger_id).trend = rows;
  }

  const grpMapping: Record<string, string> = {};
  const grpGroups: Record<string, string[]> = {};
  for (const g of groupRows) {
    grpMapping[g.tally_name] = g.group_name;
    (grpGroups[g.group_name] ??= []).push(g.tally_name);
  }

  const asOf = (metaRes.data as any)?.as_of_date ?? "";
  const refreshedAt = (metaRes.data as any)?.refreshed_at ?? "";
  // Dashboard trend = the month list (drives the Month selector) + org-wide totals per month.
  const trend: TrendPoint[] = [...dashAgg.entries()]
    .map(([month, v]) => ({ month, sales: v.sales, receipts: v.receipts, outstanding: v.outstanding }))
    .sort((a, b) => monthOrd(a.month) - monthOrd(b.month));
  // Ensure the current month is present even if no customer had activity/history for it.
  if (monthLabel && !trend.some((t) => t.month === monthLabel)) {
    trend.push({ month: monthLabel, sales: 0, receipts: 0, outstanding: 0 });
    trend.sort((a, b) => monthOrd(a.month) - monthOrd(b.month));
  }

  const dash = {
    asOfDate: asOf,
    lastUpdated: refreshedAt,
    trend,
    kpis: {} as any,
    riskTrend: [], aging: [], riskSegmentation: [], topRiskyCustomers: [], alerts: [],
  } as unknown as DashboardData;

  return { dash, cust, inv, grp: { mapping: grpMapping, groups: grpGroups } };
}

// ── On-demand per-customer transaction history (Customer Detail tabs) ─────────────────────────
// The snapshot deliberately does NOT carry every customer's full transaction list (it would bloat
// the bulk load for data only ever viewed one customer at a time). Instead the Customer Detail page
// fetches the shown ledgers' streams lazily via the fast per-ledger RPC public.ledger_txn(), and we
// bucket them here into the receipt / credit-note / debit-note / journal arrays the tabs render.
// refInvoice + per-txn sale type are not exposed by ledger_txn (bill allocations aren't in it), so
// they're left null in v1 — the amounts, dates and voucher types are exact.
type TxnLists = Required<Pick<CustomerDetail,
  "receiptTransactions" | "creditNoteTransactions" | "debitNoteTransactions" | "journalTransactions">>;

interface LedgerTxnRow {
  vch_date: string | null; voucher_type: string | null; voucher_no: string | null;
  narration: string | null; amount: number | null; dr_cr: string | null;
}

/** Fetch + bucket transactions for a set of customer ledger GUIDs. Returns a map keyed by ledger id. */
export async function fetchConnectwaveLedgerTxns(ledgerIds: string[]): Promise<Record<string, TxnLists>> {
  const sb = getConnectwaveSupabase();
  const ids = [...new Set(ledgerIds)].filter(Boolean);
  const out: Record<string, TxnLists> = {};
  if (!ids.length) return out;

  // ledger_txn is keyed by (tenant_id, ledger NAME); resolve both from the snapshot by GUID.
  const { data: keyRows, error: keyErr } = await sb
    .from("collection_customer_snapshot")
    .select("tenant_id,ledger_id,name")
    .in("ledger_id", ids);
  if (keyErr) throw keyErr;

  await Promise.all((keyRows ?? []).map(async (k: any) => {
    const lists: TxnLists = { receiptTransactions: [], creditNoteTransactions: [], debitNoteTransactions: [], journalTransactions: [] };
    out[k.ledger_id] = lists;
    const { data, error } = await sb.rpc("ledger_txn", { p_tenant: k.tenant_id, p_ledger: k.name });
    if (error) throw error;
    for (const t of (data ?? []) as LedgerTxnRow[]) {
      const vt = (t.voucher_type ?? "").toUpperCase();
      const amt = Number(t.amount) || 0;
      const date = ymdToIso(t.vch_date) || null;
      const voucherNo = t.voucher_no ?? "";
      const narration = t.narration ?? "";
      if (vt.includes("RECEIPT") && amt < 0) {
        lists.receiptTransactions.push({ date, amount: -amt, type: t.voucher_type ?? "", refInvoice: null, saleType: null });
      } else if (vt.includes("CREDIT NOTE") && amt < 0) {
        lists.creditNoteTransactions.push({ date: date ?? "", voucherNo, amount: -amt, refInvoice: null, narration, saleType: null });
      } else if (vt.includes("DEBIT NOTE") && amt > 0) {
        lists.debitNoteTransactions.push({ date: date ?? "", voucherNo, amount: amt, refInvoice: null, narration, saleType: null });
      } else if (vt.includes("JOURNAL")) {
        lists.journalTransactions.push({
          date: date ?? "", voucherNo, amount: Math.abs(amt),
          type: amt >= 0 ? "Dr" : "Cr", signedAmount: amt, refInvoice: null, narration, saleType: null,
        });
      }
    }
  }));
  return out;
}
