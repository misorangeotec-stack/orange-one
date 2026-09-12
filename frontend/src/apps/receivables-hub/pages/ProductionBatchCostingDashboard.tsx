/**
 * Bushra-Dashboard → Production Batch Costing Dashboard.
 *
 * The Batch Costing register (pages/BatchCosting.tsx) read as a dashboard: what the factory
 * produced, what it cost per KG, what it consumed, and where the scrap went. Every figure is
 * folded from the register's own rows (lib/batchCosting.ts → lib/batchCostingDashboard.ts), so the
 * two screens can never disagree.
 *
 * ALL YEARS AT ONCE. Production lives in two Tally books (the live one and the pre-split one), and
 * this screen loads both, so "All Years" really is every batch since 2-Jun-2025 and the monthly
 * chart runs straight across the year boundary. The Year filter narrows what is already loaded.
 *
 * LAYOUT (the shape the business asked for):
 *   filter bar      Year · Month · Colour · Category · Sub-group · Particular · Batch no. + Reset
 *   KPI row         Total output · Batches · Total scrap · Final scrap · Avg cost/KG · Avg yield
 *   OUTPUT ANALYSIS year-wise output | monthly output | output by product category
 *   COST & SCRAP    avg cost per KG by month | scrap produced vs consumed by month
 *   BREAKDOWNS      by sub-group | top raw materials | by colour | every batch
 *
 * CHART RULES (dataviz skill): one y-axis per chart — KGS and ₹/KG are never on one plot, they are
 * two panels; a category's colour follows the CATEGORY, not its rank, so filtering never repaints
 * a survivor; every bar is directly labelled, so no value depends on a hover.
 */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDown, ArrowLeft, ArrowUp, Boxes, CalendarRange, ChevronRight, Factory, FlaskConical, IndianRupee,
  Layers, Palette, Percent, Receipt, Recycle, RotateCcw, Scale, Table2, TrendingUp, Wallet, X,
} from "lucide-react";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { Sheet, SheetContent } from "@hub/components/ui/sheet";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { fmtSales, salesFyOptions } from "@hub/lib/salesReport";
import { tallyDate } from "@hub/lib/stockSummary";
import {
  PRODUCTION_COMPANY_LABEL, fmtMoney, fmtRegisterQty, fmtTonnes, fmtTonnes3, loadBatchCostingYears,
  loadLatestProductionDate, productionFyOptions, type BatchCostingRow,
} from "@hub/lib/batchCosting";
import type { ItemGroup } from "@hub/lib/batchCostingRules";
import {
  GROUPS, GROUP_COLOR, SERIES_1, SERIES_2, byFy, byMonth, fmtInt, fmtKgs, fmtPct, fmtPerKg, kpis,
  monthLabel, monthsSpanning, sliceBy, summariseBatches, tickTonnes, topRawMaterials,
  type BatchSummary, type MonthPoint,
} from "@hub/lib/batchCostingDashboard";
import {
  EXPENSE_BLOCKS, costPerKg, expenseTotals, loadProductionExpenses, type ExpenseBlock,
} from "@hub/lib/productionExpenses";
import { loadPackingMaterial, packingFor, packingTotals } from "@hub/lib/packingMaterial";

const BASE = "/outstanding-dashboard";
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const TOOLTIP_BOX = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-md";

/** A bar not in the current pick fades back rather than disappearing — it stays there to click. */
const dim = (selected: string[], name: string) => (!selected.length || selected.includes(name) ? 1 : 0.3);
/** The one-line note under a clickable panel's title. */
const pickedNote = (selected: string[], what: string, fromBar: boolean) =>
  selected.length
    ? fromBar
      ? `filtered to ${selected.join(", ")} - click it again, or any blank space, to clear`
      : `filtered to ${selected.join(", ")} - picked in the filter bar, so Reset All clears it`
    : `click a bar to filter every panel by that ${what}`;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const opts = (vals: Iterable<string>): MultiSelectOption[] =>
  [...new Set(vals)].filter(Boolean).sort(collator.compare).map((v) => ({ value: v, label: v }));
/** Every bar is labelled in tonnes — "594.48 T" — the unit the factory talks in. */
const tLabel = (n: number) => fmtTonnes(n);

/** One accent per KPI tile — identity, not rank, so a tile keeps its colour whatever the filters. */
const KPI_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#a16207", "#7c3aed", "#0d9488"];
/** Year bars: the FY is the entity, so the colour follows the year, oldest first. */
const FY_COLORS = ["#7c3aed", "#2563eb", "#0d9488", "#ea580c"];

/** The ink colour itself, for the swatch beside a colour's NAME (a yellow label would vanish). */
const INK_SWATCH: Record<string, string> = {
  BLACK: "#1f1f1f", CYAN: "#00a6d6", MAGENTA: "#d6007e", YELLOW: "#f5c400", GREY: "#8a8f98",
  PINK: "#f48fb1", RED: "#d62828", ORANGE: "#f28c28", GREEN: "#2e9e44", BLUE: "#1f5fd6",
  VIOLET: "#7e3fd1", PURPLE: "#7e3fd1", BROWN: "#7b4a2a", WHITE: "#ffffff",
};

/** Filter keys — a blank value gets a readable name so it can be picked like any other. */
const yearOf = (b: BatchSummary) => `FY ${b.fy}`;
const monthOf = (b: BatchSummary) => monthLabel(b.month);
const colourOf = (b: BatchSummary) => b.colour || "(No colour)";
const catOf = (b: BatchSummary) => (b.item_group ?? "Others") as string;
const subOf = (b: BatchSummary) => b.item_category || "(None)";
const partOf = (b: BatchSummary) => b.fg_item || "(No finished good)";
const batchOf = (b: BatchSummary) => b.voucher_no || "(No number)";

type SortKey = "vch_date" | "voucher_no" | "fg_item" | "item_category" | "colour" | "fg_kgs" |
  "cost_per_kg" | "rm_value" | "scrap_out" | "scrap_in";

