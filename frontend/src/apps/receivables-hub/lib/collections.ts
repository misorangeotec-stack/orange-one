/**
 * collections.ts — the Collection Performance engine. Pure, UI-free.
 *
 * ONE engine, THREE reports. All three answer "where is our money stuck", from two angles:
 *
 *   threshold = 0    → "Customers with Zero Collections"  — paid us NOTHING in the period.
 *   threshold = 30   → "Customers Below 30% Collection"   — paid us less than 30% of what
 *                                                            we could have collected.
 *   dormant          → "Customers with Dues but No Sales" — owe us money and have STOPPED
 *                                                            BUYING. The sales-side question.
 *
 * Zero collection is the 0% case of the threshold report, and dormant is the exact complement
 * of its "Still Buying" lens — so all three share every line below. What differs is only the
 * predicate (`isZeroCollection` / `isBelowThreshold` / `isDormant`), the default column set
 * (`defaultColumnsFor`) and which focus lenses the page offers.
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
import { fmtINRMoney } from "./utils";
import type { GroupByPreset } from "../components/GroupByBuilder";
import type { InvoiceDrillRow } from "../components/InvoiceDrilldownDialog";
import type { ConsolidatedCustomer, Customer, CustomerDetail, SaleType } from "./types";

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

/** Money that rides in receiptTransactions but is NOT a collection: a bounced cheque
 *  ("check_return", a voucher type named CHQ.R) or a payment made out to the customer
 *  ("payment_out", a refund or an unnamed bounce). Both belong on the Due side, not the
 *  Received side (same convention as SalespersonCollectionReport). */
