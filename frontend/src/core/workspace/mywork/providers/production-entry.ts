/**
 * This module → My Work.
 *
 * Shares the production store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/productionEntry.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchProductionData, productionQueryKey } from "@/apps/production-entry/data/productionFetch";
import { productionWorkItems } from "../items/productionEntry";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useProductionWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: productionQueryKey(uid),
    queryFn: fetchProductionData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return productionWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const productionEntryProvider: MyWorkProvider = {
  key: "production-entry",
  label: appName("production-entry"),
  appId: "production-entry",
  category: "production",
  unit: "steps",
  tier: 2,
  useMyWork: useProductionWork,
};
