/**
 * Bushra-Dashboard → Purchase → every Purchase dashboard (Purchase, Machines, Spare Parts, Service, Other).
 *
 * The purchase-side twin of pages/BushraSalesDashboard.tsx (branch Bushra-Sales-Dashboard), laid out
 * the same way as its product dashboards:
 *
 *   tabs         the Purchase dashboards the viewer holds
 *   filter bar   Financial Year · Month · Location · Company · Type · Purchase-Type · Category ·
 *                Ink Type · Group · Colour · Vendor + Reset All
 *   KPI row      Net Purchase · Gross Purchase · Returns & Debit Notes · Quantity · Vouchers · Vendors
 *   Mix pairs    Quantity Mix | Value Mix for each section of the preset (lib/bushraPurchaseDashboards.ts)
 *   By Month     Value | Quantity
 *   report       every line left by the filters, filterable per column, exportable
 *
 * Every figure is summed from the Bushra Purchase Register's rows, so the dashboards and the register
 * can never disagree. VALUE IS NET — a return or debit note is a negative line, netted off.
 * Bar/row clicks filter every panel and a blank click lets them go, exactly as on the Sales dashboards.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Boxes, Download, FileText, IndianRupee, RotateCcw, Search, Table2, Truck,
  TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { fmtSales, salesFyOptions } from "@hub/lib/salesReport";
import { currentFy, ymd } from "@hub/lib/salesRegister";
import { loadItemLookup } from "@hub/lib/bushraSalesRegister";
import { loadBushraPurchaseRegister, type BushraPurchaseRow } from "@hub/lib/bushraPurchaseRegister";
import { exportPurchaseRegisterXlsx } from "@hub/lib/exportPurchaseRegister";
import { PURCHASE_REGISTER_LOCAL } from "@hub/lib/purchaseRegister";
import {
  PURCHASE_DASHBOARDS, purchaseDashboardTitle, purchasePresetById,
  type PurchaseQtyUnit, type PurchaseSectionDim,
} from "@hub/lib/bushraPurchaseDashboards";
import { SERIES_1, SERIES_2 } from "@hub/lib/batchCostingDashboard";
import { useReportAccess } from "@hub/lib/reportAccess";

const BASE = "/outstanding-dashboard";
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const TOOLTIP_BOX = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-md";
const KPI_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ea580c", "#7c3aed", "#0d9488"];

type Row = BushraPurchaseRow;

const NOT_SET = "(Not set)";
const orNotSet = (v: string | null | undefined) => v || NOT_SET;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fyOfDate = (d: string) => {
  const y = Number(d.slice(0, 4));
  const s = Number(d.slice(4, 6)) >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
};
const monthOf = (r: Row) => `${MONTHS[Number(r.vch_date.slice(4, 6)) - 1]}-${r.vch_date.slice(2, 4)}`;

const FILTERS = {
  month: { label: "Month", all: "All Months", unit: "Months", get: monthOf },
  location: { label: "Location", all: "All Locations", unit: "Locations", get: (r: Row) => orNotSet(r.location_name) },
  company: { label: "Company", all: "All Companies", unit: "Companies", get: (r: Row) => r.company },
  type: { label: "Type", all: "All Types", unit: "Types", get: (r: Row) => r.type },
  purchaseType: { label: "Purchase-Type", all: "All Purchase-Types", unit: "Purchase-Types", get: (r: Row) => orNotSet(r.purchase_type) },
  category: { label: "Category", all: "All Categories", unit: "Categories", get: (r: Row) => orNotSet(r.item_category) },
  inkType: { label: "Ink Type", all: "All Ink Types", unit: "Ink Types", get: (r: Row) => orNotSet(r.ink_type) },
  group: { label: "Group", all: "All Groups", unit: "Groups", get: (r: Row) => orNotSet(r.item_group) },
  colour: { label: "Colour", all: "All Colours", unit: "Colours", get: (r: Row) => orNotSet(r.colour) },
  particulars: { label: "Particulars", all: "All Particulars", unit: "Particulars", get: (r: Row) => orNotSet(r.particulars) },
  party: { label: "Vendor Name", all: "All Vendors", unit: "Vendors", get: (r: Row) => orNotSet(r.party) },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const byKey = <T,>(make: () => T) => Object.fromEntries(FILTER_KEYS.map((k) => [k, make()])) as Record<FilterKey, T>;
const NO_FILTERS = byKey<string[]>(() => []);
/** Particulars is filtered from its Mix panel and the report, not the bar — it has thousands of values. */
const BAR_FILTER_KEYS = FILTER_KEYS.filter((k) => k !== "particulars");

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** "Sep-26" → "202609" — full YYYYMM, as on the Sales dashboards. */
const monthKey = (label: string) => {
  const [m, y] = label.split("-");
  return `20${y}${String(MONTHS.indexOf(m) + 1).padStart(2, "0")}`;
};

