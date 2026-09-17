import { useMemo, useState } from "react";
import { Button } from "@hub/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious,
} from "@hub/components/ui/pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { ColumnFilter, SortHead } from "@hub/components/gridColumns";
import { useColumnGrid, type GridColumn } from "@hub/lib/useColumnGrid";

import type { PartyKind } from "../data/dailyReport";
import {
  cellFoc, companyColumnLabel, FOLD_SHARE, foldList,
  type PivotCell, type PivotCompany, type PivotRow,
} from "../lib/aggregate";
import { listNoun } from "../lib/labels";
import { fmtLacs, fmtQty } from "../lib/format";

/**
 * One Daily Report list — a product line's customers, or one money band's parties — with the
 * companies across the top and the fold rule applied.
 *
 * ── MODELLED ON THE DISPUTED BILLS AND RED MARK REPORTS, AND BUILT FROM THEIR PARTS ──
 * The first cut drew these lists in the portal's QueueTable, and on a real day (16-09-2026) it did
 * not read: roomy rows, customer names wrapping onto three lines, "Enterprise ₹ L" headers breaking
 * in two, and a filter pill under every figure. Ritesh Bhai's team reads the Disputed Bills screen
 * comfortably, so this is that screen's grid, with the same pieces:
 *   · one line per row — 12px type, 6px padding, nothing wraps; a long name truncates and the full
 *     name is on hover, in a customer column that stays put while the figures scroll;
 *   · figures right-aligned in tabular digits;
 *   · a GROUP header naming each company once over its "kg | ₹ L" pair, so no header has to carry
 *     two words and a company name;
 *   · sort on every column (useColumnGrid) and a searchable filter under Customer. The figure
 *     columns carry no filter — every value is its own, which is exactly the case the house rule
 *     exempts, and the Disputed Bills screen does the same for its money;
 *   · the Remaining line and the TOTAL drawn AFTER the rows, as that screen draws its total — never
 *     rows of the data, so no sort can lift "Remaining 15 customers" to the top and no filter can
 *     hide the TOTAL.
 *
 * The fold itself is `foldList` in aggregate.ts; this only draws it.
 */

const TH = "h-8 px-2.5 text-[11px] whitespace-nowrap";
const TD = "px-2.5 py-1.5 text-xs whitespace-nowrap";
const NUM = "text-right tabular-nums";
const STICKY_EDGE = "shadow-[1px_0_0_0_hsl(var(--border))]";
const STICKY_HEAD = `sticky left-0 z-[2] bg-muted ${STICKY_EDGE}`;
const STICKY_BODY = `sticky left-0 z-[1] bg-surface ${STICKY_EDGE}`;
const STICKY_FOOT = `sticky left-0 z-[1] bg-muted ${STICKY_EDGE}`;
/** Opens a company's column group, so the eye can tell O-tec's pair from Enterprise's. */
const GROUP_EDGE = "border-l border-border";

