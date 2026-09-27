import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeIndianRupee, ChevronDown, ChevronRight, Download, FileText, Lock } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Label } from "@hub/components/ui/label";
import { Switch } from "@hub/components/ui/switch";
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
import { useAppData } from "@hub/lib/useAppData";
import { FYProvider } from "@hub/lib/fyContext";
import { useHubBase, useReceivablesSource } from "@hub/lib/sourceContext";
import { formatDateDMY } from "@hub/lib/utils";
import { ColumnFilter, SortHead } from "@hub/components/gridColumns";
import { useColumnGrid, type ColumnGrid, type GridColumn } from "@hub/lib/useColumnGrid";
import {
  buildAdvanceRows, explainRow, groupBySalesperson, PAISA,
  type AdvanceRow, type Explanation, type ReceiptsStatus, type SalespersonGroup,
} from "@hub/lib/advancesReport";
import { loadOnAccountEntries, type OnAccountEntry } from "@hub/lib/onAccountEntries";
import { loadSuspenseReceipts, type SuspenseReceipt } from "@hub/lib/suspenseReceipts";
import { exportAdvancesXlsx } from "@hub/lib/exportAdvances";

/**
 * Advances Not Applied — money a customer has paid that no open invoice has absorbed (RC-18).
 *
 * Accounts cannot settle it without knowing which invoice it was meant for, and only the salesperson
 * knows. So the page lists every customer holding such money, grouped by salesperson, with the
 * entries behind the money and the open bills it could be settled against.
 *
 * ── The figure is UNCAPPED, on purpose ──
 * It is not the Collection Report's On Account, which collection_refresh() caps at the ledger's
 * overdue. See lib/advancesReport.ts. The capped figure stays on every row as the last column, so
 * the two screens can be reconciled.
 *
 * ── RELATED PARTY is its own section ──
 * Group-company balances (salesperson `RELATED PARTY`) were 71% of the capped money, and they are not
 * a customer advance a salesperson can place against an invoice. Mixed in, they would swamp every
 * total, so they sit in their own card and no total above them includes them.
 *
 * ── Scoped through the scoped customers ──
 * Rows come from `allCustomers`, which useAppData has already narrowed by salesperson AND collection
 * team. UI-level scoping only, like the rest of the hub.
 *
 * ── Pinned to Both FYs ──
 * Open bills and ledger balances are not FY-windowed, so a selector would change nothing. UserLayout
 * hides it on this route and the nested FYProvider below keeps the payload the Both-FYs one.
 */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return inr(n);
};
/** Full rupees; under ₹1 with paise, because ₹0.50 is real money and must not read as ₹1 or ₹0. */
const inr = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs > 0 && abs < 1) return `${sign}₹${abs.toFixed(2)}`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

const TH = "h-8 px-2.5 text-[11px] whitespace-nowrap";
const TD = "px-2.5 py-1.5 text-xs whitespace-nowrap";
const NUM = "text-right font-mono tabular-nums";
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

// ── Columns ──────────────────────────────────────────────────────────────────

/** One grid column: how it filters and sorts, how it draws, and whether it totals. */
interface AdvanceColumn extends GridColumn<AdvanceRow> {
  label: string;
  /** Right-aligned figure, summed on group headers and the total row. */
  sum?: (r: AdvanceRow) => number;
  /** Money figures render through `inr`; counts render as plain integers. */
  money?: boolean;
  headClass?: string;
  /** A vertical rule on this side of the column, carried through every row. */
  edge?: "left" | "right";
  cell: (r: AdvanceRow) => ReactNode;
  title?: string;
}

const dash = (s: string) => s || "—";
const edgeClass = (c: AdvanceColumn) =>
  c.edge === "left" ? "border-l border-border" : c.edge === "right" ? "border-r border-border" : "";

