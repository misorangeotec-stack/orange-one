/**
 * zeroCollections.ts — the "Customers with Zero Collections" engine. Pure, UI-free.
 *
 * The report answers one question: who owes us money and has paid us NOTHING in the
 * selected window — and are we still shipping to them?
 *
 * ── Why this is month-granular, and why that isn't laziness ────────────────────────
 * The Customer type advertises `lastReceiptDate`, `monthlyReceipts`, `receipts1M/6M`,
 * `daysSinceLastReceipt` and `consecutiveNoPaymentMonths`. In PRODUCTION (Supabase) every
 * one of those is hard-coded null/0/{} in supabaseFetcher.toCustomer() — the `customers`
 * table has no such columns. Only receipts_3m is real. Build on them and the report reads
 * "nobody has ever paid us".
 *
 * Live (ConnectWave) mode is the exact mirror: it DOES carry monthlyReceipts +
 * lastReceiptDate on the customer, but its per-customer `trend` holds only the current
 * month and its receiptTransactions are EMPTY on bulk load (fetched lazily, one customer
 * at a time, by the Customer Detail page).
 *
 *                        Supabase (prod)      Live / ConnectWave
 *   detail.receiptTransactions   full                EMPTY
 *   detail.trend[].receipts      full (LAKHS)        current month only
 *   customer.monthlyReceipts     {}                  full (rupees)
 *   customer.lastReceiptDate     null                full
 *
 * So: one source-aware adapter, month granularity (the only grain both backends can
 * serve), which is ALSO the grain the Salesperson Collection Report anchors its
 * "Received" to — so the two reports reconcile by construction.
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

/** One month of activity for one ledger, in RUPEES. */
export interface MonthFacts {
  /** Money actually collected: receipt vouchers + manual Other Payments. */
  receipts: number;
  /** Billed in the month — the "are we still supplying a non-payer" signal. */
  sales: number;
  /** Cheque returns (bounced payments). Reported, but NOT netted off `receipts`. */
  chequeReturns: number;
}

