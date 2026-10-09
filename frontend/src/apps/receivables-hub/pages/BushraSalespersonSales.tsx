/**
 * Salesperson Sales — Bushra-Dashboard → Sales (the dashboard) and Bushra-Report (the report): the
 * Bushra Sales Register read per salesperson.
 *
 * WHO SOLD IT: the salesperson tag on the customer's ledger in Masters (ext_ledger_tags — the same
 * tag that scopes receivables), joined to each line by book + ledger (lib/bushraLedgerLink.ts).
 * Tally carries no salesperson, so a ledger nobody has tagged reads "(Not assigned)" — shown, never
 * dropped, so the totals still add up to the register's.
 *
 * WHAT IS COUNTED: pure sales, the Sales dashboard's own rule (isPureSale) — no FOC, branch or
 * related-party lines. Net of returns, credit notes and discounts.
 *
 * THIS YEAR AGAINST LAST: the picked FY to its last day with sales, against the same days a year
 * earlier — like for like, since this year is only part done.
 *
 * Clicking a salesperson's bar, a product or a month filters every panel; click again to let it go.
 */
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, BarChart3, ChevronRight, Download, FileText, IndianRupee,
  Layers, RotateCcw, Search, Table2, TrendingUp, UserCheck, UserX, Users,
} from "lucide-react";
import { cn } from "@hub/lib/utils";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { PanelFill } from "@hub/components/ResizeKit";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { ColumnPicker, type ColumnOption } from "@hub/components/ColumnPicker";
import { fmtSales, salesFyOptions } from "@hub/lib/salesReport";
import { currentFy, ymd } from "@hub/lib/salesRegister";
import { loadBushraSalesRegister, loadItemLookup, type BushraRegisterRow } from "@hub/lib/bushraSalesRegister";
import { exportSalesRegisterXlsx, type ExtraColumn } from "@hub/lib/exportSalesRegister";
import { SALES_DASHBOARDS, isPureSale } from "@hub/lib/bushraSalesDashboards";
import {
  DIMS, MAIN_PRODUCTS, MONTHS, NOT_SET, OTHER_PRODUCT, fmtInt, fyOfDate, growth, makeQtyFmt, monthName, productOf, yearBefore,
} from "@hub/lib/bushraSalesFigures";
import { NOT_ASSIGNED, loadSalespersonLink } from "@hub/lib/bushraSalespersonSales";
import { useScopedParties } from "@hub/lib/scopeParties";
import { useReportAccess } from "@hub/lib/reportAccess";
import { appBasePath } from "@/apps/appInfo";

const BASE = appBasePath("reports");
export const SALESPERSON_DASHBOARD_ID = "bushra-sales-salesperson";
export const SALESPERSON_DASHBOARD_PATH = "bushra-dashboard/sales-salesperson";
export const SALESPERSON_REPORT_ID = "bushra-salesperson-sales";

const PRODUCTS = [...MAIN_PRODUCTS, OTHER_PRODUCT] as const;
/** One colour per product, the same order everywhere on this screen. */
const PRODUCT_COLOR: Record<string, string> = {
  Ink: "#2563eb", Machine: "#ea580c", Heads: "#7c3aed", "Spare Parts": "#0d9488", Paper: "#ca8a04", [OTHER_PRODUCT]: "#6b7280",
};
const CUR_COLOR = "#FF6A1F";
const PRE_COLOR = "#94a3b8";
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const fmtKg = makeQtyFmt("kg", []);
const fmtNos = makeQtyFmt("nos", []);
const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const dmy = (d: string) => (d ? `${d.slice(6)}-${d.slice(4, 6)}-${d.slice(0, 4)}` : "");
const pct = (v: number, total: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : "—");
const tick = (v: number) => fmtSales(v).replace("₹ ", "");
const growthText = (cur: number, pre: number) => {
  const g = growth(cur, pre);
  return g === null ? (cur ? "new" : "—") : `${g >= 0 ? "+" : ""}${g.toFixed(1)}%`;
};

type Row = BushraRegisterRow;
/** A line with its salesperson. */
interface Tagged { r: Row; sp: string }

const FILTERS = {
  salesperson: { label: "Salesperson", all: "All Salespersons", unit: "Salespersons", get: (t: Tagged) => t.sp },
  company: { label: "Company", all: "All Companies", unit: "Companies", get: (t: Tagged) => DIMS.company(t.r) },
  location: { label: "Location", all: "All Locations", unit: "Locations", get: (t: Tagged) => DIMS.location(t.r) },
  product: { label: "Product", all: "All Products", unit: "Products", get: (t: Tagged) => DIMS.salesType(t.r) },
  party: { label: "Customer", all: "All Customers", unit: "Customers", get: (t: Tagged) => t.r.party },
  month: { label: "Month", all: "All Months", unit: "Months", get: (t: Tagged) => DIMS.month(t.r) },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, []])) as unknown as Record<FilterKey, string[]>;
/** "Sep-26" → 9 — last year's lines follow a Month pick by month of the year. */
const monthNo = (label: string) => MONTHS.indexOf(label.split("-")[0]) + 1;

