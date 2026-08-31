/**
 * TIME PER LOT, BY STAGE — one horizontal bar per lot, split into the five stages.
 *
 * Reading across one bar says where that lot's time went; comparing bars says which
 * lots are slow and which stage made them slow. That is the question the table can
 * only answer by arithmetic across a row.
 *
 * ⚠ DOES NO ARITHMETIC. The rows arrive already computed from
 *   `lib/cycleTime.lotStageChartRows`, which is the same module the table reads. A
 *   chart that totals its own data is a second source of truth, and it will
 *   eventually disagree with the table sitting right beneath it.
 *
 * ⚠ ALWAYS FIVE STAGES, even when the table is toggled to eleven steps. The shared
 *   categorical palette holds eight fixed hues; eleven segments would mean cycling
 *   colours or inventing ones nobody can tell apart, and an eleven-colour stacked bar
 *   is unreadable at this height anyway. Step detail is what the table is for — hence
 *   the "by stage" in the heading.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { formatDuration } from "@/shared/lib/time";
import { STAGES } from "../lib/steps";
import { lotStageChartRows, type LotChartRow, type LotCycle } from "../lib/cycleTime";

/** How many bars before the chart stops being readable. */
const LIMIT = 20;

/**
 * Colour per STAGE — fixed, and assigned by the stage's identity, never by its rank
 * in the current view. Filtering a stage out must not repaint the survivors, or two
 * screenshots of the same screen mean different things.
 *
 * These are the first five of the categorical palette hr-exit and hr-recruitment
 * already share. Checked with a palette validator rather than by eye: all five clear
 * the lightness band, the chroma floor, colour-vision separation (worst adjacent pair
 * ΔE 17.6 protan) and the normal-vision floor (ΔE 27.3).
 *
 * ⚠ Orange and green sit just under 3:1 against a white card, which obliges a
 *   non-colour way to read the same numbers. The full Lot Cycle Time table is
 *   directly below and carries every figure, and the tooltip names each stage in
 *   text — so identity is never colour alone.
 */
const STAGE_COLOR: Record<string, string> = {
  "Handover & QC": "#FF6A1F",
  "Log Book & Production": "#2563EB",
  "M/C Testing": "#27AE60",
  Packing: "#7C5CFC",
  Dispatch: "#F43F8E",
};

const AXIS = { fontSize: 11, fill: "#64748B" };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid #EEF2F8",
  fontSize: 12,
  boxShadow: "0 6px 20px rgba(11,27,64,0.08)",
};

/** A running stage is drawn faint. The key above the plot says so, and shows a swatch. */
const RUNNING_OPACITY = 0.45;

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload?: LotChartRow }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div style={tooltipStyle} className="bg-white px-3 py-2">
      <div className="mb-1 font-semibold text-navy">{row.lot}</div>
      {STAGES.map((s) => {
        const slice = row.byStage[s.label];
        if (!slice || slice.ms == null) return null;
        return (
          <div key={s.label} className="flex items-center gap-2 whitespace-nowrap">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: STAGE_COLOR[s.label] }} />
            <span className="text-grey-2">{s.label}</span>
            <span className="ml-auto font-medium text-navy">
              {formatDuration(slice.ms)}
              {slice.running && <span className="text-grey-2"> · running</span>}
            </span>
          </div>
        );
      })}
      <div className="mt-1 border-t border-line pt-1 text-navy">
        <span className="text-grey-2">Total</span>{" "}
        <span className="font-semibold">
          {formatDuration(row.totalMs)}
          {!row.done && " so far"}
        </span>
      </div>
    </div>
  );
}

export default function LotStageChart({ cycles }: { cycles: LotCycle[] }) {
  const { rows, shown, total } = lotStageChartRows(cycles, LIMIT);

  // Nothing measured anywhere — an empty frame with axes reads as "all stages are
  // instant", which is the opposite of "no data yet".
  const anyData = rows.some((r) => Object.values(r.byStage).some((s) => s.ms != null));
  if (!anyData) return null;

  const anyRunning = rows.some((r) => Object.values(r.byStage).some((s) => s.running));

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>
          Time per lot, by stage
          <span className="ml-1.5 font-medium normal-case tracking-normal text-grey-2">(days)</span>
        </h3>
        <span className="text-[12px] text-grey tabular-nums">
          {shown} of {total} lot{total === 1 ? "" : "s"}
        </span>
      </div>

      {/*
        The key sits ABOVE the plot, not below it. Recharts puts its own legend under
        the chart, which on a twenty-bar chart means scrolling past every bar before
        finding out what the colours mean.

        The pale swatch is here for the same reason: a half-opacity segment is the
        first thing anyone asks about, and answering it in a footnote under the plot
        is answering it too late.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px]">
        {STAGES.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: STAGE_COLOR[s.label] }}
            />
            <span className="font-medium text-navy">{s.label}</span>
          </span>
        ))}
        {anyRunning && (
          <span className="inline-flex items-center gap-1.5 border-l border-line pl-4">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: STAGE_COLOR["Log Book & Production"], opacity: RUNNING_OPACITY }}
            />
            <span className="text-grey-2">
              Paler = the lot is <span className="font-medium text-navy">still in that stage</span>
            </span>
          </span>
        )}
      </div>

      <div style={{ height: Math.max(200, rows.length * 26 + 60) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap={6}>
            <CartesianGrid stroke="#EEF2F8" horizontal={false} />
            <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="lot" tick={AXIS} axisLine={false} tickLine={false} width={86} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,106,31,0.06)" }} />
            {STAGES.map((s) => (
              <Bar
                key={s.label}
                // The FLAT key, not `byStage.<label>.days` — recharts resolves a
                // dataKey through a lodash-style path and two of our labels carry
                // characters ("M/C Testing", "Handover & QC") that a path parser has
                // no business seeing. See LotChartRow.
                dataKey={s.label}
                name={s.label}
                stackId="a"
                fill={STAGE_COLOR[s.label]}
                // A 2px surface gap between segments, so two adjacent stages never
                // read as one block. Rounding the right edge of every segment rather
                // than only the last one: Dispatch has no data on any lot yet, so a
                // rounded end pinned to it would never actually appear.
                stroke="#FFFFFF"
                strokeWidth={2}
                radius={[0, 3, 3, 0]}
                maxBarSize={20}
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.id}
                    fillOpacity={row.byStage[s.label]?.running ? RUNNING_OPACITY : 1}
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-1 text-[12px] text-grey-2">
        {total > shown && (
          <p>
            Showing the {shown} slowest of {total} lots in view — narrow the filters above to see others.
          </p>
        )}
      </div>
    </Card>
  );
}
