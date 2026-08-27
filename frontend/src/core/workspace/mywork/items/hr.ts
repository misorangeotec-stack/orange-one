/**
 * HR Recruitment → work items. See ./README.md.
 *
 * OWNERSHIP HERE IS THREE RULES, NOT ONE.
 *
 * Most steps route by plain step ownership, so they use the shared
 * `isMineByStepOwners`. But the HOD steps have no row in `fms_hr_step_owners` at
 * all — Setup renders them "Automatic" — because "the HOD" is not a portal concept:
 * there is no departments.hod_id, and one global owner would send Sales candidates
 * to the Exim head. They route to the requisition's OWN hiring managers instead,
 * exactly as `fms_hr_can_act()` does server-side.
 *
 * `interview_2` then adds a third: the panel actually BOOKED for the round, which
 * since 20261020130000 may be any head set up to raise an MRF and not only this
 * vacancy's hiring manager. It is ORed on top of the hiring-manager rule rather than
 * replacing it — the server does the same (`fms_hr_can_act OR
 * fms_hr_is_interview_panel`), so both keep the round and a handover can never leave
 * it owned by nobody.
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

  /**
   * Candidate → the panel booked for `interview_2`, if anyone is on it.
   *
   * Round 2 can now be handed to any head set up to raise an MRF, and that head is not
   * necessarily this requisition's hiring manager — so routing R2 by `managersByReq`
   * alone would send it to somebody who is not taking it and hide it from whoever is.
   *
   * Ownership is ADDITIVE, not transferred: the hiring manager keeps the round and the
   * booked panel gains it, matching fms_hr_can_act OR fms_hr_is_interview_panel on the
   * server. That is deliberate — a handover must never leave a round owned by nobody.
   *
   * An empty panel is an auto-advance STUB, not a booking, so it contributes nothing
   * and the round correctly stays with the hiring manager until someone is put on it.
   */
  const r2PanelByCandidate = new Map<string, string[]>();
  for (const iv of data.interviews) {
    if (iv.round === 2 && !iv.heldAt && iv.interviewerIds.length > 0) {
      r2PanelByCandidate.set(iv.candidateId, iv.interviewerIds);
    }
  }

  /**
   * (requisition, step) → whoever it has been HANDED to. Keyed exactly the way
   * fms_hr_can_act authorises, so this list and the module's own queues cannot
   * give different answers.
   */
  const holderByKey = new Map(
    data.stepAssignees.map((a) => [`${a.requisitionId}|${a.stepKey}`, a.assignedTo]),
  );

  const isMine = (
    stepKey: string,
    requisitionId: string | null | undefined,
    entityId?: string,
  ): boolean => {
    /**
     * ⚠ THE HOLDER COMES FIRST, AND IT REPLACES EVERY OTHER RULE — including the
     *   Round-2 panel arm below, which is deliberately ADDITIVE. A handover MOVES
     *   the step: it has to leave the usual owner's My Work list and their line of
     *   the daily mail, or nothing has actually been passed on.
     */
    const holder = holderByKey.get(`${requisitionId ?? ""}|${stepKey}`);
    if (holder) return holder === uid;

    if (stepKey === "interview_2" && entityId && (r2PanelByCandidate.get(entityId) ?? []).includes(uid)) {
      return true;
    }
    return isHodStep(stepKey as Parameters<typeof isHodStep>[0])
      ? (managersByReq.get(requisitionId ?? "") ?? []).includes(uid)
      : isMineByStepOwners(stepKey, uid, owners);
  };

  return buildQueueEntries(hrSnapshotFrom(data))
    .filter((e) => isAdmin || isMine(e.stepKey, e.requisitionId, e.entityId))
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
      assignment: isMine(e.stepKey, e.requisitionId, e.entityId) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(e.stepKey),
    }));
}
