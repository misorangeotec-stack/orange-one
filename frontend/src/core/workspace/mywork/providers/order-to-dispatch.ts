/**
 * This module → My Work.
 *
 * Reads pending orders only (`useDispatchOpenWork`, PERF-2), reusing the dispatch
 * store's full copy when one is fresh.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/orderToDispatch.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { useDispatchOpenWork } from "@/apps/order-to-dispatch/data/useDispatchOpenWork";
import { dispatchWorkItems } from "../items/orderToDispatch";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useDispatchWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  // Pending orders only (PERF-2): this list never shows a finished order.
  const { data, isLoading, error } = useDispatchOpenWork(active);

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
