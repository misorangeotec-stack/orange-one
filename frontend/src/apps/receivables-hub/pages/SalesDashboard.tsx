import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Gauge as GaugeIcon, Globe2, LineChart as LineIcon,
  Package, RefreshCw, Search, TrendingDown, TrendingUp, Users, Wallet,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  fmtDash, tickDash, pctChange, dashPeriod, dashFyOptions,
  loadSalesDashboard, loadSalesDashboardLastRefresh, refreshSalesDashboardCompany,
  emergingProducts, nonPerformingProducts, topProductsByQty, topProductsByRevenue,
  geoBand, achievementPct, tieBroken, isUntagged, PRODUCT_BASIS_LABEL,
  DASH_CURRENT, DASH_PRIOR,
  type ProductBasis, type DashMonthPoint,
} from "@hub/lib/salesDashboard";

/**
 * Dashboards → Sales Dashboard.
 *
 * A rebuild of the Talligence "Sales Dashboard" screen (Misc/Talligence-Inputs/) in Orange One's
 * palette. Thirteen panels: Total Sales, Income, Expense, Geography, Emerging / Non-Performing
 * Products, Monthly Sales, Contributing Customers, Accounts Receivables, Monthly Sales vs AR,
 * Products by Quantity / Revenue, and Sales Person Performance.
 *
 * Every figure comes from ONE ConnectWave RPC (`rpt_sales_dashboard`). Panel-by-panel tally against
 * the source screen: Misc/Talligence-Inputs/sales-dashboard-reconciliation.md.
 *
 * FOUR DELIBERATE DIVERGENCES FROM THE SOURCE, all decided with the business:
 *  1. GAUGE — Talligence's arc is unlabelled and no target exists anywhere in Tally. Ours reads
 *     achievement against the SAME PERIOD LAST YEAR, which is the figure already on the card, and
 *     says so on the dial. Nothing is invented.
 *  2. CUSTOMERS — their dashboard rosters the whole book (129 rows, most with zero sales) while
 *     their OWN Sales Gain screen reports 89 for the same period. We list YTD-active customers, so
 *     our two screens agree with each other.
 *  3. PRODUCT CHARTS — theirs compare ~4 months of this year against 12 months of last, which
 *     structurally flatters Emerging and punishes Non-Performing. Ours defaults to the like-for-like
 *     window with a toggle to their basis, and the caption always names the window in use.
 *  4. SALESPERSONS — they print "No Data Found" (Tally has no salesperson dimension); we fill it
 *     from ext_ledger_tags and carry the untagged remainder as an explicit row, because on Noida
 *     that is 24.5% of YTD and a silent Top-5 would not tie to the KPI.
 *
 * INCOME PYTD DOES NOT TIE and cannot be made to: at the one as-on date that makes Expense exact,
 * Income is ₹3.9 L short, and no other date makes both work. Footnoted on the card.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/** FY month order — Indian FY runs Apr → Mar. */
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };

const AR_COLOR = "#9957DB";     // violet — receivables, distinct from the sales orange
const GOOD = "#27AE60";
const BAD = "#E5484D";

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}

const qtyFmt = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Talligence prints "-" with no prior base, else a signed arrow. */
function DeltaText({ current, prior, invert }: { current: number; prior: number; invert?: boolean }) {
  const p = pctChange(current, prior);
  if (p === null) return <span className="text-muted-foreground">—</span>;
  const up = p >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-semibold",
                        good ? "text-emerald-600" : "text-destructive")}>
      {Math.abs(p).toFixed(2)}%
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
    </span>
  );
}

/* ---- Hero banner (matches the Sales / Income / Expense / Gain reports) ----- */

function DashHero({
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
            <BarChart3 className="h-6 w-6 text-orange" /> Sales Dashboard
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>
        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">{controls}</div>
      </div>
    </div>
  );
}

/**
 * Achievement dial — 180° arc, needle, read-out below the pivot.
 *
 * Written here rather than reused from components/clevel/Gauge.tsx on purpose: that one is bound to
 * the C-Level RYG palette, and the master reports keep their own colours so they cannot shift when
 * that screen is reworked. Over-target pins the needle and prints ">max".
 */
