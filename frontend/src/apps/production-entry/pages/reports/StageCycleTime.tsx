/**
 * STAGE CYCLE TIME — one row per stage (or per step): what it takes on average, and
 * how often it comes in inside its target.
 *
 * Reads the SAME filtered lot set as the Lot Cycle Time screen, through the same
 * hook, so the two can never report different books. All arithmetic lives in
 * `lib/cycleTime.aggregate` — this file draws, it does not count.
 *
 * ⚠ WHAT SITS BEHIND AN AVERAGE. A leg counts only when it is finished, applies to
 *   that card type, and does not finish before it starts. Everything else is
 *   reported as a COUNT beside the average — lots still in the stage, lots that skip
 *   it, and the legs measured at under a minute — rather than being folded into a
 *   number that would then be quietly wrong.
 */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { formatDuration } from "@/shared/lib/time";
import CycleFilters from "../../components/CycleFilters";
import { useCycleReport } from "./useCycleReport";
import { aggregate, subMinuteCount, measuredLegCount, msToHours, type StatRow } from "../../lib/cycleTime";

const ORANGE = "#FF6A1F";
const AXIS = { fontSize: 11, fill: "#64748B" };
const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid #EEF2F8",
  fontSize: 12,
  boxShadow: "0 6px 20px rgba(11,27,64,0.08)",
};

/** Days, one decimal — the axis unit a factory reads a stage in. */
const toDays = (ms: number | null): number => (ms == null ? 0 : Math.round((ms / 86_400_000) * 10) / 10);

const pct = (n: number | null): string => (n == null ? "—" : `${Math.round(n)}%`);

