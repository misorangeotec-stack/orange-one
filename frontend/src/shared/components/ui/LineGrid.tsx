import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * A spreadsheet-style editable line grid.
 *
 * The grid always ends with exactly ONE blank row. You type into it, press Tab
 * or Enter off the last cell, and a fresh blank row appears below with the
 * caret already in it — so adding the 20th line costs the same as the 1st and
 * you never scroll back up to a picker.
 *
 * Two invariants keep that honest:
 *   * **Append only.** A row is never auto-deleted. Clearing the last filled row
 *     just leaves it blank, and because the trailing row is already blank no
 *     second one is appended. Removal stays explicit (the ✕ button).
 *   * **Blank means blank.** `makeEmptyRow()` must return a genuinely empty row
 *     and `isRowBlank` must be a pure emptiness check. Pre-filling a default
 *     (say qty "1") while blank-testing against that default makes every render
 *     append another row — an infinite loop. Default such fields when the user
 *     picks something, not in the empty row.
 *
 * Focus is driven by refs registered per cell rather than by walking the DOM,
 * because document-order walking in a grid lands on the row's ✕ button and on
 * neighbouring rows unpredictably.
 */

export interface LineGridRow {
  /** Stable identity. Keying rows on a field the user edits (an item id, say)
   *  remounts the <tr> mid-edit and drops focus. */
  uid: string;
}

let uidSeq = 0;
/**
 * Random per PAGE LOAD, and load-bearing for drafts (`useStepDraft`).
 *
 * The counter alone resets to 0 on every reload, so a restored draft holding
 * rows r1..r4 would collide with the very next row the user adds — duplicate
 * React keys remount the <tr> mid-edit, focus jumps, and `patch` writes into
 * the wrong row. The base makes a restored row's id unreachable by this load's
 * counter.
 *
 * Safe to change the format: a uid never leaves the browser. Submit payloads
 * carry the line's DB id (`dbId`) and never the uid, and hydrating a saved line
 * always mints a fresh one.
 */
const uidBase = Math.random().toString(36).slice(2, 8);
export const newUid = () => `r${uidBase}${++uidSeq}`;

export interface LineCellApi<T extends LineGridRow> {
  /** Patch this row. */
  patch: (next: Partial<T>) => void;
  /** Register this cell's focusable element (an input, or a Combobox handle). */
  focusRef: (el: Focusable | null) => void;
  /** Move to the next cell, appending a blank row when leaving the last one. */
  advance: () => void;
  /** Wire onto an input's onKeyDown for Enter/Tab cell chaining. */
  keyHandler: (e: { key: string; shiftKey: boolean; preventDefault: () => void }) => void;
  rowIndex: number;
  isLast: boolean;
}

/** Anything the grid can focus — a DOM node or a Combobox's imperative handle. */
export interface Focusable {
  focus: () => void;
}

export interface LineGridColumn<T extends LineGridRow> {
  key: string;
  header: ReactNode;
  /** Applied to both the <th> and every <td> — width and alignment. */
  className?: string;
  /** Cells that hold no focusable control (computed money, unit) set this so
   *  Tab/Enter skips straight past them. */
  skipFocus?: boolean;
  cell: (row: T, api: LineCellApi<T>) => ReactNode;
}

