/**
 * customerCategory.ts — the "Customer Category Report (A/B/C/D/E)" engine. Pure, UI-free.
 *
 * Every customer carries a TIER TAG — `Customer.category` (A/B/C/D/E, AA, or blank) — hand-
 * maintained by Sales/Finance in the Credit-Limit master sheet. Everywhere else in the app it
 * is only ever a FILTER. This is the one report where the tier is the SPINE: the whole book,
 * pivoted by grade, plus the question nobody could ask before — do the grades mean anything,
 * and who is tagged wrong?
 *
 * Everything below was calibrated against the live pipeline book (13-Jul-2026, Both FYs,
 * 1,780 ledgers → 1,263 customers). Where a decision looks arbitrary, it isn't — the measured
 * reason is in the comment. The numbers themselves WILL drift; none of them are hard-coded.
 *
 * ── 1. Owed / Advances / Net, never a single "outstanding" ────────────────────────────
 *
 * Tier E's NET balance is NEGATIVE (−₹4.80 cr): 25 of its customers sit on ₹5.01 cr of
 * advances while only 11 owe anything. Compute share-of-book on the net and tier E reads
 * −8.9% — a negative slice of a pie. So the book is always split three ways:
 *
 *     Owed      = Σ max(0, net)     ← always positive; SHARE-OF-BOOK divides by this
 *     Advances  = Σ min(0, net)     ← money customers PRE-PAID us. ₹13.93 cr of it,
 *                                     invisible anywhere else in the app.
 *     Net       = Owed + Advances   ← = sumOutstanding(). TIES TO THE DASHBOARD.
 *
 * The split is taken on the CUSTOMER's net, not per-ledger. A customer +₹10 L in one company
 * and −₹2 L in another OWES ₹8 L and holds NO advance; splitting per-ledger would report both
 * sides and inflate each (measured: ₹68.66 cr / −₹14.63 cr per-ledger vs ₹67.96 cr / −₹13.93 cr
 * per-customer — same Net, different story).
 *
 * ── 2. The behaviour grade ignores Collection %, and that is the whole point ───────────
 *
 * The obvious grade is "who pays us". Measured with this app's own formula
 * (collected ÷ (opening + sales in window)), by tier:
 *
 *     A 41%   B 48%   C 44%   D 45%   E 44%        ← a 7-point spread. NOISE.
 *
 * D — the tier with 43% of its money past 180 days — collects marginally MORE than A. Grade on
 * Collection % and the report would tell management that D is their best-paying tier. What
 * actually separates a good customer from a rotten one is AGE:
 *
 *     180+ / owed:   A 5%    B 6%    C 6%    D 43%    ← an 8× spread. SIGNAL.
 *     max overdue:   A 169d  B 137d  C 154d  D 317d
 *
 * So `riskScoreOf` is built from aging and overdue only. Collection % survives as a COLUMN,
 * because management wants to see it — but it never grades anyone.
 *
 * ── 3. Quintiles, not fixed thresholds ────────────────────────────────────────────────
 *
 * The first cut of this report used absolute grade cuts (>=80 → A, etc). Measured, they flagged
 * 117 customers holding ₹43 cr — 80% of the entire book — as "over-graded", including one that
 * was 33 days overdue. A fixed threshold cannot know the shape of the book it lands in.
 *
 * Ranking into five equal quintiles CANNOT blow up or collapse to zero, and "the worst fifth of
 * our payers" is what management means anyway. Measured, it separates cleanly:
 *
 *     behaves-A: 0% at 180+,  30d overdue   |   behaves-E: 77% at 180+, 421d overdue
 *
 * ── 4. Aging is bill-wise ─────────────────────────────────────────────────────────────
 *
 * Every overdue/aging rupee here comes from agingReport::enumerateBills, NOT
 * `Customer.agingBuckets`. Not because the buckets are broken (measured, 180+ agrees to 0.6%) —
 * but because the Aging Report and the Overdue-120 report are both bill-wise, so all three tie
 * to the rupee, and only a bill can be drilled into.
 *
 * CONSEQUENCE, and it must be on screen: bill-wise Overdue (₹38.00 cr) reads ~7.8% ABOVE the
 * DASHBOARD's Overdue (₹35.26 cr, which sums the ledger column). OverdueAgingReport already
 * carries this same difference. Net Outstanding still ties exactly.
 *
 * ── 5. Dormant accounts ───────────────────────────────────────────────────────────────
 *
 * 604 of 1,263 customers have NEVER transacted in the whole 16-month horizon — no sales, no
 * balance, ever. 449 of them are tagged E. Counting them makes "46% of our customers are E" a
 * statistic about dead ledgers. `isActive` gates them out by default; they are a lens, not a
 * silent inclusion.
 *
 * ── Units ─────────────────────────────────────────────────────────────────────────────
 * Everything in and out of this module is RUPEES.
 */

import "./customerCategory.augment";

import {
  pctOf,
  zcDimValue,
  dominantSaleTypeOf,
  NEVER_PAID,
  SALE_TYPES,
  factsForScoped,
  type CollectionFacts,
  type MonthFacts,
} from "./collections";
import { utilizationPct } from "./receivables";
import { buildGroupTree, type GroupNode } from "./groupTree";
import type { GroupByPreset } from "../components/GroupByBuilder";
import type { EnrichedBill } from "./agingReport";
import type { ConsolidatedCustomer, Customer, SaleType } from "./types";

/** Rupee guard, matching enumerateBills' own `Math.abs(pending) < 0.5` drop. */
export const EPS = 0.5;

/* ── The tier spine ──────────────────────────────────────────────────────────────────── */

export type Tier = "A" | "B" | "C" | "D" | "E" | "AA" | "Uncategorized";

/** The bucket for a blank tag. Must equal UNCATEGORIZED in CustomerCategoryMultiSelect. */
export const UNCATEGORIZED_TIER: Tier = "Uncategorized";

