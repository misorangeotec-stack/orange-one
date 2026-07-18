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
import { applyOtherPaymentsToLive } from "./liveOtherPayments";
import { fetchCompanyMap, makeCompanyResolver, type CompanyIdentity } from "./companyMap";
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

/** Coerce the snapshot's aging_buckets_by_type jsonb ({sale_type: {bucket: amount}}) into a full
 *  Record<SaleType, AgingBuckets> (rupees). Unknown sale types fold into 'other'. */
function toAgingByType(j: any): Record<SaleType, AgingBuckets> {
  const out = {
    ink: EMPTY_AGING(), spare_parts: EMPTY_AGING(), machine: EMPTY_AGING(),
    head: EMPTY_AGING(), other: EMPTY_AGING(),
  } as Record<SaleType, AgingBuckets>;
  if (j && typeof j === "object") {
    for (const [t, buckets] of Object.entries(j)) {
      const key = (SALE_TYPES as string[]).includes(t) ? (t as SaleType) : "other";
      if (buckets && typeof buckets === "object")
        for (const b of Object.keys(out[key]) as (keyof AgingBuckets)[])
          out[key][b] += Number((buckets as any)[b]) || 0;
    }
  }
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

/**
 * FY suffix (from useFY(): "" | "_fy2526" | "_fy2627") → inclusive [min,max] month-ordinal window,
 * or null for "Both FYs" (all months). This lets the Live path be FY-scoped exactly like the pipeline
 * partitions (fy2526/fy2627/default) — see supabaseFetcher.fySuffixToFy. An Indian FY runs Apr→Mar,
 * so FY 25-26 = Apr-25…Mar-26 and FY 26-27 = Apr-26…Mar-27 (ordinal = (2000+yy)*12 + monthIndex).
 */
function fyWindow(fySuffix: string): { min: number; max: number } | null {
  if (fySuffix === "_fy2526") return { min: 2025 * 12 + MONTH_ABBR.Apr, max: 2026 * 12 + MONTH_ABBR.Mar };
  if (fySuffix === "_fy2627") return { min: 2026 * 12 + MONTH_ABBR.Apr, max: 2027 * 12 + MONTH_ABBR.Mar };
  return null;
}
/** Is a month label ("Apr-25") inside the selected FY window? (Both FYs → always true.) */
function inFy(label: string, w: { min: number; max: number } | null): boolean {
  if (!w) return true;
  const o = monthOrd(label);
  return o >= w.min && o <= w.max;
}

interface RawAppData {
  dash: DashboardData;
  cust: Customer[];
  inv: Record<string, CustomerDetail>;
  grp: CustomerGroupMap;
}

/**
 * Page through a table with .range(). `orderBy` MUST name a UNIQUE key.
 *
 * Postgres guarantees no row order without an ORDER BY, so an unordered .range() walk can
 * hand back the same row on two pages and silently drop another. This is not theoretical:
 * see supabaseFetcher.fetchAllRows, where exactly this bug duplicated 2,064 customer_trend
 * rows and inflated receipts ₹355.72cr → ₹402.76cr (13-Jul-2026). Both collection_* snapshots
 * are already well past PAGE (1,802 and 5,435 rows), so this is load-bearing, not defensive.
 * A non-unique key is not enough — ties are broken arbitrarily and reintroduce the bug.
 */
async function fetchAll<T>(makeQuery: () => any, orderBy: string[]): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = makeQuery();
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
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
  // { 'Apr-25': { s, r, o, od, st, rt, oa }, ... } — rupees.
  // st/rt = that month's sales/receipts split by sale type; oa = on-account receipts (2026-07-17).
  monthly: any;
  // Receipts / credit notes split by the sale type of the BILL each settled. Σ == fy_receipts /
  // credit_notes exactly (collection_refresh folds any unallocated remainder into 'other'), so
  // these can be summed directly without undercounting.
  receipts_by_type: any; credit_notes_by_type: any; aging_buckets_by_type: any;
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

function toCustomer(r: CustSnap, identity: CompanyIdentity): Customer {
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
    // The finance-facing pair from ext_company_map (see companyMap.ts), NOT the raw Tally book name
    // and NOT the snapshot's location (which is '' for every row). This is the chokepoint: every
    // consumer — the Company/Location filters on every report, useAppData's filters, the
    // `name|||company|||location` group keys, the Excel exports — reads these two fields, so
    // resolving here fixes them all at once and makes Live match the pipeline exactly.
    company: identity.company,
    location: identity.location,
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
    agingBucketsByType: toAgingByType(r.aging_buckets_by_type),
    // sales_by_type is now the FY mix (collection_refresh 2026-07-17). It used to be CURRENT-MONTH
    // only, which quietly made a customer with no sales this month look like it had no sales mix.
    salesByType: toTypeRecord(r.sales_by_type),
    receiptsByType: toTypeRecord(r.receipts_by_type),
    creditNotesByType: toTypeRecord(r.credit_notes_by_type),
    outstandingByType: toTypeRecord(r.outstanding_by_type),
    overdueByType: toTypeRecord(r.overdue_by_type),
    // Opening balance by sale type is NOT derivable from the mirror with the pipeline's meaning
    // (the pipeline splits the source-true opening; the mirror only knows which opening BILLS are
    // still open). Left zeroed deliberately rather than filled with a differently-defined number —
    // this report never reads it. See the parity plan.
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

export async function loadFromConnectwave(fySuffix: string = ""): Promise<RawAppData> {
  const w = fyWindow(fySuffix);
  const sb = getConnectwaveSupabase();
  // Each order key below is that table's PRIMARY key — the uniqueness fetchAll requires.
  // (ext_ledger_group is keyed by ledger_id, NOT tally_name: 387 names repeat across companies.)
  const [custRows, invRows, metaRes, groupRows, tagRows, companyRows, ledgerGroupRows] = await Promise.all([
    fetchAll<CustSnap>(() => sb.from("collection_customer_snapshot").select("*"), ["tenant_id", "ledger_id"]),
    fetchAll<InvSnap>(() => sb.from("collection_invoice_snapshot").select("*"), ["tenant_id", "ledger_id", "bill_ref"]),
    sb.from("collection_meta").select("*").maybeSingle(),
    fetchAll<{ ledger_id: string; tally_name: string; group_name: string }>(
      () => sb.from("ext_ledger_group").select("ledger_id,tally_name,group_name"), ["ledger_id"]),
    fetchAll<{ ledger_id: string; salesperson: string | null; category: string | null }>(
      () => sb.from("ext_ledger_tags").select("ledger_id,salesperson,category"), ["ledger_id"]),
    fetchCompanyMap(),
    // The ledger's Tally parent group, so the report can SAY why a balance is a credit
    // ("MACHINE DEBTORS" = machine advance, "BALANCE WITH RELATED PARTY(Debtors)" = group company)
    // instead of showing an unexplained negative. Straight from Tally masters — no list of ours.
    // Filtered server-side to debtors: the unfiltered view is 9,217 rows, this slice is ~2,169.
    fetchAll<{ guid: string; sub_group: string | null }>(
      () => sb.from("v_ledger_detail").select("guid,sub_group").contains("group_chain", ["Sundry Debtors"]),
      ["guid"]),
  ]);

  // Musters are read LIVE (small, editable) and applied over the snapshot by ledger GUID, so a
  // salesperson/category edit reflects on the next load without waiting for a full refresh.
  const resolveCompany = makeCompanyResolver(companyRows);
  const tagByGuid = new Map(tagRows.map((t) => [t.ledger_id, t]));
  const tallyGroupByGuid = new Map(ledgerGroupRows.map((g) => [g.guid, g.sub_group ?? undefined]));
  const cust = custRows.map((r) => toCustomer(r, resolveCompany(r.tenant_id, r.company))).map((c) => {
    const tallyGroup = tallyGroupByGuid.get(c.id);
    const t = tagByGuid.get(c.id);
    if (!t) return tallyGroup ? { ...c, tallyGroup } : c;
    return { ...c, tallyGroup, salesPerson: t.salesperson ?? c.salesPerson, category: t.category ?? c.category };
  });
  // The as-of month comes from collection_meta (the authoritative stamp collection_refresh()
  // writes), not from an arbitrary snapshot row — row 0 of an unordered fetch is whatever the
  // planner happened to return, and it decides the report's current-month branch.
  const monthLabel = (metaRes.data as any)?.month_label ?? custRows[0]?.month_label ?? "";
  // NEVER surface a month later than the as-of month. collection_refresh derives part of the
  // `monthly` key set from bills' DUE dates, so a machine bill due in 2034 mints a 'Oct-34' key —
  // the mirror legitimately knows about future due dates, but they are not HISTORY and must not
  // become selectable months. This is not cosmetic: the report takes the LAST month as its as-of
  // month (SalespersonCollectionReport: `asOfMonth = months[months.length - 1]`), so future keys
  // made asOfMonth 'Mar-27'/'Oct-34' instead of 'Jul-26' — which silently pushed the CURRENT month
  // onto the historical branch (Outstanding read from the trend snapshot instead of live Tally,
  // invoice drill-downs disabled, "(current)" on the wrong month).
  const maxOrd = monthLabel ? monthOrd(monthLabel) : Number.MAX_SAFE_INTEGER;

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
  // FY-windowed sales/receipts (RUPEES) per ledger, summed from the months kept below. When a single
  // FY is selected these override the all-period fy_sales/fy_receipts so BOTH sides share the FY window
  // (the mirror carries all-year receipts but only current-FY sales, so an unscoped comparison is what
  // made receipts look inflated). "Both FYs" keeps fy_sales/fy_receipts (already the full-period total).
  const fyTotals = new Map<string, { sales: number; receipts: number }>();
  for (const r of custRows) {
    const m = r.monthly && typeof r.monthly === "object" ? r.monthly : {};
    const creditLimit = Number(r.credit_limit) || 0;
    let fySalesR = 0, fyRcptR = 0;
    const rows: MonthlyTrend[] = Object.entries(m)
      .filter(([month]) => inFy(month, w) && monthOrd(month) <= maxOrd)
      .map(([month, v]: [string, any]) => {
      const sR = Number(v?.s || 0), rR = Number(v?.r || 0);
      fySalesR += sR; fyRcptR += rR;
      const s = sR / LAKH, rc = rR / LAKH;
      const o = Number(v?.o || 0) / LAKH, od = Number(v?.od || 0) / LAKH;
      const agg = dashAgg.get(month) ?? { sales: 0, receipts: 0, outstanding: 0 };
      agg.sales += s; agg.receipts += rc; agg.outstanding += o; dashAgg.set(month, agg);
      // Per-month risk is APPROXIMATE for history: we only have the month-end outstanding + an
      // approximate overdue, not the exact per-month max-overdue-days. Derive the band from
      // utilization (o vs credit limit); the CURRENT month is overridden by live data in the
      // month-on-month charts, so this only shades historical months.
      const utilM = creditLimit > 0 ? o * LAKH / creditLimit * 100 : 0;
      // NOTE ON EMPTY BREAKDOWNS — the rule is: OMIT what we don't know, never send zeros.
      // MonthlyTrend.salesByType/receiptsByType are optional precisely so a snapshot that lacks
      // them can let the report fall back to its sales-mix estimate. An all-zeros record is
      // TRUTHY, so sending one makes the report believe the real per-type split IS zero — that is
      // what rendered Sales as ₹0 for every row under a sale-type filter. collection_refresh now
      // emits the real per-month splits ('st'/'rt', rupees), so pass them through — but only when
      // actually present, so an older snapshot still degrades to the estimate instead of to zero.
      const st = v?.st && Object.keys(v.st).length ? toTypeRecord(v.st, 1 / LAKH) : undefined;
      const rt = v?.rt && Object.keys(v.rt).length ? toTypeRecord(v.rt, 1 / LAKH) : undefined;
      // GST contained in this month's sales (sales are booked INCLUSIVE of GST). Only present on
      // snapshots built after collection_refresh started emitting 'g' — key off `'g' in v`, NOT the
      // value, so a genuine zero-GST month (an export invoice) still reports "GST ₹0" instead of
      // silently degrading to "no breakup available".
      const hasG = v && typeof v === "object" && "g" in v;
      const gt = v?.gt && Object.keys(v.gt).length ? toTypeRecord(v.gt, 1 / LAKH) : undefined;
      return {
        month, sales: s, receipts: rc,
        creditNotes: 0, debitNotes: 0, journalAdjustments: 0, checkReturns: 0,
        outstanding: o, overdue: od, maxOverdueDays: 0, risk: categorizeRisk(0, utilM),
        outstandingByType: emptyTypeRec(), maxOverdueDaysByType: {} as any,
        ...(st ? { salesByType: st } : {}),
        ...(rt ? { receiptsByType: rt } : {}),
        ...(hasG ? { salesGst: Number(v.g || 0) / LAKH } : {}),
        ...(gt ? { salesGstByType: gt } : {}),
      } as MonthlyTrend;
    }).sort((a, b) => monthOrd(a.month) - monthOrd(b.month));
    ensure(r.ledger_id).trend = rows;
    fyTotals.set(r.ledger_id, { sales: fySalesR, receipts: fyRcptR });
  }
  // Scope each customer's headline sales/receipts to the selected FY (Both FYs = leave the full total).
  if (w) {
    for (const c of cust) {
      const t = fyTotals.get(c.id);
      if (t) { c.sales = t.sales; c.receipts = t.receipts; }
    }
  }

  // The muster is keyed by ledger GUID — that is the ONLY stable identity. `grpMapping`
  // (name → group) is derived from it for the consumers that are still name-based, and for the
  // group option lists. Deriving it is lossy by nature: 387 ledger names repeat across companies
  // and can legitimately carry different groups, so the last writer used to win silently. We now
  // resolve deterministically (first by ledger_id order, which fetchAll already sorts) and count
  // the conflicts, so the remaining name-keyed reads are visible rather than invisible.
  const grpByLedgerId: Record<string, string> = {};
  const grpMapping: Record<string, string> = {};
  const grpGroups: Record<string, string[]> = {};
  const grpConflicts: string[] = [];
  for (const g of groupRows) {
    if (g.ledger_id) grpByLedgerId[g.ledger_id] = g.group_name;
    const name = g.tally_name;
    if (!name) continue;
    const seen = grpMapping[name];
    if (seen === undefined) {
      grpMapping[name] = g.group_name;
      (grpGroups[g.group_name] ??= []).push(name);
    } else if (seen !== g.group_name) {
      grpConflicts.push(`${name}: "${seen}" vs "${g.group_name}"`);
    }
  }
  if (grpConflicts.length) {
    console.warn(
      `[connectwave] ${grpConflicts.length} ledger name(s) carry different groups in different ` +
      `companies; the name-keyed view kept the first. Resolve via byLedgerId. Examples: ` +
      grpConflicts.slice(0, 5).join(" | "),
    );
  }

  const asOf = (metaRes.data as any)?.as_of_date ?? "";
  const refreshedAt = (metaRes.data as any)?.refreshed_at ?? "";
  // Dashboard trend = the month list (drives the Month selector) + org-wide totals per month.
  const trend: TrendPoint[] = [...dashAgg.entries()]
    .map(([month, v]) => ({ month, sales: v.sales, receipts: v.receipts, outstanding: v.outstanding }))
    .sort((a, b) => monthOrd(a.month) - monthOrd(b.month));
  // Ensure the current month is present even if no customer had activity/history for it — but only when
  // it falls inside the selected FY (else a past-FY view would sprout a stray current-month column).
  if (monthLabel && inFy(monthLabel, w) && !trend.some((t) => t.month === monthLabel)) {
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

  // Tally never saw the manual Other Payments, so the snapshot doesn't either — net them in here
  // (same waterfall as the pipeline) so Live and pipeline mode agree on outstanding AND overdue.
  // LOG the total: this return value used to be discarded, which is exactly why the netting could
  // silently apply nothing (see the 1000-row story in liveOtherPayments' header) while the report
  // tied to a Tally export to the rupee and looked perfectly healthy. A ₹0 here is the symptom.
  const opApplied = await applyOtherPaymentsToLive(cust, inv);
  console.info(
    `[liveOtherPayments] applied ₹${opApplied.toLocaleString("en-IN")} across ` +
    `${cust.filter((c) => (c.otherPayments ?? 0) > 0).length} customers`,
  );

  return { dash, cust, inv, grp: { byLedgerId: grpByLedgerId, mapping: grpMapping, groups: grpGroups } };
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
