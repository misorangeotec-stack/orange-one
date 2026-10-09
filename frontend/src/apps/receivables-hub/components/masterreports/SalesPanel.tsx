import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Minus, Plus, type LucideIcon } from "lucide-react";
import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import { HeightGrip, usePersistedSize } from "@/core/shared/components/ResizeGrip";
import { normalisePath } from "@/shared/lib/tableLook";

/**
 * The card chrome for every Master Reports panel: a tight header (icon + title +
 * optional subtitle + right-hand slot) over a body that owns its own loading / error /
 * empty states.
 *
 * Deliberately OWNED BY MASTER REPORTS rather than borrowed from the C-Level dashboard's
 * WidgetCard — the C-Level screen is being reworked, and these reports must not move when
 * it does. Any shared look is a coincidence to be re-established later, not a dependency.
 *
 * READER-SIZED CHARTS (30-09-2026, the Bushra dashboards). `resizable` puts a drag strip
 * along the card's bottom edge — taller or shorter — and `bars` adds a thinner / thicker
 * control to the header. Both are remembered per browser, per screen and per panel title;
 * double-click the strip, or the "Bars" label, to go back. The panel cannot resize a chart
 * it does not draw, so a resizable panel passes its children a function instead of nodes:
 *
 *   <SalesPanel resizable bars …>{(s) => <ResponsiveContainer height={s.h(300)}>…
 *     <Bar maxBarSize={s.bar(26)} />…}</SalesPanel>
 *
 * `h(base)` is the chart's own height times the reader's scale, `bar(base)` its bar size
 * times theirs. A panel without the props renders exactly as before.
 */
export interface PanelSize {
  /** A height this panel draws, scaled by the reader's drag. */
  h: (base: number) => number;
  /** A bar thickness, scaled by the reader's thinner / thicker setting. */
  bar: (base: number) => number;
}

const SAME: PanelSize = { h: (b) => b, bar: (b) => b };
const H_MIN = 0.4, H_MAX = 4;
const BAR_STEP = 0.25, BAR_MIN = 0.5, BAR_MAX = 3;

export interface SalesPanelProps {
  title: string;
  icon?: LucideIcon;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  bodyClassName?: string;
  /** A drag strip along the bottom edge that makes the panel's chart taller or shorter. */
  resizable?: boolean;
  /** A thinner / thicker control for the chart's bars. */
  bars?: boolean;
  /**
   * A body that scrolls past this height (px). Scaled with the reader's drag, so on a long list the
   * strip opens the window rather than stretching the chart.
   */
  bodyMaxHeight?: number;
  /** Stands in for the title in the remembered sizes, where a title changes with the data. */
  sizeKey?: string;
  children: ReactNode | ((size: PanelSize) => ReactNode);
}

/**
 * The sizing a resizable panel carries — as a hook, so a dashboard card that draws its own chrome
 * (a donut mix, a month chart) can be resized exactly like a SalesPanel without taking its header.
 * Render `barControl` in the header, put `bodyRef` on the element the drag measures, `grip` at the
 * bottom, and draw with `size`.
 */
export function usePanelSizing(title: string, opts: { resizable?: boolean; bars?: boolean; sizeKey?: string }) {
  const { resizable, bars, sizeKey } = opts;
  const { pathname } = useLocation();
  const key = `panel.${normalisePath(pathname)}#${sizeKey ?? title}`;
  const [hScale, setHScale] = usePersistedSize(resizable ? `${key}.h` : undefined);
  const [barScale, setBarScale] = usePersistedSize(bars ? `${key}.bar` : undefined);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef({ px: 1, scale: 1 });

  const hs = hScale ?? 1;
  const bs = barScale ?? 1;
  const size: PanelSize = resizable || bars
    ? { h: (b) => Math.round(b * hs), bar: (b) => Math.max(2, Math.round(b * bs)) }
    : SAME;
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

export default function SalesPanel({
  title,
  icon: Icon,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage = "No data",
  className,
  bodyClassName,
  resizable,
  bars,
  sizeKey,
  bodyMaxHeight,
  children,
}: SalesPanelProps) {
  const { size, barControl, grip, bodyRef } = usePanelSizing(title, { resizable, bars, sizeKey });

  return (
    <Card className={cn("rounded-card border-border bg-surface flex flex-col overflow-hidden shadow-sm", className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/70 bg-muted/20">
        {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground truncate leading-tight">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
        </div>
        {(actions || barControl) && (
          <div className="shrink-0 flex items-center gap-2">
            {barControl}
            {actions}
          </div>
        )}
      </div>
      <div ref={bodyRef} className={cn("flex-1 p-3", bodyMaxHeight && "overflow-y-auto", bodyClassName)}
           style={bodyMaxHeight ? { maxHeight: size.h(bodyMaxHeight) } : undefined}>
        {loading ? (
          <div className="h-full min-h-[80px] w-full animate-pulse rounded-md bg-muted/50" />
        ) : error ? (
          <div className="flex items-center gap-2 text-xs text-destructive py-6 justify-center text-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : empty ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{emptyMessage}</div>
        ) : typeof children === "function" ? (
          children(size)
        ) : (
          children
        )}
      </div>
      {grip}
    </Card>
  );
}
