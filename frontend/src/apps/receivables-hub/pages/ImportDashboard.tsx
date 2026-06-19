import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  PackageOpen, Filter, Package, TrendingUp, Users, DollarSign,
  BarChart3, RefreshCw, AlertTriangle, Search, X, ChevronDown, ChevronRight,
  ArrowUpDown, Loader2,
} from "lucide-react";
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { Input } from "@hub/components/ui/input";
import { useImportData } from "@hub/lib/useImportData";
import { formatDateDMY } from "@hub/lib/utils";
import type { ImportFilters, ImportProductMonthRow } from "@hub/lib/importTypes";
import { matchesSearch } from "@/shared/lib/search";

/* ── Formatters ─────────────────────────────────────────────────────────────*/

const fmtQty = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)    return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};


const fmtUSD = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)    return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};

const fmtPrice = (n: number) => `$${n.toFixed(2)}`;

/* ── Color palette ──────────────────────────────────────────────────────────*/

const CAT_COLORS = [
  "hsl(220,65%,55%)",
  "hsl(142,71%,45%)",
  "hsl(28,80%,52%)",
  "hsl(0,84%,60%)",
  "hsl(270,65%,60%)",
  "hsl(180,65%,45%)",
  "hsl(45,93%,47%)",
  "hsl(320,65%,55%)",
  "hsl(195,80%,45%)",
];

const catColor = (index: number) => CAT_COLORS[index % CAT_COLORS.length];

/* ── Pivot table helpers ────────────────────────────────────────────────────*/

function getPivotCell(row: ImportProductMonthRow, product: string): { qty: number; value: number } {
  const cell = row[product];
  if (typeof cell === "object" && cell !== null) return cell as { qty: number; value: number };
  return { qty: 0, value: 0 };
}

/* ── Component ──────────────────────────────────────────────────────────────*/

