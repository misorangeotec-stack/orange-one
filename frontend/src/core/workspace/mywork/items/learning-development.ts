/**
 * Learning & Development → work items. See ./README.md.
 *
 * ⚠ THIS MODULE IS UNIVERSAL, AND THAT CHANGES WHAT THIS FILE IS FOR. Every other
 *   provider here answers "which of this department's rows are mine". This one is
 *   read by all 67 people in the company, because everybody is a potential
 *   participant — so most of what it returns is somebody's OWN obligation (answer
 *   the invitation, hand in the assignment, give the feedback), not pipeline work.
 *   Get the ownership wrong here and a warehouse operator opens the home screen to
 *   HR's approval queue.
 *
 * ⚠ FIVE STEPS ARE ROW-OWNED, and `lib/work.ts` has already resolved who: a
 *   nominee's RSVP, assignment and feedback are theirs, and the 30-day
 *   effectiveness note is owed by the HOD named on its own row. This file never
 *   re-derives any of that — it reads `ownerIds` and falls back to the configured
 *   step owners when the row names nobody. That fallback matters: 19 of 67
 *   employees resolve to no HOD at all, and without it their effectiveness review
 *   would be owed by nobody and silently never happen.
 *
 * ⚠ A PROCESS COORDINATOR IS NOT GIVEN EVERY STEP. `fms_ld_can_act` lets one act
 *   on anything, which is right for a permission and wrong for a worklist: it
 *   would hand the L&D executive all 22 steps of every open request and drown the
 *   ones actually hers. My Work answers "what should I do next", not "what am I
 *   allowed to touch" — the same line travel-desk draws.
 */
import { appName } from "@/apps/appInfo";
import type { LdData } from "@/apps/learning-development/data/ldFetch";
import { buildLdWork, type LdOpenStep } from "@/apps/learning-development/lib/work";
import { resolveStepSla } from "@/apps/learning-development/lib/sla";
import { stepByKey } from "@/apps/learning-development/lib/steps";
import { stepOwnerIdsFor, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set([
  "need_validation",
  "hr_head_approval",
  "mgmt_approval",
  "nomination_approval",
  "assignment_review",
  "effectiveness",
]);

export function learningDevelopmentWorkItems(
  data: LdData,
  uid: string,
  isAdmin: boolean,
): WorkItem[] {
  const stepOwners = (data.stepOwners ?? []) as unknown as StepOwnerRow[];
  const { open } = buildLdWork(data, resolveStepSla(data.config?.step_sla ?? null));

  /**
   * (request|session, step) → whoever it has been REASSIGNED to.
   *
   * ⚠ THE ASSIGNEE REPLACES EVERY OTHER RULE, including a row-owned one. A
   *   reassignment MOVES the step, so it has to leave the usual owner's list —
   *   otherwise both of them see it and neither is sure it is theirs.
   */
  const assignee = new Map<string, string>();
  for (const a of data.stepAssignees ?? []) {
    const ent = a.requestId ?? a.sessionId;
    if (ent) assignee.set(`${ent}|${a.stepKey}`, a.assignedTo);
  }

  const isMine = (o: LdOpenStep): boolean => {
    const moved = assignee.get(`${o.entityId}|${o.stepKey}`);
    if (moved) return moved === uid;
    // The row named its owner — a nominee, an attendee's HOD, an internal trainer.
    if (o.ownerIds.length > 0) return o.ownerIds.includes(uid);
    return stepOwnerIdsFor(o.stepKey, stepOwners).includes(uid);
  };

  /*
   * ⚠ AN ADMIN IS NOT GIVEN EVERYTHING HERE EITHER, and that is the opposite of
   *   what `isAdmin` does in most of this folder. An admin of this hub is a
   *   person with a job, and this module's steps belong to named people; handing
   *   them all 22 would bury their own RSVP under everyone else's paperwork. They
   *   still SEE everything through the module's own queues and the Control
   *   Center, which is where org-wide oversight lives.
   */
  void isAdmin;

  return open
    .filter(isMine)
    .map((o): WorkItem => {
      const rowOwned = o.ownerIds.includes(uid);
      return {
        id: `learning-development:${o.rowId}:${o.stepKey}`,
        source: "learning-development",
        sourceLabel: appName("learning-development"),
        ref: o.ref,
        detail: o.title,
        stage: stepByKey(o.stepKey)?.short,
        dueIso: o.dueIso,
        to: o.sessionId
          ? `/learning-development/sessions/${o.sessionId}`
          : `/learning-development/requests/${o.entityId}`,
        /*
         * "direct" when the row itself names this person — their own RSVP, their
         * own assignment, their own team's effectiveness note. "team" when they
         * are one of the configured owners of the step. Both are genuinely their
         * work; the distinction is shown, not filtered on.
         */
        assignment: rowOwned || assignee.get(`${o.entityId}|${o.stepKey}`) === uid ? "direct" : "team",
        isApproval: APPROVAL_STEPS.has(o.stepKey),
      };
    });
}
