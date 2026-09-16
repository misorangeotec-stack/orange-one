/**
 * Bushra-Dashboard → Sales → every Sales dashboard (Sales, Ink, Machines, Heads, Spare Parts, Papers,
 * FOC, SOA, Branch & Related).
 *
 * ONE screen, many fixed slices. Which lines a dashboard counts and what its first chart breaks
 * them down by live in lib/bushraSalesDashboards.ts; the route passes the preset id. Every figure is
 * summed from the Bushra Sales Register's own rows (lib/bushraSalesRegister.ts), so the dashboards
 * and the register can never disagree.
 *
 * LAYOUT
 *   tabs         the Sales dashboards the viewer holds
 *   filter bar   Financial Year · Month · Location · Company · Type · Sales-Type · Category ·
 *                Ink Type · Group · Colour · Party + Value/Quantity + Reset All
 *   KPI row      Net Value · Gross Value · Credit Notes & Returns · Quantity · Vouchers · Customers
 *   charts       by <primary> (Sales-Type / Ink Type / Group / Company) | by Category — two
 *                separate single-series bar charts, not grouped
 *
 * VALUE IS NET — a credit note or return is a negative line, netted off. QUANTITY is summed as
 * booked, across units (KGS, PCS, NOS…), so it is only meaningful once a filter narrows to items
 * that share a unit; the tile says so.
 *
 * CHART RULES (dataviz skill): each chart is ONE series, so one colour; every bar carries its value
 * and share as a label; clicking a bar filters every panel and clicking again lets it go.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowLeft, Boxes, Download, FileText, IndianRupee, Layers, Percent, RotateCcw, Search, ShoppingCart, Table2,
  TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { exportSalesRegisterXlsx, type ExtraColumn } from "@hub/lib/exportSalesRegister";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { fmtSales, salesFyOptions } from "@hub/lib/salesReport";
import { currentFy, ymd } from "@hub/lib/salesRegister";
import { loadBushraSalesRegister, loadItemLookup, type BushraRegisterRow } from "@hub/lib/bushraSalesRegister";
import {
  SALES_DASHBOARDS, salesPresetById, type Metric, type PrimaryDim, type QtyUnit, type SectionDim,
} from "@hub/lib/bushraSalesDashboards";
import { SERIES_1, SERIES_2 } from "@hub/lib/batchCostingDashboard";
import { useScopedParties } from "@hub/lib/scopeParties";
import { useReportAccess } from "@hub/lib/reportAccess";

const BASE = "/outstanding-dashboard";
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const TOOLTIP_BOX = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-md";
const KPI_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ea580c", "#7c3aed", "#0d9488"];

type Row = BushraRegisterRow;

const NOT_SET = "(Not set)";
const orNotSet = (v: string | null | undefined) => v || NOT_SET;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "20260415" → "2026-27" — the Indian FY a date falls in. */
const fyOfDate = (d: string) => {
  const y = Number(d.slice(0, 4));
  const s = Number(d.slice(4, 6)) >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
};
/** "20260415" → "Apr-26" */
const monthOf = (r: Row) => `${MONTHS[Number(r.vch_date.slice(4, 6)) - 1]}-${r.vch_date.slice(2, 4)}`;

/**
 * A DISCOUNT LINE IS NOT A RETURN, so it is counted as itself.
 *
 * Discounts and rate differences are booked as ledger lines on a credit note (or a debit note, when
 * the difference is in our favour) — "DISCOUNT & RATE DIFFERENCE@18% (INK)", "RATE DIFFERENCE
 * (INCOME) 18%-SPARE". Left inside Credit Note they read as goods coming back, which they are not:
 * nothing returned, the price simply changed. So TYPE says "Discount" on those lines, and the cards
 * split Sales → Discount → Net.
 */
const DISCOUNT_LINE = /DISCOUNT|RATE\s*DIFF/i;
const isDiscountLine = (r: Row) => DISCOUNT_LINE.test(r.particulars);
export const DISCOUNT_TYPE = "Discount";

