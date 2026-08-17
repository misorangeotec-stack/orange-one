/**
 * This module → My Work.
 *
 * Shares the sampling store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/sampling.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSamplingData, samplingQueryKey } from "@/apps/sampling/data/samplingFetch";
import { samplingWorkItems } from "../items/sampling";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useSamplingWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: samplingQueryKey(uid),
    queryFn: fetchSamplingData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return samplingWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const samplingProvider: MyWorkProvider = {
  key: "sampling",
  label: appName("sampling"),
  appId: "sampling",
  category: "sampling",
  unit: "steps",
  tier: 2,
  useMyWork: useSamplingWork,
};
