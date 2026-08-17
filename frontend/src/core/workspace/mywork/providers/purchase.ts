/**
 * This module → My Work.
 *
 * Shares one react-query cache entry with the procurement app, so this list cannot
 * report a different set of open work than the app does.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/purchase.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchProcurementData, procurementQueryKey } from "@/apps/procurement/data/procFetch";
import { purchaseWorkItems } from "../items/purchase";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function usePurchaseWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: procurementQueryKey(uid),
    queryFn: fetchProcurementData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return purchaseWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const purchaseProvider: MyWorkProvider = {
  key: "purchase",
  label: appName("procurement"),
  appId: "procurement",
  category: "purchase",
  unit: "steps",
  tier: 2,
  useMyWork: usePurchaseWork,
};