export default function ProductionBatchCostingDashboard() {
  const [params, setParams] = useSearchParams();
  const fyOptions = useMemo(() => productionFyOptions(salesFyOptions()), []);

  // EVERY production year in one load. One company books production, so there is no company
  // picker; the Year filter narrows what was loaded rather than refetching.
  const { data, isLoading, isFetching, error } = useQuery<BatchCostingRow[]>({
    queryKey: ["batchCostingAllYears", fyOptions.join(",")],
    queryFn: () => loadBatchCostingYears(fyOptions),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const rows = useMemo(() => data ?? [], [data]);
  const { data: latest } = useQuery({
    queryKey: ["batchCostingLatest", fyOptions[0]],
    queryFn: () => loadLatestProductionDate(fyOptions[0]),
    staleTime: 5 * 60 * 1000,
  });
  // The P&L side: Direct & Indirect Expenses of this company (lib/productionExpenses.ts).
  const { data: expenseRows, isLoading: expLoading } = useQuery({
    queryKey: ["productionExpenses", fyOptions.join(",")],
    queryFn: () => loadProductionExpenses(fyOptions),
    staleTime: 5 * 60 * 1000,
  });
  // The packing side: caps, cans and stickers, which never touch a production voucher.
  const { data: packingRows, isLoading: packLoading } = useQuery({
    queryKey: ["packingMaterial", fyOptions.join(",")],
    queryFn: () => loadPackingMaterial(fyOptions),
    staleTime: 5 * 60 * 1000,
  });
  const allBatches = useMemo(() => summariseBatches(rows), [rows]);
  /** Voucher key -> its register lines, for the batch panel that slides over this page. */
  const linesByBatch = useMemo(() => {
    const m = new Map<string, BatchCostingRow[]>();
    for (const r of rows) {
      const key = `${r.company_guid}|${r.voucher_guid}`;
      const at = m.get(key);
      if (at) at.push(r);
      else m.set(key, [r]);
    }
    for (const v of m.values()) v.sort((a, b) => a.line_no - b.line_no);
    return m;
  }, [rows]);
  const [openBatch, setOpenBatch] = useState<BatchSummary | null>(null);
  /**
   * THE DETAIL SECTIONS ARE FOLDED AWAY. Output, colour, cost and the batch list are what the page
   * is for and stay open; where the money went and which raw material it went on are a question the
   * reader asks now and then, so they wait behind a heading until clicked.
   */
  const [showExpenses, setShowExpenses] = useState(false);
  const [showBreakdowns, setShowBreakdowns] = useState(false);

  /* -------- filters: one bar, everything below it obeys -------- */
  const [years, setYears] = useState<string[]>(() => {
    const y = params.get("fy");
    return y ? [`FY ${y}`] : [];
  });
  const [months, setMonths] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [subs, setSubs] = useState<string[]>([]);
  const [parts, setParts] = useState<string[]>([]);
  const [batchNos, setBatchNos] = useState<string[]>([]);

  /**
   * A FILTER PICKED FROM A BAR AND ONE PICKED FROM THE BAR AT THE TOP ARE NOT THE SAME THING.
   *
   * Clicking a bar is a glance — a blank click puts it back. Choosing from a dropdown is a
   * deliberate act, and wiping it because the reader clicked an empty patch of the page would be
   * infuriating. So this remembers which dimensions were set by clicking, and only those are
   * dropped on a blank click; the dropdowns go when Reset All says so.
   */
  type Dim = "year" | "month" | "colour" | "cat" | "sub";
  const [barPicked, setBarPicked] = useState<Dim[]>([]);
  const SETTERS: Record<Dim, (v: string[]) => void> = {
    year: setYears, month: setMonths, colour: setColours, cat: setCats, sub: setSubs,
  };
  /** Toggle one value from a bar: pick it, or let it go if it was already the picked one. */
  const fromBar = (dim: Dim, current: string[]) => (name: string) => {
    const on = !current.includes(name);
    SETTERS[dim](on ? [name] : []);
    setBarPicked((p) => (on ? (p.includes(dim) ? p : [...p, dim]) : p.filter((d) => d !== dim)));
  };
  /** A dropdown choice is the reader's own; it stops being a bar pick. */
  const fromDropdown = (dim: Dim) => (v: string[]) => {
    SETTERS[dim](v);
    setBarPicked((p) => p.filter((d) => d !== dim));
  };

  const pick = (sel: string[], v: string) => !sel.length || sel.includes(v);
  // Each control's options come from the rows still standing after the controls above it, so no
  // combination can be picked that returns nothing.
  const afterYear = useMemo(() => allBatches.filter((b) => pick(years, yearOf(b))), [allBatches, years]);
  const afterMonth = useMemo(() => afterYear.filter((b) => pick(months, monthOf(b))), [afterYear, months]);
  const afterColour = useMemo(() => afterMonth.filter((b) => pick(colours, colourOf(b))), [afterMonth, colours]);
  const afterCat = useMemo(() => afterColour.filter((b) => pick(cats, catOf(b))), [afterColour, cats]);
  const afterSub = useMemo(() => afterCat.filter((b) => pick(subs, subOf(b))), [afterCat, subs]);
  const afterPart = useMemo(() => afterSub.filter((b) => pick(parts, partOf(b))), [afterSub, parts]);
  const batches = useMemo(() => afterPart.filter((b) => pick(batchNos, batchOf(b))), [afterPart, batchNos]);

  const yearOptions = useMemo(() => opts(allBatches.map(yearOf)), [allBatches]);
  const monthOptions = useMemo(
    () => monthsSpanning(afterYear).map((m) => ({ value: monthLabel(m), label: monthLabel(m) })),
    [afterYear],
  );
  const colourOptions = useMemo(() => opts(afterMonth.map(colourOf)), [afterMonth]);
  const catOptions = useMemo(() => opts(afterColour.map(catOf)), [afterColour]);
  const subOptions = useMemo(() => opts(afterCat.map(subOf)), [afterCat]);
  const partOptions = useMemo(() => opts(afterSub.map(partOf)), [afterSub]);
  const batchOptions = useMemo(() => opts(afterPart.map(batchOf)), [afterPart]);

  const filterCount = years.length + months.length + colours.length + cats.length + subs.length +
    parts.length + batchNos.length;

  /**
   * A CLICK ON BLANK SPACE ANYWHERE DROPS WHAT WAS PICKED FROM A BAR — and nothing else. Anything
   * chosen in the filter bar stays until Reset All; see the note on `barPicked`.
   *
   * Everything you could be USING is exempt, or a click on it would wipe the filters out from under
   * you: the filter bar itself, any button/link/input, the tables, and the batch panel. A bar click
   * never reaches here either — it stops the event so it can set its own filter instead.
   */
  const clearOnBlankClick = (e: React.MouseEvent) => {
    if (!barPicked.length) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest?.("button, a, input, select, textarea, table, [role='dialog'], [data-keep-filters]")) return;
    for (const dim of barPicked) SETTERS[dim]([]);
    setBarPicked([]);
  };
  const resetAll = () => {
    setYears([]); setMonths([]); setColours([]); setCats([]); setSubs([]); setParts([]); setBatchNos([]);
    setBarPicked([]);
    if (params.get("fy")) {
      const n = new URLSearchParams(params);
      n.delete("fy");
      setParams(n, { replace: true });
    }
  };

  /* -------- panels -------- */
  /**
   * A CLICKABLE PANEL IS BUILT WITHOUT ITS OWN FILTER. Click "Reactive" and the category chart must
   * still show Sublimation and Others — faded, but there to click again — while every other panel
   * narrows. So each clickable panel applies every filter EXCEPT its own dimension; the KPI row,
   * the tables and the rest use `batches`, which has them all.
   */
  const without = useMemo(() => (skip: "year" | "month" | "cat" | "sub" | "colour") => allBatches.filter((b) =>
    (skip === "year" || pick(years, yearOf(b))) &&
    (skip === "month" || pick(months, monthOf(b))) &&
    (skip === "cat" || pick(cats, catOf(b))) &&
    (skip === "sub" || pick(subs, subOf(b))) &&
    (skip === "colour" || pick(colours, colourOf(b))) &&
    pick(parts, partOf(b)) && pick(batchNos, batchOf(b))),
    [allBatches, years, months, cats, subs, colours, parts, batchNos]);

  const k = useMemo(() => kpis(batches), [batches]);
  const fyPoints = useMemo(() => byFy(without("year")), [without]);
  const monthBars = useMemo(() => {
    const base = without("month");
    return byMonth(base, monthsSpanning(base));
  }, [without]);
  const monthPoints = useMemo(() => byMonth(batches, monthsSpanning(batches)), [batches]);
  const catSlices = useMemo(() => {
    const sliced = sliceBy(without("cat"), catOf);
    return GROUPS.map((g) => sliced.find((s) => s.name === g) ??
      { name: g as string, batches: 0, kgs: 0, value: 0, costPerKg: null, group: g });
  }, [without]);
  const subSlices = useMemo(() => sliceBy(without("sub"), subOf).filter((s) => s.kgs > 0), [without]);
  const colourSlices = useMemo(() => sliceBy(without("colour"), colourOf).filter((s) => s.kgs > 0), [without]);
  const rm = useMemo(() => topRawMaterials(rows, new Set(batches.map((b) => b.key))), [rows, batches]);

  /**
   * EXPENSES FOLLOW YEAR AND MONTH, NOTHING ELSE. An expense belongs to the company and a date, not
   * to a batch — so the colour/category/sub-group/particular/batch filters cannot narrow it, and the
   * production KGS it is divided by is cut the same way, or the ratio would compare two different
   * slices of the year.
   */
  const batchFilterOn = !!(colours.length || cats.length || subs.length || parts.length || batchNos.length);
  const expenses = useMemo(() => expenseTotals(
    (expenseRows ?? []).filter((e) => pick(years, `FY ${e.fy}`) && pick(months, e.month))),
    [expenseRows, years, months]);
  const periodKgs = useMemo(() => kpis(
    allBatches.filter((b) => pick(years, yearOf(b)) && pick(months, monthOf(b)))), [allBatches, years, months]);
  /**
   * Material follows WHATEVER IS FILTERED — the same figure as the Avg cost / KG card, so the two
   * can never disagree. Overhead cannot: it is the company's rate for the period (expenses ÷ what
   * the company produced in those months), applied on top of whichever product is selected. So
   * picking a sub-group changes the material line and the full cost; the overhead rate holds.
   */
  const perKg = useMemo(() => costPerKg(k.costPerKg, expenses, periodKgs.fgKgs), [k, expenses, periodKgs]);
  /**
   * PACKING DOES FOLLOW THE PRODUCT FILTERS — unlike the expenses above. The voucher that issues a
   * cap also brings the packed goods back in, so the cap is charged to the colour, category and
   * sub-group it actually went on (see lib/packingMaterial.ts), and the rate divides by the output
   * of that same selection. Godown moves are netted off first. Batch no. is the one filter it
   * cannot follow: packing names the item, never the lot, so the rate holds across the batches.
   */
  const packInPeriod = useMemo(
    () => (packingRows ?? []).filter((r) => pick(years, `FY ${r.fy}`) && pick(months, r.month)),
    [packingRows, years, months]);
  const packing = useMemo(() => packingTotals(packInPeriod), [packInPeriod]);
  const productFilterOn = !!(colours.length || cats.length || subs.length || parts.length);
  const packingForSelection = useMemo(() => packingFor(
    packInPeriod,
    productFilterOn
      ? (pk) => pick(colours, pk.colour || "(No colour)") &&
                pick(cats, (pk.group ?? "Others") as string) &&
                pick(subs, pk.category || "(None)") &&
                pick(parts, pk.item || "(No finished good)")
      : undefined),
    [packInPeriod, productFilterOn, colours, cats, subs, parts]);
  /** The output the packing above went on: every filter except batch no. */
  const productKgs = useMemo(() => kpis(allBatches.filter((b) =>
    pick(years, yearOf(b)) && pick(months, monthOf(b)) && pick(colours, colourOf(b)) &&
    pick(cats, catOf(b)) && pick(subs, subOf(b)) && pick(parts, partOf(b)))),
    [allBatches, years, months, colours, cats, subs, parts]);
  const packPerKg = productKgs.fgKgs > 0 ? packingForSelection / productKgs.fgKgs : 0;
  const fullPerKg = perKg.materialPerKg == null
    ? null
    : perKg.materialPerKg + packPerKg + (perKg.directPerKg ?? 0) + (perKg.indirectPerKg ?? 0);

  /**
   * COST BY COLOUR. Each colour carries its own material rate — Tally's, weighted by batch size —
   * and its own packing rate, because the packing voucher names the goods it packed. What it cannot
   * carry of its own is the overhead: Tally ties no expense to a colour, so every colour takes the
   * period's Direct + Indirect over the period's output, and spreading it any other way (by value,
   * by batch count) would be an assumption rather than a figure from the books.
   */
  const overheadPerKg = (perKg.directPerKg ?? 0) + (perKg.indirectPerKg ?? 0);
  /** Packing per KG for ONE colour: what was packed onto it, over what that colour produced. */
  const packingByColour = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of colourSlices) {
      const v = packingFor(packInPeriod, (pk) => (pk.colour || "(No colour)") === c.name);
      m.set(c.name, c.kgs > 0 ? v / c.kgs : 0);
    }
    return m;
  }, [colourSlices, packInPeriod]);
  const colourFull = (name: string, costPerKg: number | null) =>
    costPerKg == null ? null : costPerKg + (packingByColour.get(name) ?? 0) + overheadPerKg;
  const catTotal = catSlices.reduce((s, c) => s + c.kgs, 0);

  const loading = (isLoading || packLoading) && !data;
  const errText = error ? (error as Error).message : null;
  const empty = !loading && !errText && batches.length === 0;
  const emptyMsg = allBatches.length ? "No batches match those filters." : "No production vouchers found.";
  const span = useMemo(() => {
    if (!batches.length) return "";
    const d = batches.map((b) => b.vch_date).sort();
    return `${tallyDate(d[0])} → ${tallyDate(d[d.length - 1])}`;
  }, [batches]);

  return (
    <div
      onClick={clearOnBlankClick}
      className={cn("p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3 transition-opacity", isFetching && data && "opacity-70")}
    >
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={`${BASE}/bushra-dashboard?group=production-batch-costing`}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Production - Batch Costing
          </Link>
          <div className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">Production Dashboard</h1>
            <span className="text-[12px] text-muted-foreground">· {PRODUCTION_COMPANY_LABEL}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {latest && <span>Synced to {tallyDate(latest)}</span>}
          <Link to={`${BASE}/bushra-dashboard/production-expenses`} className="text-primary hover:underline">Expenses</Link>
          <Link to={`${BASE}/reports/batch-costing`} className="text-primary hover:underline">Register</Link>
        </div>
      </div>

      {/* ── Filter bar: one bar, scoping every panel below ────────────────── */}
      <div data-keep-filters className="rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Filter label="Year" options={yearOptions} value={years} onChange={fromDropdown("year")} all="All Years" unit="Years" />
          <Filter label="Month" options={monthOptions} value={months} onChange={fromDropdown("month")} all="All Months" unit="Months" searchable />
          <Filter label="Colour" options={colourOptions} value={colours} onChange={fromDropdown("colour")} all="All Colours" unit="Colours" />
          <Filter label="Category" options={catOptions} value={cats} onChange={fromDropdown("cat")} all="All Categories" unit="Categories" />
          <Filter label="Sub-group" options={subOptions} value={subs} onChange={fromDropdown("sub")} all="All Sub-Groups" unit="Sub-Groups" searchable />
          <Filter label="Particular" options={partOptions} value={parts} onChange={setParts} all="All Particulars" unit="Particulars" searchable />
          <Filter label="Batch no." options={batchOptions} value={batchNos} onChange={setBatchNos} all="All Batches" unit="Batches" searchable />
          <Button
            onClick={resetAll}
            disabled={!filterCount}
            className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {fmtInt(batches.length)} batches{span ? ` · ${span}` : ""}
          </span>
        </div>
      </div>

      {errText && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>
      )}

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi accent={KPI_COLORS[0]} icon={Boxes} label="Total output" loading={loading}
             value={fmtTonnes(k.fgKgs)} exact={fmtKgs(k.fgKgs)} sub="produced" />
        <Kpi accent={KPI_COLORS[1]} icon={Layers} label="Total batches" loading={loading}
             value={fmtInt(k.batches)} exact={`${fmtInt(rows.length)} lines`} sub="production runs" />
        <Kpi accent={KPI_COLORS[2]} icon={Recycle} label="Total scrap" loading={loading}
             value={fmtTonnes(k.scrapOut)} exact={fmtKgs(k.scrapOut)} sub="generated" />
        <Kpi accent={KPI_COLORS[3]} icon={Recycle} label="Final scrap" loading={loading}
             value={fmtTonnes(k.scrapFinal)} exact={fmtKgs(k.scrapFinal)} sub="scrap − consumed scrap" />
        <Kpi accent={KPI_COLORS[4]} icon={Scale} label="Avg cost / KG" loading={loading}
             value={fmtPerKg(k.costPerKg)} exact={fmtSales(k.rmValue)} sub="weighted avg · RM consumed" />
        <Kpi accent={KPI_COLORS[5]} icon={Percent} label="Avg yield" loading={loading}
             value={fmtPct(k.yieldPct)} exact={`${fmtPct(k.scrapRate)} scrap`} sub="output ÷ (output + scrap)" />
      </div>

      {/* ── Output analysis ───────────────────────────────────────────────── */}
      <SectionHeading>Output analysis</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel title="Year-wise output (T)" icon={CalendarRange} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle={pickedNote(years, "year", barPicked.includes("year"))}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={fyPoints} margin={{ top: 22, right: 12, left: -4, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickTonnes} width={52} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<FyTooltip />} />
              <Bar dataKey="kgs" maxBarSize={90} radius={[4, 4, 0, 0]} className="cursor-pointer"
                   onClick={(d: { label?: string }, _i: number, e?: { stopPropagation?: () => void }) => {
                     e?.stopPropagation?.();
                     if (d?.label) fromBar("year", years)(d.label);
                   }}>
                {fyPoints.map((p, i) => (
                  <Cell key={p.fy} fill={FY_COLORS[i % FY_COLORS.length]} fillOpacity={dim(years, p.label)} />
                ))}
                <LabelList dataKey="kgs" position="top" formatter={(v: number) => tLabel(v)}
                           style={{ fontSize: 11, fill: LABEL_FILL, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Monthly output (T)" icon={TrendingUp} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle={months.length ? pickedNote(months, "month", barPicked.includes("month"))
                              : "every month since production began — click a bar to filter"}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthBars} margin={{ top: 22, right: 8, left: -4, bottom: 14 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickTonnes} width={52} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<MonthTooltip />} />
              <Bar dataKey="totalKgs" fill={KPI_COLORS[0]} maxBarSize={26} radius={[4, 4, 0, 0]} className="cursor-pointer"
                   onClick={(d: { label?: string }, _i: number, e?: { stopPropagation?: () => void }) => {
                     e?.stopPropagation?.();
                     if (d?.label) fromBar("month", months)(d.label);
                   }}>
                {monthBars.map((m) => <Cell key={m.month} fill={KPI_COLORS[0]} fillOpacity={dim(months, m.label)} />)}
                <LabelList dataKey="totalKgs" position="top" formatter={(v: number) => (v ? tLabel(v) : "")}
                           style={{ fontSize: 9.5, fill: LABEL_FILL }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Output by product category (T)" icon={Layers} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle={pickedNote(cats, "category", barPicked.includes("cat"))}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={catSlices} margin={{ top: 22, right: 12, left: -4, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickTonnes} width={52} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<CatTooltip total={catTotal} />} />
              <Bar dataKey="kgs" maxBarSize={70} radius={[4, 4, 0, 0]} className="cursor-pointer"
                   onClick={(d: { name?: string }, _i: number, e?: { stopPropagation?: () => void }) => {
                     e?.stopPropagation?.();
                     if (d?.name) fromBar("cat", cats)(d.name);
                   }}>
                {catSlices.map((s) => (
                  <Cell key={s.name} fill={GROUP_COLOR[s.name as ItemGroup] ?? SERIES_1}
                        fillOpacity={dim(cats, s.name)} />
                ))}
                <LabelList
                  dataKey="kgs"
                  position="top"
                  formatter={(v: number) => `${tLabel(v)}${catTotal ? ` (${((v / catTotal) * 100).toFixed(1)}%)` : ""}`}
                  style={{ fontSize: 10, fill: LABEL_FILL, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      {/* ── Expenses & the full cost of a kilogram ────────────────────────── */}
      <Fold title="Expenses & full cost" open={showExpenses} onToggle={() => setShowExpenses((v) => !v)}
            hint="what a kilogram cost, and the direct and indirect expenses behind it">
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel className="lg:col-span-1" title="What a kilogram cost" icon={Scale} loading={expLoading}
                    subtitle={batchFilterOn
                      ? "the selection's material + the company's overhead rate for the period"
                      : "material on the batch + the period's overhead spread over what it produced"}>
          <div className="space-y-2">
            <CostLine label={batchFilterOn ? "Material (this selection)" : "Material (on the batch)"}
                      value={fmtPerKg(perKg.materialPerKg)} accent={SERIES_1}
                      note={batchFilterOn
                        ? "the Avg cost / KG above — Tally's own cost of what these batches consumed"
                        : "Tally's own cost of what each batch consumed"} />
            <CostLine label="+ Packing material" value={fmtPerKg(packPerKg)} accent={KPI_COLORS[5]}
                      note={productFilterOn
                        ? `${fmtSales(packingForSelection)} of caps, cans and stickers packed onto this selection`
                        : `${fmtSales(packing.consumedValue)} of caps, cans and stickers — company-wide`} />
            <CostLine label="+ Direct expenses" value={fmtPerKg(perKg.directPerKg)} accent={KPI_COLORS[3]}
                      note={`${fmtSales(expenses.direct)} over ${fmtTonnes(perKg.kgs)} — company-wide`} />
            <CostLine label="+ Indirect expenses" value={fmtPerKg(perKg.indirectPerKg)} accent={KPI_COLORS[4]}
                      note={`${fmtSales(expenses.indirect)} over ${fmtTonnes(perKg.kgs)} — company-wide`} />
            <div className="flex items-baseline justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-2">
              <span className="text-[12px] font-semibold text-foreground">Full cost per KG</span>
              <span className="text-[19px] font-bold tabular-nums text-foreground">{fmtPerKg(fullPerKg)}</span>
            </div>
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              Absorption, the plainest kind: nothing in Tally ties an expense or a cap to a batch, an
              item or a colour, so the period's packing and overhead are spread evenly over the
              period's output and added to whichever product is selected. Purchase Accounts are left
              out — that is the material, already counted on the batch — and so are warehouse →
              production moves of packing, which come straight back in on the same voucher.
            </p>
          </div>
        </SalesPanel>

        {EXPENSE_BLOCKS.map((block) => {
          const rowsFor = expenses.groups.filter((g) => g.block === block);
          const total = block === "Direct Expenses" ? expenses.direct : expenses.indirect;
          return (
            <SalesPanel
              key={block}
              title={block}
              icon={block === "Direct Expenses" ? Receipt : Wallet}
              loading={expLoading}
              empty={!rowsFor.length}
              emptyMessage="No expense lines in this period."
              subtitle={`${fmtSales(total)} · ${fmtPerKg(block === "Direct Expenses" ? perKg.directPerKg : perKg.indirectPerKg)} / KG · as Tally's P&L groups them`}
            >
              <BarList
                rows={rowsFor.map((g) => ({
                  key: g.group,
                  name: g.group,
                  value: Math.abs(g.amount),
                  color: block === "Direct Expenses" ? KPI_COLORS[3] : KPI_COLORS[4],
                  right: fmtPct(g.share),
                  detail: fmtSales(g.amount),
                  title: `${g.group}\n${fmtSales(g.amount)} · ${g.lines} line${g.lines === 1 ? "" : "s"} · ${fmtPct(g.share)} of ${block.toLowerCase()}`,
                }))}
                rightHeader="Share"
              />
            </SalesPanel>
          );
        })}
      </div>
      {batchFilterOn && (
        <p className="text-[11px] text-muted-foreground">
          <b className="font-semibold text-foreground">The two expense panels do not react to this filter, and cannot.</b>{" "}
          Packing does — a packing voucher names the goods it packed, so a cap is charged to the
          colour and sub-group it went on.{" "}
          An expense is booked against the company and a date, never against a batch — Tally holds no
          link from electricity or salaries to a sub-group — so they stay the company's Direct and
          Indirect expenses for the selected year/month, spread over everything it produced
          ({fmtTonnes(perKg.kgs)}). The material line above does follow the filter, so the full cost
          reads: this product's own material plus the company's overhead rate.
        </p>
      )}
      </Fold>

      {/* ── Breakdowns ────────────────────────────────────────────────────── */}
      <Fold title="Breakdowns" open={showBreakdowns} onToggle={() => setShowBreakdowns((v) => !v)}
            hint="by sub-group, and the raw materials the batches consumed">
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="By sub-group" icon={FlaskConical} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle={subs.length
                      ? `filtered to ${subs.join(", ")} — click it again, or any blank space, to clear`
                      : "click a bar to filter every panel by that sub-group"}
                    bodyClassName="p-3">
          <BarList
            what="sub-group"
            selected={subs}
            onSelect={fromBar("sub", subs)}
            rows={subSlices.map((s) => ({
              key: s.name, name: s.name, value: s.kgs,
              color: GROUP_COLOR[(s.group ?? "Others") as ItemGroup],
              right: fmtPerKg(s.costPerKg), detail: `${fmtTonnes(s.kgs)} · ${s.batches} batch${s.batches === 1 ? "" : "es"}`,
              title: `${s.name}\n${fmtKgs(s.kgs)} · ${s.batches} batches · ${fmtPerKg(s.costPerKg)} / KG`,
            }))}
            rightHeader="₹ / KG"
          />
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {GROUPS.map((g) => (
              <span key={g} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g}
              </span>
            ))}
          </div>
        </SalesPanel>

        <SalesPanel title="Top raw materials by value" icon={IndianRupee} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle="what the batches consumed, ranked by ₹ — the top ten and everything else">
          <BarList
            rows={rm.map((r, i) => ({
              key: r.name, name: r.name, value: r.value,
              color: i === rm.length - 1 && r.name.startsWith("All other") ? "hsl(220 12% 78%)" : SERIES_1,
              right: fmtPct(r.share), detail: fmtSales(r.value),
              title: r.unit ? `${r.name}\n${fmtSales(r.value)} · ${fmtInt(r.qty)} ${r.unit} · in ${r.batches} batches`
                            : `${r.name}\n${fmtSales(r.value)}`,
            }))}
            rightHeader="Share"
          />
        </SalesPanel>
      </div>
      </Fold>

      <BatchSheet
        batch={openBatch}
        lines={openBatch ? linesByBatch.get(openBatch.key) ?? [] : []}
        onClose={() => setOpenBatch(null)}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* The same ten colours, twice over: what each made and what its material cost, then the
            very same list costed at FULL cost — material plus the company's overhead per KG. Two
            panels rather than one with a toggle, so the two figures can be read side by side. */}
        <SalesPanel title="By colour" icon={Palette} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle={pickedNote(colours, "colour", barPicked.includes("colour"))}>
          <BarList
            what="colour"
            selected={colours}
            onSelect={fromBar("colour", colours)}
            rows={colourSlices.map((s) => ({
              key: s.name, name: s.name, value: s.kgs, color: SERIES_1, swatch: INK_SWATCH[s.name],
              right: fmtPerKg(s.costPerKg), detail: `${fmtTonnes(s.kgs)} · ${s.batches} batches`,
              title: `${s.name}\n${fmtKgs(s.kgs)} · ${s.batches} batches · production cost ${fmtPerKg(s.costPerKg)} / KG`,
            }))}
            rightHeader="₹ / KG"
          />
        </SalesPanel>

        <SalesPanel title="By colour — full cost" icon={Scale} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle={`material + the colour's own packing + ${fmtPerKg(overheadPerKg)} per KG of overhead`}>
          <BarList
            what="colour"
            selected={colours}
            onSelect={fromBar("colour", colours)}
            rows={colourSlices.map((s) => ({
              key: s.name, name: s.name, value: s.kgs, color: KPI_COLORS[0], swatch: INK_SWATCH[s.name],
              right: fmtPerKg(colourFull(s.name, s.costPerKg)),
              detail: `${fmtTonnes(s.kgs)} · ${s.batches} batches`,
              title: `${s.name}\nproduction ${fmtPerKg(s.costPerKg)} + packing ${fmtPerKg(packingByColour.get(s.name) ?? 0)} + overhead ${fmtPerKg(overheadPerKg)} = full ${fmtPerKg(colourFull(s.name, s.costPerKg))} / KG`,
            }))}
            rightHeader="Full ₹ / KG"
          />
        </SalesPanel>
      </div>

      {/* ── Cost & scrap ──────────────────────────────────────────────────── */}
      <SectionHeading>Cost &amp; scrap</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="Average cost per KG by month" icon={Scale} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle="value-weighted ₹ / KG — narrow to one sub-group or particular to follow a single product">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthPoints} margin={{ top: 16, right: 16, left: -4, bottom: 14 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} domain={["auto", "auto"]}
                     tickFormatter={(v: number) => `₹${Math.round(v)}`} />
              <Tooltip content={<CostTooltip />} />
              <Line type="monotone" dataKey="costPerKg" name="₹ / KG" stroke={SERIES_1} strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round" connectNulls
                    dot={{ r: 3.5, fill: SERIES_1, stroke: "#fff", strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: SERIES_1, stroke: "#fff", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Scrap by month" icon={Recycle} loading={loading} empty={empty} emptyMessage={emptyMsg}
                    subtitle="produced on the output side vs re-used on the consumption side">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthPoints} margin={{ top: 10, right: 8, left: -4, bottom: 14 }} barGap={2}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false}
                     axisLine={{ stroke: CHART_GRID }} interval={0} angle={-40} textAnchor="end" height={44} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickTonnes} width={52} />
              <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<ScrapTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="scrapOut" name="Scrap produced" fill={KPI_COLORS[2]} maxBarSize={16} radius={[4, 4, 0, 0]} />
              <Bar dataKey="scrapIn" name="Scrap consumed" fill={SERIES_2} maxBarSize={16} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      <div className="grid gap-3">
        <SalesPanel title="Batches" icon={Table2} loading={loading} empty={empty}
                    emptyMessage={emptyMsg} bodyClassName="p-0"
                    subtitle="every batch in the selection — click a batch no. to see what it produced and consumed">
          <BatchTable batches={batches} onOpen={setOpenBatch} />
        </SalesPanel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/**
 * A HEADING THAT OPENS A SECTION. It reads like the plain headings around it until the reader
 * notices the arrow — closed, it costs one line; open, the whole section is below it. It is a real
 * button, so a click on it never reaches the blank-click handler that drops the bar filters.
 */