function AchievementGauge({ pct, caption }: { pct: number | null; caption: string }) {
  const max = 120;
  const v = pct == null ? 0 : Math.max(0, Math.min(pct, max));
  const color = pct == null ? "hsl(220,16%,80%)" : pct < 75 ? BAD : pct < 100 ? "#F8B62B" : GOOD;
  const cx = 130, cy = 122, r = 100, stroke = 18;
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (radius: number, deg: number) => ({ x: cx + radius * Math.cos(rad(deg)), y: cy - radius * Math.sin(rad(deg)) });
  const angleFor = (x: number) => 180 - (x / max) * 180;
  const A = pt(r, 180), B = pt(r, 0), V = pt(r, angleFor(v));
  const tip = pt(r - stroke - 6, angleFor(v));

  return (
    <div className="flex w-full items-center justify-center" style={{ height: 190 }}>
      <svg viewBox={`0 0 ${cx * 2} ${cy + 56}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <path d={`M ${A.x} ${A.y} A ${r} ${r} 0 0 1 ${B.x} ${B.y}`} fill="none"
              stroke="hsl(220,16%,91%)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={`M ${A.x} ${A.y} A ${r} ${r} 0 0 1 ${V.x} ${V.y}`} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="hsl(220,25%,32%)" strokeWidth={4} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={7} fill="hsl(220,25%,32%)" />
        <circle cx={cx} cy={cy} r={3} fill="white" />
        <text x={A.x} y={cy + 16} textAnchor="middle" fontSize="10.5" fill="hsl(220 10% 60%)">0%</text>
        <text x={B.x} y={cy + 16} textAnchor="middle" fontSize="10.5" fill="hsl(220 10% 60%)">{max}%</text>
        <text x={cx} y={cy + 34} textAnchor="middle" fontWeight="700" fontSize="21" fill="hsl(220 45% 20%)">
          {pct == null ? "—" : `${pct > max ? `>${max}` : pct.toFixed(1)}%`}
        </text>
        <text x={cx} y={cy + 50} textAnchor="middle" fontSize="10.5" fill="hsl(220 10% 58%)">{caption}</text>
      </svg>
    </div>
  );
}

/** A big ₹ headline with its delta badge — the shape shared by Income / Expense / AR. */
function MetricHead({
  value, prior, priorCaption, invert,
}: { value: number; prior: number; priorCaption: string; invert?: boolean }) {
  return (
    <div className="mb-1 flex items-start justify-between gap-2">
      <div className="text-[22px] font-bold leading-none tabular-nums text-navy">{fmtDash(value)}</div>
      <div className="shrink-0 text-right">
        <DeltaText current={value} prior={prior} invert={invert} />
        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
          {fmtDash(prior)} <span className="opacity-70">({priorCaption})</span>
        </div>
      </div>
    </div>
  );
}

export default function SalesDashboard() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => dashFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [basis, setBasis] = useState<ProductBasis>("pytd");
  const [geoTab, setGeoTab] = useState<"india" | "world" | "unallocated">("india");
  const [custQuery, setCustQuery] = useState("");

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

  const period = useMemo(() => dashPeriod(fy), [fy]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["salesDashboard", "v1", companyGuid, fy],
    queryFn: () => loadSalesDashboard(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["salesDashboardLastRefresh", companyGuid, fy],
    queryFn: () => loadSalesDashboardLastRefresh(companyGuid, fy),
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
      const res = await refreshSalesDashboardCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.days ?? 0} days of receivables movement.`);
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
  const kpi = data?.kpi;

  /** Align a cy/py month series onto the Apr→Mar axis. */
  const alignMonths = (points: DashMonthPoint[] | undefined) => {
    const m = new Map<string, number>();
    for (const p of points ?? []) m.set(`${p.fy}|${p.m}`, Number(p.amt) || 0);
    return FY_MONTHS.map((mo) => ({
      name: MONTH_LABEL[mo],
      cy: m.has(`cy|${mo}`) ? m.get(`cy|${mo}`)! : null,
      py: m.has(`py|${mo}`) ? m.get(`py|${mo}`)! : null,
    }));
  };

  const monthlySales = useMemo(() => alignMonths(data?.monthly), [data]);
  const incomeMonths = useMemo(() => alignMonths(data?.income?.monthly), [data]);
  const expenseMonths = useMemo(() => alignMonths(data?.expense?.monthly), [data]);
  const arMonths = useMemo(() => alignMonths(data?.ar?.monthly), [data]);

  /** Panel 10 — monthly sales beside month-end AR, current year only. */
  const salesVsAr = useMemo(
    () => FY_MONTHS.map((mo, i) => ({
      name: MONTH_LABEL[mo],
      sales: monthlySales[i]?.cy ?? null,
      ar: arMonths[i]?.cy ?? null,
    })).filter((r) => r.sales != null || r.ar != null),
    [monthlySales, arMonths],
  );

  /* Geography — the India / World / Un-Allocated partition. Every party in these books carries an
     Indian state, so the other two tabs are legitimately empty rather than broken. */
  const geoAll = data?.geography ?? [];
  const geoRows = useMemo(() => {
    const unalloc = geoAll.filter((g) => g.state === "Un-Allocated");
    const known = geoAll.filter((g) => g.state !== "Un-Allocated");
    if (geoTab === "unallocated") return unalloc;
    if (geoTab === "world") return [];
    return known;
  }, [geoAll, geoTab]);
  const geoTotal = useMemo(() => geoRows.reduce((s, g) => s + (Number(g.ytd) || 0), 0), [geoRows]);

  const products = data?.products ?? [];
  const emerging = useMemo(() => emergingProducts(products, basis), [products, basis]);
  const nonPerf = useMemo(() => nonPerformingProducts(products, basis), [products, basis]);
  const byQty = useMemo(() => topProductsByQty(products), [products]);
  const byRev = useMemo(() => topProductsByRevenue(products), [products]);
  const revTotal = useMemo(() => byRev.reduce((s, r) => s + r.sales, 0), [byRev]);

  const customers = data?.customers ?? [];
  const custFiltered = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    return q ? customers.filter((c) => c.party.toLowerCase().includes(q)) : customers;
  }, [customers, custQuery]);
  const custPage = usePagination(custFiltered, { pageSize: 10, resetKey: `${companyGuid}|${fy}|${custQuery}` });
  const custTotal = useMemo(() => custFiltered.reduce((s, c) => s + (Number(c.sales) || 0), 0), [custFiltered]);

  const salespersons = data?.salespersons ?? [];
  const spTagged = useMemo(() => salespersons.filter((s) => !isUntagged(s.name)), [salespersons]);
  const spUntagged = useMemo(() => salespersons.find((s) => isUntagged(s.name)), [salespersons]);

  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;
  const achievement = kpi ? achievementPct(kpi.ytd, kpi.pytd) : null;

  const heroSummary: React.ReactNode = heroLoading
    ? "Loading the sales book…"
    : kpi
      ? (
        <>
          <span className="font-semibold text-white">{fmtDash(kpi.ytd)}</span> sold so far this year
          {kpi.pytd > 0 && (
            <> against <span className="font-semibold text-white">{fmtDash(kpi.pytd)}</span> in the same
              period last year{achievement != null && <> ({achievement.toFixed(1)}%)</>}</>
          )}.
        </>
      )
      : "Sales, income, expense and receivables on one screen — straight from the Tally books.";

  const heroMeta = [
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 10:00 PM",
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

  const moneyTooltip = {
    contentStyle: { fontSize: 12, borderRadius: 8, border: "1px solid hsl(220 15% 88%)" },
    formatter: (v: number | string) => fmtDash(Number(v)),
  };
  const qtyTooltip = {
    contentStyle: { fontSize: 12, borderRadius: 8, border: "1px solid hsl(220 15% 88%)" },
    formatter: (v: number | string) => qtyFmt(Number(v)),
  };

  const cyLabel = fy;
  const pyLabel = useMemo(() => {
    const start = Number(fy.slice(0, 4)) - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  }, [fy]);

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      <DashHero
        company={company?.rawName}
        fy={fy}
        periodLabel={`${dmy(period.from)} → ${dmy(period.asOn)}`}
        metaLine={heroMeta}
        summary={heroSummary}
        controls={heroControls}
      />

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-muted">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Rebuilding this company's receivables walk — {elapsed.toFixed(0)}s elapsed
            {lastRefresh?.seconds ? ` (last run took ${lastRefresh.seconds}s)` : ""}
          </div>
        </div>
      )}
      {refreshNote && !busy && <div className="text-[11px] text-muted-foreground">{refreshNote}</div>}

      {errText && (
        <Card className="rounded-card border-border bg-surface p-4 text-[12.5px] text-destructive">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{errText}
        </Card>
      )}

      {/* This screen spans four snapshots that refresh on four separate crons. If one goes stale the
          panels stop agreeing with each other — say so rather than let the reader find it. */}
      {!isLoading && tieBroken(data?.meta) && (
        <Card className="rounded-card border-orange/30 bg-orange-soft/40 p-3">
          <div className="flex items-start gap-2 text-[12.5px] text-navy">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange" />
            <div>
              <span className="font-semibold">Panels are out of step.</span>{" "}
              Geography, customers and salespersons are built from separate nightly snapshots to the
              sales headline, and one of them is behind — Geography differs by{" "}
              {fmtDash(data?.meta.tie_geo ?? 0)}, salespersons by {fmtDash(data?.meta.tie_sp ?? 0)}.
              Use <b>Refresh</b>, or the Sales Report's own refresh, to bring them level.
            </div>
          </div>
        </Card>
      )}

      {/* ── Row 1: Total Sales gauge · Income · Expense ─────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel title="Total Sales (YTD)" icon={GaugeIcon} loading={isLoading}
                    subtitle={kpi ? `${fmtDash(kpi.pytd)} in the same period last year` : undefined}>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[26px] font-bold leading-none tabular-nums text-navy">{fmtDash(kpi?.ytd ?? 0)}</div>
            <DeltaText current={kpi?.ytd ?? 0} prior={kpi?.pytd ?? 0} />
          </div>
          <AchievementGauge pct={achievement} caption="achieved vs same period last year" />
        </SalesPanel>

        <SalesPanel title="Income" icon={TrendingUp} loading={isLoading}
                    subtitle="Sales Accounts + Direct & Indirect Incomes">
          <MetricHead value={data?.income.ytd ?? 0} prior={data?.income.pytd ?? 0} priorCaption="PYTD" />
          <ResponsiveContainer width="100%" height={155}>
            <LineChart data={incomeMonths} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="py" name={pyLabel} stroke={DASH_PRIOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="cy" name={cyLabel} stroke={DASH_CURRENT} strokeWidth={2.2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          {/* Recorded honestly: this one figure cannot be reproduced from the Tally income side. */}
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Talligence shows a prior-year figure ~₹3.9 L higher. At the date that makes Expense match
            exactly, no such income exists in this book — ours is the Tally-true number.
          </p>
        </SalesPanel>

        <SalesPanel title="Expense" icon={Wallet} loading={isLoading}
                    subtitle="Purchase Accounts + Direct & Indirect Expenses">
          <MetricHead value={data?.expense.ytd ?? 0} prior={data?.expense.pytd ?? 0} priorCaption="PYTD" invert />
          <ResponsiveContainer width="100%" height={155}>
            <LineChart data={expenseMonths} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="py" name={pyLabel} stroke={DASH_PRIOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="cy" name={cyLabel} stroke={DASH_CURRENT} strokeWidth={2.2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      {/* ── Row 2: Geography · Emerging · Non-Performing ────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel
          title="Geography Based Sales"
          icon={Globe2}
          loading={isLoading}
          subtitle={geoTab === "india" ? `Total in India: ${fmtDash(geoTotal)}` : undefined}
          actions={
            <div className="flex rounded-input border border-line p-0.5">
              {([["india", "India"], ["world", "World"], ["unallocated", "Un-Allocated"]] as const).map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setGeoTab(k)}
                        className={cn("rounded-[6px] px-2 py-0.5 text-[10.5px] font-medium transition",
                                      geoTab === k ? "bg-navy text-white" : "text-grey-2 hover:text-navy")}>
                  {lbl}
                </button>
              ))}
            </div>
          }
          empty={!isLoading && geoRows.length === 0}
          emptyMessage={
            geoTab === "world" ? "No sales to parties outside India."
              : geoTab === "unallocated" ? "Every customer carries a state — nothing unallocated."
              : "No sales in the period."
          }
        >
          <ResponsiveContainer width="100%" height={Math.max(160, geoRows.length * 26)}>
            <BarChart data={geoRows.map((g) => ({ name: g.state, ytd: Number(g.ytd) || 0 }))}
                      layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} />
              <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={104} />
              <Tooltip {...moneyTooltip} />
              <Bar dataKey="ytd" name="YTD" fill={DASH_CURRENT} radius={[0, 3, 3, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
          {/* The source shades a choropleth by share-of-total; we print the same bands as chips,
              which carries the identical information without shipping a map asset. */}
          <div className="mt-2 flex flex-wrap gap-1">
            {geoRows.map((g) => {
              const share = geoTotal ? ((Number(g.ytd) || 0) / geoTotal) * 100 : 0;
              return (
                <span key={g.state} className="rounded-pill bg-muted/60 px-2 py-0.5 text-[10px] text-grey-2">
                  {g.state} <b className="text-navy">{share.toFixed(1)}%</b> · {geoBand(share)}
                </span>
              );
            })}
          </div>
        </SalesPanel>

        <SalesPanel
          title="Top 5 Emerging Products"
          icon={TrendingUp}
          loading={isLoading}
          subtitle={`Quantity gain vs ${PRODUCT_BASIS_LABEL[basis].toLowerCase()}`}
          actions={
            <button type="button" onClick={() => setBasis(basis === "pytd" ? "pyfull" : "pytd")}
                    className="rounded-input border border-line px-2 py-0.5 text-[10.5px] font-medium text-grey-2 hover:text-navy">
              {basis === "pytd" ? "Like-for-like" : "Full prior year"}
            </button>
          }
          empty={!isLoading && emerging.length === 0}
          emptyMessage="No product grew against the comparison period."
        >
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={emerging.map((r) => ({ name: r.item, cy: r.cyQty, py: r.pyQty }))}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                     interval={0} tickFormatter={(s: string) => (s.length > 12 ? `${s.slice(0, 12)}…` : s)} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={50}
                     tickFormatter={(n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))} />
              <Tooltip {...qtyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="cy" name={cyLabel} fill={DASH_CURRENT} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey="py" name={pyLabel} fill={DASH_PRIOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel
          title="Top 5 Non Performing Products"
          icon={TrendingDown}
          loading={isLoading}
          subtitle={`Quantity drop vs ${PRODUCT_BASIS_LABEL[basis].toLowerCase()}`}
          empty={!isLoading && nonPerf.length === 0}
          emptyMessage="No product declined against the comparison period."
        >
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={nonPerf.map((r) => ({ name: r.item, cy: r.cyQty, py: r.pyQty }))}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                     interval={0} tickFormatter={(s: string) => (s.length > 12 ? `${s.slice(0, 12)}…` : s)} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={50}
                     tickFormatter={(n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))} />
              <Tooltip {...qtyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="cy" name={cyLabel} fill={BAD} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey="py" name={pyLabel} fill={DASH_PRIOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Products with no sales at all this year are excluded — they are discontinued, not declining.
          </p>
        </SalesPanel>
      </div>

      {/* ── Row 3: Monthly Sales · Contributing Customers ───────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="Monthly Sales" icon={BarChart3} loading={isLoading}>
          <MetricHead value={kpi?.ytd ?? 0} prior={kpi?.pytd ?? 0} priorCaption="PYTD" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlySales} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="cy" name={cyLabel} fill={DASH_CURRENT} radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="py" name={pyLabel} fill={DASH_PRIOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel
          title="Contributing Customers"
          icon={Users}
          loading={isLoading}
          subtitle={`${customers.length} customers with sales this year`}
          bodyClassName="p-0"
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey" />
              <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)} placeholder="Search"
                     className="h-7 w-36 rounded-input border border-line pl-7 pr-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>
          }
        >
          <ScrollableTable maxHeight="max-h-[280px]">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-muted/40">
                <tr className="text-left text-grey-2">
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 text-right font-semibold">Total Sales</th>
                  <th className="px-3 py-2 text-right font-semibold">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {custPage.pageItems.map((c) => (
                  <tr key={c.party} className="border-t border-line/70">
                    <td className="max-w-[260px] truncate px-3 py-1.5 text-navy" title={c.party}>{c.party}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtDash(c.sales)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-grey-2">
                      {custTotal ? `${((Number(c.sales) / custTotal) * 100).toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtDash(custTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
          <Pagination state={custPage} rowsLabel="customers" showPageSize={false} />
        </SalesPanel>
      </div>

      {/* ── Row 4: Accounts Receivables · Monthly Sales vs Total AR ─────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="Accounts Receivables" icon={LineIcon} loading={isLoading}
                    subtitle="Closing Sundry Debtors at each month end">
          <MetricHead value={data?.ar.current ?? 0} prior={data?.ar.pytd ?? 0} priorCaption="PYTD" invert />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={arMonths} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} domain={["auto", "auto"]} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="py" name={pyLabel} stroke={DASH_PRIOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="cy" name={cyLabel} stroke={AR_COLOR} strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Monthly Sales vs Total AR" icon={BarChart3} loading={isLoading}
                    subtitle="How much was billed against how much is still owed"
                    empty={!isLoading && salesVsAr.length === 0}>
          <ResponsiveContainer width="100%" height={272}>
            <BarChart data={salesVsAr} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="sales" name="Sales" fill={DASH_CURRENT} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey="ar" name="AR" fill={AR_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      {/* ── Row 5: Products by Quantity · by Revenue ────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        {([
          { title: "Top 5 Products by Quantity", rows: byQty, footer: null },
          { title: "Top 5 Products by Revenue", rows: byRev, footer: revTotal },
        ] as const).map((panel) => (
          <SalesPanel key={panel.title} title={panel.title} icon={Package} loading={isLoading}
                      bodyClassName="p-0" empty={!isLoading && panel.rows.length === 0}>
            <ScrollableTable>
              <table className="w-full text-[12.5px]">
                <thead className="bg-muted/40">
                  <tr className="text-left text-grey-2">
                    <th className="px-3 py-2 font-semibold">Item Name</th>
                    <th className="px-3 py-2 text-right font-semibold">QTY</th>
                    <th className="px-3 py-2 text-right font-semibold">Base Units</th>
                    <th className="px-3 py-2 text-right font-semibold">Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.rows.map((r) => (
                    <tr key={r.item} className="border-t border-line/70">
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-navy" title={r.item}>{r.item}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qtyFmt(r.qty)}</td>
                      <td className="px-3 py-1.5 text-right text-grey-2">{r.baseUnit || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtDash(r.sales)}</td>
                    </tr>
                  ))}
                </tbody>
                {panel.footer != null && (
                  <tfoot>
                    <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
                      <td className="px-3 py-2" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDash(panel.footer)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </ScrollableTable>
          </SalesPanel>
        ))}
      </div>

      {/* ── Row 6: Sales Person Performance ─────────────────────────────── */}
      <SalesPanel
        title="Sales Person Performance"
        icon={Users}
        loading={isLoading}
        subtitle="From Orange One's own salesperson tags — Tally carries no salesperson dimension"
        bodyClassName="p-0"
        empty={!isLoading && salespersons.length === 0}
        emptyMessage="No customers are tagged to a salesperson yet."
      >
        <ScrollableTable>
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/40">
              <tr className="text-left text-grey-2">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 text-right font-semibold">YTD</th>
                <th className="px-3 py-2 text-right font-semibold">PYTD</th>
                <th className="px-3 py-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {spTagged.map((s) => (
                <tr key={s.name} className="border-t border-line/70">
                  <td className="px-3 py-1.5 text-navy">{s.name}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", s.ytd < 0 && "text-destructive")}>
                    {fmtDash(s.ytd)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-grey-2">{fmtDash(s.pytd)}</td>
                  <td className="px-3 py-1.5 text-right"><DeltaText current={s.ytd} prior={s.pytd} /></td>
                </tr>
              ))}
              {/* Not a rounding error — on Noida this is a quarter of YTD. Hiding it would leave the
                  panel silently short of the sales headline. */}
              {spUntagged && (
                <tr className="border-t border-line/70 bg-muted/20">
                  <td className="px-3 py-1.5 italic text-grey-2">Untagged customers</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-grey-2">{fmtDash(spUntagged.ytd)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-grey-2">{fmtDash(spUntagged.pytd)}</td>
                  <td className="px-3 py-1.5 text-right"><DeltaText current={spUntagged.ytd} prior={spUntagged.pytd} /></td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtDash(salespersons.reduce((s, r) => s + (Number(r.ytd) || 0), 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtDash(salespersons.reduce((s, r) => s + (Number(r.pytd) || 0), 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
        {spUntagged && (
          <p className="px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
            Tag customers to a salesperson in Admin → Users to move sales out of the untagged row.
          </p>
        )}
      </SalesPanel>
    </div>
  );
}
