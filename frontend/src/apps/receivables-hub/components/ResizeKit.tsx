/**
 * Reader-sized panels and tables for the hub's dashboards — the same behaviour as the Ink Expiry
 * app (apps/ink-expiry/components/ResizeGrip.tsx + SortFilterHead.tsx), in the hub's own colours:
 *
 *   PANELS  — a strip along the card's bottom edge drags it taller or shorter; Bars − / + in the
 *             header makes the bars thinner or thicker. A long list scrolls inside its card.
 *   TABLES  — drag a heading's (or any cell's) right edge for column width, any row's bottom edge
 *             for row height, the strip under the heading row for heading height.
 *
 * Double-click any grip to reset it. Every size is the READER'S, kept per browser and per screen;
 * nobody else sees it and it never reaches the server. Storage is wrapped: private mode or a full
 * quota must never take a page down — a size is a convenience.
 */
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { cn } from "@hub/lib/utils";
import { normalisePath } from "@/shared/lib/tableLook";

const PREFIX = "orangeone.size.";

function readNum(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(PREFIX + key));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** One remembered number — undefined until the reader changes it, and again after a reset. */
function usePersistedNum(key: string): [number | undefined, (v: number | undefined) => void] {
  const [value, setValue] = useState<number | undefined>(() => readNum(key));
  const set = useCallback((v: number | undefined) => {
    setValue(v);
    try {
      if (v === undefined) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, String(Math.round(v * 1000) / 1000));
    } catch { /* holds for this visit */ }
  }, [key]);
  return [value, set];
}

/** Run a drag: `move` gets the pointer travel since the press, in px. */
function drag(e: ReactMouseEvent, cursor: string, move: (dx: number, dy: number) => void) {
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX, y0 = e.clientY;
  const prevCursor = document.body.style.cursor, prevSelect = document.body.style.userSelect;
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  const onMove = (ev: MouseEvent) => move(ev.clientX - x0, ev.clientY - y0);
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/* ================================================================== panels */

export interface PanelSize {
  /** The body's inner height in px — a chart fills it, so a taller card spreads the bars out. */
  fill: number;
  /** A bar thickness, scaled by Bars − / +. */
  bar: (base: number) => number;
  /** The Bars − / + scale itself (1 = default). */
  barScale: number;
}

const PanelSizeContext = createContext<PanelSize | null>(null);

/** The size of the reader-sized panel this sits in, or null outside one. */
export const usePanelSize = () => useContext(PanelSizeContext);

const H_MIN = 0.25, H_MAX = 5;
const BAR_STEP = 0.25, BAR_MIN = 0.5, BAR_MAX = 3;

/** The panel's remembered height and bar scale, keyed by screen + `sizeKey`. */
export function usePanelSizing(sizeKey: string, bodyHeight: number, pad: number) {
  const { pathname } = useLocation();
  const key = `panel.${normalisePath(pathname)}#${sizeKey}`;
  const [hScale, setHScale] = usePersistedNum(`${key}.h`);
  const [barScale, setBarScale] = usePersistedNum(`${key}.bar`);
  const hs = hScale ?? 1;
  const bs = barScale ?? 1;
  const bodyPx = Math.max(60, Math.round(bodyHeight * hs));
  const size: PanelSize = { fill: bodyPx - pad, bar: (b) => Math.max(2, Math.round(b * bs)), barScale: bs };
  const stepBars = (d: number) => {
    const next = Math.round(Math.min(BAR_MAX, Math.max(BAR_MIN, bs + d)) / BAR_STEP) * BAR_STEP;
    setBarScale(next === 1 ? undefined : next);
  };
  return { hs, bs, bodyPx, size, stepBars, setHScale, resetBars: () => setBarScale(undefined) };
}

/** Bars − / + for a panel header. */
export function BarsControl({ bs, onStep, onReset }: { bs: number; onStep: (d: number) => void; onReset: () => void }) {
  return (
    <div className="flex shrink-0 items-center rounded-md border border-border bg-surface text-muted-foreground"
         onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => onStep(-BAR_STEP)} disabled={bs <= BAR_MIN}
              title="Thinner bars" aria-label="Thinner bars"
              className="flex h-6 w-6 items-center justify-center hover:text-foreground disabled:opacity-40">
        <Minus className="h-3 w-3" />
      </button>
      <span onDoubleClick={onReset} title={`Bar thickness ${Math.round(bs * 100)}% · double-click to reset`}
            className="cursor-default select-none px-0.5 text-[9.5px] font-semibold uppercase tracking-wide">Bars</span>
      <button type="button" onClick={() => onStep(BAR_STEP)} disabled={bs >= BAR_MAX}
              title="Thicker bars" aria-label="Thicker bars"
              className="flex h-6 w-6 items-center justify-center hover:text-foreground disabled:opacity-40">
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * The strip along a card's bottom edge. Drag = taller / shorter, double-click = reset,
 * ↑ / ↓ on the focused strip = 40 px.
 */
export function HeightGrip({ bodyRef, hs, setHScale }: {
  bodyRef: React.RefObject<HTMLDivElement>;
  hs: number;
  setHScale: (v: number | undefined) => void;
}) {
  const from = useRef({ px: 1, scale: 1 });
  const start = () => { from.current = { px: Math.max(40, bodyRef.current?.clientHeight ?? 300), scale: hs }; };
  const move = (dy: number) => {
    const { px, scale } = from.current;
    setHScale(Math.min(H_MAX, Math.max(H_MIN, (scale * (px + dy)) / px)));
  };
  const label = "Drag to make the panel taller or shorter · double-click to reset";
  return (
    <div
      role="separator" aria-orientation="horizontal" aria-label={label} title={label} tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => { if (e.button !== 0) return; start(); drag(e, "row-resize", (_dx, dy) => move(dy)); }}
      onDoubleClick={() => setHScale(undefined)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        start();
        move(e.key === "ArrowDown" ? 40 : -40);
      }}
      className="group flex h-3 w-full shrink-0 cursor-row-resize touch-none select-none items-center justify-center border-t border-border/40 focus:outline-none"
    >
      <span className="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
    </div>
  );
}

