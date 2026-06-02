import { useState, useMemo, useEffect, useRef } from "react";
import {
  Globe, Filter, Package, TrendingUp, Users, DollarSign,
  BarChart3, RefreshCw, AlertTriangle, Search, X, ChevronDown, ChevronRight,
  ArrowUpDown, Loader2,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { Input } from "@hub/components/ui/input";
import { useEximData } from "@hub/lib/useEximData";
import { formatDateDMY } from "@hub/lib/utils";
import type { EximFilters } from "@hub/lib/eximTypes";

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

/* ── Category color palette ─────────────────────────────────────────────────*/

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

/* ── Component ──────────────────────────────────────────────────────────────*/

export default function EximDashboard() {
  // Filter state
  const [year,             setYear]             = useState<number | null>(null);
  const [buyerCountries,   setBuyerCountries]   = useState<string[]>([]);  // multi-select
  const [sellerCountries,  setSellerCountries]  = useState<string[]>([]);  // multi-select
  const [cat3s,         setCat3s]         = useState<string[]>([]);   // multi-select
  const [subcat3,       setSubcat3]       = useState("");
  const [buyers,        setBuyers]        = useState<string[]>([]);   // multi-select
  const [sellers,       setSellers]       = useState<string[]>([]);   // multi-select

  // UI state — subcategory expansion is now auto-driven by selection
  const [manualExpanded,   setManualExpanded]   = useState<Set<string>>(new Set());
  const [buyerSearch,      setBuyerSearch]      = useState("");
  const [sellerSearch,     setSellerSearch]     = useState("");
  const [buyerCountryOpen,   setBuyerCountryOpen]   = useState(false);
  const [buyerCountrySearch, setBuyerCountrySearch] = useState("");
  const buyerCountryDropdownRef = useRef<HTMLDivElement>(null);
  const [countryOpen,      setCountryOpen]      = useState(false);
  const [countrySearch,    setCountrySearch]    = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [catSearch,     setCatSearch]     = useState("");
  const [txnPage,       setTxnPage]       = useState(0);
  const [sortCol,       setSortCol]       = useState<"qty" | "value" | "price" | "date">("date");
  const [sortDesc,      setSortDesc]      = useState(true);

  // A category row is "expanded" (shows subcats) if it is selected OR manually toggled
  const isExpanded = (name: string) => cat3s.includes(name) || manualExpanded.has(name);

  // subcat3 only meaningful when exactly one cat3 is selected
  const effectiveSub = cat3s.length === 1 ? subcat3 : "";

  const filters: EximFilters = {
    year:             year ?? undefined,
    buyerCountries:   buyerCountries.length  ? buyerCountries  : undefined,
    sellerCountries:  sellerCountries.length ? sellerCountries : undefined,
    cat3:             cat3s.length   ? cat3s   : undefined,
    subcat3:       effectiveSub   || undefined,
    buyers:        buyers.length  ? buyers  : undefined,
    sellers:       sellers.length ? sellers : undefined,
  };

  // Toggle a category in/out of the selection array
  const toggleCat3 = (name: string) => {
    setCat3s((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
    setSubcat3("");  // clear subcat when changing category selection
  };

  const toggleBuyer = (name: string) =>
    setBuyers((prev) => prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name]);

  const toggleSeller = (name: string) =>
    setSellers((prev) => prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]);

  const toggleBuyerCountry = (c: string) =>
    setBuyerCountries((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  const toggleCountry = (c: string) =>
    setSellerCountries((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  // Close country dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (buyerCountryDropdownRef.current && !buyerCountryDropdownRef.current.contains(e.target as Node)) {
        setBuyerCountryOpen(false);
      }
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setCountryOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const {
    loading, error, summary, kpis,
    cat3Tree, filteredBuyers, filteredSellers,
    topBuyers, topSellers, yearTrend, categoryByYear,
    filteredTransactions, transactionsLoading, transactionsLoaded, loadTransactions,
  } = useEximData(filters);

  // Reset page when filters change
  useEffect(() => { setTxnPage(0); }, [year, buyerCountries, sellerCountries, cat3s, subcat3, buyers, sellers]);

  // Auto-load transactions when any filter is applied
  useEffect(() => {
    if (buyers.length || sellers.length || cat3s.length || year || buyerCountries.length || sellerCountries.length) loadTransactions();
  }, [buyers, sellers, cat3s, year, buyerCountries, sellerCountries, loadTransactions]);

  /* ── Active filter pills ─────────────────────────────────────────────────*/
  const activeFilters: { label: string; clear: () => void }[] = [
    ...(year ? [{ label: `Year: ${year}`, clear: () => setYear(null) }] : []),
    ...buyerCountries.map((c) => ({
      label: `To: ${c}`,
      clear: () => setBuyerCountries((prev) => prev.filter((x) => x !== c)),
    })),
    ...sellerCountries.map((c) => ({
      label: `From: ${c}`,
      clear: () => setSellerCountries((prev) => prev.filter((x) => x !== c)),
    })),
    // One pill per selected category
    ...cat3s.map((c) => ({
      label: `Cat: ${c}`,
      clear: () => { setCat3s((prev) => prev.filter((x) => x !== c)); setSubcat3(""); },
    })),
    ...(effectiveSub  ? [{ label: `Sub: ${effectiveSub}`,  clear: () => setSubcat3("") }] : []),
    // One pill per selected buyer
    ...buyers.map((b) => ({
      label: `Buyer: ${b.slice(0, 22)}…`,
      clear: () => setBuyers((prev) => prev.filter((x) => x !== b)),
    })),
    // One pill per selected seller
    ...sellers.map((s) => ({
      label: `Seller: ${s.slice(0, 20)}…`,
      clear: () => setSellers((prev) => prev.filter((x) => x !== s)),
    })),
  ];

  const clearAll = () => {
    setYear(null); setBuyerCountries([]); setSellerCountries([]); setCat3s([]); setSubcat3("");
    setBuyers([]); setSellers([]); setCatSearch("");
  };

  /* ── Derived data ────────────────────────────────────────────────────────*/

  // Top-8 cat3 names for the stacked bar legend
  const filteredBuyerCountryList = useMemo(() => {
    const q = buyerCountrySearch.toLowerCase();
    return q
      ? (summary?.buyerCountries ?? []).filter((c) => c.toLowerCase().includes(q))
      : (summary?.buyerCountries ?? []);
  }, [summary, buyerCountrySearch]);

  const filteredCountryList = useMemo(() => {
    const q = countrySearch.toLowerCase();
    return q
      ? (summary?.sellerCountries ?? []).filter((c) => c.toLowerCase().includes(q))
      : (summary?.sellerCountries ?? []);
  }, [summary, countrySearch]);

  const top8Cats = useMemo(
    () => (summary?.cat3Tree ?? []).slice(0, 8).map((c) => c.name),
    [summary],
  );

  // Buyer grid (searched + limited)
  const displayBuyers = useMemo(() => {
    const q = buyerSearch.toLowerCase();
    const list = q
      ? filteredBuyers.filter((b) => b.name.toLowerCase().includes(q))
      : filteredBuyers;
    return list.slice(0, 60);
  }, [filteredBuyers, buyerSearch]);

  // Seller list (searched + limited)
  const displaySellers = useMemo(() => {
    const q = sellerSearch.toLowerCase();
    const list = q
      ? filteredSellers.filter((s) => s.name.toLowerCase().includes(q))
      : filteredSellers;
    return list.slice(0, 80);
  }, [filteredSellers, sellerSearch]);

  // Category explorer (searched)
  const displayCat3Tree = useMemo(() => {
    if (!catSearch.trim()) return cat3Tree;
    const q = catSearch.toLowerCase();
    return cat3Tree.filter((n) => n.name.toLowerCase().includes(q));
  }, [cat3Tree, catSearch]);

  // Total subcat count across all (unfiltered) categories — for the badge
  const totalSubcats = useMemo(
    () => cat3Tree.reduce((sum, n) => sum + n.subcategories.filter((s) => s.name !== "(unclassified)").length, 0),
    [cat3Tree],
  );

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
    { label: "Total Quantity",    value: fmtQty(kpis.totalQuantityKgs), sub: "KGS",      icon: Package,    accent: true  },
    { label: "Total Value",       value: fmtUSD(kpis.totalValueUsd),    sub: "USD",      icon: DollarSign, accent: false },
    { label: "Avg Price / Unit",  value: fmtPrice(kpis.avgPricePerUnit), sub: "per unit", icon: TrendingUp, accent: true  },
    { label: "Buyers",            value: kpis.totalBuyers.toLocaleString(), sub: "unique", icon: Users,    accent: false },
    { label: "Sellers",           value: kpis.totalSellers.toLocaleString(), sub: "unique", icon: Globe,   accent: false },
    { label: "Transactions",      value: kpis.totalTransactions.toLocaleString(), sub: "shipments", icon: BarChart3, accent: false },
  ] : [];

  /* ── Loading / Error ─────────────────────────────────────────────────────*/
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading EXIM data…</p>
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
            {error ?? "Run: python scripts/generate_exim_json.py"}
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
            <Globe className="h-6 w-6 text-primary" />
            Export Import Data
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

        {/* Buyer Country — searchable multi-select */}
        <div className="relative" ref={buyerCountryDropdownRef}>
          <button
            type="button"
            className={`flex items-center gap-2 h-9 px-3 rounded-input border text-sm transition-colors ${
              buyerCountries.length > 0
                ? "border-primary bg-primary/5 text-primary"
                : "border-input bg-background text-foreground hover:bg-muted/50"
            }`}
            onClick={() => { setBuyerCountryOpen((o) => !o); setBuyerCountrySearch(""); }}
          >
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span>
              {buyerCountries.length === 0
                ? "Buyer Country"
                : buyerCountries.length === 1
                  ? buyerCountries[0]
                  : `${buyerCountries.length} Countries`}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${buyerCountryOpen ? "rotate-180" : ""}`} />
          </button>

          {buyerCountryOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-card border border-border bg-background shadow-lg">
              {/* Search */}
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-7 text-xs rounded-input"
                    placeholder="Search countries…"
                    value={buyerCountrySearch}
                    onChange={(e) => setBuyerCountrySearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {/* List */}
              <div className="max-h-[260px] overflow-y-auto p-1">
                {filteredBuyerCountryList.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No countries found</p>
                ) : filteredBuyerCountryList.map((c) => {
                  const isSelected = buyerCountries.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                      }`}
                      onClick={() => toggleBuyerCountry(c)}
                    >
                      <span className={`shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}>
                        {isSelected && <span className="text-primary-foreground text-[8px] font-bold leading-none">✓</span>}
                      </span>
                      {c}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              {buyerCountries.length > 0 && (
                <div className="border-t border-border p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{buyerCountries.length} selected</span>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => { setBuyerCountries([]); setBuyerCountryOpen(false); }}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Seller Country — searchable multi-select */}
        <div className="relative" ref={countryDropdownRef}>
          <button
            type="button"
            className={`flex items-center gap-2 h-9 px-3 rounded-input border text-sm transition-colors ${
              sellerCountries.length > 0
                ? "border-primary bg-primary/5 text-primary"
                : "border-input bg-background text-foreground hover:bg-muted/50"
            }`}
            onClick={() => { setCountryOpen((o) => !o); setCountrySearch(""); }}
          >
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <span>
              {sellerCountries.length === 0
                ? "Seller Country"
                : sellerCountries.length === 1
                  ? sellerCountries[0]
                  : `${sellerCountries.length} Countries`}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${countryOpen ? "rotate-180" : ""}`} />
          </button>

          {countryOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-card border border-border bg-background shadow-lg">
              {/* Search */}
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-7 text-xs rounded-input"
                    placeholder="Search countries…"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              {/* List */}
              <div className="max-h-[260px] overflow-y-auto p-1">
                {filteredCountryList.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No countries found</p>
                ) : filteredCountryList.map((c) => {
                  const isSelected = sellerCountries.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                      }`}
                      onClick={() => toggleCountry(c)}
                    >
                      <span className={`shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center ${
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}>
                        {isSelected && <span className="text-primary-foreground text-[8px] font-bold leading-none">✓</span>}
                      </span>
                      {c}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              {sellerCountries.length > 0 && (
                <div className="border-t border-border p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{sellerCountries.length} selected</span>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => { setSellerCountries([]); setCountryOpen(false); }}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Category selection info — actual selection is in the Category Explorer panel */}
        {cat3s.length > 0 && (
          <div className="flex items-center gap-1.5 h-9 px-3 rounded-input border border-border bg-primary/5 text-xs">
            <span className="text-muted-foreground">Categories:</span>
            <span className="font-semibold text-primary">{cat3s.length} selected</span>
            <button type="button" className="ml-1 text-muted-foreground hover:text-destructive" onClick={() => { setCat3s([]); setSubcat3(""); }}>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* SubCategory (only when exactly one cat3 selected) */}
        {cat3s.length === 1 && (() => {
          const node = summary.cat3Tree.find((c) => c.name === cat3s[0]);
          const subs = node?.subcategories.filter((s) => s.name !== "(unclassified)") ?? [];
          if (!subs.length) return null;
          return (
            <Select
              value={subcat3 || "all"}
              onValueChange={(v) => setSubcat3(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-44 rounded-input h-9 text-sm">
                <SelectValue placeholder="Sub-Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sub-Categories</SelectItem>
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

      {/* ── Explorer: Category | Buyers | Sellers ───────────────────────────*/}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-4">

        {/* Category Explorer */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">
                Category Explorer
                {cat3s.length > 0 && (
                  <span className="ml-2 text-primary font-normal">· {cat3s.length} selected</span>
                )}
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {cat3s.length > 0 && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => { setCat3s([]); setSubcat3(""); }}
                    title="Clear category selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <Badge variant="secondary" className="text-xs">{cat3Tree.length} cats · {totalSubcats} subs</Badge>
              </div>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs rounded-input"
                placeholder="Search categories…"
                value={catSearch}
                onChange={(e) => setCatSearch(e.target.value)}
              />
            </div>
            {/* Column labels */}
            <div className="flex items-center justify-between px-2 mt-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Category</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Qty (KGS)</span>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1 max-h-[480px] overflow-y-auto">
            {displayCat3Tree.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center">No categories found</p>
            )}
            {displayCat3Tree.map((node, idx) => {
              const isSel  = cat3s.includes(node.name);
              const isExp  = isExpanded(node.name);
              const subs   = node.subcategories.filter((s) => s.name !== "(unclassified)");
              const maxQty = cat3Tree[0]?.totalQty ?? 1;
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
                    onClick={() => toggleCat3(node.name)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {/* Checkbox indicator */}
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
                    {/* Bar */}
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, backgroundColor: catColor(idx) }}
                      />
                    </div>
                  </button>

                  {/* Subcategory chips — visible when category is selected or manually expanded */}
                  {isExp && subs.length > 0 && (
                    <div className="ml-6 mt-1 mb-1.5 space-y-0.5">
                      {subs.map((sub) => {
                        const isSubSel = effectiveSub === sub.name && cat3s.length === 1 && cat3s[0] === node.name;
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
                              // Selecting a subcat also selects the parent cat (exclusively)
                              setCat3s([node.name]);
                              setSubcat3(isSubSel ? "" : sub.name);
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
                          {b.country} · {fmtUSD(b.totalValue)}
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
                      <div className="text-muted-foreground text-[10px]">{s.country} · {fmtUSD(s.totalValue)}</div>
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
                  {filteredTransactions.length.toLocaleString()} rows
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!transactionsLoaded ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Click &ldquo;Load Transactions&rdquo; or select a buyer, seller, or category to load detail data.
            </div>
          ) : pageTxns.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No transactions match the current filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {[
                        { col: "date",          label: "Date", sortable: true },
                        { col: "year",          label: "Year" },
                        { col: "sellerCountry", label: "Seller Country" },
                        { col: "seller",        label: "Seller" },
                        { col: "buyer",         label: "Buyer" },
                        { col: "product",       label: "Product" },
                        { col: "cat3",          label: "Category" },
                        { col: "unit",          label: "Unit" },
                        { col: "qty",           label: "Quantity", sortable: true },
                        { col: "price",         label: "Unit Price", sortable: true },
                        { col: "value",         label: "Value (USD)", sortable: true },
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
                        <td className="px-3 py-1.5 whitespace-nowrap">{t.sellerCountry}</td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate" title={t.seller}>
                          <button
                            type="button"
                            className="text-left hover:text-primary hover:underline"
                            onClick={() => toggleSeller(t.seller)}
                          >
                            {t.seller}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 max-w-[160px] truncate" title={t.buyer}>
                          <button
                            type="button"
                            className="text-left hover:text-primary hover:underline"
                            onClick={() => toggleBuyer(t.buyer)}
                          >
                            {t.buyer}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 max-w-[200px] truncate" title={t.product}>{t.product}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {t.cat3}
                            {t.subcat3 && (
                              <span className="text-[10px] text-muted-foreground">/ {t.subcat3}</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">{t.unit}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-primary">{fmtQty(t.qty)}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-primary">{fmtPrice(t.price)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmtUSD(t.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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

      {/* ── Charts Row 1: Year Trend + Category Mix ──────────────────────────*/}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">

        {/* Year Trend */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Import Trend by Year</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={yearTrend} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="qty" tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtQty(v)}
                  label={{ value: "Qty (KGS)", angle: -90, position: "insideLeft", style: { fontSize: 10 }, offset: 10 }} />
                <YAxis yAxisId="val" orientation="right" tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtUSD(v)}
                  label={{ value: "Value (USD)", angle: 90, position: "insideRight", style: { fontSize: 10 }, offset: 10 }} />
                <Tooltip formatter={(v: number, name: string) =>
                  name === "Quantity" ? [fmtQty(v), "Quantity"] : [fmtUSD(v), "Value"]} />
                <Legend />
                <Line yAxisId="qty" type="monotone" dataKey="qty" name="Quantity"
                  stroke="hsl(220,65%,55%)" strokeWidth={2} dot={{ r: 4 }} />
                <Line yAxisId="val" type="monotone" dataKey="value" name="Value (USD)"
                  stroke="hsl(142,71%,45%)" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category Mix Donut */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Category Mix (by Value)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={cat3Tree.slice(0, 8).map((c, i) => ({
                    name: c.name,
                    value: Math.round(c.totalValue),
                  }))}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  onClick={(d) => toggleCat3(d.name)}
                  style={{ cursor: "pointer" }}
                >
                  {cat3Tree.slice(0, 8).map((c, idx) => (
                    <Cell key={idx} fill={catColor(idx)} opacity={cat3s.length > 0 && !cat3s.includes(c.name) ? 0.3 : 1} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtUSD(v)} />
                <Legend formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 2: Top Buyers + Top Sellers ───────────────────────────*/}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Top Buyers */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 10 Buyers by Value</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={topBuyers.map((b) => ({ name: b.name.slice(0, 22), value: b.totalValue }))}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtUSD(v)} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [fmtUSD(v), "Value"]} />
                <Bar dataKey="value" fill="hsl(220,65%,55%)" radius={[0, 3, 3, 0]}
                  onClick={(d) => { const n = topBuyers.find((b) => b.name.slice(0,22) === d.name)?.name; if (n) toggleBuyer(n); }}
                  style={{ cursor: "pointer" }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Sellers */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 10 Sellers by Value</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={topSellers.map((s) => ({ name: s.name.slice(0, 22), value: s.totalValue }))}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtUSD(v)} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [fmtUSD(v), "Value"]} />
                <Bar dataKey="value" fill="hsl(142,71%,45%)" radius={[0, 3, 3, 0]}
                  onClick={(d) => { const n = topSellers.find((s) => s.name.slice(0,22) === d.name)?.name; if (n) toggleSeller(n); }}
                  style={{ cursor: "pointer" }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 3: Category Stacked by Year + Seller Countries ────────*/}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Category Qty by Year */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quantity by Category &amp; Year</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={categoryByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtQty(v)} />
                <Tooltip formatter={(v: number, name: string) => [fmtQty(v), name]} />
                <Legend formatter={(v) => <span style={{ fontSize: 10 }}>{v}</span>} />
                {top8Cats.map((name, idx) => (
                  <Bar key={name} dataKey={name} stackId="a" fill={catColor(idx)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Seller Countries */}
        <Card className="rounded-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Source Countries</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={summary.sellerCountryDist.slice(0, 12).map((c) => ({
                  country: c.country.slice(0, 14),
                  value: c.totalValue,
                  qty: c.totalQty,
                }))}
                margin={{ top: 4, right: 8, bottom: 40, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,90%)" />
                <XAxis dataKey="country" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v)} />
                <Tooltip formatter={(v: number, name: string) =>
                  name === "value" ? [fmtUSD(v), "Value"] : [fmtQty(v), "Quantity"]} />
                <Bar dataKey="value" name="value" fill="hsl(28,80%,52%)" radius={[3, 3, 0, 0]}
                  onClick={(d) => { const n = summary.sellerCountryDist.find((c) => c.country.slice(0,14) === d.country)?.country; if (n) toggleCountry(n); }}
                  style={{ cursor: "pointer" }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
