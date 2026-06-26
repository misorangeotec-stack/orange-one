import { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment, type ReactNode, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock, ChevronRight, ChevronDown, Download, Plus, X, ArrowLeft, Info, Pin,
  ArrowUpDown, ArrowUp, ArrowDown, Search,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { MultiSelect } from "@hub/components/MultiSelect";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import {
  enumerateBills, ledgerAdjBill, buildAgingTree, billMatchesPath, billMatchesColumn,
  AGING_COLUMNS, DIMENSION_LABELS, DIMENSION_ORDER,
  type AgingDimension, type AgingNode, type AgingColumn, type EnrichedBill, type MetricKey,
} from "@hub/lib/agingReport";
import { exportAgingReportXlsx } from "@hub/lib/exportAgingReport";
import type { SaleType } from "@hub/lib/types";

/** Map an enumerated bill to the drill-down dialog's row shape. */
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

const PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/** Quick group-by presets matching how the report is read day-to-day. */
const PRESETS: { label: string; dims: AgingDimension[] }[] = [
  { label: "Sale Type", dims: ["saleType"] },
  { label: "Customer", dims: ["customer"] },
  { label: "Customer Group", dims: ["group"] },
  { label: "Salesperson", dims: ["salesperson"] },
  { label: "Customer Category", dims: ["category"] },
  { label: "Sale Type → Customer", dims: ["saleType", "customer"] },
  { label: "Salesperson → Customer", dims: ["salesperson", "customer"] },
  { label: "Customer Group → Customer", dims: ["group", "customer"] },
  { label: "Customer Category → Customer", dims: ["category", "customer"] },
];

export default function AgingReport() {
  const { loading, customers, customerDetail, dashboard, salesPersonOptions, customerGroupMap } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";

  // ── Filters ────────────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  // Customer Segment — mirrors the Dashboard / Risk Register / Collection Report filter.
  // "Active" = had any activity (sales / receipts / credit notes / other payments) in the FY,
  // judged on the customer's COMBINED (consolidate-by-name) totals. Defaults to Active so this
  // report's Total Outstanding lines up with the Collection Report's Outstanding (Today), which
  // is also Active-by-default. (A residual gap remains: this report is bill-wise gross, the
  // Collection Report's figure is net ledger balance — a known pipeline-basis difference.)
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  // Free-text search across the rows below — matches any group / customer / sale-type
  // label (or its sub-label) at any level of the roll-up. Space-separated tokens are
  // AND-ed against the node's path text, so "ink mumbai" finds Mumbai rows under Ink.
  const [search, setSearch] = useState("");

  const companyOptions = useMemo(
    () => [...new Set(customers.map((c) => c.company).filter(Boolean))].sort(),
    [customers],
  );
  const locationOptions = useMemo(
    () => [...new Set(customers.map((c) => c.location).filter(Boolean))].sort(),
    [customers],
  );
  const customerOptions = useMemo(
    () => [...new Set(customers.map((c) => c.name).filter(Boolean))].sort(),
    [customers],
  );

  // ── Grouping ─────────────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<AgingDimension[]>(["saleType"]);

  const setLevel = (i: number, dim: AgingDimension) =>
    setGroupBy((prev) => {
      const next = [...prev];
      next[i] = dim;
      // Drop the dimension if it was already used at another level (no dup levels).
      return next.filter((d, idx) => idx === i || d !== dim);
    });
  const addLevel = () =>
    setGroupBy((prev) => {
      const used = new Set(prev);
      const avail = DIMENSION_ORDER.find((d) => !used.has(d));
      return avail ? [...prev, avail] : prev;
    });
  const removeLevel = (i: number) =>
    setGroupBy((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  // ── Columns ──────────────────────────────────────────────────────────────────
  const columnOptions: ColumnOption[] = AGING_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
  const [visibleCols, setVisibleCols] = useState<string[]>(AGING_COLUMNS.map((c) => c.key));
  const visibleColumns = useMemo(
    () => AGING_COLUMNS.filter((c) => visibleCols.includes(c.key)),
    [visibleCols],
  );
  const outstandingCount = visibleColumns.filter((c) => c.group === "outstanding").length;
  const overdueCount = visibleColumns.filter((c) => c.group === "overdue").length;

  // ── Expand / pagination ──────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  // ── Freeze panes ─────────────────────────────────────────────────────────────
  // Excel-style freeze of the leading columns (chevron + the group-by label) so the
  // group name stays visible while scrolling right through the aging buckets.
  // 0 = none, 1 = frozen (default). The user toggles it via the pin in the label header.
  const [freezeLevel, setFreezeLevel] = useState<0 | 1>(1);
  const chevRef = useRef<HTMLTableCellElement>(null);
  const labelRef = useRef<HTMLTableCellElement>(null);
  const [colW, setColW] = useState({ chev: 32, label: 200 });
  const measureCols = useCallback(() => {
    const chev = chevRef.current?.offsetWidth ?? 32;
    const label = labelRef.current?.offsetWidth ?? 200;
    setColW((prev) => (prev.chev === chev && prev.label === label ? prev : { chev, label }));
  }, []);
  useLayoutEffect(measureCols); // re-measure after every render; setState is guarded so it can't loop
  useEffect(() => {
    window.addEventListener("resize", measureCols);
    return () => window.removeEventListener("resize", measureCols);
  }, [measureCols]);

  // ── Sorting ──────────────────────────────────────────────────────────────────
  // Click a column to sort every level of the roll-up by it; "label" sorts the
  // group-name column alphabetically. Default: biggest Total Outstanding first.
  type SortKey = MetricKey | "label";
  const [sortKey, setSortKey] = useState<SortKey>("totalOutstanding");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "label" ? "asc" : "desc"); }
  };
  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30 inline" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" /> : <ArrowDown className="h-3 w-3 inline" />;
  };

  // Reset expansion + paging when the shape of the report changes.
  useEffect(() => {
    setExpanded(new Set());
    setPage(1);
  }, [groupBy, companies, locations, salespersons, categories, customerSegment, saleTypes, customerNames, search]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Scope the customer set (category + Customer Segment) ─────────────────────
  // The company / location / salesperson / customer-name filters are applied inside
  // enumerateBills (via `filters`); here we narrow the customer universe by category
  // and the Customer Segment. Segment is judged on each customer's COMBINED (consolidate-
  // by-name) activity over the same dimension-filtered set the Collection Report uses, so
  // an opening-balance-only ledger of a customer who is active elsewhere stays in "Active"
  // and the two reports reconcile. (Mirrors SalespersonCollectionReport's segment logic.)
  const scopedCustomers = useMemo(() => {
    let d = customers.filter((c) => matchesCategory(c, categories));
    if (companies.length > 0) { const s = new Set(companies); d = d.filter((c) => s.has(c.company)); }
    if (locations.length > 0) { const s = new Set(locations); d = d.filter((c) => s.has(c.location)); }
    if (salespersons.length > 0) { const s = new Set(salespersons); d = d.filter((c) => s.has(c.salesPerson)); }
    if (customerNames.length > 0) { const s = new Set(customerNames); d = d.filter((c) => s.has(c.name)); }
    if (customerSegment !== "all") {
      const act = new Map<string, number>();
      for (const c of d) {
        const a = c.sales + c.receipts + c.creditNotes + (c.otherPayments ?? 0);
        act.set(c.name, (act.get(c.name) ?? 0) + a);
      }
      d = d.filter((c) =>
        customerSegment === "active" ? (act.get(c.name) ?? 0) > 0 : (act.get(c.name) ?? 0) <= 0,
      );
    }
    return d;
  }, [customers, categories, companies, locations, salespersons, customerNames, customerSegment]);

  // ── Build the bill list + tree ───────────────────────────────────────────────
  const filters = useMemo(
    () => ({ companies, locations, salespersons, saleTypes: saleTypes as SaleType[], customerNames }),
    [companies, locations, salespersons, saleTypes, customerNames],
  );
  const baseBills = useMemo(
    () =>
      enumerateBills(
        scopedCustomers,
        customerDetail,
        asOfDate,
        filters,
        customerGroupMap.mapping,
      ),
    [scopedCustomers, customerDetail, asOfDate, filters, customerGroupMap],
  );
  // Anchor each customer's Total Outstanding to its NET ledger balance (c.outstanding) — the
  // SAME figure the dashboard / Salesperson Collection Report show — by injecting one synthetic
  // "ledger adjustment" line per customer carrying (c.outstanding − Σ that customer's real bills).
  // It lands in the dedicated "Unbilled Adj." column, so the age / on-account / overdue buckets
  // stay bill-wise while the grand total ties EXACTLY to Outstanding (Today). Skipped under a
  // sale-type FILTER: c.outstanding isn't split by type, so we can't anchor per-type there and
  // fall back to pure bill-wise (matching the Collection Report, which also estimates by type).
  const bills = useMemo(() => {
    const stActive = saleTypes.length > 0 && saleTypes.length < 5;
    if (stActive) return baseBills;
    const billNet = new Map<string, number>();
    for (const b of baseBills) billNet.set(b.cust.id, (billNet.get(b.cust.id) ?? 0) + b.inv.pending);
    const extra: EnrichedBill[] = [];
    for (const c of scopedCustomers) {
      const adj = c.outstanding - (billNet.get(c.id) ?? 0);
      if (Math.abs(adj) >= 0.5) extra.push(ledgerAdjBill(c, adj, customerGroupMap.mapping));
    }
    return extra.length ? [...baseBills, ...extra] : baseBills;
  }, [baseBills, scopedCustomers, customerGroupMap, saleTypes]);
  const tree = useMemo(() => buildAgingTree(bills, groupBy, asOfDate), [bills, groupBy, asOfDate]);

  // Re-sort every level of the roll-up by the active column (the tree builder seeds
  // a Total-Outstanding-desc order; this lets the user re-sort interactively).
  const sortedRoots = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const sortNodes = (nodes: AgingNode[]): AgingNode[] =>
      [...nodes]
        .sort((a, b) =>
          sortKey === "label"
            ? dir * a.label.localeCompare(b.label)
            : dir * (a.metrics[sortKey] - b.metrics[sortKey]),
        )
        .map((n) => (n.children.length ? { ...n, children: sortNodes(n.children) } : n));
    return sortNodes(tree.roots);
  }, [tree.roots, sortKey, sortDir]);

  // ── Free-text search ─────────────────────────────────────────────────────────
  // Filter the roll-up to rows that match the query. A node is kept if its own
  // label/sub matches (its whole subtree comes along), or if any descendant matches
  // (the node is kept as a path to that match, with only matching children). Tokens
  // are matched against the node's text combined with its ancestors', so a search can
  // span levels (e.g. parent sale type + child customer). Matches auto-expand below.
  const searchActive = search.trim().length > 0;
  const filteredRoots = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return sortedRoots;
    const nodeText = (n: AgingNode) => `${n.label} ${n.sub ?? ""}`.toLowerCase();
    const filter = (nodes: AgingNode[], ancestorText: string): AgingNode[] =>
      nodes.reduce<AgingNode[]>((acc, n) => {
        const text = `${ancestorText} ${nodeText(n)}`;
        if (tokens.every((t) => text.includes(t))) { acc.push(n); return acc; } // self/path match → keep subtree
        const kids = n.children.length ? filter(n.children, text) : [];
        if (kids.length) acc.push({ ...n, children: kids });
        return acc;
      }, []);
    return filter(sortedRoots, "");
  }, [sortedRoots, search]);

  // ── Invoice drill-down ───────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[] }>({
    open: false,
    title: "",
    subtitle: "",
    rows: [],
  });

  // Drill matches the clicked column directly (billMatchesColumn handles sign):
  // the age buckets → positive bills, On Account → negative credits, Total → all (net).
  const openDrillFor = (node: AgingNode | null, col: AgingColumn) => {
    let matched: EnrichedBill[];
    let scopeLabel: string;
    if (node) {
      matched = bills.filter((b) => billMatchesPath(b, node.path) && billMatchesColumn(b, col.key));
      scopeLabel = node.sub ? `${node.label} · ${node.sub}` : node.label;
    } else {
      matched = bills.filter((b) => billMatchesColumn(b, col.key));
      scopeLabel = "All groups";
    }
    const rows = matched.map(toDrillRow);
    if (rows.length === 0) return;
    const lens = col.group === "outstanding" ? "Outstanding" : "Overdue";
    setDrill({ open: true, title: `${lens} · ${col.label}`, subtitle: scopeLabel, rows });
  };

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredRoots.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRoots =
    pageSize === "all" ? filteredRoots : filteredRoots.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ── Filter chips ─────────────────────────────────────────────────────────────
  const chips: FilterChip[] = [
    searchActive && { label: `Search: “${search.trim()}”`, onRemove: () => setSearch("") },
    companies.length > 0 && { label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) },
    locations.length > 0 && { label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) },
    salespersons.length > 0 && { label: `Salesperson: ${salespersons.length} sel.`, onRemove: () => setSalespersons([]) },
    categories.length > 0 && { label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) },
    customerSegment !== "all" && {
      label: `Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setCustomerSegment("all"),
    },
    saleTypes.length > 0 && { label: `Sale Type: ${saleTypes.length} sel.`, onRemove: () => setSaleTypes([]) },
    customerNames.length > 0 && {
      label: customerNames.length <= 2 ? `Customer: ${customerNames.join(", ")}` : `Customer: ${customerNames.length} sel.`,
      onRemove: () => setCustomerNames([]),
    },
  ].filter(Boolean) as FilterChip[];

  const clearFilters = () => {
    setSearch("");
    setCompanies([]);
    setLocations([]);
    setSalespersons([]);
    setCategories([]);
    setCustomerSegment("all");
    setSaleTypes([]);
    setCustomerNames([]);
  };

  const handleExport = () => {
    const filterSummary: string[] = [];
    if (companies.length) filterSummary.push(`Company: ${companies.join(", ")}`);
    if (locations.length) filterSummary.push(`Location: ${locations.join(", ")}`);
    if (salespersons.length) filterSummary.push(`Salesperson: ${salespersons.join(", ")}`);
    if (categories.length) filterSummary.push(`Category: ${categories.join(", ")}`);
    if (customerSegment !== "all") filterSummary.push(`Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`);
    if (saleTypes.length) filterSummary.push(`Sale Type: ${saleTypes.join(", ")}`);
    if (customerNames.length) filterSummary.push(`Customer: ${customerNames.join(", ")}`);
    exportAgingReportXlsx(tree, { groupBy, asOfDate, filterSummary });
  };

  // ── Frozen columns (freeze panes) ──────────────────────────────────────────
  // Each frozen cell is `position: sticky` with a cumulative `left` offset and an
  // OPAQUE background (so scrolled cells pass underneath); the label column (the
  // rightmost frozen one) carries an edge shadow.
  type FreezeId = "chevron" | "label";
  type FreezeStick = { className: string; style?: CSSProperties };
  const leftOf = (id: FreezeId): number => (id === "chevron" ? 0 : colW.chev);
  /** Sticky props for a leading column cell, or empty when freeze is off.
   *  `bg` is the OPAQUE background to use (defaults: header → muted, body → surface). */
  const freezeStick = (id: FreezeId, opts?: { header?: boolean; bg?: string }): FreezeStick => {
    if (freezeLevel < 1) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const shadow = id === "label" ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : ""; // edge on the boundary
    return { className: `sticky ${opts?.header ? "z-20" : "z-10"} ${bg} ${shadow}`, style: { left: leftOf(id) } };
  };
  /** Pin button in the label header — toggles the freeze on/off. */
  const freezePin = () => {
    const active = freezeLevel >= 1;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setFreezeLevel(active ? 0 : 1); }}
        className={`ml-1 inline-flex items-center justify-center h-4 w-4 rounded shrink-0 ${active ? "text-primary" : "text-foreground/35 hover:text-foreground/70"}`}
        title={active ? "Unfreeze the group column" : "Freeze the group column while scrolling"}
      >
        <Pin className={`h-3 w-3 ${active ? "fill-primary" : ""}`} />
      </button>
    );
  };

  // ── Row rendering (recursive; pagination applies to top-level only) ──────────
  const metricCells = (node: AgingNode | null, isTotal: boolean): ReactNode =>
    visibleColumns.map((col, idx) => {
      const v = node ? node.metrics[col.key] : tree.total[col.key];
      const clickable = Math.abs(v) >= 0.5;
      const firstOfGroup =
        (col.group === "outstanding" && idx === 0) ||
        (col.group === "overdue" && visibleColumns[idx - 1]?.group === "outstanding");
      return (
        <TableCell
          key={col.key}
          onClick={clickable ? (e) => { e.stopPropagation(); openDrillFor(node, col); } : undefined}
          title={clickable ? "Click to see the bills" : undefined}
          className={`text-right font-mono whitespace-nowrap ${firstOfGroup ? "!border-l-2 !border-l-border" : ""} ${col.grand ? "bg-emerald-100 font-bold" : col.total ? "bg-emerald-50 font-semibold" : ""} ${clickable ? "cursor-pointer hover:underline hover:text-primary" : ""} ${
            col.group === "overdue" && (col.key === "od_180_plus" || col.key === "od_121_180") && v > 0.5
              ? "text-destructive"
              : ""
          } ${isTotal ? "text-sm" : "text-[13px]"}`}
        >
          {fmtINRMoney(v)}
        </TableCell>
      );
    });

  const renderNodes = (nodes: AgingNode[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      // While searching, force every matched branch open so nested hits are visible.
      const isOpen = searchActive || expanded.has(n.key);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      return (
        <Fragment key={n.key}>
          <TableRow
            className={`group ${tint} ${hasChildren ? "cursor-pointer hover:bg-muted/40" : ""} transition-colors`}
            onClick={hasChildren ? () => toggle(n.key) : undefined}
          >
            {(() => { const bg = hasChildren ? "bg-surface group-hover:bg-[hsl(var(--muted))]" : "bg-surface"; const f = freezeStick("chevron", { bg }); return (
              <TableCell style={f.style} className={`text-muted-foreground ${f.className}`}>
                {hasChildren && (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
              </TableCell>
            ); })()}
            {(() => { const bg = hasChildren ? "bg-surface group-hover:bg-[hsl(var(--muted))]" : "bg-surface"; const f = freezeStick("label", { bg }); return (
              <TableCell
                className={`whitespace-nowrap ${n.depth === 0 ? "font-medium text-sm" : "text-[13px] text-muted-foreground"} ${f.className}`}
                style={{ ...f.style, paddingLeft: 8 + n.depth * 18 }}
              >
                {n.label}
                {n.sub && <span className="ml-1.5 text-[10px] font-normal opacity-70">{n.sub}</span>}
                {hasChildren && <span className="ml-1.5 text-[11px] opacity-70">({n.children.length})</span>}
              </TableCell>
            ); })()}
            {metricCells(n, false)}
          </TableRow>
          {isOpen && hasChildren && renderNodes(n.children)}
        </Fragment>
      );
    });

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Reports
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" /> Aging Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            Outstanding by invoice age and overdue by days past due.
            {asOfDate && <span className="text-foreground/70">As of {formatDateDMY(asOfDate)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnPicker columns={columnOptions} visible={visibleCols} onChange={setVisibleCols} />
          <Button onClick={handleExport} size="sm" className="rounded-button bg-primary hover:bg-primary-hover text-primary-foreground">
            <Download className="h-4 w-4 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {/* Group-by builder */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">View</span>
            {PRESETS.map((p) => {
              const active = JSON.stringify(p.dims) === JSON.stringify(groupBy);
              return (
                <Button
                  key={p.label}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => setGroupBy(p.dims)}
                  className={`h-7 text-xs rounded-button ${active ? "bg-primary text-primary-foreground" : "border-border"}`}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Group by</span>
            {groupBy.map((dim, i) => {
              const used = new Set(groupBy.filter((_, idx) => idx !== i));
              const opts = DIMENSION_ORDER.filter((d) => d === dim || !used.has(d));
              return (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground text-xs">→</span>}
                  <Select value={dim} onValueChange={(v) => setLevel(i, v as AgingDimension)}>
                    <SelectTrigger className="h-8 w-40 rounded-input border-border text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((d) => (
                        <SelectItem key={d} value={d}>{DIMENSION_LABELS[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {groupBy.length > 1 && (
                    <button onClick={() => removeLevel(i)} className="text-muted-foreground hover:text-destructive" title="Remove level">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {groupBy.length < DIMENSION_ORDER.length && (
              <Button variant="ghost" size="sm" onClick={addLevel} className="h-7 text-xs text-muted-foreground">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add level
              </Button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Filters</span>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, sale type…"
                  className="h-8 w-48 pl-7 pr-6 text-xs rounded-input border border-border bg-surface text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
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
              <MultiSelect options={customerOptions} value={customerNames} onChange={setCustomerNames} allLabel="All Customers" noun="customers" triggerClassName="h-8 w-48 text-xs rounded-input" />
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <SalesPersonMultiSelect options={salesPersonOptions} value={salespersons} onChange={setSalespersons} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <Select value={customerSegment} onValueChange={(v) => setCustomerSegment(v as "all" | "active" | "no_activity")}>
                <SelectTrigger className="h-8 w-40 rounded-input border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="no_activity">No Activity</SelectItem>
                </SelectContent>
              </Select>
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-40 text-xs rounded-input" />
            </div>
          </div>
          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
      </Card>

      {/* Basis note */}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Total Outstanding = Out&lt;180 + Out&gt;180 + On Account + Unbilled Adj, and is anchored to the NET ledger balance — so it ties exactly to the Dashboard / Salesperson Collection Report's "Outstanding (Today)". The age buckets &amp; On Account are bill-wise; "Unbilled Adj." is the part of the net balance not on any bill (advances w/o a bill, cheque returns, opening residue, sync gaps). Overdue buckets remain bill-wise. Under a Sale Type filter the total falls back to bill-wise (the net balance isn't split by type).
        <span className="inline-flex items-center gap-1">· use the <Pin className="h-3 w-3 inline" /> on the group column to freeze it while scrolling.</span>
      </p>

      {/* Table */}
      <ScrollableTable maxHeight="max-h-[62vh]" className="rounded-lg border border-border">
        <Table className="border-collapse [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/70 [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r [&_th]:border-r-border [&_td]:border-r-border/60">
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead ref={chevRef} rowSpan={2} style={freezeStick("chevron", { header: true }).style} className={`w-8 ${freezeStick("chevron", { header: true }).className}`} />
              <TableHead
                ref={labelRef}
                rowSpan={2}
                style={freezeStick("label", { header: true }).style}
                className={`text-xs font-semibold text-foreground/70 whitespace-nowrap align-bottom pb-2 cursor-pointer select-none ${freezeStick("label", { header: true }).className}`}
                onClick={() => toggleSort("label")}
              >
                <span className="inline-flex items-center gap-1">
                  {groupBy.map((d) => DIMENSION_LABELS[d]).join(" → ")}
                  {sortIcon("label")}
                  {freezePin()}
                </span>
              </TableHead>
              {outstandingCount > 0 && (
                <TableHead colSpan={outstandingCount} className="text-center text-xs font-semibold text-foreground/70 !border-l-2 !border-l-border whitespace-nowrap">
                  Outstanding <span className="font-normal opacity-70">(by invoice age)</span>
                </TableHead>
              )}
              {overdueCount > 0 && (
                <TableHead colSpan={overdueCount} className="text-center text-xs font-semibold text-foreground/70 !border-l-2 !border-l-border whitespace-nowrap">
                  Overdue <span className="font-normal opacity-70">(by days past due)</span>
                </TableHead>
              )}
            </TableRow>
            <TableRow className="bg-muted/50">
              {visibleColumns.map((col, idx) => {
                const firstOfGroup =
                  (col.group === "outstanding" && idx === 0) ||
                  (col.group === "overdue" && visibleColumns[idx - 1]?.group === "outstanding");
                return (
                  <TableHead
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`text-right text-[11px] font-semibold whitespace-nowrap cursor-pointer select-none ${firstOfGroup ? "!border-l-2 !border-l-border" : ""} ${col.grand ? "bg-emerald-200 text-emerald-950" : col.total ? "bg-emerald-100 text-emerald-900" : "text-foreground/60"}`}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">{col.label}{sortIcon(col.key)}</span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 2} className="text-center py-12 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : tree.roots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 2} className="text-center py-12 text-muted-foreground">
                  No open bills match your filters.
                </TableCell>
              </TableRow>
            ) : filteredRoots.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 2} className="text-center py-12 text-muted-foreground">
                  No rows match “{search.trim()}”.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {/* Grand total */}
                <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                  <TableCell style={freezeStick("chevron", { bg: "bg-muted" }).style} className={freezeStick("chevron", { bg: "bg-muted" }).className} />
                  <TableCell style={freezeStick("label", { bg: "bg-muted" }).style} className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${freezeStick("label", { bg: "bg-muted" }).className}`}>Grand Total</TableCell>
                  {metricCells(null, true)}
                </TableRow>
                {renderNodes(pagedRoots)}
              </>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      {/* Pagination */}
      {filteredRoots.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(v === "all" ? "all" : (Number(v) as PageSize)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-20 rounded-input border-border text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={String(s)} value={String(s)}>{s === "all" ? "All" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              {filteredRoots.length} top-level {filteredRoots.length === 1 ? "group" : "groups"}
              {searchActive && <span className="opacity-70"> · matching “{search.trim()}”</span>}
            </span>
          </div>
          {pageSize !== "all" && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 rounded-button border-border" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span>Page {safePage} of {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8 rounded-button border-border" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Invoice drill-down — opens when a metric cell is clicked */}
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
