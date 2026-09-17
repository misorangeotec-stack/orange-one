import { Fragment } from "react";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { ColumnFilter, SortHead } from "@hub/components/gridColumns";
import type { ColumnGrid } from "@hub/lib/useColumnGrid";
import { fmtINRMoney } from "@hub/lib/utils";
import {
  CELL_FIELDS, cellKey, daysState, isoToDisplay, lastTxnTip, limitState,
  type CustomerColumn, type CustomerRow, type PivotLedger,
} from "@hub/lib/creditTermsPivot";

/**
 * Credit Terms Not Set — the By customer grid (RC-19).
 *
 * One row per customer, a block of four columns per shown book. Styled to match the Disputed Bills
 * grid on purpose — same header band, sort row, filter row, sticky name column, row density and total
 * row — so the two reports read as one family.
 *
 * ── Exactly ONE background class per cell ──
 * A cell can be red (a gap), blue (days set on the bills) and in an alternate block all at once.
 * Handing Tailwind two bg-* classes leaves the winner to stylesheet order, not to the code, so the
 * priority is decided here: red, then blue, then the alternate-block shade.
 */

const TH = "h-8 px-2.5 text-[11px] whitespace-nowrap";
const TD = "px-2.5 py-1.5 text-xs whitespace-nowrap";
const NUM = "text-right font-mono tabular-nums";
const STICKY_EDGE = "shadow-[1px_0_0_0_hsl(var(--border))]";
const STICKY_HEAD = `sticky left-0 z-[2] bg-muted ${STICKY_EDGE}`;
const STICKY_BODY = `sticky left-0 z-[1] bg-surface ${STICKY_EDGE}`;
const STICKY_TOTAL = `sticky left-0 z-[1] bg-muted ${STICKY_EDGE}`;
/** Opens a book's block, so the eye can find where one company ends and the next begins. */
const BLOCK_EDGE = "border-l border-border";

export const FILL_RED = "bg-destructive/10";
export const FILL_BILLS = "bg-sky-500/10";
const FILL_ALT = "bg-muted/60";

const fillOf = (state: string, bookIndex: number) =>
  state === "missing" || state === "blocked" ? FILL_RED
  : state === "bills" ? FILL_BILLS
  : bookIndex % 2 === 1 ? FILL_ALT
  : "";