const PAGE_SIZE_OPTIONS = [25, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const FocBadge = () => (
  <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
    FOC
  </span>
);

export default function PivotGrid({
  rows, companies, unit, noun,
}: {
  rows: PivotRow[];
  /** The page's company columns, in print order — shared by every list on the page. */
  companies: PivotCompany[];
  /** "kg" for ink, "qty" for countable goods, null for money — which has no quantity. */
  unit: "kg" | "qty" | null;
  noun: PartyKind | "sales";
}) {
  // Opens FOLDED (decision 8, 17-09-2026). The caller keys this on date and location, so a new day
  // never opens already expanded.
  const [showAll, setShowAll] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [page, setPage] = useState(1);

  const fold = useMemo(() => foldList(rows), [rows]);
  const folds = fold.remaining !== null;
  const expanded = showAll || !folds;
  // Free-of-charge-only customers are real customers, so they stay in the sortable body; the list
  // opens biggest first, which puts them at its foot.
  const body = useMemo(
    () => (expanded ? fold.all : [...fold.named, ...fold.focOnly]),
    [expanded, fold],
  );

  const showTotals = companies.length > 1;
  const plural = listNoun(noun, 2);
  const nameHeader = noun === "sales" || noun === "customer" ? "Customer" : noun === "vendor" ? "Supplier" : "Party";
  const qtyHeader = unit === "kg" ? "kg" : "Qty";

  const columns = useMemo<GridColumn<PivotRow>[]>(() => [
    { key: "party", value: (r) => r.party },
    ...companies.flatMap((co): GridColumn<PivotRow>[] => [
      ...(unit === null ? [] : [{
        key: `${co.alias}|qty`, value: (r: PivotRow) => String(r.cells[co.alias]?.qty ?? ""),
        sortValue: (r: PivotRow) => r.cells[co.alias]?.qty ?? 0, filter: false,
      }]),
      {
        key: `${co.alias}|amount`, value: (r: PivotRow) => String(r.cells[co.alias]?.amountLacs ?? ""),
        sortValue: (r: PivotRow) => r.cells[co.alias]?.amountLacs ?? 0, filter: false,
      },
    ]),
    ...(showTotals
      ? [
          ...(unit === null ? [] : [{ key: "total|qty", value: (r: PivotRow) => String(r.qty), sortValue: (r: PivotRow) => r.qty, filter: false }]),
          { key: "total|amount", value: (r: PivotRow) => String(r.amountLacs), sortValue: (r: PivotRow) => r.amountLacs, filter: false },
        ]
      : []),
  ], [companies, unit, showTotals]);

  const grid = useColumnGrid(body, columns);
  const shown = grid.rows;

  const effectiveSize = pageSize === "all" ? Math.max(1, shown.length) : pageSize;
  const totalPages = Math.max(1, Math.ceil(shown.length / effectiveSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = pageSize === "all" ? shown : shown.slice((safePage - 1) * effectiveSize, safePage * effectiveSize);

  const qtyText = (n: number) => (unit === "kg" ? Math.round(n).toLocaleString("en-IN") : fmtQty(n));
  const whole = (t: { qty: number; amountLacs: number; focQty: number }): PivotCell =>
    ({ qty: t.qty, amountLacs: t.amountLacs, focQty: t.focQty });

  const qtyCell = (c: PivotCell | undefined) =>
    !c ? null : (
      <>
        {qtyText(c.qty)}
        {cellFoc(c) === "part" && (
          <span className="ml-1 text-[10px] font-semibold text-primary">({qtyText(c.focQty)} FOC)</span>
        )}
      </>
    );
  // A cell that went entirely free has quantity and no money. A bare 0.00 in a money column reads
  // as a data fault, so it says FOC.
  const amountCell = (c: PivotCell | undefined) =>
    !c ? null : unit !== null && cellFoc(c) === "all" ? <FocBadge /> : fmtLacs(c.amountLacs);

  /** The figure cells of one line, in column order — rows, Remaining and TOTAL alike. */
  const figureCells = (cell: (alias: string) => PivotCell | undefined, all: PivotCell, strong: boolean) => (
    <>
      {companies.map((co) => (
        <FigurePair key={co.alias} unit={unit} c={cell(co.alias)} qtyCell={qtyCell} amountCell={amountCell} />
      ))}
      {showTotals && (
        <>
          {unit !== null && <TableCell className={`${TD} ${NUM} ${GROUP_EDGE}`}>{qtyCell(all)}</TableCell>}
          <TableCell className={`${TD} ${NUM} ${unit === null ? GROUP_EDGE : ""} ${strong ? "font-bold" : "font-semibold"}`}>
            {amountCell(all)}
          </TableCell>
        </>
      )}
    </>
  );

  const figureColumns = companies.length * (unit === null ? 1 : 2) + (showTotals ? (unit === null ? 1 : 2) : 0);

  return (
    <div className="space-y-2">
      {folds && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {expanded ? (
            <span>All {fold.all.length} {plural}.</span>
          ) : (
            <span>
              The {fold.named.length} {listNoun(noun, fold.named.length)} making up{" "}
              {Math.round(FOLD_SHARE * 100)}% of the total
              {fold.focOnly.length > 0 && <>, and every free-of-charge {listNoun(noun, 1)}</>}; the other{" "}
              {fold.remaining?.count} are folded into one line.
            </span>
          )}
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={() => { setShowAll((v) => !v); setPage(1); }}
          >
            {expanded ? `Show the top ${plural} only` : `Show all ${fold.all.length} ${plural}`}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <ScrollableTable>
          <Table className="text-xs">
            <TableHeader>
              {unit !== null && (
                // The company named ONCE over its pair of columns.
                <TableRow className="bg-muted hover:bg-muted border-b-0">
                  <TableHead className={`${TH} ${STICKY_HEAD} h-6`} />
                  {companies.map((co) => (
                    <TableHead
                      key={co.alias}
                      colSpan={2}
                      className={`${TH} h-6 text-center font-semibold text-foreground ${GROUP_EDGE} ${co.unmapped ? "text-destructive" : ""}`}
                      title={co.unmapped ? "A Tally book missing from the company map. Tag it in Settings → Masters → Companies & Locations." : undefined}
                    >
                      {companyColumnLabel(co)}
                    </TableHead>
                  ))}
                  {showTotals && (
                    <TableHead colSpan={2} className={`${TH} h-6 text-center font-semibold text-foreground ${GROUP_EDGE}`}>
                      Total
                    </TableHead>
                  )}
                </TableRow>
              )}
              <TableRow className="bg-muted hover:bg-muted">
                <SortHead
                  label={nameHeader}
                  className={`${TH} ${STICKY_HEAD} min-w-[220px]`}
                  dir={grid.sortDir("party")}
                  onToggle={() => grid.toggleSort("party")}
                />
                {companies.map((co) =>
                  unit === null ? (
                    <SortHead
                      key={co.alias}
                      label={`${companyColumnLabel(co)} ₹ L`}
                      className={`${TH} text-right ${GROUP_EDGE}`}
                      dir={grid.sortDir(`${co.alias}|amount`)}
                      onToggle={() => grid.toggleSort(`${co.alias}|amount`)}
                    />
                  ) : (
                    <Pair key={co.alias}>
                      <SortHead
                        label={qtyHeader}
                        className={`${TH} text-right ${GROUP_EDGE}`}
                        dir={grid.sortDir(`${co.alias}|qty`)}
                        onToggle={() => grid.toggleSort(`${co.alias}|qty`)}
                      />
                      <SortHead
                        label="₹ L"
                        className={`${TH} text-right`}
                        dir={grid.sortDir(`${co.alias}|amount`)}
                        onToggle={() => grid.toggleSort(`${co.alias}|amount`)}
                      />
                    </Pair>
                  ),
                )}
                {showTotals && unit !== null && (
                  <SortHead
                    label={qtyHeader}
                    className={`${TH} text-right ${GROUP_EDGE}`}
                    dir={grid.sortDir("total|qty")}
                    onToggle={() => grid.toggleSort("total|qty")}
                  />
                )}
                {showTotals && (
                  <SortHead
                    label={unit === null ? "Total ₹ L" : "₹ L"}
                    className={`${TH} text-right ${unit === null ? GROUP_EDGE : ""}`}
                    dir={grid.sortDir("total|amount")}
                    onToggle={() => grid.toggleSort("total|amount")}
                  />
                )}
              </TableRow>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className={`${TH} ${STICKY_HEAD} py-1`}>
                  <ColumnFilter
                    label="All"
                    options={grid.optionsFor("party")}
                    selected={grid.selected("party")}
                    onChange={(v) => { grid.setSelected("party", v); setPage(1); }}
                    labelOf={grid.optionLabel}
                  />
                </TableHead>
                {/* The figures carry no filter: every value is its own. They still sort. */}
                <TableHead className={`${TH} py-1`} colSpan={figureColumns} />
              </TableRow>
            </TableHeader>

            <TableBody>
              {pageRows.map((r) => (
                <TableRow key={r.party} className="hover:bg-muted/20">
                  <TableCell className={`${TD} ${STICKY_BODY} font-medium`}>
                    <div
                      className="max-w-[420px] truncate"
                      title={unit === null && r.refs.length
                        ? `${r.party}\n${r.entries} ${r.entries === 1 ? "entry" : "entries"}: ${r.refs.join(", ")}`
                        : r.party}
                    >
                      {r.party}
                    </div>
                  </TableCell>
                  {figureCells((a) => r.cells[a], whole(r), false)}
                </TableRow>
              ))}

              {shown.length === 0 && (
                <TableRow>
                  {/* The table stays standing: its filter row is the only way back. */}
                  <TableCell colSpan={1 + figureColumns} className="py-8 text-center text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <span>No {plural} match the filter.</span>
                      <Button size="sm" variant="outline" onClick={() => { grid.clearFilters(); setPage(1); }}>
                        Clear filters
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {!expanded && fold.remaining && (
                <TableRow className="text-muted-foreground hover:bg-transparent">
                  <TableCell className={`${TD} ${STICKY_BODY}`}>
                    Remaining {fold.remaining.count} {listNoun(noun, fold.remaining.count)}
                  </TableCell>
                  {figureCells((a) => fold.remaining?.cells[a], whole(fold.remaining), false)}
                </TableRow>
              )}

              <TableRow className="bg-muted hover:bg-muted font-semibold border-t border-border">
                <TableCell className={`${TD} ${STICKY_FOOT} font-bold`}>
                  TOTAL ({fold.all.length} {listNoun(noun, fold.all.length)})
                </TableCell>
                {figureCells((a) => fold.total.cells[a], whole(fold.total), true)}
              </TableRow>
            </TableBody>
          </Table>
        </ScrollableTable>
      </div>

      {shown.length > 25 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground">Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(v === "all" ? "all" : (Number(v) as PageSize)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-[80px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((o) => (
                  <SelectItem key={String(o)} value={String(o)}>{o === "all" ? "All" : o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {(safePage - 1) * effectiveSize + 1}–{Math.min(safePage * effectiveSize, shown.length)} of {shown.length}
            </span>
          </div>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-disabled={safePage === 1}
                    className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={safePage === totalPages}
                    className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}

/** One company's cells: its quantity (goods only) and its amount. */
function FigurePair({
  unit, c, qtyCell, amountCell,
}: {
  unit: "kg" | "qty" | null;
  c: PivotCell | undefined;
  qtyCell: (c: PivotCell | undefined) => React.ReactNode;
  amountCell: (c: PivotCell | undefined) => React.ReactNode;
}) {
  if (unit === null) return <TableCell className={`${TD} ${NUM} ${GROUP_EDGE}`}>{amountCell(c)}</TableCell>;
  return (
    <>
      <TableCell className={`${TD} ${NUM} ${GROUP_EDGE}`}>{qtyCell(c)}</TableCell>
      <TableCell className={`${TD} ${NUM}`}>{amountCell(c)}</TableCell>
    </>
  );
}

/** A keyed fragment, so a company's two header cells travel together. */
function Pair({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
