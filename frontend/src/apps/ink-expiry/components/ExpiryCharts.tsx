/**
 * INK EXPIRY dashboard charts.
 *
 * Horizontal bars, one colour per chart, the value written at the end of each bar — asked for on
 * 30-09-2026 in place of tall stacked columns ("line bar chart instead of the pyramid"). Names read
 * left to right and never wrap, and a long list scrolls inside its card instead of stretching the
 * page. The expiry state is a FILTER (the colour key above the charts), not a stack.
 *
 * Reader-sized like the Bushra Sales dashboard: a drag strip along each card's bottom edge makes
 * its window taller or shorter, and Bars − / + makes the bars thinner or thicker. Both are
 * remembered per browser; double-click either to reset.
 *
 * CLICKS. A bar (or its row) calls `onPick`, and the click is stopped there so the page's own
 * "click anywhere clears the chart filter" handler does not undo it. A click on the card away from
 * any row is NOT stopped — it reaches the page and clears, as asked.
 */
import { useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { normalisePath } from "@/shared/lib/tableLook";
import { HeightGrip, usePersistedSize } from "./ResizeGrip";
import { fmtKg, fmtMeasure, fmtMoney, short, STATE_SERIES, type Measure, type StateKey, type Totals } from "./StockCharts";

const CHART_GRID = "hsl(220 15% 93%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 40%)" };
const LABEL_FILL = "hsl(220 25% 25%)";

export interface PanelSize {
  h: (base: number) => number;
  bar: (base: number) => number;
  /** The body's current inner height — a chart fills it, so a taller box spreads the bars out. */
  fill: number;
}

const H_MIN = 0.25, H_MAX = 5;
const BAR_STEP = 0.25, BAR_MIN = 0.5, BAR_MAX = 3;

/** A chart card: tight header (title, subtitle, actions, Bars − / +), a scrolling body, a height grip. */
export function ChartPanel({ title, subtitle, sizeKey, actions, bodyHeight = 330, children }: {
  title: string;
  subtitle?: string;
  sizeKey: string;
  actions?: ReactNode;
  /** The body's window height (px) before the reader drags it; taller content scrolls. */
  bodyHeight?: number;
  children: (size: PanelSize) => ReactNode;
}) {
  const { pathname } = useLocation();
  const key = `panel.${normalisePath(pathname)}#${sizeKey}`;
  const [hScale, setHScale] = usePersistedSize(`${key}.h`);
  const [barScale, setBarScale] = usePersistedSize(`${key}.bar`);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef({ px: 1, scale: 1 });
  const hs = hScale ?? 1;
  const bs = barScale ?? 1;
  const bodyPx = Math.max(60, Math.round(bodyHeight * hs));
  const size: PanelSize = { h: (b) => Math.round(b * hs), bar: (b) => Math.max(2, Math.round(b * bs)), fill: bodyPx - 12 };
  const stepBars = (d: number) => {
    const next = Math.round(Math.min(BAR_MAX, Math.max(BAR_MIN, bs + d)) / BAR_STEP) * BAR_STEP;
    setBarScale(next === 1 ? undefined : next);
  };

  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-bold leading-tight text-navy">{title}</h3>
          {subtitle && <div className="truncate text-[11px] text-grey">{subtitle}</div>}
        </div>
        {actions}
        <div className="flex shrink-0 items-center rounded-md border border-line bg-white text-grey">
          <button type="button" onClick={() => stepBars(-BAR_STEP)} disabled={bs <= BAR_MIN}
            title="Thinner bars" aria-label="Thinner bars"
            className="flex h-6 w-6 items-center justify-center hover:text-navy disabled:opacity-40">
            <Minus className="h-3 w-3" />
          </button>
          <span onDoubleClick={() => setBarScale(undefined)} title={`Bar thickness ${Math.round(bs * 100)}% · double-click to reset`}
            className="cursor-default select-none px-0.5 text-[9.5px] font-semibold uppercase tracking-wide">Bars</span>
          <button type="button" onClick={() => stepBars(BAR_STEP)} disabled={bs >= BAR_MAX}
            title="Thicker bars" aria-label="Thicker bars"
            className="flex h-6 w-6 items-center justify-center hover:text-navy disabled:opacity-40">
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
      {/* Fixed to the reader's height in BOTH directions: shorter scrolls the list, taller spreads it.
          (The cards sit in a grid with items-start, so a neighbour's height never stretches this one —
          that stretch is what made "drag shorter" look like it did nothing.) */}
      <div ref={bodyRef} className="overflow-y-auto px-2 pt-2" style={{ height: bodyPx }}>
        {children(size)}
      </div>
      <HeightGrip
        label="Drag to make the chart taller or shorter · double-click to reset"
        onStart={() => { dragFrom.current = { px: Math.max(40, bodyRef.current?.clientHeight ?? 300), scale: hs }; }}
        onMove={(dy) => {
          const { px, scale } = dragFrom.current;
          setHScale(Math.min(H_MAX, Math.max(H_MIN, (scale * (px + dy)) / px)));
        }}
        onReset={() => setHScale(undefined)}
      />
    </div>
  );
}

