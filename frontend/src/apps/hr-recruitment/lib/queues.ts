/**
 * The single source of truth for HR Recruitment **queue membership** and **due
 * dates**.
 *
 * Everything here is pure: it takes a data snapshot and returns plain data. In
 * particular it knows nothing about the signed-in user, so it never owner-filters
 * — the per-step queue pages narrow it to what you may action, but a coordinator's
 * Control Center must count *all* of it. Callers that want owner scoping compose
 * their own `.filter(...)` on top.
 *
 * The queue pages, the Kanban board and the cross-FMS Control Center all consume
 * this, so their counts cannot drift apart. **The board is a VIEW over these
 * entries, not a parallel model** — a card's overdue chip and the scoreboard's
 * overdue count are the same number by construction, because there is only one of
 * them.
 */
import { addMonths, addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import type { StepKey } from "./steps";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type {
  Candidate,
  CandidateStage,
  Interview,
  Onboarding,
  OnboardingCheck,
  Probation,
  ProbationReview,
  Requisition,
} from "../types";

/**
 * Everything the queue needs to answer "what is owed, and when".
 *
 * Every field is REQUIRED on purpose. This object is assembled in two places — the HR
 * store and the cross-FMS scoreboard's adapter — and if a field were optional, the
 * adapter could quietly omit it and the two would compute *different due dates from
 * the same data*, with nothing to catch it. Required means the compiler catches it.
 * (Better still: both now build this through `hrSnapshotFrom`, so there is one place.)
 */
export interface HrSnapshot {
  requisitions: Requisition[];
  candidates: Candidate[];
  /** Needed because a BOOKED round is due on its interview date, not on a rule. */
  interviews: Interview[];
  onboardings: Onboarding[];
  /** Needed because an onboarding is due on its next unticked item. */
  onboardingChecks: OnboardingCheck[];
  probations: Probation[];
  probationReviews: ProbationReview[];
  stepSla: StepSlaMap;
}

/**
 * HR's queue atom. Extends the shared shape (all the Control Center reads) with
 * what the HR screens need: which entity, and the department to group rows under
 * (Purchase groups by company; HR groups by department).
 */
export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "requisition" | "candidate" | "hire";
  departmentId: string | null;
  /** For a candidate row: which requisition they belong to. */
  requisitionId: string | null;
}

export const isOpenRequisition = (r: Requisition): boolean =>
  r.status !== "closed" && r.status !== "cancelled" && r.status !== "rejected" && r.status !== "on_hold";

/** A card still moving. Finalized and disqualified candidates are done. */
export const isOpenCandidate = (c: Candidate): boolean =>
  c.stage !== "finalized" && c.stage !== "disqualified";

/**
 * Onboarding still to do.
 *
 * A completed one is a hire, not a work-item. A declined / no-show one is nobody's
 * work either — that seat has already gone back to the requisition, which is the
 * open work now.
 */
export const isOpenOnboarding = (o: Onboarding): boolean =>
  !o.completedAt && o.offerStatus !== "declined" && o.offerStatus !== "no_show";

/** A seat is CONSUMED by a finalized candidate who has not declined / no-showed. */
export const seatsTaken = (
  requisitionId: string,
  candidates: Candidate[],
  onboardings: Onboarding[],
): number => {
  const byCandidate = new Map(onboardings.map((o) => [o.candidateId, o]));
  return candidates.filter(
    (c) =>
      c.requisitionId === requisitionId &&
      c.stage === "finalized" &&
      !["declined", "no_show"].includes(byCandidate.get(c.id)?.offerStatus ?? "pending"),
  ).length;
};

/** A seat is FILLED only when the person actually joined. Mirrors fms_hr_seats_joined(). */
export const seatsJoined = (requisitionId: string, onboardings: Onboarding[]): number =>
  onboardings.filter(
    (o) => o.requisitionId === requisitionId && o.offerStatus === "accepted" && !!o.completedAt,
  ).length;

