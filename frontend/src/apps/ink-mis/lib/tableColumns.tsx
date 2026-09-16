/**
 * Excel-style column adjustment for the Ink IMS tables: drag a column's right edge to resize it,
 * double-click the edge to hand it back to automatic width, and hide or show columns.
 *
 * Remembered per browser, per table, under `ink-mis:cols:<table>`. A stored width for a column
 * that no longer exists (a deleted consignment, say) is harmless — nothing reads it.
 *
 * Widths are applied as width + min-width + max-width on the header cell. The table keeps its
 * automatic layout, so a narrowed text column WRAPS instead of clipping, and a numeric column
 * cannot be dragged narrower than its widest number. Both are deliberate: a report column that
 * silently cuts a figure off is worse than one that refuses to shrink past it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { TableHead } from "@hub/components/ui/table";

const MIN_WIDTH = 48;

interface Stored {
  widths: Record<string, number>;
  hidden: string[];
}

function read(key: string): Stored {
  try {
    const raw = window.localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    return {
      widths: v.widths && typeof v.widths === "object" ? v.widths : {},
      hidden: Array.isArray(v.hidden) ? v.hidden : [],
    };
  } catch {
    return { widths: {}, hidden: [] };
  }
}

export interface TableColumns {
  widthOf: (id: string) => number | undefined;
  setWidth: (id: string, px: number | undefined) => void;
  isVisible: (id: string) => boolean;
  hidden: string[];
  setHidden: (ids: string[]) => void;
  reset: () => void;
  customised: boolean;
}

export function useTableColumns(table: string): TableColumns {
  const key = `ink-mis:cols:${table}`;
  const [state, setState] = useState<Stored>(() => read(key));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* private mode: adjustments still apply for this visit */
    }
  }, [key, state]);

  const setWidth = useCallback((id: string, px: number | undefined) => {
    setState((prev) => {
      const widths = { ...prev.widths };
      if (px === undefined) delete widths[id];
      else widths[id] = Math.max(MIN_WIDTH, Math.round(px));
      return { ...prev, widths };
    });
  }, []);

  return {
    widthOf: (id) => state.widths[id],
    setWidth,
    isVisible: (id) => !state.hidden.includes(id),
    hidden: state.hidden,
    setHidden: (ids) => setState((prev) => ({ ...prev, hidden: ids })),
    reset: () => setState({ widths: {}, hidden: [] }),
    customised: Object.keys(state.widths).length > 0 || state.hidden.length > 0,
  };
}

/**
 * A header cell with a drag handle on its right edge. Drop-in for TableHead; give it the column
 * id and the table's `useTableColumns` result.
 */
export function ResizableHead({
  id,
  cols,
  className,
  colSpan,
  children,
}: {
  id: string;
  cols: TableColumns;
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLTableCellElement>(null);
  const width = cols.widthOf(id);
  const style: CSSProperties | undefined =
    width !== undefined ? { width, minWidth: width, maxWidth: width } : undefined;

  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = ref.current?.getBoundingClientRect().width ?? width ?? 120;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: MouseEvent) => cols.setWidth(id, startW + (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <TableHead ref={ref} style={style} colSpan={colSpan} className={`relative ${className ?? ""}`}>
      {children}
      <span
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize. Double-click to reset."
        onMouseDown={onMouseDown}
        onDoubleClick={() => cols.setWidth(id, undefined)}
        className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-r border-transparent hover:border-primary hover:bg-primary/10"
      />
    </TableHead>
  );
}
