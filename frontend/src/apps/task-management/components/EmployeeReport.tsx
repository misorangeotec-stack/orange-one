import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Combobox from "@/shared/components/ui/Combobox";
import { useTaskStore } from "../mock/store";
import { WEEK_START } from "../mock/data";
import { reportFor, actualRygFor } from "../mock/selectors";
import { addWeeks, monthKey, monthLabel } from "@/shared/lib/time";
import type { Profile } from "../types";
import { rygCounts, redCounts, RygNumCell, PerfCell } from "./RygCells";
import PlanVsActual from "./PlanVsActual";

/**
 * An employee's own Reports view: this-week RYG performance shown in the same columns as the
 * admin / HOD views, followed by their monthly Plan vs Actual breakdown.
 */
export default function EmployeeReport({ user, weekStart = WEEK_START }: { user: Profile; weekStart?: string }) {
  const { tasks } = useTaskStore();
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
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-grey-2 text-[11px] uppercase tracking-wide bg-page/50">
                <th className="text-left font-semibold px-4 py-2.5 min-w-[200px]">This week</th>
                <th className="text-left font-semibold px-3 py-2.5 w-[200px]">Performance</th>
                <th className="text-center font-semibold px-3 py-2.5">Planned</th>
                <th className="text-center font-semibold px-3 py-2.5 text-[#1f8a4d]">Green</th>
                <th className="text-center font-semibold px-3 py-2.5 text-[#B7820E]">Yellow</th>
                <th className="text-center font-semibold px-3 py-2.5 text-[#c0392b]">Red</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line bg-white">
                <td className="px-4 py-3 align-middle">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={user.name} color={user.avatarColor} size={30} />
                    <div className="min-w-0">
                      <span className="block text-[13px] font-semibold text-navy truncate">{user.name}</span>
                      {user.designation && <span className="block text-[10.5px] text-grey-2 truncate">{user.designation}</span>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-middle">
                  {r.planned ? <PerfCell ryg={actual} red={red} /> : <span className="text-[11.5px] text-grey-2">No tasks this week</span>}
                </td>
                <td className="px-3 py-3 text-center align-middle tabular-nums font-bold text-[15px] text-navy">{r.planned}</td>
                <RygNumCell count={c.green} pct={actual.green} tone="text-[#1f8a4d]" has={!!r.planned} strong />
                <RygNumCell count={c.yellow} pct={actual.yellow} tone="text-[#B7820E]" has={!!r.planned} strong />
                <RygNumCell count={c.red} pct={actual.red} tone="text-[#c0392b]" has={!!r.planned} strong />
              </tr>
            </tbody>
          </table>
        </div>
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
