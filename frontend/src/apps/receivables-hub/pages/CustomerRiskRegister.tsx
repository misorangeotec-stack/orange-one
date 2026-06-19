import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search, Filter, Download, Save, ChevronRight, ChevronDown, ChevronUp, ArrowUpDown,
  ArrowUp, ArrowDown, RefreshCw, ShieldAlert, X, AlertTriangle,
  Users, DollarSign, Receipt, FileMinus, TrendingDown, TrendingUp, Clock, RotateCcw,
  Columns3,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@hub/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipTrigger as UITooltipTrigger,
  TooltipProvider as UITooltipProvider,
} from "@hub/components/ui/tooltip";
import * as XLSX from "xlsx-js-style";
import { HEADER_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import { saveAs } from "file-saver";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData } from "@hub/lib/useAppData";
import { RiskLegendPopover } from "@hub/components/RiskLegendPopover";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { RiskMultiSelect } from "@hub/components/RiskMultiSelect";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import type { AgingBuckets, ConsolidatedCustomer, GroupedCustomer, ProposedCreditLimitReason, ProposedConstituent } from "@hub/lib/types";

/* ── Types ─────────────────────────────────────────────── */

type RiskCategory = "critical" | "high" | "medium" | "low";
type SortDir = "asc" | "desc" | null;

interface CustomerRow {
  id: string;
  name: string;
  salesPerson: string;
  salesPersons?: string[];
  /** All companies this row spans (one entry = single company; >1 = "Multiple"). */
  companies?: string[];
  /** All locations this row spans (one entry = single location; >1 = "Multiple"). */
  locations?: string[];
  openingBalance: number;
  sales: number;
  receipts: number;
  creditNotes: number;
  debitNotes: number;
  journalAdjustments: number;
  checkReturns: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  creditPeriod: number;
  creditLimit: number;
  utilization: number;
  risk: RiskCategory;
  blocked: boolean;
  agingBuckets: AgingBuckets;
  proposedCreditLimit3M: number;
  proposedCreditLimit3MDeltaPct: number | null;
  proposedCreditLimitAI: number;
  proposedCreditLimitAIDeltaPct: number | null;
  proposedCreditLimitReason?: ProposedCreditLimitReason;
  proposedConstituents?: ProposedConstituent[];
  constituentIds?: string[];
  /** Set on group rows in "By Group" mode; when present and length > 1, the row is expandable. */
  childNames?: string[];
  /** Set on group rows; true if isGroup === true (more than one Tally child). */
  isGroup?: boolean;
}

type ViewMode = "customer" | "group";

import { fmtINRMoney, fmtINRDrCr } from "@hub/lib/utils";
import { sumOutstanding } from "@hub/lib/receivables";
import { matchesSearch } from "@/shared/lib/search";

const fmt = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

const riskStyle: Record<RiskCategory, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high: "bg-primary/15 text-primary border-primary/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

type SortKey = keyof CustomerRow;

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, "all"] as const;
type PageSize = number | "all";
const DEFAULT_PAGE_SIZE: PageSize = 50;
const PAGE_SIZE_STORAGE_KEY = "riskRegister.pageSize";

const fmtL = (n: number) => {
  if (n >= 100) return `₹${(n / 100).toFixed(2)} Cr`;
  return `₹${n.toFixed(2)} L`;
};

