/**
 * This module → My Work.
 *
 * Shares the HR store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/hr.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchHrData, hrQueryKey } from "@/apps/hr-recruitment/data/hrFetch";
import { hrWorkItems } from "../items/hr";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useHrWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: hrQueryKey(uid),
    queryFn: fetchHrData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return hrWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const hrProvider: MyWorkProvider = {
  key: "hr",
  label: appName("hr-recruitment"),
  appId: "hr-recruitment",
  category: "hr",
  unit: "steps",
  tier: 2,
  useMyWork: useHrWork,
};
