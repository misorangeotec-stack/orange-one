import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Wallet,
  Boxes,
  Banknote,
  Users,
  Truck,
  Receipt,
  Scale,
  Percent,
  PiggyBank,
  HandCoins,
  CreditCard,
  Search,
} from "lucide-react";
import { Input } from "@hub/components/ui/input";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { fmtINRMoney, formatDateDMY } from "@hub/lib/utils";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { matchesSearch } from "@/shared/lib/search";
import {
  useClevelTrends,
  useClevelLedgerRollup,
  useClevelGst,
  useClevelStock,
} from "@hub/lib/useClevelDashboard";
import { selectHeadline, selectRatios, type ClevelRatios } from "@hub/lib/clevelDashboard";
import WidgetCard from "@hub/components/clevel/WidgetCard";
import MetricTrendCard from "@hub/components/clevel/MetricTrendCard";
import Gauge from "@hub/components/clevel/Gauge";
import MiniTable from "@hub/components/clevel/MiniTable";

const errText = (e: unknown) => (e instanceof Error ? e.message : e ? String(e) : null);

/** Turn the fy string "2026-27" into a compact "FY 26-27" label. */
const fyShort = (fy: string | null) => (fy ? `FY ${fy.slice(2)}` : "");

export default function CLevelDashboard() {
  const { companies, linesByCompany, loading, error } = useFinancialStatements();
  const [params, setParams] = useSearchParams();
  const [companyGuid, setCompanyGuid] = useState(params.get("company") ?? "");

  // Default to the first company once the list loads (respecting a ?company= deep link).
  useEffect(() => {
    if (!companyGuid && companies.length > 0) {
      const wanted = params.get("company");
      const found = companies.find((c) => c.companyGuid === wanted);
      setCompanyGuid(found ? found.companyGuid : companies[0].companyGuid);
    }
  }, [companies, companyGuid, params]);

  const company = companies.find((c) => c.companyGuid === companyGuid);
  const roots = companyGuid ? linesByCompany[companyGuid] : undefined;

  const trends = useClevelTrends(companyGuid);
  const rollup = useClevelLedgerRollup(companyGuid);
  const gst = useClevelGst(companyGuid);
  const stock = useClevelStock(companyGuid);

  const headline = useMemo(() => (roots && company ? selectHeadline(roots, company) : null), [roots, company]);
  const ratios = useMemo(() => (roots && company ? selectRatios(roots, company) : null), [roots, company]);

  const pickCompany = (guid: string) => {
    setCompanyGuid(guid);
    const next = new URLSearchParams(params);
    next.set("company", guid);
    setParams(next, { replace: true });
  };

  // ── Page-level gate: wait for companies (feeds the selector) ───────────────
  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin" />
        <span className="text-sm">Loading financials…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-3 text-destructive">
        <AlertTriangle className="h-6 w-6" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  const fyLabel = company ? `${formatDateDMY(company.fromDate)} → ${formatDateDMY(company.asOf)}` : "";
  const curFy = fyShort(trends.data?.currentFy ?? null);
  const priFy = fyShort(trends.data?.priorFy ?? null);
  const pytd = priFy ? `PYTD: ${priFy}` : undefined;
  const td = trends.data;

  const trErr = errText(trends.error);
  const roErr = errText(rollup.error);
  const stErr = errText(stock.error);
  const gsErr = errText(gst.error);

  // Prior-year comparisons are only meaningful when last year's revenue actually synced. For companies
  // whose prior year came in Tally's *short* voucher format, revenue is incomplete/sign-flipped (a known
  // connector limitation), so we HIDE the comparison rather than show a misleading delta. Current-year
  // figures are always exact (full-format). One company-level gate drives every prior-year element.
  const priorReliable = !!td && (td.ytd.sales.prior ?? -1) > 0 && (td.ytd.income.prior ?? -1) > 0;
  const priFyCmp = priorReliable ? priFy : "";
  const priorOf = (v: number | null | undefined) => (priorReliable ? (v ?? null) : null);
  // Why a prior-year comparison may be missing — most Tally books here are a SINGLE financial year (the
  // prior year lives in a separate company file), so there is genuinely no prior year to compare; only
  // books that span two FYs can show YoY, and even then a short-format prior year is hidden as unreliable.
  const priorExists = !!(td && td.priorFy);
  const priorNote = priorReliable
    ? null
    : priorExists
      ? "Prior-year data incomplete — hidden"
      : "Single financial-year book — no prior year in this file";
  const salesPrior = priorOf(td?.ytd.sales.prior);
  const salesAchv = headline && salesPrior && salesPrior > 0 ? (headline.sales / salesPrior) * 100 : 0;

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" /> C-Level Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            The executive financial picture — sales, profit, ratios, funds and stock, from Tally.
          </p>
        </div>
        <select
          value={companyGuid}
          onChange={(e) => pickCompany(e.target.value)}
          className="h-9 rounded-input border border-border bg-surface px-3 text-sm max-w-[260px] truncate"
        >
          {companies.map((c) => (
            <option key={c.companyGuid} value={c.companyGuid}>
              {companyLabel(c)}
            </option>
          ))}
        </select>
      </div>
      {company && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground border-y border-border/60 py-1.5">
          <span className="font-medium text-foreground">{company.rawName}</span>
          <span>Period: {fyLabel}</span>
          {curFy && priorReliable && <span>Comparing {curFy} vs {priFy || "—"}</span>}
          {curFy && !priorReliable && <span className="text-amber-600">{curFy} — {priorNote}</span>}
          <span>Currency: ₹</span>
        </div>
      )}

      {!company || !headline ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No company statement available.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* ── Row 1: Sales + margins ── */}
          <WidgetCard title="Total Sales (YTD)" icon={TrendingUp}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-2xl font-bold text-navy leading-none">{fmtINRMoney(headline.sales)}</div>
              {salesPrior != null && (
                <div className="text-[10px] text-muted-foreground text-right leading-tight mt-0.5">
                  {fmtINRMoney(salesPrior)}
                  {pytd && <div className="opacity-70">({pytd})</div>}
                </div>
              )}
            </div>
            {priorReliable ? (
              <Gauge
                value={salesAchv}
                max={120}
                unit="%"
                label={priFy ? `of ${priFy}` : "of last year"}
                thresholds={{ warn: 70, good: 95 }}
                height={185}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 text-center px-3" style={{ height: 185 }}>
                <span className="text-xs text-muted-foreground">Current financial year to date</span>
                <span className="text-[11px] text-amber-600">{priorNote}</span>
              </div>
            )}
          </WidgetCard>

          <MetricTrendCard
            title="Gross Profit Margin"
            icon={Percent}
            value={headline.grossProfit}
            priorValue={priorOf(td?.ytd.grossProfit.prior)}
            priorCaption={pytd}
            data={td?.grossProfit ?? []}
            chartType="line"
            curFy={curFy}
            priFy={priFyCmp}
            loading={trends.isLoading}
            error={trErr}
          />

          <MetricTrendCard
            title="Net Profit Margin"
            icon={PiggyBank}
            value={headline.nettProfit}
            priorValue={priorOf(td?.ytd.profit.prior)}
            priorCaption={pytd}
            data={td?.profit ?? []}
            chartType="line"
            curFy={curFy}
            priFy={priFyCmp}
            loading={trends.isLoading}
            error={trErr}
          />

          {/* ── Row 2: Ratios, ROE, D-E ── */}
          <RatiosCard ratios={ratios} />
          <MetricRatioCard
            title="Return-on-Equity"
            icon={Percent}
            big={ratios?.returnOnEquityPct == null ? "—" : ratios.returnOnEquityPct.toFixed(2)}
            sub={
              ratios?.returnOnEquityPct == null || !ratios.equity
                ? undefined
                : `Ratio: ${(ratios.returnOnEquityPct / 100).toFixed(2)} : 1`
            }
            legs={[
              { label: "Net Profit", value: fmtINRMoney(headline.nettProfit) },
              { label: "Equity", value: fmtINRMoney(ratios?.equity ?? 0) },
            ]}
          />
          <MetricRatioCard
            title="Debt-to-Equity"
            icon={Scale}
            big={ratios?.debtToEquity == null ? "0.00 : 1" : `${ratios.debtToEquity.toFixed(2)} : 1`}
            legs={[
              { label: "Loans (Liability)", value: fmtINRMoney(ratios?.loans ?? 0) },
              { label: "Equity", value: fmtINRMoney(ratios?.equity ?? 0) },
            ]}
          />

          {/* ── Row 3: OpEx, Bank & Loans, Available Funds ── */}
          <MetricRatioCard
            title="Operating Expense Ratio"
            icon={Percent}
            big={ratios?.opexRatio == null ? "—" : (ratios.opexRatio * 100).toFixed(2)}
            sub={ratios?.opexRatio == null ? undefined : `Ratio: ${ratios.opexRatio.toFixed(2)} : 1`}
            legs={[
              {
                label: "Indirect Expenses",
                value: fmtINRMoney((ratios?.opexRatio ?? 0) * headline.sales),
              },
              { label: "Sales", value: fmtINRMoney(headline.sales) },
            ]}
          />
          <WidgetCard
            title="Bank Accounts & Loans (Liability)"
            icon={Banknote}
            loading={rollup.isLoading}
            error={roErr}
            empty={!rollup.isLoading && (rollup.data?.bankAccounts.length ?? 0) === 0 && !(rollup.data?.loans)}
          >
            <MiniTable
              columns={[
                { key: "n", header: "Name", render: (r: { name: string }) => <span className="truncate block max-w-[220px]" title={r.name}>{r.name}</span> },
                { key: "a", header: "Amount", align: "right", render: (r: { amount: number }) => fmtINRMoney(r.amount) },
              ]}
              rows={[
                ...(rollup.data?.bankAccounts ?? []),
                ...(rollup.data?.loans ? [{ name: "Loans (Liability)", amount: -(rollup.data.loans) }] : []),
              ]}
              rowKey={(r) => r.name}
              maxRows={8}
            />
          </WidgetCard>
          <WidgetCard title="Available Funds" icon={Wallet} loading={rollup.isLoading} error={roErr}>
            <FundsBars bank={rollup.data?.bank ?? 0} cash={rollup.data?.cash ?? 0} loans={rollup.data?.loans ?? 0} />
          </WidgetCard>

          {/* ── Row 4: Monthly Sales, Top Customers, AR ── */}
          <MetricTrendCard
            title="Monthly Sales"
            icon={TrendingUp}
            value={td?.ytd.sales.current ?? 0}
            priorValue={priorOf(td?.ytd.sales.prior)}
            priorCaption={pytd}
            data={td?.sales ?? []}
            chartType="bar"
            curFy={curFy}
            priFy={priFyCmp}
            loading={trends.isLoading}
            error={trErr}
          />
          <WidgetCard
            title="Top Customers"
            icon={Users}
            loading={rollup.isLoading}
            error={roErr}
            empty={!rollup.isLoading && (rollup.data?.topCustomers.length ?? 0) === 0}
          >
            <PartyTable rows={rollup.data?.topCustomers ?? []} label="Customer" amountHeader="Sales" />
          </WidgetCard>
          <ValueCard
            title="Accounts Receivables"
            icon={HandCoins}
            value={rollup.data?.receivables ?? 0}
            caption="Total outstanding (current)"
            loading={rollup.isLoading}
            error={roErr}
          />

          {/* ── Row 5: Monthly Purchase, Top Suppliers, AP ── */}
          <MetricTrendCard
            title="Monthly Purchase"
            icon={ShoppingCart}
            value={td?.ytd.purchase.current ?? 0}
            priorValue={priorOf(td?.ytd.purchase.prior)}
            priorCaption={pytd}
            invert
            data={td?.purchase ?? []}
            chartType="bar"
            curFy={curFy}
            priFy={priFyCmp}
            loading={trends.isLoading}
            error={trErr}
          />
          <WidgetCard
            title="Top Suppliers"
            icon={Truck}
            loading={rollup.isLoading}
            error={roErr}
            empty={!rollup.isLoading && (rollup.data?.topSuppliers.length ?? 0) === 0}
          >
            <PartyTable rows={rollup.data?.topSuppliers ?? []} label="Supplier" amountHeader="Purchase" />
          </WidgetCard>
          <ValueCard
            title="Accounts Payables"
            icon={CreditCard}
            value={rollup.data?.payables ?? 0}
            caption="Total outstanding (current)"
            loading={rollup.isLoading}
            error={roErr}
          />

          {/* ── Row 6: Income, Expense, Stock Group Summary ── */}
          <MetricTrendCard
            title="Income"
            icon={TrendingUp}
            value={td?.ytd.income.current ?? 0}
            priorValue={priorOf(td?.ytd.income.prior)}
            priorCaption={pytd}
            data={td?.income ?? []}
            chartType="line"
            curFy={curFy}
            priFy={priFyCmp}
            loading={trends.isLoading}
            error={trErr}
          />
          <MetricTrendCard
            title="Expense"
            icon={TrendingDown}
            value={td?.ytd.expense.current ?? 0}
            priorValue={priorOf(td?.ytd.expense.prior)}
            priorCaption={pytd}
            invert
            data={td?.expense ?? []}
            chartType="line"
            curFy={curFy}
            priFy={priFyCmp}
            loading={trends.isLoading}
            error={trErr}
          />
          <WidgetCard
            title="Stock Group Summary"
            icon={Boxes}
            subtitle={stock.data ? `Total: ${fmtINRMoney(stock.data.totalValue)}` : undefined}
            loading={stock.isLoading}
            error={stErr}
            empty={!stock.isLoading && (stock.data?.groups.length ?? 0) === 0}
          >
            <MiniTable
              columns={[
                { key: "g", header: "Particular", render: (r: { group: string }) => <span className="truncate block max-w-[200px]" title={r.group}>{r.group}</span> },
                { key: "q", header: "Quantity", align: "right", render: (r: { qty: number }) => r.qty.toLocaleString("en-IN") },
                { key: "v", header: "Amount", align: "right", render: (r: { value: number }) => fmtINRMoney(r.value) },
              ]}
              rows={stock.data?.groups ?? []}
              rowKey={(r) => r.group}
              maxRows={9}
            />
          </WidgetCard>

          {/* ── Row 7: Fast / Slow / Non-Moving ── */}
          <StockMoveCard title="Top 10 Fast Moving Product" rows={stock.data?.fast ?? []} loading={stock.isLoading} error={stErr} />
          <StockMoveCard title="Top 10 Slow Moving Product" rows={stock.data?.slow ?? []} loading={stock.isLoading} error={stErr} />
          <StockMoveCard title="Top 10 Non Moving Products" rows={stock.data?.nonMoving ?? []} loading={stock.isLoading} error={stErr} noQty />

          {/* ── Row 8: Duties & Taxes ── */}
          <DutiesCard rows={gst.data ?? []} loading={gst.isLoading} error={gsErr} />
        </div>
      )}
    </div>
  );
}

