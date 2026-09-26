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
import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Boxes, ChevronRight, Download, FileText, Gift, IndianRupee, Layers,
  Mail, Percent, RotateCcw, Search, ShoppingCart, Table2,
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
import {
  DIMS, DISCOUNT_TYPE, MAIN_PRODUCTS, MONTHS, NOT_SET, OTHER_PRODUCT, QUARTER_MONTHS, SALES_TYPE_UNIT,
  compareBy, fmtInt, fmtQty, fyOfDate, growth, isDiscountLine, makeQtyFmt, monthName, monthsOfFy, orNotSet,
  pairBy, quarterOf, salesKpis, yearBefore, type Cmp, type Pair, type QtyFmt,
} from "@hub/lib/bushraSalesFigures";
import { useScopedParties } from "@hub/lib/scopeParties";
import { EMAILABLE_REPORTS, useReportAccess } from "@hub/lib/reportAccess";
import { useSession } from "@/core/platform/session";
import { Sheet, SheetContent } from "@hub/components/ui/sheet";
import ReportDeliveryConfig from "@hub/components/ReportDeliveryConfig";
import BushraSalesMailOptions from "@hub/components/BushraSalesMailOptions";
import { appBasePath } from "@/apps/appInfo";

/**
 * This screen's own links, rooted at the app that serves it. It moved out of the Outstanding
 * Dashboard with the rest of the reporting (apps/reports/), so a hard-coded
 * "/outstanding-dashboard" here would now point every in-page link at a redirect.
 */
const BASE = appBasePath("reports");
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const TOOLTIP_BOX = "rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-md";
const KPI_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ea580c", "#7c3aed", "#0d9488"];

type Row = BushraRegisterRow;

/** The name the free-issue row carries in the Type ring. */
const FOC_ROW = "FOC (free issue)";

/**
 * Every dashboard filter: a label for the bar, and the accessor from lib/bushraSalesFigures.ts —
 * the figures live there so the scheduled mail computes them from the same code this screen draws.
 */
