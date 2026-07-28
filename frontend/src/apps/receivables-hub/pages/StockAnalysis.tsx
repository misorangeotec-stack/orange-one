import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, Boxes, CalendarX2, Hourglass, Layers, PackageSearch, RefreshCw,
  Search, TrendingUpDown, Warehouse,
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
  fmtStock, tickStock, stockPeriod, stockFyOptions, dmy, qtyFmt, badShare,
  loadStockAnalysis, loadStockAnalysisLastRefresh, refreshStockAnalysisCompany,
  DEFAULT_BAD_DAYS, DEFAULT_EXPIRE_DAYS, BAD_STOCK_BASIS, EXPIRY_NOTE,
  STOCK_CURRENT, STOCK_PRIOR, STOCK_ACCENT,
  type StockBadRow,
} from "@hub/lib/stockAnalysis";

/**
 * Reports → Inventory → Stock Analysis.
 *
 * A rebuild of the Talligence "Stock Analysis" screen (Misc/Talligence-Inputs/) in Orange One's
 * palette — the first INVENTORY-side report, and the fourth Talligence clone after the Sales,
 * Purchase and C-Level dashboards. Ten panels: Stock Value, Bad Stock Investment, Expired Stock,
 * Stock by Product Category, Stock by Product Group, Stock Inward–Outward, Top 10 Product Details,
 * Top 10 Bad Stock Item, Top 10 Expired Stock Item, Top 10 Expire Stock Item Soon.
 *
 * Every figure comes from ONE ConnectWave RPC (`rpt_stock_analysis`), measured 95 ms on the largest
 * book. Panel-by-panel tally against the source screen:
 * Misc/Talligence-Inputs/stock-analysis-reconciliation.md
 *
 * THREE DELIBERATE DIVERGENCES FROM THE SOURCE:
 *  1. AS-AT DATE — theirs is stamped 24-Jul-2026, ours reads the mirror's own sync (three days
 *     fresher). Walked back to their date our stock value lands within 1.1 % of theirs, so this is
 *     freshness, not disagreement. The header prints the date the figures are actually as at.
 *  2. BAD STOCK — theirs is ₹3.21 Cr, which exceeds its OWN ₹2.86 Cr Stock Value, because they value
 *     bad stock at inward rate while their Stock Value uses closing rate. No universe reproduces
 *     ₹3.21 Cr, and their own table contradicts their own product panel on the same page. Ours is at
 *     closing value, so Bad ≤ Stock always holds and both KPIs share one basis. The rule is printed
 *     on the card.
 *  3. EXPIRED / EXPIRING — structurally empty on EVERY company, and correctly so: the Tally
 *     connector never fetches an expiry or manufacturing date, so there is nothing to age. Said in
 *     words on the panels rather than left looking broken.
 *
 * Talligence pages its tables at 10 rows; this one uses the house 25 (see the pagination rule) and
 * the app's shared panel / table chrome.
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };

/** Inward reads as the brand orange, outward as the muted prior-year slate — the same pairing the
    other Master Reports use for "this vs that", so the eye carries over between screens. */
const INWARD_COLOR = STOCK_CURRENT;
const OUTWARD_COLOR = STOCK_PRIOR;

/* ---- Hero banner (matches the Sales / Purchase / C-Level dashboards) ---- */

function StockHero({
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
            <Warehouse className="h-6 w-6 text-orange" /> Stock Analysis
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>
        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">{controls}</div>
      </div>
    </div>
  );
}

/** The three headline cards. `note` is a footnote under the value, `control` sits beside it. */
function KpiCard({
  title, icon: Icon, value, caption, note, control, loading, muted,
}: {
  title: string; icon: React.ElementType; value: string; caption?: string;
  note?: string; control?: React.ReactNode; loading?: boolean; muted?: boolean;
}) {
  return (
    <Card className="rounded-card border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-grey-2">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-40 animate-pulse rounded-md bg-muted/60" />
      ) : (
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className={cn("text-[28px] font-bold leading-none tabular-nums",
                             muted ? "text-grey-2" : "text-navy")}>{value}</div>
          {control}
        </div>
      )}
      {caption && <div className="mt-2 text-[11px] text-muted-foreground">{caption}</div>}
      {note && <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{note}</p>}
    </Card>
  );
}

/** A small "N Days" number input, styled to sit inside a KPI card. Talligence has one on the Bad
    Stock card and one on the Expire-Soon panel; both are kept and both are wired. */
function DaysInput({
  label, value, onChange, id,
}: { label: string; value: number; onChange: (n: number) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[11px] font-semibold text-grey-2">
      {label}
      <input
        id={id}
        type="number"
        min={1}
        max={3650}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(1, Math.min(3650, Math.round(n))));
        }}
        className="h-7 w-16 rounded-input border border-line px-2 text-right text-[12px] tabular-nums text-navy focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <span className="font-normal">Days</span>
    </label>
  );
}