// ── local helper components ──────────────────────────────────────────────────

/** Big ₹ value + caption, centered — for point-in-time figures with no monthly history (AR / AP). */
function ValueCard({
  title,
  icon: Icon,
  value,
  caption,
  loading,
  error,
}: {
  title: string;
  icon: import("lucide-react").LucideIcon;
  value: number;
  caption: string;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <WidgetCard title={title} icon={Icon} loading={loading} error={error}>
      <div className="flex flex-col h-full justify-center items-start gap-1 py-4">
        <div className="text-2xl font-bold text-navy leading-none">{fmtINRMoney(value)}</div>
        <div className="text-[11px] text-muted-foreground">{caption}</div>
      </div>
    </WidgetCard>
  );
}

/** The "Ratios" card: Current + Quick ratio stacked, each with its target line (matches the PDF). */
function RatiosCard({ ratios }: { ratios: ClevelRatios | null }) {
  return (
    <WidgetCard title="Ratios" icon={Scale}>
      <div className="flex flex-col h-full justify-between gap-3 py-1">
        <RatioLine label="Current Ratio" ratio={ratios?.currentRatio ?? null} target={1.5} targetText="Target: 1.5 or higher" />
        <div className="border-t border-border/60" />
        <RatioLine label="Quick Ratio" ratio={ratios?.quickRatio ?? null} target={1} targetText="Target: 1 or higher" />
      </div>
    </WidgetCard>
  );
}

