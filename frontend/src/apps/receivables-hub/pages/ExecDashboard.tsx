import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, Banknote, Boxes, Building2, LayoutDashboard,
  Landmark, Percent, PieChart, Receipt, RefreshCw, Scale, Search, TrendingDown,
  TrendingUp, Users, Wallet,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  fmtDash, tickDash, pctChange, dashFyOptions, priorFy,
  loadExecDashboard, loadExecDashboardLastRefresh, refreshExecDashboardCompany,
  alignMonths, alignQuarters, involvement, tieBroken, dmy,
  achievementPct, DASH_CURRENT, DASH_PRIOR,
  type DashMonthPoint, type DashQuarter,
} from "@hub/lib/execDashboard";

/**
 * Dashboards → C-Level Dashboard.
 *
 * A rebuild of the Talligence "C-Level Dashboard" screen (Misc/Talligence-Inputs/) in Orange
 * One's palette: 22 panels in the source's three-column order. Every figure comes from ONE
 * ConnectWave RPC (`rpt_clevel_dashboard`), which reads a nightly-materialised payload — see
 * lib/execDashboard.ts for why this one is cached where its two siblings compute live.
 *
 * Panel-by-panel tally against the source:
 * Misc/Talligence-Inputs/clevel-dashboard-reconciliation.md.
 *
 * THE FINDING THAT SHAPES THIS PAGE: Talligence serves its own screen from TWO CACHES OF
 * DIFFERENT AGES. Its header says 23-Jul-2026 and its turnover/P&L panels reconcile there, but
 * its balance-sheet panels are two days older — bank ties EXACTLY at ₹14.3870 L on 21-Jul, not at
 * 23-Jul (₹24.34 L). This page is internally consistent at ONE as-on date instead, and names that
 * date wherever a balance-sheet figure appears.
 *
 * FIVE DELIBERATE DIVERGENCES, each footnoted on its own card:
 *  1. RETURN-ON-EQUITY — theirs prints "100.00 (Ratio 1.00 : 1)" with every quarterly bar pegged
 *     at exactly 100 in both years, including quarters that have not happened. That is a capped
 *     widget, not a ratio; Noida's real ROE is ~52%. We compute Net Profit ÷ Equity.
 *  2. GROSS / NET PROFIT TREND and the QUARTERLY OP-EX RATIO are EX-STOCK. Tally gives the
 *     opening/closing stock pair at the sync date and nowhere else, so the term cannot be split by
 *     month or quarter. The gap this creates is itself the proof: our per-quarter OER reads
 *     88.42 / 68.10 where they print 93.5 / 75.3, and the 5–7 point offset is exactly the stock
 *     term. Headline GP / NP / OER DO carry it and are exact.
 *  3. PRIOR-YEAR GROSS / NET PROFIT are ex-stock on BOTH years so the %Δ is like-for-like.
 *  4. CASH-IN-HAND — theirs reads ₹3.02 L. Noida has exactly two cash ledgers totalling
 *     ₹1.6138 L and the balance never reaches ₹3.02 L on any voucher date in the FY. Ours is
 *     Tally-true.
 *  5. TOP CUSTOMERS / TOP SUPPLIERS rank by TURNOVER, which is what their columns are actually
 *     headed ("Sales" / "Purchase") — the previous Orange One dashboard ranked by outstanding
 *     balance, which is a different number entirely.
 *
 * ACCOUNTS RECEIVABLE's current-month point does not tie (₹5.02 Cr against their ₹5.57 Cr) and
 * four bases were tested without landing on theirs; completed months are exact. INCOME PYTD
 * carries the same unreproducible gap the Sales and Purchase Dashboards already footnote.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };
const AR_COLOR = "#7C5CE0";
const AP_COLOR = "#9957DB";

const qtyFmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const ratioFmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)} :1`;

const pctFmt = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}%`;

/** Talligence prints "—" with no prior base, else a signed arrow. */
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

/** A big ₹ headline with its delta badge — the shape shared by most panels here. */
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

