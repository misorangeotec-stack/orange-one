/**
 * Who owns an Import FMS queue entry — extracted so more than one screen can ask.
 * See `apps/procurement/lib/owners.ts` for the full rationale.
 *
 * Approval is now REQUISITION-scoped (matching Purchase): one decision per
 * requisition, banded on its TOTAL. So an approval queue entry carries a REQUEST
 * id, and its owner is the approver for the request's approval total (plus any
 * per-line manual reassign). Import still uses a SINGLE approver per band
 * (`approverUserId`), where Purchase grew a multi-approver band — that difference
 * remains.
 */
import type { ApprovalBand, RequestItem, StepOwner } from "../types";
import type { StepKey } from "./steps";
import { lineInApproval, requestApprovalTotal, type QueueEntry } from "./queues";

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
  isMine: (e: QueueEntry, userId: string) => boolean;
}

export function ownerResolver(data: OwnerSnapshot): OwnerResolver {
  const linesByRequest = new Map<string, RequestItem[]>();
  for (const l of data.requestItems) {
    const arr = linesByRequest.get(l.requestId);
    if (arr) arr.push(l);
    else linesByRequest.set(l.requestId, [l]);
  }

  // Band selection mirrors the SQL exactly (`order by sort_order, min_amount
  // limit 1`) so the client and the RPC can never pick different bands.
  const approverForAmount = (amount: number): string | null => {
    const band = [...data.approvalBands]
      .filter((b) => b.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount)
      .find((b) => amount >= b.minAmount && (b.maxAmount === null || amount <= b.maxAmount));
    return band?.approverUserId ?? null;
  };

  const stepOwnerFor = (stepKey: string): StepOwner | undefined =>
    data.stepOwners.find((o) => o.stepKey === stepKey);

  const stepOwnerIds = (stepKey: string): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

  /**
   * Every step reads its owners from `step_owners`, except `approval` — there the
   * owner depends on the REQUISITION's approval total (the matrix band), plus any
   * per-line manual reassign. The entry is requisition-scoped, so `entityId` is a
   * request id.
   */
  const ownerIdsOf = (e: QueueEntry): string[] => {
    if (e.stepKey === ("approval" as StepKey)) {
      const lines = linesByRequest.get(e.entityId) ?? [];
      const ids = new Set<string>();
      const appr = approverForAmount(requestApprovalTotal(lines));
      if (appr) ids.add(appr);
      for (const l of lines) if (lineInApproval(l) && l.assignedApproverId) ids.add(l.assignedApproverId);
      return [...ids];
    }
    return stepOwnerIds(e.stepKey);
  };

  const isMine = (e: QueueEntry, userId: string): boolean => ownerIdsOf(e).includes(userId);

  return { approverForAmount, stepOwnerFor, stepOwnerIds, ownerIdsOf, isMine };
}