/**
 * Every filter's options from the rows surviving every OTHER filter — the house cascade, so no
 * combination a reader can assemble returns an empty table. A column is left out of its own options,
 * or narrowing to one value would leave no way to widen again. `rows` arrives already narrowed by
 * anything else the caller applies: the report passes its search and table-only filters in that way.
 */
function cascadeOptions(rows: Row[], sel: Record<FilterKey, string[]>): Record<FilterKey, MultiSelectOption[]> {
  const active = FILTER_KEYS.filter((k) => sel[k].length);
  const found = byKey(() => new Set<string>());
  for (const r of rows) {
    let missedKey: FilterKey | null = null;
    let missed = 0;
    for (const k of active) {
      if (!sel[k].includes(FILTERS[k].get(r))) { missed++; missedKey = k; if (missed > 1) break; }
    }
    if (missed > 1) continue;
    for (const k of FILTER_KEYS) if (missed === 0 || k === missedKey) found[k].add(FILTERS[k].get(r));
  }
  return Object.fromEntries(FILTER_KEYS.map((k) => {
    const vals = [...found[k]];
    vals.sort(k === "month" ? (a, b) => monthKey(a).localeCompare(monthKey(b)) : collator.compare);
    return [k, vals.map((v) => ({ value: v, label: v }))];
  })) as Record<FilterKey, MultiSelectOption[]>;
}

const dim = (selected: string[], name: string) => (!selected.length || selected.includes(name) ? 1 : 0.3);
const fmtInt = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n));
function fmtQtyCompact(n: number): string {
  const a = Math.abs(n);
  const trim = (x: number) => String(Number(x.toFixed(2)));
  if (a >= 1e7) return `${trim(n / 1e7)} Cr`;
  if (a >= 1e5) return `${trim(n / 1e5)} L`;
  if (a >= 1e3) return `${trim(n / 1e3)} K`;
  return trim(n);
}
type QtyFmt = (n: number) => string;
function makeQtyFmt(unit: PurchaseQtyUnit): QtyFmt {
  if (unit === "pcs") return (n) => `${fmtInt(n)} pcs`;
  if (unit === "nos") return (n) => `${fmtInt(n)} Nos`;
  return fmtQtyCompact;
}
const pct = (v: number, total: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : "");