function Fold({ title, hint, open, onToggle, children }: {
  title: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <button type="button" onClick={onToggle} aria-expanded={open}
              className="group flex w-full items-center gap-2 pt-1 text-left">
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                    open && "rotate-90")} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground group-hover:text-foreground">
          {title}
        </h2>
        <span className="truncate text-[11px] text-muted-foreground/80">{open ? "click to hide" : hint}</span>
        <div className="h-px flex-1 bg-border" />
      </button>
      {open && children}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Label + dropdown, laid out inline so seven of them fit on one bar. */
function Filter({ label, options, value, onChange, all, unit, searchable }: {
  label: string; options: MultiSelectOption[]; value: string[]; onChange: (v: string[]) => void;
  all: string; unit: string; searchable?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{label}</span>
      <MultiSelectFilter
        options={options} value={value} onChange={onChange} allLabel={all} unit={unit} searchable={searchable}
        triggerClassName="h-8 min-w-[130px] text-[12.5px] rounded-input border-border"
      />
    </div>
  );
}

/**
 * KPI tile: a coloured icon + label, the headline (tonnes on a weight tile), the exact quantity, a
 * one-line note, and a rule in the tile's own colour. No background flourish — a tinted disc behind
 * the text is decoration competing with the number, and it read as a solid blob. Tight chrome, so
 * six tiles sit in one row.
 */
