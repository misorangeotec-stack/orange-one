import {
  useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment,
  type ReactNode, type CSSProperties,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  UserX, ChevronRight, ChevronDown, Download, ArrowLeft, Info, Pin, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Wallet, TrendingDown,
  CalendarClock, ShoppingCart, Ban, Percent, Target, Undo2,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@hub/components/ui/pagination";
import { Tooltip, TooltipContent, TooltipTrigger } from "@hub/components/ui/tooltip";
import { MultiSelect } from "@hub/components/MultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { SaleTypeMultiSelect, SALE_TYPE_OPTIONS } from "@hub/components/SaleTypeMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { GroupByBuilder } from "@hub/components/GroupByBuilder";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData, groupNameOf, allGroupNames } from "@hub/lib/useAppData";
import { useHubBase, useReceivablesSource } from "@hub/lib/sourceContext";
import { FYProvider } from "@hub/lib/fyContext";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { sumOutstanding } from "@hub/lib/receivables";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import { monthEndLong, monthStartLong } from "@hub/lib/months";
import {
  buildLastReceiptDates, buildLedgerBalances, buildMonthlySeries, buildOutstandingByType, factsFor,
  isZeroCollection, isBelowThreshold, isDormant, dominantSaleTypeOf, bandOf, bandCounts, pctOf,
  makeMetricsOf, addMetrics, emptyMetrics, zcDimValue, monthRange, priorWindow, resolveWindow,
  applyFocus, totalsOf, detailPathFor, defaultColumnsFor,
  COLLECTIBLE_EPS, DETERIORATION_PP, NEVER_PAID, NEVER_SOLD, ZERO_EPS, SALE_TYPES,
  BAND_LABELS, BAND_ORDER,
  PERIOD_LABELS, ZC_COLUMNS, ZC_DIMENSIONS, ZC_PRESETS, ZC_FOCUS_LABELS,
  type CollectionBand, type CollectionsMode, type PeriodPreset, type ZCColumn, type ZCColumnKey,
  type ZCDim, type ZCFocus, type ZCMetrics, type ZCRow,
} from "@hub/lib/collections";
import { exportCollectionsXlsx } from "@hub/lib/exportCollections";
import type { ConsolidatedCustomer } from "@hub/lib/types";

/**
 * Collection Performance — ONE screen, THREE reports.
 *
 *   ?below=0           → "Customers with Zero Collections"  (paid us nothing)
 *   ?below=30          → "Customers Below 30% Collection"   (paid us less than 30% of what we
 *                                                             could have collected)
 *   variant="dormant"  → "Customers with Dues but No Sales" (owe us money and have STOPPED
 *                                                             BUYING — the sales-side question)
 *
 * The first two differ only by threshold; zero collection is the 0% case. The third asks a
 * different question of the SAME facts: it is the exact complement of the other two reports'
 * "Still Buying" lens, so it reuses the engine wholesale and differs only in its predicate
 * (`isDormant`), its default columns and its lenses. It comes in by ROUTE, not by `?below=` —
 * a dormancy report has no threshold.
 *
 * The aggregation lives in lib/collections.ts — read its header for the denominator, for why
 * the window is month-granular, and for the three traps in the pipeline data
 * (gross-of-cheque-return receipts, the clamped opening, FY scoping).
 *
 * FOLLOWS THE SOURCE TOGGLE. With the admin "Live (Tally)" toggle on, the page reads the
 * ConnectWave snapshot. The predicate that decides each report is exact under Live — Zero
 * Collections and Dormant read live receipts / live monthly sales directly. Only Below-30%
 * needs the opening balance, and the live feed carries credit notes / debit notes / journals /
 * bounces only as a per-customer YEARLY total; buildMonthlySeries spreads those across the
 * months (see its header) so Below-30% stays honest instead of reading soft.
 *
 * The DORMANT variant is still pinned to Both FYs — see the default export.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/** Cut the long tail without a fiddly ₹ input. */
const MIN_OUTSTANDING_OPTIONS = [
  { key: "0", label: "All", value: 0 },
  { key: "1L", label: "≥ ₹1 L", value: 100_000 },
  { key: "5L", label: "≥ ₹5 L", value: 500_000 },
] as const;
type MinOutKey = (typeof MIN_OUTSTANDING_OPTIONS)[number]["key"];

type Segment = "all" | "active" | "no_activity";

/** The thresholds management actually asks for. Anything else via the URL (?below=42). */
const THRESHOLD_OPTIONS = [0, 30, 50] as const;
/** Shortfall is measured against this. Defaults to the threshold; 65% is the standing goal. */
const TARGET_OPTIONS = [30, 50, 65, 80] as const;

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

/** Days-since-receipt cell. The never-paid sentinel must never render as 9007199254740991. */
const daysText = (v: number): string =>
  v === NEVER_PAID ? "Never" : v < 0 ? "—" : `${v}d`;

/**
 * Months-since-sale cell. Same sentinel discipline as daysText.
 *
 * "None" — never "Never". The data horizon starts 01-Apr-2025, so all we can honestly say is
 * that nothing was billed inside it. The basis note spells out where "inside it" begins.
 */
const monthsText = (v: number): string =>
  v === NEVER_SOLD ? "None" : v < 0 ? "—" : v === 0 ? "This month" : `${v}m`;

/** A percentage cell. null (no denominator) is "—", never "0%" — the two mean different things. */
const pctText = (v: number | null): string => (v === null ? "—" : `${v.toFixed(1)}%`);

/** "spare_parts" → "Spare Parts", for the filter chip and the exported filter summary. */
const saleTypeLabel = (v: string): string =>
  SALE_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;

