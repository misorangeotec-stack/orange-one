import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import TaskBrowser from "../components/TaskBrowser";
import EmptyState from "@/shared/components/ui/EmptyState";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import { formatDateTime } from "@/shared/lib/time";

/** HOD / sub-HOD view: tasks of everyone reporting to the current user. */
export default function TeamTasks() {
  const { user } = useSession();
  const { tasks, downlineIds, profileById } = useTaskStore();

  const reportIds = downlineIds(user.id);
  const teamIds = useMemo(() => [user.id, ...reportIds], [user.id, reportIds.join(",")]);
  const team = useMemo(() => teamIds.map((id) => profileById(id)!).filter(Boolean), [teamIds.join(",")]);
  const reports = useMemo(() => reportIds.map((id) => profileById(id)!).filter(Boolean), [reportIds.join(",")]);
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

      {reports.length === 0 ? (
        <EmptyState title="No team members mapped" message="Once employees report to you, their tasks appear here." />
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="text-[13px] font-semibold text-navy">Team · last active</h3>
              <p className="text-[11.5px] text-grey-2 mt-0.5">When each of your team members last opened the portal.</p>
            </div>
            <ul className="divide-y divide-line">
              {reports.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={r.name} color={r.avatarColor} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-navy truncate">{r.name}</div>
                    <div className="text-[11.5px] text-grey-2 truncate">{r.designation || "—"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-grey-2">Last active</div>
                    <div className="text-[11.5px] text-navy">{formatDateTime(r.lastActiveAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <TaskBrowser tasks={teamTasks} people={team} emptyMessage="No team tasks match these filters." />
        </>
      )}
    </div>
  );
}
