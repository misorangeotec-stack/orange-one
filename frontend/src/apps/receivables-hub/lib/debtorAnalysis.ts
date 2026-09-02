/**
 * debtorAnalysis.ts — the Debtor Analysis Dashboard engine. Pure, UI-free, no fetching.
 *
 * ── What this reproduces ──────────────────────────────────────────────────────────────────
 * A one-page debtor report finance used to assemble by hand, one customer at a time
 * (MISC/RAJLAXMI DIGITAL Final (1).pdf): two six-chip bands, a fiscal-quarter rollup, a
 * month-by-month table, and an action note saying how much must be collected to come back
 * inside the credit limit.
 *
 * Everything it needs is already loaded by the Customer Detail page. This module does the
 * arithmetic; DebtorAnalysis.tsx renders it and exportDebtorAnalysisPdf/Xlsx print it. All
 * three read the SAME object, so the screen and the document cannot drift apart.
 *
 * ── The three rules the source artefact enforces, measured off it ─────────────────────────
 *
 * 1. A QUARTER'S Avg Coll Days IS NOT THE MEAN OF ITS MONTHS. Q1 FY25 prints 131.0 d while
 *    its months read 121.1 / 140.2 / 124.0 (mean 128.4); the grand total prints 128.8 d
 *    against a 13-month mean of 129.6. Each bucket is computed independently over its OWN
 *    date range — which is why CollectionDaysFn takes a range, not a list of month values.
 *    Every OTHER column is the sum (flows) or the mean (stocks) of its months.
 *
 * 2. THE PERIOD SUMMARY BAND IS THE MONTHLY COLUMN SUMS, not the raw Customer fields
 *    (Cr Notes 21.02 L = the monthly column exactly; Dr Notes 1.96 = 0.01+1.63+0.32). The
 *    band is therefore DERIVED from `months`, so a band and the table beneath it can never
 *    contradict each other. The Customer fields are used only as a cross-CHECK — and only
 *    when the whole period is in view; see the FY note below.
 *
 * 3. THE REPORT FOOTS, and that is the built-in proof:
 *      99.19 + 260.68 − 238.45 − 21.02 + 1.96 + 8.49 = 110.85  vs a closing 111.00
 *    `reconciliation` ships that identity. It is the cheapest guard there is against a
 *    silent unit slip or a filter applied to one column and not another.
 *
 * ── ⚠ FY scoping is ASYMMETRIC across the Customer object ─────────────────────────────────
 * Under a NARROWED financial year, connectwaveFetcher re-scopes the monthly trend (inFy),
 * the voucher fetch (fyDateRange) and customer.sales / .receipts (fyTotals) — but
 * customer.creditNotes, .debitNotes, .checkReturns, .journalDr/.journalCr and .openingBalance
 * are raw all-period snapshot columns it never touches. So:
 *   - the cross-check in rule 2 runs ONLY at "Both FYs" (fySuffix === ""), or every narrowed
 *     FY reports a divergence that is an artefact of the fetcher, not of this report;
 *   - the opening balance is DERIVED (roll the first month's closing back through its own
 *     flows) whenever the FY is narrowed, or the identity in rule 3 breaks the moment anyone
 *     touches the selector.
 *
 * ── Units: one conversion site ────────────────────────────────────────────────────────────
 *   Customer.*, the voucher streams, DebtorChip.raw, DebtorActionNote.*   → RUPEES
 *   MonthlyTrend.* (already divided by connectwaveFetcher), every Row     → LAKHS
 * `bucketVouchersByMonth` is the ONLY place that divides by LAKH, and nothing here ever
 * multiplies back. Chips format with fmtINRMoney, which flips to Cr like the artefact; table
 * cells format with fmtLakhsCell, which never does (the artefact prints "111.00 L", not
 * "₹1.11 Cr" — and CustomerDetail's local fmtL flips at 100 L, so it cannot be reused).
 */
import type {
  Customer, MonthlyTrend, Invoice,
  CreditNoteTransaction, DebitNoteTransaction, JournalTransaction, ReceiptTransaction,
} from "./types";
import { MONTH_ABBR, MONTH_IDX, monthLabelToOrdinal, monthStartISO, monthEndISO, isoToMonthLabel } from "./months";
import { fmtINRMoney, fmtINRDrCr, formatDateDMY } from "./utils";

/** Rupees → lakhs. The one divisor in this file. */
const LAKH = 100_000;

/** Cheque returns are flagged "High" at or above this share of the period's sales. */
const CHQ_RETURN_HIGH_PCT = 2;

/**
 * A credit limit at or below this is the legacy "blocked" MARKER, not a limit — 184 ledgers
 * carry ₹1. utilizationPct has no guard for it (receivables.ts: `creditLimit > 0 ? … : 0`), so
 * it would return 100 × outstanding: a nine-digit percentage on a card that reads "%".
 */
const CREDIT_LIMIT_SENTINEL = 1;

/** Roll-forward residual (lakhs) past which a month is named in `caveats`. */
const ROLL_TOLERANCE_L = 1;

/** Whole-period reconciliation residual (lakhs) within which the report is considered to foot. */
const RECON_TOLERANCE_L = 0.5;

/** Divergence (lakhs) between a derived total and the Customer field past which we say so. */
const CROSSCHECK_TOLERANCE_L = 0.5;

const MS_PER_DAY = 86_400_000;

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────

