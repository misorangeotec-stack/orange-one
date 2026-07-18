/**
 * Who owns an Import FMS queue entry — extracted so more than one screen can ask.
 * See `apps/procurement/lib/owners.ts` for the full rationale.
 *
 * DELIBERATELY NOT A COPY OF PURCHASE. Import routes approvals per LINE with a
 * SINGLE approver per band (`approverUserId`); Purchase routes per REQUISITION
 * with a multi-approver band (`approverUserIds`). Import's `QueueEntry.entityType`
 * is typed `"line" | "po"` and so can never carry a requisition-scoped entry —
 * which is why there is no `request` branch here. Aligning the two models is a
 * product decision, not a refactor; do not "fix" this file into Purchase's shape.
 */
import type { ApprovalBand, RequestItem, StepOwner } from "../types";
import type { StepKey } from "./steps";
import type { QueueEntry } from "./queues";

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
  const lineById = new Map<string, RequestItem>();
  for (const l of data.requestItems) lineById.set(l.id, l);

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
   * owner depends on the line's value (the approval matrix band), plus any manual
   * reassign override.
   */
  const ownerIdsOf = (e: QueueEntry): string[] => {
    if (e.stepKey === ("approval" as StepKey)) {
      const l = lineById.get(e.entityId);
      const ids = new Set<string>();
      const appr = approverForAmount(l?.lineValue ?? 0);
      if (appr) ids.add(appr);
      if (l?.assignedApproverId) ids.add(l.assignedApproverId);
      return [...ids];
    }
    return stepOwnerIds(e.stepKey);
  };

  const isMine = (e: QueueEntry, userId: string): boolean => ownerIdsOf(e).includes(userId);

  return { approverForAmount, stepOwnerFor, stepOwnerIds, ownerIdsOf, isMine };
}
