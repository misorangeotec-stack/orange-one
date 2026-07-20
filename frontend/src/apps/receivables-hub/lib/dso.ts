/**
 * dso.ts — the Days Sales Outstanding engine. Pure, UI-free.
 *
 * Answers a question none of the other reports do. Overdue-120 asks "which invoices are late";
 * Dormant asks "who stopped buying"; Zero-Collections asks "who paid nothing". DSO asks
 * **"how long does this customer structurally take to turn a sale into cash"** — a customer can
 * be inside their credit terms on every individual bill and still carry a 140-day DSO.
 *
 * ── The method: COUNTBACK, not the naive ratio ─────────────────────────────────────────
 *
 * Walk backwards from today through the customer's monthly billings, consuming their outstanding
 * until it is exhausted. The days consumed IS the DSO.
 *
 * The naive `AR / Sales x Days` was rejected on measured grounds: it DIVIDES BY ZERO for every
 * customer who owes money but billed nothing in the window — 49 customers on the live book at a
 * 12-month lookback. They would all read as infinity and flood the top of a ">90 days" list,
 * which merely re-prints the Dormant report. Countback degrades honestly: a zero-sales month
 * consumes its calendar days without reducing the debt, so a dormant customer simply runs out
 * the lookback and lands in `beyondLookback` with a truthful "> N days". The naive figure is
 * still carried as a column (null when there are no sales), because when sales ARE steady the
 * two agree — and that agreement is asserted in prove-dso-engine.ts.
 *
 * ── The denominator is NET billings, and that was measured, not assumed ────────────────
 *
 *     netBillings(month) = max(0, sales + debitNotes - creditNotes)
 *
 * Credit notes clear a bill WITHOUT collecting cash, so they reduce AR. If AR is net of them,
 * the billings that created it must be too, or the ratio is not dimensionally honest. The
 * planning assumption was gross sales (which is what every other report uses, so gross ties to
 * the Salesperson Collection Report by construction). Measured on the live book, credit notes
 * are **9.57% of gross sales** (Rs26.09 Cr on Rs272.70 Cr) — far too material to ignore; gross
 * would inflate every DSO by roughly a tenth. Debit notes ADD to what is owed, so they are added
 * back. Journals are deliberately EXCLUDED: they are adjustments, not billings.
 *
 * A month CAN come out negative (returns exceeded billings) and it is deliberately NOT clamped
 * to zero. Clamping was the first implementation and the proof harness rejected it: it discarded
 * **Rs6.65 Cr of credit notes across 265 customer-months (2.69% of net billings)**, which inflates
 * the denominator and makes DSO read BETTER than it is — an optimistic distortion on a report
 * whose entire job is to find slow payers. A net-negative month instead ADDS the debt back during
 * the countback, which is what actually happened: that month reduced receivables rather than
 * creating them.
 *
 * ── The rule that shapes this whole file: A RATIO IS NEVER SUMMED ──────────────────────
 *
 * A salesperson's DSO is NOT the mean of their customers' DSOs. collections.ts already enforces
 * this for percentages ("Percentages are NEVER stored on the metrics and NEVER summed"). DSO
 * needs the same discipline — but its denominator is a TIME SERIES, not a scalar.
 *
 * So DsoMetrics carries a fixed-length VECTOR of monthly billings, summed ELEMENT-WISE by
 * `addDsoMetrics`. Every node — customer, salesperson, company, category, grand total — re-runs
 * the countback on its own summed AR and its own summed vector. A salesperson's DSO is therefore
 * the true countback of their whole portfolio, exact at every level of the tree.
 *
 * Every ratio here follows that pattern — stored as a summable numerator/denominator pair and
 * derived at read time, never averaged:
 *
 *   DSO (countback)      ar, salesVec[]          -> countback(ar, salesVec, dayVec)
 *   Naive DSO            ar, salesWindow         -> ar / salesWindow x lookbackDays   (null at 0)
 *   Avg age of open bills  ageWeighted, agePending -> weighted divide
 *   Agreed terms (days)  termsWeighted, termsArBase -> AR-WEIGHTED MEAN, never a sum
 *
 * That last one is the trap: `creditPeriod` is no more summable than DSO is. A group's terms are
 * the AR-weighted average of its members'.
 *
 * ── Why this is a sibling engine and not a 4th CollectionsMode ─────────────────────────
 * collections.ts exposes CollectionsMode = "zero" | "threshold" | "dormant", and all three share
 * one ZCMetrics. DSO needs a 12-slot vector plus four ratio pairs; bolting that on would bloat
 * the metrics of three shipped reports. Same call overdueAging.ts and customerCategory.ts made.
 *
 * ── Units ─────────────────────────────────────────────────────────────────────────────
 * Everything in and out of this module is RUPEES and DAYS. (MonthFacts is already rupees — the
 * lakhs conversion happens once, inside buildMonthlySeries.)
 */