export default function LineGrid<T extends LineGridRow>({
  rows,
  onRowsChange,
  columns,
  makeEmptyRow,
  isRowBlank,
  footer,
  mobileCard,
  mobileFooter,
  onRemove,
  canRemove,
  className,
}: {
  rows: T[];
  /** A `useState` setter. The updater form is REQUIRED (see the trailing-blank
   *  effect) — passing a handler that ignores the function form will drop rows. */
  onRowsChange: Dispatch<SetStateAction<T[]>>;
  columns: LineGridColumn<T>[];
  makeEmptyRow: () => T;
  isRowBlank: (row: T) => boolean;
  footer?: ReactNode;
  /**
   * OPT-IN narrow-screen layout: render each row as a stacked card below `sm`
   * and keep the table from `sm` up. Grids that don't pass it are untouched —
   * they render exactly the single scrolling table they always have.
   *
   * The card and the table are BOTH in the DOM, one hidden by CSS. That is fine
   * because they read and write the same row state, but it is why the card's
   * `api.focusRef` is a no-op: registering a cell twice would leave the focus
   * map pointing at whichever copy rendered last, and `focus()` on a
   * `display:none` input does nothing. Cards are tapped, not tabbed.
   *
   * The card body is yours; the surrounding padding, the blank-row tint and the
   * Remove button are the grid's, so both layouts stay consistent.
   */
  mobileCard?: (row: T, api: LineCellApi<T>, index: number) => ReactNode;
  /** Totals for the card list — the <tfoot> is inside the hidden table. */
  mobileFooter?: ReactNode;
  /** Optional hook fired after a row is removed (e.g. to clear a row-scoped error). */
  onRemove?: (row: T) => void;
  /** Gate the ✕ per row (default: every non-blank row is removable). Lets a grid
   *  mix removable new rows with locked rows carried from an earlier step. */
  canRemove?: (row: T) => boolean;
  className?: string;
}) {
  const cells = useRef(new Map<string, Focusable>());
  const [pending, setPending] = useState<string | null>(null);

  const cellKey = (uid: string, colKey: string) => `${uid}:${colKey}`;
  const focusables = useMemo(() => columns.filter((c) => !c.skipFocus), [columns]);

  /**
   * The trailing-blank invariant. Runs on every change to `rows`, including the
   * parent's own edits, so the blank row can never go missing.
   *
   * ⚠ MUST use the functional updater, never `[...rows, …]`.
   *
   * `rows` here is the value captured when this effect was scheduled. A parent
   * that seeds the grid from its OWN effect writes after this one (child effects
   * flush before parent effects), so appending to the captured snapshot posts a
   * one-blank-row array that lands last and silently wipes the seeded rows —
   * every recorded line vanishes and the form looks empty. React StrictMode's
   * double-invoked effects make it reproduce every time in dev; a production
   * build only got away with it by luck of ordering. Reading `prev` takes
   * whatever the parent last committed, so seeding and appending compose in
   * either order.
   */
  useEffect(() => {
    onRowsChange((prev) =>
      prev.length === 0 || !isRowBlank(prev[prev.length - 1]!) ? [...prev, makeEmptyRow()] : prev,
    );
    // isRowBlank/makeEmptyRow are stable-by-convention (defined inline in the
    // parent); depending on them would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Focus the queued cell after the append has rendered.
  useEffect(() => {
    if (!pending) return;
    const target = cells.current.get(pending);
    if (!target) return; // the row hasn't rendered yet — the next rows change retries
    target.focus();
    if (target instanceof HTMLInputElement) {
      try {
        target.select();
      } catch {
        /* number inputs reject select() in some browsers */
      }
    }
    setPending(null);
  }, [pending, rows]);

  /**
   * Move focus one cell on. Deliberately does NOT write to `rows`: the
   * trailing-blank effect has already appended the next row by the time you can
   * Tab out of this one (typing into the blank row is what stops it being
   * blank). Keeping this read-only means a handler can safely `patch()` and then
   * `advance()` — both close over the same `rows`, so a write here would clobber
   * the patch. Returns false when there is nowhere to go.
   */
  const advanceFrom = useCallback(
    (rowIndex: number, colKey: string): boolean => {
      const colIdx = focusables.findIndex((c) => c.key === colKey);
      if (colIdx === -1) return false;

      // Move to the next REGISTERED focusable cell: remaining columns of this row,
      // then each later row from its first column. Skipping unregistered cells lets
      // a grid mix editable and locked/display cells per row (e.g. the log book's
      // handover rows expose only Actual Use). In a uniform grid every focusable
      // cell is registered, so this is exactly a next-cell-then-next-row walk.
      const has = (uid: string, key: string) => cells.current.has(cellKey(uid, key));
      for (let ci = colIdx + 1; ci < focusables.length; ci++) {
        if (has(rows[rowIndex]!.uid, focusables[ci]!.key)) {
          setPending(cellKey(rows[rowIndex]!.uid, focusables[ci]!.key));
          return true;
        }
      }
      for (let ri = rowIndex + 1; ri < rows.length; ri++) {
        for (let ci = 0; ci < focusables.length; ci++) {
          if (has(rows[ri]!.uid, focusables[ci]!.key)) {
            setPending(cellKey(rows[ri]!.uid, focusables[ci]!.key));
            return true;
          }
        }
      }
      return false;
    },
    [rows, focusables]
  );

  const removeRow = (idx: number) => {
    const row = rows[idx];
    onRowsChange(rows.filter((_, i) => i !== idx));
    if (row) onRemove?.(row);
  };

  const table = (
    <>
      {/* table-fixed, not auto: a long value in one cell (e.g. a wide item name)
          must NOT expand its column and crush the fixed-width ones next to it
          (Qty collapsing to the spinner). With fixed layout the explicit column
          widths hold and cells that carry only a `min-w` (Item, Remark) absorb
          the slack — the truncating Combobox/inputs then clip instead of grow. */}
      <table className="w-full table-fixed text-[13.5px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line bg-page/60">
            {columns.map((c) => (
              <th key={c.key} className={cn("font-medium px-2.5 py-2 whitespace-nowrap", c.className)}>
                {c.header}
              </th>
            ))}
            <th className="px-2.5 py-2 w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const blank = isRowBlank(row);
            return (
              <tr key={row.uid} className={cn("border-b border-line/70 last:border-0", blank && "bg-page/20")}>
                {columns.map((col) => {
                  const api: LineCellApi<T> = {
                    rowIndex: i,
                    isLast: i === rows.length - 1,
                    patch: (next) => onRowsChange(rows.map((r, idx) => (idx === i ? { ...r, ...next } : r))),
                    focusRef: (el) => {
                      const k = cellKey(row.uid, col.key);
                      if (el) cells.current.set(k, el);
                      else cells.current.delete(k);
                    },
                    advance: () => advanceFrom(i, col.key),
                    keyHandler: (e) => {
                      if (e.key === "Enter") {
                        // Enter never submits from inside the grid — it steps on.
                        e.preventDefault();
                        advanceFrom(i, col.key);
                        return;
                      }
                      // Tab forward: hop to the next registered cell (skipping
                      // display/locked cells and the row's ✕ button). When there is
                      // no next cell — the trailing blank row's last cell — let
                      // native Tab carry focus out of the grid.
                      if (e.key === "Tab" && !e.shiftKey) {
                        if (advanceFrom(i, col.key)) e.preventDefault();
                      }
                    },
                  };
                  return (
                    // align-top, not align-middle: a cell that grows (the rate
                    // cell's save-to-price-list tick) would otherwise shunt every
                    // other cell in the row down by half its extra height.
                    <td key={col.key} className={cn("px-2.5 py-2 align-top", col.className)}>
                      {/* flex-col (not row) so block children keep their full
                          width — a row-flex child would shrink-wrap the inputs. */}
                      <div className="min-h-[34px] flex flex-col justify-center">{col.cell(row, api)}</div>
                    </td>
                  );
                })}
                <td className="px-2.5 py-1.5 text-right w-10">
                  {!blank && (canRemove ? canRemove(row) : true) && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="text-grey-2 hover:text-ryg-red transition"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {footer}
      </table>
    </>
  );

  // No card renderer → exactly the markup this grid has always emitted.
  if (!mobileCard) {
    return <div className={cn("rounded-xl border border-line overflow-x-auto", className)}>{table}</div>;
  }

  return (
    <div className={cn("rounded-xl border border-line", className)}>
      <div className="sm:hidden divide-y divide-line/70">
        {rows.map((row, i) => {
          const blank = isRowBlank(row);
          const api: LineCellApi<T> = {
            rowIndex: i,
            isLast: i === rows.length - 1,
            patch: (next) => onRowsChange(rows.map((r, idx) => (idx === i ? { ...r, ...next } : r))),
            // See `mobileCard`: the table copy owns the focus map.
            focusRef: () => {},
            advance: () => {},
            keyHandler: () => {},
          };
          return (
            <div key={row.uid} className={cn("p-3", blank && "bg-page/20")}>
              {mobileCard(row, api, i)}
              {!blank && (canRemove ? canRemove(row) : true) && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-grey-2 transition hover:text-ryg-red"
                >
                  ✕ Remove
                </button>
              )}
            </div>
          );
        })}
        {mobileFooter}
      </div>
      <div className="hidden sm:block overflow-x-auto">{table}</div>
    </div>
  );
}