export default function BushraSalespersonSales({ mode }: { mode: "dashboard" | "report" }) {
  const { canSee } = useReportAccess();
  const fyOptions = useMemo(() => salesFyOptions(), []);
  const [fy, setFy] = useState(currentFy());
  const fyStart = Number(fy.slice(0, 4));
  const lastFy = `${fyStart - 1}-${String(fyStart % 100).padStart(2, "0")}`;
  // The year before is loaded too, for the like-for-like comparison. With the current FY picked this
  // is the Sales dashboards' own window and cache key, so a reader coming from them waits for nothing.
  const from = `${fyStart - 1}0401`;
  const to = useMemo(() => {
    const end = `${fyStart + 1}0331`;
    const today = ymd(new Date());
    return today < end ? today : end;
  }, [fyStart]);

  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v4"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });
  const { data, isLoading, isFetching, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraSalesRegister", "v8", from, to, scopeKey],
    queryFn: () => loadBushraSalesRegister(from, to, scope, lookup),
    enabled: !scopeLoading && !!lookup,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const { data: spOf, error: linkError } = useQuery({
    queryKey: ["bushraSalespersonSales", "link", "v1"],
    queryFn: loadSalespersonLink,
    staleTime: 30 * 60 * 1000,
  });
  const err = lookupError ?? rowsError ?? linkError;
  const errText = err ? (err as Error).message : null;
  const loading = (isLoading || !lookup || !spOf) && !errText;

  /* -------- lines, each with its salesperson -------- */
  const tagged = useMemo<Tagged[]>(() => {
    if (!spOf) return [];
    return (data ?? []).filter(isPureSale).map((r) => ({ r, sp: spOf(r.tenant_id, r.party) ?? NOT_ASSIGNED }));
  }, [data, spOf]);
  const thisYear = useMemo(() => tagged.filter((t) => fyOfDate(t.r.vch_date) === fy), [tagged, fy]);
  /** This year's last day with sales — both years are measured to it. */
  const cutoff = useMemo(() => {
    let latest = "";
    for (const t of thisYear) if (t.r.vch_date > latest) latest = t.r.vch_date;
    return latest || to;
  }, [thisYear, to]);
  const lastYear = useMemo(
    () => tagged.filter((t) => fyOfDate(t.r.vch_date) === lastFy && t.r.vch_date <= yearBefore(cutoff)),
    [tagged, lastFy, cutoff],
  );

  /* -------- filters -------- */
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const keep = (t: Tagged, except?: FilterKey) =>
    FILTER_KEYS.every((k) => k === except || !sel[k].length || sel[k].includes(FILTERS[k].get(t)));
  /** Last year follows every filter, Month by month of the year (a Sep-26 pick keeps Sep-25). */
  const keepPrev = (t: Tagged) =>
    FILTER_KEYS.every((k) => !sel[k].length ||
      (k === "month" ? sel.month.some((m) => monthNo(m) === Number(t.r.vch_date.slice(4, 6))) : sel[k].includes(FILTERS[k].get(t))));
  const cur = useMemo(() => thisYear.filter((t) => keep(t)), [thisYear, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const pre = useMemo(() => lastYear.filter(keepPrev), [lastYear, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => {
    const vals = new Set<string>();
    for (const t of thisYear) if (keep(t, k)) vals.add(FILTERS[k].get(t));
    const list = [...vals];
    list.sort(k === "month"
      ? (a, b) => (monthNo(a) + 12 * Number(a.slice(-2))) - (monthNo(b) + 12 * Number(b.slice(-2)))
      : collator.compare);
    return [k, list.map((v) => ({ value: v, label: v }))];
  })) as Record<FilterKey, MultiSelectOption[]>, [thisYear, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFilter = (k: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [k]: v }));
  const toggle = (k: FilterKey, v: string) =>
    setSel((s) => ({ ...s, [k]: s[k].length === 1 && s[k][0] === v ? [] : [v] }));
  const filterCount = FILTER_KEYS.reduce((n, k) => n + sel[k].length, 0);

  /* -------- figures -------- */
  const people = useMemo(() => summarise(cur, pre), [cur, pre]);
  const totals = useMemo(() => {
    const net = cur.reduce((s, t) => s + t.r.revenue, 0);
    const prev = pre.reduce((s, t) => s + t.r.revenue, 0);
    const unassigned = cur.filter((t) => t.sp === NOT_ASSIGNED).reduce((s, t) => s + t.r.revenue, 0);
    return {
      net, prev, unassigned,
      salespersons: people.filter((p) => p.name !== NOT_ASSIGNED && p.net !== 0).length,
      customers: new Set(cur.map((t) => t.r.party)).size,
      vouchers: new Set(cur.map((t) => `${t.r.tenant_id}|${t.r.voucher_no}`)).size,
    };
  }, [cur, pre, people]);

  const byMonth = useMemo(() => {
    const out: { key: string; label: string; "This year": number; "Last year": number }[] = [];
    for (let i = 0; i < 12; i++) {
      const m = ((3 + i) % 12) + 1;
      const y = m >= 4 ? fyStart : fyStart + 1;
      const key = `${y}${String(m).padStart(2, "0")}`;
      if (key > cutoff.slice(0, 6)) break;
      out.push({ key, label: monthName(key), "This year": 0, "Last year": 0 });
    }
    const at = new Map(out.map((p) => [p.key.slice(4), p]));
    for (const t of cur) { const p = at.get(t.r.vch_date.slice(4, 6)); if (p) p["This year"] += t.r.revenue; }
    for (const t of pre) { const p = at.get(t.r.vch_date.slice(4, 6)); if (p) p["Last year"] += t.r.revenue; }
    return out;
  }, [cur, pre, fyStart, cutoff]);

  const salesTabs = SALES_DASHBOARDS.filter((p) => canSee(p.id));
  const fromLabel = dmy(`${fyStart}0401`);
  const windowLabel = `FY ${fy} · ${fromLabel} → ${dmy(cutoff)}, against the same days of FY ${lastFy}`;
  const top = people.slice(0, 25);

  return (
    <div className={cn("p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3 transition-opacity", isFetching && data && "opacity-70")}>
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={mode === "dashboard" ? `${BASE}/bushra-dashboard?group=sales` : BASE}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> {mode === "dashboard" ? "Sales" : "Reports"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">
              Salesperson {mode === "dashboard" ? "Dashboard" : "Sales Report"}
            </h1>
            <span className="text-[12px] text-muted-foreground">
              · the sales register by salesperson · pure sales · salesperson from the customer's ledger tag in Masters
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {mode === "dashboard" && canSee(SALESPERSON_REPORT_ID) && (
            <Link to={`${BASE}/bushra-salesperson-sales`} className="text-primary hover:underline">Salesperson report</Link>
          )}
          {mode === "report" && canSee(SALESPERSON_DASHBOARD_ID) && (
            <Link to={`${BASE}/${SALESPERSON_DASHBOARD_PATH}`} className="text-primary hover:underline">Dashboard</Link>
          )}
        </div>
      </div>

      {mode === "dashboard" && (salesTabs.length > 0 || canSee("bushra-sales-orange-customers")) && (
        <nav className="flex flex-wrap gap-1.5">
          {salesTabs.map((p) => (
            <Link key={p.id} to={`${BASE}/${p.path}`}
                  className="rounded-pill border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              {p.id === "bushra-sales-dashboard" ? "Sales" : p.title}
            </Link>
          ))}
          {canSee("bushra-sales-orange-customers") && (
            <Link to={`${BASE}/bushra-dashboard/sales-orange-customers`}
                  className="rounded-pill border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
              Orange vs Non-Orange
            </Link>
          )}
          <span className="rounded-pill border border-primary bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground">
            Salesperson
          </span>
        </nav>
      )}

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Financial Year</span>
            <select value={fy} onChange={(e) => { setFy(e.target.value); setSel(NO_FILTERS); }}
                    className="h-8 w-[130px] rounded-input border border-border bg-surface px-2 text-[12px]">
              {fyOptions.map((o) => <option key={o} value={o}>FY {o}</option>)}
            </select>
          </label>
          {FILTER_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{FILTERS[k].label}</span>
              <MultiSelectFilter
                options={options[k]} value={sel[k]} onChange={setFilter(k)}
                allLabel={FILTERS[k].all} unit={FILTERS[k].unit} searchable
                triggerClassName={cn("h-8 text-[12px] rounded-input border-border", k === "party" || k === "salesperson" ? "w-[200px]" : "w-[150px]")}
                contentClassName={k === "party" ? "w-80" : undefined}
              />
            </label>
          ))}
          <Button onClick={() => setSel(NO_FILTERS)} disabled={!filterCount}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{windowLabel}</span>
        </div>
      </div>

      {errText && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>
      )}

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={IndianRupee} accent="#2563eb" label="Net sales" loading={loading} value={fmtSales(totals.net)}
             sub={`last year ${fmtSales(totals.prev)} · ${growthText(totals.net, totals.prev)}`} />
        <Kpi icon={TrendingUp} accent="#16a34a" label="Growth" loading={loading} value={growthText(totals.net, totals.prev)}
             sub="against the same days last year" />
        <Kpi icon={UserCheck} accent="#7c3aed" label="Salespersons" loading={loading} value={fmtInt(totals.salespersons)} sub="with sales in the period" />
        <Kpi icon={Users} accent="#0d9488" label="Customers" loading={loading} value={fmtInt(totals.customers)} sub="billed in the period" />
        <Kpi icon={FileText} accent="#ea580c" label="Vouchers" loading={loading} value={fmtInt(totals.vouchers)}
             sub={totals.vouchers ? `avg ${fmtSales(totals.net / totals.vouchers)}` : ""} />
        <Kpi icon={UserX} accent="#dc2626" label="Not assigned" loading={loading} value={fmtSales(totals.unassigned)}
             sub={`${pct(totals.unassigned, totals.net)} of sales — tag the ledgers in Masters`} />
      </div>

      {mode === "dashboard" && (
        <>
          <div className="grid gap-3 xl:grid-cols-2">
            {/* ── Net sales by salesperson ─────────────────────────────────── */}
            <SalesPanel title="Net sales by salesperson" icon={BarChart3} loading={loading}
                        empty={!loading && !top.length} emptyMessage="No sales match those filters."
                        subtitle={sel.salesperson.length ? `filtered to ${sel.salesperson.join(", ")} — click it again to clear`
                          : "this year, with growth on the same days last year — click one to filter every panel"}
                        sizeKey="sp-net" bodyHeight={444}>
              <PanelFill base={420} min={(bar) => top.length * bar(26) + 30}>{(bar) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 4, right: 130, left: 4, bottom: 4 }}>
                    <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tick} />
                    <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false}
                           axisLine={false} width={170} interval={0} />
                    <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }}
                             formatter={(v: number, _n: string, it: { payload?: Person }) =>
                               [`${fmtSales(v)} · last year ${fmtSales(it.payload?.prev ?? 0)}`, "Net sales"]} />
                    <Bar dataKey="net" maxBarSize={bar(18)} radius={[0, 4, 4, 0]} className="cursor-pointer"
                         onClick={(d: { name?: string }) => d?.name && toggle("salesperson", d.name)}>
                      {top.map((p) => (
                        <Cell key={p.name} fill={p.name === NOT_ASSIGNED ? "#9ca3af" : CUR_COLOR}
                              fillOpacity={!sel.salesperson.length || sel.salesperson.includes(p.name) ? 1 : 0.3} />
                      ))}
                      <LabelList dataKey="net" position="right"
                                 content={(props) => {
                                   const p = top[Number(props.index ?? 0)];
                                   if (!p) return null;
                                   const g = growth(p.net, p.prev);
                                   const n = (v: unknown) => Number(v ?? 0) || 0;
                                   return (
                                     <text x={n(props.x) + n(props.width) + 6} y={n(props.y) + n(props.height) / 2 + 4}
                                           fontSize={10.5} fontWeight={600} fill={LABEL_FILL}>
                                       {fmtSales(p.net)}
                                       <tspan fill={g === null ? LABEL_FILL : g >= 0 ? "#0ca30c" : "#dc2626"}>{`  ${growthText(p.net, p.prev)}`}</tspan>
                                     </text>
                                   );
                                 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}</PanelFill>
            </SalesPanel>

            {/* ── Product mix by salesperson ───────────────────────────────── */}
            <SalesPanel title="Product mix by salesperson" icon={Layers} loading={loading}
                        empty={!loading && !top.length} emptyMessage="No sales match those filters."
                        subtitle={sel.product.length ? `filtered to ${sel.product.join(", ")} — click it again to clear`
                          : "net sales split by product — click a colour to filter by that product"}
                        sizeKey="sp-mix" bodyHeight={444}>
              <PanelFill base={420} min={(bar) => top.length * bar(26) + 50}>{(bar) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tick} />
                    <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false}
                           axisLine={false} width={170} interval={0} />
                    <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} formatter={(v: number, n: string) => [fmtSales(v), n]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                    {PRODUCTS.map((p) => (
                      <Bar key={p} dataKey={(d: Person) => d.byProduct[p] ?? 0} name={p} stackId="mix" fill={PRODUCT_COLOR[p]}
                           maxBarSize={bar(18)} className="cursor-pointer"
                           fillOpacity={!sel.product.length || sel.product.includes(p) ? 1 : 0.3}
                           onClick={() => toggle("product", p)} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}</PanelFill>
            </SalesPanel>
          </div>

          {/* ── By month, this year against last ────────────────────────────── */}
          <SalesPanel title="Net sales by month — this year against last" icon={TrendingUp} loading={loading}
                      empty={!loading && !byMonth.length} emptyMessage="No sales in this year yet."
                      subtitle={sel.month.length ? `filtered to ${sel.month.join(", ")} — click the month again to clear`
                        : "click a month to filter every panel"}
                      sizeKey="sp-month">
            <PanelFill base={300}>{(bar) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth} margin={{ top: 8, right: 8, left: 4, bottom: 4 }} barGap={2}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} tickFormatter={tick} />
                  <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} formatter={(v: number, n: string) => [fmtSales(v), n]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  {(["This year", "Last year"] as const).map((s) => (
                    <Bar key={s} dataKey={s} fill={s === "This year" ? CUR_COLOR : PRE_COLOR} maxBarSize={bar(26)} radius={[4, 4, 0, 0]}
                         className="cursor-pointer" onClick={(d: { label?: string }) => d?.label && toggle("month", d.label)}>
                      {byMonth.map((p) => (
                        <Cell key={p.key} fillOpacity={!sel.month.length || sel.month.includes(p.label) ? 1 : 0.3} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}</PanelFill>
          </SalesPanel>
        </>
      )}

      {/* ── Salesperson summary ───────────────────────────────────────────── */}
      <SalespersonTable people={people} total={totals.net} loading={loading} fy={fy} lastFy={lastFy}
                        cur={cur} pre={pre} windowLabel={windowLabel} />

      {/* ── The register lines ────────────────────────────────────────────── */}
      <LinesTable lines={cur} loading={loading} from={`${fyStart}0401`} to={cutoff} />
    </div>
  );
}

/* ================================================================== figures */

interface Person {
  name: string;
  net: number; prev: number;
  customers: number; vouchers: number;
  inkQty: number; inkVal: number; machineQty: number; machineVal: number;
  headsSparesVal: number; otherVal: number;
  byProduct: Record<string, number>;
}

/** One customer under a salesperson, as the opened row and the export show it. */
interface CustomerLine {
  party: string;
  net: number; prev: number;
  inkQty: number; ink: number;
  machineQty: number; machine: number;
  headsSpares: number; other: number;
  /** [Category, net count], biggest first. */
  machineCats: [string, number][];
  companies: string; locations: string;
  vouchers: number;
  /** YYYYMMDD, "" when only last year. */
  lastSale: string;
}

/** One record per salesperson (this year), with last year's same days beside it. */
function summarise(cur: Tagged[], pre: Tagged[]): Person[] {
  const m = new Map<string, Person & { cust: Set<string>; vch: Set<string> }>();
  const at = (name: string) => {
    let p = m.get(name);
    if (!p) {
      p = { name, net: 0, prev: 0, customers: 0, vouchers: 0, inkQty: 0, inkVal: 0, machineQty: 0, machineVal: 0,
            headsSparesVal: 0, otherVal: 0, byProduct: {}, cust: new Set(), vch: new Set() };
      m.set(name, p);
    }
    return p;
  };
  for (const { r, sp } of cur) {
    const p = at(sp);
    const prod = productOf(r.sales_type);
    p.net += r.revenue;
    p.byProduct[prod] = (p.byProduct[prod] ?? 0) + r.revenue;
    if (prod === "Ink") { p.inkQty += r.quantity; p.inkVal += r.revenue; }
    else if (prod === "Machine") { p.machineQty += r.quantity; p.machineVal += r.revenue; }
    else if (prod === "Heads" || prod === "Spare Parts") p.headsSparesVal += r.revenue;
    else p.otherVal += r.revenue;
    p.cust.add(r.party);
    p.vch.add(`${r.tenant_id}|${r.voucher_no}`);
  }
  for (const { r, sp } of pre) at(sp).prev += r.revenue;
  return [...m.values()]
    .map(({ cust, vch, ...p }) => ({ ...p, customers: cust.size, vouchers: vch.size }))
    // Not assigned last, so it never reads as the top salesperson.
    .sort((a, b) => (a.name === NOT_ASSIGNED ? 1 : 0) - (b.name === NOT_ASSIGNED ? 1 : 0) || b.net - a.net);
}

function Kpi({ icon: Icon, accent, label, value, sub, loading }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string;
  label: string; value: string; sub?: string; loading?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2 shadow-sm" title={value}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="truncate">{label}</span>
      </div>
      {loading ? <div className="mt-1 h-5 w-2/3 animate-pulse rounded bg-muted/60" />
        : <div className="truncate text-[19px] font-bold leading-tight text-foreground">{value}</div>}
      {sub && <div className="truncate text-[10px] leading-snug text-muted-foreground">{sub}</div>}
      <div className="mt-1.5 h-[3px] w-full rounded-full" style={{ background: `${accent}33` }}>
        <div className="h-full w-1/3 rounded-full" style={{ background: accent }} />
      </div>
    </div>
  );
}

function SortHead({ label, right, on, dir, onClick }: { label: string; right?: boolean; on: boolean; dir: 1 | -1; onClick: () => void }) {
  return (
    <th className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", right ? "text-right" : "text-left")}>
      <button type="button" onClick={onClick} title={`Sort by ${label}`}
              className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", on && "text-foreground")}>
        {label}
        {!on ? <ArrowUpDown className="h-3 w-3 opacity-40" /> : dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </button>
    </th>
  );
}

/* ======================================================= the salesperson table */

const SP_COLS: { key: string; header: string; right?: boolean; get: (p: Person, total: number) => string | number; show: (p: Person, total: number) => React.ReactNode }[] = [
  { key: "name", header: "Salesperson", get: (p) => p.name, show: (p) => <span className="font-medium">{p.name}</span> },
  { key: "customers", header: "Customers", right: true, get: (p) => p.customers, show: (p) => fmtInt(p.customers) },
  { key: "vouchers", header: "Vouchers", right: true, get: (p) => p.vouchers, show: (p) => fmtInt(p.vouchers) },
  { key: "inkQty", header: "Ink Qty", right: true, get: (p) => p.inkQty, show: (p) => (p.inkQty ? fmtKg(p.inkQty) : "—") },
  { key: "inkVal", header: "Ink", right: true, get: (p) => p.inkVal, show: (p) => (p.inkVal ? fmtSales(p.inkVal) : "—") },
  { key: "machineQty", header: "Machines", right: true, get: (p) => p.machineQty, show: (p) => (p.machineQty ? fmtNos(p.machineQty) : "—") },
  { key: "machineVal", header: "Machine Value", right: true, get: (p) => p.machineVal, show: (p) => (p.machineVal ? fmtSales(p.machineVal) : "—") },
  { key: "headsSparesVal", header: "Heads & Spares", right: true, get: (p) => p.headsSparesVal, show: (p) => (p.headsSparesVal ? fmtSales(p.headsSparesVal) : "—") },
  { key: "otherVal", header: "Other", right: true, get: (p) => p.otherVal, show: (p) => (p.otherVal ? fmtSales(p.otherVal) : "—") },
  { key: "net", header: "Net Sales", right: true, get: (p) => p.net, show: (p) => <span className="font-semibold">{fmtSales(p.net)}</span> },
  { key: "prev", header: "Last Year", right: true, get: (p) => p.prev, show: (p) => <span className="text-muted-foreground">{fmtSales(p.prev)}</span> },
  { key: "growth", header: "Growth", right: true, get: (p) => growth(p.net, p.prev) ?? -Infinity,
    show: (p) => {
      const g = growth(p.net, p.prev);
      return <span className={cn("font-semibold", g === null ? "text-muted-foreground" : g >= 0 ? "text-[#0ca30c]" : "text-destructive")}>{growthText(p.net, p.prev)}</span>;
    } },
  { key: "share", header: "Share", right: true, get: (p, t) => (t ? p.net / t : 0), show: (p, t) => pct(p.net, t) },
];

function SalespersonTable({ people, total, loading, fy, lastFy, cur, pre, windowLabel }: {
  people: Person[]; total: number; loading: boolean; fy: string; lastFy: string; cur: Tagged[]; pre: Tagged[]; windowLabel: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "net", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => {
    const col = SP_COLS.find((c) => c.key === sort.key) ?? SP_COLS[9];
    return [...people].sort((a, b) => {
      const x = col.get(a, total), y = col.get(b, total);
      return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [people, sort, total]);
  const toggleSort = (key: string, right?: boolean) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: right ? -1 : 1 });

  /**
   * A salesperson's customers, this year against last, with WHICH machines they took: the machine
   * lines' Category (Central Masters), each with its net count — "KYOCERA 600 DPI - STANDARD × 2".
   */
  const customersOf = (name: string) => {
    const m = new Map<string, CustomerLine & { cats: Map<string, number>; vch: Set<string>; companySet: Set<string>; locationSet: Set<string> }>();
    const at = (party: string) => m.get(party) ?? m.set(party, {
      party, net: 0, prev: 0, inkQty: 0, ink: 0, machineQty: 0, machine: 0, headsSpares: 0, other: 0,
      machineCats: [], companies: "", locations: "", vouchers: 0, lastSale: "",
      cats: new Map(), vch: new Set(), companySet: new Set(), locationSet: new Set(),
    }).get(party)!;
    for (const { r, sp } of cur) if (sp === name) {
      const c = at(r.party);
      c.net += r.revenue;
      const p = productOf(r.sales_type);
      if (p === "Ink") { c.inkQty += r.quantity; c.ink += r.revenue; }
      else if (p === "Machine") {
        c.machineQty += r.quantity; c.machine += r.revenue;
        // A discount line on a machine has no item, so no category and no count — leave it out.
        if (r.quantity) {
          const cat = itemCell(DIMS.category(r)) || r.particulars;
          c.cats.set(cat, (c.cats.get(cat) ?? 0) + r.quantity);
        }
      }
      else if (p === "Heads" || p === "Spare Parts") c.headsSpares += r.revenue;
      else c.other += r.revenue;
      c.vch.add(`${r.tenant_id}|${r.voucher_no}`);
      c.companySet.add(r.company);
      c.locationSet.add(r.location_name);
      if (r.vch_date > c.lastSale) c.lastSale = r.vch_date;
    }
    for (const { r, sp } of pre) if (sp === name) at(r.party).prev += r.revenue;
    return [...m.values()]
      .map(({ cats, vch, companySet, locationSet, ...c }): CustomerLine => ({
        ...c,
        machineCats: [...cats].filter(([, n]) => n !== 0).sort((a, b) => b[1] - a[1]),
        companies: [...companySet].sort().join(", "),
        locations: [...locationSet].sort().join(", "),
        vouchers: vch.size,
      }))
      .sort((a, b) => b.net - a.net);
  };
  const catText = (cats: [string, number][]) => cats.map(([cat, n]) => `${cat} × ${nf2.format(n)}`).join(", ");

  const exportXlsx = () => {
    const head = SP_COLS.map((c) => c.header);
    const ws = XLSX.utils.aoa_to_sheet([head, ...sorted.map((p) => SP_COLS.map((c) => {
      const v = c.get(p, total);
      if (c.key === "growth") { const g = growth(p.net, p.prev); return g === null ? "" : Math.round(g * 10) / 10; }
      if (c.key === "share") return total ? Math.round((p.net / total) * 1000) / 10 : 0;
      return typeof v === "number" ? Math.round(v * 100) / 100 : v;
    }))]);
    ws["!cols"] = SP_COLS.map((c) => ({ wch: c.key === "name" ? 28 : 14 }));
    head.forEach((_, i) => { const a = XLSX.utils.encode_cell({ r: 0, c: i }); if (ws[a]) ws[a].s = { font: { bold: true } }; });
    const custHead = ["Salesperson", "Customer", "Company", "Location", "Machine Category", "Machines", "Machine Value",
                      "Ink Qty (KG)", "Ink Value", "Heads & Spares", "Other", "Net Sales", "Last Year", "Growth %", "Vouchers", "Last Sale"];
    const wsC = XLSX.utils.aoa_to_sheet([
      custHead,
      ...sorted.flatMap((p) => customersOf(p.name).map((c) => {
        const g = growth(c.net, c.prev);
        return [p.name, c.party, c.companies, c.locations, catText(c.machineCats), c.machineQty, Math.round(c.machine),
                Math.round(c.inkQty * 100) / 100, Math.round(c.ink), Math.round(c.headsSpares), Math.round(c.other),
                Math.round(c.net), Math.round(c.prev), g === null ? "" : Math.round(g * 10) / 10, c.vouchers, dmy(c.lastSale)];
      })),
    ]);
    wsC["!cols"] = custHead.map((h) => ({ wch: h === "Customer" || h === "Machine Category" ? 40 : h === "Salesperson" || h === "Company" ? 26 : 13 }));
    const info = XLSX.utils.aoa_to_sheet([
      ["Salesperson Sales"], ["Window", windowLabel],
      ["Salesperson", "the tag on the customer's ledger in Masters; untagged = (Not assigned)"],
      ["Lines", "pure sales only — no FOC, branch or related-party lines; net of returns and discounts"],
      ["Growth / Share", "percent"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Salespersons");
    XLSX.utils.book_append_sheet(wb, wsC, "Customers");
    XLSX.utils.book_append_sheet(wb, info, "Report Info");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Salesperson_Sales_FY_${fy}.xlsx`);
  };

  return (
    <SalesPanel title="Salesperson summary" icon={UserCheck} loading={loading}
                subtitle={`${fmtInt(people.length)} salespersons · FY ${fy} against the same days of FY ${lastFy} · click a row for its customers`}
                actions={
                  <Button onClick={exportXlsx} disabled={!people.length}
                          className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90">
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                }>
      <ScrollableTable className="rounded-md border border-border" maxHeight="max-h-[60vh]" resizeKey="bushra-salesperson-summary">
        <table className="w-full min-w-[1300px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-muted/80">
            <tr className="border-b border-border">
              {SP_COLS.map((c) => (
                <SortHead key={c.key} label={c.header} right={c.right} on={sort.key === c.key} dir={sort.dir}
                          onClick={() => toggleSort(c.key, c.right)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={SP_COLS.length} className="py-8 text-center text-[12px] text-muted-foreground">No sales match those filters.</td></tr>
            ) : sorted.map((p) => (
              <Fragment key={p.name}>
                <tr onClick={() => setOpen((o) => (o === p.name ? null : p.name))}
                    className={cn("cursor-pointer border-b border-border/40 hover:bg-muted/40", open === p.name && "bg-muted/30",
                                  p.name === NOT_ASSIGNED && "text-muted-foreground")}>
                  {SP_COLS.map((c, i) => (
                    <td key={c.key} className={cn("whitespace-nowrap px-3 py-1.5", c.right && "text-right tabular-nums")}>
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open === p.name && "rotate-90")} />
                          {c.show(p, total)}
                        </span>
                      ) : c.show(p, total)}
                    </td>
                  ))}
                </tr>
                {open === p.name && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td colSpan={SP_COLS.length} className="px-6 py-2">
                      <div className="max-h-[420px] overflow-auto">
                        <table className="w-full min-w-[1500px] text-[12px]">
                          <thead className="sticky top-0 z-[1] bg-muted">
                            <tr className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                              <th className="py-1 pr-3 text-left font-semibold">Customer</th>
                              <th className="px-3 py-1 text-left font-semibold">Company</th>
                              <th className="px-3 py-1 text-left font-semibold">Location</th>
                              <th className="px-3 py-1 text-left font-semibold">Machine Category</th>
                              <th className="px-3 py-1 text-right font-semibold">Machines</th>
                              <th className="px-3 py-1 text-right font-semibold">Machine Value</th>
                              <th className="px-3 py-1 text-right font-semibold">Ink Qty</th>
                              <th className="px-3 py-1 text-right font-semibold">Ink</th>
                              <th className="px-3 py-1 text-right font-semibold">Heads & Spares</th>
                              <th className="px-3 py-1 text-right font-semibold">Other</th>
                              <th className="px-3 py-1 text-right font-semibold">Net Sales</th>
                              <th className="px-3 py-1 text-right font-semibold">Last Year</th>
                              <th className="px-3 py-1 text-right font-semibold">Growth</th>
                              <th className="px-3 py-1 text-right font-semibold">Vouchers</th>
                              <th className="pl-3 py-1 text-right font-semibold">Last Sale</th>
                            </tr>
                          </thead>
                          <tbody>
                            {customersOf(p.name).map((c) => {
                              const g = growth(c.net, c.prev);
                              return (
                                <tr key={c.party} className="border-t border-border/40 align-top">
                                  <td className="py-1 pr-3">{c.party}</td>
                                  <td className="px-3 py-1 whitespace-nowrap">{c.companies}</td>
                                  <td className="px-3 py-1 whitespace-nowrap">{c.locations}</td>
                                  <td className="px-3 py-1">
                                    {c.machineCats.length ? (
                                      <div className="flex flex-col gap-0.5">
                                        {c.machineCats.map(([cat, n]) => (
                                          <span key={cat} className="whitespace-nowrap">
                                            {cat} <span className="font-semibold text-foreground">× {nf2.format(n)}</span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : "—"}
                                  </td>
                                  <td className="px-3 py-1 text-right tabular-nums">{c.machineQty ? fmtNos(c.machineQty) : "—"}</td>
                                  <td className="px-3 py-1 text-right tabular-nums">{c.machine ? fmtSales(c.machine) : "—"}</td>
                                  <td className="px-3 py-1 text-right tabular-nums">{c.inkQty ? fmtKg(c.inkQty) : "—"}</td>
                                  <td className="px-3 py-1 text-right tabular-nums">{c.ink ? fmtSales(c.ink) : "—"}</td>
                                  <td className="px-3 py-1 text-right tabular-nums">{c.headsSpares ? fmtSales(c.headsSpares) : "—"}</td>
                                  <td className="px-3 py-1 text-right tabular-nums">{c.other ? fmtSales(c.other) : "—"}</td>
                                  <td className="px-3 py-1 text-right font-medium tabular-nums">{fmtSales(c.net)}</td>
                                  <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{fmtSales(c.prev)}</td>
                                  <td className={cn("px-3 py-1 text-right tabular-nums", g === null ? "text-muted-foreground" : g >= 0 ? "text-[#0ca30c]" : "text-destructive")}>
                                    {growthText(c.net, c.prev)}
                                  </td>
                                  <td className="px-3 py-1 text-right tabular-nums">{fmtInt(c.vouchers)}</td>
                                  <td className="pl-3 py-1 text-right tabular-nums whitespace-nowrap">{dmy(c.lastSale) || "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </SalesPanel>
  );
}

/* =========================================================== the register lines */

const itemCell = (v: string) => (v === NOT_SET ? "" : v);
const LINE_COLS: { key: string; header: string; right?: boolean; sort: (t: Tagged) => string | number; cell: (t: Tagged) => React.ReactNode }[] = [
  { key: "date", header: "Date", sort: (t) => t.r.vch_date, cell: (t) => t.r.date_display },
  { key: "voucher", header: "Voucher No.", sort: (t) => t.r.voucher_no, cell: (t) => t.r.voucher_no },
  { key: "salesperson", header: "Salesperson", sort: (t) => t.sp, cell: (t) => <span className={cn(t.sp === NOT_ASSIGNED && "text-muted-foreground")}>{t.sp}</span> },
  { key: "type", header: "Type", sort: (t) => DIMS.type(t.r), cell: (t) => DIMS.type(t.r) },
  { key: "company", header: "Company", sort: (t) => t.r.company, cell: (t) => t.r.company },
  { key: "location", header: "Location", sort: (t) => t.r.location_name, cell: (t) => t.r.location_name },
  { key: "product", header: "Product", sort: (t) => DIMS.salesType(t.r), cell: (t) => DIMS.salesType(t.r) },
  { key: "party", header: "Customer Name", sort: (t) => t.r.party, cell: (t) => t.r.party },
  { key: "particulars", header: "Particulars", sort: (t) => t.r.particulars, cell: (t) => t.r.particulars },
  { key: "quantity", header: "Quantity", right: true, sort: (t) => t.r.quantity, cell: (t) => (t.r.quantity ? nf2.format(t.r.quantity) : "—") },
  { key: "rate", header: "Rate", right: true, sort: (t) => t.r.rate, cell: (t) => (t.r.rate ? nf2.format(t.r.rate) : "—") },
  { key: "revenue", header: "Revenue", right: true, sort: (t) => t.r.revenue,
    cell: (t) => <span className={cn(t.r.revenue < 0 && "text-destructive")}>{nf2.format(t.r.revenue)}</span> },
  { key: "category", header: "Category", sort: (t) => itemCell(DIMS.category(t.r)), cell: (t) => itemCell(DIMS.category(t.r)) },
  { key: "group", header: "Group", sort: (t) => itemCell(DIMS.group(t.r)), cell: (t) => itemCell(DIMS.group(t.r)) },
  { key: "inkType", header: "Ink Type", sort: (t) => itemCell(DIMS.inkType(t.r)), cell: (t) => itemCell(DIMS.inkType(t.r)) },
  { key: "colour", header: "Colour", sort: (t) => itemCell(DIMS.colour(t.r)), cell: (t) => itemCell(DIMS.colour(t.r)) },
];
const LINE_OPTIONS: ColumnOption[] = LINE_COLS.map((c) => ({ key: c.key, label: c.header }));
const LINE_COLS_KEY = "orangeone.cols.bushra-salesperson-lines";
const readLineCols = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(LINE_COLS_KEY) ?? "null");
    const kept = Array.isArray(v) ? LINE_COLS.map((c) => c.key).filter((k) => v.includes(k)) : [];
    return kept.length ? kept : LINE_COLS.map((c) => c.key);
  } catch { return LINE_COLS.map((c) => c.key); }
};

function LinesTable({ lines, loading, from, to }: { lines: Tagged[]; loading: boolean; from: string; to: string }) {
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState<string[]>(readLineCols);
  const pickCols = (v: string[]) => {
    setVisible(v);
    try { localStorage.setItem(LINE_COLS_KEY, JSON.stringify(v)); } catch { /* private window: just not kept */ }
  };
  const cols = useMemo(() => LINE_COLS.filter((c) => visible.includes(c.key)), [visible]);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return lines;
    return lines.filter((t) => t.r.party.toLowerCase().includes(s) || t.r.particulars.toLowerCase().includes(s) ||
      t.r.voucher_no.toLowerCase().includes(s) || t.sp.toLowerCase().includes(s));
  }, [lines, q]);
  const sorted = useMemo(() => {
    if (!sort) return searched;
    const get = LINE_COLS.find((c) => c.key === sort.key)!.sort;
    return [...searched].sort((a, b) => {
      const x = get(a), y = get(b);
      return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [searched, sort]);
  const toggleSort = (key: string, right?: boolean) => setSort((s) =>
    s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: right ? -1 : 1 });
  const page = usePagination(sorted, { resetKey: `${lines.length}|${q}|${sort?.key}|${sort?.dir}` });
  const total = useMemo(() => searched.reduce((s, t) => s + t.r.revenue, 0), [searched]);
  const spOfRow = useMemo(() => new Map(searched.map((t) => [t.r, t.sp])), [searched]);
  const extra: ExtraColumn<Row>[] = [
    { header: "SALESPERSON", width: 22, get: (r) => spOfRow.get(r) ?? NOT_ASSIGNED },
    { header: "PRODUCT", width: 14, get: (r) => DIMS.salesType(r) },
    { header: "CATEGORY", width: 22, get: (r) => itemCell(DIMS.category(r)) },
    { header: "GROUP", width: 22, get: (r) => itemCell(DIMS.group(r)) },
    { header: "INK TYPE", width: 22, get: (r) => itemCell(DIMS.inkType(r)) },
    { header: "COLOUR", width: 12, get: (r) => itemCell(DIMS.colour(r)) },
  ];

  return (
    <SalesPanel title="Sales register by salesperson" icon={Table2} loading={loading}
                subtitle={`${fmtInt(searched.length)} lines · revenue ${fmtSales(total)}`}
                actions={
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, particulars, voucher, salesperson…"
                             className="h-8 w-64 rounded-input pl-7 text-[12px]" />
                    </div>
                    <ColumnPicker columns={LINE_OPTIONS} visible={visible} onChange={pickCols} triggerClassName="h-8 text-[12px]" />
                    <Button onClick={() => sorted.length && exportSalesRegisterXlsx(sorted.map((t) => t.r), { from, to, extra, filePrefix: "Bushra_Salesperson_Sales" })}
                            disabled={!sorted.length}
                            className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90">
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </div>
                }>
      <ScrollableTable className="rounded-md border border-border" maxHeight="max-h-[60vh]" resizeKey="bushra-salesperson-lines">
        <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: Math.max(900, cols.length * 120) }}>
          <thead className="sticky top-0 z-10 bg-muted/80">
            <tr className="border-b border-border">
              {cols.map((c) => (
                <SortHead key={c.key} label={c.header} right={c.right} on={sort?.key === c.key} dir={sort?.dir ?? 1}
                          onClick={() => toggleSort(c.key, c.right)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.length === 0 ? (
              <tr><td colSpan={cols.length} className="py-8 text-center text-[12px] text-muted-foreground">No lines match those filters.</td></tr>
            ) : page.pageItems.map((t, i) => (
              <tr key={`${t.r.tenant_id}-${t.r.voucher_no}-${t.r.line_no}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
                {cols.map((c) => (
                  <td key={c.key} className={cn("px-3 py-1.5", c.key === "party" || c.key === "particulars" ? "" : "whitespace-nowrap",
                                                c.right && "text-right tabular-nums")}>
                    {c.cell(t)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <Pagination state={page} rowsLabel="lines" />
    </SalesPanel>
  );
}