/** Inline ▲/▼ % badge for proposed-vs-current credit limit deltas. */
function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) {
    return <span className="ml-1 text-[10px] text-muted-foreground">±0%</span>;
  }
  const up = rounded > 0;
  return (
    <span className={`ml-1 text-[10px] font-medium ${up ? "text-emerald-600" : "text-destructive"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{rounded.toFixed(1)}%
    </span>
  );
}

/** Single-constituent breakdown for the 3M Proposed (avg-of-last-3-months × 3). */
function ThreeMReasonBreakdown({
  avg3MMonthlySales,
  proposed3M,
  compact = false,
}: {
  avg3MMonthlySales: number;
  proposed3M: number;
  compact?: boolean;
}) {
  const sizeCls = compact ? "text-[11px]" : "text-xs";

  if (avg3MMonthlySales <= 0) {
    return (
      <div className={`${sizeCls} text-muted-foreground break-words whitespace-normal`}>
        No sales in last 3 months — 3M Proposed = ₹0.
      </div>
    );
  }

  const total3M = avg3MMonthlySales * 3;

  return (
    <div className={`${sizeCls} grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5`}>
      <div className="text-muted-foreground whitespace-nowrap">3M total sales</div>
      <div className="break-words whitespace-normal"><span className="font-mono">{fmt(total3M)}</span></div>

      <div className="text-muted-foreground whitespace-nowrap">Monthly avg</div>
      <div className="break-words whitespace-normal"><span className="font-mono">{fmt(avg3MMonthlySales)}</span> /mo</div>

      <div className="text-muted-foreground whitespace-nowrap">× 3 months</div>
      <div className="break-words whitespace-normal"><span className="font-mono">{fmt(total3M)}</span></div>

      {!compact && (
        <>
          <div className="text-muted-foreground whitespace-nowrap border-t border-border/60 pt-1 mt-0.5">Rounded</div>
          <div className="break-words whitespace-normal border-t border-border/60 pt-1 mt-0.5">
            <span className="font-mono">{fmt(proposed3M)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Tooltip body explaining the 3M Proposed credit limit. For aggregated rows,
 *  groups constituents under company headers (same layout as AI Proposed). */
function ThreeMProposedReason({ row }: { row: CustomerRow }) {
  const constituents = row.proposedConstituents ?? [];
  const reason = row.proposedCreditLimitReason;

  // Single-constituent — show full breakdown
  if (constituents.length <= 1) {
    if (!reason) {
      return (
        <div>
          <div className="font-semibold mb-1">
            3M Proposed: <span className="font-mono">{fmt(row.proposedCreditLimit3M ?? 0)}</span>
          </div>
          <div className="text-muted-foreground">Reasoning unavailable.</div>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <div className="font-semibold">
          3M Proposed: <span className="font-mono">{fmt(row.proposedCreditLimit3M)}</span>
          <DeltaBadge pct={row.proposedCreditLimit3MDeltaPct ?? null} />
        </div>
        <div className="text-[11px] text-muted-foreground mb-1">
          Avg monthly sales (last 3 months) × 3
        </div>
        <div className="border-t border-border/60 my-1" />
        <ThreeMReasonBreakdown
          avg3MMonthlySales={reason.avg3MMonthlySales}
          proposed3M={row.proposedCreditLimit3M}
        />
      </div>
    );
  }

  // Multi-constituent — group by company.
  const byCompany = new Map<string, ProposedConstituent[]>();
  for (const k of constituents) {
    if (!byCompany.has(k.company)) byCompany.set(k.company, []);
    byCompany.get(k.company)!.push(k);
  }

  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      <div>
        <div className="font-semibold">
          3M Proposed: <span className="font-mono">{fmt(row.proposedCreditLimit3M)}</span>
          <DeltaBadge pct={row.proposedCreditLimit3MDeltaPct ?? null} />
        </div>
        <div className="text-[11px] text-muted-foreground">
          Avg monthly sales (last 3 months) × 3 — sum of {constituents.length} row{constituents.length !== 1 ? "s" : ""} across {byCompany.size} compan{byCompany.size !== 1 ? "ies" : "y"}.
        </div>
      </div>

      {Array.from(byCompany.entries()).map(([company, list]) => {
        const companySum = list.reduce((s, k) => s + k.proposed3M, 0);
        return (
          <div key={company} className="border-t border-border/60 pt-1.5">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                {company}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                Σ <span className="font-mono">{fmt(companySum)}</span>
              </span>
            </div>
            {list.map((k, i) => (
              <div key={`${k.customerId}-${i}`} className={i > 0 ? "mt-2" : ""}>
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-[11px] font-medium text-foreground/90 break-words whitespace-normal min-w-0">
                    {k.customerName}
                  </span>
                  <span className="font-semibold whitespace-nowrap shrink-0">
                    <span className="font-mono">{fmt(k.proposed3M)}</span>
                    <DeltaBadge pct={k.delta3MPct} />
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mb-0.5 flex flex-wrap gap-x-2 gap-y-0">
                  <span>{k.company} · {k.location}</span>
                  <span>•</span>
                  <span>Current limit <span className="font-mono text-foreground/80">{fmt(k.creditLimit)}</span></span>
                </div>
                <ThreeMReasonBreakdown
                  avg3MMonthlySales={k.reason.avg3MMonthlySales}
                  proposed3M={k.proposed3M}
                  compact
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Single-constituent factor breakdown. Two-column wrap-friendly layout. */
function ReasonBreakdown({ reason, compact = false }: { reason: ProposedCreditLimitReason; compact?: boolean }) {
  if (reason.edgeCase === "dormant") {
    return (
      <div className={`${compact ? "text-[11px]" : "text-xs"} text-muted-foreground break-words whitespace-normal`}>
        No sales in last 3 months — dormant. Suggested = current × 0.5.
      </div>
    );
  }

  const sizeCls = compact ? "text-[11px]" : "text-xs";

  const labelCell = (text: string, factor?: string) => (
    <div className="text-muted-foreground whitespace-nowrap">
      {text}{factor !== undefined && <> <span className="font-mono text-foreground/90">{factor}</span></>}
    </div>
  );
  const noteCell = (children: ReactNode) => (
    <div className="break-words whitespace-normal">{children}</div>
  );

  return (
    <div className={`${sizeCls} grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5`}>
      {labelCell("Base")}
      {noteCell(<><span className="font-mono">{fmt(reason.base)}</span> · {fmt(reason.avg3MMonthlySales)}/mo × {reason.cycleMultiplier.toFixed(2)} cycle</>)}

      {labelCell("× Payment", reason.paymentFactor.toFixed(2))}
      {noteCell(reason.paymentReason)}

      {labelCell("× Overdue", reason.overdueFactor.toFixed(2))}
      {noteCell(reason.overdueReason)}

      {labelCell("× Risk", reason.riskFactor.toFixed(2))}
      {noteCell(reason.riskReason)}

      {!compact && (
        <>
          <div className="text-muted-foreground border-t border-border/60 pt-1 mt-0.5 whitespace-nowrap">Computed</div>
          <div className="break-words whitespace-normal border-t border-border/60 pt-1 mt-0.5">
            <span className="font-mono">{fmt(reason.computed)}</span>
          </div>
          {reason.finalBeforeRounding === reason.floor && (
            <>
              {labelCell("Floored")}
              {noteCell(<><span className="font-mono">{fmt(reason.floor)}</span> <span className="text-muted-foreground">(min)</span></>)}
            </>
          )}
          {reason.finalBeforeRounding === reason.ceiling && reason.finalBeforeRounding !== reason.floor && (
            <>
              {labelCell("Capped")}
              {noteCell(<><span className="font-mono">{fmt(reason.ceiling)}</span> <span className="text-muted-foreground">(max)</span></>)}
            </>
          )}
          {labelCell("Rounded")}
          {noteCell(<span className="font-mono">{fmt(reason.final)}</span>)}
        </>
      )}
    </div>
  );
}

/** Tooltip body explaining the AI Proposed credit limit. For aggregated rows,
 *  groups constituents under company headers so the same company isn't repeated. */
function AIProposedReason({ row }: { row: CustomerRow }) {
  const constituents = row.proposedConstituents ?? [];
  const reason = row.proposedCreditLimitReason;

  // Single-constituent (or fallback) — show full breakdown
  if (constituents.length <= 1) {
    if (!reason) {
      return (
        <div>
          <div className="font-semibold mb-1">
            AI Proposed: <span className="font-mono">{fmt(row.proposedCreditLimitAI ?? 0)}</span>
          </div>
          <div className="text-muted-foreground">Reasoning unavailable.</div>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <div className="font-semibold">
          AI Proposed: <span className="font-mono">{fmt(reason.final)}</span>
          <DeltaBadge pct={row.proposedCreditLimitAIDeltaPct ?? null} />
        </div>
        <div className="border-t border-border/60 my-1" />
        <ReasonBreakdown reason={reason} />
      </div>
    );
  }

  // Multi-constituent — group by company, list customers under each company header.
  const byCompany = new Map<string, ProposedConstituent[]>();
  for (const k of constituents) {
    if (!byCompany.has(k.company)) byCompany.set(k.company, []);
    byCompany.get(k.company)!.push(k);
  }

  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      <div>
        <div className="font-semibold">
          AI Proposed: <span className="font-mono">{fmt(row.proposedCreditLimitAI)}</span>
          <DeltaBadge pct={row.proposedCreditLimitAIDeltaPct ?? null} />
        </div>
        <div className="text-[11px] text-muted-foreground">
          Sum of {constituents.length} row{constituents.length !== 1 ? "s" : ""} across {byCompany.size} compan{byCompany.size !== 1 ? "ies" : "y"}.
        </div>
      </div>

      {Array.from(byCompany.entries()).map(([company, list]) => {
        const companySum = list.reduce((s, k) => s + k.proposedAI, 0);
        return (
          <div key={company} className="border-t border-border/60 pt-1.5">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                {company}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                Σ <span className="font-mono">{fmt(companySum)}</span>
              </span>
            </div>
            {list.map((k, i) => (
              <div key={`${k.customerId}-${i}`} className={i > 0 ? "mt-2" : ""}>
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="text-[11px] font-medium text-foreground/90 break-words whitespace-normal min-w-0">
                    {k.customerName}
                  </span>
                  <span className="font-semibold whitespace-nowrap shrink-0">
                    <span className="font-mono">{fmt(k.proposedAI)}</span>
                    <DeltaBadge pct={k.deltaPct} />
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mb-0.5 flex flex-wrap gap-x-2 gap-y-0">
                  <span>{k.company} · {k.location}</span>
                  <span>•</span>
                  <span>Current limit <span className="font-mono text-foreground/80">{fmt(k.creditLimit)}</span></span>
                </div>
                <ReasonBreakdown reason={k.reason} compact />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const trendTabs = [
  { key: "all",          label: "All",          color: "" },
  { key: "sales",        label: "Sales",        color: "hsl(var(--primary))" },
  { key: "receipts",     label: "Receipts",     color: "hsl(142, 71%, 45%)" },
  { key: "creditNotes",  label: "Credit Notes", color: "hsl(271, 75%, 58%)" },
  { key: "checkReturns", label: "Chq Returns",  color: "hsl(213, 94%, 52%)" },
  { key: "outstanding",  label: "Outstanding",  color: "hsl(var(--secondary))" },
  { key: "overdue",      label: "Overdue",      color: "hsl(var(--destructive))" },
] as const;

const trendAllLines = trendTabs.filter((t) => t.key !== "all");

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

const columns: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name",           label: "Customer" },
  { key: "salesPerson",    label: "Sales Person" },
  { key: "companies",      label: "Company" },
  { key: "locations",      label: "Location" },
  { key: "openingBalance", label: "Opening Bal",   align: "right" },
  { key: "sales",          label: "Sales",         align: "right" },
  { key: "receipts",       label: "Receipts",      align: "right" },
  { key: "creditNotes",    label: "Cr. Notes",     align: "right" },
  { key: "debitNotes",     label: "Dr. Notes",     align: "right" },
  { key: "journalAdjustments", label: "Journal (Net)", align: "right" },
  { key: "outstanding",    label: "Outstanding",   align: "right" },
  { key: "overdue",        label: "Overdue",       align: "right" },
  { key: "maxOverdueDays", label: "Max OD Days",   align: "right" },
  { key: "creditPeriod",   label: "Credit Period", align: "right" },
  { key: "creditLimit",    label: "Credit Limit",  align: "right" },
  { key: "proposedCreditLimit3M", label: "3M Proposed", align: "right" },
  { key: "proposedCreditLimitAI", label: "AI Proposed", align: "right" },
  { key: "utilization",    label: "Util %",        align: "right" },
  { key: "risk",           label: "Risk" },
  { key: "blocked",        label: "Blocked" },
];

const ALL_COL_KEYS = columns.map((c) => c.key);
// Columns hidden by default — user can opt-in via the column toggle.
const HIDDEN_BY_DEFAULT: SortKey[] = ["companies", "locations", "proposedCreditLimit3M", "proposedCreditLimitAI"];
const DEFAULT_VISIBLE_COL_KEYS = ALL_COL_KEYS.filter((k) => !HIDDEN_BY_DEFAULT.includes(k));
const COL_STORAGE_KEY = "riskRegister.visibleColumns";

/* ── Component ─────────────────────────────────────────── */

export default function CustomerRiskRegister() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Party rows open the Customer/Group Detail page in a NEW tab so the filtered
  // Risk Register stays intact in the original tab (filters live in component
  // state and don't survive a same-tab Back navigation).
  const openInNewTab = (path: string) =>
    window.open(path, "_blank", "noopener,noreferrer");
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [riskLevels, setRiskLevels] = useState<string[]>([]);
  const [agingFilter, setAgingFilter] = useState("all");
  const [specialFilter, setSpecialFilter] = useState("all");
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [balanceFilter, setBalanceFilter] = useState<"all" | "has_outstanding" | "zero_outstanding">("all");
  const [blockedFilter, setBlockedFilter] = useState<"all" | "blocked" | "not_blocked">("all");
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey | null>("outstanding");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showKpis, setShowKpis] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => {
    try {
      const raw = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      if (raw) {
        if (raw === "all") return "all";
        const n = Number(raw);
        if (PAGE_SIZE_OPTIONS.includes(n as never)) return n;
      }
    } catch {}
    return DEFAULT_PAGE_SIZE;
  });

  useEffect(() => {
    try { localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize)); } catch {}
  }, [pageSize]);
  const [activeTrendKeys, setActiveTrendKeys] = useState<Set<string>>(new Set());
  const [showTrend, setShowTrend] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(
    searchParams.get("view") === "group" ? "group" : "customer",
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [visibleCols, setVisibleCols] = useState<Set<SortKey>>(() => {
    try {
      const raw = localStorage.getItem(COL_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as SortKey[];
        const valid = arr.filter((k) => ALL_COL_KEYS.includes(k));
        if (valid.length > 0) return new Set(valid);
      }
    } catch {}
    return new Set(DEFAULT_VISIBLE_COL_KEYS);
  });

  useEffect(() => {
    try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...visibleCols])); } catch {}
  }, [visibleCols]);

  const toggleCol = (key: SortKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const { loading, error, allCustomers, consolidatedCustomers, groupedCustomers, customerDetail, salesPersonOptions } = useAppData({
    saleType: saleTypes.length === 0 ? "all" : saleTypes.join(","),
    customerSegment,
    balanceFilter,
    salesPerson: salesPersons.length === 0 ? "all" : salesPersons.join(","),
    company:  companyFilter  === "all" ? undefined : companyFilter,
    location: locationFilter === "all" ? undefined : locationFilter,
  });
  const allData: CustomerRow[] = (viewMode === "group" ? groupedCustomers : consolidatedCustomers) as CustomerRow[];

  // Company / Location filter options — dependent (each list narrows by the other
  // selection) and sourced from the unfiltered, salesperson-scoped customer set so
  // the options stay stable as the numeric/segment filters change.
  const companyOptions = useMemo(
    () => [...new Set(
      allCustomers
        .filter((c) => locationFilter === "all" || c.location === locationFilter)
        .map((c) => c.company),
    )].sort(),
    [allCustomers, locationFilter],
  );
  const locationOptions = useMemo(
    () => [...new Set(
      allCustomers
        .filter((c) => companyFilter === "all" || c.company === companyFilter)
        .map((c) => c.location),
    )].sort(),
    [allCustomers, companyFilter],
  );

  // Lookup of consolidated customer rows by Tally name (for rendering child rows
  // under each expanded group).
  const customerByName = useMemo(() => {
    const m = new Map<string, ConsolidatedCustomer>();
    for (const c of consolidatedCustomers) m.set(c.name, c);
    return m;
  }, [consolidatedCustomers]);

  // Persist view mode in the URL so deep links/refreshes preserve it.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (viewMode === "group") params.set("view", "group");
    else                       params.delete("view");
    setSearchParams(params, { replace: true });
    // Reset expanded groups when leaving group view
    if (viewMode === "customer") setExpandedGroups(new Set());
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize filters from URL query params
  useEffect(() => {
    const riskParam     = searchParams.get("risk");
    const agingParam    = searchParams.get("aging");

    const filterParam   = searchParams.get("filter");
    const segmentParam  = searchParams.get("segment");
    if (riskParam)     setRiskLevels(riskParam.toLowerCase().split(",").filter(Boolean));
    if (agingParam)    setAgingFilter(agingParam);

    if (filterParam)   setSpecialFilter(filterParam);
    if (segmentParam === "all" || segmentParam === "active" || segmentParam === "no_activity") setCustomerSegment(segmentParam);
    const blockedParam = searchParams.get("blocked");
    if (blockedParam === "1" || blockedParam === "true") setBlockedFilter("blocked");
  }, [searchParams]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const activeFilterCount = [agingFilter, specialFilter, customerSegment, balanceFilter, blockedFilter, companyFilter, locationFilter].filter((f) => f !== "all").length + (search ? 1 : 0) + (riskLevels.length > 0 ? 1 : 0) + (saleTypes.length > 0 ? 1 : 0) + (salesPersons.length > 0 ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setRiskLevels([]);
    setAgingFilter("all");
    setSpecialFilter("all");
    setCustomerSegment("all");
    setBalanceFilter("all");
    setBlockedFilter("all");
    setSalesPersons([]);
    setSaleTypes([]);
    setCompanyFilter("all");
    setLocationFilter("all");
  };

  const filterChips: FilterChip[] = [
    search && {
      label: `Search: "${search}"`,
      onRemove: () => setSearch(""),
    },
    riskLevels.length > 0 && {
      label: `Risk: ${riskLevels.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}`,
      onRemove: () => setRiskLevels([]),
    },
    agingFilter !== "all" && {
      label: `Aging: ${agingFilter} days`,
      onRemove: () => setAgingFilter("all"),
    },
    specialFilter !== "all" && {
      label: specialFilter === "over_credit_limit" ? "Over Credit Limit" : specialFilter,
      onRemove: () => setSpecialFilter("all"),
    },
    customerSegment !== "all" && {
      label: `Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setCustomerSegment("all"),
    },
    balanceFilter !== "all" && {
      label: `Balance: ${balanceFilter === "has_outstanding" ? "Has Outstanding" : "Zero Outstanding"}`,
      onRemove: () => setBalanceFilter("all"),
    },
    blockedFilter !== "all" && {
      label: blockedFilter === "blocked" ? "Blocked" : "Not Blocked",
      onRemove: () => setBlockedFilter("all"),
    },
    salesPersons.length > 0 && {
      label: salesPersons.length <= 2 ? `Sales: ${salesPersons.join(", ")}` : `Sales: ${salesPersons.length} persons`,
      onRemove: () => setSalesPersons([]),
    },
    saleTypes.length > 0 && {
      label: saleTypes.length <= 2 ? `Type: ${saleTypes.join(", ")}` : `Types: ${saleTypes.length} selected`,
      onRemove: () => setSaleTypes([]),
    },
    companyFilter !== "all" && {
      label: `Company: ${companyFilter}`,
      onRemove: () => setCompanyFilter("all"),
    },
    locationFilter !== "all" && {
      label: `Location: ${locationFilter}`,
      onRemove: () => setLocationFilter("all"),
    },
  ].filter(Boolean) as FilterChip[];

  // Customer-level filter predicate. A group is flagged "blocked" / matching
  // an aging bucket / etc. if *any* of its constituents is — so when filters
  // are applied we re-check each constituent against the same predicate to
  // decide what's actually visible inside the group.
  const childPassesFilters = useMemo(() => {
    const bkMap: Record<string, keyof AgingBuckets> = {
      "0-30": "0_30", "31-60": "31_60", "61-90": "61_90",
      "91-120": "91_120", "121-180": "121_180", "180+": "180_plus",
    };
    const agingBk = agingFilter !== "all" ? bkMap[agingFilter] : null;
    return (r: CustomerRow): boolean => {
      if (search && !matchesSearch(search, r.name, r.id)) return false;
      if (riskLevels.length > 0 && !riskLevels.includes(r.risk)) return false;
      if (agingBk && !((r.agingBuckets?.[agingBk] ?? 0) > 0)) return false;
      if (specialFilter === "over_credit_limit" && !(r.utilization > 100)) return false;
      if (blockedFilter === "blocked" && r.blocked !== true) return false;
      if (blockedFilter === "not_blocked" && r.blocked === true) return false;
      return true;
    };
  }, [search, riskLevels, agingFilter, specialFilter, blockedFilter]);

  const rows = useMemo(() => {
    let d = [...allData];
    // Active aging bucket (if any) — drives both the bucket filter below and the
    // overdue sort, so the Overdue column sorts by the SAME value it displays.
    const bkMap: Record<string, keyof AgingBuckets> = {
      "0-30": "0_30", "31-60": "31_60", "61-90": "61_90",
      "91-120": "91_120", "121-180": "121_180", "180+": "180_plus",
    };
    const bucketKey: keyof AgingBuckets | null =
      agingFilter !== "all" ? (bkMap[agingFilter] ?? null) : null;
    if (search) {
      // In group mode, also match by underlying Tally child name.
      d = d.filter((r) => {
        if (matchesSearch(search, r.name, r.id)) return true;
        if (viewMode === "group" && r.childNames?.some((n) => matchesSearch(search, n))) return true;
        return false;
      });
    }
    if (riskLevels.length > 0) {
      d = d.filter((r) => riskLevels.includes(r.risk));
    }
    if (bucketKey) {
      d = d.filter((r) => (r.agingBuckets?.[bucketKey] ?? 0) > 0);
    }
    if (specialFilter === "over_credit_limit") {
      d = d.filter((r) => r.utilization > 100);
    }
    if (blockedFilter === "blocked") {
      d = d.filter((r) => r.blocked === true);
    } else if (blockedFilter === "not_blocked") {
      d = d.filter((r) => r.blocked !== true);
    }
    // Refine expandable groups by the visible-child count: a group with zero
    // surviving children is dropped, and a group with only one is degraded
    // to a plain customer row (no tree, no expand chevron, no badge) so it
    // truly behaves like a single customer in both rendering and counts.
    if (viewMode === "group") {
      d = d.flatMap<CustomerRow>((r) => {
        if (!(r.isGroup ?? false)) return [r];
        const visible = (r.childNames ?? [])
          .map((n) => customerByName.get(n) as CustomerRow | undefined)
          .filter((c): c is CustomerRow => !!c && childPassesFilters(c));
        if (visible.length === 0) return [];
        if (visible.length === 1) return [{ ...visible[0], isGroup: false, childNames: undefined }];
        return [{ ...r, childNames: visible.map((c) => c.name) }];
      });
    }
    if (sortKey && sortDir) {
      // For the Overdue column, sort by the value actually shown: the selected
      // aging bucket's amount when a bucket filter is active, else total overdue.
      const valueFor = (r: CustomerRow) =>
        sortKey === "overdue" && bucketKey ? (r.agingBuckets?.[bucketKey] ?? 0) : r[sortKey];
      d.sort((a, b) => {
        const av = valueFor(a);
        const bv = valueFor(b);
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return d;
  }, [allData, search, riskLevels, agingFilter, specialFilter, blockedFilter, sortKey, sortDir, viewMode, customerByName, childPassesFilters]);

  // When an aging bucket filter is active, sum only that specific bucket's overdue
  // rather than the customer's total overdue — otherwise customers with e.g. 180+ day
  // invoices also bring in their 0–30 day overdue amounts, overstating the figure.
  const agingBucketKey: keyof AgingBuckets | null = useMemo(() => {
    const map: Record<string, keyof AgingBuckets> = {
      "0-30":    "0_30",
      "31-60":   "31_60",
      "61-90":   "61_90",
      "91-120":  "91_120",
      "121-180": "121_180",
      "180+":    "180_plus",
    };
    return agingFilter !== "all" ? (map[agingFilter] ?? null) : null;
  }, [agingFilter]);

  // Overdue shown per row: the selected bucket's amount when an aging filter is
  // active, else the customer's total overdue. Keeps the column consistent with
  // the bucket-aware KPI total and the customer-detail aging breakdown.
  const overdueForRow = (r: CustomerRow) =>
    agingBucketKey ? (r.agingBuckets?.[agingBucketKey] ?? 0) : r.overdue;

  // Collapse a multi-value company/location list to a single display label,
  // matching the group view's convention (single value, else "Multiple").
  const showList = (xs?: string[]) => (!xs?.length ? "—" : xs.length === 1 ? xs[0] : "Multiple");

  const totals = useMemo(() => ({
    sales:             rows.reduce((s, r) => s + r.sales, 0),
    receipts:          rows.reduce((s, r) => s + r.receipts, 0),
    creditNotes:       rows.reduce((s, r) => s + r.creditNotes, 0),
    debitNotes:        rows.reduce((s, r) => s + (r.debitNotes ?? 0), 0),
    journalAdjustments: rows.reduce((s, r) => s + (r.journalAdjustments ?? 0), 0),
    checkReturns:      rows.reduce((s, r) => s + (r.checkReturns ?? 0), 0),
    outstanding:       sumOutstanding(rows),
    overdue:           agingBucketKey
                         ? rows.reduce((s, r) => s + (r.agingBuckets?.[agingBucketKey] ?? 0), 0)
                         : rows.reduce((s, r) => s + r.overdue, 0),
    count:             rows.length,
    criticalCustomers: rows.filter((r) => r.risk === "critical").length,
    overCreditLimit:   rows.filter((r) => r.utilization > 100).length,
    overdue180Plus:    rows.filter((r) => r.maxOverdueDays > 180).length,
  }), [rows, agingBucketKey]);

  const aggregatedTrend = useMemo(() => {
    if (rows.length === 0 || rows.length >= 10) return [];
    const byMonth = new Map<string, {
      month: string; sales: number; receipts: number;
      creditNotes: number; checkReturns: number;
      outstanding: number; overdue: number;
    }>();
    for (const row of rows) {
      const ids = (row as unknown as ConsolidatedCustomer).constituentIds ?? [row.id];
      for (const id of ids) {
        for (const t of customerDetail[id]?.trend ?? []) {
          if (!byMonth.has(t.month)) {
            byMonth.set(t.month, { ...t, checkReturns: (t as any).checkReturns ?? 0 });
          } else {
            const m = byMonth.get(t.month)!;
            m.sales         += t.sales;
            m.receipts      += t.receipts;
            m.creditNotes   += t.creditNotes;
            m.checkReturns  += (t as any).checkReturns ?? 0;
            m.outstanding   += t.outstanding;
            m.overdue       += t.overdue;
          }
        }
      }
    }
    // Sort chronologically by calendar order (handles cross-FY ranges, e.g.
    // Jan-26/Feb-26/Mar-26 in FY 25-26 followed by Apr-26 in FY 26-27).
    const calMonth = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return [...byMonth.values()].sort((a, b) => {
      const [am, ay] = [a.month.slice(0, 3), a.month.slice(4)];
      const [bm, by_] = [b.month.slice(0, 3), b.month.slice(4)];
      if (ay !== by_) return Number(ay) - Number(by_);
      return calMonth.indexOf(am) - calMonth.indexOf(bm);
    });
  }, [rows, customerDetail]);

  const activeLines = activeTrendKeys.size === 0
    ? trendAllLines
    : trendAllLines.filter((t) => activeTrendKeys.has(t.key));

  // Auto-expand groups whose child Tally names match the current search.
  useEffect(() => {
    if (viewMode !== "group" || !search) return;
    const toExpand = new Set<string>();
    for (const r of allData) {
      if (r.childNames && (r.isGroup ?? r.childNames.length > 1)
          && r.childNames.some((n) => matchesSearch(search, n))) {
        toExpand.add(r.name);
      }
    }
    if (toExpand.size > 0) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        for (const g of toExpand) next.add(g);
        return next;
      });
    }
  }, [search, viewMode, allData]);

  // Reset to page 1 whenever filters, sort, or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, riskLevels, agingFilter, blockedFilter, sortKey, sortDir, viewMode, pageSize]);

  const effectivePageSize = pageSize === "all" ? Math.max(rows.length, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(rows.length / effectivePageSize));
  const paginatedRows = pageSize === "all"
    ? rows
    : rows.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);
  const rangeStart = rows.length === 0 ? 0 : (currentPage - 1) * effectivePageSize + 1;
  const rangeEnd = Math.min(currentPage * effectivePageSize, rows.length);

  const handleExport = () => {
    if (rows.length === 0) {
      toast({ title: "Nothing to export", description: "No customers match the current filters." });
      return;
    }

    const visibleCols_ = columns.filter((c) => visibleCols.has(c.key));
    const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const PCT_FMT = '0.0"%"';
    const INT_FMT = "0";
    const numericFmt: Partial<Record<SortKey, string>> = {
      openingBalance: INR_FMT, sales: INR_FMT, receipts: INR_FMT,
      creditNotes: INR_FMT, debitNotes: INR_FMT, journalAdjustments: INR_FMT,
      outstanding: INR_FMT, overdue: INR_FMT, creditLimit: INR_FMT,
      proposedCreditLimit3M: INR_FMT, proposedCreditLimitAI: INR_FMT,
      maxOverdueDays: INT_FMT, creditPeriod: INT_FMT,
      utilization: PCT_FMT,
    };

    const header = visibleCols_.map((c) =>
      c.key === "overdue" && agingBucketKey ? `Overdue (${agingFilter})` : c.label);
    const aoa: (string | number)[][] = [header];
    for (const row of rows) {
      const r: (string | number)[] = [];
      for (const c of visibleCols_) {
        if (c.key === "salesPerson") {
          r.push(row.salesPersons?.join("; ") ?? row.salesPerson ?? "");
        } else if (c.key === "companies" || c.key === "locations") {
          r.push((row[c.key] as string[] | undefined)?.join("; ") ?? "");
        } else if (c.key === "risk") {
          r.push(row.risk.charAt(0).toUpperCase() + row.risk.slice(1));
        } else if (c.key === "blocked") {
          r.push(row.blocked ? "Blocked" : "");
        } else if (c.key === "overdue") {
          r.push(overdueForRow(row));
        } else if (c.key === "utilization") {
          // Blocked customers carry a ₹1 sentinel credit limit, not a real limit,
          // so their utilization % is meaningless — export a dash instead.
          r.push(row.blocked ? "—" : row.utilization);
        } else {
          const v = row[c.key];
          r.push(typeof v === "number" ? v : (v ?? "") as string);
        }
      }
      aoa.push(r);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Apply number formats to numeric columns.
    for (let ci = 0; ci < visibleCols_.length; ci++) {
      const fmt = numericFmt[visibleCols_[ci].key];
      if (!fmt) continue;
      for (let ri = 1; ri < aoa.length; ri++) {
        const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
        const cell = ws[ref];
        if (cell && typeof cell.v === "number") cell.z = fmt;
      }
    }

    // Auto column widths.
    ws["!cols"] = visibleCols_.map((c, ci) => {
      let max = c.label.length;
      for (let ri = 1; ri < aoa.length; ri++) {
        const v = aoa[ri][ci];
        const len = typeof v === "number" ? Math.round(v).toString().length + 4 : String(v ?? "").length;
        if (len > max) max = len;
      }
      return { wch: Math.min(Math.max(max + 2, 10), 40) };
    });

    // Freeze header row.
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    // Column header row: bold, black fill, white text.
    styleRow(ws, 0, visibleCols_.length, HEADER_STYLE);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Risk Register");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const ts = new Date().toISOString().slice(0, 10);
    saveAs(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `risk-register-${ts}.xlsx`,
    );

    toast({ title: "Export complete", description: `${rows.length} customer${rows.length !== 1 ? "s" : ""} exported to Excel.` });
  };
  const handleSaveView = () => toast({ title: "View saved", description: "Current filters have been saved." });

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

  return (
    <UITooltipProvider>
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Customer Risk Register</h1>
            <p className="text-sm text-muted-foreground">
              {(() => {
                const unit = viewMode === "group" ? "group" : "customer";
                if (rows.length === 0) return `0 of ${allData.length} ${unit}s`;
                return `Showing ${rangeStart}–${rangeEnd} of ${rows.length} ${unit}${rows.length !== 1 ? "s" : ""}`;
              })()}
            </p>
            <p className="text-[11px] text-muted-foreground/80 italic mt-0.5">
              Note: "Blocked" is set when the source-sheet credit limit equals 1. In practice this marker is used for the INK product category only.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-button border-border">
                <Columns3 className="h-4 w-4 mr-2" />
                Columns{visibleCols.size < columns.length ? ` (${visibleCols.size}/${columns.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleCols.has(col.key)}
                  onCheckedChange={() => toggleCol(col.key)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={visibleCols.size === columns.length}
                onCheckedChange={() => setVisibleCols(new Set(ALL_COL_KEYS))}
                onSelect={(e) => e.preventDefault()}
              >
                Show all
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleSaveView} className="rounded-button border-border">
            <Save className="h-4 w-4 mr-2" /> Save View
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="rounded-button border-border">
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">View</span>
              <div className="inline-flex rounded-input border border-border h-9 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode("customer")}
                  className={`px-3 text-sm font-medium transition-colors ${viewMode === "customer" ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted/50"}`}
                >
                  Customers
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("group")}
                  className={`px-3 text-sm font-medium transition-colors border-l border-border ${viewMode === "group" ? "bg-primary text-primary-foreground" : "bg-transparent text-foreground hover:bg-muted/50"}`}
                >
                  Groups
                </button>
              </div>
            </div>
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

            {companyOptions.length > 1 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-[150px] rounded-input border-border text-sm">
                    <SelectValue placeholder="All Companies" />
                  </SelectTrigger>
                  <SelectContent className="rounded-input">
                    <SelectItem value="all">All Companies</SelectItem>
                    {companyOptions.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {locationOptions.length > 1 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="w-[150px] rounded-input border-border text-sm">
                    <SelectValue placeholder="All Locations" />
                  </SelectTrigger>
                  <SelectContent className="rounded-input">
                    <SelectItem value="all">All Locations</SelectItem>
                    {locationOptions.map((loc) => (
                      <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Blocked</span>
              <Select value={blockedFilter} onValueChange={(v) => setBlockedFilter(v as "all" | "blocked" | "not_blocked")}>
                <SelectTrigger className="w-36 rounded-input h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="blocked">Blocked only</SelectItem>
                  <SelectItem value="not_blocked">Not blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sales Person</span>
              <SalesPersonMultiSelect options={salesPersonOptions} value={salesPersons} onChange={setSalesPersons} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sale Type</span>
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} />
            </div>
          </div>
          {saleTypes.length > 0 && (
            <p className="text-[11px] text-muted-foreground italic mt-2">
              Opening balance, on-account/advance receipts, unlinked credit notes and cheque returns have no sale type — they're distributed across types by each customer's sales mix (estimate), so figures still reconcile to the total.
            </p>
          )}
          <FilterChips chips={filterChips} onClearAll={clearFilters} />
        </CardContent>
      </Card>

      {/* KPI Cards — collapsible, closed by default */}
      {rows.length > 0 && (() => {
        const groupMode = viewMode === "group";
        const kpiCards = [
          { label: groupMode ? "Groups" : "Customers", value: String(totals.count), icon: Users, warn: false },
          { label: "Sales",              value: fmt(totals.sales),                icon: DollarSign,    warn: false },
          { label: "Receipts",           value: fmt(totals.receipts),             icon: Receipt,       warn: false },
          { label: "Credit Notes",       value: fmtINRMoney(totals.creditNotes),          icon: FileMinus,     warn: false },
          { label: "Debit Notes",        value: fmtINRMoney(totals.debitNotes),           icon: FileMinus,     warn: true  },
          { label: "Journal Adj (Net)",  value: fmtINRDrCr(totals.journalAdjustments),    icon: FileMinus,     warn: totals.journalAdjustments > 0 },
          { label: "Cheque Returns",     value: fmtINRMoney(totals.checkReturns),         icon: RotateCcw,     warn: true  },
          { label: "Outstanding",        value: fmt(Math.abs(totals.outstanding)),          icon: TrendingDown,  warn: true  },
          { label: "Overdue",            value: fmt(totals.overdue),              icon: Clock,         warn: true  },
          { label: groupMode ? "Critical Groups" : "Critical Customers", value: String(totals.criticalCustomers), icon: ShieldAlert,   warn: true  },
          { label: "Over Credit Limit",  value: String(totals.overCreditLimit),   icon: AlertTriangle, warn: true  },
          { label: "180+ Overdue",       value: String(totals.overdue180Plus),    icon: Users,         warn: true  },
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
                  Summary — {totals.count} {viewMode === "group" ? "group" : "customer"}{totals.count !== 1 ? "s" : ""}
                </span>
              </div>
            </button>
            {showKpis && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="border-t border-border pt-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
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

      {/* Aggregate Trend — shown only when < 10 customers match filters */}
      {rows.length > 0 && rows.length < 10 && aggregatedTrend.length > 0 && (
        <Card className="rounded-card">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors rounded-card"
            onClick={() => setShowTrend((v) => !v)}
          >
            <div className="flex items-center gap-2">
              {showTrend
                ? <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Trends — {rows.length} customer{rows.length !== 1 ? "s" : ""}
              </span>
            </div>
          </button>
          {showTrend && (
          <CardContent className="px-4 pb-4 pt-0">
            <div className="border-t border-border pt-3">
            <div className="flex flex-wrap gap-1 mb-4">
              {/* All — clears selection */}
              <Button
                key="all"
                variant={activeTrendKeys.size === 0 ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTrendKeys(new Set())}
                className="rounded-button text-xs h-7"
              >
                All
              </Button>
              {trendAllLines.map((t) => {
                const active = activeTrendKeys.has(t.key);
                return (
                <Button
                  key={t.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.key)) next.delete(t.key);
                      else next.add(t.key);
                      return next;
                    });
                  }}
                  className="rounded-button text-xs h-7"
                >
                  {t.label}
                </Button>
                );
              })}
            </div>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={aggregatedTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmtL} width={72} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--surface))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                    formatter={(v: number) => fmtL(v)}
                  />
                  <>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {activeLines.map((t) => (
                      <Line
                        key={t.key}
                        type="monotone"
                        dataKey={t.key}
                        name={t.label}
                        stroke={t.color}
                        strokeWidth={2}
                        dot={{ r: activeLines.length === 1 ? 4 : 3, fill: t.color }}
                        activeDot={{ r: activeLines.length === 1 ? 6 : 5 }}
                      />
                    ))}
                  </>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-6 gap-3">
              {[
                { label: "Total Sales",       value: fmtL(aggregatedTrend.reduce((s, r) => s + r.sales, 0)),              color: "text-primary" },
                { label: "Total Receipts",    value: fmtL(aggregatedTrend.reduce((s, r) => s + r.receipts, 0)),           color: "text-[hsl(142,71%,45%)]" },
                { label: "Total Cr. Notes",   value: fmtL(aggregatedTrend.reduce((s, r) => s + r.creditNotes, 0)),        color: "text-[hsl(271,75%,58%)]" },
                { label: "Total Chq Returns", value: fmtL(aggregatedTrend.reduce((s, r) => s + r.checkReturns, 0)),       color: "text-[hsl(213,94%,52%)]" },
                { label: "Outstanding",       value: fmt(Math.abs(totals.outstanding)), color: "text-secondary" },
                { label: "Overdue",           value: fmt(totals.overdue),    color: "text-destructive" },
              ].map((item) => (
                <div key={item.label} className="bg-muted/40 rounded-input px-3 py-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{item.label}</p>
                  <p className={`text-sm font-bold font-mono mt-0.5 ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>
            </div>
          </CardContent>
          )}
        </Card>
      )}

      {/* Table */}
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <ScrollableTable>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {columns.filter((col) => visibleCols.has(col.key)).map((col) => (
                  <TableHead
                    key={col.key}
                    className={`text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap ${col.align === "right" ? "text-right" : ""} ${col.key === "name" ? "sticky left-0 z-20 bg-muted shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]" : ""}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.key === "overdue" && agingBucketKey ? `Overdue (${agingFilter})` : col.label}
                      {sortKey === col.key && sortDir === "asc"  && <ArrowUp   className="h-3 w-3" />}
                      {sortKey === col.key && sortDir === "desc" && <ArrowDown  className="h-3 w-3" />}
                      {sortKey !== col.key && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleCols.size + 1} className="text-center py-12 text-muted-foreground">
                    No {viewMode === "group" ? "groups" : "customers"} match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows.flatMap((row) => {
                  const isExpandableGroup = viewMode === "group" && (row.isGroup ?? false);
                  const isExpanded        = isExpandableGroup && expandedGroups.has(row.name);
                  const navTarget = isExpandableGroup
                    ? `/outstanding-dashboard/group/${encodeURIComponent(row.name)}`
                    : `/outstanding-dashboard/customer/${encodeURIComponent(row.name)}`;
                  // `rows` has already pruned childNames to those that pass the
                  // active filters (and degraded single-child groups to plain
                  // rows), so this lookup is straightforward.
                  const visibleChildren: CustomerRow[] = isExpandableGroup
                    ? (row.childNames ?? [])
                        .map((n) => customerByName.get(n) as CustomerRow | undefined)
                        .filter((c): c is CustomerRow => !!c)
                    : [];

                  const renderRow = (
                    r: CustomerRow,
                    opts: { isChild?: boolean; key: string; onClick: () => void; leadCell: ReactNode },
                  ) => (
                    <TableRow
                      key={opts.key}
                      className={`group hover:bg-muted/30 transition-colors cursor-pointer ${opts.isChild ? "bg-muted/10" : ""}`}
                      onClick={opts.onClick}
                    >
                      {visibleCols.has("name") && (
                        <TableCell
                          className={`font-medium text-sm whitespace-nowrap sticky left-0 z-10 bg-surface group-hover:bg-[hsl(var(--muted))] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]`}
                        >
                          {opts.leadCell}
                        </TableCell>
                      )}
                      {visibleCols.has("salesPerson") && (
                        <TableCell className="text-sm whitespace-nowrap">{r.salesPersons?.join(", ") ?? r.salesPerson}</TableCell>
                      )}
                      {visibleCols.has("companies") && (
                        <TableCell className="text-sm whitespace-nowrap" title={r.companies?.join(", ")}>{showList(r.companies)}</TableCell>
                      )}
                      {visibleCols.has("locations") && (
                        <TableCell className="text-sm whitespace-nowrap" title={r.locations?.join(", ")}>{showList(r.locations)}</TableCell>
                      )}
                      {visibleCols.has("openingBalance") && (
                        <TableCell className="text-sm text-right font-mono">{fmt(r.openingBalance)}</TableCell>
                      )}
                      {visibleCols.has("sales") && (
                        <TableCell className="text-sm text-right font-mono">{fmt(r.sales)}</TableCell>
                      )}
                      {visibleCols.has("receipts") && (
                        <TableCell className="text-sm text-right font-mono">{fmt(r.receipts)}</TableCell>
                      )}
                      {visibleCols.has("creditNotes") && (
                        <TableCell className="text-sm text-right font-mono">{fmt(r.creditNotes)}</TableCell>
                      )}
                      {visibleCols.has("debitNotes") && (
                        <TableCell className="text-sm text-right font-mono">{fmtINRMoney(r.debitNotes ?? 0)}</TableCell>
                      )}
                      {visibleCols.has("journalAdjustments") && (
                        <TableCell className={`text-sm text-right font-mono ${(r.journalAdjustments ?? 0) > 0 ? "text-destructive" : (r.journalAdjustments ?? 0) < 0 ? "text-emerald-700" : ""}`}>
                          {fmtINRDrCr(r.journalAdjustments ?? 0)}
                        </TableCell>
                      )}
                      {visibleCols.has("outstanding") && (
                        <TableCell className={`text-sm text-right font-mono font-semibold ${r.outstanding < 0 ? "text-emerald-600" : ""}`}>
                          {fmt(Math.abs(r.outstanding))}
                          {r.outstanding < 0 && <span className="text-[10px] font-normal ml-0.5">(Cr)</span>}
                        </TableCell>
                      )}
                      {visibleCols.has("overdue") && (
                        <TableCell className={`text-sm text-right font-mono ${overdueForRow(r) > 0 ? "text-destructive font-semibold" : ""}`}>
                          {fmt(overdueForRow(r))}
                        </TableCell>
                      )}
                      {visibleCols.has("maxOverdueDays") && (
                        <TableCell className={`text-sm text-right font-mono ${r.maxOverdueDays > 180 ? "text-destructive font-semibold" : r.maxOverdueDays > 90 ? "text-primary font-semibold" : ""}`}>
                          {r.maxOverdueDays}
                        </TableCell>
                      )}
                      {visibleCols.has("creditPeriod") && (
                        <TableCell className="text-sm text-right">{r.creditPeriod}d</TableCell>
                      )}
                      {visibleCols.has("creditLimit") && (
                        <TableCell className="text-sm text-right font-mono">{fmt(r.creditLimit)}</TableCell>
                      )}
                      {visibleCols.has("proposedCreditLimit3M") && (
                        <TableCell className="text-sm text-right font-mono whitespace-nowrap">
                          <UITooltip delayDuration={150}>
                            <UITooltipTrigger asChild>
                              <span
                                className="inline-flex items-center cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {fmt(r.proposedCreditLimit3M ?? 0)}
                                <DeltaBadge pct={r.proposedCreditLimit3MDeltaPct ?? null} />
                              </span>
                            </UITooltipTrigger>
                            <UITooltipContent
                              side="left"
                              className="w-[22rem] max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed whitespace-normal break-words"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ThreeMProposedReason row={r} />
                            </UITooltipContent>
                          </UITooltip>
                        </TableCell>
                      )}
                      {visibleCols.has("proposedCreditLimitAI") && (
                        <TableCell className="text-sm text-right font-mono whitespace-nowrap">
                          <UITooltip delayDuration={150}>
                            <UITooltipTrigger asChild>
                              <span
                                className="inline-flex items-center cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {fmt(r.proposedCreditLimitAI ?? 0)}
                                <DeltaBadge pct={r.proposedCreditLimitAIDeltaPct ?? null} />
                              </span>
                            </UITooltipTrigger>
                            <UITooltipContent
                              side="left"
                              className="w-[22rem] max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed whitespace-normal break-words"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <AIProposedReason
                                row={r}
                              />
                            </UITooltipContent>
                          </UITooltip>
                        </TableCell>
                      )}
                      {visibleCols.has("utilization") && (
                        <TableCell className={`text-sm text-right font-mono font-semibold ${r.blocked ? "text-muted-foreground" : r.utilization > 100 ? "text-destructive" : r.utilization > 80 ? "text-primary" : ""}`}>
                          {r.blocked ? "—" : `${r.utilization}%`}
                        </TableCell>
                      )}
                      {visibleCols.has("risk") && (
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${riskStyle[r.risk]}`}>
                            {r.risk}
                          </Badge>
                        </TableCell>
                      )}
                      {visibleCols.has("blocked") && (
                        <TableCell>
                          {r.blocked ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-destructive/15 text-destructive border-destructive/30">
                              Blocked
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Button
                          variant="ghost" size="sm"
                          onClick={(e) => { e.stopPropagation(); opts.onClick(); }}
                          className="h-7 w-7 p-0 rounded-button text-muted-foreground hover:text-primary"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );

                  const parentLead = (
                    <span className="inline-flex items-center gap-2">
                      {isExpandableGroup ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.name)) next.delete(row.name);
                              else                     next.add(row.name);
                              return next;
                            });
                          }}
                          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50 shrink-0"
                          aria-label={isExpanded ? "Collapse group" : "Expand group"}
                        >
                          {isExpanded
                            ? <ChevronDown  className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      {row.name}
                      {isExpandableGroup && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 rounded font-normal text-muted-foreground border-border shrink-0">
                          {row.childNames?.length ?? 0} customers
                        </Badge>
                      )}
                      {row.sales === 0 && row.receipts === 0 && row.creditNotes === 0 && (
                        <Badge className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 border border-amber-200 rounded font-normal shrink-0">
                          No Activity
                        </Badge>
                      )}
                    </span>
                  );

                  const out: ReactNode[] = [];
                  out.push(renderRow(row, {
                    key: row.id,
                    onClick: () => openInNewTab(navTarget),
                    leadCell: parentLead,
                  }));

                  if (isExpanded) {
                    for (const child of visibleChildren) {
                      out.push(renderRow(child, {
                        key: `${row.id}::${child.id}`,
                        isChild: true,
                        onClick: () => openInNewTab(`/outstanding-dashboard/customer/${encodeURIComponent(child.name)}`),
                        leadCell: (
                          <span className="inline-flex items-center gap-2 pl-7 text-muted-foreground">
                            <span className="text-xs">↳</span>
                            <span className="text-foreground">{child.name}</span>
                          </span>
                        ),
                      }));
                    }
                  }

                  return out;
                })
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>

      {/* Pagination */}
      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(v === "all" ? "all" : Number(v))}
            >
              <SelectTrigger className="w-[90px] h-8 rounded-input border-border text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-input">
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={String(opt)} value={String(opt)}>
                    {opt === "all" ? "All" : opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {rangeStart}–{rangeEnd} of {rows.length}
            </span>
          </div>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
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
      )}
    </div>
    </UITooltipProvider>
  );
}
