/**
 * Active / In-active Ink Customers — Bushra-Dashboard → Sales (the dashboard) and Bushra-Report (the
 * list). Who still buys our ink, who has gone quiet, and for how long. The rules are in
 * lib/bushraInkActivity.ts; the layout follows the business's own Excel (an Inactive Months slicer,
 * the customer list with its last sale, and the category × colour × month pivot), with the
 * salesperson, company, location and ageing band added.
 *
 * Clicking a band, a month-count bar or a salesperson filters every panel; click again to let go.
 */
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import * as XLSX from "xlsx-js-style";
import { saveAs } from "file-saver";
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ChevronRight, Download, Droplet, Hourglass, RotateCcw,
  Search, Table2, UserCheck, UserX, Users,
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
import { fmtSales } from "@hub/lib/salesReport";
import { currentFy, ymd } from "@hub/lib/salesRegister";
import { loadBushraSalesRegister, loadItemLookup, type BushraRegisterRow } from "@hub/lib/bushraSalesRegister";
import { SALES_DASHBOARDS } from "@hub/lib/bushraSalesDashboards";
import { fmtInt, makeQtyFmt, monthName } from "@hub/lib/bushraSalesFigures";
import { loadGroupLink } from "@hub/lib/bushraOrangeCustomers";
import { NOT_ASSIGNED, loadSalespersonLink } from "@hub/lib/bushraSalespersonSales";
import { BANDS, bandOf, inkCustomers, monthsBetween, type Band, type InkCustomer } from "@hub/lib/bushraInkActivity";
import { useScopedParties } from "@hub/lib/scopeParties";
import { useReportAccess } from "@hub/lib/reportAccess";
import { appBasePath } from "@/apps/appInfo";

const BASE = appBasePath("reports");
export const INK_ACTIVE_DASHBOARD_ID = "bushra-sales-ink-active";
export const INK_ACTIVE_DASHBOARD_PATH = "bushra-dashboard/sales-ink-active";
export const INK_ACTIVE_REPORT_ID = "bushra-ink-active-customers";

const BAND_COLOR: Record<Band, string> = {
  Active: "#16a34a", "Under 3 m": "#ca8a04", "3–6 m": "#ea580c", "6–12 m": "#dc2626", "12 m+": "#7f1d1d",
};
const CHART_GRID = "hsl(220 15% 92%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 45%)" };
const LABEL_FILL = "hsl(220 20% 30%)";
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const fmtKg = makeQtyFmt("kg", []);
const nf1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const dmy = (d: string) => (d ? `${d.slice(6)}-${d.slice(4, 6)}-${d.slice(0, 4)}` : "");
/** The slicer's choices, as in the Excel. */
const THRESHOLDS = Array.from({ length: 15 }, (_, i) => i + 1);

type Row = BushraRegisterRow;
/** A customer with today's reading of it. */
interface Read extends InkCustomer { months: number; band: Band; status: "Active" | "In-active"; sp: string }

const FILTERS = {
  status: { label: "Status", all: "All", unit: "Statuses", get: (c: Read) => c.status },
  band: { label: "Ageing", all: "All bands", unit: "Bands", get: (c: Read) => c.band },
  salesperson: { label: "Salesperson", all: "All Salespersons", unit: "Salespersons", get: (c: Read) => c.sp },
  company: { label: "Company", all: "All Companies", unit: "Companies", get: (c: Read) => c.companies },
  location: { label: "Location", all: "All Locations", unit: "Locations", get: (c: Read) => c.locations },
  category: { label: "Main Category", all: "All Categories", unit: "Categories", get: (c: Read) => c.categories },
  group: { label: "Customer", all: "All Customers", unit: "Customers", get: (c: Read) => c.group },
} as const;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const NO_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, []])) as unknown as Record<FilterKey, string[]>;
/** A filter value can be one value or several (a customer billed by two companies matches either). */
const valuesOf = (k: FilterKey, c: Read): string[] => { const v = FILTERS[k].get(c); return Array.isArray(v) ? v : [v as string]; };

