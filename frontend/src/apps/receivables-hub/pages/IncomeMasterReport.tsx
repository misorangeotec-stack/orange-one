import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, ChevronDown, ChevronRight, Eye, Layers,
  PieChart as PieIcon, RefreshCw, TrendingDown, TrendingUp, type LucideIcon,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { Button } from "@hub/components/ui/button";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { appBasePath } from "@/apps/appInfo";
import {
  fmtInc, tickInc, pctChange, incPeriod, incFyOptions, priorFy, incCat,
  loadIncomeReport, loadIncomeLastRefresh, refreshIncomeCompany, groupStats, movers,
  INC_CURRENT, INC_PRIOR,
  type GroupStat, type IncGroupRow, type IncomeFilters,
} from "@hub/lib/incomeReport";

/**
 * Master Reports → Finance → Income.
 *
 * A faithful rebuild of the Talligence "Master Report – Finance – Income" screen
 * (Misc/Talligence-Inputs/Master Report - Finance - Income.pdf) in Orange One's palette:
 * the four mover KPIs (Income / Highest Change / Highest Increase / Lowest Change), the
 * Quarterly + Trend + Groups + Sub-Groups charts, and the Group → Sub-group → Ledger table.
 *
 * Every figure comes from ONE ConnectWave RPC (`rpt_income_report`) reading the precomputed
 * rpt_income_line snapshot. Income = net posted to income-group ledgers {Sales Accounts,
 * Direct Incomes, Indirect Incomes}, credit-positive — the P&L-movement twin of the Sales
 * Report, so its Sales Accounts slice reproduces that report exactly. Reconciled for Orange
 * O Tec Noida FY2026-27: total income PYTD ₹8.29 Cr / PY ₹26.18 Cr, Sales Accounts PYTD
 * ₹8.2139 Cr / PY ₹25.9954 Cr, Direct Incomes YTD ₹2.9 L — all tie to Talligence.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";
const BASE = appBasePath("outstanding-dashboard");

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

/* ---- Hero banner (matches the Sales / Payables reports) ------------------- */

function IncomeHero({
  company, fy, periodLabel, metaLine, summary, controls,
}: {
  company?: string; fy: string; periodLabel: string;
  metaLine?: string; summary: React.ReactNode; controls: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-card bg-navy text-white px-5 py-5 sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-orange/25 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy via-navy/95 to-transparent" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-white/55">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-400/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live · Tally
            </span>
            {company && <span className="font-semibold text-white/75">{company}</span>}
            <span className="text-white/30">·</span>
            <span>FY {fy}</span>
            <span className="text-white/30">·</span>
            <span>{periodLabel}</span>
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-[24px] font-bold tracking-tight sm:text-[27px]">
            <TrendingUp className="h-6 w-6 text-orange" /> Income
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>
        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">{controls}</div>
      </div>
    </div>
  );
}

/* ---- KPI cards (faithful Talligence: Income / Highest Change / Increase / Lowest) --- */

type KpiTone = "orange" | "up" | "down" | "grey";
const KPI_TONE: Record<KpiTone, { chip: string; value: string; glow: string }> = {
  orange: { chip: "bg-orange-soft text-orange", value: "text-navy", glow: "from-orange/10" },
  up: { chip: "bg-[#E7F6EE] text-emerald-600", value: "text-navy", glow: "from-emerald-500/10" },
  down: { chip: "bg-[#FDECEC] text-ryg-red", value: "text-navy", glow: "from-ryg-red/10" },
  grey: { chip: "bg-page text-grey-2", value: "text-navy", glow: "from-grey-2/[0.07]" },
};

/** A change pill "1.95 % ▼" — forceUp shows a green +100% for a dormant (0→0) group, as Talligence does. */
function ChangePill({ pct, forceUp }: { pct: number | null; forceUp?: boolean }) {
  const shown = pct == null ? (forceUp ? 100 : null) : pct;
  if (shown == null) return <span className="text-[12px] text-grey-2">—</span>;
  const up = shown >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12.5px] font-semibold", up ? "text-emerald-600" : "text-ryg-red")}>
      {Math.abs(shown).toFixed(2)}%
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
    </span>
  );
}

