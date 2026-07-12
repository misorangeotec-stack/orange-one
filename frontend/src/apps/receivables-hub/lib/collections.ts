/**
 * collections.ts — the Collection Performance engine. Pure, UI-free.
 *
 * ONE engine, TWO reports. Both answer "who isn't paying us", at different thresholds:
 *
 *   threshold = 0    → "Customers with Zero Collections"  — paid us NOTHING in the period.
 *   threshold = 30   → "Customers Below 30% Collection"   — paid us less than 30% of what
 *                                                            we could have collected.
 *
 * Zero collection is the 0% case, so they share every line below. The only thing that
 * differs is the predicate (`isZeroCollection` vs `isBelowThreshold`) and the default
 * column set — see `defaultColumnsFor`.
 *
 * ── The percentage, and why the denominator is what it is ──────────────────────────
 *
 *     Collectible  = Opening Outstanding (at window start) + Sales billed in the window
 *     Collected    = receipt vouchers + manual Other Payments in the window
 *     Collection % = Collected / Collectible
 *
 * The obvious alternative — "% of what was contractually DUE" — cannot be summed over a
 * multi-month window: an unpaid bill is due again next month, so a 3-month window would
 * double-count it. A stock (opening) plus a flow (sales) composes correctly over ANY
 * window length, and rolls up a Salesperson/Group tree as Σcollected / Σcollectible.
 *
 * Percentages are NEVER stored on the metrics and NEVER summed. Every node's % is derived
 * from its own summed collected/collectible — see `pctOf` and the `value()` on each column.
 *
 * ── Why this is month-granular, and why that isn't laziness ────────────────────────
 * The Customer type advertises `lastReceiptDate`, `monthlyReceipts`, `receipts1M/6M`,
 * `daysSinceLastReceipt` and `consecutiveNoPaymentMonths`. In PRODUCTION (Supabase) every
 * one of those is hard-coded null/0/{} in supabaseFetcher.toCustomer() — the `customers`
 * table has no such columns. Only receipts_3m is real. Build on them and the report reads
 * "nobody has ever paid us". So: one source-aware adapter at MONTH grain — which is also
 * the grain the Salesperson Collection Report anchors its "Received" to, so the reports
 * reconcile by construction.
 *
 * ── Three traps in the pipeline data (measured against the live receivables Supabase) ──
 *
 * 1. `customer_trend.receipts` is stored GROSS, while the BALANCE nets cheque returns
 *    (`mr_net = mr - mchq` in process_data.py). A customer who "pays" ₹10L with a cheque
 *    that bounces would otherwise score 10%, clear a 30% threshold, and never appear on this
 *    report. Ten real customers do exactly this today — one reads 184% gross and 10% net on
 *    ₹34L of returned cheques. So we carry BOTH `pct` (gross — reconciles with the
 *    Salesperson Collection Report) and `pctNet`, and `pctEff` (the WORSE of the two) decides
 *    who is listed.
 *
 * 2. `customer_trend.outstanding` is NOT the canonical balance. It is the trend's own
 *    recomputed stock, it is `max(0, ...)`-clamped, and it disagrees with
 *    `customers.outstanding` for 184 of 1,780 ledgers — by ₹1.92 Cr on BISHEN DYEING, the
 *    largest row on this report. Opening is therefore NEVER read from it: it is derived by
 *    rolling the canonical outstanding BACKWARDS through the recorded movements. See
 *    `openingForLedger` — that is the single most important function in this file.
 *
 * 3. Everything is FY-scoped (`customers`, `customer_trend` and `dashboard_trend` are all
 *    fetched .eq("fiscal_year", fy)). The month vocabulary never precedes the FY start, so
 *    a "This FY" window has NO prior period: `priorPct`/`deltaPp` come back null and must
 *    render "—", never 0%.
 *
 * ── The consolidateByName trap ────────────────────────────────────────────────────
 * useAppData's consolidateByName() spreads `...entries[0]` and then overrides an explicit
 * field list. `monthlyReceipts` / `lastReceiptDate` / `receipts3M` are NOT on that list, so
 * a merged customer silently carries only its FIRST ledger's values. Everything here is
 * therefore built from RAW ledgers and summed over `constituentIds` — never read off a
 * ConsolidatedCustomer.
 *
 * ── Units ─────────────────────────────────────────────────────────────────────────
 * Customer.* and every *Transaction.amount are RUPEES. MonthlyTrend.* is LAKHS.
 * Everything this module returns is RUPEES.
 */

import { isoToMonthLabel } from "./months";
import type { GroupByPreset } from "../components/GroupByBuilder";
import type { ConsolidatedCustomer, Customer, CustomerDetail } from "./types";

/** Which backend the current view is reading. Mirrors useReceivablesSource(). */
export type CollectionsSource = "pipeline" | "live";

