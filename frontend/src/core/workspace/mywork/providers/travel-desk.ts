/**
 * This module → My Work.
 *
 * Shares the Travel Desk store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each
 * one says, lives in `../items/travel-desk.ts` — because the daily snapshot
 * email runs that same code on the server, where there is no browser to run a
 * hook. Adding a condition here instead would apply it to the screen and not to
 * the mail, and the two would start disagreeing about the same person.
 * See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchTravelData, travelQueryKey } from "@/apps/travel-desk/data/travelFetch";
import { travelDeskWorkItems } from "../items/travel-desk";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useTravelDeskWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: travelQueryKey(uid),
    queryFn: fetchTravelData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return travelDeskWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const travelDeskProvider: MyWorkProvider = {
  key: "travel-desk",
  label: appName("travel-desk"),
  appId: "travel-desk",
  category: "hr",
  // A trip sits at one step at a time, so a row here is a step somebody owes —
  // the same unit hr-exit and the other FMS providers count in.
  unit: "steps",
  tier: 2,
  useMyWork: useTravelDeskWork,
};