export default function ImportDashboard() {
  // Filter state
  const [year,        setYear]        = useState<number | null>(null);
  const [products,    setProducts]    = useState<string[]>([]);   // multi-select
  const [groups,      setGroups]      = useState<string[]>([]);   // multi-select (category)
  const [subGroup,    setSubGroup]    = useState("");
  const [buyers,      setBuyers]      = useState<string[]>([]);   // multi-select
  const [sellers,     setSellers]     = useState<string[]>([]);   // multi-select

  // UI state
  const [manualExpanded, setManualExpanded] = useState<Set<string>>(new Set());
  const [buyerSearch,    setBuyerSearch]    = useState("");
  const [sellerSearch,   setSellerSearch]   = useState("");
  const [groupSearch,    setGroupSearch]    = useState("");
  const [productOpen,    setProductOpen]    = useState(false);
  const [productSearch,  setProductSearch]  = useState("");
  const productDropdownRef = useRef<HTMLDivElement>(null);
  const [txnPage,    setTxnPage]    = useState(0);
  const [sortCol,    setSortCol]    = useState<"qty" | "value" | "price" | "date">("date");
  const [sortDesc,   setSortDesc]   = useState(true);
  const [pivotCollapsed,     setPivotCollapsed]     = useState(false);
  const [unitPivotCollapsed, setUnitPivotCollapsed] = useState(false);
  const [selectedMonth,      setSelectedMonth]      = useState<string | null>(null);
  const [selectedUnit,       setSelectedUnit]       = useState<string | null>(null);
  const [selectedProduct,    setSelectedProduct]    = useState<string | null>(null);

  const isExpanded = (name: string) => groups.includes(name) || manualExpanded.has(name);
  const effectiveSub = groups.length === 1 ? subGroup : "";

  const filters: ImportFilters = {
    year:         year ?? undefined,
    products:     products.length ? products : undefined,
    groups:       groups.length   ? groups   : undefined,
    subGroup:     effectiveSub    || undefined,
    buyers:       buyers.length   ? buyers   : undefined,
    sellers:      sellers.length  ? sellers  : undefined,
    pivotMonth:   selectedMonth   ?? undefined,
    pivotUnit:    selectedUnit    ?? undefined,
    pivotProduct: selectedProduct ?? undefined,
  };

  const toggleGroup = (name: string) => {
    setGroups((prev) => prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]);
    setSubGroup("");
  };

  const toggleProduct = (name: string) =>
    setProducts((prev) => prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]);

  const toggleBuyer = (name: string) =>
    setBuyers((prev) => prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]);

  const toggleSeller = (name: string) =>
    setSellers((prev) => prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]);

  // Close product dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setProductOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const {
    loading, error, summary, kpis,
    groupTree, filteredBuyers, filteredSellers,
    groupByYear, productMonthMatrix,
    filteredTransactions, transactionsLoading, transactionsLoaded, loadTransactions,
  } = useImportData(filters);

  // Reset page when filters change
  useEffect(() => { setTxnPage(0); }, [year, products, groups, subGroup, buyers, sellers, selectedMonth, selectedUnit, selectedProduct]);

  // Always load transactions (needed for unit×product pivot table)
  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  /* ── Active filter pills ────────────────────────────────────────────────*/
  const activeFilters: { label: string; clear: () => void }[] = [
    ...(year ? [{ label: `Year: ${year}`, clear: () => setYear(null) }] : []),
    ...products.map((p) => ({
      label: `Product: ${p}`,
      clear: () => setProducts((prev) => prev.filter((x) => x !== p)),
    })),
    ...groups.map((g) => ({
      label: `Group: ${g}`,
      clear: () => { setGroups((prev) => prev.filter((x) => x !== g)); setSubGroup(""); },
    })),
    ...(effectiveSub ? [{ label: `Sub: ${effectiveSub}`, clear: () => setSubGroup("") }] : []),
    ...buyers.map((b) => ({
      label: `Buyer: ${b.slice(0, 22)}…`,
      clear: () => setBuyers((prev) => prev.filter((x) => x !== b)),
    })),
    ...sellers.map((s) => ({
      label: `Seller: ${s.slice(0, 20)}…`,
      clear: () => setSellers((prev) => prev.filter((x) => x !== s)),
    })),
  ];

  const clearAll = () => {
    setYear(null); setProducts([]); setGroups([]); setSubGroup("");
    setBuyers([]); setSellers([]); setGroupSearch("");
  };

  /* ── Derived data ────────────────────────────────────────────────────────*/

  const top8Groups = useMemo(
    () => (summary?.groupTree ?? []).slice(0, 8).map((g) => g.name),
    [summary],
  );

  const filteredProductList = useMemo(() => {
    return productSearch.trim()
      ? (summary?.products ?? []).filter((p) => matchesSearch(productSearch, p))
      : (summary?.products ?? []);
  }, [summary, productSearch]);

  const displayBuyers = useMemo(() => {
    const list = buyerSearch.trim()
      ? filteredBuyers.filter((b) => matchesSearch(buyerSearch, b.name))
      : filteredBuyers;
    return list.slice(0, 60);
  }, [filteredBuyers, buyerSearch]);

  const displaySellers = useMemo(() => {
    const list = sellerSearch.trim()
      ? filteredSellers.filter((s) => matchesSearch(sellerSearch, s.name))
      : filteredSellers;
    return list.slice(0, 80);
  }, [filteredSellers, sellerSearch]);

  const displayGroupTree = useMemo(() => {
    if (!groupSearch.trim()) return groupTree;
    return groupTree.filter((n) => matchesSearch(groupSearch, n.name));
  }, [groupTree, groupSearch]);

  const totalSubGroups = useMemo(
    () => groupTree.reduce((sum, n) => sum + n.subcategories.filter((s) => s.name !== "(unclassified)").length, 0),
    [groupTree],
  );

  // Pivot table — product columns from summary (fixed list), rows from productMonthMatrix
  const pivotProducts = useMemo(() => summary?.products ?? [], [summary]);

  // Pivot totals per product
  const pivotTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const prod of pivotProducts) {
      totals[prod] = productMonthMatrix.reduce((sum, row) => sum + getPivotCell(row, prod).qty, 0);
    }
    return totals;
  }, [pivotProducts, productMonthMatrix]);

  // Grand total row
  const pivotGrandTotal = useMemo(
    () => Object.values(pivotTotals).reduce((s, v) => s + v, 0),
    [pivotTotals],
  );

  // ── Unit × Product matrix ─────────────────────────────────────────────────
  const unitProductMatrix = useMemo(() => {
    // filteredTransactions already has pivotMonth + pivotProduct applied by the hook.
    // We do NOT filter by pivotUnit here — the unit table shows all units (selectedUnit is a visual highlight).
    if (!filteredTransactions.length) return { units: [] as string[], data: {} as Record<string, Record<string, number>> };
    const txns = filteredTransactions;
    const data: Record<string, Record<string, number>> = {};
    for (const t of txns) {
      const u = t.unit || "—";
      if (!data[u]) data[u] = {};
      data[u][t.product] = (data[u][t.product] ?? 0) + t.qty;
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    for (const u of Object.keys(data))
      for (const p of Object.keys(data[u]))
        data[u][p] = r2(data[u][p]);
    const units = Object.keys(data).sort();
    return { units, data };
  }, [filteredTransactions]);

  // ── Dimming helpers ───────────────────────────────────────────────────────
  const isMonthDimmed   = (mk: string) => selectedMonth   !== null && selectedMonth   !== mk;
  const isUnitDimmed    = (u: string)  => selectedUnit    !== null && selectedUnit    !== u;
  const isProdDimmed    = (p: string)  => selectedProduct !== null && selectedProduct !== p;

  // Toggle helpers (click same item again → clear)
  const toggleSelMonth = (mk: string) => {
    setSelectedMonth((prev) => prev === mk ? null : mk);
    setSelectedUnit(null);
  };
  const toggleSelUnit = (u: string) => {
    setSelectedUnit((prev) => prev === u ? null : u);
    setSelectedMonth(null);
  };
  const toggleSelProduct = (p: string) => setSelectedProduct((prev) => prev === p ? null : p);
  const clearCrossFilters = () => { setSelectedMonth(null); setSelectedUnit(null); setSelectedProduct(null); };
  const hasCrossFilter = selectedMonth !== null || selectedUnit !== null || selectedProduct !== null;

  // Transactions table (sorted + paginated)
  const PAGE_SIZE = 50;
  const sortedTxns = useMemo(() => {
    const arr = [...filteredTransactions];
    if (sortCol === "date") {
      arr.sort((a, b) => {
        const da = a.date ?? "", db = b.date ?? "";
        return sortDesc ? db.localeCompare(da) : da.localeCompare(db);
      });
    } else {
      arr.sort((a, b) => sortDesc ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]);
    }
    return arr;
  }, [filteredTransactions, sortCol, sortDesc]);
  const pageCount = Math.ceil(sortedTxns.length / PAGE_SIZE);
  const pageTxns  = sortedTxns.slice(txnPage * PAGE_SIZE, (txnPage + 1) * PAGE_SIZE);

  /* ── KPI cards config ────────────────────────────────────────────────────*/
  const kpiCards = kpis ? [
    { label: "Total Quantity",    value: fmtQty(kpis.totalQuantityKgs),  sub: "units",  icon: Package,    accent: true  },
    { label: "Total Value",       value: fmtUSD(kpis.totalValueUsd),          sub: "USD",        icon: DollarSign, accent: false },
    { label: "Avg Price / Unit",  value: fmtPrice(kpis.avgPricePerUnit),      sub: "per unit",   icon: TrendingUp, accent: true  },
    { label: "Buyers",            value: kpis.totalBuyers.toLocaleString(),   sub: "unique",     icon: Users,      accent: false },
    { label: "Sellers",           value: kpis.totalSellers.toLocaleString(),  sub: "unique",     icon: PackageOpen,accent: false },
    { label: "Transactions",      value: kpis.totalTransactions.toLocaleString(), sub: "shipments", icon: BarChart3, accent: false },
  ] : [];

  /* ── Loading / Error ─────────────────────────────────────────────────────*/
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading Import data…</p>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm font-medium text-destructive">Data not loaded</p>
          <p className="text-xs text-muted-foreground">
            {error ?? "Run: python scripts/generate_import_json.py"}
          </p>
        </div>
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────────────────────────*/
  return (
    <div className="p-6 md:p-8 max-w-content mx-auto space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────*/}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <PackageOpen className="h-6 w-6 text-primary" />
            Import Data
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            India import trade · {summary.kpis.totalTransactions.toLocaleString()} shipments
            · Last updated: {formatDateDMY(summary.lastUpdated)}
          </p>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────*/}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Year */}
        <Select
          value={year ? String(year) : "all"}
          onValueChange={(v) => setYear(v === "all" ? null : Number(v))}
        >
          <SelectTrigger className="w-32 rounded-input h-9 text-sm">
            <SelectValue placeholder="All Years" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {summary.years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Product — searchable multi-select */}
        <div className="relative" ref={productDropdownRef}>
          <button
            type="button"
            className={`flex items-center gap-2 h-9 px-3 rounded-input border text-sm transition-colors ${
              products.length > 0
                ? "border-primary bg-primary/5 text-primary"
                : "border-input bg-background text-foreground hover:bg-muted/50"
            }`}
            onClick={() => { setProductOpen((o) => !o); setProductSearch(""); }}
          >
            <Package className="h-3.5 w-3.5 shrink-0" />
            <span>
              {products.length === 0
                ? "Product"
                : products.length === 1
                  ? products[0]
                  : `${products.length} Products`}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${productOpen ? "rotate-180" : ""}`} />
          </button>

          {productOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-card border border-border bg-background shadow-lg">
              {/* Search */}
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-7 text-xs rounded-input"
                    placeholder="Search products…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-[240px] overflow-y-auto p-1">
                {filteredProductList.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No products found</p>
                ) : filteredProductList.map((p) => {
                  const isSelected = products.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                      }`}
                      onClick={() => toggleProduct(p)}
                    >
                      <span className={`shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}>
                        {isSelected && <span className="text-primary-foreground text-[8px] font-bold leading-none">✓</span>}
                      </span>
                      {p}
                    </button>
                  );
                })}
              </div>
              {products.length > 0 && (
                <div className="border-t border-border p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{products.length} selected</span>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => { setProducts([]); setProductOpen(false); }}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Group selection info */}
        {groups.length > 0 && (
          <div className="flex items-center gap-1.5 h-9 px-3 rounded-input border border-border bg-primary/5 text-xs">
            <span className="text-muted-foreground">Groups:</span>
            <span className="font-semibold text-primary">{groups.length} selected</span>
            <button type="button" className="ml-1 text-muted-foreground hover:text-destructive" onClick={() => { setGroups([]); setSubGroup(""); }}>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* SubGroup (only when exactly one group selected) */}
        {groups.length === 1 && (() => {
          const node = summary.groupTree.find((g) => g.name === groups[0]);
          const subs = node?.subcategories.filter((s) => s.name !== "(unclassified)") ?? [];
          if (!subs.length) return null;
          return (
            <Select
              value={subGroup || "all"}
              onValueChange={(v) => setSubGroup(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-44 rounded-input h-9 text-sm">
                <SelectValue placeholder="Sub-Group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sub-Groups</SelectItem>
                {subs.map((s) => (
                  <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}
      </div>

      {/* Active filter pills */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((f, i) => (
            <Badge
              key={i}
              variant="secondary"
              className="gap-1 pr-1 text-xs cursor-pointer hover:bg-destructive/10"
              onClick={f.clear}
            >
              {f.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={clearAll}>
            Clear all
          </Button>
        </div>
      )}

      {/* ── KPI Cards ───────────────────────────────────────────────────────*/}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((k) => (
          <Card key={k.label} className={`rounded-card ${k.accent ? "border-primary/30 bg-primary/5" : ""}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
                  <p className={`font-bold ${k.accent ? "text-2xl text-primary" : "text-xl text-foreground"}`}>
                    {k.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
                </div>
                <k.icon className={`h-5 w-5 shrink-0 ${k.accent ? "text-primary" : "text-muted-foreground"}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Explorer: Group | Buyers | Sellers ──────────────────────────────*/}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-4">

        {/* Group Explorer */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">
                Group Explorer
                {groups.length > 0 && (
                  <span className="ml-2 text-primary font-normal">· {groups.length} selected</span>
                )}
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {groups.length > 0 && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => { setGroups([]); setSubGroup(""); }}
                    title="Clear group selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <Badge variant="secondary" className="text-xs">{groupTree.length} groups · {totalSubGroups} subs</Badge>
              </div>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs rounded-input"
                placeholder="Search groups…"
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between px-2 mt-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Group</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Qty</span>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1 max-h-[480px] overflow-y-auto">
            {displayGroupTree.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center">No groups found</p>
            )}
            {displayGroupTree.map((node, idx) => {
              const isSel = groups.includes(node.name);
              const isExp = isExpanded(node.name);
              const subs  = node.subcategories.filter((s) => s.name !== "(unclassified)");
              const maxQty = groupTree[0]?.totalQty ?? 1;
              const barPct = Math.round((node.totalQty / maxQty) * 100);

              return (
                <div key={node.name}>
                  <button
                    type="button"
                    className={`w-full text-left rounded-button px-2 py-1.5 transition-colors ${
                      isSel
                        ? "bg-primary/12 text-primary ring-1 ring-primary/30"
                        : "hover:bg-muted/50 text-foreground"
                    }`}
                    onClick={() => toggleGroup(node.name)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                          isSel ? "bg-primary border-primary" : "border-border"
                        }`}>
                          {isSel && (
                            <svg className="h-2.5 w-2.5 text-primary-foreground" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </span>
                        <span className="text-xs font-medium truncate">{node.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">{fmtQty(node.totalQty)}</span>
                        {subs.length > 0 && (
                          <span
                            className="p-0.5 rounded hover:bg-muted"
                            onClick={(e) => {
                              e.stopPropagation();
                              setManualExpanded((prev) => {
                                const next = new Set(prev);
                                next.has(node.name) ? next.delete(node.name) : next.add(node.name);
                                return next;
                              });
                            }}
                          >
                            {isExp
                              ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, backgroundColor: catColor(idx) }}
                      />
                    </div>
                  </button>

                  {isExp && subs.length > 0 && (
                    <div className="ml-6 mt-1 mb-1.5 space-y-0.5">
                      {subs.map((sub) => {
                        const isSubSel = effectiveSub === sub.name && groups.length === 1 && groups[0] === node.name;
                        return (
                          <button
                            type="button"
                            key={sub.name}
                            className={`w-full text-left flex items-center justify-between px-2 py-0.5 rounded text-[11px] transition-colors ${
                              isSubSel
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setGroups([node.name]);
                              setSubGroup(isSubSel ? "" : sub.name);
                            }}
                          >
                            <span className="truncate">↳ {sub.name}</span>
                            <span className="shrink-0 ml-2 tabular-nums opacity-70">{fmtQty(sub.totalQty)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Buyers Grid */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">
                Buyers
                {buyers.length > 0 && (
                  <span className="ml-2 text-primary font-normal">· {buyers.length} selected</span>
                )}
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {buyers.length > 0 && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setBuyers([])}
                    title="Clear buyer selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <Badge variant="secondary" className="text-xs">{filteredBuyers.length.toLocaleString()}</Badge>
              </div>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs rounded-input"
                placeholder="Search buyers…"
                value={buyerSearch}
                onChange={(e) => setBuyerSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 max-h-[420px] overflow-y-auto">
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
              {displayBuyers.map((b) => {
                const isSelected = buyers.includes(b.name);
                return (
                  <button
                    type="button"
                    key={b.name}
                    className={`text-left p-2 rounded-button border text-xs transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40 hover:bg-muted/50"
                    }`}
                    onClick={() => toggleBuyer(b.name)}
                  >
                    <div className="flex items-start gap-1.5">
                      <span className={`mt-0.5 shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}>
                        {isSelected && <span className="text-primary-foreground text-[8px] font-bold leading-none">✓</span>}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium truncate leading-tight" title={b.name}>
                          {b.name}
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-[10px]">
                          {fmtUSD(b.totalValue)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {displayBuyers.length === 0 && (
                <p className="col-span-3 text-xs text-muted-foreground py-4 text-center">No buyers found</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sellers List */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">
                Sellers
                {sellers.length > 0 && (
                  <span className="ml-2 text-primary font-normal">· {sellers.length} selected</span>
                )}
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {sellers.length > 0 && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setSellers([])}
                    title="Clear seller selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <Badge variant="secondary" className="text-xs">{filteredSellers.length.toLocaleString()}</Badge>
              </div>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs rounded-input"
                placeholder="Search sellers…"
                value={sellerSearch}
                onChange={(e) => setSellerSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 max-h-[420px] overflow-y-auto space-y-0.5">
            {displaySellers.map((s) => {
              const isSelected = sellers.includes(s.name);
              return (
                <button
                  type="button"
                  key={s.name}
                  className={`w-full text-left px-2 py-1.5 rounded-button border text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent hover:border-border hover:bg-muted/50"
                  }`}
                  onClick={() => toggleSeller(s.name)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center ${
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}>
                      {isSelected && <span className="text-primary-foreground text-[8px] font-bold leading-none">✓</span>}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium truncate" title={s.name}>{s.name}</div>
                      <div className="text-muted-foreground text-[10px]">{fmtUSD(s.totalValue)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            {displaySellers.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No sellers found</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Month × Product Pivot Table ──────────────────────────────────────*/}
      <Card className="rounded-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              Month-wise · Product-wise Quantity
              {selectedUnit && (
                <span className="ml-2 text-xs font-normal text-primary">
                  · filtered to unit: {selectedUnit}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasCrossFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-button text-xs h-7 gap-1 text-destructive hover:text-destructive"
                  onClick={clearCrossFilters}
                >
                  <X className="h-3 w-3" /> Clear selection
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="rounded-button text-xs h-7 gap-1"
                onClick={() => setPivotCollapsed((c) => !c)}
              >
                {pivotCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {pivotCollapsed ? "Expand" : "Collapse"}
              </Button>
            </div>
          </div>
        </CardHeader>
        {!pivotCollapsed && (
          <CardContent className="p-0">
            {productMonthMatrix.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No data available.
              </div>
            ) : (
              <ScrollableTable>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/30 z-10">
                        Month
                      </th>
                      {pivotProducts.filter((prod) => (pivotTotals[prod] ?? 0) > 0).map((prod) => (
                        <th
                          key={prod}
                          onClick={() => toggleSelProduct(prod)}
                          className={`px-3 py-2 text-right font-semibold whitespace-nowrap cursor-pointer select-none transition-opacity
                            ${isProdDimmed(prod) ? "opacity-30" : ""}
                            ${selectedProduct === prod ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                        >
                          {prod}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-semibold text-foreground whitespace-nowrap bg-muted/50">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {productMonthMatrix.map((row) => {
                      const activeProducts = pivotProducts.filter((prod) => (pivotTotals[prod] ?? 0) > 0);
                      const rowTotal = activeProducts.reduce((sum, prod) => sum + getPivotCell(row, prod).qty, 0);
                      const isSelMonth = selectedMonth === row.monthKey;
                      return (
                        <tr
                          key={row.monthKey}
                          className={`border-b border-border/50 transition-opacity
                            ${isMonthDimmed(row.monthKey) ? "opacity-30" : ""}
                            ${isSelMonth ? "bg-primary/8" : "hover:bg-muted/20"}`}
                        >
                          <td
                            onClick={() => toggleSelMonth(row.monthKey)}
                            className={`px-3 py-1.5 font-medium whitespace-nowrap sticky left-0 z-10 cursor-pointer select-none
                              ${isSelMonth ? "text-primary bg-primary/10" : "bg-background hover:bg-muted/40"}`}
                          >
                            {row.month}
                          </td>
                          {activeProducts.map((prod) => {
                            const cell = getPivotCell(row, prod);
                            return (
                              <td
                                key={prod}
                                onClick={() => {
                                  const alreadySel = selectedMonth === row.monthKey && selectedProduct === prod;
                                  if (alreadySel) { clearCrossFilters(); }
                                  else { setSelectedMonth(row.monthKey); setSelectedUnit(null); setSelectedProduct(prod); }
                                }}
                                className={`px-3 py-1.5 text-right tabular-nums cursor-pointer select-none transition-opacity
                                  ${isProdDimmed(prod) ? "opacity-30" : ""}
                                  ${isSelMonth && selectedProduct === prod ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/20"}`}
                              >
                                {cell.qty > 0 ? fmtQty(cell.qty) : "—"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-1.5 text-right font-semibold text-primary tabular-nums bg-muted/20">
                            {rowTotal > 0 ? fmtQty(rowTotal) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Grand total row */}
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="px-3 py-2 sticky left-0 bg-muted/30 z-10">Total</td>
                      {pivotProducts.filter((prod) => (pivotTotals[prod] ?? 0) > 0).map((prod) => (
                        <td
                          key={prod}
                          className={`px-3 py-2 text-right tabular-nums text-foreground transition-opacity
                            ${isProdDimmed(prod) ? "opacity-30" : ""}`}
                        >
                          {fmtQty(pivotTotals[prod] ?? 0)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums text-primary bg-muted/50">
                        {fmtQty(pivotGrandTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Unit × Product Pivot Table ───────────────────────────────────────*/}
      <Card className="rounded-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              Unit-wise · Product-wise Quantity
              {selectedMonth && (
                <span className="ml-2 text-xs font-normal text-primary">
                  · filtered to month: {productMonthMatrix.find(r => r.monthKey === selectedMonth)?.month ?? selectedMonth}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasCrossFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-button text-xs h-7 gap-1 text-destructive hover:text-destructive"
                  onClick={clearCrossFilters}
                >
                  <X className="h-3 w-3" /> Clear selection
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="rounded-button text-xs h-7 gap-1"
                onClick={() => setUnitPivotCollapsed((c) => !c)}
              >
                {unitPivotCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {unitPivotCollapsed ? "Expand" : "Collapse"}
              </Button>
            </div>
          </div>
        </CardHeader>
        {!unitPivotCollapsed && (
          <CardContent className="p-0">
            {transactionsLoading ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions…
              </div>
            ) : unitProductMatrix.units.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No data available.
              </div>
            ) : (() => {
              const activeProds = pivotProducts.filter((p) =>
                unitProductMatrix.units.some((u) => (unitProductMatrix.data[u]?.[p] ?? 0) > 0)
              );
              const unitTotals: Record<string, number> = {};
              for (const u of unitProductMatrix.units) {
                unitTotals[u] = activeProds.reduce((s, p) => s + (unitProductMatrix.data[u]?.[p] ?? 0), 0);
              }
              const prodTotals: Record<string, number> = {};
              for (const p of activeProds) {
                prodTotals[p] = unitProductMatrix.units.reduce((s, u) => s + (unitProductMatrix.data[u]?.[p] ?? 0), 0);
              }
              const grandTotal = Object.values(unitTotals).reduce((s, v) => s + v, 0);
              return (
                <ScrollableTable>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/30 z-10">
                          Unit
                        </th>
                        {activeProds.map((prod) => (
                          <th
                            key={prod}
                            onClick={() => toggleSelProduct(prod)}
                            className={`px-3 py-2 text-right font-semibold whitespace-nowrap cursor-pointer select-none transition-opacity
                              ${isProdDimmed(prod) ? "opacity-30" : ""}
                              ${selectedProduct === prod ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                          >
                            {prod}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-right font-semibold text-foreground whitespace-nowrap bg-muted/50">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unitProductMatrix.units.map((u) => {
                        if (unitTotals[u] === 0) return null;
                        const isSelUnit = selectedUnit === u;
                        return (
                          <tr
                            key={u}
                            className={`border-b border-border/50 transition-opacity
                              ${isUnitDimmed(u) ? "opacity-30" : ""}
                              ${isSelUnit ? "bg-primary/8" : "hover:bg-muted/20"}`}
                          >
                            <td
                              onClick={() => toggleSelUnit(u)}
                              className={`px-3 py-1.5 font-medium whitespace-nowrap sticky left-0 z-10 cursor-pointer select-none
                                ${isSelUnit ? "text-primary bg-primary/10" : "bg-background hover:bg-muted/40"}`}
                            >
                              {u}
                            </td>
                            {activeProds.map((prod) => {
                              const qty = unitProductMatrix.data[u]?.[prod] ?? 0;
                              return (
                                <td
                                  key={prod}
                                  onClick={() => {
                                    const alreadySel = selectedUnit === u && selectedProduct === prod;
                                    if (alreadySel) { clearCrossFilters(); }
                                    else { setSelectedUnit(u); setSelectedMonth(null); setSelectedProduct(prod); }
                                  }}
                                  className={`px-3 py-1.5 text-right tabular-nums cursor-pointer select-none transition-opacity
                                    ${isProdDimmed(prod) ? "opacity-30" : ""}
                                    ${isSelUnit && selectedProduct === prod ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-muted/20"}`}
                                >
                                  {qty > 0 ? fmtQty(qty) : "—"}
                                </td>
                              );
                            })}
                            <td className="px-3 py-1.5 text-right font-semibold text-primary tabular-nums bg-muted/20">
                              {unitTotals[u] > 0 ? fmtQty(unitTotals[u]) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Grand total row */}
                      <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                        <td className="px-3 py-2 sticky left-0 bg-muted/30 z-10">Total</td>
                        {activeProds.map((prod) => (
                          <td
                            key={prod}
                            className={`px-3 py-2 text-right tabular-nums text-foreground transition-opacity
                              ${isProdDimmed(prod) ? "opacity-30" : ""}`}
                          >
                            {fmtQty(prodTotals[prod] ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums text-primary bg-muted/50">
                          {fmtQty(grandTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </ScrollableTable>
              );
            })()}
          </CardContent>
        )}
      </Card>

      {/* ── Detail Table ─────────────────────────────────────────────────────*/}
      <Card className="rounded-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">Transaction Details</CardTitle>
            <div className="flex items-center gap-2">
              {!transactionsLoaded && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-button gap-1.5 text-xs"
                  onClick={loadTransactions}
                  disabled={transactionsLoading}
                >
                  {transactionsLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Package className="h-3.5 w-3.5" />
                  )}
                  {transactionsLoading ? "Loading…" : "Load Transactions"}
                </Button>
              )}
              {transactionsLoaded && (
                <span className="text-xs text-muted-foreground">
                  {sortedTxns.length.toLocaleString()}
                  {sortedTxns.length !== filteredTransactions.length && (
                    <span> of {filteredTransactions.length.toLocaleString()}</span>
                  )} rows
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!transactionsLoaded ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Click &ldquo;Load Transactions&rdquo; or select a buyer, seller, or group to load detail data.
            </div>
          ) : pageTxns.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No transactions match the current filters.
            </div>
          ) : (
            <>
              <ScrollableTable>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {[
                        { col: "date",     label: "Date",       sortable: true },
                        { col: "year",     label: "Year" },
                        { col: "month",    label: "Month" },
                        { col: "buyer",    label: "Buyer" },
                        { col: "seller",   label: "Seller" },
                        { col: "product",  label: "Product" },
                        { col: "group",    label: "Group" },
                        { col: "subGroup", label: "Sub Group" },
                        { col: "colors",   label: "Colors" },
                        { col: "unit",     label: "Unit" },
                        { col: "qty",      label: "Quantity",   sortable: true },
                        { col: "price",    label: "Unit Price", sortable: true },
                        { col: "value",    label: "Value (USD)", sortable: true },
                      ].map(({ col, label, sortable }) => (
                        <th
                          key={col}
                          className={`px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap ${
                            sortable ? "cursor-pointer select-none hover:text-foreground" : ""
                          }`}
                          onClick={sortable ? () => {
                            if (sortCol === col) setSortDesc(!sortDesc);
                            else { setSortCol(col as "qty" | "value" | "price" | "date"); setSortDesc(true); }
                          } : undefined}
                        >
                          <span className="flex items-center gap-1">
                            {label}
                            {sortable && <ArrowUpDown className="h-3 w-3" />}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageTxns.map((t, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                          {t.date ? t.date.split("-").reverse().join("/") : "—"}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{t.year ?? "—"}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{t.month ?? "—"}</td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate" title={t.buyer}>
                          <button
                            type="button"
                            className="text-left hover:text-primary hover:underline"
                            onClick={() => toggleBuyer(t.buyer)}
                          >
                            {t.buyer}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate" title={t.seller}>
                          <button
                            type="button"
                            className="text-left hover:text-primary hover:underline"
                            onClick={() => toggleSeller(t.seller)}
                          >
                            {t.seller}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-medium">{t.product}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {t.group}
                            {t.subGroup && (
                              <span className="text-[10px] text-muted-foreground">/ {t.subGroup}</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{t.subGroup || "—"}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{t.colors || "—"}</td>
                        <td className="px-3 py-1.5">{t.unit}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-primary">{fmtQty(t.qty)}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-primary">{fmtPrice(t.price)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmtUSD(t.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>

              {/* Pagination */}
              {pageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    Page {txnPage + 1} of {pageCount} · {sortedTxns.length.toLocaleString()} transactions
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline" size="sm" className="rounded-button text-xs h-7"
                      disabled={txnPage === 0}
                      onClick={() => setTxnPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline" size="sm" className="rounded-button text-xs h-7"
                      disabled={txnPage >= pageCount - 1}
                      onClick={() => setTxnPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