export default function BushraInkActiveCustomers({ mode }: { mode: "dashboard" | "report" }) {
  const { canSee } = useReportAccess();
  const fyStart = Number(currentFy().slice(0, 4));
  const from = `${fyStart - 1}0401`;
  const today = ymd(new Date());

  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");
  // The Sales dashboards' own cache keys — one load between all of them.
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v4"], queryFn: loadItemLookup, staleTime: 30 * 60 * 1000,
  });
  const { data, isLoading, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraSalesRegister", "v8", from, today, scopeKey],
    queryFn: () => loadBushraSalesRegister(from, today, scope, lookup),
    enabled: !scopeLoading && !!lookup, staleTime: 5 * 60 * 1000,
  });
  const { data: groupLink, error: gErr } = useQuery({
    queryKey: ["bushraOrangeCustomers", "groupLink", "v1"], queryFn: loadGroupLink, staleTime: 30 * 60 * 1000,
  });
  const { data: spOf, error: sErr } = useQuery({
    queryKey: ["bushraSalespersonSales", "link", "v1"], queryFn: loadSalespersonLink, staleTime: 30 * 60 * 1000,
  });
  const err = lookupError ?? rowsError ?? gErr ?? sErr;
  const errText = err ? (err as Error).message : null;
  const loading = (isLoading || !lookup || !groupLink || !spOf) && !errText;

  /** The Excel's Inactive Months slicer. */
  const [threshold, setThreshold] = useState(3);
  const customers = useMemo(
    () => (groupLink && spOf ? inkCustomers(data ?? [], groupLink.of, spOf, today) : []),
    [data, groupLink, spOf, today],
  );
  const read = useMemo<Read[]>(() => customers.map((c) => {
    const months = monthsBetween(c.lastSale, today);
    const band = bandOf(months, threshold);
    return { ...c, months, band, status: band === "Active" ? "Active" : "In-active", sp: c.salesperson || NOT_ASSIGNED };
  }), [customers, today, threshold]);

  /* -------- filters -------- */
  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  /** A bar click on the months chart — one months-inactive value. */
  const [monthsPick, setMonthsPick] = useState<number | null>(null);
  const keep = (c: Read, except?: FilterKey) =>
    FILTER_KEYS.every((k) => k === except || !sel[k].length || valuesOf(k, c).some((v) => sel[k].includes(v)));
  const shown = useMemo(
    () => read.filter((c) => keep(c) && (monthsPick === null || Math.min(c.months, 15) === monthsPick)),
    [read, sel, monthsPick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const options = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => {
    const vals = new Set<string>();
    for (const c of read) if (keep(c, k)) for (const v of valuesOf(k, c)) vals.add(v);
    const list = [...vals];
    if (k === "band") list.sort((a, b) => BANDS.indexOf(a as Band) - BANDS.indexOf(b as Band));
    else list.sort(collator.compare);
    return [k, list.map((v) => ({ value: v, label: v }))];
  })) as Record<FilterKey, MultiSelectOption[]>, [read, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFilter = (k: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [k]: v }));
  const toggle = (k: FilterKey, v: string) =>
    setSel((s) => ({ ...s, [k]: s[k].length === 1 && s[k][0] === v ? [] : [v] }));
  const filterCount = FILTER_KEYS.reduce((n, k) => n + sel[k].length, 0) + (monthsPick === null ? 0 : 1);
  const resetAll = () => { setSel(NO_FILTERS); setMonthsPick(null); };

  /* -------- figures -------- */
  const kpi = useMemo(() => {
    const k = { active: 0, inactive: 0, activeVal12: 0, inactiveVal12: 0, inactiveQty12: 0, byBand: {} as Record<Band, number> };
    for (const b of BANDS) k.byBand[b] = 0;
    for (const c of shown) {
      k.byBand[c.band]++;
      if (c.status === "Active") { k.active++; k.activeVal12 += c.value12; }
      else { k.inactive++; k.inactiveVal12 += c.value12; k.inactiveQty12 += c.qty12; }
    }
    return k;
  }, [shown]);
  /** Customers by months since their last ink — 0 … 14, and 15 for "15 and over", as the slicer runs. */
  const byMonths = useMemo(() => {
    const out = Array.from({ length: 16 }, (_, m) => ({ m, label: m === 15 ? "15+" : String(m), customers: 0 }));
    for (const c of read.filter((x) => keep(x))) out[Math.min(c.months, 15)].customers++;
    return out;
  }, [read, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const bySalesperson = useMemo(() => {
    const m = new Map<string, { name: string; inactive: number; active: number; lost: number }>();
    for (const c of shown) {
      const p = m.get(c.sp) ?? m.set(c.sp, { name: c.sp, inactive: 0, active: 0, lost: 0 }).get(c.sp)!;
      if (c.status === "Active") p.active++; else { p.inactive++; p.lost += c.value12; }
    }
    return [...m.values()].filter((p) => p.inactive > 0).sort((a, b) => b.inactive - a.inactive).slice(0, 20);
  }, [shown]);

  const salesTabs = SALES_DASHBOARDS.filter((p) => canSee(p.id));
  const tab = "rounded-pill border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground";

  return (
    <div className="p-4 lg:p-6 max-w-[1700px] mx-auto space-y-3">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="min-w-0">
          <Link to={mode === "dashboard" ? `${BASE}/bushra-dashboard?group=sales` : BASE}
                className="mb-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> {mode === "dashboard" ? "Sales" : "Reports"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-[19px] font-bold tracking-tight text-foreground">Active / In-active Ink Customers</h1>
            <span className="text-[12px] text-muted-foreground">
              · months since each customer's last ink purchase · by Customer Group · data from {dmy(from)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {mode === "dashboard" && canSee(INK_ACTIVE_REPORT_ID) && (
            <Link to={`${BASE}/bushra-ink-active-customers`} className="text-primary hover:underline">Customer list report</Link>
          )}
          {mode === "report" && canSee(INK_ACTIVE_DASHBOARD_ID) && (
            <Link to={`${BASE}/${INK_ACTIVE_DASHBOARD_PATH}`} className="text-primary hover:underline">Dashboard</Link>
          )}
        </div>
      </div>

      {mode === "dashboard" && (
        <nav className="flex flex-wrap gap-1.5">
          {salesTabs.map((p) => (
            <Link key={p.id} to={`${BASE}/${p.path}`} className={tab}>{p.id === "bushra-sales-dashboard" ? "Sales" : p.title}</Link>
          ))}
          {canSee("bushra-sales-orange-customers") && <Link to={`${BASE}/bushra-dashboard/sales-orange-customers`} className={tab}>Orange vs Non-Orange</Link>}
          {canSee("bushra-sales-salesperson") && <Link to={`${BASE}/bushra-dashboard/sales-salesperson`} className={tab}>Salesperson</Link>}
          <span className="rounded-pill border border-primary bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground">Active / In-active Ink</span>
        </nav>
      )}

      {/* ── The slicer + filters ──────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Inactive months</span>
          {THRESHOLDS.map((n) => (
            <button key={n} type="button" onClick={() => setThreshold(n)}
                    title={`In-active = no ink bought for ${n} month${n === 1 ? "" : "s"} or more`}
                    className={cn("h-7 min-w-[34px] rounded-md border px-2 text-[12px] font-medium tabular-nums transition-colors",
                                  threshold === n ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border bg-surface text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
              {n}
            </button>
          ))}
          <span className="ml-1 text-[11px] text-muted-foreground">
            In-active = no ink for <b className="text-foreground">{threshold}</b> month{threshold === 1 ? "" : "s"} or more
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          {FILTER_KEYS.map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{FILTERS[k].label}</span>
              <MultiSelectFilter options={options[k]} value={sel[k]} onChange={setFilter(k)}
                                 allLabel={FILTERS[k].all} unit={FILTERS[k].unit} searchable
                                 triggerClassName={cn("h-8 text-[12px] rounded-input border-border", k === "group" || k === "category" || k === "salesperson" ? "w-[190px]" : "w-[130px]")}
                                 contentClassName={k === "group" || k === "category" ? "w-80" : undefined} />
            </label>
          ))}
          <Button onClick={resetAll} disabled={!filterCount}
                  className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Reset All
          </Button>
          <span className="ml-auto rounded-pill bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {fmtInt(shown.length)} ink customers · as on {dmy(today)}
          </span>
        </div>
      </div>

      {errText && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">{errText}</div>}

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icon={UserCheck} accent={BAND_COLOR.Active} label="Active customers" loading={loading}
             value={fmtInt(kpi.active)} sub={`bought ink in the last ${threshold} month${threshold === 1 ? "" : "s"}`}
             on={sel.status.length === 1 && sel.status[0] === "Active"} onClick={() => toggle("status", "Active")} />
        <Kpi icon={UserX} accent="#dc2626" label="In-active customers" loading={loading}
             value={fmtInt(kpi.inactive)} sub={`${shown.length ? Math.round((kpi.inactive / shown.length) * 100) : 0}% of ink customers`}
             on={sel.status.length === 1 && sel.status[0] === "In-active"} onClick={() => toggle("status", "In-active")} />
        <Kpi icon={Droplet} accent="#2563eb" label="Ink from in-actives, last 12 m" loading={loading}
             value={fmtSales(kpi.inactiveVal12)} sub={`${fmtKg(kpi.inactiveQty12)} — the business at risk`} />
        <Kpi icon={Users} accent="#16a34a" label="Ink from actives, last 12 m" loading={loading}
             value={fmtSales(kpi.activeVal12)} sub="what the active base buys" />
      </div>

      {/* ── Ageing bands ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {BANDS.map((b) => {
          const on = sel.band.length === 1 && sel.band[0] === b;
          return (
            <button key={b} type="button" onClick={() => toggle("band", b)}
                    className={cn("flex min-w-[120px] flex-1 items-center justify-between gap-2 rounded-lg border bg-surface px-3 py-2 text-left shadow-sm hover:bg-muted/30",
                                  on ? "border-2" : "border-border", sel.band.length && !on && "opacity-50")}
                    style={on ? { borderColor: BAND_COLOR[b] } : undefined}
                    title={on ? "Click again to show every band" : `Filter every panel to ${b}`}>
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_COLOR[b] }} /> {b}
              </span>
              <span className="text-[17px] font-bold tabular-nums text-foreground">{loading ? "…" : fmtInt(kpi.byBand[b])}</span>
            </button>
          );
        })}
      </div>

      {mode === "dashboard" && (
        <div className="grid gap-3 xl:grid-cols-2">
          <SalesPanel title="Customers by months since their last ink" icon={Hourglass} loading={loading}
                      empty={!loading && !read.length} emptyMessage="No ink customers."
                      subtitle={monthsPick !== null ? `filtered to ${byMonths[monthsPick].label} months — click it again to clear`
                        : `green = active, red = in-active at ${threshold}+ months — click a bar to filter`}
                      sizeKey="ink-active-months">
            <PanelFill base={300}>{(bar) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonths} margin={{ top: 18, right: 8, left: 0, bottom: 14 }}>
                  <CartesianGrid stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }}
                         label={{ value: "months since last ink", position: "insideBottom", offset: -8, fontSize: 10.5, fill: "hsl(220 10% 45%)" }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} formatter={(v: number) => [fmtInt(v), "Customers"]}
                           labelFormatter={(l: string) => `${l} months since last ink`} />
                  <Bar dataKey="customers" maxBarSize={bar(34)} radius={[4, 4, 0, 0]} className="cursor-pointer"
                       onClick={(d: { m?: number }) => d?.m !== undefined && setMonthsPick((p) => (p === d.m ? null : d.m!))}>
                    {byMonths.map((p) => (
                      <Cell key={p.m} fill={p.m < threshold ? BAND_COLOR.Active : BAND_COLOR[bandOf(p.m, threshold)]}
                            fillOpacity={monthsPick === null || monthsPick === p.m ? 1 : 0.3} />
                    ))}
                    <LabelList dataKey="customers" position="top" style={{ fontSize: 10.5, fill: LABEL_FILL, fontWeight: 600 }}
                               formatter={(v: number) => (v ? fmtInt(v) : "")} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}</PanelFill>
          </SalesPanel>

          <SalesPanel title="In-active customers by salesperson" icon={UserX} loading={loading}
                      empty={!loading && !bySalesperson.length} emptyMessage="No in-active customers in this selection."
                      subtitle={sel.salesperson.length ? `filtered to ${sel.salesperson.join(", ")} — click it again to clear`
                        : "how many each salesperson has let go quiet, with the ink they bought in the last 12 months"}
                      sizeKey="ink-active-sp" bodyHeight={324}>
            <PanelFill base={300} min={(bar) => bySalesperson.length * bar(26) + 30}>{(bar) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySalesperson} layout="vertical" margin={{ top: 4, right: 120, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10.5 }} tickLine={false} axisLine={false} width={160} interval={0} />
                  <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }}
                           formatter={(v: number, _n: string, it: { payload?: { lost: number; active: number } }) =>
                             [`${fmtInt(v)} in-active · ${fmtSales(it.payload?.lost ?? 0)} ink last 12 m · ${fmtInt(it.payload?.active ?? 0)} active`, "Customers"]} />
                  <Bar dataKey="inactive" maxBarSize={bar(18)} radius={[0, 4, 4, 0]} className="cursor-pointer"
                       onClick={(d: { name?: string }) => d?.name && toggle("salesperson", d.name)}>
                    {bySalesperson.map((p) => (
                      <Cell key={p.name} fill="#dc2626" fillOpacity={!sel.salesperson.length || sel.salesperson.includes(p.name) ? 1 : 0.3} />
                    ))}
                    <LabelList dataKey="inactive" position="right" style={{ fontSize: 10.5, fill: LABEL_FILL, fontWeight: 600 }}
                               formatter={(v: number) => `${fmtInt(v)}`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}</PanelFill>
          </SalesPanel>
        </div>
      )}

      <CustomerList customers={shown} loading={loading} from={from} today={today} threshold={threshold} />
    </div>
  );
}

function Kpi({ icon: Icon, accent, label, value, sub, loading, on, onClick }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string;
  label: string; value: string; sub?: string; loading?: boolean; on?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className={cn("rounded-card border bg-surface px-3 py-2 text-left shadow-sm disabled:cursor-default",
                          onClick && "hover:bg-muted/30", on ? "border-2" : "border-border")}
            style={on ? { borderColor: accent } : undefined} title={value}>
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
    </button>
  );
}

/* ================================================================ the list */

const COLS: { key: string; header: string; right?: boolean; sort: (c: Read) => string | number; cell: (c: Read) => React.ReactNode; xl: (c: Read) => string | number }[] = [
  { key: "status", header: "Status", sort: (c) => c.months,
    cell: (c) => <span className="rounded-pill px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: BAND_COLOR[c.band] }}>{c.status === "Active" ? "Active" : c.band}</span>,
    xl: (c) => c.status },
  { key: "group", header: "Customer", sort: (c) => c.group, cell: (c) => <span className="font-medium">{c.group}</span>, xl: (c) => c.group },
  { key: "sp", header: "Salesperson", sort: (c) => c.sp, cell: (c) => <span className={cn(c.sp === NOT_ASSIGNED && "text-muted-foreground")}>{c.sp}</span>, xl: (c) => c.sp },
  { key: "company", header: "Company", sort: (c) => c.companies.join(", "), cell: (c) => c.companies.join(", "), xl: (c) => c.companies.join(", ") },
  { key: "location", header: "Location", sort: (c) => c.locations.join(", "), cell: (c) => c.locations.join(", "), xl: (c) => c.locations.join(", ") },
  { key: "lastSale", header: "Last Ink Date", sort: (c) => c.lastSale, cell: (c) => dmy(c.lastSale), xl: (c) => dmy(c.lastSale) },
  { key: "months", header: "Months Inactive", right: true, sort: (c) => c.months, cell: (c) => <span className="font-semibold">{fmtInt(c.months)}</span>, xl: (c) => c.months },
  { key: "band", header: "Ageing", sort: (c) => c.months, cell: (c) => c.band, xl: (c) => c.band },
  { key: "qty12", header: "Ink Qty 12 m", right: true, sort: (c) => c.qty12, cell: (c) => (c.qty12 ? fmtKg(c.qty12) : "—"), xl: (c) => Math.round(c.qty12 * 100) / 100 },
  { key: "value12", header: "Ink Value 12 m", right: true, sort: (c) => c.value12, cell: (c) => (c.value12 ? fmtSales(c.value12) : "—"), xl: (c) => Math.round(c.value12) },
  { key: "qty", header: "Ink Qty (all)", right: true, sort: (c) => c.qty, cell: (c) => fmtKg(c.qty), xl: (c) => Math.round(c.qty * 100) / 100 },
  { key: "value", header: "Ink Value (all)", right: true, sort: (c) => c.value, cell: (c) => fmtSales(c.value), xl: (c) => Math.round(c.value) },
  { key: "avg", header: "Avg KG / Buying Month", right: true, sort: (c) => (c.activeMonths ? c.qty / c.activeMonths : 0),
    cell: (c) => (c.activeMonths ? `${nf1.format(c.qty / c.activeMonths)} KG` : "—"), xl: (c) => (c.activeMonths ? Math.round((c.qty / c.activeMonths) * 10) / 10 : 0) },
  { key: "buyingMonths", header: "Buying Months", right: true, sort: (c) => c.activeMonths, cell: (c) => fmtInt(c.activeMonths), xl: (c) => c.activeMonths },
  { key: "firstSale", header: "First Ink Date", sort: (c) => c.firstSale, cell: (c) => dmy(c.firstSale), xl: (c) => dmy(c.firstSale) },
  { key: "categories", header: "Main Categories", sort: (c) => c.categories.join(", "),
    cell: (c) => <span className="block max-w-[320px] truncate" title={c.categories.join(", ")}>{c.categories.join(", ")}</span>, xl: (c) => c.categories.join(", ") },
];
const COLUMN_OPTIONS: ColumnOption[] = COLS.map((c) => ({ key: c.key, label: c.header }));
const COLS_KEY = "orangeone.cols.bushra-ink-active";
const readCols = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
    const kept = Array.isArray(v) ? COLS.map((c) => c.key).filter((k) => v.includes(k)) : [];
    return kept.length ? kept : COLS.map((c) => c.key);
  } catch { return COLS.map((c) => c.key); }
};

