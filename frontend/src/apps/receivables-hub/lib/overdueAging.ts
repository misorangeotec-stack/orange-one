/**
 * overdueAging.ts — the "Customers Overdue Over N Days" engine. Pure, UI-free.
 *
 * ONE report, a SWITCHABLE cutoff. Ships as "Customers Overdue Over 120 Days" (?over=120);
 * 90 and 180 are one click away, and any custom cutoff works.
 *
 *     aged = Σ invoice.pending  over open bills where invoice.overdueDays > cutoff
 *
 * The headline is the AGED SLICE ONLY — not the customer's whole balance. A customer owing
 * ₹50 L of which ₹8 L sits past 120 days shows ₹8 L, and is ranked on it. Total Overdue and
 * Total Outstanding ride along as supporting columns, so the row still ties to the dashboard.
 *
 * ── Why every rupee here is bill-wise, and never `Customer.agingBuckets` ───────────────
 *
 * The one-line shortcut is `c.agingBuckets["121_180"] + c.agingBuckets["180_plus"]`. It is
 * already summed across companies by consolidateByName, and it is WRONG for this report:
 *
 *   1. The pipeline pushes the *remaining opening balance* into aging_buckets["180_plus"]
 *      ("opening residual treated as fully overdue from opening date") with NO backing bill.
 *   2. It then caps overdue_total against the bill-wise closing balance WITHOUT rescaling the
 *      buckets — so Σ agingBuckets can exceed customer.overdue.
 *
 * Measured against production (12-Jul-2026, Both FYs): bucket-summed 120+ = ₹11.00 cr vs
 * bill-summed ₹11.17 cr — a 1.5% gap across 9 customers. The bill-summed figure is the one
 * that drills down to named invoices, and a number management can open is a number management
 * will trust. (The Dashboard's aging chart reads the buckets, so it sits ~1.5% away from both
 * this report and the Aging Report. That inconsistency predates this file.)
 *
 * ── Reconciliation with the Aging Report (exact, by construction) ──────────────────────
 *
 * Bills come from agingReport.ts::enumerateBills — the SAME pass that backs the Aging Report —
 * and `isAged` mirrors its addBill gates verbatim. agingReport's overdueBucket boundaries are
 * <=0 → none, <=30, <=60, <=90, <=120, <=180, else 180_plus. Therefore:
 *
 *     cutoff 120  ≡  od_121_180 + od_180_plus  ≡  the Aging Report's "Total 120+" column
 *     cutoff 180  ≡  od_180_plus               (its "180+" column is really 181+)
 *     cutoff  90  ≡  od_91_120 + od_121_180 + od_180_plus   (no single column there)
 *     custom      ≡  nothing — reconcilesToAging() returns null and the UI says so.
 *
 * Grand totals tie to the rupee. INDIVIDUAL ROWS DO NOT, and that is by design: the Aging
 * Report keys customers per LEDGER (`name ||| company ||| location`) while this report — like
 * the other two management reports — consolidates BY NAME. A customer trading in three
 * companies is one row here and three there.
 *
 * ── Scope: the full book, always ──────────────────────────────────────────────────────
 *
 * The page pins itself to Both FYs. On a single-FY view this figure barely moves but its
 * MEANING flips: FY 26-27 is ~100 days old, so no invoice raised inside it can yet be 120 days
 * overdue — 100% of the number would be pre-FY debt, silently. Aging is a property of the whole
 * book, so the report reads the whole book.
 *
 * ── Brought-forward debt ──────────────────────────────────────────────────────────────
 *
 * 39% of today's ₹11.16 cr (₹4.35 cr) is OPENING debt — bills that predate the data horizon
 * (01-Apr-2025), carried into the system rather than billed on our watch. It is real, genuinely
 * overdue, and the oldest money on the books — so it is COUNTED. But it is also always SPLIT OUT
 * (header + an "of which B/F" column + a toggle), because ₹11.16 cr means two different things
 * depending on whether you know that.
 *
 * See isBroughtForward for why the boundary is the horizon and NOT the current financial year —
 * the FY boundary produces a 100/0 split by construction and is worthless.
 *
 * ── The filtered-set rule (the bug this file is shaped to avoid) ──────────────────────
 *
 * ConsolidatedCustomer's numbers are aggregated over EVERY constituent ledger, ignoring this
 * report's filters (useAppData.ts::consolidateByName). Read c.outstanding while `aged` comes
 * from a company-filtered bill set and you show one company's aged slice over the customer's
 * all-India balance: % Aged collapses and the grand total ties to nothing.
 *
 * So: every money figure below is derived from the bills that survived the filters, and the two
 * receipt-derived columns sum over `constituentIds ∩ inScopeLedgerIds` — never over
 * constituentIds, and never via collections.ts::factsFor, which does exactly that.
 *
 * ── Units ─────────────────────────────────────────────────────────────────────────────
 * Everything in and out of this module is RUPEES.
 */