function RatioLine({ label, ratio, target, targetText }: { label: string; ratio: number | null; target: number; targetText: string }) {
  const meets = ratio != null && ratio >= target;
  return (
    <div>
      <span className="inline-block px-2 py-0.5 rounded-button bg-primary/10 text-primary text-[11px] font-semibold mb-1.5">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-navy leading-none">{ratio == null ? "—" : `${ratio.toFixed(2)} : 1`}</span>
        <span className={meets ? "text-ryg-green text-[11px] font-semibold" : "text-ryg-red text-[11px] font-semibold"}>
          {target} : 1 {ratio == null ? "" : meets ? "▲" : "▼"}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{targetText}</div>
    </div>
  );
}

/** A ratio/percent headline with its numerator/denominator legs (ROE, D-E, OpEx). */
function MetricRatioCard({
  title,
  icon: Icon,
  big,
  sub,
  legs,
}: {
  title: string;
  icon: import("lucide-react").LucideIcon;
  big: string;
  sub?: string;
  legs: { label: string; value: string }[];
}) {
  return (
    <WidgetCard title={title} icon={Icon}>
      <div className="flex flex-col h-full justify-between gap-3 py-1">
        <div>
          <div className="text-2xl font-bold text-navy leading-none">{big}</div>
          {sub && <div className="text-[11px] text-muted-foreground mt-1.5">{sub}</div>}
        </div>
        <div className="space-y-1 text-[11px] border-t border-border/50 pt-2">
          {legs.map((l) => (
            <div key={l.label} className="flex justify-between gap-2">
              <span className="text-muted-foreground truncate">{l.label}</span>
              <span className="font-medium text-foreground">{l.value}</span>
            </div>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
}

function FundsBars({ bank, cash, loans }: { bank: number; cash: number; loans: number }) {
  const rows = [
    { label: "Bank Amount", value: bank, color: "hsl(180,55%,45%)" },
    { label: "Cash-in-Hand", value: cash, color: "hsl(142,60%,42%)" },
    { label: "Loans", value: loans, color: "hsl(0,74%,58%)" },
  ];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="flex flex-col justify-center h-full gap-3 py-2">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-semibold text-foreground">{fmtINRMoney(r.value)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PartyTable({ rows, label, amountHeader }: { rows: { name: string; amount: number }[]; label: string; amountHeader: string }) {
  const grand = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return (
    <MiniTable
      columns={[
        { key: "n", header: label, render: (r: { name: string }) => <span className="truncate block max-w-[200px]" title={r.name}>{r.name}</span> },
        { key: "a", header: amountHeader, align: "right", render: (r: { amount: number }) => fmtINRMoney(r.amount) },
        { key: "p", header: "Involvement (in %)", align: "right", render: (r: { amount: number }) => `${((r.amount / grand) * 100).toFixed(2)}`, className: "text-muted-foreground" },
      ]}
      rows={rows}
      rowKey={(r) => r.name}
      maxRows={10}
    />
  );
}

function StockMoveCard({ title, rows, loading, error, noQty }: { title: string; rows: { item: string; group: string; qty: number; movement: number; baseUnit: string }[]; loading?: boolean; error?: string | null; noQty?: boolean }) {
  return (
    <WidgetCard title={title} icon={Boxes} loading={loading} error={error} empty={!loading && rows.length === 0} emptyMessage="No items">
      <MiniTable
        columns={[
          { key: "i", header: "Name", render: (r: { item: string }) => <span className="truncate block max-w-[130px]" title={r.item}>{r.item}</span> },
          { key: "g", header: "Group", render: (r: { group: string }) => <span className="truncate block max-w-[110px] text-muted-foreground" title={r.group}>{r.group}</span> },
          ...(noQty
            ? []
            : [{ key: "q", header: "Quantity", align: "right" as const, render: (r: { movement: number }) => Math.abs(r.movement).toLocaleString("en-IN") }]),
          ...(noQty
            ? []
            : [{ key: "u", header: "Base Unit", align: "right" as const, render: (r: { baseUnit: string }) => <span className="text-muted-foreground">{r.baseUnit}</span> }]),
        ]}
        rows={rows}
        rowKey={(r, i) => `${r.item}-${i}`}
      />
    </WidgetCard>
  );
}

function DutiesCard({ rows, loading, error }: { rows: { taxName: string; receivable: number; payable: number }[]; loading?: boolean; error?: string | null }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => rows.filter((r) => matchesSearch(q, r.taxName)), [rows, q]);
  const pg = usePagination(filtered, { pageSize: 10, resetKey: q });
  return (
    <WidgetCard
      title="Duties And Taxes"
      icon={Receipt}
      loading={loading}
      error={error}
      actions={
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-7 pl-7 w-32 text-xs rounded-input" />
        </div>
      }
    >
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/70 text-muted-foreground">
            <th className="py-1 text-left text-[11px] uppercase tracking-wide">Tax Name</th>
            <th className="py-1 text-right text-[11px] uppercase tracking-wide">Receivables</th>
            <th className="py-1 text-right text-[11px] uppercase tracking-wide">Payables</th>
          </tr>
        </thead>
        <tbody>
          {pg.pageItems.map((r, i) => (
            <tr key={`${r.taxName}-${i}`} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
              <td className="py-1 truncate max-w-[220px]" title={r.taxName}>{r.taxName}</td>
              <td className="py-1 text-right tabular-nums">{r.receivable ? fmtINRMoney(r.receivable) : "₹ 0"}</td>
              <td className="py-1 text-right tabular-nums">{r.payable ? fmtINRMoney(r.payable) : "₹ 0"}</td>
            </tr>
          ))}
          {pg.pageItems.length === 0 && (
            <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">No matching taxes</td></tr>
          )}
        </tbody>
      </table>
      <div className="mt-2">
        <Pagination state={pg} rowsLabel="taxes" showPageSize={false} />
      </div>
    </WidgetCard>
  );
}