/** A customer counts as having collected when they're at or above this (₹). Strict zero. */
export const ZERO_EPS = 1;

/** Below this (₹) there was nothing to collect, so a percentage is undefined — not 0%. */
export const COLLECTIBLE_EPS = 1;

/** One month of activity for one ledger, in RUPEES. All FLOWS — see `movementOf`. */
export interface MonthFacts {
  /** Money actually collected: receipt vouchers + manual Other Payments. GROSS — see trap 1. */
  receipts: number;
  /** Billed in the month — the "are we still supplying a non-payer" signal. */
  sales: number;
  /** Cheque returns (bounced payments). Reported, and netted only into `pctNet`. */
  chequeReturns: number;
  /** Credit notes (sales returns) — they clear a bill WITHOUT collecting cash. */
  creditNotes: number;
  /** Debit notes — they ADD to what's owed. */
  debitNotes: number;
  /** Journal adjustments, signed (Dr − Cr). */
  journals: number;
}

const emptyMonth = (): MonthFacts => ({
  receipts: 0, sales: 0, chequeReturns: 0, creditNotes: 0, debitNotes: 0, journals: 0,
});

/**
 * How much this month moved the receivable, in RUPEES. Positive = they owe MORE.
 *
 * Note receipts are netted of cheque returns here but NOT in the `receipts` field — the
 * pipeline stores the balance net (`mr_net = mr − mchq`) and the reported figure gross.
 * That asymmetry is trap 1; this is the one place it gets reconciled.
 */
const movementOf = (f: MonthFacts): number =>
  f.sales + f.debitNotes + f.journals - (f.receipts - f.chequeReturns) - f.creditNotes;

/** Cheque-return rows ride in receiptTransactions with this type; they belong on the
 *  Due side, not the Received side (same convention as SalespersonCollectionReport). */
const isChequeReturn = (type: string | null | undefined): boolean =>
  (type ?? "").toLowerCase() === "check_return";

/**
 * ledgerId → (month label → MonthFacts), in RUPEES.
 *
 * Pass RAW ledgers (useAppData's `allCustomers`, already salesperson-scoped) — not
 * consolidated rows. See the consolidateByName note above.
 */
export function buildMonthlySeries(
  ledgers: Customer[],
  detail: Record<string, CustomerDetail>,
  source: CollectionsSource,
): Map<string, Map<string, MonthFacts>> {
  const out = new Map<string, Map<string, MonthFacts>>();

  for (const c of ledgers) {
    const byMonth = new Map<string, MonthFacts>();
    const bucket = (label: string): MonthFacts | null => {
      if (!label) return null;
      let m = byMonth.get(label);
      if (!m) { m = emptyMonth(); byMonth.set(label, m); }
      return m;
    };

    const d = detail[c.id];

    // The per-customer trend is the CANONICAL monthly figure (LAKHS) — the same one the
    // Salesperson Collection Report anchors "Received" to. Using it (rather than re-summing
    // receiptTransactions) is what makes the two reports agree exactly.
    for (const t of d?.trend ?? []) {
      const m = bucket(t.month);
      if (!m) continue;
      m.sales         += (t.sales ?? 0) * 100_000;
      m.creditNotes   += (t.creditNotes ?? 0) * 100_000;
      m.debitNotes    += (t.debitNotes ?? 0) * 100_000;
      m.journals      += (t.journalAdjustments ?? 0) * 100_000;
      m.chequeReturns += (t.checkReturns ?? 0) * 100_000;
      // Live (ConnectWave) carries receipts on the customer row in exact rupees; taking them
      // from the trend instead would round-trip through lakhs and could perturb the strict
      // ZERO_EPS test. Pipeline has no such row, so the trend IS the receipt figure.
      if (source === "pipeline") m.receipts += (t.receipts ?? 0) * 100_000;
    }

    if (source === "live") {
      for (const [label, amt] of Object.entries(c.monthlyReceipts ?? {})) {
        const m = bucket(label);
        if (m) m.receipts += Number(amt) || 0;
      }
    } else {
      // Manual (non-Tally) Other Payments are real money but live outside the trend's
      // receipts, so fold them in by date. (They don't exist in the live snapshot.)
      for (const o of d?.otherPaymentTransactions ?? []) {
        if (!o.date) continue;
        const m = bucket(isoToMonthLabel(o.date));
        if (m) m.receipts += Math.abs(o.amount);
      }
    }

    out.set(c.id, byMonth);
  }

  return out;
}

/**
 * ledgerId → the ledger's CANONICAL outstanding today (₹, signed).
 *
 * This is the anchor the window's Opening is derived from — see `openingForLedger`. Read off
 * the RAW ledger, for the same consolidateByName reason as everything else.
 */
export function buildLedgerBalances(ledgers: Customer[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of ledgers) out.set(c.id, c.outstanding ?? 0);
  return out;
}

