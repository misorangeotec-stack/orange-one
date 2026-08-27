/**
 * HR Exit → work items. See ./README.md.
 *
 * ⚠ OWNERSHIP HERE IS NOT PURELY STEP-BASED. A clearance row carries its own
 * `ownerIds` — WHO owes THAT SPECIFIC CHECK (IT owes the laptop, Finance the
 * advance, and so on). Falling back to the `clearance` step's owner list would put
 * every department's outstanding check on every clearance owner's plate. So a row's
 * own `ownerIds` wins whenever present; step owners are the fallback for the steps
 * that have no per-row owner.
 *
 * One exit case is legitimately owed at several steps at once, and each outstanding
 * clearance check is its own entry — so a case can appear more than once. That is
 * correct: they are separate units of work, which is why the id keys off `checkId`
 * and not the case.
 */
import { appName } from "@/apps/appInfo";
import type { ExitData } from "@/apps/hr-exit/data/exitFetch";
import { buildQueueEntries, exitSnapshotFrom, type QueueEntry } from "@/apps/hr-exit/lib/queues";
import { stepByKey } from "@/apps/hr-exit/lib/steps";
import { stepOwnerIdsFor, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set(["manager_review", "hr_verification", "hr_head_approval", "fnf_approve"]);

/**
 * Per-row owners win over step owners — see the header note — but an explicit
 * ASSIGNEE wins over both.
 *
 * ⚠ That order matters. A reassignment MOVES the step, so it has to leave the
 *   usual owner's My Work list and their line of the daily mail. It overrides
 *   even a clearance row's own `ownerIds`, which otherwise beat everything:
 *   somebody was named for this specific step on purpose.
 */
const ownersOf = (
  e: QueueEntry,
  stepOwners: StepOwnerRow[],
  assigneeByKey: Map<string, string>,
): string[] => {
  const assignee = assigneeByKey.get(`${e.caseId}|${e.stepKey}`);
  if (assignee) return [assignee];
  return e.ownerIds && e.ownerIds.length ? e.ownerIds : stepOwnerIdsFor(e.stepKey, stepOwners);
};

export function hrExitWorkItems(data: ExitData, uid: string, isAdmin: boolean): WorkItem[] {
  const stepOwners = data.stepOwners as StepOwnerRow[];
  const assigneeByKey = new Map(
    data.stepAssignees.map((a) => [`${a.caseId}|${a.stepKey}`, a.assignedTo]),
  );
  return buildQueueEntries(exitSnapshotFrom(data))
    .filter((e) => isAdmin || ownersOf(e, stepOwners, assigneeByKey).includes(uid))
    .map((e) => ({
      // A clearance check is its own work-item, so the check id has to be part of
      // the key — otherwise four open checks on one case collapse into one row.
      id: `hr-exit:${e.checkId ?? e.entityId}:${e.stepKey}`,
      source: "hr-exit",
      sourceLabel: appName("hr-exit"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: `/hr-exit/exits/${e.caseId}`,
      assignment: ownersOf(e, stepOwners, assigneeByKey).includes(uid) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