const STATUS_CLASS: Record<ReceiptsStatus, string> = {
  "All named": "text-emerald-700 dark:text-emerald-400",
  "Partly named": "text-foreground",
  "Opening balance only": "text-muted-foreground",
  "Doesn't reconcile": "text-warning-foreground",
  "Manual payment": "text-foreground",
  "No untagged money": "text-muted-foreground",
  "Loading…": "text-muted-foreground italic",
};
const STATUS_TITLE: Record<ReceiptsStatus, string> = {
  "All named": "Every rupee tagged to no bill is named by a voucher in Tally.",
  "Partly named": "Some of the money tagged to no bill is named by a voucher; the rest is opening balance with no receipt detail.",
  "Opening balance only": "No voucher in Tally explains the money tagged to no bill — it was keyed as an opening balance with no bill breakup.",
  "Doesn't reconcile": "Tally's vouchers add up to MORE than the money tagged to no bill, so none are listed rather than a list that doesn't add up.",
  "Manual payment": "The money tagged to no bill is a manual Other Payment recorded outside Tally.",
  "No untagged money": "All of this customer's unapplied credit sits on named references.",
  "Loading…": "Looking up the vouchers in Tally.",
};

function buildColumns(explanations: Map<string, Explanation>): AdvanceColumn[] {
  const statusOf = (r: AdvanceRow): ReceiptsStatus => explanations.get(r.ledgerId)?.status ?? "Loading…";
  const money = (
    key: string, label: string, get: (r: AdvanceRow) => number, extra?: Partial<AdvanceColumn>,
  ): AdvanceColumn => ({
    key, label, money: true, sum: get,
    value: (r) => inr(get(r)), sortValue: get, filter: false,
    cell: (r) => inr(get(r)),
    ...extra,
  });
  return [
    {
      key: "customer", label: "Customer", value: (r) => r.customer,
      headClass: `${STICKY_HEAD} min-w-[220px]`,
      cell: (r) => <div className="max-w-[240px] truncate font-medium" title={r.customer}>{r.customer}</div>,
    },
    { key: "company", label: "Company", value: (r) => r.company, cell: (r) => dash(r.company) },
    { key: "location", label: "Location", value: (r) => r.location, cell: (r) => dash(r.location) },
    {
      key: "salesPerson", label: "Salesperson", value: (r) => r.salesPerson,
      cell: (r) => <div className="max-w-[130px] truncate" title={r.salesPerson}>{dash(r.salesPerson)}</div>,
    },
    { key: "collectionTeam", label: "Team", value: (r) => r.collectionTeam, cell: (r) => dash(r.collectionTeam) },
    money("unapplied", "Unapplied credit", (r) => r.unapplied, {
      edge: "left",
      title: "Tagged to no bill + on a named ref: money received that no open invoice has absorbed.",
    }),
    money("untagged", "Tagged to no bill", (r) => r.untagged, {
      title: "Received against the customer with no bill named — ledger credit beyond its open bills. Includes any manual Other Payment left on account.",
    }),
    money("namedRef", "On a named ref", (r) => r.namedRef, {
      edge: "right",
      title: "Credit sitting on a named reference — an advance such as M/C ADV, or a bill paid more than it owed.",
    }),
    {
      key: "receipts", label: "Named in Tally", value: statusOf,
      title: "Whether Tally holds the vouchers (receipts, credit notes, journals) behind the money tagged to no bill. Expand the row to see them.",
      cell: (r) => {
        const s = statusOf(r);
        return <span className={STATUS_CLASS[s]} title={STATUS_TITLE[s]}>{s}</span>;
      },
    },
    {
      key: "openBills", label: "Open bills",
      value: (r) => String(r.openBills.length), sortValue: (r) => r.openBills.length,
      sum: (r) => r.openBills.length,
      title: "Invoices still owing that this money could be settled against.",
      cell: (r) => (r.openBills.length ? r.openBills.length : <span className="text-muted-foreground">0</span>),
    },
    money("openPending", "Pending on open bills", (r) => r.openPending),
    money("outstanding", "Outstanding", (r) => r.outstanding, {
      title: "The ledger's net balance. Negative = the customer is in credit overall.",
    }),
    money("onAccount", "On Account (Collection Report)", (r) => r.onAccount, {
      title: "The Collection Report's On Account: the same credit, but capped at this customer's overdue. Tie-back only.",
    }),
  ];
}

// ── The expanded row ─────────────────────────────────────────────────────────

const SUB_TH = "py-1 pr-3 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap";
const SUB_TD = "py-1 pr-3 align-top";