/**
 * ledgerId → the most recent collection date (ISO), or null when the ledger has never
 * paid within the data horizon (which starts 01-Apr-2025 — the report says so on screen).
 */
export function buildLastReceiptDates(
  ledgers: Customer[],
  detail: Record<string, CustomerDetail>,
  source: CollectionsSource,
): Map<string, string | null> {
  const out = new Map<string, string | null>();

  for (const c of ledgers) {
    if (source === "live") {
      // Day-level transactions aren't in the live bulk snapshot, but the customer row
      // carries the pre-computed last receipt date. Use it — deriving from the (empty)
      // transaction list would brand every customer "Never paid".
      out.set(c.id, c.lastReceiptDate ?? null);
      continue;
    }

    const d = detail[c.id];
    let last: string | null = null;
    for (const r of d?.receiptTransactions ?? []) {
      if (!r.date || isChequeReturn(r.type)) continue;
      if (!last || r.date > last) last = r.date;
    }
    for (const o of d?.otherPaymentTransactions ?? []) {
      if (!o.date) continue;
      if (!last || o.date > last) last = o.date;
    }
    out.set(c.id, last);
  }

  return out;
}

/** Everything the report knows about one customer's collection behaviour in a window. */
export interface CollectionFacts {
  /** Collected inside the window (₹), GROSS of cheque returns. The zero test reads this. */
  inWindow: number;
  /** Collected in the equal-length window immediately before — did they GO quiet, or never pay? */
  inPrior: number;
  /** Billed inside the window (₹) — we're still supplying them. */
  salesInWindow: number;
  /** Cheque returns inside the window (₹) — they "paid" and it bounced. */
  chequeReturns: number;
  /** Credit notes inside the window (₹) — bills cleared without cash. */
  creditNotes: number;

  /** Outstanding carried into the window (₹), clamped >= 0. */
  opening: number;
  /** opening + salesInWindow — everything we could have collected. */
  collectible: number;
  /** = inWindow. Named for the ratio it feeds. */
  collected: number;
  /** collected − cheque returns, clamped >= 0. A bounced cheque is not a collection. */
  collectedNet: number;
  /** collected / collectible × 100. null when there was nothing to collect. */
  pct: number | null;
  /** collectedNet / collectible × 100. null when there was nothing to collect. */
  pctNet: number | null;
  /** The WORSE of pct and pctNet — the one that decides whether a customer is listed. */
  pctEff: number | null;

  /** Collectible in the prior window. 0 when there is no prior window (start of the FY). */
  priorCollectible: number;
  /** inPrior / priorCollectible × 100. null when there is no prior window (trap 3). */
  priorPct: number | null;
  /** pct − priorPct, in percentage points. null when either side is null. */
  deltaPp: number | null;

  /** Most recent collection ever, across all constituent ledgers. null = never paid. */
  lastReceiptDate: string | null;
  /** Days from lastReceiptDate to as-of. null when never paid. */
  daysSinceLastReceipt: number | null;
}

const sumMonths = (
  byMonth: Map<string, MonthFacts> | undefined,
  months: string[],
  pick: (m: MonthFacts) => number,
): number => {
  if (!byMonth) return 0;
  let total = 0;
  for (const label of months) {
    const m = byMonth.get(label);
    if (m) total += pick(m);
  }
  return total;
};

const daysBetween = (fromIso: string, toIso: string): number | null => {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
};

/** A ratio as a percentage, or null when the denominator is nothing. Never 0/0 = 0%. */
export const pctOf = (num: number, den: number): number | null =>
  den >= COLLECTIBLE_EPS ? (num / den) * 100 : null;

/**
 * Outstanding carried INTO `firstMonth`, for one ledger, in RUPEES (signed).
 *
 *     Opening(w0) = outstanding today − Σ movements from w0 to the latest month
 *
 * ── Why it is derived backwards, and not simply read off customer_trend.outstanding ──
 *
 * The obvious implementation reads the month-end `outstanding` of the month before the
 * window. That column exists, it is a genuine month-end stock, and it is WRONG for this:
 * it is the trend's own recomputed balance, and it does not agree with the canonical
 * `customers.outstanding` the rest of the dashboard reports. Measured against the live
 * pipeline data (1,780 ledgers): it diverges for 184 of them, and for 406 of the 608 who
 * owe money it breaks the identity below — by ₹1.92 Cr on BISHEN DYEING alone, which is the
 * single largest row on this report. It also carries a `max(0, …)` clamp (trap 2), so a
 * ledger that once dipped into advance has its history flattened to zero.
 *
 * Anchoring on the canonical balance instead and rolling it backwards through the recorded
 * movements makes this identity hold EXACTLY, for every customer, by construction:
 *
 *     Opening + Sales + DebitNotes + Journals − (Collected − Bounced) − CreditNotes
 *         = Outstanding
 *
 * which is what makes the report auditable: management can add up the columns on screen and
 * land on the outstanding figure they already know. (The ConnectWave snapshot's SQL derives
 * its own per-month balance the same way, for the same reason.)
 *
 * `months` must run to the as-of month — it is `dashboard.trend`'s month list, which does.
 */
