import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, BadgeIndianRupee, CalendarClock, Clock, FileSpreadsheet, HandCoins,
  Percent, ReceiptText, RefreshCw, TrendingUp, Users, Wallet, type LucideIcon,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { composePartyFilter, useScopedParties } from "@hub/lib/scopeParties";
import NothingInScope from "@hub/components/NothingInScope";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  fmtRecv, loadReceivablesLastRefresh, loadReceivablesReport, recvFyOptions, recvPeriod,
  refreshReceivablesCompany, tickRecv, RECV_CURRENT,
  type PartyRow, type ReceivablesFilters, type RecvBillRow,
} from "@hub/lib/receivablesReport";

/**
 * Master Reports → Finance → Receivables.
 *
 * A faithful rebuild of the Talligence "Master Report – Finance – Receivables" screen in
 * Orange One's palette: the six KPI tiles, Monthly Sales + Accounts Receivables bars, the
 * bill-age Ageing Balance, the Party-Wise Bills Receivables table and the Bill Details
 * table. Every figure comes from ONE ConnectWave RPC (`rpt_receivables_report`).
 *
 * Reconciled for Orange O Tec Noida FY2026-27: Outstanding ₹5.18 Cr and On Account ₹20.25 L
 * tie to Tally exactly. Bills Receivable / Overdue / Advance are the Tally-consistent figures
 * (the source report's gross numbers do not tie to the ledger closing — see receivablesReport.ts).
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/** FY month order — Indian FY runs Apr → Mar. */
const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };
const AR_FILL = "#9957DB"; // violet — Accounts Receivables, distinct from the orange sales bar

