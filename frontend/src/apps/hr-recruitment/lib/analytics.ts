/**
 * The HR Recruitment reporting model — every number the dashboard shows, computed
 * here as pure functions over a data snapshot.
 *
 * Two rules run through all of it, and they are the difference between a report and
 * a rumour:
 *
 * 1. **Every metric reads an authoritative timestamp column on a domain row** —
 *    `submitted_at`, `hr_shortlisted_at`, `interview1_at`, `finalized_at`,
 *    `onboardings.completed_at`, `probations.final_status_at`. NEVER the activity
 *    trail: `announce` swallows its own failures (see the header of
 *    20260708120900_add_fms_purchase_step_timestamps.sql), so the trail is a
 *    decoration, not a source. A missing activity row would silently delete a hire
 *    from these numbers.
 *
 * 2. **Every metric carries its denominator.** An average over two hires is noise,
 *    and a reader cannot tell that from the number alone — so `n` travels with the
 *    average and the screen prints it. Same reason offer-acceptance excludes offers
 *    that are still pending: a decision nobody has taken yet is not a refusal.
 *
 * Nothing here knows about React, the signed-in user or RLS. A user only ever
 * receives rows RLS lets them read, so these aggregates scope themselves: a hiring
 * manager sees their own vacancies' figures, HR sees everything.
 */
import { bucketOf, todayLocalIso } from "@/shared/lib/dueBuckets";
import { seatsJoined, seatsTaken, isOpenRequisition, type QueueEntry } from "./queues";
import { STEPS, type StepKey } from "./steps";
import type { Candidate, JobPlatform, Onboarding, Probation, Requisition } from "../types";

/* -------------------------------------------------------------------------- */
/*  Date helpers — local midnight, never UTC (see shared/lib/dueBuckets).       */
/* -------------------------------------------------------------------------- */

