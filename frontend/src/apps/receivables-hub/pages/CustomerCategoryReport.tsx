import {
  useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment,
  type ReactNode, type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import {
  Layers, ChevronRight, ChevronDown, Download, ArrowLeft, Info, Pin, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Users, Wallet, PiggyBank,
  Percent as PercentIcon, AlarmClock, TrendingDown, TrendingUp, Moon, AlertTriangle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ComposedChart, Line,
  ReferenceLine, Cell, LabelList, Legend, Tooltip as RTooltip,
} from "recharts";
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
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { FYProvider } from "@hub/lib/fyContext";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import { enumerateBills, ledgerAdjBill, type EnrichedBill } from "@hub/lib/agingReport";
import {
  buildMonthlySeries, buildLastReceiptDates, buildLedgerBalances, buildOutstandingByType,
  resolveWindow, priorWindow, monthRange, detailPathFor,
  PERIOD_LABELS, NEVER_PAID, type PeriodPreset, type ZCDim,
} from "@hub/lib/collections";
import {
  buildCCRows, buildBucketsByLedger, buildCategoryMatrix, ccDimValue, applyCCFocus,
  makeCCMetricsOf, addCCMetrics, emptyCCMetrics, ccTotalsOf, mismatchOf, mismatchReasonOf,
  isActive, isDormantLedger,
  CC_COLUMNS, DEFAULT_CC_COLUMNS, CC_DIMENSIONS, CC_PRESETS, CC_FOCUS_LABELS,
  TIER_ORDER, TIER_RANK, TIER_LABELS, TIER_COLORS, AGING_BUCKET_KEYS, AGING_BUCKET_LABELS,
  MATRIX_DIMS, MATRIX_MEASURES, MATRIX_OTHER, DEFAULT_MISMATCH_GAP, MISMATCH_GAP_OPTIONS, EPS,
  type CCColumn, type CCColumnKey, type CCDim, type CCFocus, type CCMetrics, type CCRow,
  type MatrixDim, type MatrixMeasure, type Tier,
} from "@hub/lib/customerCategory";
import { exportCustomerCategoryXlsx } from "@hub/lib/exportCustomerCategory";
import type { ConsolidatedCustomer, SaleType } from "@hub/lib/types";

/**
 * Customer Category Report (A/B/C/D/E) — the whole book, pivoted by the tier tag.
 *
 * The tier (`Customer.category`) is hand-maintained by Sales/Finance in the Credit-Limit sheet.
 * Everywhere else in this app it is only a FILTER. Here it is the SPINE — and the report asks the
 * question nobody could ask before: do the grades actually mean anything?
 *
 * lib/customerCategory.ts carries the reasoning, all of it measured against the live book:
 * why the balance is split Owed / Advances / Net (tier E is NET NEGATIVE — 25 customers sitting on
 * ₹5 cr of advances — so a share-of-book on the net gives a negative pie slice); why the behaviour
 * grade IGNORES Collection % (it is 41-48% across every tier — noise — while 180+/owed runs 5% → 43%);
 * why the grade is a QUINTILE and not a fixed threshold; and why 604 dormant ledgers are gated out
 * by default rather than counted.
 *
 * SOURCE → follows the "Live (Tally)" topbar toggle. Under Live the report's SPINE is exact: the
 * tier tag, Owed/Advances/Net (Net ties to the Live Dashboard) and the behaviour grade + aging +
 * overdue, which are all bill-wise (enumerateBills, same path the Overdue report uses under Live).
 * Only the three flow COLUMNS — Opening, Collection % and Credit Notes — lean on an estimate under
 * Live: the ConnectWave feed carries credit/debit notes only as a per-customer yearly total, which
 * buildMonthlySeries spreads across the months (see its header). Collection % is deliberately NOT a
 * grade input, so the estimate never moves a grade.
 *
 * PINNED to Both FYs (still deliberate, exactly like OverdueAgingReport). The balance/aging half of
 * this report is a property of the WHOLE BOOK, and the flow half has its own period selector on the
 * page. An FY selector in the topbar would be claiming to drive both, and would drive neither.
 * UserLayout hides it on this route.
 */

const PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const PERIOD_PRESETS: PeriodPreset[] = ["1m", "3m", "6m", "fy", "all", "custom"];

type Activity = "active" | "all" | "dormant";
const ACTIVITY_LABELS: Record<Activity, string> = {
  active: "Active only",
  all: "All accounts",
  dormant: "Dormant ledgers only",
};

const MIN_OWED_OPTIONS = [
  { key: "0", label: "All", value: 0 },
  { key: "1L", label: "≥ ₹1 L", value: 100_000 },
  { key: "5L", label: "≥ ₹5 L", value: 500_000 },
] as const;
type MinOwedKey = (typeof MIN_OWED_OPTIONS)[number]["key"];

type CellMode = "value" | "row" | "col";

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

/** The never-paid sentinel must never render as 9007199254740991. */
const daysText = (v: number): string => (v === NEVER_PAID ? "Never" : v < 0 ? "—" : `${v}d`);

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

function CustomerCategoryInner() {
  const {
    loading, allCustomers, consolidatedCustomers, customerDetail, customerGroupMap,
    dashboard, salesPersonOptions,
  } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);

  // ── Period (flows only — balances are always the whole book, today) ────────────────
  const [preset, setPreset] = useState<PeriodPreset>("fy");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  useEffect(() => {
    if (months.length && !customFrom) {
      setCustomFrom(months[Math.max(0, months.length - 3)]);
      setCustomTo(months[months.length - 1]);
    }
  }, [months, customFrom]);

  const windowMonths = useMemo(
    () => (preset === "custom" && customFrom && customTo
      ? monthRange(months, customFrom, customTo)
      : resolveWindow(months, preset)),
    [months, preset, customFrom, customTo],
  );
  const priorMonths = useMemo(() => priorWindow(months, windowMonths), [months, windowMonths]);
  const periodLabel = preset === "custom"
    ? `${customFrom} → ${customTo}`
    : `${PERIOD_LABELS[preset]}${windowMonths.length ? ` (${windowMonths[0]} → ${windowMonths[windowMonths.length - 1]})` : ""}`;

  // ── Filters ───────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [groupNamesSel, setGroupNamesSel] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [minOwed, setMinOwed] = useState<MinOwedKey>("0");
  const [activity, setActivity] = useState<Activity>("active");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [gap, setGap] = useState<number>(DEFAULT_MISMATCH_GAP);

  const [focus, setFocus] = useState<Set<CCFocus>>(new Set());
  const [tierFilter, setTierFilter] = useState<Set<Tier>>(new Set());
  const [groupBy, setGroupBy] = useState<CCDim[]>(["category", "customer"]);
  const [visibleCols, setVisibleCols] = useState<CCColumnKey[]>(DEFAULT_CC_COLUMNS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinTierOrder, setPinTierOrder] = useState(true);
  const [sortKey, setSortKey] = useState<"label" | CCColumnKey>("label");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [basisOpen, setBasisOpen] = useState(false);

  // Matrix panel
  const [mxDim, setMxDim] = useState<MatrixDim>("salesperson");
  const [mxMeasure, setMxMeasure] = useState<MatrixMeasure>("owed");
  const [cellMode, setCellMode] = useState<CellMode>("value");
  const [mxCell, setMxCell] = useState<{ tier: Tier; col: string; ids: Set<string> } | null>(null);

  const companyOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.company).filter(Boolean))].sort(), [allCustomers]);
  const locationOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.location).filter(Boolean))].sort(), [allCustomers]);
  const customerOptions = useMemo(
    () => [...new Set(allCustomers.map((c) => c.name).filter(Boolean))].sort(), [allCustomers]);
  const realGroupNames = useMemo(
    () => allGroupNames(customerGroupMap), [customerGroupMap]);
  const groupOptions = useMemo(() => [...realGroupNames].sort(), [realGroupNames]);
  const groupOf = useCallback(
    (c: ConsolidatedCustomer) => groupNameOf(c, customerGroupMap), [customerGroupMap]);

  // ── Scope the RAW ledgers, then keep every money figure inside that scope ──────────
  const scopedLedgers = useMemo(() => {
    let d = allCustomers.filter((c) => matchesCategory(c, categories));
    if (companies.length)     { const s = new Set(companies);     d = d.filter((c) => s.has(c.company)); }
    if (locations.length)     { const s = new Set(locations);     d = d.filter((c) => s.has(c.location)); }
    if (salespersons.length)  { const s = new Set(salespersons);  d = d.filter((c) => s.has(c.salesPerson)); }
    if (customerNames.length) { const s = new Set(customerNames); d = d.filter((c) => s.has(c.name)); }
    if (groupNamesSel.length) { const s = new Set(groupNamesSel); d = d.filter((c) => s.has(groupNameOf(c, customerGroupMap))); }
    if (blockedOnly) d = d.filter((c) => c.blocked === true);
    return d;
  }, [allCustomers, categories, companies, locations, salespersons, customerNames, groupNamesSel,
      blockedOnly, customerGroupMap]);

  const inScopeLedgerIds = useMemo(() => new Set(scopedLedgers.map((c) => c.id)), [scopedLedgers]);

  // ── Bills (the ONLY source of overdue + aging — see the engine header) ─────────────
  const billFilters = useMemo(
    () => ({ companies, locations, salespersons, saleTypes: saleTypes as SaleType[], customerNames }),
    [companies, locations, salespersons, saleTypes, customerNames]);

  const baseBills = useMemo(
    () => enumerateBills(scopedLedgers, customerDetail, asOfDate, billFilters, customerGroupMap),
    [scopedLedgers, customerDetail, asOfDate, billFilters, customerGroupMap]);

  /** Selecting every sale type means "no filter" — same guard as the Aging / Overdue reports. */
  const saleTypeActive = saleTypes.length > 0 && saleTypes.length < SALE_TYPE_OPTIONS.length;

  /**
   * The synthetic net-ledger line, so a bill drill-down can still show the part of a balance that
   * no open bill carries. It has overdueDays 0 and isLedgerAdj, so buildBucketsByLedger drops it —
   * the Overdue and aging columns are UNAFFECTED. It exists only for the drill-down's honesty.
   */
  const bills = useMemo(() => {
    if (saleTypeActive) return baseBills;
    const billNet = new Map<string, number>();
    for (const b of baseBills) billNet.set(b.cust.id, (billNet.get(b.cust.id) ?? 0) + b.inv.pending);
    const extra: EnrichedBill[] = [];
    for (const c of scopedLedgers) {
      const adj = c.outstanding - (billNet.get(c.id) ?? 0);
      if (Math.abs(adj) >= EPS) extra.push(ledgerAdjBill(c, adj, customerGroupMap));
    }
    return extra.length ? [...baseBills, ...extra] : baseBills;
  }, [baseBills, scopedLedgers, customerGroupMap, saleTypeActive]);

  const billsByLedger = useMemo(() => {
    const m = new Map<string, EnrichedBill[]>();
    for (const b of bills) {
      const arr = m.get(b.cust.id);
      if (arr) arr.push(b); else m.set(b.cust.id, [b]);
    }
    return m;
  }, [bills]);

  const bucketsByLedger = useMemo(() => buildBucketsByLedger(baseBills), [baseBills]);

  // ── The engine ────────────────────────────────────────────────────────────────────
  // Follow the topbar Live toggle (same one-liner as Overdue/DSO/Collections). Under Live,
  // buildMonthlySeries spreads each customer's yearly notes across the months, so the Opening /
  // Collection % / Credit Notes columns stay honest; the grade/aging spine is bill-wise and exact.
  const collSource = useReceivablesSource() === "connectwave" ? "live" : "pipeline";
  const isLive = collSource === "live";
  const series = useMemo(
    () => buildMonthlySeries(allCustomers, customerDetail, collSource),
    [allCustomers, customerDetail, collSource]);
  const lastDates = useMemo(
    () => buildLastReceiptDates(allCustomers, customerDetail, collSource),
    [allCustomers, customerDetail, collSource]);
  const balances = useMemo(() => buildLedgerBalances(allCustomers), [allCustomers]);
  const obt = useMemo(() => buildOutstandingByType(allCustomers), [allCustomers]);
  const ledgerById = useMemo(
    () => new Map(allCustomers.map((c) => [c.id, c])), [allCustomers]);

  /** Only customers with at least one surviving ledger. */
  const eligible = useMemo(
    () => consolidatedCustomers.filter((c) =>
      (c.constituentIds?.length ? c.constituentIds : [c.id]).some((id) => inScopeLedgerIds.has(id))),
    [consolidatedCustomers, inScopeLedgerIds]);

  const allRows = useMemo(() => buildCCRows({
    customers: eligible, ledgerById, bucketsByLedger, outstandingByType: obt,
    series, lastDates, balances, months, windowMonths, priorMonths, asOfDate,
    scopeIds: inScopeLedgerIds, groupOf,
  }), [eligible, ledgerById, bucketsByLedger, obt, series, lastDates, balances, months,
       windowMonths, priorMonths, asOfDate, inScopeLedgerIds, groupOf]);

  /** Activity + search + min-owed. The KPI strip reads THIS (unfocused), never the tree. */
  const rows = useMemo(() => {
    let d = allRows;
    if (activity === "active") d = d.filter(isActive);
    else if (activity === "dormant") d = d.filter(isDormantLedger);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      d = d.filter((r) => r.customer.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q));
    }
    const min = MIN_OWED_OPTIONS.find((o) => o.key === minOwed)?.value ?? 0;
    if (min > 0) d = d.filter((r) => r.owed >= min);
    return d;
  }, [allRows, activity, search, minOwed]);

  const focusedRows = useMemo(() => {
    let d = applyCCFocus(rows, focus, gap);
    if (tierFilter.size) d = d.filter((r) => tierFilter.has(r.tier));
    if (mxCell) d = d.filter((r) => mxCell.ids.has(r.customer.id));
    return d;
  }, [rows, focus, gap, tierFilter, mxCell]);

  const kpi = useMemo(() => ccTotalsOf(rows, gap), [rows, gap]);

  const columns: CCColumn[] = useMemo(
    () => CC_COLUMNS.filter((c) => visibleCols.includes(c.key)), [visibleCols]);
  const columnOptions: ColumnOption[] = useMemo(
    () => CC_COLUMNS.map((c) => ({ key: c.key, label: c.label })), []);

  const tree = useMemo(() => buildGroupTree<CCRow, CCMetrics>(focusedRows, groupBy, {
    dimValue: ccDimValue,
    idOf: (r) => r.customer.id,
    metricsOf: makeCCMetricsOf(gap),
    empty: emptyCCMetrics,
    add: addCCMetrics,
  }), [focusedRows, groupBy, gap]);

  /**
   * Tier order is PINNED at the top level by default. Without it, sorting by Owed scrambles
   * A/B/C/D/E and the thing stops being a scoreboard — the row order IS the grades.
   */
  const sortedRoots = useMemo(() => {
    const col = CC_COLUMNS.find((c) => c.key === sortKey);
    const cmp = (a: GroupNode<CCMetrics>, b: GroupNode<CCMetrics>) => {
      if (pinTierOrder && a.depth === 0 && a.path[0]?.dim === "category" && b.path[0]?.dim === "category") {
        return TIER_RANK[a.path[0].value as Tier] - TIER_RANK[b.path[0].value as Tier];
      }
      if (sortKey === "label" || !col) {
        const r = a.label.localeCompare(b.label);
        return sortDir === "asc" ? r : -r;
      }
      const av = col.value(a.metrics, tree.total) ?? -Infinity;
      const bv = col.value(b.metrics, tree.total) ?? -Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    };
    return sortTree(tree.roots, cmp);
  }, [tree, sortKey, sortDir, pinTierOrder]);

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sortedRoots.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRoots = useMemo(
    () => (pageSize === "all" ? sortedRoots : sortedRoots.slice((safePage - 1) * pageSize, safePage * pageSize)),
    [sortedRoots, pageSize, safePage]);
  useEffect(() => { setPage(1); }, [groupBy, focus, tierFilter, activity, search, minOwed, gap, mxCell]);

  const matrix = useMemo(
    () => buildCategoryMatrix(rows, mxDim, mxMeasure, gap), [rows, mxDim, mxMeasure, gap]);
  const matrixFull = useMemo(
    () => buildCategoryMatrix(rows, mxDim, mxMeasure, gap, { topCols: 9999 }), [rows, mxDim, mxMeasure, gap]);

  const toggle = (k: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleSort = (k: "label" | CCColumnKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "label" ? "asc" : "desc"); }
  };
  const sortIcon = (k: "label" | CCColumnKey) =>
    sortKey !== k ? <ArrowUpDown className="h-3 w-3 opacity-30" />
      : sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" />
        : <ArrowDown className="h-3 w-3 text-primary" />;

  const toggleFocus = (f: CCFocus) =>
    setFocus((p) => { const n = new Set(p); n.has(f) ? n.delete(f) : n.add(f); return n; });

  // ── Drill-down ────────────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[] }>(
    { open: false, title: "", subtitle: "", rows: [] });

  const openDrill = (node: GroupNode<CCMetrics> | null, col: CCColumn) => {
    if (!col.drill) return;
    const wanted = new Set(node ? node.ids : focusedRows.map((r) => r.customer.id));
    const byId = new Map(focusedRows.map((r) => [r.customer.id, r]));
    const ledgerIds = new Set<string>();
    for (const id of wanted) {
      const r = byId.get(id);
      if (!r) continue;
      for (const lid of (r.customer.constituentIds?.length ? r.customer.constituentIds : [r.customer.id])) {
        if (inScopeLedgerIds.has(lid)) ledgerIds.add(lid);
      }
    }
    const out: InvoiceDrillRow[] = [];
    for (const lid of ledgerIds) {
      for (const b of billsByLedger.get(lid) ?? []) {
        if (b.isLedgerAdj) continue;
        const keep =
          col.drill === "owed" ? b.inv.pending > 0
          : col.drill === "overdue" ? b.inv.pending > 0 && !!b.overdueKey
          : b.inv.pending > 0 && b.overdueKey === col.drill;
        if (keep) out.push(toDrillRow(b));
      }
    }
    if (out.length === 0) return;
    setDrill({
      open: true,
      title: `${col.label} — open bills`,
      subtitle: node ? (node.sub ? `${node.label} · ${node.sub}` : node.label) : "All rows",
      rows: out,
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

  const freezeStick = (
    id: "chevron" | "label", opts?: { header?: boolean; bg?: string },
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

  // ── Cells ─────────────────────────────────────────────────────────────────────────
  const metricCells = (node: GroupNode<CCMetrics> | null, isTotal: boolean): ReactNode =>
    columns.map((col) => {
      const m = node ? node.metrics : tree.total;
      const v = col.value(m, tree.total);
      const clickable = !!col.drill && v !== null && Math.abs(v) >= EPS;
      const alarm =
        v === null ? false
        : col.kind === "days" ? !!col.alarm && (v === NEVER_PAID || v > 180)
        : !!col.alarm && v > EPS;
      const text =
        v === null ? "—"
        : col.kind === "money" ? fmtINRMoney(v)
        : col.kind === "days" ? daysText(v)
        : col.kind === "pct" ? `${v.toFixed(1)}%`
        : String(v);
      return (
        <TableCell
          key={col.key}
          onClick={clickable ? (e) => { e.stopPropagation(); openDrill(node, col); } : undefined}
          title={clickable ? "Click to see the bills" : undefined}
          className={`text-right font-mono whitespace-nowrap ${isTotal ? "text-sm" : "text-[13px]"} ${alarm ? "text-destructive" : ""} ${clickable ? "cursor-pointer hover:underline hover:text-primary" : ""}`}
        >
          {text}
        </TableCell>
      );
    });

  const detailPathOf = (n: GroupNode<CCMetrics>): string | null => {
    const dim = n.path[n.path.length - 1]?.dim as ZCDim | undefined;
    return detailPathFor(dim, n.label, realGroupNames);
  };
  const openDetail = (path: string) => window.open(path, "_blank", "noopener");

  const mismatchById = useMemo(() => {
    const m = new Map<string, "over_graded" | "under_graded">();
    for (const r of focusedRows) {
      const c = mismatchOf(r, gap);
      if (c === "over_graded" || c === "under_graded") m.set(r.customer.id, c);
    }
    return m;
  }, [focusedRows, gap]);
  const rowById = useMemo(
    () => new Map(focusedRows.map((r) => [r.customer.id, r])), [focusedRows]);

  const renderNodes = (nodes: GroupNode<CCMetrics>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const path = detailPathOf(n);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      const bg = "bg-surface group-hover:bg-[hsl(var(--muted))]";
      const chev = freezeStick("chevron", { bg });
      const lab = freezeStick("label", { bg });
      const isTierRow = n.depth === 0 && n.path[0]?.dim === "category";
      const tierAccent = isTierRow ? TIER_COLORS[n.path[0].value as Tier] : undefined;
      const leafId = !hasChildren && n.ids.length === 1 ? n.ids[0] : null;
      const mm = leafId ? mismatchById.get(leafId) : undefined;
      const leafRow = leafId ? rowById.get(leafId) : undefined;
      const onRowClick = path ? () => openDetail(path) : hasChildren ? () => toggle(n.key) : undefined;
      return (
        <Fragment key={n.key}>
          <TableRow
            className={`group ${tint} ${onRowClick ? "cursor-pointer hover:bg-muted/40" : ""} transition-colors`}
            onClick={onRowClick}
          >
            <TableCell
              style={{ ...chev.style, borderLeft: tierAccent ? `3px solid ${tierAccent}` : undefined }}
              className={`text-muted-foreground ${chev.className}`}
            >
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
              {mm && leafRow && (
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <span className={`ml-1.5 inline-flex items-center rounded-button px-1.5 py-0 text-[10px] border ${
                      mm === "over_graded"
                        ? "bg-destructive/10 text-destructive border-destructive/30"
                        : "bg-primary/10 text-primary border-primary/30"
                    }`}>
                      {mm === "over_graded" ? `↓ behaves ${leafRow.grade}` : `↑ behaves ${leafRow.grade}`}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm text-xs">{mismatchReasonOf(leafRow)}</TooltipContent>
                </Tooltip>
              )}
            </TableCell>
            {metricCells(n, false)}
          </TableRow>
          {isOpen && hasChildren && renderNodes(n.children)}
        </Fragment>
      );
    });

  // ── KPI cards ─────────────────────────────────────────────────────────────────────
  const collPct = kpi.collectible > 0 ? (kpi.collected / kpi.collectible) * 100 : null;
  const dormantCount = useMemo(() => allRows.filter(isDormantLedger).length, [allRows]);

  interface Kpi {
    label: string; icon: typeof Users; value: string; sub: string;
    focusKey?: CCFocus; count?: number; explain: ReactNode;
  }
  const kpiCards: Kpi[] = [
    {
      label: "Customers", icon: Users, value: String(kpi.customers),
      sub: `${kpi.active} active`,
      explain: <>Customers in view, after the Activity filter. A customer is <strong>active</strong> when they billed something in the period or carry a balance.</>,
    },
    {
      label: "Owed", icon: Wallet, value: fmtINRMoney(kpi.owed),
      sub: "gross — what customers owe us",
      explain: <>Σ of every customer's balance where it is <strong>positive</strong>. This is the denominator for % of Book, because a net figure can go negative (tier E does) and a share of it would be meaningless.</>,
    },
    {
      label: "Advances Held", icon: PiggyBank, value: fmtINRMoney(kpi.advances),
      sub: "money customers pre-paid us",
      focusKey: "holdsAdvance",
      count: allRows.filter((r) => r.advances < -1).length,
      explain: <>Σ of every customer's balance where it is <strong>negative</strong> — they have paid us more than they owe. <strong>Owed + Advances = Net Outstanding</strong>, which ties to the Dashboard.</>,
    },
    {
      label: "Collection %", icon: PercentIcon,
      value: collPct === null ? "—" : `${collPct.toFixed(1)}%`,
      sub: `${fmtINRMoney(kpi.collected)} of ${fmtINRMoney(kpi.collectible)}`,
      explain: <>Collected ÷ (Opening + Sales in the period). Shown because it is asked for — but note it barely varies between tiers, which is exactly why the behaviour grade below <strong>ignores</strong> it.</>,
    },
    {
      label: "Overdue", icon: AlarmClock, value: fmtINRMoney(kpi.overdue),
      sub: kpi.owed > 0 ? `${((kpi.overdue / kpi.owed) * 100).toFixed(0)}% of Owed` : "—",
      focusKey: "overdue", count: rows.filter((r) => r.buckets.overdue > EPS).length,
      explain: <>Summed from the individual open <strong>bills</strong> that are past due — not the stored ledger column. That makes it tie to the Aging Report exactly, and it reads slightly <em>above</em> the Dashboard's Overdue.</>,
    },
    {
      label: "180+ Debt", icon: TrendingDown, value: fmtINRMoney(kpi.od_180_plus),
      sub: kpi.owed > 0 ? `${((kpi.od_180_plus / kpi.owed) * 100).toFixed(0)}% of Owed` : "—",
      focusKey: "over180", count: rows.filter((r) => r.buckets.od_180_plus > EPS).length,
      explain: <>The oldest money on the books. This is <strong>the</strong> signal that separates a good tier from a bad one — and the largest input to the behaviour grade.</>,
    },
    {
      label: "Over-graded", icon: AlertTriangle, value: String(kpi.overGraded),
      sub: fmtINRMoney(rows.filter((r) => mismatchOf(r, gap) === "over_graded").reduce((s, r) => s + r.owed, 0)),
      focusKey: "overGraded", count: kpi.overGraded,
      explain: <>Tagged <strong>{gap === 2 ? "two" : "three"} or more grades better</strong> than they actually pay. A customer tagged A who behaves like a D. Ranked by money at stake in the export's <em>Tag Mismatches</em> sheet.</>,
    },
    {
      label: "Under-graded", icon: TrendingUp, value: String(kpi.underGraded),
      sub: "pay better than their tag",
      focusKey: "underGraded", count: kpi.underGraded,
      explain: <>Tagged <strong>{gap === 2 ? "two" : "three"} or more grades worse</strong> than they actually pay — a D or E who settles on time. Often a commercial opportunity rather than a risk.</>,
    },
  ];

  // ── Charts ────────────────────────────────────────────────────────────────────────
  const tierNodes = useMemo(() => {
    const t = buildGroupTree<CCRow, CCMetrics>(focusedRows, ["category"], {
      dimValue: ccDimValue, idOf: (r) => r.customer.id,
      metricsOf: makeCCMetricsOf(gap), empty: emptyCCMetrics, add: addCCMetrics,
    });
    const byTier = new Map<string, CCMetrics>();
    for (const n of t.roots) byTier.set(n.path[0].value, n.metrics);
    return TIER_ORDER
      .filter((tr) => byTier.has(tr))
      .map((tr) => ({ tier: tr, m: byTier.get(tr)! }));
  }, [focusedRows, gap]);

  const agingChart = tierNodes.map(({ tier, m }) => ({
    tier, ...Object.fromEntries(AGING_BUCKET_KEYS.map((k) => [k, m[k]])),
  }));
  const collChart = tierNodes.map(({ tier, m }) => ({
    tier,
    sales: m.salesInWindow,
    collected: m.collected,
    pct: m.collectible > 0 ? (m.collected / m.collectible) * 100 : null,
  }));
  const shareChart = tierNodes.map(({ tier, m }) => ({
    tier, owed: m.owed,
    pct: kpi.owed > 0 ? (m.owed / kpi.owed) * 100 : 0,
  }));
  const BUCKET_FILL: Record<string, string> = {
    od_0_30: "#86efac", od_31_60: "#fde047", od_61_90: "#fdba74",
    od_91_120: "#fb923c", od_121_180: "#f87171", od_180_plus: "#b91c1c",
  };

  // ── Chips ─────────────────────────────────────────────────────────────────────────
  const chips: FilterChip[] = [
    ...(search ? [{ label: `Search: ${search}`, onRemove: () => setSearch("") }] : []),
    ...(customerNames.length ? [{ label: `Customers: ${customerNames.length}`, onRemove: () => setCustomerNames([]) }] : []),
    ...(groupNamesSel.length ? [{ label: `Groups: ${groupNamesSel.length}`, onRemove: () => setGroupNamesSel([]) }] : []),
    ...(salespersons.length ? [{ label: `Salesperson: ${salespersons.join(", ")}`, onRemove: () => setSalespersons([]) }] : []),
    ...(companies.length ? [{ label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) }] : []),
    ...(locations.length ? [{ label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) }] : []),
    ...(categories.length ? [{ label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) }] : []),
    ...(saleTypes.length ? [{ label: `Sale Type: ${saleTypes.length}`, onRemove: () => setSaleTypes([]) }] : []),
    ...(minOwed !== "0" ? [{ label: `Min Owed: ${MIN_OWED_OPTIONS.find((o) => o.key === minOwed)?.label}`, onRemove: () => setMinOwed("0") }] : []),
    ...(activity !== "active" ? [{ label: ACTIVITY_LABELS[activity], onRemove: () => setActivity("active") }] : []),
    ...(blockedOnly ? [{ label: "Red Mark only", onRemove: () => setBlockedOnly(false) }] : []),
    ...(tierFilter.size ? [{ label: `Tier: ${[...tierFilter].join(", ")}`, onRemove: () => setTierFilter(new Set()) }] : []),
    ...(mxCell ? [{ label: `Cell: ${mxCell.tier} × ${mxCell.col}`, onRemove: () => setMxCell(null) }] : []),
    ...[...focus].map((f) => ({ label: CC_FOCUS_LABELS[f], onRemove: () => toggleFocus(f) })),
  ];
  const clearFilters = () => {
    setSearch(""); setCustomerNames([]); setGroupNamesSel([]); setSalespersons([]);
    setCompanies([]); setLocations([]); setCategories([]); setSaleTypes([]);
    setMinOwed("0"); setActivity("active"); setBlockedOnly(false);
    setTierFilter(new Set()); setFocus(new Set()); setMxCell(null);
  };

  // ── Export ────────────────────────────────────────────────────────────────────────
  const viewLabel = groupBy.map((d) => CC_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → ");
  const scopeLabel = `Both FYs · balances as on ${formatDateDMY(asOfDate)} · flows in ${periodLabel}`;

  const handleExport = () => {
    exportCustomerCategoryXlsx(sortedRoots, tree.total, focusedRows, matrixFull, columns, {
      title: "Customer Category Report",
      viewLabel: viewLabel || "Category",
      scopeLabel,
      periodLabel,
      basis: "Owed, Advances, Net, Overdue, Aging and Credit Limit are the whole book as it stands today. Sales, Collected and Collection % cover the selected period only."
        + (isLive ? " Source: the live Tally feed (ConnectWave) — grade, aging, overdue and Owed/Advances/Net are exact; Opening, Collection % and Credit Notes are estimated from each customer's yearly notes total (the live feed doesn't carry them month by month)." : ""),
      reconciliation: "Net Outstanding ties to the Dashboard's Total Outstanding. Overdue and the aging buckets are summed from individual open bills (like the Aging and Overdue-120 reports), so they read slightly ABOVE the Dashboard's Overdue, which sums the stored ledger column.",
      gradeBasis: `Behaviour grade = every customer who owes money, ranked on a risk score (45% share of balance past 180 days + 30% share overdue + 25% max days overdue) and cut into five equal quintiles. Collection % is deliberately NOT an input: it is 41-48% across every tier and carries no signal. Mismatch = tagged tier vs behaviour grade differing by ${gap} or more grades.`,
      mismatchGap: gap,
      asOfDate,
      filterSummary: chips.map((c) => c.label),
      exclusions: activity === "active"
        ? [`Dormant ledgers excluded (${dormantCount} customers with no sales anywhere in the data and no balance)`]
        : [],
    });
  };

  const t = tree.total;
  const kpiGridClass = "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3";
  const mxMeasureKind = MATRIX_MEASURES.find((m) => m.key === mxMeasure)?.kind ?? "money";
  const mxCellText = (v: number, rowTotal: number, colTotal: number): string => {
    if (cellMode === "row") return rowTotal !== 0 ? `${((v / rowTotal) * 100).toFixed(0)}%` : "—";
    if (cellMode === "col") return colTotal !== 0 ? `${((v / colTotal) * 100).toFixed(0)}%` : "—";
    return mxMeasureKind === "money" ? fmtINRMoney(v) : String(Math.round(v));
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" /> Customer Category Report (A/B/C/D/E)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The whole book, pivoted by the customer tier — and whether the tiers actually mean anything.
            {asOfDate && <span className="text-foreground/70"> As on {formatDateDMY(asOfDate)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columnOptions} visible={visibleCols} onChange={(v) => setVisibleCols(v as CCColumnKey[])} />
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

      {/* Period + the dual-basis warning */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Period (sales &amp; collections)</span>
            {PERIOD_PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? "default" : "outline"}
                onClick={() => setPreset(p)}
                className={`h-8 rounded-button text-xs ${preset === p ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "border-border"}`}
              >
                {PERIOD_LABELS[p]}
              </Button>
            ))}
            {preset === "custom" && months.length > 0 && (
              <div className="flex items-center gap-1.5 ml-1">
                <Select value={customFrom} onValueChange={setCustomFrom}>
                  <SelectTrigger className="h-8 w-28 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">→</span>
                <Select value={customTo} onValueChange={setCustomTo}>
                  <SelectTrigger className="h-8 w-28 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-button bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 px-3 py-2">
            <Info className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
              <strong>Two bases on one screen.</strong> Owed, Advances, Net, Overdue, Aging, Credit Limit and
              Utilisation are the <strong>whole book as it stands today</strong> ({formatDateDMY(asOfDate)}) —
              the financial-year selector does not apply and is hidden. Sales, Collected and Collection % cover
              the <strong>selected period only</strong> ({periodLabel}). So a tier's Collection % can read 0%
              while its Owed is unchanged.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className={kpiGridClass}>
        {kpiCards.map((k) => {
          const on = k.focusKey ? focus.has(k.focusKey) : false;
          const clickable = !!k.focusKey && (k.count ?? 0) > 0;
          return (
            <Tooltip key={k.label} delayDuration={250}>
              <TooltipTrigger asChild>
                <Card
                  onClick={clickable ? () => toggleFocus(k.focusKey!) : undefined}
                  className={`rounded-card border bg-surface transition-all ${
                    on ? "border-primary ring-1 ring-primary/30" : "border-border"
                  } ${clickable ? "cursor-pointer hover:border-primary/40" : ""}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <k.icon className="h-3.5 w-3.5" /> {k.label}
                    </div>
                    <div className="mt-1 text-lg font-bold text-foreground font-mono">{k.value}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{k.sub}</div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{k.explain}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Tier chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tiers</span>
        {tierNodes.map(({ tier, m }) => {
          const on = tierFilter.has(tier);
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter((p) => { const n = new Set(p); n.has(tier) ? n.delete(tier) : n.add(tier); return n; })}
              className={`inline-flex items-center gap-1.5 rounded-button border px-2.5 py-1 text-[11px] transition-colors ${
                on ? "border-primary bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/40"
              }`}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: TIER_COLORS[tier] }} />
              <strong className="text-foreground">{TIER_LABELS[tier]}</strong>
              <span>{m.customers}</span>
              <span className="font-mono">{fmtINRMoney(m.owed)}</span>
              <span className="opacity-70">{kpi.owed > 0 ? `${((m.owed / kpi.owed) * 100).toFixed(1)}%` : "—"}</span>
            </button>
          );
        })}
        {dormantCount > 0 && activity === "active" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground ml-1">
            <Moon className="h-3 w-3" />
            {dormantCount} dormant ledger{dormantCount === 1 ? "" : "s"} hidden
            <button type="button" onClick={() => setActivity("dormant")} className="text-primary hover:underline ml-0.5">
              show
            </button>
          </span>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-foreground/80 mb-2">Owed by tier, split by age</h3>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={agingChart} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="tier" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtINRMoney(Number(v))} />
                <RTooltip
                  formatter={(v: number, n: string) => [fmtINRMoney(v), AGING_BUCKET_LABELS[n as never] ?? n]}
                  contentStyle={{ fontSize: 11 }}
                />
                {AGING_BUCKET_KEYS.map((k) => (
                  <Bar key={k} dataKey={k} stackId="a" fill={BUCKET_FILL[k]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-foreground/80 mb-2">Sales vs Collected, and Collection %</h3>
            <ResponsiveContainer width="100%" height={230}>
              <ComposedChart data={collChart} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="tier" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtINRMoney(Number(v))} />
                {/* A tier CAN collect more than 100% (paying down old debt), so the axis must not be
                    clamped at 120 — recharts would then emit an unrounded tick like "144.5948995%". */}
                <YAxis
                  yAxisId="r"
                  orientation="right"
                  domain={[0, "auto"]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${Math.round(Number(v))}%`}
                />
                <RTooltip
                  formatter={(v: number, n: string) => [n === "pct" ? `${v.toFixed(1)}%` : fmtINRMoney(v), n === "pct" ? "Collection %" : n === "sales" ? "Sales" : "Collected"]}
                  contentStyle={{ fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar yAxisId="l" dataKey="sales" name="Sales" fill="#93c5fd" />
                <Bar yAxisId="l" dataKey="collected" name="Collected" fill="#34d399" />
                <ReferenceLine yAxisId="r" y={65} stroke="#94a3b8" strokeDasharray="4 4" />
                <Line yAxisId="r" type="monotone" dataKey="pct" name="Collection %" stroke="#ea580c" strokeWidth={2} dot connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold text-foreground/80 mb-2">Share of the book (on Owed)</h3>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={shareChart} layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtINRMoney(Number(v))} />
                <YAxis type="category" dataKey="tier" width={38} tick={{ fontSize: 11 }} />
                <RTooltip formatter={(v: number) => [fmtINRMoney(v), "Owed"]} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="owed" radius={[0, 3, 3, 0]}>
                  {shareChart.map((d) => <Cell key={d.tier} fill={TIER_COLORS[d.tier]} />)}
                  <LabelList
                    dataKey="pct"
                    position="right"
                    formatter={(v: number) => `${v.toFixed(1)}%`}
                    style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Matrix */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category ×</span>
            <Select value={mxDim} onValueChange={(v) => { setMxDim(v as MatrixDim); setMxCell(null); }}>
              <SelectTrigger className="h-8 w-40 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{MATRIX_DIMS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={mxMeasure} onValueChange={(v) => setMxMeasure(v as MatrixMeasure)}>
              <SelectTrigger className="h-8 w-32 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{MATRIX_MEASURES.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex items-center gap-1 ml-1">
              {([["value", "₹"], ["row", "% of row"], ["col", "% of col"]] as [CellMode, string][]).map(([m, lbl]) => (
                <Button
                  key={m} size="sm"
                  variant={cellMode === m ? "default" : "outline"}
                  onClick={() => setCellMode(m)}
                  className={`h-7 px-2 rounded-button text-[11px] ${cellMode === m ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "border-border"}`}
                >
                  {lbl}
                </Button>
              ))}
            </div>
            {matrix.folded && (
              <span className="text-[10px] text-muted-foreground ml-1">
                showing top {matrix.cols.length - 1} · rest folded into “{MATRIX_OTHER}” (the Excel export has them all)
              </span>
            )}
          </div>

          <ScrollableTable maxHeight="max-h-[40vh]" className="rounded-lg border border-border">
            <Table className="border-collapse [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/70 [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="text-xs font-semibold text-foreground/70 sticky left-0 z-20 bg-muted">Category</TableHead>
                  {matrix.cols.map((c) => (
                    <TableHead key={c} className="text-right text-[11px] font-semibold text-foreground/60 whitespace-nowrap">{c}</TableHead>
                  ))}
                  <TableHead className="text-right text-[11px] font-semibold text-foreground/70">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrix.rows.map((r) => (
                  <TableRow key={r.tier} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-[13px] font-medium sticky left-0 z-10 bg-surface" style={{ borderLeft: `3px solid ${TIER_COLORS[r.tier]}` }}>
                      {r.label}
                    </TableCell>
                    {r.cells.map((v, i) => {
                      const on = mxCell?.tier === r.tier && mxCell?.col === matrix.cols[i];
                      const clickable = Math.abs(v) > EPS;
                      return (
                        <TableCell
                          key={matrix.cols[i]}
                          onClick={clickable ? () => setMxCell(
                            on ? null : { tier: r.tier, col: matrix.cols[i], ids: new Set(r.ids[i]) },
                          ) : undefined}
                          className={`text-right font-mono text-[12px] whitespace-nowrap ${
                            on ? "bg-primary/15 text-foreground font-semibold" : ""
                          } ${clickable ? "cursor-pointer hover:bg-primary/10" : "text-muted-foreground/50"}`}
                          title={clickable ? "Click to narrow the table below to this cell" : undefined}
                        >
                          {mxCellText(v, r.total, matrix.colTotals[i])}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono text-[12px] font-semibold whitespace-nowrap bg-muted/30">
                      {mxMeasureKind === "money" ? fmtINRMoney(r.total) : Math.round(r.total)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/60 font-semibold">
                  <TableCell className="text-[13px] uppercase tracking-wide sticky left-0 z-10 bg-muted">Total</TableCell>
                  {matrix.colTotals.map((v, i) => (
                    <TableCell key={matrix.cols[i]} className="text-right font-mono text-[12px] whitespace-nowrap">
                      {mxMeasureKind === "money" ? fmtINRMoney(v) : Math.round(v)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-[12px] whitespace-nowrap">
                    {mxMeasureKind === "money" ? fmtINRMoney(matrix.grand) : Math.round(matrix.grand)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </ScrollableTable>
        </CardContent>
      </Card>

      {/* View + filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <GroupByBuilder
              dimensions={CC_DIMENSIONS}
              presets={CC_PRESETS}
              value={groupBy}
              onChange={setGroupBy}
            />
            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer ml-1">
              <Checkbox checked={pinTierOrder} onCheckedChange={(v) => setPinTierOrder(!!v)} />
              Keep tiers in A→E order
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer…"
                className="h-9 w-52 rounded-input border border-border bg-surface pl-8 pr-7 text-sm outline-none focus:border-primary"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <MultiSelect options={customerOptions} value={customerNames} onChange={setCustomerNames} allLabel="All Customers" noun="Customers" />
            <MultiSelect options={groupOptions} value={groupNamesSel} onChange={setGroupNamesSel} allLabel="All Groups" noun="Groups" />
            <SalesPersonMultiSelect options={salesPersonOptions} value={salespersons} onChange={setSalespersons} />
            <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="Companies" />
            <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="Locations" />
            <CustomerCategoryMultiSelect value={categories} onChange={setCategories} />
            <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} />

            <div className="flex items-center gap-1">
              {MIN_OWED_OPTIONS.map((o) => (
                <Button
                  key={o.key} size="sm"
                  variant={minOwed === o.key ? "default" : "outline"}
                  onClick={() => setMinOwed(o.key)}
                  className={`h-8 px-2 rounded-button text-[11px] ${minOwed === o.key ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "border-border"}`}
                >
                  {o.label}
                </Button>
              ))}
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 rounded-input border-border text-xs">
                  <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> More
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-3" align="start">
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Accounts</div>
                  <Select value={activity} onValueChange={(v) => setActivity(v as Activity)}>
                    <SelectTrigger className="h-8 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((a) => (
                        <SelectItem key={a} value={a}>{ACTIVITY_LABELS[a]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                    {dormantCount} customers have never billed anything and carry no balance. They are hidden by
                    default — counting them makes a tier's customer count meaningless.
                  </p>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1.5">Mismatch sensitivity</div>
                  <Select value={String(gap)} onValueChange={(v) => setGap(Number(v))}>
                    <SelectTrigger className="h-8 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MISMATCH_GAP_OPTIONS.map((g) => (
                        <SelectItem key={g} value={String(g)}>
                          {g} grades apart {g === 2 ? "(standard)" : "(only the extremes)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={blockedOnly} onCheckedChange={(v) => setBlockedOnly(!!v)} />
                  Red Mark customers only
                </label>
              </PopoverContent>
            </Popover>
          </div>

          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
      </Card>

      {/* Basis */}
      <Card className="rounded-card border-border bg-surface">
        <button
          type="button"
          onClick={() => setBasisOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left"
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
            <Info className="h-3.5 w-3.5 text-primary" /> How this report is calculated
          </span>
          {basisOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {basisOpen && (
          <CardContent className="px-4 pb-4 pt-0">
            <ul className="space-y-2 text-xs text-muted-foreground leading-relaxed list-disc pl-4">
              {isLive && (
                <li>
                  <strong className="text-foreground">Source: the live Tally feed (ConnectWave).</strong>{" "}
                  The tier tag, Owed / Advances / Net, and the whole grade / aging / overdue side are read
                  straight from the live book — exact. Only <strong className="text-foreground">Opening</strong>,{" "}
                  <strong className="text-foreground">Collection %</strong> and{" "}
                  <strong className="text-foreground">Credit Notes</strong> are estimated: the live feed carries
                  credit and debit notes only as each customer's yearly total, spread across the months by sales.
                  Since Collection % never feeds the grade, this never moves anyone's tier.
                </li>
              )}
              <li>
                <strong className="text-foreground">The tier comes from the Credit-Limit sheet.</strong>{" "}
                It is typed by hand by Sales/Finance, not computed. Every customer lands in exactly one tier, so
                the shares add to 100%. <strong className="text-foreground">AA</strong> and{" "}
                <strong className="text-foreground">Uncategorized</strong> are shown and sorted last — neither is a
                grade. AA is an internal / related-party marker.
              </li>
              <li>
                <strong className="text-foreground">Owed, Advances and Net are three different things.</strong>{" "}
                <em>Owed</em> is what customers owe us (positive balances only). <em>Advances</em> is money they have
                pre-paid (negative balances) — {fmtINRMoney(Math.abs(t.advances))} of it, invisible everywhere else in
                this app. <em>Net</em> = Owed + Advances, and <strong className="text-foreground">Net is what ties to
                the Dashboard's Total Outstanding</strong>. % of Book always divides by <em>Owed</em>, never Net —
                tier E's net balance is <em>negative</em>, and a share of a negative number is nonsense.
              </li>
              <li>
                <strong className="text-foreground">Overdue and the aging buckets come from the bills.</strong>{" "}
                Summed from individual open invoices, so you can click any figure and read the invoice numbers
                behind it — and so this report ties exactly to the Aging Report and the Overdue-120 report.{" "}
                <strong className="text-foreground">It therefore reads slightly ABOVE the Dashboard's Overdue</strong>,
                which sums a stored ledger column instead. Net Outstanding still ties to the Dashboard exactly.
              </li>
              <li>
                <strong className="text-foreground">The behaviour grade deliberately ignores Collection %.</strong>{" "}
                Collection % runs about 41–48% across <em>every</em> tier — it carries no signal, and grading on it
                would rank D (which has ~43% of its money past 180 days) as one of the best tiers in the book. What
                actually separates a good customer from a bad one is <strong className="text-foreground">age</strong>:
                tier A has ~5% of its balance past 180 days, tier D has ~43%. So the grade is built from{" "}
                <strong className="text-foreground">45% share of balance past 180 days + 30% share overdue + 25% max
                days overdue</strong> — and Collection % stays on screen as a column, because it is still worth seeing.
              </li>
              <li>
                <strong className="text-foreground">The grade is a quintile, not a fixed threshold.</strong>{" "}
                Every customer <em>who owes money</em> is ranked on that score and cut into five equal fifths →
                behaves-A … behaves-E. A customer with no balance is <em>not scored</em> (shown as “—”), never graded E:
                having no debt is not the same as being a bad payer. Fixed cut-offs were tried and flagged 80% of the
                book; a rank cannot blow up or collapse.
              </li>
              <li>
                <strong className="text-foreground">A mismatch is a tag that contradicts the behaviour.</strong>{" "}
                Tagged tier vs behaviour grade, {gap} or more grades apart.{" "}
                <strong className="text-foreground">Over-graded</strong> = tagged better than they pay (an A who behaves
                like a D). <strong className="text-foreground">Under-graded</strong> = tagged worse than they pay.
                D and E can never be over-graded — there is no grade far enough below them. The Excel export's{" "}
                <em>Tag Mismatches</em> sheet ranks them by the money at stake, with the reason in plain English and a
                suggested tier.
              </li>
              <li>
                <strong className="text-foreground">Dormant ledgers are hidden by default.</strong>{" "}
                {dormantCount} customers have billed nothing anywhere in the data and carry no balance. They contribute
                to no column and only inflate the customer counts — 46% of the book is tagged E, and most of that is
                dead ledgers. Switch <em>Accounts</em> in the More menu to see them.
              </li>
              <li>
                <strong className="text-foreground">Category × Aging already exists.</strong>{" "}
                Use the <Link to="/outstanding-dashboard/reports/aging" className="text-primary hover:underline">Aging
                Report</Link> grouped by Customer Category — it is bill-wise on the same bills, so it agrees with this
                report to the rupee.
              </li>
              <li>
                <strong className="text-foreground">Getting around.</strong> Click a{" "}
                <strong className="text-foreground">Customer</strong> or{" "}
                <strong className="text-foreground">Customer Group</strong> row to open its detail page in a new tab.
                Click any <strong className="text-foreground">Owed</strong>, <strong className="text-foreground">Overdue</strong>{" "}
                or aging figure to see the bills behind it. Click a matrix cell to narrow the table to it. Use the{" "}
                <Pin className="h-3 w-3 inline" /> to freeze the name column.
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
                  {viewLabel || "Category"}
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
                      No customer matches {[...focus].map((f) => CC_FOCUS_LABELS[f]).join(" + ")}.
                      <button type="button" onClick={() => setFocus(new Set())} className="ml-1.5 text-primary hover:underline">
                        Clear the focus
                      </button>
                    </>
                  ) : (
                    "No customer matches these filters."
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

/** Follows the source toggle; pinned to Both FYs — see the file header. */
export default function CustomerCategoryReport() {
  return (
    <FYProvider>
      <CustomerCategoryInner />
    </FYProvider>
  );
}
