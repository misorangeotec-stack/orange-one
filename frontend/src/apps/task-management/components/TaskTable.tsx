import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { dateLabel, isOverdue, isToday, todayIso } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../mock/store";
import { useSession } from "../mock/session";
import { isRecurringTask } from "../mock/selectors";
import { taskDetailPath } from "../lib/taskLink";
import { RECURRENCE_LABEL, isOverdueTask, type Task } from "../types";
import StatusChip from "./StatusChip";
import EditTaskModal from "./EditTaskModal";
import PersonalTaskModal from "./PersonalTaskModal";

export type TaskSortKey = "title" | "department" | "createdBy" | "assignedTo" | "createdAt" | "dueDate" | "status";
export type SortDir = "asc" | "desc";
export type TaskSort = { key: TaskSortKey; dir: SortDir };

/**
 * One filter control per column, rendered in a second header row directly under
 * the column it narrows — so each control is labelled by its own column instead
 * of sitting in an anonymous wall of dropdowns above the table. Keys match
 * TaskSortKey; omit one to leave that column's filter cell empty.
 */
export type TaskFilterCells = Partial<Record<TaskSortKey, ReactNode>>;

export const DEFAULT_TASK_SORT: TaskSort = { key: "dueDate", dir: "asc" };

/** Toggle direction when re-clicking the active column; otherwise default a new
 *  column to ascending (A→Z / earliest-first). */