function openingForLedger(
  ledgerId: string,
  series: Map<string, Map<string, MonthFacts>>,
  balances: Map<string, number>,
  months: string[],
  firstMonth: string,
): number {
  const idx = months.indexOf(firstMonth);
  if (idx < 0) return 0;
  const byMonth = series.get(ledgerId);
  let balance = balances.get(ledgerId) ?? 0;
  for (let i = months.length - 1; i >= idx; i--) {
    const m = byMonth?.get(months[i]);
    if (m) balance -= movementOf(m);
  }
  return balance;
}

/** Roll a consolidated customer's constituent ledgers up into one set of collection facts. */
export function factsFor(
  c: ConsolidatedCustomer,
  series: Map<string, Map<string, MonthFacts>>,
  lastDates: Map<string, string | null>,
  balances: Map<string, number>,
  months: string[],
  windowMonths: string[],
  priorMonths: string[],
  asOfDate: string,
): CollectionFacts {
  const ids = c.constituentIds?.length ? c.constituentIds : [c.id];

  let inWindow = 0, inPrior = 0, salesInWindow = 0, chequeReturns = 0, creditNotes = 0;
  let salesInPrior = 0;
  let openingRaw = 0, priorOpeningRaw = 0;
  let lastReceiptDate: string | null = null;

  for (const id of ids) {
    const byMonth = series.get(id);
    inWindow      += sumMonths(byMonth, windowMonths, (m) => m.receipts);
    inPrior       += sumMonths(byMonth, priorMonths,  (m) => m.receipts);
    salesInWindow += sumMonths(byMonth, windowMonths, (m) => m.sales);
    salesInPrior  += sumMonths(byMonth, priorMonths,  (m) => m.sales);
    chequeReturns += sumMonths(byMonth, windowMonths, (m) => m.chequeReturns);
    creditNotes   += sumMonths(byMonth, windowMonths, (m) => m.creditNotes);

    if (windowMonths.length)
      openingRaw += openingForLedger(id, series, balances, months, windowMonths[0]);
    if (priorMonths.length)
      priorOpeningRaw += openingForLedger(id, series, balances, months, priorMonths[0]);

    const last = lastDates.get(id) ?? null;
    if (last && (!lastReceiptDate || last > lastReceiptDate)) lastReceiptDate = last;
  }

  // Clamp deliberately (trap 2): a customer sitting in advance had nothing to collect from
  // their opening — but they may still have bought during the window.
  const opening = Math.max(0, openingRaw);
  const collectible = opening + salesInWindow;
  const collected = inWindow;
  const collectedNet = Math.max(0, collected - chequeReturns);

  const priorCollectible = priorMonths.length
    ? Math.max(0, priorOpeningRaw) + salesInPrior
    : 0;

  const pct = pctOf(collected, collectible);
  const pctNet = pctOf(collectedNet, collectible);
  const pctEff = pct === null || pctNet === null ? null : Math.min(pct, pctNet);
  const priorPct = priorMonths.length ? pctOf(inPrior, priorCollectible) : null;

  return {
    inWindow,
    inPrior,
    salesInWindow,
    chequeReturns,
    creditNotes,
    opening,
    collectible,
    collected,
    collectedNet,
    pct,
    pctNet,
    pctEff,
    priorCollectible,
    priorPct,
    deltaPp: pct !== null && priorPct !== null ? pct - priorPct : null,
    lastReceiptDate,
    daysSinceLastReceipt:
      lastReceiptDate && asOfDate ? daysBetween(lastReceiptDate, asOfDate) : null,
  };
}

// ── The two predicates ──────────────────────────────────────────────────────────────

/**
 * A customer collected nothing in the window. Strict: any receipt at all disqualifies.
 *
 * Deliberately needs NO denominator, so it still catches a customer with an empty
 * collectible pool — and so the Zero Collections report is bit-for-bit what it always was.
 */
export const isZeroCollection = (f: CollectionFacts): boolean => f.inWindow < ZERO_EPS;

/**
 * A customer collected less than `thresholdPct` of what we could have collected.
 *
 * Reads `pctEff` (the worse of gross and net-of-cheque-returns), so a customer whose only
 * "payment" bounced is listed — see trap 1. Customers with nothing to collect are excluded:
 * a percentage of nothing is undefined, not 0%.
 */