/**
 * The step a card in this column is WAITING ON — whose work-item it currently is.
 *
 * This is the crux of the board. A card sitting in "Resumes Uploaded" was put
 * there by nobody in particular; what matters is that HR now owes it a shortlist
 * decision. So the card's due date, its position in someone's queue, and who is
 * allowed to act on it all key off THIS, not off the column's own name.
 *
 * Mirrors `fms_hr_pending_step()` in SQL — keep the two in step.
 */
export const STAGE_PENDING_STEP: Record<CandidateStage, StepKey | null> = {
  resume_uploaded: "hr_shortlist",   // HR must screen this CV
  hr_shortlisted: "hod_share",       // HR must send it to the HOD
  shared_with_hod: "hod_shortlist",  // the HOD must decide
  hod_shortlisted: "interview_1",    // Round 1 must be booked
  interview_1: "interview_1",        // Round 1 must be conducted
  interview_2: "interview_2",
  interview_3: "interview_3",
  final_decision: "final_decision",
  finalized: null,                   // closed
  disqualified: null,
};

/* -------------------------------------------------------------------------- */
/*  Step-completion timestamps — the ANCHORS every due date is measured from.  */
/*                                                                            */
/*  These read the domain row's own timestamp columns, never the activity      */
/*  trail. The trail is best-effort (a failed `announce` is swallowed), so     */
/*  inferring completion from it would silently lose a step.                   */
/* -------------------------------------------------------------------------- */

export function requisitionStepCompletedIso(r: Requisition, step: StepKey): string | null {
  switch (step) {
    case "mrf":
      return r.submittedAt;
    case "mrf_resubmit":
      // The clock starts the day it was SENT BACK. Without this case the anchor falls
      // through to `submittedAt` below — so an MRF sent back today would be dated from
      // its original submission weeks ago and arrive already overdue.
      return r.sentBackAt;
    case "hr_head_approval":
      return r.hrApprovedAt;
    case "mgmt_approval":
      return r.mgmtApprovedAt;
    case "job_posting":
      return r.postedAt;
    default:
      return null;
  }
}

/**
 * When a step completed *for this candidate*.
 *
 * A requisition-scope anchor (e.g. `job_posting`) resolves one hop up, via the
 * candidate's requisition — the same cross-scope walk Purchase already does when a
 * PO anchors on its request line. `resume_upload` deliberately resolves to THIS
 * CV's arrival, not the requisition's posting date: HR gets N days from when the
 * CV actually landed, not from when the advert went out.
 */
export function candidateStepCompletedIso(
  c: Candidate,
  step: StepKey,
  reqById: Map<string, Requisition>,
): string | null {
  switch (step) {
    case "resume_upload":
      return c.uploadedAt;
    case "hr_shortlist":
      return c.hrShortlistedAt;
    case "hod_share":
      return c.sharedToHodAt;
    case "hod_shortlist":
      return c.hodDecidedAt;
    case "interview_1":
      return c.interview1At;
    case "interview_2":
      return c.interview2At;
    case "interview_3":
      return c.interview3At;
    case "final_decision":
      return c.finalizedAt ?? c.disqualifiedAt;
    default: {
      // A requisition-scope anchor — walk up to the requisition.
      const r = reqById.get(c.requisitionId);
      return r ? requisitionStepCompletedIso(r, step) : null;
    }
  }
}

/** Due date for a requisition-scope step. */
export function requisitionDueIso(snap: HrSnapshot, r: Requisition, step: StepKey): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = requisitionStepCompletedIso(r, sla.anchor) ?? r.submittedAt;
  return dueIsoFrom(from, sla);
}

/** The round a candidate's stage means, or null if they aren't in an interview stage. */
const stageRound = (stage: CandidateStage): 1 | 2 | 3 | null =>
  stage === "interview_1" ? 1 : stage === "interview_2" ? 2 : stage === "interview_3" ? 3 : null;

/**
 * Due date for the step a candidate card is currently waiting on.
 *
 * BOOKING a round and HOLDING it are different jobs with different deadlines, and they
 * used to share one clock counted from the HOD's shortlist. So a round legitimately
 * booked for three weeks out was overdue the day it was booked, and the board bled red
 * for interviews that were perfectly on track.
 *
 *   • not booked yet  → the SLA clock: "book this within N days"
 *   • booked, dated   → the interview date itself: it is due when it happens
 *   • booked, NO date → back to the SLA clock. A date-less booking is reachable today,
 *     and returning null here would drop the round out of the overdue counts entirely —
 *     trading a false red for a silent disappearance, which is worse.
 */