/**
 * Display AND sort order. AA and Uncategorized last, deliberately: neither is a grade.
 * AA is an internal / related-party marker (measured: 5 customers, ₹0 ever collected against
 * ₹91.4 L of sales, 99% of its balance past 180 days). Uncategorized is simply untagged.
 */
export const TIER_ORDER: Tier[] = ["A", "B", "C", "D", "E", "AA", "Uncategorized"];

export const TIER_RANK: Record<Tier, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, AA: 5, Uncategorized: 6,
};

export const TIER_LABELS: Record<Tier, string> = {
  A: "A", B: "B", C: "C", D: "D", E: "E",
  AA: "AA (internal)",
  Uncategorized: "Uncategorized",
};

/** Chart / row-accent colours. Graded tiers run green → red; AA and Uncategorized stay grey. */
export const TIER_COLORS: Record<Tier, string> = {
  A: "#16a34a", B: "#65a30d", C: "#ca8a04", D: "#ea580c", E: "#dc2626",
  AA: "#7c3aed", Uncategorized: "#94a3b8",
};

/** The five real grades. AA / Uncategorized are NOT on this scale — see mismatchOf. */
export const GRADED_TIERS: Tier[] = ["A", "B", "C", "D", "E"];
export const isGradedTier = (t: Tier): boolean => GRADED_TIERS.includes(t);

const asTier = (raw: string): Tier | null => {
  const t = raw.trim().toUpperCase();
  return (TIER_ORDER as string[]).includes(t) && t !== UNCATEGORIZED_TIER ? (t as Tier) : null;
};

