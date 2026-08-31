import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom } from "@/shared/lib/stepSla";
import { addWorkingDaysSigned, localDateIso } from "@/shared/lib/workingDays";
import type { StepKey } from "./steps";
import { TRIGGER_STEPS, type StepSlaMap } from "./sla";
import { STATUS_STEP, type Trip } from "../types";

/**
 * Queue membership and due dates for Travel Desk.
 *
 * PURE. No react, no supabase, no clock beyond the one passed in. The store, the
 * eight queue screens, the Control Center, the dashboard and the cross-FMS
 * scoreboard all read `buildQueueEntries`, which is the only reason those five
 * can never disagree about how much work is outstanding.
 *
 * ⚠ MEMBERSHIP READS `status`, NEVER `currentStep`. `currentStep` is a
 *   convenience column the RPCs also maintain; the status CHECK is what the
 *   database actually enforces. Reading the softer of the two is how a queue
 *   ends up holding a row the workflow has already moved on.
 */

/** Every step that can hold a work-item — i.e. all of them except `request`. */
export type QueueStep = Exclude<StepKey, "request">;

export interface QueueEntry extends QueueEntryBase<QueueStep> {
  tripId: string;
  travellerId: string | null;
  travellerName: string;
  departmentId: string | null;
  destinationCityId: string | null;
  departureIso: string | null;
  status: Trip["status"];
  /** The trip's own approvers — the manager steps route to these. */
  approverManagerIds: string[];
}

/**
 * WHEN each step's clock starts.
 *
 * ⚠ THIS MAP, NOT THE STORED `anchor`, IS WHAT PICKS THE TIMESTAMP.
 *   The stored SLA row still supplies `days` and the label an admin reads, but
 *   three of these steps cannot be expressed as "the moment step X completed":
 *
 *     booking   — the LAST APPROVAL THAT ACTUALLY HAPPENED. A band-7 trip is
 *                 measured from the Director's decision; a band-3 trip skipped
 *                 that step entirely and is measured from the manager's. Reading
 *                 a fixed anchor would date half the queue from a step that
 *                 never ran.
 *     claim     — the trip's RETURN DATE. The journey ending is what starts the
 *                 clock, and the journey is not a step (see steps.ts).
 *     advance   — the PLANNED DEPARTURE date, counted BACKWARDS (see below).
 *
 *   Order to Dispatch and asset-maintenance both do exactly this; the latter's
 *   `service_done: (j) => j.dueDate` is the same manoeuvre as `claim` here.
 */
const ANCHOR_AT: Record<QueueStep, (t: Trip) => string | null> = {
  manager_approval: (t) => t.submittedAt,
  director_approval: (t) => t.maAt,
  // Counted backwards from departure — see tripDueIso().
  advance: (t) => t.plannedDepartureDate,
  // ⚠ The fall-through IS the skip handling: `daAt` is null when the Director
  //   step was skipped, so a band-3 trip measures from the manager's approval.
  booking: (t) => t.daAt ?? t.maAt ?? t.submittedAt,
  // Actual if the trip has been closed out, else what was planned. A trip whose
  // return date is still in the future gets a FUTURE due date, which is correct
  // and is what makes "upcoming travel" fall out of the same list.
  claim: (t) => t.actualReturnDate ?? t.plannedReturnDate,
  claim_review: (t) => t.clAt,
  finance_review: (t) => t.crAt,
  // §12 measures the credit from HOD APPROVAL, not from Finance's verification.
  settlement: (t) => t.crAt,
};

/**
 * WHEN each step completed, and by WHOM.
 *
 * ⚠ `stepCompletedIso` AND `stepActorId` ARE EDITED TOGETHER. They answer the
 *   same question about the same row — when, and who — and a step added to one
 *   and forgotten in the other is a step the stepper dates without naming.
 *
 * ⚠ `request` RESOLVES TO `submittedAt` / `raisedBy`. It is the only step whose
 *   actor is not stamped by a decision RPC, because filing the request IS
 *   raising the trip.
 */
export function stepCompletedIso(t: Trip, step: StepKey): string | null {
  switch (step) {
    case "request":            return t.submittedAt;
    case "manager_approval":   return t.maAt;
    case "director_approval":  return t.daAt;
    case "advance":            return t.advAt;
    case "booking":            return t.bkAt;
    case "claim":              return t.clAt;
    case "claim_review":       return t.crAt;
    case "finance_review":     return t.frAt;
    case "settlement":         return t.stAt;
    default:                   return null;
  }
}

/**
 * WHO actually did each step — the counterpart to `stepCompletedIso`.
 *
 * ⚠ THIS IS THE ACTOR, NOT THE OWNER, and the difference matters on a
 *   reimbursement. Settings names who is *supposed* to verify a claim; this says
 *   who did. A coordinator or an admin can act on any step, so the two routinely
 *   differ, and after the fact only one of them is a fact.
 */
