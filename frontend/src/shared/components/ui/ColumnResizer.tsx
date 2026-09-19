/**
 * PF-20 — the pieces every table uses to let a reader drag a column wider or narrower and to keep
 * each row to one line. QueueTable and MasterCrud use them internally; a hand-built <table> uses
 * `useColumnWidths("tb", …)` with `FitTh`, `FitCell` and `ResetWidths`.
 *
 * ── How a column holds a dragged width ──
 *
 * The width lives in two places, and both matter:
 * - on the column's <th> (`box-sizing: content-box`, so it is the content width) — a column with
 *   a declared width is never handed a share of spare width, which is what made the KRA / KPI
 *   prototype render 357 px for a 352 px drag;
 * - on the header label's wrapper (`FitHead`) — the one thing that counts when a wide table sits
 *   every column at its minimum width. Without it a dragged column collapsed to its padding.
 * Everything else in the column — the cells, the filter — contributes NOTHING to its width once
 * it is dragged (`width: 0; min-width: 100%`: no say in how wide the column is, then fill whatever
 * it got). So the edge stays exactly under the pointer.
 *
 * A column nobody has dragged keeps its natural width; its long text stops growing it at the cut
 * width (300 px) and is cut there with "…".
 */

import { useRef, type CSSProperties, type ReactNode, type ThHTMLAttributes } from "react";
import { FIT } from "@/shared/lib/tableLook";
import type { FitTable } from "@/shared/lib/useColumnWidths";

/** The <th> style for a column: its dragged width, or nothing while it keeps its natural width. */
export function thFitStyle(fit: FitTable, col: string): CSSProperties | undefined {
  const w = fit.width(col);
  return w === undefined ? undefined : { width: w, boxSizing: "content-box" };
}

/** The <th>'s content width as rendered — where a drag starts, whatever the column's state. */
function contentWidth(th: HTMLElement): number {
  const cs = getComputedStyle(th);
  const px = (v: string) => parseFloat(v) || 0;
  return (
    th.getBoundingClientRect().width -
    px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)
  );
}

/**
 * The drag handle on a header's right edge.
 *
 * - A press only becomes a drag after a few px of travel, so a plain click (and the first click
 *   of a double-click) saves nothing.
 * - During the drag it writes the <th>'s width directly — no React render per pointer move — and
 *   commits once, on release. Escape puts the column back.
 * - It sits BESIDE the header's sort button, never inside it, and stops every event it handles,
 *   so a drag can never sort the table.
 * - ← / → move a focused edge; `stopPropagation` keeps ScrollableTable from scrolling instead
 *   (the same guard Combobox and MultiSelect carry). Double-click resets the column.
 */