export const isBelowThreshold = (f: CollectionFacts, thresholdPct: number): boolean =>
  f.collectible >= COLLECTIBLE_EPS && f.pctEff !== null && f.pctEff < thresholdPct;

// ── Severity bands ──────────────────────────────────────────────────────────────────

export type CollectionBand = "zero" | "b0_10" | "b10_20" | "b20_30" | "b30_plus";

export const BAND_LABELS: Record<CollectionBand, string> = {
  zero: "0% (nothing)",
  b0_10: "0–10%",
  b10_20: "10–20%",
  b20_30: "20–30%",
  b30_plus: "30%+",
};

export const BAND_ORDER: CollectionBand[] = ["zero", "b0_10", "b10_20", "b20_30", "b30_plus"];

export function bandOf(f: CollectionFacts): CollectionBand {
  if (f.collected < ZERO_EPS) return "zero";
  const p = f.pctEff ?? 0;
  if (p < 10) return "b0_10";
  if (p < 20) return "b10_20";
  if (p < 30) return "b20_30";
  return "b30_plus";
}

/** Money that would have arrived had this customer hit the target. Summable — unlike a %. */
export const shortfallOf = (f: CollectionFacts, targetPct: number): number =>
  Math.max(0, (f.collectible * targetPct) / 100 - f.collected);

// ── The report row + its roll-up metrics ────────────────────────────────────────────

/** One customer on the report: the consolidated ledger + its collection facts + its group. */
export interface ZCRow {
  customer: ConsolidatedCustomer;
  facts: CollectionFacts;
  /** Parent group from the mapping sheet, or the customer's own name when ungrouped. */
  group: string;
}

/**
 * The SUMMABLE columns. `maxOverdueDays` and `daysSinceLastReceipt` fold with MAX (the
 * worst offender in the group), everything else with SUM — see `addMetrics`.
 * `daysSinceLastReceipt` uses -1 as the "never paid" sentinel so MAX still ranks it worst.
 *
 * There is NO percentage here, on purpose. A node's Collection % is derived from its own
 * summed collected/collectible (see ZC_COLUMNS) — averaging children's percentages would be
 * wrong, and storing one here would invite exactly that.
 */
export interface ZCMetrics {
  customers: number;
  outstanding: number;
  overdue: number;
  over180: number;
  opening: number;
  salesInWindow: number;
  collectible: number;
  collected: number;
  shortfall: number;
  priorCollections: number;
  priorCollectible: number;
  chequeReturns: number;
  creditNotes: number;
  maxOverdueDays: number;
  /** Worst (largest) days-since-last-receipt in the group. NEVER_PAID when any never paid. */
  daysSinceLastReceipt: number;
  neverPaid: number;
  stillBuying: number;
  bounced: number;
  deteriorating: number;
  zeroCollectors: number;
  creditLimit: number;
}

/** Sentinel for "no receipt in the entire data horizon" — sorts as the worst possible. */
export const NEVER_PAID = Number.MAX_SAFE_INTEGER;

/** A collection % has fallen this many points below the prior window → "deteriorating". */
export const DETERIORATION_PP = 10;

export const emptyMetrics = (): ZCMetrics => ({
  customers: 0, outstanding: 0, overdue: 0, over180: 0,
  opening: 0, salesInWindow: 0, collectible: 0, collected: 0, shortfall: 0,
  priorCollections: 0, priorCollectible: 0, chequeReturns: 0, creditNotes: 0,
  maxOverdueDays: 0, daysSinceLastReceipt: -1,
  neverPaid: 0, stillBuying: 0, bounced: 0, deteriorating: 0, zeroCollectors: 0,
  creditLimit: 0,
});

/**
 * `metricsOf` needs the target to compute Shortfall, and buildGroupTree wants a plain
 * (row) => metrics — so it's curried. Memoise the result on `targetPct` at the call site.
 */
export const makeMetricsOf = (targetPct: number) => (r: ZCRow): ZCMetrics => {
  const c = r.customer;
  const f = r.facts;
  const never = f.lastReceiptDate === null;
  return {
    customers: 1,
    outstanding: c.outstanding,
    overdue: c.overdue,
    over180: c.agingBuckets?.["180_plus"] ?? 0,
    opening: f.opening,
    salesInWindow: f.salesInWindow,
    collectible: f.collectible,
    collected: f.collected,
    shortfall: shortfallOf(f, targetPct),
    priorCollections: f.inPrior,
    priorCollectible: f.priorCollectible,
    chequeReturns: f.chequeReturns,
    creditNotes: f.creditNotes,
    maxOverdueDays: c.maxOverdueDays ?? 0,
    daysSinceLastReceipt: never ? NEVER_PAID : (f.daysSinceLastReceipt ?? -1),
    neverPaid: never ? 1 : 0,
    stillBuying: f.salesInWindow > 0 ? 1 : 0,
    bounced: f.chequeReturns > 0.5 ? 1 : 0,
    deteriorating: f.deltaPp !== null && f.deltaPp < -DETERIORATION_PP ? 1 : 0,
    zeroCollectors: f.collected < ZERO_EPS ? 1 : 0,
    creditLimit: c.creditLimit ?? 0,
  };
};

