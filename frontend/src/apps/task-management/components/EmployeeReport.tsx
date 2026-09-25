import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { FitTh, ResetWidths } from "@/shared/components/ui/ColumnResizer";
import { useColumnWidths } from "@/shared/lib/useColumnWidths";
import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Combobox from "@/shared/components/ui/Combobox";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { WEEK_START } from "../mock/data";
import { reportFor, actualRygFor } from "../mock/selectors";
import { addWeeks, monthKey, monthLabel } from "@/shared/lib/time";
import type { Profile } from "../types";
import { taskListLink } from "../lib/taskLink";
import { rygCounts, redCounts, RygNumCell, PerfCell } from "./RygCells";
import PlanVsActual from "./PlanVsActual";
import ReportsToTag from "./ReportsToTag";

/**
 * An employee's own Reports view: this-week RYG performance shown in the same columns as the
 * admin / HOD views, followed by their monthly Plan vs Actual breakdown.
 */
/** The draggable columns, for their remembered widths (PF-20). */
const WEEK_COLS = ["week", "performance", "planned", "green", "yellow", "red"];

export default function EmployeeReport({ user, weekStart = WEEK_START }: { user: Profile; weekStart?: string }) {
  const { role } = useSession();
  const { tasks } = useTaskStore();
  /**
   * PF-20 (drag only): a column's right edge drags wider, and the width is remembered per browser
   * (double-click the edge to put it back). Nothing else about this table changes.
   */
  const fit = useColumnWidths("tb", WEEK_COLS);
  const weekTasks = useMemo(() => tasks.filter((t) => t.weekStart === weekStart), [tasks, weekStart]);

  const r = useMemo(() => reportFor(weekTasks, user.id), [weekTasks, user.id]);
  const actual = useMemo(() => actualRygFor(weekTasks, user.id, weekStart), [weekTasks, user.id, weekStart]);
  const red = useMemo(() => redCounts(weekTasks, new Set([user.id])), [weekTasks, user.id]);
  const c = rygCounts(r);

  // month picker for the Plan vs Actual section (recent months that may hold data)
  const monthOpts = useMemo(() => {
    const keys = new Set<string>();
    for (let n = -6; n <= 2; n++) keys.add(monthKey(addWeeks(WEEK_START, n)));
    return [...keys].sort().reverse().map((k) => ({ value: k, label: monthLabel(`${k}-01`) }));
  }, []);
  const [month, setMonth] = useState(monthKey(WEEK_START));
  const people = useMemo(() => [user], [user]);

  return (
    <div className="space-y-5">
      {/* this week — same RYG columns as the manager views */}
      <Card className="p-0 overflow-hidden">
      {/* PF-20: appears only once a column here has been dragged. */}
      {fit.anyCustom(WEEK_COLS) && (
        <div className="flex justify-end px-4 pt-2">
          <ResetWidths fit={fit} cols={WEEK_COLS} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-grey-2 hover:text-orange" />
        </div>
      )}
        <ScrollableTable>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-grey-2 text-[11px] uppercase tracking-wide bg-page/50">
                <FitTh fit={fit} col="week" className="text-left font-semibold px-4 py-2.5 min-w-[200px]">This week</FitTh>
                <FitTh fit={fit} col="performance" className="text-left font-semibold px-3 py-2.5 w-[200px]">Performance</FitTh>
                <FitTh fit={fit} col="planned" className="text-center font-semibold px-3 py-2.5">Planned</FitTh>
                <FitTh fit={fit} col="green" className="text-center font-semibold px-3 py-2.5 text-[#1f8a4d]">Green</FitTh>
                <FitTh fit={fit} col="yellow" className="text-center font-semibold px-3 py-2.5 text-[#B7820E]">Yellow</FitTh>
                <FitTh fit={fit} col="red" className="text-center font-semibold px-3 py-2.5 text-[#c0392b]">Red</FitTh>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line bg-white">
                <td className="px-4 py-3 align-middle">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={user.name} color={user.avatarColor} size={30} />
                    <div className="min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-semibold text-navy truncate">{user.name}</span>
                        <ReportsToTag person={user} />
                      </span>
                      {user.designation && <span className="block text-[10.5px] text-grey-2 truncate">{user.designation}</span>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-middle">
                  {r.planned ? <PerfCell ryg={actual} red={red} /> : <span className="text-[11.5px] text-grey-2">No tasks this week</span>}
                </td>
                <td className="px-3 py-3 text-center align-middle tabular-nums font-bold text-[15px] text-navy">{r.planned}</td>
                <RygNumCell count={c.green} pct={actual.green} tone="text-[#1f8a4d]" has={!!r.planned} strong to={r.planned ? taskListLink({ role, assignee: user.id, weekStart, colour: "green", metricOnly: true }) : undefined} />
                <RygNumCell count={c.yellow} pct={actual.yellow} tone="text-[#B7820E]" has={!!r.planned} strong to={r.planned ? taskListLink({ role, assignee: user.id, weekStart, colour: "yellow", metricOnly: true }) : undefined} />
                <RygNumCell count={c.red} pct={actual.red} tone="text-[#c0392b]" has={!!r.planned} strong to={r.planned ? taskListLink({ role, assignee: user.id, weekStart, colour: "red", metricOnly: true }) : undefined} />
              </tr>
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      {/* plan vs actual — monthly rollup + weekly breakdown */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold text-navy">Plan vs Actual</h3>
        <Combobox value={month} onChange={setMonth} className="w-auto min-w-[170px]" options={monthOpts} />
      </div>
      <PlanVsActual people={people} month={month} />
    </div>
  );
}
