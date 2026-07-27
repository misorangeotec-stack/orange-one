import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Gauge as GaugeIcon, Globe2, LineChart as LineIcon,
  Package, RefreshCw, Search, ShoppingCart, TrendingUp, Truck, Wallet,
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
  loadPurchaseDashboard, loadPurchaseDashboardLastRefresh, refreshPurchaseDashboardCompany,
  topProductsByQty, topProductsByAmount, geoBand, achievementPct, tieBroken, productCoverage,
  DASH_CURRENT, DASH_PRIOR,
  type DashMonthPoint,
} from "@hub/lib/purchaseDashboard";

/**
 * Dashboards → Purchase Dashboard.
 *
 * A rebuild of the Talligence "Purchase Dashboard" screen (Misc/Talligence-Inputs/) in Orange One's
 * palette, and the purchase-side twin of SalesDashboard.tsx. Ten panels: Total Purchase, Income,
 * Expense, Geography, Accounts Payables, Monthly Purchase vs AP, Monthly Purchase, Contributing
 * Vendors, and Products by Quantity / Amount.
 *
 * Every figure comes from ONE ConnectWave RPC (`rpt_purchase_dashboard`). Panel-by-panel tally
 * against the source screen: Misc/Talligence-Inputs/purchase-dashboard-reconciliation.md.
 *
 * FOUR DELIBERATE DIVERGENCES FROM THE SOURCE:
 *  1. TOTAL PURCHASE — Talligence reads ₹3.71 Cr; the book says ₹6.41 Cr. THEIR current year is
 *     stale (their purchase-voucher sync lagged their bill sync — proven six ways when the Purchase
 *     Report was built, and their prior year ties to the rupee). We ship the Tally-true figure, as
 *     Master Reports → Purchase already does, so our two purchase screens agree. Footnoted on the card.
 *  2. GAUGE — their arc is unlabelled and no target exists anywhere in Tally. Ours reads achievement
 *     against the SAME PERIOD LAST YEAR, which is the figure already on the card, and says so on the
 *     dial. Unlike the sales gauge it is a single NEUTRAL colour: buying less than last year is not
 *     self-evidently good or bad, and a red/amber arc would assert that it is.
 *  3. GEOGRAPHY — theirs is a shaded choropleth. Ours is a ranked bar chart plus the same share
 *     bands as chips, which carries identical information without shipping a map asset.
 *  4. VENDORS — 31 rows against their 29. The gap is the RELATED PARTY PURCHASE sub-group, which
 *     they exclude and we include; the same divergence the Purchase Report already documents.
 *
 * INCOME PYTD DOES NOT TIE and cannot be made to — ₹3.9 L short at the one as-on date that makes
 * Expense exact. Identical to the Sales Dashboard, which carries the same footnote.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/** FY month order — Indian FY runs Apr → Mar. */
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };

/** The same violet Finance → Payables uses for AP, so the metric reads identically on both screens. */
const AP_COLOR = "#9957DB";

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

/* ---- Hero banner (matches the Sales / Purchase / Income / Expense reports) ---- */

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
            <ShoppingCart className="h-6 w-6 text-orange" /> Purchase Dashboard
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
 * Deliberately a SINGLE NEUTRAL colour, unlike the sales gauge's red/amber/green. There is no
 * agreed good direction for purchasing: buying less than last year can mean efficiency or a
 * shrinking business, and Noida's 83.3% would land on amber and silently assert it is a problem.
 */
