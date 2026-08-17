import {
  useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment,
  type ReactNode, type CSSProperties,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  UserX, ChevronRight, ChevronDown, ArrowLeft, Info, Pin, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Wallet, TrendingDown,
  CalendarClock, ShoppingCart, Ban, Percent, Target, Undo2, AlertTriangle,
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
import { CustomerCategoryMultiSelect, matchesCategory, CATEGORY_OPTIONS } from "@hub/components/CustomerCategoryMultiSelect";
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
import { monthEndLong, monthStartLong, monthStartISO, monthEndISO, isoToMonthLabel } from "@hub/lib/months";
import { Input } from "@hub/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { fetchRangeFacts, priorRange, lastNDays } from "@hub/lib/collectionsRange";
import {
  buildLastReceiptDates, buildLastReceiptAmounts, buildLedgerBalances, buildMonthlySeries, buildOutstandingByType, factsFor, factsForRange,
  DATE_RANGE_PRESETS, isDateRangePreset,
  isZeroCollection, isBelowThreshold, isDormant, dominantSaleTypeOf, bandOf, bandCounts, pctOf,
  makeMetricsOf, addMetrics, emptyMetrics, zcDimValue, monthRange, priorWindow, resolveWindow,
  applyFocus, totalsOf, detailPathFor, defaultColumnsFor, defaultGroupByFor, pickerColumnsFor,
  buildDrillRows,
  overdueBySaleType, isCriticalSaleType, SALE_TYPE_CARD_ORDER,
  COLLECTIBLE_EPS, DETERIORATION_PP, NEVER_PAID, NEVER_SOLD, ZERO_EPS, SALE_TYPES,
  BAND_LABELS, BAND_ORDER,
  PERIOD_LABELS, ZC_COLUMNS, ZC_DIMENSIONS, ZC_PRESETS, ZC_FOCUS_LABELS,
  type CollectionBand, type CollectionsMode, type PeriodPreset, type ZCColumn, type ZCColumnKey,
  type ZCDim, type ZCFocus, type ZCMetrics, type ZCRow,
} from "@hub/lib/collections";
import { useReportColumnPrefs, REPORT_PREF_IDS } from "@hub/lib/reportPrefs";
import { salespersonNamesOf, type CollectionsExportContext } from "@hub/lib/collectionsExport";
import { useHubMenuAccess } from "@hub/lib/menus";
import { ExportMenu } from "./collections/ExportMenu";
import type { ConsolidatedCustomer, SaleType } from "@hub/lib/types";

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

/**
 * The header row is frozen to the top of the scroll box, always — a table 100 rows deep whose
 * column names scroll away is a table you can only read by scrolling back up. Applied per CELL,
 * not to the `<tr>`: `position: sticky` on a table row does nothing in Chrome.
 *
 * Three things this class has to carry, all load-bearing:
 *  - OPAQUE background (bg-muted, not the row's bg-muted/60) or the rows slide visibly under it.
 *  - z-20, which clears the frozen body cells (z-10). The two cells frozen on BOTH axes take
 *    z-30 in `freezeStick`.
 *  - the bottom rule as an INSET SHADOW, not a border. The table is `border-collapse`, and a
 *    collapsed border belongs to the table rather than the cell — so the header's real
 *    `border-b` scrolls away with the body and the frozen row loses its underline exactly when
 *    it is doing its job. A shadow is painted by the cell and stays put.
 */
const HEADER_STICKY = "sticky top-0 z-20 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))]";

/** Cut the long tail without a fiddly ₹ input. */
const MIN_OUTSTANDING_OPTIONS = [
  { key: "0", label: "All", value: 0 },
  { key: "1L", label: "≥ ₹1 L", value: 100_000 },
  { key: "5L", label: "≥ ₹5 L", value: 500_000 },
] as const;
type MinOutKey = (typeof MIN_OUTSTANDING_OPTIONS)[number]["key"];

type Segment = "all" | "active" | "no_activity";

/**
 * Sale-type default for EVERY variant of this report (zero / threshold / dormant): all types
 * except Machine. A machine is a one-time capital sale paid down over months, so "hasn't bought /
 * hasn't paid recently" is its NORMAL state, not a warning — machine-dominant customers otherwise
 * swamp the list with business-as-usual. They are one click away, not gone. "Clear filters"
 * resets to THIS, not to a truly-empty (Machine back in) set, so a cleared call-list stays honest.
 */
const DEFAULT_SALE_TYPES = ["ink", "spare_parts", "head", "other"] as const;

/**
 * Category default for every variant: all tiers EXCEPT "AA" (internal). AA is not a real customer
 * relationship, so it doesn't belong on a collections call-list by default. One click ("Select
 * all" in the dropdown) adds it back; "Clear filters" resets to THIS, not to a truly-empty set.
 */
const DEFAULT_CATEGORIES = CATEGORY_OPTIONS.map((o) => o.value).filter((v) => v !== "AA");

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

/** Last-receipt cell. Takes the yyyymmdd ordinal the metric carries and shows dd-mm-yyyy;
 *  0 (no receipt in the data horizon) reads "Never", same as the days column. */
const dateText = (v: number): string => {
  if (!v) return "Never";
  const s = String(v);
  return formatDateDMY(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
};

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

  /**
   * Which catalogue report this screen currently IS (lib/reportCatalog.ts).
   *
   * One component serves three catalogue entries, so the id has to be derived from `mode` rather
   * than read off the route. It is what gates emailing — `report_email_settings` is keyed on it,
   * the same id that decides who may open the report — so the three are switched on separately.
   * Below-30% is `low-collections`; the title says "Below N%" because the threshold is tunable,
   * but the catalogue entry is the one fixed thing about it.
   */
  const reportKey = isDormantMode ? "dormant-debtors" : mode === "zero" ? "zero-collections" : "low-collections";

  const title = isDormantMode
    ? "Customers with Dues but No Sales"
    : mode === "zero"
      ? "Customers with Zero Collections"
      : `Customers Below ${threshold}% Collection`;
  const subtitle = isDormantMode
    ? "Customers who owe money and have billed nothing in the period. Dormant accounts with cash stuck in them."
    : mode === "zero"
      ? "Customers who owe money and paid nothing in the period."
      : `Customers who collected less than ${threshold}% of what we could have collected from them.`;

  const {
    loading, allCustomers, consolidatedCustomers, customerDetail, customerGroupMap,
    dashboard, salesPersonOptions,
  } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";

  // Which backend the engine is reading. Declared HERE, above the period controls, because the
  // custom date range is Live-only and the period block below has to know.
  const collSource = useReceivablesSource() === "connectwave" ? "live" : "pipeline";
  const isLive = collSource === "live";

  // The org-wide month list, chronological — the vocabulary every period control speaks.
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);

  /** Where the data itself begins. "Never sold" can only ever mean "not since here" — read it
   *  from the month vocabulary, never hardcode it: it moves when the FY selection does. */
  const horizonLabel = months[0] ?? "—";

  // ── Period ────────────────────────────────────────────────────────────────────────
  // The collection reports open on the LAST 15 DAYS: chasing cash is a fortnightly rhythm, and a
  // customer who has paid nothing for a fortnight is the one worth a call today.
  //
  // Dormant deliberately does NOT follow. Its predicate is "billed nothing in the window", and
  // over 15 days that is nearly every customer on the books — the report would list everyone and
  // mean nothing. Six months stands: one quiet quarter is a lull, two is a dead account.
  const defaultPreset: PeriodPreset = isDormantMode ? "6m" : "15d";
  const [preset, setPreset] = useState<PeriodPreset>(defaultPreset);
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  /** Where the data itself begins, as a date — the floor for both pickers and the prior window. */
  const horizonIso = useMemo(() => (months.length ? monthStartISO(months[0]) : ""), [months]);

  // Seed the custom pickers from the active preset the first time months arrive, so switching to
  // Custom starts from what the user was already looking at. ISO DATES, not month labels.
  useEffect(() => {
    if (!months.length || customFrom) return;
    const days = DATE_RANGE_PRESETS[defaultPreset as keyof typeof DATE_RANGE_PRESETS];
    const seed = days && asOfDate ? lastNDays(asOfDate, days, horizonIso) : null;
    if (seed) { setCustomFrom(seed.fromIso); setCustomTo(seed.toIso); return; }
    const w = resolveWindow(months, defaultPreset);
    setCustomFrom(monthStartISO(w[0] ?? months[0]));
    setCustomTo(monthEndISO(w[w.length - 1] ?? months[months.length - 1]));
  }, [months, customFrom, defaultPreset, asOfDate, horizonIso]);
  /** Nothing later than the as-of date is knowable, so neither picker may go past it. */
  const maxIso = asOfDate || (months.length ? monthEndISO(months[months.length - 1]) : "");
  /**
   * How far the opening-balance wind-back must reach: the END OF THE AS-OF MONTH, not the as-of
   * date. Opening = canonical outstanding − movement since From, and that outstanding reflects
   * every voucher in the mirror — including the rest of the current month, which the monthly
   * series also carries (its buckets are whole months). Stopping at the as-of date would leave
   * that movement out and make Opening disagree with the presets. See collectionsRange.
   */
  const horizonEndIso = useMemo(
    () => (months.length ? monthEndISO(months[months.length - 1]) : ""),
    [months],
  );

  /**
   * The date range in force, or null when the period is measured in whole months.
   *
   * "Last 15 Days" and "Custom" are the same machine: both resolve to real dates and are answered
   * by the day-level engine. The only difference is where the dates come from — counted back from
   * the as-of date, or typed by the user.
   */
  const dateRange = useMemo<{ fromIso: string; toIso: string } | null>(() => {
    const days = DATE_RANGE_PRESETS[preset as keyof typeof DATE_RANGE_PRESETS];
    if (days) return asOfDate ? lastNDays(asOfDate, days, horizonIso) : null;
    if (preset === "custom")
      return customFrom && customTo && customFrom <= customTo ? { fromIso: customFrom, toIso: customTo } : null;
    return null;
  }, [preset, asOfDate, horizonIso, customFrom, customTo]);

  /** Custom is selected but the two dates don't make a range — the only user-fixable error here. */
  const customInvalid = preset === "custom" && !dateRange;

  /**
   * The months the window touches. For the month presets this IS the window. For a date range it
   * is NOT — the money comes from the day-level engine — but it is still what the month-grain
   * figures (last sale month / months since sale) are measured against, and what the caption
   * falls back to when the day-level engine can't run.
   */
  const windowMonths = useMemo(() => {
    if (isDateRangePreset(preset)) {
      return dateRange
        ? monthRange(months, isoToMonthLabel(dateRange.fromIso), isoToMonthLabel(dateRange.toIso))
        : [];
    }
    return resolveWindow(months, preset);
  }, [months, preset, dateRange]);

  const prevMonths = useMemo(() => priorWindow(months, windowMonths), [months, windowMonths]);

  /** The range's prior period: the same number of DAYS immediately before it, or null when that
   *  would reach back before the data horizon. */
  const prevRange = useMemo(
    () => (dateRange && horizonIso ? priorRange(dateRange.fromIso, dateRange.toIso, horizonIso) : null),
    [dateRange, horizonIso],
  );

  /**
   * Day-level facts for the active date range. ONE query per range, ~1-2.5s end to end, cached
   * for five minutes. Since "Last 15 Days" is the default period it now runs on the first load of
   * this report; the month presets still issue nothing. Live (Tally) only — the pipeline source
   * has no bulk day-level table and stays on whole months.
   */
  const rangeQuery = useQuery({
    queryKey: ["collectionRange", dateRange?.fromIso ?? null, dateRange?.toIso ?? null, prevRange?.fromIso ?? null, horizonEndIso],
    queryFn: () => fetchRangeFacts(dateRange!.fromIso, dateRange!.toIso, prevRange?.fromIso ?? null, horizonEndIso),
    enabled: isLive && !!dateRange && !!horizonEndIso,
    staleTime: 5 * 60_000,
  });
  /** True once the day-level engine is actually driving the numbers. Until then (loading, or a
   *  failed/undeployed RPC) the report stays on the month path rather than showing nothing. */
  const usingDateRange = isLive && !!dateRange && !!rangeQuery.data;

  /** Trap 3: the data is FY-scoped, so a "This FY" window simply has no prior period. */
  const hasPrior = usingDateRange ? prevRange !== null : prevMonths.length > 0;

  // On a date range the caption states the REAL dates. It falls back to whole months while the
  // day-level query is in flight (or on the pipeline source), so the caption never claims a
  // precision the numbers underneath it don't have.
  const periodRange = usingDateRange && dateRange
    ? `${formatDateDMY(dateRange.fromIso)} → ${formatDateDMY(dateRange.toIso)}`
    : windowMonths.length
      ? `${monthStartLong(windowMonths[0])} → ${
          windowMonths[windowMonths.length - 1] === months[months.length - 1]
            ? formatDateDMY(asOfDate)
            : monthEndLong(windowMonths[windowMonths.length - 1])
        }`
      : "—";
  const periodLabel = `${PERIOD_LABELS[preset]} (${periodRange})`;

  /**
   * The prior period, spelled out — "" when there isn't one.
   *
   * Must be read through this, never off prevMonths[0] directly: on a custom date range the prior
   * period is a run of DAYS, and prevMonths can legitimately be empty while a prior period exists
   * (a range starting inside the first month has no earlier whole month, but does have earlier
   * days). monthStartLong(undefined) is the bug this prevents.
   */
  const priorLabel = usingDateRange
    ? (prevRange ? `${formatDateDMY(prevRange.fromIso)} → ${formatDateDMY(prevRange.toIso)}` : "")
    : prevMonths.length
      ? `${monthStartLong(prevMonths[0])} → ${monthEndLong(prevMonths[prevMonths.length - 1])}`
      : "";

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
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>(() => [...DEFAULT_CATEGORIES]);
  /**
   * Scopes the report to customers whose outstanding is DOMINATED by one of the selected sale
   * types — see dominantSaleTypeOf. Present on ALL three reports (zero / threshold / dormant);
   * Machine is off by default everywhere — see DEFAULT_SALE_TYPES.
   */
  const [saleTypes, setSaleTypes] = useState<string[]>(() => [...DEFAULT_SALE_TYPES]);
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
  /** The REAL groups from the mapping sheet. Also decides customer-vs-group drill-through:
   *  a "group" bucket that isn't in here is just an ungrouped customer shown as its own row. */
  const realGroupNames = useMemo(
    () => allGroupNames(customerGroupMap),
    [customerGroupMap],
  );

  // ── View ──────────────────────────────────────────────────────────────────────────
  // Which view each report opens on — and WHY the middle level differs between them — lives in
  // `defaultGroupByFor`, beside the View presets it has to stay in step with. A flat customer
  // list is still one click away in the View row.
  const [groupBy, setGroupBy] = useState<ZCDim[]>(() => defaultGroupByFor(mode));
  const viewLabel = useMemo(
    () => groupBy.map((d) => ZC_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → "),
    [groupBy],
  );

  // ── Columns + sort ────────────────────────────────────────────────────────────────
  // The two reports want different defaults: at threshold 0 every percentage column reads
  // 0% / "—" and only wastes width. Switching threshold therefore re-seeds both.
  //
  // WHICH columns the picker offers is also per report — Zero Collections is a call-list and
  // closes its picker to the twelve columns that report is about. See pickerColumnsFor.
  const pickerCols = useMemo(() => pickerColumnsFor(mode), [mode]);
  const columnOptions: ColumnOption[] = useMemo(
    () => pickerCols.map((c) => ({ key: c.key, label: c.label, help: c.help })),
    [pickerCols],
  );
  const pickerKeys = useMemo(() => pickerCols.map((c) => c.key), [pickerCols]);

  // This user's own saved layout for THIS report, if they have ever saved one. Read from
  // profiles.receivables_report_prefs, so it follows them to any browser. Fails soft: while it
  // loads, and forever if the column isn't there, the report just uses its shipped default.
  const prefReportId =
    mode === "dormant" ? REPORT_PREF_IDS.collectionsDormant
    : mode === "zero"  ? REPORT_PREF_IDS.collectionsZero
    : REPORT_PREF_IDS.collectionsThreshold;
  const colPrefs = useReportColumnPrefs(prefReportId, pickerKeys);

  const [visibleCols, setVisibleCols] = useState<string[]>(() => defaultColumnsFor(mode));
  const columns = useMemo<ZCColumn[]>(
    () => pickerCols.filter((c) => visibleCols.includes(c.key)),
    [pickerCols, visibleCols],
  );
  const colByKey = useMemo(() => new Map(ZC_COLUMNS.map((c) => [c.key, c])), []);

  /**
   * Apply the saved layout once it arrives, and again whenever the report changes underneath us
   * (?below=0 ⇄ ?below=30 don't remount — see the re-seed effect below).
   *
   * `appliedPrefFor` makes this a ONE-SHOT per report: without it, every hand-toggle of a column
   * would be overwritten on the next render by the saved set, and the picker would be unusable.
   */
  const appliedPrefFor = useRef<string | null>(null);
  useEffect(() => {
    if (colPrefs.loading) return;
    if (appliedPrefFor.current === prefReportId) return;
    appliedPrefFor.current = prefReportId;
    setVisibleCols(colPrefs.saved ?? defaultColumnsFor(mode));
  }, [colPrefs.loading, colPrefs.saved, prefReportId, mode]);

  type SortKey = ZCColumnKey | "label";
  /** Dormant and zero rank by the money at stake; threshold ranks by the shortfall it defines. */
  const defaultSortFor = (m: CollectionsMode): SortKey =>
    m === "threshold" ? "shortfall" : "outstanding";
  const [sortKey, setSortKey] = useState<SortKey>(() => defaultSortFor(mode));
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Re-seed the view and the sort whenever the report changes underneath us.
  // `?below=0` and `?below=30` are the SAME route, so switching threshold does not remount this
  // component and the useState initialisers above never run a second time — without this effect
  // the Zero report would keep whatever grouping the Below-N% report was left on. The cost is
  // that switching threshold also discards a hand-picked grouping, exactly as it already
  // discards hand-picked columns.
  //
  // The COLUMNS are re-seeded by the saved-layout effect above instead, not here: each report
  // has its own saved layout, and re-seeding in two places would race (both effects flush
  // together, and the loser wins).
  useEffect(() => {
    setGroupBy(defaultGroupByFor(mode));
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
  // The report definition (threshold / period / journal) and the filters+view are BOTH collapsed
  // by default: the KPI cards and the table must be visible on first load, not below a wall of
  // controls. Each collapsed header carries a summary of what's currently applied.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
  // (collSource / isLive are declared above the period controls — the custom date range needs them.)
  const series = useMemo(
    () => buildMonthlySeries(allCustomers, customerDetail, collSource),
    [allCustomers, customerDetail, collSource],
  );
  const lastDates = useMemo(
    () => buildLastReceiptDates(allCustomers, customerDetail, collSource),
    [allCustomers, customerDetail, collSource],
  );
  // Exact ₹ of each ledger's last receipt voucher, twinned with lastDates. Both sources carry it:
  // the pipeline sums its own same-day receipt vouchers, Live reads the snapshot column that
  // collection_refresh fills. Null only means "not known", never "belongs to another voucher".
  const lastAmounts = useMemo(
    () => buildLastReceiptAmounts(allCustomers, customerDetail, collSource),
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

  /**
   * Customers eligible for the report at all: they owe us money (the KPI denominator) — with
   * every filter applied EXCEPT sale type.
   *
   * Sale type is held back one step so the overdue-by-type cards can be built over the whole
   * book. If the sale-type filter ran here, the Machine card would read ₹0 the moment Machine
   * is deselected (which is the default), and clicking any card would delete the other four.
   * The cards have to be a stable, complete strip you can click between — so they are measured
   * before the filter and the filter is applied after. See `rows`.
   */
  const eligibleAllTypes = useMemo(() => {
    let d = consolidatedCustomers.filter((c) => matchesCategory(c, categories));
    if (companies.length)    { const s = new Set(companies);    d = d.filter((c) => (c.companies ?? [c.company]).some((x) => s.has(x))); }
    if (locations.length)    { const s = new Set(locations);    d = d.filter((c) => (c.locations ?? [c.location]).some((x) => s.has(x))); }
    if (salespersons.length) { const s = new Set(salespersons); d = d.filter((c) => (c.salesPersons?.length ? c.salesPersons : [c.salesPerson]).some((x) => s.has(x))); }
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
    consolidatedCustomers, categories, companies, locations, salespersons,
    segment, blockedOnly, includeNonDebtors, minOut, search, groupOf,
  ]);

  /**
   * Scope by the customer's DOMINANT sale type. Active only on a PROPER subset: empty and full
   * both mean "no filter", the same convention SaleTypeMultiSelect labels ("All Sale Types") and
   * every other multi-select in the app uses. Default excludes Machine (see DEFAULT_SALE_TYPES).
   */
  const inSaleTypeScope = useCallback(
    (c: ConsolidatedCustomer) => {
      if (saleTypes.length === 0 || saleTypes.length === SALE_TYPES.length) return true;
      return saleTypes.includes(dominantSaleTypeOf(c, outstandingByType));
    },
    [saleTypes, outstandingByType],
  );

  /** The KPI denominator — eligible AND inside the sale-type scope, as it has always been. */
  const eligible = useMemo(
    () => eligibleAllTypes.filter(inSaleTypeScope),
    [eligibleAllTypes, inSaleTypeScope],
  );

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
  const { allTypeRows, allTypeNoPool } = useMemo(() => {
    if (!windowMonths.length) return { allTypeRows: [] as ZCRow[], allTypeNoPool: [] as ConsolidatedCustomer[] };
    const range = usingDateRange ? rangeQuery.data! : null;
    const out: ZCRow[] = [];
    const dropped: ConsolidatedCustomer[] = [];
    for (const c of eligibleAllTypes) {
      // factsForRange is factsFor's twin — same arithmetic, day-level sources. See its header.
      const facts = range
        ? factsForRange(c, range, series, lastDates, balances, months, windowMonths, prevRange !== null, asOfDate, null, countJournalSettlements, lastAmounts)
        : factsFor(c, series, lastDates, balances, months, windowMonths, prevMonths, asOfDate, countJournalSettlements, lastAmounts);
      const listed =
        mode === "dormant" ? isDormant(facts)
        : mode === "zero"  ? isZeroCollection(facts)
        : isBelowThreshold(facts, threshold);
      if (listed) out.push({ customer: c, facts, group: groupOf(c) });
      else if (mode === "threshold" && facts.collectible < COLLECTIBLE_EPS) dropped.push(c);
    }
    return { allTypeRows: out, allTypeNoPool: dropped };
  }, [eligibleAllTypes, series, lastDates, lastAmounts, balances, months, windowMonths, prevMonths, asOfDate, groupOf, mode, threshold, countJournalSettlements, usingDateRange, rangeQuery.data, prevRange]);

  /** The report as filtered — sale type applied last, so the type cards above stay complete. */
  const rows = useMemo(
    () => allTypeRows.filter((r) => inSaleTypeScope(r.customer)),
    [allTypeRows, inSaleTypeScope],
  );
  const noPool = useMemo(
    () => allTypeNoPool.filter(inSaleTypeScope).length,
    [allTypeNoPool, inSaleTypeScope],
  );

  /** Overdue split by sale type, over the LISTED customers before the sale-type filter.
   *  Zero Collections only — the other two reports don't show the strip. */
  const typeOverdue = useMemo(
    () => overdueBySaleType(mode === "zero" ? allTypeRows : [], outstandingByType),
    [mode, allTypeRows, outstandingByType],
  );

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
  }, [groupBy, search, salespersons, companies, locations, categories, saleTypes, minOut, segment, blockedOnly, includeNonDebtors, preset, customFrom, customTo, focus, bands, threshold]);

  // Switching report (zero ⇄ threshold) must not strand a lens or band that no longer applies.
  useEffect(() => { setFocus(new Set()); setBands(new Set()); }, [mode]);

  // ...nor strand the PERIOD. The collection reports open on 15 days and Dormant on 6 months, and
  // those are not interchangeable: carrying 15 days into Dormant asks "who hasn't bought this
  // fortnight", which is nearly the whole ledger. Each report returns to its own default.
  useEffect(() => { setPreset(defaultPreset); }, [defaultPreset]);

  // ── Roll-up ───────────────────────────────────────────────────────────────────────
  // Built from the FOCUSED rows, so the table, its grand total, pagination and the export
  // all follow the active lenses. The KPI cards deliberately do NOT — see `allTotals`.
  const metricsOf = useMemo(() => makeMetricsOf(target), [target]);

  /** The roll-up configuration, lifted out of `tree` so the EXPORT can build the same tree at a
   *  different grain. The workbook is always Salesperson → Customer whatever the screen shows,
   *  and re-deriving these callbacks there would be two definitions of "what is a sale type". */
  const treeOpts = useMemo(
    () => ({
      // "Sale Type" is resolved here, not in the shared zcDimValue: the classifier needs the
      // ledger-scoped outstandingByType map (zcDimValue is also used by Overdue Aging, which
      // has no such map). Same dominantSaleTypeOf as the filter ⇒ groups and filter agree.
      dimValue: (r: ZCRow, dim: string) => {
        if (dim === "saleType") {
          const st = dominantSaleTypeOf(r.customer, outstandingByType);
          return { value: st, label: saleTypeLabel(st) };
        }
        return zcDimValue(r, dim);
      },
      idOf: (r: ZCRow) => r.customer.id,
      metricsOf,
      empty: emptyMetrics,
      add: addMetrics,
    }),
    [metricsOf, outstandingByType],
  );

  const tree = useMemo(
    () => buildGroupTree<ZCRow, ZCMetrics>(focusedRows, groupBy, treeOpts),
    [focusedRows, groupBy, treeOpts],
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
  /**
   * The KPI numbers for an arbitrary row set.
   *
   * A FUNCTION rather than a memo body, because the per-salesperson PDF has to state that
   * salesperson's position, not the company's. Handing a rep a file whose cards read "219
   * customers, ₹21.06 Cr" above a table of their own 59 is not a scoped report, it is a
   * mislabelled one. The screen still calls this once with the full row set (`allKpis`).
   */
  const computeKpis = useCallback((src: ZCRow[], pool: ConsolidatedCustomer[]) => {
    const t = totalsOf(src, target);
    const eligibleOutstanding = sumOutstanding(pool);
    const neverPaidOutstanding = src
      .filter((r) => r.facts.lastReceiptDate === null)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    // The dormant report's damning subset: stopped buying AND stopped paying. The money on
    // these is what "dead and stuck" actually costs.
    const paidNothingOutstanding = src
      .filter((r) => r.facts.collected < ZERO_EPS)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    const wentQuietOutstanding = src
      .filter((r) => r.facts.salesInPrior > 0.5 && r.facts.salesInWindow <= 0.5)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    const neverSoldOutstanding = src
      .filter((r) => r.facts.lastSaleMonth === null)
      .reduce((s, r) => s + r.customer.outstanding, 0);
    return {
      count: src.length,
      eligibleCount: pool.length,
      outstanding: t.outstanding,
      sharePct: eligibleOutstanding > 0 ? (t.outstanding / eligibleOutstanding) * 100 : 0,
      overdue: t.overdue,
      // The bridge behind it, so the card can say the figure is net rather than leave the reader
      // to discover it in the drill-down.
      overdueGross: t.overdueGross,
      onAccount: t.onAccount,
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
  }, [target]);

  /** The screen's numbers: every row in the report, before any lens. See the note above. */
  const allKpis = useMemo(() => computeKpis(rows, eligible), [computeKpis, rows, eligible]);

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

  /**
   * The mode's cards, for a given set of KPI numbers.
   *
   * ⚠ THE PARAMETER IS NAMED `kpis` ON PURPOSE. It shadows the outer `allKpis`-fed binding these
   *   card definitions used to read, so ~400 lines of card copy needed no edit to become
   *   scope-aware, and there is exactly ONE definition of each card rather than a screen version
   *   and a drifting PDF version. Call it with `allKpis` for the screen, or with a salesperson's
   *   own numbers for their extract.
   */
  const cardsFor = (kpis: ReturnType<typeof computeKpis>): KpiCard[] => {
  const zeroCards: KpiCard[] = [
    {
      label: "Zero-Collection Customers", icon: UserX, focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
      explain: (
        <>
          Customers who owe you money and paid <strong>nothing at all</strong> in this period:
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
          The total these zero-collection customers owe you is <strong>{money(kpis.outstanding)}</strong>.
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
      sub: kpis.onAccount > 0.5
        ? `past due date · less On Account ${fmtINRMoney(kpis.onAccount)}`
        : "already past due date",
      count: kpis.overdue,
      explain: (
        <>
          How much of that money is <strong>already past its due date</strong>. You had a
          contractual right to it and it still hasn’t come.
          <br />
          <br />
          The rest of the Outstanding is still inside its credit period.
          {kpis.onAccount > 0.5 && (
            <>
              <br />
              <br />
              <strong>This figure is net.</strong> The bills themselves come to{" "}
              {money(kpis.overdueGross)}, but {money(kpis.onAccount)} of that has already been paid
              as <strong>On Account</strong>: advances, credit notes and receipts that settle no
              specific bill, so they cannot be knocked off any one invoice.{" "}
              {money(kpis.overdueGross)} − {money(kpis.onAccount)} = {money(kpis.overdue)}.
            </>
          )}
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
          Of those, how many have <strong>never made a single payment</strong>: not one receipt
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
          This is the card that gets a decision made, and it’s a <strong>credit</strong> decision, not
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
          Money on bills more than <strong>180 days past due</strong>: the oldest and hardest to
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
          This is <strong>weighted</strong>: total collected ÷ total collectible, not the average
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
          The total these under-payers owe you is <strong>{money(kpis.outstanding)}</strong>, which is{" "}
          <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in scope.
          <br />
          <br />
          This is the “how bad is it really” card. A high share means the problem isn’t a long tail
          of small defaulters; it’s sitting where most of your money already is.
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
          The most actionable card here. It’s a <strong>credit</strong> decision, not a collections
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
        : "This fiscal year has no earlier months to compare against. Pick a shorter period.",
      explain: hasPrior ? (
        <>
          These customers <strong>used to pay better</strong>. Their collection % fell by more than{" "}
          {DETERIORATION_PP} percentage points versus the previous period of the same length
          ({priorLabel}).
          <br />
          <br />
          Something changed <strong>recently</strong>, so it is worth a call before it hardens. This is what
          separates a customer who just went quiet from a chronic non-payer.
        </>
      ) : (
        <>
          Compares each customer’s collection % against the previous period of the same length.
          <br />
          <br />
          <strong>Unavailable here:</strong> this fiscal year has no earlier months to compare
          against, so Prior % and Δ read as a dash. Pick a shorter period to enable it.
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
          look like they had paid and would <strong>never appear on this report at all</strong>,
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
          Not a single payment <strong>ever</strong>: no receipt since the data begins
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
          period. You are no longer selling to them, but they are still holding your cash.
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
          The total these dormant customers owe you is <strong>{money(kpis.outstanding)}</strong>,
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
          The rest is still inside its credit period, so a customer can have stopped buying and
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
          balance; these have stopped buying <em>and</em> stopped paying. Nothing is coming back
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
        : "This period has no earlier months to compare against. Pick a shorter period.",
      explain: hasPrior ? (
        <>
          They were buying in the <strong>previous</strong> period of the same length ({priorLabel})
          and have billed nothing since. They hold <strong>{money(kpis.wentQuietOutstanding)}</strong>.
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
          This does <strong>not</strong> mean they never bought from you, only that they haven’t
          since the data starts. The balance is a leftover from an older relationship, and it is
          the oldest, hardest money on this report.
        </>
      ),
    },
  ];

    return isDormantMode ? dormantCards : mode === "zero" ? zeroCards : thresholdCards;
  };

  const kpiCards = cardsFor(allKpis);

  /** A screen card, projected to the plain data the PDF renderer understands. */
  const toPdfKpi = (c: KpiCard) => ({
    label: c.label,
    value: c.value,
    sub: c.sub,
    // The card's own alarm styling isn't a field — a card is "bad news" when it is a lens onto a
    // problem subset rather than a summary of the whole list.
    alarm: c.focusKey !== null,
    // The lens key, carried so the PDF can give a card its own appendix page WITHOUT matching on
    // the printed label. `never` and `over180` get one; the rest are carried and ignored.
    key: c.focusKey ?? undefined,
  });
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
    salespersons.length > 0 && { label: `Salesperson: ${salespersons.length} sel.`, onRemove: () => setSalespersons([]) },
    companies.length > 0 && { label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) },
    locations.length > 0 && { label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) },
    categories.length > 0 && { label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) },
    // Shown on ALL reports. By default it reflects the Machine exclusion; removing the chip opens
    // the report to every sale type (Machine back in).
    saleTypes.length > 0 && saleTypes.length < SALE_TYPES.length && {
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
    setSearch("");
    setSalespersons([]); setCompanies([]); setLocations([]);
    setCategories([...DEFAULT_CATEGORIES]); setMinOut("0"); setSegment("all");
    setBlockedOnly(false); setIncludeNonDebtors(false);
    // "Clear filters" resets to the report's DEFAULT sale-type scope (Machine excluded), NOT to a
    // truly-empty set. Re-adding Machine on a cleared call-list would quietly reintroduce
    // business-as-usual capital sales the user deliberately keeps out — see DEFAULT_SALE_TYPES.
    setSaleTypes([...DEFAULT_SALE_TYPES]);
    setFocus(new Set()); setBands(new Set());
  };

  const filterSummary = useMemo(() => {
    const s: string[] = [];
    // Lenses first — they're the most drastic cut, and the exported sheet has to record
    // them or it's unauditable a week later.
    for (const f of focus) s.push(`Focus: ${ZC_FOCUS_LABELS[f]}`);
    for (const b of bands) s.push(`Band: ${BAND_LABELS[b]}`);
    if (search.trim()) s.push(`Search: ${search.trim()}`);
    if (salespersons.length) s.push(`Salesperson: ${salespersons.join(", ")}`);
    if (companies.length) s.push(`Company: ${companies.join(", ")}`);
    if (locations.length) s.push(`Location: ${locations.join(", ")}`);
    if (categories.length) s.push(`Category: ${categories.join(", ")}`);
    // Always record the sale-type scope, INCLUDING the default — every report now excludes Machine
    // by default, so the sheet has to say so or the totals are unexplainable a week later.
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
  }, [focus, bands, search, salespersons, companies, locations, categories, minOut, segment, blockedOnly, includeNonDebtors, saleTypes]);


  // ── Export — WYSIWYG: same period, threshold, filters, FOCUS, view, sort, columns ──
  // Built from `focusedRows` (not `rows`), so the files follow the active KPI lenses exactly as
  // the table does. A mismatch between the two is the kind of thing you only discover in Excel.
  //
  // Assembled lazily by the menu rather than memoised here: it is only needed at the moment
  // somebody clicks Export, and building it eagerly would walk every row on each re-render of a
  // page that already re-derives a lot per keystroke.
  /**
   * Handing the book to somebody else is a Reports FULL-ACCESS action.
   *
   * The data itself is already safe either way — `useReceivablesScope` filters at the useAppData
   * chokepoint, so a tagged rep's picker can only ever list their own names. The gate is about
   * the ACTION rather than the data: splitting the book into per-person files, and mailing those
   * files out, are both sales-management jobs. One permission covers both, and
   * `queue_report_email` re-checks it server-side so it is an access control rather than a hidden
   * button.
   */
  const { hasFullAccess } = useHubMenuAccess();
  const canDistribute = hasFullAccess("reports");

  const exportContext = useCallback(
    (): CollectionsExportContext => ({
      meta: {
        title,
        // The same sentence shown under the title on screen — one source, so they can't drift.
        description: subtitle,
        viewLabel,
        // The workbook forces Salesperson → Customer; these are overwritten there. Kept so the
        // meta object still describes the screen it came from.
        dims: groupBy.map((d) => ({ key: d, label: ZC_DIMENSIONS.find((x) => x.key === d)?.label ?? d })),
        periodLabel,
        asOfDate,
      },
      columns,
      kpis: kpiCards.map(toPdfKpi),
      // Rebuilt per salesperson from the SAME card definitions, so a rep's extract states the
      // rep's position. Their eligible pool is scoped too, or the "of N who owe money"
      // denominator would still be the company's.
      kpisFor: (subset: ZCRow[], salesperson: string) =>
        cardsFor(
          computeKpis(subset, eligible.filter((c) => salespersonNamesOf(c).includes(salesperson))),
        ).map(toPdfKpi),
      // The cards are measured over every row in the report; the table follows the lens. Say so
      // on the page when the two can disagree, since a PDF has no tooltip to explain it.
      kpiScopeNote: focus.size
        ? `Cards describe all ${rows.length} customers in this report. The table below is narrowed to the active lens (${[...focus].map((f) => ZC_FOCUS_LABELS[f]).join(" + ")}), so its totals are smaller.`
        : undefined,
      filterSummary,
      rows: focusedRows,
      customerDetail,
      treeOpts,
    }),
    // `kpisFor` closes over cardsFor/computeKpis/eligible, so everything those read has to be
    // listed or a rep's extract could be built from a previous mode's card set.
    [title, subtitle, viewLabel, groupBy, periodLabel, asOfDate, columns, kpiCards, focus, rows.length, filterSummary, focusedRows, customerDetail, treeOpts,
     eligible, computeKpis, mode, isDormantMode, threshold, target],
  );

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
  const [drill, setDrill] = useState<{
    open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[];
    ledgerFigures?: Record<string, number>;
  }>({ open: false, title: "", subtitle: "", rows: [] });

  const rowsById = useMemo(() => {
    const m = new Map<string, ZCRow>();
    for (const r of rows) m.set(r.customer.id, r);
    return m;
  }, [rows]);

  /**
   * Open the bill-level popup behind a clicked figure — and make it RECONCILE.
   *
   * The bills are gross; the report's Overdue and Outstanding are net of On Account (money the
   * customer has paid that settles no open invoice). Listing the bills alone therefore shows a
   * bigger number than the row that was clicked, with nothing on screen to explain it — which is
   * exactly how this looked before. Two things close it:
   *
   *  - `ledgerFigures` hands the popup the report's own net figure per ledger, so it can strike a
   *    balancing line and make every subtotal tie back.
   *  - for the OVERDUE drill we also emit the On Account explicitly, as an `isOnAccount` row. That
   *    is what earns the popup's full bridge — "Invoice total (N invoices)" → the credit →
   *    "Net after on account" — instead of one unlabelled adjustment.
   *
   * Only Overdue gets the explicit credit line, because `Customer.onAccount` is defined as the
   * credit netted off GROSS OVERDUE and capped there. Outstanding is already a net ledger balance
   * (deducting again would double-count) and the >180 bucket is bill-based with no per-bucket
   * allocation, so both are left to the generic reconciliation.
   */
  const openDrill = (node: GroupNode<ZCMetrics> | null, col: ZCColumn) => {
    if (!col.drill) return;
    const ids = node ? node.ids : tree.totalIds;
    // Shared with the Excel export's "Overdue Bill Details" sheet — see buildDrillRows.
    const { rows: drillRows, ledgerFigures } = buildDrillRows(ids, rowsById, customerDetail, col.drill);
    // `rows` carries the On Account credits too, so test for a real BILL before opening.
    if (!drillRows.some((r) => !r.isOnAccount)) return;
    setDrill({
      open: true,
      title: `${col.label}: open bills`,
      subtitle: node ? (node.sub ? `${node.label} · ${node.sub}` : node.label) : "All rows",
      rows: drillRows,
      ledgerFigures,
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
    // The HEADER ROW is frozen unconditionally (see HEADER_STICKY) — the pin only ever governs
    // the name COLUMN, so a header cell stays sticky-to-top even when the pin is off.
    if (freezeLevel < 1) return { className: opts?.header ? HEADER_STICKY : "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    // z-30 on the frozen header cells: they sit at the intersection of the frozen row and the
    // frozen column, so they must outrank both the plain header cells (z-20) and the frozen
    // body cells (z-10) they cross. Shadows are written out as whole literal class names —
    // Tailwind scans the source text, so a composed string would never be generated.
    const stick = opts?.header
      ? (id === "label"
          ? "sticky top-0 z-30 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18),inset_0_-1px_0_hsl(var(--border))]"
          : "sticky top-0 z-30 shadow-[inset_0_-1px_0_hsl(var(--border))]")
      : (id === "label"
          ? "sticky z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]"
          : "sticky z-10");
    return {
      className: `${stick} ${bg}`,
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
      // Leaf-only columns (last receipt date/amount) can't be summed — blank on any roll-up
      // row and the grand total, exactly what the "Last Sale Month" precedent does in Excel.
      const isLeaf = !!node && node.children.length === 0;
      const suppressed = !!col.leafOnly && (isTotal || !isLeaf);
      const v = suppressed ? null : col.value(m);
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
        : col.kind === "date" ? dateText(v)
        : col.kind === "months" ? monthsText(v)
        : col.kind === "pct"
          ? (col.key === "deltaPp" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : `${v.toFixed(1)}%`)
          : String(v);

      // The second line under the figure (today: "less On Account" under Overdue). Printed on
      // every row that carries one, grand total included — the netting happens at every level,
      // so hiding it on the roll-ups would leave the total looking unexplained.
      const note = suppressed ? null : col.note?.(m) ?? null;

      return (
        <TableCell
          key={col.key}
          onClick={clickable ? (e) => { e.stopPropagation(); openDrill(node, col); } : undefined}
          title={clickable ? "Click to see the open bills" : undefined}
          className={`text-right font-mono whitespace-nowrap ${isTotal ? "text-sm" : "text-[13px]"} ${alarm ? "text-destructive" : ""} ${clickable ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
        >
          {text}
          {note && (
            <span className="block text-[10px] font-normal leading-tight text-muted-foreground whitespace-nowrap">
              {note}
            </span>
          )}
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
      {/* Header — deliberately spare: an icon chip, the title, one line of description, and the
          as-of date as a quiet pill. The numbers live in the KPI cards right below, so the header
          doesn't repeat them. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-primary/10 text-primary shrink-0">
              <UserX className="h-5 w-5" />
            </span>
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{subtitle}</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
          {asOfDate && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted rounded-pill px-2.5 py-1">
              <CalendarClock className="h-3 w-3" /> As on {formatDateDMY(asOfDate)}
            </span>
          )}
          <div className="flex items-center gap-2">
            {/* "Save my view" writes the layout to the user's profile, so the report opens on
                it next time — on any browser. See lib/reportPrefs.ts. */}
            <ColumnPicker
              columns={columnOptions}
              visible={visibleCols}
              onChange={setVisibleCols}
              onSave={colPrefs.save}
              onResetSaved={async () => {
                await colPrefs.clear();
                setVisibleCols(defaultColumnsFor(mode));
              }}
              hasSaved={colPrefs.saved !== null}
              saving={colPrefs.saving}
              saveError={colPrefs.error}
            />
            <ExportMenu
              getContext={exportContext}
              rowCount={focusedRows.length}
              canDistribute={canDistribute}
              reportKey={reportKey}
            />
          </div>
        </div>
      </div>

      {/* Report definition (threshold / period / journal). Collapsed by default; the summary
          on the header keeps the current scope visible without opening it. */}
      <Card className="rounded-card border-border bg-surface">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-card"
        >
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground shrink-0">Report settings</span>
          <span className="text-[11px] text-muted-foreground truncate min-w-0">
            {[
              !isDormantMode && `Collected below ${threshold}%`,
              PERIOD_LABELS[preset],
              !isDormantMode && (countJournalSettlements ? "Journals count as paid" : "Journals ignored"),
            ].filter(Boolean).join(" · ")}
          </span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
        </button>
        {settingsOpen && (
        <CardContent className="p-4 pt-0 space-y-3">
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
              {(["15d", "1m", "3m", "6m", "fy", "all", "custom"] as PeriodPreset[]).map((p) => (
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
                // Real dates, not month labels. Bounded by the data horizon and the as-of date so
                // the pickers can never disagree with the FY selector or ask for a future that
                // isn't in the mirror yet.
                <div className="flex items-center gap-1">
                  <Input
                    type="date" value={customFrom} min={horizonIso} max={maxIso}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-7 w-36 rounded-input border-border text-xs"
                  />
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input
                    type="date" value={customTo} min={horizonIso} max={maxIso}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-7 w-36 rounded-input border-border text-xs"
                  />
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {periodRange}
            {!usingDateRange && windowMonths.length > 0 && windowMonths[windowMonths.length - 1] === months[months.length - 1] && (
              <span className="opacity-70"> · the current month is still in progress</span>
            )}
            {/* Say plainly which engine is behind the numbers. A custom range counts to the day;
                everything else counts whole months. */}
            {isDateRangePreset(preset) && dateRange && (
              usingDateRange ? (
                <span className="opacity-70"> · counted to the day</span>
              ) : rangeQuery.isFetching ? (
                <span className="opacity-70"> · counting to the day…</span>
              ) : isLive ? (
                <span className="text-destructive"> · day-level figures unavailable, showing whole months ({windowMonths.join(", ")})</span>
              ) : (
                <span className="opacity-70"> · this source counts whole months ({windowMonths.join(", ")}), not exact dates</span>
              )
            )}
            {customInvalid && (
              <span className="text-destructive"> · pick a From date on or before the To date</span>
            )}
            {hasPrior ? (
              <span className="opacity-70"> · compared against {priorLabel}</span>
            ) : (
              <span className="opacity-70"> · no equal-length period before this one inside the data, so Prior % and Δ read as a dash</span>
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
                    ? "A customer whose balance was cleared by a journal (e.g. inter-company transfer) counts as paid. See the Journal Settled column. Journal charges (net debit) don’t count."
                    : "Only cash / bank receipts and manual Other Payments count; journal settlements are ignored."}
                </span>
              </div>
            </div>
          )}
        </CardContent>
        )}
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
                  className={`rounded-card bg-surface shadow-soft transition-all ${
                    active
                      ? "border-primary/50 ring-2 ring-primary"
                      : clickable
                        ? "border-border cursor-pointer hover:border-primary/40 hover:shadow-card-hover"
                        : "border-border opacity-50"
                  }`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">{k.label}</span>
                      <span className={`inline-flex items-center justify-center h-6 w-6 rounded-lg shrink-0 ${active && !isSummary ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className={`text-xl font-bold leading-none ${isSummary ? "text-foreground" : "text-destructive"}`}>{k.value}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-1.5">{k.sub}</p>
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

      {/* Overdue by sale type — Zero Collections only. The question the salesperson asks next:
          "they paid nothing, but WHAT did they not pay for?" Head and Spare Parts are called
          out as critical because, unlike a machine EMI or a running ink account, they should
          never be sitting overdue at all. Clicking a card scopes the whole report to that type,
          so the rupees on the card are the rupees in the table. */}
      {mode === "zero" && (
        <div className="space-y-2 -mt-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Overdue by sale type
            </span>
            <span className="text-[11px] text-muted-foreground">
              across all {allTypeRows.length} zero-collection customers. Click a card to show only that type
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {SALE_TYPE_CARD_ORDER.map((t) => {
              const d = typeOverdue[t];
              const label = saleTypeLabel(t);
              // Critical = a type that should never carry overdue at all, carrying some.
              const critical = isCriticalSaleType(t) && d.overdue > 0.5;
              const only = saleTypes.length === 1 && saleTypes[0] === t;
              const clickable = d.customers > 0 || only;
              const pick = () => setSaleTypes(only ? [...DEFAULT_SALE_TYPES] : [t]);
              return (
                <Tooltip key={t} delayDuration={200}>
                  <TooltipTrigger asChild>
                    <Card
                      onClick={clickable ? pick : undefined}
                      role="button"
                      tabIndex={clickable ? 0 : -1}
                      aria-pressed={only}
                      aria-disabled={!clickable}
                      onKeyDown={(e) => {
                        if (!clickable) return;
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
                      }}
                      className={`rounded-card shadow-soft transition-all ${
                        only
                          ? "bg-surface border-primary/50 ring-2 ring-primary"
                          : critical
                            ? "bg-destructive/5 border-destructive/40 cursor-pointer hover:border-destructive hover:shadow-card-hover"
                            : clickable
                              ? "bg-surface border-border cursor-pointer hover:border-primary/40 hover:shadow-card-hover"
                              : "bg-surface border-border opacity-50"
                      }`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">
                            {label}
                          </span>
                          <span className={`inline-flex items-center justify-center h-6 w-6 rounded-lg shrink-0 ${
                            critical ? "bg-destructive/15 text-destructive"
                            : only ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                          }`}>
                            {critical ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                          </span>
                        </div>
                        <p className={`text-xl font-bold leading-none ${d.overdue > 0.5 ? "text-destructive" : "text-foreground"}`}>
                          {fmtINRMoney(d.overdue)}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-1.5">
                          {d.customers} customer{d.customers === 1 ? "" : "s"} · {fmtINRMoney(d.outstanding)} outstanding
                        </p>
                        {critical && (
                          <p className="text-[10px] font-semibold text-destructive leading-tight mt-1">
                            Critical: should never be overdue
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="start"
                    className="max-w-[320px] p-3 text-[11px] leading-relaxed font-normal text-left"
                  >
                    <p className="font-semibold text-[12px] mb-1.5">{label} overdue</p>
                    <p>
                      <strong>{money(d.overdue)}</strong> already past its due date, owed by the{" "}
                      <strong>{d.customers}</strong> zero-collection customer{d.customers === 1 ? "" : "s"} whose
                      business with us is mainly <strong>{label}</strong>. They owe{" "}
                      {money(d.outstanding)} in total.
                      {critical && (
                        <>
                          <br />
                          <br />
                          <strong>This should be ₹0.</strong> A {label.toLowerCase()} sale is a small,
                          one-off purchase against a machine the customer is already running, and it is meant
                          to be settled at once, not carried. Unlike a machine (capital, paid down over
                          months) or ink (a running consumable account), anything overdue here is simply
                          unpaid.
                        </>
                      )}
                    </p>
                    <p className="mt-2 pt-2 border-t border-border/50 text-[10px] opacity-80">
                      {!clickable
                        ? `No zero-collection customer is mainly ${label.toLowerCase()}.`
                        : only
                          ? "Click to go back to the default sale-type scope."
                          : `Click to scope the whole report to ${label} customers.`}
                    </p>
                    <p className="mt-1 text-[10px] opacity-70">
                      Split by each customer’s dominant sale type, the same rule the Sale Type filter
                      and grouping use, so the card and the table always agree.
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

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
          Showing {focusedRows.length} of {rows.length} customers:{" "}
          {[...[...focus].map((f) => ZC_FOCUS_LABELS[f]), ...[...bands].map((b) => BAND_LABELS[b])].join(" + ")}
          {focus.size + bands.size > 1 && <span className="text-muted-foreground"> (all conditions met)</span>}
          . The cards above still count all {rows.length}.
        </p>
      )}

      {/* Filters & view — collapsed by default so the table sits right under the KPIs. The
          header summary shows the current view and every applied filter at a glance. */}
      <Card className="rounded-card border-border bg-surface">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors rounded-card"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground shrink-0">Filters &amp; view</span>
          <span className="text-[11px] text-muted-foreground truncate min-w-0">
            {`View: ${viewLabel}`}{filterSummary.length > 0 ? ` · ${filterSummary.join(" · ")}` : ""}
          </span>
          <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
        </button>
        {filtersOpen && (
        <CardContent className="p-4 pt-0 space-y-3">
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
              {/* Customer + Group dropdowns removed — the search box above already matches on
                  customer name AND group. Scope by the customer's DOMINANT sale type instead;
                  Machine is off by default (bought once, paid down over months), see
                  dominantSaleTypeOf / DEFAULT_SALE_TYPES. */}
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-36 text-xs rounded-input" />
              <SalesPersonMultiSelect options={salesPersonOptions} value={salespersons} onChange={setSalespersons} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} triggerClassName="h-8 w-40 text-xs rounded-input" />

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
                      <span className="block text-[10px] text-muted-foreground">They owe nothing, so off by default.</span>
                    </span>
                  </label>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
        )}
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
                    period. They paid nothing at all.
                  </li>
                  <li>
                    <strong className="text-foreground">Cheque returns are shown, not netted.</strong> A bounced payer
                    still counts as having paid, so they do <em>not</em> appear here. The{" "}
                    <em>Below 30% Collection</em> report does catch them.
                  </li>
                  <li>
                    <strong className="text-foreground">“Never” means never.</strong> The data starts{" "}
                    <strong className="text-foreground">01-04-2025</strong>, so “Never Paid” means no receipt since
                    then, not merely none this period.
                  </li>
                  <li>
                    <strong className="text-foreground">Prior Collections</strong> (add it from{" "}
                    <strong className="text-foreground">Columns</strong>) is money actually{" "}
                    <strong className="text-foreground">received</strong> in the equal-length period immediately before
                    this one{priorLabel ? ` (${priorLabel})` : ""}. Receipts only, so journal settlements are not added
                    and cheque returns are not subtracted. A customer listed here with a large Prior Collections figure
                    has <em>just stopped paying</em>; one showing ₹0 has been silent throughout.
                  </li>
                  <li>
                    <strong className="text-foreground">Overdue is net of On Account.</strong> Some money a customer has
                    paid settles no particular bill: an advance, a credit note, an untagged receipt. It is real cash and
                    it is deducted, but it belongs to no invoice, so the bills alone always add up to{" "}
                    <em>more</em> than the Overdue figure. Where that applies the row says{" "}
                    <strong className="text-foreground">less On Account</strong> under the figure, the drill-down shows
                    the same bridge bill by bill, and{" "}
                    <strong className="text-foreground">Overdue (Gross)</strong> and{" "}
                    <strong className="text-foreground">On Account</strong> are available as columns.
                  </li>
                  <li>
                    <strong className="text-foreground">Credit Days and Credit Limit</strong> come straight from the
                    Tally master, so they read as a dash where none is set, which is about half of all ledgers.
                  </li>
                  <li>
                    <strong className="text-foreground">It reconciles.</strong> Collections are month-wise, matching
                    the Salesperson Collection Report exactly.
                  </li>
                  <li>
                    <strong className="text-foreground">Custom counts to the day.</strong> The four ready-made periods
                    count whole months; picking <em>Custom</em> reads the vouchers themselves, so any From–To dates are
                    exact. Money received and billed comes out identical either way: a Custom range covering whole
                    months matches the preset to the rupee. <em>Opening</em> and <em>Collection %</em> can differ
                    slightly, because the month view has to spread each customer's credit notes, debit notes, journals
                    and cheque returns evenly across the year while the day view reads them on their real dates. Where
                    they disagree, the Custom figure is the accurate one.
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
                    company row is its own <strong className="text-foreground">Σ Collected ÷ Σ Collectible</strong>,{" "}
                    <em>never</em> the average of its customers’ percentages, which would let a ₹1 L customer count as
                    much as a ₹1 Cr one.
                  </li>
                  <li>
                    <strong className="text-foreground">The columns add up.</strong> Opening is derived by rolling
                    today’s Outstanding <em>back</em> through the period’s movements, so{" "}
                    <strong className="text-foreground">Opening + Sales − Collected reconciles to Outstanding</strong>{" "}
                    to the rupee, once credit/debit notes and journals are taken in.
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
                    whose balance was cleared by sales returns still appears here; they paid nothing. The{" "}
                    <strong className="text-foreground">Credit Notes</strong> column says why.
                  </li>
                  <li>
                    <strong className="text-foreground">Nothing to collect ⇒ excluded, not 0%.</strong>{" "}
                    {noPool > 0 ? (
                      <>
                        {noPool} customer{noPool === 1 ? "" : "s"} had no opening balance and no sales this period, so{" "}
                        {noPool === 1 ? "it is" : "they are"} left out, because a percentage of nothing is undefined.
                      </>
                    ) : (
                      <>A customer with no opening balance and no sales is left out, because a percentage of nothing is undefined.</>
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
                (use the caret to expand instead). The header row stays put as you scroll down; use the{" "}
                <Pin className="h-3 w-3 inline" /> to freeze the name column as you scroll across. Hover any column
                heading to see what it means, and use <strong className="text-foreground">Columns</strong> to add or
                remove one. <strong className="text-foreground">Save my view</strong> in there keeps your choice for
                next time, on any device.
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
              {/* Every column says what it means on hover. A four-word header on a management
                  report is a headline, not a definition — and a column nobody can define gets
                  quoted wrong in a meeting. The tooltip sits on the LABEL, not the cell, so it
                  doesn't fight the click-to-sort on the header. */}
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`text-right text-[11px] font-semibold text-foreground/60 whitespace-nowrap cursor-pointer select-none ${HEADER_STICKY}`}
                >
                  <span className="inline-flex items-center gap-1 justify-end w-full">
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <span className="cursor-help underline decoration-dotted decoration-foreground/25 underline-offset-4">
                          {col.label}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="end" className="max-w-[280px] p-2.5 text-[11px] leading-relaxed font-normal text-left">
                        <p className="font-semibold text-[12px] mb-1">{col.label}</p>
                        <p>{col.help}</p>
                      </TooltipContent>
                    </Tooltip>
                    {sortIcon(col.key)}
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
                    "No customer matches. Everyone who owes money paid something in this period."
                  ) : (
                    `No customer matches. Everyone who owes money collected at least ${threshold}% in this period.`
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
        ledgerFigures={drill.ledgerFigures}
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
