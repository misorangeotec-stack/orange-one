/**
 * Which customers the Collection report covers, and the one-line record of how it was narrowed.
 *
 * The companion to `collectionCards.ts`, and here for the same reason: the scheduled send builds
 * this report on a server, and a server cannot import a React page. Between them the two files
 * are the report's DEFINITION — the screen and the mail both read it, so they cannot drift into
 * disagreeing about who is on the list.
 *
 * THE PIPELINE, AND WHY SALE TYPE COMES LAST
 *
 *   consolidated customers
 *     → selectEligible()        every filter EXCEPT sale type
 *     → + sale-type scope       the KPI denominator, and the report's rows
 *
 *   Sale type is held back one step on purpose. The overdue-by-type cards are measured over the
 *   whole book, so if the sale-type filter ran with the others the Machine card would read ₹0 the
 *   moment Machine is deselected — which is the default — and clicking any card would delete the
 *   other four. The strip has to stay complete and clickable, so it is measured before the filter
 *   and the filter is applied after.
 */

import {
  COLLECTIBLE_EPS, SALE_TYPES, ZC_FOCUS_LABELS,
  dominantSaleTypeOf, factsFor, factsForRange, isBelowThreshold, isDormant, isZeroCollection,
  type MonthFacts, type RangeFacts, type ZCFocus, type ZCRow,
} from "./collections";
import type { ZCMode } from "./collectionCards";
import { matchesCategory } from "./customerCategory";
import { saleTypeLabel } from "./salesReport";
import type { ConsolidatedCustomer, SaleType } from "./types";

/** Cut the long tail without a fiddly ₹ input. Shared so the summary line can name the choice. */
export const MIN_OUTSTANDING_OPTIONS = [
  { key: "0", label: "All", value: 0 },
  { key: "1L", label: "≥ ₹1 L", value: 100_000 },
  { key: "5L", label: "≥ ₹5 L", value: 500_000 },
] as const;

export type MinOutKey = (typeof MIN_OUTSTANDING_OPTIONS)[number]["key"];
export type Segment = "all" | "active" | "no_activity";

/** Every narrowing the screen offers, as data. One shape, so nothing can be silently forgotten. */
export interface ZCFilters {
  categories: string[];
  companies: string[];
  locations: string[];
  salespersons: string[];
  saleTypes: string[];
  segment: Segment;
  blockedOnly: boolean;
  includeNonDebtors: boolean;
  minOut: MinOutKey;
  search: string;
}

/**
 * The eligible pool: every filter applied EXCEPT sale type. See the header for why.
 *
 * `groupOf` is passed in rather than derived because the screen resolves a customer's group
 * against the live group master, which is not this module's business.
 */
export function selectEligible(
  customers: ConsolidatedCustomer[],
  f: ZCFilters,
  groupOf: (c: ConsolidatedCustomer) => string,
): ConsolidatedCustomer[] {
  let d = customers.filter((c) => matchesCategory(c, f.categories));
  if (f.companies.length)    { const s = new Set(f.companies);    d = d.filter((c) => (c.companies ?? [c.company]).some((x) => s.has(x))); }
  if (f.locations.length)    { const s = new Set(f.locations);    d = d.filter((c) => (c.locations ?? [c.location]).some((x) => s.has(x))); }
  if (f.salespersons.length) { const s = new Set(f.salespersons); d = d.filter((c) => (c.salesPersons?.length ? c.salesPersons : [c.salesPerson]).some((x) => s.has(x))); }
  if (f.segment === "active")
    d = d.filter((c) => c.sales > 0 || c.receipts > 0 || c.creditNotes > 0 || (c.otherPayments ?? 0) > 0);
  else if (f.segment === "no_activity")
    d = d.filter((c) => c.sales === 0 && c.receipts === 0 && c.creditNotes === 0 && (c.otherPayments ?? 0) === 0);
  if (f.blockedOnly) d = d.filter((c) => c.blocked === true);
  // Credit / advance ledgers have OVERPAID us. They are not non-payers, so they're out
  // by default — the report would otherwise open on a list of people who owe nothing.
  if (!f.includeNonDebtors) d = d.filter((c) => c.outstanding > 0);
  const min = MIN_OUTSTANDING_OPTIONS.find((o) => o.key === f.minOut)?.value ?? 0;
  if (min > 0) d = d.filter((c) => c.outstanding >= min);
  const q = f.search.trim().toLowerCase();
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    d = d.filter((c) => {
      const text = `${c.name} ${groupOf(c)} ${c.salesPersons?.join(" ") ?? c.salesPerson}`.toLowerCase();
      return tokens.every((t) => text.includes(t));
    });
  }
  return d;
}

/**
 * Scope by the customer's DOMINANT sale type. Active only on a PROPER subset: empty and full both
 * mean "no filter", the same convention `SaleTypeMultiSelect` labels ("All Sale Types") and every
 * other multi-select in the app uses.
 */
export function makeSaleTypeScope(
  saleTypes: string[],
  outstandingByType: Map<string, Partial<Record<SaleType, number>>>,
): (c: ConsolidatedCustomer) => boolean {
  const off = saleTypes.length === 0 || saleTypes.length === SALE_TYPES.length;
  return (c) => (off ? true : saleTypes.includes(dominantSaleTypeOf(c, outstandingByType)));
}

