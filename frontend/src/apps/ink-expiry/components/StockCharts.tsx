/**
 * INK EXPIRY dashboard pieces — summary tiles, stacked "breakdown rows" and the expiry timeline.
 * They draw rows the page has already totalled; none of them does arithmetic of its own beyond
 * shares of the row they are given, so they cannot disagree with the tables.
 *
 * Colour follows the thing, never its rank:
 *   - Expiry state: Updated blue · Expired red · Not updated yellow · No lot grey.
 *     Checked with the dataviz palette validator on white: lightness band, CVD separation
 *     (worst adjacent ΔE 13.8 protan) and the normal-vision floor all pass. Grey is DELIBERATELY
 *     colourless — stock with no lot cannot carry an expiry, so it is "not applicable", not a
 *     fourth series. Yellow and grey sit under 3:1 on white, so every segment is also labelled
 *     (percent inside, figures in the hover card and the key).
 *   - Timeline: red = already expired, orange = expires this month or next (the window to act
 *     in), blue = later. The key under the chart says so in words.
 *
 * Breakdown rows are plain HTML rather than a chart library: names never wrap onto two lines,
 * each row carries its own total, and every segment is a real button (keyboard + screen reader).
 */
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Measure = "qty" | "value" | "lots";

export const MEASURE_LABEL: Record<Measure, string> = {
  qty: "Quantity (KGS)",
  value: "Value (₹)",
  lots: "Lots",
};

export const STATE_SERIES = [
  { key: "updated", label: "Expiry updated", color: "#2a78d6", ink: "#FFFFFF" },
  { key: "expired", label: "Expired", color: "#e34948", ink: "#FFFFFF" },
  { key: "missing", label: "Expiry not updated", color: "#eda100", ink: "#0B1F3A" },
  { key: "nolot", label: "No lot (can't take expiry)", color: "#a8a69e", ink: "#0B1F3A" },
] as const;
export type StateKey = (typeof STATE_SERIES)[number]["key"];

export interface Totals { qty: number; value: number; lots: number }
export const zero = (): Totals => ({ qty: 0, value: 0, lots: 0 });

/** ₹ in lakh / crore, the way the business reads it. */
export function fmtMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
export const fmtKg = (n: number) => `${Math.round(n).toLocaleString("en-IN")} KGS`;

export function fmtMeasure(m: Measure, n: number): string {
  return m === "value" ? fmtMoney(n) : m === "qty" ? fmtKg(n) : `${n.toLocaleString("en-IN")} lot${n === 1 ? "" : "s"}`;
}

/** Short axis / in-bar label. */
export function short(m: Measure, n: number): string {
  if (m === "value") return n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n));
}

const pct = (part: number, whole: number) => (whole > 0 ? (100 * part) / whole : 0);
const pctText = (p: number) => (p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);

/* ------------------------------------------------------------------- summary tile -- */

export function Tile({ label, value, sub, accent, icon, children, onClick, active, hint }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent: string;
  icon: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  /** This tile's filter is the one applied — drawn with a ring. */
  active?: boolean;
  /** Small call to action under the figures, e.g. "Click to list these lots". */
  hint?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    // Compact: icon, label and figure on one band, the detail line under it — about half the old height.
    <Tag onClick={onClick} aria-pressed={onClick ? !!active : undefined} title={onClick ? (active ? "Showing these — click again to clear" : hint) : undefined}
      className={"relative overflow-hidden rounded-xl border bg-white py-2 pl-4 pr-3 text-left shadow-sm " +
        (active ? "border-orange ring-2 ring-orange/30 " : "border-line ") +
        (onClick ? "cursor-pointer transition hover:border-orange/60 hover:shadow-md" : "")}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[13px]" style={{ background: `${accent}1A`, color: accent }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[10.5px] font-semibold uppercase tracking-wide text-grey">{label}</span>
            {onClick && <span className={"shrink-0 text-[10.5px] font-semibold " + (active ? "text-orange" : "text-orange/70")}>{active ? "✓ showing" : "view →"}</span>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[19px] font-bold leading-tight text-navy">{value}</span>
            {sub && <span className="truncate text-[11.5px] text-grey">{sub}</span>}
          </div>
        </div>
      </div>
      {children}
    </Tag>
  );
}

/* ---------------------------------------------------------------- breakdown rows -- */

export interface BreakdownRow {
  key: string;
  label: string;
  /** Second line under the name, e.g. "₹2.83 Cr · 562 lots". */
  sub?: string;
  parts: Record<StateKey, Totals>;
}

export const rowTotal = (r: BreakdownRow, m: Measure) => STATE_SERIES.reduce((n, s) => n + r.parts[s.key][m], 0);

/**
 * One row per company / category: name, a bar whose LENGTH is the row's size against the
 * largest row, split into expiry states with each part's share written inside it.
 */