/** One bar: a company, a category or a group, with its figures per expiry state for the tooltip. */
export interface BarPoint {
  key: string;
  label: string;
  parts: Record<StateKey, Totals>;
}

const totalOf = (p: BarPoint, m: Measure) => STATE_SERIES.reduce((n, s) => n + p.parts[s.key][m], 0);

function PointTooltip({ active, payload, measure }: { active?: boolean; payload?: { payload?: { p: BarPoint } }[]; measure: Measure }) {
  const p = active ? payload?.[0]?.payload?.p : undefined;
  if (!p) return null;
  const qty = totalOf(p, "qty"), val = totalOf(p, "value"), lots = totalOf(p, "lots");
  return (
    <div className="min-w-[220px] rounded-lg border border-line bg-white px-3 py-2 text-[12px] shadow-lg">
      <div className="mb-1 font-semibold text-navy">{p.label}</div>
      <div className="mb-1 text-navy"><b>{fmtKg(qty)}</b> · {fmtMoney(val)} · {lots.toLocaleString("en-IN")} lots</div>
      {STATE_SERIES.filter((s) => p.parts[s.key][measure] > 0).map((s) => (
        <div key={s.key} className="flex items-center gap-2 whitespace-nowrap">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
          <span className="text-grey">{s.label}</span>
          <span className="ml-auto font-medium tabular-nums text-navy">{fmtMeasure(measure, p.parts[s.key][measure])}</span>
        </div>
      ))}
      <div className="mt-1 text-[11px] text-orange">Click to filter the dashboard</div>
    </div>
  );
}

/** Y-axis label cut to fit, with the full name on hover. */
function NameTick({ x, y, payload, width }: { x?: number; y?: number; payload?: { value: string }; width: number }) {
  const v = payload?.value ?? "";
  const max = Math.floor(width / 6.3);
  const text = v.length > max ? `${v.slice(0, max - 1)}…` : v;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="hsl(220 20% 25%)">
      <title>{v}</title>{text}
    </text>
  );
}

export function HBarChart({ points, measure, size, color, selected, onPick, labelWidth = 150 }: {
  points: BarPoint[];
  measure: Measure;
  size: PanelSize;
  color: string;
  /** Key of the picked bar; the others fade. */
  selected: string | null;
  onPick: (key: string) => void;
  labelWidth?: number;
}) {
  const data = points.map((p) => ({ key: p.key, label: p.label, v: totalOf(p, measure), p }));
  // At least room for every bar; otherwise fill the box, so dragging it taller spreads the bars.
  const rowH = size.bar(22) + 10;
  const height = Math.max(data.length * rowH + 36, size.fill, 80);
  if (!data.length) return <div className="flex h-full items-center justify-center text-[12.5px] text-grey">Nothing in the current filters.</div>;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, left: 4, bottom: 4 }} barCategoryGap={8}
          className="cursor-pointer"
          // The whole row is the target, not just the bar — a small bar is a sliver.
          onClick={((st: { activeLabel?: string } | null, e?: { stopPropagation?: () => void }) => {
            const d = data.find((x) => x.label === st?.activeLabel);
            if (!d) return;
            e?.stopPropagation?.();
            onPick(d.key);
          }) as never}>
          <CartesianGrid stroke={CHART_GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => short(measure, v)} />
          <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={{ stroke: CHART_GRID }} interval={0}
            tick={(props: object) => <NameTick {...(props as object)} width={labelWidth} />} />
          <Tooltip cursor={{ fill: "hsl(220 15% 95%)" }} content={<PointTooltip measure={measure} />} />
          <Bar dataKey="v" radius={[0, 4, 4, 0]} maxBarSize={size.bar(22)} isAnimationActive={false}
            onClick={(d: { key?: string }, _i: number, e?: { stopPropagation?: () => void }) => {
              e?.stopPropagation?.();
              if (d?.key) onPick(d.key);
            }}>
            {data.map((d) => <Cell key={d.key} fill={color} fillOpacity={selected && selected !== d.key ? 0.25 : 1} />)}
            <LabelList dataKey="v" position="right" formatter={(v: number) => (v ? short(measure, v) : "")}
              style={{ fontSize: 10.5, fill: LABEL_FILL, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The colour key, doubling as an expiry-state filter. */
export function StateKeyRow({ totals, measure, selected, onPick }: {
  totals: Record<StateKey, Totals>;
  measure: Measure;
  selected: StateKey[];
  onPick: (s: StateKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STATE_SERIES.map((s) => {
        const on = selected.includes(s.key);
        return (
          <button key={s.key} type="button" onClick={(e) => { e.stopPropagation(); onPick(s.key); }} aria-pressed={on}
            className={"flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition " +
              (on ? "border-navy bg-navy text-white" : "border-line bg-white text-grey hover:border-navy/40 hover:text-navy") +
              (selected.length && !on ? " opacity-60" : "")}>
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            <span className="font-medium">{s.label}</span>
            <span className="tabular-nums opacity-80">{fmtMeasure(measure, totals[s.key][measure])}</span>
          </button>
        );
      })}
    </div>
  );
}
