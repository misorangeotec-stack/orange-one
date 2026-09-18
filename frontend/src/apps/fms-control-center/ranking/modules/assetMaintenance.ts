/**
 * Asset Maintenance — scored steps (CC-1).
 *
 * ⚠ SWITCHED OFF in the ranking at launch (`fms_rank_modules`): one job ever and no
 *   step owners on 18-09-2026. Scored here so an admin can switch it on once it is
 *   in use, without anybody writing code that day.
 *
 * Closed: `completedFor` per step, due from `jobDueIso`. A "rework needed"
 * verification records no actor or time — only its outcome — so it is not a
 * closure here; the job's final verification is.
 *
 * Open: `assetWorkItems` — step owners, plus the asset's custodian for Schedule and
 * Record Service.
 */
import { fetchAssetData, type AssetData } from "@/apps/asset-maintenance/data/assetFetch";
import { assetSnapshotFrom, completedFor, jobDueIso, type QueueStep } from "@/apps/asset-maintenance/lib/queues";
import { stepByKey } from "@/apps/asset-maintenance/lib/steps";
import { assetWorkItems } from "@/core/workspace/mywork/items/assetMaintenance";
import type { ClosedStep, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const STEPS: QueueStep[] = ["schedule", "service_done", "verify_close"];
const label = (k: string) => stepByKey(k)?.title ?? k;

export const assetMaintenanceScorer: ModuleScorer<AssetData> = {
  key: "asset-maintenance",
  appId: "asset-maintenance",
  load: () => fetchAssetData(),

  closed(data) {
    const snap = assetSnapshotFrom({
      jobs: data.jobs,
      stepSla: data.config.stepSla,
      assets: data.assets,
      scheduleTypes: data.scheduleTypes,
    });
    const out: ClosedStep[] = [];
    for (const step of STEPS) {
      for (const e of completedFor(snap, step)) {
        out.push({
          stepId: `${e.jobId}:${step}`,
          entityId: e.jobId,
          ref: e.ref,
          stepKey: step,
          stepLabel: label(step),
          roundNo: 0,
          dueIso: jobDueIso(snap, e.row, step),
          actorId: e.actorId,
          doneAtIso: e.atIso,
        });
      }
    }
    return out;
  },

  openFor(data, uid) {
    return parseItems(assetWorkItems(data, uid, false)).map(
      ({ entityId, stepKey, item }): OpenStep => ({
        stepId: `${entityId}:${stepKey}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: 0,
        dueIso: item.dueIso,
      }),
    );
  },
};