import { monthLabelToEndDate, monthLabelToStartDate } from "./months";
import { NEVER_PAID, NEVER_SOLD, type MonthFacts } from "./collections";
import type { EnrichedBill } from "./agingReport";
import type { ConsolidatedCustomer, Customer } from "./types";
import type { GroupByPreset } from "../components/GroupByBuilder";

/** Months of billing history the countback is allowed to consume. Annualised. */
export const LOOKBACK_MONTHS = 12;

/** The cutoff management asked for. Switchable via ?over= (see parseCutoff in overdueAging). */
export const DEFAULT_DSO_CUTOFF = 90;

export const DSO_CUTOFF_PRESETS = [60, 90, 120] as const;

/** Below this (Rs) a balance is noise — same epsilon the bill enumerator uses. */
export const EPS = 0.5;

/**
 * Calendar days in a trend month — EXCEPT the as-of month, which is PARTIAL.
 *
 * Today is the 13th, so Jul-26 has 13 days of selling in it, not 31. Counting it whole would
 * hand every customer ~18 phantom days of denominator and overstate the entire book's DSO.
 */
export function daysInMonth(label: string, asOfDate: string): number {
  const end = monthLabelToEndDate(label);
  const asOf = new Date(asOfDate);
  if (Number.isNaN(asOf.getTime())) return end.getDate();
  // Same calendar month as the as-of date -> only the elapsed days count.
  if (asOf.getFullYear() === end.getFullYear() && asOf.getMonth() === end.getMonth())
    return Math.max(1, asOf.getDate());
  return end.getDate();
}

/** The day-length of each month in the lookback, most-recent-first. Pairs with `salesVec`. */
export function buildDayVector(lookbackMonths: string[], asOfDate: string): number[] {
  return [...lookbackMonths].reverse().map((m) => daysInMonth(m, asOfDate));
}

/** Total days the countback can span. NEVER hardcode 365 — the horizon may be shorter. */
export const lookbackDaysOf = (dayVec: number[]): number =>
  dayVec.reduce((s, d) => s + d, 0);

export interface CountbackResult {
  /** Days of billing it takes to account for the outstanding. Capped at the lookback. */
  days: number;
  /** The debt outlived the entire lookback — it exceeds a full year of their own billings. */
  beyondLookback: boolean;
}

/**
 * THE metric. `salesVec` and `dayVec` are both MOST-RECENT-FIRST and the same length.
 *
 * Three behaviours that look like bugs and are not:
 *  - A zero-billing month still BURNS its days (no `continue`). Skipping it would make a dormant
 *    customer's DSO SMALLER — the exact inversion of the truth. Time passes whether or not we
 *    invoiced them.
 *  - A NET-NEGATIVE month (returns exceeded billings) ADDS the debt back — `remaining -= s` with
 *    s < 0 grows `remaining`. That month destroyed receivable rather than creating it, so it
 *    cannot pay down the countback. Clamping it to zero instead was measured to throw away 2.69%
 *    of the denominator and flatter every affected customer.
 *  - When the debt outlives the lookback we return the lookback length and flag it, rather than
 *    extrapolating. "> 347 days" is a fact; a made-up 800 would not be.
 *
 * `remaining` can only grow (negative month) or shrink toward the exhaustion branch, so it never
 * crosses zero unnoticed.
 */
