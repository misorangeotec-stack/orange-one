import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight, ArrowUpRight, Download, Eye, PieChart, RefreshCw, Sparkles,
  TrendingDown, UserPlus, Users, UserX, type LucideIcon,
} from "lucide-react";

import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { BASE } from "@hub/lib/menus";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import {
  bandTotals, custFyOptions, custPeriod, dmy, fmtCust, journeys, loadCustomerProfile,
  loadCustomerProfileLastRefresh, loadSegmentConfig, refreshCustomerProfileCompany,
  saveSegmentConfig, segmentOf, DEFAULT_INACTIVE_DAYS, DEFAULT_SEGMENT_CONFIG, RECEIVABLE_BASIS,
  type CustomerRow, type Segment, type SegmentConfig,
} from "@hub/lib/customerProfile";
import { exportCustomerProfileXlsx } from "@hub/lib/exportCustomerProfile";

/**
 * Reports → Insights → Customer Profile.
 *
 * A rebuild of the Talligence "Insights → Customer Profile" screen: Segmental Statistics
 * (four lifecycle cards + three size bands), the two Customers' Journey panels, and the
 * Top 20 New Customers table. Every figure comes from ONE ConnectWave RPC
 * (`rpt_customer_profile`); full reconciliation in
 * Misc/Talligence-Inputs/customer-profile-reconciliation.md.
 *
 * Reconciled for Orange O Tec Noida FY2026-27 at their 24-Jul-2026 stamp: roster 89, New 9,
 * Existing 80, Old 0, Small 84 — all exact; Non Active ₹1.1078 Cr against their ₹1.11 Cr; both
 * Journey panels reproduce with their exact ordering.
 *
 * Three deliberate divergences, each footnoted ON THE PAGE rather than only here:
 *  1. Existing "Pending Receivable" ships Tally-true. Theirs (₹23.77 Cr) is 4.6× this company's
 *     entire debtor book, and their own table agrees with our figures to the rupee.
 *  2. Non Active counts 39, not their 40 — the extra row is a pre-rename ledger whose money they
 *     also exclude from their own total, so their count and total disagree with each other.
 *  3. Sales Person is filled from ext_ledger_tags; Talligence leaves the column blank because
 *     Tally has no salesperson dimension.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/* ---- Hero banner --------------------------------------------------------- */

function CustomerHero({
  company, fy, periodLabel, metaLine, summary, controls,
}: {
  company?: string;
  fy: string;
  periodLabel: string;
  metaLine?: string;
  summary: React.ReactNode;
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
            <Users className="h-6 w-6 text-orange" /> Customer Profile
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>
        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">{controls}</div>
      </div>
    </div>
  );
}

/* ---- Cards --------------------------------------------------------------- */

type Tone = "orange" | "slate" | "grey" | "up" | "down";
const TONE: Record<Tone, { chip: string; value: string; glow: string }> = {
  orange: { chip: "bg-orange-soft text-orange", value: "text-navy", glow: "from-orange/10" },
  slate: { chip: "bg-[#EAF0FA] text-navy", value: "text-navy", glow: "from-navy/[0.07]" },
  grey: { chip: "bg-page text-grey-2", value: "text-grey", glow: "from-grey-2/[0.07]" },
  up: { chip: "bg-[#E7F6EE] text-emerald-600", value: "text-emerald-600", glow: "from-emerald-500/10" },
  down: { chip: "bg-[#FDECEC] text-ryg-red", value: "text-ryg-red", glow: "from-ryg-red/10" },
};

