/**
 * prove-category-engine.ts — the gate for lib/customerCategory.ts.
 *
 * Imports the REAL engine functions (no reimplementation) and runs them against the LIVE
 * receivables Supabase, asserting they reproduce the values measured during planning. If this
 * is red, the engine is wrong and no UI gets built on top of it.
 *
 * READ-ONLY. Run:  npx esbuild scripts/prove-category-engine.ts --bundle --platform=node \
 *                    --format=esm --outfile=<tmp>.mjs  &&  node <tmp>.mjs
 */
import fs from "node:fs";

import {
  buildMonthlySeries, buildLedgerBalances, buildLastReceiptDates, buildOutstandingByType,
  resolveWindow, priorWindow,
} from "../src/apps/receivables-hub/lib/collections";
import { enumerateBills } from "../src/apps/receivables-hub/lib/agingReport";
import { buildGroupTree } from "../src/apps/receivables-hub/lib/groupTree";
import {
  buildBucketsByLedger, buildCCRows, ccTotalsOf, makeCCMetricsOf, addCCMetrics, emptyCCMetrics,
  ccDimValue, mismatchOf, isActive, isDormantLedger, buildCategoryMatrix,
  TIER_ORDER, DEFAULT_MISMATCH_GAP,
  type CCRow, type CCMetrics, type Tier,
} from "../src/apps/receivables-hub/lib/customerCategory";
import type {
  Customer, ConsolidatedCustomer, CustomerDetail, Invoice, MonthlyTrend, SaleType,
} from "../src/apps/receivables-hub/lib/types";

/* ── live read ───────────────────────────────────────────────────────────────────────── */