export function nextSort(sort: TaskSort, key: TaskSortKey): TaskSort {
  if (sort.key === key) return { key, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

/** Sort a task list by the chosen column. `nameOf` resolves a user id to a
 *  display name so the person columns sort by name, not by raw UUID; `deptNameOf`
 *  does the same for the Department column (only All Tasks shows it, so the other
 *  callers may omit it — without one, department sorting is a no-op). */
export function sortTasks(
  tasks: Task[],
  sort: TaskSort,
  nameOf: (id: string | null) => string | undefined,
  deptNameOf?: (id: string | null) => string | undefined,
): Task[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const today = todayIso();
  const val = (t: Task): string => {
    switch (sort.key) {
      case "title": return t.title?.toLowerCase() ?? "";
      case "department": return (deptNameOf?.(t.departmentId) ?? "~").toLowerCase(); // no department sorts last (asc)
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
 * task. Used by My Tasks, Team Tasks, All Tasks and Tagged so they all look
 * identical. The caller does the filtering, sorting and pagination, then hands
 * the page's tasks in here; `sort` / `onSort` drive the header indicators.
 *
 * Pass `filterRow` to get a second header row holding one filter control per
 * column. The caller owns those controls (the filter STATE lives with the
 * filtering), this just places them in the right cells.
 */
export default function TaskTable({ tasks, sort, onSort, showDepartment = false, filterRow, emptyMessage }: {
  tasks: Task[];
  sort: TaskSort;
  onSort: (k: TaskSortKey) => void;
  /** Show a Department column. Only All Tasks spans departments; the other views
   *  are already scoped to one, where the column would be a constant. */
  showDepartment?: boolean;
  /** Per-column filter controls, rendered in a second header row. */
  filterRow?: TaskFilterCells;
  /**
   * Shown as a full-width row when `tasks` is empty. Callers with a `filterRow`
   * MUST render this table even with no rows and use this instead of swapping in
   * an EmptyState — otherwise a filter that matches nothing takes the filter row
   * off screen with it, leaving no way to undo the filter.
   */
  emptyMessage?: ReactNode;
}) {
  const { actorById, departmentById, getRecurring, canStatusActions, deleteTask, unreadAssignedTaskIds } = useTaskStore();
  const { user, role } = useSession();
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // One modal instance for the whole table, driven by an id (like confirmId) —
  // not one per row. EditTaskModal re-prefills on each open.
  const [editId, setEditId] = useState<string | null>(null);
  const [personalEditId, setPersonalEditId] = useState<string | null>(null);

  /**
   * Open a row's task. A plain click navigates IN THIS TAB — the list's filters,
   * sort and page survive in sticky state (shared/lib/stickyState), so coming Back
   * restores them; that's what replaced the old window.open-a-new-tab workaround.
   * Ctrl/Cmd-click and middle-click still open a new tab, as any link would.
   */
  const openTask = (e: { target: EventTarget | null; button: number; metaKey: boolean; ctrlKey: boolean }, id: string) => {
    // The row's own controls (delete) win outright. The delete button stops
    // propagation on click, but auxclick is a separate event with no such guard.
    if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, label")) return;

    const href = taskDetailPath(id);
    if (e.button === 1 || e.metaKey || e.ctrlKey) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (e.button !== 0) return; // right-click etc.
    navigate(href);
  };

  // Same guard as the detail page: a genuine one-off (not personal, not recurring)
  // may be deleted only while PENDING, and only by its creator, assignee, or an
  // admin. RLS (tasks_delete_pending) enforces it server-side too.
  const canDeleteRow = (t: Task) =>
    !t.isPersonal &&
    !t.recurringTaskId &&
    !t.fromRecurring &&
    t.status === "pending" &&
    canStatusActions &&
    (t.createdBy === user.id || t.assignedTo === user.id || role === "admin");

  // Edit mirrors delete exactly: a genuine one-off, still PENDING, and you're its
  // creator, assignee, or an admin. A HOD who assigned the task IS the creator, so
  // they're covered without a wider grant. Note the pending guard is UI-only —
  // tasks_update RLS has no status check (see updateTask in data/taskWrites).
  const canEditRow = (t: Task) => canDeleteRow(t);

  // Personal ("Other") tasks aren't in canDeleteRow's world at all — they're
  // creator-only at any status, and have no locations, so they get the simpler
  // PersonalTaskModal. Their rows had no actions before this.
  const canEditPersonalRow = (t: Task) => t.isPersonal && t.createdBy === user.id && canStatusActions;

  const confirmTask = confirmId ? tasks.find((t) => t.id === confirmId) : undefined;
  const editTask = editId ? tasks.find((t) => t.id === editId) : undefined;
  const personalEditTask = personalEditId ? tasks.find((t) => t.id === personalEditId) : undefined;

  const colCount = showDepartment ? 8 : 7;
  // Three configurations, three minimums — a single value would either crush the
  // search box in the Task cell or give Tagged Tasks (no filter row) horizontal
  // scroll it never had. Tailwind needs literal class names, hence the ternaries.
  const minWidth = !filterRow ? "min-w-[930px]" : showDepartment ? "min-w-[1210px]" : "min-w-[1060px]";

  return (
    <>
    <ScrollableTable>
      <table className={cn("w-full text-[13px] border-collapse table-fixed", minWidth)}>
        <thead>
          <tr className="text-grey-2 text-[11px] uppercase tracking-wide bg-page/50 border-b border-line">
            <SortTh label="Task" sortKey="title" sort={sort} onSort={onSort} className="px-4" />
            {showDepartment && <SortTh label="Department" sortKey="department" sort={sort} onSort={onSort} className="w-[150px]" />}
            <SortTh label="Created By" sortKey="createdBy" sort={sort} onSort={onSort} className="w-[160px]" />
            <SortTh label="Assigned To" sortKey="assignedTo" sort={sort} onSort={onSort} className="w-[160px]" />
            <SortTh label="Assigned" sortKey="createdAt" sort={sort} onSort={onSort} className="w-[120px]" />
            <SortTh label="Due" sortKey="dueDate" sort={sort} onSort={onSort} className="w-[120px]" />
            <SortTh label="Status" sortKey="status" sort={sort} onSort={onSort} align="center" className="w-[130px]" />
            <th className="w-[90px]" />
          </tr>
          {filterRow && (
            /*
             * onKeyDown/stopPropagation is load-bearing, not defensive.
             * ScrollableTable scrolls the table on arrow keys and only bows out
             * when the event target is an INPUT/TEXTAREA/SELECT. The status
             * MultiSelect has exactly 6 options, one short of the threshold that
             * gives it a search box, so its menu's focus target is a bare div —
             * and React portals bubble through the REACT tree, not the DOM tree.
             * Without this, arrowing through that dropdown scrolls the table
             * sideways underneath it.
             */
            <tr className="bg-page/40 border-b border-line" onKeyDown={(e) => e.stopPropagation()}>
              <th className="px-3 py-2 font-normal text-left align-middle">{filterRow.title}</th>
              {showDepartment && <th className="px-2 py-2 font-normal text-left align-middle">{filterRow.department}</th>}
              <th className="px-2 py-2 font-normal text-left align-middle">{filterRow.createdBy}</th>
              <th className="px-2 py-2 font-normal text-left align-middle">{filterRow.assignedTo}</th>
              <th className="px-2 py-2 font-normal text-left align-middle">{filterRow.createdAt}</th>
              <th className="px-2 py-2 font-normal text-left align-middle">{filterRow.dueDate}</th>
              <th className="px-2 py-2 font-normal text-left align-middle">{filterRow.status}</th>
              <th />
            </tr>
          )}
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.length === 0 && emptyMessage && (
            <tr>
              <td colSpan={colCount} className="px-4 py-10 text-center text-[13px] text-grey">{emptyMessage}</td>
            </tr>
          )}
          {tasks.map((task) => {
            // actorById, NOT profileById. The directory is RLS-scoped to self +
            // same department + downline, so a cross-department assigner — a
            // Director handing work to another team — resolves to undefined and
            // the Created By cell prints "—" for a task that plainly has one.
            // actorById falls back to the org-wide, name-only people list.
            const creator = actorById(task.createdBy);
            const assignee = actorById(task.assignedTo);
            const dept = departmentById(task.departmentId);
            const closed = task.status === "completed" || task.status === "shifted";
            // One definition of overdue for the red due date, the Overdue pill and
            // the Overdue status filter — they must never disagree on a row. Note
            // it also excludes parked N/A instances, which aren't being chased.
            const overdue = isOverdueTask(task);
            const recurrence = task.recurringTaskId ? getRecurring(task.recurringTaskId)?.recurrenceType : undefined;
            const recurring = isRecurringTask(task);
            // Assigned to me and not yet opened. Cleared by TaskDetail on open.
            const unseen = unreadAssignedTaskIds.has(task.id);
            return (
              <tr
                key={task.id}
                onClick={(e) => openTask(e, task.id)}
                // Middle-click fires auxclick, not click; and middle-MOUSEDOWN would
                // otherwise start the browser's autoscroll on a non-link element.
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openTask(e, task.id); } }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                className={cn(
                  "group hover:bg-page transition cursor-pointer align-middle",
                  task.notApplicable && "opacity-55" // N/A ("when") instances read as parked
                )}
              >
                {/* Task */}
                {/*
                  The "new to you" accent goes on this CELL, not the row: the
                  table is border-collapse + table-fixed, where a <tr> border is
                  unreliable. A left border also survives the row's hover:bg-page,
                  which would otherwise wash out a background tint on hover.
                */}
                <td className={cn("px-4 py-3 align-top", unseen && "border-l-2 border-orange")}>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-navy truncate group-hover:text-orange transition">{task.title}</span>
                    {unseen && (
                      <span
                        title="Newly assigned to you — opening the task clears this"
                        className="shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide text-white bg-orange rounded-pill px-1.5 py-0.5"
                      >
                        New
                      </span>
                    )}
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
                  {/* The department moves OUT of this subtitle when it has its own
                      column, so it isn't printed twice on the same row. */}
                  {(!showDepartment || task.followUpDate) && (
                    <div className="text-[11.5px] text-grey-2 mt-0.5 truncate">
                      {!showDepartment && (dept?.name ?? "—")}
                      {task.followUpDate && (
                        // A closed task needs no chasing, so its follow-up reads as plain history.
                        <span
                          className={cn(
                            closed
                              ? ""
                              : isOverdue(task.followUpDate)
                                ? "text-[#d4493f] font-medium"
                                : isToday(task.followUpDate)
                                  ? "text-orange font-medium"
                                  : "",
                          )}
                        >
                          {`${showDepartment ? "" : " · "}follow-up ${dateLabel(task.followUpDate)}`}
                          {closed ? "" : isOverdue(task.followUpDate) ? " (overdue)" : isToday(task.followUpDate) ? " (today)" : ""}
                        </span>
                      )}
                    </div>
                  )}
                </td>

                {/* Department (All Tasks only — elsewhere it's in the Task subtitle) */}
                {showDepartment && (
                  <td className="px-3 py-3 align-middle">
                    <span className="text-[12.5px] text-navy truncate block">{dept?.name ?? "—"}</span>
                  </td>
                )}

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

                {/* Status — the Overdue pill sits BESIDE the status, not instead of
                    it: overdue is derived (past due + still open), so the task is
                    still genuinely Pending or In Progress underneath. */}
                <td className="px-3 py-3 align-middle text-center">
                  <div className="flex flex-col items-center gap-1">
                    <StatusChip status={task.status} notApplicable={task.notApplicable} />
                    {overdue && (
                      <span
                        title={`Overdue — was due ${dateLabel(task.dueDate)}`}
                        className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[#FDECEA] text-[#d4493f] whitespace-nowrap"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="7" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17" /></svg>
                        Overdue
                      </span>
                    )}
                  </div>
                </td>

                {/* Edit + Delete (pending one-offs only) + chevron */}
                <td className="px-2 py-3 align-middle text-right whitespace-nowrap">
                  {(canEditRow(task) || canEditPersonalRow(task)) && (
                    <button
                      type="button"
                      title={canEditPersonalRow(task) ? "Edit this task" : "Edit this pending task"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (task.isPersonal) setPersonalEditId(task.id);
                        else setEditId(task.id);
                      }}
                      className="align-middle text-grey-2 hover:text-orange transition p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                  )}
                  {canDeleteRow(task) && (
                    <button
                      type="button"
                      title="Delete this pending task"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmId(task.id);
                      }}
                      className="align-middle text-grey-2 hover:text-[#d4493f] transition p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                    </button>
                  )}
                  <svg className="inline align-middle ml-1 text-grey-2 group-hover:text-orange transition" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>

    <Modal
      open={!!confirmId}
      onClose={() => setConfirmId(null)}
      title="Delete task"
      subtitle={confirmTask?.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmId(null)} disabled={deleting}>Cancel</Button>
          <Button
            className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]"
            disabled={deleting || !confirmId}
            onClick={async () => {
              if (!confirmId) return;
              setDeleting(true);
              try {
                await deleteTask(confirmId);
                setConfirmId(null);
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-grey">This permanently removes this pending task. This can't be undone.</p>
    </Modal>

    {/* Both edit modals prefill on open, so a single instance serves every row. */}
    {editTask && (
      <EditTaskModal task={editTask} open={!!editId} onClose={() => setEditId(null)} />
    )}
    {personalEditTask && (
      <PersonalTaskModal task={personalEditTask} open={!!personalEditId} onClose={() => setPersonalEditId(null)} />
    )}
    </>
  );
}
