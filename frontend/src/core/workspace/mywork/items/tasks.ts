/**
 * Task Management → work items. See ./README.md for why this is not in the provider.
 */
import { appName } from "@/apps/appInfo";
import type { TaskData } from "@/apps/task-management/data/fetchTaskData";
import type { WorkItem } from "../types";

/**
 * ⚠ `assignedTo === uid` IS NOT OPTIONAL. RLS hands an HOD their entire transitive
 *   downline's tasks, so without it a manager's personal list fills up with their
 *   team's work.
 *
 * ⚠ `notApplicable` / `isPersonal` mirror `countsTowardMetrics`
 *   (task-management/mock/selectors.ts) — the same two exclusions every other
 *   dashboard metric applies. It is inlined rather than imported because that
 *   module re-exports from the React store, which the server cannot load.
 *
 * ⚠ A DENY-LIST, DELIBERATELY. A status added later counts as OPEN, so new work
 *   can never vanish from someone's list without anyone noticing. Getting this
 *   wrong once reported 14 items and 11 overdue for a user whose screen said 8 / 6.
 *
 * This provider ignores `isAdmin` on purpose: a task has exactly one assignee, so
 * an admin still sees only their own.
 */
export function taskWorkItems(data: TaskData, uid: string): WorkItem[] {
  return data.tasks
    .filter(
      (t) =>
        t.assignedTo === uid &&
        !t.notApplicable &&
        !t.isPersonal &&
        t.status !== "completed" &&
        t.status !== "shifted",
    )
    .map((t) => ({
      id: `tasks:${t.id}:task`,
      source: "tasks",
      sourceLabel: appName("task-management"),
      ref: t.title,
      detail: t.description || undefined,
      dueIso: t.dueDate,
      to: `/task-management/tasks/${t.id}`,
      // A task has exactly one assignee, so it is always personal.
      assignment: "direct" as const,
    }));
}
