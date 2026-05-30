import { Link } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import { dateLabel, isOverdue } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../mock/store";
import type { Task } from "../types";
import StatusChip from "./StatusChip";

/** A single task row used in list views. Links to the task detail screen. */
export default function TaskListItem({ task, showAssignee = false }: { task: Task; showAssignee?: boolean }) {
  const { profileById, departmentById } = useTaskStore();
  const assignee = profileById(task.assignedTo);
  const dept = departmentById(task.departmentId);
  const overdue = isOverdue(task.dueDate) && task.status !== "completed" && task.status !== "shifted";

  return (
    <Link
      to={`/task-management/tasks/${task.id}`}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-page transition group"
    >
      {showAssignee && assignee && <Avatar name={assignee.name} color={assignee.avatarColor} size={34} />}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-navy truncate group-hover:text-orange transition">
            {task.title}
          </span>
          {task.revisionCount > 0 && (
            <span className="shrink-0 text-[10px] font-semibold text-[#B7820E] bg-[#FEF6E6] rounded-pill px-1.5 py-0.5">
              ↻ {task.revisionCount}
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-grey-2 mt-0.5 truncate">
          {dept?.name ?? "—"}
          {showAssignee && assignee ? ` · ${assignee.name}` : ""}
          {task.followUpDate ? ` · follow-up ${dateLabel(task.followUpDate)}` : ""}
        </div>
      </div>

      <div className="hidden sm:flex flex-col items-end shrink-0">
        <span className="text-[11px] text-grey-2">Due</span>
        <span className={cn("text-[12.5px] font-medium", overdue ? "text-[#d4493f]" : "text-navy")}>
          {dateLabel(task.dueDate)}
        </span>
      </div>

      <StatusChip status={task.status} className="shrink-0" />

      <svg className="text-grey-2 group-hover:text-orange transition shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
