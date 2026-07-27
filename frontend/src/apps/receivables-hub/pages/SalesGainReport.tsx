import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, CalendarDays, Info, Layers, MapPin,
  Package, Percent, RefreshCw, Search, TrendingUp, Users,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  fmtGain, tickGain, pctChange, gainPeriod, gainFyOptions, gainPct, quarterly, gainIsDerivable,
  loadSalesGainReport, loadSalesGainLastRefresh, refreshSalesGainCompany,
  GAIN_CURRENT, GAIN_PRIOR,
  type SalesGainFilters, type GainProductRow, type CostBasis,
} from "@hub/lib/salesGainReport";

/**
 * Master Reports → Finance → Sales Gain Report.
 *
 * A rebuild of the Talligence "Master Report - Finance - Sales Gain Report" screen
 * (Misc/Talligence-Inputs/) in Orange One's palette: the three-block KPI row, the
 * Yearly / Quarterly / Monthly / Weekly charts, Geography, Sales Person Performance,
 * Contributing Customers and All Products.
 *
 * Every figure comes from ONE ConnectWave RPC (`rpt_sales_gain_report`) over the precomputed
 * rpt_sales_gain_voucher + rpt_sales_gain_item snapshots.
 *
 * GAIN IS DERIVED, NOT READ. Tally stores no cost. Cost is priced per item from that item's own
 * VALUATIONMETHOD — actual purchase cost where Tally's "closing rate" is really a configured
 * standard PRICE (82% of the book), Tally's rate where it is a genuine average cost, zero for
 * At-Zero-Cost items. See lib/salesGainReport.ts and the SQL header for the full reasoning.
 *
 * WHY THE HEADLINE DIFFERS FROM TALLIGENCE. Talligence prints 40.59% on its KPI and 22.70% on its
 * own All Products table, on one screen for one period. We ship the actual-cost number and make
 * every panel tie: KPI total = Σ geography = Σ customers = Σ salespersons, by construction.
 * The sales spine ties exactly (PYTD ₹8.2139 Cr / PY ₹25.9954 Cr / 89 customers).
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/** FY month order — Indian FY runs Apr → Mar. */
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };

/** The four series every comparison chart plots. Gain is the darker, thinner pair. */
const CY_SALES = GAIN_CURRENT;      // brand orange
const PY_SALES = GAIN_PRIOR;        // muted slate
const CY_GAIN = "#12A594";          // teal
const PY_GAIN = "#6E8BD6";          // periwinkle

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}

