import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { StepKey } from "./steps";
import type { Effectiveness, QueueEntry, TrainingRequest, TrainingSession } from "../types";

/** What the closure rules need to see beyond the request itself. */
export interface CloseContext {
  sessions: TrainingSession[];
  effectiveness: Effectiveness[];
}

/**
 * Where a training request is RIGHT NOW, and when that step falls due.
 *
 * Pure functions over plain data, so the queues, the dashboard and (later) the
 * cross-FMS scoreboard all agree without any of them re-deriving the rules.
 *
 * ⚠ ONE REQUEST SITS AT EXACTLY ONE STEP. Unlike Purchase — where a PO can have
 *   several lines at different stages — a training request is one thing moving
 *   through one chain, so its step is a function of its status and nothing else.
 *   That is what makes `stepOf` total and testable.
 */

/** The step a request is waiting at, or null when nobody owes anything. */
export function stepOf(r: TrainingRequest): StepKey | null {
  switch (r.status) {
    case "draft":
      return null; // Nobody owes anything on a draft but its author.
    case "submitted":
      return "need_validation";
    /*
     * ⚠ `under_validation` MEANS "HR HAS VALIDATED IT", not "HR is about to".
     *   The RPC sets this status on a SUCCESSFUL validation, stamping
     *   `validated_at` at the same time — the name is a leftover and it is a
     *   CHECK-constrained value already stored on live rows, so it stays.
     *
     *   Reading it as still-at-validation left every validated request parked on
     *   the validation queue and the Proposal queue permanently empty. Caught on
     *   22-09-2026 by walking the flow in a browser; it is invisible from the
     *   request page, which offers the next panel either way.
     *
     *   `validated_at` is the honest signal, so that is what decides.
     */
    case "under_validation":
      return r.validatedAt ? "proposal" : "need_validation";
    case "returned":
      return "need_resubmit";
    case "proposed":
      return "hr_head_approval";
    case "hr_approved":
      // Only reachable when mgmt_required was frozen true at proposal time.
      return "mgmt_approval";
    case "approved":
      return "trainer_finalization";
    case "trainer_finalised":
      return "session_scheduling";
    // Everything below has left the request chain: the work is on the session
    // now (LD-3 … LD-8), or the request is finished.
    case "scheduled":
    case "closed":
    case "rejected":
    case "cancelled":
      return null;
    default:
      return null;
  }
}

/**
 * The timestamp a step's clock counts from.
 *
 * ⚠ `need_validation` ANCHORS ON `submittedAt`, NOT `createdAt`. A request can sit
 *   in draft for a week; HR's two days start when it is actually submitted, and
 *   anchoring on creation would make a long-drafted request arrive overdue
 *   through no fault of the validator.
 *
 * ⚠ `need_resubmit` ANCHORS ON `returnedAt` — its own event. Anchoring it on the
 *   original submission dates a freshly returned request from the day it was
 *   first raised, i.e. born overdue. See TRIGGER_STEPS in lib/sla.ts.
 */
export function stepCompletedIso(r: TrainingRequest, step: StepKey): string | null {
  switch (step) {
    case "need_raised":
      return r.submittedAt;
    case "need_resubmit":
      return r.returnedAt;
    case "need_validation":
      return r.validatedAt;
    case "proposal":
      return r.proposedAt;
    case "hr_head_approval":
      return r.hrApprovedAt;
    case "mgmt_approval":
      return r.mgmtApprovedAt;
    case "trainer_finalization":
      return r.trainerConfirmedAt;
    default:
      return null;
  }
}

/**
 * When the step a request is sitting at falls due.
 *
 * ⚠ A MISSING ANCHOR FALLS BACK TO SUBMISSION rather than returning null.
 *   `mgmt_approval` is conditional, so a request that skipped it has a null
 *   `hrApprovedAt`-to-`mgmtApprovedAt` chain for every later step. Without the
 *   fallback those steps would be untimed — which reads as "deliberately
 *   untimed, can never be late", the exact opposite of the truth.
 */
export function dueIsoFor(r: TrainingRequest, sla: StepSlaMap): string | null {
  const step = stepOf(r);
  if (!step) return null;
  const rule = sla[step];
  if (!rule) return null;
  const anchorIso = stepCompletedIso(r, rule.anchor as StepKey) ?? r.submittedAt;
  return dueIsoFrom(anchorIso, rule);
}

/** Is this request still moving? */
export const isOpen = (r: TrainingRequest): boolean =>
  !["closed", "rejected", "cancelled"].includes(r.status);

/** One open work-item per request that is waiting on somebody. */
export function buildQueueEntries(requests: TrainingRequest[], sla: StepSlaMap): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const r of requests) {
    const step = stepOf(r);
    if (!step || !isOpen(r)) continue;
    out.push({
      stepKey: step,
      entityId: r.id,
      ref: r.code ?? "Draft",
      dueIso: dueIsoFor(r, sla),
      title: r.title,
      departmentId: r.departmentId,
      priority: r.priority,
      requestedBy: r.requestedBy,
    });
  }
  return out;
}

/**
 * The steps a request has ALREADY cleared, for the detail rail.
 *
 * Returns the conditional Management gate only when this request actually needed
 * it — a request that skipped it should show seven steps, not eight with one
 * mysteriously blank. `mgmtRequired` is the frozen field, never the live rule.
 */
export function railStepsFor(r: TrainingRequest): StepKey[] {
  const rail: StepKey[] = ["need_raised", "need_validation", "proposal", "hr_head_approval"];
  if (r.mgmtRequired) rail.push("mgmt_approval");
  rail.push("trainer_finalization", "session_scheduling");
  return rail;
}
