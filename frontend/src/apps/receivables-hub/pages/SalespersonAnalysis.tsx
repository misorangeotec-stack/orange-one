import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, ChevronRight, ChevronDown, ChevronUp, ArrowUpDown,
  ArrowUp, ArrowDown, RefreshCw, UserCheck, X, AlertTriangle,
  Users, DollarSign, TrendingDown, Clock, UserCircle,
} from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { useAppData } from "@hub/lib/useAppData";
import { RiskLegendPopover } from "@hub/components/RiskLegendPopover";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { RiskMultiSelect } from "@hub/components/RiskMultiSelect";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import type { AgingBuckets } from "@hub/lib/types";
import { ShareReportMenu } from "@hub/pages/salesperson/ShareReportMenu";
import type { ActiveFiltersSummary } from "@hub/lib/exportSalesperson";
import { sumOutstanding } from "@hub/lib/receivables";

/* ── Types ─────────────────────────────────────────────── */

type RiskCategory = "critical" | "high" | "medium" | "low";
type SortDir = "asc" | "desc" | null;

interface CustomerRow {
  id: string;
  name: string;
  salesPerson: string;
  salesPersons?: string[];
  sales: number;
  receipts: number;
  creditNotes: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  creditPeriod: number;
  creditLimit: number;
  utilization: number;
  risk: RiskCategory;
  agingBuckets: AgingBuckets;
}

interface RiskSlice { customers: number; outstanding: number; overdue: number; }

interface PivotRow {
  salesperson: string;
  total: { customers: number; sales: number; outstanding: number; overdue: number };
  critical: RiskSlice;
  high:     RiskSlice;
  medium:   RiskSlice;
  low:      RiskSlice;
}

type PivotSortKey =
  | "salesperson"
  | "total.customers" | "total.sales" | "total.outstanding" | "total.overdue"
  | `${RiskCategory}.customers` | `${RiskCategory}.outstanding` | `${RiskCategory}.overdue`;

type BottomSortKey = keyof CustomerRow;

/* ── Helpers ───────────────────────────────────────────── */

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const riskStyle: Record<RiskCategory, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high:     "bg-primary/15 text-primary border-primary/30",
  medium:   "bg-warning/15 text-warning border-warning/30",
  low:      "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

const riskHeaderStyle: Record<RiskCategory, string> = {
  critical: "bg-destructive/10 text-destructive",
  high:     "bg-primary/10 text-primary",
  medium:   "bg-warning/10 text-warning",
  low:      "bg-emerald-500/10 text-emerald-600",
};

const riskOrder: RiskCategory[] = ["critical", "high", "medium", "low"];
const riskLabel: Record<RiskCategory, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

const PAGE_SIZE = 20;

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

const emptySlice = (): RiskSlice => ({ customers: 0, outstanding: 0, overdue: 0 });
const emptyPivotRow = (sp: string): PivotRow => ({
  salesperson: sp,
  total:    { customers: 0, sales: 0, outstanding: 0, overdue: 0 },
  critical: emptySlice(),
  high:     emptySlice(),
  medium:   emptySlice(),
  low:      emptySlice(),
});

const pivotValue = (row: PivotRow, key: PivotSortKey): number | string => {
  if (key === "salesperson") return row.salesperson;
  const [group, field] = key.split(".") as [keyof PivotRow, string];
  // @ts-expect-error dynamic lookup by composed key
  return row[group][field];
};

const bottomColumns: { key: BottomSortKey; label: string; align?: "right" }[] = [
  { key: "name",           label: "Customer" },
  { key: "salesPerson",    label: "Sales Person" },
  { key: "sales",          label: "Sales",       align: "right" },
  { key: "receipts",       label: "Receipts",    align: "right" },
  { key: "outstanding",    label: "Outstanding", align: "right" },
  { key: "overdue",        label: "Overdue",     align: "right" },
  { key: "maxOverdueDays", label: "Max OD Days", align: "right" },
  { key: "utilization",    label: "Util %",      align: "right" },
  { key: "risk",           label: "Risk" },
];