export function countbackDso(ar: number, salesVec: number[], dayVec: number[]): CountbackResult {
  let remaining = Math.max(0, ar);
  if (remaining < EPS) return { days: 0, beyondLookback: false };

  let days = 0;
  for (let i = 0; i < salesVec.length; i++) {
    const s = salesVec[i] ?? 0;
    const d = dayVec[i] ?? 0;
    if (s > 0 && remaining <= s) {
      days += d * (remaining / s);            // partial month — the debt runs out mid-month
      return { days, beyondLookback: false };
    }
    remaining -= s;                           // whole month consumed; a NEGATIVE month adds back
    days += d;
  }
  return { days: lookbackDaysOf(dayVec), beyondLookback: true };
}

/**
 * Net billings for one month, in RUPEES: sales + debit notes - credit notes.
 *
 * NOT clamped at zero — see the countback header. A month where returns exceeded billings is a
 * real, negative contribution and the countback consumes it as such.
 */
export const netBillingsOf = (f: MonthFacts | undefined): number =>
  f ? f.sales + f.debitNotes - f.creditNotes : 0;

// ── Facts ────────────────────────────────────────────────────────────────────────────────

export interface DsoFacts {
  /** Canonical outstanding (Rs), summed over the customer's in-scope ledgers. */
  ar: number;
  /** Net billings per month, MOST-RECENT-FIRST, length = lookback. The DSO denominator. */
  salesVec: number[];
  /** Sum of salesVec — the naive ratio's denominator. */
  salesWindow: number;
  /** Gross sales in the lookback (Rs) — shown so the netting is visible, never the denominator. */
  grossSales: number;
  /** Credit notes in the lookback (Rs). */
  creditNotes: number;
  /** Debit notes in the lookback (Rs). */
  debitNotes: number;

  /** THE headline. Days. */
  dso: number;
  /** Debt exceeds the whole lookback's billings. `dso` is the cap, not a measurement. */
  beyondLookback: boolean;
  /** AR / salesWindow x lookbackDays. NULL when nothing was billed — never Infinity, never 0. */
  naiveDso: number | null;

  /** Sum(pending x age) over open bills — the numerator of Avg Age of Open Bills. */
  ageWeighted: number;
  /** Sum(pending) over open bills — its denominator. NOT equal to `ar` (see the basis panel). */
  agePending: number;
  /** Weighted average age of the bills still open. null when the customer has no open bills. */
  avgAgeOpenBills: number | null;

  /** Agreed credit period, in days. 0 = NOT RECORDED (never "cash on delivery"). */
  creditPeriod: number;
  /** ar x creditPeriod, only when terms are recorded — the AR-weighted-mean numerator. */
  termsWeighted: number;
  /** ar, only when terms are recorded — its denominator. */
  termsArBase: number;
  /** dso - creditPeriod. NULL when terms are not recorded. */
  excessOverTerms: number | null;

  /** Bill-wise overdue (Rs) — Sum pending of past-due bills. Reads above the Dashboard's netted figure. */
  overdue: number;
  /** Bill-wise slice more than 180 days past due (Rs). */
  over180: number;
  maxOverdueDays: number;

  lastReceiptDate: string | null;
  /** Days since the last collection. NEVER_PAID sentinel when they never have. */
  daysSinceLastReceipt: number;
  lastSaleMonth: string | null;
  /** Months since the last billing. NEVER_SOLD sentinel when nothing in the horizon. */
  monthsSinceLastSale: number;
}

export interface DsoRow {
  customer: ConsolidatedCustomer;
  facts: DsoFacts;
  group: string;
}