export function BreakdownRows({ rows, measure, grand, selected, onSelect, labelWidth = 190 }: {
  rows: BreakdownRow[];
  measure: Measure;
  /** Denominator for "x% of all". */
  grand: number;
  selected?: { key: string; state: StateKey | null } | null;
  onSelect?: (key: string, state: StateKey | null) => void;
  labelWidth?: number;
}) {
  const [hover, setHover] = useState<{ key: string; state: StateKey } | null>(null);
  const max = Math.max(1, ...rows.map((r) => rowTotal(r, measure)));
  return (
    <div role="list" className="divide-y divide-line">
      {rows.map((r) => {
        const total = rowTotal(r, measure);
        const rowOn = selected?.key === r.key;
        const dimRow = !!selected && !rowOn;
        return (
          <div key={r.key} role="listitem"
            className={"grid items-center gap-4 py-2.5 transition " + (dimRow ? "opacity-45" : "")}
            style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr) 128px` }}>
            <button onClick={() => onSelect?.(r.key, null)} title={`${r.label} — list all`}
              className={"min-w-0 text-left " + (onSelect ? "group cursor-pointer" : "")}>
              <div className={"truncate text-[13px] font-semibold " + (rowOn && !selected?.state ? "text-orange" : "text-navy group-hover:text-orange")}>
                {r.label}
              </div>
              {r.sub && <div className="truncate text-[11.5px] text-grey">{r.sub}</div>}
            </button>

            <div className="flex h-7 items-stretch gap-[2px]" style={{ width: `${Math.max(pct(total, max), 1.5)}%` }}>
              {STATE_SERIES.map((s) => {
                const v = r.parts[s.key][measure];
                if (v <= 0) return null;
                const p = pct(v, total);
                const on = rowOn && selected?.state === s.key;
                const dim = rowOn && !!selected?.state && !on;
                const hov = hover?.key === r.key && hover.state === s.key;
                return (
                  <button key={s.key}
                    onClick={() => onSelect?.(r.key, s.key)}
                    onMouseEnter={() => setHover({ key: r.key, state: s.key })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ key: r.key, state: s.key })}
                    onBlur={() => setHover(null)}
                    aria-label={`${r.label}, ${s.label}: ${fmtMeasure(measure, v)} (${pctText(p)})`}
                    className={"relative flex min-w-[3px] items-center justify-center rounded-[4px] text-[11px] font-semibold transition " +
                      (on ? "ring-2 ring-navy ring-offset-1 " : "") + (dim ? "opacity-35 " : "") + "hover:brightness-110"}
                    style={{ flexGrow: v, flexBasis: 0, background: s.color, color: s.ink }}>
                    {p >= 9 && <span className="truncate px-1">{pctText(p)}</span>}
                    {hov && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max -translate-x-1/2 rounded-lg border border-line bg-white px-3 py-2 text-left text-[12px] font-normal text-navy shadow-lg">
                        <span className="mb-0.5 block font-semibold">{r.label}</span>
                        <span className="flex items-center gap-1.5">
                          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="mt-1 block">
                          <b>{fmtKg(r.parts[s.key].qty)}</b> · {fmtMoney(r.parts[s.key].value)}
                          {s.key !== "nolot" && <> · {r.parts[s.key].lots.toLocaleString("en-IN")} lots</>}
                        </span>
                        <span className="block text-grey">{pctText(p)} of this row · click to list</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-right">
              <div className="text-[13px] font-bold tabular-nums text-navy">{fmtMeasure(measure, total)}</div>
              <div className="text-[11px] tabular-nums text-grey">{pctText(pct(total, grand))} of all</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StateLegend({ totals, measure }: { totals: Record<StateKey, Totals>; measure: Measure }) {
  const grand = STATE_SERIES.reduce((n, s) => n + totals[s.key][measure], 0);
  return (
    <div className="flex flex-wrap gap-2">
      {STATE_SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[12px]">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          <span className="font-medium text-navy">{s.label}</span>
          <span className="tabular-nums text-grey">{fmtMeasure(measure, totals[s.key][measure])} · {pctText(pct(totals[s.key][measure], grand))}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ expiry timeline -- */

export interface TimelineBucket {
  key: string;
  label: string;
  /** "expired" | "soon" | "later" — picks the colour. */
  tone: "expired" | "soon" | "later";
  totals: Totals;
}

const TONE: Record<TimelineBucket["tone"], string> = { expired: "#e34948", soon: "#eb6834", later: "#2a78d6" };
const AXIS = { fontSize: 11, fill: "#64748B" };

export function ExpiryTimeline({ buckets, measure, selected, onSelect }: {
  buckets: TimelineBucket[];
  measure: Measure;
  selected?: string | null;
  onSelect?: (b: TimelineBucket) => void;
}) {
  const data = buckets.map((b) => ({ label: b.label, v: b.totals[measure], b }));
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%"
          onClick={(e) => {
            const b = buckets.find((x) => x.label === e?.activeLabel);
            if (b) onSelect?.(b);
          }}
          style={onSelect ? { cursor: "pointer" } : undefined}>
          <CartesianGrid stroke="#EEF2F8" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: "#E2E8F0" }} tickLine={false} interval={0} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} tickFormatter={(n: number) => short(measure, n)} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(255,106,31,0.06)" }}
            content={({ active, payload }) => {
              const b = active ? (payload?.[0]?.payload as { b: TimelineBucket } | undefined)?.b : undefined;
              if (!b) return null;
              return (
                <div className="rounded-lg border border-line bg-white px-3 py-2 text-[12px] text-navy shadow-lg">
                  <div className="mb-0.5 font-semibold">{b.tone === "expired" ? "Already expired" : `Expires ${b.label}`}</div>
                  <div><b>{b.totals.lots}</b> lots · {fmtKg(b.totals.qty)} · {fmtMoney(b.totals.value)}</div>
                  <div className="text-grey">click to list the lots</div>
                </div>
              );
            }}
          />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={TONE[d.b.tone]} fillOpacity={selected && selected !== d.b.key ? 0.3 : 1} />
            ))}
            <LabelList dataKey="v" position="top" style={{ fontSize: 11, fill: "#334155", fontWeight: 600 }}
              formatter={(n: number) => (n > 0 ? short(measure, n) : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TimelineKey() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-grey">
      {([["expired", "Already expired, still in stock"], ["soon", "Expires this month or next — act now"], ["later", "Expires later"]] as const).map(([t, l]) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TONE[t] }} />{l}
        </span>
      ))}
    </div>
  );
}
