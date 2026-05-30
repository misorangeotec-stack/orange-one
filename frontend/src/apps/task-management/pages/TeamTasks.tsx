import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import TaskBrowser from "../components/TaskBrowser";
import EmptyState from "@/shared/components/ui/EmptyState";

/** HOD / sub-HOD view: tasks of everyone reporting to the current user. */
export default function TeamTasks() {
  const { user } = useSession();
  const { tasks, directReportIds, profileById } = useTaskStore();

  const reportIds = directReportIds(user.id);
  const teamIds = useMemo(() => [user.id, ...reportIds], [user.id, reportIds.join(",")]);
  const team = useMemo(() => teamIds.map((id) => profileById(id)!).filter(Boolean), [teamIds.join(",")]);
  const teamTasks = useMemo(
    () => tasks.filter((t) => t.assignedTo && teamIds.includes(t.assignedTo)),
    [tasks, teamIds.join(",")]
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

      {directReportIds(user.id).length === 0 ? (
        <EmptyState title="No team members mapped" message="Once employees report to you, their tasks appear here." />
      ) : (
        <TaskBrowser tasks={teamTasks} people={team} emptyMessage="No team tasks match these filters." />
      )}
    </div>
  );
}
