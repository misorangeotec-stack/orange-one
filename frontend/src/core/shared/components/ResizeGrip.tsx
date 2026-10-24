/**
 * Reader-sized boxes — a table's height, a chart panel's height, a chart's bar thickness.
 *
 * Asked for on the Bushra reports and dashboards (30-09-2026): "give the option to resize the
 * table and bar". Column widths already have their own kit (PF-20, ColumnResizer.tsx); this is
 * the other three, which that kit does not cover.
 *
 * Each size is the READER'S, remembered per browser under `orangeone.size.<key>`, exactly as a
 * dragged column width is. Nobody else sees it, it never reaches the server, and a double-click on
 * the grip puts it back. Every storage access is wrapped: private mode or a full quota must never
 * take a page down — a size is a convenience.
 */
import { useCallback, useRef, useState } from "react";

const PREFIX = "orangeone.size.";

function read(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(PREFIX + key));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** One remembered number — undefined until the reader changes it, and again after a reset. */
export function usePersistedSize(key: string | undefined): [number | undefined, (v: number | undefined) => void] {
  const [value, setValue] = useState<number | undefined>(() => (key ? read(key) : undefined));
  const [seenKey, setSeenKey] = useState(key);
  // A different key (another dashboard in the same mounted page) reads its own value.
  if (seenKey !== key) {
    setSeenKey(key);
    setValue(key ? read(key) : undefined);
  }
  const set = useCallback((v: number | undefined) => {
    setValue(v);
    if (!key) return;
    try {
      if (v === undefined) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, String(Math.round(v * 1000) / 1000));
    } catch {
      /* holds for this visit */
    }
  }, [key]);
  return [value, set];
}

/**
 * The strip under a box that drags it taller or shorter. It reports pointer travel; what a pixel
 * means (a max-height, a scale) is the owner's business. Double-click resets. ↑ / ↓ on the focused
 * strip move it 40 px, for anyone not using a mouse.
 */
export function HeightGrip({ onStart, onMove, onEnd, onReset, label = "Drag to resize · double-click to reset" }: {
  /** A drag begins — measure what you are about to change. */
  onStart: () => void;
  /** Total vertical travel since the drag began, in px (down is positive). */
  onMove: (dy: number) => void;
  onEnd?: () => void;
  onReset: () => void;
  label?: string;
}) {
  const drag = useRef<{ y: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY };
        onStart();
        document.body.style.cursor = "row-resize";
      }}
      onPointerMove={(e) => {
        if (drag.current) onMove(e.clientY - drag.current.y);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        document.body.style.cursor = "";
        onEnd?.();
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.style.cursor = "";
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        onStart();
        onMove(e.key === "ArrowDown" ? 40 : -40);
        onEnd?.();
      }}
      className="group flex h-3 w-full cursor-row-resize touch-none select-none items-center justify-center focus:outline-none"
    >
      <span className="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
    </div>
  );
}
