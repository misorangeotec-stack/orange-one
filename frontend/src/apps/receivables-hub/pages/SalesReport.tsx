import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Clock, FileSpreadsheet,
  Layers, MapPin, Package, RefreshCw, TrendingUp, UserCheck, Users,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  fmtSales, loadLastRefresh, loadSalesReport, loadSalespersonByParty, pctChange,
  priorFy, refreshSalesCompany, salesCat, salesFyOptions, salesPeriod, salespersonRollup,
  saleTypeLabel, tickSales, SALES_CURRENT, SALES_PRIOR,
  type BillRow, type CustomerRow, type SalesFilters,
} from "@hub/lib/salesReport";

/**
 * Master Reports → Sales Report.
 *
 * A faithful rebuild of the Talligence Sales Report (Misc/Talligence-Inputs/
 * Reports-Sales report.pdf) in Orange One's palette: same panels, same order, same
 * columns — brand orange for the current year, muted slate for the prior year.
 *
 * Master Reports owns its panel chrome (components/masterreports/SalesPanel) and its
 * palette (lib/salesReport) outright, rather than borrowing the C-Level dashboard's —
 * that screen is being reworked and this report must not move when it does.
 *
 * Every figure comes from ONE ConnectWave RPC (`rpt_sales_report`) that reads the
 * precomputed rpt_sales_* snapshot. Reconciled against the source report for Orange O Tec
 * Noida: PYTD ₹8.2139 Cr and PY total ₹25.9954 Cr land exactly; YTD is ₹8.0028 Cr against
 * their ₹8.05 Cr, the difference being two 22-Jul-2026 invoices the mirror had not yet
 * synced.
 *
 * TWO DELIBERATE DEPARTURES FROM THE SOURCE, both improvements:
 *  - "Top 10 Product Category" is replaced by **Sales Type** (Ink / Spare Parts / Head /
 *    Machine). Talligence renders a single "Undefined" bar because Tally's stock CATEGORY
 *    field is unset on every item; our sale_type master actually carries the split.
 *  - "Top 5 Sales Person Performance" is filled from ext_ledger_tags.salesperson instead of
 *    the source's "Data for this segment was not found in Tally" empty state.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/** FY month order — Indian FY runs Apr → Mar. */
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}

/** Talligence prints "-" when there is no prior base, and an arrow otherwise. */
function ChangeCell({ current, prior }: { current: number; prior: number }) {
  const pct = pctChange(current, prior);
  if (pct === null) return <span className="text-muted-foreground">-</span>;
  const up = pct >= 0;
  return (
    <span className={up ? "text-emerald-600" : "text-destructive"}>
      {Math.abs(pct).toFixed(2)} %{" "}
      {up ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />}
    </span>
  );
}

/** Premium tooltip for the weekly line chart — week label + both years with colour dots. */
function WeeklyTooltip({
  active, payload, label, curLabel, priorLabel,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number }[];
  label?: string | number;
  curLabel: string;
  priorLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const cy = payload.find((p) => p.dataKey === "cy")?.value;
  const py = payload.find((p) => p.dataKey === "py")?.value;
  const Row = ({ color, name, v }: { color: string; name: string; v?: number }) =>
    v == null ? null : (
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-muted-foreground">{name}</span>
        <span className="ml-4 font-semibold text-foreground tabular-nums">{fmtSales(v)}</span>
      </div>
    );
  return (
    <div className="rounded-lg border border-border bg-surface shadow-md px-3 py-2 text-xs space-y-0.5">
      <div className="font-semibold text-foreground mb-1">Week {label}</div>
      <Row color={SALES_CURRENT} name={curLabel} v={cy} />
      <Row color={SALES_PRIOR} name={priorLabel} v={py} />
    </div>
  );
}

/** The three headline tiles. */
function KpiTile({ title, value, hint }: { title: string; value: number; hint: string }) {
  return (
    <Card className="rounded-card border-border bg-surface shadow-sm px-4 py-3">
      <div className="text-[13px] font-semibold text-primary">{title}</div>
      <div className="text-2xl font-bold text-navy leading-tight mt-1">{fmtSales(value)}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </Card>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children = null, right, className = "" }: { children?: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`px-3 py-1.5 text-[12.5px] whitespace-nowrap ${right ? "text-right tabular-nums" : ""} ${className}`}>
    {children}
  </td>
);

