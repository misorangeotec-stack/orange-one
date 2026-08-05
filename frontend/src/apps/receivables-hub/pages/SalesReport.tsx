import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Building2, CalendarClock, Clock, FileSpreadsheet,
  Layers, MapPin, Package, RefreshCw, TrendingDown, TrendingUp, UserCheck, Users, Wallet,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  fmtSales, loadLastRefreshMany, loadSalesReportMulti, loadSalespersonByParty, pctChange,
  priorFy, refreshSalesCompanies, salesCat, salesFyOptions, salesPeriod, salespersonRollup,
  saleTypeLabel, tickSales, SALES_CURRENT, SALES_PRIOR,
  type BillRow, type CustomerRow, type SalesCompanyRef, type SalesFilters,
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
 *
 * ONE COMPANY OR SEVERAL
 * The company picker is a multi-select. One company is exactly the report it always was —
 * the same single RPC, the same numbers. Several fan out one RPC per company and fold the
 * payloads together in the browser (lib/salesReport → mergeSalesReports), so every panel
 * reads as one combined book: a customer billed from two companies is one line carrying the
 * total. A "Sales by Company" panel and a Company column on Bill Details appear only in that
 * mode, so the combined figures can always be broken back down.
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

/* ---- Hero banner (Control-Center styling) -------------------------------- */

/**
 * The navy header block, styled to match the portal's "My Control Center" hero:
 * an orange corner wash over a navy gradient, a live-source chip in the eyebrow,
 * a one-line dynamic summary of where the year stands, and the company / FY /
 * refresh controls sitting on the dark surface (top-right, like the scope tabs).
 */
function SalesHero({
  company,
  companyHint,
  fy,
  periodLabel,
  metaLine,
  summary,
  growthPct,
  loading,
  controls,
}: {
  company?: string;
  /** Hover text behind the company chip — the full list when several are combined. */
  companyHint?: string;
  fy: string;
  periodLabel: string;
  metaLine?: string;
  summary: React.ReactNode;
  growthPct: number | null;
  loading: boolean;
  controls: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-card bg-navy text-white px-5 py-5 sm:px-6 sm:py-6">
      {/* Warm corner wash — brand orange, kept subtle so the text stays first. */}
      <div className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-orange/25 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy via-navy/95 to-transparent" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-white/55">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-400/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live · Tally
            </span>
            {company && (
              <span className="font-semibold text-white/75" title={companyHint}>{company}</span>
            )}
            <span className="text-white/30">·</span>
            <span>FY {fy}</span>
            <span className="text-white/30">·</span>
            <span>{periodLabel}</span>
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-[24px] font-bold tracking-tight sm:text-[27px]">
            <BarChart3 className="h-6 w-6 text-orange" /> Sales Report
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>

        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">
          {controls}
          {growthPct != null && !loading && <HeroGrowthPill pct={growthPct} />}
        </div>
      </div>
    </div>
  );
}

function HeroGrowthPill({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12.5px] font-semibold backdrop-blur",
        up ? "bg-emerald-400/20 text-emerald-200" : "bg-ryg-red/20 text-[#ffb4ac]",
      )}
    >
      {up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
      <span className="tabular-nums">{Math.abs(pct).toFixed(1)}%</span>
      <span className="font-medium opacity-80">YoY · YTD</span>
    </span>
  );
}

/* ---- KPI cards (Control-Center styling) ---------------------------------- */

type KpiTone = "orange" | "slate" | "grey" | "up" | "down";

const KPI_TONE: Record<KpiTone, { chip: string; value: string; glow: string }> = {
  orange: { chip: "bg-orange-soft text-orange", value: "text-navy", glow: "from-orange/10" },
  slate: { chip: "bg-[#EAF0FA] text-navy", value: "text-navy", glow: "from-navy/[0.07]" },
  grey: { chip: "bg-page text-grey-2", value: "text-grey", glow: "from-grey-2/[0.07]" },
  up: { chip: "bg-[#E7F6EE] text-emerald-600", value: "text-emerald-600", glow: "from-emerald-500/10" },
  down: { chip: "bg-[#FDECEC] text-ryg-red", value: "text-ryg-red", glow: "from-ryg-red/10" },
};

