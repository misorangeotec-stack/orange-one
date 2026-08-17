/**
 * Production Entry → work items. See ./README.md.
 *
 * A job card sits at exactly one open step (derived from its `status`), so it can
 * never appear twice. Production Entry has NO approval steps.
 */
import { appName } from "@/apps/appInfo";
import type { ProductionData } from "@/apps/production-entry/data/productionFetch";
import { buildQueueEntries, productionSnapshotFrom } from "@/apps/production-entry/lib/queues";
import { stepByKey } from "@/apps/production-entry/lib/steps";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

export function productionWorkItems(
  data: ProductionData,
  uid: string,
  isAdmin: boolean,
): WorkItem[] {
  const owners = data.stepOwners as StepOwnerRow[];
  return buildQueueEntries(
    productionSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }),
  )
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
}