/** Every month of the window as YYYYMM — the pivot's columns, as in the Excel. */
function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(4, 6));
  const end = Number(to.slice(0, 6));
  while (y * 100 + m <= end) { out.push(`${y}${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

function CustomerList({ customers, loading, from, today, threshold }: {
  customers: Read[]; loading: boolean; from: string; today: string; threshold: number;
}) {
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState<string[]>(readCols);
  const pickCols = (v: string[]) => {
    setVisible(v);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(v)); } catch { /* private window: just not kept */ }
  };
  const cols = useMemo(() => COLS.filter((c) => visible.includes(c.key)), [visible]);
  // In-actives first, longest-silent at the top — the list's job is the follow-up.
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "months", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);
  const months = useMemo(() => monthsOf(from, today), [from, today]);

  const searched = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter((c) => c.group.toLowerCase().includes(s) || c.sp.toLowerCase().includes(s) ||
      c.ledgers.some((l) => l.ledger.toLowerCase().includes(s)));
  }, [customers, q]);
  const sorted = useMemo(() => {
    const get = COLS.find((c) => c.key === sort.key)?.sort ?? ((c: Read) => c.months);
    return [...searched].sort((a, b) => {
      const x = get(a), y = get(b);
      return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)))
        || b.value12 - a.value12;
    });
  }, [searched, sort]);
  const toggleSort = (key: string, right?: boolean) => setSort((s) =>
    s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: right ? -1 : 1 });
  const page = usePagination(sorted, { resetKey: `${customers.length}|${q}|${sort.key}|${sort.dir}` });

  const exportXlsx = () => {
    const head = cols.map((c) => c.header);
    const ws = XLSX.utils.aoa_to_sheet([head, ...sorted.map((c) => cols.map((col) => col.xl(c)))]);
    ws["!cols"] = cols.map((c) => ({ wch: c.key === "group" || c.key === "categories" ? 38 : c.key === "company" || c.key === "sp" ? 24 : 13 }));
    head.forEach((_, i) => { const a = XLSX.utils.encode_cell({ r: 0, c: i }); if (ws[a]) ws[a].s = { font: { bold: true } }; });
    // The Excel's own pivot, flat: customer → main category → colour, quantity (KG) per month.
    const pHead = ["Customer", "Salesperson", "Status", "Main Category", "Colour", ...months.map(monthName), "Total"];
    const pRows: (string | number)[][] = [];
    for (const c of sorted) {
      for (const [cat, byColour] of c.pivot) for (const [colour, byMonth] of byColour) {
        const vals = months.map((m) => Math.round((byMonth.get(m) ?? 0) * 100) / 100);
        pRows.push([c.group, c.sp, c.status === "Active" ? "Active" : c.band, cat, colour, ...vals.map((v) => v || ""), Math.round(vals.reduce((s, v) => s + v, 0) * 100) / 100]);
      }
    }
    const wsP = XLSX.utils.aoa_to_sheet([pHead, ...pRows]);
    wsP["!cols"] = pHead.map((h, i) => ({ wch: i === 0 ? 36 : i <= 4 ? 22 : 9 }));
    const info = XLSX.utils.aoa_to_sheet([
      ["Active / In-active Ink Customers"], ["As on", dmy(today)], ["Data from", dmy(from)],
      ["In-active", `no ink bought for ${threshold} month(s) or more (whole months, as Excel DATEDIF "m")`],
      ["Customer", "the hub Customer Group; an unmapped ledger stands on its own"],
      ["Lines", "ink only, pure sales — no FOC, branch or related-party lines"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.utils.book_append_sheet(wb, wsP, "Category x Colour x Month");
    XLSX.utils.book_append_sheet(wb, info, "Report Info");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Ink_Active_Inactive_Customers_${today}.xlsx`);
  };

  return (
    <SalesPanel title="Ink customer list" icon={Table2} loading={loading}
                subtitle={`${fmtInt(searched.length)} customers · longest silent first · click a row for its category × colour × month quantities`}
                actions={
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, ledger or salesperson…"
                             className="h-8 w-56 rounded-input pl-7 text-[12px]" />
                    </div>
                    <ColumnPicker columns={COLUMN_OPTIONS} visible={visible} onChange={pickCols} triggerClassName="h-8 text-[12px]" />
                    <Button onClick={exportXlsx} disabled={!sorted.length}
                            className="h-8 gap-1.5 rounded-button bg-primary px-3 text-[12px] text-primary-foreground hover:bg-primary/90">
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </div>
                }>
      <ScrollableTable className="rounded-md border border-border" maxHeight="max-h-[62vh]" resizeKey="bushra-ink-active">
        <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: Math.max(900, cols.length * 115) }}>
          <thead className="sticky top-0 z-10 bg-muted/80">
            <tr className="border-b border-border">
              {cols.map((c) => (
                <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", c.right ? "text-right" : "text-left")}>
                  <button type="button" onClick={() => toggleSort(c.key, c.right)} title={`Sort by ${c.header}`}
                          className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", sort.key === c.key && "text-foreground")}>
                    {c.header}
                    {sort.key !== c.key ? <ArrowUpDown className="h-3 w-3 opacity-40" /> : sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.pageItems.length === 0 ? (
              <tr><td colSpan={cols.length} className="py-8 text-center text-[12px] text-muted-foreground">
                {customers.length ? "No customer matches that search." : "No customers match those filters."}
              </td></tr>
            ) : page.pageItems.map((c) => (
              <Fragment key={c.group}>
                <tr onClick={() => setOpen((o) => (o === c.group ? null : c.group))}
                    className={cn("cursor-pointer border-b border-border/40 hover:bg-muted/40", open === c.group && "bg-muted/30")}>
                  {cols.map((col, i) => (
                    <td key={col.key} className={cn("px-3 py-1.5", col.key !== "categories" && "whitespace-nowrap", col.right && "text-right tabular-nums")}>
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open === c.group && "rotate-90")} />
                          {col.cell(c)}
                        </span>
                      ) : col.cell(c)}
                    </td>
                  ))}
                </tr>
                {open === c.group && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td colSpan={cols.length} className="px-4 py-2">
                      <Pivot c={c} months={months} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <Pagination state={page} rowsLabel="customers" />
    </SalesPanel>
  );
}

/** The Excel's pivot for one customer: main category → colour, KG per month, with each category's total. */
function Pivot({ c, months }: { c: Read; months: string[] }) {
  const cats = [...c.pivot].sort((a, b) => sumCat(b[1]) - sumCat(a[1]));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>Ledgers: {c.ledgers.map((l) => `${l.ledger} (${l.company}, ${l.location}${l.last ? ` · last ${dmy(l.last)}` : ""})`).join(" · ")}</span>
      </div>
      <div className="max-h-[360px] overflow-auto rounded border border-border/60 bg-surface">
        <table className="border-collapse text-[11.5px]">
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-[2] bg-muted px-2 py-1 text-left font-semibold">Main Category</th>
              <th className="px-2 py-1 text-left font-semibold">Colour</th>
              {months.map((m) => <th key={m} className="px-2 py-1 text-right font-semibold">{monthName(m)}</th>)}
              <th className="px-2 py-1 text-right font-semibold">Total KG</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(([cat, byColour]) => {
              const colours = [...byColour].sort((a, b) => collator.compare(a[0], b[0]));
              return (
                <Fragment key={cat}>
                  {colours.map(([colour, byMonth], i) => {
                    const total = months.reduce((s, m) => s + (byMonth.get(m) ?? 0), 0);
                    return (
                      <tr key={colour} className="border-t border-border/40">
                        <td className="sticky left-0 bg-surface px-2 py-0.5 font-semibold whitespace-nowrap">{i === 0 ? cat : ""}</td>
                        <td className="px-2 py-0.5 whitespace-nowrap">{colour}</td>
                        {months.map((m) => {
                          const v = byMonth.get(m) ?? 0;
                          return <td key={m} className={cn("px-2 py-0.5 text-right tabular-nums", v < 0 && "text-destructive")}>{v ? nf1.format(v) : ""}</td>;
                        })}
                        <td className="px-2 py-0.5 text-right font-semibold tabular-nums">{nf1.format(total)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-border bg-[#fde8dc]/60 dark:bg-orange-950/30">
                    <td className="sticky left-0 bg-[#fde8dc] px-2 py-0.5 font-bold whitespace-nowrap dark:bg-orange-950" colSpan={1}>{cat} Total</td>
                    <td />
                    {months.map((m) => {
                      const v = colours.reduce((s, [, bm]) => s + (bm.get(m) ?? 0), 0);
                      return <td key={m} className="px-2 py-0.5 text-right font-semibold tabular-nums">{v ? nf1.format(v) : ""}</td>;
                    })}
                    <td className="px-2 py-0.5 text-right font-bold tabular-nums">{nf1.format(sumCat(byColour))}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const sumCat = (byColour: Map<string, Map<string, number>>) =>
  [...byColour.values()].reduce((s, bm) => s + [...bm.values()].reduce((a, v) => a + v, 0), 0);