/**
 * The four dated voucher streams, exactly as CustomerDetail merges them. Amounts in RUPEES.
 *
 * `receipts` carries THREE kinds of row, discriminated by `type`: a real receipt, a bounced
 * cheque ("check_return", a voucher type named CHQ.R) and money paid out to the customer
 * ("payment_out", a refund or an unnamed bounce).
 *
 * ⚠ BOTH non-receipt kinds count as Cheque Returns here, and that was settled by measurement,
 * not preference. The first cut counted CHQ.R only, so the column would match
 * customer.checkReturns and the KPI card on Customer Detail. Run against the live ledger it
 * dropped Oct-25 (3.50 L) and Feb-26 (2.69 L) — 6.19 L that the source artefact shows in this
 * very column. Tally simply did not name those two vouchers CHQ.R. collections.ts:isChequeReturn
 * already folds both for the same reason ("Both belong on the Due side, not the Received side").
 * The cross-check below therefore compares against checkReturns + paymentsOut, not checkReturns
 * alone, and `paymentsOut` is still carried per month so the split can be stated.
 */
export interface DebtorVoucherStreams {
  creditNotes: readonly CreditNoteTransaction[];
  debitNotes:  readonly DebitNoteTransaction[];
  journals:    readonly JournalTransaction[];
  receipts:    readonly ReceiptTransaction[];
}

export interface DebtorAnalysisInput {
  /** Display name — the group name on /group/, the Tally name on /customer/. */
  title: string;
  /**
   * The consolidated customer, exactly as CustomerDetail's `customer` memo produces it.
   * RUPEES. ⚠ On the group route its `id` is `G:<groupName>` and belongs to no ledger, so
   * nothing in this module may key anything off `customer.id`.
   */
  customer: Customer;
  /** Overdue NET of On Account (CustomerDetail's `overdueNet`). RUPEES. */
  overdueNet: number;
  /** Consolidated per-month trend across the active entities. LAKHS. Order irrelevant. */
  trend: readonly MonthlyTrend[];
  vouchers: DebtorVoucherStreams;
  /** Normalised bill ref → ISO date the bill was RAISED (liveTxns.billMeta). Live only. */
  billMeta?: Record<string, string>;
  /** Fallback bill dates: the merged invoice list, whose `number` is the bill ref. */
  invoices?: readonly Pick<Invoice, "number" | "date">[];
  /** dashboard.asOfDate, e.g. "2026-07-03". */
  asOfDate: string;
  /** useFY().suffix — "" for Both FYs, "_fy2526" / "_fy2627" when narrowed. */
  fySuffix: string;
  /** For the subline and the meta strip. */
  scope: { company: string; location: string; source: string; fyLabel: string };
  /** THE SEAM. Omit → every avgCollDays is null and renders as the no-data marker. */
  collectionDays?: CollectionDaysFn;
}

// ── Output shapes ───────────────────────────────────────────────────────────────────────────

/** EVERY money field on a row is LAKHS and SIGNED. */
export interface DebtorMonthRow {
  month: string;              // "Apr-25"
  sales: number;
  /** GROSS receipts — Receipt-class vouchers only. Cheque returns are their own column and are
   *  added BACK in the movement, exactly as collections.ts:movementOf does it. */
  receipts: number;
  creditNotes: number;
  debitNotes: number;
  chequeReturns: number;
  /** Signed Dr − Cr. Not a column on the artefact; it feeds the movement and the workbook. */
  journalNet: number;
  /** The part of `chequeReturns` that is a refund or an unnamed bounce rather than a CHQ.R
   *  voucher. A SUBSET, not a sibling — already counted in chequeReturns and in `movement`.
   *  Carried only so the report can say how the column splits. */
  paymentsOut: number;
  /** How much this month moved the receivable. Positive = they owe MORE. */
  movement: number;
  /** Month-end closing, SIGNED. A credit balance stays negative — losing the sign on a debtor
   *  report is the more dangerous of the two possible errors. */
  outstanding: number;
  overdue: number;
  avgCollDays: number | null;
  /** The as-of month: its flows are real but the month is not over. */
  partial: boolean;
  /** In the spine but absent from `trend` — nothing was reported. Stocks carry forward. */
  imputed: boolean;
}

export interface DebtorQuarterRow {
  key: string;                // "FY25-Q1" — stable, for React keys
  label: string;              // "Q1 FY25"
  span: string;               // "Apr-Jun 25"
  months: string[];
  sales: number;
  receipts: number;
  creditNotes: number;
  debitNotes: number;
  chequeReturns: number;
  /** MEAN of member months' month-end closing balances — not a sum, not the last value. */
  avgOutstanding: number | null;
  avgOverdue: number | null;
  /** Computed independently over the quarter's own date range. Never a mean of months. */
  avgCollDays: number | null;
  partial: boolean;
}

export interface DebtorChip {
  label: string;
  /** Preformatted and ready to print — this module owns formatting so screen and PDF agree. */
  value: string;
  sub?: string;               // "(Debit)" · "60 Days" · "⚠ OVERLIMIT" · "⚠ High"
  alarm?: boolean;
  /** Raw magnitude (rupees / percent / days) for the workbook and for assertions. */
  raw: number;
  /** The figure is unavailable rather than zero (e.g. no credit limit recorded). */
  unavailable?: boolean;
}

export interface DebtorBands {
  /** Outstanding · Overdue · Credit Limit · Utilisation · Credit Period · Opening Balance. */
  accountStatus: DebtorChip[];
  /**
   * Total Sales · Total Receipts · Credit Notes · Debit Notes · Cheque Returns · Journal Adj.
   * ⚠ Chq Returns comes BEFORE Journal here — the opposite of CustomerDetail's summaryItems.
   * That is the artefact's order. Do not "fix" it.
   */
  periodSummary: DebtorChip[];
}

