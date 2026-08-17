/**
 * General Purchase → work items. See ./README.md.
 *
 * The simplest of the set: a request sits at exactly one open step, derived from
 * its `status` column, so a request can never appear twice.
 */
import { appName } from "@/apps/appInfo";
import type { SuppliesData } from "@/apps/office-supplies/data/suppliesFetch";
import { buildQueueEntries, supplySnapshotFrom } from "@/apps/office-supplies/lib/queues";
import { stepByKey } from "@/apps/office-supplies/lib/steps";
import { requestHref } from "@/apps/office-supplies/lib/routes";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

const APPROVAL_STEPS = new Set(["first_approval", "second_approval"]);

export function officeSuppliesWorkItems(
  data: SuppliesData,
  uid: string,
  isAdmin: boolean,
): WorkItem[] {
  const owners = data.stepOwners as StepOwnerRow[];
  return buildQueueEntries(
    supplySnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }),
  )
    .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
    .map((e) => ({
      id: `office-supplies:${e.requestId}:${e.stepKey}`,
      source: "office-supplies",
      sourceLabel: appName("office-supplies"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: requestHref(e.requestId),
      assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