function KpiCard({
  tone, label, subtitle, value, pct, forceUp, hint, icon: Icon,
}: {
  tone: KpiTone; label: string; subtitle: string; value: string;
  pct: number | null; forceUp?: boolean; hint: string; icon: LucideIcon;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-white px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-100", t.glow)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
          <div className="mt-0.5 truncate text-[12px] font-medium text-navy/70">{subtitle}</div>
          <div className={cn("mt-1 text-[24px] font-bold leading-none tabular-nums sm:text-[26px]", t.value)}>{value}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <ChangePill pct={pct} forceUp={forceUp} />
            <span className="truncate text-[11px] text-grey">{hint}</span>
          </div>
        </div>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] [&>svg]:h-4 [&>svg]:w-4", t.chip)}>
          <Icon />
        </span>
      </div>
    </div>
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

const subKey = (grp: string, sub: string) => `${grp}|||${sub}`;

export default function IncomeMasterReport() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => incFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [filters, setFilters] = useState<IncomeFilters>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());

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

  const period = useMemo(() => incPeriod(fy), [fy]);
  const prior = priorFy(fy);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["incomeReport", "v1", companyGuid, fy, filters],
    queryFn: () => loadIncomeReport(companyGuid, fy, filters),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["incomeLastRefresh", companyGuid, fy],
    queryFn: () => loadIncomeLastRefresh(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 60 * 1000,
  });

  /* ---------------------------------------------------------------- refresh */

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

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
      const res = await refreshIncomeCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.lines ?? 0} income lines.`);
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

  // Monthly CY vs PY, in Apr→Mar order.
  const monthly = useMemo(() => {
    const cy = new Map<number, number>();
    const py = new Map<number, number>();
    for (const r of data?.monthly ?? []) (r.fy === "cy" ? cy : py).set(r.m, Number(r.amt) || 0);
    return FY_MONTHS.map((m) => ({ name: MONTH_LABEL[m], cy: cy.get(m) ?? 0, py: py.get(m) ?? 0 }));
  }, [data]);

  // Quarters derived from the monthly roll-up so the donut can never disagree with the bars.
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

  const stats: GroupStat[] = useMemo(() => groupStats(data?.groups ?? []), [data]);
  const mv = useMemo(() => movers(stats), [stats]);

  // Groups chart: current-FY (YTD) vs prior-FY (full year), as on the source screen.
  const groupBars = useMemo(
    () => (data?.groups ?? []).map((g) => ({ name: g.grp, cy: Number(g.ytd), py: Number(g.py) })),
    [data],
  );
  const subgroupBars = useMemo(
    () => (data?.subgroups ?? []).map((s) => ({ name: s.sub, cy: Number(s.ytd), py: Number(s.py) })),
    [data],
  );
  const subgroupHasNeg = subgroupBars.some((b) => b.cy < 0 || b.py < 0);

  // Table rows: only the income groups that carry an amount (the source table omits dormant ones).
  const tableGroups = useMemo(
    () => (data?.groups ?? []).filter((g) => Number(g.ytd) !== 0 || Number(g.pytd) !== 0),
    [data],
  );
  const groupPage = usePagination(tableGroups, { pageSize: 25, resetKey: `${companyGuid}|${fy}` });

  const subsByGroup = (grp: string) => (data?.subgroups ?? []).filter((s) => s.grp === grp);
  const ledgersBySub = (grp: string, sub: string) =>
    (data?.ledgers ?? []).filter((l) => l.grp === grp && l.sub === sub);

  const toggleGroup = (grp: string) =>
    setOpenGroups((s) => { const n = new Set(s); n.has(grp) ? n.delete(grp) : n.add(grp); return n; });
  const toggleSub = (grp: string, sub: string) =>
    setOpenSubs((s) => { const k = subKey(grp, sub); const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const opts = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ value: v, label: v }));
  const anyFilter = !!(filters.groups?.length || filters.subgroups?.length);
  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;

  const growthPct = data ? pctChange(data.kpi.ytd, data.kpi.pytd) : null;
  const heroSummary: React.ReactNode = heroLoading
    ? "Gathering the income book…"
    : data
      ? (
        <>
          <span className="font-semibold text-white">{fmtInc(data.kpi.ytd)}</span> of income booked so far this year
          {growthPct != null && (
            <>, {growthPct >= 0 ? "up" : "down"}{" "}
              <span className="font-semibold text-white">{Math.abs(growthPct).toFixed(1)}%</span> versus the same point last year</>
          )}.
        </>
      )
      : "Income posted to the Sales Accounts, Direct & Indirect Income groups — straight from the Tally books.";

  const heroMeta = [
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 9:15 PM",
  ].join("   ·   ");

  const darkControl =
    "h-9 rounded-input border border-white/15 bg-white/10 px-3 text-sm text-white backdrop-blur " +
    "transition hover:bg-white/[0.18] focus:outline-none focus:ring-2 focus:ring-white/25";
  const heroControls = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select value={companyGuid} onChange={(e) => pick(e.target.value, fy)}
              className={cn(darkControl, "max-w-[220px] cursor-pointer truncate [&>option]:text-navy")}>
        {companies.map((c) => <option key={c.companyGuid} value={c.companyGuid}>{companyLabel(c)}</option>)}
      </select>
      <select value={fy} onChange={(e) => pick(companyGuid, e.target.value)}
              className={cn(darkControl, "cursor-pointer [&>option]:text-navy")}>
        {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
      </select>
      <button type="button" onClick={onRefresh} disabled={busy || !companyGuid}
              className={cn(darkControl, "inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50")}>
        <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );

  const hintFor = (g: IncGroupRow) => `PYTD ${fmtInc(g.pytd)} · PY ${fmtInc(g.py)}`;

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      <IncomeHero
        company={company?.rawName}
        fy={fy}
        periodLabel={`${dmy(period.from)} → ${dmy(period.asOn)}`}
        metaLine={heroMeta}
        summary={heroSummary}
        controls={heroControls}
      />

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-pill bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Rebuilding this company's income snapshot — {elapsed.toFixed(0)}s elapsed
            {lastRefresh?.seconds ? ` (last run took ${lastRefresh.seconds}s)` : ""}
          </div>
        </div>
      )}
      {refreshNote && !busy && <div className="text-[11px] text-muted-foreground">{refreshNote}</div>}

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <Card className="rounded-card border-border bg-surface shadow-sm p-3">
        <div className="flex flex-wrap items-end gap-3">
          {([
            ["Income Group", "groups", data?.filters.groups],
            ["Sub Group", "subgroups", data?.filters.subgroups],
          ] as const).map(([label, key, list]) => (
            <div key={key} className="min-w-[200px]">
              <div className="text-[11px] font-medium text-muted-foreground mb-1">{label}</div>
              <MultiSelectFilter
                options={opts(list as string[] | undefined)}
                value={(filters[key] as string[] | undefined) ?? []}
                onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
                allLabel="All"
                unit={label}
                triggerClassName="h-9 w-[200px]"
              />
            </div>
          ))}
          {anyFilter && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setFilters({})}>Clear all</Button>
          )}
        </div>
      </Card>

      {errText ? (
        <div className="py-16 text-center text-destructive text-sm flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errText}
        </div>
      ) : isLoading || coLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading the income book…</div>
      ) : !data ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No income snapshot for this company yet — press Refresh to build it.
        </div>
      ) : (
        <>
          {/* ── KPI row ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard tone="orange" icon={TrendingUp} label="Income" subtitle="Yearly"
                     value={fmtInc(data.kpi.ytd)} pct={pctChange(data.kpi.ytd, data.kpi.pytd)}
                     hint={`PYTD ${fmtInc(data.kpi.pytd)} · PY ${fmtInc(data.kpi.py_total)}`} />
            <KpiCard tone="grey" icon={BarChart3} label="Highest Change"
                     subtitle={mv.highestChange?.grp ?? "—"}
                     value={mv.highestChange ? fmtInc(mv.highestChange.ytd) : "—"}
                     pct={mv.highestChange?.change ?? null}
                     hint={mv.highestChange ? hintFor(mv.highestChange) : ""} />
            <KpiCard tone="up" icon={TrendingUp} label="Highest Increase"
                     subtitle={mv.highestIncrease?.grp ?? "—"}
                     value={mv.highestIncrease ? fmtInc(mv.highestIncrease.ytd) : "—"}
                     pct={mv.highestIncrease?.change ?? null} forceUp
                     hint={mv.highestIncrease ? hintFor(mv.highestIncrease) : ""} />
            <KpiCard tone="down" icon={TrendingDown} label="Lowest Change"
                     subtitle={mv.lowestChange?.grp ?? "—"}
                     value={mv.lowestChange ? fmtInc(mv.lowestChange.ytd) : "—"}
                     pct={mv.lowestChange?.change ?? null}
                     hint={mv.lowestChange ? hintFor(mv.lowestChange) : ""} />
          </div>

          {/* ── Quarterly · Trend ────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SalesPanel title="Quarterly Income" icon={PieIcon} subtitle="Inner ring: current FY · Outer: prior FY">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={quarterly.cy} dataKey="value" nameKey="name" innerRadius={30} outerRadius={62}>
                    {quarterly.cy.map((_, i) => <Cell key={i} fill={incCat(i)} />)}
                  </Pie>
                  <Pie data={quarterly.py} dataKey="value" nameKey="name" innerRadius={72} outerRadius={100}>
                    {quarterly.py.map((_, i) => <Cell key={i} fill={incCat(i)} fillOpacity={0.45} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtInc(v)} />
                  <Legend verticalAlign="bottom" height={24} iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Income Trend" icon={BarChart3} subtitle="Monthly income, this FY vs last">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} />
                  <YAxis tickFormatter={tickInc} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtInc(v)} />
                  <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="py" name={`FY ${prior}`} fill={INC_PRIOR} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cy" name={`FY ${fy}`} fill={INC_CURRENT} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>
          </div>

          {/* ── Income Groups · Sub Groups ───────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SalesPanel title="Income Groups" icon={Layers} subtitle="By top-level group — current FY (YTD) vs prior FY">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={groupBars} margin={{ bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0}
                         angle={-20} textAnchor="end" height={40} />
                  <YAxis tickFormatter={tickInc} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtInc(v)} />
                  <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="cy" name={`FY ${fy}`} fill={INC_CURRENT} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="py" name={`FY ${prior}`} fill={INC_PRIOR} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Income Sub Groups" icon={Layers} subtitle="By sub-group — discounts & returns net negative">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={subgroupBars} margin={{ bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0}
                         angle={-30} textAnchor="end" height={54} />
                  <YAxis tickFormatter={tickInc} tick={AXIS_TICK} width={46}
                         domain={[subgroupHasNeg ? "auto" : 0, "auto"]} />
                  <Tooltip formatter={(v: number) => fmtInc(v)} />
                  <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="cy" name={`FY ${fy}`} fill={INC_CURRENT} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="py" name={`FY ${prior}`} fill={INC_PRIOR} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>
          </div>

          {/* ── Income table (Group → Sub-group → Ledger) ────────────── */}
          <SalesPanel title="Income" icon={TrendingUp} subtitle="Drill: group → sub-group → ledger" bodyClassName="p-0">
            <ScrollableTable className="border-b border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Income Name</Th><Th right>YTD Amount</Th><Th right>PYTD Amount</Th>
                    <Th right>Change (in %)</Th><Th right>Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {groupPage.pageItems.map((g) => {
                    const gOpen = openGroups.has(g.grp);
                    return (
                      <Fragment key={g.grp}>
                        <tr className="hover:bg-muted/30 cursor-pointer font-semibold"
                            onClick={() => toggleGroup(g.grp)}>
                          <Td>
                            <span className="inline-flex items-center gap-1">
                              {gOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {g.grp}
                            </span>
                          </Td>
                          <Td right>{fmtInc(g.ytd)}</Td>
                          <Td right>{fmtInc(g.pytd)}</Td>
                          <Td right><ChangeCell current={Number(g.ytd)} prior={Number(g.pytd)} /></Td>
                          <Td right />
                        </tr>

                        {gOpen && subsByGroup(g.grp).map((s) => {
                          const sOpen = openSubs.has(subKey(g.grp, s.sub));
                          return (
                            <Fragment key={subKey(g.grp, s.sub)}>
                              <tr className="hover:bg-muted/30 cursor-pointer bg-muted/10"
                                  onClick={() => toggleSub(g.grp, s.sub)}>
                                <Td className="pl-8">
                                  <span className="inline-flex items-center gap-1 text-navy/80">
                                    {sOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    {s.sub}
                                  </span>
                                </Td>
                                <Td right>{fmtInc(s.ytd)}</Td>
                                <Td right>{fmtInc(s.pytd)}</Td>
                                <Td right><ChangeCell current={Number(s.ytd)} prior={Number(s.pytd)} /></Td>
                                <Td right />
                              </tr>

                              {sOpen && ledgersBySub(g.grp, s.sub).map((l) => (
                                <tr key={`${g.grp}|${s.sub}|${l.ledger}`} className="hover:bg-muted/30">
                                  <Td className="pl-14 max-w-[360px] truncate text-grey">{l.ledger}</Td>
                                  <Td right>{fmtInc(l.ytd)}</Td>
                                  <Td right>{fmtInc(l.pytd)}</Td>
                                  <Td right><ChangeCell current={Number(l.ytd)} prior={Number(l.pytd)} /></Td>
                                  <Td right>
                                    {l.ledger_id && (
                                      <Link to={`${BASE}/reports/ledger-voucher/${l.ledger_id}`}
                                            title="View ledger vouchers"
                                            className="inline-flex text-navy/60 hover:text-orange">
                                        <Eye className="h-4 w-4" />
                                      </Link>
                                    )}
                                  </Td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border font-semibold">
                  <tr>
                    <Td>Total Income</Td>
                    <Td right>{fmtInc(data.kpi.ytd)}</Td>
                    <Td right>{fmtInc(data.kpi.pytd)}</Td>
                    <Td right><ChangeCell current={data.kpi.ytd} prior={data.kpi.pytd} /></Td>
                    <Td right />
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
            <Pagination state={groupPage} rowsLabel="groups" showPageSize={false} />
          </SalesPanel>
        </>
      )}
    </div>
  );
}
