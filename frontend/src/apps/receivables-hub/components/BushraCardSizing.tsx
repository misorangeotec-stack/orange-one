import { useRef } from "react";
import { useLocation } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { HeightGrip, usePersistedSize } from "@/core/shared/components/ResizeGrip";
import { normalisePath } from "@/shared/lib/tableLook";

/**
 * READER-SIZED HAND-BUILT CARDS on the Bushra Sales and Purchase dashboards — the donut mixes and
 * the period chart, which draw their own chrome rather than sitting in a SalesPanel. (A SalesPanel
 * sizes itself through `sizeKey` + `PanelFill` from components/ResizeKit.tsx.)
 *
 * Render `barControl` in the header, put `bodyRef` on the element the drag measures, `grip` at the
 * bottom, and draw with `size`. Sizes are per browser, per screen, per card.
 */
export interface CardSize {
  /** A height this card draws, scaled by the reader's drag. */
  h: (base: number) => number;
  /** A bar thickness, scaled by the reader's thinner / thicker setting. */
  bar: (base: number) => number;
}

const H_MIN = 0.4, H_MAX = 4;
const BAR_STEP = 0.25, BAR_MIN = 0.5, BAR_MAX = 3;

export function useCardSizing(title: string, opts: { resizable?: boolean; bars?: boolean; sizeKey?: string }) {
  const { resizable, bars, sizeKey } = opts;
  const { pathname } = useLocation();
  const key = `panel.${normalisePath(pathname)}#${sizeKey ?? title}`;
  const [hScale, setHScale] = usePersistedSize(resizable ? `${key}.h` : undefined);
  const [barScale, setBarScale] = usePersistedSize(bars ? `${key}.bar` : undefined);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef({ px: 1, scale: 1 });

  const hs = hScale ?? 1;
  const bs = barScale ?? 1;
  const size: CardSize = { h: (b) => Math.round(b * hs), bar: (b) => Math.max(2, Math.round(b * bs)) };
  const stepBars = (d: number) => {
    const next = Math.round(Math.min(BAR_MAX, Math.max(BAR_MIN, bs + d)) / BAR_STEP) * BAR_STEP;
    setBarScale(next === 1 ? undefined : next);
  };

  const barControl = bars ? (
    <div className="flex items-center rounded-md border border-border bg-surface text-muted-foreground">
      <button type="button" onClick={() => stepBars(-BAR_STEP)} disabled={bs <= BAR_MIN}
              title="Thinner bars" aria-label="Thinner bars"
              className="flex h-6 w-6 items-center justify-center hover:text-foreground disabled:opacity-40">
        <Minus className="h-3 w-3" />
      </button>
      <span onDoubleClick={() => setBarScale(undefined)} title={`Bar thickness ${Math.round(bs * 100)}% · double-click to reset`}
            className="cursor-default select-none px-1 text-[10px] font-medium uppercase tracking-wide">Bars</span>
      <button type="button" onClick={() => stepBars(BAR_STEP)} disabled={bs >= BAR_MAX}
              title="Thicker bars" aria-label="Thicker bars"
              className="flex h-6 w-6 items-center justify-center hover:text-foreground disabled:opacity-40">
        <Plus className="h-3 w-3" />
      </button>
    </div>
  ) : null;

  const grip = resizable ? (
    <HeightGrip
      label="Drag to make the chart taller or shorter · double-click to reset"
      onStart={() => { dragFrom.current = { px: Math.max(40, bodyRef.current?.clientHeight ?? 300), scale: hs }; }}
      onMove={(dy) => {
        const { px, scale } = dragFrom.current;
        setHScale(Math.min(H_MAX, Math.max(H_MIN, (scale * (px + dy)) / px)));
      }}
      onReset={() => setHScale(undefined)}
    />
  ) : null;

  return { size, barControl, grip, bodyRef };
}