export function candidateDueIso(
  snap: HrSnapshot,
  c: Candidate,
  reqById: Map<string, Requisition>,
  ivByCandidate?: Map<string, Interview[]>,
): string | null {
  const step = STAGE_PENDING_STEP[c.stage];
  if (!step) return null; // finalized / disqualified — nothing is due
  const sla = snap.stepSla[step];
  if (!sla) return null;

  const round = stageRound(c.stage);
  if (round) {
    const list = ivByCandidate?.get(c.id) ?? snap.interviews.filter((iv) => iv.candidateId === c.id);
    const booked = list.find((iv) => iv.round === round && !iv.heldAt);
    if (booked?.scheduledOn) return booked.scheduledOn;
  }

  const from = candidateStepCompletedIso(c, sla.anchor, reqById) ?? c.uploadedAt;
  return dueIsoFrom(from, sla);
}

/**
 * When a step completed *for this hire* — the `hire`-scope anchor walk.
 *
 * `onboarding` resolves to the onboarding's own completion (the person joined).
 * Anything earlier belongs to the candidate, so we hop up: hire → candidate →
 * requisition. Exactly the cross-scope resolution the candidate walk already does.
 */
export function hireStepCompletedIso(
  o: Onboarding,
  step: StepKey,
  candById: Map<string, Candidate>,
  reqById: Map<string, Requisition>,
): string | null {
  if (step === "onboarding") return o.completedAt;
  const c = candById.get(o.candidateId);
  return c ? candidateStepCompletedIso(c, step, reqById) : null;
}

/**
 * Due date for the `onboarding` step on one hire.
 *
 * This used to be "selection + 7 working days", full stop — which made **every hire on
 * a notice period overdue at birth**. Someone selected today with a 60-day notice was
 * red on day 8 and stayed red for two months, so the whole onboarding column was
 * permanently on fire and told you nothing.
 *
 * An onboarding has two phases, and only one of them is about the selection date:
 *
 *   1. No joining date yet → the work IS "agree a start date". Keep the short clock
 *      from selection: HR has about a week to pin it down. That was always right.
 *   2. Joining date set → the work is the checklist, and the checklist's clocks all run
 *      from the joining date. So the step is due on its **next unticked item** — the
 *      same "one pending sub-unit" shape probation already uses, and it stays honest
 *      about how late the *earliest* outstanding thing is.
 *
 * Two states that would otherwise fall through to null (and so vanish from every
 * overdue count while being genuinely stuck):
 *   • every box ticked, but the offer is still unanswered — the work is "chase the
 *     answer", so it stays dated on the last item.
 *   • an empty checklist (no active master items when it was seeded) — it can never
 *     complete on its own, so it is dated on the joining date and will go red.
 */
export function onboardingDueIso(
  snap: HrSnapshot,
  o: Onboarding,
  candById: Map<string, Candidate>,
  reqById: Map<string, Requisition>,
  checksByOnboarding?: Map<string, OnboardingCheck[]>,
): string | null {
  const sla = snap.stepSla.onboarding;
  if (!sla) return null;

  // Phase 1 — no joining date. The clock from selection is exactly right.
  if (!o.joiningDate) {
    const from =
      hireStepCompletedIso(o, sla.anchor, candById, reqById) ??
      candById.get(o.candidateId)?.finalizedAt ??
      o.createdAt;
    return dueIsoFrom(from, sla);
  }

  // Phase 2 — the checklist owns the clock.
  const checks =
    checksByOnboarding?.get(o.id) ?? snap.onboardingChecks.filter((k) => k.onboardingId === o.id);

  const dues = checks
    .filter((k) => !k.done)
    .map((k) => checkDueIso(o, k))
    .filter((d): d is string => !!d)
    .sort();
  if (dues.length) return dues[0]; // the earliest thing still owed

  // Nothing left to tick. Either the offer is unanswered, or the checklist is empty —
  // both are stuck, and both must still be able to go red.
  const all = checks
    .map((k) => checkDueIso(o, k))
    .filter((d): d is string => !!d)
    .sort();
  return all.length ? all[all.length - 1] : o.joiningDate;
}

