import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx-js-style";
import {
  ShieldAlert, Download, Search, FileText, AlertTriangle, CheckCircle2, RotateCcw,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData } from "@hub/lib/useAppData";
import { FYProvider, useFY } from "@hub/lib/fyContext";
import { clearRedMark, fetchRedMarkRows, reopenRedMark, type RedMarkRow } from "@hub/lib/musterApi";
import { buildMonthlySeries } from "@hub/lib/collections";
import { fetchRangeFacts } from "@hub/lib/collectionsRange";
import { isoToMonthLabel, monthEndISO, monthStartISO, shiftMonthLabel } from "@hub/lib/months";
import { formatDateDMY } from "@hub/lib/utils";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import { ClearStatusToggle } from "@hub/components/ClearStatusToggle";
import { ClearStatusBadge } from "@hub/components/ClearStatusBadge";
import { ClearNoteDialog } from "@hub/components/ClearNoteDialog";
import {
  CLEAR_VIEW_DEFAULT, countByClearView, describeClear, matchesClearView, useCanClear,
  type ClearFields, type ClearView,
} from "@hub/lib/clearStatus";
import { ColumnFilter, SortHead } from "@hub/components/gridColumns";
import { useColumnGrid, type GridColumn } from "@hub/lib/useColumnGrid";

/**
 * Red Mark Customers — the report management reads (RC-12).
 *
 * It answers three questions the master alone cannot: how much is stuck, whether they are paying
 * (three months of receipts, rolling), and — the one that is a control rather than a statistic —
 * whether we are STILL SUPPLYING them. A red-marked customer being billed this month is the row
 * that has to shout.
 *
 * ── It reads the master directly, NOT `Customer.blocked` ──
 * `blocked` is now "has an uncleared red mark", so a page built on it could never show a cleared
 * case — and this report has to, under its All / Cleared views. So the rows are the red-mark master
 * joined to the live ledgers, and the flag is only used elsewhere.
 *
 * ── Ledger grain, deliberately ──
 * `allCustomers` is one row per LEDGER (customer × company), which is exactly the grain of
 * `ext_redmark` and of the finance sheet this replaces — GOPAL HOME FURNISHING is four rows because
 * it is four books. The consolidated screens (the Dashboard tile, the risk register) fold those
 * together and take "uncleared wins" for free, because a consolidated row is blocked when ANY of
 * its ledgers is.
 *
 * ── Pinned to Both FYs ──
 * The month columns are the last three CALENDAR months, so they cannot be scoped to a financial
 * year: in April, a single-FY view keeps the receipts (which are not FY-windowed) and silently
 * drops the sales of February and March. The nested FYProvider below re-bases the context to its
 * own default (Both FYs) and UserLayout hides the topbar selector on this route, so the two can
 * never disagree — the same treatment as the Aging and DSO reports.
 */

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

/** Below this (₹) a month's figure is rounding, not activity. Same epsilon the engine uses. */
const ACTIVITY_EPS = 0.5;

/*
 * Cell classes for the 22-column grid. Compact on purpose: the shadcn defaults (h-12 headers,
 * p-4 cells) made every row several lines tall once 22 columns shared a screen. `whitespace-nowrap`
 * everywhere, so an amount never breaks into "₹30.00" / "L" and a header never stacks "Rcv / Jul- / 26".
 * The hub's `cn` runs tailwind-merge, so these REPLACE the defaults rather than competing with them.
 */
const TH = "h-8 px-2.5 text-[11px] whitespace-nowrap";
const TD = "px-2.5 py-1.5 text-xs whitespace-nowrap";
const NUM = "text-right font-mono tabular-nums";
/**
 * Customer stays put while the rest scrolls. Two details make that work:
 *  · a SOLID background, or the columns scrolling underneath show through the name;
 *  · the divider is a box-shadow, not a border — a border on a sticky cell stays behind with the
 *    table's collapsed borders and the column edge disappears the moment you scroll.
 */
const STICKY_EDGE = "shadow-[1px_0_0_0_hsl(var(--border))]";
const STICKY_HEAD = `sticky left-0 z-[2] bg-muted ${STICKY_EDGE}`;
const STICKY_BODY = `sticky left-0 z-[1] bg-surface ${STICKY_EDGE}`;
const STICKY_TOTAL = `sticky left-0 z-[1] bg-muted ${STICKY_EDGE}`;

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

