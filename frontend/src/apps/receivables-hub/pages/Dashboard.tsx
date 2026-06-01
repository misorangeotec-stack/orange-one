import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  TrendingUp, TrendingDown, AlertTriangle, Users, DollarSign, Receipt,
  Clock, ShieldAlert, Filter, Download, RefreshCw, ChevronRight, ChevronDown, ChevronUp,
  FileMinus, FilePlus, RotateCcw, BookOpen,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData } from "@hub/lib/useAppData";
import { fmtINRMoney, fmtINRDrCr, formatDateDMY, formatDateTimeDMY } from "@hub/lib/utils";
import { RiskLegendPopover } from "@hub/components/RiskLegendPopover";
import { ActivityLegendPopover } from "@hub/components/ActivityLegendPopover";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { RiskMultiSelect } from "@hub/components/RiskMultiSelect";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";

/* ── Helpers ────────────────────────────────────────────── */

const fmt = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs  = Math.abs(n);
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

// Formats a value that is already expressed in Lakhs
const fmtL = (n: number) => {
  if (n >= 100) return `₹${(n / 100).toFixed(2)} Cr`;
  return `₹${n.toFixed(2)} L`;
};

const riskBadgeClass: Record<string, string> = {
  Critical: "bg-destructive/10 text-destructive border-destructive/20",
  High:     "bg-primary/10 text-primary border-primary/20",
  Medium:   "bg-amber-100 text-amber-700 border-amber-200",
  Low:      "bg-emerald-100 text-emerald-700 border-emerald-200",
};

/* ── Component ─────────────────────────────────────────── */

type ViewMode = "customer" | "group";