/** A lifecycle card: the count on the left, its two money lines on the right. */
function LifecycleCard({
  tone, label, sub, count, moneyLabel, money, recv, icon: Icon,
}: {
  tone: Tone; label: string; sub?: string; count: number;
  moneyLabel: string; money?: number; recv: number; icon: LucideIcon;
}) {
  const t = TONE[tone];
  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-white transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent", t.glow)} />
      <div className="relative flex">
        <div className="min-w-0 flex-1 border-r border-line px-4 py-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
              {sub && <div className="text-[10.5px] text-grey-2/80">{sub}</div>}
              <div className={cn("mt-1 text-[24px] font-bold leading-none tabular-nums", t.value)}>
                {count.toLocaleString("en-IN")}
              </div>
            </div>
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] [&>svg]:h-4 [&>svg]:w-4", t.chip)}>
              <Icon />
            </span>
          </div>
        </div>
        <div className="flex w-[52%] shrink-0 flex-col justify-center gap-1.5 px-4 py-3.5">
          <div className="text-[12px] text-grey">
            Pending Receivable : <span className="font-semibold text-navy tabular-nums">{fmtCust(recv)}</span>
          </div>
          {money !== undefined && (
            <div className="text-[12px] text-grey">
              {moneyLabel} : <span className="font-semibold text-navy tabular-nums">{fmtCust(money)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A size-band card: count, the rule, and a grey Total footer. */
function BandCard({ name, count, rule, total }: { name: Segment; count: number; rule: string; total: number }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-white">
      <div className="flex-1 px-4 py-3.5">
        <div className="text-[12px] font-semibold text-navy">{name}</div>
        <div className="mt-0.5 text-[26px] font-bold leading-none tabular-nums text-navy">
          {count.toLocaleString("en-IN")}
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-grey">{rule}</p>
      </div>
      <div className="border-t border-line bg-page px-4 py-2 text-center text-[12px] font-semibold text-navy tabular-nums">
        Total: {fmtCust(total)}
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

const Foot = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <td className={`px-3 py-2 text-[12.5px] font-semibold text-navy ${right ? "text-right tabular-nums" : ""}`}>{children}</td>
);

/* ---- Page ---------------------------------------------------------------- */

export default function CustomerProfile() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => custFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [query, setQuery] = useState("");
  const [viewAll, setViewAll] = useState(false);

  // The "Non Active Customers for [Days]" box. Debounced into the RPC so typing "90" does not
  // fire a request for 9 — same treatment Stock Analysis gives its DaysInput.
  const [inactiveDays, setInactiveDays] = useState(DEFAULT_INACTIVE_DAYS);
  const [inactiveApplied, setInactiveApplied] = useState(DEFAULT_INACTIVE_DAYS);
  useEffect(() => {
    const t = window.setTimeout(() => setInactiveApplied(inactiveDays), 400);
    return () => window.clearTimeout(t);
  }, [inactiveDays]);

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

  const period = useMemo(() => custPeriod(fy), [fy]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["customerProfile", "v1", companyGuid, fy, inactiveApplied],
    queryFn: () => loadCustomerProfile(companyGuid, fy, inactiveApplied),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["customerProfileLastRefresh", companyGuid],
    queryFn: () => loadCustomerProfileLastRefresh(companyGuid),
    enabled: !!companyGuid,
    staleTime: 60 * 1000,
  });

  const { data: savedCfg, refetch: refetchCfg } = useQuery({
    queryKey: ["customerSegmentConfig", companyGuid],
    queryFn: () => loadSegmentConfig(companyGuid),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });
  const cfg: SegmentConfig = savedCfg ?? DEFAULT_SEGMENT_CONFIG;

  /* ---------------------------------------------------------------- refresh */

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const etaSeconds = Math.max(3, Number(lastRefresh?.seconds ?? 5));
  const progress = busy ? Math.min(95, (elapsed / etaSeconds) * 100) : 0;

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const onRefresh = async () => {
    if (busy || !companyGuid) return;
    setBusy(true);
    setRefreshNote(null);
    setElapsed(0);
    timer.current = window.setInterval(() => setElapsed((s) => s + 0.25), 250);
    try {
      const res = await refreshCustomerProfileCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.customers ?? 0} customers across ${res.fys ?? 0} financial years.`);
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

  /* ----------------------------------------------------------- edit segments */

  const [editOpen, setEditOpen] = useState(false);
  const [draftSmall, setDraftSmall] = useState(String(DEFAULT_SEGMENT_CONFIG.small_max_pct));
  const [draftMedium, setDraftMedium] = useState(String(DEFAULT_SEGMENT_CONFIG.medium_max_pct));
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const openEdit = () => {
    setDraftSmall(String(cfg.small_max_pct));
    setDraftMedium(String(cfg.medium_max_pct));
    setSaveErr(null);
    setEditOpen(true);
  };

  const onSaveSegments = async () => {
    const small = Number(draftSmall);
    const medium = Number(draftMedium);
    if (!Number.isFinite(small) || !Number.isFinite(medium) || !(small > 0 && small < medium && medium < 100)) {
      setSaveErr("Bands must satisfy 0 < Small < Medium < 100.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      await saveSegmentConfig(companyGuid, { small_max_pct: small, medium_max_pct: medium });
      await refetchCfg();
      setEditOpen(false);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------ derivations */

  const company = companies.find((c) => c.companyGuid === companyGuid);
  const rows: CustomerRow[] = useMemo(() => data?.customers ?? [], [data]);

  const bands = useMemo(() => bandTotals(rows, cfg), [rows, cfg]);
  const journey = useMemo(() => journeys(rows, cfg), [rows, cfg]);

  /** The Top 20 New Customers table — Talligence sorts it by Average Sales descending. */
  const newRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows
      .filter((r) => r.lifecycle === "new")
      .sort((a, b) => b.avg_sales - a.avg_sales || a.name.localeCompare(b.name));
    const filtered = q ? base.filter((r) => r.name.toLowerCase().includes(q)) : base;
    return viewAll ? filtered : filtered.slice(0, 20);
  }, [rows, query, viewAll]);

  const newTotals = useMemo(
    () => newRows.reduce(
      (a, r) => ({ sales: a.sales + Number(r.cy_sales), recv: a.recv + Number(r.receivable) }),
      { sales: 0, recv: 0 },
    ),
    [newRows],
  );

  const newPage = usePagination(newRows, {
    pageSize: 25,
    resetKey: `${companyGuid}|${fy}|${query}|${viewAll}`,
  });

  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;
  const kpi = data?.kpi;
  const meta = data?.meta;

  const heroSummary: React.ReactNode = heroLoading
    ? "Reading the customer base…"
    : kpi
      ? (
        <>
          <span className="font-semibold text-white">{kpi.roster.toLocaleString("en-IN")}</span> customers bought this
          year — <span className="font-semibold text-white">{kpi.new_count}</span> new,{" "}
          <span className="font-semibold text-white">{kpi.existing_count}</span> returning — while{" "}
          <span className="font-semibold text-white">{kpi.nonactive_count}</span> who bought last year have gone quiet.
        </>
      )
      : "Who is new, who is returning, who has gone quiet, and what money sits with each group.";

  const heroMeta = [
    meta?.as_at ? `Figures as at ${dmy(meta.as_at)}` : null,
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 11:00 PM",
  ].filter(Boolean).join("   ·   ");

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

  /** The eye drills into the ledger's voucher statement — disabled when the GUID is unknown. */
  const viewProfile = (guid: string | null, name: string) =>
    guid ? (
      <Link to={`${BASE}/reports/ledger-voucher/${encodeURIComponent(guid)}`}
            title={`Open ${name}'s ledger`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-grey-2 transition hover:bg-page hover:text-navy">
        <Eye className="h-4 w-4" />
      </Link>
    ) : (
      <span title="This customer is not yet in the ledger master, so there is no ledger to open."
            className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-grey-2/40">
        <Eye className="h-4 w-4" />
      </span>
    );

  const journeyTable = (title: string, tone: "up" | "down", list: typeof journey.positive) => (
    <SalesPanel
      title={title}
      icon={tone === "up" ? ArrowUpRight : ArrowDownRight}
      loading={isLoading}
      empty={!isLoading && list.length === 0}
      emptyMessage="No Data Found."
    >
      <ScrollableTable>
        <table className="w-full border-collapse">
          <thead className="bg-page">
            <tr><Th>Name</Th><Th>Segment</Th><Th right>Prior Year</Th></tr>
          </thead>
          <tbody>
            {list.slice(0, 5).map((r) => (
              <tr key={r.name} className="border-t border-line hover:bg-page/60">
                <Td className="max-w-[280px] truncate">{r.name}</Td>
                <Td>
                  <span className={cn(
                    "rounded-pill px-2 py-0.5 text-[11px] font-medium",
                    tone === "up" ? "bg-[#E7F6EE] text-emerald-700" : "bg-[#FDECEC] text-ryg-red",
                  )}>
                    {r.segment}
                  </span>
                </Td>
                <Td right>{fmtCust(r.weight)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </SalesPanel>
  );

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      <CustomerHero
        company={company?.rawName}
        fy={fy}
        periodLabel={`${dmy(period.from)} → ${dmy(meta?.as_at ?? period.asOn)}`}
        metaLine={heroMeta}
        summary={heroSummary}
        controls={heroControls}
      />

      {busy && (
        <div className="h-1 w-full overflow-hidden rounded-pill bg-line">
          <div className="h-full bg-orange transition-all duration-200" style={{ width: `${progress}%` }} />
        </div>
      )}
      {refreshNote && (
        <div className="rounded-card border border-line bg-white px-4 py-2 text-[12.5px] text-grey">{refreshNote}</div>
      )}
      {errText && (
        <div className="rounded-card border border-ryg-red/30 bg-[#FDECEC] px-4 py-3 text-[13px] text-ryg-red">{errText}</div>
      )}

      {/* ---- Segmental Statistics ---- */}
      <SalesPanel
        title="Segmental Statistics"
        icon={PieChart}
        loading={isLoading}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={openEdit} disabled={!companyGuid}
                    className="rounded-button gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Edit Segments
            </Button>
            <Button size="sm" onClick={() => data && exportCustomerProfileXlsx(data, cfg, {
              company: company ? companyLabel(company) : "",
              fy,
              asAt: meta?.as_at ?? null,
              inactiveDays: inactiveApplied,
            })}
                    disabled={!data}
                    className="rounded-button gap-1.5 bg-primary hover:bg-primary-hover text-primary-foreground">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="grid gap-2.5">
            <LifecycleCard
              tone="orange" label="New Customers" icon={UserPlus}
              count={kpi?.new_count ?? 0}
              moneyLabel="Total Sales" money={kpi?.new_sales ?? 0} recv={kpi?.new_recv ?? 0}
            />
            <LifecycleCard
              tone="slate" label="Existing Customers" icon={Users}
              count={kpi?.existing_count ?? 0}
              moneyLabel="Total Sales" money={kpi?.existing_sales ?? 0} recv={kpi?.existing_recv ?? 0}
            />
            <LifecycleCard
              tone="down" label="Non Active Customers" sub="(for current year)" icon={UserX}
              count={kpi?.nonactive_count ?? 0}
              moneyLabel="Total Sales (prior year)" money={kpi?.nonactive_sales ?? 0} recv={kpi?.nonactive_recv ?? 0}
            />
            <LifecycleCard
              tone="grey" label="Old Customers" sub="(not in current year and previous year)" icon={TrendingDown}
              count={kpi?.old_count ?? 0}
              moneyLabel="Total Sales" recv={kpi?.old_recv ?? 0}
            />
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3">
            <BandCard name="Small" count={bands.Small.count} total={bands.Small.total}
                      rule={`Customer contribution between 0% and ${cfg.small_max_pct}% of total sales`} />
            <BandCard name="Medium" count={bands.Medium.count} total={bands.Medium.total}
                      rule={`Customer contribution between ${cfg.small_max_pct}% and ${cfg.medium_max_pct}% of total sales`} />
            <BandCard name="Large" count={bands.Large.count} total={bands.Large.total}
                      rule={`Customer contribution above ${cfg.medium_max_pct}% of total sales`} />
          </div>
        </div>

        <div className="mt-3 space-y-1 text-[10.5px] leading-relaxed text-muted-foreground">
          <p>
            Bands are a share of this year's <b>positive</b> sales. A customer whose year nets to zero or
            below is left unbanded rather than counted as Small — that is why the band counts can be
            lower than the customer count. The lifecycle cards above <b>do</b> net returns.
          </p>
          <p>{RECEIVABLE_BASIS}</p>
          {meta && !meta.old_supported && (
            <p>
              <b>Old Customers reads 0 because this book only holds {meta.book_fys} financial year
              {meta.book_fys === 1 ? "" : "s"}</b>{meta.book_from ? ` (from FY ${meta.book_from})` : ""} — nobody can
              fall outside both the current and previous year. It becomes meaningful once a third year is
              in the book.
            </p>
          )}
          {meta && !meta.py_present && (
            <p><b>No prior year is available for this company</b>, so every customer reads as New.</p>
          )}
        </div>
      </SalesPanel>

      {/* ---- Customers' Journey ---- */}
      <div className="grid gap-3 lg:grid-cols-2">
        {journeyTable("Top 5 Customers' Journey · Positive", "up", journey.positive)}
        {journeyTable("Top 5 Customers' Journey · Negative", "down", journey.negative)}
      </div>

      {/* ---- New customers ---- */}
      <SalesPanel
        title={viewAll ? "All New Customers" : "Top 20 New Customers"}
        icon={UserPlus}
        loading={isLoading}
        empty={!isLoading && newRows.length === 0}
        emptyMessage="No new customers in this period."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setViewAll((v) => !v)}
                    className="rounded-button">
              {viewAll ? "Top 20" : "View All"}
            </Button>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer…"
                   className="h-9 w-[190px]" />
            <label className="flex items-center gap-1.5 text-[12px] text-grey">
              Non-active after
              <Input type="number" min={1} value={inactiveDays}
                     onChange={(e) => setInactiveDays(Math.max(1, Number(e.target.value) || 1))}
                     className="h-9 w-[76px]" />
              days
            </label>
          </div>
        }
      >
        <ScrollableTable>
          <table className="w-full border-collapse">
            <thead className="bg-page">
              <tr>
                <Th>Name</Th>
                <Th>Sales Person</Th>
                <Th>Last Invoice</Th>
                <Th right>Days Since Invoice</Th>
                <Th right>Total Sales</Th>
                <Th right>Average Sales</Th>
                <Th right>Pending Receivables</Th>
                <Th>Segment</Th>
                <Th>View Profile</Th>
              </tr>
            </thead>
            <tbody>
              {newPage.pageItems.map((r) => {
                const seg = segmentOf(r.cy_share, cfg);
                return (
                  <tr key={r.cust_key} className="border-t border-line hover:bg-page/60">
                    <Td className="max-w-[300px] truncate">{r.name}</Td>
                    <Td className="text-grey">{r.salesperson ?? ""}</Td>
                    <Td>{dmy(r.last_invoice)}</Td>
                    <Td right>{r.days_since ?? ""}</Td>
                    <Td right className={r.cy_sales < 0 ? "text-ryg-red" : ""}>{fmtCust(r.cy_sales)}</Td>
                    <Td right className={r.avg_sales < 0 ? "text-ryg-red" : ""}>{fmtCust(r.avg_sales)}</Td>
                    <Td right>{fmtCust(r.receivable)}</Td>
                    <Td>{seg ?? ""}</Td>
                    <Td>{viewProfile(r.guid, r.name)}</Td>
                  </tr>
                );
              })}
            </tbody>
            {newRows.length > 0 && (
              <tfoot className="border-t-2 border-line bg-page">
                <tr>
                  <Foot />
                  <Foot />
                  <Foot />
                  <Foot />
                  <Foot right>Total: {fmtCust(newTotals.sales)}</Foot>
                  <Foot />
                  <Foot right>Total: {fmtCust(newTotals.recv)}</Foot>
                  <Foot />
                  <Foot />
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollableTable>
        <Pagination state={newPage} rowsLabel="customers" showPageSize={false} />
        <p className="px-4 pb-3 text-[10.5px] leading-relaxed text-muted-foreground">
          Sorted by Average Sales, highest first — the order Talligence prints. Average Sales divides by
          sales invoices only, so a customer whose activity was a credit note shows ₹0 here while its
          value still counts in Total Sales. <b>Sales Person is filled from the customer muster</b>;
          Talligence leaves it blank because Tally has no salesperson dimension.
          {meta && meta.guid_missing > 0 && (
            <> {meta.guid_missing} customer{meta.guid_missing === 1 ? " is" : "s are"} not yet in the ledger
            master, so the profile link is unavailable for {meta.guid_missing === 1 ? "it" : "them"}.</>
          )}
        </p>
      </SalesPanel>

      {/* ---- Gone quiet ---- */}
      {(data?.inactive?.length ?? 0) > 0 && (
        <SalesPanel
          title={`Customers with no invoice in ${inactiveApplied} days`}
          icon={UserX}
          loading={isLoading}
        >
          <ScrollableTable>
            <table className="w-full border-collapse">
              <thead className="bg-page">
                <tr>
                  <Th>Name</Th><Th>Sales Person</Th><Th>Last Invoice</Th>
                  <Th right>Days Since</Th><Th right>This Year</Th><Th right>Prior Year</Th>
                  <Th right>Pending Receivables</Th><Th>View Profile</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.inactive ?? []).slice(0, 25).map((r) => (
                  <tr key={`${r.name}-${r.last_invoice}`} className="border-t border-line hover:bg-page/60">
                    <Td className="max-w-[300px] truncate">{r.name}</Td>
                    <Td className="text-grey">{r.salesperson ?? ""}</Td>
                    <Td>{dmy(r.last_invoice)}</Td>
                    <Td right>{r.days_since ?? ""}</Td>
                    <Td right>{fmtCust(r.cy_sales)}</Td>
                    <Td right>{fmtCust(r.py_sales)}</Td>
                    <Td right>{fmtCust(r.receivable)}</Td>
                    <Td>{viewProfile(r.guid, r.name)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
          <p className="px-4 pb-3 pt-2 text-[10.5px] text-muted-foreground">
            Highest pending receivable first, top 25. Change the day count above to re-cut this list.
          </p>
        </SalesPanel>
      )}

      {/* ---- Edit Segments ---- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Edit Segments</DialogTitle>
            <DialogDescription>
              Where the Small / Medium / Large bands sit, as a share of this company's total sales.
              Saved for {company ? companyLabel(company) : "this company"} and applied instantly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <label className="flex items-center justify-between gap-3 text-[13px] text-navy">
              <span>Small — up to</span>
              <span className="flex items-center gap-1.5">
                <Input type="number" min={1} max={98} value={draftSmall}
                       onChange={(e) => setDraftSmall(e.target.value)} className="h-9 w-[92px]" />
                <span className="text-grey">%</span>
              </span>
            </label>
            <label className="flex items-center justify-between gap-3 text-[13px] text-navy">
              <span>Medium — up to</span>
              <span className="flex items-center gap-1.5">
                <Input type="number" min={2} max={99} value={draftMedium}
                       onChange={(e) => setDraftMedium(e.target.value)} className="h-9 w-[92px]" />
                <span className="text-grey">%</span>
              </span>
            </label>
            <p className="text-[11.5px] text-muted-foreground">
              Anything above {draftMedium || "…"}% is Large. On a broad customer base no single customer
              reaches 31% of total sales, so Talligence's own bands leave Medium and Large empty — lower
              them here if you want the split to discriminate.
            </p>
            {saveErr && <p className="text-[12px] text-ryg-red">{saveErr}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={onSaveSegments} disabled={saving || !companyGuid}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