/** The panel frame — title bar, optional footnote, consistent body padding. */
function Panel({
  title, icon: Icon, note, children, className,
}: {
  title: string; icon?: React.ComponentType<{ className?: string }>;
  note?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={cn("flex flex-col overflow-hidden rounded-card border-border/70", className)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        {Icon && <Icon className="h-4 w-4 text-orange" />}
        <h3 className="text-[13.5px] font-semibold text-navy">{title}</h3>
      </div>
      <div className="flex-1 px-4 py-3">{children}</div>
      {note && (
        <p className="border-t border-border/50 bg-muted/30 px-4 py-1.5 text-[10.5px] leading-snug text-muted-foreground">
          {note}
        </p>
      )}
    </Card>
  );
}

/* ---- Hero banner (matches the Sales / Purchase dashboards) ---- */

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
            <LayoutDashboard className="h-6 w-6 text-orange" /> C-Level Dashboard
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
 * Achievement dial — 180° arc, needle, read-out below the pivot. Same geometry as the sales and
 * purchase dashboards so the three screens read identically.
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

/** A ratio read-out with its target, as Talligence's Ratios card shows them. */
function RatioRow({
  label, value, target, goodWhen = "high",
}: { label: string; value: number | null; target: string; goodWhen?: "high" | "low" }) {
  const num = value == null || !Number.isFinite(value) ? null : value;
  const targetNum = Number(target.match(/[\d.]+/)?.[0] ?? NaN);
  const good = num == null || !Number.isFinite(targetNum)
    ? null
    : goodWhen === "high" ? num >= targetNum : num <= targetNum;
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-navy px-2.5 py-1 text-[11px] font-semibold text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-orange" /> {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-[19px] font-bold tabular-nums text-navy">{ratioFmt(num)}</span>
        <span className="border-l border-border/70 pl-2 text-[10.5px] leading-tight text-muted-foreground">
          Target: {target}
          {good != null && (
            good ? <ArrowUp className="ml-1 inline h-3 w-3 text-emerald-600" />
                 : <ArrowDown className="ml-1 inline h-3 w-3 text-destructive" />
          )}
        </span>
      </div>
    </div>
  );
}

