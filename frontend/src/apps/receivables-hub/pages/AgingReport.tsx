import { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, Fragment, type ReactNode, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock, ChevronRight, ChevronDown, Download, Plus, X, ArrowLeft, Info, Pin,
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
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { InvoiceDrilldownDialog, type InvoiceDrillRow } from "@hub/components/InvoiceDrilldownDialog";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import {
  enumerateBills, buildAgingTree, billMatchesPath, billMatchesColumn,
  AGING_COLUMNS, DIMENSION_LABELS, DIMENSION_ORDER,
  type AgingDimension, type AgingNode, type AgingColumn, type EnrichedBill,
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
  { label: "Sale Type → Customer", dims: ["saleType", "customer"] },
  { label: "Salesperson → Customer", dims: ["salesperson", "customer"] },
  { label: "Customer Group → Customer", dims: ["group", "customer"] },
];

export default function AgingReport() {
  const { loading, customers, customerDetail, dashboard, salesPersonOptions, customerGroupMap } = useAppData({});
  const asOfDate = dashboard?.asOfDate ?? "";

  // ── Filters ────────────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [salespersons, setSalespersons] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);

  const companyOptions = useMemo(
    () => [...new Set(customers.map((c) => c.company).filter(Boolean))].sort(),
    [customers],
  );
  const locationOptions = useMemo(
    () => [...new Set(customers.map((c) => c.location).filter(Boolean))].sort(),
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

  // Reset expansion + paging when the shape of the report changes.
  useEffect(() => {
    setExpanded(new Set());
    setPage(1);
  }, [groupBy, companies, locations, salespersons, saleTypes]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Build the bill list + tree ───────────────────────────────────────────────
  const filters = useMemo(
    () => ({ companies, locations, salespersons, saleTypes: saleTypes as SaleType[] }),
    [companies, locations, salespersons, saleTypes],
  );
  const bills = useMemo(
    () => enumerateBills(customers, customerDetail, asOfDate, filters, customerGroupMap.mapping),
    [customers, customerDetail, asOfDate, filters, customerGroupMap],
  );
  const tree = useMemo(() => buildAgingTree(bills, groupBy, asOfDate), [bills, groupBy, asOfDate]);

  // ── Invoice drill-down ───────────────────────────────────────────────────────
  const [drill, setDrill] = useState<{ open: boolean; title: string; subtitle: string; rows: InvoiceDrillRow[] }>({
    open: false,
    title: "",
    subtitle: "",
    rows: [],
  });

  // Drill rules mirror the row split: grand total = all bills (net); a normal
  // group row = its positive bills; the On Account row = the negative credits.
  const openDrillFor = (node: AgingNode | null, col: AgingColumn) => {
    let matched: EnrichedBill[];
    let scopeLabel: string;
    if (node?.isOnAccount) {
      matched = bills.filter((b) => b.inv.pending < 0 && billMatchesColumn(b, col.key));
      scopeLabel = node.label;
    } else if (node) {
      matched = bills.filter((b) => b.inv.pending > 0 && billMatchesPath(b, node.path) && billMatchesColumn(b, col.key));
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

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(tree.roots.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRoots =
    pageSize === "all" ? tree.roots : tree.roots.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ── Filter chips ─────────────────────────────────────────────────────────────
  const chips: FilterChip[] = [
    companies.length > 0 && { label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) },
    locations.length > 0 && { label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) },
    salespersons.length > 0 && { label: `Salesperson: ${salespersons.length} sel.`, onRemove: () => setSalespersons([]) },
    saleTypes.length > 0 && { label: `Sale Type: ${saleTypes.length} sel.`, onRemove: () => setSaleTypes([]) },
  ].filter(Boolean) as FilterChip[];

  const clearFilters = () => {
    setCompanies([]);
    setLocations([]);
    setSalespersons([]);
    setSaleTypes([]);
  };

  const handleExport = () => {
    const filterSummary: string[] = [];
    if (companies.length) filterSummary.push(`Company: ${companies.join(", ")}`);
    if (locations.length) filterSummary.push(`Location: ${locations.join(", ")}`);
    if (salespersons.length) filterSummary.push(`Salesperson: ${salespersons.join(", ")}`);
    if (saleTypes.length) filterSummary.push(`Sale Type: ${saleTypes.join(", ")}`);
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
      const isOpen = expanded.has(n.key);
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
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <SalesPersonMultiSelect options={salesPersonOptions} value={salespersons} onChange={setSalespersons} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-40 text-xs rounded-input" />
            </div>
          </div>
          {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}
        </CardContent>
      </Card>

      {/* Basis note */}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Bill-wise (gross) basis — sums open-bill pending, like the source workbook. May differ slightly from the dashboard's net outstanding. Overdue ⊆ Outstanding.
        <span className="inline-flex items-center gap-1">· use the <Pin className="h-3 w-3 inline" /> on the group column to freeze it while scrolling.</span>
      </p>

      {/* Table */}
      <ScrollableTable maxHeight="max-h-[62vh]" className="rounded-lg border border-border">
        <Table className="border-collapse [&_th]:border-b [&_th]:border-border [&_td]:border-b [&_td]:border-border/70 [&_th:not(:last-child)]:border-r [&_td:not(:last-child)]:border-r [&_th]:border-r-border [&_td]:border-r-border/60">
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead ref={chevRef} rowSpan={2} style={freezeStick("chevron", { header: true }).style} className={`w-8 ${freezeStick("chevron", { header: true }).className}`} />
              <TableHead ref={labelRef} rowSpan={2} style={freezeStick("label", { header: true }).style} className={`text-xs font-semibold text-foreground/70 whitespace-nowrap align-bottom pb-2 ${freezeStick("label", { header: true }).className}`}>
                <span className="inline-flex items-center gap-1">
                  {groupBy.map((d) => DIMENSION_LABELS[d]).join(" → ")}
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
                    className={`text-right text-[11px] font-semibold whitespace-nowrap ${firstOfGroup ? "!border-l-2 !border-l-border" : ""} ${col.grand ? "bg-emerald-200 text-emerald-950" : col.total ? "bg-emerald-100 text-emerald-900" : "text-foreground/60"}`}
                  >
                    {col.label}
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
            ) : (
              <>
                {/* Grand total */}
                <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                  <TableCell style={freezeStick("chevron", { bg: "bg-muted" }).style} className={freezeStick("chevron", { bg: "bg-muted" }).className} />
                  <TableCell style={freezeStick("label", { bg: "bg-muted" }).style} className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${freezeStick("label", { bg: "bg-muted" }).className}`}>Grand Total</TableCell>
                  {metricCells(null, true)}
                </TableRow>
                {renderNodes(pagedRoots)}
                {tree.onAccount && (
                  <TableRow className="bg-amber-50/70 border-t-2 border-border/50">
                    <TableCell style={freezeStick("chevron", { bg: "bg-amber-50" }).style} className={freezeStick("chevron", { bg: "bg-amber-50" }).className} />
                    <TableCell style={freezeStick("label", { bg: "bg-amber-50" }).style} className={`text-[13px] whitespace-nowrap text-foreground/70 italic ${freezeStick("label", { bg: "bg-amber-50" }).className}`}>
                      {tree.onAccount.label}
                      <span className="ml-1.5 text-[10px] not-italic opacity-70">advances / unallocated receipts (credit)</span>
                    </TableCell>
                    {metricCells(tree.onAccount, false)}
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      {/* Pagination */}
      {tree.roots.length > 0 && (
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
              {tree.roots.length} top-level {tree.roots.length === 1 ? "group" : "groups"}
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