import { pctOf, NEVER_PAID } from "./collections";
import type { GroupByPreset } from "../components/GroupByBuilder";
import type { EnrichedBill } from "./agingReport";
import type { ConsolidatedCustomer } from "./types";

/* ── Cutoff ─────────────────────────────────────────────────────────────────────────── */

/** The cutoffs management actually asks for. Anything else via the URL (?over=150). */
export const CUTOFF_PRESETS = [90, 120, 180] as const;

export const DEFAULT_CUTOFF = 120;

/**
 * Read ?over=. Clamped to a sane range so a typo can't empty or hang the report.
 *
 * `fallback` exists because the DSO report shares this parser but opens on 90 rather than 120.
 * Shared rather than copied — a second copy of the clamp would inevitably drift from this one.
 *
 * The `!raw` guard also fixes a latent bug: `Number(null)` is 0, NOT NaN, so `Number.isFinite`
 * happily accepted a MISSING ?over= and the clamp turned it into a 1-day cutoff. It never showed
 * because the Reports card always links with ?over=120, but landing on the bare route silently
 * gave "Overdue over 1 day". A missing or empty param now correctly yields the default.
 */
export function parseCutoff(raw: string | null, fallback: number = DEFAULT_CUTOFF): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3650, Math.max(1, Math.round(n)));
}

/**
 * Which Aging Report column this cutoff reconciles to, or null when it lands mid-bucket.
 * The UI prints the tie when there is one and warns when there isn't.
 */
export function reconcilesToAging(cutoff: number): "od_120_plus" | "od_180_plus" | "od_90_plus" | null {
  if (cutoff === 120) return "od_120_plus";
  if (cutoff === 180) return "od_180_plus";
  if (cutoff === 90) return "od_90_plus"; // = od_91_120 + od_121_180 + od_180_plus (no single column)
  return null;
}

/** Rupee guard, matching enumerateBills' own `Math.abs(pending) < 0.5` drop. */
export const EPS = 0.5;

/* ── The two bill predicates ────────────────────────────────────────────────────────── */

/**
 * A bill is AGED when it is past the cutoff.
 *
 * Mirrors agingReport.ts::addBill's overdue gate verbatim (`!isLedgerAdj && p > 0 && overdueKey`)
 * so the two files diff cleanly. Both gates are load-bearing:
 *   - isLedgerAdj : the synthetic net-ledger line is not a bill and carries overdueDays 0.
 *   - pending > 0 : an on-account credit (negative pending) is money we HOLD, not money we're owed.
 *
 * `overdueDays` is read AS GIVEN — it is a pipeline snapshot (`max(0, as_of − due_date)`, clamped,
 * never negative), not something to recompute from dueDate vs today. Recomputing it would silently
 * diverge from the Aging Report and the dashboard. It also means the boundary is as-of the last
 * pipeline run: a bill at 119 days then still reads 119 today. The page stamps the as-of date.
 */
export const isAged = (b: EnrichedBill, cutoff: number): boolean =>
  !b.isLedgerAdj && b.inv.pending > 0 && b.inv.overdueDays > cutoff;