function AchievementGauge({ pct, caption }: { pct: number | null; caption: string }) {
  const max = 120;
  const v = pct == null ? 0 : Math.max(0, Math.min(pct, max));
  const color = pct == null ? "hsl(220,16%,80%)" : DASH_CURRENT;
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

/** A big ₹ headline with its delta badge — the shape shared by Income / Expense / AP. */
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

export default function PurchaseDashboard() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => dashFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [geoTab, setGeoTab] = useState<"india" | "world" | "unallocated">("india");
  const [vendQuery, setVendQuery] = useState("");

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
    queryKey: ["purchaseDashboard", "v1", companyGuid, fy],
    queryFn: () => loadPurchaseDashboard(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["purchaseDashboardLastRefresh", companyGuid, fy],
    queryFn: () => loadPurchaseDashboardLastRefresh(companyGuid, fy),
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
      const res = await refreshPurchaseDashboardCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.days ?? 0} days of payables movement.`);
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

  const monthlyPurchase = useMemo(() => alignMonths(data?.monthly), [data]);
  const incomeMonths = useMemo(() => alignMonths(data?.income?.monthly), [data]);
  const expenseMonths = useMemo(() => alignMonths(data?.expense?.monthly), [data]);
  const apMonths = useMemo(() => alignMonths(data?.ap?.monthly), [data]);

  /** Monthly purchase beside month-end AP, current year only — the source's Apr→Jul window falls
      out of the data rather than being hardcoded. */
  const purchaseVsAp = useMemo(
    () => FY_MONTHS.map((mo, i) => ({
      name: MONTH_LABEL[mo],
      purchase: monthlyPurchase[i]?.cy ?? null,
      ap: apMonths[i]?.cy ?? null,
    })).filter((r) => r.purchase != null || r.ap != null),
    [monthlyPurchase, apMonths],
  );

  /* Geography — the India / World / Un-Allocated partition. Every vendor in these books carries an
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
  const byQty = useMemo(() => topProductsByQty(products), [products]);
  const byAmt = useMemo(() => topProductsByAmount(products), [products]);
  const amtTotal = useMemo(() => byAmt.reduce((s, r) => s + r.amount, 0), [byAmt]);
  const coverage = useMemo(() => productCoverage(data?.meta, kpi?.ytd), [data, kpi]);

  const vendors = data?.vendors ?? [];
  const vendFiltered = useMemo(() => {
    const q = vendQuery.trim().toLowerCase();
    return q ? vendors.filter((v) => v.party.toLowerCase().includes(q)) : vendors;
  }, [vendors, vendQuery]);
  const vendPage = usePagination(vendFiltered, { pageSize: 10, resetKey: `${companyGuid}|${fy}|${vendQuery}` });
  const vendTotal = useMemo(
    () => vendFiltered.reduce((s, v) => s + (Number(v.purchase) || 0), 0),
    [vendFiltered],
  );

  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;
  const achievement = kpi ? achievementPct(kpi.ytd, kpi.pytd) : null;

  const heroSummary: React.ReactNode = heroLoading
    ? "Loading the purchase book…"
    : kpi
      ? (
        <>
          <span className="font-semibold text-white">{fmtDash(kpi.ytd)}</span> purchased so far this year
          {kpi.pytd > 0 && (
            <> against <span className="font-semibold text-white">{fmtDash(kpi.pytd)}</span> in the same
              period last year{achievement != null && <> ({achievement.toFixed(1)}%)</>}</>
          )}.
        </>
      )
      : "Purchase, income, expense and payables on one screen — straight from the Tally books.";

  const heroMeta = [
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 10:15 PM",
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
            Rebuilding this company's payables walk — {elapsed.toFixed(0)}s elapsed
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

      {/* The payables walk and the payables bill snapshot are two independent derivations of the
          same number, rebuilt by two different nightly crons. If they disagree, one is behind. */}
      {!isLoading && tieBroken(data?.meta) && (
        <Card className="rounded-card border-orange/30 bg-orange-soft/40 p-3">
          <div className="flex items-start gap-2 text-[12.5px] text-navy">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange" />
            <div>
              <span className="font-semibold">Payables are out of step.</span>{" "}
              This screen's ledger walk and the Payables report's bill snapshot are built by separate
              nightly jobs, and they differ by {fmtDash(data?.meta.tie_ap ?? 0)}. Use <b>Refresh</b>,
              or the Payables report's own refresh, to bring them level.
            </div>
          </div>
        </Card>
      )}

      {/* ── Row 1: Total Purchase gauge · Income · Expense ──────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel title="Total Purchase (YTD)" icon={GaugeIcon} loading={isLoading}
                    subtitle={kpi ? `${fmtDash(kpi.pytd)} in the same period last year` : undefined}>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[26px] font-bold leading-none tabular-nums text-navy">{fmtDash(kpi?.ytd ?? 0)}</div>
            <DeltaText current={kpi?.ytd ?? 0} prior={kpi?.pytd ?? 0} />
          </div>
          <AchievementGauge pct={achievement} caption="of the same period last year" />
          {/* Recorded honestly: the source screen under-reports this one figure. */}
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Talligence shows a lower current year — its purchase-voucher sync lags its bill sync, while
            its prior year ties exactly. This is the Tally-true figure, matching Master Reports → Purchase.
          </p>
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

      {/* ── Row 2: Geography · Accounts Payables · Monthly Purchase vs AP ── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel
          title="Geography Based Purchase"
          icon={Globe2}
          loading={isLoading}
          subtitle={geoTab === "india" ? `Total Purchase in INDIA: ${fmtDash(geoTotal)}` : undefined}
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
            geoTab === "world" ? "No purchases from parties outside India."
              : geoTab === "unallocated" ? "Every vendor carries a state — nothing unallocated."
              : "No purchases in the period."
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

        <SalesPanel title="Accounts Payables" icon={LineIcon} loading={isLoading}
                    subtitle="Closing Sundry Creditors at each month end">
          <MetricHead value={data?.ap.current ?? 0} prior={data?.ap.pytd ?? 0} priorCaption="PYTD" invert />
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={apMonths} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} domain={["auto", "auto"]} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="py" name={pyLabel} stroke={DASH_PRIOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="cy" name={cyLabel} stroke={AP_COLOR} strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          {/* A negative balance is not an error: it means advances paid to suppliers exceed what is
              owed to them. Finance → Payables prints the same sign on the same book. */}
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Net of supplier advances, so a negative figure means suppliers owe us more than we owe them.
          </p>
        </SalesPanel>

        <SalesPanel title="Monthly Purchase vs Total AP" icon={BarChart3} loading={isLoading}
                    subtitle="How much was bought against how much is still owed"
                    empty={!isLoading && purchaseVsAp.length === 0}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={purchaseVsAp} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={48} />
              <Tooltip {...moneyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="purchase" name="Purchase" fill={DASH_CURRENT} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Bar dataKey="ap" name="AP" fill={AP_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      {/* ── Row 3: Monthly Purchase · Contributing Vendors ──────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel title="Monthly Purchase" icon={BarChart3} loading={isLoading}>
          <MetricHead value={kpi?.ytd ?? 0} prior={kpi?.pytd ?? 0} priorCaption="PYTD" />
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyPurchase} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
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
          title="Contributing Vendors"
          icon={Truck}
          loading={isLoading}
          subtitle={`${vendors.length} vendors active this year or last`}
          bodyClassName="p-0"
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey" />
              <input value={vendQuery} onChange={(e) => setVendQuery(e.target.value)} placeholder="Search"
                     className="h-7 w-36 rounded-input border border-line pl-7 pr-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>
          }
        >
          <ScrollableTable maxHeight="max-h-[280px]">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-muted/40">
                <tr className="text-left text-grey-2">
                  <th className="px-3 py-2 font-semibold">Vendor</th>
                  <th className="px-3 py-2 text-right font-semibold">Purchase</th>
                  <th className="px-3 py-2 text-right font-semibold">Contribution (in %)</th>
                </tr>
              </thead>
              <tbody>
                {vendPage.pageItems.map((v) => (
                  <tr key={v.party} className="border-t border-line/70">
                    <td className="max-w-[260px] truncate px-3 py-1.5 text-navy" title={v.party}>{v.party}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtDash(v.purchase)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-grey-2">
                      {vendTotal ? `${((Number(v.purchase) / vendTotal) * 100).toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtDash(vendTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
          <Pagination state={vendPage} rowsLabel="vendors" showPageSize={false} />
        </SalesPanel>
      </div>

      {/* ── Row 4: Products by Quantity · by Amount ─────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        {([
          { title: "Top 5 Products by Quantity", rows: byQty, footer: null },
          { title: "Top 5 Products by Amount", rows: byAmt, footer: amtTotal },
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
                    <th className="px-3 py-2 text-right font-semibold">Total Purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {panel.rows.map((r) => (
                    <tr key={r.item} className="border-t border-line/70">
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-navy" title={r.item}>{r.item}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{qtyFmt(r.qty)}</td>
                      <td className="px-3 py-1.5 text-right text-grey-2">{r.baseUnit || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtDash(r.amount)}</td>
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
            {/* Coverage, not a warning: item lines exist only on GST PURCHASE vouchers, so credit
                notes, debit notes and journals carry purchase value with no stock item attached. */}
            {coverage != null && coverage < 99.5 && (
              <p className="px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
                Item lines cover {coverage.toFixed(1)}% of purchases — the rest sits on credit/debit
                notes and journals, which carry no stock item.
              </p>
            )}
          </SalesPanel>
        ))}
      </div>
    </div>
  );
}