export interface BuildDsoRowsInput {
  customers: ConsolidatedCustomer[];
  /** ledgerId -> monthLabel -> MonthFacts, from buildMonthlySeries(allCustomers, detail, source). */
  series: Map<string, Map<string, MonthFacts>>;
  /** ledgerId -> canonical outstanding, from buildLedgerBalances. NEVER customer_trend.outstanding. */
  balances: Map<string, number>;
  /** ledgerId -> its open bills, for the age cross-check. */
  billsByLedger: Map<string, EnrichedBill[]>;
  /** ledgerId -> last receipt ISO date, from buildLastReceiptDates. */
  lastReceiptByLedger: Map<string, string | null>;
  /** ledgerId -> raw Customer, for creditPeriod / maxOverdueDays. */
  ledgerById: Map<string, Customer>;
  /** Only these ledgers count — the page's company/salesperson/etc. filters. */
  inScopeLedgerIds: ReadonlySet<string>;
  /** The full chronological month vocabulary (dashboard.trend). */
  months: string[];
  /** The lookback slice, chronological. Its reverse pairs with salesVec/dayVec. */
  lookbackMonths: string[];
  dayVec: number[];
  asOfDate: string;
  groupOf: (c: ConsolidatedCustomer) => string;
  /**
   * Live (ConnectWave) only: the monthly trend has NO per-month credit/debit notes there, so
   * netBillingsOf(trend) collapses to GROSS and every DSO reads optimistically low. When set, the
   * engine estimates each ledger's per-month notes from its REAL annual totals (Customer.creditNotes /
   * .debitNotes over .sales — same period on the live book, verified 1:1 vs Σ monthly sales),
   * apportioned by each month's sales. Pipeline leaves this off and uses the trend's real notes.
   */
  estimateNotesFromFy?: boolean;
}