/**
 * A bill is BROUGHT FORWARD when it predates the DATA HORIZON — the opening balances carried into
 * the system, rather than anything billed since we started recording.
 *
 * ── Why the horizon, and NOT the current financial year ───────────────────────────────
 *
 * "Before the current FY" is the obvious boundary and it is USELESS here, provably so: the report
 * only lists bills more than `cutoff` days overdue, and the current FY is younger than the cutoff
 * for most of the year. On 12-Jul-2026, FY 26-27 was ~100 days old — so no bill raised inside it
 * COULD be 120 days overdue, and the split came out 100% brought-forward / 0% this year. A split
 * that is always 100/0 by construction tells management nothing.
 *
 * The horizon boundary is the one that carries information: it separates debt we inherited on day
 * one (opening balances seeded from the 1wM3 sheet, with their real Tally bill dates) from debt
 * that went bad on our watch. Measured: ₹4.35 cr of the ₹11.16 cr — 39%.
 *
 * It is EXACT rather than heuristic, because the pipeline filters period sales to
 * `date >= opening_date`, so nothing dated before the horizon can be anything but an opening bill.
 * (There is no flag to read instead: the pipeline `invoices` table has no is_opening column — that
 * exists only on the ConnectWave source — and Invoice.isCarryforward is computed by the pipeline
 * but never written and never read.)
 */
export const isBroughtForward = (b: EnrichedBill, horizonStart: string): boolean =>
  !!horizonStart && !!b.inv.date && b.inv.date < horizonStart;

/**
 * First day of the data horizon, derived from the earliest month the dashboard has data for
 * ("Apr-25" → "2025-04-01"). Returns "" when the trend is empty, in which case the caller must
 * hide the brought-forward split rather than report every bill as in-period.
 */
export function horizonStartFrom(months: string[]): string {
  const first = months[0];
  if (!first) return "";
  const [mon, yy] = first.split("-");
  const idx = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    .indexOf(mon);
  const year = Number(yy);
  if (idx < 0 || Number.isNaN(year)) return "";
  return `${2000 + year}-${String(idx + 1).padStart(2, "0")}-01`;
}

/* ── Facts ──────────────────────────────────────────────────────────────────────────── */

/** Everything the report knows about one customer's aged debt. All rupees, all from the bills. */
export interface OverdueFacts {
  /** THE HEADLINE: Σ pending of bills past the cutoff. */
  aged: number;
  /** Of `aged`, the opening debt carried in from before the data horizon. */
  agedBroughtForward: number;
  /** Of `aged`, the part billed since the horizon. aged === agedBroughtForward + agedInPeriod. */
  agedInPeriod: number;
  /** Of `aged`, the part more than 180 days past due (derived from BILLS, never agingBuckets). */
  agedOver180: number;
  /** How many open bills are past the cutoff. */
  agedBillCount: number;
  /** Worst overdueDays among this customer's AGED bills. Not c.maxOverdueDays — that is an
   *  unfiltered max across every ledger and every bill, and would contradict the drill-down. */
  oldestOverdueDays: number;
  /** Bill date of the oldest aged bill (ISO), or "" when there is none. */
  oldestBillDate: string;

  /** Σ pending of ALL positive open bills (aged or not). The % Aged denominator. */
  billedOutstanding: number;
  /** Σ pending of negative bills — advances / unallocated receipts. A credit, so <= 0. */
  onAccount: number;
  /** The net ledger balance not carried by any real bill (the synthetic ledgerAdj line). */
  unbilledAdj: number;
  /** billedOutstanding + onAccount + unbilledAdj === the customer's NET ledger balance. */
  totalOutstanding: number;
  /** Total overdue at ANY age (>0 days), for context beside the aged slice. */
  totalOverdue: number;

  /** An aged bill offset by a bigger advance → the customer is net in credit. Flagged, not hidden:
   *  hiding them would break the tie to the Aging Report, which counts them too. */
  isNetCredit: boolean;

  /** Most recent collection across the customer's IN-SCOPE ledgers. null = never paid. */
  lastReceiptDate: string | null;
  /** Days from lastReceiptDate to as-of. null when never paid. */
  daysSinceLastReceipt: number | null;
  /** Billed in the trailing window (last 3 months) — "we are still supplying a non-payer". */
  salesInWindow: number;
}

const daysBetween = (fromIso: string, toIso: string): number | null => {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
};

/* ── Rows ───────────────────────────────────────────────────────────────────────────── */

/** One customer on the report. */
export interface OARow {
  customer: ConsolidatedCustomer;
  facts: OverdueFacts;
  /** Parent group from the mapping sheet, or the customer's own name when ungrouped. */
  group: string;
}

