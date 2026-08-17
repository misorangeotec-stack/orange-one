/**
 * This module → My Work.
 *
 * Shares the purchase store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/officeSupplies.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSuppliesData, suppliesQueryKey } from "@/apps/office-supplies/data/suppliesFetch";
import { officeSuppliesWorkItems } from "../items/officeSupplies";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useOfficeSuppliesWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: suppliesQueryKey(uid),
    queryFn: fetchSuppliesData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return officeSuppliesWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const officeSuppliesProvider: MyWorkProvider = {
  key: "office-supplies",
  label: appName("office-supplies"),
  appId: "office-supplies",
  category: "purchase",
  unit: "steps",
  tier: 2,
  useMyWork: useOfficeSuppliesWork,
};
