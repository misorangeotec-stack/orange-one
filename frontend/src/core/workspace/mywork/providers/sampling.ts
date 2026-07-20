/**
 * Sampling FMS → My Work.
 *
 * Uses `buildQueueEntries(samplingSnapshotFrom(...))` — the same two calls the
 * sampling store and the FMS Control Center make, on the same cache entry.
 *
 * A request sits at exactly one open step, derived from its `status` column, so a
 * request can never appear twice here. Sampling has NO approval steps — isApproval
 * is always false.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSamplingData, samplingQueryKey } from "@/apps/sampling/data/samplingFetch";
import { buildQueueEntries, samplingSnapshotFrom } from "@/apps/sampling/lib/queues";
import { stepByKey } from "@/apps/sampling/lib/steps";
import { isMineByStepOwners } from "@/shared/lib/fmsOwners";
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
    const owners = data.stepOwners;
    return buildQueueEntries(samplingSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }))
      .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
      .map((e) => ({
        id: `sampling:${e.requestId}:${e.stepKey}`,
        source: "sampling",
        sourceLabel: appName("sampling"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/sampling/requests/${e.requestId}`,
        assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
        isApproval: false,
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const samplingProvider: MyWorkProvider = {
  key: "sampling",
  label: appName("sampling"),
  appId: "sampling",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useSamplingWork,
};