export function addMetrics(acc: ZCMetrics, m: ZCMetrics): void {
  acc.customers        += m.customers;
  acc.outstanding      += m.outstanding;
  acc.overdue          += m.overdue;
  acc.over180          += m.over180;
  acc.opening          += m.opening;
  acc.salesInWindow    += m.salesInWindow;
  acc.collectible      += m.collectible;
  acc.collected        += m.collected;
  acc.shortfall        += m.shortfall;
  acc.priorCollections += m.priorCollections;
  acc.priorCollectible += m.priorCollectible;
  acc.chequeReturns    += m.chequeReturns;
  acc.creditNotes      += m.creditNotes;
  acc.neverPaid        += m.neverPaid;
  acc.stillBuying      += m.stillBuying;
  acc.bounced          += m.bounced;
  acc.deteriorating    += m.deteriorating;
  acc.zeroCollectors   += m.zeroCollectors;
  acc.creditLimit      += m.creditLimit;
  // Non-summable: the group inherits its worst member.
  acc.maxOverdueDays       = Math.max(acc.maxOverdueDays, m.maxOverdueDays);
  acc.daysSinceLastReceipt = Math.max(acc.daysSinceLastReceipt, m.daysSinceLastReceipt);
}

// ── Focus lenses (the clickable KPI cards) ──────────────────────────────────────────

/**
 * The KPI cards that are genuine SUBSETS of the report, and so can filter it.
 *
 * The summary cards — "Customers", "Outstanding Locked", "Collection %" — describe the WHOLE
 * list, so filtering by them is a no-op. They act as "show everything / clear" instead of
 * pretending to be lenses.
 *
 * Multiple lenses AND together: `never` + `buying` is the report's most damning list —
 * customers we are still shipping goods to who have never paid us a single rupee.
 */
export type ZCFocus =
  | "overdue" | "never" | "buying" | "over180"
  | "partial" | "deteriorating" | "bounced";

export const ZC_FOCUS_LABELS: Record<ZCFocus, string> = {
  overdue: "Overdue Locked",
  never:   "Never Paid",
  buying:  "Still Buying",
  over180: "> 180 Days",
  partial: "Partial Payers",
  deteriorating: "Deteriorating",
  bounced: "Bounced",
};

/** The ₹0.5 guard matches the drill-down's `Math.abs(v) >= 0.5`, so a row carrying nothing
 *  but rounding dust can't slip into a lens. */
export const ZC_FOCUS_PREDICATES: Record<ZCFocus, (r: ZCRow) => boolean> = {
  overdue: (r) => r.customer.overdue > 0.5,
  never:   (r) => r.facts.lastReceiptDate === null,
  buying:  (r) => r.facts.salesInWindow > 0.5,
  over180: (r) => (r.customer.agingBuckets?.["180_plus"] ?? 0) > 0.5,
  // Paid us SOMETHING and still fell short — the customers worth a phone call rather than a
  // lawyer. (Every row on this report is already below the threshold.)
  partial: (r) => r.facts.collected >= ZERO_EPS,
  deteriorating: (r) => r.facts.deltaPp !== null && r.facts.deltaPp < -DETERIORATION_PP,
  bounced: (r) => r.facts.chequeReturns > 0.5,
};

/** Apply every active lens (AND). An empty set means no focus — the full list. */
export function applyFocus(rows: ZCRow[], focus: ReadonlySet<ZCFocus>): ZCRow[] {
  if (focus.size === 0) return rows;
  const preds = [...focus].map((f) => ZC_FOCUS_PREDICATES[f]);
  return rows.filter((r) => preds.every((p) => p(r)));
}

/** Fold a row set into one metrics total. Used for the KPI cards, which must be computed
 *  over the UNFOCUSED rows — see the note on the report page. */
export function totalsOf(rows: ZCRow[], targetPct: number): ZCMetrics {
  const metricsOf = makeMetricsOf(targetPct);
  const acc = emptyMetrics();
  for (const r of rows) addMetrics(acc, metricsOf(r));
  return acc;
}

/** Count of rows in each severity band. Drives the band chips. */
export function bandCounts(rows: ZCRow[]): Record<CollectionBand, number> {
  const out: Record<CollectionBand, number> = {
    zero: 0, b0_10: 0, b10_20: 0, b20_30: 0, b30_plus: 0,
  };
  for (const r of rows) out[bandOf(r.facts)]++;
  return out;
}

// ── Grouping dimensions + the View presets ──────────────────────────────────────────