export default function Dashboard() {
  const { toast } = useToast();
  const navigate  = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [riskLevels,      setRiskLevels]      = useState<string[]>([]);
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [balanceFilter,   setBalanceFilter]   = useState<"all" | "has_outstanding" | "zero_outstanding">("all");
  const [blockedFilter,   setBlockedFilter]   = useState<"all" | "blocked" | "not_blocked">("all");
  const [salesPersons,    setSalesPersons]    = useState<string[]>([]);
  const [saleTypes,       setSaleTypes]       = useState<string[]>([]);
  const [showBuildup,     setShowBuildup]     = useState(false);
  const [viewMode,        setViewMode]        = useState<ViewMode>(
    searchParams.get("view") === "group" ? "group" : "customer",
  );
  const isGroupMode = viewMode === "group";

  const { loading, error, kpis, trend, aging, riskSegmentation,
          topRiskyCustomers, alerts, dashboard, riskTrend, riskCountTrend,
          groupedCustomers,
          salesPersonOptions } = useAppData({
    risk: riskLevels.length === 0 ? "all" : riskLevels.join(","),
    saleType: saleTypes.length === 0 ? "all" : saleTypes.join(","),
    customerSegment,
    balanceFilter,
    blockedFilter,
    salesPerson: salesPersons.length === 0 ? "all" : salesPersons.join(","),
  });

  // Persist view mode in URL so refresh / deep links keep the toggle state.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (viewMode === "group") params.set("view", "group");
    else                       params.delete("view");
    setSearchParams(params, { replace: true });
  }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Group-mode count KPIs ───────────────────────────────────────────────
  // Money totals (sales / receipts / etc) are mathematically identical between
  // the two views, so kpis stays as-is. Only counts and risk-distribution
  // change with grouping.
  const groupCounts = useMemo(() => ({
    total:        groupedCustomers.length,
    critical:     groupedCustomers.filter((g) => g.risk === "critical").length,
    overLimit:    groupedCustomers.filter((g) => g.utilization > 100).length,
    overdue180:   groupedCustomers.filter((g) => g.maxOverdueDays > 180).length,
    blocked:      groupedCustomers.filter((g) => g.blocked).length,
  }), [groupedCustomers]);

  // Risk segmentation pie — recomputed from groups (% of group count).
  const groupRiskSegmentation = useMemo(() => {
    const colors: Record<string, string> = {
      Low:      "hsl(142, 71%, 45%)",
      Medium:   "hsl(45, 93%, 47%)",
      High:     "hsl(28, 80%, 52%)",
      Critical: "hsl(0, 84%, 60%)",
    };
    const total = groupedCustomers.length;
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    groupedCustomers.forEach((g) => { counts[g.risk] = (counts[g.risk] ?? 0) + 1; });
    return ["Low", "Medium", "High", "Critical"].map((label) => {
      const k = label.toLowerCase();
      return {
        name:  label,
        value: total > 0 ? Math.round((counts[k] ?? 0) / total * 1000) / 10 : 0,
        count: counts[k] ?? 0,
        color: colors[label],
      };
    });
  }, [groupedCustomers]);

  // Top risky groups — top 10 by overdue.
  const topRiskyGroups = useMemo(() => {
    return [...groupedCustomers]
      .filter((g) => g.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 10);
  }, [groupedCustomers]);

  const displayRiskSegmentation = isGroupMode ? groupRiskSegmentation : riskSegmentation;
  const displayTopRisky = isGroupMode
    ? topRiskyGroups.map((g) => ({
        id:        g.id,
        name:      g.name,
        company:   g.company,
        overdue:   g.overdue,
        maxODDays: g.maxOverdueDays,
        risk:      g.risk,
        isGroup:   g.isGroup,
      }))
    : topRiskyCustomers.map((c) => ({
        id:        c.id,
        name:      c.name,
        company:   c.company,
        overdue:   c.overdue,
        maxODDays: c.maxODDays,
        risk:      c.risk,
        isGroup:   false,
      }));

  // Last 6 months of trend data for the chart
  const trendChart = trend.slice(-6);

  const handleExport = () =>
    toast({ title: "Exported", description: "Dashboard summary downloaded." });

  /* ── Loading / Error states ─────────────────────────────*/
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading receivables data…</p>
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

  const filterChips: FilterChip[] = [
    riskLevels.length > 0 && {
      label: `Risk: ${riskLevels.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}`,
      onRemove: () => setRiskLevels([]),
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
  ].filter(Boolean) as FilterChip[];

  const clearAllFilters = () => {
    setRiskLevels([]);
    setCustomerSegment("all");
    setBalanceFilter("all");
    setBlockedFilter("all");
    setSalesPersons([]);
    setSaleTypes([]);
  };

  /* ── Helper: build Risk Register URL carrying current dashboard filters ─*/
  const buildRRUrl = (base: string): string => {
    const [path, existing] = base.split("?");
    const params = new URLSearchParams(existing ?? "");
    params.set("segment", customerSegment);
    if (isGroupMode)               params.set("view", "group");
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  /* ── KPI cards ──────────────────────────────────────────*/
  const totalCountValue   = String(isGroupMode ? groupCounts.total      : kpis?.totalCustomers     ?? 0);
  const criticalValue     = String(isGroupMode ? groupCounts.critical   : kpis?.criticalCustomers  ?? 0);
  const overLimitValue    = String(isGroupMode ? groupCounts.overLimit  : kpis?.overCreditLimit    ?? 0);
  const overdue180Value   = String(isGroupMode ? groupCounts.overdue180 : kpis?.overdue180Plus     ?? 0);
  const blockedValue      = String(isGroupMode ? groupCounts.blocked    : kpis?.blockedCustomers   ?? 0);
  const totalCountLabel   = isGroupMode ? "Total Groups"       : "Total Customers";
  const criticalLabel     = isGroupMode ? "Critical Groups"    : "Critical Customers";
  const blockedLabel      = isGroupMode ? "Blocked Groups" : "Blocked Customers";

  const kpiCards = kpis ? [
    { label: totalCountLabel,      value: totalCountValue,                icon: Users,         warn: false, link: buildRRUrl(riskLevels.length > 0 ? `/outstanding-dashboard/risk-register?risk=${riskLevels.join(",")}` : "/outstanding-dashboard/risk-register"), toggle: null },
    { label: "Total Sales",        value: fmt(kpis.totalSales),           icon: DollarSign,    warn: false, link: null,                                                                   toggle: null },
    { label: "Total Receipts",     value: fmt(kpis.totalReceipts),        icon: Receipt,       warn: false, link: null,                                                                   toggle: null },
    { label: "Total Outstanding",  value: fmt(kpis.totalOutstanding),     icon: TrendingDown,  warn: true,  link: null,                                                                   toggle: () => setShowBuildup((v) => !v) },
    { label: "Total Overdue",      value: fmt(kpis.totalOverdue),         icon: Clock,         warn: true,  link: null,                                                                   toggle: null },
    { label: "Credit Notes",       value: fmtINRMoney(kpis.totalCreditNotes),       icon: FileMinus,     warn: false, link: null,                                                                   toggle: null },
    { label: "Debit Notes",        value: fmtINRMoney(kpis.totalDebitNotes ?? 0),   icon: FilePlus,      warn: true,  link: null,                                                                   toggle: null },
    { label: "Journal Adj (Net)",  value: fmtINRDrCr(kpis.totalJournalAdjustments ?? 0), icon: BookOpen, warn: (kpis.totalJournalAdjustments ?? 0) > 0, link: null,                              toggle: null },
    { label: "Cheque Returns",     value: fmtINRMoney(kpis.totalCheckReturns),      icon: RotateCcw,     warn: true,  link: null,                                                                   toggle: null },
    { label: criticalLabel,        value: criticalValue,                  icon: ShieldAlert,   warn: true,  link: buildRRUrl("/outstanding-dashboard/risk-register?risk=critical"),                   toggle: null },
    { label: "Over Credit Limit",  value: overLimitValue,                 icon: AlertTriangle, warn: true,  link: buildRRUrl("/outstanding-dashboard/risk-register?filter=over_credit_limit"),         toggle: null },
    { label: "180+ Overdue",       value: overdue180Value,                icon: Users,         warn: true,  link: buildRRUrl("/outstanding-dashboard/risk-register?aging=180%2B"),                    toggle: null },
    { label: blockedLabel,         value: blockedValue,                   icon: ShieldAlert,   warn: true,  link: buildRRUrl("/outstanding-dashboard/risk-register?blocked=1"),                       toggle: null },
  ] : [];

  const lastSync = dashboard?.lastUpdated
    ? formatDateTimeDMY(dashboard.lastUpdated)
    : "—";

  return (
    <div className="p-6 md:p-8 max-w-content mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-[11px] text-muted-foreground/80 italic mt-1">
            Note: "Blocked" is set when the source-sheet credit limit equals 1. In practice this marker is used for the INK product category only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-button gap-1.5" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <Filter className="h-4 w-4 text-muted-foreground mb-2.5" />
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
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Risk Level</span>
          <RiskMultiSelect value={riskLevels} onChange={setRiskLevels} />
        </div>
        <div className="mb-1"><RiskLegendPopover /></div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer Segment</span>
          <Select value={customerSegment} onValueChange={(v) => setCustomerSegment(v as "all" | "active" | "no_activity")}>
            <SelectTrigger className="w-44 rounded-input h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="no_activity">No Activity</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mb-1"><ActivityLegendPopover /></div>
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
      <FilterChips chips={filterChips} onClearAll={clearAllFilters} />

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-2">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          const clickable = !!(kpi.link || kpi.toggle);
          const isActive  = kpi.toggle && showBuildup;
          return (
            <Card
              key={kpi.label}
              className={`rounded-card transition-colors ${clickable ? "cursor-pointer hover:bg-muted/40 hover:border-primary/30" : ""} ${isActive ? "border-primary/40 bg-primary/5" : ""}`}
              onClick={kpi.link ? () => navigate(kpi.link!) : kpi.toggle ?? undefined}
            >
              <CardContent className="px-3 py-2">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <div className="flex items-center gap-1">
                    <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-muted-foreground leading-tight">{kpi.label}</span>
                  </div>
                  {kpi.link   && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
                  {kpi.toggle && (showBuildup
                    ? <ChevronUp   className="h-3 w-3 text-primary/70 shrink-0" />
                    : <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />)}
                </div>
                <p className={`text-sm font-bold ${kpi.warn ? "text-destructive" : "text-foreground"}`}>
                  {kpi.value}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Outstanding Build-up — shown on demand */}
      {showBuildup && kpis && (() => {
        const openingPart     = kpis.totalRemainingOpeningBalance;
        const currentYearPart = kpis.totalOutstanding - openingPart;
        return (
          <Card className="rounded-card">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                Outstanding Build-up
              </p>
              <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">

                {/* Opening Balance Outstanding */}
                <div className="flex flex-col bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 min-w-[160px] flex-1">
                  <span className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-1">
                    Opening Balance (Outstanding)
                  </span>
                  <span className="text-base font-bold text-amber-800">{fmt(openingPart)}</span>
                  <span className="text-[10px] text-amber-600 mt-1">
                    of {fmt(kpis.totalOpeningBalance)} brought forward
                  </span>
                </div>

                <div className="flex items-center">
                  <span className="text-xl font-semibold text-muted-foreground">+</span>
                </div>

                {/* Current Year Outstanding */}
                <div className="flex flex-col bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 min-w-[200px] flex-1">
                  <span className="text-[10px] text-blue-700 font-semibold uppercase tracking-wide mb-1">
                    Current Year (Net Outstanding)
                  </span>
                  <span className="text-base font-bold text-blue-800">{fmt(currentYearPart)}</span>
                  <span className="text-[10px] text-blue-600 mt-1">
                    {fmt(kpis.totalSales)} invoiced · {fmt(kpis.totalSales - currentYearPart)} collected / adjusted
                  </span>
                </div>

                <div className="flex items-center">
                  <span className="text-xl font-semibold text-muted-foreground">=</span>
                </div>

                {/* Total Outstanding */}
                <div className="flex flex-col bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 min-w-[140px] flex-1">
                  <span className="text-[10px] text-destructive font-semibold uppercase tracking-wide mb-1">
                    Total Outstanding
                  </span>
                  <span className="text-base font-bold text-destructive">{fmt(kpis.totalOutstanding)}</span>
                  <span className="text-[10px] text-destructive/70 mt-1">as of {formatDateDMY(dashboard?.asOfDate)}</span>
                </div>

              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Outstanding by Risk Level — Month on Month */}
        <Card className="rounded-card border-border bg-surface lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Outstanding by Risk Level — Month on Month</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={riskTrend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220,10%,50%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,50%)" tickFormatter={fmtL} width={72} />
                <Tooltip formatter={(v: number) => fmtL(v)} />
                <Legend />
                <Area type="monotone" dataKey="low"      stackId="1" stroke="hsl(142,71%,45%)" fill="hsl(142,71%,45%)" fillOpacity={0.75} name="Low" />
                <Area type="monotone" dataKey="medium"   stackId="1" stroke="hsl(45,93%,47%)"  fill="hsl(45,93%,47%)"  fillOpacity={0.75} name="Medium" />
                <Area type="monotone" dataKey="high"     stackId="1" stroke="hsl(28,80%,52%)"  fill="hsl(28,80%,52%)"  fillOpacity={0.75} name="High" />
                <Area type="monotone" dataKey="critical" stackId="1" stroke="hsl(0,84%,60%)"   fill="hsl(0,84%,60%)"   fillOpacity={0.75} name="Critical" />
              </AreaChart>
            </ResponsiveContainer>

            {/* Latest-month outstanding by risk level + total */}
            {(() => {
              const latest = riskTrend[riskTrend.length - 1];
              if (!latest) return null;
              const tiers = [
                { label: "Low",      risk: "low",      value: latest.low,      bg: "bg-emerald-50",  border: "border-emerald-200",  text: "text-emerald-700",  bold: "text-emerald-800" },
                { label: "Medium",   risk: "medium",   value: latest.medium,   bg: "bg-amber-50",    border: "border-amber-200",    text: "text-amber-700",    bold: "text-amber-800"   },
                { label: "High",     risk: "high",     value: latest.high,     bg: "bg-orange-50",   border: "border-orange-200",   text: "text-orange-700",   bold: "text-orange-800"  },
                { label: "Critical", risk: "critical", value: latest.critical, bg: "bg-destructive/10", border: "border-destructive/20", text: "text-destructive", bold: "text-destructive" },
              ];
              const total = tiers.reduce((s, t) => s + t.value, 0);
              return (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex flex-wrap items-stretch gap-1.5">
                    {tiers.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => navigate(buildRRUrl(`/outstanding-dashboard/risk-register?risk=${t.risk}`))}
                        title={`View ${t.label}-risk customers in the Risk Register`}
                        className={`flex flex-col items-center ${t.bg} border ${t.border} rounded px-2.5 py-1.5 min-w-[80px] flex-1 cursor-pointer transition hover:shadow-md hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-ring`}
                      >
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${t.text}`}>{t.label}</span>
                        <span className={`text-xs font-bold mt-0.5 ${t.bold}`}>{fmtL(t.value)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => navigate(buildRRUrl("/outstanding-dashboard/risk-register"))}
                      title="View all customers in the Risk Register"
                      className="flex flex-col items-center bg-muted/50 border border-border rounded px-2.5 py-1.5 min-w-[96px] flex-1 cursor-pointer transition hover:shadow-md hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Total Outstanding</span>
                      <span className="text-xs font-bold text-foreground mt-0.5">{fmtL(total)}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">{latest.month} (latest month)</p>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Customer Count by Risk Level — Month on Month */}
        <Card className="rounded-card border-border bg-surface lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer Count by Risk Level — Month on Month</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={riskCountTrend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220,10%,50%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,50%)" width={48} />
                <Tooltip formatter={(v: number) => `${v} customers`} />
                <Legend />
                <Area type="monotone" dataKey="low"      stackId="1" stroke="hsl(142,71%,45%)" fill="hsl(142,71%,45%)" fillOpacity={0.75} name="Low" />
                <Area type="monotone" dataKey="medium"   stackId="1" stroke="hsl(45,93%,47%)"  fill="hsl(45,93%,47%)"  fillOpacity={0.75} name="Medium" />
                <Area type="monotone" dataKey="high"     stackId="1" stroke="hsl(28,80%,52%)"  fill="hsl(28,80%,52%)"  fillOpacity={0.75} name="High" />
                <Area type="monotone" dataKey="critical" stackId="1" stroke="hsl(0,84%,60%)"   fill="hsl(0,84%,60%)"   fillOpacity={0.75} name="Critical" />
              </AreaChart>
            </ResponsiveContainer>

            {/* Latest-month customer count by risk level + total */}
            {(() => {
              const latest = riskCountTrend[riskCountTrend.length - 1];
              if (!latest) return null;
              const tiers = [
                { label: "Low",      risk: "low",      value: latest.low,      bg: "bg-emerald-50",     border: "border-emerald-200",  text: "text-emerald-700",  bold: "text-emerald-800" },
                { label: "Medium",   risk: "medium",   value: latest.medium,   bg: "bg-amber-50",       border: "border-amber-200",    text: "text-amber-700",    bold: "text-amber-800"   },
                { label: "High",     risk: "high",     value: latest.high,     bg: "bg-orange-50",      border: "border-orange-200",   text: "text-orange-700",   bold: "text-orange-800"  },
                { label: "Critical", risk: "critical", value: latest.critical, bg: "bg-destructive/10", border: "border-destructive/20", text: "text-destructive", bold: "text-destructive" },
              ];
              const total = tiers.reduce((s, t) => s + t.value, 0);
              return (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex flex-wrap items-stretch gap-1.5">
                    {tiers.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => navigate(buildRRUrl(`/outstanding-dashboard/risk-register?risk=${t.risk}`))}
                        title={`View ${t.label}-risk customers in the Risk Register`}
                        className={`flex flex-col items-center ${t.bg} border ${t.border} rounded px-2.5 py-1.5 min-w-[80px] flex-1 cursor-pointer transition hover:shadow-md hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-ring`}
                      >
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${t.text}`}>{t.label}</span>
                        <span className={`text-xs font-bold mt-0.5 ${t.bold}`}>{t.value}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => navigate(buildRRUrl("/outstanding-dashboard/risk-register"))}
                      title="View all customers in the Risk Register"
                      className="flex flex-col items-center bg-muted/50 border border-border rounded px-2.5 py-1.5 min-w-[96px] flex-1 cursor-pointer transition hover:shadow-md hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Total Customers</span>
                      <span className="text-xs font-bold text-foreground mt-0.5">{total}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">{latest.month} (latest month)</p>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Trend Chart */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sales vs Receipts vs Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(220,10%,50%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,50%)" tickFormatter={fmtL} width={72} />
                <Tooltip formatter={(v: number) => fmtL(v)} />
                <Legend />
                <Line type="monotone" dataKey="sales"       stroke="hsl(28,80%,52%)"   strokeWidth={2} name="Sales" />
                <Line type="monotone" dataKey="receipts"    stroke="hsl(220,45%,20%)"  strokeWidth={2} name="Receipts" />
                <Line type="monotone" dataKey="outstanding" stroke="hsl(0,84%,60%)"    strokeWidth={2} strokeDasharray="5 5" name="Outstanding" />
                <Line type="monotone" dataKey="overdue"     stroke="hsl(0,72%,40%)"    strokeWidth={2} strokeDasharray="2 3" dot={false} name="Overdue" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Aging Buckets */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Aging Bucket Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={aging}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="bucket" tick={{ fontSize: 12 }} stroke="hsl(220,10%,50%)"
                  label={{ value: "Days", position: "insideBottom", offset: -2, fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,50%)"
                  tickFormatter={fmtL} width={72} />
                <Tooltip formatter={(v: number) => fmtL(v)} />
                <Bar
                  dataKey="amount"
                  fill="hsl(28,80%,52%)"
                  radius={[4, 4, 0, 0]}
                  name="Amount"
                  cursor="pointer"
                  onClick={(_: unknown, index: number) =>
                    navigate(buildRRUrl(`/outstanding-dashboard/risk-register?aging=${encodeURIComponent(aging[index]?.bucket ?? "")}`))
                  }
                />
              </BarChart>
            </ResponsiveContainer>

            {/* Bucket-wise totals + grand total */}
            {(() => {
              const grandTotal = aging.reduce((s, b) => s + b.amount, 0);
              return (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex flex-wrap items-stretch gap-1.5">
                    {aging.map((b) => (
                      <div key={b.bucket} className="flex flex-col items-center bg-muted/40 rounded px-2.5 py-1.5 min-w-[72px] flex-1">
                        <span className="text-[10px] text-muted-foreground font-medium">{b.bucket} days</span>
                        <span className="text-xs font-semibold text-foreground mt-0.5">{fmtL(b.amount)}</span>
                      </div>
                    ))}
                    <div className="flex flex-col items-center bg-destructive/10 border border-destructive/20 rounded px-2.5 py-1.5 min-w-[88px] flex-1">
                      <span className="text-[10px] text-destructive font-semibold uppercase tracking-wide">Total Overdue</span>
                      <span className="text-xs font-bold text-destructive mt-0.5">{fmtL(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>


      {/* Risk + Top Risky */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk Pie */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Risk Segmentation</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={displayRiskSegmentation}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, value }) => `${name} ${value}%`}
                  cursor="pointer"
                  onClick={(_: unknown, index: number) =>
                    navigate(buildRRUrl(`/outstanding-dashboard/risk-register?risk=${displayRiskSegmentation[index]?.name.toLowerCase() ?? ""}`))
                  }
                >
                  {displayRiskSegmentation.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Risky Customers / Groups */}
        <Card className="rounded-card lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">{isGroupMode ? "Top Risky Groups" : "Top Risky Customers"}</CardTitle>
            <Button
              variant="ghost" size="sm"
              className="rounded-button gap-1 text-xs text-primary"
              onClick={() => navigate(buildRRUrl("/outstanding-dashboard/risk-register?risk=critical,high"))}
            >
              View All <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {displayTopRisky.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No overdue {isGroupMode ? "groups" : "customers"}.</p>
              ) : (
                displayTopRisky.map((c) => {
                  const riskLabel = c.risk.charAt(0).toUpperCase() + c.risk.slice(1);
                  // In group mode, expandable groups (multi-child) navigate to /group/:name;
                  // single-child groups go to the underlying customer detail.
                  const target = isGroupMode && c.isGroup
                    ? `/outstanding-dashboard/group/${encodeURIComponent(c.name)}`
                    : `/outstanding-dashboard/customer/${encodeURIComponent(c.name)}`;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-input cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(target)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-button bg-secondary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-secondary">
                            {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.maxODDays} days overdue · {c.company}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-foreground">{fmt(c.overdue)}</span>
                        <Badge className={`${riskBadgeClass[riskLabel] ?? ""} hover:opacity-90 text-xs`}>
                          {riskLabel}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