/**
 * How this report was narrowed, as printable lines — carried into the PDF and the workbook so a
 * file found a week later can still say what it was a view OF.
 *
 * `focus` and `bands` are the clickable lenses rather than the filter bar, and they come first
 * because they are the most drastic cut.
 */
export function buildFilterSummary(
  f: ZCFilters,
  focus: Iterable<ZCFocus>,
  bands: Iterable<string>,
  bandLabels: Record<string, string>,
): string[] {
  const s: string[] = [];
  for (const x of focus) s.push(`Focus: ${ZC_FOCUS_LABELS[x]}`);
  for (const b of bands) s.push(`Band: ${bandLabels[b]}`);
  if (f.search.trim()) s.push(`Search: ${f.search.trim()}`);
  if (f.salespersons.length) s.push(`Salesperson: ${f.salespersons.join(", ")}`);
  if (f.companies.length) s.push(`Company: ${f.companies.join(", ")}`);
  if (f.locations.length) s.push(`Location: ${f.locations.join(", ")}`);
  if (f.categories.length) s.push(`Category: ${f.categories.join(", ")}`);
  // Always record the sale-type scope, INCLUDING the default — every report now excludes Machine
  // by default, so the sheet has to say so or the totals are unexplainable a week later.
  s.push(
    f.saleTypes.length === 0 || f.saleTypes.length === SALE_TYPES.length
      ? "Sale Type: All (incl. Machine)"
      : `Sale Type: ${f.saleTypes.map(saleTypeLabel).join(", ")} (dominant type; Machine excluded by default)`,
  );
  if (f.minOut !== "0") s.push(`Min Outstanding: ${MIN_OUTSTANDING_OPTIONS.find((o) => o.key === f.minOut)?.label}`);
  if (f.segment !== "all") s.push(`Segment: ${f.segment === "active" ? "Active" : "No Activity"}`);
  if (f.blockedOnly) s.push("Red Mark only");
  if (f.includeNonDebtors) s.push("Incl. zero & credit balances");
  return s;
}

/** Everything the row predicate needs that is not a filter — the period, and the derived series. */
export interface ReportWindow {
  mode: ZCMode;
  /** The threshold report's bar, as a percentage. Ignored by the other two. */
  threshold: number;
  months: string[];
  windowMonths: string[];
  prevMonths: string[];
  asOfDate: string;
  countJournalSettlements: boolean;
  /** Set only when the period is a custom date range; then `range` must be supplied too. */
  usingDateRange: boolean;
  range: Map<string, RangeFacts> | null;
  hasPrevRange: boolean;
  series: Map<string, Map<string, MonthFacts>>;
  lastDates: Map<string, string | null>;
  lastAmounts: Map<string, number | null>;
  balances: Map<string, number>;
}

/**
 * The report itself: which of the eligible customers are actually listed.
 *
 *  - zero mode      : collected nothing at all. Needs no denominator, so it still catches a
 *                     customer with an empty collectible pool.
 *  - threshold mode : collected less than `threshold`% of Opening + Sales. Reads the WORSE of the
 *                     gross and net-of-cheque-return percentages, so a customer whose only
 *                     "payment" bounced can't hide above the bar.
 *  - dormant mode   : billed NOTHING in the window. Also needs no denominator — paired with the
 *                     outstanding > 0 gate in `selectEligible`, that IS the report.
 *
 * `noPool` is the count deliberately dropped: nothing was collectible from them in this window, so
 * their percentage is undefined — NOT 0%. The basis note reports it rather than letting them
 * silently vanish. Threshold-only: the other two predicates have no denominator to be undefined,
 * so they drop nobody.
 *
 * ⚠ SALE TYPE IS NOT APPLIED HERE. Callers filter the result with `makeSaleTypeScope`, for the
 *   reason in this file's header — the overdue-by-type strip is measured over these rows first.
 */
export function listReportRows(
  eligibleAllTypes: ConsolidatedCustomer[],
  w: ReportWindow,
  groupOf: (c: ConsolidatedCustomer) => string,
): { rows: ZCRow[]; noPool: ConsolidatedCustomer[] } {
  if (!w.windowMonths.length) return { rows: [], noPool: [] };
  const range = w.usingDateRange ? w.range : null;
  const out: ZCRow[] = [];
  const dropped: ConsolidatedCustomer[] = [];
  for (const c of eligibleAllTypes) {
    // factsForRange is factsFor's twin — same arithmetic, day-level sources. See its header.
    const facts = range
      ? factsForRange(c, range, w.series, w.lastDates, w.balances, w.months, w.windowMonths, w.hasPrevRange, w.asOfDate, null, w.countJournalSettlements, w.lastAmounts)
      : factsFor(c, w.series, w.lastDates, w.balances, w.months, w.windowMonths, w.prevMonths, w.asOfDate, w.countJournalSettlements, w.lastAmounts);
    const listed =
      w.mode === "dormant" ? isDormant(facts)
      : w.mode === "zero"  ? isZeroCollection(facts)
      : isBelowThreshold(facts, w.threshold);
    if (listed) out.push({ customer: c, facts, group: groupOf(c) });
    else if (w.mode === "threshold" && facts.collectible < COLLECTIBLE_EPS) dropped.push(c);
  }
  return { rows: out, noPool: dropped };
}