interface RmRow extends ClearFields {
  id: string;
  customer: string;
  salesPerson: string;
  collectionTeam: string;
  category: string;
  company: string;
  location: string;
  outstanding: number;
  /** The report's "Due" — the ledger's overdue, which is the sheet's own "DUE AS ON" column. */
  due: number;
  maxOverdueDays: number;
  reason: string;
  /** Receipts for M-2, M-1, M (rupees, GROSS — see the Percentage note on the page). */
  received: [number, number, number];
  receivedTotal: number;
  /** Bounced cheques (CHQ.R) over the same three months, on their real dates. */
  bounced: number;
  sales: [number, number, number];
  /** Billed in the CURRENT month — the control. */
  billedThisMonth: boolean;
}

/* ── Page ──────────────────────────────────────────────────── */

function RedMarkCustomersInner() {
  const { loading, error, allCustomers, customerDetail, dashboard } = useAppData();
  const { label: fyLabel } = useFY();
  const { toast } = useToast();
  const canClear = useCanClear();

  /**
   * The master itself — every red mark, cleared or not.
   *
   * ⚠ LOAD-BEARING NOW, so a failure is an error rather than a shrug. It used to be fetched for the
   *   optional `reason` and ignored on failure; if this list is missing the page cannot tell a
   *   cleared case from an open one, and falling back to `blocked` would quietly show only the
   *   uncleared ones under a toggle that claims to show all.
   */
  const master = useQuery({
    queryKey: ["redMarkRows"],
    queryFn: fetchRedMarkRows,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [search, setSearch] = useState("");
  const [clearView, setClearView] = useState<ClearView>(CLEAR_VIEW_DEFAULT);
  const [billedOnly, setBilledOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [clearing, setClearing] = useState<{ row: RmRow; mode: "clear" | "reopen" } | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  /**
   * "As on" is ALWAYS today's snapshot — there is no historical replay in the mirror, so the page
   * prints the date instead of offering a date picker it could not honour.
   */
  const asOfIso: string = dashboard?.asOfDate ?? "";
  /** M, M-1, M-2 — rolling, so nobody hand-adds a month the way the finance sheet did. */
  const months = useMemo<[string, string, string]>(() => {
    const trend = dashboard?.trend ?? [];
    const m = isoToMonthLabel(asOfIso) || (trend.length ? trend[trend.length - 1].month : "");
    return [shiftMonthLabel(m, -2), shiftMonthLabel(m, -1), m];
  }, [asOfIso, dashboard?.trend]);
  const currentMonth = months[2];

  const redMarkRows = master.data ?? [];

  /** The ledgers this report is about: in the master, and visible to this viewer. */
  const ledgers = useMemo(() => {
    const byId = new Map(redMarkRows.map((r) => [r.ledger_id, r]));
    return allCustomers.filter((c) => byId.has(c.id));
  }, [allCustomers, redMarkRows]);

  /**
   * Monthly receipts and sales, from the engine every other collection report uses — so a figure
   * here and the same figure on the Collection report are the same number by construction.
   * Receipts include manual Other Payments (none of the red-marked ledgers has any today).
   */
  const series = useMemo(
    () => buildMonthlySeries(ledgers, customerDetail, "live"),
    [ledgers, customerDetail],
  );

  /**
   * Bounced cheques over the three months, read on their REAL dates.
   *
   * Not from MonthFacts: under Live those per-month cheque returns are an estimate — the year's
   * total spread across months by receipt weight — so a month-by-month figure from there would be
   * arithmetic, not a fact. This RPC reads the dated vouchers. It counts Payment vouchers named
   * CHQ.R only, so refunds and unlabelled bounces are NOT in it, which is why the column says CHQ.R.
   */
  const bounced = useQuery({
    queryKey: ["redMarkBounced", months[0], asOfIso],
    queryFn: () => fetchRangeFacts(monthStartISO(months[0]), asOfIso, null, monthEndISO(currentMonth)),
    enabled: !!asOfIso && !!months[0],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const allRows = useMemo<RmRow[]>(() => {
    const byId = new Map(redMarkRows.map((r) => [r.ledger_id, r]));
    const monthOf = (id: string, label: string, pick: (f: { receipts: number; sales: number }) => number) => {
      const f = series.get(id)?.get(label);
      return f ? pick(f) : 0;
    };
    return ledgers.map((c) => {
      const m = byId.get(c.id) as RedMarkRow;
      const received: [number, number, number] = [
        monthOf(c.id, months[0], (f) => f.receipts),
        monthOf(c.id, months[1], (f) => f.receipts),
        monthOf(c.id, months[2], (f) => f.receipts),
      ];
      const sales: [number, number, number] = [
        monthOf(c.id, months[0], (f) => f.sales),
        monthOf(c.id, months[1], (f) => f.sales),
        monthOf(c.id, months[2], (f) => f.sales),
      ];
      return {
        id: c.id,
        customer: c.name,
        salesPerson: c.salesPerson || "",
        collectionTeam: c.collectionTeam || "",
        category: c.category || "",
        company: c.company,
        location: c.location,
        outstanding: c.outstanding,
        due: c.overdue,
        maxOverdueDays: c.maxOverdueDays,
        reason: m.reason ?? "",
        received,
        receivedTotal: received[0] + received[1] + received[2],
        bounced: bounced.data?.get(c.id)?.chequeReturns ?? 0,
        sales,
        billedThisMonth: sales[2] > ACTIVITY_EPS,
        cleared: m.cleared,
        cleared_at: m.cleared_at,
        cleared_by: m.cleared_by,
        clear_note: m.clear_note,
      };
    });
  }, [ledgers, redMarkRows, series, months, bounced.data]);

  /** Received ÷ Due. Undefined (not 0%) when there is nothing due to measure against. */
  const pctOf = (r: RmRow): number | null => (r.due > 1 ? (r.receivedTotal / r.due) * 100 : null);

  const columns = useMemo<GridColumn<RmRow>[]>(() => [
    { key: "customer", value: (r) => r.customer },
    { key: "salesPerson", value: (r) => r.salesPerson },
    { key: "collectionTeam", value: (r) => r.collectionTeam },
    { key: "company", value: (r) => r.company },
    { key: "location", value: (r) => r.location },
    { key: "category", value: (r) => r.category },
    // Money and day counts: sorted on the NUMBER, and no filter — every value is its own, so the
    // dropdown would only restate the table.
    { key: "outstanding", value: (r) => fmt(r.outstanding), sortValue: (r) => r.outstanding, filter: false },
    { key: "due", value: (r) => fmt(r.due), sortValue: (r) => r.due, filter: false },
    { key: "maxOd", value: (r) => String(r.maxOverdueDays), sortValue: (r) => r.maxOverdueDays, filter: false },
    { key: "rcv0", value: (r) => fmt(r.received[0]), sortValue: (r) => r.received[0], filter: false },
    { key: "rcv1", value: (r) => fmt(r.received[1]), sortValue: (r) => r.received[1], filter: false },
    { key: "rcv2", value: (r) => fmt(r.received[2]), sortValue: (r) => r.received[2], filter: false },
    { key: "rcvTot", value: (r) => fmt(r.receivedTotal), sortValue: (r) => r.receivedTotal, filter: false },
    { key: "bounced", value: (r) => fmt(r.bounced), sortValue: (r) => r.bounced, filter: false },
    { key: "pct", value: (r) => (pctOf(r) === null ? "" : `${pctOf(r)!.toFixed(0)}%`), sortValue: (r) => pctOf(r) ?? -1, filter: false },
    { key: "sal0", value: (r) => fmt(r.sales[0]), sortValue: (r) => r.sales[0], filter: false },
    { key: "sal1", value: (r) => fmt(r.sales[1]), sortValue: (r) => r.sales[1], filter: false },
    { key: "sal2", value: (r) => fmt(r.sales[2]), sortValue: (r) => r.sales[2], filter: false },
    // Billed is a two-value column and the point of the report — filterable on purpose.
    { key: "billed", value: (r) => (r.billedThisMonth ? "Billed" : "Not billed") },
    { key: "clear", value: (r) => (r.cleared ? "Cleared" : "Red Mark") },
    { key: "reason", value: (r) => r.reason },
  ], []);

  const prefilter = useCallback((r: RmRow) => {
    if (!matchesClearView(r, clearView)) return false;
    if (billedOnly && !r.billedThisMonth) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.customer.toLowerCase().includes(q) ||
      r.salesPerson.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q) ||
      (r.clear_note ?? "").toLowerCase().includes(q)
    );
  }, [search, clearView, billedOnly]);

  const grid = useColumnGrid(allRows, columns, prefilter);
  const filteredRows = grid.rows;
  const counts = useMemo(() => countByClearView(allRows), [allRows]);

  const totalOutstanding = filteredRows.reduce((s, r) => s + r.outstanding, 0);
  const totalDue = filteredRows.reduce((s, r) => s + r.due, 0);
  const totalReceived = filteredRows.reduce((s, r) => s + r.receivedTotal, 0);
  /**
   * THE number management acts on: red-marked customers we are still supplying.
   * Counted on UNCLEARED rows only — a cleared customer is no longer red-marked, so billing them
   * is not the thing this is watching for.
   */
  const billedCount = filteredRows.filter((r) => r.billedThisMonth && !r.cleared).length;

  // Pagination
  const effectivePageSize = pageSize === "all" ? Math.max(1, filteredRows.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = pageSize === "all"
    ? filteredRows
    : filteredRows.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  const rangeStart = filteredRows.length === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const rangeEnd = Math.min(safePage * effectivePageSize, filteredRows.length);

  const clearFiltersAll = () => {
    grid.clearFilters(); setSearch(""); setBilledOnly(false); setClearView("all"); setCurrentPage(1);
  };

  const doClear = async (note: string) => {
    if (!clearing) return;
    const { row, mode } = clearing;
    setClearBusy(true);
    try {
      if (mode === "clear") await clearRedMark(row.id, note);
      else await reopenRedMark(row.id);
      setClearing(null);
      toast({ title: mode === "clear" ? "Cleared" : "Reopened", description: row.customer });
      // The master drives this page; `blocked` (and so the dashboard, the risk register and the
      // filters) comes from the app-data payload, which is refetched on every mount.
      await master.refetch();
    } catch (e) {
      toast({
        variant: "destructive",
        title: mode === "clear" ? "Couldn't clear" : "Couldn't reopen",
        description: (e as Error).message,
      });
    } finally {
      setClearBusy(false);
    }
  };

  const filterCell = (key: string) => (
    <ColumnFilter
      label="All"
      options={grid.optionsFor(key)}
      selected={grid.selected(key)}
      onChange={(v) => { grid.setSelected(key, v); setCurrentPage(1); }}
      labelOf={grid.optionLabel}
    />
  );

  const asOnLabel = asOfIso ? formatDateDMY(asOfIso) : "—";
  /**
   * What the balance columns mean, and how fresh they are. `lastUpdated` is the last Tally sync
   * (IST); the snapshot is rebuilt within 30 minutes of each sync, so it is the honest freshness.
   */
  // `lastUpdated` arrives as an IST clock string ("2026-09-16T18:05"); print it the way the rest of
  // the page prints dates, and leave it out rather than show a raw or unparseable stamp.
  const syncMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(dashboard?.lastUpdated ?? "");
  const syncedAt = syncMatch ? `${syncMatch[3]}-${syncMatch[2]}-${syncMatch[1]} ${syncMatch[4]}:${syncMatch[5]}` : "";
  const balancesNote =
    `Live Tally balances as on ${asOnLabel}` +
    (syncedAt ? ` (Tally last synced ${syncedAt})` : "") +
    ". Outstanding = everything the customer owes today, including bills not yet due. " +
    "Due = only the bills already past their due date.";

  const exportXlsx = () => {
    const header = [
      "Customer", "Sales Person", "Collection Team", "Company", "Location", "Category",
      `Outstanding as on ${asOnLabel}`, `Due as on ${asOnLabel}`, "Max OD Days",
      `Received ${months[0]}`, `Received ${months[1]}`, `Received ${months[2]}`,
      "Received (3 mo)", "Bounced cheques CHQ.R (3 mo)", "Received ÷ Due %",
      `Sales ${months[0]}`, `Sales ${months[1]}`, `Sales ${months[2]}`,
      `Billed in ${months[2]}`, "Clear status", "Cleared on", "Cleared by", "Clear note", "Reason",
    ];
    const viewLabel = clearView === "all" ? "All cases"
      : clearView === "cleared" ? "Cleared cases only" : "Uncleared cases only";
    const aoa: (string | number)[][] = [
      [`Red Mark Customers — as on ${asOnLabel} (${viewLabel}) — ${fyLabel}`],
      [
        "Outstanding and Due are the live Tally snapshot as on the date above; there is no back-dating. " +
        "Received is GROSS receipt vouchers plus manual Other Payments for the three months shown, and " +
        "the percentage is that total divided by Due — bounced cheques are NOT deducted from it, and are " +
        "shown in their own column (Payment vouchers named CHQ.R only). One row per customer per company.",
      ],
      [],
      header,
      ...filteredRows.map((r) => [
        r.customer, r.salesPerson || "—", r.collectionTeam || "—", r.company, r.location, r.category,
        Math.round(r.outstanding), Math.round(r.due), r.maxOverdueDays,
        Math.round(r.received[0]), Math.round(r.received[1]), Math.round(r.received[2]),
        Math.round(r.receivedTotal), Math.round(r.bounced),
        pctOf(r) === null ? "—" : Math.round(pctOf(r)!),
        Math.round(r.sales[0]), Math.round(r.sales[1]), Math.round(r.sales[2]),
        r.billedThisMonth ? "YES" : "",
        r.cleared ? "Cleared" : "Red Mark",
        r.cleared_at ? formatDateDMY(r.cleared_at.slice(0, 10)) : "",
        r.cleared_by ?? "", r.clear_note ?? "", r.reason,
      ]),
      [
        "", "", "", "", "", "Total",
        Math.round(totalOutstanding), Math.round(totalDue), "",
        "", "", "", Math.round(totalReceived), "", "", "", "", "",
        `${billedCount} billed`, "", "", "", "", "",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 11 },
      { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
      { wch: 13 }, { wch: 13 }, { wch: 13 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 40 }, { wch: 30 },
    ];
    styleRow(ws, 0, header.length, HEADER_STYLE);          // title
    styleRow(ws, 3, header.length, HEADER_STYLE);          // column header
    styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Red Mark Customers");
    XLSX.writeFile(wb, `red-mark-customers-${asOfIso || "today"}.xlsx`);
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading Red Mark customers…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;
  }
  if (master.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading the Red Mark master…</div>;
  }
  if (master.error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Could not read the Red Mark master, so this report cannot tell a cleared case from an open
        one: {(master.error as Error).message}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-destructive" /> Red Mark Customers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customers hand-flagged as Red Mark (managed in Masters → Red Mark), with their live
            outstanding, three months of receipts, and what we have billed them.{" "}
            <span className="font-medium text-foreground">As on {asOnLabel}</span> — the live Tally
            snapshot; figures cannot be back-dated. One row per customer per company.
          </p>
        </div>
        <Button onClick={exportXlsx} disabled={filteredRows.length === 0} className="rounded-button gap-2">
          <Download className="h-4 w-4" /> Export Excel
        </Button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Red Mark Customers", value: String(counts.uncleared), sub: "uncleared cases" },
          { label: "Total Outstanding", value: fmt(totalOutstanding), sub: `as on ${asOnLabel}, rows shown` },
          { label: "Total Due", value: fmt(totalDue), sub: "overdue as on " + asOnLabel },
        ].map((s) => (
          <Card key={s.label} className="rounded-card border-border bg-surface">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
        {/* The control, as a tile. Clicking it narrows the table to exactly those rows — a number
            management is expected to act on has to be openable. */}
        <Card
          className={`rounded-card border-border bg-surface cursor-pointer transition-colors ${
            billedOnly ? "ring-2 ring-destructive" : "hover:border-destructive/40"
          } ${billedCount > 0 ? "border-destructive/40" : ""}`}
          onClick={() => { setBilledOnly((v) => !v); setCurrentPage(1); }}
          title="Show only the red-marked customers billed this month"
        >
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {billedCount > 0 && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
              Billed this month
            </div>
            <div className={`text-lg font-bold mt-1 ${billedCount > 0 ? "text-destructive" : "text-foreground"}`}>
              {billedCount}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              red-marked customers were billed in {currentMonth || "this month"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customer / salesperson / reason / clear note"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="pl-8 w-72 h-9 rounded-input text-sm"
          />
        </div>
        <ClearStatusToggle
          value={clearView}
          onChange={(v) => { setClearView(v); setCurrentPage(1); }}
          counts={counts}
        />
        {billedOnly && (
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
            onClick={() => setBilledOnly(false)}>
            Billed this month only ✕
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          {allRows.length === 0 ? (
            /* The full empty state answers "this list has no rows at all" and so is keyed on the
               UNFILTERED rows; a filter that matches nothing keeps the table (see the tbody). */
            <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <FileText className="h-8 w-8 opacity-40" />
              No customers are flagged as Red Mark.
            </div>
          ) : (
            <ScrollableTable>
              {/*
                22 columns do not fit a screen, so this table is built to be SCANNED, not to fit:
                  · one line per row — nothing wraps, names truncate with the full name on hover;
                  · compact cells (the shadcn default p-4 made every row four lines tall);
                  · the month columns sit under "Received" / "Sales billed" group headers, so each
                    header is just the month instead of nine near-identical "Rcv Jul-26" labels;
                  · Customer is STICKY, so the row is still identifiable after scrolling right to
                    the sales flag and the Clear button.
                The sticky cells need a SOLID background (bg-muted / bg-surface), or the columns
                scrolling underneath show through.
              */}
              <Table className="text-xs">
                <TableHeader>
                  {/* Group row. Column count: 1 + 5 + 3 + 5 + 1 + 3 + 4 = 22.
                      The balances carry their date IN THE HEADER, not just in the page intro: a
                      screenshot or a scrolled table loses the intro, and "Due" with no date on it is
                      the column people were misreading. */}
                  <TableRow className="bg-muted hover:bg-muted border-b-0">
                    <TableHead className={`${TH} ${STICKY_HEAD} h-6`} />
                    <TableHead className={`${TH} h-6`} colSpan={5} />
                    <TableHead
                      className={`${TH} h-6 text-center text-foreground border-x border-border`}
                      colSpan={3}
                      title={balancesNote}
                    >
                      As on {asOnLabel}
                    </TableHead>
                    <TableHead className={`${TH} h-6 text-center text-foreground border-x border-border`} colSpan={5}>
                      Received (gross)
                    </TableHead>
                    <TableHead className={`${TH} h-6`} />
                    <TableHead className={`${TH} h-6 text-center text-foreground border-x border-border`} colSpan={3}>
                      Sales billed
                    </TableHead>
                    <TableHead className={`${TH} h-6`} colSpan={4} />
                  </TableRow>
                  <TableRow className="bg-muted hover:bg-muted">
                    <SortHead label="Customer" className={`${TH} ${STICKY_HEAD} min-w-[220px]`} dir={grid.sortDir("customer")} onToggle={() => grid.toggleSort("customer")} />
                    <SortHead label="Salesperson" className={TH} dir={grid.sortDir("salesPerson")} onToggle={() => grid.toggleSort("salesPerson")} />
                    <SortHead label="Team" className={TH} dir={grid.sortDir("collectionTeam")} onToggle={() => grid.toggleSort("collectionTeam")} />
                    <SortHead label="Company" className={TH} dir={grid.sortDir("company")} onToggle={() => grid.toggleSort("company")} />
                    <SortHead label="Location" className={TH} dir={grid.sortDir("location")} onToggle={() => grid.toggleSort("location")} />
                    <SortHead label="Cat." className={TH} dir={grid.sortDir("category")} onToggle={() => grid.toggleSort("category")} />
                    <SortHead label="Outstanding" className={`${TH} text-right border-l border-border`} dir={grid.sortDir("outstanding")} onToggle={() => grid.toggleSort("outstanding")} />
                    <SortHead label="Due" className={`${TH} text-right`} dir={grid.sortDir("due")} onToggle={() => grid.toggleSort("due")} />
                    <SortHead label="Max OD" className={`${TH} text-right`} dir={grid.sortDir("maxOd")} onToggle={() => grid.toggleSort("maxOd")} />
                    <SortHead label={months[0]} className={`${TH} text-right border-l border-border`} dir={grid.sortDir("rcv0")} onToggle={() => grid.toggleSort("rcv0")} />
                    <SortHead label={months[1]} className={`${TH} text-right`} dir={grid.sortDir("rcv1")} onToggle={() => grid.toggleSort("rcv1")} />
                    <SortHead label={months[2]} className={`${TH} text-right`} dir={grid.sortDir("rcv2")} onToggle={() => grid.toggleSort("rcv2")} />
                    <SortHead label="3 mo" className={`${TH} text-right`} dir={grid.sortDir("rcvTot")} onToggle={() => grid.toggleSort("rcvTot")} />
                    <SortHead label="Bounced" className={`${TH} text-right border-r border-border`} dir={grid.sortDir("bounced")} onToggle={() => grid.toggleSort("bounced")} />
                    <SortHead label="Rcvd ÷ Due" className={`${TH} text-right`} dir={grid.sortDir("pct")} onToggle={() => grid.toggleSort("pct")} />
                    <SortHead label={months[0]} className={`${TH} text-right border-l border-border`} dir={grid.sortDir("sal0")} onToggle={() => grid.toggleSort("sal0")} />
                    <SortHead label={months[1]} className={`${TH} text-right`} dir={grid.sortDir("sal1")} onToggle={() => grid.toggleSort("sal1")} />
                    <SortHead label={months[2]} className={`${TH} text-right border-r border-border`} dir={grid.sortDir("sal2")} onToggle={() => grid.toggleSort("sal2")} />
                    <SortHead label="Billed" className={TH} dir={grid.sortDir("billed")} onToggle={() => grid.toggleSort("billed")} />
                    <SortHead label="Clear status" className={TH} dir={grid.sortDir("clear")} onToggle={() => grid.toggleSort("clear")} />
                    <SortHead label="Reason" className={TH} dir={grid.sortDir("reason")} onToggle={() => grid.toggleSort("reason")} />
                    <TableHead className={`${TH} text-right`}>Actions</TableHead>
                  </TableRow>
                  {/* Filter row. 1 + 5 + 9 + 3 + 1 + 1 + 1 + 1 = 22. */}
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className={`${TH} ${STICKY_HEAD} py-1`}>{filterCell("customer")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("salesPerson")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("collectionTeam")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("company")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("location")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("category")}</TableHead>
                    {/* Money columns carry no filter: every value is unique, so a dropdown would only
                        restate the table. They still sort. */}
                    <TableHead className={`${TH} py-1`} colSpan={9} />
                    <TableHead className={`${TH} py-1`} colSpan={3} />
                    <TableHead className={`${TH} py-1`}>{filterCell("billed")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("clear")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("reason")}</TableHead>
                    <TableHead className={`${TH} py-1`} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((r) => {
                    const pct = pctOf(r);
                    const mayClear = canClear(r.collectionTeam);
                    // A cleared customer is not red-marked, so billing them is not the alarm.
                    const shout = r.billedThisMonth && !r.cleared;
                    return (
                      <TableRow key={r.id} className={`hover:bg-muted/20 ${r.cleared ? "opacity-70" : ""}`}>
                        <TableCell className={`${TD} ${STICKY_BODY} font-medium`}>
                          <div className="max-w-[240px] truncate" title={r.customer}>{r.customer}</div>
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>
                          <div className="max-w-[130px] truncate" title={r.salesPerson}>{r.salesPerson || "—"}</div>
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.collectionTeam || "—"}</TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.company}</TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.location}</TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.category || "—"}</TableCell>
                        <TableCell className={`${TD} ${NUM} font-semibold border-l border-border`} title={`Everything owed as on ${asOnLabel}, including bills not yet due`}>{fmt(r.outstanding)}</TableCell>
                        <TableCell className={`${TD} ${NUM} ${r.due > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`} title={`Bills already past their due date as on ${asOnLabel}`}>{fmt(r.due)}</TableCell>
                        <TableCell className={`${TD} ${NUM} text-muted-foreground`}>{r.maxOverdueDays > 0 ? r.maxOverdueDays : "—"}</TableCell>
                        {r.received.map((v, i) => (
                          <TableCell
                            key={i}
                            className={`${TD} ${NUM} ${i === 0 ? "border-l border-border" : ""} ${v > ACTIVITY_EPS ? "" : "text-muted-foreground"}`}
                          >
                            {v > ACTIVITY_EPS ? fmt(v) : "—"}
                          </TableCell>
                        ))}
                        <TableCell className={`${TD} ${NUM} font-semibold`}>{r.receivedTotal > ACTIVITY_EPS ? fmt(r.receivedTotal) : "—"}</TableCell>
                        <TableCell
                          className={`${TD} ${NUM} border-r border-border ${r.bounced > ACTIVITY_EPS ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                          title="Bounced cheques (Payment vouchers named CHQ.R) over the same three months. Not deducted from Received."
                        >
                          {bounced.isLoading ? "…" : r.bounced > ACTIVITY_EPS ? fmt(r.bounced) : "—"}
                        </TableCell>
                        <TableCell
                          className={`${TD} ${NUM}`}
                          title={`Three months of receipts (gross) ÷ Due as on ${asOnLabel}. Bounced cheques are not deducted.`}
                        >
                          {pct === null ? "—" : `${pct.toFixed(0)}%`}
                        </TableCell>
                        {r.sales.map((v, i) => {
                          const alarm = i === 2 && shout;
                          return (
                            <TableCell
                              key={i}
                              className={`${TD} ${NUM} ${i === 0 ? "border-l border-border" : ""} ${i === 2 ? "border-r border-border" : ""} ${
                                alarm ? "text-destructive font-bold bg-destructive/10" : v > ACTIVITY_EPS ? "" : "text-muted-foreground"
                              }`}
                              title={alarm ? "We billed this red-marked customer this month" : undefined}
                            >
                              {v > ACTIVITY_EPS ? fmt(v) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell className={TD}>
                          {shout ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                              <AlertTriangle className="h-3 w-3" /> Billed
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className={TD}><ClearStatusBadge row={r} /></TableCell>
                        <TableCell className={`${TD} text-[11px] text-muted-foreground`} title={r.cleared ? describeClear(r) : r.reason}>
                          <div className="max-w-[200px] truncate">{r.reason || "—"}</div>
                        </TableCell>
                        <TableCell className={`${TD} text-right`}>
                          <Button
                            size="sm" variant="outline"
                            className="h-6 gap-1 px-2 text-[11px] border-emerald-600/40 text-emerald-700 hover:text-emerald-700 dark:text-emerald-400"
                            disabled={!mayClear}
                            title={mayClear
                              ? (r.cleared ? "Reopen this case" : "Clear — the case is settled; the record stays")
                              : "Only this customer's collection team, or an administrator, can clear it"}
                            onClick={() => setClearing({ row: r, mode: r.cleared ? "reopen" : "clear" })}
                          >
                            {r.cleared
                              ? <><RotateCcw className="h-3 w-3" />Reopen</>
                              : <><CheckCircle2 className="h-3 w-3" />Clear</>}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filteredRows.length === 0 && (
                    <TableRow>
                      {/* Keep the table standing: the header, the sort toggles and the filter row
                          are the only way back from a filter that matches nothing. */}
                      <TableCell colSpan={22} className="text-center text-sm text-muted-foreground py-10">
                        <div className="flex flex-col items-center gap-2">
                          <span>
                            No Red Mark customers match the current filters
                            {clearView !== "all" ? ` in the ${clearView} view` : ""}.
                          </span>
                          <Button size="sm" variant="outline" onClick={clearFiltersAll}>Clear filters</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {filteredRows.length > 0 && (
                    /* 1 + 5 + 1 + 1 + 1 + 3 + 1 + 5 + 1 + 3 = 22 */
                    <TableRow className="bg-muted hover:bg-muted font-semibold border-t border-border">
                      <TableCell className={`${TD} ${STICKY_TOTAL} font-bold`}>
                        Total ({filteredRows.length} row{filteredRows.length === 1 ? "" : "s"})
                      </TableCell>
                      <TableCell className={TD} colSpan={5} />
                      <TableCell className={`${TD} ${NUM} font-bold border-l border-border`}>{fmt(totalOutstanding)}</TableCell>
                      <TableCell className={`${TD} ${NUM} font-bold text-destructive`}>{fmt(totalDue)}</TableCell>
                      <TableCell className={TD} />
                      <TableCell className={`${TD} border-l border-border`} colSpan={3} />
                      <TableCell className={`${TD} ${NUM} font-bold`}>{fmt(totalReceived)}</TableCell>
                      <TableCell className={TD} colSpan={5} />
                      <TableCell className={`${TD} font-bold text-destructive`}>{billedCount} billed</TableCell>
                      <TableCell className={TD} colSpan={3} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Received is gross receipt vouchers plus manual Other Payments, so a payment that later
        bounced still counts — the Bounced column shows those separately (Payment vouchers named
        CHQ.R only) and is not deducted from the percentage. Received ÷ Due divides the three months
        of receipts by Due as on {asOnLabel}.
      </p>

      {/* Pagination */}
      {filteredRows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(v === "all" ? "all" : Number(v) as PageSize); setCurrentPage(1); }}>
              <SelectTrigger className="w-[90px] h-8 rounded-input border-border text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-input">
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={String(opt)} value={String(opt)}>{opt === "all" ? "All" : opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{rangeStart}–{rangeEnd} of {filteredRows.length}</span>
          </div>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-disabled={safePage === 1}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {getPageWindow(safePage, totalPages).map((p, i) =>
                  p === "..." ? (
                    <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={p === safePage} onClick={() => setCurrentPage(p)} className="cursor-pointer">{p}</PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={safePage === totalPages}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      <ClearNoteDialog
        mode={clearing?.mode ?? null}
        subject={clearing ? `${clearing.row.customer} · ${clearing.row.company}` : ""}
        row={clearing?.row ?? null}
        busy={clearBusy}
        onCancel={() => setClearing(null)}
        onConfirm={(note) => void doClear(note)}
      />
    </div>
  );
}

/**
 * Pinned to Both FYs — see the file header. The nested FYProvider re-bases the financial-year
 * context to its own default and never changes it, and UserLayout hides the topbar selector on this
 * route so the two can never disagree on screen.
 */
export default function RedMarkCustomersReport() {
  return (
    <FYProvider>
      <RedMarkCustomersInner />
    </FYProvider>
  );
}