const isChequeReturn = (type: string | null | undefined): boolean => {
  const t = (type ?? "").toLowerCase();
  return t === "check_return" || t === "payment_out";
};

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
    }

    // Manual (non-Tally) Other Payments are real money but live outside the trend's receipts
    // (and outside Tally's monthlyReceipts), so fold them in by date. Both sources carry them:
    // the pipeline loads them, and liveOtherPayments nets them into the ConnectWave snapshot.
    for (const o of d?.otherPaymentTransactions ?? []) {
      if (!o.date) continue;
      const m = bucket(isoToMonthLabel(o.date));
      if (m) m.receipts += Math.abs(o.amount);
    }

    // ── Live only: spread the YEARLY notes across the months ──────────────────────────
    // The ConnectWave snapshot carries sales and receipts month-by-month, but credit notes,
    // debit notes, journals and cheque returns ONLY as a per-customer yearly total (the trend
    // loop above therefore left those four at 0 under Live). The opening balance is derived by
    // winding today's outstanding back through movementOf(), which reads all four — so without
    // them Below-30%'s opening drifts (mostly by the year's credit notes) and reads too soft,
    // and the Bounced card sits at 0. Fill the gap by apportioning each yearly total across the
    // customer's own months: notes by SALES weight (they arise from billing), bounces by RECEIPT
    // weight (a returned cheque reverses a receipt). Rate clamped to ±95% so a returns-heavy — or
    // single-FY-scoped — ledger can't push a month negative. Pipeline is untouched: it already
    // carries the real month-by-month figures. Same estimate the DSO report uses (dso.ts). When
    // the Tally refresh gains month-by-month notes, delete this block.
    if (source === "live") {
      let totSales = 0, totReceipts = 0;
      for (const m of byMonth.values()) { totSales += m.sales; totReceipts += m.receipts; }
      const rate = (annual: number, base: number): number =>
        base > 0.5 ? Math.min(Math.max((Number(annual) || 0) / base, -0.95), 0.95) : 0;
      const cnRate     = rate(c.creditNotes, totSales);
      const dnRate     = rate(c.debitNotes, totSales);
      const jnlRate    = rate(c.journalAdjustments, totSales);
      const bounceRate = rate(c.checkReturns, totReceipts);
      if (cnRate || dnRate || jnlRate || bounceRate) {
        for (const m of byMonth.values()) {
          m.creditNotes   += m.sales * cnRate;
          m.debitNotes    += m.sales * dnRate;
          m.journals      += m.sales * jnlRate;
          m.chequeReturns += m.receipts * bounceRate;
        }
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

/**
 * ledgerId → the ₹ amount of that ledger's MOST RECENT receipt voucher (same-day receipts
 * summed), or null when it can't be known. The date twin of this is buildLastReceiptDates;
 * they are kept as separate functions so the four other reports that consume the date map
 * (DSO, Overdue Aging, Customer Category) are untouched.
 *
 * Under LIVE the bulk snapshot carries no per-voucher DETAIL, but it does now carry this one
 * pre-computed figure: collection_customer_snapshot.last_receipt_amount, filled by a set-based
 * pass over tally_voucher_line at the end of every collection_refresh(). Deriving it in the
 * browser is not an option — that query is a 5s nested loop over ~1,800 ledgers.
 *
 * The snapshot only ever writes the amount when its own computed date agrees with the stored
 * last_receipt_date, so a null here means "genuinely unknown", never "belongs to another
 * voucher". Before the first refresh after the migration every Live row is null and the column
 * reads "—", exactly as it did before.
 */
export function buildLastReceiptAmounts(
  ledgers: Customer[],
  detail: Record<string, CustomerDetail>,
  source: CollectionsSource,
): Map<string, number | null> {
  const out = new Map<string, number | null>();

  for (const c of ledgers) {
    if (source === "live") {
      out.set(c.id, c.lastReceiptAmount ?? null);
      continue;
    }

    const d = detail[c.id];
    let last: string | null = null;
    let amount = 0;
    const consider = (date: string | null, amt: number) => {
      if (!date) return;
      if (!last || date > last) { last = date; amount = amt; }
      else if (date === last) { amount += amt; } // same-day receipts make up one "last receipt"
    };
    for (const r of d?.receiptTransactions ?? []) {
      if (isChequeReturn(r.type)) continue;
      consider(r.date, r.amount);
    }
    for (const o of d?.otherPaymentTransactions ?? []) consider(o.date, o.amount);
    out.set(c.id, last ? amount : null);
  }

  return out;
}

// ── Dominant sale type (the dormant report's scope filter) ──────────────────────────

export const SALE_TYPES: SaleType[] = ["ink", "spare_parts", "machine", "head", "other"];

/** ledgerId → its outstanding split by sale type (₹). Raw ledgers — consolidateByName trap. */
export function buildOutstandingByType(
  ledgers: Customer[],
): Map<string, Partial<Record<SaleType, number>>> {
  const out = new Map<string, Partial<Record<SaleType, number>>>();
  for (const c of ledgers) out.set(c.id, c.outstandingByType ?? {});
  return out;
}

/**
 * Where the BULK of this customer's outstanding sits. The largest single type wins.
 *
 * ── Why DOMINANT, and not "has any outstanding of a selected type" ──
 *
 * The obvious implementation keeps a customer if ANY selected type has money against it. It
 * does not work here, and the live data says so loudly: nearly every MACHINE ledger carries a
 * small `other` sliver (freight, a rate difference, a debit note), so "all types except
 * machine" would still keep GOPI KRISHNA …-MACHINE (₹9.0 Cr), SKYLARK (₹2.7 Cr), YASH PRINTS
 * (₹2.4 Cr) — 74 of the 123 dormant customers survive a filter meant to remove them, and the
 * report stays dominated by exactly what you asked to exclude.
 *
 * Ranking by the largest share instead classifies a customer by what they actually ARE to us.
 * Measured on the live book: 48 machine-dominant dormant customers holding ₹63.3 Cr drop out,
 * leaving 75 holding ₹9.5 Cr — a consumables dormancy list rather than a machine-EMI list.
 *
 * A customer with NO sale-type tags at all (12 of them today, mostly opening-balance-only
 * ledgers) is classified `other` — the catch-all bucket, which is selected by default. So
 * untagged money is visible unless you explicitly deselect "Other": this filter never hides a
 * balance silently.
 */
export function dominantSaleTypeOf(
  c: ConsolidatedCustomer,
  byType: Map<string, Partial<Record<SaleType, number>>>,
): SaleType {
  const ids = c.constituentIds?.length ? c.constituentIds : [c.id];
  const totals = {} as Record<SaleType, number>;
  for (const t of SALE_TYPES) totals[t] = 0;
  for (const id of ids) {
    const bt = byType.get(id);
    if (!bt) continue;
    // Magnitude, not sign: a credit sitting on one type still says the relationship is there.
    for (const t of SALE_TYPES) totals[t] += Math.abs(bt[t] ?? 0);
  }
  let best: SaleType = "other";
  let max = 0;
  for (const t of SALE_TYPES) {
    if (totals[t] > max) { max = totals[t]; best = t; }
  }
  return max < 0.5 ? "other" : best;
}

// ── Overdue, split by sale type (the Zero Collections card strip) ───────────────────

/**
 * The two types that should NEVER be sitting overdue.
 *
 * A machine is capital equipment paid down over months, and ink is a running consumable
 * account — some balance riding on those is the normal shape of the business. A HEAD or a
 * SPARE PART is not: both are small, one-off, fix-it-now purchases against a machine the
 * customer is already running, and they are supposed to be settled almost immediately. Money
 * stuck there is not a payment plan running its course, it is a customer who has simply not
 * paid for a part they are using — so the card turns critical the moment it is non-zero.
 */
export const CRITICAL_SALE_TYPES: SaleType[] = ["head", "spare_parts"];
export const isCriticalSaleType = (t: SaleType): boolean => CRITICAL_SALE_TYPES.includes(t);

/** Card order: the two that should never be overdue lead, then the rest in book order. */
export const SALE_TYPE_CARD_ORDER: SaleType[] = ["head", "spare_parts", "ink", "machine", "other"];

export interface SaleTypeOverdue {
  type: SaleType;
  /** How many listed customers are DOMINATED by this type. */
  customers: number;
  overdue: number;
  outstanding: number;
}

/**
 * Overdue on the listed customers, split by sale type.
 *
 * Split by the customer's DOMINANT type (dominantSaleTypeOf), not by the per-bill
 * `overdueByType` figures — deliberately, and it is the difference between a card that can be
 * clicked and one that cannot. The Sale Type FILTER, the Sale Type group-by level and these
 * cards then all cut the report the same way, so the rupees printed on a card are exactly the
 * rupees the table shows when you click it. Splitting by bill would print a number no filter on
 * this report can reproduce — every machine ledger carries a small spare-parts sliver, so a
 * "Spare Parts" card would count money belonging to customers the card cannot select.
 */
export function overdueBySaleType(
  rows: ZCRow[],
  byType: Map<string, Partial<Record<SaleType, number>>>,
): Record<SaleType, SaleTypeOverdue> {
  const out = {} as Record<SaleType, SaleTypeOverdue>;
  for (const t of SALE_TYPES) out[t] = { type: t, customers: 0, overdue: 0, outstanding: 0 };
  for (const r of rows) {
    const bucket = out[dominantSaleTypeOf(r.customer, byType)];
    bucket.customers += 1;
    bucket.overdue += r.customer.overdue;
    bucket.outstanding += r.customer.outstanding;
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
  /** Billed in the prior window (₹). Zero now + non-zero here = they JUST stopped buying,
   *  which is the one dormant customer still worth a sales call. Feeds `wentQuiet`. */
  salesInPrior: number;
  /** Cheque returns inside the window (₹) — they "paid" and it bounced. */
  chequeReturns: number;
  /** Credit notes inside the window (₹) — bills cleared without cash. */
  creditNotes: number;
  /**
   * Net journal CREDIT inside the window (₹), clamped >= 0 — the amount journals REDUCED the
   * balance by (inter-company settlements: paid in one company, moved across by journal). This
   * is a display figure; whether it is folded into `collected`/`inWindow` (and so removes a
   * customer from the zero/below-threshold list) is decided by the `includeJournalSettlement`
   * flag passed to factsForScoped. Net rule: a window whose journals sum to a DEBIT (they owe
   * more — interest, rate diffs) contributes 0, so a charge is never mistaken for a payment.
   */
  journalSettledInWindow: number;

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
  /** ₹ of the voucher behind lastReceiptDate (from the ledger that owns the latest date).
   *  null = never paid, or the source hasn't got the figure yet (Live carries it from the
   *  snapshot's last_receipt_amount, which is null until the first refresh after that column
   *  was added). */
  lastReceiptAmount?: number | null;

  /**
   * The most recent month with ANY billing, across all constituent ledgers ("Jun-25").
   * null = nothing billed anywhere in the data horizon — which is NOT "never bought from us",
   * only "not since the horizon began". The UI must say so.
   *
   * Month grain, from the trend, deliberately: `CustomerDetail.invoices` would give a day-exact
   * date, but the per-FY bundle DROPS fully-paid early bills (supabaseFetcher.ts), so the
   * ABSENCE of an invoice is not proof of no sale. The trend is the only sound negative test,
   * and it is the only sales source that exists in BOTH the pipeline and live backends.
   */
  lastSaleMonth: string | null;
  /** Months from lastSaleMonth to the window's last month. NEVER_SOLD when never billed. */
  monthsSinceLastSale: number;
}

/**
 * The last month this ledger billed anything, or null. Scans the FULL month vocabulary, not
 * the window — the whole question is how far back you have to go.
 */
export function lastSaleMonthOf(
  byMonth: Map<string, MonthFacts> | undefined,
  months: string[],
): string | null {
  if (!byMonth) return null;
  for (let i = months.length - 1; i >= 0; i--) {
    const m = byMonth.get(months[i]);
    if (m && m.sales > 0.5) return months[i];
  }
  return null;
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
  includeJournalSettlement = false,
  lastAmounts?: Map<string, number | null>,
): CollectionFacts {
  return factsForScoped(c, series, lastDates, balances, months, windowMonths, priorMonths, asOfDate, null, includeJournalSettlement, lastAmounts);
}

/**
 * factsFor, restricted to a subset of the customer's ledgers.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────
 * A ConsolidatedCustomer's `constituentIds` span EVERY ledger it trades under, ignoring
 * whatever company / location / salesperson filter the calling report has applied. A report
 * that filters to one company and then reads plain `factsFor` shows that company's balances
 * beside the customer's ALL-INDIA sales and receipts — so Collection % is silently wrong and
 * the grand total ties to nothing. That is the exact bug overdueAging.ts:63-73 is shaped to
 * avoid, and it is why it refuses to call factsFor at all.
 *
 * Passing the in-scope ledger ids fixes it properly. Every ledger's opening and flows are
 * derived INDEPENDENTLY and then summed (see openingForLedger — it is per-ledger, anchored on
 * that ledger's own canonical balance), so restricting the id set is exact, not an
 * approximation: the identity Opening + Sales + DN + Jnl − (Collected − Bounced) − CN =
 * Outstanding still holds, over the scoped ledgers.
 *
 * `scopeIds = null` means "no scope" and is byte-for-byte the old behaviour.
 */
export function factsForScoped(
  c: ConsolidatedCustomer,
  series: Map<string, Map<string, MonthFacts>>,
  lastDates: Map<string, string | null>,
  balances: Map<string, number>,
  months: string[],
  windowMonths: string[],
  priorMonths: string[],
  asOfDate: string,
  scopeIds: ReadonlySet<string> | null,
  includeJournalSettlement = false,
  lastAmounts?: Map<string, number | null>,
): CollectionFacts {
  const all = c.constituentIds?.length ? c.constituentIds : [c.id];
  const ids = scopeIds ? all.filter((id) => scopeIds.has(id)) : all;

  let inWindow = 0, inPrior = 0, salesInWindow = 0, chequeReturns = 0, creditNotes = 0;
  let salesInPrior = 0;
  // Signed net journals (Dr − Cr) across the scoped ledgers in the window. Summed BEFORE the
  // clamp so one ledger's charge can offset another's settlement — the user's "net" rule.
  let journalInWindowRaw = 0;
  let openingRaw = 0, priorOpeningRaw = 0;
  let lastReceiptDate: string | null = null;
  let lastReceiptAmount: number | null = null;
  let lastSaleMonth: string | null = null;

  for (const id of ids) {
    const byMonth = series.get(id);
    inWindow      += sumMonths(byMonth, windowMonths, (m) => m.receipts);
    inPrior       += sumMonths(byMonth, priorMonths,  (m) => m.receipts);
    salesInWindow += sumMonths(byMonth, windowMonths, (m) => m.sales);
    salesInPrior  += sumMonths(byMonth, priorMonths,  (m) => m.sales);
    chequeReturns += sumMonths(byMonth, windowMonths, (m) => m.chequeReturns);
    creditNotes   += sumMonths(byMonth, windowMonths, (m) => m.creditNotes);
    journalInWindowRaw += sumMonths(byMonth, windowMonths, (m) => m.journals);

    if (windowMonths.length)
      openingRaw += openingForLedger(id, series, balances, months, windowMonths[0]);
    if (priorMonths.length)
      priorOpeningRaw += openingForLedger(id, series, balances, months, priorMonths[0]);

    const last = lastDates.get(id) ?? null;
    // The consolidated customer's last receipt is its most-recently-paying ledger's — take
    // that ledger's amount alongside its date so the two always describe the same voucher.
    if (last && (!lastReceiptDate || last > lastReceiptDate)) {
      lastReceiptDate = last;
      lastReceiptAmount = lastAmounts?.get(id) ?? null;
    }

    // The consolidated customer is as alive as its MOST RECENTLY active ledger. Compared by
    // position in `months`, never as a string — "Sep-25" < "Apr-25" lexically.
    const sale = lastSaleMonthOf(byMonth, months);
    if (sale && (!lastSaleMonth || months.indexOf(sale) > months.indexOf(lastSaleMonth)))
      lastSaleMonth = sale;
  }

  // Distance back from the window's LAST month (the as-of month), so "sold in the final month
  // of the window" is 0 and a dormant customer is always >= windowMonths.length.
  const endIdx = windowMonths.length
    ? months.indexOf(windowMonths[windowMonths.length - 1])
    : months.length - 1;
  const saleIdx = lastSaleMonth ? months.indexOf(lastSaleMonth) : -1;
  const monthsSinceLastSale =
    saleIdx < 0 || endIdx < 0 ? NEVER_SOLD : Math.max(0, endIdx - saleIdx);

  // Clamp deliberately (trap 2): a customer sitting in advance had nothing to collect from
  // their opening — but they may still have bought during the window.
  const opening = Math.max(0, openingRaw);
  const collectible = opening + salesInWindow;
  // Net journal credit = the amount journals REDUCED the balance by (negative net = credit).
  // A window that nets to a journal debit contributes 0 (a charge is never a "payment").
  const journalSettledInWindow = Math.max(0, -journalInWindowRaw);
  // When the toggle is on, a journal settlement counts as collected — so it lifts the zero /
  // below-threshold test and the Collection %. When off, `collected` is receipts-only, exactly
  // as before. `journalSettledInWindow` is still reported (its own column) either way.
  const collected = inWindow + (includeJournalSettlement ? journalSettledInWindow : 0);
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
    salesInPrior,
    chequeReturns,
    creditNotes,
    journalSettledInWindow,
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
    lastReceiptAmount,
    lastSaleMonth,
    monthsSinceLastSale,
  };
}

// ── The same facts, for an arbitrary DATE range ─────────────────────────────────────

/**
 * One ledger's day-level totals for a chosen From→To range, straight from the
 * `collection_range_facts` RPC. Rupees; `journals` is signed (Dr − Cr).
 *
 * `mvSinceFrom` / `mvSincePriorFrom` are the movement (in movementOf's sense) from that date
 * through the as-of date — what the canonical outstanding has to be wound BACK through to get
 * the opening balance. The RPC computes them with movementOf's exact formula.
 */
export interface RangeFacts {
  receipts: number;
  sales: number;
  creditNotes: number;
  debitNotes: number;
  journals: number;
  chequeReturns: number;
  priorReceipts: number;
  priorSales: number;
  mvSinceFrom: number;
  mvSincePriorFrom: number;
}

/**
 * factsForScoped's TWIN, for a date range instead of a run of whole months.
 *
 * ── Why a twin and not a parameter ────────────────────────────────────────────────────────
 * Everything the monthly path reads is bucketed by month (the ConnectWave snapshot stores
 * sales/receipts as a month→totals jsonb), so a date range simply cannot be answered from it —
 * the numbers would silently round to whole months. This reads day-level vouchers instead.
 *
 * THE TWO MUST STAY IN STEP. Every line of arithmetic below is deliberately identical to
 * factsForScoped: the same clamps, the same journal netting rule, the same collectible
 * definition, the same trap-1 and trap-2 handling. Only the SOURCE of the six per-window
 * figures differs. If you change a rule there, change it here.
 *
 * ── Where the two agree, and where this one is BETTER ─────────────────────────────────────
 * Receipts and Sales tie exactly: a range covering N whole months reproduces the N-month preset
 * to the rupee (verified over Jun–Aug 2026: 1,831 ledgers, ₹69.50 Cr receipts, ₹75.81 Cr sales,
 * zero mismatches). Anything listed by a receipts-only predicate — the whole Zero-Collection
 * report — is therefore identical either way.
 *
 * Opening / Collectible / Collection % can legitimately DIFFER, and when they do this side is
 * the accurate one. Under Live the monthly path has only sales and receipts per month; credit
 * notes, debit notes, journals and cheque returns exist in the snapshot as a per-customer YEARLY
 * total, which buildMonthlySeries spreads across months by sales/receipt weight (see its "Live
 * only: spread the YEARLY notes" block — it says outright that it is an estimate). This path
 * reads all four on their real voucher dates. Measured over Jun–Aug 2026: 225 of 1,831 ledgers
 * differ, ₹3.30 Cr of movement; 613 ledgers carry ₹56.23 Cr of such notes this FY. Do not
 * "reconcile" the two by degrading this one.
 *
 * Sale recency (`lastSaleMonth` / `monthsSinceLastSale`) stays on the MONTH series, because it
 * is a month-grain question by definition — see the CollectionFacts note on lastSaleMonth.
 * `windowMonths` is therefore still passed, as the months the date range touches.
 */
export function factsForRange(
  c: ConsolidatedCustomer,
  range: Map<string, RangeFacts>,
  series: Map<string, Map<string, MonthFacts>>,
  lastDates: Map<string, string | null>,
  balances: Map<string, number>,
  months: string[],
  windowMonths: string[],
  hasPrior: boolean,
  asOfDate: string,
  scopeIds: ReadonlySet<string> | null = null,
  includeJournalSettlement = false,
  lastAmounts?: Map<string, number | null>,
): CollectionFacts {
  const all = c.constituentIds?.length ? c.constituentIds : [c.id];
  const ids = scopeIds ? all.filter((id) => scopeIds.has(id)) : all;

  let inWindow = 0, inPrior = 0, salesInWindow = 0, chequeReturns = 0, creditNotes = 0;
  let salesInPrior = 0;
  let journalInWindowRaw = 0;
  let openingRaw = 0, priorOpeningRaw = 0;
  let lastReceiptDate: string | null = null;
  let lastReceiptAmount: number | null = null;
  let lastSaleMonth: string | null = null;

  for (const id of ids) {
    const rf = range.get(id);
    if (rf) {
      inWindow      += rf.receipts;
      inPrior       += rf.priorReceipts;
      salesInWindow += rf.sales;
      salesInPrior  += rf.priorSales;
      chequeReturns += rf.chequeReturns;
      creditNotes   += rf.creditNotes;
      journalInWindowRaw += rf.journals;
    }
    // Opening is derived PER LEDGER from that ledger's own canonical balance and summed raw —
    // the same contract as openingForLedger, for the same reason (see its header). A ledger with
    // no vouchers in range still has an opening: its balance, unmoved.
    const bal = balances.get(id) ?? 0;
    openingRaw += bal - (rf?.mvSinceFrom ?? 0);
    if (hasPrior) priorOpeningRaw += bal - (rf?.mvSincePriorFrom ?? 0);

    const last = lastDates.get(id) ?? null;
    if (last && (!lastReceiptDate || last > lastReceiptDate)) {
      lastReceiptDate = last;
      lastReceiptAmount = lastAmounts?.get(id) ?? null;
    }

    const sale = lastSaleMonthOf(series.get(id), months);
    if (sale && (!lastSaleMonth || months.indexOf(sale) > months.indexOf(lastSaleMonth)))
      lastSaleMonth = sale;
  }

  const endIdx = windowMonths.length
    ? months.indexOf(windowMonths[windowMonths.length - 1])
    : months.length - 1;
  const saleIdx = lastSaleMonth ? months.indexOf(lastSaleMonth) : -1;
  const monthsSinceLastSale =
    saleIdx < 0 || endIdx < 0 ? NEVER_SOLD : Math.max(0, endIdx - saleIdx);

  const opening = Math.max(0, openingRaw);
  const collectible = opening + salesInWindow;
  const journalSettledInWindow = Math.max(0, -journalInWindowRaw);
  const collected = inWindow + (includeJournalSettlement ? journalSettledInWindow : 0);
  const collectedNet = Math.max(0, collected - chequeReturns);

  const priorCollectible = hasPrior ? Math.max(0, priorOpeningRaw) + salesInPrior : 0;

  const pct = pctOf(collected, collectible);
  const pctNet = pctOf(collectedNet, collectible);
  const pctEff = pct === null || pctNet === null ? null : Math.min(pct, pctNet);
  const priorPct = hasPrior ? pctOf(inPrior, priorCollectible) : null;

  return {
    inWindow,
    inPrior,
    salesInWindow,
    salesInPrior,
    chequeReturns,
    creditNotes,
    journalSettledInWindow,
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
    lastReceiptAmount,
    lastSaleMonth,
    monthsSinceLastSale,
  };
}

// ── The three predicates ────────────────────────────────────────────────────────────

/**
 * A customer collected nothing in the window. Strict: any collection at all disqualifies.
 *
 * Reads `f.collected`, which is receipts + manual Other Payments and — when the caller passed
 * `includeJournalSettlement` to factsFor(Scoped) — the net journal settlement too. With the
 * flag off, `collected === inWindow`, so this is bit-for-bit the original receipt-only test.
 * Needs NO denominator, so it still catches a customer with an empty collectible pool.
 */
export const isZeroCollection = (f: CollectionFacts): boolean => f.collected < ZERO_EPS;

/**
 * A customer collected less than `thresholdPct` of what we could have collected.
 *
 * Reads `pctEff` (the worse of gross and net-of-cheque-returns), so a customer whose only
 * "payment" bounced is listed — see trap 1. Customers with nothing to collect are excluded:
 * a percentage of nothing is undefined, not 0%.
 */
export const isBelowThreshold = (f: CollectionFacts, thresholdPct: number): boolean =>
  f.collectible >= COLLECTIBLE_EPS && f.pctEff !== null && f.pctEff < thresholdPct;

/**
 * A customer billed NOTHING in the window — they've stopped buying. Paired with the report's
 * outstanding > 0 gate, that's a dormant debtor: money stuck in a dead relationship.
 *
 * The ₹0.5 guard is deliberately the SAME one `ZC_FOCUS_PREDICATES.buying` uses, so the two
 * are exact complements and no rounding dust can fall between them. Change one, change both.
 *
 * Needs no denominator (like isZeroCollection, unlike isBelowThreshold): a customer who bought
 * nothing AND had nothing collectible is still a dormant debtor if they owe us money.
 */
export const isDormant = (f: CollectionFacts): boolean => f.salesInWindow <= 0.5;

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
  /**
   * Overdue NET of On Account — the same figure every other page shows, and the reason this
   * report's Overdue never equals the sum of its own overdue bills. See `onAccount` below.
   */
  overdue: number;
  /** Σ pending of past-due bills BEFORE On Account. The bill-wise figure. */
  overdueGross: number;
  /**
   * Money the customer has already paid that settles no open invoice (untagged receipts, or
   * credit filed against a bill reference), capped per ledger at that ledger's own gross
   * overdue. `overdue === overdueGross − onAccount` at every level, because the cap is applied
   * per ledger in the database before the browser sees it — which is what lets customer, group
   * and grand-total rows all reconcile by plain addition.
   */
  onAccount: number;
  over180: number;
  opening: number;
  salesInWindow: number;
  collectible: number;
  collected: number;
  /** Portion of `collected` that came from journal settlements (net journal credit). */
  journalSettled: number;
  shortfall: number;
  priorCollections: number;
  priorCollectible: number;
  chequeReturns: number;
  creditNotes: number;
  maxOverdueDays: number;
  /** Worst (largest) days-since-last-receipt in the group. NEVER_PAID when any never paid. */
  daysSinceLastReceipt: number;
  /** Most recent receipt date as a yyyymmdd ordinal (0 = none). Leaf-only on screen — folded
   *  with MAX only to stay well-typed for grand totals. */
  lastReceiptAt: number;
  /** ₹ of the last receipt voucher (0 = none/unknown). Leaf-only on screen. */
  lastReceiptAmount: number;
  /** Worst (largest) months-since-last-sale in the group. NEVER_SOLD when any never billed. */
  monthsSinceLastSale: number;
  neverPaid: number;
  /** Never billed anything in the whole data horizon. */
  neverSold: number;
  stillBuying: number;
  /** Was buying in the prior window, billed nothing in this one — they JUST went quiet. */
  wentQuiet: number;
  bounced: number;
  deteriorating: number;
  zeroCollectors: number;
  creditLimit: number;
  /** Agreed credit period in days, from the Tally master. -1 = none set (renders "—", not "0d").
   *  Leaf-only on screen: credit terms are a per-customer fact and summing them is meaningless. */
  creditDays: number;
}

/** Sentinel for "no receipt in the entire data horizon" — sorts as the worst possible. */
export const NEVER_PAID = Number.MAX_SAFE_INTEGER;

/** Sentinel for "no SALE in the entire data horizon" — sorts as the worst possible. Same
 *  MAX-rollup contract as NEVER_PAID: a group inherits it if any member carries it. */
export const NEVER_SOLD = Number.MAX_SAFE_INTEGER;

/** A collection % has fallen this many points below the prior window → "deteriorating". */
export const DETERIORATION_PP = 10;

export const emptyMetrics = (): ZCMetrics => ({
  customers: 0, outstanding: 0, overdue: 0, overdueGross: 0, onAccount: 0, over180: 0,
  opening: 0, salesInWindow: 0, collectible: 0, collected: 0, journalSettled: 0, shortfall: 0,
  priorCollections: 0, priorCollectible: 0, chequeReturns: 0, creditNotes: 0,
  maxOverdueDays: 0, daysSinceLastReceipt: -1, monthsSinceLastSale: -1,
  lastReceiptAt: 0, lastReceiptAmount: 0,
  neverPaid: 0, neverSold: 0, stillBuying: 0, wentQuiet: 0, bounced: 0,
  deteriorating: 0, zeroCollectors: 0,
  creditLimit: 0, creditDays: -1,
});

/**
 * `metricsOf` needs the target to compute Shortfall, and buildGroupTree wants a plain
 * (row) => metrics — so it's curried. Memoise the result on `targetPct` at the call site.
 */
/** "2026-06-18" → 20260618. 0 for null/malformed — sorts and MAX-folds as "no receipt". */
const ymdOrdinal = (iso: string | null): number => {
  if (!iso) return 0;
  const n = Number(iso.slice(0, 10).replace(/-/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const makeMetricsOf = (targetPct: number) => (r: ZCRow): ZCMetrics => {
  const c = r.customer;
  const f = r.facts;
  const never = f.lastReceiptDate === null;
  const neverSold = f.lastSaleMonth === null;
  return {
    customers: 1,
    outstanding: c.outstanding,
    overdue: c.overdue,
    // Both sides of the Overdue bridge. `?? c.overdue` / `?? 0` is the legacy-pipeline fallback:
    // that feed carries no split, so gross reads equal to net and On Account reads ₹0 — which is
    // true of it, rather than a guess.
    overdueGross: c.overdueGross ?? c.overdue,
    onAccount: c.onAccount ?? 0,
    over180: c.agingBuckets?.["180_plus"] ?? 0,
    opening: f.opening,
    salesInWindow: f.salesInWindow,
    collectible: f.collectible,
    collected: f.collected,
    journalSettled: f.journalSettledInWindow,
    shortfall: shortfallOf(f, targetPct),
    priorCollections: f.inPrior,
    priorCollectible: f.priorCollectible,
    chequeReturns: f.chequeReturns,
    creditNotes: f.creditNotes,
    maxOverdueDays: c.maxOverdueDays ?? 0,
    daysSinceLastReceipt: never ? NEVER_PAID : (f.daysSinceLastReceipt ?? -1),
    lastReceiptAt: ymdOrdinal(f.lastReceiptDate),
    lastReceiptAmount: f.lastReceiptAmount ?? 0,
    monthsSinceLastSale: f.monthsSinceLastSale,
    neverPaid: never ? 1 : 0,
    neverSold: neverSold ? 1 : 0,
    stillBuying: f.salesInWindow > 0 ? 1 : 0,
    wentQuiet: f.salesInPrior > 0.5 && f.salesInWindow <= 0.5 ? 1 : 0,
    bounced: f.chequeReturns > 0.5 ? 1 : 0,
    deteriorating: f.deltaPp !== null && f.deltaPp < -DETERIORATION_PP ? 1 : 0,
    zeroCollectors: f.collected < ZERO_EPS ? 1 : 0,
    creditLimit: c.creditLimit ?? 0,
    // ~half the Tally masters carry no credit period. -1 (not 0) so `daysText` renders "—" —
    // "0d" would read as "cash only", which is a different and much harsher claim.
    creditDays: (c.creditPeriod ?? 0) > 0 ? c.creditPeriod : -1,
  };
};

export function addMetrics(acc: ZCMetrics, m: ZCMetrics): void {
  acc.customers        += m.customers;
  acc.outstanding      += m.outstanding;
  acc.overdue          += m.overdue;
  acc.overdueGross     += m.overdueGross;
  acc.onAccount        += m.onAccount;
  acc.over180          += m.over180;
  acc.opening          += m.opening;
  acc.salesInWindow    += m.salesInWindow;
  acc.collectible      += m.collectible;
  acc.collected        += m.collected;
  acc.journalSettled   += m.journalSettled;
  acc.shortfall        += m.shortfall;
  acc.priorCollections += m.priorCollections;
  acc.priorCollectible += m.priorCollectible;
  acc.chequeReturns    += m.chequeReturns;
  acc.creditNotes      += m.creditNotes;
  acc.neverPaid        += m.neverPaid;
  acc.neverSold        += m.neverSold;
  acc.stillBuying      += m.stillBuying;
  acc.wentQuiet        += m.wentQuiet;
  acc.bounced          += m.bounced;
  acc.deteriorating    += m.deteriorating;
  acc.zeroCollectors   += m.zeroCollectors;
  acc.creditLimit      += m.creditLimit;
  acc.lastReceiptAmount += m.lastReceiptAmount; // leaf-only on screen; summed to stay well-typed
  // Non-summable: the group inherits its worst member.
  acc.maxOverdueDays       = Math.max(acc.maxOverdueDays, m.maxOverdueDays);
  acc.daysSinceLastReceipt = Math.max(acc.daysSinceLastReceipt, m.daysSinceLastReceipt);
  acc.monthsSinceLastSale  = Math.max(acc.monthsSinceLastSale, m.monthsSinceLastSale);
  acc.lastReceiptAt        = Math.max(acc.lastReceiptAt, m.lastReceiptAt);
  // Credit terms fold with MAX for the same reason consolidateByName does it across a customer's
  // ledgers. It MUST be folded even though the column is leaf-only: a leaf node's metrics are
  // also built by accumulating onto emptyMetrics(), so leaving it out doesn't "keep the leaf's
  // value" — it strands every row on the -1 sentinel and the whole column renders "—".
  acc.creditDays           = Math.max(acc.creditDays, m.creditDays);
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
  | "partial" | "deteriorating" | "bounced"
  | "paidNothing" | "wentQuiet" | "neverSold";

export const ZC_FOCUS_LABELS: Record<ZCFocus, string> = {
  overdue: "Overdue Locked",
  never:   "Never Paid",
  buying:  "Still Buying",
  over180: "> 180 Days",
  partial: "Partial Payers",
  deteriorating: "Deteriorating",
  bounced: "Bounced",
  paidNothing: "Paid Nothing Either",
  wentQuiet:   "Recently Gone Quiet",
  neverSold:   "Never Sold in Horizon",
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

  // ── Dormant-report lenses ──
  // Collected nothing either. The exact inverse of `partial`; on the dormant report this is
  // the damning subset — stopped buying AND stopped paying. Dead and stuck.
  paidNothing: (r) => r.facts.collected < ZERO_EPS,
  // Was buying last period, billed nothing this one. The dormant customers you can still
  // SAVE — as opposed to the long-dead, who are a collections problem, not a sales one.
  wentQuiet: (r) => r.facts.salesInPrior > 0.5 && r.facts.salesInWindow <= 0.5,
  // Nothing billed anywhere in the data horizon — not "never bought", see lastSaleMonth.
  neverSold: (r) => r.facts.lastSaleMonth === null,
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

// ── The bills behind a figure ───────────────────────────────────────────────────────

/** What a drillable column resolves to. Mirrors `ZCColumn.drill`. */
export type ZCDrill = NonNullable<ZCColumn["drill"]>;

export interface DrillRowsResult {
  /** Bill lines first, then the On Account credit lines — the order the popup expects. */
  rows: InvoiceDrillRow[];
  /** The report's own NET figure per ledger key (`name|||company|||location`), so a consumer
   *  can strike the reconciliation line that makes gross bills agree with the net column. */
  ledgerFigures: Record<string, number>;
}

/**
 * The bill-level rows behind Outstanding / Overdue / > 180 Days, for a set of consolidated
 * customer ids.
 *
 * ONE builder, two consumers: the on-screen drill-down popup and the Excel export's
 * "Overdue Bill Details" sheet. They MUST agree — the popup lists GROSS bills while the report's
 * Overdue column is net of On Account, and reconciling the two is the whole reason the On Account
 * line exists. Two copies of this logic would drift, and the drift would look like a data bug.
 *
 * Only Overdue emits the explicit credit line, because `Customer.onAccount` is defined as the
 * credit netted off GROSS OVERDUE and capped there. Outstanding is already a net ledger balance
 * (deducting again would double-count) and the > 180 bucket is bill-based with no per-bucket
 * allocation, so both are left to the caller's generic reconciliation.
 */
export function buildDrillRows(
  ids: readonly string[],
  rowsById: ReadonlyMap<string, ZCRow>,
  customerDetail: Record<string, CustomerDetail>,
  drill: ZCDrill,
): DrillRowsResult {
  const rows: InvoiceDrillRow[] = [];
  const onAcctRows: InvoiceDrillRow[] = [];
  // Keyed exactly as the popup buckets ledgers: name ||| company ||| location.
  const ledgerFigures: Record<string, number> = {};

  for (const id of ids) {
    const r = rowsById.get(id);
    if (!r) continue;
    const c = r.customer;
    const key = `${c.name}|||${c.company}|||${c.location}`;
    // Same convention as zcDimValue's "salesperson" bucket, so the Excel export's bill sheet
    // files a customer under exactly the salesperson the roll-up sheet files them under.
    const salesperson = (c.salesPersons?.length ? c.salesPersons.join(", ") : c.salesPerson) || "Others";
    const net =
      drill === "outstanding" ? c.outstanding
      : drill === "overdue" ? c.overdue
      : (c.agingBuckets?.["180_plus"] ?? 0);
    ledgerFigures[key] = (ledgerFigures[key] ?? 0) + net;

    const onAccount = c.onAccount ?? 0;
    if (drill === "overdue" && onAccount > 0.5) {
      onAcctRows.push({
        customerName: c.name, groupName: r.group, company: c.company, location: c.location, salesperson,
        number: "", billRefName: "", date: "",
        amount: 0, received: 0, pending: -onAccount,
        dueDate: "", overdueDays: 0, status: "pending", voucherType: "other",
        isOnAccount: true,
        onAccountLabel: "On Account (paid, tagged to no bill)",
      });
    }

    // A consolidated row's bills live under its constituent LEDGER ids.
    const ledgerIds = c.constituentIds?.length ? c.constituentIds : [c.id];
    for (const lid of ledgerIds) {
      for (const inv of customerDetail[lid]?.invoices ?? []) {
        if (inv.pending <= 0) continue;
        if (drill === "overdue" && inv.overdueDays <= 0) continue;
        if (drill === "over180" && inv.overdueDays <= 180) continue;
        rows.push({
          customerName: c.name,
          groupName: r.group,
          company: c.company,
          location: c.location,
          salesperson,
          number: inv.number,
          billRefName: inv.billRefName,
          date: inv.date,
          amount: inv.amount,
          received: inv.amount - inv.pending,
          pending: inv.pending,
          dueDate: inv.dueDate,
          overdueDays: inv.overdueDays,
          status: inv.status,
          voucherType: inv.voucherType,
        });
      }
    }
  }

  return { rows: [...rows, ...onAcctRows], ledgerFigures };
}

// ── Grouping dimensions + the View presets ──────────────────────────────────────────

export type ZCDim = "salesperson" | "customer" | "group" | "category" | "company" | "location" | "saleType";

export const ZC_DIMENSIONS: { key: ZCDim; label: string }[] = [
  { key: "salesperson", label: "Salesperson" },
  { key: "customer",    label: "Customer" },
  { key: "group",       label: "Customer Group" },
  { key: "category",    label: "Customer Category" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
  { key: "saleType",    label: "Sale Type" },
];

/** Quick "View" buttons. These are shortcuts, not the whole surface — the report renders
 *  the shared GroupByBuilder, so any dimension can be chained to any depth
 *  (e.g. Customer Group → Customer → Salesperson).
 *
 *  The first two are the reports' own opening views (see `defaultGroupByFor`). They are listed
 *  because GroupByBuilder highlights a chip only on an exact dimension-for-dimension match: with
 *  no preset behind the default, the View row came up on first load with nothing lit, and the
 *  grouping you were looking at appeared to be one nobody had chosen. */
export const ZC_PRESETS: GroupByPreset<ZCDim>[] = [
  { label: "Salesperson → Customer Group", dims: ["salesperson", "group"] },
  { label: "Salesperson → Customer → Sale Type", dims: ["salesperson", "customer", "saleType"] },
  { label: "Salesperson → Customer Group → Sale Type", dims: ["salesperson", "group", "saleType"] },
  { label: "Salesperson → Customer",   dims: ["salesperson", "customer"] },
  { label: "Customer",                 dims: ["customer"] },
  { label: "Customer Group",           dims: ["group"] },
  { label: "Customer Group → Customer", dims: ["group", "customer"] },
  { label: "Category → Customer",      dims: ["category", "customer"] },
  { label: "Company → Customer",       dims: ["company", "customer"] },
  { label: "Sale Type",                dims: ["saleType"] },
  { label: "Sale Type → Customer",     dims: ["saleType", "customer"] },
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

/**
 * Bucket value + display label for a row on a dimension (feeds buildGroupTree).
 *
 * Typed on the structural minimum rather than ZCRow so the Overdue Aging report (lib/overdueAging)
 * shares one set of group labels, sub-labels and drill-through targets with the two collection
 * reports instead of forking them. Widening a parameter is contravariant-safe: ZCRow still fits.
 * (`ZC_FOCUS_PREDICATES` is NOT shared — see the note on OA_FOCUS_PREDICATES.)
 */
export function zcDimValue(
  r: { customer: ConsolidatedCustomer; group: string },
  dim: string,
): { value: string; label: string; sub?: string } {
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
  | "customers" | "outstanding" | "overdue" | "overdueGross" | "onAccount" | "over180"
  | "opening" | "salesInWindow" | "collectible" | "collected" | "journalSettled"
  | "collectionPct" | "shortfall" | "priorPct" | "deltaPp"
  | "priorCollections" | "chequeReturns" | "creditNotes"
  | "daysSinceLastReceipt" | "lastReceipt" | "lastReceiptAmount"
  | "monthsSinceLastSale" | "maxOverdueDays" | "creditLimit" | "creditDays";

export interface ZCColumn {
  key: ZCColumnKey;
  label: string;
  /** How the cell renders: money (₹), a plain count, a day count, a month count, a %, or a date. */
  kind: "money" | "count" | "days" | "pct" | "months" | "date";
  /**
   * One line, in plain English, on what the column means and why it matters — shown on hover
   * over the table header. A header is four words wide; this is where the rest of the sentence
   * goes, so a reader never has to open "How this report is calculated" to read a column.
   */
  help: string;
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
  /** A per-customer fact that can't be summed — shown only on leaf rows, "—" on group rows
   *  and the grand total (the same reason "Last Sale Month" never went on screen). */
  leafOnly?: boolean;
  /**
   * A small second line printed UNDER the figure, on every row that has one.
   *
   * Exists for exactly one job: a column whose value has already had something taken off it has
   * to say so on the row itself. Overdue is net of On Account, so a reader comparing it against
   * the bills behind it finds a gap and has no way to know why. A tooltip is not enough — nobody
   * hovers a number they have no reason to doubt. Same treatment, same wording, as the Salesperson
   * Collection Report's "less On Account" line under Due Pending.
   */
  note?: (m: ZCMetrics) => string | null;
}

export const ZC_COLUMNS: ZCColumn[] = [
  { key: "customers",     label: "Customers",       kind: "count", value: (m) => m.customers,
    help: "How many customers are rolled up into this row." },
  { key: "outstanding",   label: "Outstanding",     kind: "money", value: (m) => m.outstanding, drill: "outstanding",
    help: "Everything this row still owes as on the report date. Click to see the bills behind it." },
  { key: "overdue",       label: "Overdue",         kind: "money", value: (m) => m.overdue, drill: "overdue", alarm: true,
    // Says on the row itself that the figure is already net. Without it the number silently
    // disagrees with its own drill-down, which is where this started.
    note: (m) => (m.onAccount > 0.5 ? `less On Account ${fmtINRMoney(m.onAccount)}` : null),
    help: "The part of Outstanding that is already past its due date, AFTER setting off On Account (money paid but tagged to no bill). Gross overdue minus On Account." },
  // The two halves of the Overdue bridge, for anyone who wants them as real, sortable, exportable
  // columns rather than as the note under Overdue. Off by default: the note answers the question
  // for most readers, and these would be two more columns on an already wide call-list.
  { key: "overdueGross",  label: "Overdue (Gross)", kind: "money", value: (m) => m.overdueGross, alarm: true,
    help: "Overdue before On Account is set off: the straight sum of what is pending on every past-due bill. This is the figure the drill-down lists." },
  { key: "onAccount",     label: "On Account",      kind: "money", value: (m) => m.onAccount,
    help: "Money the customer has already paid that settles no specific bill (advances, credit notes, untagged receipts). It is subtracted from Gross to give Overdue." },
  { key: "over180",       label: "> 180 Days",      kind: "money", value: (m) => m.over180, drill: "over180", alarm: true,
    help: "Unpaid for more than six months. The oldest money on the book, and the hardest to recover." },
  { key: "opening",       label: "Opening",         kind: "money", value: (m) => m.opening,
    help: "What this row already owed at the START of the period, before anything was billed in it." },
  { key: "salesInWindow", label: "Sales in Period", kind: "money", value: (m) => m.salesInWindow, alarm: true,
    help: "What we billed them during the period. A large figure here means we kept selling to a non-payer." },
  { key: "collectible",   label: "Collectible",     kind: "money", value: (m) => m.collectible,
    help: "Everything we could have collected in the period: Opening + Sales in Period. The denominator of Collection %." },
  { key: "collected",     label: "Collected",       kind: "money", value: (m) => m.collected,
    help: "Cash that actually came in during the period: receipt vouchers plus manual Other Payments." },
  { key: "journalSettled", label: "Journal Settled", kind: "money", value: (m) => m.journalSettled,
    help: "Dues cleared by a journal entry (typically an inter-company adjustment) rather than by cash." },
  { key: "collectionPct", label: "Collection %",    kind: "pct",   value: (m) => pctOf(m.collected, m.collectible), lowIsBad: true,
    help: "Collected ÷ Collectible, so how much of what was due actually came in. Group rows are weighted, never averaged." },
  { key: "shortfall",     label: "Shortfall",       kind: "money", value: (m) => m.shortfall, alarm: true,
    help: "Rupees short of the target collection. The size of the gap to chase, not just a percentage." },
  { key: "priorPct",      label: "Prior %",         kind: "pct",   value: (m) => pctOf(m.priorCollections, m.priorCollectible),
    help: "The same Collection % for the equal-length period immediately before this one." },
  {
    key: "deltaPp", label: "Δ pp", kind: "pct",
    value: (m) => {
      const cur = pctOf(m.collected, m.collectible);
      const prior = pctOf(m.priorCollections, m.priorCollectible);
      return cur === null || prior === null ? null : cur - prior;
    },
    help: "Change in Collection % against the prior period, in percentage points. Negative means they are getting worse.",
  },
  { key: "priorCollections",     label: "Prior Collections", kind: "money", value: (m) => m.priorCollections,
    help: "Cash received in the equal-length period just before this one. A large figure means they have JUST stopped paying; ₹0 means they were always silent." },
  { key: "chequeReturns",        label: "Cheque Returns",    kind: "money", value: (m) => m.chequeReturns, alarm: true,
    help: "Payments that bounced in the period. They count as paid and are then reversed, so they can hide a defaulter." },
  { key: "creditNotes",          label: "Credit Notes",      kind: "money", value: (m) => m.creditNotes,
    help: "Dues cleared by a credit note (sales return or adjustment) instead of cash. The balance fell without money arriving." },
  { key: "daysSinceLastReceipt", label: "Days Since Receipt", kind: "days", value: (m) => m.daysSinceLastReceipt, alarm: true,
    help: "Days since the last rupee arrived from this customer. “Never” means none since the data starts." },
  // Leaf-only: a date/amount can't be summed onto a group row. Both sources carry the exact
  // voucher amount now — the pipeline from its day detail, Live from the snapshot column.
  { key: "lastReceipt",       label: "Last Receipt",   kind: "date",  leafOnly: true, value: (m) => m.lastReceiptAt || null,
    help: "The date of the most recent payment received. Shown per customer only, because a date cannot be summed onto a group row." },
  { key: "lastReceiptAmount", label: "Last Receipt ₹", kind: "money", leafOnly: true, value: (m) => m.lastReceiptAmount || null,
    help: "How much that most recent payment was for. A token ₹5,000 against ₹40 L reads very differently from a real one." },
  // Folded with MAX, so a group reads as its DEADEST member. The exact month label is a
  // per-customer fact and can't be summed — it ships in the Excel export instead.
  { key: "monthsSinceLastSale",  label: "Months Since Sale", kind: "months", value: (m) => m.monthsSinceLastSale, alarm: true,
    help: "Months since we last billed them, so how dormant the account is. A group row shows its deadest member." },
  { key: "maxOverdueDays",       label: "Max Overdue Days",  kind: "days",  value: (m) => m.maxOverdueDays,
    help: "The age of the oldest unpaid invoice in this row, so how far back the problem goes." },
  { key: "creditLimit",          label: "Credit Limit",      kind: "money", value: (m) => m.creditLimit,
    help: "The credit limit set on this customer in Tally. A dash means none was ever set." },
  // Leaf-only, and no `alarm`: long credit terms aren't a fault, so this column never turns red
  // (the days rule at CollectionPerformanceReport's `alarm` would otherwise flag anything > 180).
  { key: "creditDays",           label: "Credit Days",       kind: "days",  leafOnly: true, value: (m) => m.creditDays,
    help: "The credit period agreed with this customer in Tally. A dash means no terms were ever recorded." },
];

/** Which of the three reports this is. Decides the predicate, the defaults and the lenses. */
export type CollectionsMode = "zero" | "threshold" | "dormant";

/**
 * WHICH COLUMNS THE PICKER EVEN OFFERS, per report.
 *
 * Zero Collections is a call-list, not a workbench. Every percentage column reads 0% / "—" at
 * threshold 0, and Opening / Collectible / Shortfall / Δ pp only make sense next to a percentage
 * — offering all 23 columns there was 11 choices that could only make the report worse. So the
 * picker on that report is CLOSED to the twelve columns the report is actually about; eight of
 * them are on by default (see defaultColumnsFor) and the other four are one click away.
 *
 * The other two reports keep the full set: Below-N% is exactly the percentage working, and the
 * dormant report is read side by side with it.
 */
const ZERO_PICKER_COLUMNS: ZCColumnKey[] = [
  "customers", "outstanding", "overdue", "overdueGross", "onAccount", "over180",
  "salesInWindow", "journalSettled",
  "priorCollections", "daysSinceLastReceipt", "lastReceipt", "lastReceiptAmount",
  "creditDays", "creditLimit",
];

export function pickerColumnsFor(mode: CollectionsMode): ZCColumn[] {
  if (mode !== "zero") return ZC_COLUMNS;
  const allowed = new Set<ZCColumnKey>(ZERO_PICKER_COLUMNS);
  return ZC_COLUMNS.filter((c) => allowed.has(c.key));
}

/**
 * The default (management) column set — what the report OPENS on. Everything else its picker
 * offers (see pickerColumnsFor) is one click away.
 *
 * The three reports want different defaults:
 *  - zero      : at threshold 0 every percentage column reads 0% / "—" and only wastes width, so
 *                it opens on the eight figures that decide a call: who, how much, how overdue,
 *                are we still billing them, when did they last pay and how much, and what terms
 *                were they given. > 180 Days, Journal Settled, Prior Collections and Days Since
 *                Receipt are the second question, not the first — they stay in the picker.
 *  - threshold : the full percentage working.
 *  - dormant   : "Sales in Period" is ₹0 for EVERY row by construction (that's the predicate),
 *                so it is dropped for the two figures that actually rank a dead account —
 *                how long since they bought, and how long since they paid.
 */
export function defaultColumnsFor(mode: CollectionsMode): ZCColumnKey[] {
  if (mode === "zero")
    // Credit Days + Credit Limit close the loop the rest of the row opens: this customer paid
    // nothing — were they ever given terms, and how much rope? Both come straight from the Tally
    // master, so ~half read "—" (951 of 1,831 ledgers carry no credit period, 908 no limit).
    return ["customers", "outstanding", "overdue", "salesInWindow", "lastReceipt", "lastReceiptAmount", "creditDays", "creditLimit"];
  if (mode === "dormant")
    return ["customers", "outstanding", "overdue", "over180", "collected", "monthsSinceLastSale", "daysSinceLastReceipt"];
  return [
    "customers", "outstanding", "opening", "salesInWindow", "collectible", "collected", "journalSettled",
    "collectionPct", "shortfall", "priorPct", "deltaPp", "chequeReturns", "creditNotes",
  ];
}

/**
 * The view each report OPENS on. Lives here, next to ZC_PRESETS, so the default and the chip
 * that highlights it cannot drift apart.
 *
 * Salesperson first in all three: chasing money is owned by a person before it is owned by a
 * ledger, and Sale Type underneath tells them WHICH bill to chase (ink and machine are different
 * conversations).
 *
 * The middle level differs. Zero Collections lists everyone who paid nothing at all, which on the
 * live book is hundreds of ledgers — one row per customer is a list to scroll, not to read. It
 * opens on Customer Group instead, so the first question answered is which HOUSE has stopped
 * paying; the customers are one expand away. The other two reports are already narrowed by their
 * own predicate, so the customer row is the useful grain there.
 *
 * Zero Collections also stops at TWO levels. A third Sale Type split under every group turned a
 * salesperson's call-list into a tree nobody expanded — the sale-type question is answered by the
 * Sale Type filter and the overdue-by-type cards above the table, not by a third nesting level.
 * The dimension itself is untouched: "Sale Type" is still in the View presets and the Group by
 * dropdown, one click away, on this report as on the other two.
 */
export function defaultGroupByFor(mode: CollectionsMode): ZCDim[] {
  if (mode === "zero") return ["salesperson", "group"];
  return ["salesperson", "customer", "saleType"];
}

// ── Window resolution ───────────────────────────────────────────────────────────────

export type PeriodPreset = "15d" | "1m" | "3m" | "6m" | "fy" | "all" | "custom";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "15d": "Last 15 Days",
  "1m": "This Month", "3m": "Last 3 Months", "6m": "Last 6 Months",
  fy: "This FY", all: "All", custom: "Custom",
};

/**
 * Presets measured in DAYS, not whole months. They resolve to a date range and are answered by
 * the day-level engine (factsForRange), exactly as Custom is — `resolveWindow` cannot express
 * them, and calling it with one is a bug. `isDateRangePreset` is the guard for that.
 */
export const DATE_RANGE_PRESETS = { "15d": 15 } as const satisfies Partial<Record<PeriodPreset, number>>;

/** True for the presets that mean a run of days: "15d" and the user-picked "custom". */
export const isDateRangePreset = (p: PeriodPreset): boolean =>
  p === "custom" || p in DATE_RANGE_PRESETS;

/**
 * Resolve a preset into the contiguous run of trend month labels it covers.
 * `months` is the org-wide month list from dashboard.trend, already in chronological order —
 * so presets are always valid whatever the FY selector is set to.
 */
export function resolveWindow(months: string[], preset: PeriodPreset): string[] {
  if (months.length === 0) return [];
  switch (preset) {
    // A day-based preset has no month answer — its window is derived from real dates and its
    // touched months come from monthRange(). Falling through to `months` here would silently
    // widen "Last 15 Days" to the entire data horizon.
    case "15d": return months.slice(-1);
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