export default function BushraPurchaseDashboard({ presetId }: { presetId: string }) {
  const preset = purchasePresetById(presetId);
  const { canSee } = useReportAccess();
  const fyOptions = useMemo(() => salesFyOptions(), []);
  const [fys, setFys] = useState<string[]>(() => [currentFy()]);
  const pickedFys = useMemo(() => (fys.length ? [...fys] : [currentFy()]).sort(), [fys]);
  const from = `${pickedFys[0].slice(0, 4)}0401`;
  const to = useMemo(() => {
    const end = `${Number(pickedFys[pickedFys.length - 1].slice(0, 4)) + 1}0331`;
    const today = ymd(new Date());
    return today < end ? today : end;
  }, [pickedFys]);

  // Same cache keys as the Purchase Register page, so every dashboard and the register share one load.
  // ⚠ The item lookup's key is the Sales side's: bump it WITH that one, or the lookup downloads twice.
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v3"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });
  const { data, isLoading, isFetching, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraPurchaseRegister", "v2", PURCHASE_REGISTER_LOCAL, from, to],
    queryFn: () => loadBushraPurchaseRegister(from, to, lookup),
    enabled: !!lookup,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const errText = (lookupError ?? rowsError) ? ((lookupError ?? rowsError) as Error).message : null;
  const base = useMemo(
    () => (data ?? []).filter((r) => pickedFys.includes(fyOfDate(r.vch_date)) && preset.include(r)),
    [data, preset, pickedFys],
  );

  /* -------- filters (bar clicks work as on the Sales dashboards) -------- */
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const [barPicked, setBarPicked] = useState<FilterKey[]>([]);
  const setFilter = (k: FilterKey) => (v: string[]) => {
    setSel((s) => ({ ...s, [k]: v }));
    setBarPicked((p) => p.filter((d) => d !== k));
  };
  const toggle = (k: FilterKey) => (name: string) => {
    const on = !(sel[k].length === 1 && sel[k][0] === name);
    setSel((s) => ({ ...s, [k]: on ? [name] : [] }));
    setBarPicked((p) => (on ? (p.includes(k) ? p : [...p, k]) : p.filter((d) => d !== k)));
  };
  const filterCount = FILTER_KEYS.reduce((n, k) => n + sel[k].length, 0);
  const resetAll = () => { setSel(NO_FILTERS); setBarPicked([]); };
  const clearOnBlankClick = (e: React.MouseEvent) => {
    if (!barPicked.length) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.("button, a, input, select, textarea, table, [role='dialog'], [data-keep-filters]")) return;
    setSel((s) => ({ ...s, ...Object.fromEntries(barPicked.map((k) => [k, []])) }));
    setBarPicked([]);
  };
  const pickedNote = (k: FilterKey, what: string) =>
    sel[k].length
      ? barPicked.includes(k)
        ? `filtered to ${sel[k].join(", ")} — click it again, or any blank space, to clear`
        : `filtered to ${sel[k].join(", ")} — picked in the filter bar, so Reset All clears it`
      : `click a bar to filter every panel by that ${what}`;

  const rows = useMemo(
    () => base.filter((r) => FILTER_KEYS.every((k) => !sel[k].length || sel[k].includes(FILTERS[k].get(r)))),
    [base, sel],
  );

  /** Each dropdown's options come from the rows surviving every OTHER filter (the house cascade). */
  const options = useMemo(() => cascadeOptions(base, sel), [base, sel]);

  /* -------- figures -------- */
  const kpi = useMemo(() => {
    let net = 0, gross = 0, less = 0, qty = 0;
    const vouchers = new Set<string>();
    const parties = new Set<string>();
    for (const r of rows) {
      net += r.amount;
      qty += r.quantity;
      if (r.amount < 0) { less += r.amount; continue; }
      gross += r.amount;
      vouchers.add(`${r.tenant_id}|${r.voucher_guid}`);
      parties.add(r.party);
    }
    return { net, gross, less, qty, vouchers: vouchers.size, parties: parties.size };
  }, [rows]);

  const fmtQ = useMemo(() => makeQtyFmt(preset.qtyUnit), [preset]);
  const loading = (isLoading || !lookup) && !data && !errText;
  const empty = !loading && !errText && rows.length === 0;
  const emptyMsg = base.length ? "No lines match those filters." : "No lines on this dashboard in this period.";
  const tabs = PURCHASE_DASHBOARDS.filter((p) => canSee(p.id));

  return (
    <div onClick={clearOnBlankClick}
         className={cn("p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3 transition-opacity", isFetching && data && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={`${BASE}/bushra-dashboard?group=purchase`}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Purchase
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">{purchaseDashboardTitle(preset)}</h1>
            <span className="text-[12px] text-muted-foreground">· {preset.blurb}</span>
          </div>
        </div>
        {canSee("bushra-purchase-register") && (
          <Link to={`${BASE}/reports/bushra-purchase-register`} className="text-[11px] text-primary hover:underline">Purchase Register</Link>
        )}
      </div>

      {tabs.length > 1 && (
        <nav className="flex flex-wrap gap-1.5">
          {tabs.map((p) => (
            <Link key={p.id} to={`${BASE}/${p.path}`}
                  className={cn(
                    "rounded-pill border px-3 py-1 text-[12px] font-medium transition-colors",
                    p.id === preset.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}>
              {p.id === "bushra-purchase-dashboard" ? "Purchase" : p.title}
            </Link>
          ))}
        </nav>
      )}

      {PURCHASE_REGISTER_LOCAL && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Localhost snapshot — not the live table. Rebuild with <code>python tools/build_purchase_register_snapshot.py</code>.
        </div>
      )}

      <div data-keep-filters className="rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Financial Year</span>
            <MultiSelectFilter
              options={fyOptions.map((o) => ({ value: o, label: `FY ${o}` }))}
              value={fys}
              // Clearing falls back to the current year — shown as such, never as "All Years",
              // which is what an empty pick would otherwise read while showing one year.
              onChange={(v) => { setFys(v.length ? v : [currentFy()]); setSel(NO_FILTERS); }}
              allLabel="All Years"
              searchable
              unit="Years"
              triggerClassName="w-[170px] h-8 text-[12px] rounded-input border-border"
            />
          </label>
          {BAR_FILTER_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{FILTERS[k].label}</span>
              <MultiSelectFilter
                options={options[k]}
                value={sel[k]}
                onChange={setFilter(k)}
                allLabel={FILTERS[k].all}
                unit={FILTERS[k].unit}
                triggerClassName={cn("h-8 text-[12px] rounded-input border-border", k === "party" ? "w-[200px]" : "w-[150px]")}
                contentClassName={k === "party" || k === "category" || k === "inkType" || k === "group" ? "w-80" : undefined}
                searchable
              />
            </label>
          ))}
          <Button onClick={resetAll} disabled={!filterCount}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {fmtInt(rows.length)} lines · {from.slice(6)}-{from.slice(4, 6)}-{from.slice(0, 4)} → {to.slice(6)}-{to.slice(4, 6)}-{to.slice(0, 4)}
          </span>
        </div>
      </div>

      {errText && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>
      )}

      <div className={cn("grid grid-cols-2 md:grid-cols-3 gap-2", preset.hasQuantity ? "xl:grid-cols-6" : "xl:grid-cols-5")}>
        <Kpi accent={KPI_COLORS[0]} icon={IndianRupee} label="Net Purchase" loading={loading}
             value={fmtSales(kpi.net)} sub="less returns & debit notes" />
        <Kpi accent={KPI_COLORS[1]} icon={TrendingUp} label="Gross Purchase" loading={loading}
             value={fmtSales(kpi.gross)} sub="every positive line" />
        <Kpi accent={KPI_COLORS[2]} icon={TrendingDown} label="Returns & Debit Notes" loading={loading}
             value={fmtSales(kpi.less)} sub={kpi.gross ? `${pct(-kpi.less, kpi.gross)} of gross` : "none"} />
        {preset.hasQuantity && (
          <Kpi accent={KPI_COLORS[3]} icon={Boxes} label="Quantity" loading={loading}
               value={fmtQ(kpi.qty)}
               sub={preset.qtyUnit === "none" ? "as booked — mixed units unless filtered" : "net of returns"} />
        )}
        <Kpi accent={KPI_COLORS[4]} icon={FileText} label="Vouchers" loading={loading}
             value={fmtInt(kpi.vouchers)} sub={kpi.vouchers && kpi.gross ? `avg ${fmtSales(kpi.gross / kpi.vouchers)}` : ""} />
        <Kpi accent={KPI_COLORS[5]} icon={Users} label="Vendors" loading={loading}
             value={fmtInt(kpi.parties)} sub="billed in the period" />
      </div>

      <Overview
        rows={rows} from={from} to={to} fys={pickedFys} sections={preset.sections} hasQuantity={preset.hasQuantity}
        base={base} sel={sel} toggle={toggle} noteFor={pickedNote} fmtQ={fmtQ} setFilter={setFilter}
        onResetDashboard={resetAll} loading={loading} empty={empty} emptyMessage={emptyMsg}
      />
    </div>
  );
}