/** A timestamptz or yyyy-mm-dd → local midnight, so day arithmetic is honest. */
function localMidnight(input: string | null): Date | null {
  if (!input) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days between two dates. Null if either is unusable. */
function daysBetween(from: string | null, to: string | null): number | null {
  const a = localMidnight(from);
  const b = localMidnight(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/* -------------------------------------------------------------------------- */
/*  1 · Open requisitions and unfilled seats                                    */
/* -------------------------------------------------------------------------- */

export interface SeatSummary {
  /** Vacancies still being worked (excludes closed, cancelled, rejected, on-hold). */
  openRequisitions: number;
  onHold: number;
  /** Headcount those open vacancies asked for. */
  seatsRequired: number;
  /** Seats where the person has actually JOINED. A promise is not a hire. */
  seatsFilled: number;
  /** Offered and not yet joined — the seat is spoken for but empty. */
  seatsOffered: number;
  /** Required minus filled: the real hole in the org chart. */
  seatsUnfilled: number;
  /** Nobody is even lined up for these — HR still has to source them. */
  seatsToSource: number;
}

export function seatSummary(
  requisitions: Requisition[],
  candidates: Candidate[],
  onboardings: Onboarding[],
): SeatSummary {
  const open = requisitions.filter(isOpenRequisition);
  let seatsRequired = 0;
  let seatsFilled = 0;
  let seatsTakenTotal = 0;

  for (const r of open) {
    seatsRequired += r.positionsRequired;
    seatsFilled += seatsJoined(r.id, onboardings);
    seatsTakenTotal += seatsTaken(r.id, candidates, onboardings);
  }

  return {
    openRequisitions: open.length,
    onHold: requisitions.filter((r) => r.status === "on_hold").length,
    seatsRequired,
    seatsFilled,
    seatsOffered: Math.max(0, seatsTakenTotal - seatsFilled),
    seatsUnfilled: Math.max(0, seatsRequired - seatsFilled),
    seatsToSource: Math.max(0, seatsRequired - seatsTakenTotal),
  };
}

/* -------------------------------------------------------------------------- */
/*  2 · What is overdue right now — by step, and by owner                       */
/* -------------------------------------------------------------------------- */

export interface OverdueByStep {
  stepKey: StepKey;
  label: string;
  overdue: number;
  dueToday: number;
  total: number;
}

export interface OverdueByOwner {
  ownerId: string | null; // null = nobody owns it
  overdue: number;
  dueToday: number;
  total: number;
}

/**
 * Roll the queue up by step and by owner.
 *
 * `entries` MUST be `buildQueueEntries(...)` output — the same list the queue pages
 * and the cross-FMS scoreboard count. Computing "what's late" a second, independent
 * way is exactly how a dashboard starts lying about the queue it links to.
 *
 * `ownerIdsOf` is injected because ownership is not a property of the entry: a HOD
 * step belongs to the requisition's own hiring manager, everything else to the global
 * step-owner table. The caller (which has the store) resolves it.
 */
export function overdueRollup(
  entries: QueueEntry[],
  ownerIdsOf: (e: QueueEntry) => string[],
  today: string = todayLocalIso(),
): { byStep: OverdueByStep[]; byOwner: OverdueByOwner[]; totalOverdue: number; totalDueToday: number } {
  const steps = new Map<StepKey, OverdueByStep>();
  const owners = new Map<string | null, OverdueByOwner>();
  let totalOverdue = 0;
  let totalDueToday = 0;

  const touchOwner = (id: string | null) => {
    let rec = owners.get(id);
    if (!rec) {
      rec = { ownerId: id, overdue: 0, dueToday: 0, total: 0 };
      owners.set(id, rec);
    }
    return rec;
  };

  for (const e of entries) {
    const bucket = bucketOf(e.dueIso, today);
    const isOverdue = bucket === "delayed";
    const isToday = bucket === "today";
    if (isOverdue) totalOverdue++;
    if (isToday) totalDueToday++;

    const def = STEPS.find((s) => s.key === e.stepKey);
    let step = steps.get(e.stepKey);
    if (!step) {
      step = { stepKey: e.stepKey, label: def?.short ?? e.stepKey, overdue: 0, dueToday: 0, total: 0 };
      steps.set(e.stepKey, step);
    }
    step.total++;
    if (isOverdue) step.overdue++;
    if (isToday) step.dueToday++;

    const ids = ownerIdsOf(e);
    // Unowned work is the point of this table, not an edge case: a step with no owner
    // is work nobody has been told about, and it must show up as such.
    for (const id of ids.length ? ids : [null]) {
      const rec = touchOwner(id);
      rec.total++;
      if (isOverdue) rec.overdue++;
      if (isToday) rec.dueToday++;
    }
  }

  return {
    byStep: [...steps.values()].sort(
      (a, b) => (STEPS.find((s) => s.key === a.stepKey)?.index ?? 0) - (STEPS.find((s) => s.key === b.stepKey)?.index ?? 0),
    ),
    byOwner: [...owners.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total),
    totalOverdue,
    totalDueToday,
  };
}

/* -------------------------------------------------------------------------- */
/*  3 · Time to hire — MRF submitted → the person actually joined               */
/* -------------------------------------------------------------------------- */

export interface TimeToHire {
  /** Mean calendar days from MRF submission to the joining date. */
  avgDays: number;
  medianDays: number;
  /** THE denominator. An average over two hires is noise; the screen must say so. */
  hires: number;
  fastestDays: number | null;
  slowestDays: number | null;
}

export interface TimeToHireByDept extends TimeToHire {
  departmentId: string;
}

/**
 * One hire's elapsed time, or null if it isn't a hire.
 *
 * Counts ONLY people who actually joined — accepted the offer AND completed
 * onboarding. A finalized candidate is a promise; `completed_at` is the fact, which
 * is precisely why the requisition auto-closes on joining rather than on finalizing.
 * Including offers-in-flight here would quietly flatter the number.
 *
 * The clock stops on the JOINING DATE (the day they walked in), not on `completed_at`
 * (the day HR finished ticking the checklist) — HR admin lag is not time-to-hire.
 */
function hireDays(o: Onboarding, reqById: Map<string, Requisition>): number | null {
  if (o.offerStatus !== "accepted" || !o.completedAt || !o.joiningDate) return null;
  const r = reqById.get(o.requisitionId);
  if (!r) return null;
  const days = daysBetween(r.submittedAt, o.joiningDate);
  // A joining date before the MRF was raised is a data error, not a zero-day hire.
  return days !== null && days >= 0 ? days : null;
}

function summarise(days: number[]): TimeToHire {
  if (!days.length) return { avgDays: 0, medianDays: 0, hires: 0, fastestDays: null, slowestDays: null };
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    avgDays: Math.round(avg(sorted)),
    medianDays:
      sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid],
    hires: sorted.length,
    fastestDays: sorted[0],
    slowestDays: sorted[sorted.length - 1],
  };
}

export function timeToHire(
  requisitions: Requisition[],
  onboardings: Onboarding[],
): { overall: TimeToHire; byDepartment: TimeToHireByDept[] } {
  const reqById = new Map(requisitions.map((r) => [r.id, r]));
  const all: number[] = [];
  const byDept = new Map<string, number[]>();

  for (const o of onboardings) {
    const days = hireDays(o, reqById);
    if (days === null) continue;
    all.push(days);
    const dept = reqById.get(o.requisitionId)!.departmentId;
    const list = byDept.get(dept) ?? [];
    list.push(days);
    byDept.set(dept, list);
  }

  return {
    overall: summarise(all),
    byDepartment: [...byDept.entries()]
      .map(([departmentId, days]) => ({ departmentId, ...summarise(days) }))
      .sort((a, b) => b.avgDays - a.avgDays),
  };
}

/* -------------------------------------------------------------------------- */
/*  4 · Where the pipeline leaks                                                */
/* -------------------------------------------------------------------------- */

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** % of the stage before it. The drop is the leak. */
  fromPrevious: number | null;
  /** % of the CVs that came in. */
  fromTop: number | null;
}