/** Two-series month line — Income / Expense / Gross Profit / Net Profit all use this. */
function TwoSeriesLine({
  data, curFy, priFy, colorCur = DASH_CURRENT, colorPri = DASH_PRIOR, height = 190,
}: {
  data: Array<{ month: string; current: number | null; prior: number | null }>;
  curFy: string; priFy: string; colorCur?: string; colorPri?: string; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={54} />
        <Tooltip formatter={(v: number | string) => fmtDash(Number(v))} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="current" name={curFy} stroke={colorCur} strokeWidth={2}
              dot={{ r: 2 }} connectNulls={false} />
        <Line type="monotone" dataKey="prior" name={priFy} stroke={colorPri} strokeWidth={2}
              dot={{ r: 2 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function ExecDashboard() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => dashFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [custQuery, setCustQuery] = useState("");
  const [dutyQuery, setDutyQuery] = useState("");

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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["execDashboard", "v1", companyGuid, fy],
    queryFn: () => loadExecDashboard(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["execDashboardLastRefresh", companyGuid, fy],
    queryFn: () => loadExecDashboardLastRefresh(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 60 * 1000,
  });

  /* ---------------------------------------------------------------- refresh */

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const etaSeconds = Math.max(5, Number(lastRefresh?.seconds ?? 25));
  const progress = busy ? Math.min(95, (elapsed / etaSeconds) * 100) : 0;

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const onRefresh = async () => {
    if (busy || !companyGuid) return;
    setBusy(true);
    setRefreshNote(null);
    setElapsed(0);
    timer.current = window.setInterval(() => setElapsed((s) => s + 0.25), 250);
    try {
      const res = await refreshExecDashboardCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Rebuilt in ${res.seconds}s — ${res.tenants ?? 0} financial year(s).`);
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
  const pl = data?.pl;
  const ratios = data?.ratios;
  const meta = data?.meta;
  const priFy = priorFy(fy);
  const notBuilt = !!data && !data.meta;

  const salesMonths = useMemo(() => alignMonths(data?.monthly), [data]);
  const purchaseMonths = useMemo(() => alignMonths(data?.purchase?.monthly), [data]);
  const incomeMonths = useMemo(() => alignMonths(data?.income?.monthly), [data]);
  const expenseMonths = useMemo(() => alignMonths(data?.expense?.monthly), [data]);
  const arMonths = useMemo(() => alignMonths(data?.ar?.monthly), [data]);
  const apMonths = useMemo(() => alignMonths(data?.ap?.monthly), [data]);

  /** Gross / Net profit by month — EX-STOCK, because the stock term cannot be split monthly. */
  const gpMonths = useMemo(
    () => salesMonths.map((s, i) => ({
      month: s.month,
      current: s.current == null && purchaseMonths[i]?.current == null
        ? null : (s.current ?? 0) - (purchaseMonths[i]?.current ?? 0),
      prior: s.prior == null && purchaseMonths[i]?.prior == null
        ? null : (s.prior ?? 0) - (purchaseMonths[i]?.prior ?? 0),
    })),
    [salesMonths, purchaseMonths],
  );
  const npMonths = useMemo(
    () => incomeMonths.map((s, i) => ({
      month: s.month,
      current: s.current == null && expenseMonths[i]?.current == null
        ? null : (s.current ?? 0) - (expenseMonths[i]?.current ?? 0),
      prior: s.prior == null && expenseMonths[i]?.prior == null
        ? null : (s.prior ?? 0) - (expenseMonths[i]?.prior ?? 0),
    })),
    [incomeMonths, expenseMonths],
  );

  /* The ONLY quarterly series charted. It needs no balance-sheet term — just the quarter's own
     income and expense — which is why it survives where the ROE / Debt-to-Equity series do not;
     see the note on those two panels. */
  const oerQuarters = useMemo(
    () => alignQuarters(data?.quarters, (q: DashQuarter) => q.oer), [data],
  );

  const salesTotal = kpi?.ytd ?? 0;
  const purchaseTotal = data?.purchase?.ytd ?? 0;

  const customers = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    const rows = (data?.customers ?? []).filter((c) => !q || c.party.toLowerCase().includes(q));
    return rows.slice(0, 10);
  }, [data, custQuery]);

  const vendors = useMemo(() => (data?.vendors ?? []).slice(0, 10), [data]);

  /** Talligence's table is the top 10 stock groups BY QUANTITY, and its total is the sum of those
      ten rows only — not the company's closing stock. */
  const stockGroups = useMemo(() => (data?.stock_groups ?? []).slice(0, 10), [data]);
  const stockGroupTotal = useMemo(
    () => stockGroups.reduce((s, g) => s + (Number(g.value) || 0), 0), [stockGroups],
  );

  const dutyRows = useMemo(() => {
    const q = dutyQuery.trim().toLowerCase();
    return (data?.duties ?? []).filter((d) => !q || d.tax_name.toLowerCase().includes(q));
  }, [data, dutyQuery]);
  const dutyPage = usePagination(dutyRows);

  const bankLedgers = useMemo(
    () => (data?.funds?.ledgers ?? []).filter((l) => l.bucket === "bank" || l.bucket === "loans"),
    [data],
  );

  const drift = tieBroken(meta);
  const stockDate = meta?.stock_as_of ? new Date(meta.stock_as_of).toLocaleDateString("en-GB") : null;
  const balanceNote = stockDate
    ? `Balance-sheet figures as at ${stockDate} — Tally reports a ledger closing only at the sync date.`
    : undefined;

  /* ------------------------------------------------------------------ view */

  return (
    <div className="space-y-4">
      <DashHero
        company={company ? companyLabel(company) : undefined}
        fy={fy}
        periodLabel={meta?.as_on ? `as on ${dmy(meta.as_on)}` : "—"}
        summary="Sales, profitability, ratios, funds, parties, stock and taxes — the whole company on one screen."
        metaLine={
          data?.cache?.built_at
            ? `Snapshot built ${new Date(data.cache.built_at).toLocaleString("en-GB")} · rebuilt nightly at 22:30 IST`
            : undefined
        }
        controls={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={companyGuid}
                onChange={(e) => pick(e.target.value, fy)}
                className="h-9 min-w-[16rem] rounded-input border border-white/20 bg-white/10 px-3 text-[13px] text-white outline-none focus:border-orange"
              >
                {companies.map((c) => (
                  <option key={c.companyGuid} value={c.companyGuid} className="text-ink">
                    {companyLabel(c)}
                  </option>
                ))}
              </select>
              <select
                value={fy}
                onChange={(e) => pick(companyGuid, e.target.value)}
                className="h-9 rounded-input border border-white/20 bg-white/10 px-3 text-[13px] text-white outline-none focus:border-orange"
              >
                {fyOptions.map((f) => (
                  <option key={f} value={f} className="text-ink">FY {f}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={onRefresh}
                disabled={busy || !companyGuid}
                className="inline-flex h-9 items-center gap-1.5 rounded-input bg-orange px-3 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
                {busy ? `Rebuilding… ${elapsed.toFixed(0)}s` : "Refresh"}
              </button>
            </div>
            {busy && (
              <div className="h-1 w-full overflow-hidden rounded-pill bg-white/15">
                <div className="h-full bg-orange transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            {refreshNote && <p className="text-[11px] text-white/60">{refreshNote}</p>}
          </>
        }
      />

      {coError && <Card className="p-4 text-[13px] text-destructive">{coError}</Card>}
      {error && (
        <Card className="p-4 text-[13px] text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </Card>
      )}

      {notBuilt && !isLoading && (
        <Card className="flex items-start gap-2 p-4 text-[13px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            No snapshot has been built for this company and financial year yet. Press{" "}
            <strong>Refresh</strong> to build it — it takes about half a minute.
          </span>
        </Card>
      )}

      {drift && (
        <Card className="flex items-start gap-2 border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This screen spans six snapshots refreshed on separate schedules, and they currently
            disagree (AR {fmtDash(meta?.tie_ar ?? 0)} · AP {fmtDash(meta?.tie_ap ?? 0)} ·
            balance sheet {fmtDash(meta?.tie_bs ?? 0)}). Press Refresh, or wait for tonight's rebuild.
          </span>
        </Card>
      )}

      {(coLoading || isLoading) && (
        <Card className="p-6 text-center text-[13px] text-muted-foreground">Loading…</Card>
      )}

      {!isLoading && data?.meta && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* ── Row 1 — Total Sales · Gross Profit · Net Profit ─────────────── */}

          <Panel
            title="Total Sales (YTD)" icon={TrendingUp}
            note="No sales target exists anywhere in Tally, so the dial reads achievement against the same period last year — the figure already on the card."
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="text-[22px] font-bold leading-none tabular-nums text-navy">
                {fmtDash(salesTotal)}
              </div>
              <div className="shrink-0 text-right text-[10px] leading-tight text-muted-foreground">
                {fmtDash(kpi?.pytd ?? 0)}<br />
                <span className="opacity-70">(PYTD: FY {priFy})</span>
              </div>
            </div>
            <AchievementGauge
              pct={achievementPct(salesTotal, kpi?.pytd ?? 0)}
              caption={`vs FY ${priFy} same period`}
            />
          </Panel>

          <Panel
            title="Gross Profit Margin" icon={Percent}
            note={`Headline carries the stock movement (${fmtDash(pl?.stock_delta ?? 0)}) and is exact. The trend and the prior-year comparison are EX-STOCK on both years — Tally reports opening and closing stock only at the sync date, so the term cannot be split by month.`}
          >
            <MetricHead
              value={pl?.gp_ex ?? 0}
              prior={pl?.py_gp_ex ?? 0}
              priorCaption={`PYTD: FY ${priFy}, ex-stock`}
            />
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              With stock: <strong className="text-navy">{fmtDash(pl?.gp ?? 0)}</strong>
              {salesTotal ? ` · ${(((pl?.gp ?? 0) / salesTotal) * 100).toFixed(2)}% of sales` : ""}
            </p>
            <TwoSeriesLine data={gpMonths} curFy={fy} priFy={priFy} />
          </Panel>

          <Panel
            title="Net Profit Margin" icon={TrendingUp}
            note={`Net Profit = Gross Profit + Indirect Incomes − Indirect Expenses. Headline carries the stock movement and is exact; the trend and prior year are ex-stock on both years.`}
          >
            <MetricHead
              value={pl?.np_ex ?? 0}
              prior={pl?.py_np_ex ?? 0}
              priorCaption={`PYTD: FY ${priFy}, ex-stock`}
            />
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              With stock: <strong className="text-navy">{fmtDash(pl?.np ?? 0)}</strong>
              {salesTotal ? ` · ${(((pl?.np ?? 0) / salesTotal) * 100).toFixed(2)}% of sales` : ""}
            </p>
            <TwoSeriesLine data={npMonths} curFy={fy} priFy={priFy} />
          </Panel>

          {/* ── Row 2 — Ratios · Return-on-Equity · Debt-to-Equity ──────────── */}

          <Panel title="Ratios" icon={Scale} note={balanceNote}>
            <RatioRow label="Current Ratio" value={ratios?.current_ratio ?? null} target="1.5 or higher" />
            <div className="border-t border-border/50" />
            <RatioRow label="Quick Ratio" value={ratios?.quick_ratio ?? null} target="1 or higher" />
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border/50 pt-2 text-[11px]">
              <dt className="text-muted-foreground">Current assets</dt>
              <dd className="text-right tabular-nums text-navy">{fmtDash(ratios?.current_assets ?? 0)}</dd>
              <dt className="text-muted-foreground">Closing stock</dt>
              <dd className="text-right tabular-nums text-navy">{fmtDash(ratios?.closing_stock ?? 0)}</dd>
              <dt className="text-muted-foreground">Current liabilities</dt>
              <dd className="text-right tabular-nums text-navy">{fmtDash(ratios?.current_liabilities ?? 0)}</dd>
            </dl>
          </Panel>

          {/* ROE and Debt-to-Equity are read-outs, NOT quarterly charts.
              Talligence charts both by quarter, but the denominator makes that undeliverable
              honestly: no voucher ever moves Tally's Profit & Loss A/c, so equity at a past
              quarter-end can only be RECONSTRUCTED (opening P&L ± profit to date), and on Noida
              that reconstruction swings to −₹108 L in prior-Q2 and then to a meaningless +502%
              ROE in prior-Q4. A chart that looks precise and is not is worse than a number.
              Their own version is capped at exactly 100 in every quarter of both years, so
              nothing real is being dropped. The as-on figures below ARE exact. */}
          <Panel
            title="Return-on-Equity" icon={PieChart}
            note="Net Profit ÷ Equity at the sync date. Talligence prints 100.00 with every bar pegged at exactly 100 in both years — including quarters that have not happened — which is a capped widget, not a ratio. Shown as a single exact figure rather than a quarterly series: equity at a past quarter-end is not observable in Tally, only reconstructable, and the reconstruction is unstable mid-year."
          >
            <div className="flex h-full flex-col justify-center py-4 text-center">
              <div className="text-[34px] font-bold leading-none tabular-nums text-navy">
                {pctFmt(ratios?.roe)}
              </div>
              <div className="mt-1 text-[11.5px] text-muted-foreground">
                ratio {ratios?.roe == null ? "—" : (ratios.roe / 100).toFixed(2)} : 1
              </div>
              <dl className="mx-auto mt-4 grid w-full max-w-xs grid-cols-2 gap-x-3 gap-y-1 border-t border-border/50 pt-3 text-[11.5px]">
                <dt className="text-left text-muted-foreground">Net profit</dt>
                <dd className="text-right tabular-nums text-navy">{fmtDash(pl?.np ?? 0)}</dd>
                <dt className="text-left text-muted-foreground">Equity</dt>
                <dd className="text-right tabular-nums text-navy">{fmtDash(ratios?.equity ?? 0)}</dd>
              </dl>
            </div>
          </Panel>

          <Panel
            title="Debt-to-Equity" icon={Landmark}
            note={
              (ratios?.loans ?? 0) === 0
                ? "This company carries no loan ledgers, so the ratio is 0.00 : 1 by definition — not a missing figure. Shown as a single figure for the same reason as Return-on-Equity."
                : "Loans ÷ Equity at the sync date. Shown as a single figure for the same reason as Return-on-Equity — equity at a past quarter-end is not observable in Tally."
            }
          >
            <div className="flex h-full flex-col justify-center py-4 text-center">
              <div className="text-[34px] font-bold leading-none tabular-nums text-navy">
                {ratioFmt(ratios?.debt_to_equity ?? null)}
              </div>
              <dl className="mx-auto mt-4 grid w-full max-w-xs grid-cols-2 gap-x-3 gap-y-1 border-t border-border/50 pt-3 text-[11.5px]">
                <dt className="text-left text-muted-foreground">Loans (liability)</dt>
                <dd className="text-right tabular-nums text-navy">{fmtDash(ratios?.loans ?? 0)}</dd>
                <dt className="text-left text-muted-foreground">Equity</dt>
                <dd className="text-right tabular-nums text-navy">{fmtDash(ratios?.equity ?? 0)}</dd>
              </dl>
            </div>
          </Panel>

          {/* ── Row 3 — Op-Ex Ratio · Bank & Loans · Available Funds ────────── */}

          <Panel
            title="Operating Expense Ratio" icon={Percent}
            note="Total expense as a share of total income. The headline carries the stock movement; the quarterly bars are ex-stock, which is why they sit a few points below it."
          >
            <div className="mb-2 text-center">
              <div className="text-[21px] font-bold tabular-nums text-navy">{pctFmt(ratios?.oer)}</div>
              <div className="text-[11px] text-muted-foreground">
                ratio {ratios?.oer == null ? "—" : (ratios.oer / 100).toFixed(2)} : 1
              </div>
            </div>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={oerQuarters} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="quarter" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44}
                       tickFormatter={(v: number) => `${Math.round(v)}`} />
                <Tooltip formatter={(v: number | string) => pctFmt(Number(v))} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="current" name={fy} stroke={DASH_CURRENT}
                      strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="prior" name={priFy} stroke={DASH_PRIOR}
                      strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Bank Accounts & Loans (Liability)" icon={Building2} note={balanceNote}>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 text-left font-semibold">Name</th>
                  <th className="py-1.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/40 bg-muted/30">
                  <td className="py-1.5 font-semibold text-navy">Bank Accounts</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-navy">
                    {fmtDash(data.funds?.bank ?? 0)}
                  </td>
                </tr>
                {bankLedgers.filter((l) => l.bucket === "bank").map((l) => (
                  <tr key={l.name} className="border-b border-border/30">
                    <td className="py-1.5 pl-4 text-muted-foreground">{l.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDash(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-border/40 bg-muted/30">
                  <td className="py-1.5 font-semibold text-navy">Loans (Liability)</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-navy">
                    {fmtDash(data.funds?.loans ?? 0)}
                  </td>
                </tr>
                {bankLedgers.filter((l) => l.bucket === "loans").map((l) => (
                  <tr key={l.name} className="border-b border-border/30">
                    <td className="py-1.5 pl-4 text-muted-foreground">{l.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDash(-l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Available Funds" icon={Wallet} note={balanceNote}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                layout="vertical"
                data={[
                  { name: "Bank Amount", value: data.funds?.bank ?? 0 },
                  { name: "Cash-in-Hand", value: data.funds?.cash ?? 0 },
                  { name: "Loans", value: data.funds?.loans ?? 0 },
                ]}
                margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
              >
                <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} tickLine={false}
                       axisLine={{ stroke: CHART_GRID }} tickFormatter={tickDash} />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false}
                       axisLine={false} width={92} />
                <Tooltip formatter={(v: number | string) => fmtDash(Number(v))} />
                <Bar dataKey="value" fill="#5EBFB5" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {/* ── Row 4 — Monthly Sales · Top Customers · Accounts Receivable ─── */}

          <Panel title="Monthly Sales" icon={TrendingUp}>
            <MetricHead value={salesTotal} prior={kpi?.pytd ?? 0} priorCaption={`PYTD: FY ${priFy}`} />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={salesMonths} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={54} />
                <Tooltip formatter={(v: number | string) => fmtDash(Number(v))} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="current" name={fy} fill={DASH_CURRENT} radius={[3, 3, 0, 0]} />
                <Bar dataKey="prior" name={priFy} fill={DASH_PRIOR} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel
            title="Top Customers" icon={Users}
            note="Ranked by SALES TURNOVER for the year to date, which is what Talligence's column is — not by outstanding balance."
          >
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer…"
                className="h-8 w-full rounded-input border border-border pl-7 pr-2 text-[12.5px] outline-none focus:border-orange"
              />
            </div>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 text-left font-semibold">Customer</th>
                  <th className="py-1.5 text-right font-semibold">Sales</th>
                  <th className="py-1.5 text-right font-semibold">Involvement</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.party} className="border-b border-border/30">
                    <td className="max-w-[13rem] truncate py-1.5" title={c.party}>{c.party}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDash(c.sales)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {involvement(c.sales, salesTotal)?.toFixed(2) ?? "—"}
                    </td>
                  </tr>
                ))}
                {!customers.length && (
                  <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No customers.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Accounts Receivables" icon={Banknote}
            note="Month-end debtor balances from a daily ledger walk anchored on the closing. Completed months reconcile to Talligence exactly; the current month is up to 1% below theirs and four alternative bases were tested without matching it."
          >
            <MetricHead
              value={data.ar?.current ?? 0}
              prior={data.ar?.pytd ?? 0}
              priorCaption={`PYTD: FY ${priFy}`}
            />
            <TwoSeriesLine data={arMonths} curFy={fy} priFy={priFy} colorCur={AR_COLOR} height={200} />
          </Panel>

          {/* ── Row 5 — Monthly Purchase · Top Suppliers · Accounts Payable ─── */}

          <Panel title="Monthly Purchase" icon={Boxes}>
            <MetricHead
              value={purchaseTotal}
              prior={data.purchase?.pytd ?? 0}
              priorCaption={`PYTD: FY ${priFy}`}
              invert
            />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={purchaseMonths} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickDash} width={54} />
                <Tooltip formatter={(v: number | string) => fmtDash(Number(v))} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="current" name={fy} fill="#E77C7C" radius={[3, 3, 0, 0]} />
                <Bar dataKey="prior" name={priFy} fill="#5EBFB5" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel
            title="Top Suppliers" icon={Users}
            note="Ranked by PURCHASE TURNOVER for the year to date — not by outstanding balance."
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 text-left font-semibold">Supplier</th>
                  <th className="py-1.5 text-right font-semibold">Purchase</th>
                  <th className="py-1.5 text-right font-semibold">Involvement</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.party} className="border-b border-border/30">
                    <td className="max-w-[13rem] truncate py-1.5" title={v.party}>{v.party}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDash(v.purchase)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {involvement(v.purchase, purchaseTotal)?.toFixed(2) ?? "—"}
                    </td>
                  </tr>
                ))}
                {!vendors.length && (
                  <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No suppliers.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Accounts Payables" icon={Receipt}
            note="Payable-positive, so a negative figure is a net advance TO suppliers rather than a debt. Matches Finance → Payables by construction."
          >
            <MetricHead
              value={data.ap?.current ?? 0}
              prior={data.ap?.pytd ?? 0}
              priorCaption={`PYTD: FY ${priFy}`}
              invert
            />
            <TwoSeriesLine data={apMonths} curFy={fy} priFy={priFy} colorCur={AP_COLOR} height={200} />
          </Panel>

          {/* ── Row 6 — Income · Expense · Stock Group Summary ──────────────── */}

          <Panel
            title="Income" icon={TrendingUp}
            note="Sales Accounts + Direct and Indirect Incomes. Prior-year to date reads slightly below Talligence's; that gap is unreproducible at any as-on date and the Sales and Purchase Dashboards carry the same footnote."
          >
            <MetricHead
              value={data.income?.ytd ?? 0}
              prior={data.income?.pytd ?? 0}
              priorCaption={`PYTD: FY ${priFy}`}
            />
            <TwoSeriesLine data={incomeMonths} curFy={fy} priFy={priFy} colorCur="#5EBFB5" />
          </Panel>

          <Panel title="Expense" icon={TrendingDown}
                 note="Purchase Accounts + Direct and Indirect Expenses.">
            <MetricHead
              value={data.expense?.ytd ?? 0}
              prior={data.expense?.pytd ?? 0}
              priorCaption={`PYTD: FY ${priFy}`}
              invert
            />
            <TwoSeriesLine data={expenseMonths} curFy={fy} priFy={priFy} colorCur="#8B7CE0" />
          </Panel>

          <Panel
            title="Stock Group Summary" icon={Boxes}
            note={`Top 10 stock groups by closing quantity. The total is the sum of these ten rows — the company's whole closing stock is ${fmtDash(pl?.closing_stock ?? 0)}.`}
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 text-left font-semibold">Particular</th>
                  <th className="py-1.5 text-right font-semibold">Quantity</th>
                  <th className="py-1.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {stockGroups.map((g) => (
                  <tr key={g.stock_group} className="border-b border-border/30">
                    <td className="max-w-[12rem] truncate py-1.5" title={g.stock_group}>{g.stock_group}</td>
                    <td className="py-1.5 text-right tabular-nums">{qtyFmt(Number(g.qty) || 0)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDash(Number(g.value) || 0)}</td>
                  </tr>
                ))}
                {!stockGroups.length && (
                  <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No stock.</td></tr>
                )}
              </tbody>
              {!!stockGroups.length && (
                <tfoot>
                  <tr className="bg-muted/40">
                    <td className="py-1.5 font-semibold text-navy" colSpan={2}>Total</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-navy">
                      {fmtDash(stockGroupTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Panel>

          {/* ── Row 7 — Fast / Slow / Non-Moving products ───────────────────── */}

          <Panel
            title="Top 10 Fast Moving Products" icon={TrendingUp}
            note="Quantity sold in the year to date, signed — returns carry a positive quantity against a negative amount, so an unsigned sum overstates."
          >
            <MovementTable rows={data.movement?.fast ?? []} />
          </Panel>

          <Panel
            title="Top 10 Slow Moving Products" icon={TrendingDown}
            note="The same measure, ascending. Negative rows are net returns — items that came back in greater quantity than they went out."
          >
            <MovementTable rows={data.movement?.slow ?? []} />
          </Panel>

          <Panel
            title="Top 10 Non Moving Products" icon={Boxes}
            note="Items carrying stock that recorded no outward movement at all this year."
          >
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 text-left font-semibold">Name</th>
                  <th className="py-1.5 text-left font-semibold">Group</th>
                </tr>
              </thead>
              <tbody>
                {(data.movement?.non_moving ?? []).map((r) => (
                  <tr key={r.item} className="border-b border-border/30">
                    <td className="max-w-[11rem] truncate py-1.5" title={r.item}>{r.item}</td>
                    <td className="max-w-[10rem] truncate py-1.5 text-muted-foreground" title={r.stock_group}>
                      {r.stock_group}
                    </td>
                  </tr>
                ))}
                {!(data.movement?.non_moving ?? []).length && (
                  <tr><td colSpan={2} className="py-4 text-center text-muted-foreground">
                    Every stocked item moved this year.
                  </td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          {/* ── Row 8 — Duties and Taxes ────────────────────────────────────── */}

          <Panel
            title="Duties And Taxes" icon={Receipt}
            className="lg:col-span-3"
            note={balanceNote}
          >
            <div className="relative mb-2 max-w-xs">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={dutyQuery}
                onChange={(e) => setDutyQuery(e.target.value)}
                placeholder="Search tax…"
                className="h-8 w-full rounded-input border border-border pl-7 pr-2 text-[12.5px] outline-none focus:border-orange"
              />
            </div>
            <ScrollableTable>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 text-left font-semibold">Tax Name</th>
                    <th className="py-1.5 text-right font-semibold">Receivables</th>
                    <th className="py-1.5 text-right font-semibold">Payables</th>
                  </tr>
                </thead>
                <tbody>
                  {dutyPage.pageItems.map((d) => (
                    <tr key={d.tax_name} className="border-b border-border/30">
                      <td className="py-1.5">{d.tax_name}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtDash(d.receivable)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtDash(d.payable)}</td>
                    </tr>
                  ))}
                  {!dutyPage.pageItems.length && (
                    <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">
                      No tax ledgers.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={dutyPage} rowsLabel="tax ledgers" showPageSize={false} />
          </Panel>
        </div>
      )}
    </div>
  );
}

/** Fast / Slow share one table shape. */
function MovementTable({ rows }: { rows: Array<{ item: string; stock_group: string; qty: number; base_unit: string }> }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="py-1.5 text-left font-semibold">Name</th>
          <th className="py-1.5 text-left font-semibold">Group</th>
          <th className="py-1.5 text-right font-semibold">Quantity</th>
          <th className="py-1.5 text-right font-semibold">Unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.item} className="border-b border-border/30">
            <td className="max-w-[9rem] truncate py-1.5" title={r.item}>{r.item}</td>
            <td className="max-w-[8rem] truncate py-1.5 text-muted-foreground" title={r.stock_group}>
              {r.stock_group}
            </td>
            <td className="py-1.5 text-right tabular-nums">{qtyFmt(Number(r.qty) || 0)}</td>
            <td className="py-1.5 text-right text-muted-foreground">{r.base_unit}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No movement.</td></tr>
        )}
      </tbody>
    </table>
  );
}
