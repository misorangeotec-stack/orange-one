/**
 * Who owns an Import FMS queue entry — extracted so more than one screen can ask.
 * See `apps/procurement/lib/owners.ts` for the full rationale.
 *
 * Approval is now REQUISITION-scoped (matching Purchase): one decision per
 * requisition, so an approval queue entry carries a REQUEST id and its owners are
 * the configured approvers. Import still uses a SINGLE approver per band
 * (`approverUserId`), where Purchase grew a multi-approver band — that difference
 * remains.
 *
 * ⚠ A requisition can be HANDED OVER to one person (Setup → Approvers names who
 *   may receive one). While it is, that person is its sole owner — the handover
 *   MOVES the work rather than sharing it. `holderOfLines` is the one place that
 *   rule is expressed; the store imports it too, so the queue, My Work, the
 *   daily snapshot mail and the Approve button cannot drift apart.
 */
import type { ApprovalBand, RequestItem, StepOwner } from "../types";
import type { StepKey } from "./steps";
import type { QueueEntry } from "./queues";

/**
 * Whoever this set of lines has been handed to, or null if it still sits with
 * the configured approvers.
 *
 * The CALLER picks the basis, because the two readers disagree about it on
 * purpose: queue ownership asks about the lines still under decision, while the
 * store also has to answer for a decided-but-not-yet-PO'd requisition it is
 * about to let the holder revise. Same rule, different slice.
 *
 * Lines of one requisition are handed over together, so the first non-null wins.
 */
export const holderOfLines = (lines: RequestItem[]): string | null => {
  for (const l of lines) if (l.assignedApproverId) return l.assignedApproverId;
  return null;
};

/** The slice of `ImportData` owner resolution reads — nothing more. */
export interface OwnerSnapshot {
  stepOwners: StepOwner[];
  approvalBands: ApprovalBand[];
  requestItems: RequestItem[];
}

export interface OwnerResolver {
  /** The approver for this amount via the active matrix bands (null if none covers it). */
  approverForAmount: (amount: number) => string | null;
  stepOwnerFor: (stepKey: string) => StepOwner | undefined;
  stepOwnerIds: (stepKey: string) => string[];
  /** Every user who owns this work-item. Empty means unassigned. */
  ownerIdsOf: (e: QueueEntry) => string[];
  /** Whoever this requisition has been handed to while it awaits a decision. */
  holderOfRequest: (requestId: string) => string | null;
  isMine: (e: QueueEntry, userId: string) => boolean;
}

export function ownerResolver(data: OwnerSnapshot): OwnerResolver {
  // Approvals no longer route by value. Every active row in the matrix is an
  // eligible approver (a single person, or a small list). `approverForAmount`
  // ignores the amount and returns the FIRST active approver (kept for callers
  // that want one representative); `activeApproverIds` returns them all.
  const activeApproverIds = (): string[] =>
    [...data.approvalBands]
      .filter((b) => b.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount)
      .map((b) => b.approverUserId);

  const approverForAmount = (_amount: number): string | null => activeApproverIds()[0] ?? null;

  const stepOwnerFor = (stepKey: string): StepOwner | undefined =>
    data.stepOwners.find((o) => o.stepKey === stepKey);

  const stepOwnerIds = (stepKey: string): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

  /** Handed over to whom, judged on the lines still awaiting a decision. */
  const holderOfRequest = (requestId: string): string | null =>
    holderOfLines(
      data.requestItems.filter(
        (l) => l.requestId === requestId && (l.status === "approval" || l.status === "on_hold")
      )
    );

  /**
   * Every step reads its owners from `step_owners`, except `approval` — there the
   * owners are ALL active configured approvers (no value banding any more)...
   * UNLESS the requisition has been handed to someone, in which case they are its
   * only owner. That is what makes the handover a MOVE: it leaves the approvers'
   * queues, their My Work list, and their line on the daily snapshot mail.
   *
   * An approval entry is request-scoped, so `entityId` IS the request id
   * (lib/queues.ts builds it that way).
   */
  const ownerIdsOf = (e: QueueEntry): string[] => {
    if (e.stepKey !== ("approval" as StepKey)) return stepOwnerIds(e.stepKey);
    const holder = holderOfRequest(e.entityId);
    return holder ? [holder] : activeApproverIds();
  };

  const isMine = (e: QueueEntry, userId: string): boolean => ownerIdsOf(e).includes(userId);

  return { approverForAmount, stepOwnerFor, stepOwnerIds, ownerIdsOf, holderOfRequest, isMine };
}
