/**
 * New Recruitment (HR) — scored steps (CC-1).
 *
 * Closed, two sources, both the module's own:
 *  · every step with a Completed tab, from `hrCompletedEntries` — the builder that
 *    moved out of the store for this, so the ranking lists exactly what that tab
 *    lists. Onboarding is credited as the tab shows it: to whoever set the joining
 *    date (or decided the offer), since completing the checklist records no actor.
 *    The user chose to follow the module's list, 18-09-2026.
 *  · the three candidate steps no tab lists — the HR and HOD shortlists and the
 *    final decision — from `candidateStepCompletedIso` and its actor twin.
 *    A DISQUALIFICATION records no actor, so it closes the step for nobody.
 *
 * Due dates: `requisitionDueIso`, `candidateStepDueIso` (the step-aware form of the
 * card's own due date), `onboardingDueIso` and `probationDueIso`.
 *
 * Open: `hrWorkItems`, My Work Today's rule — an assignee replaces everyone, a
 * booked panel adds itself, HOD steps go to the requisition's hiring managers, the
 * rest to step owners.
 *
 * Left out, both ways:
 *  · Revise & Resubmit — the requester re-submitting their own MRF is "submitted",
 *    not work anyone was given (decision 3).
 *  · Collect Resumes — a vacancy short of CVs. Nobody ever closes it.
 *  · the test position MRF-2627-0019 ("ZZ TEST - HR Executive") and everything
 *    hanging off it, and any `MRF-DEMO-` seed.
 *
 * ⚠ Re-recording an interview result or a probation review re-stamps its time, so
 *   those read as done at the last recording.
 */
import { fetchHrData, type HrData } from "@/apps/hr-recruitment/data/hrFetch";
import {
  candidateStepActorId,
  candidateStepCompletedIso,
  candidateStepDueIso,
  hrCompletedEntries,
  hrSnapshotFrom,
  onboardingDueIso,
  probationDueIso,
  requisitionDueIso,
  type HrCompletedIndex,
} from "@/apps/hr-recruitment/lib/queues";
import { CHECKIN_STEPS, stepByKey, type StepKey } from "@/apps/hr-recruitment/lib/steps";
import type { Candidate, Interview, Onboarding, OnboardingCheck, Probation, ProbationCheckin, ProbationReview, Requisition } from "@/apps/hr-recruitment/types";
import { hrWorkItems } from "@/core/workspace/mywork/items/hr";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { perDataset } from "../memo";
import { heldDrop, parseItems } from "../workItems";

const TEST_MRFS: ReadonlySet<string> = new Set(["MRF-2627-0019"]);
const EXCLUDED: ReadonlySet<string> = new Set(["mrf_resubmit", "resume_upload"]);

const REQUISITION_TAB_STEPS: StepKey[] = ["hr_head_approval", "mgmt_approval", "job_posting"];
const INTERVIEW_TAB_STEPS: StepKey[] = ["telephonic_screening", "interview_1", "interview_2", "interview_3"];
// NR-11 · the Day 7/15/30/60/90 check-ins that replaced the monthly reviews in
// b2690d30. The old `probation_m1`/`m2`/`m3` keys are deliberately NOT listed: the
// form that wrote them was deleted with the cadence, so scanning for them scores
// nobody and only suggests the ranking still knows about them. They stay in
// lib/steps.ts, flagged `retired`, so an old row keeps its title.
const PROBATION_TAB_STEPS: StepKey[] = [
  ...CHECKIN_STEPS.map((c) => c.key),
  "probation_extension",
  "probation_final",
];
/** Candidate steps that close with a stamp but have no Completed tab. */
const UNTABBED_CANDIDATE_STEPS: StepKey[] = ["hr_shortlist", "hod_shortlist", "final_decision"];

const label = (k: string) => stepByKey(k)?.title ?? k;

const group = <T,>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
};

interface Context {
  snap: ReturnType<typeof hrSnapshotFrom>;
  ix: HrCompletedIndex;
  checksByOnb: Map<string, OnboardingCheck[]>;
  /** Any HR entity id → the requisition it belongs to, for the test-position rule. */
  reqOf: Map<string, string | null>;
  isTestReq: (requisitionId: string | null) => boolean;
}

