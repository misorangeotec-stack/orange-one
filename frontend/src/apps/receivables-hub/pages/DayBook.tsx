import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BookOpen, Boxes,
  CalendarClock, Package, RefreshCw, ShoppingCart, TrendingUp, Users, Wallet,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import SalesPanel from "@hub/components/masterreports/SalesPanel";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { fmtSales } from "@hub/lib/salesReport";
import {
  dmy, isoToYmd, loadDayBook, loadLastDayBookRefresh, longDate, refreshDayBookCompany,
  ymdOf, ymdToIso, type DayProduct, type DayVoucher,
} from "@hub/lib/dayBook";

/**
 * Master Reports → Day Book.
 *
 * A faithful rebuild of the Talligence Day Book (Misc/Talligence-Inputs/Reports - Day Book.pdf):
 * a single-company, single-day operational dashboard — 8 KPI cards, the day's voucher list, the
 * Income/Expense split and the Sales/Purchase product + Sales-Person panels, driven by a date
 * picker. Every figure comes from ONE ConnectWave RPC (`rpt_day_book`) reading the precomputed
 * rpt_day_book_* snapshot. Reconciled against the source screen for Orange O Tec Noida on
 * 24-Jul-2026: Today's Sales ₹6,12,542.74, all 5 sales vouchers, Income {Sales Accounts 6.13 L,
 * Direct Incomes ₹150}, Expense {Indirect Expenses ₹0.43}, 15 products = ₹6.13 L, Best Sales
 * Day 14-Jul — all exact. (Purchases differ from a point-in-time PDF only by back-dated
 * vouchers, which this live snapshot correctly carries.)
 */

const NOIDA_GUID = "53d35745-5246-4e1a-a27a-d4769f245b50";

/* ---- Hero banner (matches the Sales Report hero) ------------------------- */

function DayHero({
  company, dateYmd, metaLine, summary, controls,
}: {
  company?: string;
  dateYmd: string;
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
            <span>{longDate(dateYmd)}</span>
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-[24px] font-bold tracking-tight sm:text-[27px]">
            <BookOpen className="h-6 w-6 text-orange" /> Day Book
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-white/75">{summary}</p>
          {metaLine && <p className="mt-1.5 text-[11px] text-white/40">{metaLine}</p>}
        </div>
        <div className="flex flex-col items-stretch gap-2.5 sm:items-end">{controls}</div>
      </div>
    </div>
  );
}

/* ---- KPI cards (matches the Sales Report tiles) -------------------------- */

type KpiTone = "orange" | "slate" | "grey" | "up" | "down";

const KPI_TONE: Record<KpiTone, { chip: string; value: string; glow: string }> = {
  orange: { chip: "bg-orange-soft text-orange", value: "text-navy", glow: "from-orange/10" },
  slate: { chip: "bg-[#EAF0FA] text-navy", value: "text-navy", glow: "from-navy/[0.07]" },
  grey: { chip: "bg-page text-grey-2", value: "text-grey", glow: "from-grey-2/[0.07]" },
  up: { chip: "bg-[#E7F6EE] text-emerald-600", value: "text-emerald-600", glow: "from-emerald-500/10" },
  down: { chip: "bg-[#FDECEC] text-ryg-red", value: "text-ryg-red", glow: "from-ryg-red/10" },
};

function KpiCard({
  tone, label, value, hint, icon: Icon,
}: {
  tone: KpiTone; label: string; value: string; hint: string; icon: LucideIcon;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-white px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-card">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-100", t.glow)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
          <div className={cn("mt-1 text-[24px] font-bold leading-none tabular-nums sm:text-[26px]", t.value)}>{value}</div>
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

/* ---- Reusable P&L (Income/Expense) and Products tables ------------------- */

function PlTable({ rows }: { rows: { group: string; amount: number }[] }) {
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <ScrollableTable className="rounded-md border border-border">
      <table className="w-full">
        <thead className="bg-muted/40 border-b border-border">
          <tr><Th>Group</Th><Th right>Amount</Th></tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.group} className="hover:bg-muted/30">
              <Td className="max-w-[280px] truncate">{r.group}</Td>
              <Td right>{fmtSales(r.amount)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/40 border-t border-border font-semibold">
          <tr><Td>Total</Td><Td right>{fmtSales(total)}</Td></tr>
        </tfoot>
      </table>
    </ScrollableTable>
  );
}

