/**
 * Production Entry FMS → My Work.
 *
 * Uses `buildQueueEntries(productionSnapshotFrom(...))` — the same two calls the
 * production store and the FMS Control Center make, on the same cache entry.
 *
 * A job card sits at exactly one open step (derived from its `status`), so it can
 * never appear twice here. Production Entry has NO approval steps — isApproval is
 * always false.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchProductionData, productionQueryKey } from "@/apps/production-entry/data/productionFetch";
import { buildQueueEntries, productionSnapshotFrom } from "@/apps/production-entry/lib/queues";
import { stepByKey } from "@/apps/production-entry/lib/steps";
import { isMineByStepOwners } from "@/shared/lib/fmsOwners";
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
    const owners = data.stepOwners;
    return buildQueueEntries(productionSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }))
      .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
      .map((e) => ({
        id: `production-entry:${e.requestId}:${e.stepKey}`,
        source: "production-entry",
        sourceLabel: appName("production-entry"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/production-entry/requests/${e.requestId}`,
        assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
        isApproval: false,
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const productionEntryProvider: MyWorkProvider = {
  key: "production-entry",
  label: appName("production-entry"),
  appId: "production-entry",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useProductionWork,
};