function CollectionPerformanceInner({ variant }: { variant?: "dormant" }) {
  // ── Mode: the one thing that decides which of the three reports this is ───────────
  // `?below=` picks between the two COLLECTION reports. The DORMANT report is a different
  // question (sales, not receipts), so it comes in by route as a prop and ignores `below`.
  const [params, setParams] = useSearchParams();
  const threshold = useMemo(() => {
    const raw = Number(params.get("below"));
    return Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 30;
  }, [params]);
  const mode: CollectionsMode =
    variant === "dormant" ? "dormant" : threshold <= 0 ? "zero" : "threshold";
  const isDormantMode = mode === "dormant";
  const setThreshold = (t: number) =>
    setParams((p) => { p.set("below", String(t)); return p; }, { replace: true });

  const title = isDormantMode
    ? "Customers with Dues but No Sales"
    : mode === "zero"
      ? "Customers with Zero Collections"
      : `Customers Below ${threshold}% Collection`;
  const subtitle = isDormantMode
    ? "Customers who owe money and have billed nothing in the period — dormant accounts with cash stuck in them."
    : mode === "zero"
      ? "Customers who owe money and paid nothing in the period."
      : `Customers who collected less than ${threshold}% of what we could have collected from them.`;

  const {
    loading, allCustomers, consolidatedCustomers, customerDetail, customerGroupMap,
    dashboard, salesPersonOptions,
  } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";

  // The org-wide month list, chronological — the vocabulary every period control speaks.
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);

  /** Where the data itself begins. "Never sold" can only ever mean "not since here" — read it
   *  from the month vocabulary, never hardcode it: it moves when the FY selection does. */
  const horizonLabel = months[0] ?? "—";

  // ── Period ────────────────────────────────────────────────────────────────────────
  // Dormant opens on 6 months: one quiet quarter is a lull, two is a dead account. (The
  // collection reports open on 3 — that's a cash-flow question, and it moves faster.)
  const defaultPreset: PeriodPreset = isDormantMode ? "6m" : "3m";
  const [preset, setPreset] = useState<PeriodPreset>(defaultPreset);
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  // Seed the custom pickers from the active preset the first time months arrive, so
  // switching to Custom starts from what the user was already looking at.
  useEffect(() => {
    if (!months.length || customFrom) return;
    const w = resolveWindow(months, defaultPreset);
    setCustomFrom(w[0] ?? months[0]);
    setCustomTo(w[w.length - 1] ?? months[months.length - 1]);
  }, [months, customFrom, defaultPreset]);

  const windowMonths = useMemo(() => {
    if (preset === "custom") {
      return customFrom && customTo ? monthRange(months, customFrom, customTo) : [];
    }
    return resolveWindow(months, preset);
  }, [months, preset, customFrom, customTo]);

  const prevMonths = useMemo(() => priorWindow(months, windowMonths), [months, windowMonths]);
  /** Trap 3: the data is FY-scoped, so a "This FY" window simply has no prior period. */
  const hasPrior = prevMonths.length > 0;

  const periodRange = windowMonths.length
    ? `${monthStartLong(windowMonths[0])} → ${
        windowMonths[windowMonths.length - 1] === months[months.length - 1]
          ? formatDateDMY(asOfDate)
          : monthEndLong(windowMonths[windowMonths.length - 1])
      }`
    : "—";
  const periodLabel = `${PERIOD_LABELS[preset]} (${periodRange})`;

  // ── Target (drives Shortfall ₹) ───────────────────────────────────────────────────
  const [target, setTarget] = useState<number>(30);
  useEffect(() => { setTarget(threshold > 0 ? threshold : 30); }, [threshold]);

  // ── Count journal settlements as collected ────────────────────────────────────────
  // Multi-company reality: a customer often pays into ONE company and the receivable in another
  // is cleared by an inter-company JOURNAL (not a receipt). With this ON (default), a customer's
  // NET journal credit counts as a collection, so those genuinely-paid customers drop off the
  // list. OFF = the classic receipt-only view (for auditing what the journal cleared). See the
  // "Journal Settled" column for the amount. Not shown in dormant mode (that report isn't
  // collection-based). Journal charges (net debit) never count — see journalSettledInWindow.
  const [countJournalSettlements, setCountJournalSettlements] = useState(true);

  // ── Filters (the bar; the rest behind "More") ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [groupNamesSel, setGroupNamesSel] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  /**
   * DORMANT ONLY. Scopes the report to customers whose outstanding is DOMINATED by one of the
   * selected sale types — see dominantSaleTypeOf.
   *
   * Machine is deselected by default, deliberately. A machine is a one-time capital sale paid
   * down over months, so "hasn't bought in 6 months" is the NORMAL state for a machine ledger,
   * not a warning: on the live book, machine-dominant customers are 48 of the 123 dormant rows
   * but ₹63.3 Cr of the ₹72.8 Cr, and they swamp the report with business-as-usual. They are one
   * click away, not gone — and a machine customer who has genuinely stopped paying still shows
   * on the two collection reports, which have no such filter.
   *
   * The other two reports (zero / threshold) do NOT get this control: they ask a payment
   * question, where a machine customer is as accountable as anyone.
   */
  const [saleTypes, setSaleTypes] = useState<string[]>(
    () => (variant === "dormant" ? ["ink", "spare_parts", "head", "other"] : []),
  );
  const [minOut, setMinOut] = useState<MinOutKey>("0");
  // "More"
  const [segment, setSegment] = useState<Segment>("all");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [includeNonDebtors, setIncludeNonDebtors] = useState(false);

  const companyOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.company).filter(Boolean))].sort(),
    [allCustomers],
  );
  const locationOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.location).filter(Boolean))].sort(),
    [allCustomers],
  );
  const customerOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.name).filter(Boolean))].sort(),
    [allCustomers],
  );
  /** The REAL groups from the mapping sheet. Also decides customer-vs-group drill-through:
   *  a "group" bucket that isn't in here is just an ungrouped customer shown as its own row. */
  const realGroupNames = useMemo(
    () => allGroupNames(customerGroupMap),
    [customerGroupMap],
  );
  const groupOptions = useMemo(() => [...realGroupNames].sort(), [realGroupNames]);

  // ── View ──────────────────────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<ZCDim[]>(["salesperson", "customer"]);
  const viewLabel = useMemo(
    () => groupBy.map((d) => ZC_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → "),
    [groupBy],
  );

  // ── Columns + sort ────────────────────────────────────────────────────────────────
  // The two reports want different defaults: at threshold 0 every percentage column reads
  // 0% / "—" and only wastes width. Switching threshold therefore re-seeds both.
  const columnOptions: ColumnOption[] = ZC_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  const [visibleCols, setVisibleCols] = useState<string[]>(() => defaultColumnsFor(mode));
  const columns = useMemo<ZCColumn[]>(
    () => ZC_COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [visibleCols],
  );
  const colByKey = useMemo(() => new Map(ZC_COLUMNS.map((c) => [c.key, c])), []);

  type SortKey = ZCColumnKey | "label";
  /** Dormant and zero rank by the money at stake; threshold ranks by the shortfall it defines. */
  const defaultSortFor = (m: CollectionsMode): SortKey =>
    m === "threshold" ? "shortfall" : "outstanding";
  const [sortKey, setSortKey] = useState<SortKey>(() => defaultSortFor(mode));
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setVisibleCols(defaultColumnsFor(mode));
    setSortKey(defaultSortFor(mode));
    setSortDir("desc");
  }, [mode]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "label" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30 inline" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" /> : <ArrowDown className="h-3 w-3 inline" />;
  };

  // The "How this report is calculated" panel. Collapsed by default — the working has to be
  // available, but it must not shout over the numbers.
  const [basisOpen, setBasisOpen] = useState(false);

  // ── Expand / paginate ─────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // ── The engine ────────────────────────────────────────────────────────────────────
  // Built from RAW ledgers (allCustomers) — a ConsolidatedCustomer's monthlyReceipts /
  // lastReceiptDate / openingBalance carry only its FIRST ledger's values (consolidateByName
  // spreads ...entries[0] and doesn't override them). See lib/collections.ts.
  // Follow the topbar "Live (Tally)" toggle, same as Overdue/DSO. Under Live the engine reads
  // receipts + last-receipt from the live customer row (buildMonthlySeries/buildLastReceiptDates),
  // and buildMonthlySeries spreads the yearly notes across months so Below-30%'s opening stays
  // honest. Zero + Dormant are exact under Live; only Below-30% uses the note estimate.
  const collSource = useReceivablesSource() === "connectwave" ? "live" : "pipeline";
  const isLive = collSource === "live";
  const series = useMemo(
    () => buildMonthlySeries(allCustomers, customerDetail, collSource),
    [allCustomers, customerDetail, collSource],
  );
  const lastDates = useMemo(
    () => buildLastReceiptDates(allCustomers, customerDetail, collSource),
    [allCustomers, customerDetail, collSource],
  );
  // The anchor for Opening: the CANONICAL outstanding, rolled backwards through the window's
  // movements. Never customer_trend.outstanding — see the openingForLedger header.
  const balances = useMemo(() => buildLedgerBalances(allCustomers), [allCustomers]);
  // Dormant only: what KIND of customer this is, for the sale-type scope filter.
  const outstandingByType = useMemo(() => buildOutstandingByType(allCustomers), [allCustomers]);

  const groupOf = useCallback(
    (c: ConsolidatedCustomer) => groupNameOf(c, customerGroupMap),
    [customerGroupMap],
  );

  /** Customers eligible for the report at all: they owe us money (the KPI denominator). */
  const eligible = useMemo(() => {
    let d = consolidatedCustomers.filter((c) => matchesCategory(c, categories));
    if (customerNames.length)  { const s = new Set(customerNames);  d = d.filter((c) => s.has(c.name)); }
    if (groupNamesSel.length)  { const s = new Set(groupNamesSel);  d = d.filter((c) => s.has(groupOf(c))); }
    if (companies.length)    { const s = new Set(companies);    d = d.filter((c) => (c.companies ?? [c.company]).some((x) => s.has(x))); }
    if (locations.length)    { const s = new Set(locations);    d = d.filter((c) => (c.locations ?? [c.location]).some((x) => s.has(x))); }
    if (salespersons.length) { const s = new Set(salespersons); d = d.filter((c) => (c.salesPersons?.length ? c.salesPersons : [c.salesPerson]).some((x) => s.has(x))); }
    // Dormant only. Active only on a PROPER subset: empty and full both mean "no filter", the
    // same convention SaleTypeMultiSelect labels ("All Sale Types") and every other multi-select
    // in the app uses. So "Clear selection" restores machine rather than emptying the report.
    if (isDormantMode && saleTypes.length > 0 && saleTypes.length < SALE_TYPES.length) {
      const s = new Set(saleTypes);
      d = d.filter((c) => s.has(dominantSaleTypeOf(c, outstandingByType)));
    }
    if (segment === "active")
      d = d.filter((c) => c.sales > 0 || c.receipts > 0 || c.creditNotes > 0 || (c.otherPayments ?? 0) > 0);
    else if (segment === "no_activity")
      d = d.filter((c) => c.sales === 0 && c.receipts === 0 && c.creditNotes === 0 && (c.otherPayments ?? 0) === 0);
    if (blockedOnly) d = d.filter((c) => c.blocked === true);
    // Credit / advance ledgers have OVERPAID us. They are not non-payers, so they're out
    // by default — the report would otherwise open on a list of people who owe nothing.
    if (!includeNonDebtors) d = d.filter((c) => c.outstanding > 0);
    const min = MIN_OUTSTANDING_OPTIONS.find((o) => o.key === minOut)?.value ?? 0;
    if (min > 0) d = d.filter((c) => c.outstanding >= min);
    const q = search.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      d = d.filter((c) => {
        const text = `${c.name} ${groupOf(c)} ${c.salesPersons?.join(" ") ?? c.salesPerson}`.toLowerCase();
        return tokens.every((t) => text.includes(t));
      });
    }
    return d;
  }, [
    consolidatedCustomers, categories, customerNames, groupNamesSel, companies, locations, salespersons,
    segment, blockedOnly, includeNonDebtors, minOut, search, groupOf,
    isDormantMode, saleTypes, outstandingByType,
  ]);

  /**
   * The report itself.
   *
   *  - zero mode      : collected nothing at all. Needs no denominator, so it still catches
   *                     a customer with an empty collectible pool. Bit-for-bit the original.
   *  - threshold mode : collected less than `threshold`% of Opening + Sales. Reads the WORSE
   *                     of the gross and net-of-cheque-return percentages, so a customer whose
   *                     only "payment" bounced can't hide above the bar.
   *  - dormant mode   : billed NOTHING in the window. Also needs no denominator — paired with
   *                     the outstanding > 0 gate in `eligible`, that IS the report.
   *
   * `noPool` is the count we deliberately dropped: nothing was collectible from them in this
   * window, so their percentage is undefined — NOT 0%. The basis note reports it rather than
   * letting them silently vanish. Threshold-only: the other two predicates have no denominator
   * to be undefined, so they drop nobody.
   */
  const { rows, noPool } = useMemo(() => {
    if (!windowMonths.length) return { rows: [] as ZCRow[], noPool: 0 };
    const out: ZCRow[] = [];
    let dropped = 0;
    for (const c of eligible) {
      const facts = factsFor(c, series, lastDates, balances, months, windowMonths, prevMonths, asOfDate, countJournalSettlements);
      const listed =
        mode === "dormant" ? isDormant(facts)
        : mode === "zero"  ? isZeroCollection(facts)
        : isBelowThreshold(facts, threshold);
      if (listed) out.push({ customer: c, facts, group: groupOf(c) });
      else if (mode === "threshold" && facts.collectible < COLLECTIBLE_EPS) dropped++;
    }
    return { rows: out, noPool: dropped };
  }, [eligible, series, lastDates, balances, months, windowMonths, prevMonths, asOfDate, groupOf, mode, threshold, countJournalSettlements]);

  // ── Focus (the clickable KPI cards) + severity bands ──────────────────────────────
  // A layer ON TOP of the filter chain: eligible → rows → focusedRows. Lenses AND together.
  const [focus, setFocus] = useState<Set<ZCFocus>>(new Set());
  const [bands, setBands] = useState<Set<CollectionBand>>(new Set());
  const toggleFocus = (f: ZCFocus) =>
    setFocus((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  const toggleBand = (b: CollectionBand) =>
    setBands((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b); else next.add(b);
      return next;
    });

  const focusedRows = useMemo(() => {
    let r = applyFocus(rows, focus);
    if (bands.size) r = r.filter((x) => bands.has(bandOf(x.facts)));
    return r;
  }, [rows, focus, bands]);

  // Counts printed on the band chips — over the UNFOCUSED rows, same invariant as the KPIs.
  const counts = useMemo(() => bandCounts(rows), [rows]);
  /** Bands that can actually appear below the threshold (30% → no 30%+ band). */
  const visibleBands = useMemo(
    () => BAND_ORDER.filter((b) => counts[b] > 0),
    [counts],
  );

  // Reset paging/expansion whenever the shape of the report changes.
  useEffect(() => {
    setExpanded(new Set());
    setPage(1);
  }, [groupBy, search, customerNames, groupNamesSel, salespersons, companies, locations, categories, saleTypes, minOut, segment, blockedOnly, includeNonDebtors, preset, customFrom, customTo, focus, bands, threshold]);

  // Switching report (zero ⇄ threshold) must not strand a lens or band that no longer applies.
  useEffect(() => { setFocus(new Set()); setBands(new Set()); }, [mode]);

  // ── Roll-up ───────────────────────────────────────────────────────────────────────
  // Built from the FOCUSED rows, so the table, its grand total, pagination and the export
  // all follow the active lenses. The KPI cards deliberately do NOT — see `allTotals`.
  const metricsOf = useMemo(() => makeMetricsOf(target), [target]);

  const tree = useMemo(
    () =>
      buildGroupTree<ZCRow, ZCMetrics>(focusedRows, groupBy, {
        dimValue: zcDimValue,
        idOf: (r) => r.customer.id,
        metricsOf,
        empty: emptyMetrics,
        add: addMetrics,
      }),
    [focusedRows, groupBy, metricsOf],
  );

  // Percentage columns can be null (no denominator). Nulls sort LAST in both directions —
  // a "—" floating to the top of a descending sort reads as if it were the worst offender.
  const sortedRoots = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "label")
      return sortTree(tree.roots, (a, b) => dir * a.label.localeCompare(b.label));
    const col = colByKey.get(sortKey);
    if (!col) return tree.roots;
    return sortTree(tree.roots, (a, b) => {
      const av = col.value(a.metrics);
      const bv = col.value(b.metrics);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv);
    });
  }, [tree.roots, sortKey, sortDir, colByKey]);

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedRoots.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRoots = pageSize === "all"
    ? sortedRoots
    : sortedRoots.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ── KPIs ──────────────────────────────────────────────────────────────────────────
  // CRITICAL: computed over `rows` — the UNFOCUSED set — never over `tree.total`.
  // The cards are a fixed set of lenses over the same customers. If they recomputed under
  // the active focus, clicking "Still Buying" (94) would silently drop "Never Paid" from 38
  // to "never-paid AND still-buying": the number printed on a card would stop matching what
  // clicking it shows, and the second click of a combination would be unreadable.
  const allTotals = useMemo(() => totalsOf(rows, target), [rows, target]);

  const kpis = useMemo(() => {
    const t = allTotals;
    const eligibleOutstanding = sumOutstanding(eligible);
    const neverPaidOutstanding = rows
      .filter((r) => r.facts.lastReceiptDate === null)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    // The dormant report's damning subset: stopped buying AND stopped paying. The money on
    // these is what "dead and stuck" actually costs.
    const paidNothingOutstanding = rows
      .filter((r) => r.facts.collected < ZERO_EPS)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    const wentQuietOutstanding = rows
      .filter((r) => r.facts.salesInPrior > 0.5 && r.facts.salesInWindow <= 0.5)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    const neverSoldOutstanding = rows
      .filter((r) => r.facts.lastSaleMonth === null)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    return {
      count: rows.length,
      eligibleCount: eligible.length,
      outstanding: t.outstanding,
      sharePct: eligibleOutstanding > 0 ? (t.outstanding / eligibleOutstanding) * 100 : 0,
      overdue: t.overdue,
      over180: t.over180,
      neverPaid: t.neverPaid,
      neverPaidOutstanding,
      stillBuying: t.stillBuying,
      salesInWindow: t.salesInWindow,
      // Weighted, never an average of percentages.
      collectionPct: pctOf(t.collected, t.collectible),
      collected: t.collected,
      collectible: t.collectible,
      shortfall: t.shortfall,
      deteriorating: t.deteriorating,
      bounced: t.bounced,
      chequeReturns: t.chequeReturns,
      // Dormant
      paidNothing: t.zeroCollectors,
      paidNothingOutstanding,
      wentQuiet: t.wentQuiet,
      wentQuietOutstanding,
      neverSold: t.neverSold,
      neverSoldOutstanding,
    };
  }, [allTotals, rows, eligible]);

  /** A KPI card. `focusKey: null` = a summary card describing the WHOLE list (clicking it
   *  clears every lens rather than pretending to filter). `count` drives the inert state. */
  interface KpiCard {
    label: string;
    icon: typeof UserX;
    value: string;
    sub: string;
    focusKey: ZCFocus | null;
    /** The underlying magnitude — a card with nothing behind it isn't worth a click. */
    count: number;
    /** Why the card is inert, when that isn't obvious (e.g. no prior period this FY). */
    disabledHint?: string;
    /**
     * What the card MEANS, in plain words, on hover. A number on a management screen that
     * can't explain itself gets quoted wrong in a meeting — so every card says what it
     * counts, how it was worked out, and what to do about it.
     */
    explain: ReactNode;
  }

  const money = (n: number) => fmtINRMoney(n);

  const zeroCards: KpiCard[] = [
    {
      label: "Zero-Collection Customers", icon: UserX, focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
      explain: (
        <>
          Customers who owe you money and paid <strong>nothing at all</strong> in this period —
          no receipt voucher and no manual Other Payment.
          <br />
          <br />
          <strong>{kpis.count}</strong> of the <strong>{kpis.eligibleCount}</strong> customers who
          currently owe you money. Ledgers with the same name are merged, so one customer with
          three company ledgers counts once.
        </>
      ),
    },
    {
      label: "Outstanding Locked", icon: Wallet, focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
      explain: (
        <>
          The total these zero-collection customers owe you — <strong>{money(kpis.outstanding)}</strong>.
          <br />
          <br />
          That is <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in
          scope. The higher this is, the more your problem is concentrated in people who aren’t
          paying at all.
        </>
      ),
    },
    {
      label: "Overdue Locked", icon: TrendingDown, focusKey: "overdue",
      value: fmtINRMoney(kpis.overdue),
      sub: "already past due date",
      count: kpis.overdue,
      explain: (
        <>
          How much of that money is <strong>already past its due date</strong> — you had a
          contractual right to it and it still hasn’t come.
          <br />
          <br />
          The rest of the Outstanding is still inside its credit period.
        </>
      ),
    },
    {
      label: "Never Paid", icon: Ban, focusKey: "never",
      value: String(kpis.neverPaid),
      sub: `${fmtINRMoney(kpis.neverPaidOutstanding)} · no receipt ever`,
      count: kpis.neverPaid,
      explain: (
        <>
          Of those, how many have <strong>never made a single payment</strong> — not one receipt
          since the data begins (01-04-2025). They hold {money(kpis.neverPaidOutstanding)}.
          <br />
          <br />
          This is a write-off or legal conversation, not a follow-up call.
        </>
      ),
    },
    {
      label: "Still Buying", icon: ShoppingCart, focusKey: "buying",
      value: String(kpis.stillBuying),
      sub: `${fmtINRMoney(kpis.salesInWindow)} billed in period`,
      count: kpis.stillBuying,
      explain: (
        <>
          How many of these non-payers you are <strong>still billing</strong>. You invoiced them{" "}
          <strong>{money(kpis.salesInWindow)}</strong> during the very period in which they paid
          you nothing.
          <br />
          <br />
          This is the card that gets a decision made — it’s a <strong>credit</strong> decision, not
          a collections one.
        </>
      ),
    },
    {
      label: "> 180 Days", icon: CalendarClock, focusKey: "over180",
      value: fmtINRMoney(kpis.over180),
      sub: "oldest, hardest money",
      count: kpis.over180,
      explain: (
        <>
          Money on bills more than <strong>180 days past due</strong> — the oldest and hardest to
          recover.
          <br />
          <br />
          The longer a receivable sits here, the less of it you typically get back.
        </>
      ),
    },
  ];

  const thresholdCards: KpiCard[] = [
    {
      label: `Customers Below ${threshold}%`, icon: UserX, focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
      explain: (
        <>
          Worked out <strong>for each customer separately</strong>:
          <br />
          <br />
          <span className="font-mono text-[10px] leading-relaxed block">
            Collectible = what they owed at the start
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;+ what you billed them since
            <br />
            Collected&nbsp;&nbsp; = what they actually paid
            <br />
            <br />
            Collected ÷ Collectible &lt; {threshold}% → listed
          </span>
          <br />
          <strong>{kpis.count}</strong> of the <strong>{kpis.eligibleCount}</strong> customers who
          currently owe you money. Bounced cheques don’t count as payment; customers with nothing
          to collect are excluded, not scored 0%.
        </>
      ),
    },
    {
      label: "Collection %", icon: Percent, focusKey: null,
      value: pctText(kpis.collectionPct),
      sub: `${fmtINRMoney(kpis.collected)} of ${fmtINRMoney(kpis.collectible)} collectible`,
      count: kpis.count,
      explain: (
        <>
          Together these {kpis.count} customers could have paid{" "}
          <strong>{money(kpis.collectible)}</strong>. They paid{" "}
          <strong>{money(kpis.collected)}</strong>.
          <br />
          <br />
          So roughly <strong>{kpis.collectionPct === null ? "—" : Math.round(kpis.collectionPct)} paise
          in every rupee</strong>.
          <br />
          <br />
          This is <strong>weighted</strong> — total collected ÷ total collectible — not the average
          of their individual percentages, which would let a tiny customer count as much as a
          ₹1 Cr one.
        </>
      ),
    },
    {
      // The headline. A % can't be summed up a roll-up; this can — and it is the number
      // management acts on: "₹X would have come in had everyone hit the target."
      label: `Shortfall vs ${target}%`, icon: Target, focusKey: null,
      value: fmtINRMoney(kpis.shortfall),
      sub: "money that didn't come in",
      count: kpis.count,
      explain: (
        <>
          <strong>The number to take to a review meeting.</strong>
          <br />
          <br />
          If every one of these {kpis.count} customers had simply hit <strong>{target}%</strong>,
          another <strong>{money(kpis.shortfall)}</strong> would have landed in the bank this
          period.
          <br />
          <br />
          It’s added up <strong>customer by customer</strong>, so a good payer can’t quietly cancel
          out a bad one. Unlike a percentage, it totals correctly under every salesperson, group
          and company in the table below.
        </>
      ),
    },
    {
      label: "Outstanding Locked", icon: Wallet, focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
      explain: (
        <>
          The total these under-payers owe you — <strong>{money(kpis.outstanding)}</strong>, which is{" "}
          <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in scope.
          <br />
          <br />
          This is the “how bad is it really” card. A high share means the problem isn’t a long tail
          of small defaulters — it’s sitting where most of your money already is.
        </>
      ),
    },
    {
      label: "Still Buying", icon: ShoppingCart, focusKey: "buying",
      value: String(kpis.stillBuying),
      sub: `${fmtINRMoney(kpis.salesInWindow)} billed in period`,
      count: kpis.stillBuying,
      explain: (
        <>
          How many of these poor payers you are <strong>still billing</strong>. You invoiced them{" "}
          <strong>{money(kpis.salesInWindow)}</strong> during the very period in which they were
          under-paying you.
          <br />
          <br />
          The most actionable card here — it’s a <strong>credit</strong> decision, not a collections
          one.
        </>
      ),
    },
    {
      label: "Deteriorating", icon: TrendingDown, focusKey: "deteriorating",
      value: String(kpis.deteriorating),
      sub: hasPrior ? `fell > ${DETERIORATION_PP}pp vs prior period` : "no prior period in this FY",
      count: hasPrior ? kpis.deteriorating : 0,
      disabledHint: hasPrior
        ? undefined
        : "This fiscal year has no earlier months to compare against — pick a shorter period.",
      explain: hasPrior ? (
        <>
          These customers <strong>used to pay better</strong>. Their collection % fell by more than{" "}
          {DETERIORATION_PP} percentage points versus the previous period of the same length
          ({monthStartLong(prevMonths[0])} → {monthEndLong(prevMonths[prevMonths.length - 1])}).
          <br />
          <br />
          Something changed <strong>recently</strong> — worth a call before it hardens. This is what
          separates a customer who just went quiet from a chronic non-payer.
        </>
      ) : (
        <>
          Compares each customer’s collection % against the previous period of the same length.
          <br />
          <br />
          <strong>Unavailable here:</strong> this fiscal year has no earlier months to compare
          against, so Prior % and Δ read “—”. Pick a shorter period to enable it.
        </>
      ),
    },
    {
      label: "Bounced", icon: Undo2, focusKey: "bounced",
      value: String(kpis.bounced),
      sub: `${fmtINRMoney(kpis.chequeReturns)} of cheques returned`,
      count: kpis.bounced,
      explain: (
        <>
          They “paid”, and the cheque <strong>came back</strong>.{" "}
          <strong>{money(kpis.chequeReturns)}</strong> of cheques returned in this period.
          <br />
          <br />
          A bounced cheque is not a collection. Without this check, several of these customers would
          look like they had paid and would <strong>never appear on this report at all</strong> —
          so a customer is listed if they fall below {threshold}% on <em>either</em> the gross or the
          net-of-bounces figure.
        </>
      ),
    },
    {
      label: "Never Paid", icon: Ban, focusKey: "never",
      value: String(kpis.neverPaid),
      sub: `${fmtINRMoney(kpis.neverPaidOutstanding)} · no receipt ever`,
      count: kpis.neverPaid,
      explain: (
        <>
          Not a single payment <strong>ever</strong> — no receipt since the data begins
          (01-04-2025). They hold <strong>{money(kpis.neverPaidOutstanding)}</strong>.
          <br />
          <br />
          A write-off or legal conversation, not a follow-up call.
        </>
      ),
    },
  ];

  /**
   * The dormant report asks the SALES question, so its cards rank a dead account, not a bad
   * payer. "Still Buying" is deliberately absent: it is false for every row by construction —
   * that is the predicate — so the card would read 0 on every screen, forever.
   */
  const dormantCards: KpiCard[] = [
    {
      label: "Dormant Customers", icon: UserX, focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
      explain: (
        <>
          Customers who owe you money and have billed <strong>nothing at all</strong> in this
          period — you are no longer selling to them, but they are still holding your cash.
          <br />
          <br />
          <strong>{kpis.count}</strong> of the <strong>{kpis.eligibleCount}</strong> customers who
          currently owe you money. Ledgers with the same name are merged, so one customer with
          three company ledgers counts once.
        </>
      ),
    },
    {
      label: "Outstanding Locked", icon: Wallet, focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
      explain: (
        <>
          The total these dormant customers owe you — <strong>{money(kpis.outstanding)}</strong>,
          which is <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in
          scope.
          <br />
          <br />
          This is money tied up in relationships that have <strong>already ended</strong>. It will
          not be recovered by selling them more.
        </>
      ),
    },
    {
      label: "Overdue Locked", icon: TrendingDown, focusKey: "overdue",
      value: fmtINRMoney(kpis.overdue),
      sub: "already past due date",
      count: kpis.overdue,
      explain: (
        <>
          How much of that dormant money is <strong>already past its due date</strong>.
          <br />
          <br />
          The rest is still inside its credit period — a customer can have stopped buying and
          still not be late yet.
        </>
      ),
    },
    {
      label: "Paid Nothing Either", icon: Ban, focusKey: "paidNothing",
      value: String(kpis.paidNothing),
      sub: `${fmtINRMoney(kpis.paidNothingOutstanding)} · dead and stuck`,
      count: kpis.paidNothing,
      explain: (
        <>
          Of these dormant customers, how many also paid you <strong>nothing</strong> in the
          period. They hold <strong>{money(kpis.paidNothingOutstanding)}</strong>.
          <br />
          <br />
          <strong>The list that matters.</strong> The others are dormant but still clearing their
          balance — these have stopped buying <em>and</em> stopped paying. Nothing is coming back
          on its own.
        </>
      ),
    },
    {
      label: "Recently Gone Quiet", icon: ShoppingCart, focusKey: "wentQuiet",
      value: String(kpis.wentQuiet),
      sub: hasPrior
        ? `${fmtINRMoney(kpis.wentQuietOutstanding)} · were buying before`
        : "no prior period in this FY",
      count: hasPrior ? kpis.wentQuiet : 0,
      disabledHint: hasPrior
        ? undefined
        : "This period has no earlier months to compare against — pick a shorter period.",
      explain: hasPrior ? (
        <>
          They were buying in the <strong>previous</strong> period of the same length (
          {monthStartLong(prevMonths[0])} → {monthEndLong(prevMonths[prevMonths.length - 1])}) and
          have billed nothing since. They hold <strong>{money(kpis.wentQuietOutstanding)}</strong>.
          <br />
          <br />
          <strong>The ones you can still save.</strong> A customer who went quiet last quarter is a
          sales call; one who has been dead for two years is a collections problem.
        </>
      ) : (
        <>
          Compares billing against the previous period of the same length.
          <br />
          <br />
          <strong>Unavailable here:</strong> there are no earlier months to compare against. Pick a
          shorter period to enable it.
        </>
      ),
    },
    {
      label: "Never Sold in Horizon", icon: CalendarClock, focusKey: "neverSold",
      value: String(kpis.neverSold),
      sub: `${fmtINRMoney(kpis.neverSoldOutstanding)} · nothing billed since ${horizonLabel}`,
      count: kpis.neverSold,
      explain: (
        <>
          Not a single sale <strong>anywhere in the available data</strong>, which begins{" "}
          {horizonLabel}. They hold <strong>{money(kpis.neverSoldOutstanding)}</strong>.
          <br />
          <br />
          This does <strong>not</strong> mean they never bought from you — only that they haven’t
          since the data starts. The balance is a leftover from an older relationship, and it is
          the oldest, hardest money on this report.
        </>
      ),
    },
  ];

  const kpiCards = isDormantMode ? dormantCards : mode === "zero" ? zeroCards : thresholdCards;
  const kpiGridClass = mode === "threshold"
    ? "grid grid-cols-2 sm:grid-cols-4 gap-2"
    : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2";

  // ── Filter chips ──────────────────────────────────────────────────────────────────
  const chips: FilterChip[] = [
    ...[...focus].map((f) => ({
      label: `Focus: ${ZC_FOCUS_LABELS[f]}`,
      onRemove: () => toggleFocus(f),
    })),
    ...[...bands].map((b) => ({
      label: `Band: ${BAND_LABELS[b]}`,
      onRemove: () => toggleBand(b),
    })),
    search.trim() && { label: `Search: “${search.trim()}”`, onRemove: () => setSearch("") },
    customerNames.length > 0 && {
      label: customerNames.length <= 2 ? `Customer: ${customerNames.join(", ")}` : `Customer: ${customerNames.length} sel.`,
      onRemove: () => setCustomerNames([]),
    },
    groupNamesSel.length > 0 && {
      label: groupNamesSel.length <= 2 ? `Group: ${groupNamesSel.join(", ")}` : `Group: ${groupNamesSel.length} sel.`,
      onRemove: () => setGroupNamesSel([]),
    },
    salespersons.length > 0 && { label: `Salesperson: ${salespersons.length} sel.`, onRemove: () => setSalespersons([]) },
    companies.length > 0 && { label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) },
    locations.length > 0 && { label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) },
    categories.length > 0 && { label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) },
    // Removing the chip clears the filter (= all sale types, machine back in).
    isDormantMode && saleTypes.length > 0 && saleTypes.length < SALE_TYPES.length && {
      label: `Sale Type: ${saleTypes.map(saleTypeLabel).join(", ")}`,
      onRemove: () => setSaleTypes([]),
    },
    minOut !== "0" && {
      label: `Min Outstanding: ${MIN_OUTSTANDING_OPTIONS.find((o) => o.key === minOut)?.label}`,
      onRemove: () => setMinOut("0"),
    },
    segment !== "all" && {
      label: `Segment: ${segment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setSegment("all"),
    },
    blockedOnly && { label: "Red Mark only", onRemove: () => setBlockedOnly(false) },
    includeNonDebtors && { label: "Incl. zero & credit balances", onRemove: () => setIncludeNonDebtors(false) },
  ].filter(Boolean) as FilterChip[];

  const clearFilters = () => {
    setSearch(""); setCustomerNames([]); setGroupNamesSel([]);
    setSalespersons([]); setCompanies([]); setLocations([]);
    setCategories([]); setMinOut("0"); setSegment("all");
    setBlockedOnly(false); setIncludeNonDebtors(false);
    // "Clear filters" means CLEAR — including the machine exclusion, which is a filter like any
    // other. Leaving it on would make the cleared report still quietly hide ₹63 Cr.
    setSaleTypes([]);
    setFocus(new Set()); setBands(new Set());
  };

  const filterSummary = useMemo(() => {
    const s: string[] = [];
    // Lenses first — they're the most drastic cut, and the exported sheet has to record
    // them or it's unauditable a week later.
    for (const f of focus) s.push(`Focus: ${ZC_FOCUS_LABELS[f]}`);
    for (const b of bands) s.push(`Band: ${BAND_LABELS[b]}`);
    if (search.trim()) s.push(`Search: ${search.trim()}`);
    if (customerNames.length) s.push(`Customer: ${customerNames.join(", ")}`);
    if (groupNamesSel.length) s.push(`Group: ${groupNamesSel.join(", ")}`);
    if (salespersons.length) s.push(`Salesperson: ${salespersons.join(", ")}`);
    if (companies.length) s.push(`Company: ${companies.join(", ")}`);
    if (locations.length) s.push(`Location: ${locations.join(", ")}`);
    if (categories.length) s.push(`Category: ${categories.join(", ")}`);
    // Always record the sale-type scope on the dormant export, INCLUDING the default. The sheet
    // has to say that machine was excluded, or the totals are unexplainable a week later.
    if (isDormantMode)
      s.push(
        saleTypes.length === 0 || saleTypes.length === SALE_TYPES.length
          ? "Sale Type: All (incl. Machine)"
          : `Sale Type: ${saleTypes.map(saleTypeLabel).join(", ")} (dominant type; Machine excluded by default)`,
      );
    if (minOut !== "0") s.push(`Min Outstanding: ${MIN_OUTSTANDING_OPTIONS.find((o) => o.key === minOut)?.label}`);
    if (segment !== "all") s.push(`Segment: ${segment === "active" ? "Active" : "No Activity"}`);
    if (blockedOnly) s.push("Red Mark only");
    if (includeNonDebtors) s.push("Incl. zero & credit balances");
    return s;
  }, [focus, bands, search, customerNames, groupNamesSel, salespersons, companies, locations, categories, minOut, segment, blockedOnly, includeNonDebtors, isDormantMode, saleTypes]);

  // Live (Tally) caveat, appended only under the ConnectWave source. Zero + Dormant are exact —
  // they read live receipts / live monthly sales — so they say so. Below-30% leans on the opening
  // balance, whose per-month notes the live feed doesn't carry, so it's honest about the estimate.
  const liveNote = !isLive
    ? ""
    : (isDormantMode || mode === "zero") && !(mode === "zero" && countJournalSettlements)
      ? " Source: the live Tally feed (ConnectWave) — read directly, no estimate."
      : mode === "zero"
        ? " Source: the live Tally feed (ConnectWave). Receipts are read directly; journal settlements are apportioned from each customer's yearly journal total (the live feed doesn't carry journals month by month), so journal-cleared customers are dropped accurately over a full FY and approximately over shorter windows."
        : " Source: the live Tally feed (ConnectWave). Credit notes, debit notes, journals and bounced cheques are estimated from each customer's yearly total (the live feed doesn't carry them month by month), so the Opening balance and % are close, not exact.";

  const basis = (isDormantMode
    ? `A customer is listed when they owe money (Outstanding > ₹0) and billed NO sales at all in the period. Sales are read at month grain from the customer trend and summed over every ledger the customer consolidates. Months Since Sale counts back to the most recent month with any billing; "None" means nothing billed anywhere in the available data, which begins ${horizonLabel} — it does NOT mean the customer never bought from us. A group row shows its deadest member. "Paid Nothing Either" narrows to those who also collected ₹0 in the period; "Recently Gone Quiet" to those who were still buying in the previous period of the same length. The Sale Type filter scopes the report to customers whose outstanding is DOMINATED by the selected types (the single largest type wins; untagged balances count as Other). MACHINE IS EXCLUDED BY DEFAULT: a machine is a one-time capital sale paid down over months, so a machine customer not re-ordering is normal rather than a warning — select it in the Sale Type filter to bring those customers back in.`
    : mode === "zero"
      ? (countJournalSettlements
          ? "No receipt voucher, manual Other Payment, OR journal settlement in the period. A customer whose balance was cleared by a journal (e.g. paid in one company, moved across by an inter-company journal) is treated as paid and drops off — the amount shows in the Journal Settled column. Only journals that NET to a credit count; journal charges don't. Cheque returns are reported, not netted."
          : "No receipt voucher and no Other Payment in the period. Journal settlements are NOT counted (toggle off). Cheque returns are reported, not netted.")
      : `Collection % = Collected ÷ (Opening Outstanding at period start + Sales billed in the period). Collected = receipt vouchers + manual Other Payments${countJournalSettlements ? " + net journal settlements (see the Journal Settled column)" : ""}. Opening is derived by rolling today's outstanding back through the period, so Opening + Sales − Collected reconciles to Outstanding (within credit/debit notes and journals). A customer is listed when EITHER the gross or the net-of-cheque-returns percentage falls below ${threshold}%.`) + liveNote;

  // ── Export — WYSIWYG: same period, threshold, filters, FOCUS, view, sort, columns ──
  // `focusedRows` (not `rows`) feeds the flat Customers sheet: otherwise the roll-up sheet
  // would be focused while the flat sheet silently listed every customer — a mismatch you'd
  // only ever discover in Excel.
  const handleExport = () => {
    exportCollectionsXlsx(sortedRoots, tree.total, focusedRows, columns, {
      title,
      viewLabel,
      periodLabel,
      basis,
      targetPct: target,
      asOfDate,
      filterSummary,
    });
  };

  // ── Drill-through to Customer / Group Detail ──────────────────────────────────────
  // The route param is the NAME, url-encoded — CustomerDetail matches it against the raw
  // ledger names. Passing an id (ConsolidatedCustomer.id is a pipeline surrogate) resolves
  // to nothing and renders "Customer not found". New tab, so the filters — which live in
  // component state and don't survive a same-tab Back — stay intact behind you.
  const hubBase = useHubBase();
  const openDetail = (path: string) =>
    window.open(path.replace(/^\/outstanding-dashboard/, hubBase), "_blank", "noopener,noreferrer");
  const detailPathOf = (n: GroupNode<ZCMetrics>): string | null =>
    detailPathFor(n.path[n.path.length - 1]?.dim as ZCDim | undefined, n.label, realGroupNames);

  // ── Invoice drill-down ────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[] }>(
    { open: false, title: "", subtitle: "", rows: [] },
  );

  const rowsById = useMemo(() => {
    const m = new Map<string, ZCRow>();
    for (const r of rows) m.set(r.customer.id, r);
    return m;
  }, [rows]);

  const openDrill = (node: GroupNode<ZCMetrics> | null, col: ZCColumn) => {
    if (!col.drill) return;
    const ids = node ? node.ids : tree.totalIds;
    const drillRows: InvoiceDrillRow[] = [];
    for (const id of ids) {
      const r = rowsById.get(id);
      if (!r) continue;
      // A consolidated row's bills live under its constituent LEDGER ids.
      const ledgerIds = r.customer.constituentIds?.length ? r.customer.constituentIds : [r.customer.id];
      for (const lid of ledgerIds) {
        for (const inv of customerDetail[lid]?.invoices ?? []) {
          if (inv.pending <= 0) continue;
          if (col.drill === "overdue" && inv.overdueDays <= 0) continue;
          if (col.drill === "over180" && inv.overdueDays <= 180) continue;
          drillRows.push({
            customerName: r.customer.name,
            groupName: r.group,
            company: r.customer.company,
            location: r.customer.location,
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
    if (drillRows.length === 0) return;
    setDrill({
      open: true,
      title: `${col.label} — open bills`,
      subtitle: node ? (node.sub ? `${node.label} · ${node.sub}` : node.label) : "All rows",
      rows: drillRows,
    });
  };

  // ── Freeze panes: keep the name column put while scrolling right ───────────────────
  const [freezeLevel, setFreezeLevel] = useState<0 | 1>(1);
  const chevRef = useRef<HTMLTableCellElement>(null);
  const labelRef = useRef<HTMLTableCellElement>(null);
  const [colW, setColW] = useState({ chev: 32, label: 240 });
  const measureCols = useCallback(() => {
    const chev = chevRef.current?.offsetWidth ?? 32;
    const label = labelRef.current?.offsetWidth ?? 240;
    setColW((prev) => (prev.chev === chev && prev.label === label ? prev : { chev, label }));
  }, []);
  useLayoutEffect(measureCols); // re-measure every render; the setState is guarded so it can't loop
  useEffect(() => {
    window.addEventListener("resize", measureCols);
    return () => window.removeEventListener("resize", measureCols);
  }, [measureCols]);

  type FreezeId = "chevron" | "label";
  const freezeStick = (
    id: FreezeId,
    opts?: { header?: boolean; bg?: string },
  ): { className: string; style?: CSSProperties } => {
    if (freezeLevel < 1) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const shadow = id === "label" ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : "";
    return {
      className: `sticky ${opts?.header ? "z-20" : "z-10"} ${bg} ${shadow}`,
      style: { left: id === "chevron" ? 0 : colW.chev },
    };
  };
  const freezePin = () => {
    const active = freezeLevel >= 1;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setFreezeLevel(active ? 0 : 1); }}
        className={`ml-1 inline-flex items-center justify-center h-4 w-4 rounded shrink-0 ${active ? "text-primary" : "text-foreground/35 hover:text-foreground/70"}`}
        title={active ? "Unfreeze the name column" : "Freeze the name column while scrolling"}
      >
        <Pin className={`h-3 w-3 ${active ? "fill-primary" : ""}`} />
      </button>
    );
  };

  // ── Rows ──────────────────────────────────────────────────────────────────────────
  const metricCells = (node: GroupNode<ZCMetrics> | null, isTotal: boolean): ReactNode =>
    columns.map((col) => {
      const m = node ? node.metrics : tree.total;
      const v = col.value(m);
      const clickable = !!col.drill && v !== null && Math.abs(v) >= 0.5;

      // What "wrong" means differs by column: a shortfall is bad when it's big, a collection
      // % when it's SMALL, and a Δ when it's a steep fall.
      const alarm =
        v === null ? false
        : col.key === "deltaPp" ? v < -DETERIORATION_PP
        : col.lowIsBad ? v < threshold
        : col.kind === "days" ? !!col.alarm && (v === NEVER_PAID || v > 180)
        // Six quiet months is the point at which a lull has become a dead account — the same
        // bar the report opens on.
        : col.kind === "months" ? !!col.alarm && (v === NEVER_SOLD || v >= 6)
        : !!col.alarm && v > 0.5;

      const text =
        v === null ? "—"
        : col.kind === "money" ? fmtINRMoney(v)
        : col.kind === "days" ? daysText(v)
        : col.kind === "months" ? monthsText(v)
        : col.kind === "pct"
          ? (col.key === "deltaPp" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : `${v.toFixed(1)}%`)
          : String(v);

      return (
        <TableCell
          key={col.key}
          onClick={clickable ? (e) => { e.stopPropagation(); openDrill(node, col); } : undefined}
          title={clickable ? "Click to see the open bills" : undefined}
          className={`text-right font-mono whitespace-nowrap ${isTotal ? "text-sm" : "text-[13px]"} ${alarm ? "text-destructive" : ""} ${clickable ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
        >
          {text}
        </TableCell>
      );
    });

  const renderNodes = (nodes: GroupNode<ZCMetrics>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const path = detailPathOf(n);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      const bg = "bg-surface group-hover:bg-[hsl(var(--muted))]";
      const chev = freezeStick("chevron", { bg });
      const lab = freezeStick("label", { bg });
      // A Customer / Customer Group row opens its detail page; every other dimension is a
      // pure subtotal with nowhere to go, so it keeps toggle-on-row-click. When a row can do
      // BOTH (a group with children), the row opens the page and the caret expands.
      const onRowClick = path
        ? () => openDetail(path)
        : hasChildren
          ? () => toggle(n.key)
          : undefined;
      return (
        <Fragment key={n.key}>
          <TableRow
            className={`group ${tint} ${onRowClick ? "cursor-pointer hover:bg-muted/40" : ""} transition-colors`}
            onClick={onRowClick}
          >
            <TableCell style={chev.style} className={`text-muted-foreground ${chev.className}`}>
              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
                  className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
            </TableCell>
            <TableCell
              style={{ ...lab.style, paddingLeft: 8 + n.depth * 18 }}
              className={`whitespace-nowrap ${n.depth === 0 ? "font-medium text-sm" : "text-[13px] text-muted-foreground"} ${lab.className}`}
              title={path ? "Open in a new tab" : undefined}
            >
              <span className={path ? "group-hover:text-primary group-hover:underline" : ""}>{n.label}</span>
              {n.sub && <span className="ml-1.5 text-[10px] font-normal opacity-70">{n.sub}</span>}
              {hasChildren && <span className="ml-1.5 text-[11px] opacity-70">({n.children.length})</span>}
            </TableCell>
            {metricCells(n, false)}
          </TableRow>
          {isOpen && hasChildren && renderNodes(n.children)}
        </Fragment>
      );
    });

  const noMonths = !loading && months.length === 0;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserX className="h-6 w-6 text-primary" /> {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {subtitle}
            {asOfDate && <span className="text-foreground/70"> As on {formatDateDMY(asOfDate)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columnOptions} visible={visibleCols} onChange={setVisibleCols} />
          <Button
            onClick={handleExport}
            disabled={focusedRows.length === 0}
            size="sm"
            className="rounded-button bg-primary hover:bg-primary-hover text-primary-foreground"
          >
            <Download className="h-4 w-4 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {/* Threshold + Period */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          {/* The threshold row is a COLLECTIONS control. Dormancy has no threshold — the
              report's only knob is the period, so the row is dropped entirely there. */}
          {!isDormantMode && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Collected below</span>
            {THRESHOLD_OPTIONS.map((t) => (
              <Button
                key={t}
                variant={threshold === t ? "default" : "outline"}
                size="sm"
                onClick={() => setThreshold(t)}
                className={`h-7 text-xs rounded-button ${threshold === t ? "bg-primary text-primary-foreground" : "border-border"}`}
              >
                {t === 0 ? "0% (nothing)" : `${t}%`}
              </Button>
            ))}
            {!THRESHOLD_OPTIONS.includes(threshold as (typeof THRESHOLD_OPTIONS)[number]) && (
              <span className="h-7 px-2.5 inline-flex items-center text-xs rounded-button bg-primary text-primary-foreground">
                {threshold}%
              </span>
            )}
            {mode === "threshold" && (
              <>
                <span className="ml-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Target</span>
                <Select value={String(target)} onValueChange={(v) => setTarget(Number(v))}>
                  <SelectTrigger className="h-7 w-24 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_OPTIONS.map((t) => (
                      <SelectItem key={t} value={String(t)}>{t}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">drives the Shortfall column</span>
              </>
            )}
          </div>
          )}

          {/* No divider above the Period row when it's the only row on the card. */}
          <div className={`flex flex-wrap items-center gap-2 ${isDormantMode ? "" : "pt-1 border-t border-border/60"}`}>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Period</span>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              {(["1m", "3m", "6m", "fy", "all", "custom"] as PeriodPreset[]).map((p) => (
                <Button
                  key={p}
                  variant={preset === p ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPreset(p)}
                  className={`h-7 text-xs rounded-button ${preset === p ? "bg-primary text-primary-foreground" : "border-border"}`}
                >
                  {PERIOD_LABELS[p]}
                </Button>
              ))}
              {preset === "custom" && (
                <div className="flex items-center gap-1">
                  <Select value={customFrom} onValueChange={setCustomFrom}>
                    <SelectTrigger className="h-7 w-28 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground text-xs">→</span>
                  <Select value={customTo} onValueChange={setCustomTo}>
                    <SelectTrigger className="h-7 w-28 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {periodRange}
            {windowMonths.length > 0 && windowMonths[windowMonths.length - 1] === months[months.length - 1] && (
              <span className="opacity-70"> · the current month is still in progress</span>
            )}
            {hasPrior ? (
              <span className="opacity-70"> · compared against {monthStartLong(prevMonths[0])} → {monthEndLong(prevMonths[prevMonths.length - 1])}</span>
            ) : (
              <span className="opacity-70"> · no prior period in this fiscal year, so Prior % and Δ read “—”</span>
            )}
          </p>

          {/* Multi-company: a customer often pays into one company and the receivable in another
              is cleared by an inter-company JOURNAL, not a receipt. Counting the net journal
              credit as a collection stops those genuinely-paid customers being flagged. */}
          {!isDormantMode && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Journal Settlements</span>
              <div className="pt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant={countJournalSettlements ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCountJournalSettlements((v) => !v)}
                  className={`h-7 text-xs rounded-button ${countJournalSettlements ? "bg-primary text-primary-foreground" : "border-border"}`}
                >
                  {countJournalSettlements ? "Counted as collected" : "Not counted"}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {countJournalSettlements
                    ? "A customer whose balance was cleared by a journal (e.g. inter-company transfer) counts as paid — see the Journal Settled column. Journal charges (net debit) don’t count."
                    : "Only cash / bank receipts and manual Other Payments count; journal settlements are ignored."}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPIs — click to focus the table. The lens cards AND together; the summary cards
          describe the whole list, so clicking any of them clears every lens. */}
      <div className={kpiGridClass}>
        {kpiCards.map((k) => {
          const Icon = k.icon;
          const isSummary = k.focusKey === null;
          const active = isSummary ? focus.size === 0 : focus.has(k.focusKey!);
          // A card with nothing behind it isn't worth a click — EXCEPT while it's active, or
          // a filter that drives it to zero would strand a focus the user can't switch off.
          const clickable = isSummary ? rows.length > 0 : active || k.count > 0.5;
          // Every card explains itself on hover. A number on a management screen that can't say
          // what it counts gets quoted wrong in a meeting.
          const action =
            !clickable ? null
            : isSummary ? "Click to clear every filter and show all customers."
            : active ? `Click to remove the “${k.label}” filter.`
            : "Click to show only these customers in the table.";
          return (
            <Tooltip key={k.label} delayDuration={200}>
              <TooltipTrigger asChild>
                <Card
                  onClick={clickable ? () => (isSummary ? setFocus(new Set()) : toggleFocus(k.focusKey!)) : undefined}
                  role="button"
                  tabIndex={clickable ? 0 : -1}
                  aria-pressed={active}
                  aria-disabled={!clickable}
                  onKeyDown={(e) => {
                    if (!clickable) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      isSummary ? setFocus(new Set()) : toggleFocus(k.focusKey!);
                    }
                  }}
                  className={`rounded-card bg-surface transition-all ${
                    active
                      ? "border-primary/50 ring-2 ring-primary"
                      : clickable
                        ? "border-border cursor-pointer hover:border-primary/40 hover:bg-muted/30"
                        : "border-border opacity-50"
                  }`}
                >
                  <CardContent className="px-3 py-2">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Icon className={`h-3 w-3 shrink-0 ${active && !isSummary ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="text-[11px] text-muted-foreground leading-tight">{k.label}</span>
                    </div>
                    <p className="text-sm font-bold text-destructive">{k.value}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{k.sub}</p>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="max-w-[320px] p-3 text-[11px] leading-relaxed font-normal text-left"
              >
                <p className="font-semibold text-[12px] mb-1.5">{k.label}</p>
                <p>{k.explain}</p>
                {(action || k.disabledHint) && (
                  <p className="mt-2 pt-2 border-t border-border/50 text-[10px] opacity-80">
                    {action ?? k.disabledHint}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Severity bands — how bad is "below the bar"? Only meaningful once there's a bar. */}
      {mode === "threshold" && visibleBands.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Severity</span>
          {visibleBands.map((b) => {
            const on = bands.has(b);
            return (
              <button
                key={b}
                type="button"
                onClick={() => toggleBand(b)}
                className={`h-7 px-2.5 text-xs rounded-button border transition-colors ${
                  on
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "bg-surface text-muted-foreground border-border hover:bg-muted"
                }`}
                title={on ? "Remove this band" : "Show only this band"}
              >
                {BAND_LABELS[b]} <span className="opacity-70">({counts[b]})</span>
              </button>
            );
          })}
        </div>
      )}

      {(focus.size > 0 || bands.size > 0) && (
        <p className="text-[11px] text-primary -mt-3">
          Showing {focusedRows.length} of {rows.length} customers —{" "}
          {[...[...focus].map((f) => ZC_FOCUS_LABELS[f]), ...[...bands].map((b) => BAND_LABELS[b])].join(" + ")}
          {focus.size + bands.size > 1 && <span className="text-muted-foreground"> (all conditions met)</span>}
          . The cards above still count all {rows.length}.
        </p>
      )}

      {/* View + filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          {/* Presets + chainable levels (Customer Group → Customer → Salesperson, any order). */}
          <GroupByBuilder dimensions={ZC_DIMENSIONS} presets={ZC_PRESETS} value={groupBy} onChange={setGroupBy} />

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Filters</span>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer, group…"
                  className="h-8 w-52 pl-7 pr-6 text-xs rounded-input border border-border bg-surface text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <MultiSelect options={customerOptions} value={customerNames} onChange={setCustomerNames} allLabel="All Customers" noun="customers" triggerClassName="h-8 w-44 text-xs rounded-input" />
              <MultiSelect options={groupOptions} value={groupNamesSel} onChange={setGroupNamesSel} allLabel="All Groups" noun="groups" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <SalesPersonMultiSelect options={salesPersonOptions} value={salespersons} onChange={setSalespersons} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} triggerClassName="h-8 w-40 text-xs rounded-input" />
              {/* Dormant only. Scopes by the customer's DOMINANT sale type; Machine is off by
                  default because a machine is bought once and paid down over months, so "no
                  repeat purchase" is its normal state, not a warning. See dominantSaleTypeOf. */}
              {isDormantMode && (
                <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-36 text-xs rounded-input" />
              )}

              {/* Min Outstanding — chips, not a fiddly ₹ box */}
              <div className="inline-flex items-center rounded-input border border-border overflow-hidden">
                {MIN_OUTSTANDING_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setMinOut(o.key)}
                    className={`h-8 px-2.5 text-xs transition-colors ${minOut === o.key ? "bg-primary text-primary-foreground font-medium" : "bg-surface text-muted-foreground hover:bg-muted"}`}
                    title="Minimum outstanding"
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {/* Everything else lives here, off by default */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs rounded-input border-border">
                    <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> More
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-3 space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Customer segment</p>
                    <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
                      <SelectTrigger className="h-8 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All customers</SelectItem>
                        <SelectItem value="active">Active this FY</SelectItem>
                        <SelectItem value="no_activity">No activity (dormant)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={blockedOnly} onCheckedChange={(v) => setBlockedOnly(v === true)} />
                    <span className="text-xs text-foreground">Red Mark customers only</span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <Checkbox className="mt-0.5" checked={includeNonDebtors} onCheckedChange={(v) => setIncludeNonDebtors(v === true)} />
                    <span className="text-xs text-foreground leading-snug">
                      Include zero &amp; credit balances
                      <span className="block text-[10px] text-muted-foreground">They owe nothing — off by default.</span>
                    </span>
                  </label>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
      </Card>

      {/* How it's calculated — a management report must be able to show its working, but the
          working must not shout over the numbers. Collapsed by default; one click to audit. */}
      <Card className="rounded-card border-border bg-surface">
        <button
          type="button"
          onClick={() => setBasisOpen((o) => !o)}
          aria-expanded={basisOpen}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-card"
        >
          <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">How this report is calculated</span>
          <span className="text-[11px] text-muted-foreground hidden sm:inline truncate">
            {mode === "zero"
              ? "· who is listed, and what counts as a payment"
              : `· Collection % = Collected ÷ (Opening Outstanding + Sales)`}
          </span>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${basisOpen ? "rotate-180" : ""}`}
          />
        </button>

        {basisOpen && (
          <CardContent className="px-4 pb-4 pt-0">
            <ul className="space-y-2 text-[12px] leading-relaxed text-muted-foreground list-disc pl-9 marker:text-primary">
              {mode === "zero" ? (
                <>
                  <li>
                    <strong className="text-foreground">Who is listed.</strong> Customers who owe money and made{" "}
                    <strong className="text-foreground">no receipt voucher and no manual Other Payment</strong> in the
                    period — they paid nothing at all.
                  </li>
                  <li>
                    <strong className="text-foreground">Cheque returns are shown, not netted.</strong> A bounced payer
                    still counts as having paid, so they do <em>not</em> appear here. The{" "}
                    <em>Below 30% Collection</em> report does catch them.
                  </li>
                  <li>
                    <strong className="text-foreground">“Never” means never.</strong> The data starts{" "}
                    <strong className="text-foreground">01-04-2025</strong>, so “Never Paid” means no receipt since
                    then — not merely none this period.
                  </li>
                  <li>
                    <strong className="text-foreground">It reconciles.</strong> Collections are month-wise, matching
                    the Salesperson Collection Report exactly.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <strong className="text-foreground">Collection % = Collected ÷ Collectible</strong>, worked out for
                    each customer separately.
                    <div className="mt-1.5 font-mono text-[11px] text-foreground/80 bg-muted/40 rounded-input px-3 py-2 inline-block">
                      Collectible = what they owed at the start of the period
                      <br />
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ what we billed them during it
                      <br />
                      Collected&nbsp;&nbsp;&nbsp;= receipt vouchers + manual Other Payments
                    </div>
                  </li>
                  <li>
                    <strong className="text-foreground">A group’s % is weighted.</strong> Every salesperson, group and
                    company row is its own <strong className="text-foreground">Σ Collected ÷ Σ Collectible</strong> —{" "}
                    <em>never</em> the average of its customers’ percentages, which would let a ₹1 L customer count as
                    much as a ₹1 Cr one.
                  </li>
                  <li>
                    <strong className="text-foreground">The columns add up.</strong> Opening is derived by rolling
                    today’s Outstanding <em>back</em> through the period’s movements, so{" "}
                    <strong className="text-foreground">Opening + Sales − Collected reconciles to Outstanding</strong>{" "}
                    — to the rupee, once credit/debit notes and journals are taken in.
                  </li>
                  <li>
                    <strong className="text-foreground">A bounced cheque cannot hide a defaulter.</strong> A customer is
                    listed when <strong className="text-foreground">either</strong> the gross{" "}
                    <strong className="text-foreground">or</strong> the net-of-cheque-returns percentage falls below{" "}
                    {threshold}%. Without this, a customer whose only payment bounced would score above the bar and
                    never appear.
                  </li>
                  <li>
                    <strong className="text-foreground">Credit notes clear a bill without cash.</strong> A customer
                    whose balance was cleared by sales returns still appears here — they paid nothing. The{" "}
                    <strong className="text-foreground">Credit Notes</strong> column says why.
                  </li>
                  <li>
                    <strong className="text-foreground">Nothing to collect ⇒ excluded, not 0%.</strong>{" "}
                    {noPool > 0 ? (
                      <>
                        {noPool} customer{noPool === 1 ? "" : "s"} had no opening balance and no sales this period, so{" "}
                        {noPool === 1 ? "it is" : "they are"} left out — a percentage of nothing is undefined.
                      </>
                    ) : (
                      <>A customer with no opening balance and no sales is left out — a percentage of nothing is undefined.</>
                    )}
                  </li>
                  <li>
                    <strong className="text-foreground">It reconciles.</strong> Collections are month-wise, matching the
                    Salesperson Collection Report exactly. The data starts{" "}
                    <strong className="text-foreground">01-04-2025</strong>.
                  </li>
                </>
              )}
              <li>
                <strong className="text-foreground">Getting around.</strong> Click a{" "}
                <strong className="text-foreground">Customer</strong> or{" "}
                <strong className="text-foreground">Customer Group</strong> row to open its detail page in a new tab
                (use the caret to expand instead). Use the <Pin className="h-3 w-3 inline" /> to freeze the name column
                while scrolling.
              </li>
            </ul>
          </CardContent>
        )}
      </Card>

      {/* Table */}
      <ScrollableTable maxHeight="max-h-[62vh]" className="rounded-lg border border-border">
        <Table className="border-collapse [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/70 [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r [&_th]:border-r-border [&_td]:border-r-border/60">
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead
                ref={chevRef}
                style={freezeStick("chevron", { header: true }).style}
                className={`w-8 ${freezeStick("chevron", { header: true }).className}`}
              />
              <TableHead
                ref={labelRef}
                style={freezeStick("label", { header: true }).style}
                className={`text-xs font-semibold text-foreground/70 whitespace-nowrap cursor-pointer select-none ${freezeStick("label", { header: true }).className}`}
                onClick={() => toggleSort("label")}
              >
                <span className="inline-flex items-center gap-1">
                  {viewLabel}
                  {sortIcon("label")}
                  {freezePin()}
                </span>
              </TableHead>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="text-right text-[11px] font-semibold text-foreground/60 whitespace-nowrap cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1 justify-end w-full">
                    {col.label}{sortIcon(col.key)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : noMonths ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center py-12 text-muted-foreground">
                  No monthly data available for this fiscal year.
                </TableCell>
              </TableRow>
            ) : sortedRoots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center py-12 text-muted-foreground">
                  {focus.size > 0 || bands.size > 0 ? (
                    <>
                      No customer matches{" "}
                      {[...[...focus].map((f) => ZC_FOCUS_LABELS[f]), ...[...bands].map((b) => BAND_LABELS[b])].join(" + ")}.
                      <button
                        type="button"
                        onClick={() => { setFocus(new Set()); setBands(new Set()); }}
                        className="ml-1.5 text-primary hover:underline"
                      >
                        Clear the focus
                      </button>
                    </>
                  ) : mode === "zero" ? (
                    "No customer matches — everyone who owes money paid something in this period."
                  ) : (
                    `No customer matches — everyone who owes money collected at least ${threshold}% in this period.`
                  )}
                </TableCell>
              </TableRow>
            ) : (
              <>
                <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                  <TableCell
                    style={freezeStick("chevron", { bg: "bg-muted" }).style}
                    className={freezeStick("chevron", { bg: "bg-muted" }).className}
                  />
                  <TableCell
                    style={freezeStick("label", { bg: "bg-muted" }).style}
                    className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${freezeStick("label", { bg: "bg-muted" }).className}`}
                  >
                    Grand Total
                  </TableCell>
                  {metricCells(null, true)}
                </TableRow>
                {renderNodes(pagedRoots)}
              </>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      {/* Pagination */}
      {sortedRoots.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(v === "all" ? "all" : (Number(v) as PageSize)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-20 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={String(s)} value={String(s)}>{s === "all" ? "All" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              {sortedRoots.length} {sortedRoots.length === 1 ? "row" : "rows"} · {focusedRows.length} customer{focusedRows.length === 1 ? "" : "s"}
              {(focus.size > 0 || bands.size > 0) && <span className="opacity-70"> of {rows.length}</span>}
            </span>
          </div>
          {pageSize !== "all" && totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-disabled={safePage === 1}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {getPageWindow(safePage, totalPages).map((p, i) =>
                  p === "..." ? (
                    <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={p === safePage} onClick={() => setPage(p)} className="cursor-pointer">
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={safePage === totalPages}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      <InvoiceDrilldownDialog
        open={drill.open}
        onOpenChange={(o) => setDrill((d) => ({ ...d, open: o }))}
        title={drill.title}
        subtitle={drill.subtitle}
        rows={drill.rows}
        asOfDate={asOfDate}
      />
    </div>
  );
}

export default function CollectionPerformanceReport({ variant }: { variant?: "dormant" }) {
  // Follows the source toggle. The three predicates that DECIDE each report are exact under Live:
  // Zero Collections ("paid nothing") reads live receipts, Dormant ("billed nothing") reads live
  // monthly sales. Only Below-30% needs the opening balance, whose per-month credit/debit notes,
  // journals and bounces the live feed lacks — buildMonthlySeries estimates those from each
  // customer's yearly total (see its header), so Below-30% stays honest rather than reading soft.
  //
  // DORMANT is still pinned to Both FYs — the same reasoning as OverdueAgingReport. Its window is
  // `months.slice(-6)` over the FY-scoped month vocabulary, so on a young FY "no sales in the last
  // 6 months" would silently become "in the last 3", and a customer who last bought in Feb would
  // be reported as never having bought at all. A dormancy question is a property of the whole
  // book, so it reads the whole book. The nested FYProvider re-bases the FY context to its default
  // (Both FYs); UserLayout hides the topbar FY selector on the route so the two can never disagree.
  const inner = <CollectionPerformanceInner variant={variant} />;
  return variant === "dormant" ? <FYProvider>{inner}</FYProvider> : inner;
}
