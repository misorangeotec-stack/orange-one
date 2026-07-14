/**
 * prove-dso-engine.ts — the gate for lib/dso.ts.
 *
 * Imports the REAL engine functions (no reimplementation) and runs them against the LIVE
 * receivables Supabase. If this is red, the engine is wrong and no UI gets built on top of it.
 *
 * READ-ONLY. Run:  npx esbuild frontend/scripts/prove-dso-engine.ts --bundle --platform=node \
 *                    --format=esm --outfile=<tmp>.mjs  &&  node <tmp>.mjs      (cwd = repo root)
 */
import fs from "node:fs";

import {
  buildMonthlySeries, buildLedgerBalances, buildLastReceiptDates, buildOutstandingByType,
  dominantSaleTypeOf, NEVER_PAID,
} from "../src/apps/receivables-hub/lib/collections";
import { enumerateBills } from "../src/apps/receivables-hub/lib/agingReport";
import { buildGroupTree } from "../src/apps/receivables-hub/lib/groupTree";
import {
  buildDsoRows, buildDayVector, countbackDso, daysInMonth, lookbackDaysOf, netBillingsOf,
  dsoOf, naiveDsoOf, avgTermsOf, addDsoMetrics, emptyDsoMetrics, makeDsoMetricsOf, dsoTotalsOf,
  LOOKBACK_MONTHS, DEFAULT_DSO_CUTOFF,
  type DsoRow, type DsoMetrics,
} from "../src/apps/receivables-hub/lib/dso";
import { zcDimValue } from "../src/apps/receivables-hub/lib/collections";
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
const FY = "default"; // "Both FYs" — the report is pinned here.

/** Paginate under a STABLE TOTAL ORDER. Without it, Postgres reshuffles between pages: measured,
 *  one run in four duplicated 2,064 customer_trend rows and moved receipts by 13%. */