/** The Bad / Expired / Expiring tables all share this shape. */
function ItemTable({
  rows, daysHeader, emptyNote,
}: { rows: StockBadRow[]; daysHeader: string; emptyNote?: string }) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (!rows.length) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
        No Data Found.
        {emptyNote && <p className="mx-auto mt-2 max-w-md text-[10.5px] leading-snug">{emptyNote}</p>}
      </div>
    );
  }
  return (
    <ScrollableTable>
      <table className="w-full text-[12.5px]">
        <thead className="bg-muted/40">
          <tr className="text-left text-grey-2">
            <th className="px-3 py-2 font-semibold">Product Name</th>
            <th className="px-3 py-2 text-right font-semibold">Quantity</th>
            <th className="px-3 py-2 text-right font-semibold">Base Units</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
            <th className="px-3 py-2 text-right font-semibold">{daysHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item} className="border-t border-line/70">
              <td className="max-w-[280px] truncate px-3 py-1.5 text-navy" title={r.item}>{r.item}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{qtyFmt(r.qty)}</td>
              <td className="px-3 py-1.5 text-right text-grey-2">{r.base_unit || "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{fmtStock(r.amount)}</td>
              {/* never_moved means the item has no line at all this FY, so the age is a FLOOR —
                  days since the FY started — not its true age. Marked, never rounded away. */}
              <td className="px-3 py-1.5 text-right tabular-nums text-grey-2">
                {r.never_moved ? `${r.days}+` : r.days}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
            <td className="px-3 py-2" colSpan={3}>Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtStock(total)}</td>
            <td className="px-3 py-2" />
          </tr>
        </tfoot>
      </table>
    </ScrollableTable>
  );
}