export interface DebtorActionNote {
  creditLimit: number;        // ₹
  outstanding: number;        // ₹
  /** max(0, outstanding − creditLimit) — the artefact's 42.50 L. */
  minimumRequired: number;
  withinLimit: boolean;
  limitNotSet: boolean;
  lines: string[];
}

export interface DebtorReconciliation {
  openingBalance: number;     // LAKHS, signed
  /** Whether the opening was read from the snapshot or rolled back from the first month. */
  openingDerived: boolean;
  netMovement: number;
  expectedClosing: number;
  actualClosing: number;
  residual: number;           // actual − expected
  ok: boolean;
}

export interface DebtorAnalysisReport {
  title: string;              // "RAJLAXMI DIGITAL — DEBTOR ANALYSIS DASHBOARD"
  subline: string;
  asOfDate: string;           // "2026-07-03"
  asOfMonth: string;          // "Jul-26"
  periodLabel: string;        // "Apr-25 to Jul-26"
  bands: DebtorBands;
  months: DebtorMonthRow[];
  /** month = "SUMMARY TOTAL". Flows summed INCLUDING the partial month; outstanding/overdue
   *  are the LAST month's values, not sums. */
  monthsSummary: DebtorMonthRow;
  quarters: DebtorQuarterRow[];
  /** label = "TOTAL / AVG (Excl. Jul-26)". Null when no complete month exists. */
  quartersTotal: DebtorQuarterRow | null;
  note: DebtorActionNote;
  reconciliation: DebtorReconciliation;
  /** Everything the report could not compute honestly. Rendered, never swallowed. */
  caveats: string[];
}

// ── The Avg Collection Days seam ────────────────────────────────────────────────────────────

export interface CollDaysBucket {
  key: string;                            // "Apr-25" | "Q1 FY25" | "TOTAL"
  kind: "month" | "quarter" | "total";
  /** Inclusive ISO range, clamped at asOfDate for a partial bucket. */
  fromISO: string;
  toISO: string;
  months: string[];
  partial: boolean;
}

export interface CollDaysContext {
  customer: Customer;
  vouchers: DebtorVoucherStreams;
  /** Normalised bill ref → ISO raise date. The primary bill-date source. */
  billDateOf: (ref: string | null | undefined) => string | null;
  asOfDate: string;
  /** The month rows built so far — everything except avgCollDays. */
  months: readonly Omit<DebtorMonthRow, "avgCollDays">[];
}

/**
 * Return days, or null when the inputs cannot answer honestly.
 *
 * ⚠ MUST be computed independently per bucket — see rule 1 in the file header. A quarter is
 * not the mean of its months, and averaging would silently produce different numbers from the
 * document this screen exists to reproduce.
 */
export type CollectionDaysFn = (bucket: CollDaysBucket, ctx: CollDaysContext) => number | null;

/** The honest fallback: every cell reads as no-data, and the layout is still reviewable. */
export const noCollectionDays: CollectionDaysFn = () => null;

/**
 * ACTUAL SETTLEMENT LAG — the amount-weighted mean of (receipt date − bill date) over every
 * receipt allocation banked inside the bucket.
 *
 *     Σ( allocAmount × (receiptDate − billDate) ) / Σ( allocAmount )
 *
 * This is affordable only because ConnectWave already hands us the right grain: a receipt
 * covering two invoices arrives as TWO rows, each carrying its own allocation amount and the
 * normalised ref of the bill it settled (connectwaveFetcher's `parts` split). So the weight and
 * the ref are read straight off the row — no allocation query, no apportioning.
 *
 * Excluded, and why:
 *   - "check_return" / "payment_out" — a bounce or a refund is not a collection.
 *   - refInvoice === null — precisely Tally's own On Account / Advance / mixed-sign / residual
 *     cases. An advance genuinely has no lag to measure, so it must not contribute a zero.
 *   - refs whose bill has no raise date in any of the company's books.
 * When nothing survives, return null → the artefact's "— No data", which is very likely what
 * its own blank May-26 / Jun-26 / Jul-26 rows are.
 *
 * Negative lags (a receipt predating its bill) are KEPT, not clamped. Clamping would quietly
 * flatter a report whose whole job is to show how slowly this customer pays.
 */
export const settlementLagCollectionDays: CollectionDaysFn = (bucket, ctx) => {
  let weighted = 0;
  let weight = 0;
  for (const r of ctx.vouchers.receipts) {
    if (!r.date) continue;
    const t = (r.type ?? "").toLowerCase();
    if (t === "check_return" || t === "payment_out") continue;
    if (r.date < bucket.fromISO || r.date > bucket.toISO) continue;
    const billDate = ctx.billDateOf(r.refInvoice);
    if (!billDate) continue;
    const lag = (Date.parse(r.date) - Date.parse(billDate)) / MS_PER_DAY;
    if (!Number.isFinite(lag)) continue;
    const w = Math.abs(r.amount);
    if (w <= 0) continue;
    weighted += w * lag;
    weight += w;
  }
  if (weight <= 0) return null;
  return Math.round((weighted / weight) * 10) / 10;
};

// ── Month / quarter vocabulary ──────────────────────────────────────────────────────────────

/**
 * Every month label from `fromLabel` to `toLabel` inclusive, by ordinal arithmetic.
 *
 * Built by counting, never by listing the months `trend` happens to contain: a customer who
 * bought nothing in September must still get a September row (carrying its balance forward),
 * or the table silently closes a gap the reader needs to see.
 */
