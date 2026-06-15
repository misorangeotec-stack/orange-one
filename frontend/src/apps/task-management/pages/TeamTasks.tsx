import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import ReportsToTag from "../components/ReportsToTag";
import TaskBrowser from "../components/TaskBrowser";
import ScopeToggle, { scopeTasks, type Scope } from "../components/ScopeToggle";
import EmptyState from "@/shared/components/ui/EmptyState";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import { formatDateTime } from "@/shared/lib/time";

/** HOD / sub-HOD view: tasks of everyone reporting to the current user. */
export default function TeamTasks() {
  const { user } = useSession();
  const { tasks, downlineIds, profileById } = useTaskStore();
  const [scope, setScope] = useState<Scope>("week");
  // The "Team · last active" panel is collapsed by default so the task list is
  // the focus; the header acts as the expand/collapse toggle.
  const [showActivity, setShowActivity] = useState(false);

  const reportIds = downlineIds(user.id);
  const teamIds = useMemo(() => [user.id, ...reportIds], [user.id, reportIds.join(",")]);
  const team = useMemo(() => teamIds.map((id) => profileById(id)!).filter(Boolean), [teamIds.join(",")]);
  const reports = useMemo(() => reportIds.map((id) => profileById(id)!).filter(Boolean), [reportIds.join(",")]);
  const teamTasks = useMemo(
    () => scopeTasks(tasks.filter((t) => t.assignedTo && teamIds.includes(t.assignedTo)), scope),
    [tasks, teamIds.join(","), scope]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Team Tasks</h2>
          <p className="text-grey text-[13px] mt-1">Monitor and assign work across your team.</p>
        </div>
        <Link
          to="/task-management/tasks/new"
          className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Assign Task
        </Link>
      </div>

      {/* scope toggle: this week vs all time — same placement as the dashboard */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-grey-2">
          Showing <b className="text-navy font-semibold">{scope === "week" ? "this week" : "all time"}</b> · {teamTasks.length} task{teamTasks.length !== 1 ? "s" : ""} across your team
        </span>
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>

      {reports.length === 0 ? (
        <EmptyState title="No team members mapped" message="Once employees report to you, their tasks appear here." />
      ) : (
        <>
          <Card className="overflow-hidden">
            <button
              type="button"
              onClick={() => setShowActivity((v) => !v)}
              aria-expanded={showActivity}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-page/60 transition"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold text-navy">Team · last active</h3>
                <p className="text-[11.5px] text-grey-2 mt-0.5">When each of your team members last opened the portal.</p>
              </div>
              <span className="text-[11.5px] text-grey-2 shrink-0">{reports.length} member{reports.length !== 1 ? "s" : ""}</span>
              <svg
                className={`shrink-0 text-grey-2 transition-transform ${showActivity ? "rotate-180" : ""}`}
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {showActivity && (
              <ul className="divide-y divide-line border-t border-line">
                {reports.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={r.name} color={r.avatarColor} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13.5px] font-medium text-navy truncate">{r.name}</span>
                        <ReportsToTag person={r} viewerId={user.id} />
                      </div>
                      <div className="text-[11.5px] text-grey-2 truncate">{r.designation || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wide text-grey-2">Last active</div>
                      <div className="text-[11.5px] text-navy">{formatDateTime(r.lastActiveAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <TaskBrowser tasks={teamTasks} people={team} emptyMessage="No team tasks match these filters." hideWeekFilter />
        </>
      )}
    </div>
  );
}