/**
 * What makes up one customer's advance, and what it could be settled against.
 *
 * The lines always add up to the row's figure: named voucher lines where Tally has them, and one
 * labelled line for whatever they do not explain — so a reader who adds up the receipts and gets less
 * than the total can see why, instead of distrusting both.
 */
function AdvanceDetail({ row, explanation }: { row: AdvanceRow; explanation: Explanation | undefined }) {
  const hubBase = useHubBase();
  const lines = explanation?.lines ?? [];
  const untaggedLines = lines.filter((l) => l.kind !== "namedRef");
  const refLines = lines.filter((l) => l.kind === "namedRef");
  const lineClass = (kind: string) =>
    kind === "unexplained" ? "italic text-muted-foreground"
      : kind === "rounding" ? "text-muted-foreground" : "text-foreground";

  return (
    // Pinned to the left edge of the scroller, so a wide grid never pushes the detail out of view.
    <div className="sticky left-0 grid max-w-[1180px] gap-6 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs font-semibold text-foreground">What makes up {inr(row.unapplied)}</div>
          <Link
            to={`${hubBase}/customer/${encodeURIComponent(row.customer)}`}
            className="text-[11px] text-primary hover:underline"
          >
            Open in Customer Detail
          </Link>
        </div>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr><th className={SUB_TH}>Date</th><th className={SUB_TH}>Entry</th><th className={`${SUB_TH} text-right`}>Amount</th></tr>
          </thead>
          <tbody>
            {row.untagged > PAISA && (
              <tr><td colSpan={3} className="pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tagged to no bill · {inr(row.untagged)}
              </td></tr>
            )}
            {untaggedLines.map((l, i) => (
              <tr key={`u-${i}`} className={lineClass(l.kind)}>
                <td className={`${SUB_TD} whitespace-nowrap`}>{l.date ? formatDateDMY(l.date) : ""}</td>
                <td className={`${SUB_TD} break-words`}>{l.label}</td>
                <td className={`${SUB_TD} ${NUM}`}>{inr(l.amount)}</td>
              </tr>
            ))}
            {explanation?.loading && (
              <tr><td colSpan={3} className={`${SUB_TD} italic text-muted-foreground`}>
                Looking up the vouchers behind {inr(row.tallyUntagged)} in Tally…
              </td></tr>
            )}
            {refLines.length > 0 && (
              <tr><td colSpan={3} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                On a named ref · {inr(row.namedRef)}
              </td></tr>
            )}
            {refLines.map((l, i) => (
              <tr key={`r-${i}`} className="text-foreground">
                <td className={`${SUB_TD} whitespace-nowrap`}>{l.date ? formatDateDMY(l.date) : ""}</td>
                <td className={`${SUB_TD} break-words`}>{l.label}</td>
                <td className={`${SUB_TD} ${NUM}`}>{inr(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold text-foreground">
              <td className={SUB_TD} />
              <td className={SUB_TD}>Unapplied credit</td>
              <td className={`${SUB_TD} ${NUM}`}>{inr(row.unapplied)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">
          Open bills to settle against
          {row.openBills.length > 0 && (
            <span className="font-normal text-muted-foreground">
              {" "}· {row.openBills.length} bill{row.openBills.length === 1 ? "" : "s"} · {inr(row.openPending)} pending
            </span>
          )}
        </div>
        {row.openBills.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No open bill to settle against yet.</p>
        ) : (
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className={SUB_TH}>Bill ref</th><th className={SUB_TH}>Date</th><th className={SUB_TH}>Due</th>
                  <th className={`${SUB_TH} text-right`}>Overdue days</th><th className={`${SUB_TH} text-right`}>Pending</th>
                </tr>
              </thead>
              <tbody>
                {row.openBills.map((b) => (
                  <tr key={b.id} className="text-foreground">
                    <td className={`${SUB_TD} font-mono whitespace-nowrap`}>{b.billRefName || b.number}</td>
                    <td className={`${SUB_TD} whitespace-nowrap`}>{b.date ? formatDateDMY(b.date) : "—"}</td>
                    <td className={`${SUB_TD} whitespace-nowrap`}>{b.dueDate ? formatDateDMY(b.dueDate) : "—"}</td>
                    <td className={`${SUB_TD} ${NUM} ${b.overdueDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {b.overdueDays > 0 ? b.overdueDays : "—"}
                    </td>
                    <td className={`${SUB_TD} ${NUM}`}>{inr(b.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Paging (shared by both grids and the suspense block) ─────────────────────

function usePaging<T>(items: T[]) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const effective = pageSize === "all" ? Math.max(1, items.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(items.length / effective));
  const page = Math.min(currentPage, totalPages);
  const slice = pageSize === "all" ? items : items.slice((page - 1) * effective, page * effective);
  return {
    slice,
    page,
    totalPages,
    pageSize,
    total: items.length,
    rangeStart: items.length === 0 ? 0 : (page - 1) * effective + 1,
    rangeEnd: Math.min(page * effective, items.length),
    setPage: setCurrentPage,
    setPageSize: (v: PageSize) => { setPageSize(v); setCurrentPage(1); },
  };
}

function PageControls({ paging }: { paging: ReturnType<typeof usePaging> }) {
  const { page, totalPages, pageSize, total, rangeStart, rangeEnd, setPage, setPageSize } = paging;
  if (total === 0) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-border">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(v === "all" ? "all" : Number(v) as PageSize)}>
          <SelectTrigger className="w-[90px] h-8 rounded-input border-border text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-input">
            {PAGE_SIZE_OPTIONS.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)}>{opt === "all" ? "All" : opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{rangeStart}–{rangeEnd} of {total}</span>
      </div>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setPage(Math.max(1, page - 1))}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {getPageWindow(page, totalPages).map((p, i) =>
              p === "..." ? (
                <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink isActive={p === page} onClick={() => setPage(p)} className="cursor-pointer">{p}</PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                aria-disabled={page === totalPages}
                className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

// ── The grid ─────────────────────────────────────────────────────────────────

type Group = SalespersonGroup;

function AdvanceGrid({ rows, grid, columns, grouped, emptyText, explanations }: {
  /** Unfiltered — decides "this list is empty" as opposed to "the filters matched nothing". */
  rows: AdvanceRow[];
  grid: ColumnGrid<AdvanceRow>;
  columns: AdvanceColumn[];
  grouped: boolean;
  emptyText: string;
  explanations: Map<string, Explanation>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const filtered = grid.rows;

  // Groups keep the grid's own sort inside them (see groupBySalesperson for the group order).
  const groups = useMemo<Group[]>(
    () => (grouped ? groupBySalesperson(filtered) : [{ name: "", rows: filtered }]),
    [filtered, grouped],
  );

  const flat = useMemo(
    () => groups.flatMap((g) => g.rows.map((row, i) => ({ row, group: g, first: i === 0 }))),
    [groups],
  );

  const paging = usePaging(flat);
  const pageRows = paging.slice;
  const colCount = columns.length;
  /** Columns before the first figure: the label cell spans them on group and total rows. */
  const lead = Math.max(1, columns.findIndex((c) => c.sum));

  const sumCells = (list: AdvanceRow[], strong: boolean) => columns.slice(lead).map((c) => (
    <TableCell
      key={c.key}
      className={`${TD} ${NUM} ${strong ? "font-bold" : "font-semibold"} ${edgeClass(c)}`}
    >
      {c.sum ? (c.money ? inr(list.reduce((s, r) => s + c.sum!(r), 0)) : list.reduce((s, r) => s + c.sum!(r), 0)) : ""}
    </TableCell>
  ));

  if (rows.length === 0) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <FileText className="h-8 w-8 opacity-40" />
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <ScrollableTable>
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              {columns.map((c) => (
                <SortHead
                  key={c.key}
                  label={c.label}
                  className={`${TH} ${c.sum ? "text-right" : ""} ${c.headClass ?? ""} ${edgeClass(c)}`}
                  dir={grid.sortDir(c.key)}
                  onToggle={() => grid.toggleSort(c.key)}
                />
              ))}
            </TableRow>
            <TableRow className="bg-muted hover:bg-muted">
              {columns.map((c, i) => (
                <TableHead key={c.key} className={`${TH} py-1 ${i === 0 ? STICKY_HEAD : ""}`}>
                  {/* Money carries no filter — every value is its own. It still sorts. */}
                  {c.filter === false ? null : (
                    <ColumnFilter
                      label="All"
                      options={grid.optionsFor(c.key)}
                      selected={grid.selected(c.key)}
                      onChange={(v) => { grid.setSelected(c.key, v); paging.setPage(1); }}
                      labelOf={grid.optionLabel}
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map(({ row, group, first }, i) => (
              <Fragment key={row.ledgerId}>
                {grouped && (first || i === 0) && (
                  <TableRow className="bg-muted hover:bg-muted border-t border-border">
                    <TableCell className={`${TD} ${STICKY_TOTAL} font-semibold text-foreground`}>
                      {group.name}{!first && <span className="font-normal text-muted-foreground"> (continued)</span>}
                      <span className="font-normal text-muted-foreground">
                        {" "}· {group.rows.length} customer{group.rows.length === 1 ? "" : "s"}
                      </span>
                    </TableCell>
                    {lead > 1 && <TableCell className={TD} colSpan={lead - 1} />}
                    {sumCells(group.rows, false)}
                  </TableRow>
                )}
                <TableRow className={`hover:bg-muted/20 ${expanded.has(row.ledgerId) ? "bg-muted/20" : ""}`}>
                  {columns.map((c, ci) => (
                    <TableCell
                      key={c.key}
                      title={ci === 0 ? undefined : c.title}
                      className={`${TD} ${ci === 0 ? STICKY_BODY : ""} ${c.sum ? NUM : "text-muted-foreground"} ${c.key === "unapplied" ? "font-semibold text-foreground" : ""} ${edgeClass(c)}`}
                    >
                      {ci === 0 ? (
                        <div className="flex items-center gap-1">
                          <button
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => toggle(row.ledgerId)}
                            aria-expanded={expanded.has(row.ledgerId)}
                            aria-label={`${expanded.has(row.ledgerId) ? "Hide" : "Show"} what makes up ${row.customer}'s advance`}
                            title="Show the receipts behind this money, and the open bills it could be settled against"
                          >
                            {expanded.has(row.ledgerId) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <span className="text-foreground">{c.cell(row)}</span>
                        </div>
                      ) : c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
                {expanded.has(row.ledgerId) && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount} className="p-0 bg-muted/20">
                      <AdvanceDetail row={row} explanation={explanations.get(row.ledgerId)} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}

            {filtered.length === 0 && (
              <TableRow>
                {/* The table stays standing: its filter row is the only way back. */}
                <TableCell colSpan={colCount} className="text-center text-sm text-muted-foreground py-10">
                  <div className="flex flex-col items-center gap-2">
                    <span>No customers match the current filters.</span>
                    <Button size="sm" variant="outline" onClick={() => { grid.clearFilters(); paging.setPage(1); }}>
                      Clear filters
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {filtered.length > 0 && (
              <TableRow className="bg-muted hover:bg-muted font-semibold border-t border-border">
                <TableCell className={`${TD} ${STICKY_TOTAL} font-bold`}>
                  Total ({filtered.length} customer{filtered.length === 1 ? "" : "s"})
                </TableCell>
                {lead > 1 && <TableCell className={TD} colSpan={lead - 1} />}
                {sumCells(filtered, true)}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      <PageControls paging={paging} />
    </>
  );
}

// ── Suspense ─────────────────────────────────────────────────────────────────

const referenceOf = (r: SuspenseReceipt) => r.voucherNo || r.narration || "";

interface SuspenseColumn extends GridColumn<SuspenseReceipt> {
  label: string;
  right?: boolean;
  cell: (r: SuspenseReceipt) => ReactNode;
}

const SUSPENSE_COLUMNS: SuspenseColumn[] = [
  { key: "date", label: "Date", value: (r) => (r.date ? formatDateDMY(r.date) : ""), sortValue: (r) => r.date, cell: (r) => (r.date ? formatDateDMY(r.date) : "—") },
  { key: "company", label: "Company", value: (r) => r.company, cell: (r) => dash(r.company) },
  { key: "location", label: "Location", value: (r) => r.location, cell: (r) => dash(r.location) },
  {
    key: "book", label: "Tally book", value: (r) => r.book,
    cell: (r) => <div className="max-w-[260px] truncate" title={r.book}>{r.book}</div>,
  },
  { key: "ledger", label: "Ledger", value: (r) => r.ledger, cell: (r) => dash(r.ledger) },
  { key: "voucherType", label: "Voucher type", value: (r) => r.voucherType, cell: (r) => dash(r.voucherType) },
  {
    // Every reference is its own, so it sorts but carries no filter.
    key: "reference", label: "Reference", value: referenceOf, filter: false,
    cell: (r) => <div className="max-w-[420px] truncate font-mono" title={referenceOf(r)}>{dash(referenceOf(r))}</div>,
  },
  {
    key: "amount", label: "Amount", value: (r) => inr(r.amount), sortValue: (r) => r.amount, filter: false, right: true,
    cell: (r) => inr(r.amount),
  },
];

/**
 * Receipts into the SUSPENSE ledgers — money in with no customer named. Worked by accounts as one
 * block, so it is not scoped and not grouped. See lib/suspenseReceipts.ts for why it is read on its
 * own, per real book, credits only.
 */
function SuspenseReceiptsBlock({ query }: { query: { data?: SuspenseReceipt[]; isLoading: boolean; error: unknown } }) {
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const grid = useColumnGrid(rows, SUSPENSE_COLUMNS);
  const paging = usePaging(grid.rows);
  const total = grid.rows.reduce((s, r) => s + r.amount, 0);

  return (
    <Card className="rounded-card border-border bg-surface">
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border">
          <div className="text-sm font-semibold text-foreground">Suspense — receipts that name no customer</div>
          <div className="text-xs text-muted-foreground mt-0.5 max-w-5xl">
            Money received into a SUSPENSE ledger, in every Tally book including closed financial years.
            Money in only: the large debit balances on the suspense ledgers are payments and opening
            entries, not advances. Not in any total above, and not limited to your customers — there is
            no customer to limit it by.
          </div>
        </div>
        {query.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading suspense receipts…</div>
        ) : query.error ? (
          <div className="p-6 text-sm text-destructive">
            Could not read the suspense receipts: {(query.error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <FileText className="h-8 w-8 opacity-40" />
            No money has been received into a suspense ledger.
          </div>
        ) : (
          <>
            <ScrollableTable>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    {SUSPENSE_COLUMNS.map((c) => (
                      <SortHead
                        key={c.key}
                        label={c.label}
                        className={`${TH} ${c.right ? "text-right" : ""}`}
                        dir={grid.sortDir(c.key)}
                        onToggle={() => grid.toggleSort(c.key)}
                      />
                    ))}
                  </TableRow>
                  <TableRow className="bg-muted hover:bg-muted">
                    {SUSPENSE_COLUMNS.map((c) => (
                      <TableHead key={c.key} className={`${TH} py-1`}>
                        {c.filter === false ? null : (
                          <ColumnFilter
                            label="All"
                            options={grid.optionsFor(c.key)}
                            selected={grid.selected(c.key)}
                            onChange={(v) => { grid.setSelected(c.key, v); paging.setPage(1); }}
                            labelOf={grid.optionLabel}
                          />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paging.slice.map((r) => (
                    <TableRow key={r.key} className="hover:bg-muted/20">
                      {SUSPENSE_COLUMNS.map((c) => (
                        <TableCell key={c.key} className={`${TD} ${c.right ? `${NUM} font-semibold` : "text-muted-foreground"}`}>
                          {c.cell(r)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {grid.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={SUSPENSE_COLUMNS.length} className="text-center text-sm text-muted-foreground py-8">
                        <div className="flex flex-col items-center gap-2">
                          <span>No suspense receipts match the current filters.</span>
                          <Button size="sm" variant="outline" onClick={() => { grid.clearFilters(); paging.setPage(1); }}>
                            Clear filters
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {grid.rows.length > 0 && (
                    <TableRow className="bg-muted hover:bg-muted font-semibold border-t border-border">
                      <TableCell className={`${TD} font-bold`} colSpan={SUSPENSE_COLUMNS.length - 1}>
                        Total ({grid.rows.length} receipt{grid.rows.length === 1 ? "" : "s"})
                      </TableCell>
                      <TableCell className={`${TD} ${NUM} font-bold`}>{inr(total)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
            <PageControls paging={paging} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────

/** Rows with nothing tagged to no bill need no lookup; an empty map lets them explain at once. */
const NO_ENTRIES = new Map<string, OnAccountEntry[]>();

function AdvancesInner() {
  const source = useReceivablesSource();
  // NO filters, deliberately: a sale-type filter strips bills and would inflate the figure.
  const { loading, error, allCustomers, customerDetail, dashboard } = useAppData();
  const [grouped, setGrouped] = useState(true);

  const asOfIso: string = dashboard?.asOfDate ?? "";
  const asOnLabel = asOfIso ? formatDateDMY(asOfIso) : "—";

  const allRows = useMemo(() => buildAdvanceRows(allCustomers, customerDetail), [allCustomers, customerDetail]);
  const mainRows = useMemo(() => allRows.filter((r) => !r.relatedParty), [allRows]);
  const relatedRows = useMemo(() => allRows.filter((r) => r.relatedParty), [allRows]);

  // The vouchers behind the money tagged to no bill — ONE batched lookup for every row that needs it
  // (loadOnAccountEntries splits by book, 30 ledgers a call, 4 in flight). Never per customer.
  // ⚠ "advanceEntries" must stay OUT of main.tsx's PERSISTED_QUERY_ROOTS: the result is a Map, which
  //   does not survive the JSON round trip into IndexedDB.
  const entryGuids = useMemo(
    () => allRows.filter((r) => r.tallyUntagged > PAISA).map((r) => r.ledgerId).sort(),
    [allRows],
  );
  const entries = useQuery({
    queryKey: ["advanceEntries", entryGuids],
    queryFn: () => loadOnAccountEntries(entryGuids),
    enabled: source === "connectwave" && entryGuids.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const entriesByLedger: Map<string, OnAccountEntry[]> | undefined =
    entryGuids.length === 0 ? NO_ENTRIES : entries.data;
  const explanations = useMemo(
    () => new Map(allRows.map((r) => [r.ledgerId, explainRow(r, entriesByLedger)])),
    [allRows, entriesByLedger],
  );

  // Suspense receipts name no customer, so this read is not scoped. Not a persisted root either.
  const suspense = useQuery({
    queryKey: ["suspenseReceipts"],
    queryFn: loadSuspenseReceipts,
    enabled: source === "connectwave",
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const suspenseTotal = (suspense.data ?? []).reduce((s, r) => s + r.amount, 0);

  const columns = useMemo(() => buildColumns(explanations), [explanations]);
  const mainGrid = useColumnGrid(mainRows, columns);
  const relatedGrid = useColumnGrid(relatedRows, columns);

  const shown = mainGrid.rows;
  const sum = (list: AdvanceRow[], get: (r: AdvanceRow) => number) => list.reduce((s, r) => s + get(r), 0);
  const relatedTotal = sum(relatedRows, (r) => r.unapplied);
  const namedInTally = sum(shown, (r) => explanations.get(r.ledgerId)?.namedInTally ?? 0);
  // The workbook carries every line behind every figure, so it waits for the voucher lookup.
  const entriesReady = !allRows.some((r) => explanations.get(r.ledgerId)?.loading);
  const doExport = () => exportAdvancesXlsx({
    asOfIso,
    asOnLabel,
    main: mainGrid.rows,
    related: relatedGrid.rows,
    grouped,
    explanations,
    suspense: suspense.error ? null : (suspense.data ?? []),
    suspenseError: suspense.error ? (suspense.error as Error).message : undefined,
  });
  const namedCustomers = shown.filter((r) => (explanations.get(r.ledgerId)?.namedInTally ?? 0) > PAISA).length;

  if (source === "default") {
    return (
      <div className="p-6 max-w-[900px] mx-auto space-y-4">
        <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="p-10 flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <BadgeIndianRupee className="h-5 w-5 text-primary" /> Advances Not Applied
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
              This report reads live Tally ledger balances and voucher lines, so it is only available on
              the <strong>Live (Tally)</strong> view. Switch on <strong>Live (Tally)</strong> in the top
              bar to use it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading advances…</div>;
  if (error) return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BadgeIndianRupee className="h-6 w-6 text-primary" /> Advances Not Applied
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-5xl">
            Money a customer has paid that no open invoice has absorbed — received with no bill named, or
            sitting on a named reference such as an advance. Ask the salesperson which invoice it belongs
            to. <span className="font-medium text-foreground">As on {asOnLabel}</span>, live from Tally.
            This is the whole of it, so it is larger than the Collection Report's On Account, which counts
            only the part that offsets overdue; that figure is the last column.
          </p>
        </div>
        <Button
          onClick={doExport}
          disabled={!entriesReady || suspense.isLoading || allRows.length === 0}
          className="rounded-button gap-2"
          title={entriesReady ? "The rows shown, with every entry behind them" : "Waiting for the voucher lookup to finish"}
        >
          <Download className="h-4 w-4" /> {entriesReady && !suspense.isLoading ? "Export Excel" : "Loading entries…"}
        </Button>
      </div>

      {/* Summary strip — the rows shown in the main grid, filters applied. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Unapplied credit", value: fmt(sum(shown, (r) => r.unapplied)), sub: `${shown.length} customer${shown.length === 1 ? "" : "s"} in the rows shown` },
          { label: "Tagged to no bill", value: fmt(sum(shown, (r) => r.untagged)), sub: "received with no bill named" },
          { label: "On a named ref", value: fmt(sum(shown, (r) => r.namedRef)), sub: "an advance, or a bill paid more than it owed" },
          {
            // The honesty tile: most of the money tagged to no bill has no voucher behind it at all.
            label: "Named in Tally",
            value: entries.isLoading ? "…" : fmt(namedInTally),
            sub: entries.isLoading
              ? "looking up the vouchers"
              : `vouchers behind ${fmt(sum(shown, (r) => r.tallyUntagged))} tagged to no bill · ${namedCustomers} customer${namedCustomers === 1 ? "" : "s"}; the rest has none to list`,
          },
          { label: "No open bill", value: String(shown.filter((r) => r.openBills.length === 0).length), sub: "customers with nothing to settle against yet" },
        ].map((s) => (
          <Card key={s.label} className="rounded-card border-border bg-surface">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{s.value}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Not in these totals: <span className="font-medium text-foreground">Related party {fmt(relatedTotal)}</span>{" "}
        ({relatedRows.length} group-company ledger{relatedRows.length === 1 ? "" : "s"}) and{" "}
        <span className="font-medium text-foreground">
          Suspense {suspense.isLoading ? "…" : suspense.error ? "(could not be read)" : fmt(suspenseTotal)}
        </span>{" "}
        ({suspense.data?.length ?? 0} receipt{suspense.data?.length === 1 ? "" : "s"} naming no customer), both listed separately below.
      </p>

      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <div className="text-sm font-semibold text-foreground">Customers</div>
            <div className="flex items-center gap-2">
              <Switch id="advances-group" checked={grouped} onCheckedChange={setGrouped} />
              <Label htmlFor="advances-group" className="text-xs text-muted-foreground cursor-pointer">Group by salesperson</Label>
            </div>
          </div>
          <AdvanceGrid
            rows={mainRows}
            grid={mainGrid}
            columns={columns}
            grouped={grouped}
            explanations={explanations}
            emptyText="No customer you can see is holding unapplied credit."
          />
        </CardContent>
      </Card>

      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-sm font-semibold text-foreground">Related party — group-company balances</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Ledgers whose salesperson is RELATED PARTY. Not a customer advance, and not in any total above.
            </div>
          </div>
          <AdvanceGrid
            rows={relatedRows}
            grid={relatedGrid}
            columns={columns}
            grouped={false}
            explanations={explanations}
            emptyText="No related-party ledger you can see is holding unapplied credit."
          />
        </CardContent>
      </Card>

      <SuspenseReceiptsBlock query={suspense} />
    </div>
  );
}

/** Pinned to Both FYs — see the file header. */
export default function AdvancesReport() {
  return (
    <FYProvider>
      <AdvancesInner />
    </FYProvider>
  );
}