function Kpi({ accent, icon: Icon, label, value, exact, sub, loading }: {
  accent: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string; value: string; exact?: string; sub?: string; loading?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2 shadow-sm"
         title={exact ? `${value} · ${exact}` : value}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="mt-1 h-5 w-2/3 animate-pulse rounded bg-muted/60" />
      ) : (
        <div className="text-[19px] font-bold leading-tight text-foreground truncate">{value}</div>
      )}
      {exact && <div className="text-[11px] font-medium leading-snug tabular-nums text-foreground/70 truncate">{exact}</div>}
      {sub && <div className="text-[10px] leading-snug text-muted-foreground truncate">{sub}</div>}
      <div className="mt-1.5 h-[3px] w-full rounded-full" style={{ background: `${accent}33` }}>
        <div className="h-full w-1/3 rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}

interface BarRow {
  key: string; name: string; value: number; color: string; right: string; detail: string;
  title: string; swatch?: string;
}

/**
 * A ranked horizontal bar list — the chart and its table in one; every value readable without hover.
 *
 * With `onSelect` it also filters: clicking a bar picks it (and clicking it again lets it go), the
 * rows not picked fade back, and a click anywhere else in the panel clears the selection.
 */
function BarList({ rows, rightHeader, selected, onSelect, what = "value" }: {
  rows: BarRow[]; rightHeader: string; selected?: string[]; onSelect?: (name: string) => void;
  /** What one bar stands for, for the hover hint: "colour", "sub-group". */
  what?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const picking = !!onSelect;
  const isOn = (name: string) => !selected?.length || selected.includes(name);
  return (
    <div className="text-[12px]">
      <div className="mb-1 flex justify-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{rightHeader}</div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.key}
            title={picking ? `${r.title}

Click to filter every panel by this ${what}` : r.title}
            onClick={picking ? (e) => { e.stopPropagation(); onSelect!(r.name); } : undefined}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3 rounded px-1 py-0.5 hover:bg-muted/40",
              picking && "cursor-pointer",
              picking && !isOn(r.name) && "opacity-45",
              picking && selected?.includes(r.name) && "bg-primary/5 ring-1 ring-primary/30",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground">
                  {r.swatch && <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border" style={{ background: r.swatch }} />}
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{r.detail}</span>
              </div>
              <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted/50">
                <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
              </div>
            </div>
            <span className="text-right font-medium text-foreground tabular-nums">{r.right}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ tooltips */

interface MonthTip { active?: boolean; payload?: Array<{ payload: MonthPoint }> }

function MonthTooltip({ active, payload }: MonthTip) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <div className="text-foreground">{fmtTonnes(m.totalKgs)} <span className="text-muted-foreground">({fmtKgs(m.totalKgs)})</span></div>
      {GROUPS.filter((g) => m[g] > 0).map((g) => (
        <div key={g} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g] }} />{g}
          </span>
          <span className="tabular-nums">{fmtTonnes(m[g])}</span>
        </div>
      ))}
      <div className="text-muted-foreground">{m.batches} batches · {fmtSales(m.value)} · {fmtPerKg(m.costPerKg)}/KG</div>
    </div>
  );
}