export type ZCDim = "salesperson" | "customer" | "group" | "category" | "company" | "location";

export const ZC_DIMENSIONS: { key: ZCDim; label: string }[] = [
  { key: "salesperson", label: "Salesperson" },
  { key: "customer",    label: "Customer" },
  { key: "group",       label: "Customer Group" },
  { key: "category",    label: "Customer Category" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
];

/** Quick "View" buttons. These are shortcuts, not the whole surface — the report renders
 *  the shared GroupByBuilder, so any dimension can be chained to any depth
 *  (e.g. Customer Group → Customer → Salesperson). */
export const ZC_PRESETS: GroupByPreset<ZCDim>[] = [
  { label: "Salesperson → Customer",   dims: ["salesperson", "customer"] },
  { label: "Customer",                 dims: ["customer"] },
  { label: "Customer Group",           dims: ["group"] },
  { label: "Customer Group → Customer", dims: ["group", "customer"] },
  { label: "Category → Customer",      dims: ["category", "customer"] },
  { label: "Company → Customer",       dims: ["company", "customer"] },
  { label: "Salesperson",              dims: ["salesperson"] },
  { label: "Location",                 dims: ["location"] },
];

/**
 * Which dimensions have a detail page behind them, and which route it is.
 *
 * The route param is the NAME, url-encoded — never an id. CustomerDetail matches the
 * decoded string against the raw ledger names (`Customer.id` is a pipeline surrogate and
 * will never resolve). A group bucket that isn't a REAL group is just an ungrouped
 * customer surfacing as its own one-row group, so it must drill into /customer/.
 *
 * Salesperson / Category / Company / Location have no detail page → no link, rather than
 * a dead one.
 */
export function detailPathFor(
  dim: ZCDim | undefined,
  label: string,
  realGroupNames: ReadonlySet<string>,
): string | null {
  const enc = encodeURIComponent(label);
  if (dim === "customer") return `/outstanding-dashboard/customer/${enc}`;
  if (dim === "group") {
    return realGroupNames.has(label)
      ? `/outstanding-dashboard/group/${enc}`
      : `/outstanding-dashboard/customer/${enc}`;
  }
  return null;
}

/** Bucket value + display label for a row on a dimension (feeds buildGroupTree). */
export function zcDimValue(r: ZCRow, dim: string): { value: string; label: string; sub?: string } {
  const c = r.customer;
  switch (dim as ZCDim) {
    case "salesperson": {
      const sp = (c.salesPersons?.length ? c.salesPersons.join(", ") : c.salesPerson) || "Others";
      return { value: sp, label: sp };
    }
    case "customer": {
      const where = [c.companies?.join(" / ") || c.company, c.locations?.join(" / ") || c.location]
        .filter(Boolean).join(" · ");
      return { value: c.name, label: c.name, sub: where || undefined };
    }
    case "group":
      return { value: r.group, label: r.group };
    case "category": {
      const cat = (c.categories?.length ? c.categories.join(", ") : c.category) || "Uncategorized";
      return { value: cat, label: cat };
    }
    case "company": {
      const co = c.companies?.join(" / ") || c.company || "—";
      return { value: co, label: co };
    }
    case "location": {
      const loc = c.locations?.join(" / ") || c.location || "—";
      return { value: loc, label: loc };
    }
    default:
      return { value: "—", label: "—" };
  }
}

// ── Columns ─────────────────────────────────────────────────────────────────────────

export type ZCColumnKey =
  | "customers" | "outstanding" | "overdue" | "over180"
  | "opening" | "salesInWindow" | "collectible" | "collected"
  | "collectionPct" | "shortfall" | "priorPct" | "deltaPp"
  | "priorCollections" | "chequeReturns" | "creditNotes"
  | "daysSinceLastReceipt" | "maxOverdueDays" | "creditLimit";

export interface ZCColumn {
  key: ZCColumnKey;
  label: string;
  /** How the cell renders: money (₹), a plain count, a day count, or a percentage. */
  kind: "money" | "count" | "days" | "pct";
  /**
   * The node's value for this column, derived from its SUMMED metrics.
   *
   * Percentages return `null` when there's no denominator — which is why this is a function
   * and not a metrics key. It is the single place a % is ever computed, and it always
   * divides the node's own totals: Σcollected / Σcollectible, never an average of children.
   */
  value: (m: ZCMetrics) => number | null;
  /** Opens the invoice drill-down when clicked (only the balance columns can). */
  drill?: "outstanding" | "overdue" | "over180";
  /** Red when it means something is wrong. */
  alarm?: boolean;
  /** A percentage column where LOW is bad (the alarm fires below the threshold). */
  lowIsBad?: boolean;
}

export const ZC_COLUMNS: ZCColumn[] = [
  { key: "customers",     label: "Customers",       kind: "count", value: (m) => m.customers },
  { key: "outstanding",   label: "Outstanding",     kind: "money", value: (m) => m.outstanding, drill: "outstanding" },
  { key: "overdue",       label: "Overdue",         kind: "money", value: (m) => m.overdue, drill: "overdue", alarm: true },
  { key: "over180",       label: "> 180 Days",      kind: "money", value: (m) => m.over180, drill: "over180", alarm: true },
  { key: "opening",       label: "Opening",         kind: "money", value: (m) => m.opening },
  { key: "salesInWindow", label: "Sales in Period", kind: "money", value: (m) => m.salesInWindow, alarm: true },
  { key: "collectible",   label: "Collectible",     kind: "money", value: (m) => m.collectible },
  { key: "collected",     label: "Collected",       kind: "money", value: (m) => m.collected },
  { key: "collectionPct", label: "Collection %",    kind: "pct",   value: (m) => pctOf(m.collected, m.collectible), lowIsBad: true },
  { key: "shortfall",     label: "Shortfall",       kind: "money", value: (m) => m.shortfall, alarm: true },
  { key: "priorPct",      label: "Prior %",         kind: "pct",   value: (m) => pctOf(m.priorCollections, m.priorCollectible) },
  {
    key: "deltaPp", label: "Δ pp", kind: "pct",
    value: (m) => {
      const cur = pctOf(m.collected, m.collectible);
      const prior = pctOf(m.priorCollections, m.priorCollectible);
      return cur === null || prior === null ? null : cur - prior;
    },
  },
  { key: "priorCollections",     label: "Prior Collections", kind: "money", value: (m) => m.priorCollections },
  { key: "chequeReturns",        label: "Cheque Returns",    kind: "money", value: (m) => m.chequeReturns, alarm: true },
  { key: "creditNotes",          label: "Credit Notes",      kind: "money", value: (m) => m.creditNotes },
  { key: "daysSinceLastReceipt", label: "Days Since Receipt", kind: "days", value: (m) => m.daysSinceLastReceipt, alarm: true },
  { key: "maxOverdueDays",       label: "Max Overdue Days",  kind: "days",  value: (m) => m.maxOverdueDays },
  { key: "creditLimit",          label: "Credit Limit",      kind: "money", value: (m) => m.creditLimit },
];

/**
 * The default (management) column set. Everything else lives behind the ColumnPicker.
 *
 * The two reports want different defaults: at threshold 0 every percentage column reads 0%
 * / "—" and only wastes width, so the zero report keeps exactly the columns it shipped with.
 */
export function defaultColumnsFor(mode: "zero" | "threshold"): ZCColumnKey[] {
  return mode === "zero"
    ? ["customers", "outstanding", "overdue", "over180", "salesInWindow", "priorCollections", "daysSinceLastReceipt"]
    : [
        "customers", "outstanding", "opening", "salesInWindow", "collectible", "collected",
        "collectionPct", "shortfall", "priorPct", "deltaPp", "chequeReturns", "creditNotes",
      ];
}

// ── Window resolution ───────────────────────────────────────────────────────────────

export type PeriodPreset = "1m" | "3m" | "6m" | "fy" | "all" | "custom";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "1m": "This Month", "3m": "Last 3 Months", "6m": "Last 6 Months",
  fy: "This FY", all: "All", custom: "Custom",
};

