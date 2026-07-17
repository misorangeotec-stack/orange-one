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

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

/**
 * One piece of work a user COMPLETED at a step — the counterpart to a queue
 * entry, which is work still owed.
 *
 * `departmentId` is resolved at BUILD time, not in the table's `groupBy.idOf`.
 * QueueTable calls `idOf` from inside its sort comparator, so a lookup there
 * would be O(n·m) once this list is a year deep. (This app groups by department,
 * not company — the request's own department is the owning unit.)
 *
 * Like every predicate in this file, this is owner-agnostic: it returns
 * everyone's entries and the caller filters to "mine" (via `useStageMode`).
 * The Control Center needs the unscoped set.
 */
export interface StageEntry<T> {
  /** The underlying row's id. Every step here is request-scope, so this is the request. */
  id: string;
  stepKey: StepKey;
  requestId: string;
  /** Human reference, for display and search. */
  ref: string;
  departmentId: string | null;
  /** Who completed the step. Null = unknown. */
  actorId: string | null;
  /** When the step completed. */
  atIso: string;
  /** When it was last corrected, if ever. */
  editedAtIso: string | null;
  editedById: string | null;
  /** Null when the entry may still be corrected; otherwise why it cannot be. */
  lockReason: string | null;
  /** The row itself, so the page can render its own columns without a second lookup. */
  row: T;
}

/**
 * Every rule below mirrors its `fms_supplies_<step>_editable()` counterpart in
 * the DB. The server is the gate; these exist so the UI can grey a button and
 * SAY WHY, and are written to the same shape so a drift is easy to spot.
 *
 * `on_hold` locks everything, and that is MECHANICAL rather than cautious:
 * `fms_supplies_resume_status` decides where a held request comes back to by
 * reading the very timestamps an edit touches, so editing under hold could move
 * where it resumes. Resume first, then edit.
 */
const heldOrTerminal = (r: SupplyRequest, what: string): string | null => {
  if (r.status === "on_hold") return `This request is on hold — take it off hold before editing its ${what}.`;
  if (r.status === "rejected" || r.status === "cancelled") return `This request was ${r.status} — its ${what} can no longer be changed.`;
  return null;
};

/** Editable while the request is approved and awaiting the SECOND approval. */
export function firstApprovalLockReason(r: SupplyRequest): string | null {
  const t = heldOrTerminal(r, "first approval");
  if (t) return t;
  if (r.status !== "pending_second_approval") return "The second approval has already been decided — the first can no longer be changed.";
  return null;
}

/** Editable while the request is approved here and the handover has not started. */
export function secondApprovalLockReason(r: SupplyRequest): string | null {
  const t = heldOrTerminal(r, "second approval");
  if (t) return t;
  if (r.handedOverAt || r.status === "delivered") return "The handover has already been recorded — this approval can no longer be changed.";
  if (r.status !== "pending_handover") return "This request is not awaiting handover — its second approval can no longer be changed.";
  return null;
}

/**
 * Handover is the LAST step, so nothing downstream can lock it — and a delivered
 * request's handover deliberately STAYS editable (an explicit product decision).
 *
 * That is safe here in a way it would not be in Purchase FMS: this app has no
 * stage machine (no refresh_* function — each RPC sets `status` inline), so a
 * late correction to a delivery date or remark has nothing derived hanging off it
 * to drift. Only held / rejected / cancelled lock it.
 */
export function handoverLockReason(r: SupplyRequest): string | null {
  return heldOrTerminal(r, "handover");
}

const entryOf = <T extends SupplyRequest>(stepKey: StepKey, r: T, actorId: string | null, atIso: string, lockReason: string | null): StageEntry<T> => ({
  id: r.id,
  stepKey,
  requestId: r.id,
  ref: r.reqNo,
  departmentId: r.departmentId,
  actorId,
  atIso,
  editedAtIso: r.editedAt,
  editedById: r.editedBy,
  lockReason,
  row: r,
});

/**
 * Decided first approvals.
 *
 * A REJECTION never stamps `firstApprovedAt` — the reject branch sets the
 * approver + `rejectedAt` + `rejectStage` and leaves the approved-at null. So a
 * filter on `firstApprovedAt !== null` alone would silently drop every
 * rejection, which is exactly what an approver most wants to look back at.
 * `rejectStage` is the discriminator, and it also keeps the SKIP PATH out for
 * free: a `requires_approval = false` request has neither field set.
 */
export const completedFirstApprovalEntries = (data: SupplySnapshot): StageEntry<SupplyRequest>[] =>
  data.requests
    .filter((r) => !!r.firstApprovedAt || r.rejectStage === "first_approval")
    .map((r) => entryOf("first_approval", r, r.firstApproverId, r.firstApprovedAt ?? r.rejectedAt ?? r.submittedAt, firstApprovalLockReason(r)));

export const completedSecondApprovalEntries = (data: SupplySnapshot): StageEntry<SupplyRequest>[] =>
  data.requests
    .filter((r) => !!r.secondApprovedAt || r.rejectStage === "second_approval")
    .map((r) => entryOf("second_approval", r, r.secondApproverId, r.secondApprovedAt ?? r.rejectedAt ?? r.submittedAt, secondApprovalLockReason(r)));

/** Recorded handovers — delivered or still open at handover; both are "done here". */
export const completedHandoverEntries = (data: SupplySnapshot): StageEntry<SupplyRequest>[] =>
  data.requests
    .filter((r) => !!r.handedOverAt)
    .map((r) => entryOf("handover", r, r.handoverBy, r.handedOverAt!, handoverLockReason(r)));

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