function CostTooltip({ active, payload }: MonthTip) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <div className="text-foreground">{fmtPerKg(m.costPerKg)} / KG</div>
      <div className="text-muted-foreground">{fmtTonnes(m.totalKgs)} · {m.batches} batches</div>
    </div>
  );
}

function ScrapTooltip({ active, payload }: MonthTip) {
  const m = active && payload?.[0]?.payload;
  if (!m) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{m.label}</div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Produced</span><span className="tabular-nums">{fmtTonnes(m.scrapOut)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Consumed</span><span className="tabular-nums">{fmtTonnes(m.scrapIn)}</span></div>
      <div className="mt-1 border-t border-border pt-1 flex justify-between gap-4 font-medium"><span>Final</span><span className="tabular-nums">{fmtTonnes(m.scrapFinal)}</span></div>
    </div>
  );
}

interface FyTip {
  active?: boolean;
  payload?: Array<{ payload: { label: string; kgs: number; batches: number; value: number; costPerKg: number | null } }>;
}

function FyTooltip({ active, payload }: FyTip) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{p.label}</div>
      <div className="text-foreground">{fmtTonnes(p.kgs)} <span className="text-muted-foreground">({fmtKgs(p.kgs)})</span></div>
      <div className="text-muted-foreground">{p.batches} batches · {fmtSales(p.value)} · {fmtPerKg(p.costPerKg)}/KG</div>
    </div>
  );
}

