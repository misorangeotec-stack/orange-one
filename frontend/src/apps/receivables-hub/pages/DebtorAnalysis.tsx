/**
 * DebtorAnalysis.tsx — the per-customer Debtor Analysis Dashboard.
 *
 * A one-page debtor report, reproducing the sheet finance used to assemble by hand for one
 * customer at a time: two six-chip bands, a fiscal-quarter rollup, a month-by-month table and
 * an action note saying what must be collected to come back inside the credit limit.
 *
 * Mounted from /customer/:id/analysis and /group/:id/analysis — siblings of the Customer Detail
 * routes, not children (CustomerDetail is not a layout and renders no Outlet). They sit outside
 * the report guards for the same reason their parents do: this is a customer page, not a
 * catalogued report, and RequireReportAccess fails closed on anything not in the catalogue.
 *
 * All the arithmetic lives in lib/debtorAnalysis.ts, and the PDF and workbook exports render the
 * SAME report object this page does — so a figure on screen, in the document and in the
 * spreadsheet cannot be three different numbers.
 *
 * Per-salesperson scoping comes for free: the data arrives through useAppData, whose chokepoints
 * drop any ledger outside the reader's grant, so an out-of-scope name resolves to null and lands
 * on the not-found panel rather than rendering someone else's customer.
 */
import { useMemo, useState } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, FileBarChart2, FileSpreadsheet, Loader2, ShieldAlert, Info } from "lucide-react";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/components/ui/table";
import { SALE_TYPE_OPTIONS } from "@hub/components/SaleTypeMultiSelect";
import { useHubBase, useReceivablesSource } from "@hub/lib/sourceContext";
import { useToast } from "@hub/hooks/use-toast";
import { useDebtorLedgerData } from "@hub/lib/useDebtorLedgerData";
import {
  buildDebtorAnalysis, settlementLagCollectionDays, noCollectionDays,
  fmtLakhsCell, fmtCollDays,
  type DebtorAnalysisReport, type DebtorChip, type DebtorMonthRow, type DebtorQuarterRow,
} from "@hub/lib/debtorAnalysis";

/** Same canonicalisation Customer Detail applies: every type checked means no filter. */
function normalizeSaleType(value: string): string {
  if (value === "all") return "all";
  const list = value.split(",").map((t) => t.trim()).filter(Boolean);
  if (list.length === 0) return "all";
  const selected = new Set(list);
  return SALE_TYPE_OPTIONS.every((o) => selected.has(o.value)) ? "all" : list.join(",");
}

/* ── Chips ─────────────────────────────────────────────── */

