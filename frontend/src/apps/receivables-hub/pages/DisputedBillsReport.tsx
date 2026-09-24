import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx-js-style";
import {
  AlertTriangle, CheckCircle2, Download, FileText, Pencil, Plus, RotateCcw, Search, X, Check,
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
import { FYProvider } from "@hub/lib/fyContext";
import { useHubMenuAccess } from "@hub/lib/menus";
import {
  clearDispute, fetchDisputeRows, reopenDispute, saveDispute, type DisputeRow,
} from "@hub/lib/musterApi";
import { saleTypeLabel } from "@hub/lib/salesReport";
import { formatDateDMY } from "@hub/lib/utils";
import { HEADER_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import { ClearStatusToggle } from "@hub/components/ClearStatusToggle";
import { ClearStatusBadge } from "@hub/components/ClearStatusBadge";
import { ClearNoteDialog } from "@hub/components/ClearNoteDialog";
import { AddDisputeDialog, type DisputeBill, type DisputeCustomer } from "@hub/components/AddDisputeDialog";
import {
  CLEAR_VIEW_DEFAULT, DISPUTE_COPY, countByClearView, describeClear, matchesClearView, useCanClear,
  type ClearFields, type ClearView,
} from "@hub/lib/clearStatus";
import { ColumnFilter, SortHead } from "@hub/components/gridColumns";
import { useColumnGrid, type GridColumn } from "@hub/lib/useColumnGrid";

/**
 * Disputed Bills — the customer bills under dispute, with their live figures (RC-13).
 *
 * Replaces the DISPUTE tab of accounts' hand-kept sheet, where the status was being typed into the
 * remark ("CLEAR", "NO DISPUTE") because there was nowhere else to put it.
 *
 * ── The master stores what a human typed; everything else is live ──
 * `ext_dispute` holds the bill's key, the remark, the item and the clear status. Date, amount,
 * pending, settled and sale type are read here from the dashboard's own bills, so this page and
 * every other screen quote the same number for the same bill.
 *
 * ── A settled bill LEAVES the snapshot — and that is how most disputes end ──
 * The snapshot holds open bills only. When Tally knocks the bill off, the dispute is left pointing at
 * nothing. It is never dropped: the row stays, reads "No longer open", and asks to be cleared.
 *
 * ── "Settled" is one figure, on purpose ──
 * Live, the snapshot nets receipts, credit notes, debit notes and journals against each bill and does
 * not split them — `receiptAdj` / `creditNoteAdj` / `debitNoteAdj` / `journalAdj` are always 0 there.
 * The only separable part is manual Other Payments (`otherPaymentAdj`). So Settled = Amount − Pending,
 * which reconciles by construction, and the hover says which part came from where.
 *
 * ── Scoped through the scoped customers, never the raw table ──
 * ext_dispute is read-open, so every dispute reaches the browser. A row is shown only when its
 * ledger is in `allCustomers`, which useAppData has already narrowed by salesperson AND collection
 * team — the same chokepoint the Red Mark report uses. UI-level scoping only, like the rest of the hub.
 *
 * ── Pinned to Both FYs ──
 * Nothing on the page depends on the financial year (open bills are not FY-windowed), so a selector
 * would change nothing and read as broken. UserLayout hides it on this route and the nested
 * FYProvider below keeps the payload the Both-FYs one.
 */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};
const inr = (n: number) => `${n < 0 ? "-" : ""}₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;

const TH = "h-8 px-2.5 text-[11px] whitespace-nowrap";
const TD = "px-2.5 py-1.5 text-xs whitespace-nowrap";
const NUM = "text-right font-mono tabular-nums";
const STICKY_EDGE = "shadow-[1px_0_0_0_hsl(var(--border))]";
const STICKY_HEAD = `sticky left-0 z-[2] bg-muted ${STICKY_EDGE}`;
const STICKY_BODY = `sticky left-0 z-[1] bg-surface ${STICKY_EDGE}`;
const STICKY_TOTAL = `sticky left-0 z-[1] bg-muted ${STICKY_EDGE}`;

/** The two values of the Bill column. Strings, because the column filter offers them. */
const OPEN = "Open";
const GONE = "No longer open";

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

interface DbRow extends ClearFields {
  id: number;
  ledgerId: string;
  customer: string;
  company: string;
  location: string;
  salesPerson: string;
  collectionTeam: string;
  billRef: string;
  /** False when the bill has left the snapshot — settled in Tally, usually. The figures below are then 0. */
  open: boolean;
  date: string;
  overdueDays: number;
  saleType: string;
  amount: number;
  pending: number;
  /** Amount − Pending. */
  settled: number;
  /** The part of `settled` that is manual Other Payments; the rest was settled inside Tally. */
  otherPayments: number;
  /** An opening bill: `amount` is what was still owed when these books began, not the invoice value. */
  isOpening: boolean;
  remarks: string;
  item: string;
  updatedBy: string;
}

function DisputedBillsInner() {
  const { loading, error, allCustomers, customerDetail, dashboard } = useAppData();
  const { toast } = useToast();
  const canClear = useCanClear();
  const { hasFullAccess, canEdit } = useHubMenuAccess();
  // Adding a dispute and editing its remark are Settings-grade writes, exactly like Red Mark's
  // details; the server refuses everyone else. Collectors clear and reopen.
  const canManage = canEdit && hasFullAccess("settings");

  /** The master — every dispute, cleared or not. Load-bearing: without it nothing can be shown. */
  const master = useQuery({
    queryKey: ["disputeRows"],
    queryFn: fetchDisputeRows,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [search, setSearch] = useState("");
  const [clearView, setClearView] = useState<ClearView>(CLEAR_VIEW_DEFAULT);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [clearing, setClearing] = useState<{ row: DbRow; mode: "clear" | "reopen" } | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const asOfIso: string = dashboard?.asOfDate ?? "";
  const asOnLabel = asOfIso ? formatDateDMY(asOfIso) : "—";
  const disputes = master.data ?? [];

  const customerById = useMemo(() => new Map(allCustomers.map((c) => [c.id, c])), [allCustomers]);

  const allRows = useMemo<DbRow[]>(() => {
    const out: DbRow[] = [];
    for (const d of disputes) {
      // Scope: a dispute on a customer this viewer cannot see is not shown at all (see the header).
      const c = customerById.get(d.ledger_id);
      if (!c) continue;
      // Matched on BOTH halves of the key, exactly: the bill number alone repeats across customers.
      const inv = customerDetail[d.ledger_id]?.invoices.find((i) => i.billRefName === d.bill_ref);
      const amount = inv?.amount ?? 0;
      const pending = inv?.pending ?? 0;
      out.push({
        id: d.id,
        ledgerId: d.ledger_id,
        customer: c.name,
        company: c.company,
        location: c.location,
        salesPerson: c.salesPerson || "",
        collectionTeam: c.collectionTeam || "",
        billRef: d.bill_ref,
        open: !!inv,
        date: inv?.date ?? "",
        overdueDays: inv?.overdueDays ?? 0,
        saleType: inv ? saleTypeLabel(inv.voucherType) : "",
        amount,
        pending,
        settled: amount - pending,
        otherPayments: inv?.otherPaymentAdj ?? 0,
        isOpening: !!inv?.isCarryforward,
        remarks: d.remarks ?? "",
        item: d.item_description ?? "",
        updatedBy: d.updated_by ?? "",
        cleared: d.cleared,
        cleared_at: d.cleared_at,
        cleared_by: d.cleared_by,
        clear_note: d.clear_note,
      });
    }
    // Default order, before anyone sorts: the ones that need action first — an open dispute whose bill
    // has already gone — then the most overdue.
    return out.sort((a, b) =>
      Number(a.open) - Number(b.open) || b.overdueDays - a.overdueDays || a.customer.localeCompare(b.customer));
  }, [disputes, customerById, customerDetail]);

  const columns = useMemo<GridColumn<DbRow>[]>(() => [
    { key: "customer", value: (r) => r.customer },
    { key: "company", value: (r) => r.company },
    { key: "location", value: (r) => r.location },
    { key: "collectionTeam", value: (r) => r.collectionTeam },
    { key: "salesPerson", value: (r) => r.salesPerson },
    { key: "billRef", value: (r) => r.billRef },
    { key: "bill", value: (r) => (r.open ? OPEN : GONE) },
    { key: "date", value: (r) => (r.date ? formatDateDMY(r.date) : ""), sortValue: (r) => r.date },
    { key: "overdue", value: (r) => String(r.overdueDays), sortValue: (r) => r.overdueDays, filter: false },
    { key: "saleType", value: (r) => r.saleType },
    // Money: sorted on the number; no filter, since every value is its own.
    { key: "amount", value: (r) => inr(r.amount), sortValue: (r) => r.amount, filter: false },
    { key: "pending", value: (r) => inr(r.pending), sortValue: (r) => r.pending, filter: false },
    { key: "settled", value: (r) => inr(r.settled), sortValue: (r) => r.settled, filter: false },
    { key: "item", value: (r) => r.item },
    { key: "remarks", value: (r) => r.remarks },
    { key: "clear", value: (r) => (r.cleared ? "Cleared" : DISPUTE_COPY.openLabel) },
  ], []);

  const prefilter = useCallback((r: DbRow) => {
    if (!matchesClearView(r, clearView)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${r.customer} ${r.billRef} ${r.remarks} ${r.item} ${r.salesPerson} ${r.clear_note ?? ""}`
      .toLowerCase().includes(q);
  }, [search, clearView]);

  const grid = useColumnGrid(allRows, columns, prefilter);
  const filteredRows = grid.rows;
  const counts = useMemo(() => countByClearView(allRows), [allRows]);

  const totalAmount = filteredRows.reduce((s, r) => s + r.amount, 0);
  const totalPending = filteredRows.reduce((s, r) => s + r.pending, 0);
  const totalSettled = filteredRows.reduce((s, r) => s + r.settled, 0);
  const customerCount = new Set(filteredRows.map((r) => r.ledgerId)).size;
  /** Open disputes whose bill has gone — settled in Tally, still open here. The number to act on. */
  const goneCount = allRows.filter((r) => !r.cleared && !r.open).length;
  const goneOnly = grid.selected("bill").length === 1 && grid.selected("bill")[0] === GONE;

  const effectivePageSize = pageSize === "all" ? Math.max(1, filteredRows.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = pageSize === "all"
    ? filteredRows
    : filteredRows.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);
  const rangeStart = filteredRows.length === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const rangeEnd = Math.min(safePage * effectivePageSize, filteredRows.length);

  const clearFiltersAll = () => {
    grid.clearFilters(); setSearch(""); setClearView("all"); setCurrentPage(1);
  };

  const doClear = async (note: string) => {
    if (!clearing) return;
    const { row, mode } = clearing;
    setClearBusy(true);
    try {
      if (mode === "clear") await clearDispute(row.id, note);
      else await reopenDispute(row.id);
      setClearing(null);
      toast({ title: mode === "clear" ? "Dispute cleared" : "Dispute reopened", description: `${row.customer} · ${row.billRef}` });
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

  /** Save the remark alone — the server writes only the fields sent. */
  const saveRemark = async () => {
    if (!editing) return;
    setEditBusy(true);
    try {
      await saveDispute({ id: editing.id, remarks: editing.text.trim() || null });
      setEditing(null);
      toast({ title: "Remark saved" });
      await master.refetch();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save the remark", description: (e as Error).message });
    } finally {
      setEditBusy(false);
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

  // ── The add dialog, fed from the dashboard's own (scoped) customers and bills ──
  const dialogCustomers = useMemo<DisputeCustomer[]>(
    () => allCustomers.map((c) => ({ ledgerId: c.id, name: c.name, company: c.company, location: c.location })),
    [allCustomers],
  );
  const billsOf = useCallback((ledgerId: string): DisputeBill[] =>
    (customerDetail[ledgerId]?.invoices ?? []).map((i) => ({
      billRef: i.billRefName,
      date: i.date,
      dueDate: i.dueDate,
      amount: i.amount,
      pending: i.pending,
      overdueDays: i.overdueDays,
      saleType: i.voucherType,
    })), [customerDetail]);

  const settledTitle = (r: DbRow) => {
    if (!r.open) return "The bill is no longer open in Tally, so there is nothing live to show.";
    const inTally = r.settled - r.otherPayments;
    const parts = [
      `Settled ${inr(r.settled)} = Amount ${inr(r.amount)} − Pending ${inr(r.pending)}`,
      `· In Tally ${inr(inTally)} — receipts, credit notes, debit notes and journals against this bill (Tally nets them; they are not split)`,
      `· Manual Other Payments ${inr(r.otherPayments)}`,
    ];
    if (r.isOpening) {
      parts.push("Opening bill: Amount is what was still owed when these books began, so Settled counts only what came in since.");
    }
    return parts.join("\n");
  };

  const exportXlsx = () => {
    const header = [
      "Customer", "Company", "Location", "Collection Team", "Sales Person", "Bill reference", "Bill",
      "Bill date", "Overdue days", "Sale type",
      `Amount as on ${asOnLabel}`, `Pending as on ${asOnLabel}`, `Settled as on ${asOnLabel}`,
      "of which manual Other Payments", "Item", "Remark",
      "Clear status", "Cleared on", "Cleared by", "Clear note",
    ];
    const viewLabel = clearView === "all" ? "All disputes"
      : clearView === "cleared" ? "Cleared disputes only" : "Uncleared disputes only";
    const aoa: (string | number)[][] = [
      [`Disputed Bills — as on ${asOnLabel} (${viewLabel})`],
      [
        "Amount, Pending and Settled are the live Tally snapshot as on the date above; there is no back-dating. " +
        "Settled = Amount − Pending: everything knocked off the bill in Tally (receipts, credit notes, debit notes, " +
        "journals — Tally does not split them per bill) plus manual Other Payments, shown separately. " +
        "A bill marked 'No longer open' has left Tally's open bills, usually because it was settled; its figures are blank. " +
        "Bill-wise figures do not tie to the Dashboard's ledger totals (bill-wise overdue reads about 7.8% higher).",
      ],
      [],
      header,
      ...filteredRows.map((r) => [
        r.customer, r.company, r.location, r.collectionTeam || "—", r.salesPerson || "—", r.billRef,
        r.open ? OPEN : GONE,
        r.date ? formatDateDMY(r.date) : "", r.open ? r.overdueDays : "", r.saleType,
        r.open ? Math.round(r.amount) : "", r.open ? Math.round(r.pending) : "", r.open ? Math.round(r.settled) : "",
        r.open ? Math.round(r.otherPayments) : "",
        r.item, r.remarks,
        r.cleared ? "Cleared" : DISPUTE_COPY.openLabel,
        r.cleared_at ? formatDateDMY(r.cleared_at.slice(0, 10)) : "",
        r.cleared_by ?? "", r.clear_note ?? "",
      ]),
      [
        `Total (${filteredRows.length} bills, ${customerCount} customers)`, "", "", "", "", "", "", "", "", "",
        Math.round(totalAmount), Math.round(totalPending), Math.round(totalSettled), "", "", "", "", "", "", "",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 15 },
      { wch: 12 }, { wch: 11 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 50 },
      { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 40 },
    ];
    styleRow(ws, 0, header.length, HEADER_STYLE);
    styleRow(ws, 3, header.length, HEADER_STYLE);
    styleRow(ws, aoa.length - 1, header.length, GRAND_TOTAL_STYLE);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Disputed Bills");
    XLSX.writeFile(wb, `disputed-bills-${asOfIso || "today"}.xlsx`);
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading disputed bills…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;
  if (master.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading the disputes master…</div>;
  if (master.error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Could not read the disputed bills master: {(master.error as Error).message}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warning" /> Disputed Bills
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-4xl">
            Customer bills under dispute (also managed in Masters → Disputed Bills), with their live
            figures from Tally. <span className="font-medium text-foreground">As on {asOnLabel}</span> —
            the live snapshot; figures cannot be back-dated. Clear a dispute once it is settled; the
            record stays.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="outline" onClick={() => setAddOpen(true)} className="rounded-button gap-2">
              <Plus className="h-4 w-4" /> Add disputed bills
            </Button>
          )}
          <Button onClick={exportXlsx} disabled={filteredRows.length === 0} className="rounded-button gap-2">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Open disputes", value: String(counts.uncleared), sub: `bills not yet cleared · ${counts.cleared} cleared` },
          { label: "Pending under dispute", value: fmt(totalPending), sub: `as on ${asOnLabel}, rows shown` },
          { label: "Customers", value: String(customerCount), sub: "with a bill in the rows shown" },
        ].map((s) => (
          <Card key={s.label} className="rounded-card border-border bg-surface">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
        {/* The one to act on, as a tile that opens exactly those rows. */}
        <Card
          className={`rounded-card border-border bg-surface cursor-pointer transition-colors ${
            goneOnly ? "ring-2 ring-warning" : "hover:border-warning/40"
          } ${goneCount > 0 ? "border-warning/40" : ""}`}
          onClick={() => {
            if (goneOnly) grid.setSelected("bill", []);
            else { grid.setSelected("bill", [GONE]); setClearView("uncleared"); }
            setCurrentPage(1);
          }}
          title="Open disputes whose bill has already left Tally's open bills — most likely settled. Click to show them."
        >
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Bill no longer open</div>
            <div className={`text-lg font-bold mt-1 ${goneCount > 0 ? "text-warning-foreground" : "text-foreground"}`}>
              {goneCount}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">open disputes to review and clear</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customer / bill / remark / item"
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
      </div>

      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          {allRows.length === 0 ? (
            /* Keyed on the UNFILTERED rows: "this list is empty", not "the filters matched nothing". */
            <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
              <FileText className="h-8 w-8 opacity-40" />
              No disputed bills{disputes.length > 0 ? " on the customers you can see" : " yet"}.
            </div>
          ) : (
            <ScrollableTable>
              <Table className="text-xs">
                <TableHeader>
                  {/* 1 + 6 + 3 + 3 + 3 + 1 = 17 columns */}
                  <TableRow className="bg-muted hover:bg-muted border-b-0">
                    <TableHead className={`${TH} ${STICKY_HEAD} h-6`} />
                    <TableHead className={`${TH} h-6`} colSpan={9} />
                    <TableHead
                      className={`${TH} h-6 text-center text-foreground border-x border-border`}
                      colSpan={3}
                      title="Live Tally figures for the bill. Settled = Amount − Pending."
                    >
                      As on {asOnLabel}
                    </TableHead>
                    <TableHead className={`${TH} h-6`} colSpan={4} />
                  </TableRow>
                  <TableRow className="bg-muted hover:bg-muted">
                    <SortHead label="Customer" className={`${TH} ${STICKY_HEAD} min-w-[220px]`} dir={grid.sortDir("customer")} onToggle={() => grid.toggleSort("customer")} />
                    <SortHead label="Company" className={TH} dir={grid.sortDir("company")} onToggle={() => grid.toggleSort("company")} />
                    <SortHead label="Location" className={TH} dir={grid.sortDir("location")} onToggle={() => grid.toggleSort("location")} />
                    <SortHead label="Team" className={TH} dir={grid.sortDir("collectionTeam")} onToggle={() => grid.toggleSort("collectionTeam")} />
                    <SortHead label="Salesperson" className={TH} dir={grid.sortDir("salesPerson")} onToggle={() => grid.toggleSort("salesPerson")} />
                    <SortHead label="Bill ref" className={TH} dir={grid.sortDir("billRef")} onToggle={() => grid.toggleSort("billRef")} />
                    <SortHead label="Bill" className={TH} dir={grid.sortDir("bill")} onToggle={() => grid.toggleSort("bill")} />
                    <SortHead label="Date" className={TH} dir={grid.sortDir("date")} onToggle={() => grid.toggleSort("date")} />
                    <SortHead label="Overdue" className={`${TH} text-right`} dir={grid.sortDir("overdue")} onToggle={() => grid.toggleSort("overdue")} />
                    <SortHead label="Sale type" className={TH} dir={grid.sortDir("saleType")} onToggle={() => grid.toggleSort("saleType")} />
                    <SortHead label="Amount" className={`${TH} text-right border-l border-border`} dir={grid.sortDir("amount")} onToggle={() => grid.toggleSort("amount")} />
                    <SortHead label="Pending" className={`${TH} text-right`} dir={grid.sortDir("pending")} onToggle={() => grid.toggleSort("pending")} />
                    <SortHead label="Settled" className={`${TH} text-right border-r border-border`} dir={grid.sortDir("settled")} onToggle={() => grid.toggleSort("settled")} />
                    <SortHead label="Item" className={TH} dir={grid.sortDir("item")} onToggle={() => grid.toggleSort("item")} />
                    <SortHead label="Remark" className={TH} dir={grid.sortDir("remarks")} onToggle={() => grid.toggleSort("remarks")} />
                    <SortHead label="Clear status" className={TH} dir={grid.sortDir("clear")} onToggle={() => grid.toggleSort("clear")} />
                    <TableHead className={`${TH} text-right`}>Actions</TableHead>
                  </TableRow>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className={`${TH} ${STICKY_HEAD} py-1`}>{filterCell("customer")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("company")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("location")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("collectionTeam")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("salesPerson")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("billRef")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("bill")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("date")}</TableHead>
                    {/* Overdue and the money carry no filter: every value is its own. They still sort. */}
                    <TableHead className={`${TH} py-1`} />
                    <TableHead className={`${TH} py-1`}>{filterCell("saleType")}</TableHead>
                    <TableHead className={`${TH} py-1`} colSpan={3} />
                    <TableHead className={`${TH} py-1`}>{filterCell("item")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("remarks")}</TableHead>
                    <TableHead className={`${TH} py-1`}>{filterCell("clear")}</TableHead>
                    <TableHead className={`${TH} py-1`} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedRows.map((r) => {
                    const mayClear = canClear(r.collectionTeam);
                    const isEditing = editing?.id === r.id;
                    // The prompt: an OPEN dispute on a bill Tally no longer holds.
                    const needsReview = !r.open && !r.cleared;
                    return (
                      <TableRow key={r.id} className={`hover:bg-muted/20 ${r.cleared ? "opacity-70" : ""}`}>
                        <TableCell className={`${TD} ${STICKY_BODY} font-medium`}>
                          <div className="max-w-[240px] truncate" title={r.customer}>{r.customer}</div>
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.company}</TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.location}</TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.collectionTeam || "—"}</TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>
                          <div className="max-w-[130px] truncate" title={r.salesPerson}>{r.salesPerson || "—"}</div>
                        </TableCell>
                        <TableCell className={`${TD} font-mono`}>{r.billRef}</TableCell>
                        <TableCell className={TD}>
                          {r.open ? (
                            <span className="text-muted-foreground">{OPEN}</span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                needsReview
                                  ? "border-warning/50 bg-warning/10 text-warning-foreground"
                                  : "border-border text-muted-foreground"
                              }`}
                              title={needsReview
                                ? "Tally no longer lists this bill as open — most likely it was settled. Check, then clear the dispute."
                                : "Tally no longer lists this bill as open."}
                            >
                              {needsReview && <AlertTriangle className="h-3 w-3" />}{GONE}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.date ? formatDateDMY(r.date) : "—"}</TableCell>
                        <TableCell className={`${TD} ${NUM} ${r.overdueDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {r.open ? (r.overdueDays > 0 ? r.overdueDays : "—") : ""}
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>{r.saleType || "—"}</TableCell>
                        <TableCell className={`${TD} ${NUM} border-l border-border`} title={r.isOpening ? "Opening bill — the balance owed when these books began" : undefined}>
                          {r.open ? inr(r.amount) : "—"}
                        </TableCell>
                        <TableCell className={`${TD} ${NUM} font-semibold`}>{r.open ? inr(r.pending) : "—"}</TableCell>
                        <TableCell className={`${TD} ${NUM} border-r border-border cursor-help`} title={settledTitle(r)}>
                          {r.open ? inr(r.settled) : "—"}
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground`}>
                          <div className="max-w-[180px] truncate" title={r.item}>{r.item || "—"}</div>
                        </TableCell>
                        <TableCell className={TD}>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <Input
                                autoFocus
                                value={editing.text}
                                disabled={editBusy}
                                onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void saveRemark();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                                className="h-7 w-72 text-xs"
                              />
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={editBusy}
                                onClick={() => void saveRemark()} title="Save the remark (Enter)">
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={editBusy}
                                onClick={() => setEditing(null)} title="Cancel (Esc)">
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 group">
                              <div className="max-w-[260px] truncate" title={r.cleared ? describeClear(r) : r.remarks}>
                                {r.remarks || <span className="text-muted-foreground">—</span>}
                              </div>
                              {canManage && (
                                <button
                                  className="opacity-40 group-hover:opacity-100 hover:text-foreground text-muted-foreground"
                                  onClick={() => setEditing({ id: r.id, text: r.remarks })}
                                  title="Edit the remark"
                                  aria-label={`Edit the remark on ${r.billRef}`}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={TD}><ClearStatusBadge row={r} copy={DISPUTE_COPY} /></TableCell>
                        <TableCell className={`${TD} text-right`}>
                          <Button
                            size="sm" variant="outline"
                            className={`h-6 gap-1 px-2 text-[11px] border-emerald-600/40 text-emerald-700 hover:text-emerald-700 dark:text-emerald-400 ${
                              needsReview && mayClear ? "ring-1 ring-warning" : ""
                            }`}
                            disabled={!mayClear}
                            title={mayClear
                              ? (r.cleared ? "Reopen this dispute" : "Clear — the dispute is settled; the record stays")
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
                      {/* The table stays standing: its filter row is the only way back. */}
                      <TableCell colSpan={17} className="text-center text-sm text-muted-foreground py-10">
                        <div className="flex flex-col items-center gap-2">
                          <span>
                            No disputed bills match the current filters
                            {clearView !== "all" ? ` in the ${clearView} view` : ""}.
                          </span>
                          <Button size="sm" variant="outline" onClick={clearFiltersAll}>Clear filters</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {filteredRows.length > 0 && (
                    /* 1 + 9 + 3 + 4 = 17 */
                    <TableRow className="bg-muted hover:bg-muted font-semibold border-t border-border">
                      <TableCell className={`${TD} ${STICKY_TOTAL} font-bold`}>
                        Total ({filteredRows.length} bill{filteredRows.length === 1 ? "" : "s"})
                      </TableCell>
                      <TableCell className={TD} colSpan={9} />
                      <TableCell className={`${TD} ${NUM} font-bold border-l border-border`}>{inr(totalAmount)}</TableCell>
                      <TableCell className={`${TD} ${NUM} font-bold`}>{inr(totalPending)}</TableCell>
                      <TableCell className={`${TD} ${NUM} font-bold border-r border-border`}>{inr(totalSettled)}</TableCell>
                      <TableCell className={TD} colSpan={4} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground max-w-5xl">
        Settled = Amount − Pending: everything knocked off the bill in Tally — receipts, credit notes,
        debit notes and journals, which Tally nets per bill without splitting them — plus manual Other
        Payments; hover a Settled figure for the split. A bill marked <span className="font-medium">No longer
        open</span> has left Tally's open bills, usually because it was settled, so the dispute is waiting
        to be cleared. These are bill-wise figures and do not tie to the Dashboard's ledger totals:
        bill-wise overdue reads about 7.8% higher.
      </p>

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
                  ),
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

      {canManage && (
        <AddDisputeDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          customers={dialogCustomers}
          billsOf={billsOf}
          existing={disputes}
          onAdded={() => void master.refetch()}
        />
      )}

      <ClearNoteDialog
        mode={clearing?.mode ?? null}
        subject={clearing ? `${clearing.row.billRef} · ${clearing.row.customer}` : ""}
        row={clearing?.row ?? null}
        busy={clearBusy}
        onCancel={() => setClearing(null)}
        onConfirm={(note) => void doClear(note)}
        copy={DISPUTE_COPY}
      />
    </div>
  );
}

/** Pinned to Both FYs — see the file header. */
export default function DisputedBillsReport() {
  return (
    <FYProvider>
      <DisputedBillsInner />
    </FYProvider>
  );
}