/**
 * Resolve a preset into the contiguous run of trend month labels it covers.
 * `months` is the org-wide month list from dashboard.trend, already in chronological order —
 * so presets are always valid whatever the FY selector is set to.
 */
export function resolveWindow(months: string[], preset: PeriodPreset): string[] {
  if (months.length === 0) return [];
  switch (preset) {
    case "1m": return months.slice(-1);
    case "3m": return months.slice(-3);
    case "6m": return months.slice(-6);
    case "fy": {
      // Everything from the latest April onward — the running financial year.
      const lastApr = months.map((m) => m.startsWith("Apr-")).lastIndexOf(true);
      return lastApr >= 0 ? months.slice(lastApr) : months;
    }
    case "all":
    case "custom":
    default:
      return months;
  }
}

/** The equal-length run of months immediately BEFORE the window (may be shorter at the
 *  start of the data horizon, or empty). Powers "Prior Collections" and the Δ. */
export function priorWindow(months: string[], window: string[]): string[] {
  if (window.length === 0) return [];
  const start = months.indexOf(window[0]);
  if (start <= 0) return [];
  return months.slice(Math.max(0, start - window.length), start);
}

/** Inclusive month-label slice, for the custom From → To pickers. */
export function monthRange(months: string[], from: string, to: string): string[] {
  const i = months.indexOf(from);
  const j = months.indexOf(to);
  if (i < 0 || j < 0) return [];
  return i <= j ? months.slice(i, j + 1) : months.slice(j, i + 1);
}