const FILTERS = {
  month: { label: "Month", all: "All Months", unit: "Months", get: DIMS.month },
  location: { label: "Location", all: "All Locations", unit: "Locations", get: DIMS.location },
  company: { label: "Company", all: "All Companies", unit: "Companies", get: DIMS.company },
  type: { label: "Type", all: "All Types", unit: "Types", get: DIMS.type },
  salesType: { label: "Product", all: "All Products", unit: "Products", get: DIMS.salesType },
  category: { label: "Category", all: "All Categories", unit: "Categories", get: DIMS.category },
  inkType: { label: "Ink Type", all: "All Ink Types", unit: "Ink Types", get: DIMS.inkType },
  group: { label: "Group", all: "All Groups", unit: "Groups", get: DIMS.group },
  colour: { label: "Colour", all: "All Colours", unit: "Colours", get: DIMS.colour },
  party: { label: "Customer Name", all: "All Customers", unit: "Customers", get: DIMS.party },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const byKey = <T,>(make: () => T) => Object.fromEntries(FILTER_KEYS.map((k) => [k, make()])) as Record<FilterKey, T>;
const NO_FILTERS = byKey<string[]>(() => []);

const PRIMARY_TITLE: Record<PrimaryDim, string> = {
  salesType: "Product", inkType: "Ink Type", group: "Group", company: "Company",
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** "Sep-26" → "202609" — the YYYYMM every window and label below expects. */
const monthKey = (label: string) => {
  const [m, y] = label.split("-");
  return `20${y}${String(MONTHS.indexOf(m) + 1).padStart(2, "0")}`;
};

/** A bar outside the current pick fades back rather than disappearing — it stays there to click. */
const dim = (selected: string[], name: string) => (!selected.length || selected.includes(name) ? 1 : 0.3);
const pct = (v: number, total: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : "");
/** "20260918" → "18-09-2026" */
const dmy = (d: string) => `${d.slice(6)}-${d.slice(4, 6)}-${d.slice(0, 4)}`;

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
  const navigate = useNavigate();
  const { canSee } = useReportAccess();
  const { isAdmin } = useSession();
  const fyOptions = useMemo(() => salesFyOptions(), []);
  // THE CURRENT YEAR by default; the reader ticks last year when they want it. The load spans every
  // picked FY in one window (the register resolves each FY's own winning Tally book), and `base`
  // below drops a year left un-ticked in the middle of the span.
  const [fys, setFys] = useState<string[]>(() => [currentFy()]);
  const pickedFys = useMemo(() => (fys.length ? [...fys] : [currentFy()]).sort(), [fys]);
  /** The year the comparison calls "this year" — the latest one picked. */
  const thisFy = pickedFys[pickedFys.length - 1];
  const lastFy = useMemo(() => {
    const s = Number(thisFy.slice(0, 4)) - 1;
    return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  }, [thisFy]);
  /**
   * THE WINDOW ALWAYS REACHES BACK ONE YEAR, whatever is ticked. Product performance compares this
   * year against last, so last year has to be in hand even when only this year is shown; `base`
   * below still narrows the dashboard itself to the ticked years.
   */
  const from = `${Math.min(Number(pickedFys[0].slice(0, 4)), Number(lastFy.slice(0, 4)))}0401`;
  const to = useMemo(() => {
    const end = `${Number(pickedFys[pickedFys.length - 1].slice(0, 4)) + 1}0331`;
    const today = ymd(new Date());
    return today < end ? today : end;
  }, [pickedFys]);
  /** Where the years being READ start — what the header, the PDF and the exports quote, not `from`. */
  const readFrom = `${pickedFys[0].slice(0, 4)}0401`;

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
  /** Month or quarter, for the period charts; and which measure the performance table shows. */
  const [grain, setGrain] = useState<"month" | "quarter">("month");
  const [tableMeasure, setTableMeasure] = useState<"value" | "qty">("value");
  const [mailOpen, setMailOpen] = useState(false);
  /** A bar in the period chart picks its months — one for a month, three for a quarter. */
  const pickMonths = (labels: string[]) => {
    const same = labels.length === sel.month.length && labels.every((l) => sel.month.includes(l));
    setSel((s) => ({ ...s, month: same ? [] : labels }));
    setBarPicked((p) => (same ? p.filter((d) => d !== "month") : p.includes("month") ? p : [...p, "month"]));
  };
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
  const options = useMemo(() => cascadeOptions(base, sel), [base, sel]);

  /* -------- figures -------- */
  // Sales → Discount → Returns, which add up to Net. Computed in lib/bushraSalesFigures.ts so the
  // scheduled mail reports the same four numbers this screen shows.
  const kpi = useMemo(() => salesKpis(rows), [rows]);

  /**
   * FOC SITS BESIDE THE CARDS, NEVER INSIDE THEM.
   *
   * The Sales dashboard counts pure sales only — that is the point of it. But management still has
   * to see how much went out free, so FOC is summed here from the SAME window and the SAME filters
   * (Type excepted: no FOC type exists in a pure-sales list) and shown as its own strip.
   */
  const focLines = useMemo(
    () => (data ?? []).filter((r) =>
      /\bFOC\b/i.test(r.type) &&
      pickedFys.includes(fyOfDate(r.vch_date)) &&
      FILTER_KEYS.every((k) => k === "type" || !sel[k].length || sel[k].includes(FILTERS[k].get(r)))),
    [data, pickedFys, sel],
  );
  const foc = useMemo(() => {
    if (preset.id !== "bushra-sales-dashboard") return null;
    const vouchers = new Set(focLines.map((r) => `${r.tenant_id}|${r.voucher_no}`));
    return {
      qty: focLines.reduce((s, r) => s + r.quantity, 0),
      value: focLines.reduce((s, r) => s + r.revenue, 0),
      lines: focLines.length,
      vouchers: vouchers.size,
    };
  }, [focLines, preset]);

  /**
   * PRODUCT PERFORMANCE — this year against last, on the dashboard's own lines.
   *
   * Takes every filter EXCEPT Month and the year picker: the month is what the two halves compare
   * (the latest month with sales, or the one month picked in the filter bar), and the years are the
   * comparison itself.
   */
  const compareRows = useMemo(
    () => (data ?? []).filter((r) => {
      const fy = fyOfDate(r.vch_date);
      if (fy !== thisFy && fy !== lastFy) return false;
      if (!preset.include(r)) return false;
      return FILTER_KEYS.every((k) => k === "month" || !sel[k].length || sel[k].includes(FILTERS[k].get(r)));
    }),
    [data, preset, thisFy, lastFy, sel],
  );
  /** Each product's own quantity writer — Ink in T, Machines in Nos, Spare Parts in pcs. */
  const productFmt = useMemo(() => {
    const cache = new Map<string, QtyFmt>();
    return (name: string): QtyFmt => {
      let f = cache.get(name);
      if (!f) {
        f = makeQtyFmt(SALES_TYPE_UNIT[name] ?? "auto", compareRows.filter((r) => FILTERS.salesType.get(r) === name));
        cache.set(name, f);
      }
      return f;
    };
  }, [compareRows]);

  /**
   * The last day of this year's data — the year-to-date cut-off both years are measured to. With no
   * line this year it falls back to today, but never past the FY's own 31-Mar: a past year with
   * nothing in it would otherwise stretch the month list and the YTD window across later years.
   */
  const compareTo = useMemo(() => {
    let latest = "";
    for (const r of compareRows) if (fyOfDate(r.vch_date) === thisFy && r.vch_date > latest) latest = r.vch_date;
    if (latest) return latest;
    const today = ymd(new Date());
    const fyEnd = `${Number(thisFy.slice(0, 4)) + 1}0331`;
    return today < fyEnd ? today : fyEnd;
  }, [compareRows, thisFy]);
  /** The month both halves line up on: the one picked, else the month of that cut-off. */
  const compareMonth = sel.month.length === 1 ? monthKey(sel.month[0]) : compareTo.slice(0, 6);
  /** Every month of this FY up to that cut-off — what the month cards run over. */
  const compareMonths = useMemo(() => monthsOfFy(thisFy, compareTo), [thisFy, compareTo]);
  const total = metric === "value" ? kpi.net : kpi.qty;

  /** Company and location mixes — the same panels on every dashboard, over its own lines. */
  const byCompany = useMemo(() => pairBy(rows, FILTERS.company.get), [rows]);
  const byLocation = useMemo(() => pairBy(rows, FILTERS.location.get), [rows]);

  const byPrimary = useMemo(() => sliceBy(rows, FILTERS[preset.primary].get, measure), [rows, preset, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCategory = useMemo(() => sliceBy(rows, FILTERS.category.get, measure), [rows, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  // One colour per value on these two bar charts as well, off the UNFILTERED rows so a bar keeps
  // its colour when a click narrows the chart. Product and Company already have a fixed colour.
  const primaryColor = useMemo(
    () => (preset.primary === "salesType" ? salesTypeColor
      : preset.primary === "company" ? companyColor
      : makeMixColors(base, FILTERS[preset.primary].get)),
    [base, preset],
  );
  const categoryColor = useMemo(() => makeMixColors(base, FILTERS.category.get), [base]);

  /**
   * The PDF the scheduled mail will carry, built from exactly what the reader is looking at —
   * same rows, same filters, same period. lib/bushraSalesSummary.ts turns the rows into tables and
   * lib/bushraSalesPdf.ts draws them; neither touches the DOM, so the runner builds the same file.
   */
  const onPdf = async () => {
    const [{ buildSalesSummary }, { buildSalesPdf }] = await Promise.all([
      import("@hub/lib/bushraSalesSummary"),
      import("@hub/lib/bushraSalesPdf"),
    ]);
    const filters = FILTER_KEYS.filter((k) => sel[k].length).map((k) => `${FILTERS[k].label}: ${sel[k].join(", ")}`);
    const summary = buildSalesSummary({
      // FOC rides beside the cards on the Sales dashboard only, as on screen. Anywhere else it would
      // be every product's free issue on a one-product page, or on the FOC page the same lines twice.
      rows, compareRows, focRows: foc ? focLines : [], thisFy, lastFy, ytdTo: compareTo, compareMonth,
      dims: COMPARE_DIMS[preset.id] ?? { bucket: "salesType", child: "category" },
      qtyUnit: preset.qtyUnit,
      title: preset.id === "bushra-sales-dashboard" ? "Sales Dashboard" : `Sales · ${preset.title}`,
      // The years being READ, not the window the register was loaded over (which always reaches
      // back a year so the comparisons have something to compare with).
      periodLabel: `FY ${pickedFys.join(", FY ")} · ${dmy(readFrom)} to ${dmy(compareTo)}`,
      filters,
    });
    const blob = await buildSalesPdf(summary);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.title.replace(/\s+/g, "_")}_${readFrom}_${to}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const loading = (isLoading || !lookup) && !data && !errText;
  const empty = !loading && !errText && rows.length === 0;
  const emptyMsg = base.length ? "No lines match those filters." : "No lines on this dashboard in this period.";
  const metricWord = metric === "value" ? "Net value" : "Quantity";
  const tabs = SALES_DASHBOARDS.filter((p) => canSee(p.id));
  const mailReady = EMAILABLE_REPORTS.some((r) => r.id === preset.id);
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
        <div className="flex items-center gap-3">
          {/* The same file the scheduled mail attaches — built here from what is on screen, so a
              reader can check it before anyone signs up to receive it. */}
          <Button onClick={onPdf} disabled={!rows.length}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <FileText className="h-3.5 w-3.5" /> PDF
          </Button>
          {/* Setting up the automatic mail belongs WHERE THE DASHBOARD IS, not three screens away
              in Settings. Admin-only, because arming an unattended send is an admin's decision.
              Shown only once the dashboard is `emailable` in lib/reportCatalog.ts — i.e. once a
              sender exists. Before that, the schedule panel would read "Active — this sends
              itself" over a report nothing sends. */}
          {isAdmin && mailReady && (
            <Button variant="outline" onClick={() => setMailOpen(true)}
                    className="h-8 gap-1.5 rounded-button px-3 text-[12px]">
              <Mail className="h-3.5 w-3.5" /> Auto email
            </Button>
          )}
          {canSee("bushra-sales-register") && (
            <Link to={`${BASE}/bushra-sales-register`} className="text-[11px] text-primary hover:underline">Sales Register</Link>
          )}
        </div>
      </div>

      {/* ── Auto email setup, opened from the header ──────────────────────── */}
      <Sheet open={mailOpen} onOpenChange={setMailOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
          <div className="space-y-4 py-2">
            <div>
              <h2 className="text-[16px] font-bold text-foreground">Automatic email</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {preset.title} · set when it goes, what it carries and who receives it. Nothing is sent
                until the schedule is set here AND the send is armed in the database.
              </p>
            </div>
            <div className="hub-root space-y-3">
              {/* The same two panels the Settings screen shows, so there is one setup, not two. */}
              <ReportDeliveryConfig reportKey={preset.id} />
              <BushraSalesMailOptions reportKey={preset.id} reportTitle={preset.title} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
              // Clearing falls back to the current year — shown as such, never as "All Years",
              // which is what an empty pick would otherwise read while showing one year.
              onChange={(v) => { setFys(v.length ? v : [currentFy()]); setSel(NO_FILTERS); }}
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
            {fmtInt(rows.length)} lines · {dmy(readFrom)} → {dmy(to)}
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

      {/* ── FOC, beside the cards and not in them ─────────────────────────── */}
      {foc && (foc.lines > 0 || loading) && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Gift className="h-4 w-4 text-primary" /> Given free (FOC)
            <span className="font-normal normal-case tracking-normal">· not counted in the cards above</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Quantity</span>
            <span className="text-[17px] font-bold text-foreground">{fmtQ(foc.qty)}</span>
            {kpi.qty > 0 && <span className="text-[11px] text-muted-foreground">{pct(foc.qty, kpi.qty)} of sold qty</span>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Value</span>
            <span className="text-[17px] font-bold text-foreground">{fmtSales(foc.value)}</span>
            <span className="text-[11px] text-muted-foreground">
              {foc.value === 0 ? "booked at no value" : kpi.sales > 0 ? `${pct(foc.value, kpi.sales)} of sales` : ""}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Vouchers</span>
            <span className="text-[17px] font-bold text-foreground">{fmtInt(foc.vouchers)}</span>
            <span className="text-[11px] text-muted-foreground">{fmtInt(foc.lines)} lines</span>
          </div>
          {canSee("bushra-sales-foc") && (
            <Link to={`${BASE}/bushra-dashboard/sales-foc`} className="ml-auto text-[11px] text-primary hover:underline">
              FOC dashboard →
            </Link>
          )}
        </div>
      )}

      {/* ── By Company: who booked it. The Sales page reads every product; a product page
             reads only its own lines, so the same panel answers "which company sells the ink". ── */}
      <Section id="by-company" title="By Company & Location">
        <div className="grid gap-3 lg:grid-cols-2">
          <MixPanel
            title="Company Mix"
            subtitle={preset.id === "bushra-sales-dashboard" ? "quantity & revenue" : `quantity & revenue · ${preset.title.toLowerCase()} only`}
            data={byCompany} measure="both" note={pickedNote("company", "company")}
            colorOf={companyColor} selected={sel.company} onPick={toggle("company")}
            fmtQ={fmtQ} loading={loading} empty={empty} emptyMessage={emptyMsg}
          />
          <MixPanel
            title="Location Mix"
            subtitle="Surat & Noida · quantity & revenue"
            data={byLocation} measure="both" note={pickedNote("location", "location")}
            colorOf={locationColor} selected={sel.location} onPick={toggle("location")}
            fmtQ={fmtQ} loading={loading} empty={empty} emptyMessage={emptyMsg}
          />
        </div>
      </Section>

      {/* ── Product performance: this year against last ───────────────────── */}
      <ProductPerformance
        rows={compareRows} dims={COMPARE_DIMS[preset.id] ?? { bucket: "salesType", child: "category" }}
        month={compareMonth} ytdTo={compareTo} thisFy={thisFy} lastFy={lastFy} fmtQ={fmtQ} loading={loading}
      />

      {/* ── Quarter & month performance: one table, products across the top ─── */}
      <PeriodTable
        rows={compareRows} months={compareMonths} thisFy={thisFy} ytdTo={compareTo} measure={tableMeasure} setMeasure={setTableMeasure}
        fmtQ={fmtQ} productFmt={productFmt} selected={sel.month} onPickMonths={pickMonths} loading={loading}
        rowDim={(COMPARE_DIMS[preset.id] ?? { bucket: "salesType" }).bucket}
      />

      {preset.layout === "overview" ? (
        <Overview
          rows={rows} base={base} from={readFrom} to={to} fys={pickedFys} sections={preset.sections ?? ["type", "salesType"]}
          sel={sel} toggle={toggle} noteFor={pickedNote} fmtQ={fmtQ} setFilter={setFilter} onResetDashboard={resetAll}
          focPair={foc && foc.lines > 0 ? { name: FOC_ROW, qty: foc.qty, value: foc.value, lines: foc.lines } : null}
          onFocClick={() => navigate(`${BASE}/bushra-dashboard/sales-foc`)}
          grain={grain} setGrain={setGrain} periodMonths={compareMonths} onPickMonths={pickMonths}
          loading={loading} empty={empty} emptyMessage={emptyMsg}
        />
      ) : (
      <Section id={`slices:${preset.id}`} title={`${metricWord} by ${primaryTitle} & Category`}>
      <div className="grid gap-3 lg:grid-cols-2">
        <SliceChart
          title={`${metricWord} by ${primaryTitle}`} icon={ShoppingCart} colorOf={primaryColor}
          slices={byPrimary} total={total} fmt={fmtMeasure} selected={sel[preset.primary]}
          onPick={toggle(preset.primary)} what={primaryTitle} note={pickedNote(preset.primary, primaryTitle.toLowerCase())}
          loading={loading} empty={empty} emptyMessage={emptyMsg}
        />
        <SliceChart
          title={`${metricWord} by Category`} icon={Layers} colorOf={categoryColor}
          slices={byCategory} total={total} fmt={fmtMeasure} selected={sel.category}
          onPick={toggle("category")} what="Category" note={pickedNote("category", "category")}
          loading={loading} empty={empty} emptyMessage={emptyMsg}
        />
      </div>
      </Section>
      )}

      {/* The overview layout carries its own report; every other dashboard gets the same one here. */}
      {preset.layout === "slices" && (
        <Section id="report" title="Sales Report">
          <SalesReportTable rows={rows} base={base} from={readFrom} to={to} loading={loading} fmtQ={fmtQ}
                            sel={sel} setFilter={setFilter} onResetDashboard={resetAll} />
        </Section>
      )}
    </div>
  );
}

/* ==================================================================== overview layout */


/**
 * The Sales page: Quantity and Revenue side by side for Type, Sales-Type and Month, then the full
 * report. Never both measures on one plot — they have different units, and a second y-axis is how
 * a chart lies; two panels with the SAME bar order read across just as easily.
 */
/**
 * How each Mix section is titled and coloured. The filter key is the section's own name.
 *
 * `colorOf: null` means "no fixed colour per value" — Category, Group and Ink Type are whatever
 * Central Masters holds, so the section is painted by makeMixColors() from the dashboard's own
 * rows instead. They used to take ONE hue for every value, which left the reader with nothing but
 * bar length to tell the biggest category from the smallest.
 */
const SECTION_META: Record<SectionDim, { heading: string; subtitle: string; colorOf: ((name: string) => string) | null }> = {
  type: { heading: "By Type", subtitle: "by transaction type", colorOf: (n) => typeColor(n) },
  salesType: { heading: "By Product", subtitle: "by product", colorOf: (n) => salesTypeColor(n) },
  category: { heading: "By Category", subtitle: "by category", colorOf: null },
  group: { heading: "By Group", subtitle: "by group", colorOf: null },
  inkType: { heading: "By Ink Type", subtitle: "by ink type", colorOf: null },
  // The ink's own colour, so CYAN reads cyan. (A pale swatch still has its name beside it.)
  colour: {
    heading: "By Colour", subtitle: "by colour",
    colorOf: (n) => FIXED_MIX_COLORS[n] ?? INK_SWATCH[n] ?? OTHER_COLOR,
  },
};

function Overview({ rows, base, from, to, fys, sections, sel, toggle, noteFor, fmtQ, setFilter, onResetDashboard, focPair, onFocClick, grain, setGrain, periodMonths, onPickMonths, loading, empty, emptyMessage }: {
  noteFor: (k: FilterKey, what: string) => string;
  /** The free-issue total as one row for the Type ring, or null where FOC is the dashboard itself. */
  focPair: Pair | null; onFocClick: () => void;
  /** Month or quarter, and the months the period chart runs over. */
  grain: "month" | "quarter"; setGrain: (g: "month" | "quarter") => void; periodMonths: string[];
  onPickMonths: (labels: string[]) => void;
  rows: Row[]; base: Row[]; from: string; to: string; fys: string[]; sections: SectionDim[]; sel: Record<FilterKey, string[]>;
  fmtQ: QtyFmt; setFilter: (k: FilterKey) => (v: string[]) => void; onResetDashboard: () => void;
  toggle: (k: FilterKey) => (name: string) => void;
  loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const bySection = useMemo(
    () => sections.map((s) => {
      const data = pairBy(rows, FILTERS[s].get);
      // FOC RIDES ALONG IN THE TYPE MIX, though it is not a sale and never reaches the cards: the
      // reader wants "what went out free" beside "what was billed", which is what this ring is for.
      if (s === "type" && focPair && (focPair.qty !== 0 || focPair.value !== 0)) data.push(focPair);
      // Built from `base`, not `rows`: the colour of a category must not change when a filter
      // takes its neighbours off the card.
      const colorOf = SECTION_META[s].colorOf ?? makeMixColors(base, FILTERS[s].get);
      return { dim: s, colorOf, data: data.sort((a, b) => b.value - a.value) };
    }),
    [rows, base, sections, focPair],
  );
  const common = { loading, empty, emptyMessage, fmtQ };
  void fys;

  return (
    <>
      {bySection.map(({ dim, data, colorOf }) => {
        const meta = SECTION_META[dim];
        return (
          <Section key={dim} id={`mix:${dim}`} title={meta.heading}>
            <div className="grid gap-3 lg:grid-cols-2">
              {(["qty", "value"] as const).map((measure) => (
                <MixPanel
                  key={measure}
                  title={measure === "qty" ? "Quantity Mix" : "Revenue Mix"}
                  subtitle={meta.subtitle} data={data} measure={measure}
                  note={noteFor(dim, meta.subtitle.replace("by ", ""))}
                  colorOf={colorOf} selected={sel[dim]}
                  // The FOC row is not one of this dashboard's lines, so it opens the FOC dashboard
                  // instead of filtering a set it does not belong to.
                  onPick={(name) => (name === FOC_ROW ? onFocClick() : toggle(dim)(name))}
                  {...common}
                />
              ))}
            </div>
          </Section>
        );
      })}

      <Section id="by-period" title={`By ${grain === "month" ? "Month" : "Quarter"}`}>
        <div className="grid gap-3 lg:grid-cols-2">
          {(["value", "qty"] as const).map((m) => (
            <PeriodMix
              key={m} rows={rows} months={periodMonths} grain={grain} setGrain={setGrain} measure={m}
              fmtQ={fmtQ} selectedProducts={sel.salesType} onPickProduct={toggle("salesType")}
              onPickMonths={onPickMonths} loading={loading} empty={empty} emptyMessage={emptyMessage}
            />
          ))}
        </div>
      </Section>

      <Section id="report" title="Sales Report">
        <SalesReportTable rows={rows} base={base} from={from} to={to} loading={loading} fmtQ={fmtQ}
                          sel={sel} setFilter={setFilter} onResetDashboard={onResetDashboard} />
      </Section>
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
  [FOC_ROW]: CAT[2],
};
/** One colour per product, fixed — Ink is blue on every dashboard, whatever the filters. */
const SALES_TYPE_COLORS: Record<string, string> = {
  Ink: CAT[0], Machine: CAT[3], Heads: CAT[2], "Spare Parts": CAT[1], Paper: CAT[4],
  [OTHER_PRODUCT]: OTHER_COLOR,
};
/** The ink colour itself, for the Colour mix — same swatches as the Production Dashboard. */
const INK_SWATCH: Record<string, string> = {
  BLACK: "#1f1f1f", CYAN: "#00a6d6", MAGENTA: "#d6007e", YELLOW: "#f5c400", GREY: "#8a8f98",
  PINK: "#f48fb1", RED: "#d62828", ORANGE: "#f28c28", GREEN: "#2e9e44", BLUE: "#1f5fd6",
  VIOLET: "#7e3fd1", PURPLE: "#7e3fd1", BROWN: "#7b4a2a", WHITE: "#d9d9d9", TURQUOISE: "#1fb5b0",
};
/** One colour per company book, fixed — O-tec is blue wherever it appears. */
const COMPANY_COLORS: Record<string, string> = {
  "ORANGE O TEC": CAT[0], "ORANGE ENTERPRISE": CAT[1], COLORIX: CAT[2],
  "ORANGE O TEC BRANCH": CAT[3], "ORANGE ENT BRANCH": CAT[4],
  "ORANGE O TEC RELATED": CAT[6], "ORANGE ENT RELATED": CAT[7],
};
const companyColor = (name: string) => COMPANY_COLORS[name] ?? OTHER_COLOR;
/** The two places the business bills from. */
const LOCATION_COLORS: Record<string, string> = { Surat: CAT[0], Noida: CAT[1] };
const locationColor = (name: string) => LOCATION_COLORS[name] ?? OTHER_COLOR;
const typeColor = (name: string) => TYPE_COLORS[name] ?? OTHER_COLOR;
const salesTypeColor = (name: string) => SALES_TYPE_COLORS[name] ?? OTHER_COLOR;

/**
 * Values that mean the same thing on every dimension keep ONE colour, wherever they turn up.
 *
 * "(Not set)" takes the palette's neutral, the one slot that carries no identity — which is the
 * honest reading of "the master is not filled in", and keeps it from borrowing a real category's
 * hue. Grey is not a lesser row: it is a full slice of the ring and a full line of the total, the
 * same as any other.
 */
const FIXED_MIX_COLORS: Record<string, string> = {
  [NOT_SET]: OTHER_COLOR,
  // The same amber the Type mix already gives it, so one entity is never two colours on one page.
  [DISCOUNT_TYPE]: CAT[3],
};

/**
 * The seven hues, in the order they are handed out. CAT's own order minus the amber CAT[3] held
 * for Discount — and then RE-ORDERED, because dropping one hue put the green and the pink side by
 * side and neighbouring slots have to stay apart for a deuteranope. Validated with the dataviz
 * skill's validator (`scripts/validate_palette.js`, light surface): all checks pass, worst adjacent
 * pair ΔE 7.2, and that pair is the last two slots — the smallest values on the card. Re-run it
 * before changing this order.
 */
const MIX_WHEEL = [CAT[0], CAT[1], CAT[2], CAT[6], CAT[7], CAT[5], CAT[4]];

/**
 * TYPE, PRODUCT, COMPANY and LOCATION have a fixed colour per value above. CATEGORY, GROUP and INK
 * TYPE cannot: their values are whatever Central Masters holds, and they differ per dashboard. So
 * the hues are handed out per dashboard, from `base` — every line the dashboard covers BEFORE any
 * filter — biggest first, and the map is then fixed:
 *
 *   · colour follows the ENTITY, never its rank in the current view (the dataviz rule). Clicking a
 *     bar or a dropdown narrows the set; it must not repaint the survivors, and building the map
 *     from the unfiltered rows is what guarantees that.
 *   · hues are taken in the palette's fixed order and NEVER cycled. Past the seventh value colour
 *     has stopped telling them apart, so the tail takes the same neutral as "(Not set)" — one grey,
 *     not two, because two greys cannot be told apart either — and the name, bar and amount beside
 *     them carry the reading. Every row on these cards is directly labelled, so nothing rests on
 *     colour alone. On a card with seven categories or fewer, "(Not set)" is the only grey.
 */
function makeMixColors(rows: Row[], get: (r: Row) => string): (name: string) => string {
  const weight = new Map<string, number>();
  for (const r of rows) {
    const k = get(r);
    weight.set(k, (weight.get(k) ?? 0) + Math.abs(r.revenue));
  }
  // Ties broken by name, so the map cannot come out differently on two identical loads.
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  const map = new Map<string, string>();
  let next = 0;
  for (const [name] of ranked) {
    const fixed = FIXED_MIX_COLORS[name];
    map.set(name, fixed ?? (next < MIX_WHEEL.length ? MIX_WHEEL[next++] : OTHER_COLOR));
  }
  return (name) => FIXED_MIX_COLORS[name] ?? map.get(name) ?? OTHER_COLOR;
}

/**
 * "Mix" card — one row per value: colour dot · name · a bar · amount · share. The share is of the
 * POSITIVE total, so a credit note reads as "−14% of gross" instead of pushing sales past 100%;
 * a negative row draws its bar hatched-light and its amount in red. Rows are sorted largest first
 * and click to filter, like every other chart on the page.
 */
function MixPanel({ title, subtitle, data, measure, colorOf, selected, onPick, note, fmtQ, loading, empty, emptyMessage }: {
  title: string; subtitle: string; data: Pair[];
  /** "both" puts quantity AND revenue in one card — the list has room for two columns. */
  measure: "qty" | "value" | "both";
  colorOf: (name: string) => string; note: string;
  selected: string[]; onPick: (name: string) => void; fmtQ: QtyFmt; loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const both = measure === "both";
  // With both on one card the ring follows REVENUE — money is the one measure that adds up across
  // products, and quantity rides beside it in its own column.
  const ringOn: "qty" | "value" = both ? "value" : measure;
  const fmt = ringOn === "value" ? fmtSales : fmtQ;
  const rows = [...data].sort((a, b) => b[ringOn] - a[ringOn]);
  const net = rows.reduce((s, p) => s + p[ringOn], 0);
  const gross = rows.reduce((s, p) => s + Math.max(0, p[ringOn]), 0);
  const netQty = rows.reduce((s, p) => s + p.qty, 0);
  /** The ring shows what ADDS to the total; a negative stays in the list beside it. */
  const positives = rows.filter((p) => p[ringOn] > 0).map((p) => ({ name: p.name, value: p[ringOn] }));

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
        <span className="text-[12px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="-mt-2 mb-2 truncate text-[11px] text-muted-foreground" title={note}>{note}</div>
      {loading ? (
        <div className="h-52 w-full animate-pulse rounded-md bg-muted/50" />
      ) : empty ? (
        <div className="py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <Donut slices={positives} total={net} label={fmt(net)} colorOf={colorOf} selected={selected} onPick={onPick} />
            {/* A long list (every spare-parts category) scrolls beside the ring, largest first. */}
            <ul className={cn("min-w-0 flex-1 space-y-0.5", rows.length > 8 && "max-h-[280px] overflow-y-auto pr-1")}>
              {rows.map((p) => {
                const v = p[ringOn];
                const on = !selected.length || selected.includes(p.name);
                const color = colorOf(p.name);
                return (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => onPick(p.name)}
                      title={`${p.name}\nRevenue ${fmtSales(p.value)} · Quantity ${fmtQ(p.qty)} · ${fmtInt(p.lines)} lines${v < 0 ? "\nNegative — listed here, not in the ring" : ""}\nClick to filter`}
                      className={cn(
                        "grid w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/40",
                        both ? "grid-cols-[minmax(0,1fr)_auto_auto_46px]" : "grid-cols-[minmax(0,1fr)_auto_50px]",
                        !on && "opacity-40",
                        selected.includes(p.name) && "bg-primary/5 ring-1 ring-primary/30",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {/* Hollow dot = not in the ring, because a donut cannot draw a negative slice. */}
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={v < 0
                            ? { border: `2px solid ${color}`, background: "transparent" }
                            : { background: color }}
                        />
                        <span className="truncate text-[13.5px] text-foreground/80">{p.name}</span>
                      </span>
                      {both && (
                        <span className={cn("text-right text-[12.5px] tabular-nums", p.qty < 0 ? "text-destructive/80" : "text-muted-foreground")}>
                          {p.qty ? fmtQ(p.qty) : "—"}
                        </span>
                      )}
                      <span className={cn("text-right text-[13.5px] font-semibold tabular-nums", v < 0 ? "text-destructive" : "text-foreground")}>
                        {fmt(v)}
                      </span>
                      <span className={cn("text-right text-[12px] tabular-nums", v < 0 ? "text-destructive/80" : "text-muted-foreground")}>
                        {gross ? `${((v / gross) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 px-2 pt-2 text-[12.5px]">
            <span className="font-medium text-muted-foreground">
              {ringOn === "value" ? "Net total" : "Total"}
              {gross !== net && <span className="ml-1 text-[11px]">(gross {fmt(gross)})</span>}
            </span>
            <span className="flex items-baseline gap-3">
              {both && <span className="tabular-nums text-muted-foreground">{fmtQ(netQty)}</span>}
              <span className="font-bold tabular-nums text-foreground">{fmt(net)}</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/* ========================================================= product performance */
interface Bucket {
  name: string; month: Cmp; ytd: Cmp; children: Bucket[];
  /** What opens inside this card ("category", "type"). */
  childLabel: string;
  /** Each row's own quantity writer — Other's children are packing material, raw material… */
  fmtQ: QtyFmt;
  childFmt: (name: string) => QtyFmt;
  /**
   * False on "Other": it holds packing material in numbers, raw material in KG and software in
   * licences, so ONE quantity for the card would be a number with no unit behind it. The card shows
   * revenue, and the types inside carry their own quantities.
   */
  showQty: boolean;
}

/**
 * ON THE SALES DASHBOARD EACH PRODUCT CARD KEEPS ITS OWN UNIT. The dashboard's own total has to add
 * KG to pieces to say anything at all, but a card is one product line, so Machines count in Nos and
 * ink weighs in T — never "0.07 T of machines".

/** Which dimension the buckets are, and what opens inside one, per dashboard. */
const COMPARE_DIMS: Record<string, { bucket: FilterKey; child: FilterKey }> = {
  "bushra-sales-dashboard": { bucket: "salesType", child: "category" },
  "bushra-sales-foc": { bucket: "salesType", child: "category" },
  "bushra-sales-soa": { bucket: "salesType", child: "category" },
  "bushra-sales-branch-related": { bucket: "salesType", child: "category" },
  "bushra-sales-ink": { bucket: "category", child: "inkType" },
  "bushra-sales-machines": { bucket: "category", child: "group" },
  "bushra-sales-heads": { bucket: "category", child: "group" },
  "bushra-sales-spare-parts": { bucket: "category", child: "group" },
  "bushra-sales-papers": { bucket: "category", child: "group" },
};

/**
 * PRODUCT PERFORMANCE — one card per product, this year against last.
 *
 * Two windows per card: the MONTH (the latest month with sales, or the one month picked in the
 * filter bar) against the same month a year earlier, and the YEAR TO DATE (1-Apr to the last day
 * with sales) against the same days last year — like for like, since this year is only part done.
 * Opening a card breaks it into its categories without leaving the page.
 */
function ProductPerformance({ rows, dims, month, ytdTo, thisFy, lastFy, fmtQ, loading }: {
  rows: Row[]; dims: { bucket: FilterKey; child: FilterKey }; month: string; ytdTo: string;
  thisFy: string; lastFy: string; fmtQ: QtyFmt; loading: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  /** The month still running is compared to the same day last year, like the year to date. */
  const monthCut = ytdTo.slice(0, 6) === month;
  const windows = useMemo(() => {
    const curMonth = { from: `${month}01`, to: monthCut ? ytdTo : `${month}31` };
    const preMonth = { from: yearBefore(curMonth.from), to: yearBefore(curMonth.to) };
    const curYtd = { from: `${thisFy.slice(0, 4)}0401`, to: ytdTo };
    const preYtd = { from: yearBefore(curYtd.from), to: yearBefore(curYtd.to) };
    return { curMonth, preMonth, curYtd, preYtd };
  }, [month, monthCut, ytdTo, thisFy]);

  /** A card's own quantity writer: by product line where the buckets ARE product lines. */
  const fmtFor = useMemo(() => {
    if (dims.bucket !== "salesType") return () => fmtQ;
    const cache = new Map<string, QtyFmt>();
    return (name: string): QtyFmt => {
      const unit = SALES_TYPE_UNIT[name];
      if (!unit) return fmtQ;
      let f = cache.get(name);
      if (!f) { f = makeQtyFmt(unit, rows.filter((r) => FILTERS.salesType.get(r) === name)); cache.set(name, f); }
      return f;
    };
  }, [dims.bucket, rows, fmtQ]);

  const buckets = useMemo(() => {
    const get = FILTERS[dims.bucket].get;
    const byMonth = new Map(compareBy(rows, get, windows.curMonth, windows.preMonth).map((c) => [c.name, c]));
    const blank = (name: string): Cmp => ({ name, curQty: 0, curVal: 0, preQty: 0, preVal: 0 });
    const order = (n: string) => {
      const i = (MAIN_PRODUCTS as readonly string[]).indexOf(n);
      return i === -1 ? MAIN_PRODUCTS.length : i;
    };
    const list = compareBy(rows, get, windows.curYtd, windows.preYtd).map((ytd): Bucket => {
      const mine = rows.filter((r) => get(r) === ytd.name);
      // "Other" opens by TYPE — packing material, raw material, software — because that is the
      // question a reader has of it. Every other card opens by the dashboard's child dimension.
      const isOther = dims.bucket === "salesType" && ytd.name === OTHER_PRODUCT;
      const childGet = isOther ? (r: Row) => orNotSet(r.sales_type) : FILTERS[dims.child].get;
      const childLabel = isOther ? "type" : FILTERS[dims.child].label.toLowerCase();
      const childMonth = new Map(compareBy(mine, childGet, windows.curMonth, windows.preMonth).map((c) => [c.name, c]));
      const childFmt = (name: string): QtyFmt =>
        // A type inside Other is measured in whatever unit its own items carry in Central Masters.
        isOther ? makeQtyFmt("auto", mine.filter((r) => childGet(r) === name)) : fmtFor(ytd.name);
      const children = compareBy(mine, childGet, windows.curYtd, windows.preYtd)
        .map((cy): Bucket => ({
          name: cy.name, ytd: cy, month: childMonth.get(cy.name) ?? blank(cy.name), children: [],
          childLabel, fmtQ: childFmt(cy.name), childFmt, showQty: true,
        }));
      return {
        name: ytd.name, ytd, month: byMonth.get(ytd.name) ?? blank(ytd.name), children,
        childLabel, fmtQ: fmtFor(ytd.name), childFmt, showQty: !isOther,
      };
    });
    // The five products read in their own order, with Other last; every other dimension by size.
    return dims.bucket === "salesType"
      ? [...list].sort((a, b) => order(a.name) - order(b.name))
      : list;
  }, [rows, dims, windows]);

  const monthLabel = `${monthName(month)} vs ${monthName(yearBefore(`${month}01`).slice(0, 6))}${monthCut ? ` · 1–${Number(ytdTo.slice(6))}` : ""}`;
  const ytdLabel = `FY ${thisFy} to date vs FY ${lastFy}`;

  return (
    <Section
      id={`product-performance:${dims.bucket}`}
      title={dims.bucket === "salesType" ? "Product performance" : `${FILTERS[dims.bucket].label} performance`}
      right={
        <span className="text-[11px] text-muted-foreground">
          {monthLabel} · year to date to {ytdTo.slice(6)}-{ytdTo.slice(4, 6)}-{ytdTo.slice(0, 4)}, against the same days last year
        </span>
      }
    >
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-muted/50" />)}
        </div>
      ) : buckets.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface py-8 text-center text-[12px] text-muted-foreground">
          Nothing to compare in this period.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {buckets.map((b) => (
            <ProductCard
              key={b.name} bucket={b}
              blocks={[
                { label: monthLabel, q: [b.month.curQty, b.month.preQty], v: [b.month.curVal, b.month.preVal] },
                { label: ytdLabel, q: [b.ytd.curQty, b.ytd.preQty], v: [b.ytd.curVal, b.ytd.preVal] },
              ]}
              childBlocks={(c) => [{ label: monthLabel, cmp: c.month }, { label: ytdLabel, cmp: c.ytd }]}
              canOpen={b.children.length > 0}
              open={open === b.name}
              onToggle={() => setOpen((o) => (o === b.name ? null : b.name))}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function Delta({ cur, pre }: { cur: number; pre: number }) {
  const g = growth(cur, pre);
  if (g === null) return <span className="text-[12px] text-muted-foreground">{cur ? "new" : "—"}</span>;
  const up = g >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12.5px] font-semibold tabular-nums",
                        up ? "text-[#0ca30c]" : "text-destructive")}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {`${up ? "+" : ""}${g.toFixed(1)}%`}
    </span>
  );
}

/**
 * One product's card: quantity and revenue, this year against last, for the month and for the year
 * to date. Click it and the same four rows appear per sub-group (a category inside a product line,
 * an ink type inside a category) without leaving the page.
 */
function ProductCard({ bucket, blocks, childBlocks, open, onToggle, canOpen }: {
  bucket: Bucket;
  /** The comparison rows this card shows, top to bottom. */
  blocks: { label: string; q: [number, number]; v: [number, number] }[];
  /** How a child's rows are labelled and which figures they carry. */
  childBlocks: (c: Bucket) => { label: string; cmp: Cmp }[];
  open: boolean; onToggle: () => void; canOpen: boolean;
}) {
  const children = bucket.children;
  const childLabel = bucket.childLabel;
  const fmtQ = bucket.fmtQ;
  const Block = ({ label, q, v }: { label: string; q: [number, number]; v: [number, number] }) => (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {([["Quantity", q, fmtQ], ["Revenue", v, fmtSales]] as const).map(([what, [cur, pre], fmt]) =>
        what === "Quantity" && !bucket.showQty ? (
          <div key={what} className="grid grid-cols-[62px_1fr_1fr_auto] items-baseline gap-2 text-[12.5px]">
            <span className="text-muted-foreground">{what}</span>
            <span className="col-span-3 text-right text-[11.5px] italic text-muted-foreground">
              mixed units — open the card
            </span>
          </div>
        ) : (
          <div key={what} className="grid grid-cols-[62px_1fr_1fr_auto] items-baseline gap-2 text-[12.5px]">
            <span className="text-muted-foreground">{what}</span>
            <span className="text-right font-semibold tabular-nums text-foreground">{fmt(cur)}</span>
            <span className="text-right tabular-nums text-muted-foreground">{fmt(pre)}</span>
            <span className="w-[68px] text-right"><Delta cur={cur} pre={pre} /></span>
          </div>
        ))}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
      <button type="button" onClick={onToggle} disabled={!canOpen}
              className="mb-2 flex w-full items-center justify-between gap-2 text-left disabled:cursor-default">
        <span className="truncate text-[14px] font-bold text-foreground">{bucket.name}</span>
        {canOpen && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-primary">
            {open ? "close" : `by ${childLabel}`}
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          </span>
        )}
      </button>
      <div className="grid grid-cols-[62px_1fr_1fr_auto] gap-2 border-b border-border/70 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span />
        <span className="text-right">This year</span>
        <span className="text-right">Last year</span>
        <span className="w-[68px] text-right">Change</span>
      </div>
      <div className="mt-2 space-y-2.5">
        {blocks.map((b) => <Block key={b.label} label={b.label} q={b.q} v={b.v} />)}
      </div>
      {open && children && (
        <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
          {children.length === 0 ? (
            <div className="py-2 text-center text-[11.5px] text-muted-foreground">Nothing inside this one.</div>
          ) : children.map((c) => (
            <div key={c.name} className="rounded-md bg-muted/30 px-2 py-1.5">
              <div className="mb-1 truncate text-[12.5px] font-semibold text-foreground/90" title={c.name}>{c.name}</div>
              {childBlocks(c).map(({ label, cmp: cm }) => (
                <div key={label} className="mb-1 last:mb-0">
                  <div className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="grid grid-cols-[62px_1fr_1fr_auto] items-baseline gap-2 text-[12px]">
                    <span className="text-muted-foreground">Quantity</span>
                    <span className="text-right font-medium tabular-nums text-foreground">{c.fmtQ(cm.curQty)}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{c.fmtQ(cm.preQty)}</span>
                    <span className="w-[68px] text-right"><Delta cur={cm.curQty} pre={cm.preQty} /></span>
                  </div>
                  <div className="grid grid-cols-[62px_1fr_1fr_auto] items-baseline gap-2 text-[12px]">
                    <span className="text-muted-foreground">Revenue</span>
                    <span className="text-right font-medium tabular-nums text-foreground">{fmtSales(cm.curVal)}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{fmtSales(cm.preVal)}</span>
                    <span className="w-[68px] text-right"><Delta cur={cm.curVal} pre={cm.preVal} /></span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================ revenue & quantity by period, per product */

interface PeriodPoint { key: string; label: string; months: string[]; total: number; [product: string]: string | number | string[] }

/**
 * The period chart — one stacked bar per month (or quarter), split by product.
 *
 * Stacked rather than side by side: the reader wants the month's total AND what made it up, and six
 * products in grouped bars over twelve months is 72 bars nobody can compare. Each segment keeps its
 * product's colour, so a colour means the same thing here as in every ring on the page. A 2px gap
 * between segments keeps them apart at small sizes.
 */
function PeriodMix({ rows, months, grain, setGrain, measure, fmtQ, selectedProducts, onPickProduct, onPickMonths, loading, empty, emptyMessage }: {
  rows: Row[]; months: string[]; grain: "month" | "quarter"; setGrain: (g: "month" | "quarter") => void;
  measure: "qty" | "value"; fmtQ: QtyFmt; selectedProducts: string[];
  onPickProduct: (name: string) => void; onPickMonths: (labels: string[]) => void;
  loading: boolean; empty: boolean; emptyMessage: string;
}) {
  const fmt = measure === "value" ? fmtSales : fmtQ;
  const products = [...MAIN_PRODUCTS, OTHER_PRODUCT];

  const data = useMemo(() => {
    const periods = new Map<string, PeriodPoint>();
    const blank = (key: string, label: string, ms: string[]): PeriodPoint => {
      const p = { key, label, months: ms, total: 0 } as PeriodPoint;
      for (const n of products) p[n] = 0;
      return p;
    };
    for (const m of months) {
      const key = grain === "month" ? m : `${m.slice(0, 4)}Q${quarterOf(m)}`;
      if (!periods.has(key)) {
        const label = grain === "month"
          ? monthName(m)
          : `Q${quarterOf(m)} ${QUARTER_MONTHS[quarterOf(m) - 1]}`;
        periods.set(key, blank(key, label, []));
      }
      periods.get(key)!.months.push(monthName(m));
    }
    for (const r of rows) {
      const m = r.vch_date.slice(0, 6);
      if (!months.includes(m)) continue;
      const key = grain === "month" ? m : `${m.slice(0, 4)}Q${quarterOf(m)}`;
      const p = periods.get(key);
      if (!p) continue;
      const name = FILTERS.salesType.get(r);
      const v = measure === "value" ? r.revenue : r.quantity;
      p[name] = (p[name] as number) + v;
      p.total += v;
    }
    return [...periods.values()];
  }, [rows, months, grain, measure]); // eslint-disable-line react-hooks/exhaustive-deps

  const grandTotal = data.reduce((s, p) => s + p.total, 0);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-foreground">
          {measure === "value" ? "Revenue" : "Quantity"} by {grain === "month" ? "month" : "quarter"}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">per product</span>
          <div className="flex h-7 overflow-hidden rounded-input border border-border text-[11.5px]">
            {(["month", "quarter"] as const).map((g) => (
              <button key={g} type="button" onClick={() => setGrain(g)}
                      className={cn("px-2.5", grain === g ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-muted/50")}>
                {g === "month" ? "Month" : "Quarter"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* The legend doubles as a product filter, so a colour can be switched off at the source. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {products.map((n) => (
          <button key={n} type="button" onClick={() => onPickProduct(n)}
                  className={cn("flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground",
                                selectedProducts.length && !selectedProducts.includes(n) && "opacity-40")}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: salesTypeColor(n) }} />
            {n}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="h-[300px] w-full animate-pulse rounded-md bg-muted/50" />
      ) : empty ? (
        <div className="py-10 text-center text-xs text-muted-foreground">{emptyMessage}</div>
      ) : (
        <ResponsiveContainer width="100%" height={310}>
          <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: grain === "month" ? 26 : 8 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: grain === "month" ? 10 : 11 }} tickLine={false}
                   axisLine={{ stroke: CHART_GRID }} interval={0}
                   angle={grain === "month" ? -35 : 0} textAnchor={grain === "month" ? "end" : "middle"}
                   height={grain === "month" ? 46 : 30} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={64}
                   tickFormatter={(v: number) => fmt(v).replace("₹ ", "")} />
            <ReferenceLine y={0} stroke="hsl(220 10% 75%)" />
            <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<PeriodTooltip fmt={fmt} products={products} />} />
            {products.map((n, i) => (
              <Bar key={n} dataKey={n} stackId="p" fill={salesTypeColor(n)} maxBarSize={54}
                   stroke="hsl(0 0% 100%)" strokeWidth={1}
                   radius={i === products.length - 1 ? [4, 4, 0, 0] : undefined}
                   className="cursor-pointer"
                   onClick={(d: PeriodPoint, _i: number, e?: { stopPropagation?: () => void }) => {
                     e?.stopPropagation?.();
                     if (d?.months) onPickMonths(d.months as string[]);
                   }}>
                {i === products.length - 1 && (
                  <LabelList dataKey="total" position="top" formatter={(v: number) => (v ? fmt(v) : "")}
                             style={{ fontSize: 10, fill: LABEL_FILL, fontWeight: 600 }} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
      {!loading && !empty && (
        <div className="mt-1 flex justify-between border-t border-border/70 px-1 pt-2 text-[12.5px]">
          <span className="font-medium text-muted-foreground">Total</span>
          <span className="font-bold tabular-nums text-foreground">{fmt(grandTotal)}</span>
        </div>
      )}
    </div>
  );
}

function PeriodTooltip({ active, payload, label, fmt, products }: {
  active?: boolean; payload?: { payload: PeriodPoint }[]; label?: string;
  fmt: (n: number) => string; products: string[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className={TOOLTIP_BOX}>
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {products.filter((n) => (p[n] as number) !== 0).map((n) => (
        <div key={n} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-sm" style={{ background: salesTypeColor(n) }} />{n}
          </span>
          <span className="tabular-nums text-foreground">{fmt(p[n] as number)}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-border/70 pt-1 font-semibold">
        <span>Total</span><span className="tabular-nums">{fmt(p.total)}</span>
      </div>
    </div>
  );
}

/* ================================================= period × product performance table */

interface PeriodRow {
  key: string; label: string; months: string[];
  /** Product → this year / last year, plus the row's own total. */
  cur: Record<string, number>; pre: Record<string, number>;
  curTotal: number; preTotal: number;
}

/**
 * ONE TABLE FOR THE WHOLE YEAR: every quarter down the side, every product across the top, and each
 * quarter opens into its own months. It replaced a card per month — six cards said the same thing in
 * six places and none of them could be read against another.
 *
 * A cell carries this year's figure; hovering it (or reading the Total column) gives last year and
 * the change, so the table stays a table rather than three numbers per cell.
 */
function PeriodTable({ rows, months, thisFy, ytdTo, measure, setMeasure, fmtQ, productFmt, selected, onPickMonths, rowDim, loading }: {
  /** `ytdTo` is this year's last day with data; last year is cut at the same day, like for like. */
  rows: Row[]; months: string[]; thisFy: string; ytdTo: string; measure: "value" | "qty";
  setMeasure: (m: "value" | "qty") => void; fmtQ: QtyFmt; productFmt: (name: string) => QtyFmt;
  selected: string[]; onPickMonths: (labels: string[]) => void;
  /**
   * WHAT THE ROWS ARE, per dashboard: products on the Sales dashboard, and that product's own
   * CATEGORIES on a product dashboard — an Ink page listing "Machine — —" down the side told the
   * reader nothing they did not already know.
   */
  rowDim: FilterKey;
  loading: boolean;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const byProduct = rowDim === "salesType";
  // A product row carries its own unit (ink T, machines Nos); a category row is inside one product,
  // so the dashboard's unit is already the right one.
  const fmtFor = (name: string | null) =>
    measure === "value" ? fmtSales : name && byProduct ? productFmt(name) : fmtQ;

  /**
   * COLUMN WIDTHS ARE THE READER'S. Figures run from "₹140 Cr" to "₹19.66 L" and a name can be
   * "Spare Parts" or "EP SUBLIMATION SUPER HD", so any width we choose is wrong for somebody: every
   * divider is draggable, and a double-click puts one back to its default.
   */
  const DEFAULT_W: Record<string, number> = { product: 190, pre: 84, cur: 92, chg: 58 };
  const [widths, setWidths] = useState<Record<string, number>>({});
  const widthOf = (key: string, kind: keyof typeof DEFAULT_W) => widths[key] ?? DEFAULT_W[kind];
  const startResize = (key: string, kind: keyof typeof DEFAULT_W) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(key, kind);
    const move = (ev: MouseEvent) => {
      const w = Math.max(48, startW + ev.clientX - startX);
      setWidths((prev) => ({ ...prev, [key]: w }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  /** The grip on a column's right edge. Double-click restores that column's default. */
  const Grip = ({ colKey, kind }: { colKey: string; kind: keyof typeof DEFAULT_W }) => (
    <span
      onMouseDown={startResize(colKey, kind)}
      onDoubleClick={(e) => { e.stopPropagation(); setWidths((p) => { const n = { ...p }; delete n[colKey]; return n; }); }}
      title="Drag to resize · double-click to reset"
      className="absolute right-0 top-0 z-[3] h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40"
    />
  );

  const { quarters, monthRows, grand, rowNames } = useMemo(() => {
    const get = FILTERS[rowDim].get;
    const mk = (key: string, label: string, ms: string[]): PeriodRow =>
      ({ key, label, months: ms, cur: {}, pre: {}, curTotal: 0, preTotal: 0 });

    const byMonth = new Map(months.map((m) => [m, mk(m, monthName(m), [monthName(m)])]));
    const byQuarter = new Map<string, PeriodRow>();
    for (const m of months) {
      const q = quarterOf(m);
      const key = `Q${q}`;
      if (!byQuarter.has(key)) byQuarter.set(key, mk(key, `Q${q} · ${QUARTER_MONTHS[q - 1]}`, []));
      byQuarter.get(key)!.months.push(monthName(m));
    }
    const grandRow = mk("all", `FY ${thisFy}`, months.map(monthName));

    const add = (row: PeriodRow | undefined, name: string, v: number, isCur: boolean) => {
      if (!row) return;
      if (isCur) { row.cur[name] = (row.cur[name] ?? 0) + v; row.curTotal += v; }
      else { row.pre[name] = (row.pre[name] ?? 0) + v; row.preTotal += v; }
    };
    const seen = new Set<string>();
    const lastYearTo = yearBefore(ytdTo);
    for (const r of rows) {
      const ym = r.vch_date.slice(0, 6);
      const isCur = months.includes(ym);
      // Last year's line lands on the month it matches — Sep-25 feeds Sep-26's "last year".
      const mapped = isCur ? ym : `${Number(ym.slice(0, 4)) + 1}${ym.slice(4)}`;
      if (!isCur && !months.includes(mapped)) continue;
      // ...but only up to the same day: 1–18 Sep this year against 1–18 Sep last, not all of it,
      // so the running month, its quarter and the year all compare like for like.
      if (!isCur && r.vch_date > lastYearTo) continue;
      const name = get(r);
      seen.add(name);
      const v = measure === "value" ? r.revenue : r.quantity;
      add(byMonth.get(mapped), name, v, isCur);
      add(byQuarter.get(`Q${quarterOf(mapped)}`), name, v, isCur);
      add(grandRow, name, v, isCur);
    }
    // Products keep their own order with Other last; categories run biggest first.
    const names = byProduct
      ? [...MAIN_PRODUCTS, OTHER_PRODUCT].filter((p) => seen.has(p))
      : [...seen].sort((a, b) => Math.abs(grandRow.cur[b] ?? 0) - Math.abs(grandRow.cur[a] ?? 0));
    return { quarters: [...byQuarter.values()], monthRows: byMonth, grand: grandRow, rowNames: names };
  }, [rows, months, measure, thisFy, ytdTo, rowDim, byProduct]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The columns, left to right: each quarter, with its months slotted in behind it while it is open,
   * and the whole year last. Every one of them carries three figures — last year, this year, change.
   */
  const columns = useMemo(() => {
    const out: { row: PeriodRow; kind: "quarter" | "month" | "grand" }[] = [];
    for (const q of quarters) {
      out.push({ row: q, kind: "quarter" });
      if (open.includes(q.key)) {
        for (const m of months.filter((mm) => `Q${quarterOf(mm)}` === q.key)) {
          const r = monthRows.get(m);
          if (r) out.push({ row: r, kind: "month" });
        }
      }
    }
    out.push({ row: grand, kind: "grand" });
    return out;
  }, [quarters, monthRows, grand, months, open]);

  const tableWidth = useMemo(
    () => widthOf("product", "product") + columns.reduce((s, { row }) =>
      s + widthOf(`${row.key}|pre`, "pre") + widthOf(`${row.key}|cur`, "cur") + widthOf(`${row.key}|chg`, "chg"), 0),
    [columns, widths], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** One product's three cells under one period. */
  const Cells = ({ row, product, bold }: { row: PeriodRow; product: string | null; bold?: boolean }) => {
    const cur = product ? row.cur[product] ?? 0 : row.curTotal;
    const pre = product ? row.pre[product] ?? 0 : row.preTotal;
    const g = growth(cur, pre);
    const fmt = fmtFor(product);
    return (
      <>
        <td className="whitespace-nowrap px-2 py-1.5 text-right text-[12px] tabular-nums text-muted-foreground">
          {pre ? fmt(pre) : "—"}
        </td>
        <td className={cn("whitespace-nowrap px-2 py-1.5 text-right text-[12.5px] tabular-nums",
                          cur < 0 ? "text-destructive" : "text-foreground", bold && "font-bold")}>
          {cur ? fmt(cur) : "—"}
        </td>
        <td className={cn("whitespace-nowrap border-r border-border/50 px-2 py-1.5 text-right text-[11.5px] tabular-nums",
                          g === null ? "text-muted-foreground" : g >= 0 ? "text-[#0ca30c]" : "text-destructive")}>
          {g === null ? (cur ? "new" : "—") : `${g >= 0 ? "+" : ""}${g.toFixed(0)}%`}
        </td>
      </>
    );
  };

  return (
    <Section
      id="quarter-month"
      title="Quarter & month performance"
      right={
        <>
          <span className="text-[11px] text-muted-foreground">
            last year to the same day, this year and the change · open a quarter for its months · click a period to filter
          </span>
          <div className="flex h-7 overflow-hidden rounded-input border border-border text-[11.5px]">
            {(["value", "qty"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMeasure(m)}
                      className={cn("px-2.5", measure === m ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:bg-muted/50")}>
                {m === "value" ? "Revenue" : "Quantity"}
              </button>
            ))}
          </div>
        </>
      }
    >
      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
      ) : (
        <ScrollableTable className="rounded-xl border border-border bg-surface" maxHeight="max-h-[70vh]">
          <table className="border-collapse" style={{ tableLayout: "fixed", width: tableWidth, minWidth: "100%" }}>
            <colgroup>
              <col style={{ width: widthOf("product", "product") }} />
              {columns.map(({ row }) => (
                <Fragment key={row.key}>
                  <col style={{ width: widthOf(`${row.key}|pre`, "pre") }} />
                  <col style={{ width: widthOf(`${row.key}|cur`, "cur") }} />
                  <col style={{ width: widthOf(`${row.key}|chg`, "chg") }} />
                </Fragment>
              ))}
            </colgroup>
            <thead>
              {/* Period across the top: a quarter opens into its months, the year sits last. */}
              <tr className="border-b border-border bg-muted/50">
                <th rowSpan={2} className="sticky left-0 z-[2] bg-muted/50 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground relative">
                  {FILTERS[rowDim].label}
                  <Grip colKey="product" kind="product" />
                </th>
                {columns.map(({ row, kind }) => (
                  <th key={row.key} colSpan={3}
                      className={cn("border-l border-border/60 px-2 py-1.5 text-center text-[12px] font-bold",
                                    kind === "grand" ? "bg-muted/60 text-foreground" : "text-foreground")}>
                    {kind === "grand" ? row.label : (
                      <span className="inline-flex items-center gap-1">
                        {kind === "quarter" && (
                          <button type="button" title={open.includes(row.key) ? "Hide its months" : "Show its months"}
                                  onClick={() => setOpen((o) => (o.includes(row.key) ? o.filter((k) => k !== row.key) : [...o, row.key]))}>
                            <ChevronRight className={cn("h-3.5 w-3.5 text-primary transition-transform", open.includes(row.key) && "rotate-90")} />
                          </button>
                        )}
                        <button type="button" onClick={() => onPickMonths(row.months)}
                                title={`Filter the dashboard to ${row.months.join(", ")}`}
                                className={cn("hover:text-primary",
                                              kind === "month" && "text-[11.5px] font-semibold text-foreground/80",
                                              selected.length && row.months.every((m) => selected.includes(m)) && "text-primary")}>
                          {row.label}
                        </button>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
              <tr className="border-b-2 border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                {columns.map(({ row }) => (
                  <Fragment key={row.key}>
                    <th className="relative border-l border-border/60 px-2 py-1 text-right font-medium">
                      Last yr<Grip colKey={`${row.key}|pre`} kind="pre" />
                    </th>
                    <th className="relative px-2 py-1 text-right font-medium">
                      This yr<Grip colKey={`${row.key}|cur`} kind="cur" />
                    </th>
                    <th className="relative border-r border-border/50 px-2 py-1 text-right font-medium">
                      Chg<Grip colKey={`${row.key}|chg`} kind="chg" />
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowNames.length === 0 ? (
                <tr><td colSpan={1 + columns.length * 3} className="py-8 text-center text-[12px] text-muted-foreground">
                  Nothing in this period.
                </td></tr>
              ) : rowNames.map((p) => (
                <tr key={p} className="border-b border-border/40 hover:bg-muted/30">
                  <th scope="row" className="sticky left-0 z-[1] bg-surface px-2 py-1.5 text-left">
                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground" title={p}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: byProduct ? salesTypeColor(p) : CAT[0] }} />
                      <span className="truncate">{p}</span>
                    </span>
                  </th>
                  {columns.map(({ row }) => <Cells key={row.key} row={row} product={p} />)}
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-muted/40">
                <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-muted/40 px-2 py-1.5 text-left text-[12.5px] font-bold text-foreground">
                  Total
                </th>
                {columns.map(({ row }) => <Cells key={row.key} row={row} product={null} bold />)}
              </tr>
            </tbody>
          </table>
        </ScrollableTable>
      )}
      {measure === "qty" && byProduct && (
        <div className="text-[11px] italic text-muted-foreground">
          Each product row is in its own unit (ink in T, machines and heads in Nos, spare parts in pcs);
          the Total row adds them together, so read the rows rather than the total.
        </div>
      )}
    </Section>
  );
}

/**
 * The ring beside a Mix list — one arc per positive value, the total in the hole.
 *
 * Plain SVG rather than a chart library: it is a dozen arcs and a text node, and drawing it here
 * keeps the slice order, the 2px surface gap between arcs and the click-to-filter behaviour exactly
 * the same as the list it sits next to. A single value draws a full ring (an arc of 360° would
 * collapse to nothing, so it is a <circle>).
 */
function Donut({ slices, total, label, colorOf, selected, onPick }: {
  slices: { name: string; value: number }[]; total: number; label: string;
  colorOf: (name: string) => string; selected: string[]; onPick: (name: string) => void;
}) {
  const SIZE = 168, R = 72, W = 26;
  const sum = slices.reduce((s, p) => s + p.value, 0);
  const c = SIZE / 2;
  const point = (angle: number, radius: number) => {
    const a = ((angle - 90) * Math.PI) / 180;
    return [c + radius * Math.cos(a), c + radius * Math.sin(a)];
  };
  let start = 0;
  const arcs = slices.map((p) => {
    const sweep = sum > 0 ? (p.value / sum) * 360 : 0;
    // A 2px gap between arcs, taken off the sweep, so neighbouring colours never touch.
    const gap = slices.length > 1 ? Math.min(2.5, sweep / 3) : 0;
    const a0 = start + gap / 2;
    const a1 = start + sweep - gap / 2;
    start += sweep;
    const [x0, y0] = point(a0, R);
    const [x1, y1] = point(a1, R);
    const large = a1 - a0 > 180 ? 1 : 0;
    return { ...p, d: `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`, share: sum > 0 ? p.value / sum : 0 };
  });

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0" role="img" aria-label={`Total ${label}`}>
      <circle cx={c} cy={c} r={R} fill="none" stroke="hsl(220 15% 94%)" strokeWidth={W} />
      {slices.length === 1 ? (
        <circle cx={c} cy={c} r={R} fill="none" strokeWidth={W} stroke={colorOf(slices[0].name)}
                opacity={dim(selected, slices[0].name)} className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onPick(slices[0].name); }}>
          <title>{`${slices[0].name} — 100%`}</title>
        </circle>
      ) : arcs.map((a) => (
        <path key={a.name} d={a.d} fill="none" strokeWidth={W} stroke={colorOf(a.name)} strokeLinecap="butt"
              opacity={dim(selected, a.name)} className="cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onPick(a.name); }}>
          <title>{`${a.name} — ${(a.share * 100).toFixed(1)}% of the ring`}</title>
        </path>
      ))}
      <text x={c} y={c - 2} textAnchor="middle" className="fill-foreground" style={{ fontSize: 15, fontWeight: 700 }}>{label}</text>
      <text x={c} y={c + 14} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9.5, letterSpacing: 0.6 }}>
        {total < 0 ? "NET (−)" : "TOTAL"}
      </text>
    </svg>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

/**
 * A BAND OF THE DASHBOARD THE READER CAN SHUT.
 *
 * The page has grown long — performance, a table, four rings, two charts and the report — and not
 * everyone wants all of it at once. Every band folds away, and what is open is remembered per
 * dashboard (localStorage), so a reader who only wants the table gets the table next time too.
 * Anything on the right of the title (a measure switch, a note) stays clickable while folded.
 */
function Section({ id, title, right, defaultOpen = true, children }: {
  id: string; title: string; right?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const storeKey = `bushra-sales:section:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storeKey);
      return saved === null ? defaultOpen : saved === "1";
    } catch { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(storeKey, o ? "0" : "1"); } catch { /* private window — fold anyway */ }
      return !o;
    });
  };
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1">
        <button type="button" onClick={toggle}
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                title={open ? "Close this section" : "Open this section"}>
          <ChevronRight className={cn("h-3.5 w-3.5 text-primary transition-transform", open && "rotate-90")} />
          {title}
        </button>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {open && children}
    </section>
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

/**
 * A ROW'S CELL, not a chart's bucket. The charts must name the blank — a reader has to be able to
 * see and click "(Not set)" — but a table row with nothing in the column says that by itself, and
 * printing "(Not set)" down four columns of a few thousand lines only crowds them. So the cell
 * shows what the filter shows EXCEPT for "(Not set)", which stays an empty cell as before.
 */
const itemCell = (v: string) => (v === NOT_SET ? "" : v);

const REPORT_EXTRA: ExtraColumn<Row>[] = [
  { header: "SALES-TYPE", width: 16, get: (r) => r.sales_type },
  { header: "INK TYPE", width: 22, get: (r) => itemCell(FILTERS.inkType.get(r)) },
  { header: "GROUP", width: 22, get: (r) => itemCell(FILTERS.group.get(r)) },
  { header: "CATEGORY", width: 22, get: (r) => itemCell(FILTERS.category.get(r)) },
  { header: "COLOUR", width: 12, get: (r) => itemCell(FILTERS.colour.get(r)) },
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
/**
 * Every column sorts (the house rule), each by `sort`: the date in calendar order and the amounts
 * as numbers, not by the text they print.
 */
const REPORT_COLUMNS: {
  header: string; filter: { dash: FilterKey } | { table: TableOnlyKey } | null; right?: boolean;
  sort: (r: Row) => string | number;
}[] = [
  { header: "Date", filter: { table: "date" }, sort: (r) => r.vch_date },
  { header: "Voucher No.", filter: { table: "voucherNo" }, sort: (r) => r.voucher_no },
  { header: "Type", filter: { dash: "type" }, sort: FILTERS.type.get },
  { header: "Company", filter: { dash: "company" }, sort: (r) => r.company },
  { header: "Location", filter: { dash: "location" }, sort: (r) => r.location_name },
  { header: "Customer Name", filter: { dash: "party" }, sort: (r) => r.party },
  { header: "Particulars", filter: { table: "particulars" }, sort: (r) => r.particulars },
  { header: "Product", filter: { dash: "salesType" }, sort: FILTERS.salesType.get },
  { header: "Category", filter: { dash: "category" }, sort: (r) => itemCell(FILTERS.category.get(r)) },
  { header: "Group", filter: { dash: "group" }, sort: (r) => itemCell(FILTERS.group.get(r)) },
  { header: "Ink Type", filter: { dash: "inkType" }, sort: (r) => itemCell(FILTERS.inkType.get(r)) },
  { header: "Colour", filter: { dash: "colour" }, sort: (r) => itemCell(FILTERS.colour.get(r)) },
  { header: "Quantity", filter: null, right: true, sort: (r) => r.quantity },
  { header: "Rate", filter: null, right: true, sort: (r) => r.rate },
  { header: "Revenue", filter: null, right: true, sort: (r) => r.revenue },
];

/** The full sales report: every line the filters leave, filterable and sortable per column, searchable, paged, exportable. */
function SalesReportTable({ rows, base, from, to, loading, fmtQ, sel, setFilter, onResetDashboard }: {
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
  const keepTable = (r: Row, except?: TableOnlyKey) =>
    TABLE_ONLY_KEYS.every((k) => k === except || !tsel[k].length || tsel[k].includes(TABLE_ONLY[k](r)));
  const searched = useMemo(() => rows.filter(matchesSearch), [rows, matchesSearch]);
  const shown = useMemo(() => searched.filter((r) => keepTable(r)), [searched, tsel]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const page = usePagination(sorted, {
    resetKey: `${rows.length}|${q}|${TABLE_ONLY_KEYS.map((k) => tsel[k].join(",")).join("|")}|${sort?.col}|${sort?.dir}`,
  });
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
                    <Button onClick={() => sorted.length && exportSalesRegisterXlsx(sorted, { from, to, extra: REPORT_EXTRA, filePrefix: "Bushra_Sales_Report" })}
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
            {/* Filter row — an "Any" dropdown under each heading. */}
            <tr className="border-b-2 border-border bg-muted/30">
              {REPORT_COLUMNS.map((c) => (
                <th key={c.header} className="px-2 py-1.5 font-normal">
                  {c.filter && ("dash" in c.filter ? (
                    <MultiSelectFilter
                      options={dashOptions[c.filter.dash]}
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
              <tr key={`${r.tenant_id}-${r.voucher_no}-${r.line_no}-${i}`} className="border-b border-border/40 text-[12.5px] hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{r.date_display}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.voucher_no}</td>
                {/* The derived type, so a discount line reads "Discount" here too. */}
                <td className="whitespace-nowrap px-3 py-1.5">{FILTERS.type.get(r)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.company}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{r.location_name}</td>
                <td className="px-3 py-1.5">{r.party}</td>
                <td className="px-3 py-1.5">{r.particulars}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{FILTERS.salesType.get(r)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{itemCell(FILTERS.category.get(r))}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{itemCell(FILTERS.group.get(r))}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{itemCell(FILTERS.inkType.get(r))}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{itemCell(FILTERS.colour.get(r))}</td>
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
function SliceChart({ title, icon, colorOf, slices, total, fmt, selected, onPick, what, note, loading, empty, emptyMessage }: {
  title: string; icon: typeof Layers; colorOf: (name: string) => string; slices: Slice[]; total: number;
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
            {slices.map((s) => <Cell key={s.name} fill={colorOf(s.name)} fillOpacity={dim(selected, s.name)} />)}
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