export const PanelSizeProvider = PanelSizeContext.Provider;

/**
 * A chart that fills its reader-sized panel: at least `min` px (room for every bar), otherwise
 * the panel's height, so dragging the card taller spreads the chart out. Outside a sized panel it
 * is simply `base` px tall, exactly as before.
 */
export function PanelFill({ base, min = 0, children }: {
  base: number;
  /** Room every bar needs; a function of the bar thickness when the rows grow with it. */
  min?: number | ((bar: (b: number) => number) => number);
  children: (bar: (b: number) => number) => ReactNode;
}) {
  const size = usePanelSize();
  const bar = size ? size.bar : (b: number) => b;
  const need = typeof min === "function" ? min(bar) : min;
  const height = size ? Math.max(size.fill, need, 80) : Math.max(base, need);
  return <div style={{ height }}>{children(bar)}</div>;
}

/* ================================================================== tables */

const MIN_W = 48;
const PAD_MIN = 1, PAD_MAX = 28;
const EDGE = 7;

interface Look { widths: Record<string, number>; rowPad: number; headPad: number }

/**
 * One table's remembered layout. `rowPad` / `headPad` are the defaults (6 = py-1.5, 8 = py-2);
 * the key is scoped to the screen, so two screens' "ledgers" tables never share widths.
 */
export function useTableLayout(tableKey: string, defaults: { rowPad?: number; headPad?: number } = {}) {
  const ROW = defaults.rowPad ?? 6, HEAD = defaults.headPad ?? 8;
  const { pathname } = useLocation();
  const key = `${PREFIX}table.${normalisePath(pathname)}#${tableKey}`;
  const fresh: Look = { widths: {}, rowPad: ROW, headPad: HEAD };
  const [look, setLook] = useState<Look>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<Look>;
      return {
        widths: v.widths && typeof v.widths === "object" ? v.widths : {},
        rowPad: typeof v.rowPad === "number" ? v.rowPad : ROW,
        headPad: typeof v.headPad === "number" ? v.headPad : HEAD,
      };
    } catch {
      return fresh;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(look)); } catch { /* this visit only */ }
  }, [key, look]);
  const clampPad = (p: number) => Math.min(PAD_MAX, Math.max(PAD_MIN, p));
  return {
    look,
    defaults: { rowPad: ROW, headPad: HEAD },
    setWidth: (id: string, px: number | undefined) => setLook((l) => {
      const widths = { ...l.widths };
      if (px === undefined) delete widths[id]; else widths[id] = Math.max(MIN_W, Math.round(px));
      return { ...l, widths };
    }),
    setRowPad: (p: number) => setLook((l) => ({ ...l, rowPad: clampPad(p) })),
    setHeadPad: (p: number) => setLook((l) => ({ ...l, headPad: clampPad(p) })),
    reset: () => setLook(fresh),
    customised: Object.keys(look.widths).length > 0 || look.rowPad !== ROW || look.headPad !== HEAD,
  };
}

