import {
  useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment,
  type ReactNode, type CSSProperties,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Cell,
  Tooltip as RTooltip,
} from "recharts";
import {
  Gauge, ChevronRight, ChevronDown, Download, ArrowLeft, Info, Pin, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Users, Infinity as InfinityIcon,
  FileWarning, Flame, CalendarX2, IndianRupee,
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
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { GroupByBuilder } from "@hub/components/GroupByBuilder";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import { FYProvider } from "@hub/lib/fyContext";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import { enumerateBills, type EnrichedBill } from "@hub/lib/agingReport";
import {
  buildMonthlySeries, buildLedgerBalances, buildLastReceiptDates, buildOutstandingByType,
  dominantSaleTypeOf, zcDimValue, detailPathFor, SALE_TYPES, NEVER_PAID, NEVER_SOLD,
  type ZCDim,
} from "@hub/lib/collections";
import { parseCutoff } from "@hub/lib/overdueAging";
import {
  buildDsoRows, buildDayVector, lookbackDaysOf, dsoTotalsOf, dsoOf, avgTermsOf, avgAgeOf,
  naiveDsoOf, addDsoMetrics, emptyDsoMetrics, makeDsoMetricsOf, makeDsoColumns, applyDsoFocus,
  DEFAULT_DSO_COLUMNS, DEFAULT_DSO_CUTOFF, DSO_CUTOFF_PRESETS, DSO_DIMENSIONS, DSO_PRESETS,
  DSO_FOCUS_LABELS, LOOKBACK_MONTHS, EPS,
  type DsoColumn, type DsoColumnKey, type DsoDim, type DsoFocus, type DsoMetrics, type DsoRow,
} from "@hub/lib/dso";
import { exportDsoXlsx } from "@hub/lib/exportDso";
import type { ConsolidatedCustomer, SaleType } from "@hub/lib/types";

/**
 * Customers with Average DSO over N Days.
 *
 *   ?over=90   → the cutoff management asked for. 60 / 120 / custom also work.
 *
 * DSO = how long this customer structurally takes to turn a sale into cash. A customer can be
 * inside their credit terms on every individual bill and still carry a 140-day DSO, which is
 * why this is not the Overdue report wearing a hat.
 *
 * The engine (lib/dso.ts) carries the reasoning: why the metric is a COUNTBACK rather than the
 * naive AR/Sales ratio (which divides by zero for 46 dormant debtors and would flood a ">90"
 * list with infinities), why the denominator is NET of credit notes (measured at 9.7% of gross
 * — worth 9.6 days of book DSO), why a net-negative month is not clamped, and above all why a
 * ratio is NEVER summed up the group tree.
 *
 * That last one is the load-bearing idea. A salesperson's DSO is NOT the mean of their
 * customers' DSOs. Every node re-runs the countback on its OWN summed AR and its OWN
 * element-wise-summed billing vector. On the live book the two answers differ on every single
 * salesperson node — one by 91 days.
 *
 * PINNED TWICE, both deliberate:
 *  1. SOURCE → the pipeline. The admin "Live (Tally)" toggle must not move a management number.
 *  2. SCOPE → Both FYs. Load-bearing: inside a young FY the 12-month lookback would silently
 *     collapse to ~3 months and EVERY DSO would be wrong.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type Segment = "all" | "active" | "no_activity";

const MIN_AR_OPTIONS = [
  { key: "0", label: "All", value: 0 },
  { key: "1L", label: "≥ ₹1 L", value: 100_000 },
  { key: "5L", label: "≥ ₹5 L", value: 500_000 },
] as const;
type MinArKey = (typeof MIN_AR_OPTIONS)[number]["key"];

/**
 * Machine is DESELECTED by default — the same call the Dormant report made, for the same reason.
 * A machine is a one-time capital sale paid down over months, so a 300-day DSO is its DESIGN, not
 * a warning. Measured: 59 machine-dominant customers, and leaving them in drags the book DSO from
 * 113 days to 144. Keeping them would make this an EMI schedule rather than a slow-payer list.
 * They are one click away, never gone.
 */
const DEFAULT_SALE_TYPES: string[] = SALE_TYPES.filter((t) => t !== "machine");

/** Chart status colours. Same palette the Category report already uses on this screen. */
const OK_FILL = "#34d399";      // within the cutoff
const OVER_FILL = "#f87171";    // past it
const REF_STROKE = "#94a3b8";   // the cutoff line
/** Bars not currently selected are dimmed rather than recoloured — colour means status, not focus. */
const DIM_OPACITY = 0.3;

/**
 * The DSO bands the distribution chart bins into. Module-level so the chart and the click-filter
 * predicate read the SAME definition — two copies would eventually disagree about which side of a
 * boundary a customer sits on, and the bar would then filter to a different set than it counted.
 */
const DSO_BANDS = [
  { label: "0–30", lo: 0, hi: 30 },
  { label: "31–60", lo: 30, hi: 60 },
  { label: "61–90", lo: 60, hi: 90 },
  { label: "91–120", lo: 90, hi: 120 },
  { label: "121–180", lo: 120, hi: 180 },
  { label: "181–365", lo: 180, hi: 365 },
] as const;

/** The capped bucket's label depends on the real lookback, so it can't be a constant. */
const cappedBandLabel = (lookbackDays: number) => `> ${lookbackDays}`;

/**
 * Does this row belong in `bandLabel`?
 *
 * A capped row carries dso === lookbackDays (347), which would ALSO satisfy the 181–365 band — so
 * capped rows must be excluded from every real band first, exactly as the binning does. Getting
 * this wrong would double-count them: 69 customers appearing in two bars at once.
 */
const rowInBand = (r: DsoRow, bandLabel: string, lookbackDays: number): boolean => {
  if (bandLabel === cappedBandLabel(lookbackDays)) return r.facts.beyondLookback;
  if (r.facts.beyondLookback) return false;
  const b = DSO_BANDS.find((x) => x.label === bandLabel);
  if (!b) return true;
  const d = r.facts.dso;
  return b.lo === 0 ? d <= b.hi : d > b.lo && d <= b.hi;
};

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

function toDrillRow(b: EnrichedBill): InvoiceDrillRow {
  return {
    customerName: b.cust.name,
    groupName: b.dims.group,
    company: b.cust.company,
    location: b.cust.location,
    number: b.inv.number,
    billRefName: b.inv.billRefName,
    date: b.inv.date,
    amount: b.inv.amount,
    received: b.inv.amount - b.inv.pending,
    pending: b.inv.pending,
    dueDate: b.inv.dueDate,
    overdueDays: b.inv.overdueDays,
    status: b.inv.status,
    voucherType: b.inv.voucherType,
  };
}

function DsoInner() {
  const [params, setParams] = useSearchParams();
  const cutoff = parseCutoff(params.get("over"), DEFAULT_DSO_CUTOFF);
  const title = `Customers with Average DSO over ${cutoff} Days`;

  const {
    allCustomers, consolidatedCustomers, customerDetail, customerGroupMap, dashboard,
    salesPersonOptions, loading,
  } = useAppData({});

  const asOfDate = dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10);

  // ── Filters ───────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [groupNamesSel, setGroupNamesSel] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>(DEFAULT_SALE_TYPES);
  const [minAr, setMinAr] = useState<MinArKey>("0");
  const [segment, setSegment] = useState<Segment>("all");
  const [blockedOnly, setBlockedOnly] = useState(false);
  /**
   * Chart drill-downs. These are FILTERS, not KPI lenses — clicking a bar narrows the whole report
   * (table, grand total, KPI cards, export), so the Book DSO card then reads that slice's own DSO.
   * They are kept out of the salesperson/category multi-selects deliberately: the chart is keyed by
   * zcDimValue, which folds a customer's several salespeople into one "A, B" label and maps blanks
   * to "Others" — neither of which a multi-select can represent without lying about what was clicked.
   */
  const [spFocus, setSpFocus] = useState<string | null>(null);
  const [bandFocus, setBandFocus] = useState<string | null>(null);
  const [cutoffDraft, setCutoffDraft] = useState(String(cutoff));
  useEffect(() => setCutoffDraft(String(cutoff)), [cutoff]);

  const applyCutoff = (n: number) => {
    const next = new URLSearchParams(params);
    next.set("over", String(n));
    setParams(next, { replace: true });
  };

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
  const realGroupNames = useMemo(
    () => new Set(Object.values(customerGroupMap.mapping)),
    [customerGroupMap],
  );
  const groupOptions = useMemo(() => [...realGroupNames].sort(), [realGroupNames]);
  const groupOf = useCallback(
    (c: ConsolidatedCustomer) => customerGroupMap.mapping[c.name] ?? c.name,
    [customerGroupMap],
  );

  // ── Month vocabulary & the lookback ───────────────────────────────────────────────
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);
  const lookbackMonths = useMemo(() => months.slice(-LOOKBACK_MONTHS), [months]);
  const dayVec = useMemo(() => buildDayVector(lookbackMonths, asOfDate), [lookbackMonths, asOfDate]);
  const lookbackDays = useMemo(() => lookbackDaysOf(dayVec), [dayVec]);
  const lookbackLabel = lookbackMonths.length
    ? `${lookbackMonths[0]} → ${lookbackMonths[lookbackMonths.length - 1]}`
    : "—";

  // ── Scope the RAW ledgers ─────────────────────────────────────────────────────────
  // The universe is "they owe us money": an advance/credit ledger has nothing to collect, so it
  // has no DSO. Everything below is summed over raw ledgers, never off a ConsolidatedCustomer.
  const scopedLedgers = useMemo(() => {
    let d = allCustomers.filter((c) => (c.outstanding ?? 0) > 0);
    d = d.filter((c) => matchesCategory(c, categories));
    if (companies.length)     { const s = new Set(companies);     d = d.filter((c) => s.has(c.company)); }
    if (locations.length)     { const s = new Set(locations);     d = d.filter((c) => s.has(c.location)); }
    if (salespersons.length)  { const s = new Set(salespersons);  d = d.filter((c) => s.has(c.salesPerson)); }
    if (customerNames.length) { const s = new Set(customerNames); d = d.filter((c) => s.has(c.name)); }
    if (groupNamesSel.length) { const s = new Set(groupNamesSel); d = d.filter((c) => s.has(customerGroupMap.mapping[c.name] ?? c.name)); }
    if (segment !== "all") {
      const act = new Map<string, number>();
      for (const c of d) {
        const a = c.sales + c.receipts + c.creditNotes + (c.otherPayments ?? 0);
        act.set(c.name, (act.get(c.name) ?? 0) + a);
      }
      d = d.filter((c) =>
        segment === "active" ? (act.get(c.name) ?? 0) > 0 : (act.get(c.name) ?? 0) <= 0,
      );
    }
    if (blockedOnly) d = d.filter((c) => c.blocked === true);
    return d;
  }, [
    allCustomers, categories, companies, locations, salespersons, customerNames, groupNamesSel,
    segment, blockedOnly, customerGroupMap,
  ]);

  const inScopeLedgerIds = useMemo(
    () => new Set(scopedLedgers.map((c) => c.id)),
    [scopedLedgers],
  );

  // ── Bills (for the age / overdue cross-check columns only) ────────────────────────
  // No synthetic ledger-adjustment bill here, unlike the Overdue report: a bill with no date has
  // no AGE, so it could never contribute to the weighted average anyway. The consequence is
  // stated on the basis panel — Avg Age of Open Bills covers the BILLED portion of AR, not all
  // of it.
  const bills = useMemo(
    () => enumerateBills(scopedLedgers, customerDetail, asOfDate, {}, customerGroupMap.mapping),
    [scopedLedgers, customerDetail, asOfDate, customerGroupMap],
  );
  const billsByLedger = useMemo(() => {
    const m = new Map<string, EnrichedBill[]>();
    for (const b of bills) {
      const arr = m.get(b.cust.id);
      if (arr) arr.push(b);
      else m.set(b.cust.id, [b]);
    }
    return m;
  }, [bills]);

  // ── Source-aware month-grain adapters, pinned to "pipeline" ───────────────────────
  const series = useMemo(
    () => buildMonthlySeries(allCustomers, customerDetail, "pipeline"),
    [allCustomers, customerDetail],
  );
  const balances = useMemo(() => buildLedgerBalances(allCustomers), [allCustomers]);
  const lastReceiptByLedger = useMemo(
    () => buildLastReceiptDates(allCustomers, customerDetail, "pipeline"),
    [allCustomers, customerDetail],
  );
  const outstandingByType = useMemo(() => buildOutstandingByType(allCustomers), [allCustomers]);
  const ledgerById = useMemo(
    () => new Map(allCustomers.map((c) => [c.id, c])),
    [allCustomers],
  );

  // ── Rows ──────────────────────────────────────────────────────────────────────────
  const eligible = useMemo(() => {
    let d = consolidatedCustomers.filter((c) =>
      (c.constituentIds?.length ? c.constituentIds : [c.id]).some((id) => inScopeLedgerIds.has(id)),
    );
    const q = search.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      d = d.filter((c) => {
        const text = `${c.name} ${groupOf(c)} ${c.salesPersons?.join(" ") ?? c.salesPerson}`.toLowerCase();
        return tokens.every((t) => text.includes(t));
      });
    }
    // The Sale Type filter scopes by DOMINANT type — it does not split the money. Per-month
    // sale-type sales are a documented best-effort estimate, so a per-type DSO would inherit that
    // error silently. A proper subset means the filter is live; selecting all 5 means "no filter".
    if (saleTypes.length > 0 && saleTypes.length < SALE_TYPES.length) {
      const s = new Set(saleTypes);
      d = d.filter((c) => s.has(dominantSaleTypeOf(c, outstandingByType)));
    }
    return d;
  }, [consolidatedCustomers, inScopeLedgerIds, search, groupOf, saleTypes, outstandingByType]);

  const allRows = useMemo(
    () =>
      buildDsoRows({
        customers: eligible, series, balances, billsByLedger, lastReceiptByLedger, ledgerById,
        inScopeLedgerIds, months, lookbackMonths, dayVec, asOfDate, groupOf,
      }),
    [
      eligible, series, balances, billsByLedger, lastReceiptByLedger, ledgerById,
      inScopeLedgerIds, months, lookbackMonths, dayVec, asOfDate, groupOf,
    ],
  );

  /** The chart's salesperson key. Reuses zcDimValue so a clicked bar and the table's own
   *  "Salesperson" grouping can never disagree about what a customer is called. */
  const spKeyOf = useCallback((r: DsoRow) => zcDimValue(r, "salesperson").value, []);

  /**
   * What the CHARTS are drawn from: everything the normal filters allow, but BEFORE the chart's
   * own click-filters. If the charts read `rows` they would collapse to the single bar you just
   * clicked and there would be no way to pick a different one — the selection would be a one-way
   * door. Drawn from this, the bars hold still and a click merely highlights.
   */
  const chartBase = useMemo(() => {
    const min = MIN_AR_OPTIONS.find((o) => o.key === minAr)?.value ?? 0;
    return min > 0 ? allRows.filter((r) => r.facts.ar >= min) : allRows;
  }, [allRows, minAr]);

  const rows = useMemo(() => {
    let d = chartBase;
    if (spFocus) d = d.filter((r) => spKeyOf(r) === spFocus);
    if (bandFocus) d = d.filter((r) => rowInBand(r, bandFocus, lookbackDays));
    return d;
  }, [chartBase, spFocus, bandFocus, spKeyOf, lookbackDays]);

  // ── Focus ─────────────────────────────────────────────────────────────────────────
  const [focus, setFocus] = useState<Set<DsoFocus>>(new Set());
  const toggleFocus = (f: DsoFocus) =>
    setFocus((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  const focusedRows = useMemo(() => applyDsoFocus(rows, focus, cutoff), [rows, focus, cutoff]);

  // ── View / columns / sort ─────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<DsoDim[]>(["customer"]);
  const viewLabel = useMemo(
    () => groupBy.map((d) => DSO_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → "),
    [groupBy],
  );

  const ALL_COLUMNS = useMemo(() => makeDsoColumns(dayVec, cutoff), [dayVec, cutoff]);
  const columnOptions: ColumnOption[] = ALL_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_DSO_COLUMNS);
  const columns = useMemo<DsoColumn[]>(
    () => ALL_COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [ALL_COLUMNS, visibleCols],
  );
  const colByKey = useMemo(() => new Map(ALL_COLUMNS.map((c) => [c.key, c])), [ALL_COLUMNS]);

  type SortKey = DsoColumnKey | "label";
  const [sortKey, setSortKey] = useState<SortKey>("dso");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "label" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30 inline" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" /> : <ArrowDown className="h-3 w-3 inline" />;
  };

  const [basisOpen, setBasisOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  useEffect(() => {
    setExpanded(new Set());
    setPage(1);
  }, [groupBy, search, customerNames, groupNamesSel, salespersons, companies, locations, categories, saleTypes, minAr, segment, blockedOnly, focus, cutoff, spFocus, bandFocus]);

  // ── Roll-up ───────────────────────────────────────────────────────────────────────
  const metricsOf = useMemo(() => makeDsoMetricsOf(cutoff), [cutoff]);
  const emptyOf = useCallback(
    () => emptyDsoMetrics(lookbackMonths.length),
    [lookbackMonths.length],
  );

  const tree = useMemo(
    () =>
      buildGroupTree<DsoRow, DsoMetrics>(focusedRows, groupBy, {
        dimValue: zcDimValue,
        idOf: (r) => r.customer.id,
        metricsOf,
        empty: emptyOf,
        add: addDsoMetrics,
      }),
    [focusedRows, groupBy, metricsOf, emptyOf],
  );

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
      if (av === null) return 1;      // nulls sort LAST in both directions
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
  // Over `rows` — the UNFOCUSED set. If the cards recomputed under the active focus, a card's
  // number would stop matching what clicking it shows.
  const t = useMemo(
    () => dsoTotalsOf(rows, cutoff, lookbackMonths.length),
    [rows, cutoff, lookbackMonths.length],
  );
  const bookDso = useMemo(() => dsoOf(t, dayVec), [t, dayVec]);
  const arOverCutoff = useMemo(
    () => rows.filter((r) => r.facts.dso > cutoff).reduce((s, r) => s + r.facts.ar, 0),
    [rows, cutoff],
  );
  const bookTerms = avgTermsOf(t);

  interface KpiCard {
    label: string;
    icon: typeof Gauge;
    value: string;
    sub: string;
    focusKey: DsoFocus | null;
    count: number;
    explain: ReactNode;
  }

  const kpiCards: KpiCard[] = [
    {
      label: "Book DSO", icon: Gauge, focusKey: null,
      value: `${bookDso.days.toFixed(0)}d${bookDso.beyondLookback ? "+" : ""}`,
      sub: bookDso.days > cutoff ? `above the ${cutoff}-day line` : `within the ${cutoff}-day line`,
      count: rows.length,
      explain: (
        <>
          The countback DSO of <strong>every customer currently listed</strong>, taken together —
          their combined outstanding measured against their combined monthly billings.
          <br />
          <br />
          This is the number that answers <em>"is our average DSO more than {cutoff} days?"</em>. It
          is <strong>not</strong> the average of the DSOs in the table below — averaging a ratio is
          meaningless. It is recomputed from the summed money.
        </>
      ),
    },
    {
      label: `Over ${cutoff} Days`, icon: Users, focusKey: "overCutoff",
      value: String(t.overCutoff),
      sub: `of ${rows.length} customers`,
      count: t.overCutoff,
      explain: (
        <>
          <strong>{t.overCutoff}</strong> of {rows.length} customers take longer than {cutoff} days
          to convert a sale into cash. Ledgers with the same name are merged, so a customer trading
          through three companies counts once.
        </>
      ),
    },
    {
      label: "Outstanding at Risk", icon: IndianRupee, focusKey: null,
      value: fmtINRMoney(arOverCutoff),
      sub: `held by the ${t.overCutoff} above`,
      count: t.overCutoff,
      explain: (
        <>
          The money tied up in customers whose DSO exceeds {cutoff} days —{" "}
          <strong>{fmtINRMoney(arOverCutoff)}</strong>. This is their <em>whole</em> balance, not
          just the overdue slice: a slow payer's entire receivable turns over slowly.
        </>
      ),
    },
    {
      label: "Beyond Lookback", icon: InfinityIcon, focusKey: "beyondLookback",
      value: String(t.beyondLookback),
      sub: `debt > ${lookbackMonths.length}m of billings`,
      count: t.beyondLookback,
      explain: (
        <>
          <strong>{t.beyondLookback}</strong> customers owe more than their entire{" "}
          {lookbackMonths.length}-month billing history. The countback runs out of sales to consume,
          so their DSO is reported as <strong>&gt; {lookbackDays} days</strong> — a floor, not a
          measurement.
          <br />
          <br />
          The worst accounts on the book. Every dormant debtor lands here, plus the slow payers who
          are still buying.
        </>
      ),
    },
    {
      label: "Breaching Terms", icon: FileWarning, focusKey: "breachingTerms",
      value: String(t.breachingTerms),
      sub: bookTerms !== null ? `avg terms ${bookTerms.toFixed(0)}d` : "no terms recorded",
      count: t.breachingTerms,
      explain: (
        <>
          <strong>{t.breachingTerms}</strong> customers have a DSO above{" "}
          <em>their own agreed credit period</em> — which is a sharper test than the flat{" "}
          {cutoff}-day line. A customer on 90-day terms at 95 days is basically fine; one on 30-day
          terms at 95 days is a serious breach. The flat line cannot tell them apart.
          <br />
          <br />
          Customers with no credit period recorded are <strong>excluded</strong>, not treated as
          zero-day terms.
        </>
      ),
    },
    {
      label: "Severe", icon: Flame, focusKey: "severe",
      value: String(t.severe),
      sub: `DSO ≥ ${2 * cutoff} days`,
      count: t.severe,
      explain: (
        <>
          <strong>{t.severe}</strong> customers are at <strong>double</strong> the cutoff or worse
          (≥ {2 * cutoff} days). Not merely late — structurally financing themselves on our balance
          sheet.
        </>
      ),
    },
    {
      label: "Never Paid", icon: CalendarX2, focusKey: "neverPaid",
      value: String(t.neverPaid),
      sub: "no receipt on record",
      count: t.neverPaid,
      explain: (
        <>
          <strong>{t.neverPaid}</strong> customers owe money and have <strong>never</strong> sent us
          a rupee within the available data, which begins 01-04-2025. Not "no receipt in the
          window" — no receipt at all.
        </>
      ),
    },
  ];

  // ── Charts ────────────────────────────────────────────────────────────────────────
  // Both panels are SINGLE-MEASURE (days), so neither needs a legend or a categorical palette.
  // Colour carries a status (within / past the cutoff) and is never the only signal — the
  // reference line and the axis say the same thing.

  /** DSO by salesperson, recomputed per salesperson from THEIR summed AR + billing vector. */
  const bySalesperson = useMemo(() => {
    const acc = new Map<string, DsoMetrics>();
    for (const r of chartBase) {
      const key = spKeyOf(r);
      let m = acc.get(key);
      if (!m) { m = emptyDsoMetrics(lookbackMonths.length); acc.set(key, m); }
      addDsoMetrics(m, metricsOf(r));
    }
    return [...acc.entries()]
      .map(([name, m]) => {
        const d = dsoOf(m, dayVec);
        return { name, dso: Math.round(d.days), capped: d.beyondLookback, customers: m.customers, ar: m.ar };
      })
      .filter((d) => d.customers > 0)
      .sort((a, b) => b.dso - a.dso)
      .slice(0, 12);
  }, [chartBase, spKeyOf, metricsOf, dayVec, lookbackMonths.length]);

  /** Distribution of customer DSO, binned by the SHARED band definitions the click-filter reads. */
  const distribution = useMemo(() => {
    const out = DSO_BANDS.map((b) => ({
      label: b.label as string, customers: 0, ar: 0, over: b.lo >= cutoff,
    }));
    let cappedCount = 0, cappedAr = 0;
    for (const r of chartBase) {
      if (r.facts.beyondLookback) { cappedCount++; cappedAr += r.facts.ar; continue; }
      const d = r.facts.dso;
      const bin = out.find((b, i) => {
        const band = DSO_BANDS[i];
        return band.lo === 0 ? d <= band.hi : d > band.lo && d <= band.hi;
      });
      if (bin) { bin.customers++; bin.ar += r.facts.ar; }
    }
    return [
      ...out,
      { label: cappedBandLabel(lookbackDays), customers: cappedCount, ar: cappedAr, over: true },
    ];
  }, [chartBase, cutoff, lookbackDays]);

  // ── Drill-down ────────────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[] }>(
    { open: false, title: "", subtitle: "", rows: [] },
  );

  const openDrill = (node: GroupNode<DsoMetrics> | null, col: DsoColumn) => {
    if (!col.drill) return;
    const ids = node ? new Set(node.ids) : new Set(focusedRows.map((r) => r.customer.id));
    const wanted = new Set<string>();
    for (const r of focusedRows) {
      if (!ids.has(r.customer.id)) continue;
      for (const id of r.customer.constituentIds?.length ? r.customer.constituentIds : [r.customer.id])
        if (inScopeLedgerIds.has(id)) wanted.add(id);
    }
    const picked: EnrichedBill[] = [];
    for (const id of wanted) {
      for (const b of billsByLedger.get(id) ?? []) {
        if ((b.inv.pending ?? 0) <= EPS) continue;
        const od = b.inv.overdueDays ?? 0;
        if (col.drill === "overdue" && od <= 0) continue;
        if (col.drill === "over180" && od <= 180) continue;
        picked.push(b);
      }
    }
    picked.sort((a, b) => (b.inv.overdueDays ?? 0) - (a.inv.overdueDays ?? 0));
    const what =
      col.drill === "overdue" ? "Overdue bills"
      : col.drill === "over180" ? "Bills more than 180 days past due"
      : "Open bills";
    setDrill({
      open: true,
      title: `${what} — ${picked.length} bill${picked.length === 1 ? "" : "s"}`,
      subtitle: node ? (node.sub ? `${node.label} · ${node.sub}` : node.label) : "All rows",
      rows: picked.map(toDrillRow),
    });
  };

  // ── Freeze panes ──────────────────────────────────────────────────────────────────
  const [freezeLevel, setFreezeLevel] = useState<0 | 1>(1);
  const chevRef = useRef<HTMLTableCellElement>(null);
  const labelRef = useRef<HTMLTableCellElement>(null);
  const [colW, setColW] = useState({ chev: 32, label: 240 });
  const measureCols = useCallback(() => {
    const chev = chevRef.current?.offsetWidth ?? 32;
    const label = labelRef.current?.offsetWidth ?? 240;
    setColW((prev) => (prev.chev === chev && prev.label === label ? prev : { chev, label }));
  }, []);
  useLayoutEffect(measureCols);
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

  // ── Chips ─────────────────────────────────────────────────────────────────────────
  const saleTypeActive = saleTypes.length > 0 && saleTypes.length < SALE_TYPES.length;
  const machineExcluded = saleTypeActive && !saleTypes.includes("machine");

  const chips: FilterChip[] = [
    ...(search ? [{ label: `Search: ${search}`, onRemove: () => setSearch("") }] : []),
    ...(customerNames.length ? [{ label: `Customers: ${customerNames.length}`, onRemove: () => setCustomerNames([]) }] : []),
    ...(groupNamesSel.length ? [{ label: `Groups: ${groupNamesSel.length}`, onRemove: () => setGroupNamesSel([]) }] : []),
    ...(salespersons.length ? [{ label: `Salesperson: ${salespersons.join(", ")}`, onRemove: () => setSalespersons([]) }] : []),
    ...(companies.length ? [{ label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) }] : []),
    ...(locations.length ? [{ label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) }] : []),
    ...(categories.length ? [{ label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) }] : []),
    // Removing the chip clears the filter — which brings MACHINE back in. Same convention as the
    // Dormant report: "clear" means clear, including the default exclusion.
    ...(saleTypeActive ? [{ label: `Sale Type: ${saleTypes.length} of ${SALE_TYPES.length}${machineExcluded ? " (Machine excluded)" : ""}`, onRemove: () => setSaleTypes([]) }] : []),
    ...(minAr !== "0" ? [{ label: `Min Outstanding: ${MIN_AR_OPTIONS.find((o) => o.key === minAr)?.label}`, onRemove: () => setMinAr("0") }] : []),
    ...(segment !== "all" ? [{ label: `Segment: ${segment === "active" ? "Active" : "Dormant"}`, onRemove: () => setSegment("all") }] : []),
    ...(blockedOnly ? [{ label: "Blocked only", onRemove: () => setBlockedOnly(false) }] : []),
    // The chart drill-downs get chips like any other filter, so a narrowed report can always be
    // explained — and undone — from one place.
    ...(spFocus ? [{ label: `Salesperson (chart): ${spFocus}`, onRemove: () => setSpFocus(null) }] : []),
    ...(bandFocus ? [{ label: `DSO band (chart): ${bandFocus} days`, onRemove: () => setBandFocus(null) }] : []),
  ];
  const clearFilters = () => {
    setSearch(""); setCustomerNames([]); setGroupNamesSel([]); setSalespersons([]);
    setCompanies([]); setLocations([]); setCategories([]); setSaleTypes([]);
    setMinAr("0"); setSegment("all"); setBlockedOnly(false);
    setSpFocus(null); setBandFocus(null);
  };

  // ── Export ────────────────────────────────────────────────────────────────────────
  const scopeLabel = `Both FYs (01-04-2025 → ${formatDateDMY(asOfDate)})`;
  const handleExport = () => {
    exportDsoXlsx(
      sortedRoots, tree.total, focusedRows,
      bills.filter((b) => inScopeLedgerIds.has(b.cust.id) && (b.inv.pending ?? 0) > EPS),
      columns, dayVec,
      {
        title,
        cutoff,
        viewLabel,
        scopeLabel,
        lookbackLabel: `${lookbackMonths.length} months (${lookbackLabel}) = ${lookbackDays} days`,
        basis:
          `DSO is a COUNTBACK: the customer's outstanding is consumed against their most recent ` +
          `monthly billings until it runs out, and the days consumed is the DSO. Billings are NET ` +
          `of credit notes (sales + debit notes − credit notes). A customer whose debt outlives the ` +
          `whole lookback is reported as "> ${lookbackDays}d" and flagged. Outstanding is the ` +
          `canonical net ledger balance.`,
        asOfDate,
        filterSummary: chips.map((c) => c.label),
        exclusions: [
          ...(machineExcluded
            ? ["Machine-dominant customers are excluded (a machine is a one-time capital sale paid down over months, so a long DSO is its design)"]
            : []),
          "Customers in credit (Outstanding ≤ 0) are excluded — there is nothing to collect, so they have no DSO",
        ],
      },
    );
  };

  // ── Cells ─────────────────────────────────────────────────────────────────────────
  const daysText = (v: number): string =>
    v === NEVER_PAID || v === NEVER_SOLD ? "Never" : v < 0 ? "—" : `${Math.round(v)}d`;

  const metricCells = (node: GroupNode<DsoMetrics> | null, isTotal: boolean): ReactNode =>
    columns.map((col) => {
      const m = node ? node.metrics : tree.total;
      const v = col.value(m);
      const clickable = !!col.drill && v !== null && Math.abs(v) >= EPS;
      const capped = !!col.capped && col.capped(m);
      const alarm = v !== null && !!col.alarm && col.alarm(v);

      const text =
        v === null ? "—"
        : col.kind === "money" ? fmtINRMoney(v)
        : col.kind === "days" ? (capped ? `> ${lookbackDays}d` : daysText(v))
        : col.kind === "months" ? (v === NEVER_SOLD ? "None" : v < 0 ? "—" : `${v}m`)
        : String(v);

      return (
        <TableCell
          key={col.key}
          onClick={clickable ? (e) => { e.stopPropagation(); openDrill(node, col); } : undefined}
          title={
            capped ? `Their debt exceeds the whole ${lookbackMonths.length}-month billing history — this is a floor, not a measurement.`
            : clickable ? "Click to see the bills"
            : undefined
          }
          className={`text-right font-mono whitespace-nowrap ${isTotal ? "text-sm" : "text-[13px]"} ${alarm ? "text-destructive" : ""} ${clickable ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
        >
          {text}
        </TableCell>
      );
    });

  const detailPathOf = (n: GroupNode<DsoMetrics>): string | null => {
    const dim = n.path[n.path.length - 1]?.dim as ZCDim | undefined;
    return detailPathFor(dim, n.label, realGroupNames);
  };
  const openDetail = (path: string) => window.open(path, "_blank", "noopener");

  const renderNodes = (nodes: GroupNode<DsoMetrics>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const path = detailPathOf(n);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      const bg = "bg-surface group-hover:bg-[hsl(var(--muted))]";
      const chev = freezeStick("chevron", { bg });
      const lab = freezeStick("label", { bg });
      const onRowClick = path ? () => openDetail(path) : hasChildren ? () => toggle(n.key) : undefined;
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

  const kpiGridClass = "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3";

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Gauge className="h-6 w-6 text-primary" /> {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            How long each customer actually takes to turn a sale into cash — their outstanding
            counted back against their own monthly billings. As of {formatDateDMY(asOfDate)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columnOptions} visible={visibleCols} onChange={setVisibleCols} />
          <Button onClick={handleExport} className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Cutoff + scope pin */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cutoff</span>
            <div className="inline-flex items-center rounded-input border border-border overflow-hidden">
              {DSO_CUTOFF_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyCutoff(p)}
                  className={`h-8 px-3 text-xs transition-colors ${cutoff === p ? "bg-primary text-primary-foreground font-medium" : "bg-surface text-muted-foreground hover:bg-muted"}`}
                >
                  {p}d
                </button>
              ))}
            </div>
            <input
              type="number"
              value={cutoffDraft}
              onChange={(e) => setCutoffDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyCutoff(parseCutoff(cutoffDraft, DEFAULT_DSO_CUTOFF)); }}
              onBlur={() => applyCutoff(parseCutoff(cutoffDraft, DEFAULT_DSO_CUTOFF))}
              className="h-8 w-20 px-2 text-xs rounded-input border border-border bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              title="Custom cutoff, in days — press Enter"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/70">Lookback</span>{" "}
            {lookbackMonths.length} months ({lookbackLabel}) ={" "}
            <span className="font-mono">{lookbackDays}</span> days
            <span className="opacity-70"> — the as-of month counts elapsed days only</span>
          </div>
          <div className="text-xs text-muted-foreground ml-auto">
            Pinned to <span className="font-semibold text-foreground/70">Both FYs</span> and the{" "}
            <span className="font-semibold text-foreground/70">pipeline</span> — a 12-month lookback
            cannot be read inside a single young financial year.
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className={kpiGridClass}>
        {kpiCards.map((k) => {
          const Icon = k.icon;
          const isSummary = k.focusKey === null;
          const active = isSummary ? false : focus.has(k.focusKey!);
          const clickable = isSummary ? false : active || k.count > 0;
          const action =
            !clickable ? null
            : active ? `Click to remove the “${k.label}” filter.`
            : "Click to show only these customers in the table.";
          return (
            <Tooltip key={k.label} delayDuration={200}>
              <TooltipTrigger asChild>
                <Card
                  onClick={clickable ? () => toggleFocus(k.focusKey!) : undefined}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : -1}
                  aria-pressed={active}
                  onKeyDown={(e) => {
                    if (!clickable) return;
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFocus(k.focusKey!); }
                  }}
                  className={`rounded-card bg-surface transition-all ${
                    active
                      ? "border-primary/50 ring-2 ring-primary"
                      : clickable
                        ? "border-border cursor-pointer hover:border-primary/40 hover:shadow-md"
                        : "border-border"
                  }`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      <span className="text-[11px] font-medium uppercase tracking-wide truncate">{k.label}</span>
                    </div>
                    <p className={`text-lg font-bold mt-1 font-mono ${k.label === "Book DSO" && bookDso.days > cutoff ? "text-destructive" : "text-foreground"}`}>
                      {k.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{k.sub}</p>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                {k.explain}
                {action && <p className="mt-2 pt-2 border-t border-border/50 text-muted-foreground">{action}</p>}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {focus.size > 0 && (
        <p className="text-[11px] text-primary -mt-3">
          Showing {focusedRows.length} of {rows.length} customers —{" "}
          {[...focus].map((f) => DSO_FOCUS_LABELS[f]).join(" + ")}
          {focus.size > 1 && <span className="text-muted-foreground"> (all conditions met)</span>}
          . The cards above still count all {rows.length}.
        </p>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-0.5">DSO by Salesperson</h3>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Each bar is that salesperson's own countback — their whole book's outstanding
                  against their whole book's billings. Never the average of their customers' DSOs.
                  <span className="text-foreground/60"> Click a bar to filter the report to them.</span>
                </p>
              </div>
              {spFocus && (
                <button
                  type="button"
                  onClick={() => setSpFocus(null)}
                  className="shrink-0 h-6 px-2 text-[11px] rounded-button border border-primary/40 text-primary hover:bg-primary/10"
                >
                  Clear
                </button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={bySalesperson} margin={{ top: 4, right: 30, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis
                  dataKey="name" tick={{ fontSize: 10 }} interval={0}
                  angle={-30} textAnchor="end" height={64}
                />
                <YAxis tick={{ fontSize: 11 }} unit="d" width={44} />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  formatter={(v: number, _n, p: any) => [
                    `${v}${p?.payload?.capped ? "+" : ""} days · ${p?.payload?.customers} customers · ${fmtINRMoney(p?.payload?.ar ?? 0)}`,
                    "DSO",
                  ]}
                />
                {/* insideTopRight, not right — at the plot edge the label was being clipped. */}
                <ReferenceLine
                  y={cutoff} stroke={REF_STROKE} strokeDasharray="4 4"
                  label={{ value: `${cutoff}d`, position: "insideTopRight", fontSize: 10, fill: REF_STROKE }}
                />
                <Bar
                  dataKey="dso"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(d: any) => {
                    const name = d?.name ?? d?.payload?.name;
                    if (name) setSpFocus((cur) => (cur === name ? null : name));   // click again to clear
                  }}
                >
                  {bySalesperson.map((d) => (
                    <Cell
                      key={d.name}
                      fill={d.dso > cutoff ? OVER_FILL : OK_FILL}
                      // Colour carries STATUS (over / within the cutoff), so selection is shown by
                      // dimming the others rather than by recolouring — recolouring would make a
                      // healthy salesperson look like a breaching one just because it was picked.
                      fillOpacity={spFocus && spFocus !== d.name ? DIM_OPACITY : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-0.5">How the book is distributed</h3>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Customers by DSO band. The final bar is everyone whose debt outlived the whole
                  lookback — a floor, not a measurement.
                  <span className="text-foreground/60"> Click a bar to filter the report to that band.</span>
                </p>
              </div>
              {bandFocus && (
                <button
                  type="button"
                  onClick={() => setBandFocus(null)}
                  className="shrink-0 h-6 px-2 text-[11px] rounded-button border border-primary/40 text-primary hover:bg-primary/10"
                >
                  Clear
                </button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={distribution} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} height={40} />
                <YAxis tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  formatter={(v: number, _n, p: any) => [
                    `${v} customers · ${fmtINRMoney(p?.payload?.ar ?? 0)}`,
                    "In this band",
                  ]}
                />
                <Bar
                  dataKey="customers"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(d: any) => {
                    const label = d?.label ?? d?.payload?.label;
                    if (label) setBandFocus((cur) => (cur === label ? null : label));
                  }}
                >
                  {distribution.map((d) => (
                    <Cell
                      key={d.label}
                      fill={d.over ? OVER_FILL : OK_FILL}
                      fillOpacity={bandFocus && bandFocus !== d.label ? DIM_OPACITY : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* View + filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <GroupByBuilder dimensions={DSO_DIMENSIONS} presets={DSO_PRESETS} value={groupBy} onChange={setGroupBy} />

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
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-36 text-xs rounded-input" />

              <div className="inline-flex items-center rounded-input border border-border overflow-hidden">
                {MIN_AR_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setMinAr(o.key)}
                    className={`h-8 px-2.5 text-xs transition-colors ${minAr === o.key ? "bg-primary text-primary-foreground font-medium" : "bg-surface text-muted-foreground hover:bg-muted"}`}
                    title="Minimum outstanding"
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-8 gap-1.5 rounded-input border-border text-xs">
                    <SlidersHorizontal className="h-3.5 w-3.5" /> More
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-3 space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Customer segment</p>
                    <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
                      <SelectTrigger className="h-8 text-xs rounded-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="active">Active only</SelectItem>
                        <SelectItem value="no_activity">No activity</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <Checkbox checked={blockedOnly} onCheckedChange={(v) => setBlockedOnly(v === true)} />
                    Blocked customers only
                  </label>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
      </Card>

      {/* Basis */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() => setBasisOpen((o) => !o)}
            className="w-full flex items-center gap-2 p-3 text-left text-xs font-semibold text-foreground/80 hover:bg-muted/40 transition-colors"
          >
            <Info className="h-3.5 w-3.5 text-primary" />
            How this report is calculated
            {basisOpen ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
          </button>
          {basisOpen && (
            <div className="px-4 pb-4 -mt-1">
              <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
                <li>
                  <strong className="text-foreground/80">DSO is a countback, not a ratio.</strong> The
                  customer's outstanding is consumed against their most recent monthly billings until
                  it runs out; the days consumed is the DSO. The obvious alternative —{" "}
                  <em>Outstanding ÷ Sales × Days</em> — divides by zero for every customer who owes
                  money but billed nothing, so they would all read as infinity. It is carried as the{" "}
                  <em>Naive DSO</em> column, blank where it is undefined.
                </li>
                <li>
                  <strong className="text-foreground/80">Billings are net of credit notes</strong>{" "}
                  (sales + debit notes − credit notes). A credit note clears a bill without collecting
                  cash, so it reduces the receivable; the billings that created that receivable must be
                  measured the same way. Credit notes run at ~10% of gross sales on this book — using
                  gross would understate the book's DSO by about 10 days.
                </li>
                <li>
                  <strong className="text-foreground/80">A group's DSO is not the average of its
                  rows.</strong> A ratio cannot be averaged. Every salesperson, company and category
                  row re-runs the countback on its <em>own</em> summed outstanding and its own summed
                  monthly billings. Expanding a group and averaging what you see will not reproduce the
                  parent, and should not.
                </li>
                <li>
                  <strong className="text-foreground/80">"&gt; {lookbackDays}d" is a floor.</strong>{" "}
                  When a customer's debt outlives the entire {lookbackMonths.length}-month lookback
                  there is no more billing to count back against, so the figure is capped and flagged
                  rather than extrapolated.
                </li>
                <li>
                  <strong className="text-foreground/80">The as-of month is partial.</strong> Today is
                  the {new Date(asOfDate).getDate()}th, so it contributes {new Date(asOfDate).getDate()}{" "}
                  days of selling, not a whole month. Counting it whole would inflate every DSO.
                </li>
                <li>
                  <strong className="text-foreground/80">Agreed Terms is an outstanding-weighted
                  average</strong>, never a sum — and a credit period of <em>0</em> means <em>not
                  recorded</em>, not "cash on delivery". Those customers are excluded from{" "}
                  <em>Excess over Terms</em> and from the Breaching Terms count rather than being
                  scored against zero-day terms. Where a customer trades through several ledgers the
                  longest recorded period wins.
                </li>
                <li>
                  <strong className="text-foreground/80">Avg Age of Open Bills covers the billed
                  portion only.</strong> It is weighted by each open bill's pending amount, and money
                  with no backing bill (opening-balance residue, on-account credits) has no age. It is
                  a cross-check on the countback, never a substitute — the two answer different
                  questions.
                </li>
                <li>
                  <strong className="text-foreground/80">Overdue and 180+ are bill-wise</strong> (Σ
                  pending of past-due bills), so they read above the Dashboard's figure, which is net
                  of on-account credits. Both are correct; they answer different questions. Outstanding
                  is the canonical net ledger balance and ties to the Dashboard.
                </li>
                <li>
                  <strong className="text-foreground/80">Machine sales are excluded by default.</strong>{" "}
                  A machine is a one-time capital purchase paid down over many months, so a long DSO is
                  its design rather than a warning — and machine ledgers are large enough to swamp the
                  list. The Sale Type filter scopes by each customer's <em>dominant</em> outstanding
                  type; select Machine to bring them back.
                </li>
                <li>
                  Customers in credit (Outstanding ≤ 0) are excluded: there is nothing to collect, so
                  they have no DSO.
                </li>
              </ul>
            </div>
          )}
        </CardContent>
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
            ) : sortedRoots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center py-12 text-muted-foreground">
                  {focus.size > 0 ? (
                    <>
                      No customer matches {[...focus].map((f) => DSO_FOCUS_LABELS[f]).join(" + ")}.
                      <button
                        type="button"
                        onClick={() => setFocus(new Set())}
                        className="ml-1.5 text-primary hover:underline"
                      >
                        Clear the focus
                      </button>
                    </>
                  ) : (
                    "No customer owes money under the current filters."
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
              {focus.size > 0 && <span className="opacity-70"> of {rows.length}</span>}
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

/** Pinned twice — see the file header. */
export default function DsoReport() {
  return (
    <ReceivablesSourceProvider value="default">
      <FYProvider>
        <DsoInner />
      </FYProvider>
    </ReceivablesSourceProvider>
  );
}
