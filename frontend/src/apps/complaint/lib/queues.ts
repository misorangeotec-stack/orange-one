/**
 * The single source of truth for Complaint FMS queue membership and due dates.
 *
 * Pure: takes a snapshot, returns plain data, knows nothing about the signed-in
 * user. The per-step queue pages, the Dashboard and the cross-FMS Control Center
 * all consume these, so their counts cannot drift.
 *
 * Membership is STATUS-DRIVEN (the RPCs set `status`), so `openStep` is a lookup
 * with no special cases — and a rejected, held, closed or cancelled complaint
 * leaves every queue by construction rather than by a filter someone has to
 * remember to write.
 *
 * ⚠ RM vs FG IS NOT A BRANCH. Both run the same steps; only the raise
 *   panel's labels differ (lib/format.ts). There is deliberately no
 *   `requestBranch` here — `complaintType` is an ordinary column that the grids
 *   sort and filter on like any other.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, type StepSlaMap } from "./sla";
import type { StepKey } from "./steps";
import type { ComplaintRequest } from "../types";

export interface ComplaintSnapshot {
  requests: ComplaintRequest[];
  stepSla: StepSlaMap;
}

/** THE ONE snapshot builder — the store and the Control Center adapter both go through it. */
export function complaintSnapshotFrom(data: {
  requests: ComplaintRequest[];
  stepSla: StepSlaMap;
}): ComplaintSnapshot {
  return { requests: data.requests, stepSla: data.stepSla };
}

export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "request";
  requestId: string;
}

/** Still someone's work — a held / rejected / closed / cancelled complaint leaves every queue. */
export const isOpenRequest = (r: ComplaintRequest): boolean => openStep(r) !== null;

/**
 * The single step a complaint currently owes, from its status.
 *
 * `closed`, `rejected`, `on_hold` and `cancelled` all fall to `default: null` —
 * they are statuses, never step keys, and a status loose in a queue is work owed
 * by nobody.
 */
export function openStep(r: ComplaintRequest): StepKey | null {
  switch (r.status) {
    case "awaiting_plant":
      return "plant";
    // BOTH service statuses map to the ONE service step — it is the same bucket
    // entered twice, so both passes belong in one queue. See lib/steps.ts.
    case "awaiting_service":
    case "awaiting_service_close":
      return "service";
    case "awaiting_approval":
      return "approval";
    case "awaiting_management_review":
      return "management_review";
    default:
      return null;
  }
}

/**
 * Which PASS of the service step this complaint is on.
 *
 * The queue shows both, and the modal has to ask different questions: the first
 * pass takes the requisition and the commercial call, the second only the closing
 * remarks after management has ruled.
 */
export const servicePass = (r: ComplaintRequest): "first" | "close" | null =>
  r.status === "awaiting_service" ? "first"
  : r.status === "awaiting_service_close" ? "close"
  : null;

/**
 * The anchor completion timestamp that starts a step's SLA clock.
 *
 * Linear, so each step anchors on the one before it and `acknowledge` anchors on
 * the raise itself. `complaintDueIso` falls back to `submittedAt` when an anchor
 * never ran, so no step is ever born overdue.
 */
function stepAnchorCompletedIso(r: ComplaintRequest, step: StepKey): string | null {
  switch (step) {
    case "plant":
      return r.submittedAt;
    case "service":
      // The second pass restarts the clock from the approval; the first runs from
      // the plant. Without this a complaint back from approval would look overdue
      // the moment it returned.
      return r.aprAt ?? r.plantAt;
    case "approval":
      return r.svcAt;
    case "management_review":
      return r.svcCloseAt ?? r.svcAt;
    default:
      return null;
  }
}

/**
 * A complaint's due date for one step = its anchor's completion + N working days.
 *
 * ONE EXCEPTION, and it is the whole reason acknowledge asks for a target date:
 * once a date has been PROMISED TO THE PARTY (`ackTargetDate`), that is when the
 * resolution is due. A date somebody committed to a customer beats a generic SLA,
 * and leaving the generic clock in the Due column would both misreport the
 * deadline and hide the only date anyone outside the building was told about.
 *
 * (The same shape as sampling's `lab_tentative_date` rule, for the same reason.)
 */
export function complaintDueIso(
  snap: ComplaintSnapshot,
  r: ComplaintRequest,
  step: StepKey,
): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;
  const from = stepAnchorCompletedIso(r, step) ?? r.submittedAt;
  return dueIsoFrom(from, sla);
}

/* -------------------------------------------------------------------------- */
/*  Completed entries — the "what I did here" side of a stage                  */
/* -------------------------------------------------------------------------- */

