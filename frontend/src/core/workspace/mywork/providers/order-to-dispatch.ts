/**
 * This module → My Work.
 *
 * Shares the dispatch store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/orderToDispatch.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchDispatchData, dispatchQueryKey } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { dispatchWorkItems } from "../items/orderToDispatch";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useDispatchWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: dispatchQueryKey(uid),
    queryFn: fetchDispatchData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return dispatchWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const orderToDispatchProvider: MyWorkProvider = {
  key: "order-to-dispatch",
  label: appName("order-to-dispatch"),
  appId: "order-to-dispatch",
  category: "sales",
  unit: "steps",
  tier: 2,
  useMyWork: useDispatchWork,
};
