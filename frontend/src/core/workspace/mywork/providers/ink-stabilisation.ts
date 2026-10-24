/**
 * This module → My Work.
 *
 * Shares the Ink Stabilisation pages' cache entries (flow + lots).
 *
 * ⚠ THIS FILE HOLDS NO RULES — they live in `../items/inkStabilisation.ts`.
 *
 * The lots are a slow ConnectWave read, so they are fetched only for someone who
 * owns the Plant step — not for admins, whose home screen would otherwise pay for
 * it on every visit. Review work needs the flow rows alone.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { FLOW_QUERY, fetchFlow, useInkLots } from "@/apps/ink-stabilisation/lib/flow";
import { inkStabilisationWorkItems } from "../items/inkStabilisation";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useInkStabilisationWork(active: boolean): MyWorkResult {
  const { user, isAdmin, canEditModule } = useSession();
  const uid = user?.id ?? null;
  const canEdit = canEditModule("ink-stabilisation");

  const flow = useQuery({ queryKey: FLOW_QUERY, queryFn: fetchFlow, enabled: active && !!uid, staleTime: 30_000 });
  const needsLots = !!flow.data && canEdit && !!uid && flow.data.owners.plant.includes(uid);
  const lots = useInkLots(active && needsLots);

  const items = useMemo<WorkItem[]>(() => {
    if (!flow.data || !uid) return [];
    return inkStabilisationWorkItems(flow.data, lots.data ?? null, uid, isAdmin, canEdit);
  }, [flow.data, lots.data, uid, isAdmin, canEdit]);

  return { items, isLoading: flow.isLoading, error: flow.error };
}

export const inkStabilisationProvider: MyWorkProvider = {
  key: "ink-stabilisation",
  label: appName("ink-stabilisation"),
  appId: "ink-stabilisation",
  category: "plant",
  unit: "steps",
  tier: 2,
  useMyWork: useInkStabilisationWork,
};
