import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import {
  Crown, Download, Search, ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronRight, ChevronDown, Info, FileText, Lock, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Badge } from "@hub/components/ui/badge";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import { MultiSelect } from "@hub/components/MultiSelect";
import { SaleTypeMultiSelect, SALE_TYPE_OPTIONS } from "@hub/components/SaleTypeMultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { GroupByBuilder, type GroupByPreset } from "@hub/components/GroupByBuilder";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import TopExposureAnalysis from "@hub/components/TopExposureAnalysis";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { useFY } from "@hub/lib/fyContext";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { fmtINRMoney } from "@hub/lib/utils";
import { buildGroupTree, sortTree, type GroupNode } from "@hub/lib/groupTree";
import {
  toExposureRow, rankRows, dimValueOf,
  emptyExposureMetrics, addExposureMetrics, metricsOfRow, utilizationOf,
  EXPOSURE_DIMENSIONS,
  type ExposureRow, type ExposureMetrics, type ExposureDimension, type RankBy,
} from "@hub/lib/topExposure";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";

/* ── Helpers ───────────────────────────────────────────────── */

const TOP_N_OPTIONS = [25, 50, 100, "all"] as const;
type TopN = (typeof TOP_N_OPTIONS)[number];

const PAGE_SIZE = 25;

/** util % with an over-limit flag when > 100. "—" when no credit limit is set.
 *  Capped at 3 digits: a tiny / sentinel credit limit (e.g. ₹1) otherwise sends this
 *  to millions of %, which reads as noise. Anything over 999% shows as ">999%". */
function fmtUtil(m: ExposureMetrics): { text: string; over: boolean } {
  if (m.creditLimit <= 0) return { text: "—", over: false };
  const u = utilizationOf(m);
  return { text: u > 999 ? ">999%" : `${u.toFixed(0)}%`, over: u > 100 };
}

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

const GROUP_PRESETS: GroupByPreset<ExposureDimension>[] = [
  { label: "Salesperson", dims: ["salesperson"] },
  { label: "Customer Category", dims: ["category"] },
  { label: "Customer Group", dims: ["group"] },
  { label: "Salesperson → Customer", dims: ["salesperson", "customer"] },
  { label: "Company → Location", dims: ["company", "location"] },
];

type FlatSortKey =
  | "customer" | "salesPerson" | "creditLimit" | "outstanding"
  | "utilization" | "overdue" | "maxOverdueDays";

/** Toggleable columns after the fixed # + Customer pair, in display order. */
type OptColKey =
  | "salesPerson" | "company" | "location" | "category"
  | "creditPeriod" | "creditLimit" | "outstanding" | "utilization" | "overdue" | "maxOverdueDays";

const OPT_COLUMNS: { key: OptColKey; label: string; numeric: boolean; sortKey?: FlatSortKey }[] = [
  { key: "salesPerson", label: "Salesperson", numeric: false, sortKey: "salesPerson" },
  { key: "company", label: "Company", numeric: false },
  { key: "location", label: "Location", numeric: false },
  { key: "category", label: "Category", numeric: false },
  { key: "creditPeriod", label: "Credit Period", numeric: true },
  { key: "creditLimit", label: "Credit Limit", numeric: true, sortKey: "creditLimit" },
  { key: "outstanding", label: "Outstanding", numeric: true, sortKey: "outstanding" },
  { key: "utilization", label: "Utilisation %", numeric: true, sortKey: "utilization" },
  { key: "overdue", label: "Overdue", numeric: true, sortKey: "overdue" },
  { key: "maxOverdueDays", label: "Max OD", numeric: true, sortKey: "maxOverdueDays" },
];

/** Lean default: the columns that actually drive a chase call. */
const DEFAULT_COLS: string[] = ["salesPerson", "category", "creditLimit", "outstanding", "utilization", "overdue", "maxOverdueDays"];

const COLUMN_OPTIONS: ColumnOption[] = OPT_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

/* ── Page ──────────────────────────────────────────────────── */

