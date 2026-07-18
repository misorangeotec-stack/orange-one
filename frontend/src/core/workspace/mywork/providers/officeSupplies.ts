/**
 * Office Supplies FMS → My Work.
 *
 * Uses `buildQueueEntries(supplySnapshotFrom(...))` — the same two calls the
 * supplies store and the FMS Control Center make, on the same cache entry.
 *
 * This is the simplest of the five: a request sits at exactly one open step,
 * derived from its `status` column, so a request can never appear twice here.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSuppliesData, suppliesQueryKey } from "@/apps/office-supplies/data/suppliesFetch";
import { buildQueueEntries, supplySnapshotFrom } from "@/apps/office-supplies/lib/queues";
import { stepByKey } from "@/apps/office-supplies/lib/steps";
import { isMineByStepOwners } from "@/shared/lib/fmsOwners";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

const APPROVAL_STEPS = new Set(["first_approval", "second_approval"]);

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
    const owners = data.stepOwners;
    return buildQueueEntries(supplySnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }))
      .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
      .map((e) => ({
        id: `office-supplies:${e.requestId}:${e.stepKey}`,
        source: "office-supplies",
        sourceLabel: appName("office-supplies"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/office-supplies/requests/${e.requestId}`,
        assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
        isApproval: APPROVAL_STEPS.has(e.stepKey),
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const officeSuppliesProvider: MyWorkProvider = {
  key: "office-supplies",
  label: appName("office-supplies"),
  appId: "office-supplies",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useOfficeSuppliesWork,
};