const contextOf = perDataset((data: HrData): Context => {
  const reqById = new Map<string, Requisition>(data.requisitions.map((r) => [r.id, r]));
  const ix: HrCompletedIndex = {
    requisitions: data.requisitions,
    candidates: data.candidates,
    onboardings: data.onboardings,
    probations: data.probations,
    reqById,
    canById: new Map<string, Candidate>(data.candidates.map((c) => [c.id, c])),
    cansByReq: group<Candidate>(data.candidates, (c) => c.requisitionId),
    ivsByCan: group<Interview>(data.interviews, (iv) => iv.candidateId),
    reviewsByProb: group<ProbationReview>(data.probationReviews, (rv) => rv.probationId),
    checkinsByProb: group<ProbationCheckin>(data.probationCheckins, (c) => c.probationId),
    // A check-in is written by the head of department and by the new joiner; HR
    // writes neither. HR is answerable for BOTH answers arriving by the due date,
    // which is the moment `completedAt` is stamped — so the point follows the step's
    // owner. Configured by person in Setup; owned by a department instead and this
    // returns null, which the ranking reports as a `no_actor` drop rather than
    // silently crediting the wrong person.
    stepOwnerId: (stepKey) =>
      data.stepOwners.find((o) => o.stepKey === stepKey)?.employeeIds[0] ?? null,
  };
  const reqOf = new Map<string, string | null>();
  for (const r of data.requisitions) reqOf.set(r.id, r.id);
  for (const c of data.candidates) reqOf.set(c.id, c.requisitionId);
  for (const o of data.onboardings as Onboarding[]) reqOf.set(o.id, o.requisitionId);
  for (const p of data.probations as Probation[]) reqOf.set(p.id, p.requisitionId);
  const isTestReq = (id: string | null) => {
    const mrf = id ? reqById.get(id)?.mrfNo : undefined;
    return !!mrf && (TEST_MRFS.has(mrf) || mrf.startsWith("MRF-DEMO-"));
  };
  return {
    snap: hrSnapshotFrom(data),
    ix,
    checksByOnb: group<OnboardingCheck>(data.onboardingChecks, (k) => k.onboardingId),
    reqOf,
    isTestReq,
  };
});

export const hrRecruitmentScorer: ModuleScorer<HrData> = {
  key: "hr",
  appId: "hr-recruitment",
  load: () => fetchHrData(),

  closed(data) {
    const { snap, ix, checksByOnb, isTestReq } = contextOf(data);
    const out: ClosedStep[] = [];
    const add = (
      stepKey: StepKey,
      entityId: string,
      requisitionId: string | null,
      ref: string,
      actorId: string | null,
      doneAtIso: string,
      dueIso: string | null,
    ) => {
      const drop: DropReason | undefined = isTestReq(requisitionId) ? "test_record" : undefined;
      out.push({
        stepId: `${entityId}:${stepKey}`,
        entityId,
        ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: 0,
        dueIso,
        actorId,
        doneAtIso,
        drop,
      });
    };

    for (const step of REQUISITION_TAB_STEPS) {
      for (const e of hrCompletedEntries(ix, step)) {
        add(step, e.entityId, e.requisitionId, e.ref, e.actorId, e.atIso, requisitionDueIso(snap, e.row as Requisition, step));
      }
    }
    for (const step of INTERVIEW_TAB_STEPS) {
      for (const e of hrCompletedEntries(ix, step)) {
        const c = e.row as Candidate;
        add(step, e.entityId, e.requisitionId, e.ref, e.actorId, e.atIso, candidateStepDueIso(snap, c, step, ix.reqById, ix.ivsByCan));
      }
    }
    for (const e of hrCompletedEntries(ix, "onboarding")) {
      const due = onboardingDueIso(snap, e.row as Onboarding, ix.canById, ix.reqById, checksByOnb);
      add("onboarding", e.entityId, e.requisitionId, e.ref, e.actorId, e.atIso, due);
    }
    for (const step of PROBATION_TAB_STEPS) {
      for (const e of hrCompletedEntries(ix, step)) {
        add(step, e.entityId, e.requisitionId, e.ref, e.actorId, e.atIso, probationDueIso(snap, e.row as Probation, step));
      }
    }
    for (const step of UNTABBED_CANDIDATE_STEPS) {
      for (const c of data.candidates) {
        const at = candidateStepCompletedIso(c, step, ix.reqById);
        if (!at) continue;
        add(step, c.id, c.requisitionId, c.name, candidateStepActorId(c, step), at, candidateStepDueIso(snap, c, step, ix.reqById, ix.ivsByCan));
      }
    }
    return out;
  },

  openFor(data, uid) {
    const { reqOf, isTestReq } = contextOf(data);
    return parseItems(hrWorkItems(data, uid, false)).map(({ entityId, stepKey, item }): OpenStep => ({
      stepId: `${entityId}:${stepKey}`,
      entityId,
      ref: item.ref,
      stepKey,
      stepLabel: label(stepKey),
      roundNo: 0,
      dueIso: item.dueIso,
      drop:
        heldDrop(item) ??
        (EXCLUDED.has(stepKey) ? "excluded_step" : isTestReq(reqOf.get(entityId) ?? null) ? "test_record" : undefined),
    }));
  },
};