/* ==================================================================== overview */

interface Pair { name: string; qty: number; value: number; lines: number }

function pairBy(rows: Row[], get: (r: Row) => string): Pair[] {
  const m = new Map<string, Pair>();
  for (const r of rows) {
    const k = get(r);
    const p = m.get(k) ?? { name: k, qty: 0, value: 0, lines: 0 };
    p.qty += r.quantity;
    p.value += r.amount;
    p.lines += 1;
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

function monthPairs(rows: Row[], from: string, to: string, fys: string[]): Pair[] {
  const out: Pair[] = [];
  const idx = new Map<string, Pair>();
  let y = Number(from.slice(0, 4)), m = Number(from.slice(4, 6));
  const endKey = Number(to.slice(0, 6));
  while (y * 100 + m <= endKey) {
    const key = `${y}${String(m).padStart(2, "0")}`;
    if (fys.includes(fyOfDate(`${key}01`))) {
      const p = { name: `${MONTHS[m - 1]}-${String(y).slice(2)}`, qty: 0, value: 0, lines: 0 };
      out.push(p);
      idx.set(key, p);
    }
    if (++m > 12) { m = 1; y++; }
  }
  for (const r of rows) {
    const p = idx.get(r.vch_date.slice(0, 6));
    if (!p) continue;
    p.qty += r.quantity;
    p.value += r.amount;
    p.lines += 1;
  }
  return out;
}

const CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER_COLOR = "#898781";
/** Colours follow the ENTITY, never its rank — a Purchase Return is red under every filter. */
const TYPE_COLORS: Record<string, string> = {
  "Purchase": CAT[0], "Branch Purchase": CAT[3], "Related Purchase": CAT[4],
  "Purchase Return": CAT[7], "Branch Purchase Return": CAT[7], "Related Purchase Return": CAT[7],
  "Purchase Debit Note": CAT[6], "Purchase Credit Note": CAT[5],
};
const PURCHASE_TYPE_COLORS: Record<string, string> = {
  "Ink": CAT[0], "Spare Parts": CAT[1], "Heads": CAT[2], "Machine": CAT[3], "Paper": CAT[4],
  "Service Expense": CAT[5], "Raw Material": CAT[6], "Packing Material": CAT[7],
};
const INK_SWATCH: Record<string, string> = {
  BLACK: "#1f1f1f", CYAN: "#00a6d6", MAGENTA: "#d6007e", YELLOW: "#f5c400", GREY: "#8a8f98",
  PINK: "#f48fb1", RED: "#d62828", ORANGE: "#f28c28", GREEN: "#2e9e44", BLUE: "#1f5fd6",
  VIOLET: "#7e3fd1", PURPLE: "#7e3fd1", BROWN: "#7b4a2a", WHITE: "#d9d9d9", TURQUOISE: "#1fb5b0",
};

const SECTION_META: Record<PurchaseSectionDim, { heading: string; subtitle: string; colorOf: (name: string) => string }> = {
  type: { heading: "By Type", subtitle: "by transaction type", colorOf: (n) => TYPE_COLORS[n] ?? OTHER_COLOR },
  purchaseType: { heading: "By Purchase-Type", subtitle: "by purchase-type", colorOf: (n) => PURCHASE_TYPE_COLORS[n] ?? OTHER_COLOR },
  category: { heading: "By Category", subtitle: "by category", colorOf: () => CAT[0] },
  group: { heading: "By Group", subtitle: "by group", colorOf: () => CAT[2] },
  inkType: { heading: "By Ink Type", subtitle: "by ink type", colorOf: () => CAT[6] },
  colour: { heading: "By Colour", subtitle: "by colour", colorOf: (n) => INK_SWATCH[n] ?? OTHER_COLOR },
  particulars: { heading: "By Expense Ledger", subtitle: "by expense ledger", colorOf: () => CAT[5] },
  company: { heading: "By Company", subtitle: "by company", colorOf: () => CAT[3] },
};

function Overview({ rows, base, from, to, fys, sections, hasQuantity, sel, toggle, noteFor, fmtQ, setFilter, onResetDashboard, loading, empty, emptyMessage }: {
  rows: Row[]; base: Row[]; from: string; to: string; fys: string[]; sections: PurchaseSectionDim[]; hasQuantity: boolean;
  sel: Record<FilterKey, string[]>; toggle: (k: FilterKey) => (name: string) => void;
  noteFor: (k: FilterKey, what: string) => string; fmtQ: QtyFmt;
  setFilter: (k: FilterKey) => (v: string[]) => void; onResetDashboard: () => void;
  loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const bySection = useMemo(
    () => sections.map((s) => ({ dim: s, data: pairBy(rows, FILTERS[s].get) })),
    [rows, sections],
  );
  const byMonth = useMemo(() => monthPairs(rows, from, to, fys), [rows, from, to, fys]);
  const common = { loading, empty, emptyMessage, fmtQ };

  return (
    <>
      {bySection.map(({ dim: d, data }) => {
        const meta = SECTION_META[d];
        const note = noteFor(d, meta.subtitle.replace("by ", ""));
        return (
          <div key={d} className="space-y-3">
            <SectionHeading>{meta.heading}</SectionHeading>
            <div className={cn("grid gap-3", hasQuantity && "lg:grid-cols-2")}>
              {hasQuantity && (
                <MixPanel title="Quantity Mix" subtitle={meta.subtitle} data={data} measure="qty" note={note}
                          colorOf={meta.colorOf} selected={sel[d]} onPick={toggle(d)} {...common} />
              )}
              <MixPanel title="Value Mix" subtitle={meta.subtitle} data={data} measure="value" note={note}
                        colorOf={meta.colorOf} selected={sel[d]} onPick={toggle(d)} {...common} />
            </div>
          </div>
        );
      })}

      <SectionHeading>By Month</SectionHeading>
      <div className={cn("grid gap-3", hasQuantity && "lg:grid-cols-2")}>
        <ColumnChart title="Value by Month" data={byMonth} measure="value" color={SERIES_1}
                     selected={sel.month} onPick={toggle("month")} note={noteFor("month", "month")} {...common} />
        {hasQuantity && (
          <ColumnChart title="Quantity by Month" data={byMonth} measure="qty" color={SERIES_2}
                       selected={sel.month} onPick={toggle("month")} note={noteFor("month", "month")} {...common} />
        )}
      </div>

      <SectionHeading>Purchase Report</SectionHeading>
      <PurchaseReportTable rows={rows} base={base} from={from} to={to} loading={loading} fmtQ={fmtQ}
                           sel={sel} setFilter={setFilter} onResetDashboard={onResetDashboard} />
    </>
  );
}

function MixPanel({ title, subtitle, data, measure, colorOf, selected, onPick, note, fmtQ, loading, empty, emptyMessage }: {
  title: string; subtitle: string; data: Pair[]; measure: "qty" | "value"; colorOf: (name: string) => string; note: string;
  selected: string[]; onPick: (name: string) => void; fmtQ: QtyFmt; loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const fmt = measure === "value" ? fmtSales : fmtQ;
  const rows = [...data].sort((a, b) => b[measure] - a[measure]);
  const net = rows.reduce((s, p) => s + p[measure], 0);
  const gross = rows.reduce((s, p) => s + Math.max(0, p[measure]), 0);
  const max = Math.max(1, ...rows.map((p) => Math.abs(p[measure])));

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
        <span className="text-[12px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="-mt-2 mb-2 truncate text-[11px] text-muted-foreground" title={note}>{note}</div>
      {loading ? (
        <div className="h-40 w-full animate-pulse rounded-md bg-muted/50" />
      ) : empty ? (
        <div className="py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <>
          <ul className={cn("space-y-1", rows.length > 10 && "max-h-[420px] overflow-y-auto pr-1")}>
            {rows.map((p) => {
              const v = p[measure];
              const on = !selected.length || selected.includes(p.name);
              const color = colorOf(p.name);
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => onPick(p.name)}
                    title={`${p.name}\nValue ${fmtSales(p.value)} · Quantity ${fmtQ(p.qty)} · ${fmtInt(p.lines)} lines\nClick to filter`}
                    className={cn(
                      "grid w-full grid-cols-[minmax(110px,1.1fr)_minmax(60px,2fr)_auto_52px] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/40",
                      !on && "opacity-40",
                      selected.includes(p.name) && "bg-primary/5 ring-1 ring-primary/30",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="truncate text-[13.5px] text-foreground/80">{p.name}</span>
                    </span>
                    <span className="h-2 w-full overflow-hidden rounded-full bg-muted/60">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(Math.abs(v) / max) * 100}%`,
                          background: v < 0 ? `repeating-linear-gradient(45deg, ${color} 0 3px, ${color}55 3px 6px)` : color,
                        }}
                      />
                    </span>
                    <span className={cn("text-right text-[13.5px] font-semibold tabular-nums", v < 0 ? "text-destructive" : "text-foreground")}>
                      {fmt(v)}
                    </span>
                    <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                      {gross ? `${((v / gross) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border/70 px-2 pt-2 text-[12.5px]">
            <span className="font-medium text-muted-foreground">
              {measure === "value" ? "Net total" : "Total"}
              {measure === "value" && gross !== net && <span className="ml-1 text-[11px]">(gross {fmtSales(gross)})</span>}
            </span>
            <span className="font-bold tabular-nums text-foreground">{fmt(net)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

function ColumnChart({ title, data, measure, color, selected, onPick, note, fmtQ, loading, empty, emptyMessage }: {
  title: string; data: Pair[]; measure: "qty" | "value"; color: string; note: string;
  selected: string[]; onPick: (name: string) => void; fmtQ: QtyFmt; loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const fmt = measure === "value" ? fmtSales : fmtQ;
  const total = data.reduce((s, p) => s + p[measure], 0);
  const many = data.length > 8;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
        <span className="truncate text-[12px] text-muted-foreground">{note}</span>
      </div>
      {loading ? (
        <div className="h-[300px] w-full animate-pulse rounded-md bg-muted/50" />
      ) : empty ? (
        <div className="py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: many ? 30 : 4 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: many ? 10 : 11 }} tickLine={false}
                   axisLine={{ stroke: CHART_GRID }} interval={0}
                   angle={many ? -35 : 0} textAnchor={many ? "end" : "middle"} height={many ? 50 : 30} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={62}
                   tickFormatter={(v: number) => fmt(v).replace("₹ ", "")} />
            <ReferenceLine y={0} stroke="hsl(220 10% 75%)" />
            <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<PairTooltip fmtQ={fmtQ} />} />
            <Bar dataKey={measure} maxBarSize={56} radius={[4, 4, 0, 0]} className="cursor-pointer"
                 onClick={(d: { name?: string }, _i: number, e?: { stopPropagation?: () => void }) => {
                   e?.stopPropagation?.();
                   if (d?.name) onPick(d.name);
                 }}>
              {data.map((p) => <Cell key={p.name} fill={color} fillOpacity={dim(selected, p.name)} />)}
              <LabelList dataKey={measure} position="top"
                         formatter={(v: number) => (v ? fmt(v) : "")}
                         style={{ fontSize: many ? 9.5 : 11, fill: LABEL_FILL, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {!loading && !empty && total !== 0 && (
        <div className="mt-1 flex justify-between border-t border-border/70 px-1 pt-2 text-[12.5px]">
          <span className="font-medium text-muted-foreground">Total</span>
          <span className="font-bold tabular-nums text-foreground">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

function PairTooltip({ active, payload, fmtQ }: { active?: boolean; payload?: { payload: Pair }[]; fmtQ: QtyFmt }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{p.name}</div>
      <div className="tabular-nums text-foreground">Value {fmtSales(p.value)}</div>
      <div className="tabular-nums text-foreground">Quantity {fmtQ(p.qty)}</div>
      <div className="text-muted-foreground">{fmtInt(p.lines)} lines</div>
    </div>
  );
}

const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const TABLE_ONLY = {
  date: (r: Row) => r.date_display,
  voucherNo: (r: Row) => r.voucher_no,
} as const;
type TableOnlyKey = keyof typeof TABLE_ONLY;
const TABLE_ONLY_KEYS = Object.keys(TABLE_ONLY) as TableOnlyKey[];
const NO_TABLE_FILTERS: Record<TableOnlyKey, string[]> = { date: [], voucherNo: [] };
const dateSortKey = (d: string) => d.split("-").reverse().join("");

/**
 * Columns the dashboard also filters use the DASHBOARD's selection; Date and Voucher No. narrow only
 * the table. Every column sorts (the house rule), each by `sort`: the date in calendar order and the
 * amounts as numbers, not by the text they print.
 */
const REPORT_COLUMNS: {
  header: string; filter: { dash: FilterKey } | { table: TableOnlyKey } | null; right?: boolean;
  sort: (r: Row) => string | number;
}[] = [
  { header: "Date", filter: { table: "date" }, sort: (r) => r.vch_date },
  { header: "Voucher No.", filter: { table: "voucherNo" }, sort: (r) => r.voucher_no },
  { header: "Type", filter: { dash: "type" }, sort: (r) => r.type },
  { header: "Company", filter: { dash: "company" }, sort: (r) => r.company },
  { header: "Location", filter: { dash: "location" }, sort: (r) => r.location_name },
  { header: "Vendor Name", filter: { dash: "party" }, sort: (r) => r.party },
  { header: "Particulars", filter: { dash: "particulars" }, sort: (r) => r.particulars },
  { header: "Purchase-Type", filter: { dash: "purchaseType" }, sort: (r) => r.purchase_type },
  { header: "Category", filter: { dash: "category" }, sort: (r) => r.item_category },
  { header: "Group", filter: { dash: "group" }, sort: (r) => r.item_group },
  { header: "Ink Type", filter: { dash: "inkType" }, sort: (r) => r.ink_type },
  { header: "Colour", filter: { dash: "colour" }, sort: (r) => r.colour },
  { header: "Quantity", filter: null, right: true, sort: (r) => r.quantity },
  { header: "Rate", filter: null, right: true, sort: (r) => r.rate },
  { header: "Amount", filter: null, right: true, sort: (r) => r.amount },
];

function PurchaseReportTable({ rows, base, from, to, loading, fmtQ, sel, setFilter, onResetDashboard }: {
  /** The dashboard's filtered lines, and `base` — its slice before any filter, for the dropdowns. */
  rows: Row[]; base: Row[]; from: string; to: string; loading: boolean; fmtQ: QtyFmt;
  sel: Record<FilterKey, string[]>;
  setFilter: (k: FilterKey) => (v: string[]) => void;
  onResetDashboard: () => void;
}) {
  const [q, setQ] = useState("");
  const [tsel, setTsel] = useState<Record<TableOnlyKey, string[]>>(NO_TABLE_FILTERS);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const matchesSearch = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (r: Row) => !s ||
      r.party.toLowerCase().includes(s) || r.particulars.toLowerCase().includes(s) || r.voucher_no.toLowerCase().includes(s);
  }, [q]);
  const keepTable = (r: Row) => TABLE_ONLY_KEYS.every((k) => !tsel[k].length || tsel[k].includes(TABLE_ONLY[k](r)));
  const searched = useMemo(() => rows.filter(matchesSearch), [rows, matchesSearch]);
  const shown = useMemo(() => searched.filter(keepTable), [searched, tsel]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => {
    if (!sort) return shown;
    const get = REPORT_COLUMNS[sort.col].sort;
    return [...shown].sort((a, b) => {
      const x = get(a), y = get(b);
      return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [shown, sort]);
  /** Text columns open A→Z, amounts largest first; a second click turns it round. */
  const toggleSort = (col: number) => setSort((s) =>
    s?.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: REPORT_COLUMNS[col].right ? -1 : 1 });
  /**
   * The dashboard columns' dropdowns cascade off the table's own filters and search too, so no pick
   * made in this row can return an empty table. (The filter bar's lists stay the dashboard's own.)
   */
  const dashOptions = useMemo(
    () => cascadeOptions(base.filter((r) => matchesSearch(r) && keepTable(r)), sel),
    [base, sel, matchesSearch, tsel], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** Clears what could have emptied the table — its own filters and search, and the dashboard's when those alone do. */
  const clearFilters = () => {
    setTsel(NO_TABLE_FILTERS);
    setQ("");
    if (!rows.length) onResetDashboard();
  };
  const tableOptions = useMemo(() => Object.fromEntries(TABLE_ONLY_KEYS.map((k) => {
    const vals = new Set<string>();
    for (const r of searched) {
      if (TABLE_ONLY_KEYS.every((o) => o === k || !tsel[o].length || tsel[o].includes(TABLE_ONLY[o](r)))) vals.add(TABLE_ONLY[k](r));
    }
    const list = [...vals];
    list.sort(k === "date" ? (a, b) => dateSortKey(a).localeCompare(dateSortKey(b)) : collator.compare);
    return [k, list.map((v) => ({ value: v, label: v }))];
  })) as Record<TableOnlyKey, MultiSelectOption[]>, [searched, tsel]);

  const page = usePagination(sorted, {
    resetKey: `${rows.length}|${q}|${TABLE_ONLY_KEYS.map((k) => tsel[k].join(",")).join("|")}|${sort?.col}|${sort?.dir}`,
  });
  const totals = useMemo(() => shown.reduce((t, r) => ({ qty: t.qty + r.quantity, value: t.value + r.amount }), { qty: 0, value: 0 }), [shown]);
  const tableFilterCount = TABLE_ONLY_KEYS.reduce((n, k) => n + tsel[k].length, 0);

  return (
    <SalesPanel title="Full purchase report" icon={Table2} loading={loading}
                subtitle={`${fmtInt(shown.length)} lines · quantity ${fmtQ(totals.qty)} · amount ${fmtSales(totals.value)}`}
                actions={
                  <div className="flex items-center gap-2">
                    {tableFilterCount > 0 && (
                      <button type="button" onClick={() => setTsel(NO_TABLE_FILTERS)} className="text-[11px] text-primary hover:underline">
                        Clear table filters ({tableFilterCount})
                      </button>
                    )}
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor, particulars, voucher…"
                             className="h-8 w-56 rounded-input pl-7 text-[12px]" />
                    </div>
                    <Button onClick={() => sorted.length && exportPurchaseRegisterXlsx(sorted, { from, to })}
                            disabled={!shown.length}
                            className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90">
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </div>
                }>
      <ScrollableTable className="rounded-md border border-border" maxHeight="max-h-[60vh]">
        <table className="w-full min-w-[1800px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {REPORT_COLUMNS.map((c, i) => (
                <th key={c.header} className={cn(
                  "whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                  c.right ? "text-right" : "text-left",
                )}>
                  <button type="button" onClick={() => toggleSort(i)} title={`Sort by ${c.header}`}
                          className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", sort?.col === i && "text-foreground")}>
                    {c.header}
                    {sort?.col !== i ? <ArrowUpDown className="h-3 w-3 opacity-40" />
                      : sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="border-b-2 border-border bg-muted/30">
              {REPORT_COLUMNS.map((c) => (
                <th key={c.header} className="px-2 py-1.5 font-normal">
                  {c.filter && ("dash" in c.filter ? (
                    <MultiSelectFilter
                      options={dashOptions[c.filter.dash]}
                      value={sel[c.filter.dash]}
                      onChange={setFilter(c.filter.dash)}
                      allLabel="Any" unit={c.header} searchable contentClassName="w-72"
                      triggerClassName="w-full min-w-[110px] h-8 text-xs rounded-input border-border bg-surface"
                    />
                  ) : (
                    <MultiSelectFilter
                      options={tableOptions[c.filter.table]}
                      value={tsel[c.filter.table]}
                      onChange={(v) => setTsel((s) => ({ ...s, [(c.filter as { table: TableOnlyKey }).table]: v }))}
                      allLabel="Any" unit={c.header} searchable contentClassName="w-72"
                      triggerClassName="w-full min-w-[110px] h-8 text-xs rounded-input border-border bg-surface"
                    />
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.length === 0 ? (
              // The table stays standing when the filters match nothing, so the way back is right here.
              <tr><td colSpan={REPORT_COLUMNS.length} className="py-8 text-center text-[12px] text-muted-foreground">
                {base.length ? (
                  <span className="inline-flex items-center gap-3">
                    No lines match those filters.
                    <Button variant="outline" onClick={clearFilters} className="h-7 gap-1.5 rounded-button px-2.5 text-[11.5px]">
                      <RotateCcw className="h-3 w-3" /> Clear filters
                    </Button>
                  </span>
                ) : "No lines on this dashboard in this period."}
              </td></tr>
            ) : page.pageItems.map((r, i) => (
              <tr key={`${r.tenant_id}-${r.voucher_guid}-${r.line_no}-${i}`} className="border-b border-border/40 text-[12.5px] hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{r.date_display}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.voucher_no}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.type}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.company}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.location_name}</td>
                <td className="px-3 py-1.5">{r.party}</td>
                <td className="px-3 py-1.5">{r.particulars}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.purchase_type}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.item_category}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.item_group}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.ink_type}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.colour}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.quantity ? nf2.format(r.quantity) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.rate ? nf2.format(r.rate) : "—"}</td>
                <td className={cn("whitespace-nowrap px-3 py-1.5 text-right tabular-nums", r.amount < 0 && "text-destructive")}>{nf2.format(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <Pagination state={page} rowsLabel="lines" />
    </SalesPanel>
  );
}

function Kpi({ accent, icon: Icon, label, value, sub, loading }: {
  accent: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; sub?: string; loading?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2 shadow-sm" title={value}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="mt-1 h-5 w-2/3 animate-pulse rounded bg-muted/60" />
      ) : (
        <div className="text-[19px] font-bold leading-tight text-foreground truncate">{value}</div>
      )}
      {sub && <div className="text-[10px] leading-snug text-muted-foreground truncate">{sub}</div>}
      <div className="mt-1.5 h-[3px] w-full rounded-full" style={{ background: `${accent}33` }}>
        <div className="h-full w-1/3 rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}
