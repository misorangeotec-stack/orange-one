/**
 * General Purchase → work items. See ./README.md.
 *
 * The simplest of the set: a request sits at exactly one open step, derived from
 * its `status` column, so a request can never appear twice.
 *
 * ⚠ FIRST APPROVAL IS NOT A STEP-OWNER QUESTION in this app, and asking
 *   `isMineByStepOwners` about it returns false for EVERYONE. 20260720100000
 *   deliberately emptied that step-owner row — first approval routes per request
 *   to fms_supplies_departments.hod_user_id and only to them — so an HOD's
 *   pending approvals were silently absent from both My Work and the daily
 *   snapshot email. `mine` below mirrors the store's `canActOn` instead.
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
  // Departments this person heads. The queue entry carries the request's
  // department, so ownership is a set lookup rather than a scan per row.
  const myHodDepartmentIds = new Set(
    data.departments.filter((d) => d.hodUserId === uid).map((d) => d.id),
  );

  const mine = (stepKey: string, departmentId: string): boolean =>
    stepKey === "first_approval"
      ? myHodDepartmentIds.has(departmentId)
      : isMineByStepOwners(stepKey, uid, owners);

  return buildQueueEntries(
    supplySnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla }),
  )
    .filter((e) => isAdmin || mine(e.stepKey, e.departmentId))
    .map((e) => ({
      id: `office-supplies:${e.requestId}:${e.stepKey}`,
      source: "office-supplies",
      sourceLabel: appName("office-supplies"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: requestHref(e.requestId),
      assignment: mine(e.stepKey, e.departmentId) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