export default function StockAnalysis() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const fyOptions = useMemo(() => stockFyOptions(), []);
  const [fy, setFy] = useState<string>(params.get("fy") ?? fyOptions[0]);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");
  const [badDays, setBadDays] = useState(DEFAULT_BAD_DAYS);
  const [expireDays, setExpireDays] = useState(DEFAULT_EXPIRE_DAYS);
  const [showZeroValue, setShowZeroValue] = useState(true);
  const [grpQuery, setGrpQuery] = useState("");

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

  const period = useMemo(() => stockPeriod(fy), [fy]);

  /* The two Days inputs re-cut the payload server-side, so debounce them — otherwise every
     keystroke on "90" fires a request for 9 and then 90. */
  const [badDaysApplied, setBadDaysApplied] = useState(badDays);
  const [expireDaysApplied, setExpireDaysApplied] = useState(expireDays);
  useEffect(() => {
    const t = window.setTimeout(() => setBadDaysApplied(badDays), 400);
    return () => window.clearTimeout(t);
  }, [badDays]);
  useEffect(() => {
    const t = window.setTimeout(() => setExpireDaysApplied(expireDays), 400);
    return () => window.clearTimeout(t);
  }, [expireDays]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["stockAnalysis", "v1", companyGuid, fy, badDaysApplied, expireDaysApplied],
    queryFn: () => loadStockAnalysis(companyGuid, fy, badDaysApplied, expireDaysApplied),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["stockAnalysisLastRefresh", companyGuid, fy],
    queryFn: () => loadStockAnalysisLastRefresh(companyGuid, fy),
    enabled: !!companyGuid,
    staleTime: 60 * 1000,
  });

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
      const res = await refreshStockAnalysisCompany(companyGuid, fy);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.items ?? 0} stock items.`);
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
  const meta = data?.meta;

  const movement = useMemo(() => {
    const m = new Map<number, { inward: number; outward: number }>();
    for (const p of data?.movement ?? []) {
      m.set(Number(p.m), { inward: Number(p.inward) || 0, outward: Number(p.outward) || 0 });
    }
    return FY_MONTHS.map((mo) => ({
      name: MONTH_LABEL[mo],
      inward: m.has(mo) ? m.get(mo)!.inward : null,
      outward: m.has(mo) ? m.get(mo)!.outward : null,
    }));
  }, [data]);

  const categories = data?.categories ?? [];
  const groups = data?.groups ?? [];

  const grpFiltered = useMemo(() => {
    const q = grpQuery.trim().toLowerCase();
    return q ? groups.filter((g) => g.grp.toLowerCase().includes(q)) : groups;
  }, [groups, grpQuery]);
  const grpPage = usePagination(grpFiltered, {
    pageSize: 25,
    resetKey: `${companyGuid}|${fy}|${grpQuery}`,
  });
  const grpTotal = useMemo(
    () => grpFiltered.reduce((s, g) => s + (Number(g.amt) || 0), 0),
    [grpFiltered],
  );

  const products = showZeroValue ? (data?.products ?? []) : (data?.products_valued ?? []);
  const productTotal = useMemo(
    () => products.reduce((s, p) => s + (Number(p.value) || 0), 0),
    [products],
  );

  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;
  const share = badShare(kpi);

  const heroSummary: React.ReactNode = heroLoading
    ? "Loading the stock book…"
    : kpi
      ? (
        <>
          <span className="font-semibold text-white">{fmtStock(kpi.stock_value)}</span> of stock on hand
          across <span className="font-semibold text-white">{kpi.in_stock_items.toLocaleString("en-IN")}</span> items
          {share != null && <>, of which <span className="font-semibold text-white">{share.toFixed(1)}%</span> has
            not moved out in {badDaysApplied} days</>}.
        </>
      )
      : "Stock value, ageing and movement — straight from the Tally books.";

  const heroMeta = [
    `Stock as at: ${meta?.stock_as_at ? dmy(meta.stock_as_at) : "—"}`,
    `Last refreshed: ${
      lastRefresh?.ran_at
        ? new Date(lastRefresh.ran_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : "never"
    }`,
    "Currency ₹",
    "Auto-refreshes daily at 10:45 PM",
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
    formatter: (v: number | string) => fmtStock(Number(v)),
  };
  const qtyTooltip = {
    contentStyle: { fontSize: 12, borderRadius: 8, border: "1px solid hsl(220 15% 88%)" },
    formatter: (v: number | string) => qtyFmt(Number(v)),
  };

  /* ------------------------------------------------------------------ view */

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      <StockHero
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
            Rebuilding this company's stock snapshot — {elapsed.toFixed(0)}s elapsed
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

      {/* ── Row 1: the three KPI cards ─────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <KpiCard
          title="Stock Value"
          icon={Boxes}
          loading={isLoading}
          value={fmtStock(kpi?.stock_value ?? 0)}
          caption={kpi ? `${kpi.in_stock_items.toLocaleString("en-IN")} of ${kpi.item_count.toLocaleString("en-IN")} items carry a balance` : undefined}
          note="Tally's own closing value, as at the last ConnectWave sync — not a re-derivation."
        />
        <KpiCard
          title="Bad Stock Investment"
          icon={Hourglass}
          loading={isLoading}
          value={fmtStock(kpi?.bad_value ?? 0)}
          caption={kpi ? `${kpi.bad_items.toLocaleString("en-IN")} items${share != null ? ` · ${share.toFixed(1)}% of stock value` : ""}` : undefined}
          note={BAD_STOCK_BASIS}
          control={
            <DaysInput id="bad-days" label="Bad Stock Duration:" value={badDays} onChange={setBadDays} />
          }
        />
        <KpiCard
          title="Expired Stock"
          icon={CalendarX2}
          loading={isLoading}
          muted
          value={fmtStock(kpi?.expired_value ?? 0)}
          caption={`Expired Stock Items: ${kpi?.expired_items ?? 0}`}
          note={meta && !meta.expiry_supported ? "No batch expiry is tracked on these books — see the panel below." : undefined}
        />
      </div>

      {/* ── Row 2: Category · Product Group ────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel
          title="Stock by Product Category"
          icon={Layers}
          loading={isLoading}
          subtitle={categories.length === 1 && categories[0].category === "Undefined"
            ? "Tally carries no stock categories on this book"
            : undefined}
          empty={!isLoading && categories.length === 0}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={categories.map((c) => ({ name: c.category, amt: Number(c.amt) || 0 }))}
                      margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={tickStock} width={52} />
              <Tooltip {...moneyTooltip} />
              <Bar dataKey="amt" name="Stock Value" fill={STOCK_ACCENT} radius={[3, 3, 0, 0]} maxBarSize={140} />
            </BarChart>
          </ResponsiveContainer>
          {/* Talligence labels this bar "Undefined". Every item on these books is CATEGORY
              'Not Applicable', which is Tally's sentinel for "no category" — one bar is correct,
              not a missing dimension. */}
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Stock categories are not set up in Tally, so everything falls into one bucket. The source
            screen prints the same single bar.
          </p>
        </SalesPanel>

        <SalesPanel
          title="Stock by Product Group"
          icon={PackageSearch}
          loading={isLoading}
          subtitle={meta ? `${meta.group_count} groups carry a balance` : undefined}
          bodyClassName="p-0"
          empty={!isLoading && groups.length === 0}
          actions={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-grey" />
              <input value={grpQuery} onChange={(e) => setGrpQuery(e.target.value)} placeholder="Search"
                     className="h-7 w-36 rounded-input border border-line pl-7 pr-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>
          }
        >
          <ScrollableTable maxHeight="max-h-[420px]">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-muted/40">
                <tr className="text-left text-grey-2">
                  <th className="px-3 py-2 font-semibold">Groups</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {grpPage.pageItems.map((g) => (
                  <tr key={g.grp} className="border-t border-line/70">
                    <td className="max-w-[320px] truncate px-3 py-1.5 text-navy" title={g.grp}>{g.grp}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtStock(g.amt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtStock(grpTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
          <Pagination state={grpPage} rowsLabel="groups" showPageSize={false} />
        </SalesPanel>
      </div>

      {/* ── Row 3: Inward–Outward · Top 10 Product Details ─────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel
          title="Stock Inward – Outward"
          icon={TrendingUpDown}
          loading={isLoading}
          subtitle="Quantity moved each month, all items"
          empty={!isLoading && (data?.movement ?? []).length === 0}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={movement} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false}
                     tickFormatter={(v: number) => qtyFmt(v)} width={56} />
              <Tooltip {...qtyTooltip} />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inward" name="Inward Qty" fill={INWARD_COLOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="outward" name="Outward Qty" fill={OUTWARD_COLOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
          {/* Deliberate: Tally's own chart does the same. Mixing units is what makes this a volume
              indicator rather than a measure, and the reconciliation matched Talligence on it. */}
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Quantities are summed across mixed base units (KGS, MTR, PCS), so read this as movement
            volume rather than a single measure — the source screen does the same.
          </p>
        </SalesPanel>

        <SalesPanel
          title="Top 10 Product Details"
          icon={Boxes}
          loading={isLoading}
          subtitle="Ranked by stock quantity"
          bodyClassName="p-0"
          empty={!isLoading && products.length === 0}
          actions={
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-grey-2">
              <input type="checkbox" checked={showZeroValue}
                     onChange={(e) => setShowZeroValue(e.target.checked)}
                     aria-label="Show zero value items"
                     className="h-3.5 w-3.5 cursor-pointer align-middle" />
              Show Zero Value Items
            </label>
          }
        >
          <ScrollableTable>
            <table className="w-full text-[12.5px]">
              <thead className="bg-muted/40">
                <tr className="text-left text-grey-2">
                  <th className="px-3 py-2 font-semibold">Product Name</th>
                  <th className="px-3 py-2 text-right font-semibold">Stock Quantity</th>
                  <th className="px-3 py-2 text-right font-semibold">Base Units</th>
                  <th className="px-3 py-2 text-right font-semibold">Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.item} className="border-t border-line/70">
                    <td className="max-w-[300px] truncate px-3 py-1.5 text-navy" title={p.item}>{p.item}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{qtyFmt(p.qty)}</td>
                    <td className="px-3 py-1.5 text-right text-grey-2">{p.base_unit || "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtStock(p.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-muted/30 font-semibold text-navy">
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtStock(productTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </ScrollableTable>
          {/* The total is the ten rows shown, not the whole book — same as the source screen. */}
          <p className="px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
            Total is these ten rows, not all stock.
          </p>
        </SalesPanel>
      </div>

      {/* ── Row 4: Bad Stock · Expired ─────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel
          title="Top 10 Bad Stock Item"
          icon={Hourglass}
          loading={isLoading}
          subtitle={`No outward movement in ${badDaysApplied} days · ranked by value`}
          bodyClassName="p-0"
        >
          <ItemTable rows={data?.bad ?? []} daysHeader="Bad Stock Days" />
          {/* Talligence sorts this table by days ascending, which puts a ₹6.15 K row above a ₹1.24 L
              one. On a "Top 10" the money is the point. */}
          {(data?.bad ?? []).some((r) => r.never_moved) && (
            <p className="px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
              A trailing <b>+</b> means the item has no movement at all this financial year, so its
              age is at least that many days rather than exactly that many.
            </p>
          )}
        </SalesPanel>

        <SalesPanel
          title="Top 10 Expired Stock Item"
          icon={CalendarX2}
          loading={isLoading}
          bodyClassName="p-0"
        >
          <ItemTable rows={data?.expired ?? []} daysHeader="Expired Stock Days" emptyNote={EXPIRY_NOTE} />
        </SalesPanel>
      </div>

      {/* ── Row 5: Expiring soon ───────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SalesPanel
          title="Top 10 Expire Stock Item Soon"
          icon={CalendarX2}
          loading={isLoading}
          bodyClassName="p-0"
          actions={
            <DaysInput id="expire-days" label="Days" value={expireDays} onChange={setExpireDays} />
          }
        >
          <ItemTable rows={data?.expiring ?? []} daysHeader="Expire in Days" emptyNote={EXPIRY_NOTE} />
        </SalesPanel>
      </div>
    </div>
  );
}
