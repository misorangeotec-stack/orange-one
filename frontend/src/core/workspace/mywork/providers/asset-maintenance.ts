/**
 * Asset Maintenance FMS → My Work.
 *
 * Uses `buildQueueEntries(assetSnapshotFrom(...))` — the same two calls the asset
 * store and the FMS Control Center make, on the same cache entry.
 *
 * A job sits at exactly one open step (derived from its `status`), so it can never
 * appear twice here. There are NO approval steps in this flow — isApproval is
 * always false.
 *
 * The schedule and service steps have one extra owner the step-owner list does not
 * know about: the ASSET'S CUSTODIAN. That mirrors `fms_asset_can_act`, so the
 * person who actually takes the car to the garage sees it on this screen — without
 * it, the most likely doer of the work is the one person who never gets told.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchAssetData, assetQueryKey } from "@/apps/asset-maintenance/data/assetFetch";
import { assetSnapshotFrom, buildQueueEntries } from "@/apps/asset-maintenance/lib/queues";
import { stepByKey } from "@/apps/asset-maintenance/lib/steps";
import { isMineByStepOwners } from "@/shared/lib/fmsOwners";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useAssetWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: assetQueryKey(uid),
    queryFn: fetchAssetData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const owners = data.stepOwners;
    const assetById = new Map(data.assets.map((a) => [a.id, a]));
    const jobById = new Map(data.jobs.map((j) => [j.id, j]));

    /** The custodian arm: the person answerable for the asset. */
    const isMyAsset = (stepKey: string, jobId: string): boolean => {
      if (stepKey !== "schedule" && stepKey !== "service_done") return false;
      const job = jobById.get(jobId);
      const custodian = job ? assetById.get(job.assetId)?.custodianUserId : null;
      return !!custodian && custodian === uid;
    };

    return buildQueueEntries(
      assetSnapshotFrom({
        jobs: data.jobs,
        stepSla: data.config.stepSla,
        assets: data.assets,
        scheduleTypes: data.scheduleTypes,
      }),
    )
      .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners) || isMyAsset(e.stepKey, e.jobId))
      .map((e) => {
        const job = jobById.get(e.jobId);
        const asset = job ? assetById.get(job.assetId) : undefined;
        return {
          id: `asset-maintenance:${e.jobId}:${e.stepKey}`,
          source: "asset-maintenance",
          sourceLabel: appName("asset-maintenance"),
          ref: e.ref,
          detail: asset ? `${asset.assetNo} ${asset.name}` : undefined,
          stage: stepByKey(e.stepKey)?.short,
          dueIso: e.dueIso,
          to: `/asset-maintenance/jobs/${e.jobId}`,
          assignment:
            isMineByStepOwners(e.stepKey, uid, owners) || isMyAsset(e.stepKey, e.jobId)
              ? ("direct" as const)
              : ("team" as const),
          isApproval: false,
        };
      });
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const assetMaintenanceProvider: MyWorkProvider = {
  key: "asset-maintenance",
  label: appName("asset-maintenance"),
  appId: "asset-maintenance",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useAssetWork,
};