/** A headline tile: uppercase label, big money value, hint, and a tinted icon chip. */
function KpiCard({
  tone,
  label,
  value,
  hint,
  icon: Icon,
}: {
  tone: KpiTone;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-white px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-100", t.glow)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
          <div className={cn("mt-1 text-[26px] font-bold leading-none tabular-nums sm:text-[28px]", t.value)}>{value}</div>
          <div className="mt-1.5 truncate text-[11px] text-grey">{hint}</div>
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

/** `?company=` carries one guid or a comma-separated list — an old single-company link still works. */
const parseGuids = (raw: string | null): string[] =>
  (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export default function SalesReport() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => salesFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuids, setCompanyGuids] = useState<string[]>(() => parseGuids(params.get("company")));
  const [filters, setFilters] = useState<SalesFilters>({});
  const [custQuery, setCustQuery] = useState("");
  const [billQuery, setBillQuery] = useState("");

  // Default to Orange O Tec Noida (the book the source report was produced from) when it
  // exists, otherwise the first company in the list. Applied ONCE — an empty selection later
  // means the user cleared it to get every company, and must not be re-seeded.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || companyGuids.length || !companies.length) return;
    seeded.current = true;
    const noida = companies.find((c) => c.companyGuid === NOIDA_GUID);
    setCompanyGuids([(noida ?? companies[0]).companyGuid]);
  }, [companies, companyGuids]);

  /**
   * The books the report is running over. An empty selection means every company — the
   * "Clear selection" / "All companies" convention the rest of the portal's multi-selects
   * use; guids in the URL that no longer exist simply drop out.
   */
  const selected = useMemo(
    () => (companyGuids.length
      ? companies.filter((c) => companyGuids.includes(c.companyGuid))
      : companies),
    [companies, companyGuids],
  );
  const multi = selected.length > 1;

  const refs: SalesCompanyRef[] = useMemo(
    () => selected.map((c) => ({ guid: c.companyGuid, label: companyLabel(c) })),
    [selected],
  );
  /** Order-independent cache key for the selection. */
  const guidKey = useMemo(() => refs.map((r) => r.guid).sort().join(","), [refs]);
  const selectedGuids = useMemo(() => refs.map((r) => r.guid), [refs]);

  const pick = (guids: string[], nextFy: string) => {
    setCompanyGuids(guids);
    setFy(nextFy);
    setParams({ company: guids.join(","), fy: nextFy }, { replace: true });
  };

  const period = useMemo(() => salesPeriod(fy), [fy]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["salesReport", "v2", guidKey, fy, filters],
    queryFn: () => loadSalesReportMulti(refs, fy, filters),
    enabled: refs.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: spByParty } = useQuery({
    queryKey: ["salesReportSalespersons", "v1"],
    queryFn: loadSalespersonByParty,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["salesReportLastRefresh", guidKey, fy],
    queryFn: () => loadLastRefreshMany(selectedGuids, fy),
    enabled: refs.length > 0,
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
    if (busy || !selectedGuids.length) return;
    setBusy(true);
    setRefreshNote(null);
    setElapsed(0);
    timer.current = window.setInterval(() => setElapsed((s) => s + 0.25), 250);
    try {
      // Every selected company is rebuilt, one after another. A company still inside its
      // two-minute cooldown is reported, not treated as a failure — its snapshot is already
      // current, which is the whole point of the cooldown.
      const res = await refreshSalesCompanies(selectedGuids, fy);
      const ok = res.filter((r) => r.result.status === "ok");
      const skipped = res.filter((r) => r.result.status === "cooldown" || r.result.status === "busy");
      const failed = res.filter((r) => r.result.status === "error");

      if (!ok.length && !skipped.length) {
        setRefreshNote(failed[0]?.result.message ?? "Refresh failed.");
      } else {
        const secs = ok.reduce((s, r) => s + (Number(r.result.seconds) || 0), 0);
        const lines = ok.reduce((s, r) => s + (Number(r.result.lines) || 0), 0);
        const bills = ok.reduce((s, r) => s + (Number(r.result.bills) || 0), 0);
        const head = res.length > 1
          ? `Refreshed ${ok.length} of ${res.length} companies in ${secs.toFixed(0)}s`
          : `Refreshed in ${secs.toFixed(0)}s`;
        const parts = [
          ok.length
            ? `${head} — ${lines} sales lines, ${bills} bills.`
            : "Nothing to refresh — every selected company was snapshotted moments ago.",
          skipped.length && ok.length ? `${skipped.length} already up to date.` : "",
          failed.length ? `${failed.length} failed: ${failed[0].result.message ?? "unknown error"}` : "",
        ].filter(Boolean);
        setRefreshNote(parts.join(" "));
        if (ok.length) await Promise.all([refetch(), refetchLast()]);
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

  const companyTitle = selected.length === 1
    ? selected[0].rawName
    : selected.length
      ? `${selected.length} companies · combined`
      : undefined;
  const companyNames = selected.map(companyLabel).join(", ");
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
      ? rows.filter((r) =>
          r.ledger.toLowerCase().includes(q) ||
          r.bill_ref.toLowerCase().includes(q) ||
          (r.company ?? "").toLowerCase().includes(q))
      : rows;
  }, [data, billQuery]);

  const custPage = usePagination(customers, { pageSize: 10, resetKey: `${guidKey}|${fy}|${custQuery}` });
  const agePage = usePagination(data?.ageing.customers ?? [], { pageSize: 10, resetKey: `${guidKey}|${fy}` });
  const billPage = usePagination(bills, { pageSize: 10, resetKey: `${guidKey}|${fy}|${billQuery}` });

  const opts = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ value: v, label: v }));
  const anyFilter =
    !!(filters.saleTypes?.length || filters.states?.length || filters.parties?.length ||
       filters.groups?.length || filters.items?.length);

  const errText = error instanceof Error ? error.message : coError;

  /* ------------------------------------------------------------- hero bits */

  const heroLoading = isLoading || coLoading;
  const growthPct = data ? pctChange(data.kpi.ytd, data.kpi.pytd) : null;

  const heroSummary: React.ReactNode = heroLoading
    ? multi ? `Gathering ${selected.length} sales books…` : "Gathering the sales book…"
    : data
      ? (
        <>
          <span className="font-semibold text-white">{fmtSales(data.kpi.ytd)}</span> booked so far this year
          {growthPct != null && (
            <>
              , {growthPct >= 0 ? "up" : "down"}{" "}
              <span className="font-semibold text-white">{Math.abs(growthPct).toFixed(1)}%</span>{" "}
              versus the same point last year
            </>
          )}
          .
        </>
      )
      : "Sales posted to the Sales Accounts group, ex-GST — straight from the Tally books.";

  const heroMeta = [
    // With several companies this is the OLDEST of their last runs — the screen is only as
    // fresh as its stalest book (see loadLastRefreshMany).
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }${multi ? " (oldest of the selected)" : ""}`,
    "Currency ₹",
    "Auto-refreshes daily at 8:00 PM",
  ].join("   ·   ");

  // Company / FY / Refresh, restyled to sit on the navy hero (translucent white,
  // like the Control Center's scope tabs) instead of the light shadcn surface.
  const darkControl =
    "h-9 rounded-input border border-white/15 bg-white/10 px-3 text-sm text-white backdrop-blur " +
    "transition hover:bg-white/[0.18] focus:outline-none focus:ring-2 focus:ring-white/25";
  const heroControls = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* Tick as many companies as you like — the panels below combine them. The shadcn
          outline trigger is overridden to the hero's translucent-white treatment (cn is
          tailwind-merge, so these classes win). */}
      <MultiSelectFilter
        options={companies.map((c) => ({ value: c.companyGuid, label: companyLabel(c) }))}
        value={companyGuids}
        onChange={(v) => pick(v, fy)}
        allLabel="All companies"
        unit="companies"
        triggerClassName={cn(darkControl, "w-[220px] hover:text-white")}
        contentClassName="w-72"
      />
      <select
        value={fy}
        onChange={(e) => pick(companyGuids, e.target.value)}
        className={cn(darkControl, "cursor-pointer [&>option]:text-navy")}
      >
        {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
      </select>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy || !selectedGuids.length}
        className={cn(darkControl, "inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50")}
      >
        <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <SalesHero
        company={companyTitle}
        companyHint={companyNames}
        fy={fy}
        periodLabel={`${dmy(period.from)} → ${dmy(period.asOn)}`}
        metaLine={heroMeta}
        summary={heroSummary}
        growthPct={growthPct}
        loading={heroLoading}
        controls={heroControls}
      />

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-pill bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Rebuilding {multi ? `${selected.length} companies'` : "this company's"} sales snapshot
            {multi ? " (one at a time)" : ""} — {elapsed.toFixed(0)}s elapsed
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
        <div className="py-16 text-center text-muted-foreground text-sm">
          {multi ? `Loading ${selected.length} sales books…` : "Loading the sales book…"}
        </div>
      ) : !data ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No sales data for {multi ? "the selected companies" : "this company"}.
        </div>
      ) : (
        <>
          {/* ── KPI row ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              tone="orange"
              icon={Wallet}
              label="Current Year (YTD)"
              value={fmtSales(data.kpi.ytd)}
              hint={`${dmy(period.from)} → ${dmy(period.asOn)}`}
            />
            <KpiCard
              tone="slate"
              icon={CalendarClock}
              label="Previous Year (PYTD)"
              value={fmtSales(data.kpi.pytd)}
              hint={`${dmy(period.pFrom)} → ${dmy(period.pAsOn)}`}
            />
            <KpiCard
              tone="grey"
              icon={BarChart3}
              label="Previous Year (Total)"
              value={fmtSales(data.kpi.py_total)}
              hint={`FY ${prior} full year`}
            />
            {(() => {
              const g = pctChange(data.kpi.ytd, data.kpi.pytd);
              const up = (g ?? 0) >= 0;
              return (
                <KpiCard
                  tone={g == null ? "grey" : up ? "up" : "down"}
                  icon={g == null ? BarChart3 : up ? TrendingUp : TrendingDown}
                  label="YoY Growth (YTD)"
                  value={g == null ? "—" : `${up ? "+" : "−"}${Math.abs(g).toFixed(1)}%`}
                  hint="This year vs same point last year"
                />
              );
            })()}
          </div>

          {/* ── Sales by Company (combined mode only) ────────────────── */}
          {multi && (data.by_company?.length ?? 0) > 1 && (
            <SalesPanel
              title="Sales by Company"
              icon={Building2}
              subtitle="Every panel below is these companies combined — this is the split"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <ResponsiveContainer width="100%" height={Math.max(210, (data.by_company?.length ?? 0) * 42)}>
                  <BarChart
                    data={(data.by_company ?? []).map((c) => ({
                      name: c.company, ytd: Number(c.ytd), pytd: Number(c.pytd),
                    }))}
                    layout="vertical"
                    margin={{ left: 8, right: 12 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                    <XAxis type="number" tickFormatter={tickSales} tick={AXIS_TICK} />
                    <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={150} />
                    <Tooltip formatter={(v: number) => fmtSales(v)} />
                    <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="pytd" name="PYTD" fill={SALES_PRIOR} radius={[0, 3, 3, 0]} />
                    <Bar dataKey="ytd" name="YTD" fill={SALES_CURRENT} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <ScrollableTable className="rounded-md border border-border self-start">
                  <table className="w-full">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <Th>Company</Th><Th right>YTD</Th><Th right>PYTD</Th>
                        <Th right>Share (in %)</Th><Th right>Change (in %)</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {(data.by_company ?? []).map((c) => (
                        <tr key={c.company} className="hover:bg-muted/30">
                          <Td className="max-w-[280px] truncate">{c.company}</Td>
                          <Td right>{fmtSales(c.ytd)}</Td>
                          <Td right>{fmtSales(c.pytd)}</Td>
                          <Td right>
                            {data.kpi.ytd ? ((Number(c.ytd) / data.kpi.ytd) * 100).toFixed(2) : "0.00"}
                          </Td>
                          <Td right><ChangeCell current={Number(c.ytd)} prior={Number(c.pytd)} /></Td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40 border-t border-border font-semibold">
                      <tr>
                        <Td>Total</Td>
                        <Td right>{fmtSales(data.kpi.ytd)}</Td>
                        <Td right>{fmtSales(data.kpi.pytd)}</Td>
                        <Td right />
                        <Td right><ChangeCell current={data.kpi.ytd} prior={data.kpi.pytd} /></Td>
                      </tr>
                    </tfoot>
                  </table>
                </ScrollableTable>
              </div>
            </SalesPanel>
          )}

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
            subtitle={multi ? "One line per customer — billing from every selected company added up" : undefined}
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
                    <Th>Bill Date</Th><Th>Bill No</Th>
                    {multi && <Th>Company</Th>}
                    <Th>Party Name</Th><Th right>Amount</Th>
                    <Th>Status</Th><Th right>Due Amount</Th><Th>Due On</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {billPage.pageItems.map((b) => {
                    const due = Number(b.pending) || 0;
                    return (
                      // A bill number is only unique within a company, so the book is part
                      // of the key once several are combined.
                      <tr key={`${b.company ?? ""}|${b.ledger}|${b.bill_ref}`} className="hover:bg-muted/30">
                        <Td>{dmy(b.bill_date)}</Td>
                        <Td>{b.bill_ref}</Td>
                        {multi && <Td className="max-w-[200px] truncate">{b.company ?? "—"}</Td>}
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