export default function TopExposureReport() {
  const source = useReceivablesSource();
  const { label: fyLabel } = useFY();

  // Filters
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  // Ranking / size
  const [rankBy, setRankBy] = useState<RankBy>("outstanding");
  const [topN, setTopN] = useState<TopN>(50);

  // Grouping (empty = flat ranked list)
  const [groupBy, setGroupBy] = useState<ExposureDimension[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Flat-view sort + pagination
  const [sortKey, setSortKey] = useState<FlatSortKey>("outstanding");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // Which tab is showing (the ranked list, or the charts + AI analysis).
  const [tab, setTab] = useState<"list" | "analysis">("list");

  // Controls panel (collapsed by default to save space) + column picker (flat view).
  const [controlsOpen, setControlsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_COLS);
  const shownCols = useMemo(() => OPT_COLUMNS.filter((c) => visibleCols.includes(c.key)), [visibleCols]);

  // Sale Type flows through the hook (needs per-type projection); "all selected" = no filter.
  const saleTypeParam =
    saleTypes.length > 0 && saleTypes.length < SALE_TYPE_OPTIONS.length
      ? saleTypes.join(",")
      : undefined;
  const { loading, error, customers, salesPersonOptions, customerGroupMap } = useAppData({
    saleType: saleTypeParam,
  });

  const grouped = groupBy.length > 0;

  // Keep rankBy and the flat sort in step: the toggle drives the primary sort.
  const setRank = (by: RankBy) => {
    setRankBy(by);
    setSortKey(by);
    setSortDir("desc");
    setPage(1);
  };

  // Reset paging when the shape of the list changes.
  useEffect(() => {
    setPage(1);
    setExpanded(new Set());
  }, [saleTypeParam, salesPersons, categories, companies, locations, search, groupBy, topN, rankBy]);

  // Option lists for the company / location filters.
  const companyOptions = useMemo(
    () => [...new Set(customers.map((c) => c.company).filter(Boolean))].sort(),
    [customers],
  );
  const locationOptions = useMemo(
    () => [...new Set(customers.map((c) => c.location).filter(Boolean))].sort(),
    [customers],
  );

  // All rows (sale-type-projected by the hook) → client-side filtered.
  const filteredRows = useMemo<ExposureRow[]>(() => {
    const q = search.trim().toLowerCase();
    const spSet = new Set(salesPersons);
    const coSet = new Set(companies);
    const loSet = new Set(locations);
    return customers
      .map((c) => toExposureRow(c, customerGroupMap))
      // Keep only ledgers that actually carry exposure or overdue (a call-list, not the whole book).
      .filter((r) => Math.abs(r.outstanding) >= 0.5 || Math.abs(r.overdue) >= 0.5)
      .filter((r) => {
        if (spSet.size > 0 && !spSet.has(r.salesPerson)) return false;
        if (coSet.size > 0 && !coSet.has(r.company)) return false;
        if (loSet.size > 0 && !loSet.has(r.location)) return false;
        if (!matchesCategory({ category: r.category }, categories)) return false;
        if (q && !(r.customer.toLowerCase().includes(q) || r.salesPerson.toLowerCase().includes(q))) return false;
        return true;
      });
  }, [customers, customerGroupMap, salesPersons, companies, locations, categories, search]);

  // ── The call-list set: Top-N by the ranking metric, ALWAYS applied ───────────
  // Ranked FIRST (by rankBy), then capped to Top-N. This same capped set feeds BOTH
  // the flat list and the grouped roll-up, so adding a Group By never widens the list
  // back out to the whole book — it groups the shown Top-N.
  const rankedRows = useMemo(() => rankRows(filteredRows, rankBy), [filteredRows, rankBy]);
  const capped = useMemo(
    () => (topN === "all" ? rankedRows : rankedRows.slice(0, topN)),
    [rankedRows, topN],
  );

  // KPIs / grand total summarise EXACTLY this set (the shown Top-N), in both views.
  const totals = useMemo(() => {
    const acc = emptyExposureMetrics();
    for (const r of capped) addExposureMetrics(acc, metricsOfRow(r));
    const overLimit = capped.filter((r) => r.creditLimit > 0 && r.utilization > 100).length;
    return { ...acc, overLimit };
  }, [capped]);

  // Flat view: sort the capped set for display (the SET stays the Top-N by rankBy;
  // a column-header sort only reorders those rows, it doesn't change which rows qualify).
  const sortedFlat = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...capped].sort((a, b) => {
      if (sortKey === "customer" || sortKey === "salesPerson") {
        return dir * String(a[sortKey]).localeCompare(String(b[sortKey]));
      }
      return dir * ((a[sortKey] as number) - (b[sortKey] as number));
    });
  }, [capped, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedFlat.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedFlat = sortedFlat.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Grouped roll-up ────────────────────────────────────────
  const tree = useMemo(() => {
    if (!grouped) return null;
    const t = buildGroupTree<ExposureRow, ExposureMetrics>(capped, groupBy, {
      dimValue: dimValueOf,
      idOf: (r) => r.id,
      metricsOf: metricsOfRow,
      empty: emptyExposureMetrics,
      add: addExposureMetrics,
      sort: (a, b) => b.metrics[rankBy] - a.metrics[rankBy],
    });
    return { ...t, roots: sortTree(t.roots, (a, b) => b.metrics[rankBy] - a.metrics[rankBy]) };
  }, [grouped, capped, groupBy, rankBy]);

  const toggleSort = (k: FlatSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "customer" || k === "salesPerson" ? "asc" : "desc"); }
    setPage(1);
  };
  const SortIcon = ({ k }: { k: FlatSortKey }) =>
    sortKey !== k ? <ArrowUpDown className="h-3 w-3 inline opacity-40" />
    : sortDir === "asc" ? <ArrowUp className="h-3 w-3 inline" />
    : <ArrowDown className="h-3 w-3 inline" />;

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // ── Filter chips ───────────────────────────────────────────
  const chips: FilterChip[] = [
    saleTypes.length > 0 && saleTypes.length < SALE_TYPE_OPTIONS.length && {
      label: `Sale Type: ${saleTypes.length} sel.`, onRemove: () => setSaleTypes([]),
    },
    salesPersons.length > 0 && { label: `Salesperson: ${salesPersons.length} sel.`, onRemove: () => setSalesPersons([]) },
    categories.length > 0 && { label: `Category: ${categories.join(", ")}`, onRemove: () => setCategories([]) },
    companies.length > 0 && { label: `Company: ${companies.join(", ")}`, onRemove: () => setCompanies([]) },
    locations.length > 0 && { label: `Location: ${locations.join(", ")}`, onRemove: () => setLocations([]) },
    search.trim() && { label: `Search: “${search.trim()}”`, onRemove: () => setSearch("") },
  ].filter(Boolean) as FilterChip[];

  const clearFilters = () => {
    setSaleTypes([]); setSalesPersons([]); setCategories([]);
    setCompanies([]); setLocations([]); setSearch("");
  };

  // ── Export ─────────────────────────────────────────────────
  const exportXlsx = () => {
    const rankLabel = rankBy === "outstanding" ? "Outstanding" : "Overdue";
    const wb = XLSX.utils.book_new();

    if (grouped && tree) {
      const dimPath = groupBy.map((d) => EXPOSURE_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → ");
      const header = [dimPath, "Customers", "Credit Limit", "Outstanding", "Utilisation %", "Overdue", "Max OD"];
      const aoa: (string | number)[][] = [
        [`Top Credit Exposure & Overdue — grouped by ${dimPath} — ${fyLabel}`],
        [`Ranked by ${rankLabel}${saleTypeParam ? ` · Sale Type: ${saleTypes.join(", ")}` : ""}`],
        [],
        header,
      ];
      const subtotalRows: number[] = [];
      const walk = (nodes: GroupNode<ExposureMetrics>[]) => {
        for (const n of nodes) {
          const label = `${"    ".repeat(n.depth)}${n.sub ? `${n.label} (${n.sub})` : n.label}`;
          const u = fmtUtil(n.metrics);
          aoa.push([
            label, n.metrics.count, Math.round(n.metrics.creditLimit), Math.round(n.metrics.outstanding),
            u.text, Math.round(n.metrics.overdue), n.metrics.maxOverdueDays || 0,
          ]);
          if (n.children.length) { subtotalRows.push(aoa.length - 1); walk(n.children); }
        }
      };
      walk(tree.roots);
      const gu = fmtUtil(totals);
      aoa.push([
        "Grand Total", totals.count, Math.round(totals.creditLimit), Math.round(totals.outstanding),
        gu.text, Math.round(totals.overdue), totals.maxOverdueDays || 0,
      ]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 40 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 9 }];
      styleRow(ws, 0, header.length, HEADER_STYLE);
      styleRow(ws, 3, header.length, HEADER_STYLE);
      for (const r of subtotalRows) styleRow(ws, r, header.length, TOTAL_STYLE);
      styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);
      XLSX.utils.book_append_sheet(wb, ws, "Grouped");
    } else {
      const header = [
        "Rank", "Customer", "Salesperson", "Company", "Location", "Category",
        "Credit Period", "Credit Limit", "Outstanding", "Utilisation %", "Overdue", "Max OD",
      ];
      const aoa: (string | number)[][] = [
        [`Top ${topN === "all" ? "" : `${topN} `}Credit Exposure & Overdue Accounts — ${fyLabel}`],
        [`Ranked by ${rankLabel}${saleTypeParam ? ` · Sale Type: ${saleTypes.join(", ")}` : ""}`],
        [],
        header,
        ...capped.map((r, i) => {
          const u = fmtUtil(metricsOfRow(r));
          return [
            i + 1, r.customer, r.salesPerson, r.company, r.location, r.category || "—",
            r.creditPeriod || 0, Math.round(r.creditLimit), Math.round(r.outstanding),
            u.text, Math.round(r.overdue), r.maxOverdueDays || 0,
          ];
        }),
        ["", "", "", "", "", "", "Total", Math.round(totals.creditLimit), Math.round(totals.outstanding),
          fmtUtil(totals).text, Math.round(totals.overdue), ""],
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [
        { wch: 6 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 9 },
        { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 9 },
      ];
      styleRow(ws, 0, header.length, HEADER_STYLE);
      styleRow(ws, 3, header.length, HEADER_STYLE);
      styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);
      XLSX.utils.book_append_sheet(wb, ws, "Top Exposure");
    }
    XLSX.writeFile(wb, `top-credit-exposure-${fyLabel.replace(/\s+/g, "")}.xlsx`);
  };

  /* ── Not applicable on the default pipeline ──────────────── */
  if (source === "default") {
    return (
      <div className="p-6 max-w-[900px] mx-auto space-y-4">
        <Link to="/outstanding-dashboard/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" /> Top Credit Exposure & Overdue Accounts
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              This report reads live Tally credit limits, terms and per-sale-type exposure, so it is
              only available on the <strong>Live (Tally)</strong> view. Switch on{" "}
              <strong>Live (Tally)</strong> in the top bar to use it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const scopeSub = topN === "all" ? "across all shown" : `across the top ${topN}`;
  const activeFilterCount =
    (saleTypes.length > 0 && saleTypes.length < SALE_TYPE_OPTIONS.length ? 1 : 0) +
    (salesPersons.length ? 1 : 0) + (categories.length ? 1 : 0) +
    (companies.length ? 1 : 0) + (locations.length ? 1 : 0) + (search.trim() ? 1 : 0);
  const controlsSummary =
    `${rankBy === "outstanding" ? "Credit Exposure" : "Overdue"} · Top ${topN === "all" ? "All" : topN}` +
    (groupBy.length ? " · Grouped" : "");

  /* ── Column-driven flat table (respects the column picker) ─── */
  type OptCol = (typeof OPT_COLUMNS)[number];

  const renderOptHead = (col: OptCol): ReactNode => (
    <TableHead
      key={col.key}
      onClick={col.sortKey ? () => toggleSort(col.sortKey!) : undefined}
      className={`text-xs whitespace-nowrap ${col.numeric ? "text-right" : ""} ${col.sortKey ? "cursor-pointer" : ""}`}
    >
      {col.label} {col.sortKey && <SortIcon k={col.sortKey} />}
    </TableHead>
  );

  const renderOptCell = (col: OptCol, r: ExposureRow): ReactNode => {
    switch (col.key) {
      case "salesPerson": return <TableCell key={col.key} className="text-xs text-muted-foreground">{r.salesPerson}</TableCell>;
      case "company": return <TableCell key={col.key} className="text-xs text-muted-foreground">{r.company}</TableCell>;
      case "location": return <TableCell key={col.key} className="text-xs text-muted-foreground">{r.location}</TableCell>;
      case "category": return <TableCell key={col.key} className="text-xs text-muted-foreground">{r.category || "—"}</TableCell>;
      case "creditPeriod": return <TableCell key={col.key} className="text-xs text-right font-mono text-muted-foreground">{r.creditPeriod > 0 ? `${r.creditPeriod}d` : "—"}</TableCell>;
      case "creditLimit": return <TableCell key={col.key} className="text-xs text-right font-mono text-muted-foreground">{r.creditLimit > 0 ? fmtINRMoney(r.creditLimit) : "—"}</TableCell>;
      case "outstanding": return <TableCell key={col.key} className="text-xs text-right font-mono font-semibold">{fmtINRMoney(r.outstanding)}</TableCell>;
      case "utilization": { const u = fmtUtil(metricsOfRow(r)); return <TableCell key={col.key} className={`text-xs text-right font-mono ${u.over ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{u.text}</TableCell>; }
      case "overdue": return <TableCell key={col.key} className={`text-xs text-right font-mono ${r.overdue > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{fmtINRMoney(r.overdue)}</TableCell>;
      case "maxOverdueDays": return <TableCell key={col.key} className="text-xs text-right font-mono text-muted-foreground">{r.maxOverdueDays > 0 ? r.maxOverdueDays : "—"}</TableCell>;
      default: return <TableCell key={col.key} />;
    }
  };

  const renderOptTotal = (col: OptCol): ReactNode => {
    switch (col.key) {
      case "creditLimit": return <TableCell key={col.key} className="text-xs text-right font-mono font-bold">{fmtINRMoney(totals.creditLimit)}</TableCell>;
      case "outstanding": return <TableCell key={col.key} className="text-xs text-right font-mono font-bold">{fmtINRMoney(totals.outstanding)}</TableCell>;
      case "utilization": { const gu = fmtUtil(totals); return <TableCell key={col.key} className={`text-xs text-right font-mono font-bold ${gu.over ? "text-destructive" : ""}`}>{gu.text}</TableCell>; }
      case "overdue": return <TableCell key={col.key} className="text-xs text-right font-mono font-bold text-destructive">{fmtINRMoney(totals.overdue)}</TableCell>;
      default: return <TableCell key={col.key} />;
    }
  };

  const renderGroupNodes = (nodes: GroupNode<ExposureMetrics>[]): ReactNode =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0;
      const isOpen = expanded.has(n.key);
      const u = fmtUtil(n.metrics);
      const tint = n.depth === 0 ? "" : n.depth === 1 ? "bg-muted/20" : "bg-muted/10";
      return (
        <Fragment key={n.key}>
          <TableRow
            className={`${tint} ${hasChildren ? "cursor-pointer hover:bg-muted/40" : ""}`}
            onClick={hasChildren ? () => toggleExpand(n.key) : undefined}
          >
            <TableCell className="text-xs whitespace-nowrap" style={{ paddingLeft: 8 + n.depth * 18 }}>
              <span className="inline-flex items-center gap-1">
                {hasChildren
                  ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)
                  : <span className="inline-block w-3.5" />}
                <span className={n.depth === 0 ? "font-semibold" : "text-muted-foreground"}>{n.label}</span>
                {n.sub && <span className="ml-1 text-[10px] opacity-70">{n.sub}</span>}
                {hasChildren && <span className="ml-1 text-[11px] opacity-70">({n.metrics.count})</span>}
              </span>
            </TableCell>
            <TableCell className="text-xs text-right font-mono text-muted-foreground">{n.metrics.count}</TableCell>
            <TableCell className="text-xs text-right font-mono">{fmtINRMoney(n.metrics.creditLimit)}</TableCell>
            <TableCell className="text-xs text-right font-mono font-semibold">{fmtINRMoney(n.metrics.outstanding)}</TableCell>
            <TableCell className={`text-xs text-right font-mono ${u.over ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{u.text}</TableCell>
            <TableCell className={`text-xs text-right font-mono ${n.metrics.overdue > 0 ? "text-destructive" : "text-muted-foreground"}`}>{fmtINRMoney(n.metrics.overdue)}</TableCell>
            <TableCell className="text-xs text-right font-mono text-muted-foreground">{n.metrics.maxOverdueDays || "—"}</TableCell>
          </TableRow>
          {isOpen && hasChildren && renderGroupNodes(n.children)}
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
            <Crown className="h-6 w-6 text-primary" /> Top Credit Exposure & Overdue Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            The biggest exposure / most-overdue customers as a ranked call-list. ({fyLabel})
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!grouped && <ColumnPicker columns={COLUMN_OPTIONS} visible={visibleCols} onChange={setVisibleCols} />}
          <Button onClick={exportXlsx} disabled={filteredRows.length === 0} size="sm" className="rounded-button gap-2">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      {/* Summary strip — reflects EXACTLY what the table shows (the shown Top-N, not the whole book). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Customers Shown",
            value: String(totals.count),
            sub: topN === "all" ? "all with exposure / overdue" : `the top ${topN}`,
          },
          { label: "Total Exposure", value: fmtINRMoney(totals.outstanding), sub: scopeSub },
          { label: "Total Overdue", value: fmtINRMoney(totals.overdue), sub: scopeSub },
          { label: "Over Credit Limit", value: String(totals.overLimit), sub: "utilisation > 100%" },
        ].map((s) => (
          <Card key={s.label} className="rounded-card border-border bg-surface">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls — collapsible; collapsed by default to save space. */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() => setControlsOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              Rank, Sale Type &amp; View
              {activeFilterCount > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button border-primary/40 text-primary">
                  {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
                </Badge>
              )}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">{controlsSummary}</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${controlsOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          {controlsOpen && (
          <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/60">
          {/* Rank / size */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rank by</span>
            {(["outstanding", "overdue"] as RankBy[]).map((b) => (
              <Button
                key={b}
                variant={rankBy === b ? "default" : "outline"}
                size="sm"
                onClick={() => setRank(b)}
                className={`h-7 text-xs rounded-button ${rankBy === b ? "bg-primary text-primary-foreground" : "border-border"}`}
              >
                {b === "outstanding" ? "Credit Exposure" : "Overdue"}
              </Button>
            ))}
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide ml-3">Show top</span>
            <Select value={String(topN)} onValueChange={(v) => setTopN(v === "all" ? "all" : (Number(v) as TopN))}>
              <SelectTrigger className="h-7 w-20 rounded-input border-border text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TOP_N_OPTIONS.map((o) => (
                  <SelectItem key={String(o)} value={String(o)}>{o === "all" ? "All" : o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {grouped && <span className="text-[11px] text-muted-foreground italic">Grouping the {topN === "all" ? "full" : `top ${topN}`} list.</span>}
          </div>

          {/* Filters — Sale Type first & emphasised */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/60">
            <span className="text-xs font-semibold text-primary uppercase tracking-wide pt-2">Sale Type</span>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} triggerClassName="h-8 w-40 text-xs rounded-input border-primary/40" />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer / salesperson" className="h-8 w-56 pl-7 text-xs rounded-input" />
              </div>
              <SalesPersonMultiSelect options={salesPersonOptions} value={salesPersons} onChange={setSalesPersons} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={companyOptions} value={companies} onChange={setCompanies} allLabel="All Companies" noun="companies" triggerClassName="h-8 w-40 text-xs rounded-input" />
              <MultiSelect options={locationOptions} value={locations} onChange={setLocations} allLabel="All Locations" noun="locations" triggerClassName="h-8 w-40 text-xs rounded-input" />
            </div>
          </div>

          {/* Group-by builder */}
          <div className="pt-1 border-t border-border/60">
            <div className="pt-2">
              <GroupByBuilder
                dimensions={EXPOSURE_DIMENSIONS}
                presets={[{ label: "None (ranked list)", dims: [] }, ...GROUP_PRESETS]}
                value={groupBy}
                onChange={setGroupBy}
              />
            </div>
          </div>

          </div>
          )}
        </CardContent>
      </Card>
      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearFilters} />}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "analysis")} className="w-full">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-5 mt-4">

      {/* Basis note */}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Exposure = net outstanding; under a Sale Type filter every figure is projected onto the selected type(s).
        Utilisation = Outstanding ÷ Credit Limit, recomputed at each group level (a ratio is never summed).
      </p>

      {/* Table */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="p-10 text-center text-sm text-destructive">Failed to load: {error}</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <FileText className="h-8 w-8 opacity-40" />
              No customers match the current filters.
            </div>
          ) : grouped && tree ? (
            /* ── Grouped roll-up ── */
            <ScrollableTable>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs whitespace-nowrap">
                      {groupBy.map((d) => EXPOSURE_DIMENSIONS.find((x) => x.key === d)?.label ?? d).join(" → ")}
                    </TableHead>
                    <TableHead className="text-xs text-right">Customers</TableHead>
                    <TableHead className="text-xs text-right">Credit Limit</TableHead>
                    <TableHead className="text-xs text-right">Outstanding</TableHead>
                    <TableHead className="text-xs text-right">Utilisation %</TableHead>
                    <TableHead className="text-xs text-right">Overdue</TableHead>
                    <TableHead className="text-xs text-right">Max OD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => { const gu = fmtUtil(totals); return (
                    <TableRow className="bg-muted/60 font-semibold border-b-2 border-border/60">
                      <TableCell className="text-xs uppercase tracking-wide text-foreground/80">Grand Total</TableCell>
                      <TableCell className="text-xs text-right font-mono">{totals.count}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmtINRMoney(totals.creditLimit)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmtINRMoney(totals.outstanding)}</TableCell>
                      <TableCell className={`text-xs text-right font-mono ${gu.over ? "text-destructive" : ""}`}>{gu.text}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-destructive">{fmtINRMoney(totals.overdue)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{totals.maxOverdueDays || "—"}</TableCell>
                    </TableRow>
                  ); })()}
                  {renderGroupNodes(tree.roots)}
                </TableBody>
              </Table>
            </ScrollableTable>
          ) : (
            /* ── Flat ranked list ── */
            <ScrollableTable>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs w-12">#</TableHead>
                    <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("customer")}>Customer <SortIcon k="customer" /></TableHead>
                    {shownCols.map(renderOptHead)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedFlat.map((r, i) => {
                    const rank = (safePage - 1) * PAGE_SIZE + i + 1;
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/20">
                        <TableCell className="text-xs text-muted-foreground font-mono">{rank}</TableCell>
                        <TableCell className="text-xs font-medium">{r.customer}</TableCell>
                        {shownCols.map((c) => renderOptCell(c, r))}
                      </TableRow>
                    );
                  })}
                  {/* Grand total — over the SHOWN Top-N (matches the KPI cards). */}
                  <TableRow className="bg-muted/50 font-semibold border-t border-border">
                    <TableCell colSpan={2} className="text-xs font-bold">Total ({totals.count} customer{totals.count === 1 ? "" : "s"})</TableCell>
                    {shownCols.map(renderOptTotal)}
                  </TableRow>
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Pagination (flat view only) */}
      {!grouped && capped.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, capped.length)} of {capped.length}
            {topN !== "all" && filteredRows.length > capped.length && <span className="opacity-70"> (top {topN} of {filteredRows.length})</span>}
          </span>
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
                    <PaginationLink isActive={p === safePage} onClick={() => setPage(p)} className="cursor-pointer">{p}</PaginationLink>
                  </PaginationItem>
                )
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
        </div>
      )}

        </TabsContent>

        <TabsContent value="analysis" className="mt-4">
          <TopExposureAnalysis rows={capped} saleTypes={saleTypes} fyLabel={fyLabel} rankBy={rankBy} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
