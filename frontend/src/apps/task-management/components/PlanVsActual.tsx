import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import { weekStartOf, weekEndOf, addWeeks, monthKey, formatDate } from "@/shared/lib/time";
import { useTaskStore } from "../mock/store";
import { aggregateRyg } from "../mock/selectors";
import type { RygPct } from "../mock/selectors";
import type { Profile } from "../types";
import RygBar from "./RygBar";

/** Mondays whose week sits inside the given "yyyy-mm" month. */
function weeksInMonth(month: string): string[] {
  const out: string[] = [];
  let w = weekStartOf(`${month}-01`);
  if (monthKey(w) !== month) w = addWeeks(w, 1);
  while (monthKey(w) === month) {
    out.push(w);
    w = addWeeks(w, 1);
  }
  return out;
}

/** Planned-vs-actual RYG for a set of people over a month: rollup + weekly breakdown. */
export default function PlanVsActual({ people, month }: { people: Profile[]; month: string }) {
  const { tasks, weeklyPlanFor } = useTaskStore();
  const ids = useMemo(() => people.map((p) => p.id), [people]);
  const weeks = useMemo(() => weeksInMonth(month), [month]);

  const rollup = useMemo(() => aggregateRyg(ids, weeks, tasks, weeklyPlanFor), [ids, weeks, tasks, weeklyPlanFor]);
  const weekly = useMemo(
    () => weeks.map((w) => ({ w, ...aggregateRyg(ids, [w], tasks, weeklyPlanFor) })),
    [ids, weeks, tasks, weeklyPlanFor]
  );

  if (people.length === 0) return <EmptyState title="No one to report on" message="Pick a different selection." />;

  const delta = rollup.planned.total && rollup.actual.total ? rollup.actual.green - rollup.planned.green : null;

  return (
    <div className="space-y-4">
      {/* month rollup tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Planned green" value={rollup.planned.total ? `${rollup.planned.green}%` : "—"} tone="text-[#27AE60]" />
        <Tile label="Actual green" value={rollup.actual.total ? `${rollup.actual.green}%` : "—"} tone="text-[#27AE60]" />
        <Tile label="Variance" value={delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta}%`} tone={delta === null ? "text-grey-2" : delta >= 0 ? "text-[#27AE60]" : "text-[#d4493f]"} />
        <Tile label="Tasks this month" value={rollup.actual.total} tone="text-navy" />
      </div>

      {/* month planned vs actual */}
      <Card className="p-5">
        <h3 className="text-[14px] font-semibold text-navy mb-4">This month — Planned vs Actual</h3>
        <PlannedActual planned={rollup.planned} actual={rollup.actual} />
      </Card>

      {/* weekly breakdown */}
      <Card className="p-5">
        <h3 className="text-[14px] font-semibold text-navy mb-4">Weekly breakdown</h3>
        <div className="space-y-5">
          {weekly.map(({ w, planned, actual }) => {
            const d = planned.total && actual.total ? actual.green - planned.green : null;
            return (
              <div key={w} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-navy">{formatDate(w)} – {formatDate(weekEndOf(w))}</span>
                  {d !== null && (
                    <span className={"text-[11.5px] font-semibold " + (d >= 0 ? "text-[#27AE60]" : "text-[#d4493f]")}>
                      {d >= 0 ? "+" : ""}{d}% vs plan
                    </span>
                  )}
                </div>
                <PlannedActual planned={planned} actual={actual} compact />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/** Two stacked, labelled RYG bars: planned over actual. */
function PlannedActual({ planned, actual, compact = false }: { planned: RygPct; actual: RygPct; compact?: boolean }) {
  return (
    <div className="grid grid-cols-[58px_1fr] items-center gap-x-3 gap-y-2.5">
      <BarRow label="Planned" ryg={planned} emptyText="No plan set" showLegend={!compact} />
      <BarRow label="Actual" ryg={actual} emptyText="No tasks logged" showLegend={!compact} />
    </div>
  );
}

function BarRow({ label, ryg, emptyText, showLegend }: { label: string; ryg: RygPct; emptyText: string; showLegend: boolean }) {
  return (
    <>
      <span className="text-[12px] font-medium text-grey">{label}</span>
      <div>
        {ryg.total ? (
          <RygBar red={ryg.red} yellow={ryg.yellow} green={ryg.green} showLegend={showLegend} />
        ) : (
          <span className="text-[12px] text-grey-2">{emptyText}</span>
        )}
      </div>
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <div className={`text-[22px] font-bold leading-none ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-grey mt-1.5">{label}</div>
    </Card>
  );
}