/** Every distinct tier tag across a customer's ledgers. Empty = untagged. */
export function tierTagsOf(c: ConsolidatedCustomer): Tier[] {
  const raw = c.categories?.length ? c.categories : c.category ? [c.category] : [];
  const out: Tier[] = [];
  for (const r of raw) {
    const t = asTier(String(r ?? ""));
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The ONE tier a customer lands in. The scoreboard is a partition — share-of-book only means
 * something if every customer sits in exactly one bucket, so a customer can never be "A, C".
 *
 * MEASURED: 0 of 1,263 customers carry conflicting tags (384 DO trade under multiple ledgers;
 * all are tagged consistently). So the tie-break below is a defensive fallback for a future
 * sheet edit, not a feature — which is why there is no "conflicting tags" lens. If the sheet
 * ever drifts, `hasTierConflict` counts it and the report says so rather than silently picking.
 *
 * The fallback ranks by where the MONEY is (largest |balance| wins), the same argument already
 * settled for dominantSaleTypeOf: classify a customer by what they actually are to us.
 */
export function tierOf(
  c: ConsolidatedCustomer,
  ledgerById: Map<string, Customer>,
  scopeIds: ReadonlySet<string> | null,
): Tier {
  const tags = tierTagsOf(c);
  if (tags.length === 0) return UNCATEGORIZED_TIER;
  if (tags.length === 1) return tags[0];

  const totals = new Map<Tier, number>();
  for (const id of ledgerIdsOf(c, scopeIds)) {
    const l = ledgerById.get(id);
    const t = l ? asTier(String(l.category ?? "")) : null;
    if (t) totals.set(t, (totals.get(t) ?? 0) + Math.abs(l?.outstanding ?? 0));
  }
  let best = tags[0];
  let max = -1;
  for (const t of tags) {
    const v = totals.get(t) ?? 0;
    // Ties fall to the STRONGER tag (lower rank) — deterministic, never order-dependent.
    if (v > max || (v === max && TIER_RANK[t] < TIER_RANK[best])) { max = v; best = t; }
  }
  return best;
}

/** The customer is tagged two different ways at once — a tagging defect in its own right. */
export const hasTierConflict = (c: ConsolidatedCustomer): boolean => tierTagsOf(c).length > 1;

/** The customer's constituent ledgers, narrowed to the ones that survived the page filters. */
function ledgerIdsOf(c: ConsolidatedCustomer, scopeIds: ReadonlySet<string> | null): string[] {
  const all = c.constituentIds?.length ? c.constituentIds : [c.id];
  return scopeIds ? all.filter((id) => scopeIds.has(id)) : all;
}

/* ── Aging, bill-wise ────────────────────────────────────────────────────────────────── */

export const AGING_BUCKET_KEYS = [
  "od_0_30", "od_31_60", "od_61_90", "od_91_120", "od_121_180", "od_180_plus",
] as const;
export type AgingBucketKey = (typeof AGING_BUCKET_KEYS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  od_0_30: "0-30", od_31_60: "31-60", od_61_90: "61-90",
  od_91_120: "91-120", od_121_180: "121-180", od_180_plus: "180+",
};

export interface BucketSplit {
  overdue: number;
  od_0_30: number; od_31_60: number; od_61_90: number;
  od_91_120: number; od_121_180: number; od_180_plus: number;
  billCount: number;
}

export const emptyBuckets = (): BucketSplit => ({
  overdue: 0, od_0_30: 0, od_31_60: 0, od_61_90: 0,
  od_91_120: 0, od_121_180: 0, od_180_plus: 0, billCount: 0,
});

/**
 * ledgerId → its bill-wise overdue split.
 *
 * The gate mirrors agingReport::addBill VERBATIM — `!isLedgerAdj && pending > 0 && overdueKey`
 * — so this report's Overdue and 180+ tie to the Aging Report and the Overdue-120 report to the
 * rupee. Both clauses are load-bearing:
 *   - isLedgerAdj : the synthetic net-ledger line is not a bill and carries overdueDays 0.
 *   - pending > 0 : an on-account credit is money we HOLD, not money we are owed.
 * Change agingReport's bucket boundaries and you must change nothing here — the key comes
 * straight off the bill.
 */
export function buildBucketsByLedger(bills: EnrichedBill[]): Map<string, BucketSplit> {
  const out = new Map<string, BucketSplit>();
  for (const b of bills) {
    if (b.isLedgerAdj) continue;
    const p = b.inv.pending;
    if (p <= 0 || !b.overdueKey) continue;
    let s = out.get(b.cust.id);
    if (!s) { s = emptyBuckets(); out.set(b.cust.id, s); }
    s[b.overdueKey] += p;
    s.overdue += p;
    s.billCount += 1;
  }
  return out;
}

/* ── Revenue Pareto (ABC) ────────────────────────────────────────────────────────────── */

/** `N` = NO SALES in the period. Deliberately not "the bottom 5%" — those are different facts. */
export type ParetoClass = "A" | "B" | "C" | "N";

export const PARETO_LABELS: Record<ParetoClass, string> = {
  A: "Revenue A (top 80%)",
  B: "Revenue B (next 15%)",
  C: "Revenue C (last 5%)",
  N: "No sales in period",
};

export const PARETO_A_CUT = 80;
export const PARETO_B_CUT = 95;

export interface ParetoEntry {
  /** 1 = biggest, among customers with sales. 0 for class N. */
  rank: number;
  sharePct: number;
  cumPct: number;
  cls: ParetoClass;
  /** 1..10 by sales rank; 0 for class N. */
  decile: number;
}

const NO_SALES: ParetoEntry = { rank: 0, sharePct: 0, cumPct: 0, cls: "N", decile: 0 };

/**
 * Rank customers by sales, cut at 80% / 95% cumulative share. The customer that CROSSES the
 * line is INSIDE it (standard ABC). Sales are the SELECTED WINDOW's, so the classification
 * moves with the period selector — which is correct: "our biggest customers" means this period.
 */
export function computePareto(rows: { id: string; sales: number }[]): Map<string, ParetoEntry> {
  const out = new Map<string, ParetoEntry>();
  const withSales = rows.filter((r) => r.sales > EPS).sort((a, b) => b.sales - a.sales);
  for (const r of rows) out.set(r.id, NO_SALES);

  const total = withSales.reduce((s, r) => s + r.sales, 0);
  if (total <= 0 || withSales.length === 0) return out;

  let cum = 0;
  withSales.forEach((r, i) => {
    cum += r.sales;
    const cumPct = (cum / total) * 100;
    out.set(r.id, {
      rank: i + 1,
      sharePct: (r.sales / total) * 100,
      cumPct,
      cls: cumPct <= PARETO_A_CUT ? "A" : cumPct <= PARETO_B_CUT ? "B" : "C",
      decile: Math.max(1, Math.ceil(((i + 1) / withSales.length) * 10)),
    });
  });
  return out;
}

/* ── The behaviour grade ─────────────────────────────────────────────────────────────── */

export type BehaviourGrade = "A" | "B" | "C" | "D" | "E";
export const BEHAVIOUR_GRADES: BehaviourGrade[] = ["A", "B", "C", "D", "E"];
export const BEHAVIOUR_RANK: Record<BehaviourGrade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

/**
 * Risk-score weights. Higher score = worse payer. Exported so they can be tuned against a
 * future book without a code change — see the module header for why Collection % is absent.
 * The day-count divisor 3.65 maps 365 days → 100 points.
 */
export const RISK_WEIGHTS = { over180: 0.45, overdue: 0.30, days: 0.25 } as const;
export const RISK_DAYS_DIVISOR = 3.65;

/** 0..100, higher = worse. Meaningless for a customer with no balance — see assignBehaviourGrades. */
export function riskScoreOf(owed: number, buckets: BucketSplit, maxOverdueDays: number): number {
  const o = Math.max(1, owed);
  const r180 = Math.min(100, (buckets.od_180_plus / o) * 100);
  const rOvd = Math.min(100, (buckets.overdue / o) * 100);
  const rDay = Math.min(100, maxOverdueDays / RISK_DAYS_DIVISOR);
  return RISK_WEIGHTS.over180 * r180 + RISK_WEIGHTS.overdue * rOvd + RISK_WEIGHTS.days * rDay;
}

/**
 * Rank every customer WHO OWES MONEY by risk score and cut into five equal quintiles.
 *
 * Everyone else gets `null`, never "E": a customer with no balance is not a bad payer, they are
 * an unscorable one. Grading them E would bury the real defaulters under 760 dormant ledgers.
 *
 * Mutates `row.payScore` / `row.grade` in place — it is a rank ACROSS the set, so it cannot be
 * a per-row pure function.
 */
export function assignBehaviourGrades(rows: CCRow[]): void {
  for (const r of rows) {
    r.payScore = r.owed > 1 ? riskScoreOf(r.owed, r.buckets, r.maxOverdueDays) : null;
    r.grade = null;
  }
  const scored = rows.filter((r) => r.payScore !== null).sort((a, b) => a.payScore! - b.payScore!);
  const n = scored.length;
  if (n === 0) return;
  scored.forEach((r, i) => {
    r.grade = BEHAVIOUR_GRADES[Math.min(4, Math.floor(i / (n / 5)))];
  });
}

/* ── Mismatch: what they're tagged vs how they behave ────────────────────────────────── */

export type MismatchClass = "over_graded" | "under_graded" | "ok";

export const MISMATCH_GAP_OPTIONS = [2, 3] as const;
export const DEFAULT_MISMATCH_GAP = 2;

export const MISMATCH_LABELS: Record<MismatchClass, string> = {
  over_graded: "Over-graded",
  under_graded: "Under-graded",
  ok: "In line",
};

/**
 * `null` = NOT TESTABLE, which is different from "fine":
 *   - AA / Uncategorized are not on the A–E scale.
 *   - A customer with no balance has no payment behaviour to compare against.
 * The UI must render these as "—", never as "In line".
 */
export function mismatchOf(r: CCRow, gap: number): MismatchClass | null {
  if (!isGradedTier(r.tier) || r.grade === null) return null;
  // TIER_RANK and BEHAVIOUR_RANK agree on A..E = 0..4, so the two scales are directly comparable.
  const d = BEHAVIOUR_RANK[r.grade] - TIER_RANK[r.tier];
  if (d >= gap) return "over_graded";   // behaves WORSE than tagged
  if (-d >= gap) return "under_graded"; // behaves BETTER than tagged
  return "ok";
}

/** Plain English, for the export's `Why` column and the row tooltip. Never a code. */
export function mismatchReasonOf(r: CCRow): string {
  if (r.grade === null || !isGradedTier(r.tier)) return "";
  const bits: string[] = [`Tagged ${r.tier}`, `behaves like ${r.grade}`];
  const o = Math.max(1, r.owed);
  const p180 = Math.round((r.buckets.od_180_plus / o) * 100);
  const pOvd = Math.round((r.buckets.overdue / o) * 100);
  if (p180 >= 25) bits.push(`${p180}% of balance past 180 days`);
  else if (pOvd >= 50) bits.push(`${pOvd}% of balance overdue`);
  if (r.maxOverdueDays > 0) bits.push(`${r.maxOverdueDays} days overdue`);
  if (r.facts.lastReceiptDate === null) bits.push("never paid");
  if (r.facts.chequeReturns > EPS) bits.push("cheque returned");
  return bits.join(" · ");
}

/* ── The row ─────────────────────────────────────────────────────────────────────────── */

export interface CCRow {
  customer: ConsolidatedCustomer;
  facts: CollectionFacts;
  group: string;
  /** The single tier bucket this customer lives in. THE spine. */
  tier: Tier;
  tags: Tier[];
  conflict: boolean;

  /** Balance over the IN-SCOPE ledgers only. net = owed + advances, always. */
  net: number;
  owed: number;       // max(0, net)
  advances: number;   // min(0, net)  — negative or 0

  buckets: BucketSplit;
  maxOverdueDays: number;
  creditLimit: number;
  saleType: SaleType;

  pareto: ParetoEntry;
  /** Risk score 0..100 (higher = worse). null when there is no balance to judge. */
  payScore: number | null;
  grade: BehaviourGrade | null;
}

/**
 * Contributes to at least one column. Everything else is a dead ledger — see header §5.
 *
 * ── The trap this is shaped to avoid ──────────────────────────────────────────────────
 * The obvious test is "sold something, or still owes something". It is WRONG, and wrong in the
 * worst direction: a customer who owed money at the start of the period and PAID IT ALL OFF has
 * no sales and no closing balance — so it would drop them. Measured, that silently removed
 * ₹5.3 cr of collections (and ₹8.6 cr of collectible) from the book, pulling the grand Collection %
 * from 47.9% down to 47.0%. In other words it excluded the customers who behaved BEST.
 *
 * So an account is active if there was anything to collect (`opening`), anything collected, any
 * billing, or any balance left. A dormant ledger — never sold, never paid, no balance — has none
 * of the four, which is exactly what `isDormantLedger` says.
 */
export const isActive = (r: CCRow): boolean =>
  r.facts.salesInWindow > EPS ||
  r.facts.collected > EPS ||
  r.facts.opening > 1 ||
  Math.abs(r.net) > 1;

/** Never transacted at all, anywhere in the data horizon — the data-hygiene worklist. */
export const isDormantLedger = (r: CCRow): boolean =>
  r.facts.lastSaleMonth === null && Math.abs(r.net) <= 1;

export interface BuildCCRowsInput {
  customers: ConsolidatedCustomer[];
  ledgerById: Map<string, Customer>;
  bucketsByLedger: Map<string, BucketSplit>;
  outstandingByType: Map<string, Partial<Record<SaleType, number>>>;
  series: Map<string, Map<string, MonthFacts>>;
  lastDates: Map<string, string | null>;
  balances: Map<string, number>;
  months: string[];
  windowMonths: string[];
  priorMonths: string[];
  asOfDate: string;
  /** In-scope ledger ids after the page's company / location / salesperson filters. */
  scopeIds: ReadonlySet<string> | null;
  groupOf: (c: ConsolidatedCustomer) => string;
}

/**
 * Two passes, and the order matters: Pareto and the behaviour grade are both RANKS ACROSS THE
 * SET, so neither can be computed while the rows are still being built.
 */
export function buildCCRows(input: BuildCCRowsInput): CCRow[] {
  const { customers, ledgerById, bucketsByLedger, outstandingByType, series, lastDates,
          balances, months, windowMonths, priorMonths, asOfDate, scopeIds, groupOf } = input;

  const rows: CCRow[] = customers.map((c) => {
    const ids = ledgerIdsOf(c, scopeIds);

    // The balance is summed over the SCOPED ledgers and split ONCE, on the customer's net —
    // see header §1. Splitting per-ledger would report an advance and a debt for the same
    // customer and inflate both sides of the book.
    let net = 0, maxOverdueDays = 0, creditLimit = 0;
    const buckets = emptyBuckets();
    for (const id of ids) {
      const l = ledgerById.get(id);
      if (!l) continue;
      net += l.outstanding ?? 0;
      maxOverdueDays = Math.max(maxOverdueDays, l.maxOverdueDays ?? 0);
      // MAX, not sum — mirrors consolidateByName (useAppData.ts:35).
      creditLimit = Math.max(creditLimit, l.creditLimit ?? 0);
      const b = bucketsByLedger.get(id);
      if (b) {
        for (const k of AGING_BUCKET_KEYS) buckets[k] += b[k];
        buckets.overdue += b.overdue;
        buckets.billCount += b.billCount;
      }
    }

    const facts = factsForScoped(
      c, series, lastDates, balances, months, windowMonths, priorMonths, asOfDate,
      scopeIds,
    );
    const tags = tierTagsOf(c);

    return {
      customer: c,
      facts,
      group: groupOf(c),
      tier: tierOf(c, ledgerById, scopeIds),
      tags,
      conflict: tags.length > 1,
      net,
      owed: Math.max(0, net),
      advances: Math.min(0, net),
      buckets,
      maxOverdueDays,
      creditLimit,
      saleType: dominantSaleTypeOf(c, outstandingByType),
      pareto: NO_SALES,
      payScore: null,
      grade: null,
    };
  });

  const pareto = computePareto(rows.map((r) => ({ id: r.customer.id, sales: r.facts.salesInWindow })));
  for (const r of rows) r.pareto = pareto.get(r.customer.id) ?? NO_SALES;

  assignBehaviourGrades(rows);
  return rows;
}

/* ── Metrics ─────────────────────────────────────────────────────────────────────────── */

/**
 * The SUMMABLE columns. `maxOverdueDays` and `daysSinceLastReceipt` fold with MAX (a group
 * inherits its WORST member); everything else sums.
 *
 * There is NO percentage here, on purpose — the same contract as ZCMetrics. Every % is derived
 * from a node's OWN summed numerator and denominator in CC_COLUMNS. Averaging children's
 * percentages is always wrong, and storing one here would invite exactly that.
 */
export interface CCMetrics {
  customers: number;
  active: number;
  dormant: number;

  net: number;
  owed: number;
  advances: number;
  creditLimit: number;

  opening: number;
  salesInWindow: number;
  collectible: number;
  collected: number;
  chequeReturns: number;
  creditNotes: number;

  overdue: number;
  od_0_30: number; od_31_60: number; od_61_90: number;
  od_91_120: number; od_121_180: number; od_180_plus: number;
  billCount: number;

  riskCritical: number;
  blocked: number;
  overLimit: number;
  neverPaid: number;
  zeroCollected: number;
  stillBuying: number;
  overGraded: number;
  underGraded: number;
  tierConflict: number;

  // MAX-folded:
  maxOverdueDays: number;
  daysSinceLastReceipt: number;
}

export const emptyCCMetrics = (): CCMetrics => ({
  customers: 0, active: 0, dormant: 0,
  net: 0, owed: 0, advances: 0, creditLimit: 0,
  opening: 0, salesInWindow: 0, collectible: 0, collected: 0, chequeReturns: 0, creditNotes: 0,
  overdue: 0, od_0_30: 0, od_31_60: 0, od_61_90: 0, od_91_120: 0, od_121_180: 0, od_180_plus: 0,
  billCount: 0,
  riskCritical: 0, blocked: 0, overLimit: 0, neverPaid: 0, zeroCollected: 0, stillBuying: 0,
  overGraded: 0, underGraded: 0, tierConflict: 0,
  maxOverdueDays: 0, daysSinceLastReceipt: -1,
});

/** Curried on the mismatch gap, because the two mismatch COUNTS depend on it. */
export const makeCCMetricsOf = (gap: number) => (r: CCRow): CCMetrics => {
  const mm = mismatchOf(r, gap);
  const never = r.facts.lastReceiptDate === null;
  return {
    customers: 1,
    active: isActive(r) ? 1 : 0,
    dormant: isDormantLedger(r) ? 1 : 0,

    net: r.net,
    owed: r.owed,
    advances: r.advances,
    creditLimit: r.creditLimit,

    opening: r.facts.opening,
    salesInWindow: r.facts.salesInWindow,
    collectible: r.facts.collectible,
    collected: r.facts.collected,
    chequeReturns: r.facts.chequeReturns,
    creditNotes: r.facts.creditNotes,

    overdue: r.buckets.overdue,
    od_0_30: r.buckets.od_0_30,
    od_31_60: r.buckets.od_31_60,
    od_61_90: r.buckets.od_61_90,
    od_91_120: r.buckets.od_91_120,
    od_121_180: r.buckets.od_121_180,
    od_180_plus: r.buckets.od_180_plus,
    billCount: r.buckets.billCount,

    riskCritical: r.customer.risk === "critical" ? 1 : 0,
    blocked: r.customer.blocked ? 1 : 0,
    overLimit: utilizationPct({ outstanding: r.net, creditLimit: r.creditLimit }) > 100 ? 1 : 0,
    neverPaid: never ? 1 : 0,
    zeroCollected: r.facts.collected < 1 ? 1 : 0,
    stillBuying: r.facts.salesInWindow > EPS ? 1 : 0,
    overGraded: mm === "over_graded" ? 1 : 0,
    underGraded: mm === "under_graded" ? 1 : 0,
    tierConflict: r.conflict ? 1 : 0,

    maxOverdueDays: r.maxOverdueDays,
    daysSinceLastReceipt: never ? NEVER_PAID : (r.facts.daysSinceLastReceipt ?? -1),
  };
};

export function addCCMetrics(acc: CCMetrics, m: CCMetrics): void {
  acc.customers += m.customers;
  acc.active += m.active;
  acc.dormant += m.dormant;
  acc.net += m.net;
  acc.owed += m.owed;
  acc.advances += m.advances;
  acc.creditLimit += m.creditLimit;
  acc.opening += m.opening;
  acc.salesInWindow += m.salesInWindow;
  acc.collectible += m.collectible;
  acc.collected += m.collected;
  acc.chequeReturns += m.chequeReturns;
  acc.creditNotes += m.creditNotes;
  acc.overdue += m.overdue;
  acc.od_0_30 += m.od_0_30;
  acc.od_31_60 += m.od_31_60;
  acc.od_61_90 += m.od_61_90;
  acc.od_91_120 += m.od_91_120;
  acc.od_121_180 += m.od_121_180;
  acc.od_180_plus += m.od_180_plus;
  acc.billCount += m.billCount;
  acc.riskCritical += m.riskCritical;
  acc.blocked += m.blocked;
  acc.overLimit += m.overLimit;
  acc.neverPaid += m.neverPaid;
  acc.zeroCollected += m.zeroCollected;
  acc.stillBuying += m.stillBuying;
  acc.overGraded += m.overGraded;
  acc.underGraded += m.underGraded;
  acc.tierConflict += m.tierConflict;
  // The group is as bad as its worst member.
  acc.maxOverdueDays = Math.max(acc.maxOverdueDays, m.maxOverdueDays);
  acc.daysSinceLastReceipt = Math.max(acc.daysSinceLastReceipt, m.daysSinceLastReceipt);
}

export function ccTotalsOf(rows: CCRow[], gap: number): CCMetrics {
  const metricsOf = makeCCMetricsOf(gap);
  const acc = emptyCCMetrics();
  for (const r of rows) addCCMetrics(acc, metricsOf(r));
  return acc;
}

/* ── Columns ─────────────────────────────────────────────────────────────────────────── */

export type CCColumnKey =
  | "customers" | "sharePctCustomers" | "avgOwed"
  | "owed" | "sharePct" | "advances" | "net"
  | "opening" | "salesInWindow" | "sharePctSales" | "collectible" | "collected" | "collectionPct"
  | "chequeReturns" | "creditNotes"
  | "overdue" | "overduePct" | "billCount"
  | "od_0_30" | "od_31_60" | "od_61_90" | "od_91_120" | "od_121_180" | "od_180_plus" | "od_120_plus"
  | "pct180" | "creditLimit" | "utilPct"
  | "riskCritical" | "blocked" | "overLimit" | "neverPaid" | "stillBuying"
  | "overGraded" | "underGraded"
  | "maxOverdueDays" | "daysSinceLastReceipt";

export interface CCColumn {
  key: CCColumnKey;
  label: string;
  kind: "money" | "count" | "pct" | "days";
  /**
   * WIDENED by one param vs ZCColumn — `total` is the GRAND total, and it exists for exactly
   * one reason: share-of-book needs a denominator from OUTSIDE the node. Every other percentage
   * still divides the node's OWN summed numerator and denominator; `total` is never used for
   * anything but a share.
   */
  value: (m: CCMetrics, total: CCMetrics) => number | null;
  /** Opens the bill drill-down when clicked. */
  drill?: "owed" | "overdue" | AgingBucketKey;
  alarm?: boolean;
  lowIsBad?: boolean;
}

export const CC_COLUMNS: CCColumn[] = [
  { key: "customers",         label: "Customers",     kind: "count", value: (m) => m.customers },
  { key: "sharePctCustomers", label: "% of Custs",    kind: "pct",   value: (m, t) => pctOf(m.customers, t.customers) },

  // Owed is the share denominator — never Net. A NET total can approach zero or flip sign under
  // a filter (tier E is net −₹4.80 cr), and the share column would explode or go negative.
  { key: "owed",      label: "Owed",         kind: "money", value: (m) => m.owed, drill: "owed" },
  { key: "sharePct",  label: "% of Book",    kind: "pct",   value: (m, t) => pctOf(m.owed, t.owed) },
  { key: "advances",  label: "Advances",     kind: "money", value: (m) => m.advances },
  { key: "net",       label: "Net Outstanding", kind: "money", value: (m) => m.net },
  { key: "avgOwed",   label: "Avg Owed",     kind: "money", value: (m) => (m.customers > 0 ? m.owed / m.customers : null) },

  { key: "opening",       label: "Opening",         kind: "money", value: (m) => m.opening },
  { key: "salesInWindow", label: "Sales in Period", kind: "money", value: (m) => m.salesInWindow },
  { key: "sharePctSales", label: "% of Sales",      kind: "pct",   value: (m, t) => pctOf(m.salesInWindow, t.salesInWindow) },
  { key: "collectible",   label: "Collectible",     kind: "money", value: (m) => m.collectible },
  { key: "collected",     label: "Collected",       kind: "money", value: (m) => m.collected },
  { key: "collectionPct", label: "Collection %",    kind: "pct",   value: (m) => pctOf(m.collected, m.collectible), lowIsBad: true },
  { key: "chequeReturns", label: "Cheque Returns",  kind: "money", value: (m) => m.chequeReturns, alarm: true },
  { key: "creditNotes",   label: "Credit Notes",    kind: "money", value: (m) => m.creditNotes },

  { key: "overdue",    label: "Overdue",     kind: "money", value: (m) => m.overdue, drill: "overdue", alarm: true },
  { key: "overduePct", label: "% Overdue",   kind: "pct",   value: (m) => pctOf(m.overdue, m.owed), alarm: true },
  { key: "od_0_30",     label: "0-30",       kind: "money", value: (m) => m.od_0_30,     drill: "od_0_30" },
  { key: "od_31_60",    label: "31-60",      kind: "money", value: (m) => m.od_31_60,    drill: "od_31_60" },
  { key: "od_61_90",    label: "61-90",      kind: "money", value: (m) => m.od_61_90,    drill: "od_61_90" },
  { key: "od_91_120",   label: "91-120",     kind: "money", value: (m) => m.od_91_120,   drill: "od_91_120" },
  { key: "od_121_180",  label: "121-180",    kind: "money", value: (m) => m.od_121_180,  drill: "od_121_180" },
  { key: "od_180_plus", label: "180+",       kind: "money", value: (m) => m.od_180_plus, drill: "od_180_plus", alarm: true },
  { key: "od_120_plus", label: "Total 120+", kind: "money", value: (m) => m.od_121_180 + m.od_180_plus, alarm: true },
  { key: "pct180",      label: "% at 180+",  kind: "pct",   value: (m) => pctOf(m.od_180_plus, m.owed), alarm: true },
  { key: "billCount",   label: "Open Bills", kind: "count", value: (m) => m.billCount },

  { key: "creditLimit", label: "Credit Limit", kind: "money", value: (m) => m.creditLimit },
  { key: "utilPct",     label: "Utilisation %", kind: "pct", value: (m) => pctOf(m.owed, m.creditLimit) },

  { key: "riskCritical", label: "Critical",     kind: "count", value: (m) => m.riskCritical, alarm: true },
  { key: "blocked",      label: "Blocked",      kind: "count", value: (m) => m.blocked },
  { key: "overLimit",    label: "Over Limit",   kind: "count", value: (m) => m.overLimit, alarm: true },
  { key: "neverPaid",    label: "Never Paid",   kind: "count", value: (m) => m.neverPaid, alarm: true },
  { key: "stillBuying",  label: "Still Buying", kind: "count", value: (m) => m.stillBuying },
  { key: "overGraded",   label: "Over-graded",  kind: "count", value: (m) => m.overGraded, alarm: true },
  { key: "underGraded",  label: "Under-graded", kind: "count", value: (m) => m.underGraded },

  { key: "maxOverdueDays",      label: "Max Overdue Days", kind: "days", value: (m) => m.maxOverdueDays, alarm: true },
  { key: "daysSinceLastReceipt", label: "Days Since Receipt", kind: "days", value: (m) => m.daysSinceLastReceipt },
];

export const DEFAULT_CC_COLUMNS: CCColumnKey[] = [
  "customers", "owed", "sharePct", "advances", "opening", "salesInWindow",
  "collected", "collectionPct", "overdue", "od_180_plus", "pct180",
  "creditLimit", "utilPct", "overGraded",
];

/* ── Dimensions ──────────────────────────────────────────────────────────────────────── */

export type CCDim =
  | "category" | "customer" | "salesperson" | "group" | "company" | "location"
  | "saleType" | "behaviour" | "pareto";

export const CC_DIMENSIONS: { key: CCDim; label: string }[] = [
  { key: "category",    label: "Customer Category" },
  { key: "customer",    label: "Customer" },
  { key: "salesperson", label: "Salesperson" },
  { key: "group",       label: "Customer Group" },
  { key: "behaviour",   label: "Behaviour Grade" },
  { key: "pareto",      label: "Revenue Class" },
  { key: "saleType",    label: "Sale Type" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
];

export const CC_PRESETS: GroupByPreset<CCDim>[] = [
  { label: "Category → Customer",       dims: ["category", "customer"] },
  { label: "Category",                  dims: ["category"] },
  { label: "Category → Behaviour",      dims: ["category", "behaviour"] },
  { label: "Category → Salesperson",    dims: ["category", "salesperson"] },
  { label: "Category → Sale Type",      dims: ["category", "saleType"] },
  { label: "Salesperson → Category",    dims: ["salesperson", "category"] },
  { label: "Company → Category",        dims: ["company", "category"] },
  { label: "Category → Customer Group", dims: ["category", "group"] },
];

const SALE_TYPE_LABEL: Record<SaleType, string> = {
  ink: "Ink", spare_parts: "Spare Parts", machine: "Machine", head: "Head", other: "Other",
};

/**
 * THE critical wrapper.
 *
 * `category` MUST NOT go through zcDimValue — that one joins a multi-tag customer into an
 * "A, C" bucket (collections.ts:877), which would put the same customer in two places and
 * destroy the seven-tier partition that share-of-book depends on. It reads the row's single
 * resolved tier instead.
 *
 * Everything else DELEGATES to zcDimValue, so salesperson / customer / group / company /
 * location labels, sub-labels and detailPathFor drill-through never fork from the other reports.
 */
export function ccDimValue(r: CCRow, dim: string): { value: string; label: string; sub?: string } {
  switch (dim as CCDim) {
    case "category":
      return { value: r.tier, label: TIER_LABELS[r.tier] };
    case "behaviour":
      return r.grade
        ? { value: r.grade, label: `Behaves like ${r.grade}` }
        : { value: "n/a", label: "Not scored (no balance)" };
    case "pareto":
      return { value: r.pareto.cls, label: PARETO_LABELS[r.pareto.cls] };
    case "saleType":
      return { value: r.saleType, label: SALE_TYPE_LABEL[r.saleType] ?? r.saleType };
    default:
      return zcDimValue(r, dim);
  }
}

/* ── Focus lenses ────────────────────────────────────────────────────────────────────── */

export type CCFocus =
  | "overGraded" | "underGraded" | "untagged" | "conflict"
  | "overdue" | "over180" | "neverPaid" | "zeroCollected"
  | "overLimit" | "blocked" | "critical" | "stillBuying" | "dormant" | "holdsAdvance";

export const CC_FOCUS_LABELS: Record<CCFocus, string> = {
  overGraded: "Over-graded", underGraded: "Under-graded",
  untagged: "Untagged", conflict: "Conflicting tags",
  overdue: "Has overdue", over180: "Has 180+ debt",
  neverPaid: "Never paid", zeroCollected: "Collected nothing",
  overLimit: "Over credit limit", blocked: "Blocked",
  critical: "Critical risk", stillBuying: "Still buying",
  dormant: "Dormant ledger", holdsAdvance: "Holds advance",
};

/**
 * Defined FRESH, not imported from ZC_FOCUS_PREDICATES — `over180` there reads
 * `agingBuckets["180_plus"]`, the ledger column this report deliberately does not use. Same
 * argument, verbatim, as OA_FOCUS_PREDICATES (overdueAging.ts:454-462).
 *
 * The mismatch lenses are closed over the DEFAULT gap; the page rebuilds them when the gap
 * control moves — see makeCCFocusPredicates.
 */
export const makeCCFocusPredicates = (gap: number): Record<CCFocus, (r: CCRow) => boolean> => ({
  overGraded:   (r) => mismatchOf(r, gap) === "over_graded",
  underGraded:  (r) => mismatchOf(r, gap) === "under_graded",
  untagged:     (r) => r.tier === UNCATEGORIZED_TIER,
  conflict:     (r) => r.conflict,
  overdue:      (r) => r.buckets.overdue > EPS,
  over180:      (r) => r.buckets.od_180_plus > EPS,
  neverPaid:    (r) => r.facts.lastReceiptDate === null,
  zeroCollected:(r) => r.facts.collected < 1,
  overLimit:    (r) => utilizationPct({ outstanding: r.net, creditLimit: r.creditLimit }) > 100,
  blocked:      (r) => !!r.customer.blocked,
  critical:     (r) => r.customer.risk === "critical",
  stillBuying:  (r) => r.facts.salesInWindow > EPS,
  dormant:      (r) => isDormantLedger(r),
  holdsAdvance: (r) => r.advances < -1,
});

/** Lenses AND together — two selected cards mean "both", never "either". */
export function applyCCFocus(rows: CCRow[], focus: ReadonlySet<CCFocus>, gap: number): CCRow[] {
  if (focus.size === 0) return rows;
  const preds = makeCCFocusPredicates(gap);
  return rows.filter((r) => [...focus].every((f) => preds[f](r)));
}

/* ── The Category × dimension matrix ─────────────────────────────────────────────────── */

/**
 * NOTE there is no "aging" dimension here, and that is deliberate: the AGING REPORT already
 * ships Group-by-Customer-Category with all six overdue buckets (agingReport.ts:31,246). A
 * Category × Aging matrix would be a second, subtly-different implementation of a view that
 * already exists — so the page deep-links to it instead.
 */
export type MatrixDim = "salesperson" | "saleType" | "company" | "location" | "group" | "behaviour" | "pareto";
export type MatrixMeasure = "owed" | "net" | "overdue" | "od_180_plus" | "salesInWindow" | "collected" | "customers";

export const MATRIX_DIMS: { key: MatrixDim; label: string }[] = [
  { key: "salesperson", label: "Salesperson" },
  { key: "saleType",    label: "Sale Type" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
  { key: "group",       label: "Customer Group" },
  { key: "behaviour",   label: "Behaviour Grade" },
  { key: "pareto",      label: "Revenue Class" },
];

export const MATRIX_MEASURES: { key: MatrixMeasure; label: string; kind: "money" | "count" }[] = [
  { key: "owed",          label: "Owed",         kind: "money" },
  { key: "overdue",       label: "Overdue",      kind: "money" },
  { key: "od_180_plus",   label: "180+",         kind: "money" },
  { key: "net",           label: "Net",          kind: "money" },
  { key: "salesInWindow", label: "Sales",        kind: "money" },
  { key: "collected",     label: "Collected",    kind: "money" },
  { key: "customers",     label: "Customers",    kind: "count" },
];

export const MATRIX_MEASURE_OF: Record<MatrixMeasure, (m: CCMetrics) => number> = {
  owed: (m) => m.owed,
  net: (m) => m.net,
  overdue: (m) => m.overdue,
  od_180_plus: (m) => m.od_180_plus,
  salesInWindow: (m) => m.salesInWindow,
  collected: (m) => m.collected,
  customers: (m) => m.customers,
};

export interface MatrixRow {
  tier: Tier;
  label: string;
  cells: number[];
  /** Backing customer ids per cell — lets a cell click narrow the table below. */
  ids: string[][];
  total: number;
}

export interface CategoryMatrix {
  dim: MatrixDim;
  measure: MatrixMeasure;
  cols: string[];
  rows: MatrixRow[];
  colTotals: number[];
  grand: number;
  /** True when low-volume columns were folded into "Other" (the export shows them all). */
  folded: boolean;
}

export const MATRIX_OTHER = "Other";

/**
 * A thin PIVOT over buildGroupTree — not a second tree engine.
 *
 * buildGroupTree(rows, ["category", dim]) already produces exactly the cells: one child per
 * distinct dim value under each tier, carrying summed CCMetrics. All that is missing is turning
 * the union of child labels into COLUMNS, which is what this does.
 */
export function buildCategoryMatrix(
  rows: CCRow[],
  dim: MatrixDim,
  measure: MatrixMeasure,
  gap: number,
  opts: { topCols?: number } = {},
): CategoryMatrix {
  const topCols = opts.topCols ?? 12;
  const pick = MATRIX_MEASURE_OF[measure];

  const tree = buildGroupTree<CCRow, CCMetrics>(rows, ["category", dim], {
    dimValue: ccDimValue,
    idOf: (r) => r.customer.id,
    metricsOf: makeCCMetricsOf(gap),
    empty: emptyCCMetrics,
    add: addCCMetrics,
  });

  // Rank the union of column values by their own total, keep the top N, fold the tail.
  const colTotal = new Map<string, number>();
  for (const root of tree.roots) {
    for (const child of root.children) {
      colTotal.set(child.label, (colTotal.get(child.label) ?? 0) + Math.abs(pick(child.metrics)));
    }
  }
  const ranked = [...colTotal.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const kept = ranked.slice(0, topCols);
  const folded = ranked.length > kept.length;
  const cols = folded ? [...kept, MATRIX_OTHER] : kept;
  const colIdx = new Map(cols.map((c, i) => [c, i]));

  // Keyed on the dimension VALUE (the raw tier), never the display label — TIER_LABELS maps
  // AA to "AA (internal)", so matching on the label would silently drop that row.
  const byTier = new Map<string, GroupNode<CCMetrics>>();
  for (const root of tree.roots) byTier.set(root.path[0]?.value ?? "", root);

  const matrixRows: MatrixRow[] = [];
  for (const tier of TIER_ORDER) {
    // TIER_ORDER drives the row order, always — a scoreboard's rows ARE the grades.
    const root = byTier.get(tier);
    if (!root) continue;
    const cells = cols.map(() => 0);
    const ids: string[][] = cols.map(() => []);
    for (const child of root.children) {
      const i = colIdx.get(child.label) ?? (folded ? cols.length - 1 : -1);
      if (i < 0) continue;
      cells[i] += pick(child.metrics);
      ids[i].push(...child.ids);
    }
    matrixRows.push({
      tier,
      label: TIER_LABELS[tier],
      cells,
      ids,
      total: pick(root.metrics),
    });
  }

  const colTotals = cols.map((_, i) => matrixRows.reduce((s, r) => s + r.cells[i], 0));
  return {
    dim, measure, cols, rows: matrixRows, colTotals,
    grand: pick(tree.total),
    folded,
  };
}

/* ── Sale-type helper re-export (the page needs the same list the filters use) ────────── */
export { SALE_TYPES };
