/**
 * The single source of truth for Office Supplies FMS queue membership and due dates.
 *
 * Pure: takes a snapshot, returns plain data, knows nothing about the signed-in user.
 * Both the per-step queue pages and the cross-FMS Control Center consume these, so
 * their counts cannot drift.
 *
 * Membership is STATUS-DRIVEN (the RPCs set `status`), so the conditional route is
 * native: a request that skips approvals is submitted straight into `pending_handover`
 * and simply never appears in an approval queue — no special-casing here.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { StepKey } from "./steps";
import type { SupplyRequest } from "../types";

export interface SupplySnapshot {
  requests: SupplyRequest[];
  stepSla: StepSlaMap;
}

/** THE ONE snapshot builder — the adapter and the store both go through it. */
export function supplySnapshotFrom(data: { requests: SupplyRequest[]; stepSla: StepSlaMap }): SupplySnapshot {
  return { requests: data.requests, stepSla: data.stepSla };
}

export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "request";
  departmentId: string;
  requestId: string;
}

/** Still someone's work — a held / closed / rejected / cancelled request leaves every queue. */
export const isOpenRequest = (r: SupplyRequest): boolean =>
  r.status === "pending_first_approval" ||
  r.status === "pending_second_approval" ||
  r.status === "pending_handover";

/** The single step a request currently owes, from its status. */
export function openStep(r: SupplyRequest): StepKey | null {
  switch (r.status) {
    case "pending_first_approval":
      return "first_approval";
    case "pending_second_approval":
      return "second_approval";
    case "pending_handover":
      return "handover";
    default:
      return null;
  }
}

/** When `step` completed for this request, or null. Reads the authoritative columns. */
export function requestStepCompletedIso(r: SupplyRequest, step: StepKey): string | null {
  switch (step) {
    case "request":
      return r.submittedAt;
    case "first_approval":
      return r.firstApprovedAt;
    case "second_approval":
      return r.secondApprovedAt;
    case "handover":
      return r.deliveredAt;
    default:
      return null;
  }
}

/**
 * A request's due date for one step = its anchor step's completion + N working days.
 *
 * The anchor fallback to `submittedAt` is what keeps the SKIP PATH from being born
 * overdue: for a direct-to-handover request `secondApprovedAt` (handover's anchor) is
 * null, so it falls back to submission + 1, not to a never-completed approval.
 */
export function supplyDueIso(snap: SupplySnapshot, r: SupplyRequest, step: StepKey): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = requestStepCompletedIso(r, sla.anchor) ?? r.submittedAt;
  return dueIsoFrom(from, sla);
}

/** Every open work-item, one per (current step, request). */
export function buildQueueEntries(snap: SupplySnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const r of snap.requests) {
    const step = openStep(r);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityType: "request",
      entityId: r.id,
      ref: r.reqNo,
      dueIso: supplyDueIso(snap, r, step),
      departmentId: r.departmentId,
      requestId: r.id,
    });
  }
  return out;
}