const daysBetween = (fromIso: string, toIso: string): number | null => {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

/**
 * Build one row per consolidated customer.
 *
 * Everything is summed from RAW LEDGERS over `constituentIds` intersected with the in-scope set —
 * never read off the ConsolidatedCustomer, whose totals span every ledger regardless of the page's
 * filters, and whose consolidateByName() silently drops monthlyReceipts/lastReceiptDate. Same
 * discipline as factsForScoped().
 */
export function buildDsoRows(input: BuildDsoRowsInput): DsoRow[] {
  const {
    customers, series, balances, billsByLedger, lastReceiptByLedger, ledgerById,
    inScopeLedgerIds, months, lookbackMonths, dayVec, asOfDate, groupOf, estimateNotesFromFy,
  } = input;

  const lookbackDays = lookbackDaysOf(dayVec);
  // salesVec is most-recent-first, so the countback can walk it forwards.
  const recentFirst = [...lookbackMonths].reverse();
  const rows: DsoRow[] = [];

  for (const c of customers) {
    const all = c.constituentIds?.length ? c.constituentIds : [c.id];
    const ids = all.filter((id) => inScopeLedgerIds.has(id));
    if (!ids.length) continue;

    let ar = 0, grossSales = 0, creditNotes = 0, debitNotes = 0;
    let ageWeighted = 0, agePending = 0;
    let overdue = 0, over180 = 0, maxOverdueDays = 0;
    let creditPeriod = 0;
    let lastReceiptDate: string | null = null;
    let lastSaleMonth: string | null = null;
    const salesVec = new Array<number>(recentFirst.length).fill(0);

    for (const id of ids) {
      ar += balances.get(id) ?? 0;

      // Live only: derive this ledger's credit/debit-note RATE from its real annual totals, to be
      // apportioned onto each month's sales below (the live trend has no per-month notes). Clamped so
      // a returns-heavy ledger can't drive a month's net billing negative and skew the countback.
      let cnRate = 0, dnRate = 0;
      if (estimateNotesFromFy) {
        const led0 = ledgerById.get(id);
        const fySales = led0?.sales ?? 0;
        if (fySales > EPS) {
          cnRate = Math.min(Math.max((led0?.creditNotes ?? 0) / fySales, 0), 0.95);
          dnRate = Math.min(Math.max((led0?.debitNotes ?? 0) / fySales, 0), 0.95);
        }
      }

      const byMonth = series.get(id);
      for (let i = 0; i < recentFirst.length; i++) {
        const f = byMonth?.get(recentFirst[i]);
        if (!f) continue;
        if (estimateNotesFromFy) {
          // Estimate this month's notes from the annual rate × this month's sales, keeping salesVec
          // (net) and the Gross / Credit Notes columns internally consistent under Live.
          const cn = f.sales * cnRate;
          const dn = f.sales * dnRate;
          salesVec[i] += f.sales + dn - cn;
          grossSales += f.sales;
          creditNotes += cn;
          debitNotes += dn;
        } else {
          salesVec[i] += netBillingsOf(f);
          grossSales += f.sales;
          creditNotes += f.creditNotes;
          debitNotes += f.debitNotes;
        }
      }

      // Most recent month with ANY billing, across the FULL horizon (not just the lookback) —
      // the whole point is how far back you have to go. Compared by POSITION in `months`, never
      // as a string: "Sep-25" < "Apr-25" lexically.
      if (byMonth) {
        for (let i = months.length - 1; i >= 0; i--) {
          const f = byMonth.get(months[i]);
          if (f && f.sales > EPS) {
            if (!lastSaleMonth || months.indexOf(months[i]) > months.indexOf(lastSaleMonth))
              lastSaleMonth = months[i];
            break;
          }
        }
      }

      const led = ledgerById.get(id);
      if (led) {
        // consolidateByName already folds creditPeriod with MAX across a customer's ledgers;
        // mirror that here so the two agree. 0 means NOT RECORDED.
        creditPeriod = Math.max(creditPeriod, led.creditPeriod ?? 0);
        maxOverdueDays = Math.max(maxOverdueDays, led.maxOverdueDays ?? 0);
      }

      for (const b of billsByLedger.get(id) ?? []) {
        const pending = b.inv.pending ?? 0;
        if (pending <= EPS) continue;              // negative pending = on-account credit; no age
        const age = b.inv.date ? daysBetween(b.inv.date, asOfDate) : null;
        if (age !== null) { ageWeighted += pending * age; agePending += pending; }
        const od = b.inv.overdueDays ?? 0;
        if (od > 0) overdue += pending;
        if (od > 180) over180 += pending;
      }

      const lr = lastReceiptByLedger.get(id) ?? null;
      if (lr && (!lastReceiptDate || lr > lastReceiptDate)) lastReceiptDate = lr;
    }

    const salesWindow = salesVec.reduce((s, v) => s + v, 0);
    const { days: dso, beyondLookback } = countbackDso(ar, salesVec, dayVec);

    const endIdx = lookbackMonths.length
      ? months.indexOf(lookbackMonths[lookbackMonths.length - 1])
      : months.length - 1;
    const saleIdx = lastSaleMonth ? months.indexOf(lastSaleMonth) : -1;

    const termsKnown = creditPeriod > 0;

    rows.push({
      customer: c,
      group: groupOf(c),
      facts: {
        ar,
        salesVec,
        salesWindow,
        grossSales,
        creditNotes,
        debitNotes,
        dso,
        beyondLookback,
        naiveDso: salesWindow >= EPS ? (ar / salesWindow) * lookbackDays : null,
        ageWeighted,
        agePending,
        avgAgeOpenBills: agePending >= EPS ? ageWeighted / agePending : null,
        creditPeriod,
        termsWeighted: termsKnown ? ar * creditPeriod : 0,
        termsArBase: termsKnown ? ar : 0,
        excessOverTerms: termsKnown ? dso - creditPeriod : null,
        overdue,
        over180,
        maxOverdueDays,
        lastReceiptDate,
        daysSinceLastReceipt:
          lastReceiptDate ? (daysBetween(lastReceiptDate, asOfDate) ?? 0) : NEVER_PAID,
        lastSaleMonth,
        monthsSinceLastSale:
          saleIdx < 0 || endIdx < 0 ? NEVER_SOLD : Math.max(0, endIdx - saleIdx),
      },
    });
  }

  return rows;
}

// ── Metrics (the buildGroupTree contract) ────────────────────────────────────────────────

export interface DsoMetrics {
  customers: number;
  ar: number;
  /** ELEMENT-WISE summed monthly billings. This is what makes a group's DSO exact. */
  salesVec: number[];
  salesWindow: number;
  grossSales: number;
  creditNotes: number;
  debitNotes: number;

  ageWeighted: number;
  agePending: number;

  /** Sum(ar x terms) over members WITH terms recorded. Terms are a weighted mean, never a sum. */
  termsWeighted: number;
  termsArBase: number;

  overdue: number;
  over180: number;

  /** MAX-folded, like ZCMetrics. */
  maxOverdueDays: number;
  daysSinceLastReceipt: number;
  monthsSinceLastSale: number;

  /** Counts, for the KPI lenses. */
  overCutoff: number;
  beyondLookback: number;
  breachingTerms: number;
  severe: number;
  neverPaid: number;
}

export const emptyDsoMetrics = (lookback: number): DsoMetrics => ({
  customers: 0, ar: 0, salesVec: new Array<number>(lookback).fill(0), salesWindow: 0,
  grossSales: 0, creditNotes: 0, debitNotes: 0,
  ageWeighted: 0, agePending: 0, termsWeighted: 0, termsArBase: 0,
  overdue: 0, over180: 0,
  maxOverdueDays: 0, daysSinceLastReceipt: -1, monthsSinceLastSale: -1,
  overCutoff: 0, beyondLookback: 0, breachingTerms: 0, severe: 0, neverPaid: 0,
});

/** Curried on the cutoff, because the lens counts depend on it. Memoise at the call site. */
export const makeDsoMetricsOf = (cutoff: number) => (r: DsoRow): DsoMetrics => {
  const f = r.facts;
  return {
    customers: 1,
    ar: f.ar,
    salesVec: [...f.salesVec],
    salesWindow: f.salesWindow,
    grossSales: f.grossSales,
    creditNotes: f.creditNotes,
    debitNotes: f.debitNotes,
    ageWeighted: f.ageWeighted,
    agePending: f.agePending,
    termsWeighted: f.termsWeighted,
    termsArBase: f.termsArBase,
    overdue: f.overdue,
    over180: f.over180,
    maxOverdueDays: f.maxOverdueDays,
    daysSinceLastReceipt: f.daysSinceLastReceipt,
    monthsSinceLastSale: f.monthsSinceLastSale,
    overCutoff: f.dso > cutoff ? 1 : 0,
    beyondLookback: f.beyondLookback ? 1 : 0,
    breachingTerms: f.excessOverTerms !== null && f.excessOverTerms > 0 ? 1 : 0,
    severe: f.dso >= 2 * cutoff ? 1 : 0,
    neverPaid: f.daysSinceLastReceipt === NEVER_PAID ? 1 : 0,
  };
};

/** SUM everything, MAX the "worst-in-group" day counts, and sum the vector ELEMENT-WISE. */
export function addDsoMetrics(acc: DsoMetrics, m: DsoMetrics): void {
  acc.customers += m.customers;
  acc.ar += m.ar;
  for (let i = 0; i < acc.salesVec.length; i++) acc.salesVec[i] += m.salesVec[i] ?? 0;
  acc.salesWindow += m.salesWindow;
  acc.grossSales += m.grossSales;
  acc.creditNotes += m.creditNotes;
  acc.debitNotes += m.debitNotes;
  acc.ageWeighted += m.ageWeighted;
  acc.agePending += m.agePending;
  acc.termsWeighted += m.termsWeighted;
  acc.termsArBase += m.termsArBase;
  acc.overdue += m.overdue;
  acc.over180 += m.over180;
  acc.maxOverdueDays = Math.max(acc.maxOverdueDays, m.maxOverdueDays);
  acc.daysSinceLastReceipt = Math.max(acc.daysSinceLastReceipt, m.daysSinceLastReceipt);
  acc.monthsSinceLastSale = Math.max(acc.monthsSinceLastSale, m.monthsSinceLastSale);
  acc.overCutoff += m.overCutoff;
  acc.beyondLookback += m.beyondLookback;
  acc.breachingTerms += m.breachingTerms;
  acc.severe += m.severe;
  acc.neverPaid += m.neverPaid;
}

export function dsoTotalsOf(rows: DsoRow[], cutoff: number, lookback: number): DsoMetrics {
  const acc = emptyDsoMetrics(lookback);
  const of = makeDsoMetricsOf(cutoff);
  for (const r of rows) addDsoMetrics(acc, of(r));
  return acc;
}

// ── The four derived ratios. NONE is ever summed or averaged. ────────────────────────────

/** A node's DSO, recomputed from ITS OWN summed AR and summed billing vector. */
export const dsoOf = (m: DsoMetrics, dayVec: number[]): CountbackResult =>
  countbackDso(m.ar, m.salesVec, dayVec);

export const naiveDsoOf = (m: DsoMetrics, lookbackDays: number): number | null =>
  m.salesWindow >= EPS ? (m.ar / m.salesWindow) * lookbackDays : null;

export const avgAgeOf = (m: DsoMetrics): number | null =>
  m.agePending >= EPS ? m.ageWeighted / m.agePending : null;

/** AR-weighted mean of the agreed credit period. NEVER a sum. null = nobody has terms recorded. */
export const avgTermsOf = (m: DsoMetrics): number | null =>
  m.termsArBase >= EPS ? m.termsWeighted / m.termsArBase : null;

export const excessOverTermsOf = (m: DsoMetrics, dayVec: number[]): number | null => {
  const terms = avgTermsOf(m);
  return terms === null ? null : dsoOf(m, dayVec).days - terms;
};

// ── Focus lenses (the clickable KPI cards) ───────────────────────────────────────────────

export type DsoFocus =
  | "overCutoff" | "beyondLookback" | "breachingTerms" | "severe" | "neverPaid";

export const DSO_FOCUS_LABELS: Record<DsoFocus, string> = {
  overCutoff: "Over cutoff",
  beyondLookback: "Beyond lookback",
  breachingTerms: "Breaching agreed terms",
  severe: "Severe",
  neverPaid: "Never paid",
};

/**
 * Curried on the cutoff.
 *
 * NOTE the lens that ISN'T here. The design originally carried "Slowing down: 3-month-basis DSO
 * exceeds the 12-month basis by >= 30 days". It is broken by construction — a 3-month lookback
 * CAPS the countback at ~91 days, so a customer with a 12-month DSO of 140 can never satisfy it.
 * The lens would have matched zero rows on the very report it serves. Comparing countback DSOs
 * across different lookback caps is unsound for exactly the slow payers this report is about.
 * Replaced with `severe`, which is cap-free.
 */
export const makeDsoFocusPredicates = (
  cutoff: number,
): Record<DsoFocus, (r: DsoRow) => boolean> => ({
  overCutoff: (r) => r.facts.dso > cutoff,
  beyondLookback: (r) => r.facts.beyondLookback,
  breachingTerms: (r) => r.facts.excessOverTerms !== null && r.facts.excessOverTerms > 0,
  severe: (r) => r.facts.dso >= 2 * cutoff,
  neverPaid: (r) => r.facts.daysSinceLastReceipt === NEVER_PAID,
});

export function applyDsoFocus(
  rows: DsoRow[],
  focus: ReadonlySet<DsoFocus>,
  cutoff: number,
): DsoRow[] {
  if (!focus.size) return rows;
  const preds = makeDsoFocusPredicates(cutoff);
  return rows.filter((r) => [...focus].every((f) => preds[f](r)));
}

// ── Columns ──────────────────────────────────────────────────────────────────────────────

export type DsoColumnKey =
  | "customers" | "ar" | "terms" | "dso" | "naiveDso" | "avgAge" | "excessOverTerms"
  | "salesWindow" | "grossSales" | "creditNotes"
  | "overdue" | "over180" | "maxOverdueDays"
  | "daysSinceLastReceipt" | "monthsSinceLastSale";

export interface DsoColumn {
  key: DsoColumnKey;
  label: string;
  kind: "money" | "count" | "days" | "months";
  value: (m: DsoMetrics) => number | null;
  /** Render "> N" rather than a bare number — the countback hit its cap. */
  capped?: (m: DsoMetrics) => boolean;
  alarm?: (v: number) => boolean;
  /** Which slice of bills this figure is made of — click it to see them. */
  drill?: "overdue" | "over180" | "open";
}

/**
 * Curried on `dayVec` + `cutoff`, because every derived ratio needs the day vector and the alarm
 * thresholds need the cutoff. This is the same shape as makeMetricsOf(targetPct) in collections.
 */
export function makeDsoColumns(dayVec: number[], cutoff: number): DsoColumn[] {
  const lookbackDays = lookbackDaysOf(dayVec);
  return [
    { key: "customers", label: "Customers", kind: "count", value: (m) => m.customers },
    { key: "ar", label: "Outstanding", kind: "money", value: (m) => m.ar },
    { key: "terms", label: "Agreed Terms", kind: "days", value: (m) => avgTermsOf(m) },
    {
      key: "dso", label: "DSO", kind: "days",
      value: (m) => dsoOf(m, dayVec).days,
      capped: (m) => dsoOf(m, dayVec).beyondLookback,
      alarm: (v) => v > cutoff,
    },
    // Excess sits immediately beside the DSO it is derived from (DSO − Terms) — the two are read
    // together or not at all. NOTE the visible column ORDER is this array's order, not the order
    // of DEFAULT_DSO_COLUMNS (the page filters this list, which preserves its own sequence).
    {
      key: "excessOverTerms", label: "Excess over Terms", kind: "days",
      value: (m) => excessOverTermsOf(m, dayVec),
      alarm: (v) => v > 0,
    },
    {
      key: "avgAge", label: "Avg Age of Open Bills", kind: "days",
      value: (m) => avgAgeOf(m), drill: "open",
    },
    { key: "naiveDso", label: "Naive DSO", kind: "days", value: (m) => naiveDsoOf(m, lookbackDays) },
    { key: "salesWindow", label: "Net Billings (12m)", kind: "money", value: (m) => m.salesWindow },
    { key: "grossSales", label: "Gross Sales (12m)", kind: "money", value: (m) => m.grossSales },
    { key: "creditNotes", label: "Credit Notes (12m)", kind: "money", value: (m) => m.creditNotes },
    { key: "overdue", label: "Overdue", kind: "money", value: (m) => m.overdue, drill: "overdue" },
    { key: "over180", label: "180+ Days", kind: "money", value: (m) => m.over180, drill: "over180" },
    { key: "maxOverdueDays", label: "Max Overdue Days", kind: "days", value: (m) => m.maxOverdueDays },
    {
      key: "daysSinceLastReceipt", label: "Days Since Last Receipt", kind: "days",
      value: (m) => m.daysSinceLastReceipt,
    },
    {
      key: "monthsSinceLastSale", label: "Months Since Last Sale", kind: "months",
      value: (m) => m.monthsSinceLastSale,
    },
  ];
}

export const DEFAULT_DSO_COLUMNS: DsoColumnKey[] = [
  "customers", "ar", "terms", "dso", "excessOverTerms", "avgAge",
  "salesWindow", "overdue", "over180",
];

// ── Grouping dimensions (shared with the other reports via zcDimValue) ───────────────────

export type DsoDim = "salesperson" | "customer" | "group" | "category" | "company" | "location";

export const DSO_DIMENSIONS: { key: DsoDim; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "salesperson", label: "Salesperson" },
  { key: "group", label: "Group" },
  { key: "category", label: "Category" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
];

export const DSO_PRESETS: GroupByPreset<DsoDim>[] = [
  { label: "Customer",                  dims: ["customer"] },
  { label: "Salesperson → Customer",    dims: ["salesperson", "customer"] },
  { label: "Salesperson",               dims: ["salesperson"] },
  { label: "Category → Customer",       dims: ["category", "customer"] },
  { label: "Customer Group",            dims: ["group"] },
  { label: "Company → Customer",        dims: ["company", "customer"] },
  { label: "Location",                  dims: ["location"] },
];
