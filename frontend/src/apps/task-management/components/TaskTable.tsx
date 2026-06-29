import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useNavigate } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import { dateLabel, isOverdue, isToday, todayIso } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../mock/store";
import { isRecurringTask } from "../mock/selectors";
import { RECURRENCE_LABEL, type Task } from "../types";
import StatusChip from "./StatusChip";

export type TaskSortKey = "title" | "createdBy" | "assignedTo" | "createdAt" | "dueDate" | "status";
export type SortDir = "asc" | "desc";
export type TaskSort = { key: TaskSortKey; dir: SortDir };

export const DEFAULT_TASK_SORT: TaskSort = { key: "dueDate", dir: "asc" };

/** Toggle direction when re-clicking the active column; otherwise default a new
 *  column to ascending (A→Z / earliest-first). */
export function nextSort(sort: TaskSort, key: TaskSortKey): TaskSort {
  if (sort.key === key) return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

/** Sort a task list by the chosen column. `nameOf` resolves a user id to a
 *  display name so the person columns sort by name, not by raw UUID. */
export function sortTasks(tasks: Task[], sort: TaskSort, nameOf: (id: string | null) => string | undefined): Task[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const today = todayIso();
  const val = (t: Task): string => {
    switch (sort.key) {
      case "title": return t.title?.toLowerCase() ?? "";
      case "createdBy": return (nameOf(t.createdBy) ?? "").toLowerCase();
      case "assignedTo": return (nameOf(t.assignedTo) ?? "~").toLowerCase(); // unassigned sorts last (asc)
      case "createdAt": return t.createdAt ?? "9999-99-99";
      case "dueDate": return t.dueDate ?? "9999-99-99";
      case "status": return t.status;
    }
  };
  return [...tasks].sort((a, b) => {
    // Due-date ascending (the default view) pins tasks due today to the very top,
    // then orders the rest chronologically. Reversed, it stays a plain latest-first.
    if (sort.key === "dueDate" && sort.dir === "asc") {
      const at = a.dueDate === today;
      const bt = b.dueDate === today;
      if (at !== bt) return at ? -1 : 1;
    }
    const av = val(a);
    const bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

/** Clickable column header that drives the table sort and shows the active
 *  direction. Mirrors the SortTh used in the report tables. */
function SortTh({ label, sortKey, sort, onSort, align = "left", className }: {
  label: string;
  sortKey: TaskSortKey;
  sort: TaskSort;
  onSort: (k: TaskSortKey) => void;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("font-semibold px-3 py-2.5 select-none", align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy transition", align === "center" && "justify-center", align === "right" && "flex-row-reverse", active && "text-navy")}
      >
        <span>{label}</span>
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          className={cn("transition-transform", active ? "opacity-100" : "opacity-30", active && sort.dir === "asc" && "rotate-180")}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </th>
  );
}

/**
 * Shared task table: one header row, aligned sortable columns, and a row per
 * task. Used by My Tasks, Team Tasks and All Tasks so they all look identical.
 * The caller does the filtering, sorting and pagination, then hands the page's
 * tasks in here; `sort` / `onSort` drive the header indicators.
 */
export default function TaskTable({ tasks, sort, onSort }: {
  tasks: Task[];
  sort: TaskSort;
  onSort: (k: TaskSortKey) => void;
}) {
  const { profileById, departmentById, getRecurring } = useTaskStore();
  const navigate = useNavigate();

  return (
    <ScrollableTable>
      <table className="w-full min-w-[930px] text-[13px] border-collapse table-fixed">
        <thead>
          <tr className="text-grey-2 text-[11px] uppercase tracking-wide bg-page/50 border-b border-line">
            <SortTh label="Task" sortKey="title" sort={sort} onSort={onSort} className="px-4" />
            <SortTh label="Created By" sortKey="createdBy" sort={sort} onSort={onSort} className="w-[170px]" />
            <SortTh label="Assigned To" sortKey="assignedTo" sort={sort} onSort={onSort} className="w-[170px]" />
            <SortTh label="Assigned" sortKey="createdAt" sort={sort} onSort={onSort} className="w-[110px]" />
            <SortTh label="Due" sortKey="dueDate" sort={sort} onSort={onSort} className="w-[110px]" />
            <SortTh label="Status" sortKey="status" sort={sort} onSort={onSort} align="center" className="w-[130px]" />
            <th className="w-[40px]" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((task) => {
            const creator = profileById(task.createdBy);
            const assignee = profileById(task.assignedTo);
            const dept = departmentById(task.departmentId);
            const overdue = isOverdue(task.dueDate) && task.status !== "completed" && task.status !== "shifted";
            const recurrence = task.recurringTaskId ? getRecurring(task.recurringTaskId)?.recurrenceType : undefined;
            const recurring = isRecurringTask(task);
            return (
              <tr
                key={task.id}
                onClick={() => navigate(`/task-management/tasks/${task.id}`)}
                className={cn(
                  "group hover:bg-page transition cursor-pointer align-middle",
                  task.notApplicable && "opacity-55" // N/A ("when") instances read as parked
                )}
              >
                {/* Task */}
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-navy truncate group-hover:text-orange transition">{task.title}</span>
                    {task.isPersonal && (
                      <span
                        title="Other task — for your own tracking; excluded from all scores"
                        className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-orange bg-[#FFF1E8] rounded-pill px-1.5 py-0.5"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                        Other
                      </span>
                    )}
                    {recurring && (
                      <span
                        title={recurrence ? `Recurring task · ${RECURRENCE_LABEL[recurrence]}` : "Generated from a recurring task"}
                        className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue bg-[#EAF1FE] rounded-pill px-1.5 py-0.5"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                        {recurrence ? RECURRENCE_LABEL[recurrence] : "Recurring"}
                      </span>
                    )}
                    {task.revisionCount > 0 && (
                      <span className="shrink-0 text-[10px] font-semibold text-[#B7820E] bg-[#FEF6E6] rounded-pill px-1.5 py-0.5">↻ {task.revisionCount}</span>
                    )}
                  </div>
                  {task.description?.trim() && (
                    <div className="text-[12px] text-grey mt-0.5 truncate">{task.description}</div>
                  )}
                  <div className="text-[11.5px] text-grey-2 mt-0.5 truncate">
                    {dept?.name ?? "—"}
                    {task.followUpDate && (
                      <span
                        className={cn(
                          isOverdue(task.followUpDate)
                            ? "text-[#d4493f] font-medium"
                            : isToday(task.followUpDate)
                              ? "text-orange font-medium"
                              : "",
                        )}
                      >
                        {` · follow-up ${dateLabel(task.followUpDate)}`}
                        {isOverdue(task.followUpDate) ? " (overdue)" : isToday(task.followUpDate) ? " (today)" : ""}
                      </span>
                    )}
                  </div>
                </td>

                {/* Created By */}
                <td className="px-3 py-3 align-middle">
                  <div className="flex items-center gap-2 min-w-0">
                    {creator && <Avatar name={creator.name} color={creator.avatarColor} size={24} />}
                    <span className="text-[12.5px] text-navy truncate">{creator?.name ?? "—"}</span>
                  </div>
                </td>

                {/* Assigned To */}
                <td className="px-3 py-3 align-middle">
                  <div className="flex items-center gap-2 min-w-0">
                    {assignee && <Avatar name={assignee.name} color={assignee.avatarColor} size={24} />}
                    <span className="text-[12.5px] text-navy truncate">{assignee?.name ?? "Unassigned"}</span>
                  </div>
                </td>

                {/* Assigned (task creation date) */}
                <td className="px-3 py-3 align-middle">
                  <span className="text-[12.5px] text-navy">{dateLabel(task.createdAt)}</span>
                </td>

                {/* Due */}
                <td className="px-3 py-3 align-middle">
                  <span className={cn("text-[12.5px] font-medium", overdue ? "text-[#d4493f]" : "text-navy")}>{dateLabel(task.dueDate)}</span>
                </td>

                {/* Status */}
                <td className="px-3 py-3 align-middle text-center">
                  <StatusChip status={task.status} notApplicable={task.notApplicable} />
                </td>

                {/* Chevron */}
                <td className="px-2 py-3 align-middle text-right">
                  <svg className="inline text-grey-2 group-hover:text-orange transition" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>
  );
}