export interface StageEntry<T> {
  /** The underlying row's id. Every step here is request-scope, so this is the complaint. */
  id: string;
  stepKey: StepKey;
  requestId: string;
  /** Human reference, for display and search. */
  ref: string;
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
 * Every rule below mirrors its `fms_complaint_step_editable()` counterpart in the
 * database. The server is the gate; these exist so the UI can grey a button and
 * SAY WHY.
 *
 * ⚠ `on_hold` does NOT lock an edit. This module stores `holdFromStatus`
 *   explicitly, so resuming is independent of what was corrected while parked —
 *   and a hold is often exactly when a mistake gets noticed.
 */
const terminalLock = (r: ComplaintRequest, what: string): string | null =>
  r.status === "cancelled" ? `This complaint was cancelled — its ${what} can no longer be changed.` : null;

const effectiveStatus = (r: ComplaintRequest) =>
  r.status === "on_hold" ? (r.holdFromStatus ?? r.status) : r.status;

/** Editable while the plant has acted but the service team has not. */
export function plantLockReason(r: ComplaintRequest): string | null {
  const t = terminalLock(r, "plant action");
  if (t) return t;
  if (effectiveStatus(r) !== "awaiting_service")
    return "The service team has already picked this up — the plant action can no longer be changed.";
  return null;
}

/** Editable at either place the service team's first pass can hand to. */
export function serviceLockReason(r: ComplaintRequest): string | null {
  const t = terminalLock(r, "service entry");
  if (t) return t;
  const st = effectiveStatus(r);
  if (st !== "awaiting_approval" && st !== "awaiting_management_review")
    return "This has moved on — the service entry can no longer be changed.";
  return null;
}

/** Editable while approved but the service team has not closed it. */
export function approvalLockReason(r: ComplaintRequest): string | null {
  const t = terminalLock(r, "approval");
  if (t) return t;
  if (effectiveStatus(r) !== "awaiting_service_close")
    return "The service team has already closed this — the approval can no longer be changed.";
  return null;
}

/** The review is last, so nothing downstream can lock it. */
export function managementReviewLockReason(r: ComplaintRequest): string | null {
  return terminalLock(r, "review");
}

export function lockReasonFor(step: StepKey, r: ComplaintRequest): string | null {
  switch (step) {
    case "plant":
      return plantLockReason(r);
    case "service":
      return serviceLockReason(r);
    case "approval":
      return approvalLockReason(r);
    case "management_review":
      return managementReviewLockReason(r);
    default:
      return null;
  }
}

const entryOf = (
  stepKey: StepKey,
  r: ComplaintRequest,
  actorId: string | null,
  atIso: string,
  lockReason: string | null,
): StageEntry<ComplaintRequest> => ({
  id: r.id,
  stepKey,
  requestId: r.id,
  ref: r.complaintNo,
  actorId,
  atIso,
  editedAtIso: r.editedAt,
  editedById: r.editedBy,
  lockReason,
  row: r,
});

export const completedPlantEntries = (d: ComplaintSnapshot): StageEntry<ComplaintRequest>[] =>
  d.requests.filter((r) => !!r.plantAt).map((r) => entryOf("plant", r, r.plantBy, r.plantAt!, plantLockReason(r)));

/**
 * ⚠ Keyed on `svcAt` — the FIRST pass. A complaint that has only been sent for
 *   approval is still work owed to the service team, so it must stay in Pending;
 *   keying this on the close would move it to Completed with the closing still to
 *   come. (The same trap sampling documents on `lab_process`.)
 */
export const completedServiceEntries = (d: ComplaintSnapshot): StageEntry<ComplaintRequest>[] =>
  d.requests.filter((r) => !!r.svcAt).map((r) => entryOf("service", r, r.svcBy, r.svcAt!, serviceLockReason(r)));

export const completedApprovalEntries = (d: ComplaintSnapshot): StageEntry<ComplaintRequest>[] =>
  d.requests.filter((r) => !!r.aprAt).map((r) => entryOf("approval", r, r.aprBy, r.aprAt!, approvalLockReason(r)));

export const completedManagementReviewEntries = (d: ComplaintSnapshot): StageEntry<ComplaintRequest>[] =>
  d.requests.filter((r) => !!r.mgmtAt).map((r) => entryOf("management_review", r, r.mgmtBy, r.mgmtAt!, managementReviewLockReason(r)));

export function completedEntriesFor(step: StepKey, d: ComplaintSnapshot): StageEntry<ComplaintRequest>[] {
  switch (step) {
    case "plant":
      return completedPlantEntries(d);
    case "service":
      return completedServiceEntries(d);
    case "approval":
      return completedApprovalEntries(d);
    case "management_review":
      return completedManagementReviewEntries(d);
    default:
      return [];
  }
}

export function buildQueueEntries(snap: ComplaintSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const r of snap.requests) {
    const step = openStep(r);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityType: "request",
      entityId: r.id,
      ref: r.complaintNo,
      dueIso: complaintDueIso(snap, r, step),
      requestId: r.id,
    });
  }
  return out;
}