const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function ProductsPanel({
  title, icon, rows, resetKey,
}: {
  title: string; icon: LucideIcon; rows: DayProduct[]; resetKey: string;
}) {
  const page = usePagination(rows, { pageSize: 10, resetKey });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <SalesPanel title={title} icon={icon} bodyClassName="p-0" empty={rows.length === 0} emptyMessage="No data found.">
      <ScrollableTable className="border-b border-border">
        <table className="w-full">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              <Th>Item Name</Th><Th right>Item Quantity</Th><Th>Base Units</Th>
              <Th right>Item Rate</Th><Th right>Amount</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {page.pageItems.map((p, i) => (
              <tr key={`${p.item}|${i}`} className="hover:bg-muted/30">
                <Td className="max-w-[320px] truncate">{p.item}</Td>
                <Td right>{nf2.format(Number(p.qty) || 0)}</Td>
                <Td>{p.unit ?? "—"}</Td>
                <Td right>{nf2.format(Number(p.rate) || 0)}</Td>
                <Td right>{fmtSales(p.amount)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/40 border-t border-border font-semibold">
            <tr><Td>Total</Td><Td right /><Td /><Td right /><Td right>{fmtSales(total)}</Td></tr>
          </tfoot>
        </table>
      </ScrollableTable>
      <Pagination state={page} rowsLabel="items" showPageSize={false} />
    </SalesPanel>
  );
}

export default function DayBook() {
  const { companies, loading: coLoading, error: coError } = useFinancialStatements();
  const [params, setParams] = useSearchParams();

  const todayYmd = useMemo(() => ymdOf(new Date()), []);
  const [dateYmd, setDateYmd] = useState<string>(params.get("date") ?? todayYmd);
  const [companyGuid, setCompanyGuid] = useState<string>(params.get("company") ?? "");

  // Default to Orange O Tec Noida (the book the source report came from) when present.
  useEffect(() => {
    if (companyGuid || !companies.length) return;
    const noida = companies.find((c) => c.companyGuid === NOIDA_GUID);
    setCompanyGuid(noida?.companyGuid ?? companies[0].companyGuid);
  }, [companies, companyGuid]);

  const pick = (guid: string, nextDate: string) => {
    setCompanyGuid(guid);
    setDateYmd(nextDate);
    setParams({ company: guid, date: nextDate }, { replace: true });
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dayBook", "v1", companyGuid, dateYmd],
    queryFn: () => loadDayBook(companyGuid, dateYmd),
    enabled: !!companyGuid,
    staleTime: 5 * 60 * 1000,
  });

  const { data: lastRefresh, refetch: refetchLast } = useQuery({
    queryKey: ["dayBookLastRefresh", companyGuid, dateYmd],
    queryFn: () => loadLastDayBookRefresh(companyGuid, dateYmd),
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
      const res = await refreshDayBookCompany(companyGuid, dateYmd);
      if (res.status === "cooldown") {
        setRefreshNote(`Already refreshed a moment ago — try again in ${res.retry_after_seconds ?? 60}s.`);
      } else if (res.status === "busy") {
        setRefreshNote("A refresh is already running for this company.");
      } else if (res.status === "error") {
        setRefreshNote(res.message ?? "Refresh failed.");
      } else {
        setRefreshNote(`Refreshed in ${res.seconds}s — ${res.vouchers} vouchers.`);
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

  const vouchers: DayVoucher[] = data?.vouchers ?? [];
  const vchPage = usePagination(vouchers, { pageSize: 25, resetKey: `${companyGuid}|${dateYmd}` });
  const vchTotal = vouchers.reduce((s, v) => s + Number(v.amount), 0);

  const errText = error instanceof Error ? error.message : coError;
  const heroLoading = isLoading || coLoading;

  const heroSummary: React.ReactNode = heroLoading
    ? "Gathering the day's book…"
    : kpi
      ? (
        <>
          <span className="font-semibold text-white">{fmtSales(kpi.today_sales)}</span> sold and{" "}
          <span className="font-semibold text-white">{fmtSales(kpi.today_purchase)}</span> purchased on this day.
        </>
      )
      : "Every voucher, product and income/expense posting for the selected day — straight from the Tally books.";

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
      <select
        value={companyGuid}
        onChange={(e) => pick(e.target.value, dateYmd)}
        className={cn(darkControl, "max-w-[220px] cursor-pointer truncate [&>option]:text-navy")}
      >
        {companies.map((c) => (
          <option key={c.companyGuid} value={c.companyGuid}>{companyLabel(c)}</option>
        ))}
      </select>
      <input
        type="date"
        value={ymdToIso(dateYmd)}
        max={ymdToIso(todayYmd)}
        onChange={(e) => e.target.value && pick(companyGuid, isoToYmd(e.target.value))}
        className={cn(darkControl, "cursor-pointer [color-scheme:dark]")}
      />
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy || !companyGuid}
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
      <DayHero
        company={company?.rawName}
        dateYmd={dateYmd}
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
            Rebuilding this company's day-book snapshot — {elapsed.toFixed(0)}s elapsed
            {lastRefresh?.seconds ? ` (last run took ${lastRefresh.seconds}s)` : ""}
          </div>
        </div>
      )}
      {refreshNote && !busy && <div className="text-[11px] text-muted-foreground">{refreshNote}</div>}

      {errText ? (
        <div className="py-16 text-center text-destructive text-sm flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errText}
        </div>
      ) : isLoading || coLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading the day's book…</div>
      ) : !data || !kpi ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No data for this company.</div>
      ) : (
        <>
          {/* ── KPI row 1: sales + collection ────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard tone="orange" icon={Wallet} label="Today's Sales" value={fmtSales(kpi.today_sales)} hint={dmy(dateYmd)} />
            <KpiCard tone="slate" icon={CalendarClock} label="Yesterday's Sales" value={fmtSales(kpi.yesterday_sales)} hint="Previous day" />
            <KpiCard tone="up" icon={TrendingUp} label="Best Sales Day in Month" value={fmtSales(kpi.best_sales_day.amt)} hint={longDate(kpi.best_sales_day.date) || "—"} />
            <KpiCard tone="grey" icon={ArrowDownToLine} label="Collection" value={fmtSales(kpi.collection)} hint="Receipts on this day" />
          </div>

          {/* ── KPI row 2: purchase + payment ────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard tone="slate" icon={ShoppingCart} label="Today's Purchase" value={fmtSales(kpi.today_purchase)} hint={dmy(dateYmd)} />
            <KpiCard tone="grey" icon={CalendarClock} label="Yesterday's Purchase" value={fmtSales(kpi.yesterday_purchase)} hint="Previous day" />
            <KpiCard tone="up" icon={TrendingUp} label="Best Purchase Day in Month" value={fmtSales(kpi.best_purchase_day.amt)} hint={longDate(kpi.best_purchase_day.date) || "—"} />
            <KpiCard tone="grey" icon={ArrowUpFromLine} label="Payment" value={fmtSales(kpi.payment)} hint="Payments on this day" />
          </div>

          {/* ── Day Book voucher table ───────────────────────────────── */}
          <SalesPanel
            title="Day Book"
            icon={BookOpen}
            subtitle={`All vouchers on ${dmy(dateYmd)}`}
            bodyClassName="p-0"
            empty={vouchers.length === 0}
            emptyMessage="No vouchers on this day."
          >
            <ScrollableTable className="border-b border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Date</Th><Th>Party Name</Th><Th>Voucher Number</Th>
                    <Th>Voucher Type</Th><Th right>Amount</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {vchPage.pageItems.map((v) => (
                    <tr key={`${v.voucher_type}|${v.voucher_no}`} className="hover:bg-muted/30">
                      <Td>{dmy(v.date)}</Td>
                      <Td className="max-w-[300px] truncate">{v.party ?? "—"}</Td>
                      <Td>{v.voucher_no ?? "—"}</Td>
                      <Td className="max-w-[220px] truncate">{v.voucher_type ?? "—"}</Td>
                      <Td right>{fmtSales(v.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border font-semibold">
                  <tr><Td>Total</Td><Td /><Td /><Td /><Td right>{fmtSales(vchTotal)}</Td></tr>
                </tfoot>
              </table>
            </ScrollableTable>
            <Pagination state={vchPage} rowsLabel="vouchers" />
          </SalesPanel>

          {/* ── Income · Expense ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SalesPanel title="Income" icon={TrendingUp} empty={(data.income ?? []).length === 0} emptyMessage="No income postings.">
              <PlTable rows={data.income ?? []} />
            </SalesPanel>
            <SalesPanel title="Expense" icon={Wallet} empty={(data.expense ?? []).length === 0} emptyMessage="No expense postings.">
              <PlTable rows={data.expense ?? []} />
            </SalesPanel>
          </div>

          {/* ── Sales Products · Purchase Products ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ProductsPanel title="Sales Products" icon={Package} rows={data.sales_products ?? []} resetKey={`s|${companyGuid}|${dateYmd}`} />
            <ProductsPanel title="Purchase Products" icon={Boxes} rows={data.purchase_products ?? []} resetKey={`p|${companyGuid}|${dateYmd}`} />
          </div>

          {/* ── Sales Persons ────────────────────────────────────────── */}
          <SalesPanel
            title="Sales Persons"
            icon={Users}
            subtitle="Today's sales by salesperson tag (from Masters)"
            empty={(data.sales_persons ?? []).length === 0}
            emptyMessage="No sales tagged to a salesperson on this day."
          >
            <ScrollableTable className="rounded-md border border-border">
              <table className="w-full">
                <thead className="bg-muted/40 border-b border-border">
                  <tr><Th>Sales Person</Th><Th right>Amount</Th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(data.sales_persons ?? []).map((s) => (
                    <tr key={s.salesperson} className="hover:bg-muted/30">
                      <Td>{s.salesperson}</Td>
                      <Td right>{fmtSales(s.amount)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40 border-t border-border font-semibold">
                  <tr>
                    <Td>Total</Td>
                    <Td right>{fmtSales((data.sales_persons ?? []).reduce((s, r) => s + Number(r.amount), 0))}</Td>
                  </tr>
                </tfoot>
              </table>
            </ScrollableTable>
          </SalesPanel>
        </>
      )}
    </div>
  );
}
