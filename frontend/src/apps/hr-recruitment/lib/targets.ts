/**
 * NR-7 — what the HR Head's four numbers look like against what actually
 * happened on a position.
 *
 * Every rule below is a decision the client took on 21-09-2026; the ones that
 * are easy to get wrong carry the reason with them.
 */
import { localDateIso } from "@/shared/lib/workingDays";
import { STAGE_RANK } from "./board";
import type { Candidate, Interview, Onboarding, Requisition } from "../types";

/** Midnight local, never UTC-shifted — the same convention the queues use. */
const at = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00`);

/** Whole CALENDAR days from a to b. The closure period is not a working-day clock. */
const daysBetween = (aIso: string, bIso: string): number =>
  Math.round((at(bIso).getTime() - at(aIso).getTime()) / 86_400_000);

export const addDaysIso = (iso: string, n: number): string => {
  const d = at(iso);
  d.setDate(d.getDate() + n);
  return localDateIso(d);
};

/**
 * Did this candidate get in front of a director?
 *
 * Three signals in the data answer this differently, and picking the wrong one
 * understates it by an order of magnitude — on today's board `interview3At`
 * (the round HELD) is set on **one** candidate while **sixteen** R3 rounds are
 * booked and never resulted. So all three are read:
 *
 *  • `interview3At` — the round was held and a result recorded;
 *  • the card sits at R3 or beyond — booked, not yet resulted;
 *  • a round-3 interview exists for them — covers somebody disqualified
 *    afterwards, whose stage no longer says how far they reached.
 *
 * ⚠ `STAGE_RANK.disqualified` is **10**, above R3's 8, so the rank alone would
 * count every dropped candidate as having met a director. It is excluded here
 * and caught by the interview row instead.
 */
export const reachedDirector = (c: Candidate, interviews: Interview[]): boolean =>
  c.interview3At != null ||
  (c.stage !== "disqualified" && STAGE_RANK[c.stage] >= STAGE_RANK.interview_3) ||
  interviews.some((i) => i.candidateId === c.id && i.round === 3);

/** Handed to the HOD. HR's shortlist IS the handover (there is no Share step). */
export const wasShortlisted = (c: Candidate): boolean => c.hrShortlistedAt != null;

export type TargetState = "not-set" | "not-started" | "running" | "met" | "missed";

export interface TargetProgress {
  /** False until somebody sets the numbers — a real state, not a failure. */
  hasTargets: boolean;

  /** CVs the hub had never seen before. Repeats are excluded, by decision. */
  newCvs: number;
  repeatCvs: number;
  cvTarget: number | null;
  cvMet: boolean | null;

  shortlisted: number;
  shortlistTarget: number;
  shortlistMet: boolean;

  director: number;
  directorTarget: number;
  directorMet: boolean;

  /** The day the job was POSTED — not the day it was approved. */
  startIso: string | null;
  /** The day the first offer was ACCEPTED. Null while the hunt is still running. */
  stopIso: string | null;
  dueIso: string | null;
  daysUsed: number | null;
  /** Negative once overdue. Null when there is no target or the clock has stopped. */
  daysLeft: number | null;
  closedInTime: boolean | null;
  clock: TargetState;
}

/**
 * @param candidates every candidate on THIS requisition
 * @param interviews every interview row (filtered per candidate inside)
 * @param onboardings every onboarding on this requisition — where an offer is
 *        ACCEPTED (`offerStatus`), which is not the same event as the offer
 *        being made (`finalizedAt` on the candidate)
 */
export function targetProgress(
  r: Requisition,
  candidates: Candidate[],
  interviews: Interview[],
  onboardings: Onboarding[],
  todayIso: string,
): TargetProgress {
  const newCvs = candidates.filter((c) => !c.isRepeat).length;
  const repeatCvs = candidates.length - newCvs;
  const shortlisted = candidates.filter(wasShortlisted).length;
  const director = candidates.filter((c) => reachedDirector(c, interviews)).length;

  // The clock starts when the job went out, not when it was approved: a posting
  // delay is not the hunt's. posted_on is the business date HR typed; posted_at
  // is the step's own stamp and only stands in when that is missing.
  const startIso = r.postedOn ?? (r.postedAt ? r.postedAt.slice(0, 10) : null);

  // …and it stops at the first ACCEPTED offer. The position itself closes later,
  // when the person joins; that is a different fact and not this clock.
  const accepted = onboardings
    .filter((o) => o.offerStatus === "accepted" && o.offerDecidedAt)
    .map((o) => o.offerDecidedAt!.slice(0, 10))
    .sort();
  const stopIso = accepted[0] ?? null;

  const days = r.targetCloseDays;
  const dueIso = days != null && startIso ? addDaysIso(startIso, days) : null;
  const daysUsed = startIso ? daysBetween(startIso, stopIso ?? todayIso) : null;
  const daysLeft = dueIso && !stopIso ? daysBetween(todayIso, dueIso) : null;
  const closedInTime = dueIso && stopIso ? stopIso <= dueIso : null;

  const clock: TargetState =
    days == null ? "not-set"
    : !startIso ? "not-started"
    : closedInTime === true ? "met"
    : closedInTime === false ? "missed"
    : daysLeft != null && daysLeft < 0 ? "missed"
    : "running";

  return {
    hasTargets: r.targetsSetAt != null,
    newCvs,
    repeatCvs,
    cvTarget: r.cvTarget,
    cvMet: r.cvTarget == null ? null : newCvs >= r.cvTarget,
    shortlisted,
    shortlistTarget: r.shortlistTarget,
    shortlistMet: shortlisted >= r.shortlistTarget,
    director,
    directorTarget: r.directorCvTarget,
    directorMet: director >= r.directorCvTarget,
    startIso,
    stopIso,
    dueIso,
    daysUsed,
    daysLeft,
    closedInTime,
    clock,
  };
}

/** "8 of 10" — and never "8 of —" when nobody set a number. */
export const outOf = (actual: number, target: number | null): string =>
  target == null ? String(actual) : `${actual} of ${target}`;

export const CLOCK_LABEL: Record<TargetState, string> = {
  "not-set": "No closure period set",
  "not-started": "Not posted yet",
  running: "Running",
  met: "Closed in time",
  missed: "Over the period",
};