const emptyMonth = (): MonthFacts => ({ receipts: 0, sales: 0, chequeReturns: 0 });

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

    if (source === "live") {
      // The live snapshot carries no per-month sales or cheque returns and no manual
      // other-payments — only monthlyReceipts (already rupees). Receipts is all we need
      // for the zero test; sales/chequeReturns stay 0 and their columns read as blank.
      for (const [label, amt] of Object.entries(c.monthlyReceipts ?? {})) {
        const m = bucket(label);
        if (m) m.receipts += Number(amt) || 0;
      }
    } else {
      const d = detail[c.id];
      // Pipeline: the per-customer trend is the CANONICAL monthly figure (lakhs) — the same
      // one the Salesperson Collection Report anchors "Received" to. Using it (rather than
      // re-summing receiptTransactions) is what makes the two reports agree exactly.
      for (const t of d?.trend ?? []) {
        const m = bucket(t.month);
        if (!m) continue;
        m.receipts      += (t.receipts ?? 0) * 100_000;
        m.sales         += (t.sales ?? 0) * 100_000;
        m.chequeReturns += (t.checkReturns ?? 0) * 100_000;
      }
      // Manual (non-Tally) Other Payments are real money but live outside the trend's
      // receipts, so fold them in by date.
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
  /** Collected inside the window (₹). The zero test reads this. */
  inWindow: number;
  /** Collected in the equal-length window immediately before — did they GO quiet, or never pay? */
  inPrior: number;
  /** Billed inside the window (₹) — we're still supplying them. */
  salesInWindow: number;
  /** Cheque returns inside the window (₹) — they "paid" and it bounced. */
  chequeReturns: number;
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

/** Roll a consolidated customer's constituent ledgers up into one set of collection facts. */
export function factsFor(
  c: ConsolidatedCustomer,
  series: Map<string, Map<string, MonthFacts>>,
  lastDates: Map<string, string | null>,
  windowMonths: string[],
  priorMonths: string[],
  asOfDate: string,
): CollectionFacts {
  const ids = c.constituentIds?.length ? c.constituentIds : [c.id];

  let inWindow = 0, inPrior = 0, salesInWindow = 0, chequeReturns = 0;
  let lastReceiptDate: string | null = null;

  for (const id of ids) {
    const byMonth = series.get(id);
    inWindow      += sumMonths(byMonth, windowMonths, (m) => m.receipts);
    inPrior       += sumMonths(byMonth, priorMonths,  (m) => m.receipts);
    salesInWindow += sumMonths(byMonth, windowMonths, (m) => m.sales);
    chequeReturns += sumMonths(byMonth, windowMonths, (m) => m.chequeReturns);

    const last = lastDates.get(id) ?? null;
    if (last && (!lastReceiptDate || last > lastReceiptDate)) lastReceiptDate = last;
  }

  return {
    inWindow,
    inPrior,
    salesInWindow,
    chequeReturns,
    lastReceiptDate,
    daysSinceLastReceipt:
      lastReceiptDate && asOfDate ? daysBetween(lastReceiptDate, asOfDate) : null,
  };
}

/** A customer collected nothing in the window. Strict: any receipt at all disqualifies. */
export const isZeroCollection = (f: CollectionFacts): boolean => f.inWindow < ZERO_EPS;

// ── The report row + its roll-up metrics ────────────────────────────────────────────

/** One customer on the report: the consolidated ledger + its collection facts + its group. */
export interface ZCRow {
  customer: ConsolidatedCustomer;
  facts: CollectionFacts;
  /** Parent group from the mapping sheet, or the customer's own name when ungrouped. */
  group: string;
}

/**
 * The summable columns. `maxOverdueDays` and `daysSinceLastReceipt` fold with MAX (the
 * worst offender in the group), everything else with SUM — see `addMetrics`.
 * `daysSinceLastReceipt` uses -1 as the "never paid" sentinel so MAX still ranks it worst.
 */
export interface ZCMetrics {
  customers: number;
  outstanding: number;
  overdue: number;
  over180: number;
  salesInWindow: number;
  priorCollections: number;
  chequeReturns: number;
  maxOverdueDays: number;
  /** Worst (largest) days-since-last-receipt in the group. NEVER_PAID when any never paid. */
  daysSinceLastReceipt: number;
  neverPaid: number;
  stillBuying: number;
  creditLimit: number;
}

/** Sentinel for "no receipt in the entire data horizon" — sorts as the worst possible. */
export const NEVER_PAID = Number.MAX_SAFE_INTEGER;

export const emptyMetrics = (): ZCMetrics => ({
  customers: 0, outstanding: 0, overdue: 0, over180: 0,
  salesInWindow: 0, priorCollections: 0, chequeReturns: 0,
  maxOverdueDays: 0, daysSinceLastReceipt: -1,
  neverPaid: 0, stillBuying: 0, creditLimit: 0,
});

export function metricsOf(r: ZCRow): ZCMetrics {
  const c = r.customer;
  const never = r.facts.lastReceiptDate === null;
  return {
    customers: 1,
    outstanding: c.outstanding,
    overdue: c.overdue,
    over180: c.agingBuckets?.["180_plus"] ?? 0,
    salesInWindow: r.facts.salesInWindow,
    priorCollections: r.facts.inPrior,
    chequeReturns: r.facts.chequeReturns,
    maxOverdueDays: c.maxOverdueDays ?? 0,
    daysSinceLastReceipt: never ? NEVER_PAID : (r.facts.daysSinceLastReceipt ?? -1),
    neverPaid: never ? 1 : 0,
    stillBuying: r.facts.salesInWindow > 0 ? 1 : 0,
    creditLimit: c.creditLimit ?? 0,
  };
}

export function addMetrics(acc: ZCMetrics, m: ZCMetrics): void {
  acc.customers        += m.customers;
  acc.outstanding      += m.outstanding;
  acc.overdue          += m.overdue;
  acc.over180          += m.over180;
  acc.salesInWindow    += m.salesInWindow;
  acc.priorCollections += m.priorCollections;
  acc.chequeReturns    += m.chequeReturns;
  acc.neverPaid        += m.neverPaid;
  acc.stillBuying      += m.stillBuying;
  acc.creditLimit      += m.creditLimit;
  // Non-summable: the group inherits its worst member.
  acc.maxOverdueDays       = Math.max(acc.maxOverdueDays, m.maxOverdueDays);
  acc.daysSinceLastReceipt = Math.max(acc.daysSinceLastReceipt, m.daysSinceLastReceipt);
}

// ── Focus lenses (the clickable KPI cards) ──────────────────────────────────────────

/**
 * The four KPI cards that are genuine SUBSETS of the report, and so can filter it.
 *
 * The other two cards — "Zero-Collection Customers" and "Outstanding Locked" — describe
 * the WHOLE list (every listed customer is one, and every listed customer owes money), so
 * filtering by them is a no-op. They act as "show everything / clear" instead of pretending
 * to be lenses.
 *
 * Multiple lenses AND together: `never` + `buying` is the report's most damning list —
 * customers we are still shipping goods to who have never paid us a single rupee.
 */
export type ZCFocus = "overdue" | "never" | "buying" | "over180";

export const ZC_FOCUS_LABELS: Record<ZCFocus, string> = {
  overdue: "Overdue Locked",
  never:   "Never Paid",
  buying:  "Still Buying",
  over180: "> 180 Days",
};

/** The ₹0.5 guard matches the drill-down's `Math.abs(v) >= 0.5`, so a row carrying nothing
 *  but rounding dust can't slip into a lens. */
export const ZC_FOCUS_PREDICATES: Record<ZCFocus, (r: ZCRow) => boolean> = {
  overdue: (r) => r.customer.overdue > 0.5,
  never:   (r) => r.facts.lastReceiptDate === null,
  buying:  (r) => r.facts.salesInWindow > 0.5,
  over180: (r) => (r.customer.agingBuckets?.["180_plus"] ?? 0) > 0.5,
};

/** Apply every active lens (AND). An empty set means no focus — the full list. */
export function applyFocus(rows: ZCRow[], focus: ReadonlySet<ZCFocus>): ZCRow[] {
  if (focus.size === 0) return rows;
  const preds = [...focus].map((f) => ZC_FOCUS_PREDICATES[f]);
  return rows.filter((r) => preds.every((p) => p(r)));
}

/** Fold a row set into one metrics total. Used for the KPI cards, which must be computed
 *  over the UNFOCUSED rows — see the note on the report page. */
export function totalsOf(rows: ZCRow[]): ZCMetrics {
  const acc = emptyMetrics();
  for (const r of rows) addMetrics(acc, metricsOf(r));
  return acc;
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
  | "salesInWindow" | "priorCollections" | "daysSinceLastReceipt"
  | "chequeReturns" | "maxOverdueDays" | "creditLimit";

export interface ZCColumn {
  key: ZCColumnKey;
  label: string;
  /** How the cell renders: money (₹), a plain count, or a day count. */
  kind: "money" | "count" | "days";
  /** Opens the invoice drill-down when clicked (only the balance columns can). */
  drill?: "outstanding" | "overdue" | "over180";
  /** In the default (management) column set. The rest live behind the ColumnPicker. */
  default: boolean;
  /** Red when non-zero — the columns that mean something is wrong. */
  alarm?: boolean;
}

export const ZC_COLUMNS: ZCColumn[] = [
  { key: "customers",            label: "Customers",         kind: "count", default: true },
  { key: "outstanding",          label: "Outstanding",       kind: "money", default: true, drill: "outstanding" },
  { key: "overdue",              label: "Overdue",           kind: "money", default: true, drill: "overdue", alarm: true },
  { key: "over180",              label: "> 180 Days",        kind: "money", default: true, drill: "over180", alarm: true },
  { key: "salesInWindow",        label: "Sales in Window",   kind: "money", default: true, alarm: true },
  { key: "priorCollections",     label: "Prior Collections", kind: "money", default: true },
  { key: "daysSinceLastReceipt", label: "Days Since Receipt", kind: "days", default: true, alarm: true },
  { key: "chequeReturns",        label: "Cheque Returns",    kind: "money", default: false, alarm: true },
  { key: "maxOverdueDays",       label: "Max Overdue Days",  kind: "days",  default: false },
  { key: "creditLimit",          label: "Credit Limit",      kind: "money", default: false },
];

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
 *  start of the data horizon, or empty). Powers the "Prior Collections" column. */
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