/** What buildOverdueRows needs. Everything is pre-filtered by the caller. */
export interface BuildRowsInput {
  /** Consolidated (by-name) customers already narrowed by the page's filters. */
  customers: ConsolidatedCustomer[];
  /** Bills from enumerateBills + the injected ledgerAdj lines, keyed by RAW ledger id. */
  billsByLedger: Map<string, EnrichedBill[]>;
  /** Raw ledger ids that survived the page's filters — the intersection guard (see header). */
  inScopeLedgerIds: ReadonlySet<string>;
  /** ledgerId → month label → sales (₹), from collections.ts::buildMonthlySeries. */
  salesByLedgerMonth: Map<string, Map<string, number>>;
  /** The trailing months that "Sales in Window" covers. */
  windowMonths: string[];
  /** ledgerId → last receipt ISO, from collections.ts::buildLastReceiptDates. */
  lastReceiptByLedger: Map<string, string | null>;
  /** customer name → parent group. */
  groupOf: (c: ConsolidatedCustomer) => string;
  cutoff: number;
  /** First day of the data horizon — the brought-forward boundary. See isBroughtForward. */
  horizonStart: string;
  asOfDate: string;
  /** Drop brought-forward bills entirely (the "Exclude brought-forward" toggle). */
  excludeBroughtForward: boolean;
}

/**
 * Build one row per consolidated customer that has any aged debt.
 *
 * Money is summed over the customer's IN-SCOPE ledgers only (constituentIds ∩ inScopeLedgerIds),
 * so a company/salesperson/location filter narrows the rupees as well as the row list. Customers
 * with no aged bill are absent by design — this is a list of people with old debt.
 */
export function buildOverdueRows(input: BuildRowsInput): OARow[] {
  const {
    customers, billsByLedger, inScopeLedgerIds, salesByLedgerMonth, windowMonths,
    lastReceiptByLedger, groupOf, cutoff, horizonStart, asOfDate, excludeBroughtForward,
  } = input;

  const rows: OARow[] = [];

  for (const c of customers) {
    const ids = (c.constituentIds?.length ? c.constituentIds : [c.id])
      .filter((id) => inScopeLedgerIds.has(id));
    if (ids.length === 0) continue;

    let aged = 0, agedBF = 0, agedOver180 = 0, agedBillCount = 0;
    let billedOutstanding = 0, onAccount = 0, unbilledAdj = 0, totalOverdue = 0;
    let oldestOverdueDays = 0;
    let oldestBillDate = "";
    let salesInWindow = 0;
    let lastReceiptDate: string | null = null;

    for (const id of ids) {
      for (const b of billsByLedger.get(id) ?? []) {
        // The ledger-reconciliation line is not a bill: its own column, never a bucket.
        if (b.isLedgerAdj) {
          unbilledAdj += b.inv.pending;
          continue;
        }
        const bf = isBroughtForward(b, horizonStart);
        if (excludeBroughtForward && bf) continue;

        const p = b.inv.pending;
        if (p > 0) billedOutstanding += p;
        else if (p < 0) onAccount += p;
        if (p > 0 && b.inv.overdueDays > 0) totalOverdue += p;

        if (isAged(b, cutoff)) {
          aged += p;
          agedBillCount += 1;
          if (bf) agedBF += p;
          if (b.inv.overdueDays > 180) agedOver180 += p;
          if (b.inv.overdueDays > oldestOverdueDays) oldestOverdueDays = b.inv.overdueDays;
          if (b.inv.date && (!oldestBillDate || b.inv.date < oldestBillDate)) oldestBillDate = b.inv.date;
        }
      }

      const byMonth = salesByLedgerMonth.get(id);
      if (byMonth) for (const m of windowMonths) salesInWindow += byMonth.get(m) ?? 0;

      const last = lastReceiptByLedger.get(id) ?? null;
      if (last && (!lastReceiptDate || last > lastReceiptDate)) lastReceiptDate = last;
    }

    if (aged <= EPS) continue;

    const totalOutstanding = billedOutstanding + onAccount + unbilledAdj;

    rows.push({
      customer: c,
      group: groupOf(c),
      facts: {
        aged,
        agedBroughtForward: agedBF,
        agedInPeriod: aged - agedBF,
        agedOver180,
        agedBillCount,
        oldestOverdueDays,
        oldestBillDate,
        billedOutstanding,
        onAccount,
        unbilledAdj,
        totalOutstanding,
        totalOverdue,
        isNetCredit: totalOutstanding <= 0,
        lastReceiptDate,
        daysSinceLastReceipt:
          lastReceiptDate && asOfDate ? daysBetween(lastReceiptDate, asOfDate) : null,
        salesInWindow,
      },
    });
  }

  return rows;
}

