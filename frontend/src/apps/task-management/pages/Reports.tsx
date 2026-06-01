import { useMemo, useState } from "react";
import { WEEK_START } from "../mock/data";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import DepartmentReport from "../components/DepartmentReport";
import EmployeeReport from "../components/EmployeeReport";
import WeeklyPlanModal from "../components/WeeklyPlanModal";
import { formatDate, addWeeks, weekStartOf, weekEndOf } from "@/shared/lib/time";

const fmt = (iso: string) => formatDate(iso);

export default function Reports() {
  const { user, isAdmin, isHod } = useSession();
  const { profileById, directReportIds, canWrite } = useTaskStore();
  const [planOpen, setPlanOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(WEEK_START);
  const isManager = isAdmin || isHod;

  // A HOD/sub-HOD's team = themselves + their direct reports; used to scope their department view.
  const team = useMemo(() => [user.id, ...directReportIds(user.id)].map((id) => profileById(id)!).filter(Boolean), [user.id]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Reports</h2>
          <WeekNav weekStart={weekStart} onChange={setWeekStart} />
        </div>
        {isManager && canWrite && (
          <button
            onClick={() => setPlanOpen(true)}
            className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Set weekly plan
          </button>
        )}
      </div>

      <RygLegend />

      {isManager ? (
        <DepartmentReport
          weekStart={weekStart}
          scope={isAdmin ? undefined : { deptId: user.departmentId, memberIds: team.map((p) => p.id), selfId: user.id }}
        />
      ) : (
        <EmployeeReport user={user} weekStart={weekStart} />
      )}

      {isManager && <WeeklyPlanModal open={planOpen} onClose={() => setPlanOpen(false)} />}
    </div>
  );
}

/** Explains what the Red/Yellow/Green bars mean, shown at the top of every report. */
function RygLegend() {
  const items = [
    { dot: "bg-ryg-green", label: "Green", desc: "Completed on time" },
    { dot: "bg-ryg-yellow", label: "Yellow", desc: "Revised — needed rework" },
    { dot: "bg-ryg-red", label: "Red", desc: "Missed, shifted, in progress or still pending" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-white px-4 py-2.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">RYG key</span>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-2 text-[12.5px]">
          <span className={`w-2.5 h-2.5 rounded-full ${it.dot}`} />
          <span className="font-semibold text-navy">{it.label}</span>
          <span className="text-grey-2">— {it.desc}</span>
        </span>
      ))}
    </div>
  );
}

/** Previous / next / custom-week picker for the week-based reports. */
function WeekNav({ weekStart, onChange }: { weekStart: string; onChange: (ws: string) => void }) {
  const weekEnd = weekEndOf(weekStart);
  const isCurrent = weekStart === WEEK_START;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(addWeeks(weekStart, -1))}
        aria-label="Previous week"
        className="w-7 h-7 grid place-items-center rounded-lg border border-line text-grey hover:text-orange hover:border-orange/40 transition"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <span className="text-[13px] text-grey font-medium px-1 text-center tabular-nums">
        week of {fmt(weekStart)} – {fmt(weekEnd)}
      </span>
      <button
        type="button"
        onClick={() => onChange(addWeeks(weekStart, 1))}
        aria-label="Next week"
        className="w-7 h-7 grid place-items-center rounded-lg border border-line text-grey hover:text-orange hover:border-orange/40 transition"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
      <input
        type="date"
        value={weekStart}
        onChange={(e) => e.target.value && onChange(weekStartOf(e.target.value))}
        title="Pick any day to jump to that week"
        className="ml-1 rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] text-ink outline-none focus:border-orange cursor-pointer"
      />
      {!isCurrent && (
        <button type="button" onClick={() => onChange(WEEK_START)} className="ml-1 text-[12.5px] font-semibold text-orange hover:underline">
          This week
        </button>
      )}
    </div>
  );
}