/**
 * Due date for ONE checklist item.
 *
 * Items are NOT workflow steps — `onboarding` is one step, and the checklist lives
 * in a master so HR can add an item without a migration. So an item's clock is not
 * an SLA rule: it is simply `due_days` working days from the joining date, which is
 * the event the whole checklist hangs off.
 */
export function checkDueIso(o: Onboarding, check: OnboardingCheck): string | null {
  if (!o.joiningDate) return null; // the checklist is locked until HR sets the date
  const from = new Date(`${o.joiningDate}T00:00:00`);
  if (Number.isNaN(from.getTime())) return null;
  return localDateIso(addWorkingDays(from, check.dueDays));
}

/* -------------------------------------------------------------------------- */
/*  Probation — the HOD's monthly work on someone who has actually JOINED.     */
/* -------------------------------------------------------------------------- */

/** Still someone's work. A probation with a final answer is history, not a queue row. */
export const isOpenProbation = (p: Probation): boolean => !p.finalStatus;

/**
 * The ONE step a probation is currently waiting on.
 *
 * Reviews are sequential — a person two months in owes month 1 if month 1 was never
 * written, however late it now is. So exactly one entry exists per probation at a
 * time, and its due date is honest about how far behind it has fallen (rather than
 * three simultaneous rows all claiming to be today's work).
 *
 * Mirrors the sequence the RPCs enforce (fms_hr_record_probation_review /
 * fms_hr_decide_probation / fms_hr_decide_extension) — keep the two in step.
 */
export function probationPendingStep(p: Probation, reviews: ProbationReview[]): StepKey | null {
  if (p.finalStatus) return null; // decided — nothing is due
  const has = (m: number) => reviews.some((r) => r.month === m);

  if (!has(1)) return "probation_m1";
  if (!has(2)) return "probation_m2";
  if (!has(3)) return "probation_m3";

  // The three reviews are in. The three-month decision is what is owed now.
  if (p.outcome === null) return "probation_final";

  // Extended: one more review, then the same decision maker closes it out.
  if (!has(4)) return "probation_extension";
  return "probation_final";
}

/**
 * Due date for a probation step: N CALENDAR MONTHS after the joining date — never
 * working days. "One month after they joined" is not "26 working days", and the
 * month-end trap is real: a 31-Jan joiner's Month-1 review is due 28-Feb, not 3-Mar.
 * `addMonths` clamps; `fms_hr_add_months()` in SQL does the same thing.
 *
 * The probation steps are TRIGGER_STEPS (lib/sla.ts): their clock starts on a domain
 * event, so the configured `anchor` is inert and only `days` — the month count — is
 * read. That number stays admin-editable in Setup → Due Dates.
 */
export function probationDueIso(snap: HrSnapshot, p: Probation, step: StepKey): string | null {
  // Once extended, the final decision follows the MONTH-4 review, not the month-3 one —
  // otherwise an extension would be born overdue.
  const key: StepKey = step === "probation_final" && p.outcome === "extended" ? "probation_extension" : step;
  const sla = snap.stepSla[key];
  if (!sla) return null;

  const from = new Date(`${p.joiningDate}T00:00:00`); // local midnight, never UTC-shifted
  if (Number.isNaN(from.getTime())) return null;
  return localDateIso(addMonths(from, sla.days));
}