/* ── Component ─────────────────────────────────────────── */

export default function SalespersonAnalysis() {
  const navigate = useNavigate();

  // Filter state
  const [search, setSearch] = useState("");
  const [riskLevels, setRiskLevels] = useState<string[]>([]);
  const [agingFilter, setAgingFilter] = useState("all");
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [balanceFilter, setBalanceFilter] = useState<"all" | "has_outstanding" | "zero_outstanding">("all");
  const [saleTypes, setSaleTypes] = useState<string[]>([]);

  // Pivot-selection state (drives the bottom customer table)
  const [selectedSalesperson, setSelectedSalesperson] = useState<string | null>(null);
  const [selectedRisk, setSelectedRisk] = useState<RiskCategory | null>(null);

  // Sort state
  const [pivotSortKey, setPivotSortKey] = useState<PivotSortKey>("total.outstanding");
  const [pivotSortDir, setPivotSortDir] = useState<SortDir>("desc");
  const [bottomSortKey, setBottomSortKey] = useState<BottomSortKey | null>("outstanding");
  const [bottomSortDir, setBottomSortDir] = useState<SortDir>("desc");

  // UI state
  const [showKpis, setShowKpis] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const { loading, error, consolidatedCustomers, dashboard } = useAppData({
    saleType: saleTypes.length === 0 ? "all" : saleTypes.join(","),
    customerSegment,
    balanceFilter,
  });
  const allData: CustomerRow[] = consolidatedCustomers as CustomerRow[];
  const asOfDate = dashboard?.asOfDate ?? new Date().toISOString().slice(0, 10);

  /* ── Derived: filtered customer set (feeds both tables) ── */
  const filteredRows = useMemo(() => {
    let d = [...allData];
    if (search) {
      const q = search.toLowerCase();
      d = d.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
    }
    if (riskLevels.length > 0) {
      d = d.filter((r) => riskLevels.includes(r.risk));
    }
    if (agingFilter !== "all") {
      const bkMap: Record<string, keyof AgingBuckets> = {
        "0-30": "0_30", "31-60": "31_60", "61-90": "61_90",
        "91-120": "91_120", "121-180": "121_180", "180+": "180_plus",
      };
      const bk = bkMap[agingFilter];
      if (bk) d = d.filter((r) => (r.agingBuckets?.[bk] ?? 0) > 0);
    }
    return d;
  }, [allData, search, riskLevels, agingFilter]);

  /* ── Derived: salesperson × risk pivot ── */
  const pivotRows = useMemo(() => {
    const map = new Map<string, PivotRow>();
    for (const c of filteredRows) {
      const sp = c.salesPerson || "Others";
      const row = map.get(sp) ?? emptyPivotRow(sp);
      row.total.customers   += 1;
      row.total.sales       += c.sales;
      row.total.outstanding += c.outstanding;
      row.total.overdue     += c.overdue;
      const slice = row[c.risk];
      slice.customers   += 1;
      slice.outstanding += c.outstanding;
      slice.overdue     += c.overdue;
      map.set(sp, row);
    }
    const arr = [...map.values()].filter((r) => r.total.customers > 0);
    if (pivotSortKey && pivotSortDir) {
      arr.sort((a, b) => {
        const av = pivotValue(a, pivotSortKey);
        const bv = pivotValue(b, pivotSortKey);
        if (typeof av === "number" && typeof bv === "number")
          return pivotSortDir === "asc" ? av - bv : bv - av;
        return pivotSortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return arr;
  }, [filteredRows, pivotSortKey, pivotSortDir]);

  /* ── Derived: bottom customer rows (filtered by pivot selection) ── */
  const customerRows = useMemo(() => {
    let d = filteredRows;
    if (selectedSalesperson) {
      d = d.filter((r) => (r.salesPerson || "Others") === selectedSalesperson);
    }
    if (selectedRisk) {
      d = d.filter((r) => r.risk === selectedRisk);
    }
    if (bottomSortKey && bottomSortDir) {
      d = [...d].sort((a, b) => {
        const av = a[bottomSortKey];
        const bv = b[bottomSortKey];
        if (typeof av === "number" && typeof bv === "number")
          return bottomSortDir === "asc" ? av - bv : bv - av;
        return bottomSortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return d;
  }, [filteredRows, selectedSalesperson, selectedRisk, bottomSortKey, bottomSortDir]);

  /* ── Pivot totals row (sums every pivot column) ── */
  const pivotTotals = useMemo(() => {
    const sum = emptyPivotRow("Total");
    for (const r of pivotRows) {
      sum.total.customers   += r.total.customers;
      sum.total.sales       += r.total.sales;
      sum.total.outstanding += r.total.outstanding;
      sum.total.overdue     += r.total.overdue;
      for (const risk of riskOrder) {
        sum[risk].customers   += r[risk].customers;
        sum[risk].outstanding += r[risk].outstanding;
        sum[risk].overdue     += r[risk].overdue;
      }
    }
    return sum;
  }, [pivotRows]);

  /* ── KPI totals ── */
  const totals = useMemo(() => ({
    salespersons: new Set(filteredRows.map((r) => r.salesPerson || "Others")).size,
    customers:    filteredRows.length,
    sales:        filteredRows.reduce((s, r) => s + r.sales, 0),
    outstanding:  sumOutstanding(filteredRows),
    overdue:      filteredRows.reduce((s, r) => s + r.overdue, 0),
  }), [filteredRows]);

  /* ── Customer table totals row (sums every filtered customer, not just current page) ── */
  const customerTotals = useMemo(() => ({
    count:       customerRows.length,
    sales:       customerRows.reduce((s, r) => s + r.sales, 0),
    receipts:    customerRows.reduce((s, r) => s + r.receipts, 0),
    outstanding: sumOutstanding(customerRows),
    overdue:     customerRows.reduce((s, r) => s + r.overdue, 0),
  }), [customerRows]);

  /* ── Event handlers ── */
  const togglePivotSort = (key: PivotSortKey) => {
    if (pivotSortKey === key) {
      setPivotSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (pivotSortDir === "desc") setPivotSortKey("total.outstanding");
    } else {
      setPivotSortKey(key);
      setPivotSortDir("asc");
    }
  };

  const toggleBottomSort = (key: BottomSortKey) => {
    if (bottomSortKey === key) {
      setBottomSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (bottomSortDir === "desc") setBottomSortKey(null);
    } else {
      setBottomSortKey(key);
      setBottomSortDir("asc");
    }
  };

  const handleSalespersonClick = (sp: string) => {
    if (selectedSalesperson === sp && selectedRisk === null) {
      setSelectedSalesperson(null);
    } else {
      setSelectedSalesperson(sp);
      setSelectedRisk(null);
    }
  };

  const handleCellClick = (sp: string, risk: RiskCategory, hasData: boolean) => {
    if (!hasData) return;
    if (selectedSalesperson === sp && selectedRisk === risk) {
      setSelectedSalesperson(null);
      setSelectedRisk(null);
    } else {
      setSelectedSalesperson(sp);
      setSelectedRisk(risk);
    }
  };

  const clearSelection = () => { setSelectedSalesperson(null); setSelectedRisk(null); };

  const clearFilters = () => {
    setSearch("");
    setRiskLevels([]);
    setAgingFilter("all");
    setCustomerSegment("all");
    setBalanceFilter("all");
    setSaleTypes([]);
  };

  const filterChips: FilterChip[] = [
    search && { label: `Search: "${search}"`, onRemove: () => setSearch("") },
    riskLevels.length > 0 && {
      label: `Risk: ${riskLevels.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}`,
      onRemove: () => setRiskLevels([]),
    },
    agingFilter !== "all" && {
      label: `Aging: ${agingFilter} days`,
      onRemove: () => setAgingFilter("all"),
    },
    customerSegment !== "all" && {
      label: `Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setCustomerSegment("all"),
    },
    balanceFilter !== "all" && {
      label: `Balance: ${balanceFilter === "has_outstanding" ? "Has Outstanding" : "Zero Outstanding"}`,
      onRemove: () => setBalanceFilter("all"),
    },
    saleTypes.length > 0 && {
      label: saleTypes.length <= 2 ? `Type: ${saleTypes.join(", ")}` : `Types: ${saleTypes.length} selected`,
      onRemove: () => setSaleTypes([]),
    },
  ].filter(Boolean) as FilterChip[];

  /* Reset page when filters or selection change */
  useEffect(() => {
    setCurrentPage(1);
  }, [search, riskLevels, agingFilter, customerSegment, balanceFilter, saleTypes, selectedSalesperson, selectedRisk, bottomSortKey, bottomSortDir]);

  /* Reset selection if salesperson disappears from filtered set */
  useEffect(() => {
    if (selectedSalesperson && !pivotRows.some((r) => r.salesperson === selectedSalesperson)) {
      clearSelection();
    }
  }, [pivotRows, selectedSalesperson]);

  const totalPages = Math.ceil(customerRows.length / PAGE_SIZE);
  const paginatedCustomerRows = customerRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = customerRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, customerRows.length);

  const activeFilters: ActiveFiltersSummary = {
    search,
    riskLevels,
    aging: agingFilter,
    customerSegment,
    balance: balanceFilter,
    saleTypes,
  };

  const pivotSortIcon = (key: PivotSortKey) => {
    if (pivotSortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    if (pivotSortDir === "asc")  return <ArrowUp className="h-3 w-3" />;
    if (pivotSortDir === "desc") return <ArrowDown className="h-3 w-3" />;
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  };

  const bottomSortIcon = (key: BottomSortKey) => {
    if (bottomSortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    if (bottomSortDir === "asc")  return <ArrowUp className="h-3 w-3" />;
    if (bottomSortDir === "desc") return <ArrowDown className="h-3 w-3" />;
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading customer data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm font-medium text-destructive">Data not loaded</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const selectionLabel = selectedSalesperson
    ? selectedRisk
      ? `${selectedSalesperson} · ${riskLabel[selectedRisk]}`
      : selectedSalesperson
    : null;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center">
            <UserCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Salesperson Risk Analysis</h1>
            <p className="text-sm text-muted-foreground">
              {pivotRows.length} salesperson{pivotRows.length !== 1 ? "s" : ""} · {filteredRows.length} customer{filteredRows.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareReportMenu
            customers={filteredRows}
            filters={activeFilters}
            asOfDate={asOfDate}
          />
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-xs">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customer..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 rounded-input border-border text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Risk Level</span>
              <RiskMultiSelect value={riskLevels} onChange={setRiskLevels} triggerClassName="w-[140px] h-9 text-sm rounded-input border-border" />
            </div>
            <div className="mb-1"><RiskLegendPopover /></div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Aging</span>
              <Select value={agingFilter} onValueChange={setAgingFilter}>
                <SelectTrigger className="w-[150px] rounded-input border-border text-sm">
                  <SelectValue placeholder="Aging" />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Aging</SelectItem>
                  <SelectItem value="0-30">0–30 days</SelectItem>
                  <SelectItem value="31-60">31–60 days</SelectItem>
                  <SelectItem value="61-90">61–90 days</SelectItem>
                  <SelectItem value="91-120">91–120 days</SelectItem>
                  <SelectItem value="121-180">121–180 days</SelectItem>
                  <SelectItem value="180+">180+ days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer Segment</span>
              <Select value={customerSegment} onValueChange={(v) => setCustomerSegment(v as "all" | "active" | "no_activity")}>
                <SelectTrigger className="w-40 rounded-input h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="no_activity">No Activity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Balance</span>
              <Select value={balanceFilter} onValueChange={(v) => setBalanceFilter(v as "all" | "has_outstanding" | "zero_outstanding")}>
                <SelectTrigger className="w-44 rounded-input h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Balances</SelectItem>
                  <SelectItem value="has_outstanding">Has Outstanding</SelectItem>
                  <SelectItem value="zero_outstanding">Zero Outstanding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sale Type</span>
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} />
            </div>
          </div>
          <FilterChips chips={filterChips} onClearAll={clearFilters} />
        </CardContent>
      </Card>

      {/* KPI Cards — collapsible */}
      {filteredRows.length > 0 && (() => {
        const kpiCards = [
          { label: "Salespersons",      value: String(totals.salespersons), icon: UserCircle,   warn: false },
          { label: "Total Customers",   value: String(totals.customers),    icon: Users,        warn: false },
          { label: "Total Sales",       value: fmt(totals.sales),           icon: DollarSign,   warn: false },
          { label: "Total Outstanding", value: fmt(Math.abs(totals.outstanding)),     icon: TrendingDown, warn: true  },
          { label: "Total Overdue",     value: fmt(totals.overdue),         icon: Clock,        warn: true  },
        ];
        return (
          <Card className="rounded-card">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors rounded-card"
              onClick={() => setShowKpis((v) => !v)}
            >
              <div className="flex items-center gap-2">
                {showKpis
                  ? <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Summary — {totals.salespersons} salesperson{totals.salespersons !== 1 ? "s" : ""} · {totals.customers} customer{totals.customers !== 1 ? "s" : ""}
                </span>
              </div>
            </button>
            {showKpis && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="border-t border-border pt-3">
                  <div className="grid grid-cols-5 gap-2">
                    {kpiCards.map((kpi) => {
                      const Icon = kpi.icon;
                      return (
                        <div key={kpi.label} className="bg-muted/40 rounded-card px-3 py-2">
                          <div className="flex items-center gap-1 mb-0.5">
                            <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-[11px] text-muted-foreground leading-tight">{kpi.label}</span>
                          </div>
                          <p className={`text-sm font-bold ${kpi.warn ? "text-destructive" : "text-foreground"}`}>
                            {kpi.value}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })()}

      {/* Pivot Table: Salesperson × Risk */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Salesperson × Risk breakdown
          </span>
          <span className="text-[11px] text-muted-foreground">Click a name or cell to filter the list below</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead
                  rowSpan={2}
                  className="text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap align-middle"
                  onClick={() => togglePivotSort("salesperson")}
                >
                  <span className="inline-flex items-center gap-1">
                    Salesperson {pivotSortIcon("salesperson")}
                  </span>
                </TableHead>
                <TableHead colSpan={4} className="text-xs font-semibold text-foreground/70 text-center border-l border-border">
                  Totals
                </TableHead>
                {riskOrder.map((risk) => (
                  <TableHead
                    key={risk}
                    colSpan={3}
                    className={`text-xs font-semibold text-center border-l border-border ${riskHeaderStyle[risk]}`}
                  >
                    {riskLabel[risk]}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow className="bg-muted/30">
                {(["total.customers", "total.sales", "total.outstanding", "total.overdue"] as PivotSortKey[]).map((k, i) => (
                  <TableHead
                    key={k}
                    className={`text-[11px] font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap text-right ${i === 0 ? "border-l border-border" : ""}`}
                    onClick={() => togglePivotSort(k)}
                  >
                    <span className="inline-flex items-center gap-1 justify-end w-full">
                      {k === "total.customers" ? "Cust" : k === "total.sales" ? "Sales" : k === "total.outstanding" ? "OS" : "OD"}
                      {pivotSortIcon(k)}
                    </span>
                  </TableHead>
                ))}
                {riskOrder.flatMap((risk) =>
                  (["customers", "outstanding", "overdue"] as const).map((field, i) => {
                    const key = `${risk}.${field}` as PivotSortKey;
                    return (
                      <TableHead
                        key={key}
                        className={`text-[11px] font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap text-right ${i === 0 ? "border-l border-border" : ""}`}
                        onClick={() => togglePivotSort(key)}
                      >
                        <span className="inline-flex items-center gap-1 justify-end w-full">
                          {field === "customers" ? "Cust" : field === "outstanding" ? "OS" : "OD"}
                          {pivotSortIcon(key)}
                        </span>
                      </TableHead>
                    );
                  })
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivotRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} className="text-center py-10 text-muted-foreground">
                    No salespersons match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {/* Running totals row — must equal the Summary KPI block */}
                  <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                    <TableCell className="text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80">
                      Total
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono border-l border-border">{pivotTotals.total.customers}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(pivotTotals.total.sales)}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(Math.abs(pivotTotals.total.outstanding))}</TableCell>
                    <TableCell className={`text-sm text-right font-mono ${pivotTotals.total.overdue > 0 ? "text-destructive" : ""}`}>
                      {fmt(pivotTotals.total.overdue)}
                    </TableCell>
                    {riskOrder.flatMap((risk) => {
                      const slice = pivotTotals[risk];
                      const hasData = slice.customers > 0;
                      return [
                        <TableCell key={`total-${risk}-cust`} className="text-sm text-right font-mono border-l border-border">
                          {slice.customers}
                        </TableCell>,
                        <TableCell key={`total-${risk}-os`} className="text-sm text-right font-mono">
                          {hasData ? fmt(Math.abs(slice.outstanding)) : "—"}
                        </TableCell>,
                        <TableCell key={`total-${risk}-od`} className={`text-sm text-right font-mono ${slice.overdue > 0 ? "text-destructive" : ""}`}>
                          {hasData ? fmt(slice.overdue) : "—"}
                        </TableCell>,
                      ];
                    })}
                  </TableRow>
                  {pivotRows.map((row) => {
                  const isRowSelected = selectedSalesperson === row.salesperson;
                  return (
                    <TableRow
                      key={row.salesperson}
                      className={`transition-colors ${isRowSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}
                    >
                      <TableCell
                        className={`font-medium text-sm whitespace-nowrap cursor-pointer ${isRowSelected && !selectedRisk ? "text-primary font-semibold" : ""}`}
                        onClick={() => handleSalespersonClick(row.salesperson)}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {row.salesperson}
                          {isRowSelected && !selectedRisk && <X className="h-3 w-3 opacity-70" />}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-right font-mono border-l border-border">{row.total.customers}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{fmt(row.total.sales)}</TableCell>
                      <TableCell className="text-sm text-right font-mono font-semibold">{fmt(Math.abs(row.total.outstanding))}</TableCell>
                      <TableCell className={`text-sm text-right font-mono ${row.total.overdue > 0 ? "text-destructive font-semibold" : ""}`}>
                        {fmt(row.total.overdue)}
                      </TableCell>
                      {riskOrder.flatMap((risk) => {
                        const slice = row[risk];
                        const hasData = slice.customers > 0;
                        const cellSelected = isRowSelected && selectedRisk === risk;
                        const baseCls = `cursor-pointer transition-colors ${cellSelected ? "ring-2 ring-inset ring-primary/50 bg-primary/10" : hasData ? "hover:bg-muted/50" : "text-muted-foreground/40"}`;
                        return [
                          <TableCell
                            key={`${row.salesperson}-${risk}-cust`}
                            className={`text-sm text-right font-mono border-l border-border ${baseCls}`}
                            onClick={() => handleCellClick(row.salesperson, risk, hasData)}
                          >
                            {slice.customers}
                          </TableCell>,
                          <TableCell
                            key={`${row.salesperson}-${risk}-os`}
                            className={`text-sm text-right font-mono ${baseCls}`}
                            onClick={() => handleCellClick(row.salesperson, risk, hasData)}
                          >
                            {hasData ? fmt(Math.abs(slice.outstanding)) : "—"}
                          </TableCell>,
                          <TableCell
                            key={`${row.salesperson}-${risk}-od`}
                            className={`text-sm text-right font-mono ${baseCls} ${slice.overdue > 0 ? "text-destructive" : ""}`}
                            onClick={() => handleCellClick(row.salesperson, risk, hasData)}
                          >
                            {hasData ? fmt(slice.overdue) : "—"}
                          </TableCell>,
                        ];
                      })}
                    </TableRow>
                  );
                  })}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Selection chip */}
      {selectionLabel && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Showing customers for:</span>
          <Badge
            className="bg-primary/10 text-primary border-primary/20 text-xs gap-1 cursor-pointer rounded-button"
            onClick={clearSelection}
          >
            {selectionLabel} <X className="h-3 w-3" />
          </Badge>
        </div>
      )}

      {/* Customer table */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Customers {customerRows.length > 0 && `— ${rangeStart}–${rangeEnd} of ${customerRows.length}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {bottomColumns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap ${col.align === "right" ? "text-right" : ""}`}
                    onClick={() => toggleBottomSort(col.key)}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end w-full" : ""}`}>
                      {col.label}
                      {bottomSortIcon(col.key)}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedCustomerRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={bottomColumns.length + 1} className="text-center py-12 text-muted-foreground">
                    No customers match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {/* Running totals across all filtered customers (all pages) */}
                  <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold">
                    <TableCell className="text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80">
                      Total ({customerTotals.count})
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground/60">—</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(customerTotals.sales)}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(customerTotals.receipts)}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(Math.abs(customerTotals.outstanding))}</TableCell>
                    <TableCell className={`text-sm text-right font-mono ${customerTotals.overdue > 0 ? "text-destructive" : ""}`}>
                      {fmt(customerTotals.overdue)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground/60 text-right">—</TableCell>
                    <TableCell className="text-sm text-muted-foreground/60 text-right">—</TableCell>
                    <TableCell className="text-sm text-muted-foreground/60">—</TableCell>
                    <TableCell />
                  </TableRow>
                  {paginatedCustomerRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/outstanding-dashboard/customer/${encodeURIComponent(row.name)}`)}
                  >
                    <TableCell className="font-medium text-sm whitespace-nowrap">{row.name}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{row.salesPersons?.join(", ") ?? row.salesPerson}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(row.sales)}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{fmt(row.receipts)}</TableCell>
                    <TableCell className="text-sm text-right font-mono font-semibold">{fmt(Math.abs(row.outstanding))}</TableCell>
                    <TableCell className={`text-sm text-right font-mono ${row.overdue > 0 ? "text-destructive font-semibold" : ""}`}>
                      {fmt(row.overdue)}
                    </TableCell>
                    <TableCell className={`text-sm text-right font-mono ${row.maxOverdueDays > 180 ? "text-destructive font-semibold" : row.maxOverdueDays > 90 ? "text-primary font-semibold" : ""}`}>
                      {row.maxOverdueDays}
                    </TableCell>
                    <TableCell className={`text-sm text-right font-mono font-semibold ${row.utilization > 100 ? "text-destructive" : row.utilization > 80 ? "text-primary" : ""}`}>
                      {row.utilization}%
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${riskStyle[row.risk]}`}>
                        {row.risk}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/outstanding-dashboard/customer/${encodeURIComponent(row.name)}`); }}
                        className="h-7 w-7 p-0 rounded-button text-muted-foreground hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                aria-disabled={currentPage === 1}
                className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {getPageWindow(currentPage, totalPages).map((p, i) =>
              p === "..." ? (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === currentPage}
                    onClick={() => setCurrentPage(p)}
                    className="cursor-pointer"
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                aria-disabled={currentPage === totalPages}
                className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
