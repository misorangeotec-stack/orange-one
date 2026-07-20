/**
 * Ledger Vouchers → one ledger's statement, laid out like Tally: the ledger name and "Ledger
 * Vouchers" top-left, the period top-right, then Date · Particulars · Vch Type · Vch No · Debit ·
 * Credit · running Balance, with an Opening Balance row on top and a Closing Balance at the bottom.
 *
 * Data is the ConnectWave RPC `ledger_txn_by_id` (see lib/ledgerVouchers). Amounts are Dr-positive,
 * so the running balance folds from the ledger's opening (v_ledger_detail) and lands on its closing.
 *
 * Period: all history by default; a From/To filter narrows it, and the Opening row then folds in
 * everything BEFORE the window (Tally-exact) so the running balance still reconciles inside it. On
 * FY-split books the mirror can have opening + Σtxn ≠ master closing; when that happens (and no period
 * is set) we surface the gap rather than hide it.
 *
 * Live (Tally) only — the default pipeline has no voucher-level data (a "Not applicable" panel).
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Lock, RotateCcw, ScrollText } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@hub/components/ui/pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { fmtAmount } from "@hub/components/StatementTree";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { useReceivablesSource } from "@hub/lib/sourceContext";
import { formatDateDMY } from "@hub/lib/utils";
import { companyGuidOfLedger, loadLedgerMeta, tenantOfLedger } from "@hub/lib/ledgerOutstanding";
import { loadLedgerVouchers, type LedgerVoucherRow } from "@hub/lib/ledgerVouchers";
import { exportLedgerVouchersXlsx } from "@hub/lib/exportFinancialStatements";

const BASE = "/outstanding-dashboard";
const PAGE_SIZE = 25;

/** yyyymmdd → dd-mm-yyyy for display. Blank on a bad/absent date. */
function tallyDate(yyyymmdd: string | null): string {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return "";
  return formatDateDMY(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`);
}
/** yyyy-mm-dd (date input) → yyyymmdd, for comparing against the rows' vch_date. "" stays "". */
function toYmd(iso: string): string {
  return iso ? iso.replace(/-/g, "") : "";
}
/** Dr-positive amount with a Dr/Cr suffix, blank at zero (Tally leaves the cell empty). */
function drcr(n: number): string {
  if (Math.abs(n) < 0.5) return "";
  return `${fmtAmount(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;
}

function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, current - 1);
  const hi = Math.min(total - 1, current + 1);
  if (lo > 2) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < total - 1) out.push("…");
  out.push(total);
  return out;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>
        {value || "—"}
      </div>
    </div>
  );
}