function ChipBand({ title, chips }: { title: string; chips: DebtorChip[] }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-sm bg-primary" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">{title}</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {chips.map((c) => (
          <Card key={c.label} className="rounded-card border-border bg-surface">
            <CardContent className="px-3 py-2">
              <div className="text-[11px] text-muted-foreground truncate" title={c.label}>{c.label}</div>
              <div className={`text-sm font-bold tabular-nums ${
                c.unavailable ? "text-muted-foreground" : c.alarm ? "text-destructive" : "text-foreground"
              }`}>
                {c.value}
              </div>
              {c.sub && (
                <div className={`text-[10px] ${c.alarm ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {c.sub}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ── Tables ────────────────────────────────────────────── */

const numCell = "text-right font-mono text-xs tabular-nums whitespace-nowrap";
const headCell = "text-xs font-semibold text-foreground/70 text-right whitespace-nowrap";

function QuarterTable({ report }: { report: DebtorAnalysisReport }) {
  if (report.quarters.length === 0) {
    return (
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Not enough history — no complete quarter has closed in this period yet.
        </CardContent>
      </Card>
    );
  }
  const row = (q: DebtorQuarterRow, kind: "normal" | "partial" | "total") => (
    <TableRow
      key={q.key}
      className={
        kind === "total"   ? "bg-muted/60 font-semibold border-t-2 border-border"
        : kind === "partial" ? "bg-muted/25 text-muted-foreground"
        : "hover:bg-muted/20 transition-colors"
      }
    >
      <TableCell className="text-xs font-medium whitespace-nowrap">
        {q.label}
        {q.span && <span className="ml-1.5 text-[10px] text-muted-foreground">({q.span})</span>}
        {kind === "partial" && <span className="ml-1.5 text-[10px]">(Partial)</span>}
      </TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(q.sales)}</TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(q.receipts)}</TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(q.creditNotes)}</TableCell>
      <TableCell className={`${numCell} ${q.chequeReturns > 0 ? "text-destructive" : ""}`}>
        {fmtLakhsCell(q.chequeReturns)}
      </TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(q.avgOutstanding)}</TableCell>
      <TableCell className={`${numCell} ${(q.avgOverdue ?? 0) > 0 ? "text-destructive" : ""}`}>
        {fmtLakhsCell(q.avgOverdue)}
      </TableCell>
      <TableCell className={numCell}>{fmtCollDays(q.avgCollDays)}</TableCell>
    </TableRow>
  );
  return (
    <ScrollableTable>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="text-xs font-semibold text-foreground/70">Quarter</TableHead>
            <TableHead className={headCell}>Sales</TableHead>
            <TableHead className={headCell}>Receipts</TableHead>
            <TableHead className={headCell}>Cr Notes</TableHead>
            <TableHead className={headCell}>Chq Returns</TableHead>
            <TableHead className={headCell}>Avg O/S</TableHead>
            <TableHead className={headCell}>Avg OD</TableHead>
            <TableHead className={headCell}>Avg Coll Days</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.quarters.map((q) => row(q, q.partial ? "partial" : "normal"))}
          {report.quartersTotal && row(report.quartersTotal, "total")}
        </TableBody>
      </Table>
    </ScrollableTable>
  );
}

function MonthTable({ report }: { report: DebtorAnalysisReport }) {
  const row = (m: DebtorMonthRow, kind: "normal" | "partial" | "summary") => (
    <TableRow
      key={m.month}
      className={
        kind === "summary" ? "bg-muted/60 font-semibold border-t-2 border-border"
        : kind === "partial" ? "bg-primary/5"
        : "hover:bg-muted/20 transition-colors"
      }
    >
      <TableCell className="text-xs font-medium whitespace-nowrap">
        {m.month}
        {m.imputed && (
          <span className="ml-1.5 text-[10px] text-muted-foreground" title="No activity reported for this month">
            (no data)
          </span>
        )}
      </TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(m.sales)}</TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(m.receipts)}</TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(m.creditNotes)}</TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(m.debitNotes)}</TableCell>
      <TableCell className={`${numCell} ${m.chequeReturns > 0 ? "text-destructive" : ""}`}>
        {fmtLakhsCell(m.chequeReturns)}
      </TableCell>
      <TableCell className={numCell}>{fmtLakhsCell(m.outstanding)}</TableCell>
      <TableCell className={`${numCell} ${m.overdue > 0 ? "text-destructive" : ""}`}>
        {fmtLakhsCell(m.overdue)}
      </TableCell>
      <TableCell className={numCell}>{fmtCollDays(m.avgCollDays)}</TableCell>
    </TableRow>
  );
  return (
    <ScrollableTable>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="text-xs font-semibold text-foreground/70">Month</TableHead>
            <TableHead className={headCell}>Sales</TableHead>
            <TableHead className={headCell}>Receipts</TableHead>
            <TableHead className={headCell}>Cr Notes</TableHead>
            <TableHead className={headCell}>Dr Notes</TableHead>
            <TableHead className={headCell}>Chq Returns</TableHead>
            <TableHead className={headCell}>Outstanding</TableHead>
            <TableHead className={headCell}>Overdue</TableHead>
            <TableHead className={headCell}>Avg Coll Days</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.months.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                No monthly data available for this customer in the selected period.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {report.months.map((m) => row(m, m.partial ? "partial" : "normal"))}
              {row(report.monthsSummary, "summary")}
            </>
          )}
        </TableBody>
      </Table>
    </ScrollableTable>
  );
}

/* ── Page ──────────────────────────────────────────────── */

export default function DebtorAnalysis() {
  const { id: nameEncoded } = useParams<{ id: string }>();
  const decoded = decodeURIComponent(nameEncoded ?? "");
  const location = useLocation();
  // Base-agnostic, and still true for "/group/:id/analysis" — the same derivation Customer
  // Detail uses, so the two pages cannot disagree about what kind of thing they are showing.
  const isGroupRoute = location.pathname.includes("/group/");
  const navigate = useNavigate();
  const hubBase = useHubBase();
  const rebase = (p: string) => p.replace(/^\/outstanding-dashboard/, hubBase);
  const source = useReceivablesSource();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  // Carried through from Customer Detail so arriving from a narrowed view does not silently
  // change the basis of the figures.
  const entityCompany = searchParams.get("company") ?? "all";
  const entityLocation = searchParams.get("location") ?? "all";
  // Forced off on Live for the same reason Customer Detail forces it: the mirror cannot tag a
  // receipt or credit note with the sale type of a bill that is now closed.
  const saleTypeFilterAvailable = source !== "connectwave";
  const effectiveSaleType = saleTypeFilterAvailable
    ? normalizeSaleType(searchParams.get("saleType") ?? "all")
    : "all";

  // No child-selection control here — this report is always the whole group. `selectedChildren`
  // is left unset, which the hook reads as "every child", so the figures match the group card on
  // the Risk Register rather than some subset a reader never chose.
  const data = useDebtorLedgerData({
    name: decoded, isGroupRoute, entityCompany, entityLocation, effectiveSaleType,
  });

  const report = useMemo<DebtorAnalysisReport | null>(() => {
    if (!data.customer) return null;
    return buildDebtorAnalysis({
      title: decoded,
      customer: data.customer,
      overdueNet: data.overdueNet,
      trend: data.trend,
      vouchers: data.vouchers,
      billMeta: data.billMeta,
      invoices: data.invoices,
      asOfDate: data.asOfDate ?? "",
      fySuffix: data.fySuffix,
      scope: {
        company: entityCompany,
        location: entityLocation,
        source: source === "connectwave" ? "Live (Tally)" : "System Report",
        fyLabel: data.fyLabel,
      },
      // The lag needs dated receipt allocations. Until the Live voucher fetch lands, every
      // cell would read zero days — worse than admitting we do not know yet.
      collectionDays: data.vouchersReady ? settlementLagCollectionDays : noCollectionDays,
    });
  }, [data, decoded, entityCompany, entityLocation, source]);

  const backTo = () => {
    const seg = isGroupRoute ? "group" : "customer";
    navigate(rebase(
      `/outstanding-dashboard/${seg}/${encodeURIComponent(decoded)}${location.search}`,
    ));
  };

  const runExport = async (kind: "pdf" | "xlsx") => {
    if (!report || exporting) return;
    setExporting(kind);
    try {
      if (kind === "pdf") {
        const { exportDebtorAnalysisPdf } = await import("@hub/lib/exportDebtorAnalysisPdf");
        await exportDebtorAnalysisPdf(report);
      } else {
        const { exportDebtorAnalysisXlsx } = await import("@hub/lib/exportDebtorAnalysisXlsx");
        await exportDebtorAnalysisXlsx(report);
      }
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Could not build the file.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  if (data.loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.error || !report) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px] gap-3">
        <p className="text-sm text-muted-foreground">
          {data.error ?? `No customer named "${decoded}" is available to you.`}
        </p>
        <Button variant="outline" size="sm" onClick={backTo}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
      </div>
    );
  }

  const recon = report.reconciliation;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={backTo} className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Customer
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-button bg-primary/15 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">{decoded}</h1>
                {isGroupRoute && (
                  <Badge variant="outline" className="text-[10px]">
                    Group · {data.groupChildNames.length} customers
                  </Badge>
                )}
                {data.customer?.blocked && (
                  <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                    Red Mark
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Debtor Analysis Dashboard</p>
            </div>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Button
            variant="outline" size="sm" onClick={() => runExport("xlsx")}
            disabled={exporting !== null} className="rounded-button border-border"
          >
            {exporting === "xlsx"
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            Excel
          </Button>
          <Button
            variant="outline" size="sm" onClick={() => runExport("pdf")}
            disabled={exporting !== null} className="rounded-button border-border"
          >
            {exporting === "pdf"
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <FileBarChart2 className="h-4 w-4 mr-2" />}
            PDF
          </Button>
        </div>
      </div>

      {/* Title band — the artefact's own navy bar, so the screen reads like the document */}
      <div className="rounded-card overflow-hidden border border-border">
        <div className="bg-navy px-4 py-3 text-center">
          <h2 className="text-base font-bold tracking-wide text-white uppercase">{report.title}</h2>
        </div>
        <div className="bg-surface px-4 py-2 text-center text-[11px] text-muted-foreground">
          {report.subline}
        </div>
      </div>

      <ChipBand title={`Account Status (as at ${report.asOfMonth || "—"})`} chips={report.bands.accountStatus} />
      <ChipBand title={`Period Summary (${report.periodLabel})`} chips={report.bands.periodSummary} />

      {/* Quarterly */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="h-4 w-1 rounded-sm bg-primary self-center" aria-hidden />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Quarterly Summary</h2>
          <span className="text-[10px] text-muted-foreground">
            Flows are the sum of the months below · Avg O/S and Avg OD are the average of month-end
            closing balances · Avg Coll Days is computed over the whole quarter, not averaged from the months
          </span>
        </div>
        <QuarterTable report={report} />
      </section>

      {/* Monthly */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="h-4 w-1 rounded-sm bg-primary self-center" aria-hidden />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">Monthly Analysis</h2>
          <span className="text-[10px] text-muted-foreground">
            Summary row: flows are totals, Outstanding and Overdue are the closing position
          </span>
        </div>
        <MonthTable report={report} />
      </section>

      {/* Reconciliation, caveats, action */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/70 mb-1">
              Action Required
            </h3>
            {report.note.lines.map((l, i) => (
              <p key={i} className="text-sm text-foreground leading-relaxed">{l}</p>
            ))}
          </div>

          <div className="border-t border-border pt-3">
            <p className={`text-xs ${recon.ok ? "text-muted-foreground" : "text-destructive"}`}>
              <span className="font-medium">Reconciliation:</span>{" "}
              opening {fmtLakhsCell(recon.openingBalance)} plus net movement{" "}
              {fmtLakhsCell(recon.netMovement)} gives {fmtLakhsCell(recon.expectedClosing)} against a
              closing balance of {fmtLakhsCell(recon.actualClosing)}
              {Math.abs(recon.residual) >= 0.005 && <> (difference {fmtLakhsCell(recon.residual)})</>}.
            </p>
          </div>

          {report.caveats.length > 0 && (
            <div className="border-t border-border pt-3 space-y-1">
              {report.caveats.map((c, i) => (
                <p key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>{c}</span>
                </p>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground border-t border-border pt-3">
            Month-end Outstanding and Overdue for past months are the ledger's own monthly
            closing figures and are approximate; only {report.asOfMonth || "the latest month"} is
            anchored to the live balance. Averages built on them inherit that.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