/* ── Metrics (the roll-up contract for buildGroupTree) ──────────────────────────────── */

/**
 * The SUMMABLE columns. `oldestOverdueDays` and `daysSinceLastReceipt` fold with MAX — a group
 * inherits its WORST member — everything else with SUM. `daysSinceLastReceipt` uses -1 as the
 * "no receipt data" floor and NEVER_PAID (from collections.ts) as the "never paid" ceiling, so
 * MAX still ranks a never-payer worst. Render it through `daysText`, or a management screen
 * prints 9007199254740991.
 *
 * There is NO percentage stored here, on purpose — see OA_COLUMNS.
 */
export interface OAMetrics {
  customers: number;
  aged: number;
  agedBroughtForward: number;
  agedInPeriod: number;
  agedOver180: number;
  agedBillCount: number;
  billedOutstanding: number;
  onAccount: number;
  unbilledAdj: number;
  totalOutstanding: number;
  totalOverdue: number;
  creditLimit: number;
  salesInWindow: number;
  /** MAX-folded. */
  oldestOverdueDays: number;
  /** MAX-folded, NEVER_PAID sentinel. */
  daysSinceLastReceipt: number;
  /** Counts, for the KPI cards. */
  neverPaid: number;
  stillBuying: number;
  netCredit: number;
  fullyAged: number;
}

export const emptyOAMetrics = (): OAMetrics => ({
  customers: 0, aged: 0, agedBroughtForward: 0, agedInPeriod: 0, agedOver180: 0,
  agedBillCount: 0, billedOutstanding: 0, onAccount: 0, unbilledAdj: 0,
  totalOutstanding: 0, totalOverdue: 0, creditLimit: 0, salesInWindow: 0,
  oldestOverdueDays: 0, daysSinceLastReceipt: -1,
  neverPaid: 0, stillBuying: 0, netCredit: 0, fullyAged: 0,
});

/** A customer whose open bills are (essentially) ALL past the cutoff — nothing recent is holding
 *  the balance up. Measured against billedOutstanding, never totalOutstanding (which can be <= 0). */
export const isFullyAged = (f: OverdueFacts): boolean =>
  f.billedOutstanding > EPS && f.aged >= 0.995 * f.billedOutstanding;

export const oaMetricsOf = (r: OARow): OAMetrics => {
  const f = r.facts;
  const never = f.lastReceiptDate === null;
  return {
    customers: 1,
    aged: f.aged,
    agedBroughtForward: f.agedBroughtForward,
    agedInPeriod: f.agedInPeriod,
    agedOver180: f.agedOver180,
    agedBillCount: f.agedBillCount,
    billedOutstanding: f.billedOutstanding,
    onAccount: f.onAccount,
    unbilledAdj: f.unbilledAdj,
    totalOutstanding: f.totalOutstanding,
    totalOverdue: f.totalOverdue,
    // All-ledger value off the consolidated row (credit limit is a MAX, not a sum) — the one
    // field we can't derive from bills. Labelled as such in the UI.
    creditLimit: r.customer.creditLimit ?? 0,
    salesInWindow: f.salesInWindow,
    oldestOverdueDays: f.oldestOverdueDays,
    daysSinceLastReceipt: never ? NEVER_PAID : (f.daysSinceLastReceipt ?? -1),
    neverPaid: never ? 1 : 0,
    stillBuying: f.salesInWindow > EPS ? 1 : 0,
    netCredit: f.isNetCredit ? 1 : 0,
    fullyAged: isFullyAged(f) ? 1 : 0,
  };
};