/** dd-mm-yyyy from Tally's YYYYMMDD — the house date format. */
function dmy(ymd: string | null | undefined): string {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(6, 8)}-${ymd.slice(4, 6)}-${ymd.slice(0, 4)}`;
}
/** YYYYMMDD → yyyy-mm-dd for <input type="date">. */
const toInputDate = (ymd: string) => (ymd && ymd.length >= 8 ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : "");
/** yyyy-mm-dd → YYYYMMDD. */
const fromInputDate = (v: string) => v.replace(/-/g, "");

const nDays = (v: number | null): string =>
  v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* ---- Hero banner --------------------------------------------------------- */

function ReceivablesHero({
  company, fy, periodLabel, metaLine, summary, loading, controls,
}: {
  company?: string;
  fy: string;
  periodLabel: string;
  metaLine?: string;
  summary: React.ReactNode;
  loading: boolean;
  controls: React.ReactNode;
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
            <ReceiptText className="h-6 w-6 text-orange" /> Receivables
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>
        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">{controls}</div>
      </div>
    </div>
  );
}

/* ---- KPI cards ----------------------------------------------------------- */

type KpiTone = "orange" | "slate" | "grey" | "up" | "down";
const KPI_TONE: Record<KpiTone, { chip: string; value: string; glow: string }> = {
  orange: { chip: "bg-orange-soft text-orange", value: "text-navy", glow: "from-orange/10" },
  slate: { chip: "bg-[#EAF0FA] text-navy", value: "text-navy", glow: "from-navy/[0.07]" },
  grey: { chip: "bg-page text-grey-2", value: "text-grey", glow: "from-grey-2/[0.07]" },
  up: { chip: "bg-[#E7F6EE] text-emerald-600", value: "text-emerald-600", glow: "from-emerald-500/10" },
  down: { chip: "bg-[#FDECEC] text-ryg-red", value: "text-ryg-red", glow: "from-ryg-red/10" },
};

function KpiCard({ tone, label, value, hint, icon: Icon }: {
  tone: KpiTone; label: string; value: string; hint: string; icon: LucideIcon;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-white px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-100", t.glow)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
          <div className={cn("mt-1 text-[22px] font-bold leading-none tabular-nums sm:text-[24px]", t.value)}>{value}</div>
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

export default function ReceivablesMasterReport() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => recvFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [filters, setFilters] = useState<ReceivablesFilters>({});
  const [partyQuery, setPartyQuery] = useState("");
  const [billQuery, setBillQuery] = useState("");

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

  const period = useMemo(() => recvPeriod(fy), [fy]);

  // Bill Details From/To — default to the current FY window, editable like Talligence.
  const [billFrom, setBillFrom] = useState(toInputDate(period.from));
  const [billTo, setBillTo] = useState(toInputDate(period.asOn));
  useEffect(() => { setBillFrom(toInputDate(period.from)); setBillTo(toInputDate(period.asOn)); }, [period.from, period.asOn]);

  // Per-salesperson scope, applied SERVER-side via rpt_receivables_report's p_parties.
  // `scoped.visible === false` gates `enabled` and not just the render: an empty parties array
  // would pass through the fetcher's arr() helper as p_parties: null, which means "no filter"
  // — i.e. every debtor in the company. See lib/scopeParties.ts.
  const { scope, loading: scopeLoading } = useScopedParties();
  const scoped = useMemo(() => composePartyFilter(scope, filters.parties), [scope, filters.parties]);
  const scopedFilters = useMemo<ReceivablesFilters>(
    () => ({ ...filters, parties: scoped.visible ? scoped.parties : [] }),
    [filters, scoped],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["receivablesReport", "v1", companyGuid, fy, scopedFilters],
    queryFn: () => loadReceivablesReport(companyGuid, fy, scopedFilters),
    enabled: !!companyGuid && !scopeLoading && scoped.visible,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["receivablesLastRefresh", companyGuid, fy],
    queryFn: () => loadReceivablesLastRefresh(companyGuid, fy),
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
      const res = await refreshReceivablesCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else if (res.bills_deferred) {
        setRefreshNote("This is a large book — its snapshot is rebuilt by the nightly job (8:30 PM).");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.bills ?? 0} open bills across ${res.ledgers ?? 0} customers.`);
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

  const monthlySales = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of data?.monthly ?? []) m.set(r.m, Number(r.amt) || 0);
    return FY_MONTHS.map((mm) => ({ name: MONTH_LABEL[mm], v: m.get(mm) ?? 0 }));
  }, [data]);

  const arSeries = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of data?.accounts_receivable ?? []) m.set(Number(r.ym.slice(4, 6)), Number(r.amt) || 0);
    return FY_MONTHS.map((mm) => ({ name: MONTH_LABEL[mm], v: m.get(mm) ?? 0 }));
  }, [data]);

  const parties: PartyRow[] = useMemo(() => {
    const q = partyQuery.trim().toLowerCase();
    const rows = data?.parties ?? [];
    return q ? rows.filter((r) => r.ledger.toLowerCase().includes(q)) : rows;
  }, [data, partyQuery]);

  const partyTotals = useMemo(
    () => parties.reduce(
      (a, r) => ({
        receivable: a.receivable + Number(r.receivable),
        on_account: a.on_account + Number(r.on_account),
        advance: a.advance + Number(r.advance),
        outstanding: a.outstanding + Number(r.outstanding),
      }),
      { receivable: 0, on_account: 0, advance: 0, outstanding: 0 },
    ),
    [parties],
  );

  const bills: RecvBillRow[] = useMemo(() => {
    const q = billQuery.trim().toLowerCase();
    const from = fromInputDate(billFrom);
    const to = fromInputDate(billTo);
    return (data?.bills ?? []).filter((r) => {
      if (from && r.bill_date < from) return false;
      if (to && r.bill_date > to) return false;
      if (q && !(r.ledger.toLowerCase().includes(q) || r.bill_ref.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, billQuery, billFrom, billTo]);

  const partyPage = usePagination(parties, { pageSize: 10, resetKey: `${companyGuid}|${fy}|${partyQuery}` });
  const billPage = usePagination(bills, { pageSize: 10, resetKey: `${companyGuid}|${fy}|${billQuery}|${billFrom}|${billTo}` });

  const opts = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ value: v, label: v }));
  const anyFilter = !!(filters.parties?.length || filters.groups?.length);
  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading || scopeLoading;

  const heroSummary: React.ReactNode = heroLoading
    ? "Gathering the receivables book…"
    : data
      ? (
        <>
          <span className="font-semibold text-white">{fmtRecv(data.kpi.outstanding)}</span> outstanding, of which{" "}
          <span className="font-semibold text-white">{fmtRecv(data.kpi.overdue)}</span> is overdue
          {data.kpi.overdue_pct != null && <> ({Number(data.kpi.overdue_pct).toFixed(1)}%)</>}.
        </>
      )
      : "What every customer owes — outstanding, overdue, on-account and advances, straight from the Tally books.";

  const heroMeta = [
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 8:30 PM",
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

  /* ------------------------------------------------------------------ view */

  // Scoped viewer whose salespeople own no customers: nothing was fetched, so there is nothing
  // to render. Bail before the hero rather than painting zeroes that read as "nobody owes us".
  // `scopeLoading` is part of the condition because useScopedParties fails closed while the tag
  // map loads — without it this panel would flash on every visit.
  if (!scopeLoading && !scoped.visible) return <NothingInScope label="report" />;

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      <ReceivablesHero
        company={company?.rawName}
        fy={fy}
        periodLabel={`${dmy(period.from)} → ${dmy(period.asOn)}`}
        metaLine={heroMeta}
        summary={heroSummary}
        loading={heroLoading}
        controls={heroControls}
      />

      {busy && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-pill bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Rebuilding this company's receivables snapshot — {elapsed.toFixed(0)}s elapsed
            {lastRefresh?.seconds ? ` (last run took ${lastRefresh.seconds}s)` : ""}
          </div>
        </div>
      )}
      {refreshNote && !busy && <div className="text-[11px] text-muted-foreground">{refreshNote}</div>}

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <Card className="rounded-card border-border bg-surface shadow-sm p-3">
        <div className="flex flex-wrap items-end gap-3">
          {([
            ["Group", "groups", data?.filters.groups],
            ["Party", "parties", data?.filters.parties],
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
        <div className="py-16 text-center text-muted-foreground text-sm">Loading the receivables book…</div>
      ) : !data ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No receivables snapshot for this company yet — press Refresh to build it.
        </div>
      ) : (
        <>
          {/* ── KPI row ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard tone="orange" icon={Wallet} label="Outstanding"
                     value={fmtRecv(data.kpi.outstanding)} hint="Net owed to us (Dr)" />
            <KpiCard tone="slate" icon={ReceiptText} label="Bills Receivables"
                     value={fmtRecv(data.kpi.bills_receivable)} hint="Open bills, gross" />
            <KpiCard tone="down" icon={CalendarClock} label="Overdue"
                     value={fmtRecv(data.kpi.overdue)} hint="Past due date" />
            <KpiCard tone={Number(data.kpi.overdue_pct) >= 50 ? "down" : "grey"} icon={Percent} label="Overdue (%)"
                     value={data.kpi.overdue_pct == null ? "—" : `${Number(data.kpi.overdue_pct).toFixed(1)}%`}
                     hint="Overdue ÷ Outstanding" />
            <KpiCard tone="slate" icon={HandCoins} label="On Account"
                     value={fmtRecv(data.kpi.on_account)} hint="Unallocated credits" />
            <KpiCard tone="grey" icon={BadgeIndianRupee} label="Advance"
                     value={fmtRecv(data.kpi.advance)} hint="Advance / credit bills" />
          </div>

          {/* ── Monthly Sales · Accounts Receivables ─────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SalesPanel title="Monthly Sales" icon={TrendingUp} subtitle="Billed sales by month, this FY">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlySales}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} />
                  <YAxis tickFormatter={tickRecv} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtRecv(v)} />
                  <Bar dataKey="v" name="Sales" fill={RECV_CURRENT} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>

            <SalesPanel title="Accounts Receivables" icon={Wallet} subtitle="Month-end receivable balance"
                        empty={arSeries.every((r) => r.v === 0)}
                        emptyMessage="No month-end receivable history for this company.">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={arSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} interval={0} />
                  <YAxis tickFormatter={tickRecv} tick={AXIS_TICK} width={46} />
                  <Tooltip formatter={(v: number) => fmtRecv(v)} />
                  <Bar dataKey="v" name="Receivable" fill={AR_FILL} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SalesPanel>
          </div>

          {/* ── Ageing Balance ───────────────────────────────────────── */}
          <SalesPanel title="Ageing Balance" icon={Clock} subtitle="Open receivable bills, bucketed by bill age"
                      empty={(data.ageing?.buckets ?? []).length === 0}
                      emptyMessage="No open bills — run Refresh if this company has never been snapshotted.">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(data.ageing?.buckets ?? []).map((b) => ({ name: b.bucket, v: Number(b.amt) }))}
                        margin={{ bottom: 34 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0}
                       angle={-25} textAnchor="end" height={48} />
                <YAxis tickFormatter={tickRecv} tick={AXIS_TICK} width={46} />
                <Tooltip formatter={(v: number) => fmtRecv(v)} />
                <Bar dataKey="v" name="Receivable" fill={AR_FILL} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SalesPanel>

          {/* ── Party Wise Bills Receivables ─────────────────────────── */}
          <SalesPanel
            title="Party Wise Bills Receivables"
            icon={Users}
            actions={
              <Input value={partyQuery} onChange={(e) => setPartyQuery(e.target.value)}
                     placeholder="Search customer…" className="h-8 w-52 text-xs" />
            }
            bodyClassName="p-0"
            empty={parties.length === 0}
            emptyMessage="No customers with a balance."
          >
            <ScrollableTable className="border-b border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Customer</Th>
                    <Th right>Receivables Formula (in days)</Th>
                    <Th right>Actual Bill Clearance (in days)</Th>
                    <Th right>Receivable Amount</Th>
                    <Th right>On Account Amount</Th>
                    <Th right>Advance Amount</Th>
                    <Th right>Outstanding Amount</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {partyPage.pageItems.map((p) => (
                    <tr key={p.ledger} className="hover:bg-muted/30">
                      <Td className="max-w-[320px] truncate">{p.ledger}</Td>
                      <Td right>{nDays(p.days_receivable)}</Td>
                      <Td right>{nDays(p.days_clearance)}</Td>
                      <Td right>{fmtRecv(p.receivable)}</Td>
                      <Td right>{fmtRecv(p.on_account)}</Td>
                      <Td right>{fmtRecv(p.advance)}</Td>
                      <Td right>{fmtRecv(p.outstanding)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border font-semibold">
                  <tr>
                    <Td>Total</Td><Td right /><Td right />
                    <Td right>{fmtRecv(partyTotals.receivable)}</Td>
                    <Td right>{fmtRecv(partyTotals.on_account)}</Td>
                    <Td right>{fmtRecv(partyTotals.advance)}</Td>
                    <Td right>{fmtRecv(partyTotals.outstanding)}</Td>
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
            <Pagination state={partyPage} rowsLabel="customers" />
          </SalesPanel>

          {/* ── Bill Details ─────────────────────────────────────────── */}
          <SalesPanel
            title="Bill Details"
            icon={FileSpreadsheet}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-muted-foreground">From</label>
                <Input type="date" value={billFrom} onChange={(e) => setBillFrom(e.target.value)} className="h-8 w-36 text-xs" />
                <label className="text-[11px] text-muted-foreground">To</label>
                <Input type="date" value={billTo} onChange={(e) => setBillTo(e.target.value)} className="h-8 w-36 text-xs" />
                <Input value={billQuery} onChange={(e) => setBillQuery(e.target.value)}
                       placeholder="Search bill or party…" className="h-8 w-48 text-xs" />
              </div>
            }
            bodyClassName="p-0"
            empty={bills.length === 0}
            emptyMessage="No bills in this window."
          >
            <ScrollableTable className="border-b border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Bill Date</Th><Th>Bill No</Th><Th>Party Name</Th><Th right>Bill Amount</Th>
                    <Th right>Due Amount</Th><Th>Due On</Th><Th right>Due (in Days)</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {billPage.pageItems.map((b) => (
                    <tr key={`${b.ledger}|${b.bill_ref}`} className="hover:bg-muted/30">
                      <Td>{dmy(b.bill_date)}</Td>
                      <Td>{b.bill_ref}</Td>
                      <Td className="max-w-[280px] truncate">{b.ledger}</Td>
                      <Td right>{fmtRecv(b.amount)}</Td>
                      <Td right>{fmtRecv(b.pending)}</Td>
                      <Td>{dmy(b.due_date)}</Td>
                      <Td right className={Number(b.due_in_days) > 0 ? "text-ryg-red" : "text-emerald-600"}>
                        {b.due_in_days == null ? "—" : Number(b.due_in_days)}
                      </Td>
                    </tr>
                  ))}
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