/** Every dashboard filter, read off a register row. Order = order in the filter bar. */
const FILTERS = {
  month: { label: "Month", all: "All Months", unit: "Months", get: monthOf },
  location: { label: "Location", all: "All Locations", unit: "Locations", get: (r: Row) => orNotSet(r.location_name) },
  company: { label: "Company", all: "All Companies", unit: "Companies", get: (r: Row) => r.company },
  type: { label: "Type", all: "All Types", unit: "Types", get: (r: Row) => (isDiscountLine(r) ? DISCOUNT_TYPE : r.type) },
  salesType: { label: "Sales-Type", all: "All Sales-Types", unit: "Sales-Types", get: (r: Row) => orNotSet(r.sales_type) },
  category: { label: "Category", all: "All Categories", unit: "Categories", get: (r: Row) => orNotSet(r.item_category) },
  inkType: { label: "Ink Type", all: "All Ink Types", unit: "Ink Types", get: (r: Row) => orNotSet(r.ink_type) },
  group: { label: "Group", all: "All Groups", unit: "Groups", get: (r: Row) => orNotSet(r.item_group) },
  colour: { label: "Colour", all: "All Colours", unit: "Colours", get: (r: Row) => orNotSet(r.colour) },
  party: { label: "Customer Name", all: "All Customers", unit: "Customers", get: (r: Row) => r.party },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const byKey = <T,>(make: () => T) => Object.fromEntries(FILTER_KEYS.map((k) => [k, make()])) as Record<FilterKey, T>;
const NO_FILTERS = byKey<string[]>(() => []);

const PRIMARY_TITLE: Record<PrimaryDim, string> = {
  salesType: "Sales-Type", inkType: "Ink Type", group: "Group", company: "Company",
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const monthKey = (label: string) => {
  const [m, y] = label.split("-");
  return `${y}${String(MONTHS.indexOf(m) + 1).padStart(2, "0")}`;
};

/** A bar outside the current pick fades back rather than disappearing — it stays there to click. */
const dim = (selected: string[], name: string) => (!selected.length || selected.includes(name) ? 1 : 0.3);
const fmtInt = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n));
/** Compact quantity — "1.2 L", "45 K", "800". */
function fmtQty(n: number): string {
  const a = Math.abs(n);
  const trim = (x: number) => String(Number(x.toFixed(2)));
  if (a >= 1e7) return `${trim(n / 1e7)} Cr`;
  if (a >= 1e5) return `${trim(n / 1e5)} L`;
  if (a >= 1e3) return `${trim(n / 1e3)} K`;
  return trim(n);
}
/**
 * The dashboard's quantity writer, in the business's own units (lib/bushraSalesDashboards.ts):
 * ink "850 KG" / "12.5 T", spare parts "1,240 pcs", machines & heads "36 Nos", paper whatever its
 * items carry, and a bare number where units are mixed.
 */
type QtyFmt = (n: number) => string;
function makeQtyFmt(unit: QtyUnit, rows: Row[]): QtyFmt {
  const trim = (x: number) => String(Number(x.toFixed(2)));
  switch (unit) {
    case "kg":
      return (n) => (Math.abs(n) >= 1000 ? `${trim(n / 1000)} T` : `${fmtInt(n)} KG`);
    case "pcs":
      return (n) => `${fmtInt(n)} pcs`;
    case "nos":
      return (n) => `${fmtInt(n)} Nos`;
    case "auto": {
      const count = new Map<string, number>();
      for (const r of rows) if (r.unit) count.set(r.unit, (count.get(r.unit) ?? 0) + 1);
      const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
      return (n) => (top ? `${fmtInt(n)} ${top}` : fmtInt(n));
    }
    default:
      return fmtQty;
  }
}
const pct = (v: number, total: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : "");

interface Slice { name: string; value: number; lines: number }

function sliceBy(rows: Row[], get: (r: Row) => string, measure: (r: Row) => number): Slice[] {
  const m = new Map<string, Slice>();
  for (const r of rows) {
    const k = get(r);
    const s = m.get(k) ?? { name: k, value: 0, lines: 0 };
    s.value += measure(r);
    s.lines += 1;
    m.set(k, s);
  }
  return [...m.values()].filter((s) => s.value !== 0 || s.lines > 0).sort((a, b) => b.value - a.value);
}

