/**
 * Production Entry → work items. See ./README.md.
 *
 * A job card sits at exactly one open step (derived from its `status`), so it can
 * never appear twice. Production Entry has NO approval steps.
 */
import { appName } from "@/apps/appInfo";
import type { ProductionData } from "@/apps/production-entry/data/productionFetch";
import { buildHeldEntries, buildQueueEntries, productionSnapshotFrom } from "@/apps/production-entry/lib/queues";
import { stepByKey } from "@/apps/production-entry/lib/steps";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

export function productionWorkItems(
  data: ProductionData,
  uid: string,
  isAdmin: boolean,
): WorkItem[] {
  const owners = data.stepOwners as StepOwnerRow[];
  const snap = productionSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla });
  const reasonById = new Map(data.requests.map((r) => [r.id, r.holdReason]));

  // Held job cards are listed, flagged, at the step they are parked at — see
  // ./officeSupplies.ts for why they are added back rather than dropped.
  const entries = [
    ...buildQueueEntries(snap).map((e) => ({ e, held: false })),
    ...buildHeldEntries(snap).map((e) => ({ e, held: true })),
  ];

  return entries
    .filter(({ e }) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
    .map(({ e, held }) => ({
      id: `production-entry:${e.requestId}:${e.stepKey}`,
      source: "production-entry",
      sourceLabel: appName("production-entry"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: `/production-entry/requests/${e.requestId}`,
      assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
      isApproval: false,
      ...(held ? { isHeld: true, holdReason: reasonById.get(e.requestId) ?? null } : {}),
    }));
}