const env = Object.fromEntries(
  fs.readFileSync("frontend/.env.local", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
) as Record<string, string>;

const URL = env.VITE_RECEIVABLES_SUPABASE_URL;
const KEY = env.VITE_RECEIVABLES_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const FY = "default"; // = "Both FYs" (fySuffixToFy("") === "default")

/**
 * Paginate under a STABLE TOTAL ORDER — the same discipline supabaseFetcher::fetchAllRows now
 * enforces. Without the `order`, Postgres is free to reshuffle between pages: measured, one run
 * in four returned 2,064 duplicate customer_trend rows and dropped 2,064 others, moving total
 * receipts by 13%. An unordered harness would "prove" a different number every run.
 */
async function page<T>(table: string, cols: string, order: string): Promise<T[]> {
  let out: T[] = [], from = 0;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${table}?select=${cols}&fiscal_year=eq.${FY}&order=${order}`,
      { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
    const b = (await r.json()) as T[];
    out = out.concat(b);
    if (b.length < 1000) break;
    from += 1000;
  }
  return out;
}

const money = (n: number) =>
  Math.abs(n) >= 1e7 ? `Rs${(n / 1e7).toFixed(2)} Cr` : `Rs${(n / 1e5).toFixed(1)} L`;

console.log("Fetching live receivables (fiscal_year=default, read-only)...");
const [cRows, tRows, rRows, oRows, iRows, dRows, mRows, gRows] = await Promise.all([
  page<any>("customers", "*", "id.asc"),
  page<any>("customer_trend", "*", "customer_id.asc,month.asc"),
  page<any>("receipt_transactions", "*", "id.asc"),
  page<any>("other_payment_transactions", "*", "id.asc"),
  page<any>("invoices", "*", "pk.asc"),
  page<any>("dashboard_trend", "month,sales", "month.asc"),
  page<any>("dashboard_meta", "as_of_date", "as_of_date.asc"),
  (async () => {
    let out: any[] = [], from = 0;
    for (;;) {
      const r = await fetch(`${URL}/rest/v1/customer_groups?select=tally_name,group_name&order=tally_name.asc`,
        { headers: { ...H, Range: `${from}-${from + 999}` } });
      const b = (await r.json()) as any[];
      out = out.concat(b);
      if (b.length < 1000) break;
      from += 1000;
    }
    return out;
  })(),
]);

const asOfDate: string = mRows[0]?.as_of_date ?? new Date().toISOString().slice(0, 10);
console.log(`  customers=${cRows.length} trend=${tRows.length} receipts=${rRows.length} ` +
            `otherPay=${oRows.length} invoices=${iRows.length}  as-of=${asOfDate}\n`);

/* ── map into the app's real shapes (mirrors supabaseFetcher.toCustomer) ─────────────── */

const ledgers: Customer[] = cRows.map((c) => ({
  id: c.id, name: c.name, company: c.company, location: c.location,
  salesPerson: c.sales_person ?? "", category: c.category ?? "",
  creditPeriod: c.credit_period ?? 0, creditLimit: c.credit_limit ?? 0,
  blocked: c.credit_limit === 1,
  openingBalance: c.opening_balance ?? 0, openingDrCr: (c.opening_balance ?? 0) >= 0 ? "Dr" : "Cr",
  remainingOpeningBalance: c.remaining_opening_balance ?? 0,
  obReceiptsApplied: c.ob_receipts_applied ?? 0, obCreditNotesApplied: c.ob_credit_notes_applied ?? 0,
  advanceBalance: c.advance_balance ?? 0, advanceBreakdown: c.advance_breakdown ?? {},
  sales: c.sales ?? 0, receipts: c.receipts ?? 0, otherPayments: c.other_payments ?? 0,
  creditNotes: c.credit_notes ?? 0, debitNotes: c.debit_notes ?? 0,
  journalDr: c.journal_dr ?? 0, journalCr: c.journal_cr ?? 0,
  journalAdjustments: c.journal_adjustments ?? 0, checkReturns: c.check_returns ?? 0,
  openingBalanceAdjustment: 0,
  outstanding: c.outstanding ?? 0, overdue: c.overdue ?? 0,
  maxOverdueDays: c.max_overdue_days ?? 0, utilization: c.utilization ?? 0, risk: c.risk ?? "low",
  agingBuckets: c.aging_buckets ?? {}, agingBucketsByType: c.aging_buckets_by_type ?? {},
  salesByType: c.sales_by_type ?? {}, receiptsByType: c.receipts_by_type ?? {},
  creditNotesByType: c.credit_notes_by_type ?? {}, debitNotesByType: c.debit_notes_by_type ?? {},
  journalByType: c.journal_by_type ?? {}, outstandingByType: c.outstanding_by_type ?? {},
  overdueByType: c.overdue_by_type ?? {}, openingBalanceByType: c.opening_balance_by_type ?? {},
  // The known pipeline nulls — exactly as supabaseFetcher leaves them.
  lastReceiptDate: null, daysSinceLastReceipt: null,
  receipts1M: 0, receipts3M: c.receipts_3m ?? 0, receipts6M: 0, monthlyReceipts: {},
  consecutiveNoPaymentMonths: 0, paymentActiveMonths: 0,
} as unknown as Customer));

const detail: Record<string, CustomerDetail> = {};
const D = (id: string): CustomerDetail => (detail[id] ??= {
  receiptTransactions: [], otherPaymentTransactions: [], invoices: [], trend: [],
} as unknown as CustomerDetail);
for (const c of ledgers) D(c.id);

for (const t of tRows) {
  D(t.customer_id).trend.push({
    month: t.month, sales: t.sales ?? 0, receipts: t.receipts ?? 0,
    creditNotes: t.credit_notes ?? 0, debitNotes: t.debit_notes ?? 0,
    journalAdjustments: t.journal_adjustments ?? 0, checkReturns: t.check_returns ?? 0,
    outstanding: t.outstanding ?? 0, overdue: t.overdue ?? 0,
    maxOverdueDays: t.max_overdue_days ?? 0, risk: t.risk ?? "low",
    outstandingByType: t.outstanding_by_type ?? {},
  } as unknown as MonthlyTrend);
}
for (const r of rRows) {
  D(r.customer_id).receiptTransactions.push({
    date: r.date, amount: r.amount ?? 0, type: r.type ?? "", refInvoice: r.ref_invoice ?? "",
    saleType: r.sale_type ?? undefined,
  } as any);
}
for (const o of oRows) {
  (D(o.customer_id).otherPaymentTransactions ??= []).push({
    date: o.date, amount: o.amount ?? 0, type: o.type ?? "", refInvoice: o.ref_invoice ?? "",
    paymentRef: o.payment_ref ?? "", remark: o.remark ?? "",
  } as any);
}
for (const i of iRows) {
  D(i.customer_id).invoices.push({
    id: i.id, number: i.number ?? "", billRefName: "", billType: "",
    date: i.date, amount: i.amount ?? 0,
    receiptAdj: i.receipt_adj ?? 0, creditNoteAdj: 0, debitNoteAdj: 0, journalAdj: 0,
    otherPaymentAdj: i.other_payment_adj ?? 0,
    pending: i.pending ?? 0, dueDate: i.due_date ?? "", overdueDays: i.overdue_days ?? 0,
    status: i.status ?? "pending", voucherType: (i.voucher_type ?? "other") as SaleType,
    isCarryforward: false,
  } as unknown as Invoice);
}

const groupMapping: Record<string, string> = {};
for (const g of gRows ?? []) if (g?.tally_name) groupMapping[g.tally_name] = g.group_name;

/* ── consolidateByName (keyed on name alone — useAppData.ts:24-29) ───────────────────── */

const byName = new Map<string, Customer[]>();
for (const c of ledgers) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name)!.push(c);
}
const consolidated: ConsolidatedCustomer[] = [...byName.values()].map((es) => ({
  ...es[0],
  outstanding: es.reduce((s, c) => s + (c.outstanding ?? 0), 0),
  creditLimit: Math.max(...es.map((c) => c.creditLimit ?? 0)),
  maxOverdueDays: Math.max(...es.map((c) => c.maxOverdueDays ?? 0)),
  constituentIds: es.map((c) => c.id),
  companies: [...new Set(es.map((c) => c.company))],
  locations: [...new Set(es.map((c) => c.location))],
  salesPersons: [...new Set(es.map((c) => c.salesPerson).filter(Boolean))],
  categories: [...new Set(es.map((c) => c.category).filter(Boolean))],
} as unknown as ConsolidatedCustomer));

/* ── run the REAL engine ─────────────────────────────────────────────────────────────── */

// CHRONOLOGICAL, not alphabetical. `order=month.asc` in SQL gives Apr-25, Apr-26, Aug-25, … —
// which is why supabaseFetcher sorts client-side too. resolveWindow("fy") slices from the LAST
// "Apr-", so an alphabetical month list silently selects the wrong window.
const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
const chrono = (m: string) => {
  const [mon, yy] = m.split("-");
  return (2000 + Number(yy)) * 12 + (MONTH_IDX[mon] ?? 0);
};
const months = [...new Set(dRows.map((d) => d.month as string))].sort((a, b) => chrono(a) - chrono(b));
const window = resolveWindow(months, "fy");
const prior = priorWindow(months, window);
console.log(`months: ${months[0]} .. ${months[months.length - 1]} (${months.length}) | ` +
            `This-FY window: ${window[0]} .. ${window[window.length - 1]} (${window.length})\n`);

const series = buildMonthlySeries(ledgers, detail, "pipeline");
const lastDates = buildLastReceiptDates(ledgers, detail, "pipeline");
const balances = buildLedgerBalances(ledgers);
const obt = buildOutstandingByType(ledgers);
const bills = enumerateBills(ledgers, detail, asOfDate, {}, groupMapping);
const bucketsByLedger = buildBucketsByLedger(bills);
const ledgerById = new Map(ledgers.map((c) => [c.id, c]));

const rows: CCRow[] = buildCCRows({
  customers: consolidated, ledgerById, bucketsByLedger, outstandingByType: obt,
  series, lastDates, balances, months, windowMonths: window, priorMonths: prior,
  asOfDate, scopeIds: null,
  groupOf: (c) => groupMapping[c.name] || c.name,
});

const GAP = DEFAULT_MISMATCH_GAP;
const total = ccTotalsOf(rows, GAP);

/* ── assertions ──────────────────────────────────────────────────────────────────────── */

let pass = 0, fail = 0;
const near = (a: number, b: number, tolPct = 1.5) =>
  Math.abs(b) < 1 ? Math.abs(a) < 1 : Math.abs((a - b) / b) * 100 <= tolPct;

function check(n: number, name: string, actual: string, ok: boolean, expected: string) {
  if (ok) { pass++; console.log(`  PASS  ${String(n).padStart(2)}. ${name.padEnd(46)} ${actual}`); }
  else { fail++; console.log(`  FAIL  ${String(n).padStart(2)}. ${name.padEnd(46)} ${actual}   expected ${expected}`); }
}

console.log("═══ ORACLE ═══");

// 1-2. Owed + Advances = Net, and Net ties to the Dashboard.
check(1, "Net ties to Dashboard Total Outstanding", money(total.net),
  near(total.net, 54.03e7), "~Rs54.03 Cr");
check(2, "Owed + Advances === Net (exactly)",
  `${money(total.owed)} + (${money(total.advances)}) = ${money(total.owed + total.advances)}`,
  Math.abs(total.owed + total.advances - total.net) < 1, "identity");
check(3, "Owed", money(total.owed), near(total.owed, 67.96e7), "~Rs67.96 Cr");
check(4, "Advances", money(total.advances), near(total.advances, -13.93e7), "~-Rs13.93 Cr");

// 5. Share-of-book sums to 100%, no negative share.
const tierTree = buildGroupTree<CCRow, CCMetrics>(rows, ["category"], {
  dimValue: ccDimValue, idOf: (r) => r.customer.id,
  metricsOf: makeCCMetricsOf(GAP), empty: emptyCCMetrics, add: addCCMetrics,
});
const shares = tierTree.roots.map((n) => ({
  tier: n.path[0].value as Tier,
  pct: (n.metrics.owed / total.owed) * 100,
  owed: n.metrics.owed, net: n.metrics.net, custs: n.metrics.customers,
}));
const shareSum = shares.reduce((s, x) => s + x.pct, 0);
const anyNeg = shares.some((x) => x.pct < 0);
check(5, "Sum(share of Owed) = 100%, none negative",
  `${shareSum.toFixed(1)}%, min=${Math.min(...shares.map((s) => s.pct)).toFixed(1)}%`,
  near(shareSum, 100, 0.1) && !anyNeg, "100%, no negative");

// 6. Bill-wise overdue / 180+.
check(6, "Overdue (bill-wise)", money(total.overdue), near(total.overdue, 38.00e7), "~Rs38.00 Cr");
check(7, "180+ (bill-wise)", money(total.od_180_plus), near(total.od_180_plus, 5.63e7), "~Rs5.63 Cr");

// 8. Bill-wise overdue reads ABOVE the ledger column (the disclosure).
const ledgerOverdue = ledgers.reduce((s, c) => s + (c.overdue ?? 0), 0);
const gapPct = ((total.overdue - ledgerOverdue) / ledgerOverdue) * 100;
check(8, "Overdue > Dashboard's (must be disclosed)",
  `${money(total.overdue)} vs ${money(ledgerOverdue)} = +${gapPct.toFixed(1)}%`,
  gapPct > 5 && gapPct < 11, "+7.8%");

// 9. Collection %.
const collPct = (total.collected / total.collectible) * 100;
check(9, "Grand Collection % (This FY)",
  `${collPct.toFixed(1)}%  (${money(total.collected)} / ${money(total.collectible)})`,
  near(collPct, 47.9, 3), "~47.9%");

// 10. Active vs dormant.
const active = rows.filter(isActive).length;
const dormant = rows.filter(isDormantLedger).length;
check(10, "Customers / active / dormant-ledger",
  `${rows.length} / ${active} active / ${dormant} never transacted`,
  rows.length === 1263 && near(dormant, 604, 3), "1263 / ~503 / ~604");

// 11. Behaviour quintiles: 5 buckets, ~equal, cleanly separated.
const scored = rows.filter((r) => r.grade !== null);
const q = (g: string) => scored.filter((r) => r.grade === g);
const avg = (rs: CCRow[], f: (r: CCRow) => number) => rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : 0;
const qA = q("A"), qE = q("E");
const sepOk =
  Math.abs(qA.length - qE.length) <= 2 &&
  avg(qA, (r) => r.maxOverdueDays) < 60 && avg(qE, (r) => r.maxOverdueDays) > 300 &&
  avg(qE, (r) => (r.buckets.od_180_plus / Math.max(1, r.owed)) * 100) > 50;
check(11, "Behaviour quintiles separate cleanly",
  `${scored.length} scored, 5x~${qA.length} | A:${avg(qA, (r) => r.maxOverdueDays).toFixed(0)}d 0%180+ ` +
  `| E:${avg(qE, (r) => r.maxOverdueDays).toFixed(0)}d ${avg(qE, (r) => (r.buckets.od_180_plus / Math.max(1, r.owed)) * 100).toFixed(0)}%180+`,
  sepOk, "A~30d/0%, E~421d/77%");

// 12. Mismatch sizing.
for (const gap of [2, 3]) {
  const over = rows.filter((r) => mismatchOf(r, gap) === "over_graded");
  const under = rows.filter((r) => mismatchOf(r, gap) === "under_graded");
  const owed = over.reduce((s, r) => s + r.owed, 0);
  const exp = gap === 2 ? { o: 108, u: 28 } : { o: 44, u: 13 };
  check(gap === 2 ? 12 : 13, `Mismatch gap>=${gap}`,
    `${over.length} over (${money(owed)}) / ${under.length} under`,
    near(over.length, exp.o, 20) && near(under.length, exp.u, 40),
    `~${exp.o} / ~${exp.u}`);
}

// 14. Non-oracle but must not throw: the matrix pivots.
const mx = buildCategoryMatrix(rows, "salesperson", "owed", GAP);
const mxSum = mx.rows.reduce((s, r) => s + r.total, 0);
check(14, "Matrix (Category x Salesperson) totals tie",
  `${mx.rows.length} tiers x ${mx.cols.length} cols, grand=${money(mx.grand)}`,
  near(mxSum, total.owed) && near(mx.grand, total.owed), "= Owed");

/* ── the scoreboard, for eyeballing ──────────────────────────────────────────────────── */

console.log("\n═══ THE SCOREBOARD (what the report will render) ═══");
console.log("tier            custs  active   Owed        Advances      Net      %book  Coll%  180+/owed  over-graded");
for (const t of TIER_ORDER) {
  const n = tierTree.roots.find((r) => (r.path[0].value as Tier) === t);
  if (!n) continue;
  const m = n.metrics;
  const cp = m.collectible > 0 ? ((m.collected / m.collectible) * 100).toFixed(0) + "%" : "-";
  const p180 = m.owed > 0 ? ((m.od_180_plus / m.owed) * 100).toFixed(0) + "%" : "-";
  console.log(
    `${t.padEnd(14)} ${String(m.customers).padStart(5)} ${String(m.active).padStart(7)}  ` +
    `${money(m.owed).padStart(11)} ${money(m.advances).padStart(12)} ${money(m.net).padStart(11)} ` +
    `${((m.owed / total.owed) * 100).toFixed(1).padStart(6)}% ${cp.padStart(6)} ${p180.padStart(9)} ` +
    `${String(m.overGraded).padStart(11)}`,
  );
}
console.log(
  `${"TOTAL".padEnd(14)} ${String(total.customers).padStart(5)} ${String(total.active).padStart(7)}  ` +
  `${money(total.owed).padStart(11)} ${money(total.advances).padStart(12)} ${money(total.net).padStart(11)} ` +
  `${"100.0%".padStart(7)} ${(((total.collected / total.collectible) * 100).toFixed(0) + "%").padStart(6)} ` +
  `${(((total.od_180_plus / total.owed) * 100).toFixed(0) + "%").padStart(9)} ${String(total.overGraded).padStart(11)}`,
);

console.log("\n═══ TOP TAG MISMATCHES (the export's worklist) ═══");
for (const r of rows.filter((x) => mismatchOf(x, GAP) === "over_graded")
  .sort((a, b) => b.owed - a.owed).slice(0, 8)) {
  console.log(`  ${r.tier} -> ${r.grade}  ${r.customer.name.slice(0, 38).padEnd(40)} ` +
    `owed=${money(r.owed).padStart(10)}  ${r.maxOverdueDays}d  ` +
    `${((r.buckets.od_180_plus / Math.max(1, r.owed)) * 100).toFixed(0)}% at 180+`);
}

console.log(`\n═══ ${fail === 0 ? "ALL GREEN" : "RED"} — ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