/** Whole days the card has sat in its current column. */
export function daysInStage(c: Candidate): number {
  const map: Record<CandidateStage, string | null> = {
    resume_uploaded: c.uploadedAt,
    hr_shortlisted: c.hrShortlistedAt,
    shared_with_hod: c.sharedToHodAt,
    hod_shortlisted: c.hodDecidedAt,
    interview_1: c.hodDecidedAt,
    interview_2: c.interview1At,
    interview_3: c.interview2At,
    final_decision: c.finalDecisionAt,
    finalized: c.finalizedAt,
    disqualified: c.disqualifiedAt,
  };
  const since = map[c.stage] ?? c.uploadedAt;
  const then = new Date(since).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/* -------------------------------------------------------------------------- */
/*  Queue predicates                                                          */
/* -------------------------------------------------------------------------- */

export const reqInHrApproval = (r: Requisition) => r.status === "hr_review";
export const reqInMgmtApproval = (r: Requisition) => r.status === "mgmt_review";
export const reqInJobPosting = (r: Requisition) => r.status === "posting";
export const reqSentBack = (r: Requisition) => r.status === "sent_back";

/**
 * Posted, and STILL SHORT OF PEOPLE.
 *
 * A 4-seat vacancy genuinely keeps needing CVs after the first hire — but only until
 * the 4th seat is taken. This used to be `status === "sourcing"` and nothing else, so a
 * fully-hired vacancy kept demanding CVs for the entire onboarding window (weeks),
 * showing a fat red number for work nobody could possibly do: there was no seat to fill.
 *
 * A seat is TAKEN by a finalized candidate who has not declined — so a decline drops the
 * count and sourcing correctly resumes, exactly as the seat rules do server-side.
 */
export const reqInResumeUpload = (
  r: Requisition,
  candidates: Candidate[],
  onboardings: Onboarding[],
): boolean =>
  r.status === "sourcing" && seatsTaken(r.id, candidates, onboardings) < r.positionsRequired;

/**
 * Roll the snapshot up into the flat list of open work-items.
 *
 * A "queue entry" is a **(step, entity)** work-item, not an entity — the unit a
 * process coordinator actually wants to count.
 *
 * Note `resume_upload` legitimately produces BOTH kinds of row: one per open
 * vacancy ("this job still needs CVs") and none per candidate — a candidate's own
 * pending step is `hr_shortlist`, never `resume_upload`. So the two never
 * double-count the same work.
 *
 * An onboarding produces exactly ONE entry, at the `onboarding` step — the checklist
 * items inside it are not steps and never surface as queue rows of their own. So does
 * a probation, at whichever monthly review or decision it is currently waiting on.
 */
/**
 * Build the queue's input from a fetch result — THE one place that does it.
 *
 * This exists because the snapshot used to be hand-assembled in two places: the HR store
 * and the cross-FMS scoreboard's adapter. Two hand-written object literals, one queue —
 * so the scoreboard could quietly compute different due dates from the same data, and
 * nothing would catch it. (That is precisely how the interview and onboarding clocks got
 * away with being wrong for so long.)
 *
 * One function, called by both. A new field is now a compile error in one place, not a
 * wrong number in another.
 */
export function hrSnapshotFrom(data: {
  requisitions: Requisition[];
  candidates: Candidate[];
  interviews: Interview[];
  onboardings: Onboarding[];
  onboardingChecks: OnboardingCheck[];
  probations: Probation[];
  probationReviews: ProbationReview[];
  config: { stepSla: StepSlaMap };
}): HrSnapshot {
  return {
    requisitions: data.requisitions,
    candidates: data.candidates,
    interviews: data.interviews,
    onboardings: data.onboardings,
    onboardingChecks: data.onboardingChecks,
    probations: data.probations,
    probationReviews: data.probationReviews,
    stepSla: data.config.stepSla,
  };
}

export function buildQueueEntries(snap: HrSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  const reqById = new Map(snap.requisitions.map((r) => [r.id, r]));
  const candById = new Map(snap.candidates.map((c) => [c.id, c]));

  // Index once — these are read per entity below, and scanning the flat arrays each
  // time turns the queue into an O(n²) walk on a real dataset.
  const ivByCandidate = new Map<string, Interview[]>();
  for (const iv of snap.interviews) {
    const list = ivByCandidate.get(iv.candidateId) ?? [];
    list.push(iv);
    ivByCandidate.set(iv.candidateId, list);
  }
  const checksByOnboarding = new Map<string, OnboardingCheck[]>();
  for (const k of snap.onboardingChecks) {
    const list = checksByOnboarding.get(k.onboardingId) ?? [];
    list.push(k);
    checksByOnboarding.set(k.onboardingId, list);
  }

  const reviewsByProbation = new Map<string, ProbationReview[]>();
  for (const rv of snap.probationReviews) {
    const list = reviewsByProbation.get(rv.probationId) ?? [];
    list.push(rv);
    reviewsByProbation.set(rv.probationId, list);
  }

  for (const r of snap.requisitions) {
    if (!isOpenRequisition(r)) continue;
    const push = (stepKey: StepKey) =>
      out.push({
        stepKey,
        entityType: "requisition",
        entityId: r.id,
        ref: r.mrfNo,
        dueIso: requisitionDueIso(snap, r, stepKey),
        departmentId: r.departmentId,
        requisitionId: r.id,
      });

    if (reqInHrApproval(r)) push("hr_head_approval");
    else if (reqInMgmtApproval(r)) push("mgmt_approval");
    else if (reqInJobPosting(r)) push("job_posting");
    else if (reqInResumeUpload(r, snap.candidates, snap.onboardings)) push("resume_upload");
    // Sent back to the person who raised it, to revise and resubmit. This branch did
    // not exist: `reqSentBack` was written and never called, so a sent-back MRF emitted
    // NOTHING — invisible in every queue and on every scoreboard. If the raiser forgot
    // it, nothing on earth reminded them, and the vacancy quietly died.
    else if (reqSentBack(r)) push("mrf_resubmit");
  }

  for (const c of snap.candidates) {
    if (!isOpenCandidate(c)) continue;
    const r = reqById.get(c.requisitionId);
    // A candidate on a held / cancelled / closed vacancy is not live work.
    if (!r || !isOpenRequisition(r)) continue;
    const step = STAGE_PENDING_STEP[c.stage];
    if (!step) continue;

    out.push({
      stepKey: step,
      entityType: "candidate",
      entityId: c.id,
      ref: c.name,
      dueIso: candidateDueIso(snap, c, reqById, ivByCandidate),
      departmentId: r.departmentId,
      requisitionId: r.id,
    });
  }

  /**
   * A HIRE IS NEVER PAUSED.
   *
   * This used to be gated on `isOpenRequisition`, like candidates are — so putting a
   * vacancy on hold (or cancelling it) silently deleted the onboarding of someone who
   * had already ACCEPTED and had a joining date. They still walked in on Monday; their
   * police verification and system handover were still owed; and not one screen showed
   * it to anyone.
   *
   * A vacancy is a plan. A hire is a person. Pausing the plan pauses the CVs and the
   * interviews above — it does not pause the person. So this loop, like probation's
   * below, is deliberately NOT requisition-gated.
   *
   * (Cancelling out from under an accepted offer is now refused outright at the
   * database — see 20260713120000_fms_hr_protect_accepted_hires.sql.)
   */
  for (const o of snap.onboardings) {
    if (!isOpenOnboarding(o)) continue;
    const r = reqById.get(o.requisitionId);

    out.push({
      stepKey: "onboarding",
      entityType: "hire",
      entityId: o.id,
      ref: candById.get(o.candidateId)?.name ?? "New hire",
      dueIso: onboardingDueIso(snap, o, candById, reqById, checksByOnboarding),
      departmentId: r?.departmentId ?? null,
      requisitionId: o.requisitionId,
    });
  }

  /**
   * A probation belongs to a person, not to a vacancy. So — unlike every other
   * entity here — it is deliberately NOT filtered by isOpenRequisition: the
   * requisition that hired them is CLOSED by definition (it closed the moment they
   * joined), and the HOD still owes them three monthly reviews.
   */
  for (const p of snap.probations) {
    if (!isOpenProbation(p)) continue;
    const step = probationPendingStep(p, reviewsByProbation.get(p.id) ?? []);
    if (!step) continue;
    const r = reqById.get(p.requisitionId);

    out.push({
      stepKey: step,
      entityType: "hire",
      entityId: p.id,
      ref: candById.get(p.candidateId)?.name ?? "New hire",
      dueIso: probationDueIso(snap, p, step),
      departmentId: r?.departmentId ?? null,
      requisitionId: p.requisitionId,
    });
  }

  return out;
}