function monthSpine(fromLabel: string, toLabel: string): string[] {
  const from = monthLabelToOrdinal(fromLabel);
  const to = monthLabelToOrdinal(toLabel);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [];
  if (to - from > 600) return [];   // 50 years: a corrupt label, not a long history
  const out: string[] = [];
  for (let o = from; o <= to; o++) {
    const y = Math.floor(o / 12);
    const m = o % 12;
    out.push(`${MONTH_ABBR[m]}-${String(y % 100).padStart(2, "0")}`);
  }
  return out;
}

/**
 * The Indian fiscal quarter a month belongs to. FY25 = Apr-2025 … Mar-2026, so the label's
 * year is the year the FY STARTED, while the span's year is the LAST month's — which is what
 * makes Q4 FY25 read "Jan-Mar 26" and Q1 FY26 read "Apr-Jun 26". Those two are the ones this
 * arithmetic is usually got wrong on, so they are asserted in the verification checklist.
 */
function fiscalQuarterOf(month: string): {
  key: string; label: string; qIndex: 1 | 2 | 3 | 4; fyStartYear: number;
} {
  const [mon, yy] = month.split("-");
  const calIdx = MONTH_IDX[mon] ?? 0;
  const calYear = 2000 + Number(yy || 0);
  const fyStartYear = calIdx >= 3 ? calYear : calYear - 1;
  const qIndex = (Math.floor(((calIdx - 3 + 12) % 12) / 3) + 1) as 1 | 2 | 3 | 4;
  const yy2 = String(fyStartYear % 100).padStart(2, "0");
  return { key: `FY${yy2}-Q${qIndex}`, label: `Q${qIndex} FY${yy2}`, qIndex, fyStartYear };
}