export default function CreditTermsCustomerGrid<L extends PivotLedger>({
  grid, columns, shownBooks, pageRows, onFilterChange, onClearAll, help,
}: {
  grid: ColumnGrid<CustomerRow<L>>;
  columns: CustomerColumn<L>[];
  shownBooks: string[];
  /** This page of grid.rows. */
  pageRows: CustomerRow<L>[];
  /** Called after any column filter changes — the page resets to page 1. */
  onFilterChange: () => void;
  /** Clears the page's filters AND the column filters. */
  onClearAll: () => void;
  help: Record<string, string>;
}) {
  const colCount = columns.length;
  const byKey = new Map(columns.map((c) => [c.key, c]));

  const sortHead = (key: string, className: string, title?: string) => (
    <SortHead
      key={key}
      label={byKey.get(key)?.label ?? key}
      className={className}
      title={title}
      dir={grid.sortDir(key)}
      onToggle={() => grid.toggleSort(key)}
    />
  );

  const filterHead = (key: string, className: string) => {
    const col = byKey.get(key);
    return (
      <TableHead key={key} className={`${TH} py-1 ${className}`}>
        {col && col.filter !== false && (
          <ColumnFilter
            label="All"
            options={grid.optionsFor(key)}
            selected={grid.selected(key)}
            onChange={(v) => { grid.setSelected(key, v); onFilterChange(); }}
            labelOf={grid.optionLabel}
          />
        )}
      </TableHead>
    );
  };

  const edge = (i: number, field: string) => (field === "days" ? BLOCK_EDGE : "") + (i === shownBooks.length - 1 && field === "outstanding" ? " border-r border-border" : "");

  return (
    <Card className="rounded-card border-border bg-surface">
      <CardContent className="p-0">
        <ScrollableTable>
          <Table className="text-xs">
            <TableHeader>
              {/* 3 + 4 per shown book */}
              <TableRow className="bg-muted hover:bg-muted border-b-0">
                <TableHead className={`${TH} ${STICKY_HEAD} h-6`} />
                <TableHead className={`${TH} h-6`} colSpan={2} />
                {shownBooks.map((book, i) => (
                  <TableHead
                    key={book}
                    colSpan={4}
                    className={`${TH} h-6 text-center font-semibold text-foreground ${BLOCK_EDGE} ${
                      i === shownBooks.length - 1 ? "border-r border-border" : ""} ${i % 2 === 1 ? "bg-foreground/5" : ""}`}
                    title={`${book}: credit days, credit limit, customer since and balance on this book's ledger`}
                  >
                    {book}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow className="bg-muted hover:bg-muted">
                {sortHead("customer", `${TH} ${STICKY_HEAD} min-w-[240px]`, help.customer)}
                {sortHead("books", `${TH} text-right`, help.books)}
                {sortHead("lastTxn", TH, help.lastTransaction)}
                {shownBooks.map((book, i) => (
                  <Fragment key={book}>
                    {sortHead(cellKey(book, "days"), `${TH} text-right ${edge(i, "days")}`, help.days)}
                    {sortHead(cellKey(book, "limit"), `${TH} text-right`, help.limit)}
                    {sortHead(cellKey(book, "since"), TH, help.customerSince)}
                    {sortHead(cellKey(book, "outstanding"), `${TH} text-right ${edge(i, "outstanding")}`, help.bookOutstanding)}
                  </Fragment>
                ))}
              </TableRow>
              <TableRow className="bg-muted hover:bg-muted">
                {filterHead("customer", STICKY_HEAD)}
                {filterHead("books", "")}
                {filterHead("lastTxn", "")}
                {shownBooks.map((book, i) => (
                  <Fragment key={book}>
                    {CELL_FIELDS.map((f) => filterHead(cellKey(book, f), edge(i, f)))}
                  </Fragment>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {pageRows.map((c) => (
                // h-9 matches the Disputed Bills rows, whose Actions button sets their height.
                <TableRow key={c.name} className="h-9 hover:bg-muted/20">
                  <TableCell className={`${TD} ${STICKY_BODY} font-medium`}>
                    <div className="flex items-center gap-1.5 max-w-[320px]">
                      <span className="truncate" title={c.name}>{c.name}</span>
                      {c.redMarkBooks.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 rounded-button bg-destructive/15 text-destructive border-destructive/30 shrink-0"
                          title={`Red Mark in ${c.redMarkBooks.join(", ")}`}
                        >
                          Red Mark
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className={`${TD} ${NUM}`} title={c.bookNames.join("\n")}>{c.bookNames.length}</TableCell>
                  <TableCell className={`${TD} text-muted-foreground`} title={lastTxnTip(c.lastTxn.iso, c.lastTxn.kind)}>
                    {isoToDisplay(c.lastTxn.iso) || "—"}
                  </TableCell>
                  {shownBooks.map((book, i) => {
                    const l = c.cells[book];
                    const ds = daysState(l);
                    const ls = limitState(l);
                    const plain = fillOf("", i);
                    const dup = c.dupBooks.includes(book)
                      ? " Two ledgers carry this exact name in this book; the one with the larger balance is shown."
                      : "";
                    return (
                      <Fragment key={book}>
                        <TableCell
                          className={`${TD} ${NUM} ${BLOCK_EDGE} ${fillOf(ds, i)}`}
                          title={
                            ds === "na" ? "Not open in this book"
                            : ds === "bills" ? `No credit days on the ledger, but ${l!.billWiseBills} open bill${l!.billWiseBills === 1 ? "" : "s"} carry their own due date — controlled from the bills`
                            : ds === "missing" ? "Open in this book with no credit days" + dup
                            : undefined
                          }
                        >
                          {ds === "na" ? <span className="text-muted-foreground/60">NA</span> : ds === "set" ? l!.creditDays : ""}
                        </TableCell>
                        <TableCell
                          className={`${TD} ${NUM} ${fillOf(ls, i)}`}
                          title={
                            ls === "na" ? "Not open in this book"
                            : ls === "blocked" ? "A limit of ₹1 is an old Tally marker for 'blocked', not a credit limit. Counted as not set."
                            : ls === "missing" ? "Open in this book with no credit limit"
                            : undefined
                          }
                        >
                          {ls === "na" ? <span className="text-muted-foreground/60">NA</span>
                            : ls === "set" ? fmtINRMoney(l!.creditLimit)
                            : ls === "blocked" ? (
                              <span className="inline-flex items-center gap-1">
                                ₹1
                                <Badge variant="outline" className="text-[10px] px-1 py-0 rounded-button text-destructive border-destructive/40">
                                  blocked
                                </Badge>
                              </span>
                            ) : ""}
                        </TableCell>
                        <TableCell className={`${TD} text-muted-foreground ${plain}`} title={l ? l.sinceTip : undefined}>
                          {l ? isoToDisplay(l.sinceIso) : ""}
                        </TableCell>
                        <TableCell className={`${TD} ${NUM} ${plain} ${edge(i, "outstanding")}`}>
                          {l ? fmtINRMoney(l.outstanding) : ""}
                        </TableCell>
                      </Fragment>
                    );
                  })}
                </TableRow>
              ))}

              {grid.rows.length === 0 && (
                <TableRow>
                  {/* The table stays standing: its filter row is the only way back. */}
                  <TableCell colSpan={colCount} className="text-center text-sm text-muted-foreground py-10">
                    <div className="flex flex-col items-center gap-2">
                      <span>No customers match the current filters.</span>
                      <Button size="sm" variant="outline" onClick={onClearAll}>Clear filters</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {grid.rows.length > 0 && (
                // A count, not a money total: each block's Outstanding is a raw balance and may be
                // negative, and a net figure here would contradict the panel's positive-only "owed".
                <TableRow className="bg-muted hover:bg-muted font-semibold border-t border-border">
                  <TableCell className={`${TD} ${STICKY_TOTAL} font-bold`}>
                    Total ({grid.rows.length} customer{grid.rows.length === 1 ? "" : "s"})
                  </TableCell>
                  <TableCell className={TD} colSpan={colCount - 1} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </CardContent>
    </Card>
  );
}