export function addOAMetrics(acc: OAMetrics, m: OAMetrics): void {
  acc.customers          += m.customers;
  acc.aged               += m.aged;
  acc.agedBroughtForward += m.agedBroughtForward;
  acc.agedInPeriod     += m.agedInPeriod;
  acc.agedOver180        += m.agedOver180;
  acc.agedBillCount      += m.agedBillCount;
  acc.billedOutstanding  += m.billedOutstanding;
  acc.onAccount          += m.onAccount;
  acc.unbilledAdj        += m.unbilledAdj;
  acc.totalOutstanding   += m.totalOutstanding;
  acc.totalOverdue       += m.totalOverdue;
  acc.creditLimit        += m.creditLimit;
  acc.salesInWindow      += m.salesInWindow;
  acc.neverPaid          += m.neverPaid;
  acc.stillBuying        += m.stillBuying;
  acc.netCredit          += m.netCredit;
  acc.fullyAged          += m.fullyAged;
  // Non-summable: the group inherits its worst member.
  acc.oldestOverdueDays    = Math.max(acc.oldestOverdueDays, m.oldestOverdueDays);
  acc.daysSinceLastReceipt = Math.max(acc.daysSinceLastReceipt, m.daysSinceLastReceipt);
}

/** Fold a row set into one metrics total. The KPI cards read this over the UNFOCUSED rows. */
export function oaTotalsOf(rows: OARow[]): OAMetrics {
  const acc = emptyOAMetrics();
  for (const r of rows) addOAMetrics(acc, oaMetricsOf(r));
  return acc;
}

/* ── Focus lenses (the clickable KPI cards) ─────────────────────────────────────────── */

/**
 * Defined FRESH — deliberately NOT imported from collections.ts.
 *
 * ZC_FOCUS_PREDICATES.over180 reads `c.agingBuckets["180_plus"]`, the very pre-aggregated bucket
 * this report exists to avoid (see the header). Reusing it would give a lens whose membership
 * disagreed with the "180+" column sitting right next to it.
 *
 * Multiple lenses AND together: `neverPaid` + `stillBuying` is the most damning list on the
 * report — customers we are still shipping goods to who have never paid us a rupee.
 */
export type OAFocus =
  | "over180" | "broughtForward" | "neverPaid" | "stillBuying"
  | "blocked" | "netCredit" | "fullyAged";

export const OA_FOCUS_LABELS: Record<OAFocus, string> = {
  over180:        "> 180 Days",
  broughtForward: "Brought Forward",
  neverPaid:      "Never Paid",
  stillBuying:    "Still Buying",
  blocked:        "Red Mark",
  netCredit:      "Net Credit",
  fullyAged:      "Fully Aged",
};

export const OA_FOCUS_PREDICATES: Record<OAFocus, (r: OARow) => boolean> = {
  over180:        (r) => r.facts.agedOver180 > EPS,
  broughtForward: (r) => r.facts.agedBroughtForward > EPS,
  neverPaid:      (r) => r.facts.lastReceiptDate === null,
  stillBuying:    (r) => r.facts.salesInWindow > EPS,
  blocked:        (r) => r.customer.blocked === true,
  netCredit:      (r) => r.facts.isNetCredit,
  fullyAged:      (r) => isFullyAged(r.facts),
};

/** Apply every active lens (AND). An empty set means no focus — the full list. */
export function applyOAFocus(rows: OARow[], focus: ReadonlySet<OAFocus>): OARow[] {
  if (focus.size === 0) return rows;
  const preds = [...focus].map((f) => OA_FOCUS_PREDICATES[f]);
  return rows.filter((r) => preds.every((p) => p(r)));
}

/* ── Columns ────────────────────────────────────────────────────────────────────────── */

/**
 * Every column here must FOLD — a group row is the sum (or max) of its children. `oldestBillDate`
 * is deliberately NOT a column: a salesperson has no single "oldest bill date", and a column that
 * renders "—" on every group row is noise. `oldestOverdueDays` carries the same signal and folds
 * with MAX. The date itself lives on the per-customer export sheet and in the drill-down.
 */
export type OAColumnKey =
  | "customers" | "aged" | "agedBroughtForward" | "agedInPeriod" | "agedOver180"
  | "agedPct" | "totalOverdue" | "totalOutstanding" | "billedOutstanding" | "onAccount"
  | "unbilledAdj" | "oldestOverdueDays" | "agedBillCount"
  | "creditLimit" | "daysSinceLastReceipt" | "salesInWindow";

export interface OAColumn {
  key: OAColumnKey;
  label: string;
  kind: "money" | "count" | "days" | "pct";
  /**
   * The node's value, derived from its SUMMED metrics. Percentages return null when there is no
   * denominator — which is why this is a function and not a metrics key. It is the single place a
   * % is ever computed, and it always divides the node's own totals, never averages children's.
   */
  value: (m: OAMetrics) => number | null;
  /** Clicking opens the bill drill-down for this lens. */
  drill?: "aged" | "totalOverdue" | "billedOutstanding";
  /** Red when it means something is wrong. */
  alarm?: boolean;
}

