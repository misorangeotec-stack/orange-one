/**
 * HR Recruitment → work items. See ./README.md.
 *
 * OWNERSHIP HERE IS TWO RULES, NOT ONE.
 *
 * Most steps route by plain step ownership, so they use the shared
 * `isMineByStepOwners`. But the HOD steps have no row in `fms_hr_step_owners` at
 * all — Setup renders them "Automatic" — because "the HOD" is not a portal concept:
 * there is no departments.hod_id, and one global owner would send Sales candidates
 * to the Exim head. They route to the requisition's OWN hiring managers instead,
 * exactly as `fms_hr_can_act()` does server-side.
 *
 * Filtering those by step ownership alone drops them on the floor: the lookup finds
 * no row, returns nobody, and the work belongs to NO ONE. That went unnoticed while
 * `hr_shortlisted` pended `hod_share` (a step HR did own). Removing that step moved
 * every shortlisted CV onto `hod_shortlist`, so the hole would have swallowed the
 * whole shortlisting queue — visible on the board, absent from My Work and from the
 * daily digest email that compiles this same file.
 *
 * RLS already narrows what an HR user can read — a hiring manager only sees their
 * own requisitions — so this filter tightens "what I can see" down to "what I owe";
 * it does not widen anything.
 */
import { appName } from "@/apps/appInfo";
import type { HrData } from "@/apps/hr-recruitment/data/hrFetch";
import { buildQueueEntries, hrSnapshotFrom } from "@/apps/hr-recruitment/lib/queues";
import { isHodStep, stepByKey } from "@/apps/hr-recruitment/lib/steps";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set(["hr_head_approval", "mgmt_approval", "final_decision"]);

export function hrWorkItems(data: HrData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = data.stepOwners as StepOwnerRow[];

  /** Requisition → its hiring managers, for the HOD steps that route per-vacancy. */
  const managersByReq = new Map(data.requisitions.map((r) => [r.id, r.hiringManagerIds]));

  const isMine = (stepKey: string, requisitionId: string | null | undefined): boolean =>
    isHodStep(stepKey as Parameters<typeof isHodStep>[0])
      ? (managersByReq.get(requisitionId ?? "") ?? []).includes(uid)
      : isMineByStepOwners(stepKey, uid, owners);

  return buildQueueEntries(hrSnapshotFrom(data))
    .filter((e) => isAdmin || isMine(e.stepKey, e.requisitionId))
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
      assignment: isMine(e.stepKey, e.requisitionId) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