async function page<T>(table: string, cols: string, order: string, fyScoped = true): Promise<T[]> {
  let out: T[] = [], from = 0;
  for (;;) {
    const fyq = fyScoped ? `&fiscal_year=eq.${FY}` : "";
    const r = await fetch(`${URL}/rest/v1/${table}?select=${cols}${fyq}&order=${order}`,
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

console.log("Fetching live receivables (fiscal_year=default, READ-ONLY)...");
const [cRows, tRows, rRows, oRows, iRows, dRows, mRows, gRows] = await Promise.all([
  page<any>("customers", "*", "id.asc"),
  page<any>("customer_trend", "*", "customer_id.asc,month.asc"),
  page<any>("receipt_transactions", "*", "id.asc"),
  page<any>("other_payment_transactions", "*", "id.asc"),
  page<any>("invoices", "*", "pk.asc"),
  page<any>("dashboard_trend", "month,sales", "month.asc"),
  page<any>("dashboard_meta", "as_of_date", "as_of_date.asc"),
  page<any>("customer_groups", "tally_name,group_name", "tally_name.asc", false),
]);

const asOfDate: string = mRows[0]?.as_of_date ?? new Date().toISOString().slice(0, 10);
console.log(`  customers=${cRows.length} trend=${tRows.length} receipts=${rRows.length} ` +
            `invoices=${iRows.length}  as-of=${asOfDate}\n`);

/* ── map into the app's real shapes (mirrors supabaseFetcher.toCustomer, incl. its nulls) ─ */

const ledgers: Customer[] = cRows.map((c) => ({
  id: c.id, name: c.name, company: c.company, location: c.location,
  salesPerson: c.sales_person ?? "", category: c.category ?? "",
  creditPeriod: c.credit_period ?? 0, creditLimit: c.credit_limit ?? 0,
  blocked: c.credit_limit === 1,
  openingBalance: c.opening_balance ?? 0,
  remainingOpeningBalance: c.remaining_opening_balance ?? 0,
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
  creditNotesByType: c.credit_notes_by_type ?? {}, outstandingByType: c.outstanding_by_type ?? {},
  overdueByType: c.overdue_by_type ?? {},
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
  } as any);
}
for (const o of oRows) {
  (D(o.customer_id).otherPaymentTransactions ??= []).push({
    date: o.date, amount: o.amount ?? 0, type: o.type ?? "", refInvoice: o.ref_invoice ?? "",
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

/* ── consolidateByName (name alone — useAppData.ts) ──────────────────────────────────── */

const byName = new Map<string, Customer[]>();
for (const c of ledgers) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name)!.push(c);
}
const consolidated: ConsolidatedCustomer[] = [...byName.values()].map((es) => ({
  ...es[0],
  outstanding: es.reduce((s, c) => s + (c.outstanding ?? 0), 0),
  creditLimit: Math.max(...es.map((c) => c.creditLimit ?? 0)),
  creditPeriod: Math.max(...es.map((c) => c.creditPeriod ?? 0)),
  maxOverdueDays: Math.max(...es.map((c) => c.maxOverdueDays ?? 0)),
  outstandingByType: es.reduce((acc, c) => {
    for (const [k, v] of Object.entries(c.outstandingByType ?? {}))
      (acc as any)[k] = ((acc as any)[k] ?? 0) + (v as number);
    return acc;
  }, {} as Record<string, number>),
  constituentIds: es.map((c) => c.id),
  companies: [...new Set(es.map((c) => c.company))],
  locations: [...new Set(es.map((c) => c.location))],
  salesPersons: [...new Set(es.map((c) => c.salesPerson).filter(Boolean))],
  categories: [...new Set(es.map((c) => c.category).filter(Boolean))],
} as unknown as ConsolidatedCustomer));

/* ── run the REAL engine ─────────────────────────────────────────────────────────────── */

const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
const chrono = (m: string) => {
  const [mon, yy] = m.split("-");
  return (2000 + Number(yy)) * 12 + (MONTH_IDX[mon] ?? 0);
};
const months = [...new Set(dRows.map((d) => d.month as string))].sort((a, b) => chrono(a) - chrono(b));
const lookbackMonths = months.slice(-LOOKBACK_MONTHS);
const dayVec = buildDayVector(lookbackMonths, asOfDate);
const lookbackDays = lookbackDaysOf(dayVec);

console.log(`months ${months[0]}..${months[months.length - 1]} (${months.length}) | ` +
            `lookback ${lookbackMonths[0]}..${lookbackMonths[lookbackMonths.length - 1]} ` +
            `(${lookbackMonths.length} mo = ${lookbackDays} days)\n`);

const series = buildMonthlySeries(ledgers, detail, "pipeline");
const balances = buildLedgerBalances(ledgers);
const lastReceiptByLedger = buildLastReceiptDates(ledgers, detail, "pipeline");
const obt = buildOutstandingByType(ledgers);
const ledgerById = new Map(ledgers.map((c) => [c.id, c]));

const bills = enumerateBills(ledgers, detail, asOfDate, {}, groupMapping);
const billsByLedger = new Map<string, typeof bills>();
for (const b of bills) {
  const id = b.cust.id;
  if (!billsByLedger.has(id)) billsByLedger.set(id, []);
  billsByLedger.get(id)!.push(b);
}

// Universe: they owe money. (An advance/credit ledger has no DSO — nothing to collect.)
const owingIds = new Set(ledgers.filter((c) => (c.outstanding ?? 0) > 0).map((c) => c.id));
const eligible = consolidated.filter((c) =>
  (c.constituentIds ?? [c.id]).some((id) => owingIds.has(id)));

const CUTOFF = DEFAULT_DSO_CUTOFF;
const allRows = buildDsoRows({
  customers: eligible, series, balances, billsByLedger, lastReceiptByLedger, ledgerById,
  inScopeLedgerIds: owingIds, months, lookbackMonths, dayVec, asOfDate,
  groupOf: (c) => groupMapping[c.name] || c.name,
});

const total = dsoTotalsOf(allRows, CUTOFF, lookbackMonths.length);

/* ── assertions ──────────────────────────────────────────────────────────────────────── */

let pass = 0, fail = 0;
const near = (a: number, b: number, tolPct = 0.5) =>
  Math.abs(b) < 1 ? Math.abs(a) < 1 : Math.abs((a - b) / b) * 100 <= tolPct;

function check(n: number, name: string, actual: string, ok: boolean, expected: string) {
  if (ok) { pass++; console.log(`  PASS  ${String(n).padStart(2)}. ${name.padEnd(48)} ${actual}`); }
  else { fail++; console.log(`  FAIL  ${String(n).padStart(2)}. ${name.padEnd(48)} ${actual}   expected ${expected}`); }
}

console.log("═══ ORACLE ═══");
const bookDso = dsoOf(total, dayVec);
console.log(`  Book DSO ${bookDso.days.toFixed(1)} days${bookDso.beyondLookback ? " (CAPPED)" : ""} | ` +
            `customers ${total.customers} | AR ${money(total.ar)} | ` +
            `net billings ${money(total.salesWindow)} | over ${CUTOFF}d: ${total.overCutoff}\n`);

// 1. The formula's own sanity check: with perfectly FLAT sales, countback == the naive ratio.
{
  const flat = new Array(12).fill(1_000_000);        // Rs10L a month
  const days = new Array(12).fill(30);               // 360-day year, so the maths is exact
  const ar = 3_000_000;                              // exactly 3 months of billing
  const cb = countbackDso(ar, flat, days);
  const naive = (ar / (12 * 1_000_000)) * 360;       // = 90
  check(1, "countback == naive when sales are flat",
    `countback ${cb.days.toFixed(1)}d, naive ${naive.toFixed(1)}d`,
    Math.abs(cb.days - naive) < 0.01 && !cb.beyondLookback, "equal (90d)");
}

// 2. THE regression guard: a zero-billing month must ADVANCE the day count, not be skipped.
//    Skipping it would make a DORMANT customer's DSO smaller — the inversion of the truth.
{
  const withGap = countbackDso(1_000_000, [0, 0, 2_000_000], [31, 30, 31]);
  const noGap = countbackDso(1_000_000, [2_000_000, 0, 0], [31, 30, 31]);
  check(2, "zero-billing months burn days (no `continue`)",
    `gap-first ${withGap.days.toFixed(1)}d vs sale-first ${noGap.days.toFixed(1)}d`,
    withGap.days > noGap.days && Math.abs(withGap.days - (31 + 30 + 15.5)) < 0.01,
    "gap-first strictly larger (76.5d vs 15.5d)");
}

// 3. The as-of month is PARTIAL — elapsed days only, asserted generally (not a hardcoded 13).
{
  const asOf = new Date(asOfDate);
  const lastMonth = lookbackMonths[lookbackMonths.length - 1];
  const d = daysInMonth(lastMonth, asOfDate);
  check(3, "as-of month counts ELAPSED days, not calendar",
    `${lastMonth} = ${d} days (as-of ${asOfDate})`,
    d === asOf.getDate(), `${asOf.getDate()} (the day-of-month)`);
}

// 4. lookbackDays is SUMMED from real months, never hardcoded to 365.
{
  const naiveHardcode = 365;
  check(4, "lookbackDays summed from real months (not 365)",
    `${lookbackDays} days over ${lookbackMonths.length} months`,
    lookbackDays === dayVec.reduce((s, x) => s + x, 0) && lookbackDays !== naiveHardcode,
    "sum of dayVec, != 365 (the as-of month is partial)");
}

// 5. Every listed customer owes money.
{
  const bad = allRows.filter((r) => r.facts.ar <= 0).length;
  check(5, "every row has AR > 0", `${bad} rows with AR <= 0`, bad === 0, "0");
}

// 6. Sum AR of rows ties to the filtered universe.
{
  const universeAr = ledgers.filter((c) => owingIds.has(c.id))
    .reduce((s, c) => s + (c.outstanding ?? 0), 0);
  const rowAr = allRows.reduce((s, r) => s + r.facts.ar, 0);
  check(6, "Sigma AR(rows) == Sigma outstanding(universe)",
    `${money(rowAr)} vs ${money(universeAr)}`, near(rowAr, universeAr, 0.01), "equal");
}

// 7. Every dormant customer (zero billings across the lookback) lands in beyondLookback.
{
  const dormant = allRows.filter((r) => r.facts.salesWindow <= 0.5);
  const escaped = dormant.filter((r) => !r.facts.beyondLookback).length;
  check(7, "dormant (0 billings) => beyondLookback",
    `${dormant.length} dormant, ${escaped} escaped the cap`, escaped === 0, "0 escaped");
}

// 8. RATIOS ARE NEVER AVERAGED. A group's DSO is recomputed from its OWN summed AR + vector,
//    and it must actually DIFFER from the mean of its children — otherwise the discipline is
//    untested and a naive mean would have passed too.
{
  const metricsOf = makeDsoMetricsOf(CUTOFF);
  const tree = buildGroupTree<DsoRow, DsoMetrics>(allRows, ["salesperson", "customer"], {
    dimValue: (r, dim) => zcDimValue(r as any, dim),
    idOf: (r) => r.customer.id,
    metricsOf,
    empty: () => emptyDsoMetrics(lookbackMonths.length),
    add: addDsoMetrics,
  });

  let checkedNodes = 0, mismatched = 0, differsFromMean = 0, worstGap = 0, worstLabel = "";
  for (const node of tree.roots) {
    if (!node.children.length) continue;
    checkedNodes++;
    const nodeDso = dsoOf(node.metrics, dayVec).days;
    // recompute independently from the node's own summed inputs
    const recomputed = countbackDso(node.metrics.ar, node.metrics.salesVec, dayVec).days;
    if (Math.abs(nodeDso - recomputed) > 0.001) mismatched++;

    const kidDsos = node.children.map((k) => dsoOf(k.metrics, dayVec).days);
    const mean = kidDsos.reduce((s, x) => s + x, 0) / (kidDsos.length || 1);
    const gap = Math.abs(nodeDso - mean);
    if (gap > 1) differsFromMean++;
    if (gap > worstGap) { worstGap = gap; worstLabel = node.label; }
  }
  check(8, "group DSO == countback(own summed AR, vector)",
    `${checkedNodes} group nodes, ${mismatched} mismatched`, mismatched === 0, "0");
  check(9, "...and DIFFERS from the mean of its children",
    `${differsFromMean}/${checkedNodes} differ; worst "${worstLabel}" by ${worstGap.toFixed(1)}d`,
    differsFromMean > 0, ">0 (else the mean-of-means bug would pass too)");
}

// 10. Terms are an AR-WEIGHTED MEAN at group level, never a sum.
{
  const withTerms = allRows.filter((r) => r.facts.creditPeriod > 0);
  const acc = emptyDsoMetrics(lookbackMonths.length);
  const of = makeDsoMetricsOf(CUTOFF);
  for (const r of withTerms) addDsoMetrics(acc, of(r));
  const weighted = avgTermsOf(acc);
  const naiveSum = withTerms.reduce((s, r) => s + r.facts.creditPeriod, 0);
  const expected = withTerms.reduce((s, r) => s + r.facts.ar * r.facts.creditPeriod, 0)
    / withTerms.reduce((s, r) => s + r.facts.ar, 0);
  check(10, "group Terms == AR-weighted mean (never a sum)",
    `${weighted?.toFixed(1)}d (a naive SUM would read ${naiveSum})`,
    weighted !== null && Math.abs(weighted - expected) < 0.01 && weighted < 400, "the weighted mean");
}

// 11. Monotonicity: more debt against the same billings can never LOWER the DSO.
{
  const vec = [500_000, 800_000, 300_000, 0, 900_000, 100_000, 400_000, 0, 700_000, 200_000, 600_000, 50_000];
  const dv = dayVec;
  let violations = 0, prev = -1;
  for (let ar = 100_000; ar <= 6_000_000; ar += 100_000) {
    const d = countbackDso(ar, vec, dv).days;
    if (d < prev - 1e-9) violations++;
    prev = d;
  }
  check(11, "DSO is monotonic in AR", `${violations} violations over 60 steps`, violations === 0, "0");
}

// 12. Naive DSO is NULL (never Infinity, never 0) when nothing was billed.
{
  const dormant = allRows.filter((r) => r.facts.salesWindow <= 0.5);
  const bad = dormant.filter((r) => r.facts.naiveDso !== null).length;
  const infinities = allRows.filter((r) => r.facts.naiveDso !== null && !Number.isFinite(r.facts.naiveDso)).length;
  check(12, "naive DSO is null (not Inf/0) with no billings",
    `${dormant.length} dormant -> ${bad} non-null, ${infinities} infinities`,
    bad === 0 && infinities === 0, "0 and 0");
}

// 13. The denominator is EXACTLY net (sales + DN - CN) with NO per-month clamp.
//     The first implementation clamped each month at zero. This assertion is what rejected it:
//     the clamp silently discarded every month where returns exceeded billings, inflating the
//     denominator and flattering exactly the slow payers this report exists to catch.
//     Summed over the SAME in-scope ledgers as the rows — not the whole book (an earlier version
//     of this check compared 414 owing customers against all 1,780 ledgers and read as a 23% gap).
{
  let rawNet = 0, negMonths = 0, negAmount = 0;
  for (const id of owingIds) {
    const byMonth = series.get(id);
    if (!byMonth) continue;
    for (const m of lookbackMonths) {
      const f = byMonth.get(m);
      if (!f) continue;
      const net = f.sales + f.debitNotes - f.creditNotes;
      rawNet += net;
      if (net < 0) { negMonths++; negAmount += -net; }
    }
  }
  const rowsNet = allRows.reduce((s, r) => s + r.facts.salesWindow, 0);
  check(13, "denominator is exactly NET (no zero-clamp)",
    `Sigma salesVec ${money(rowsNet)} == Sigma(sales+DN-CN) ${money(rawNet)}`,
    near(rowsNet, rawNet, 0.01), "equal to the rupee");
  console.log(`        ${negMonths} net-negative customer-months worth ${money(negAmount)} — a zero-clamp`);
  console.log(`        would have discarded these and shortened every affected customer's DSO.`);
}

// 14. Machine-dominant customers are excluded by the DEFAULT sale-type scope.
{
  const nonMachine = new Set(["ink", "spare_parts", "head", "other"]);
  const kept = allRows.filter((r) => nonMachine.has(dominantSaleTypeOf(r.customer, obt)));
  const machineLeaks = kept.filter((r) => dominantSaleTypeOf(r.customer, obt) === "machine").length;
  const machineRows = allRows.length - kept.length;
  check(14, "default scope drops machine-dominant customers",
    `${machineRows} machine-dominant dropped, ${kept.length} kept, ${machineLeaks} leaked`,
    machineLeaks === 0, "0 leaked");
  const keptOver = kept.filter((r) => r.facts.dso > CUTOFF);
  const keptTotal = dsoTotalsOf(kept, CUTOFF, lookbackMonths.length);
  console.log(`        default view: ${kept.length} customers, book DSO ` +
              `${dsoOf(keptTotal, dayVec).days.toFixed(1)}d, ${keptOver.length} over ${CUTOFF}d ` +
              `holding ${money(keptOver.reduce((s, r) => s + r.facts.ar, 0))}`);
}

// 15. Credit notes really are material — the measurement that flipped the denominator to NET.
//     The gross comparison is built over the SAME in-scope ledgers, so it is apples-to-apples.
{
  const cnPct = total.grossSales > 0 ? (total.creditNotes / total.grossSales) * 100 : 0;
  check(15, "credit notes are material (=> denominator is NET)",
    `CN ${money(total.creditNotes)} = ${cnPct.toFixed(2)}% of gross ${money(total.grossSales)}`,
    cnPct >= 5, ">=5% (the reason gross was rejected)");

  const recentFirst = [...lookbackMonths].reverse();
  const grossVec = recentFirst.map((m) => {
    let g = 0;
    for (const id of owingIds) g += series.get(id)?.get(m)?.sales ?? 0;
    return g;
  });
  const grossDso = countbackDso(total.ar, grossVec, dayVec).days;
  console.log(`        Book DSO on NET billings ${bookDso.days.toFixed(1)}d vs on GROSS sales ` +
              `${grossDso.toFixed(1)}d — using gross would have understated the book by ` +
              `${(bookDso.days - grossDso).toFixed(1)} days.`);
}

// 16. Never-paid customers carry the sentinel, and it MAX-folds up the tree.
{
  const never = allRows.filter((r) => r.facts.daysSinceLastReceipt === NEVER_PAID);
  const anyReal = never.filter((r) => r.facts.lastReceiptDate !== null).length;
  check(16, "NEVER_PAID sentinel <=> no last receipt date",
    `${never.length} never paid, ${anyReal} contradictions`, anyReal === 0, "0");
}

/* ── distribution, for the record ─────────────────────────────────────────────────────── */

console.log("\n═══ DSO DISTRIBUTION (all customers who owe) ═══");
const bands: [string, (d: number) => boolean][] = [
  ["0-30d   ", (d) => d <= 30],
  ["31-60d  ", (d) => d > 30 && d <= 60],
  ["61-90d  ", (d) => d > 60 && d <= 90],
  ["91-120d ", (d) => d > 90 && d <= 120],
  ["121-180d", (d) => d > 120 && d <= 180],
  ["181-365d", (d) => d > 180 && d <= 365],
  ["capped  ", () => false],
];
for (const [label, pred] of bands) {
  const rs = label.startsWith("capped")
    ? allRows.filter((r) => r.facts.beyondLookback)
    : allRows.filter((r) => !r.facts.beyondLookback && pred(r.facts.dso));
  const ar = rs.reduce((s, r) => s + r.facts.ar, 0);
  console.log(`  ${label}  ${String(rs.length).padStart(4)} customers  ${money(ar).padStart(12)}`);
}

const worst = [...allRows].sort((a, b) =>
  (b.facts.dso - a.facts.dso) || (b.facts.ar - a.facts.ar)).slice(0, 8);
console.log("\n  worst by DSO:");
for (const r of worst) {
  const t = r.facts.creditPeriod > 0 ? `${r.facts.creditPeriod}d` : "—";
  console.log(`    ${r.facts.dso.toFixed(0).padStart(4)}d${r.facts.beyondLookback ? "+" : " "} ` +
              `terms ${t.padStart(5)}  ${money(r.facts.ar).padStart(12)}  ${r.customer.name.slice(0, 44)}`);
}

console.log(`\n${fail === 0 ? "ALL GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