export default function SalesReport() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => salesFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [filters, setFilters] = useState<SalesFilters>({});
  const [custQuery, setCustQuery] = useState("");
  const [billQuery, setBillQuery] = useState("");

  // Default to Orange O Tec Noida (the book the source report was produced from) when it
  // exists, otherwise the first company in the list.
  useEffect(() => {
    if (companyGuid || !companies.length) return;
    const noida = companies.find((c) => c.companyGuid === NOIDA_GUID);
    setCompanyGuid(noida?.companyGuid ?? companies[0].companyGuid);
  }, [companies, companyGuid]);

  const pick = (guid: string, nextFy: string) => {
    setCompanyGuid(guid);
    setFy(nextFy);
    setParams({ company: guid, fy: nextFy }, { replace: true });
  };

  const period = useMemo(() => salesPeriod(fy), [fy]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["salesReport", "v1", companyGuid, fy, filters],
    queryFn: () => loadSalesReport(companyGuid, fy, filters),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: spByParty } = useQuery({
    queryKey: ["salesReportSalespersons", "v1"],
    queryFn: loadSalespersonByParty,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["salesReportLastRefresh", companyGuid, fy],
    queryFn: () => loadLastRefresh(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 60 * 1000,
  });

  /* ---------------------------------------------------------------- refresh */

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // The RPC is a single synchronous call, so there is no true progress to report. The bar
  // is driven by elapsed time against the LAST run's duration and is labelled as an
  // estimate — it never claims to be further along than 95% until the call actually returns.
  const etaSeconds = Math.max(5, Number(lastRefresh?.seconds ?? 20));
  const progress = busy ? Math.min(95, (elapsed / etaSeconds) * 100) : 0;

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const onRefresh = async () => {
    if (busy || !companyGuid) return;
    setBusy(true);
    setRefreshNote(null);
    setElapsed(0);
    timer.current = window.setInterval(() => setElapsed((s) => s + 0.25), 250);
    try {
      const res = await refreshSalesCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.lines} sales lines, ${res.bills} bills.`);
        await Promise.all([refetch(), refetchLast()]);
      }
    } catch (e) {
      setRefreshNote(e instanceof Error ? e.message : String(e));
    } finally {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ derivations */

  const company = companies.find((c) => c.companyGuid === companyGuid);
  const prior = priorFy(fy);

  const monthly = useMemo(() => {
    const cy = new Map<number, number>();
    const py = new Map<number, number>();
    for (const r of data?.monthly ?? []) (r.fy === "cy" ? cy : py).set(r.m, Number(r.amt) || 0);
    return FY_MONTHS.map((m) => ({ name: MONTH_LABEL[m], cy: cy.get(m) ?? 0, py: py.get(m) ?? 0 }));
  }, [data]);

  // Quarters are derived from the monthly roll-up so the donut can never disagree with the
  // bars beside it.
  const quarterly = useMemo(() => {
    const q = (tag: "cy" | "py") =>
      [0, 1, 2, 3].map((qi) => {
        const months = FY_MONTHS.slice(qi * 3, qi * 3 + 3);
        const total = (data?.monthly ?? [])
          .filter((r) => r.fy === tag && months.includes(r.m))
          .reduce((s, r) => s + (Number(r.amt) || 0), 0);
        return { name: `Q${qi + 1}`, value: Math.max(0, total) };
      });
    return { cy: q("cy"), py: q("py") };
  }, [data]);

  const weekly = useMemo(() => {
    const cy = new Map<number, number>();
    const py = new Map<number, number>();
    for (const r of data?.weekly ?? []) (r.fy === "cy" ? cy : py).set(r.wk, Number(r.amt) || 0);
    // Fill 0 for weeks WITHIN each year's span, null beyond it — so a genuinely dead week
    // reads as a dip to zero (the prior year is complete) while the current year's line
    // simply stops at the latest week with data rather than being drawn flat to week 53.
    const maxCy = cy.size ? Math.max(...cy.keys()) : 0;
    const maxPy = py.size ? Math.max(...py.keys()) : 0;
    const weeks = Math.max(53, maxCy, maxPy);
    const rows = Array.from({ length: weeks }, (_, i) => {
      const w = i + 1;
      return {
        name: String(w),
        cy: w <= maxCy ? cy.get(w) ?? 0 : null,
        py: w <= maxPy ? py.get(w) ?? 0 : null,
      };
    });
    const vals = rows.flatMap((r) => [r.cy, r.py]).filter((v): v is number => v != null);
    return { rows, hasNegative: vals.some((v) => v < 0) };
  }, [data]);

  const geo = data?.geography ?? [];
  const geoTotalYtd = geo.reduce((s, r) => s + Number(r.ytd), 0);
  const geoTotalPytd = geo.reduce((s, r) => s + Number(r.pytd), 0);

  const salespeople = useMemo(
    () => salespersonRollup(data?.customers ?? [], spByParty ?? {}).slice(0, 5),
    [data, spByParty],
  );

  const customers: CustomerRow[] = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    const rows = data?.customers ?? [];
    return q ? rows.filter((r) => r.party.toLowerCase().includes(q)) : rows;
  }, [data, custQuery]);

  const custTotals = useMemo(
    () => customers.reduce(
      (a, r) => ({ cy: a.cy + Number(r.cy), pytd: a.pytd + Number(r.pytd), py: a.py + Number(r.py) }),
      { cy: 0, pytd: 0, py: 0 },
    ),
    [customers],
  );

  const bills: BillRow[] = useMemo(() => {
    const q = billQuery.trim().toLowerCase();
    const rows = data?.bills ?? [];
    return q
      ? rows.filter((r) => r.ledger.toLowerCase().includes(q) || r.bill_ref.toLowerCase().includes(q))
      : rows;
  }, [data, billQuery]);

  const custPage = usePagination(customers, { pageSize: 10, resetKey: `${companyGuid}|${fy}|${custQuery}` });
  const agePage = usePagination(data?.ageing.customers ?? [], { pageSize: 10, resetKey: `${companyGuid}|${fy}` });
  const billPage = usePagination(bills, { pageSize: 10, resetKey: `${companyGuid}|${fy}|${billQuery}` });

  const opts = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ value: v, label: v }));
  const anyFilter =
    !!(filters.saleTypes?.length || filters.states?.length || filters.parties?.length ||
       filters.groups?.length || filters.items?.length);

  const errText = error instanceof Error ? error.message : coError;

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Sales Report
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sales posted to the Sales Accounts group, ex-GST, straight from the Tally books.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={companyGuid}
            onChange={(e) => pick(e.target.value, fy)}
            className="h-9 rounded-input border border-border bg-surface px-3 text-sm max-w-[280px] truncate"
          >
            {companies.map((c) => (
              <option key={c.companyGuid} value={c.companyGuid}>{companyLabel(c)}</option>
            ))}
          </select>
          <select
            value={fy}
            onChange={(e) => pick(companyGuid, e.target.value)}
            className="h-9 rounded-input border border-border bg-surface px-3 text-sm"
          >
            {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onRefresh}
            disabled={busy || !companyGuid}
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Meta strip — mirrors the source report's "Last Sync / F.Y. / Currency" band. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-y border-border/60 py-1.5">
        {company && <span className="font-medium text-foreground">{company.rawName}</span>}
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Last refreshed:{" "}
          {lastRefresh?.ran_at
            ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
            : "never"}
        </span>
        <span>F.Y. is {fy}</span>
        <span>Period: {dmy(period.from)} to {dmy(period.asOn)}</span>
        <span>Currency is ₹</span>
        <span className="opacity-70">Auto-refreshes daily at 8:00 PM</span>
      </div>

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-pill bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Rebuilding this company's sales snapshot — {elapsed.toFixed(0)}s elapsed
            {lastRefresh?.seconds ? ` (last run took ${lastRefresh.seconds}s)` : ""}
          </div>
        </div>
      )}
      {refreshNote && !busy && (
        <div className="text-[11px] text-muted-foreground">{refreshNote}</div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <Card className="rounded-card border-border bg-surface shadow-sm p-3">
        <div className="flex flex-wrap items-end gap-3">
          {([
            ["Sale Type", "saleTypes", data?.filters.sale_types],
            ["State", "states", data?.filters.states],
            ["Customer", "parties", data?.filters.parties],
            ["Product Group", "groups", data?.filters.groups],
            ["Product", "items", data?.filters.items],
          ] as const).map(([label, key, list]) => (
            <div key={key} className="min-w-[170px]">
              <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
              <MultiSelectFilter
                options={opts(list as string[] | undefined)}
                value={(filters[key] as string[] | undefined) ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
                allLabel="All"
                unit={label}
                triggerClassName="h-9 w-[170px]"
              />
            </div>
          ))}
          {anyFilter && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setFilters({})}>
              Clear all
            </Button>
          )}
        </div>
      </Card>

      {errText ? (
        <div className="py-16 text-center text-destructive text-sm flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errText}
        </div>
      ) : isLoading || coLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading the sales book…</div>
      ) : !data ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No sales data for this company.</div>
      ) : (
        <>
          {/* ── KPI trio ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <KpiTile title="Current Year Sales (YTD)" value={data.kpi.ytd}
                     hint={`${dmy(period.from)} to ${dmy(period.asOn)}`} />
            <KpiTile title="Previous Year Sales (PYTD)" value={data.kpi.pytd}
                     hint={`${dmy(period.pFrom)} to ${dmy(period.pAsOn)}`} />
            <KpiTile title="Previous Year Sales (Total)" value={data.kpi.py_total}
                     hint={`FY ${prior} full year`} />
          </div>

          {/* ── Yearly · Quarterly · Monthly ─────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <SalesPanel title="Yearly Sales" icon={TrendingUp}>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={[
                  { name: `FY ${prior}`, v: data.kpi.py_total },
                  { name: `FY ${fy}`, v: data.kpi.cy_total },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={AXIS_TICK} />
                  <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Bar dataKey="v" name="Sales" radius={[4, 4, 0, 0]}>
                    <Cell fill={SALES_PRIOR} />
                    <Cell fill={SALES_CURRENT} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Quarterly Sales" icon={Layers} subtitle="Inner ring: current FY · Outer: prior FY">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={quarterly.cy} dataKey="value" nameKey="name" innerRadius={28} outerRadius={58}>
                    {quarterly.cy.map((_, i) => <Cell key={i} fill={salesCat(i)} />)}
                  </Pie>
                  <Pie data={quarterly.py} dataKey="value" nameKey="name" innerRadius={68} outerRadius={96}>
                    {quarterly.py.map((_, i) => (
                      <Cell key={i} fill={salesCat(i)} fillOpacity={0.45} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Legend verticalAlign="bottom" height={24} iconSize={9}
                          wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Monthly Sales" icon={BarChart3}>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} />
                  <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="py" name={`FY ${prior}`} fill={SALES_PRIOR} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cy" name={`FY ${fy}`} fill={SALES_CURRENT} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>
          </div>

          {/* ── Weekly ───────────────────────────────────────────────── */}
          <SalesPanel
            title="Weekly Sales"
            icon={TrendingUp}
            subtitle="Sales by week of the financial year — week 1 starts 1 April"
            bodyClassName="p-3 pt-4"
          >
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={weekly.rows} margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="wkCurrentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SALES_CURRENT} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={SALES_CURRENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ ...AXIS_TICK, fontSize: 9 }}
                  interval={1}
                  tickMargin={6}
                  tickLine={false}
                  axisLine={{ stroke: CHART_GRID }}
                />
                <YAxis
                  tickFormatter={tickSales}
                  tick={AXIS_TICK}
                  width={48}
                  tickCount={7}
                  domain={[weekly.hasNegative ? "auto" : 0, "auto"]}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={<WeeklyTooltip curLabel={`FY ${fy}`} priorLabel={`FY ${prior}`} />}
                  cursor={{ stroke: SALES_CURRENT, strokeOpacity: 0.25, strokeWidth: 1 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                {/* Faint fill under the current year for depth — legend-suppressed so it
                    doesn't read as a third series. */}
                <Area
                  type="linear"
                  dataKey="cy"
                  stroke="none"
                  fill="url(#wkCurrentFill)"
                  legendType="none"
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="py"
                  name={`FY ${prior}`}
                  stroke={SALES_PRIOR}
                  strokeWidth={1.75}
                  dot={{ r: 1.8, fill: SALES_PRIOR, strokeWidth: 0 }}
                  activeDot={{ r: 4.5, stroke: "#fff", strokeWidth: 1.5, fill: SALES_PRIOR }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="cy"
                  name={`FY ${fy}`}
                  stroke={SALES_CURRENT}
                  strokeWidth={2.4}
                  dot={{ r: 2.2, fill: SALES_CURRENT, strokeWidth: 0 }}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: SALES_CURRENT }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </SalesPanel>

          {/* ── Geography ────────────────────────────────────────────── */}
          <SalesPanel title="Sales by Geography" icon={MapPin} empty={geo.length === 0}>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={geo.map((g) => ({ name: g.state, ytd: Number(g.ytd), pytd: Number(g.pytd) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} />
                <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46} />
                <Tooltip formatter={(v: number) => fmtSales(v)} />
                <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ytd" name="YTD" fill={SALES_CURRENT} radius={[3, 3, 0, 0]} />
                <Bar dataKey="pytd" name="PYTD" fill={SALES_PRIOR} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <ScrollableTable className="mt-3 rounded-md border border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr><Th>State</Th><Th right>YTD</Th><Th right>PYTD</Th><Th right>Change (in %)</Th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {geo.map((g) => (
                    <tr key={g.state} className="hover:bg-muted/30">
                      <Td>{g.state}</Td>
                      <Td right>{fmtSales(g.ytd)}</Td>
                      <Td right>{fmtSales(g.pytd)}</Td>
                      <Td right><ChangeCell current={Number(g.ytd)} prior={Number(g.pytd)} /></Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border font-semibold">
                  <tr>
                    <Td>Total</Td>
                    <Td right>{fmtSales(geoTotalYtd)}</Td>
                    <Td right>{fmtSales(geoTotalPytd)}</Td>
                    <Td right />
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
          </SalesPanel>

          {/* ── Salespeople ──────────────────────────────────────────── */}
          <SalesPanel
            title="Top 5 Sales Person Performance"
            icon={UserCheck}
            subtitle="From the salesperson tags in Masters — Tally itself carries no salesperson"
            empty={salespeople.length === 0}
            emptyMessage="No customers are tagged to a salesperson yet."
          >
            <ScrollableTable className="rounded-md border border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr><Th>Name</Th><Th right>YTD</Th><Th right>PYTD</Th><Th right>Change (in %)</Th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {salespeople.map((s) => (
                    <tr key={s.name} className="hover:bg-muted/30">
                      <Td>{s.name}</Td>
                      <Td right>{fmtSales(s.ytd)}</Td>
                      <Td right>{fmtSales(s.pytd)}</Td>
                      <Td right><ChangeCell current={s.ytd} prior={s.pytd} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </SalesPanel>

          {/* ── Sales Type · Product Groups · Products ───────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <SalesPanel title="Sales Type" icon={Layers} subtitle="Replaces the source's empty Product Category">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={(data.sale_types ?? []).map((s) => ({
                  name: saleTypeLabel(s.sale_type), v: Number(s.amt),
                }))} margin={{ bottom: 34 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0}
                         angle={-35} textAnchor="end" height={44} />
                  {/* Floor at 0 unless a bucket is genuinely net-negative (returns now sit in
                      their product bucket, so this is normally all-positive and clean). */}
                  <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46}
                         domain={[(data.sale_types ?? []).some((s) => Number(s.amt) < 0) ? "auto" : 0, "auto"]} />
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Bar dataKey="v" name="Sales" fill={SALES_CURRENT} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Top 10 Product Groups" icon={Package}>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={(data.groups ?? []).slice(0, 10).map((g) => ({
                  name: g.grp, v: Number(g.amt),
                }))} margin={{ bottom: 34 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0}
                         angle={-35} textAnchor="end" height={44} />
                  <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Bar dataKey="v" name="Sales" fill={salesCat(4)} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Top 10 Products" icon={Package}>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={(data.products ?? []).slice(0, 10).map((p) => ({
                  name: p.item, v: Number(p.amt),
                }))} margin={{ bottom: 34 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0}
                         angle={-35} textAnchor="end" height={44} />
                  <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Bar dataKey="v" name="Sales" fill={salesCat(5)} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>
          </div>

          {/* ── Contributing Customers ───────────────────────────────── */}
          <SalesPanel
            title="Contributing Customers"
            icon={Users}
            actions={
              <Input value={custQuery} onChange={(e) => setCustQuery(e.target.value)}
                     placeholder="Search customer…" className="h-8 w-52 text-xs" />
            }
            bodyClassName="p-0"
          >
            <ScrollableTable className="border-b border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Customer</Th><Th right>CY Sales</Th><Th right>PYTD Sales</Th>
                    <Th right>PY Sales</Th><Th right>Contribution (in %)</Th><Th right>Change (in %)</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {custPage.pageItems.map((c) => (
                    <tr key={c.party} className="hover:bg-muted/30">
                      <Td className="max-w-[320px] truncate">{c.party}</Td>
                      <Td right>{fmtSales(c.cy)}</Td>
                      <Td right>{fmtSales(c.pytd)}</Td>
                      <Td right>{fmtSales(c.py)}</Td>
                      <Td right>
                        {data.kpi.ytd ? ((Number(c.cy) / data.kpi.ytd) * 100).toFixed(2) : "0.00"}
                      </Td>
                      <Td right><ChangeCell current={Number(c.cy)} prior={Number(c.pytd)} /></Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border font-semibold">
                  <tr>
                    <Td>Total</Td>
                    <Td right>{fmtSales(custTotals.cy)}</Td>
                    <Td right>{fmtSales(custTotals.pytd)}</Td>
                    <Td right>{fmtSales(custTotals.py)}</Td>
                    <Td right /><Td right />
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
            <Pagination state={custPage} rowsLabel="customers" />
          </SalesPanel>

          {/* ── Receivable Ageing ────────────────────────────────────── */}
          <SalesPanel
            title="Receivable Ageing"
            icon={Clock}
            subtitle="Open debtor bills, bucketed by bill age"
            empty={(data.ageing?.buckets ?? []).length === 0}
            emptyMessage="No open bills — run Refresh if this company has never been snapshotted."
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={(data.ageing?.buckets ?? []).map((b) => ({ name: b.bucket, v: Number(b.amt) }))}
                          margin={{ bottom: 34 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0}
                         angle={-30} textAnchor="end" height={44} />
                  <YAxis tickFormatter={tickSales} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtSales(v)} />
                  <Bar dataKey="v" name="Due" fill={salesCat(4)} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div>
                <ScrollableTable className="rounded-md border border-border">
                  <table className="w-full">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr><Th>Customer</Th><Th right>Amount</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {agePage.pageItems.map((r) => (
                        <tr key={r.ledger} className="hover:bg-muted/30">
                          <Td className="max-w-[320px] truncate">{r.ledger}</Td>
                          <Td right>{fmtSales(r.amt)}</Td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40 border-t border-border font-semibold">
                      <tr><Td>Total</Td><Td right>{fmtSales(data.ageing?.total ?? 0)}</Td></tr>
                    </tfoot>
                  </table>
                </ScrollableTable>
                <Pagination state={agePage} rowsLabel="customers" showPageSize={false} />
              </div>
            </div>
          </SalesPanel>

          {/* ── Bill Details ─────────────────────────────────────────── */}
          <SalesPanel
            title="Bill Details"
            icon={FileSpreadsheet}
            subtitle={`Bills raised ${dmy(period.from)} to ${dmy(period.asOn)}`}
            actions={
              <Input value={billQuery} onChange={(e) => setBillQuery(e.target.value)}
                     placeholder="Search bill or party…" className="h-8 w-56 text-xs" />
            }
            bodyClassName="p-0"
            empty={bills.length === 0}
            emptyMessage="No bills in this window."
          >
            <ScrollableTable className="border-b border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Bill Date</Th><Th>Bill No</Th><Th>Party Name</Th><Th right>Amount</Th>
                    <Th>Status</Th><Th right>Due Amount</Th><Th>Due On</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {billPage.pageItems.map((b) => {
                    const due = Number(b.pending) || 0;
                    return (
                      <tr key={`${b.ledger}|${b.bill_ref}`} className="hover:bg-muted/30">
                        <Td>{dmy(b.bill_date)}</Td>
                        <Td>{b.bill_ref}</Td>
                        <Td className="max-w-[280px] truncate">{b.ledger}</Td>
                        <Td right>{fmtSales(b.amount)}</Td>
                        <Td className={due > 0 ? "text-amber-600" : "text-emerald-600"}>
                          {due > 0 ? "Payment Due" : "Settled"}
                        </Td>
                        <Td right>{due > 0 ? fmtSales(due) : "—"}</Td>
                        <Td>{dmy(b.due_date)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={billPage} rowsLabel="bills" />
          </SalesPanel>
        </>
      )}
    </div>
  );
}