/** The "Apr-Jun 25" half of a quarter heading, from its member months. */
function quarterSpan(months: string[]): string {
  if (months.length === 0) return "";
  const first = months[0].split("-")[0];
  const last = months[months.length - 1];
  const [lastMon, lastYY] = last.split("-");
  return first === lastMon ? `${lastMon} ${lastYY}` : `${first}-${lastMon} ${lastYY}`;
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────────

/**
 * FIXED lakhs, always. The artefact's tables print "111.00 L" where a Cr-flipping formatter
 * would print "₹1.11 Cr" and break the column's alignment and its comparability down the page.
 * Only the chips flip, and they use fmtINRMoney for it.
 */
function fmtLakhs(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)} L`;
}

/** Same, but a zero or an absent value reads as a plain hyphen, as the artefact does. */
export function fmtLakhsCell(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  if (Math.abs(n) < 0.005) return "-";
  return fmtLakhs(n);
}

/** Days, or the artefact's no-data marker. */
export function fmtCollDays(d: number | null | undefined): string {
  return d === null || d === undefined ? "— No data" : `${d.toFixed(1)} d`;
}

// ── Voucher bucketing ───────────────────────────────────────────────────────────────────────

export interface VoucherMonth {
  creditNotes: number;
  debitNotes: number;
  journalNet: number;
  chequeReturns: number;
  paymentsOut: number;
}

const emptyVoucherMonth = (): VoucherMonth =>
  ({ creditNotes: 0, debitNotes: 0, journalNet: 0, chequeReturns: 0, paymentsOut: 0 });

/**
 * Per-month credit notes / debit notes / journal net / cheque returns, in LAKHS, read off the
 * DATED vouchers rather than off the snapshot.
 *
 * This is the whole reason those four columns can exist on Live at all. The ConnectWave
 * snapshot's `monthly` jsonb carries sales / receipts / outstanding / overdue and nothing else,
 * so CustomerDetail hides the columns (LIVE_UNAVAILABLE_MONTHLY) rather than print a fabricated
 * ₹0 under a non-zero KPI card. But the page separately fetches the ledger's full voucher
 * history for its transaction table — every row dated, every row already split per settled bill
 * — and that answers the question exactly. No extra query; the data is sitting there.
 *
 * ⚠ Only months in `months` are counted. The voucher fetch is FY-scoped by date range while the
 * spine is built from the trend, and the two can disagree at an edge — counting a voucher that
 * falls outside the spine would put money in the totals that appears in no row.
 *
 * EXPORTED WITH NO EXTERNAL CALLER YET, deliberately. It is the seam Customer Detail needs to
 * drop LIVE_UNAVAILABLE_MONTHLY and show those four columns on Live — a follow-up commit, kept
 * separate so this derivation can be checked against a real customer first. Not dead code: this
 * module's own buildDebtorAnalysis is its first consumer.
 */
export function bucketVouchersByMonth(
  vouchers: DebtorVoucherStreams,
  months: readonly string[],
): Map<string, VoucherMonth> {
  const out = new Map<string, VoucherMonth>();
  for (const m of months) out.set(m, emptyVoucherMonth());

  const add = (iso: string | null | undefined, key: keyof VoucherMonth, rupees: number) => {
    if (!iso) return;
    const label = isoToMonthLabel(iso);
    const bucket = out.get(label);
    if (!bucket) return;
    bucket[key] += rupees / LAKH;
  };

  for (const cn of vouchers.creditNotes) add(cn.date, "creditNotes", Math.abs(cn.amount));
  for (const dn of vouchers.debitNotes)  add(dn.date, "debitNotes",  Math.abs(dn.amount));
  // Journals are signed Dr − Cr: a net that can legitimately go either way.
  for (const j of vouchers.journals)     add(j.date, "journalNet",   j.signedAmount);
  for (const r of vouchers.receipts) {
    const t = (r.type ?? "").toLowerCase();
    // Both land in chequeReturns (see the header). paymentsOut is ALSO accumulated, as a
    // subset of it, purely so the report can say how much of the column is refunds rather
    // than bounces — it is never added to the movement a second time.
    if (t === "check_return" || t === "payment_out") {
      add(r.date, "chequeReturns", Math.abs(r.amount));
      if (t === "payment_out") add(r.date, "paymentsOut", Math.abs(r.amount));
    }
  }
  return out;
}

// ── The engine ──────────────────────────────────────────────────────────────────────────────

const sum = <T>(rows: readonly T[], pick: (r: T) => number): number =>
  rows.reduce((t, r) => t + pick(r), 0);

const mean = <T>(rows: readonly T[], pick: (r: T) => number): number | null =>
  rows.length === 0 ? null : sum(rows, pick) / rows.length;

/** collections.ts:movementOf, to the letter. Receipts are GROSS, so cheque returns are added
 *  back — and `chequeReturns` already includes payments out, so paymentsOut must NOT appear
 *  here as well or every refund would move the balance twice. */
const movementOf = (r: {
  sales: number; debitNotes: number; journalNet: number;
  receipts: number; chequeReturns: number; creditNotes: number;
}): number =>
  r.sales + r.debitNotes + r.journalNet
  - (r.receipts - r.chequeReturns)
  - r.creditNotes;

export function buildDebtorAnalysis(input: DebtorAnalysisInput): DebtorAnalysisReport {
  const {
    title, customer, overdueNet, trend, vouchers, billMeta, invoices,
    asOfDate, fySuffix, scope, collectionDays = noCollectionDays,
  } = input;

  const caveats: string[] = [];
  const wholePeriod = fySuffix === "";

  // ── The spine ────────────────────────────────────────────────────────────────────────────
  const trendByMonth = new Map(trend.map((t) => [t.month, t]));
  const ordered = [...trend].sort((a, b) => monthLabelToOrdinal(a.month) - monthLabelToOrdinal(b.month));
  const firstMonth = ordered[0]?.month ?? "";
  const lastMonth = ordered[ordered.length - 1]?.month ?? "";
  const spine = monthSpine(firstMonth, lastMonth);

  // The as-of month follows the DATA, not the clock: on a stale snapshot dashboard.asOfDate and
  // the last month it actually carries disagree, and a title claiming "As of" a month the table
  // does not reach is the kind of contradiction a reader rightly stops trusting.
  const asOfMonth = lastMonth;
  const asOfLabelFromDate = isoToMonthLabel(asOfDate);
  if (asOfMonth && asOfLabelFromDate && asOfLabelFromDate !== asOfMonth) {
    caveats.push(
      `The data reaches ${asOfMonth} but the snapshot is dated ${formatDateDMY(asOfDate)} ` +
      `(${asOfLabelFromDate}). Figures are as at the end of ${asOfMonth}.`,
    );
  }

  // ── Bill dates, for the settlement lag ───────────────────────────────────────────────────
  // billMeta first: it and refInvoice both pass through normBillRef (trim + uppercase), so the
  // lookup is a direct hit. The invoice list is the fallback and must be normalised to match.
  const invoiceDates = new Map<string, string>();
  for (const inv of invoices ?? []) {
    const n = (inv.number ?? "").trim().toUpperCase();
    if (n && inv.date && !invoiceDates.has(n)) invoiceDates.set(n, inv.date);
  }
  const billDateOf = (ref: string | null | undefined): string | null => {
    const n = (ref ?? "").trim().toUpperCase();
    if (!n || n === "ON ACCOUNT" || n === "UNALLOCATED") return null;
    return billMeta?.[n] ?? invoiceDates.get(n) ?? null;
  };

  // ── Month rows ───────────────────────────────────────────────────────────────────────────
  const voucherMonths = bucketVouchersByMonth(vouchers, spine);

  type PreRow = Omit<DebtorMonthRow, "avgCollDays">;
  const pre: PreRow[] = [];
  let carried = 0;
  for (const month of spine) {
    const t = trendByMonth.get(month);
    const v = voucherMonths.get(month) ?? emptyVoucherMonth();
    const imputed = !t;
    const outstanding = t ? t.outstanding : carried;
    carried = outstanding;
    const row: PreRow = {
      month,
      sales:         t?.sales ?? 0,
      receipts:      t?.receipts ?? 0,
      creditNotes:   v.creditNotes,
      debitNotes:    v.debitNotes,
      chequeReturns: v.chequeReturns,
      journalNet:    v.journalNet,
      paymentsOut:   v.paymentsOut,
      movement:      0,
      outstanding,
      overdue:       t?.overdue ?? 0,
      partial:       month === asOfMonth,
      imputed,
    };
    row.movement = movementOf(row);
    pre.push(row);
  }

  // Pin the as-of month to the headline figures, so the chip, the last table row and the
  // summary row are one number rather than three that nearly agree. Only this month CAN be
  // pinned: netting overdue against On Account needs the open-bill list, and prior months
  // carry monthly totals with no record of what was unmatched at the time.
  if (pre.length > 0) {
    const last = pre[pre.length - 1];
    last.outstanding = customer.outstanding / LAKH;
    last.overdue = overdueNet / LAKH;
  }

  // ── Opening balance ──────────────────────────────────────────────────────────────────────
  // customer.openingBalance is an ALL-PERIOD snapshot column the FY window never touches (see
  // the header). Under a narrowed FY it is the opening of a period this report is not showing,
  // so derive it instead by rolling the first month's closing back through the first month's
  // own flows. Both branches are signed; a credit opening stays negative.
  const openingDerived = !wholePeriod && pre.length > 0;
  const openingBalance = openingDerived
    ? pre[0].outstanding - pre[0].movement
    : customer.openingBalance / LAKH;
  if (openingDerived) {
    caveats.push(
      `Opening balance is derived from ${pre[0].month}'s closing balance, not read from the ` +
      `ledger: the stored opening covers the whole period, not the selected financial year.`,
    );
  }

  // ── Avg Collection Days, one bucket at a time ────────────────────────────────────────────
  const ctx: CollDaysContext = { customer, vouchers, billDateOf, asOfDate, months: pre };
  const clampTo = (iso: string) => (asOfDate && iso > asOfDate ? asOfDate : iso);
  const bucketFor = (
    key: string, kind: CollDaysBucket["kind"], ms: string[], partial: boolean,
  ): CollDaysBucket => ({
    key, kind, months: ms, partial,
    fromISO: ms.length ? monthStartISO(ms[0]) : "",
    toISO:   ms.length ? clampTo(monthEndISO(ms[ms.length - 1])) : "",
  });

  const months: DebtorMonthRow[] = pre.map((r) => ({
    ...r,
    avgCollDays: collectionDays(bucketFor(r.month, "month", [r.month], r.partial), ctx),
  }));

  // ── Monthly summary row ──────────────────────────────────────────────────────────────────
  // Flows are summed INCLUDING the partial month; stocks are the LAST month's value, never a
  // sum. (This is why monthsSummary.sales legitimately differs from quartersTotal.sales — the
  // quarterly total excludes the partial month and the monthly one does not. Both are correct
  // and both column headers say which.)
  const lastRow = months[months.length - 1];
  const monthsSummary: DebtorMonthRow = {
    month: "SUMMARY TOTAL",
    sales:         sum(months, (r) => r.sales),
    receipts:      sum(months, (r) => r.receipts),
    creditNotes:   sum(months, (r) => r.creditNotes),
    debitNotes:    sum(months, (r) => r.debitNotes),
    chequeReturns: sum(months, (r) => r.chequeReturns),
    journalNet:    sum(months, (r) => r.journalNet),
    paymentsOut:   sum(months, (r) => r.paymentsOut),
    movement:      sum(months, (r) => r.movement),
    outstanding:   lastRow?.outstanding ?? 0,
    overdue:       lastRow?.overdue ?? 0,
    avgCollDays:   collectionDays(
                     bucketFor("TOTAL", "total", spine, false), ctx),
    partial: false,
    imputed: false,
  };

  // ── Quarters ─────────────────────────────────────────────────────────────────────────────
  // Derived from `months`, never independently, so the two can never disagree. Months strictly
  // before the as-of month form complete fiscal quarters; the remainder — from the start of the
  // current, incomplete quarter through the as-of month — becomes ONE trailing partial row.
  const completeMonths = months.filter((r) => !r.partial);
  const partialMonths = months.filter((r) => r.partial);

  const quarterOf = (rows: DebtorMonthRow[], key: string, label: string, partial: boolean): DebtorQuarterRow => {
    const ms = rows.map((r) => r.month);
    return {
      key, label, span: quarterSpan(ms), months: ms,
      sales:         sum(rows, (r) => r.sales),
      receipts:      sum(rows, (r) => r.receipts),
      creditNotes:   sum(rows, (r) => r.creditNotes),
      debitNotes:    sum(rows, (r) => r.debitNotes),
      chequeReturns: sum(rows, (r) => r.chequeReturns),
      avgOutstanding: mean(rows, (r) => r.outstanding),
      avgOverdue:     mean(rows, (r) => r.overdue),
      avgCollDays:    collectionDays(
                        bucketFor(label, "quarter", ms, partial), ctx),
      partial,
    };
  };

  const byQuarter = new Map<string, DebtorMonthRow[]>();
  const quarterLabel = new Map<string, string>();
  for (const r of completeMonths) {
    const q = fiscalQuarterOf(r.month);
    if (!byQuarter.has(q.key)) { byQuarter.set(q.key, []); quarterLabel.set(q.key, q.label); }
    byQuarter.get(q.key)!.push(r);
  }
  const quarters: DebtorQuarterRow[] = [...byQuarter.entries()]
    .sort((a, b) => monthLabelToOrdinal(a[1][0].month) - monthLabelToOrdinal(b[1][0].month))
    .map(([key, rows]) => quarterOf(rows, key, quarterLabel.get(key) ?? key, false));

  if (partialMonths.length > 0) {
    // A single trailing month is labelled with the month, as the artefact does ("Jul-26
    // (Partial)"); a longer run is labelled with its real quarter name. Either way it is one
    // row and it is excluded from the totals below.
    const q = fiscalQuarterOf(partialMonths[0].month);
    const single = partialMonths.length === 1;
    const label = single ? partialMonths[0].month : q.label;
    // A single-month row is already named by its month, so blank the span — otherwise the cell
    // renders "Sep-26 (Sep 26) (Partial)", saying the same thing three times.
    quarters.push({ ...quarterOf(partialMonths, `${q.key}-partial`, label, true), span: single ? "" : quarterSpan(partialMonths.map((r) => r.month)) });
  }

  const quartersTotal: DebtorQuarterRow | null = completeMonths.length > 0
    ? {
        ...quarterOf(
          completeMonths,
          "TOTAL",
          partialMonths.length > 0 ? `TOTAL / AVG (Excl. ${partialMonths[0].month})` : "TOTAL / AVG",
          false,
        ),
        span: "",
      }
    : null;
  if (!quartersTotal) {
    caveats.push(
      `No complete month has closed yet in the selected period, so there is no quarterly ` +
      `summary to show.`,
    );
  }

  // ── Bands, derived FROM the months ───────────────────────────────────────────────────────
  const creditLimit = customer.creditLimit;
  const limitNotSet = !(creditLimit > CREDIT_LIMIT_SENTINEL);
  const outstandingR = customer.outstanding;
  const utilisation = limitNotSet ? 0 : Math.round((Math.max(0, outstandingR) / creditLimit) * 1000) / 10;
  const overLimit = !limitNotSet && utilisation > 100;

  const drCr = (n: number) => (n >= 0 ? "(Debit)" : "(Credit)");

  const salesL = monthsSummary.sales;
  const chqPct = salesL > 0 ? (monthsSummary.chequeReturns / salesL) * 100 : 0;

  const accountStatus: DebtorChip[] = [
    { label: "Outstanding",    value: fmtINRMoney(Math.abs(outstandingR)), sub: drCr(outstandingR), raw: outstandingR },
    { label: "Overdue",        value: fmtINRMoney(Math.abs(overdueNet)),   sub: drCr(overdueNet), raw: overdueNet, alarm: overdueNet > 0 },
    {
      label: "Credit Limit",
      value: limitNotSet ? "—" : fmtINRMoney(creditLimit),
      sub: limitNotSet ? "not recorded" : undefined,
      raw: limitNotSet ? 0 : creditLimit,
      unavailable: limitNotSet,
    },
    {
      label: "Utilisation",
      value: limitNotSet ? "—" : `${utilisation.toFixed(1)}%`,
      sub: limitNotSet ? "no limit set" : overLimit ? "⚠ OVERLIMIT" : undefined,
      raw: limitNotSet ? 0 : utilisation,
      alarm: overLimit,
      unavailable: limitNotSet,
    },
    { label: "Credit Period",  value: `${customer.creditPeriod} Days`, raw: customer.creditPeriod },
    {
      label: openingDerived ? "Opening Balance (derived)" : "Opening Balance",
      value: fmtINRMoney(Math.abs(openingBalance * LAKH)),
      sub: drCr(openingBalance),
      raw: openingBalance * LAKH,
    },
  ];

  const periodSummary: DebtorChip[] = [
    { label: "Total Sales",       value: fmtINRMoney(salesL * LAKH),                    raw: salesL * LAKH },
    { label: "Total Receipts",    value: fmtINRMoney(monthsSummary.receipts * LAKH),    raw: monthsSummary.receipts * LAKH },
    { label: "Credit Notes",      value: fmtINRMoney(monthsSummary.creditNotes * LAKH), raw: monthsSummary.creditNotes * LAKH },
    { label: "Debit Notes",       value: fmtINRMoney(monthsSummary.debitNotes * LAKH),  raw: monthsSummary.debitNotes * LAKH },
    {
      label: "Cheque Returns",
      value: fmtINRMoney(monthsSummary.chequeReturns * LAKH),
      sub: chqPct >= CHQ_RETURN_HIGH_PCT ? "⚠ High" : undefined,
      alarm: chqPct >= CHQ_RETURN_HIGH_PCT,
      raw: monthsSummary.chequeReturns * LAKH,
    },
    {
      // Snapped to zero below half a paisa in lakh terms: a residual of −0.0001 L is not a
      // credit adjustment, and printing it as "− ₹0.00 L" invites a reader to go looking for
      // a journal entry that is not there.
      label: "Journal Adj (Net)",
      value: Math.abs(monthsSummary.journalNet) < 0.005 ? "₹0" : fmtINRDrCr(monthsSummary.journalNet * LAKH),
      raw: Math.abs(monthsSummary.journalNet) < 0.005 ? 0 : monthsSummary.journalNet * LAKH,
    },
  ];

  // ── Cross-check the derived band against the stored Customer fields ──────────────────────
  // ONLY at Both FYs. Narrowed, customer.creditNotes / .debitNotes / .checkReturns / .journal*
  // are all-period columns the FY window never re-scopes, so they would ALWAYS diverge from a
  // scoped monthly sum — a caveat that says more about the fetcher than about this customer.
  if (wholePeriod) {
    const check = (label: string, derivedL: number, storedR: number) => {
      const diff = derivedL - storedR / LAKH;
      if (Math.abs(diff) > CROSSCHECK_TOLERANCE_L) {
        caveats.push(
          `${label}: the monthly rows total ${fmtLakhs(derivedL)} against a ledger figure of ` +
          `${fmtLakhs(storedR / LAKH)} (difference ${fmtLakhs(diff)}). The rows are read from ` +
          `dated vouchers and are the more precise of the two.`,
        );
      }
    };
    check("Credit Notes",  monthsSummary.creditNotes,   customer.creditNotes);
    check("Debit Notes",   monthsSummary.debitNotes,    customer.debitNotes);
    // Against BOTH ledger fields: the column folds payments out in, so comparing it to
    // customer.checkReturns alone would report a difference on every customer who has ever
    // had a refund — a caveat about this report's own definition, not about the data.
    check("Cheque Returns", monthsSummary.chequeReturns,
          customer.checkReturns + (customer.paymentsOut ?? 0));
    check("Journal Adj (Net)", monthsSummary.journalNet, customer.journalAdjustments);
  }

  // State the split rather than leaving a reader to reconcile this column against the Cheque
  // Returns card on Customer Detail, which counts CHQ.R vouchers only and will read lower.
  if (Math.abs(monthsSummary.paymentsOut) > CROSSCHECK_TOLERANCE_L) {
    caveats.push(
      `Cheque Returns includes ${fmtLakhs(monthsSummary.paymentsOut)} of money paid back out to ` +
      `this customer on vouchers Tally did not name CHQ.R (refunds and unnamed bounces). The ` +
      `Cheque Returns card on the customer page counts CHQ.R only and will read lower.`,
    );
  }

  // ── Roll-forward check, month by month ───────────────────────────────────────────────────
  // Month-end balances are approximations: the snapshot's closing outstanding was measured
  // diverging from the canonical figure for 184 of 1,780 ledgers, and historical overdue is
  // explicitly approximate. Only the as-of month is anchored. Name the months that do not roll.
  for (let i = 1; i < months.length; i++) {
    const expected = months[i - 1].outstanding + months[i].movement;
    const residual = months[i].outstanding - expected;
    if (Math.abs(residual) > ROLL_TOLERANCE_L && !months[i].imputed) {
      caveats.push(
        `${months[i].month} does not roll forward exactly: ${fmtLakhs(months[i - 1].outstanding)} ` +
        `plus the month's movement gives ${fmtLakhs(expected)} against a closing balance of ` +
        `${fmtLakhs(months[i].outstanding)} (difference ${fmtLakhs(residual)}).`,
      );
    }
  }

  // ── Is the overdue HISTORY actually populated? ───────────────────────────────────────────
  // Measured on the live book: this customer carried 84 L outstanding in Apr-25 and the snapshot
  // reports its overdue that month as zero, while the finance-authored sheet for the same month
  // says 57.63 L. Only the as-of month is anchored to a real bill-level figure; the rest come
  // from the mirror's monthly rollup, which for older months is frequently just not filled in.
  //
  // A near-zero overdue printed beside a large outstanding does not read as "unknown" — it reads
  // as "nothing was late", which is the opposite of the truth and is exactly the sort of number
  // someone would take into a credit meeting. So count the months where that pattern holds and
  // say so plainly, rather than letting the Overdue column and every Avg OD built on it pass as
  // fact.
  const historic = months.slice(0, -1).filter((m) => !m.imputed && m.outstanding > 5);
  const blankOverdue = historic.filter((m) => m.overdue < Math.max(0.5, m.outstanding * 0.01));
  if (historic.length >= 3 && blankOverdue.length >= Math.ceil(historic.length / 2)) {
    caveats.push(
      `Overdue is not populated for ${blankOverdue.length} of the ${historic.length} past months ` +
      `shown (it reads as nil against a non-nil balance, e.g. ${blankOverdue[0].month}). Those ` +
      `months are unknown, not settled — treat the Overdue column and every Avg OD built on it ` +
      `as covering only the recent months. Only ${asOfMonth} is anchored to the live bill list.`,
    );
  }

  // ── Whole-period reconciliation ──────────────────────────────────────────────────────────
  const netMovement = monthsSummary.movement;
  const expectedClosing = openingBalance + netMovement;
  const actualClosing = monthsSummary.outstanding;
  const residual = actualClosing - expectedClosing;
  const reconciliation: DebtorReconciliation = {
    openingBalance, openingDerived, netMovement, expectedClosing, actualClosing, residual,
    ok: Math.abs(residual) <= RECON_TOLERANCE_L,
  };

  // ── Action note ──────────────────────────────────────────────────────────────────────────
  const minimumRequired = Math.max(0, outstandingR - (limitNotSet ? 0 : creditLimit));
  const withinLimit = !limitNotSet && outstandingR <= creditLimit;
  const lines: string[] = [];
  if (limitNotSet) {
    lines.push(
      "No credit limit is recorded in Tally for this customer, so no minimum collection can be " +
      "derived. A limit must be set before dispatch terms are decided.",
    );
  } else if (withinLimit) {
    lines.push(
      `Outstanding of ${fmtINRMoney(outstandingR)} is within the sanctioned credit limit of ` +
      `${fmtINRMoney(creditLimit)}. No additional cover is required at present.`,
    );
  } else {
    lines.push("The minimum amount required depends upon the credit limit we need to set.");
    lines.push(
      `As per the current credit limit of ${fmtINRMoney(creditLimit)} and outstanding of ` +
      `${fmtINRMoney(outstandingR)}, we would require a minimum of ${fmtINRMoney(minimumRequired)}.`,
    );
    lines.push("Further, any dispatches that need to happen should be done on advance payment terms.");
  }
  if (customer.blocked) {
    lines.push("This customer is marked Red Mark in Tally.");
  }
  const note: DebtorActionNote = {
    creditLimit: limitNotSet ? 0 : creditLimit,
    outstanding: outstandingR,
    minimumRequired, withinLimit, limitNotSet, lines,
  };

  // ── Chrome ───────────────────────────────────────────────────────────────────────────────
  const periodLabel = spine.length
    ? (spine.length === 1 ? spine[0] : `${spine[0]} to ${spine[spine.length - 1]}`)
    : "No data";
  const subline = [
    `As of ${formatDateDMY(asOfDate)}`,
    scope.company === "all" ? "All Companies" : scope.company,
    scope.location === "all" ? "All Locations" : scope.location,
  ].join(" | ") + ` | ₹ Lakhs | ${scope.fyLabel} | Source: ${scope.source}`;

  if (spine.length === 0) {
    caveats.push("No monthly data is available for this customer in the selected period.");
  }

  return {
    title: `${title} — DEBTOR ANALYSIS DASHBOARD`,
    subline,
    asOfDate,
    asOfMonth,
    periodLabel,
    bands: { accountStatus, periodSummary },
    months,
    monthsSummary,
    quarters,
    quartersTotal,
    note,
    reconciliation,
    caveats,
  };
}