const pct2 = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)} %`);

/**
 * Talligence prints "-" with no prior base, else a signed arrow. Gain is a GOOD thing here, so up
 * is green — the inverse of the Expense report's tone.
 */
function ChangeCell({ current, prior }: { current: number; prior: number }) {
  const p = pctChange(current, prior);
  if (p === null) return <span className="text-muted-foreground">—</span>;
  const up = p >= 0;
  return (
    <span className={up ? "text-emerald-600" : "text-destructive"}>
      {Math.abs(p).toFixed(2)} %{" "}
      {up ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />}
    </span>
  );
}

/* ---- Hero banner (matches the Sales / Income / Expense reports) ----------- */

function GainHero({
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
            <Percent className="h-6 w-6 text-orange" /> Sales Gain Report
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
 * The KPI row is THREE tri-column blocks, not the usual grid of single-metric tiles — each period
 * carries Total Sales · Gain (₹) · Gain (%) together, exactly as the source lays it out.
 */
function KpiBlock({
  label, sales, gain, accent,
}: { label: string; sales: number; gain: number; accent: string }) {
  const p = gainPct(gain, sales);
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-white px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ background: accent }} />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-grey">Total Sales</div>
          <div className="mt-0.5 truncate text-[19px] font-bold leading-none tabular-nums text-navy">{fmtGain(sales)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-grey">Gain (₹)</div>
          <div className={cn("mt-0.5 truncate text-[19px] font-bold leading-none tabular-nums",
                             gain >= 0 ? "text-emerald-600" : "text-destructive")}>{fmtGain(gain)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-grey">Gain (%)</div>
          <div className={cn("mt-0.5 truncate text-[19px] font-bold leading-none tabular-nums",
                             (p ?? 0) >= 0 ? "text-emerald-600" : "text-destructive")}>{pct2(p)}</div>
        </div>
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

/** What priced this item — the stock-undervaluation exposure, surfaced rather than buried. */
const COST_BASIS_LABEL: Record<CostBasis, string> = {
  actual: "Actual cost",
  valuation: "Tally valuation",
  zero: "Zero cost",
  none: "No cost data",
};
const COST_BASIS_CLASS: Record<CostBasis, string> = {
  actual: "bg-[#E7F6EE] text-emerald-700",
  valuation: "bg-orange-soft text-orange",
  zero: "bg-page text-grey-2",
  none: "bg-[#FDECEC] text-ryg-red",
};
function CostBasisPill({ basis }: { basis: CostBasis }) {
  const b: CostBasis = (["actual", "valuation", "zero", "none"] as CostBasis[]).includes(basis) ? basis : "none";
  return (
    <span className={cn("inline-flex rounded-pill px-1.5 py-0.5 text-[10.5px] font-semibold", COST_BASIS_CLASS[b])}>
      {COST_BASIS_LABEL[b]}
    </span>
  );
}

const searchInput =
  "h-8 w-[200px] rounded-input border border-border bg-white pl-7 pr-2 text-[12.5px] " +
  "focus:outline-none focus:ring-2 focus:ring-primary/25";

export default function SalesGainReport() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => gainFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [filters, setFilters] = useState<SalesGainFilters>({});
  const [custQuery, setCustQuery] = useState("");
  const [prodQuery, setProdQuery] = useState("");

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

  const period = useMemo(() => gainPeriod(fy), [fy]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["salesGainReport", "v1", companyGuid, fy, filters],
    queryFn: () => loadSalesGainReport(companyGuid, fy, filters),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["salesGainLastRefresh", companyGuid, fy],
    queryFn: () => loadSalesGainLastRefresh(companyGuid, fy),
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
      const res = await refreshSalesGainCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.lines ?? 0} item lines.`);
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
  const derivable = gainIsDerivable(data?.coverage);

  const yearly = useMemo(() => {
    const cy = (data?.yearly ?? []).find((y) => y.fy === "cy");
    const py = (data?.yearly ?? []).find((y) => y.fy === "py");
    return [
      { name: `FY ${fy}`, sales: Number(py?.sales ?? 0), gain: Number(py?.gain ?? 0) },
      { name: `FY ${fy}`, sales: Number(cy?.sales ?? 0), gain: Number(cy?.gain ?? 0) },
    ];
  }, [data, fy]);

  // Prior FY label for the yearly chart, so the two bars are distinguishable.
  const yearlyBars = useMemo(() => {
    const cy = (data?.yearly ?? []).find((y) => y.fy === "cy");
    const py = (data?.yearly ?? []).find((y) => y.fy === "py");
    const priorLabel = (() => {
      const [a] = fy.split("-");
      const start = Number(a) - 1;
      return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
    })();
    return [
      { name: priorLabel, sales: Number(py?.sales ?? 0), gain: Number(py?.gain ?? 0) },
      { name: fy, sales: Number(cy?.sales ?? 0), gain: Number(cy?.gain ?? 0) },
    ];
  }, [data, fy]);

  const monthly = useMemo(() => {
    const m = new Map<string, { sales: number; gain: number }>();
    for (const r of data?.monthly ?? []) m.set(`${r.fy}|${r.m}`, { sales: Number(r.sales) || 0, gain: Number(r.gain) || 0 });
    return FY_MONTHS.map((mo) => ({
      name: MONTH_LABEL[mo],
      cySales: m.get(`cy|${mo}`)?.sales ?? 0,
      pySales: m.get(`py|${mo}`)?.sales ?? 0,
      cyGain: m.get(`cy|${mo}`)?.gain ?? 0,
      pyGain: m.get(`py|${mo}`)?.gain ?? 0,
    }));
  }, [data]);

  const quarters = useMemo(() => {
    const q = quarterly(data?.monthly ?? []);
    return [1, 2, 3, 4].map((qi) => {
      const cy = q.find((x) => x.fy === "cy" && x.q === qi);
      const py = q.find((x) => x.fy === "py" && x.q === qi);
      return {
        name: `Q${qi}`,
        cySales: cy?.sales ?? 0, pySales: py?.sales ?? 0,
        cyGain: cy?.gain ?? 0, pyGain: py?.gain ?? 0,
      };
    });
  }, [data]);

  // FY weeks 1..53 counted from 1 April — NOT ISO weeks. Verified: week 17 ends 24-Jul-2026.
  const weekly = useMemo(() => {
    const m = new Map<string, { sales: number; gain: number }>();
    let maxWk = 0;
    for (const r of data?.weekly ?? []) {
      m.set(`${r.fy}|${r.wk}`, { sales: Number(r.sales) || 0, gain: Number(r.gain) || 0 });
      maxWk = Math.max(maxWk, Number(r.wk) || 0);
    }
    const span = Math.max(maxWk, 1);
    return Array.from({ length: span }, (_, idx) => {
      const wk = idx + 1;
      return {
        name: String(wk),
        cySales: m.get(`cy|${wk}`)?.sales ?? null,
        pySales: m.get(`py|${wk}`)?.sales ?? null,
        cyGain: m.get(`cy|${wk}`)?.gain ?? null,
        pyGain: m.get(`py|${wk}`)?.gain ?? null,
      };
    });
  }, [data]);

  const geo = data?.geography ?? [];
  const geoBars = useMemo(
    () => geo.map((g) => ({
      name: g.state,
      ytdSales: Number(g.ytd_sales) || 0, pytdSales: Number(g.pytd_sales) || 0,
      ytdGain: Number(g.ytd_gain) || 0, pytdGain: Number(g.pytd_gain) || 0,
    })),
    [geo],
  );
  const geoTotals = useMemo(() => geo.reduce(
    (a, g) => ({
      ytd_sales: a.ytd_sales + Number(g.ytd_sales || 0),
      pytd_sales: a.pytd_sales + Number(g.pytd_sales || 0),
      ytd_gain: a.ytd_gain + Number(g.ytd_gain || 0),
      pytd_gain: a.pytd_gain + Number(g.pytd_gain || 0),
    }),
    { ytd_sales: 0, pytd_sales: 0, ytd_gain: 0, pytd_gain: 0 },
  ), [geo]);

  const salespersons = data?.salespersons ?? [];
  const spTotals = useMemo(() => salespersons.reduce(
    (a, s) => ({
      ytd_sales: a.ytd_sales + Number(s.ytd_sales || 0),
      pytd_sales: a.pytd_sales + Number(s.pytd_sales || 0),
      ytd_gain: a.ytd_gain + Number(s.ytd_gain || 0),
      pytd_gain: a.pytd_gain + Number(s.pytd_gain || 0),
    }),
    { ytd_sales: 0, pytd_sales: 0, ytd_gain: 0, pytd_gain: 0 },
  ), [salespersons]);

  // Contribution % is share of TOTAL GAIN, not of sales — verified against the source
  // (74.48 L / 3.27 Cr = 22.78%).
  const totalGain = Number(kpi?.ytd_gain ?? 0);
  const customers = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    return (data?.customers ?? []).filter((c) => !q || c.party.toLowerCase().includes(q));
  }, [data, custQuery]);
  const custPage = usePagination(customers, { resetKey: `${companyGuid}|${fy}|${custQuery}` });
  const custTotals = useMemo(() => customers.reduce(
    (a, c) => ({ sales: a.sales + Number(c.sales || 0), gain: a.gain + Number(c.gain || 0) }),
    { sales: 0, gain: 0 },
  ), [customers]);

  const products = useMemo(() => {
    const q = prodQuery.trim().toLowerCase();
    return (data?.products ?? []).filter((p) => !q || p.item.toLowerCase().includes(q));
  }, [data, prodQuery]);
  const prodPage = usePagination(products, { resetKey: `${companyGuid}|${fy}|${prodQuery}|${JSON.stringify(filters)}` });
  const prodTotals = useMemo(() => products.reduce(
    (a, p) => ({
      cy_sales: a.cy_sales + Number(p.cy_sales || 0), py_sales: a.py_sales + Number(p.py_sales || 0),
      cy_gain: a.cy_gain + Number(p.cy_gain || 0), py_gain: a.py_gain + Number(p.py_gain || 0),
    }),
    { cy_sales: 0, py_sales: 0, cy_gain: 0, py_gain: 0 },
  ), [products]);

  /** Items priced off Tally's valuation where that rate sits below actual purchase cost. */
  const valuationPricedCount = useMemo(
    () => (data?.products ?? []).filter((p) => p.cost_basis === "valuation").length,
    [data],
  );

  const opts = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ value: v, label: v }));
  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;

  const heroSummary: React.ReactNode = heroLoading
    ? "Pricing the sales book…"
    : kpi
      ? (
        <>
          <span className="font-semibold text-white">{fmtGain(kpi.ytd_sales)}</span> sold so far this year at a gain of{" "}
          <span className="font-semibold text-white">{fmtGain(kpi.ytd_gain)}</span>
          {gainPct(kpi.ytd_gain, kpi.ytd_sales) != null && (
            <> ({pct2(gainPct(kpi.ytd_gain, kpi.ytd_sales))})</>
          )}.
        </>
      )
      : "Margin and gain on the sales book — sales less the derived cost of goods sold, straight from the Tally books.";

  const heroMeta = [
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 9:45 PM",
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

  const chartTooltip = {
    contentStyle: { fontSize: 12, borderRadius: 8, border: "1px solid hsl(220 15% 88%)" },
    formatter: (v: number | string) => fmtGain(Number(v)),
  };

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      <GainHero
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
            Rebuilding this company's gain snapshot — {elapsed.toFixed(0)}s elapsed
            {lastRefresh?.seconds ? ` (last run took ${lastRefresh.seconds}s)` : ""}
          </div>
        </div>
      )}
      {refreshNote && !busy && <div className="text-[11px] text-muted-foreground">{refreshNote}</div>}

      {/* Trap 4: a company that sells without inventory lines cannot have a gain. Say so plainly
          rather than printing a fabricated 100% margin. */}
      {!isLoading && data && !derivable && (
        <Card className="rounded-card border-orange/30 bg-orange-soft/40 p-3">
          <div className="flex items-start gap-2 text-[12.5px] text-navy">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange" />
            <div>
              <span className="font-semibold">Gain cannot be derived for this company.</span>{" "}
              Only {fmtGain(data.coverage.sales_with_items)} of {fmtGain(data.coverage.sales)} in
              sales ({data.coverage.value_pct ?? 0}%) sits on vouchers carrying inventory lines, so
              there is no cost to price the rest against — this book records sales without stock
              movement. The sales figures below are accurate; every gain figure would be
              meaningless and is suppressed.
            </div>
          </div>
        </Card>
      )}

      {/* ── KPI row: three tri-column blocks ───────────────────────────── */}
      {errText ? (
        <Card className="rounded-card border-border bg-surface p-4 text-[12.5px] text-destructive">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" />{errText}
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {isLoading || !kpi ? (
            [0, 1, 2].map((i) => <div key={i} className="h-[104px] animate-pulse rounded-card bg-muted/50" />)
          ) : (
            <>
              <KpiBlock label="Current Year (YTD)" sales={kpi.ytd_sales} gain={derivable ? kpi.ytd_gain : 0} accent={CY_SALES} />
              <KpiBlock label="Previous Year (PYTD)" sales={kpi.pytd_sales} gain={derivable ? kpi.pytd_gain : 0} accent={PY_SALES} />
              <KpiBlock label="Previous Year (Total)" sales={kpi.py_sales} gain={derivable ? kpi.py_gain : 0} accent={PY_GAIN} />
            </>
          )}
        </div>
      )}

      {/* ── Yearly · Quarterly · Monthly ───────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SalesPanel title="Yearly" icon={TrendingUp} loading={isLoading} error={errText} empty={!yearlyBars.length}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={yearlyBars} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickGain} width={54} />
              <Tooltip {...chartTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="sales" name="Total Sales" fill={CY_SALES} radius={[3, 3, 0, 0]} />
              <Bar dataKey="gain" name="Gain/Loss" fill={PY_GAIN} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Quarterly" icon={Layers} loading={isLoading} error={errText} empty={!quarters.length}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={quarters} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickGain} width={54} />
              <Tooltip {...chartTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="cySales" name="CY Total Sales" fill={CY_SALES} radius={[3, 3, 0, 0]} />
              <Bar dataKey="pySales" name="PY Total Sales" fill={PY_SALES} radius={[3, 3, 0, 0]} />
              <Bar dataKey="cyGain" name="CY Gain/Loss" fill={CY_GAIN} radius={[3, 3, 0, 0]} />
              <Bar dataKey="pyGain" name="PY Gain/Loss" fill={PY_GAIN} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>

        <SalesPanel title="Monthly" icon={BarChart3} loading={isLoading} error={errText} empty={!monthly.length}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={monthly} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickGain} width={54} />
              <Tooltip {...chartTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="cySales" name="CY Total Sales" fill={CY_SALES} />
              <Bar dataKey="pySales" name="PY Total Sales" fill={PY_SALES} />
              <Bar dataKey="cyGain" name="CY Gain/Loss" fill={CY_GAIN} />
              <Bar dataKey="pyGain" name="PY Gain/Loss" fill={PY_GAIN} />
            </BarChart>
          </ResponsiveContainer>
        </SalesPanel>
      </div>

      {/* ── Weekly ─────────────────────────────────────────────────────── */}
      <SalesPanel
        title="Weekly"
        icon={CalendarDays}
        subtitle="FY weeks from 1 April (1–53), not calendar weeks"
        loading={isLoading}
        error={errText}
        empty={!weekly.length}
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={weekly} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} />
            <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={1} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickGain} width={54} />
            <Tooltip {...chartTooltip} labelFormatter={(l) => `Week ${l}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="cySales" name="CY Total Sales" stroke={CY_SALES} dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="pySales" name="PY Total Sales" stroke={PY_SALES} dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="cyGain" name="CY Gain/Loss" stroke={CY_GAIN} dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="pyGain" name="PY Gain/Loss" stroke={PY_GAIN} dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </SalesPanel>

      {/* ── Geography ──────────────────────────────────────────────────── */}
      <SalesPanel title="Geography" icon={MapPin} loading={isLoading} error={errText} empty={!geo.length}>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={geoBars} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickGain} width={54} />
            <Tooltip {...chartTooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="ytdSales" name="YTD Total Sales" fill={CY_SALES} radius={[3, 3, 0, 0]} />
            <Bar dataKey="pytdSales" name="PYTD Total Sales" fill={PY_SALES} radius={[3, 3, 0, 0]} />
            <Bar dataKey="ytdGain" name="YTD Gain/Loss" fill={CY_GAIN} radius={[3, 3, 0, 0]} />
            <Bar dataKey="pytdGain" name="PYTD Gain/Loss" fill={PY_GAIN} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <ScrollableTable className="mt-3">
          <table className="w-full border-collapse">
            <thead className="bg-muted/40">
              <tr>
                <Th>State</Th>
                <Th right>YTD Total Sales</Th>
                <Th right>PYTD Total Sales</Th>
                <Th right>YTD Gain/Loss</Th>
                <Th right>PYTD Gain/Loss</Th>
                <Th right>Change (in %)</Th>
              </tr>
            </thead>
            <tbody>
              {geo.map((g) => (
                <tr key={g.state} className="border-t border-border/60 hover:bg-muted/20">
                  <Td>{g.state}</Td>
                  <Td right>{fmtGain(g.ytd_sales)}</Td>
                  <Td right>{fmtGain(g.pytd_sales)}</Td>
                  <Td right>{derivable ? fmtGain(g.ytd_gain) : "—"}</Td>
                  <Td right>{derivable ? fmtGain(g.pytd_gain) : "—"}</Td>
                  <Td right>{derivable ? <ChangeCell current={g.ytd_gain} prior={g.pytd_gain} /> : "—"}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 font-semibold">
              <tr>
                <Td>Total</Td>
                <Td right>{fmtGain(geoTotals.ytd_sales)}</Td>
                <Td right>{fmtGain(geoTotals.pytd_sales)}</Td>
                <Td right>{derivable ? fmtGain(geoTotals.ytd_gain) : "—"}</Td>
                <Td right>{derivable ? fmtGain(geoTotals.pytd_gain) : "—"}</Td>
                <Td right />
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
      </SalesPanel>

      {/* ── Sales Person Performance · Contributing Customers ──────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel
          title="Sales Person Performance"
          icon={Users}
          subtitle="From the salesperson tag on each customer ledger"
          loading={isLoading}
          error={errText}
          empty={!salespersons.length}
          emptyMessage="No salesperson tags on this company's customers yet."
        >
          <ScrollableTable>
            <table className="w-full border-collapse">
              <thead className="bg-muted/40">
                <tr>
                  <Th>Name</Th>
                  <Th right>YTD Total Sales</Th>
                  <Th right>PYTD Total Sales</Th>
                  <Th right>YTD Gain/Loss</Th>
                  <Th right>PYTD Gain/Loss</Th>
                  <Th right>Change (in %)</Th>
                </tr>
              </thead>
              <tbody>
                {salespersons.map((s) => (
                  <tr key={s.name} className="border-t border-border/60 hover:bg-muted/20">
                    <Td>{s.name}</Td>
                    <Td right>{fmtGain(s.ytd_sales)}</Td>
                    <Td right>{fmtGain(s.pytd_sales)}</Td>
                    <Td right>{derivable ? fmtGain(s.ytd_gain) : "—"}</Td>
                    <Td right>{derivable ? fmtGain(s.pytd_gain) : "—"}</Td>
                    <Td right>{derivable ? <ChangeCell current={s.ytd_gain} prior={s.pytd_gain} /> : "—"}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/40 font-semibold">
                <tr>
                  <Td>Total</Td>
                  <Td right>{fmtGain(spTotals.ytd_sales)}</Td>
                  <Td right>{fmtGain(spTotals.pytd_sales)}</Td>
                  <Td right>{derivable ? fmtGain(spTotals.ytd_gain) : "—"}</Td>
                  <Td right>{derivable ? fmtGain(spTotals.pytd_gain) : "—"}</Td>
                  <Td right />
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
        </SalesPanel>

        <SalesPanel
          title="Contributing Customers"
          icon={Users}
          subtitle="Contribution is share of total gain, not of sales"
          loading={isLoading}
          error={errText}
          empty={!customers.length}
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={custQuery} onChange={(e) => setCustQuery(e.target.value)}
                     placeholder="Search customer" className={searchInput} />
            </div>
          }
        >
          <ScrollableTable>
            <table className="w-full border-collapse">
              <thead className="bg-muted/40">
                <tr>
                  <Th>Customer</Th>
                  <Th right>Total Sales</Th>
                  <Th right>Total Gain/Loss</Th>
                  <Th right>Gain (in %)</Th>
                  <Th right>Contribution (in %)</Th>
                </tr>
              </thead>
              <tbody>
                {custPage.pageItems.map((c) => (
                  <tr key={c.party} className="border-t border-border/60 hover:bg-muted/20">
                    <Td className="max-w-[280px] truncate" >{c.party}</Td>
                    <Td right>{fmtGain(c.sales)}</Td>
                    <Td right>{derivable ? fmtGain(c.gain) : "—"}</Td>
                    <Td right>{derivable ? pct2(gainPct(c.gain, c.sales)) : "—"}</Td>
                    <Td right>{derivable ? pct2(totalGain ? (Number(c.gain) / totalGain) * 100 : null) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/40 font-semibold">
                <tr>
                  <Td>Total</Td>
                  <Td right>{fmtGain(custTotals.sales)}</Td>
                  <Td right>{derivable ? fmtGain(custTotals.gain) : "—"}</Td>
                  <Td right />
                  <Td right />
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
          <Pagination state={custPage} rowsLabel="customers" className="mt-2" />
        </SalesPanel>
      </div>

      {/* ── All Products ───────────────────────────────────────────────── */}
      <SalesPanel
        title="All Products"
        icon={Package}
        loading={isLoading}
        error={errText}
        empty={!products.length}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter
              options={opts(data?.filters.categories)}
              value={filters.categories ?? []}
              onChange={(v) => setFilters((f) => ({ ...f, categories: v }))}
              allLabel="All Categories"
              unit="Category"
              triggerClassName="h-8 w-[170px]"
            />
            <MultiSelectFilter
              options={opts(data?.filters.groups)}
              value={filters.groups ?? []}
              onChange={(v) => setFilters((f) => ({ ...f, groups: v }))}
              allLabel="All Groups"
              unit="Group"
              triggerClassName="h-8 w-[170px]"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={prodQuery} onChange={(e) => setProdQuery(e.target.value)}
                     placeholder="Search item" className={searchInput} />
            </div>
          </div>
        }
      >
        <ScrollableTable>
          <table className="w-full border-collapse">
            <thead className="bg-muted/40">
              <tr>
                <Th>Item Name</Th>
                <Th>Group</Th>
                <Th>Parent Group</Th>
                <Th>Category</Th>
                <Th>Cost basis</Th>
                <Th right>CY Total Sales</Th>
                <Th right>PY Total Sales</Th>
                <Th right>CY Gain/Loss</Th>
                <Th right>PY Gain/Loss</Th>
                <Th right>CY Gain (in %)</Th>
                <Th right>Change (in %)</Th>
              </tr>
            </thead>
            <tbody>
              {prodPage.pageItems.map((p: GainProductRow, i: number) => (
                <tr key={`${p.item}|${p.grp}|${i}`} className="border-t border-border/60 hover:bg-muted/20">
                  <Td className="max-w-[260px] truncate">{p.item}</Td>
                  <Td className="max-w-[160px] truncate">{p.grp}</Td>
                  <Td className="max-w-[160px] truncate">{p.parent_grp || "—"}</Td>
                  <Td className="max-w-[140px] truncate">{p.category || "—"}</Td>
                  <Td><CostBasisPill basis={p.cost_basis} /></Td>
                  <Td right>{fmtGain(p.cy_sales)}</Td>
                  <Td right>{fmtGain(p.py_sales)}</Td>
                  <Td right>{derivable ? fmtGain(p.cy_gain) : "—"}</Td>
                  <Td right>{derivable ? fmtGain(p.py_gain) : "—"}</Td>
                  <Td right>{derivable ? pct2(gainPct(p.cy_gain, p.cy_sales)) : "—"}</Td>
                  <Td right>{derivable ? <ChangeCell current={p.cy_gain} prior={p.py_gain} /> : "—"}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 font-semibold">
              <tr>
                <Td>Total</Td><Td /><Td /><Td /><Td />
                <Td right>{fmtGain(prodTotals.cy_sales)}</Td>
                <Td right>{fmtGain(prodTotals.py_sales)}</Td>
                <Td right>{derivable ? fmtGain(prodTotals.cy_gain) : "—"}</Td>
                <Td right>{derivable ? fmtGain(prodTotals.py_gain) : "—"}</Td>
                <Td right /><Td right />
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
        <Pagination state={prodPage} rowsLabel="items" className="mt-2" />

        {/* Two honest footnotes rather than a silently different total. */}
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This table is item-grained, so its totals differ from the KPI above: financial credit
              notes (rate-difference and discount credits) reduce sales but carry no stock line, so
              they land in the KPI and not here. Every other panel ties to the KPI exactly.
            </span>
          </div>
          {valuationPricedCount > 0 && (
            <div className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {valuationPricedCount} item{valuationPricedCount === 1 ? " is" : "s are"} priced from
                Tally's stock valuation rather than actual purchase cost. Where that valuation sits
                below what was paid, stock is carried below cost and gain here reads high — worth a
                separate look by Finance.
              </span>
            </div>
          )}
        </div>
      </SalesPanel>
    </div>
  );
}
