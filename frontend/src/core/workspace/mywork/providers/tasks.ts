/**
 * Task Management → My Work.
 *
 * Reuses the task app's own query key so this shares one cache entry with the app
 * itself — opening Task Management from the home screen costs no extra fetch, and
 * `taskData` is in `PERSISTED_QUERY_ROOTS` (main.tsx) so it is usually already
 * hydrated from the last visit and resolves instantly.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchTaskData } from "@/apps/task-management/data/fetchTaskData";
import { countsTowardMetrics } from "@/apps/task-management/mock/selectors";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useTaskWork(active: boolean): MyWorkResult {
  const { user } = useSession();
  const uid = user.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["taskData", uid ?? null],
    queryFn: fetchTaskData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data) return [];
    return (
      data.tasks
        // `assignedTo === uid` is NOT optional. RLS hands an HOD their entire
        // transitive downline's tasks, so without this a manager's personal list
        // fills up with their team's work. countsTowardMetrics drops N/A and
        // personal tasks, exactly as every other dashboard metric does.
        .filter(
          (t) =>
            t.assignedTo === uid &&
            countsTowardMetrics(t) &&
            t.status !== "completed" &&
            t.status !== "shifted"
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
        }))
    );
  }, [data, uid]);

  return { items, isLoading, error };
}

export const tasksProvider: MyWorkProvider = {
  key: "tasks",
  label: appName("task-management"),
  appId: "task-management",
  category: "productivity",
  unit: "items",
  tier: 1,
  useMyWork: useTaskWork,
};
