/**
 * Travel Desk → work items. See ./README.md.
 *
 * ⚠ OWNERSHIP HERE IS NOT PURELY STEP-BASED, and it mirrors
 *   `fms_travel_can_act` rather than re-deciding anything:
 *
 *     · the two MANAGER steps (`manager_approval`, `claim_review`) route to the
 *       trip's OWN snapshotted approvers — and fall THROUGH to the configured
 *       step owners rather than early-returning, so HR named once in Settings
 *       sees every trip's approval without being on any trip's snapshot. That
 *       fall-through is the shape hr-exit calls the bug hr-recruitment avoided.
 *     · the `claim` step belongs to the TRAVELLER. Filing your own claim is not
 *       a step anybody is made an owner of, and leaving it to step owners would
 *       put every traveller's claim on the coordinator's plate — or, worse, on
 *       nobody's.
 *
 * ⚠ A COORDINATOR IS NOT GIVEN EVERY TRIP. `can_act` lets a coordinator act on
 *   any step, which is right for a permission and wrong for a worklist: it would
 *   hand the Travel Desk all nine steps of every open trip and drown the one
 *   thing actually theirs. My Work answers "what should I do next", not "what am
 *   I allowed to touch".
 *
 * ⚠ ONE TRIP APPEARS ONCE. Unlike hr-exit — where each clearance check is its
 *   own unit — a trip sits at exactly one step at a time (`STATUS_STEP` is a
 *   partial map from status to step), so the entity id alone keys the row.
 */
import { appName } from "@/apps/appInfo";
import type { TravelData } from "@/apps/travel-desk/data/travelFetch";
import { buildQueueEntries, type QueueEntry } from "@/apps/travel-desk/lib/queues";
import { resolveStepSla } from "@/apps/travel-desk/lib/sla";
import { stepByKey } from "@/apps/travel-desk/lib/steps";
import { stepOwnerIdsFor, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

/** Steps that are somebody's decision to make, surfaced as approvals. */
const APPROVAL_STEPS = new Set([
  "manager_approval",
  "director_approval",
  "claim_review",
  "finance_review",
]);

/** The two steps that route to the trip's own snapshotted approvers. */
const MANAGER_STEPS = new Set(["manager_approval", "claim_review"]);

export function travelDeskWorkItems(data: TravelData, uid: string, isAdmin: boolean): WorkItem[] {
  const stepOwners = (data.stepOwners ?? []) as unknown as StepOwnerRow[];
  const stepSla = resolveStepSla(data.stepSla);

  /**
   * (trip, step) → whoever it has been REASSIGNED to. Keyed exactly the way
   * fms_travel_can_act authorises, so this list and the module's own queues
   * cannot give different answers.
   */
  const assigneeByKey = new Map(
    (data.stepAssignees ?? []).map((a) => [`${a.tripId}|${a.stepKey}`, a.assignedTo]),
  );

  /** Mirrors fms_travel_can_act, minus the coordinator arm — see the header. */
  const isMine = (e: QueueEntry): boolean => {
    /**
     * ⚠ THE ASSIGNEE COMES FIRST, AND IT REPLACES EVERY RULE BELOW — including
     *   the snapshot-approver arm, which is otherwise ADDITIVE. A reassignment
     *   MOVES the step, so it has to leave the usual owner's My Work list and
     *   their line of the daily mail. It does NOT touch approverManagerIds; the
     *   trip still records who it was raised against, which is where a hand-back
     *   returns it.
     */
    const assignee = assigneeByKey.get(`${e.tripId}|${e.stepKey}`);
    if (assignee) return assignee === uid;

    // The traveller owns their own claim.
    if (e.stepKey === "claim" && e.travellerId === uid) return true;

    // The trip's own approvers, ADDITIVE — it falls through to step owners.
    if (MANAGER_STEPS.has(e.stepKey) && (e.approverManagerIds ?? []).includes(uid)) return true;

    return stepOwnerIdsFor(e.stepKey, stepOwners).includes(uid);
  };

  return buildQueueEntries(data.trips, stepSla)
    .filter((e) => isAdmin || isMine(e))
    .map((e) => ({
      id: `travel-desk:${e.entityId}:${e.stepKey}`,
      source: "travel-desk",
      sourceLabel: appName("travel-desk"),
      ref: e.ref,
      detail: e.travellerName,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: `/travel-desk/trips/${e.tripId}`,
      /*
        "direct" when it is specifically this person's — their own claim, or a
        trip whose approver snapshot names them. "team" when they are one of the
        configured owners of the step. Both are genuinely their work; the
        distinction is shown, not filtered on.
      */
      assignment:
        // An assignee is always DIRECT - somebody named this person for this step.
        assigneeByKey.get(e.tripId + "|" + e.stepKey) === uid ||
        (e.stepKey === "claim" && e.travellerId === uid) ||
        (MANAGER_STEPS.has(e.stepKey) && (e.approverManagerIds ?? []).includes(uid))
          ? ("direct" as const)
          : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