/**
 * `agedPct` divides by billedOutstanding — NOT totalOutstanding.
 *
 * unbilledAdj absorbs advances, unreopened cheque returns and opening residue, and is frequently
 * large and NEGATIVE. A net-ledger denominator can therefore be ≈0 (the % explodes) or negative
 * (a customer net in credit still carrying one ancient bill → a negative percentage). Both are
 * real customers, and both would land in front of management. billedOutstanding is a strict
 * superset of `aged`, so this is always in [0, 100] and answers the honest question: how much of
 * what sits on open bills is past the cutoff.
 */
export const OA_COLUMNS: OAColumn[] = [
  { key: "customers",          label: "Customers",        kind: "count", value: (m) => m.customers },
  { key: "aged",               label: "Aged",             kind: "money", value: (m) => m.aged, drill: "aged", alarm: true },
  { key: "agedBroughtForward", label: "of which B/F",     kind: "money", value: (m) => m.agedBroughtForward, alarm: true },
  { key: "agedInPeriod",       label: "of which Billed",  kind: "money", value: (m) => m.agedInPeriod },
  { key: "agedOver180",        label: "of which 180+",    kind: "money", value: (m) => m.agedOver180, alarm: true },
  { key: "agedPct",            label: "% Aged",           kind: "pct",   value: (m) => pctOf(m.aged, m.billedOutstanding) },
  { key: "totalOverdue",       label: "Total Overdue",    kind: "money", value: (m) => m.totalOverdue, drill: "totalOverdue" },
  { key: "totalOutstanding",   label: "Outstanding",      kind: "money", value: (m) => m.totalOutstanding },
  { key: "onAccount",          label: "On Account",       kind: "money", value: (m) => m.onAccount },
  { key: "billedOutstanding",  label: "Billed O/s",       kind: "money", value: (m) => m.billedOutstanding, drill: "billedOutstanding" },
  { key: "unbilledAdj",        label: "Unbilled Adj.",    kind: "money", value: (m) => m.unbilledAdj },
  { key: "oldestOverdueDays",  label: "Max Overdue Days", kind: "days",  value: (m) => m.oldestOverdueDays, alarm: true },
  { key: "agedBillCount",      label: "Aged Bills",       kind: "count", value: (m) => m.agedBillCount },
  { key: "creditLimit",        label: "Credit Limit",     kind: "money", value: (m) => m.creditLimit },
  { key: "daysSinceLastReceipt", label: "Days Since Receipt", kind: "days", value: (m) => m.daysSinceLastReceipt, alarm: true },
  { key: "salesInWindow",      label: "Sales (Last 3M)",  kind: "money", value: (m) => m.salesInWindow, alarm: true },
];

/** The management column set. Everything else lives behind the ColumnPicker.
 *  On Account is a DEFAULT: it is what explains a net-credit row's negative Outstanding. */
export const DEFAULT_OA_COLUMNS: OAColumnKey[] = [
  "customers", "aged", "agedBroughtForward", "agedOver180", "agedPct",
  "totalOverdue", "totalOutstanding", "onAccount", "oldestOverdueDays",
];

/* ── Grouping dimensions + View presets ─────────────────────────────────────────────── */

export type OADim = "salesperson" | "customer" | "group" | "category" | "company" | "location";

export const OA_DIMENSIONS: { key: OADim; label: string }[] = [
  { key: "customer",    label: "Customer" },
  { key: "salesperson", label: "Salesperson" },
  { key: "group",       label: "Customer Group" },
  { key: "category",    label: "Customer Category" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
];

export const OA_PRESETS: GroupByPreset<OADim>[] = [
  { label: "Customer",                  dims: ["customer"] },
  { label: "Salesperson → Customer",    dims: ["salesperson", "customer"] },
  { label: "Customer Group",            dims: ["group"] },
  { label: "Customer Group → Customer", dims: ["group", "customer"] },
  { label: "Category → Customer",       dims: ["category", "customer"] },
  { label: "Company → Customer",        dims: ["company", "customer"] },
  { label: "Salesperson",               dims: ["salesperson"] },
  { label: "Location",                  dims: ["location"] },
];
