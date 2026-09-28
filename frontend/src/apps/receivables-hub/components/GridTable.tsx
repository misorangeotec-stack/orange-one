import { type ReactNode } from "react";
import { Button } from "@hub/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/components/ui/table";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { ColumnFilter, SortHead } from "@hub/components/gridColumns";
import type { ColumnGrid, GridColumn } from "@hub/lib/useColumnGrid";

/**
 * One table, driven entirely by a column array.
 *
 * ── Why this exists ──
 *
 * `gridColumns.tsx` records that the sortable header and the searchable column filter were lifted
 * out of NameMasterTab the moment a third copy was about to be written, because "a third copy was
 * the wrong answer". The same thing then happened one level up: Red Mark, Disputed Bills and the
 * Suspense block in AdvancesReport each hand-wrote the SAME four things around those controls — the
 * sort row, the filter row, the body, and the empty state. This is that shape, lifted once.
 * `AdvancesReport`'s SUSPENSE_COLUMNS block is the version it was generalised from.
 *
 * ── What it guarantees, so no caller has to remember ──
 *
 * 1. EVERY column sorts and EVERY column filters (CLAUDE.md). A column opts out of the filter with
 *    `filter: false` — never out of sorting — and out of both with `sortable: false`, which is for
 *    an Actions column and nothing else.
 * 2. An empty RESULT is not an empty TABLE. When the filters match nothing the header, the sort
 *    toggles and the filter row stay exactly where they are and one spanning row appears in the
 *    tbody with a Clear filters button. Swapping in a full-page empty state would remove the only
 *    control that could undo the filter, leaving a reload as the way back. The "nothing here at
 *    all" message is keyed on `sourceCount` — the UNFILTERED count — never on what is on screen.
 * 3. The header stays put while the body scrolls. ⚠ That needs `maxHeight`: ScrollableTable's
 *    container is `overflow-auto`, but with no height cap it never scrolls vertically, so a sticky
 *    header has nothing to stick against and silently does nothing. Both header rows are sticky and
 *    OPAQUE (`bg-muted`) — a transparent one shows the rows sliding underneath it.
 */

/** Row 1 of the header. `h-9` is load-bearing: row 2 sticks at `top-9`, directly beneath it. */
const HEAD_CLS = "h-9 px-2.5 text-[11px] whitespace-nowrap bg-muted sticky top-0 z-20";
const FILTER_CLS = "px-2.5 py-1 bg-muted sticky top-9 z-20";
const CELL_CLS = "px-2.5 py-1.5 text-xs align-middle";
/** Money and counts: right-aligned, lined up digit for digit. */
export const GRID_NUM = "text-right font-mono tabular-nums";

export interface TableColumn<T> extends GridColumn<T> {
  /** Header text. Also what the export and the filter chip call this column. */
  label: string;
  /** What the cell renders. Free to differ from `value`, which is what sorts and filters. */
  cell: (row: T) => ReactNode;
  /** Width / alignment classes for the `<th>` — `w-24`, `min-w-[220px]`. */
  head?: string;
  /** Extra classes for the `<td>`. */
  cellClass?: string;
  /** Right-align both header and cell, and set the numeric font on the cell. */
  right?: boolean;
  /** Hover text explaining the column. */
  title?: string;
  /**
   * Neither sortable nor filterable. For an Actions column, whose cells are buttons — there is
   * nothing to order by and nothing to pick from. Everything else sorts.
   */
  sortable?: false;
}

/**
 * The active column filters, in the form an export's "About" sheet wants.
 *
 * ⚠ CALL THIS WHEREVER A GRID EXPORTS. A column filter narrows the rows silently — nothing on the
 *   sheet says why it holds 27 rows out of 1,882 unless this is threaded through. An export that
 *   does not name what filtered it is a spreadsheet that lies by omission.
 *
 * Values go through `optionLabel`, so a blank reads "(Blank)" rather than the raw sentinel.
 */
export function describeColumnFilters<T>(
  columns: TableColumn<T>[],
  grid: ColumnGrid<T>,
): { label: string; values: string[] }[] {
  return columns
    .map((c) => ({ label: c.label, values: grid.selected(c.key).map(grid.optionLabel) }))
    .filter((c) => c.values.length > 0);
}

export function GridTable<T>({
  columns, grid, pageRows, rowKey, rowClass,
  sourceCount, emptyMessage, emptyFilteredMessage = "Nothing matches the current filters.",
  onClearFilters, footer, maxHeight = "max-h-[70vh]", className,
}: {
  columns: TableColumn<T>[];
  grid: ColumnGrid<T>;
  /** The slice on screen. The caller paginates, because it also needs the full set to export. */
  pageRows: T[];
  rowKey: (row: T) => string;
  rowClass?: (row: T) => string | undefined;
  /** Rows before ANY filter — what tells "nothing here yet" apart from "nothing matches". */
  sourceCount: number;
  /** Shown when there is genuinely nothing in this master. */
  emptyMessage: string;
  emptyFilteredMessage?: string;
  /** Must clear the grid's filters AND the caller's own search / chips, or the button half-works. */
  onClearFilters: () => void;
  /** A totals row, rendered inside the tbody under the last row. */
  footer?: ReactNode;
  maxHeight?: string;
  className?: string;
}) {
  return (
    <ScrollableTable className={`rounded-md border border-border ${className ?? ""}`} maxHeight={maxHeight}>
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            {columns.map((c) =>
              c.sortable === false ? (
                <TableHead key={c.key} className={`${HEAD_CLS} ${c.head ?? ""} ${c.right ? "text-right" : ""}`} title={c.title}>
                  {c.label}
                </TableHead>
              ) : (
                <SortHead
                  key={c.key}
                  label={c.label}
                  title={c.title}
                  className={`${HEAD_CLS} ${c.head ?? ""} ${c.right ? "text-right" : ""}`}
                  dir={grid.sortDir(c.key)}
                  onToggle={() => grid.toggleSort(c.key)}
                />
              ),
            )}
          </TableRow>
          <TableRow className="bg-muted hover:bg-muted">
            {columns.map((c) => (
              <TableHead key={c.key} className={`${FILTER_CLS} ${c.head ?? ""}`}>
                {/* `filter: false` makes optionsFor return [], so this must render nothing rather
                    than an empty dropdown. Same for a column that does not sort at all. */}
                {c.filter === false || c.sortable === false ? null : (
                  <ColumnFilter
                    label="All"
                    options={grid.optionsFor(c.key)}
                    selected={grid.selected(c.key)}
                    onChange={(v) => grid.setSelected(c.key, v)}
                    labelOf={grid.optionLabel}
                  />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((r) => (
            <TableRow key={rowKey(r)} className={`hover:bg-muted/40 ${rowClass?.(r) ?? ""}`}>
              {columns.map((c) => (
                <TableCell key={c.key} className={`${CELL_CLS} ${c.right ? GRID_NUM : ""} ${c.cellClass ?? ""}`}>
                  {c.cell(r)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {pageRows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">
                {sourceCount === 0 ? (
                  emptyMessage
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span>{emptyFilteredMessage}</span>
                    <Button size="sm" variant="outline" onClick={onClearFilters}>Clear filters</Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          )}
          {footer}
        </TableBody>
      </Table>
    </ScrollableTable>
  );
}