export default function LedgerVoucherStatement() {
  const { ledgerId = "" } = useParams();
  const source = useReceivablesSource();
  const live = source === "connectwave";

  const [from, setFrom] = useState(""); // yyyy-mm-dd
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const tenantId = tenantOfLedger(ledgerId);
  const companyGuid = companyGuidOfLedger(ledgerId);

  const { companies } = useFinancialStatements();
  const company = companies.find((c) => c.companyGuid === companyGuid);

  const { data: meta } = useQuery({
    queryKey: ["ledgerMeta", tenantId, ledgerId],
    queryFn: () => loadLedgerMeta(tenantId, ledgerId),
    enabled: live,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vouchers, isLoading, error } = useQuery<LedgerVoucherRow[]>({
    queryKey: ["ledgerVouchers", tenantId, ledgerId],
    queryFn: () => loadLedgerVouchers(tenantId, ledgerId),
    enabled: live,
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo(() => vouchers ?? [], [vouchers]);
  const opening = meta?.opening ?? 0;
  const fromYmd = toYmd(from);
  const toYmdVal = toYmd(to);
  const hasPeriod = !!(fromYmd || toYmdVal);

  // Opening as of the window start = master opening + everything strictly BEFORE `from`.
  const openingAsOf = useMemo(() => {
    if (!fromYmd) return opening;
    let acc = opening;
    for (const r of rows) if ((r.date ?? "") < fromYmd) acc += r.amount;
    return acc;
  }, [rows, opening, fromYmd]);

  // Rows inside the window, with a running balance folded from openingAsOf. Computed over the FULL
  // set first so the balance is correct on every page; the page then slices this.
  const withBalance = useMemo(() => {
    let bal = openingAsOf;
    const out: { row: LedgerVoucherRow; balance: number }[] = [];
    for (const r of rows) {
      const d = r.date ?? "";
      if (fromYmd && d < fromYmd) continue;
      if (toYmdVal && d > toYmdVal) continue;
      bal += r.amount;
      out.push({ row: r, balance: bal });
    }
    return out;
  }, [rows, openingAsOf, fromYmd, toYmdVal]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const { row } of withBalance) {
      if (row.amount > 0) debit += row.amount;
      else credit += -row.amount;
    }
    return { debit, credit };
  }, [withBalance]);

  const closingComputed = withBalance.length ? withBalance[withBalance.length - 1].balance : openingAsOf;
  const masterClosing = meta?.closing ?? 0;
  // Only meaningful with no period set (a windowed closing legitimately differs from the master).
  const closingGap = !hasPeriod ? closingComputed - masterClosing : 0;
  const showGap = Math.abs(closingGap) > 1;

  const totalPages = Math.max(1, Math.ceil(withBalance.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const startIdx = (current - 1) * PAGE_SIZE;
  const paged = withBalance.slice(startIdx, startIdx + PAGE_SIZE);
  // Balance carried INTO the first row on this page (Tally's "brought forward").
  const broughtForward = startIdx === 0 ? openingAsOf : withBalance[startIdx - 1].balance;
  const isLastPage = current === totalPages;

  const periodLabel = hasPeriod
    ? `${fromYmd ? tallyDate(fromYmd) : "start"} to ${toYmdVal ? tallyDate(toYmdVal) : "today"}`
    : company
    ? `${formatDateDMY(company.fromDate)} to ${formatDateDMY(company.asOf)}`
    : "All history";

  const ledgerName = meta?.ledger ?? "Ledger";
  const resetPeriod = () => { setFrom(""); setTo(""); setPage(1); };

  // Live (Tally) only.
  if (!live) {
    return (
      <div className="p-6 max-w-[900px] mx-auto space-y-4">
        <Link to={`${BASE}/reports?cat=tally`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Tally Reports
        </Link>
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-primary" /> Ledger Vouchers
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              This report reads each ledger's live Tally vouchers, so it is only available on the{" "}
              <strong>Live (Tally)</strong> view. Switch on <strong>Live (Tally)</strong> in the top bar to use it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <Link
          to={`${BASE}/reports/ledger-voucher`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
        >
          <ArrowLeft className="h-3 w-3" /> Ledger Vouchers
        </Link>

        {/* Tally's header band: ledger + "Ledger Vouchers" left, period + From/To right. */}
        <div className="rounded-xl border border-border bg-gradient-to-br from-card to-muted/30 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <ScrollText className="h-5 w-5 text-primary" />
                </span>
                <span className="truncate">{ledgerName}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1 ml-11">Ledger Vouchers</p>
              {company && (
                <p className="text-xs text-muted-foreground mt-0.5 ml-11">
                  {companyLabel(company)} · {company.rawName}
                </p>
              )}
            </div>
            <div className="text-sm text-muted-foreground sm:text-right space-y-1.5 shrink-0">
              <div className="font-medium text-foreground/80">{periodLabel}</div>
              <div className="flex items-center gap-2 sm:justify-end">
                <label className="inline-flex items-center gap-1.5 text-xs">
                  <span className="uppercase tracking-wide font-semibold">From</span>
                  <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-8 w-36 text-xs rounded-input" />
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs">
                  <span className="uppercase tracking-wide font-semibold">To</span>
                  <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-8 w-36 text-xs rounded-input" />
                </label>
                {hasPeriod && (
                  <Button variant="outline" onClick={resetPeriod} className="h-8 gap-1 rounded-button text-xs">
                    <RotateCcw className="h-3.5 w-3.5" /> All
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          {/* Stat strip — over the whole window. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Opening" value={drcr(openingAsOf)} />
            <StatCard label="Total Debit" value={fmtAmount(totals.debit)} />
            <StatCard label="Total Credit" value={fmtAmount(totals.credit)} />
            <StatCard label="Closing" value={drcr(closingComputed)} />
          </div>

          {showGap && (
            <p className="text-[11px] text-amber-700">
              Note: the running closing differs from this ledger's master closing ({drcr(masterClosing)}) by{" "}
              {drcr(closingGap)} — a known FY-split mirror inconsistency (opening + vouchers ≠ closing).
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {withBalance.length.toLocaleString("en-IN")} voucher{withBalance.length === 1 ? "" : "s"}
              {hasPeriod && rows.length !== withBalance.length && (
                <span className="opacity-70"> (of {rows.length.toLocaleString("en-IN")} total)</span>
              )}
            </div>
            <Button
              onClick={() => exportLedgerVouchersXlsx({
                ledgerName, company, periodLabel, opening: openingAsOf, closing: closingComputed, rows: withBalance,
              })}
              disabled={withBalance.length === 0}
              className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[70vh]">
            <table className="w-full border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b-2 border-border bg-muted/50">
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Particulars</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vch Type</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vch No</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Debit</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Credit</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening / brought-forward line at the top of every page. */}
                <tr className="border-b border-border/60 bg-muted/30 font-medium">
                  <td className="py-1.5 px-3 text-sm" colSpan={4}>
                    {startIdx === 0 ? "Opening Balance" : "Balance brought forward"}
                  </td>
                  <td colSpan={2} />
                  <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">{drcr(broughtForward)}</td>
                </tr>

                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      No vouchers{hasPeriod ? " in this period" : ""}.
                    </td>
                  </tr>
                ) : (
                  paged.map(({ row, balance }, idx) => (
                    <tr key={`${row.guid || "n"}-${startIdx + idx}`} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{tallyDate(row.date)}</td>
                      <td className="py-1.5 px-3 text-sm">{row.particulars ?? "—"}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{row.voucherType ?? "—"}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{row.voucherNo ?? "—"}</td>
                      <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">
                        {row.amount > 0.5 ? fmtAmount(row.amount) : ""}
                      </td>
                      <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">
                        {row.amount < -0.5 ? fmtAmount(-row.amount) : ""}
                      </td>
                      <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">{drcr(balance)}</td>
                    </tr>
                  ))
                )}

                {/* Current Total + Closing, on the last page only. */}
                {isLastPage && withBalance.length > 0 && (
                  <>
                    <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                      <td className="py-2 px-3 text-sm" colSpan={4}>Current Total</td>
                      <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap">{fmtAmount(totals.debit)}</td>
                      <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap">{fmtAmount(totals.credit)}</td>
                      <td />
                    </tr>
                    <tr className="bg-muted/60 font-bold">
                      <td className="py-2 px-3 text-sm" colSpan={6}>Closing Balance</td>
                      <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap">{drcr(closingComputed)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </ScrollableTable>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={current === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {pageWindow(current, totalPages).map((p, i) => (
                  <PaginationItem key={i}>
                    {p === "…" ? (
                      <span className="px-2 text-muted-foreground">…</span>
                    ) : (
                      <PaginationLink isActive={p === current} onClick={() => setPage(p)} className="cursor-pointer">
                        {p}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={current === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}
    </div>
  );
}