export function FitResizer({
  fit,
  col,
  label,
  min = FIT.MIN,
  max = FIT.MAX,
}: {
  fit: FitTable;
  col: string;
  label: string;
  min?: number;
  max?: number;
}) {
  const drag = useRef<{
    x: number;
    w0: number;
    /** The header's right edge when the press began — where the edge must follow the pointer from. */
    right0: number;
    /** The width and edge after the previous move, to measure how far the edge moves per px. */
    lastW: number;
    lastR: number;
    th: HTMLElement;
    prev: { width: string; boxSizing: string };
    started: boolean;
    last: number;
    onKey: (e: KeyboardEvent) => void;
  } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));

  const finish = (keep: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    window.removeEventListener("keydown", d.onKey, true);
    if (!d.started) return;
    if (keep) {
      fit.commit(col, d.last);
    } else {
      d.th.style.width = d.prev.width;
      d.th.style.boxSizing = d.prev.boxSizing;
      const head = d.th.querySelector<HTMLElement>(":scope > [data-fit-head]");
      if (head) head.style.width = d.prev.width;
      fit.cancel();
    }
  };

  const stored = fit.width(col);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column`}
      aria-valuenow={stored}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const th = e.currentTarget.closest("th");
        if (!th) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const onKey = (k: KeyboardEvent) => {
          if (k.key !== "Escape") return;
          k.preventDefault();
          k.stopPropagation();
          finish(false);
        };
        window.addEventListener("keydown", onKey, true);
        const w0 = contentWidth(th);
        const right0 = th.getBoundingClientRect().right;
        drag.current = {
          x: e.clientX,
          w0,
          right0,
          lastW: w0,
          lastR: right0,
          th,
          prev: { width: th.style.width, boxSizing: th.style.boxSizing },
          started: false,
          last: 0,
          onKey,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.started) {
          if (Math.abs(dx) < FIT.SLOP) return;
          d.started = true;
          fit.start(col, clamp(d.w0));
        }
        const apply = (w: number) => {
          d.th.style.width = `${w}px`;
          d.th.style.boxSizing = "content-box";
          // The label's wrapper (see FitHead) appears with the render `start` triggers.
          const head = d.th.querySelector<HTMLElement>(":scope > [data-fit-head]");
          if (head) head.style.width = `${w}px`;
        };
        const edge = () => d.th.getBoundingClientRect().right;
        let w = clamp(d.w0 + dx);
        apply(w);
        let r = edge();
        // ⚠ KEEP THE EDGE UNDER THE POINTER. In a table narrower than its card the spare width
        //   is spread over the other columns, so widening this one shrinks the columns to its
        //   LEFT too and its left edge moves: measured on a four-column master, a 250 px drag
        //   left the edge 123 px short of the pointer. So correct the width by how far the edge
        //   missed, scaled by how far the edge MOVES per px of width (measured, not assumed).
        //
        // ⚠ AND STOP WHERE THE EDGE CANNOT FOLLOW. The last column of a table that fills its card
        //   has its right edge pinned to the card's: widening it only takes room from the others.
        //   Chasing that edge drove the column straight to the 900 px limit on a two-row recap.
        //   There the edge barely moves per px, so the correction stops and the column simply
        //   widens by the drag distance. A table that overflows its card is right first time.
        let prevW = d.lastW, prevR = d.lastR;
        for (let i = 0; i < 5; i++) {
          const miss = d.right0 + dx - r;
          if (Math.abs(miss) < 0.5) break;
          const gain = w !== prevW ? (r - prevR) / (w - prevW) : NaN;
          if (!(gain > 0.15)) break;
          const next = clamp(w + miss / gain);
          if (next === w) break;
          prevW = w;
          prevR = r;
          w = next;
          apply(w);
          r = edge();
        }
        d.lastW = w;
        d.lastR = r;
        d.last = w;
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        finish(true);
      }}
      onLostPointerCapture={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        fit.reset(col);
      }}
      onKeyDown={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          return;
        }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        const th = e.currentTarget.closest("th");
        if (!th) return;
        const from = stored ?? contentWidth(th);
        fit.commit(col, clamp(from + (e.key === "ArrowRight" ? FIT.STEP : -FIT.STEP)));
      }}
      className="absolute right-0 top-0 z-10 h-full w-2.5 [@media(pointer:coarse)]:w-5 cursor-col-resize touch-none select-none after:absolute after:right-1 after:top-1/4 after:h-1/2 after:w-0.5 after:rounded after:bg-line hover:after:bg-orange focus-visible:outline-none focus-visible:after:bg-orange"
    />
  );
}

/**
 * A header label inside a dragged column, held at exactly the dragged width. It wraps if the
 * column is dragged narrower than the label. Renders its children untouched while the column
 * keeps its natural width.
 *
 * ⚠ THIS div, not the <th>'s own width, is what stops a dragged column collapsing. In a table
 *   wider than its card (most wide queues), the browser gives every column its MIN-content
 *   width, and a <th>'s `width` does not count towards that — with every cell of the column
 *   contributing nothing, the column shrank to its padding (measured: 32 px). A block of a
 *   definite width does count. The <th> keeps its width too, for the opposite case: a table
 *   narrower than its card, where it stops the column being handed a share of the spare width.
 */
export function FitHead({ width, children }: { width: number | undefined; children: ReactNode }) {
  if (width === undefined) return <>{children}</>;
  return (
    <div data-fit-head="" className="whitespace-normal [overflow-wrap:anywhere]" style={{ width }}>
      {children}
    </div>
  );
}

export function FitFilter({ dragged, children }: { dragged: boolean; children: ReactNode }) {
  if (!dragged) return <>{children}</>;
  return <div style={{ width: 0, minWidth: "100%" }}>{children}</div>;
}

/**
 * A cell's content, on one line.
 *
 * `cap` is where long text is cut with "…" (px), or null for a column that is never cut —
 * numbers, dates, pills: those stay whole, and a drag narrower stops at their widest value.
 *
 * The 2 px of padding inside a -2 px margin gives a focused link's ring room before
 * `overflow: hidden` clips it, without moving the text or changing the row's height.
 *
 * On a touch screen there is no hover to read the whole text by, so nothing is cut there by
 * default — the table scrolls sideways inside ScrollableTable instead.
 */
export function FitCell({ fit, col, cap, children }: { fit: FitTable; col: string; cap: number | null; children: ReactNode }) {
  if (!fit.on) return <>{children}</>;
  const dragged = fit.width(col) !== undefined;
  if (cap === null) {
    return (
      <div data-fit-cell="" className="whitespace-nowrap" style={dragged ? { minWidth: "100%" } : undefined}>
        {children}
      </div>
    );
  }
  const style: CSSProperties = dragged
    ? { width: 0, minWidth: "calc(100% + 4px)", margin: -2, padding: 2 }
    : { minWidth: "calc(100% + 4px)", maxWidth: cap + 4, margin: -2, padding: 2 };
  return (
    <div
      data-fit-cell=""
      className="overflow-hidden text-ellipsis whitespace-nowrap [@media(pointer:coarse)]:!max-w-none"
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * A header cell for a HAND-BUILT table. With the look off it renders a plain <th> with exactly the
 * props it was given. `resize={false}` keeps the one-line look without a handle (the user,
 * 19-09-2026: settings matrices get no drag).
 */
export function FitTh({
  fit,
  col,
  resize = true,
  min,
  max,
  className,
  children,
  ...rest
}: {
  fit: FitTable;
  col: string;
  resize?: boolean;
  min?: number;
  max?: number;
  children?: ReactNode;
} & ThHTMLAttributes<HTMLTableCellElement>) {
  if (!fit.on || !resize) {
    return (
      <th className={className} {...rest}>
        {children}
      </th>
    );
  }
  return (
    <th className={`${className ?? ""} relative`} style={thFitStyle(fit, col)} {...rest}>
      <FitHead width={fit.width(col)}>{children}</FitHead>
      <FitResizer fit={fit} col={col} label={typeof children === "string" ? children : col} min={min} max={max} />
    </th>
  );
}

/** "Reset widths" — shown only once one of these columns has a dragged width. */
export function ResetWidths({ fit, cols, className }: { fit: FitTable; cols: readonly string[]; className?: string }) {
  if (!fit.on || !fit.anyCustom(cols)) return null;
  return (
    <button
      type="button"
      onClick={fit.resetAll}
      title="Put every column back to its natural width"
      className={
        className ??
        "inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-semibold text-grey-2 hover:text-orange rounded-lg hover:bg-page"
      }
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12H3M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4" />
      </svg>
      Reset widths
    </button>
  );
}
