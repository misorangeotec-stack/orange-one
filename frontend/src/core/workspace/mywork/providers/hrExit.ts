/**
 * This module → My Work.
 *
 * Shares the exit store's cache entry. One case can appear more than once here:
 * each outstanding clearance check is its own unit of work.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/hrExit.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchExitData, exitQueryKey } from "@/apps/hr-exit/data/exitFetch";
import { hrExitWorkItems } from "../items/hrExit";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useHrExitWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: exitQueryKey(uid),
    queryFn: fetchExitData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return hrExitWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const hrExitProvider: MyWorkProvider = {
  key: "hr-exit",
  label: appName("hr-exit"),
  appId: "hr-exit",
  category: "hr",
  unit: "steps",
  tier: 2,
  useMyWork: useHrExitWork,
};
