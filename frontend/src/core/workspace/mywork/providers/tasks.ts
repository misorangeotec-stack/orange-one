/**
 * Task Management → My Work.
 *
 * Reuses the task app's own query key so this shares one cache entry with the app
 * itself — opening Task Management from the home screen costs no extra fetch, and
 * `taskData` is in `PERSISTED_QUERY_ROOTS` (main.tsx) so it is usually already
 * hydrated from the last visit and resolves instantly.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/tasks.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchTaskData } from "@/apps/task-management/data/fetchTaskData";
import { taskWorkItems } from "../items/tasks";
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
    return taskWorkItems(data, uid);
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
