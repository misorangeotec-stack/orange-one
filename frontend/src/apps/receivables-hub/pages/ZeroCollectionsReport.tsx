import {
  useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment,
  type ReactNode, type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import {
  UserX, ChevronRight, ChevronDown, Download, ArrowLeft, Info, Pin, Search, X,
  ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Wallet, TrendingDown,
  CalendarClock, ShoppingCart, Ban,
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
import { MultiSelect } from "@hub/components/MultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { GroupByBuilder } from "@hub/components/GroupByBuilder";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useHubBase, useReceivablesSource } from "@hub/lib/sourceContext";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import { sumOutstanding } from "@hub/lib/receivables";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import { monthEndLong, monthStartLong } from "@hub/lib/months";
import {
  buildLastReceiptDates, buildMonthlySeries, factsFor, isZeroCollection,
  metricsOf, addMetrics, emptyMetrics, zcDimValue, monthRange, priorWindow, resolveWindow,
  applyFocus, totalsOf, detailPathFor,
  NEVER_PAID, PERIOD_LABELS, ZC_COLUMNS, ZC_DIMENSIONS, ZC_PRESETS, ZC_FOCUS_LABELS,
  type CollectionsSource, type PeriodPreset, type ZCColumn, type ZCColumnKey,
  type ZCDim, type ZCFocus, type ZCMetrics, type ZCRow,
} from "@hub/lib/zeroCollections";
import { exportZeroCollectionsXlsx } from "@hub/lib/exportZeroCollections";
import type { ConsolidatedCustomer } from "@hub/lib/types";

/**
 * Customers with Zero Collections.
 *
 * Who owes us money and has paid us NOTHING in the period — ranked by how much is stuck,
 * and flagged when we're still shipping to them (the "Sales in Window" column is the one
 * that gets a decision made).
 *
 * A management report, so the controls are deliberately thin: five one-click Views, six
 * filters on one line, everything else behind "More". The aggregation lives in
 * lib/zeroCollections.ts — read its header for why the window is month-granular and why
 * the convenient-looking Customer.lastReceiptDate / monthlyReceipts fields are a trap.
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

export default function ZeroCollectionsReport() {
  const source = useReceivablesSource();
  const collectionsSource: CollectionsSource = source === "connectwave" ? "live" : "pipeline";

  const {
    loading, allCustomers, consolidatedCustomers, customerDetail, customerGroupMap,
    dashboard, salesPersonOptions,
  } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";

  // The org-wide month list, chronological — the vocabulary every period control speaks.
  const months = useMemo(() => (dashboard?.trend ?? []).map((t) => t.month), [dashboard]);

  // ── Period ────────────────────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<PeriodPreset>("3m");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  // Seed the custom pickers from the active preset the first time months arrive, so
  // switching to Custom starts from what the user was already looking at.
  useEffect(() => {
    if (!months.length || customFrom) return;
    const w = resolveWindow(months, "3m");
    setCustomFrom(w[0] ?? months[0]);
    setCustomTo(w[w.length - 1] ?? months[months.length - 1]);
  }, [months, customFrom]);

  const windowMonths = useMemo(() => {
    if (preset === "custom") {
      return customFrom && customTo ? monthRange(months, customFrom, customTo) : [];
    }
    return resolveWindow(months, preset);
  }, [months, preset, customFrom, customTo]);

  const prevMonths = useMemo(() => priorWindow(months, windowMonths), [months, windowMonths]);

  const periodRange = windowMonths.length
    ? `${monthStartLong(windowMonths[0])} → ${
        windowMonths[windowMonths.length - 1] === months[months.length - 1]
          ? formatDateDMY(asOfDate)
          : monthEndLong(windowMonths[windowMonths.length - 1])
      }`
    : "—";
  const periodLabel = `${PERIOD_LABELS[preset]} (${periodRange})`;

  // ── Filters (the bar; the rest behind "More") ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const [groupNamesSel, setGroupNamesSel] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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
    () => new Set(Object.values(customerGroupMap.mapping)),
    [customerGroupMap],
  );
  const groupOptions = useMemo(() => [...realGroupNames].sort(), [realGroupNames]);

  // ── View ──────────────────────────────────────────────────────────────────────────
  // Chainable roll-up levels (Customer Group → Customer → Salesperson, in any order) via the
  // shared GroupByBuilder — the same control the Risk Register and Collection Report use.
  const [groupBy, setGroupBy] = useState<ZCDim[]>(["salesperson", "customer"]);
  const viewLabel = useMemo(
    () => groupBy.map((d) => ZC_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → "),
    [groupBy],
  );

  // ── Columns ───────────────────────────────────────────────────────────────────────
  const columnOptions: ColumnOption[] = ZC_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  const [visibleCols, setVisibleCols] = useState<string[]>(
    ZC_COLUMNS.filter((c) => c.default).map((c) => c.key),
  );
  const columns = useMemo<ZCColumn[]>(
    () => ZC_COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [visibleCols],
  );

  // ── Sorting ───────────────────────────────────────────────────────────────────────
  type SortKey = ZCColumnKey | "label";
  const [sortKey, setSortKey] = useState<SortKey>("outstanding");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "label" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30 inline" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" /> : <ArrowDown className="h-3 w-3 inline" />;
  };

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
  // lastReceiptDate carry only its FIRST ledger's values (consolidateByName spreads
  // ...entries[0] and doesn't override them). See lib/zeroCollections.ts.
  const series = useMemo(
    () => buildMonthlySeries(allCustomers, customerDetail, collectionsSource),
    [allCustomers, customerDetail, collectionsSource],
  );
  const lastDates = useMemo(
    () => buildLastReceiptDates(allCustomers, customerDetail, collectionsSource),
    [allCustomers, customerDetail, collectionsSource],
  );

  const groupOf = useCallback(
    (c: ConsolidatedCustomer) => customerGroupMap.mapping[c.name] ?? c.name,
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
  ]);

  /** The report itself: eligible customers who collected nothing in the window. */
  const rows = useMemo<ZCRow[]>(() => {
    if (!windowMonths.length) return [];
    const out: ZCRow[] = [];
    for (const c of eligible) {
      const facts = factsFor(c, series, lastDates, windowMonths, prevMonths, asOfDate);
      if (isZeroCollection(facts)) out.push({ customer: c, facts, group: groupOf(c) });
    }
    return out;
  }, [eligible, series, lastDates, windowMonths, prevMonths, asOfDate, groupOf]);

  // ── Focus (the clickable KPI cards) ───────────────────────────────────────────────
  // A layer ON TOP of the filter chain: eligible → rows → focusedRows. Lenses AND together.
  const [focus, setFocus] = useState<Set<ZCFocus>>(new Set());
  const toggleFocus = (f: ZCFocus) =>
    setFocus((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  const focusedRows = useMemo(() => applyFocus(rows, focus), [rows, focus]);

  // Reset paging/expansion whenever the shape of the report changes.
  useEffect(() => {
    setExpanded(new Set());
    setPage(1);
  }, [groupBy, search, customerNames, groupNamesSel, salespersons, companies, locations, categories, minOut, segment, blockedOnly, includeNonDebtors, preset, customFrom, customTo, focus]);

  // ── Roll-up ───────────────────────────────────────────────────────────────────────
  // Built from the FOCUSED rows, so the table, its grand total, pagination and the export
  // all follow the active lenses. The KPI cards deliberately do NOT — see `allTotals`.
  const tree = useMemo(
    () =>
      buildGroupTree<ZCRow, ZCMetrics>(focusedRows, groupBy, {
        dimValue: zcDimValue,
        idOf: (r) => r.customer.id,
        metricsOf,
        empty: emptyMetrics,
        add: addMetrics,
      }),
    [focusedRows, groupBy],
  );

  const sortedRoots = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return sortTree(tree.roots, (a, b) =>
      sortKey === "label"
        ? dir * a.label.localeCompare(b.label)
        : dir * (a.metrics[sortKey] - b.metrics[sortKey]),
    );
  }, [tree.roots, sortKey, sortDir]);

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
  const allTotals = useMemo(() => totalsOf(rows), [rows]);

  const kpis = useMemo(() => {
    const t = allTotals;
    const eligibleOutstanding = sumOutstanding(eligible);
    const neverPaidOutstanding = rows
      .filter((r) => r.facts.lastReceiptDate === null)
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
  }

  const kpiCards: KpiCard[] = [
    {
      label: "Zero-Collection Customers", icon: UserX, focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
    },
    {
      label: "Outstanding Locked", icon: Wallet, focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
    },
    {
      label: "Overdue Locked", icon: TrendingDown, focusKey: "overdue",
      value: fmtINRMoney(kpis.overdue),
      sub: "already past due date",
      count: kpis.overdue,
    },
    {
      label: "Never Paid", icon: Ban, focusKey: "never",
      value: String(kpis.neverPaid),
      sub: `${fmtINRMoney(kpis.neverPaidOutstanding)} · no receipt ever`,
      count: kpis.neverPaid,
    },
    {
      label: "Still Buying", icon: ShoppingCart, focusKey: "buying",
      value: String(kpis.stillBuying),
      sub: `${fmtINRMoney(kpis.salesInWindow)} billed in period`,
      count: kpis.stillBuying,
    },
    {
      label: "> 180 Days", icon: CalendarClock, focusKey: "over180",
      value: fmtINRMoney(kpis.over180),
      sub: "oldest, hardest money",
      count: kpis.over180,
    },
  ];

  // ── Filter chips ──────────────────────────────────────────────────────────────────
  const chips: FilterChip[] = [
    ...[...focus].map((f) => ({
      label: `Focus: ${ZC_FOCUS_LABELS[f]}`,
      onRemove: () => toggleFocus(f),
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
    minOut !== "0" && {
      label: `Min Outstanding: ${MIN_OUTSTANDING_OPTIONS.find((o) => o.key === minOut)?.label}`,
      onRemove: () => setMinOut("0"),
    },
    segment !== "all" && {
      label: `Segment: ${segment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setSegment("all"),
    },
    blockedOnly && { label: "Blocked only", onRemove: () => setBlockedOnly(false) },
    includeNonDebtors && { label: "Incl. zero & credit balances", onRemove: () => setIncludeNonDebtors(false) },
  ].filter(Boolean) as FilterChip[];

  const clearFilters = () => {
    setSearch(""); setCustomerNames([]); setGroupNamesSel([]);
    setSalespersons([]); setCompanies([]); setLocations([]);
    setCategories([]); setMinOut("0"); setSegment("all");
    setBlockedOnly(false); setIncludeNonDebtors(false);
    setFocus(new Set());
  };

  const filterSummary = useMemo(() => {
    const s: string[] = [];
    // Lenses first — they're the most drastic cut, and the exported sheet has to record
    // them or it's unauditable a week later.
    for (const f of focus) s.push(`Focus: ${ZC_FOCUS_LABELS[f]}`);
    if (search.trim()) s.push(`Search: ${search.trim()}`);
    if (customerNames.length) s.push(`Customer: ${customerNames.join(", ")}`);
    if (groupNamesSel.length) s.push(`Group: ${groupNamesSel.join(", ")}`);
    if (salespersons.length) s.push(`Salesperson: ${salespersons.join(", ")}`);
    if (companies.length) s.push(`Company: ${companies.join(", ")}`);
    if (locations.length) s.push(`Location: ${locations.join(", ")}`);
    if (categories.length) s.push(`Category: ${categories.join(", ")}`);
    if (minOut !== "0") s.push(`Min Outstanding: ${MIN_OUTSTANDING_OPTIONS.find((o) => o.key === minOut)?.label}`);
    if (segment !== "all") s.push(`Segment: ${segment === "active" ? "Active" : "No Activity"}`);
    if (blockedOnly) s.push("Blocked only");
    if (includeNonDebtors) s.push("Incl. zero & credit balances");
    return s;
  }, [focus, search, customerNames, groupNamesSel, salespersons, companies, locations, categories, minOut, segment, blockedOnly, includeNonDebtors]);

  // ── Export — WYSIWYG: same period, filters, FOCUS, view, sort and visible columns ──
  // `focusedRows` (not `rows`) feeds the flat Customers sheet: otherwise the roll-up sheet
  // would be focused while the flat sheet silently listed every customer — a mismatch you'd
  // only ever discover in Excel.
  const handleExport = () => {
    exportZeroCollectionsXlsx(sortedRoots, tree.total, focusedRows, columns, {
      viewLabel,
      periodLabel,
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
  /** Detail route for a node, or null when its dimension has no detail page.
   *  Keyed off the node's own DIMENSION, not its leaf-ness — so a Customer row stays
   *  clickable even when another level is chained beneath it. */
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
      const v = m[col.key];
      const clickable = !!col.drill && Math.abs(v) >= 0.5;
      const alarm = col.alarm && (col.kind === "days" ? v === NEVER_PAID || v > 180 : v > 0.5);
      const text =
        col.kind === "money" ? fmtINRMoney(v)
        : col.kind === "days" ? daysText(v)
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
            <UserX className="h-6 w-6 text-primary" /> Customers with Zero Collections
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customers who owe money and paid nothing in the period.
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

      {/* Period */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Period</span>
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
          <p className="text-[11px] text-muted-foreground">
            {periodRange}
            {windowMonths.length > 0 && windowMonths[windowMonths.length - 1] === months[months.length - 1] && (
              <span className="opacity-70"> · the current month is still in progress</span>
            )}
            {prevMonths.length > 0 && (
              <span className="opacity-70"> · “Prior Collections” compares against {monthStartLong(prevMonths[0])} → {monthEndLong(prevMonths[prevMonths.length - 1])}</span>
            )}
          </p>
        </CardContent>
      </Card>

      {/* KPIs — click to focus the table. The four lens cards AND together; the two summary
          cards describe the whole list, so clicking either clears every lens. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpiCards.map((k) => {
          const Icon = k.icon;
          const isSummary = k.focusKey === null;
          const active = isSummary ? focus.size === 0 : focus.has(k.focusKey!);
          // A card with nothing behind it isn't worth a click — EXCEPT while it's active, or
          // a filter that drives it to zero would strand a focus the user can't switch off.
          const clickable = isSummary ? rows.length > 0 : active || k.count > 0.5;
          return (
            <Card
              key={k.label}
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
              title={
                !clickable ? undefined
                : isSummary ? "Show all customers"
                : active ? `Remove the “${k.label}” focus`
                : `Show only these customers`
              }
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
          );
        })}
      </div>
      {focus.size > 0 && (
        <p className="text-[11px] text-primary -mt-3">
          Showing {focusedRows.length} of {rows.length} customers —{" "}
          {[...focus].map((f) => ZC_FOCUS_LABELS[f]).join(" + ")}
          {focus.size > 1 && <span className="text-muted-foreground"> (all conditions met)</span>}
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
                    <span className="text-xs text-foreground">Blocked customers only</span>
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

      {/* Basis note */}
      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          A customer is listed when they received <strong>no receipt voucher and no Other Payment</strong> in the period.
          Cheque returns are reported in their own column but do <strong>not</strong> count as a collection reversal here —
          a bounced payer still shows as having paid. Collections are month-wise, matching the Salesperson Collection
          Report exactly. The data horizon starts 01-04-2025, so <strong>“Never”</strong> means no receipt since then.
          There is no Sale Type filter: per-type collections are an estimate, and this report only makes claims it can prove.
          Click a <strong>Customer</strong> or <strong>Customer Group</strong> row to open its detail page in a new tab (use the caret to expand instead).
          Use the <Pin className="h-3 w-3 inline" /> to freeze the name column while scrolling.
        </span>
      </p>

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
                  {focus.size > 0 ? (
                    <>
                      No customer matches {[...focus].map((f) => ZC_FOCUS_LABELS[f]).join(" + ")}.
                      <button
                        type="button"
                        onClick={() => setFocus(new Set())}
                        className="ml-1.5 text-primary hover:underline"
                      >
                        Clear the focus
                      </button>
                    </>
                  ) : (
                    "No customer matches — everyone who owes money paid something in this period."
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