export default function StageCycleTime() {
  const r = useCycleReport();

  const rows = useMemo(
    () => aggregate(r.rows, r.level, r.stepSla),
    [r.rows, r.level, r.stepSla],
  );

  // Both counts are over STEP legs, whichever detail level is showing. Counting
  // sub-minute steps against a total of measured STAGES would be two different
  // units in one sentence, and the ratio would be nonsense.
  const subMinute = useMemo(() => subMinuteCount(r.rows), [r.rows]);
  const measuredLegs = useMemo(() => measuredLegCount(r.rows), [r.rows]);

  // Only stages with something to plot. A row of zero-height bars for stages no lot
  // has reached reads as "these are instant", which is the opposite of "no data".
  const chartData = useMemo(
    () => rows.filter((s) => s.medianMs != null).map((s) => ({ label: s.label, days: toDays(s.medianMs), row: s })),
    [rows],
  );

  const columns = useMemo<QueueColumn<StatRow>[]>(
    () => [
      {
        key: "stage",
        header: r.level === "stage" ? "Stage" : "Step",
        alwaysVisible: true,
        cell: (s) => <span className="font-semibold text-navy">{s.label}</span>,
        sortValue: (s) => s.label,
        filter: { kind: "select", get: (s) => s.label },
      },
      {
        key: "measured",
        header: "Lots measured",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) => (s.measured ? String(s.measured) : <span className="text-grey-2">none yet</span>),
        sortValue: (s) => s.measured,
      },
      {
        key: "now",
        header: "In it now",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) => (s.inItNow ? String(s.inItNow) : "—"),
        sortValue: (s) => s.inItNow,
      },
      {
        key: "mean",
        header: "Average",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) => formatDuration(s.meanMs),
        sortValue: (s) => s.meanMs ?? -1,
        exportValue: (s) => msToHours(s.meanMs),
      },
      {
        key: "median",
        header: "Median",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) => <span className="font-semibold text-navy">{formatDuration(s.medianMs)}</span>,
        sortValue: (s) => s.medianMs ?? -1,
        exportValue: (s) => msToHours(s.medianMs),
      },
      {
        key: "p90",
        header: "P90",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) => formatDuration(s.p90Ms),
        sortValue: (s) => s.p90Ms ?? -1,
        exportValue: (s) => msToHours(s.p90Ms),
      },
      {
        key: "min",
        header: "Fastest",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        defaultHidden: true,
        cell: (s) => formatDuration(s.minMs),
        sortValue: (s) => s.minMs ?? -1,
        exportValue: (s) => msToHours(s.minMs),
      },
      {
        key: "max",
        header: "Slowest",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) => formatDuration(s.maxMs),
        sortValue: (s) => s.maxMs ?? -1,
        exportValue: (s) => msToHours(s.maxMs),
      },
      {
        key: "target",
        header: "Target",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) =>
          s.targetDays == null ? (
            <span className="text-grey-2" title="This step is entered without dates and never runs overdue.">
              none set
            </span>
          ) : (
            `${s.targetDays} day${s.targetDays === 1 ? "" : "s"}`
          ),
        sortValue: (s) => s.targetDays ?? -1,
      },
      {
        key: "within",
        header: "Within target",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) =>
          s.withinPct == null ? (
            "—"
          ) : (
            <span className={s.withinPct >= 80 ? "font-semibold text-ryg-green" : "font-semibold text-ryg-red"}>
              {pct(s.withinPct)}
            </span>
          ),
        sortValue: (s) => s.withinPct ?? -1,
        exportValue: (s) => (s.withinPct == null ? "" : Math.round(s.withinPct)),
      },
      {
        // Published, not hidden: it is the honest denominator. A stage whose average
        // rests mostly on same-second entries has not been measured, it has been typed.
        key: "subMinute",
        header: "Of which <1m",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (s) =>
          s.subMinute ? (
            <span className="text-ryg-red" title="Steps saved within a minute of each other — entered together, not worked that fast.">
              {s.subMinute}
            </span>
          ) : (
            "—"
          ),
        sortValue: (s) => s.subMinute,
      },
      {
        key: "na",
        header: "Skipped",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        defaultHidden: true,
        cell: (s) => (s.notApplicable ? String(s.notApplicable) : "—"),
        sortValue: (s) => s.notApplicable,
      },
    ],
    [r.level],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Stage Cycle Time</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          How long each stage takes, across the lots in view. Only finished stages count toward an
          average — lots still sitting in a stage are shown separately, not averaged in.
        </p>
        {subMinute > 0 && (
          <p className="mt-1.5 text-[12.5px] text-ryg-red">
            {subMinute} of {measuredLegs} measured steps were saved within a minute of the step
            before them — those steps were entered together, so the figures below understate real
            floor time until steps are recorded as they happen.
          </p>
        )}
      </div>

      <CycleFilters r={r} />

      {chartData.length >= 2 && (
        <Card className="space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
            <h3 className={SECTION_HEADING_CLASS}>
              Median time per {r.level === "stage" ? "stage" : "step"}
              <span className="ml-1.5 font-medium normal-case tracking-normal text-grey-2">(days)</span>
            </h3>
            <span className="text-[12px] text-grey tabular-nums">
              {r.rows.length} lot{r.rows.length === 1 ? "" : "s"} in view
            </span>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#EEF2F8" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                  width={r.level === "stage" ? 140 : 120}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "rgba(255,106,31,0.06)" }}
                  formatter={(_v, _n, item) => {
                    const row = (item?.payload as { row?: StatRow } | undefined)?.row;
                    return [
                      `${formatDuration(row?.medianMs ?? null)} across ${row?.measured ?? 0} lot${
                        row?.measured === 1 ? "" : "s"
                      }`,
                      "Median",
                    ];
                  }}
                />
                <Bar dataKey="days" fill={ORANGE} radius={[0, 4, 4, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <QueueTable
        rows={rows}
        rowKey={(s) => s.key}
        columns={columns}
        rowsLabel={r.level === "stage" ? "stages" : "steps"}
        loading={r.isLoading}
        initialSort={{ key: "median", dir: "desc" }}
        emptyTitle="Nothing measured yet"
        emptyMessage="A stage appears here once a lot has passed all the way through it."
        exportName="Production_Stage_Cycle_Time"
        exportTitle="Production — stage cycle time"
        exportNotes={EXPORT_NOTES}
        columnPicker={{ storageKey: "production-stage-cycle" }}
      />
    </div>
  );
}

const EXPORT_NOTES: string[] = [
  "Durations are plain clock time between one step's completion stamp and the next — nights, Sundays and holidays included.",
  "A stage counts toward these figures only once a lot has cleared EVERY step in it. A lot still sitting in the stage is reported under 'In it now' and is not averaged.",
  "'Skipped' counts lots that never run the stage — a repackaging card skips material handover, RM transfer, quality, the log book, production entry and M/C testing.",
  "'Target' is the allowance configured in Setup → Due Dates. The Log Book Entry has none: it is entered without dates and never runs overdue. A stage target excludes the Additional Issue Slip's allowance, so a lot that needed no rework is not measured against a budget for it.",
  "'Of which <1m' counts measured stages saved within a minute of the step before them. Those steps were ENTERED together, not worked that fast — treat an average resting on them as a data-entry artefact, not a floor time.",
  "REWORK IS UNDER-COUNTED: when a QC-rejected lot loops back through the Additional Issue Slip, the handover, RM transfer and quality steps keep their FIRST timestamps, so the repeat passes are invisible to the Handover & QC figures.",
  "A HOLD THAT HAS ENDED IS INVISIBLE: the hold timestamp is cleared on resume, so time spent on hold is included in a stage's duration with nothing to mark it.",
  "Legs stamped as finishing before they started are excluded from every figure here.",
];