/**
 * The six stages of the prompt's funnel, counted as "ever reached this point".
 *
 * That is the whole trick: a candidate rejected at Round 2 still counts in
 * "Shortlisted by HR" and "Interviewed", because they DID pass through. Counting
 * where cards are sitting *today* would show an empty pipeline and call it a leak.
 * So every stage reads its own authoritative timestamp column, which is stamped once
 * and never cleared by a later rejection.
 *
 * "Interviewed" means a round was actually HELD (`interviewN_at`), not merely
 * booked — collapsing those two is exactly where the sheet's SLA slippage hid.
 */
export function pipelineFunnel(candidates: Candidate[]): FunnelStage[] {
  const cvs = candidates.length;
  const shortlisted = candidates.filter((c) => !!c.hrShortlistedAt).length;
  const shared = candidates.filter((c) => !!c.sharedToHodAt).length;
  // "Screened/interviewed" = any screen or round actually held. Telephonic counts too,
  // and because rounds are now optional a candidate can reach Selected without an
  // interview — so this stage may hold FEWER than the one after it (that is real, not a bug).
  const interviewed = candidates.filter(
    (c) => !!c.telephonicAt || !!c.interview1At || !!c.interview2At || !!c.interview3At,
  ).length;
  const finalized = candidates.filter((c) => !!c.finalizedAt).length;
  const joined = candidates.filter((c) => !!c.joinedAt).length;

  const raw: Array<{ key: string; label: string; count: number }> = [
    { key: "cvs", label: "CVs received", count: cvs },
    { key: "hr_shortlist", label: "Shortlisted by HR", count: shortlisted },
    { key: "hod_share", label: "Shared with HOD", count: shared },
    { key: "interviewed", label: "Interviewed", count: interviewed },
    { key: "finalized", label: "Selected", count: finalized },
    { key: "joined", label: "Actually joined", count: joined },
  ];

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

  return raw.map((s, i) => ({
    ...s,
    fromPrevious: i === 0 ? null : pct(s.count, raw[i - 1].count),
    fromTop: i === 0 ? null : pct(s.count, cvs),
  }));
}

/* -------------------------------------------------------------------------- */
/*  5 · Which platform actually works                                           */
/* -------------------------------------------------------------------------- */

export interface PlatformRow {
  platformId: string | null; // null = the CV's source was never recorded
  name: string;
  cvs: number;
  interviewed: number;
  hires: number;
  /** Hires ÷ CVs. The one number HR cannot answer today. */
  hireRate: number | null;
}

/**
 * Hires per posting platform.
 *
 * Read from the CANDIDATE's `source_platform_id` — where that person's CV came from
 * — not from `fms_hr_requisition_platforms`, which records where the advert was
 * placed. Advertising on five platforms and hiring from one is precisely the fact
 * this report exists to expose, and only the candidate's own field can tell them
 * apart.
 *
 * If HR never tags the source, this lands in "Not recorded" — and it says so on
 * screen rather than quietly attributing the hire to nobody. A metric that hides its
 * own missing data is worse than no metric.
 */