export function stepActorId(t: Trip, step: StepKey): string | null {
  switch (step) {
    case "request":            return t.raisedBy;
    case "manager_approval":   return t.maBy;
    case "director_approval":  return t.daBy;
    case "advance":            return t.advBy;
    case "booking":            return t.bkBy;
    case "claim":              return t.clBy;
    case "claim_review":       return t.crBy;
    case "finance_review":     return t.frBy;
    case "settlement":         return t.stBy;
    default:                   return null;
  }
}

/** A step is done when it has a completion stamp, or when it was skipped. */
export function stepDone(t: Trip, step: StepKey): boolean {
  if (step === "manager_approval" && t.managerApprovalSkipped) return true;
  if (step === "director_approval" && t.directorApprovalSkipped) return true;
  if (step === "advance" && t.advanceSkipped) return true;
  return stepCompletedIso(t, step) !== null;
}

/** Steps this trip will never visit, so the rail can grey them rather than tick them. */
export function skippedSteps(t: Trip): StepKey[] {
  const out: StepKey[] = [];
  if (t.managerApprovalSkipped) out.push("manager_approval");
  if (t.directorApprovalSkipped) out.push("director_approval");
  if (t.advanceSkipped) out.push("advance");
  return out;
}

/**
 * When one trip's step falls due, or null if it cannot be known.
 *
 * ⚠ EVERY TRIGGER_STEPS ENTRY HAS ITS OWN BRANCH HERE. One that fell through to
 *   the generic path would be BORN OVERDUE — see the warning in sla.ts.
 *
 * The fallback to `createdAt` matters for the same reason it does in every other
 * FMS: a step whose anchor never completed — because the trip reached here down
 * a path that skipped it — must not be born with no due date at all, and must
 * not be born overdue either.
 */
export function tripDueIso(t: Trip, step: QueueStep, stepSla: StepSlaMap | null | undefined): string | null {
  const sla = stepSla?.[step];
  if (!sla) return null;

  const from = ANCHOR_AT[step](t);
  const trigger = TRIGGER_STEPS[step];

  if (trigger) {
    // The event has not been recorded yet, so nothing can be late.
    if (!from) return null;
    const at = new Date(from);
    if (Number.isNaN(at.getTime())) return null;
    // Direction lives here, magnitude in config — see the trap note in sla.ts.
    const offset = trigger.before ? -Math.abs(sla.days) : Math.abs(sla.days);
    return localDateIso(addWorkingDaysSigned(at, offset));
  }

  return dueIsoFrom(from ?? t.createdAt, sla);
}

/**
 * Every open work-item, one per trip waiting at a queue step.
 *
 * ⚠ WHAT THIS DOES NOT INCLUDE, and why each exclusion is deliberate:
 *
 *   DRAFTS      — a draft owes nobody and is private to its author. Counting one
 *                 would report somebody's unfinished thinking as work the
 *                 business is waiting on.
 *   ON HOLD     — the trip is still open and still shows on the Control Center's
 *                 Parked strip, but nobody owes an action today, so it is not a
 *                 queue row and must not colour anyone's KPI red.
 *   RETURNED    — sent back for clarification: the ball is with the traveller,
 *                 who sees it under My Trips, not in an approver's queue.
 *   CLOSED /
 *   CANCELLED /
 *   REJECTED    — over.
 *
 *   All five fall out for free: STATUS_STEP simply does not answer for them.
 */
export function buildQueueEntries(trips: Trip[], stepSla: StepSlaMap | null | undefined): QueueEntry[] {
  const out: QueueEntry[] = [];

  for (const t of trips) {
    const step = STATUS_STEP[t.status] as QueueStep | undefined;
    if (!step) continue;

    out.push({
      stepKey: step,
      entityId: t.id,
      ref: t.tripNo ?? t.travellerName,
      dueIso: tripDueIso(t, step, stepSla),
      tripId: t.id,
      travellerId: t.travellerId,
      travellerName: t.travellerName,
      departmentId: t.snapDepartmentId,
      destinationCityId: t.destinationCityId,
      departureIso: t.plannedDepartureDate,
      status: t.status,
      approverManagerIds: t.approverManagerIds,
    });
  }

  return out;
}

/**
 * Trips that are open but owe nobody an action today — the Control Center's
 * "Parked" strip. Held trips only: a returned trip owes its own author, who is
 * shown it under My Trips.
 */
export function parkedTrips(trips: Trip[]): Trip[] {
  return trips.filter((t) => t.status === "on_hold");
}

/** Booked trips that have not left yet — the PRD's "Upcoming Travel". */
export function upcomingTrips(trips: Trip[], todayIso: string): Trip[] {
  return trips
    .filter((t) => t.status === "booked" && !!t.plannedDepartureDate && t.plannedDepartureDate >= todayIso)
    .sort((a, b) => (a.plannedDepartureDate ?? "").localeCompare(b.plannedDepartureDate ?? ""));
}
