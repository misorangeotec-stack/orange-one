import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTaskStore } from "../mock/store";
import TaskBrowser from "../components/TaskBrowser";
import ScopeToggle, { scopeTasks, type Scope } from "../components/ScopeToggle";

/** Admin view: every task across the organization, filterable by department/person. */
export default function AllTasks() {
  const { tasks, profiles, departments } = useTaskStore();
  const [scope, setScope] = useState<Scope>("week");

  const scopedTasks = useMemo(() => scopeTasks(tasks, scope), [tasks, scope]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">All Tasks</h2>
          <p className="text-grey text-[13px] mt-1">Organization-wide task visibility and workload.</p>
        </div>
        <Link
          to="/task-management/tasks/new"
          className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Task
        </Link>
      </div>

      {/* scope toggle: this week vs all time — same placement as the dashboard */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-grey-2">
          Showing <b className="text-navy font-semibold">{scope === "week" ? "this week" : "all time"}</b> · {scopedTasks.length} task{scopedTasks.length !== 1 ? "s" : ""} organization-wide
        </span>
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>

      <TaskBrowser tasks={scopedTasks} people={profiles} departments={departments} emptyMessage="No tasks match these filters." hideWeekFilter />
    </div>
  );
}