export type TableLayout = ReturnType<typeof useTableLayout>;

const widthStyle = (w: number | undefined): CSSProperties =>
  w === undefined ? {} : { width: w, minWidth: w, maxWidth: w };

/** A body cell's size: the column's dragged width (if any) and the table's row height. */
export function cellStyle(layout: TableLayout, id: string): CSSProperties {
  return { ...widthStyle(layout.look.widths[id]), paddingTop: layout.look.rowPad, paddingBottom: layout.look.rowPad };
}

/**
 * A heading cell with the grips: right edge = column width, and (on the `first` heading) a strip
 * along the bottom = heading height. `width` is the column's default width.
 */
export function ResizeTh({ id, layout, first, width, className, onClick, children }: {
  id: string;
  layout: TableLayout;
  first?: boolean;
  width?: number;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const w = layout.look.widths[id];
  return (
    <th data-col-id={id} onClick={onClick} className={cn("relative", className)}
        style={{ ...(w === undefined ? (width ? { width } : {}) : widthStyle(w)),
                 paddingTop: layout.look.headPad, paddingBottom: layout.look.headPad }}>
      {children}
      <span role="separator" aria-orientation="vertical" title="Drag to resize the column · double-click to reset"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              const start = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
              drag(e, "col-resize", (dx) => layout.setWidth(id, start + dx));
            }}
            onDoubleClick={(e) => { e.stopPropagation(); layout.setWidth(id, undefined); }}
            className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none border-r border-transparent hover:border-primary hover:bg-primary/10" />
      {first && (
        <span role="separator" aria-orientation="horizontal" title="Drag to make the heading row taller or shorter · double-click to reset"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => { const p0 = layout.look.headPad; drag(e, "row-resize", (_dx, dy) => layout.setHeadPad(p0 + dy / 2)); }}
              onDoubleClick={(e) => { e.stopPropagation(); layout.setHeadPad(layout.defaults.headPad); }}
              className="absolute inset-x-0 bottom-0 z-10 h-[5px] cursor-row-resize hover:bg-primary/30" />
      )}
    </th>
  );
}

/**
 * Spread onto a <tbody>. Like a spreadsheet, the whole body listens: a press near a row's bottom
 * edge drags the row height (one height for every row), near a cell's right edge drags that
 * column's width. `colIds` are the body's columns in order.
 */
export function bodyResize(layout: TableLayout, colIds: readonly string[]) {
  const nearRowEdge = (e: ReactMouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el || el.closest("input, select, textarea, button, a, [role=separator], [role=checkbox]")) return false;
    const row = el.closest("tr");
    return !!row && e.clientY >= row.getBoundingClientRect().bottom - EDGE;
  };
  const columnAt = (e: ReactMouseEvent): { id: string; td: HTMLTableCellElement } | null => {
    const el = e.target as HTMLElement | null;
    if (!el || el.closest("input, select, textarea, button, a, [role=separator], [role=checkbox]")) return null;
    const td = el.closest("td") as HTMLTableCellElement | null;
    if (!td || e.clientX < td.getBoundingClientRect().right - EDGE) return null;
    const id = colIds[td.cellIndex];
    return id ? { id, td } : null;
  };
  return {
    onMouseMove: (e: ReactMouseEvent<HTMLTableSectionElement>) => {
      e.currentTarget.style.cursor = nearRowEdge(e) ? "row-resize" : columnAt(e) ? "col-resize" : "";
    },
    onMouseDown: (e: ReactMouseEvent<HTMLTableSectionElement>) => {
      if (nearRowEdge(e)) { const p0 = layout.look.rowPad; drag(e, "row-resize", (_dx, dy) => layout.setRowPad(p0 + dy / 2)); return; }
      const hit = columnAt(e);
      if (hit) { const w0 = hit.td.getBoundingClientRect().width; drag(e, "col-resize", (dx) => layout.setWidth(hit.id, w0 + dx)); }
    },
    onDoubleClick: (e: ReactMouseEvent<HTMLTableSectionElement>) => {
      if (nearRowEdge(e)) { layout.setRowPad(layout.defaults.rowPad); return; }
      const hit = columnAt(e);
      if (hit) layout.setWidth(hit.id, undefined);
    },
  };
}

/** "Reset layout" — shown only once the reader has dragged something. */
export function ResetLayout({ layout }: { layout: TableLayout }) {
  if (!layout.customised) return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); layout.reset(); }}
            title="Column widths, row height and heading height back to default"
            className="h-7 rounded-md border border-border px-2 text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-primary">
      Reset layout
    </button>
  );
}