export function platformEffectiveness(candidates: Candidate[], platforms: JobPlatform[]): PlatformRow[] {
  const nameById = new Map(platforms.map((p) => [p.id, p.name]));
  const rows = new Map<string | null, PlatformRow>();

  const touch = (id: string | null): PlatformRow => {
    let rec = rows.get(id);
    if (!rec) {
      rec = {
        platformId: id,
        name: id ? (nameById.get(id) ?? "Unknown platform") : "Not recorded",
        cvs: 0,
        interviewed: 0,
        hires: 0,
        hireRate: null,
      };
      rows.set(id, rec);
    }
    return rec;
  };

  for (const c of candidates) {
    const rec = touch(c.sourcePlatformId);
    rec.cvs++;
    if (c.telephonicAt || c.interview1At || c.interview2At || c.interview3At) rec.interviewed++;
    if (c.joinedAt) rec.hires++;
  }

  for (const rec of rows.values()) {
    rec.hireRate = rec.cvs > 0 ? Math.round((rec.hires / rec.cvs) * 1000) / 10 : null;
  }

  return [...rows.values()].sort((a, b) => b.hires - a.hires || b.cvs - a.cvs);
}

/* -------------------------------------------------------------------------- */
/*  6 · Offer-acceptance rate                                                   */
/* -------------------------------------------------------------------------- */

export interface OfferAcceptance {
  /** Offers with an answer. THE denominator — pending offers are excluded. */
  decided: number;
  accepted: number;
  declined: number;
  noShow: number;
  /** Still waiting on the candidate. NOT counted as a refusal. */
  pending: number;
  /** Of the accepted, how many have finished onboarding and are actually in. */
  joined: number;
  /** accepted ÷ decided, or null when nobody has answered yet. */
  rate: number | null;
}

/**
 * Of the people we finalized, how many took the job?
 *
 * `pending` is deliberately outside the denominator. An offer nobody has answered
 * yet is not a rejection, and folding it in would show a fresh, healthy pipeline as
 * a collapsing acceptance rate — the classic way this metric gets misread.
 */
export function offerAcceptance(onboardings: Onboarding[]): OfferAcceptance {
  const accepted = onboardings.filter((o) => o.offerStatus === "accepted").length;
  const declined = onboardings.filter((o) => o.offerStatus === "declined").length;
  const noShow = onboardings.filter((o) => o.offerStatus === "no_show").length;
  const pending = onboardings.filter((o) => o.offerStatus === "pending").length;
  const joined = onboardings.filter((o) => o.offerStatus === "accepted" && !!o.completedAt).length;
  const decided = accepted + declined + noShow;

  return {
    decided,
    accepted,
    declined,
    noShow,
    pending,
    joined,
    rate: decided > 0 ? Math.round((accepted / decided) * 1000) / 10 : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  7 · Probation outcomes                                                      */
/* -------------------------------------------------------------------------- */

export interface ProbationOutcomes {
  total: number;
  /** Disjoint, and they add up to `total`. */
  confirmed: number;
  rejected: number;
  inExtension: number;
  inProgress: number;
  /** How many of the DECIDED ones needed an extra month first. */
  everExtended: number;
  decided: number;
}

/**
 * Confirmed / extended / rejected.
 *
 * The four states are disjoint and exhaustive, because "extended" is not really an
 * outcome — it is a state a person is in until the month-4 review lands. Someone who
 * was extended and then confirmed is a CONFIRMATION (with `everExtended` recording
 * the detour); counting them in both columns would make the totals exceed the number
 * of people, which is how a chart loses a reader's trust in one glance.
 */
export function probationOutcomes(probations: Probation[]): ProbationOutcomes {
  const confirmed = probations.filter((p) => p.finalStatus === "approved").length;
  const rejected = probations.filter((p) => p.finalStatus === "rejected").length;
  const inExtension = probations.filter((p) => !p.finalStatus && p.outcome === "extended").length;
  const inProgress = probations.filter((p) => !p.finalStatus && !p.outcome).length;
  const everExtended = probations.filter((p) => !!p.finalStatus && p.outcome === "extended").length;

  return {
    total: probations.length,
    confirmed,
    rejected,
    inExtension,
    inProgress,
    everExtended,
    decided: confirmed + rejected,
  };
}

/* -------------------------------------------------------------------------- */
/*  Scope helper                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The candidates the funnel and the platform report are computed over: everything
 * uploaded inside the reporting window.
 *
 * The fetch layer also loads two other slices — CVs on still-open vacancies, and
 * every finalized candidate ever (see data/hrFetch.ts) — which exist so boards and
 * names resolve, NOT so they can be counted. Mixing them in would give a funnel whose
 * bottom (all-time hires) is wider than its top (windowed CVs): an impossible shape,
 * and a plainly wrong conversion rate. So the aggregates use exactly the one slice
 * that is guaranteed complete.
 */
export function candidatesInWindow(candidates: Candidate[], windowStartIso: string): Candidate[] {
  return candidates.filter((c) => c.uploadedAt.slice(0, 10) >= windowStartIso);
}
