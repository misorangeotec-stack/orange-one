/**
 * HR Recruitment → work items. See ./README.md.
 *
 * Ownership is plain step ownership here (no value-band matrix), so it uses the
 * shared `isMineByStepOwners`. Note that RLS ALREADY narrows what an HR user can
 * read in the browser — a hiring manager only sees their own requisitions — so this
 * filter tightens "what I can see" down to "what I owe"; it does not widen anything.
 */
import { appName } from "@/apps/appInfo";
import type { HrData } from "@/apps/hr-recruitment/data/hrFetch";
import { buildQueueEntries, hrSnapshotFrom } from "@/apps/hr-recruitment/lib/queues";
import { stepByKey } from "@/apps/hr-recruitment/lib/steps";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set(["hr_head_approval", "mgmt_approval", "final_decision"]);

export function hrWorkItems(data: HrData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = data.stepOwners as StepOwnerRow[];
  return buildQueueEntries(hrSnapshotFrom(data))
    .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
    .map((e) => ({
      id: `hr:${e.entityId}:${e.stepKey}`,
      source: "hr",
      sourceLabel: appName("hr-recruitment"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      // A candidate row has no page of its own — it opens its requisition.
      to: `/hr-recruitment/requisitions/${
        e.entityType === "requisition" ? e.entityId : e.requisitionId ?? ""
      }`,
      assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
