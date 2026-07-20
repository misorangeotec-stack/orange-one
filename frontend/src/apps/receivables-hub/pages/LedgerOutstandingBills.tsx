/**
 * Ledger Outstandings → Pending Bills — one ledger, laid out like Tally: the ledger name and
 * "Details of: Pending Bills" top-left, the period top-right, then Date · Ref No. · Opening Amount ·
 * Pending Amount · Due on · Overdue by days, and a Grand Total.
 *
 * Data is the Tally-exact RPC (see lib/ledgerOutstanding + bill_outstanding_tally_by_id.sql). Overdue
 * is relative to the "As on" date — default today; set it to a book's far date to reproduce a Tally
 * run taken then (e.g. 31-Mar-27 gives the screenshot's 390-day figures).
 *
 * On top of Tally's static print this screen adds: a default oldest→newest sort (any column is
 * sortable), and a per-column filter row — date-range on the two date columns, text on Ref No., and
 * numeric min/max on the three amount/overdue columns. The Grand Total and the stat strip always foot
 * the *currently shown* (filtered) rows. The On Account plug row bypasses every filter and stays
 * pinned to the bottom, so the total always ties back to the ledger.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Download, Filter, ReceiptText, RotateCcw,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { fmtAmount } from "@hub/components/StatementTree";
import { companyLabel } from "@hub/components/TallyReportFrame";
import { useFinancialStatements } from "@hub/lib/useFinancialStatements";
import { formatDateDMY } from "@hub/lib/utils";
import {
  billTotals,
  companyGuidOfLedger,
  loadLedgerBills,
  loadLedgerMeta,
  tenantOfLedger,
  type LedgerBillRow,
} from "@hub/lib/ledgerOutstanding";
import { exportLedgerOutstandingXlsx } from "@hub/lib/exportFinancialStatements";

/** yyyymmdd → dd-mm-yyyy (formatDateDMY wants dashes). Blank for the On Account row. */
function tallyDate(yyyymmdd: string | null): string {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return "";
  return formatDateDMY(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`);
}
/** yyyymmdd → yyyy-mm-dd, for comparing against the date-range inputs. */
function isoOf(yyyymmdd: string | null): string | null {
  if (!yyyymmdd || !/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Dr-positive amount with a Dr/Cr suffix, blank at zero (Tally leaves the cell empty). */
function drcr(n: number): string {
  if (Math.abs(n) < 0.5) return "";
  return `${fmtAmount(Math.abs(n))} ${n >= 0 ? "Dr" : "Cr"}`;
}

function overdueClass(days: number | null): string {
  if (days === null || days <= 0) return "text-muted-foreground";
  if (days > 90) return "text-destructive font-semibold";
  return "text-primary font-medium";
}

const todayIso = () => new Date().toISOString().slice(0, 10);

type SortKey = "date" | "ref" | "opening" | "pending" | "due" | "overdue";
const COLS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "date", label: "Date", align: "left" },
  { key: "ref", label: "Ref No.", align: "left" },
  { key: "opening", label: "Opening Amount", align: "right" },
  { key: "pending", label: "Pending Amount", align: "right" },
  { key: "due", label: "Due on", align: "left" },
  { key: "overdue", label: "Overdue by days", align: "right" },
];

/** A number is inside [min,max] — empty bound = open. Blank inputs never filter. */
function numInRange(v: number, min: string, max: string): boolean {
  if (min.trim() !== "" && v < Number(min)) return false;
  if (max.trim() !== "" && v > Number(max)) return false;
  return true;
}
/** yyyymmdd against a yyyy-mm-dd range. A dated bill outside the range fails; a dateless bill fails
 *  once any bound is set. (The On Account plug never reaches here — it bypasses all filters.) */
function dateInRange(yyyymmdd: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  const iso = isoOf(yyyymmdd);
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

/** A header cell that sorts on click and shows the active direction. */
function SortHeader({
  col, sortKey, sortDir, onSort,
}: {
  col: (typeof COLS)[number];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col.key;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={`py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${col.align === "right" ? "flex-row-reverse" : ""} ${active ? "text-foreground" : ""}`}
      >
        {col.label}
        <Icon className={`h-3 w-3 ${active ? "text-primary" : "opacity-40"}`} />
      </button>
    </th>
  );
}

/** A small filter control that lives under a header. Highlights when active. */
function ColumnFilter({ active, wide, children }: { active: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
            active
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
        >
          <Filter className="h-2.5 w-2.5" />
          {active ? "Filtered" : "Filter"}
        </button>
      </PopoverTrigger>
      <PopoverContent className={`${wide ? "w-56" : "w-44"} p-3 space-y-2`} align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>
        {value || "—"}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function LedgerOutstandingBills() {
  const { ledgerId = "" } = useParams();
  const [asOn, setAsOn] = useState(todayIso);

  // Sort — default oldest → newest by bill date.
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  // Per-column filters.
  const [refQ, setRefQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [openMin, setOpenMin] = useState("");
  const [openMax, setOpenMax] = useState("");
  const [pendMin, setPendMin] = useState("");
  const [pendMax, setPendMax] = useState("");
  const [odMin, setOdMin] = useState("");
  const [odMax, setOdMax] = useState("");

  const tenantId = tenantOfLedger(ledgerId);
  const companyGuid = companyGuidOfLedger(ledgerId);

  const { companies } = useFinancialStatements();
  const company = companies.find((c) => c.companyGuid === companyGuid);

  const { data: meta } = useQuery({
    queryKey: ["ledgerMeta", tenantId, ledgerId],
    queryFn: () => loadLedgerMeta(tenantId, ledgerId),
    staleTime: 5 * 60 * 1000,
  });

  const { data: bills, isLoading, error } = useQuery<LedgerBillRow[]>({
    queryKey: ["ledgerBills", tenantId, ledgerId, asOn],
    queryFn: () => loadLedgerBills(tenantId, ledgerId, asOn),
    staleTime: 5 * 60 * 1000,
  });

  const rows = bills ?? [];

  const dateActive = !!(dateFrom || dateTo);
  const dueActive = !!(dueFrom || dueTo);
  const openActive = !!(openMin || openMax);
  const pendActive = !!(pendMin || pendMax);
  const odActive = !!(odMin || odMax);
  const refActive = refQ.trim() !== "";
  const anyFilter = dateActive || dueActive || openActive || pendActive || odActive || refActive;

  const filtered = useMemo(() => {
    const q = refQ.trim().toLowerCase();
    return rows.filter((b) => {
      // The On Account plug (net advances / unallocated) has no date, ref or overdue of its own; keep
      // it visible under every filter so the Grand Total always ties back to the ledger.
      if (b.isOnAccount) return true;
      if (q && !(b.billRef ?? "").toLowerCase().includes(q)) return false;
      if (dateActive && !dateInRange(b.billDate, dateFrom, dateTo)) return false;
      if (dueActive && !dateInRange(b.dueDate, dueFrom, dueTo)) return false;
      if (openActive && !numInRange(b.openingAmount, openMin, openMax)) return false;
      if (pendActive && !numInRange(b.pendingAmount, pendMin, pendMax)) return false;
      if (odActive && !numInRange(b.overdueDays ?? 0, odMin, odMax)) return false;
      return true;
    });
  }, [rows, refQ, dateActive, dateFrom, dateTo, dueActive, dueFrom, dueTo,
      openActive, openMin, openMax, pendActive, pendMin, pendMax, odActive, odMin, odMax]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    const numCmp = (a: string | null, b: string | null) => (Number(a ?? 0) - Number(b ?? 0));
    arr.sort((a, b) => {
      // On Account (a dateless plug) always sinks to the bottom, whichever way we sort.
      if (a.isOnAccount !== b.isOnAccount) return a.isOnAccount ? 1 : -1;
      if (a.isOnAccount && b.isOnAccount) return 0;
      let cmp = 0;
      switch (sortKey) {
        case "date": cmp = numCmp(a.billDate, b.billDate); break;
        case "ref": cmp = (a.billRef ?? "").localeCompare(b.billRef ?? ""); break;
        case "opening": cmp = a.openingAmount - b.openingAmount; break;
        case "pending": cmp = a.pendingAmount - b.pendingAmount; break;
        case "due": cmp = numCmp(a.dueDate, b.dueDate); break;
        case "overdue": cmp = (a.overdueDays ?? 0) - (b.overdueDays ?? 0); break;
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => billTotals(sorted), [sorted]);
  const overdueCount = useMemo(() => sorted.filter((b) => (b.overdueDays ?? 0) > 0).length, [sorted]);
  const ledgerName = meta?.ledger ?? "Ledger";
  const periodLabel = company
    ? `${formatDateDMY(company.fromDate)} to ${formatDateDMY(company.asOf)}`
    : "";

  const resetFilters = () => {
    setRefQ(""); setDateFrom(""); setDateTo(""); setDueFrom(""); setDueTo("");
    setOpenMin(""); setOpenMax(""); setPendMin(""); setPendMax(""); setOdMin(""); setOdMax("");
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <Link
          to="/outstanding-dashboard/reports/ledger-outstanding"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
        >
          <ArrowLeft className="h-3 w-3" /> Ledger Outstandings
        </Link>

        {/* Tally's header band: ledger + "Details of: Pending Bills" left, period + As-on right. */}
        <div className="rounded-xl border border-border bg-gradient-to-br from-card to-muted/30 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <ReceiptText className="h-5 w-5 text-primary" />
                </span>
                <span className="truncate">{ledgerName}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1 ml-11">Details of: Pending Bills</p>
              {company && (
                <p className="text-xs text-muted-foreground mt-0.5 ml-11">
                  {companyLabel(company)} · {company.rawName}
                </p>
              )}
            </div>
            <div className="text-sm text-muted-foreground sm:text-right space-y-1.5 shrink-0">
              {periodLabel && <div className="font-medium text-foreground/80">{periodLabel}</div>}
              <label className="inline-flex items-center gap-2 text-xs">
                <span className="uppercase tracking-wide font-semibold">As on</span>
                <Input
                  type="date"
                  value={asOn}
                  onChange={(e) => setAsOn(e.target.value || todayIso())}
                  className="h-8 w-40 text-xs rounded-input"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">No pending bills for this ledger.</div>
      ) : (
        <>
          {/* Stat strip — always foots the currently shown (filtered) rows. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Opening" value={drcr(totals.opening)} />
            <StatCard label="Pending" value={drcr(totals.pending)} />
            <StatCard
              label="Bills"
              value={sorted.length.toLocaleString("en-IN")}
              sub={anyFilter ? `of ${rows.length.toLocaleString("en-IN")} total` : undefined}
            />
            <StatCard label="Overdue bills" value={overdueCount.toLocaleString("en-IN")} tone={overdueCount > 0 ? "danger" : undefined} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {anyFilter
                ? `Showing ${sorted.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} bills`
                : `${rows.length.toLocaleString("en-IN")} bill${rows.length === 1 ? "" : "s"}`}
              {" · sorted by "}
              {COLS.find((c) => c.key === sortKey)?.label.toLowerCase()}
              {sortDir === "asc" ? " (oldest → newest)" : " (newest → oldest)"}
            </div>
            <div className="flex items-center gap-2">
              {anyFilter && (
                <Button
                  variant="outline"
                  onClick={resetFilters}
                  className="h-9 gap-1.5 rounded-button text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Clear filters
                </Button>
              )}
              <Button
                onClick={() => exportLedgerOutstandingXlsx({ ledgerName, company, asOn, bills: sorted })}
                disabled={sorted.length === 0}
                className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Download className="h-4 w-4" /> Export
              </Button>
            </div>
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[70vh]">
            <table className="w-full border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {COLS.map((col) => (
                    <SortHeader key={col.key} col={col} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  ))}
                </tr>
                {/* Filter row — one control under each column, logical to the data it filters. */}
                <tr className="border-b-2 border-border bg-muted/30">
                  {/* Date — range */}
                  <td className="px-3 py-1.5">
                    <ColumnFilter active={dateActive} wide>
                      <div className="space-y-1">
                        <FieldLabel>From</FieldLabel>
                        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs rounded-input" />
                        <FieldLabel>To</FieldLabel>
                        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs rounded-input" />
                        {dateActive && (
                          <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="pt-1 text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
                        )}
                      </div>
                    </ColumnFilter>
                  </td>
                  {/* Ref No. — text */}
                  <td className="px-3 py-1.5">
                    <Input
                      value={refQ}
                      onChange={(e) => setRefQ(e.target.value)}
                      placeholder="Search ref…"
                      className={`h-7 text-xs rounded-input ${refActive ? "border-primary" : ""}`}
                    />
                  </td>
                  {/* Opening — numeric range */}
                  <td className="px-3 py-1.5 text-right">
                    <ColumnFilter active={openActive}>
                      <div className="space-y-1">
                        <FieldLabel>Min amount</FieldLabel>
                        <Input type="number" value={openMin} onChange={(e) => setOpenMin(e.target.value)} placeholder="e.g. 0" className="h-8 text-xs rounded-input" />
                        <FieldLabel>Max amount</FieldLabel>
                        <Input type="number" value={openMax} onChange={(e) => setOpenMax(e.target.value)} placeholder="e.g. 100000" className="h-8 text-xs rounded-input" />
                        <p className="text-[10px] text-muted-foreground leading-tight pt-0.5">Dr positive, Cr negative.</p>
                        {openActive && (
                          <button onClick={() => { setOpenMin(""); setOpenMax(""); }} className="text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
                        )}
                      </div>
                    </ColumnFilter>
                  </td>
                  {/* Pending — numeric range */}
                  <td className="px-3 py-1.5 text-right">
                    <ColumnFilter active={pendActive}>
                      <div className="space-y-1">
                        <FieldLabel>Min amount</FieldLabel>
                        <Input type="number" value={pendMin} onChange={(e) => setPendMin(e.target.value)} placeholder="e.g. 0" className="h-8 text-xs rounded-input" />
                        <FieldLabel>Max amount</FieldLabel>
                        <Input type="number" value={pendMax} onChange={(e) => setPendMax(e.target.value)} placeholder="e.g. 100000" className="h-8 text-xs rounded-input" />
                        <p className="text-[10px] text-muted-foreground leading-tight pt-0.5">Dr positive, Cr negative.</p>
                        {pendActive && (
                          <button onClick={() => { setPendMin(""); setPendMax(""); }} className="text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
                        )}
                      </div>
                    </ColumnFilter>
                  </td>
                  {/* Due on — range */}
                  <td className="px-3 py-1.5">
                    <ColumnFilter active={dueActive} wide>
                      <div className="space-y-1">
                        <FieldLabel>Due from</FieldLabel>
                        <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} className="h-8 text-xs rounded-input" />
                        <FieldLabel>Due to</FieldLabel>
                        <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} className="h-8 text-xs rounded-input" />
                        {dueActive && (
                          <button onClick={() => { setDueFrom(""); setDueTo(""); }} className="pt-1 text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
                        )}
                      </div>
                    </ColumnFilter>
                  </td>
                  {/* Overdue by days — numeric range */}
                  <td className="px-3 py-1.5 text-right">
                    <ColumnFilter active={odActive}>
                      <div className="space-y-1">
                        <FieldLabel>Min days</FieldLabel>
                        <Input type="number" value={odMin} onChange={(e) => setOdMin(e.target.value)} placeholder="e.g. 90" className="h-8 text-xs rounded-input" />
                        <FieldLabel>Max days</FieldLabel>
                        <Input type="number" value={odMax} onChange={(e) => setOdMax(e.target.value)} placeholder="e.g. 365" className="h-8 text-xs rounded-input" />
                        {odActive && (
                          <button onClick={() => { setOdMin(""); setOdMax(""); }} className="text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
                        )}
                      </div>
                    </ColumnFilter>
                  </td>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No bills match those filters.
                    </td>
                  </tr>
                ) : (
                  sorted.map((b, idx) => {
                    const advance = !b.isOnAccount && b.openingAmount < -0.5;
                    return (
                      <tr key={`${b.billRef ?? "on-account"}-${idx}`} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="py-1.5 px-3 text-sm whitespace-nowrap">{tallyDate(b.billDate)}</td>
                        <td className="py-1.5 px-3 text-sm">
                          {b.isOnAccount ? (
                            <span className="italic text-muted-foreground">On Account</span>
                          ) : (
                            <span>
                              {b.billRef}
                              {advance && <span className="ml-2 text-xs italic text-amber-700">(advance)</span>}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">
                          {b.isOnAccount ? "" : drcr(b.openingAmount)}
                        </td>
                        <td className="py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap">
                          {drcr(b.pendingAmount)}
                        </td>
                        <td className="py-1.5 px-3 text-sm whitespace-nowrap">{tallyDate(b.dueDate)}</td>
                        <td className={`py-1.5 px-3 text-right text-sm tabular-nums whitespace-nowrap ${overdueClass(b.overdueDays)}`}>
                          {b.overdueDays && b.overdueDays > 0 ? b.overdueDays : b.isOnAccount ? "" : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
                <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                  <td className="py-2 px-3 text-sm" colSpan={2}>
                    Grand Total{anyFilter && <span className="ml-1 font-normal text-xs text-muted-foreground">(filtered)</span>}
                  </td>
                  <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap">{drcr(totals.opening)}</td>
                  <td className="py-2 px-3 text-right text-sm tabular-nums whitespace-nowrap">{drcr(totals.pending)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </ScrollableTable>
        </>
      )}
    </div>
  );
}
