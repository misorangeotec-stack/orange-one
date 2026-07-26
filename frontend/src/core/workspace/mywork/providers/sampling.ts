/**
 * Sampling FMS → My Work.
 *
 * Uses `buildQueueEntries(samplingSnapshotFrom(...))` — the same two calls the
 * sampling store and the FMS Control Center make, on the same cache entry.
 *
 * A request sits at exactly one open step, derived from its `status` column, so a
 * request can never appear twice here. Sampling has NO approval steps — isApproval
 * is always false.
 *
 * Ownership is NOT step owners alone. Several sampling steps are assigned on the
 * REQUEST — the collector collects, the hand-over recipient receives it and sends
 * it to the lab, and whoever the lab handed the result to confirms it. `can_act` in
 * the database and the app's own queues both honour that; this list did not, so
 * anyone who was only ever a per-request assignee saw an empty My Work while the
 * work sat in their sampling queue. `isMineBySampling` below mirrors the SQL.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSamplingData, samplingQueryKey } from "@/apps/sampling/data/samplingFetch";
import { buildQueueEntries, samplingSnapshotFrom } from "@/apps/sampling/lib/queues";
import { stepByKey } from "@/apps/sampling/lib/steps";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { SamplingRequest } from "@/apps/sampling/types";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

/** Mirrors public.fms_sampling_can_act minus the admin / coordinator short-circuits. */
const isMineBySampling = (stepKey: string, uid: string, r: SamplingRequest | undefined, owners: StepOwnerRow[]): boolean => {
  if (isMineByStepOwners(stepKey, uid, owners)) return true;
  if (!r) return false;
  switch (stepKey) {
    case "receive_sample":
    case "sample_collect":
      return r.collectorId === uid;
    case "sample_received":
    case "sample_to_lab":
      return r.handoverRecipientId === uid;
    case "result_received":
      return r.labResultToId === uid;
    default:
      return false;
  }
};

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
    const byId = new Map(data.requests.map((r) => [r.id, r]));
    return buildQueueEntries(samplingSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }))
      .filter((e) => isAdmin || isMineBySampling(e.stepKey, uid, byId.get(e.requestId), owners))
      .map((e) => ({
        id: `sampling:${e.requestId}:${e.stepKey}`,
        source: "sampling",
        sourceLabel: appName("sampling"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/sampling/requests/${e.requestId}`,
        // "direct" = named on this request or a step owner; anything an admin sees
        // beyond that is the team's.
        assignment: isMineBySampling(e.stepKey, uid, byId.get(e.requestId), owners)
          ? ("direct" as const)
          : ("team" as const),
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