export default function BushraSalesDashboard({ presetId }: { presetId: string }) {
  const preset = salesPresetById(presetId);
  const { canSee } = useReportAccess();
  const fyOptions = useMemo(() => salesFyOptions(), []);
  // THE CURRENT YEAR by default; the reader ticks last year when they want it. The load spans every
  // picked FY in one window (the register resolves each FY's own winning Tally book), and `base`
  // below drops a year left un-ticked in the middle of the span.
  const [fys, setFys] = useState<string[]>(() => [currentFy()]);
  const pickedFys = useMemo(() => (fys.length ? [...fys] : [currentFy()]).sort(), [fys]);
  const from = `${pickedFys[0].slice(0, 4)}0401`;
  const to = useMemo(() => {
    const end = `${Number(pickedFys[pickedFys.length - 1].slice(0, 4)) + 1}0331`;
    const today = ymd(new Date());
    return today < end ? today : end;
  }, [pickedFys]);

  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");

  // Same cache keys as the Sales Register, so every dashboard and the register share one load.
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v3"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });
  const { data, isLoading, isFetching, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraSalesRegister", "v7", from, to, scopeKey],
    queryFn: () => loadBushraSalesRegister(from, to, scope, lookup),
    enabled: !scopeLoading && !!lookup,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const errText = (lookupError ?? rowsError) ? ((lookupError ?? rowsError) as Error).message : null;
  /** This dashboard's slice of the register — the fixed part no filter can widen. */
  const base = useMemo(
    () => (data ?? []).filter((r) => pickedFys.includes(fyOfDate(r.vch_date)) && preset.include(r)),
    [data, preset, pickedFys],
  );

  /* -------- filters -------- */
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const [metric, setMetric] = useState<Metric>(preset.defaultMetric);
  const measure = metric === "value" ? (r: Row) => r.revenue : (r: Row) => r.quantity;
  const fmtQ = useMemo(() => makeQtyFmt(preset.qtyUnit, base), [preset, base]);
  const fmtMeasure = metric === "value" ? fmtSales : preset.qtyUnit === "none" ? fmtQty : fmtQ;

  /**
   * BAR CLICKS WORK THE WAY THE PRODUCTION DASHBOARD'S DO.
   *
   * A filter picked from a bar and one picked from a dropdown are not the same thing. Clicking a bar
   * is a glance: it filters to THAT one value, clicking it again lets it go, and a click on blank
   * space anywhere puts it back. Choosing from a dropdown is deliberate, so it stays until Reset All.
   * `barPicked` remembers which filters were set by clicking, and only those a blank click drops.
   */
  const [barPicked, setBarPicked] = useState<FilterKey[]>([]);
  /** A dropdown choice is the reader's own; it stops being a bar pick. */
  const setFilter = (k: FilterKey) => (v: string[]) => {
    setSel((s) => ({ ...s, [k]: v }));
    setBarPicked((p) => p.filter((d) => d !== k));
  };
  /** From a bar: pick that one value, or let it go if it was already the pick. */
  const toggle = (k: FilterKey) => (name: string) => {
    const on = !(sel[k].length === 1 && sel[k][0] === name);
    setSel((s) => ({ ...s, [k]: on ? [name] : [] }));
    setBarPicked((p) => (on ? (p.includes(k) ? p : [...p, k]) : p.filter((d) => d !== k)));
  };
  const filterCount = FILTER_KEYS.reduce((n, k) => n + sel[k].length, 0);
  const resetAll = () => { setSel(NO_FILTERS); setBarPicked([]); };
  /**
   * A click on blank space drops what was picked from a bar — and nothing else. Anything the reader
   * could be using is exempt: the filter bar, buttons, links, inputs, tables and open dropdowns.
   * A bar click stops its own event, so it never lands here.
   */
  const clearOnBlankClick = (e: React.MouseEvent) => {
    if (!barPicked.length) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.("button, a, input, select, textarea, table, [role='dialog'], [data-keep-filters]")) return;
    setSel((s) => ({ ...s, ...Object.fromEntries(barPicked.map((k) => [k, []])) }));
    setBarPicked([]);
  };
  /** The one line under a clickable card's title, as on the Production Dashboard. */
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
  const options = useMemo(() => {
    const active = FILTER_KEYS.filter((k) => sel[k].length);
    const found = byKey(() => new Set<string>());
    for (const r of base) {
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
  }, [base, sel]);

  /* -------- figures -------- */
  const kpi = useMemo(() => {
    let net = 0, sales = 0, discount = 0, less = 0, qty = 0;
    const vouchers = new Set<string>();
    const parties = new Set<string>();
    for (const r of rows) {
      net += r.revenue;
      qty += r.quantity;
      // Sales → Discount → Returns, and the three add up to Net.
      if (isDiscountLine(r)) { discount += r.revenue; continue; }
      if (r.revenue < 0) { less += r.revenue; continue; }
      sales += r.revenue;
      // A zero-value FOC line is still a voucher and a customer served.
      vouchers.add(`${r.tenant_id}|${r.voucher_no}`);
      parties.add(r.party);
    }
    return { net, sales, discount, less, qty, vouchers: vouchers.size, parties: parties.size };
  }, [rows]);
  const total = metric === "value" ? kpi.net : kpi.qty;

  const byPrimary = useMemo(() => sliceBy(rows, FILTERS[preset.primary].get, measure), [rows, preset, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCategory = useMemo(() => sliceBy(rows, FILTERS.category.get, measure), [rows, metric]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = (isLoading || !lookup) && !data && !errText;
  const empty = !loading && !errText && rows.length === 0;
  const emptyMsg = base.length ? "No lines match those filters." : "No lines on this dashboard in this period.";
  const metricWord = metric === "value" ? "Net value" : "Quantity";
  const tabs = SALES_DASHBOARDS.filter((p) => canSee(p.id));
  const primaryTitle = PRIMARY_TITLE[preset.primary];

  return (
    <div onClick={clearOnBlankClick}
         className={cn("p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3 transition-opacity", isFetching && data && "opacity-70")}>
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={`${BASE}/bushra-dashboard?group=sales`}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Sales
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">
              {preset.id === "bushra-sales-dashboard" ? preset.title : `${preset.title} Dashboard`}
            </h1>
            <span className="text-[12px] text-muted-foreground">· {preset.blurb}</span>
          </div>
        </div>
        {canSee("bushra-sales-register") && (
          <Link to={`${BASE}/reports/bushra-sales-register`} className="text-[11px] text-primary hover:underline">Sales Register</Link>
        )}
      </div>

      {/* ── Dashboard tabs ────────────────────────────────────────────────── */}
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
              {p.id === "bushra-sales-dashboard" ? "Sales" : p.title}
            </Link>
          ))}
        </nav>
      )}

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div data-keep-filters className="rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Financial Year</span>
            <MultiSelectFilter
              options={fyOptions.map((o) => ({ value: o, label: `FY ${o}` }))}
              value={fys}
              onChange={(v) => { setFys(v); setSel(NO_FILTERS); }}
              allLabel="All Years"
              searchable
              unit="Years"
              triggerClassName="w-[170px] h-8 text-[12px] rounded-input border-border"
            />
          </label>
          {FILTER_KEYS.map((k) => (
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
          {preset.layout === "slices" && <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Show</span>
            <div className="flex h-8 overflow-hidden rounded-input border border-border text-[12px]">
              {(["value", "quantity"] as Metric[]).map((m) => (
                <button key={m} type="button" onClick={() => setMetric(m)}
                        className={cn("px-3", metric === m ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-muted/50")}>
                  {m === "value" ? "Value" : "Quantity"}
                </button>
              ))}
            </div>
          </div>}
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

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-2">
        <Kpi accent={KPI_COLORS[1]} icon={TrendingUp} label="Sales Value" loading={loading}
             value={fmtSales(kpi.sales)} sub="billed, before discount & returns" />
        <Kpi accent={KPI_COLORS[3]} icon={Percent} label="Discount" loading={loading}
             value={fmtSales(kpi.discount)}
             sub={kpi.sales ? `${pct(-kpi.discount, kpi.sales)} of sales` : "none"} />
        <Kpi accent={KPI_COLORS[0]} icon={IndianRupee} label="Net Value" loading={loading}
             value={fmtSales(kpi.net)} sub="sales − discount − returns" />
        <Kpi accent={KPI_COLORS[2]} icon={TrendingDown} label="Credit Notes & Returns" loading={loading}
             value={fmtSales(kpi.less)} sub={kpi.sales ? `${pct(-kpi.less, kpi.sales)} of sales` : "none"} />
        <Kpi accent={KPI_COLORS[3]} icon={Boxes} label="Quantity" loading={loading}
             value={fmtQ(kpi.qty)}
             sub={preset.qtyUnit === "none" ? "as booked — mixed units unless filtered" : "net of returns"} />
        <Kpi accent={KPI_COLORS[4]} icon={FileText} label="Vouchers" loading={loading}
             value={fmtInt(kpi.vouchers)} sub={kpi.vouchers && kpi.sales ? `avg ${fmtSales(kpi.sales / kpi.vouchers)}` : ""} />
        <Kpi accent={KPI_COLORS[5]} icon={Users} label="Customers" loading={loading}
             value={fmtInt(kpi.parties)} sub="served in the period" />
      </div>

      {preset.layout === "overview" ? (
        <Overview
          rows={rows} from={from} to={to} fys={pickedFys} sections={preset.sections ?? ["type", "salesType"]}
          sel={sel} toggle={toggle} noteFor={pickedNote} fmtQ={fmtQ} options={options} setFilter={setFilter}
          loading={loading} empty={empty} emptyMessage={emptyMsg}
        />
      ) : (
      <div className="grid gap-3 lg:grid-cols-2">
        <SliceChart
          title={`${metricWord} by ${primaryTitle}`} icon={ShoppingCart} color={SERIES_1}
          slices={byPrimary} total={total} fmt={fmtMeasure} selected={sel[preset.primary]}
          onPick={toggle(preset.primary)} what={primaryTitle} note={pickedNote(preset.primary, primaryTitle.toLowerCase())}
          loading={loading} empty={empty} emptyMessage={emptyMsg}
        />
        <SliceChart
          title={`${metricWord} by Category`} icon={Layers} color={SERIES_2}
          slices={byCategory} total={total} fmt={fmtMeasure} selected={sel.category}
          onPick={toggle("category")} what="Category" note={pickedNote("category", "category")}
          loading={loading} empty={empty} emptyMessage={emptyMsg}
        />
      </div>
      )}

      {/* The overview layout carries its own report; every other dashboard gets the same one here. */}
      {preset.layout === "slices" && (
        <SalesReportTable rows={rows} from={from} to={to} loading={loading} fmtQ={fmtQ}
                          sel={sel} options={options} setFilter={setFilter} />
      )}
    </div>
  );
}

/* ==================================================================== overview layout */

interface Pair { name: string; qty: number; value: number; lines: number }

function pairBy(rows: Row[], get: (r: Row) => string): Pair[] {
  const m = new Map<string, Pair>();
  for (const r of rows) {
    const k = get(r);
    const p = m.get(k) ?? { name: k, qty: 0, value: 0, lines: 0 };
    p.qty += r.quantity;
    p.value += r.revenue;
    p.lines += 1;
    m.set(k, p);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/** Every month of the window in order, empty months included, so the axis never skips one. */
function monthPairs(rows: Row[], from: string, to: string, fys: string[]): Pair[] {
  const out: Pair[] = [];
  const idx = new Map<string, Pair>();
  let y = Number(from.slice(0, 4)), m = Number(from.slice(4, 6));
  const endKey = Number(to.slice(0, 6));
  while (y * 100 + m <= endKey) {
    const key = `${y}${String(m).padStart(2, "0")}`;
    // A year left un-ticked between two picked ones gets no months on the axis.
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
    p.value += r.revenue;
    p.lines += 1;
  }
  return out;
}

/**
 * The Sales page: Quantity and Revenue side by side for Type, Sales-Type and Month, then the full
 * report. Never both measures on one plot — they have different units, and a second y-axis is how
 * a chart lies; two panels with the SAME bar order read across just as easily.
 */
/** How each Mix section is titled and coloured. The filter key is the section's own name. */
const SECTION_META: Record<SectionDim, { heading: string; subtitle: string; colorOf: (name: string) => string }> = {
  type: { heading: "By Type", subtitle: "by transaction type", colorOf: (n) => typeColor(n) },
  salesType: { heading: "By Sales-Type", subtitle: "by sales-type", colorOf: (n) => salesTypeColor(n) },
  // Many values, no fixed identity per value — one hue; the name and the bar carry the reading.
  category: { heading: "By Category", subtitle: "by category", colorOf: () => CAT[0] },
  group: { heading: "By Group", subtitle: "by group", colorOf: () => CAT[2] },
  inkType: { heading: "By Ink Type", subtitle: "by ink type", colorOf: () => CAT[6] },
  // The ink's own colour, so CYAN reads cyan. (A pale swatch still has its name beside it.)
  colour: { heading: "By Colour", subtitle: "by colour", colorOf: (n) => INK_SWATCH[n] ?? OTHER_COLOR },
};

function Overview({ rows, from, to, fys, sections, sel, toggle, noteFor, fmtQ, options, setFilter, loading, empty, emptyMessage }: {
  noteFor: (k: FilterKey, what: string) => string;
  rows: Row[]; from: string; to: string; fys: string[]; sections: SectionDim[]; sel: Record<FilterKey, string[]>;
  fmtQ: QtyFmt; options: Record<FilterKey, MultiSelectOption[]>; setFilter: (k: FilterKey) => (v: string[]) => void;
  toggle: (k: FilterKey) => (name: string) => void;
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
      {bySection.map(({ dim, data }) => {
        const meta = SECTION_META[dim];
        return (
          <div key={dim} className="space-y-3">
            <SectionHeading>{meta.heading}</SectionHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <MixPanel title="Quantity Mix" subtitle={meta.subtitle} data={data} measure="qty" note={noteFor(dim, meta.subtitle.replace("by ", ""))}
                        colorOf={meta.colorOf} selected={sel[dim]} onPick={toggle(dim)} {...common} />
              <MixPanel title="Revenue Mix" subtitle={meta.subtitle} data={data} measure="value" note={noteFor(dim, meta.subtitle.replace("by ", ""))}
                        colorOf={meta.colorOf} selected={sel[dim]} onPick={toggle(dim)} {...common} />
            </div>
          </div>
        );
      })}

      <SectionHeading>By Month</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-2">
        <ColumnChart title="Revenue by Month" icon={IndianRupee} data={byMonth} measure="value" color={SERIES_1}
                     selected={sel.month} onPick={toggle("month")} note={noteFor("month", "month")} {...common} />
        <ColumnChart title="Quantity by Month" icon={Boxes} data={byMonth} measure="qty" color={SERIES_2}
                     selected={sel.month} onPick={toggle("month")} note={noteFor("month", "month")} {...common} />
      </div>

      <SectionHeading>Sales Report</SectionHeading>
      <SalesReportTable rows={rows} from={from} to={to} loading={loading} fmtQ={fmtQ}
                        sel={sel} options={options} setFilter={setFilter} />
    </>
  );
}

/**
 * Colours follow the ENTITY, never its rank (dataviz rule) — so "Credit Note" is violet on every
 * dashboard and under every filter. Hues are the validated categorical palette, in its slot order.
 */
const CAT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER_COLOR = "#898781";
const TYPE_COLORS: Record<string, string> = {
  "SALE": CAT[0], "FOC SALE": CAT[2], "Sales Return": CAT[7], "SOA": CAT[1], "Credit Note": CAT[6],
  "Debit Note": CAT[5], "BRANCH SALE": CAT[3], "RELATED SALE": CAT[4], "Branch FOC": CAT[3],
  "Related FOC": CAT[4], "Related Return": CAT[7], Discount: CAT[3],
};
const SALES_TYPE_COLORS: Record<string, string> = {
  "Ink": CAT[0], "Spare Parts": CAT[1], "Heads": CAT[2], "Machine": CAT[3], "Paper": CAT[4],
  "Service & Other Income": CAT[5], "Provision Ink": CAT[6], "Other Ink": CAT[7],
};
/** The ink colour itself, for the Colour mix — same swatches as the Production Dashboard. */
const INK_SWATCH: Record<string, string> = {
  BLACK: "#1f1f1f", CYAN: "#00a6d6", MAGENTA: "#d6007e", YELLOW: "#f5c400", GREY: "#8a8f98",
  PINK: "#f48fb1", RED: "#d62828", ORANGE: "#f28c28", GREEN: "#2e9e44", BLUE: "#1f5fd6",
  VIOLET: "#7e3fd1", PURPLE: "#7e3fd1", BROWN: "#7b4a2a", WHITE: "#d9d9d9", TURQUOISE: "#1fb5b0",
};
const typeColor = (name: string) => TYPE_COLORS[name] ?? OTHER_COLOR;
const salesTypeColor = (name: string) => SALES_TYPE_COLORS[name] ?? OTHER_COLOR;

/**
 * "Mix" card — one row per value: colour dot · name · a bar · amount · share. The share is of the
 * POSITIVE total, so a credit note reads as "−14% of gross" instead of pushing sales past 100%;
 * a negative row draws its bar hatched-light and its amount in red. Rows are sorted largest first
 * and click to filter, like every other chart on the page.
 */
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
          {/* A long list (every spare-parts category) scrolls inside the card, largest first. */}
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
                    title={`${p.name}\nRevenue ${fmtSales(p.value)} · Quantity ${fmtQ(p.qty)} · ${fmtInt(p.lines)} lines\nClick to filter`}
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
                          background: v < 0
                            ? `repeating-linear-gradient(45deg, ${color} 0 3px, ${color}55 3px 6px)`
                            : color,
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

/** A vertical, single-measure bar chart. Bars keep the order they are given. */
function ColumnChart({ title, icon, data, measure, color, selected, onPick, note, fmtQ, loading, empty, emptyMessage }: {
  title: string; icon: typeof Layers; data: Pair[]; measure: "qty" | "value"; color: string; note: string;
  selected: string[]; onPick: (name: string) => void; fmtQ: QtyFmt; loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const fmt = measure === "value" ? fmtSales : fmtQ;
  const total = data.reduce((s, p) => s + p[measure], 0);
  const many = data.length > 8;
  void icon;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
        <span className="truncate text-[12px] text-muted-foreground">
          {note}
        </span>
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
      <div className="tabular-nums text-foreground">Revenue {fmtSales(p.value)}</div>
      <div className="tabular-nums text-foreground">Quantity {fmtQ(p.qty)}</div>
      <div className="text-muted-foreground">{fmtInt(p.lines)} lines</div>
    </div>
  );
}

const REPORT_EXTRA: ExtraColumn<Row>[] = [
  { header: "SALES-TYPE", width: 16, get: (r) => r.sales_type },
  { header: "INK TYPE", width: 22, get: (r) => r.ink_type },
  { header: "GROUP", width: 22, get: (r) => r.item_group },
  { header: "CATEGORY", width: 22, get: (r) => r.item_category },
  { header: "COLOUR", width: 12, get: (r) => r.colour },
];
const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** The report's own filters — columns the dashboard's filter bar does not carry. */
const TABLE_ONLY = {
  date: (r: Row) => r.date_display,
  voucherNo: (r: Row) => r.voucher_no,
  particulars: (r: Row) => r.particulars,
} as const;
type TableOnlyKey = keyof typeof TABLE_ONLY;
const TABLE_ONLY_KEYS = Object.keys(TABLE_ONLY) as TableOnlyKey[];
const NO_TABLE_FILTERS: Record<TableOnlyKey, string[]> = { date: [], voucherNo: [], particulars: [] };
const dateSortKey = (d: string) => d.split("-").reverse().join("");

/**
 * The report's columns and the filter under each. A column the dashboard also filters (Type,
 * Company, Customer Name, Sales-Type, Category…) uses the DASHBOARD's selection, so picking there
 * narrows every card and chart too, and the filter bar shows it. Date, Voucher No. and Particulars
 * are the report's own — they narrow only the table.
 */
const REPORT_COLUMNS: { header: string; filter: { dash: FilterKey } | { table: TableOnlyKey } | null; right?: boolean }[] = [
  { header: "Date", filter: { table: "date" } },
  { header: "Voucher No.", filter: { table: "voucherNo" } },
  { header: "Type", filter: { dash: "type" } },
  { header: "Company", filter: { dash: "company" } },
  { header: "Location", filter: { dash: "location" } },
  { header: "Customer Name", filter: { dash: "party" } },
  { header: "Particulars", filter: { table: "particulars" } },
  { header: "Sales-Type", filter: { dash: "salesType" } },
  { header: "Category", filter: { dash: "category" } },
  { header: "Group", filter: { dash: "group" } },
  { header: "Ink Type", filter: { dash: "inkType" } },
  { header: "Colour", filter: { dash: "colour" } },
  { header: "Quantity", filter: null, right: true },
  { header: "Rate", filter: null, right: true },
  { header: "Revenue", filter: null, right: true },
];

/** The full sales report: every line the filters leave, filterable per column, searchable, paged, exportable. */
function SalesReportTable({ rows, from, to, loading, fmtQ, sel, options, setFilter }: {
  rows: Row[]; from: string; to: string; loading: boolean; fmtQ: QtyFmt;
  sel: Record<FilterKey, string[]>; options: Record<FilterKey, MultiSelectOption[]>;
  setFilter: (k: FilterKey) => (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [tsel, setTsel] = useState<Record<TableOnlyKey, string[]>>(NO_TABLE_FILTERS);
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      r.party.toLowerCase().includes(s) || r.particulars.toLowerCase().includes(s) || r.voucher_no.toLowerCase().includes(s));
  }, [rows, q]);
  const shown = useMemo(
    () => searched.filter((r) => TABLE_ONLY_KEYS.every((k) => !tsel[k].length || tsel[k].includes(TABLE_ONLY[k](r)))),
    [searched, tsel],
  );
  /** Table-only options, each from the rows surviving the OTHER table filters. */
  const tableOptions = useMemo(() => Object.fromEntries(TABLE_ONLY_KEYS.map((k) => {
    const vals = new Set<string>();
    for (const r of searched) {
      if (TABLE_ONLY_KEYS.every((o) => o === k || !tsel[o].length || tsel[o].includes(TABLE_ONLY[o](r)))) vals.add(TABLE_ONLY[k](r));
    }
    const list = [...vals];
    list.sort(k === "date" ? (a, b) => dateSortKey(a).localeCompare(dateSortKey(b)) : collator.compare);
    return [k, list.map((v) => ({ value: v, label: v }))];
  })) as Record<TableOnlyKey, MultiSelectOption[]>, [searched, tsel]);

  const page = usePagination(shown, { resetKey: `${rows.length}|${q}|${TABLE_ONLY_KEYS.map((k) => tsel[k].join(",")).join("|")}` });
  const totals = useMemo(() => shown.reduce((t, r) => ({ qty: t.qty + r.quantity, value: t.value + r.revenue }), { qty: 0, value: 0 }), [shown]);
  const tableFilterCount = TABLE_ONLY_KEYS.reduce((n, k) => n + tsel[k].length, 0);

  return (
    <SalesPanel title="Full sales report" icon={Table2} loading={loading}
                subtitle={`${fmtInt(shown.length)} lines · quantity ${fmtQ(totals.qty)} · revenue ${fmtSales(totals.value)}`}
                actions={
                  <div className="flex items-center gap-2">
                    {tableFilterCount > 0 && (
                      <button type="button" onClick={() => setTsel(NO_TABLE_FILTERS)}
                              className="text-[11px] text-primary hover:underline">
                        Clear table filters ({tableFilterCount})
                      </button>
                    )}
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, particulars, voucher…"
                             className="h-8 w-56 rounded-input pl-7 text-[12px]" />
                    </div>
                    <Button onClick={() => shown.length && exportSalesRegisterXlsx(shown, { from, to, extra: REPORT_EXTRA, filePrefix: "Bushra_Sales_Report" })}
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
              {REPORT_COLUMNS.map((c) => (
                <th key={c.header} className={cn(
                  "whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                  c.right ? "text-right" : "text-left",
                )}>{c.header}</th>
              ))}
            </tr>
            {/* Filter row — an "Any" dropdown under each heading. */}
            <tr className="border-b-2 border-border bg-muted/30">
              {REPORT_COLUMNS.map((c) => (
                <th key={c.header} className="px-2 py-1.5 font-normal">
                  {c.filter && ("dash" in c.filter ? (
                    <MultiSelectFilter
                      options={options[c.filter.dash]}
                      value={sel[c.filter.dash]}
                      onChange={setFilter(c.filter.dash)}
                      allLabel="Any"
                      unit={c.header}
                      searchable
                      contentClassName="w-72"
                      triggerClassName="w-full min-w-[110px] h-8 text-xs rounded-input border-border bg-surface"
                    />
                  ) : (
                    <MultiSelectFilter
                      options={tableOptions[c.filter.table]}
                      value={tsel[c.filter.table]}
                      onChange={(v) => setTsel((s) => ({ ...s, [(c.filter as { table: TableOnlyKey }).table]: v }))}
                      allLabel="Any"
                      unit={c.header}
                      searchable
                      contentClassName="w-72"
                      triggerClassName="w-full min-w-[110px] h-8 text-xs rounded-input border-border bg-surface"
                    />
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.length === 0 ? (
              <tr><td colSpan={REPORT_COLUMNS.length} className="py-8 text-center text-[12px] text-muted-foreground">No lines match.</td></tr>
            ) : page.pageItems.map((r, i) => (
              <tr key={`${r.tenant_id}-${r.voucher_no}-${r.line_no}-${i}`} className="border-b border-border/40 text-[12.5px] hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{r.date_display}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.voucher_no}</td>
                {/* The derived type, so a discount line reads "Discount" here too. */}
                <td className="whitespace-nowrap px-3 py-1.5">{FILTERS.type.get(r)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.company}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.location_name}</td>
                <td className="px-3 py-1.5">{r.party}</td>
                <td className="px-3 py-1.5">{r.particulars}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.sales_type}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.item_category}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.item_group}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.ink_type}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.colour}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.quantity ? nf2.format(r.quantity) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.rate ? nf2.format(r.rate) : "—"}</td>
                <td className={cn("whitespace-nowrap px-3 py-1.5 text-right tabular-nums", r.revenue < 0 && "text-destructive")}>{nf2.format(r.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <Pagination state={page} rowsLabel="lines" />
    </SalesPanel>
  );
}

/** One horizontal, single-series bar chart. Tall lists scroll inside the panel. */
function SliceChart({ title, icon, color, slices, total, fmt, selected, onPick, what, note, loading, empty, emptyMessage }: {
  title: string; icon: typeof Layers; color: string; slices: Slice[]; total: number;
  fmt: (n: number) => string; selected: string[]; onPick: (name: string) => void; what: string; note: string;
  loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const barH = slices.length > 10 ? 30 : 44;
  return (
    <SalesPanel
      title={title} icon={icon} loading={loading} empty={empty} emptyMessage={emptyMessage}
      subtitle={note}
      bodyClassName="max-h-[560px] overflow-y-auto"
    >
      <ResponsiveContainer width="100%" height={Math.max(260, slices.length * barH + 40)}>
        <BarChart data={slices} layout="vertical" margin={{ top: 4, right: 130, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmt(v).replace("₹ ", "")} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false}
                 axisLine={{ stroke: CHART_GRID }} width={190} interval={0} />
          <ReferenceLine x={0} stroke="hsl(220 10% 75%)" />
          <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<SliceTooltip total={total} fmt={fmt} />} />
          <Bar dataKey="value" maxBarSize={barH > 30 ? 28 : 20} radius={4} className="cursor-pointer"
               onClick={(d: { name?: string }, _i: number, e?: { stopPropagation?: () => void }) => {
                 e?.stopPropagation?.();
                 if (d?.name) onPick(d.name);
               }}>
            {slices.map((s) => <Cell key={s.name} fill={color} fillOpacity={dim(selected, s.name)} />)}
            <LabelList dataKey="value" position="right"
                       formatter={(v: number) => `${fmt(v)}  ${pct(v, total)}`}
                       style={{ fontSize: 10.5, fill: LABEL_FILL, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </SalesPanel>
  );
}

function SliceTooltip({ active, payload, total, fmt }: {
  active?: boolean; payload?: { payload: Slice }[]; total: number; fmt: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{s.name}</div>
      <div className="tabular-nums text-foreground">{fmt(s.value)} <span className="text-muted-foreground">· {pct(s.value, total)} of total</span></div>
      <div className="text-muted-foreground">{fmtInt(s.lines)} lines</div>
    </div>
  );
}

/** KPI tile — the same chrome as the Production Dashboard's, so the Bushra dashboards read alike. */
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