interface CatTip {
  active?: boolean;
  total: number;
  payload?: Array<{ payload: { name: string; kgs: number; batches: number; costPerKg: number | null } }>;
}

function CatTooltip({ active, payload, total }: CatTip) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="font-semibold text-foreground">{p.name}</div>
      <div className="text-foreground">{fmtTonnes(p.kgs)} <span className="text-muted-foreground">({fmtKgs(p.kgs)})</span></div>
      <div className="text-muted-foreground">
        {total ? `${((p.kgs / total) * 100).toFixed(1)} % of output · ` : ""}{p.batches} batches · {fmtPerKg(p.costPerKg)}/KG
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ batch panel */

const CATEGORY_PILL: Record<BatchCostingRow["category"], string> = {
  "Finished Good": "bg-emerald-100 text-emerald-800",
  Scrap: "bg-amber-100 text-amber-800",
  "RM Consumption": "bg-orange-100 text-orange-800",
};

/**
 * One batch, slid over the dashboard rather than opened on another screen: the same lines the
 * Batch Costing register prints for that voucher — what it produced (positive) and what it
 * consumed (negative) — under a strip of the batch's own figures. Closes on the X, on Escape and
 * on a click outside, all of which the Sheet handles.
 */
function BatchSheet({ batch, lines, onClose }: {
  batch: BatchSummary | null; lines: BatchCostingRow[]; onClose: () => void;
}) {
  if (!batch) return null;
  const fg = lines.filter((l) => l.category === "Finished Good");
  const rm = lines.filter((l) => l.category === "RM Consumption");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-[840px] flex flex-col gap-0">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Batch · {tallyDate(batch.vch_date)} · FY {batch.fy}
            </div>
            <h2 className="truncate text-[17px] font-bold text-foreground">{batch.voucher_no}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                {batch.item_group && <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[batch.item_group] }} />}
                {batch.fg_item || "no finished good"}
              </span>
              {batch.item_category && <span>· {batch.item_category}</span>}
              {batch.colour && <span>· {batch.colour}</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded-button p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3 sm:grid-cols-4">
          <SheetFigure label="Output" value={fmtTonnes3(batch.fg_kgs)} sub={fmtKgs(batch.fg_kgs)} />
          <SheetFigure label="Cost / KG" value={fmtPerKg(batch.cost_per_kg)} sub={`${fmtSales(batch.fg_value)} value`} />
          <SheetFigure label="RM consumed" value={fmtSales(batch.rm_value)} sub={`${rm.length} material${rm.length === 1 ? "" : "s"}`} />
          <SheetFigure label="Scrap" value={fmtTonnes3(batch.scrap_out)}
                       sub={batch.scrap_in ? `${fmtTonnes3(batch.scrap_in)} re-used` : "none re-used"} />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-2 text-left font-semibold">Particulars</th>
                <th className="px-2 py-1.5 text-left font-semibold">Category</th>
                <th className="px-2 py-1.5 text-right font-semibold">Quantity</th>
                <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
                <th className="px-2 py-1.5 text-right font-semibold">Amount</th>
                <th className="pl-2 py-1.5 text-left font-semibold">Lot</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={`${l.line_no}`} className="border-b border-border/50 align-top">
                  <td className="py-1.5 pr-2">
                    <div className={cn("truncate", l.category === "Finished Good" ? "font-semibold text-foreground" : "text-foreground/90")}
                         title={l.item_booked ? `${l.item}\nBooked in Tally as: ${l.item_booked}` : l.item}>
                      {l.item}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium", CATEGORY_PILL[l.category])}>
                      {l.category}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtRegisterQty(l.qty, l.uom)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums italic text-muted-foreground">{fmtMoney(l.rate)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{l.amount ? fmtMoney(l.amount) : ""}</td>
                  <td className="pl-2 py-1.5 text-[11.5px] text-muted-foreground" title={l.batches.join("\n")}>
                    {l.batches.length > 1 ? `${l.batches[0]} +${l.batches.length - 1}` : l.batches[0] ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>
            {fg.length} output · {rm.length} consumption line{rm.length === 1 ? "" : "s"} · output value equals what the batch consumed
          </span>
          <Link
            to={`${BASE}/reports/batch-costing?fy=${batch.fy}&from=${batch.vch_date}&to=${batch.vch_date}&q=${encodeURIComponent(batch.voucher_no)}`}
            className="text-primary hover:underline"
          >
            Open in the register
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One line of the cost build-up: a coloured tick, what it is, and what it adds per KG. */
function CostLine({ label, value, note, accent }: { label: string; value: string; note?: string; accent: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] text-foreground">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
          <span className="truncate">{label}</span>
        </div>
        {note && <div className="pl-3.5 text-[10.5px] text-muted-foreground truncate" title={note}>{note}</div>}
      </div>
      <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function SheetFigure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-[15px] font-semibold leading-tight text-foreground truncate" title={value}>{value}</div>
      {sub && <div className="text-[10.5px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ batch table */

const COLS: Array<{ key: SortKey; label: string; right?: boolean; w: number }> = [
  { key: "vch_date", label: "Date", w: 84 },
  { key: "voucher_no", label: "Batch no.", w: 150 },
  { key: "fg_item", label: "Particular", w: 250 },
  { key: "item_category", label: "Sub-group", w: 170 },
  { key: "colour", label: "Colour", w: 80 },
  { key: "fg_kgs", label: "Output T", right: true, w: 110 },
  { key: "cost_per_kg", label: "₹ / KG", right: true, w: 90 },
  { key: "rm_value", label: "RM value", right: true, w: 120 },
  { key: "scrap_out", label: "Scrap T", right: true, w: 90 },
  { key: "scrap_in", label: "Scrap used T", right: true, w: 100 },
];

function BatchTable({ batches, onOpen }: { batches: BatchSummary[]; onOpen: (b: BatchSummary) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "vch_date", dir: "desc" });
  const sorted = useMemo(() => {
    const s = sort.dir === "asc" ? 1 : -1;
    return [...batches].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const r = typeof x === "number" || typeof y === "number"
        ? (Number(x) || 0) - (Number(y) || 0)
        : collator.compare(String(x ?? ""), String(y ?? ""));
      return r * s || collator.compare(a.voucher_no, b.voucher_no);
    });
  }, [batches, sort]);
  const page = usePagination(sorted, { pageSize: 10, resetKey: `${batches.length}|${sort.key}|${sort.dir}` });
  const nf2 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <ScrollableTable className="border-b border-border" maxHeight="max-h-[420px]">
        <table className="w-full min-w-[1220px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-muted/70">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} style={{ width: c.w }}
                    onClick={() => setSort((p) => ({ key: c.key, dir: p.key === c.key && p.dir === "desc" ? "asc" : "desc" }))}
                    className={cn("cursor-pointer select-none whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-foreground/70",
                                  c.right ? "text-right" : "text-left")}>
                  <span className={cn("inline-flex items-center gap-1", c.right && "justify-end w-full")}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.map((b) => (
              <tr key={b.key} className="border-t border-border/50 hover:bg-muted/40">
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{tallyDate(b.vch_date)}</td>
                <td className="px-3 py-1.5 truncate max-w-0" title={`${b.voucher_no} - click to open this batch`}>
                  <button type="button" onClick={() => onOpen(b)} className="truncate text-primary hover:underline">
                    {b.voucher_no}
                  </button>
                </td>
                <td className="px-3 py-1.5 truncate max-w-0 text-foreground" title={b.fg_item}>
                  <span className="inline-flex items-center gap-1.5">
                    {b.item_group && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: GROUP_COLOR[b.item_group] }} />}
                    {b.fg_item || "—"}
                  </span>
                </td>
                <td className="px-3 py-1.5 truncate max-w-0 text-muted-foreground" title={b.item_category}>{b.item_category}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{b.colour}</td>
                <td className="px-3 py-1.5 text-right tabular-nums" title={b.fg_kgs ? fmtKgs(b.fg_kgs) : ""}>{b.fg_kgs ? fmtTonnes3(b.fg_kgs) : "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{b.cost_per_kg == null ? "—" : nf2(b.cost_per_kg)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{nf2(b.rm_value)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground" title={b.scrap_out ? fmtKgs(b.scrap_out) : ""}>{b.scrap_out ? fmtTonnes3(b.scrap_out) : ""}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground" title={b.scrap_in ? fmtKgs(b.scrap_in) : ""}>{b.scrap_in ? fmtTonnes3(b.scrap_in) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <div className="px-3 py-2">
        <Pagination state={page} rowsLabel="batches" />
      </div>
    </div>
  );
}
