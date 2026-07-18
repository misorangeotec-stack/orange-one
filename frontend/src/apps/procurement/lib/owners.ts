/**
 * Who owns a Purchase FMS queue entry — extracted so more than one screen can ask.
 *
 * This lived as a closure inside the Control Center page, which meant the only
 * way to answer "is this work-item mine?" was to render that page. The home
 * screen's My Work list needs the same answer without mounting the procurement
 * store, so the rule moves here as a pure function over the data both already hold.
 *
 * The store keeps its own `approversForAmount` / `stepOwnerFor` as thin
 * delegations to this file, so there is exactly one band-selection rule in the app.
 *
 * NOTE the deliberate asymmetry with Import (`apps/import/lib/owners.ts`): Purchase
 * routes approvals per REQUISITION with a multi-approver band, Import still routes
 * per LINE with a single approver. They are not twins and must not be merged —
 * see the entityType union on each app's `QueueEntry`.
 */
import type { ApprovalBand, RequestItem, StepOwner } from "../types";
import type { StepKey } from "./steps";
import type { QueueEntry } from "./queues";

/** The slice of `ProcurementData` owner resolution reads — nothing more. */
export interface OwnerSnapshot {
  stepOwners: StepOwner[];
  approvalBands: ApprovalBand[];
  requestItems: RequestItem[];
}

export interface OwnerResolver {
  /**
   * Everyone who may approve this amount via the active matrix bands (empty if no
   * band covers it). A band can list several people and ANY ONE of them can
   * decide — so this returns a list, not a winner.
   */
  approversForAmount: (amount: number) => string[];
  stepOwnerFor: (stepKey: string) => StepOwner | undefined;
  stepOwnerIds: (stepKey: string) => string[];
  /** Every user who owns this work-item. Empty means unassigned. */
  ownerIdsOf: (e: QueueEntry) => string[];
  isMine: (e: QueueEntry, userId: string) => boolean;
}

export function ownerResolver(data: OwnerSnapshot): OwnerResolver {
  // Built once per snapshot; callers memoise on `data`.
  const linesByRequest = new Map<string, RequestItem[]>();
  const lineById = new Map<string, RequestItem>();
  for (const l of data.requestItems) {
    lineById.set(l.id, l);
    const list = linesByRequest.get(l.requestId);
    if (list) list.push(l);
    else linesByRequest.set(l.requestId, [l]);
  }
  // Sorted by createdAt to match `store.itemsForRequest`. Only the ORDER of the
  // returned owner ids depends on it — but that order is what the Control Center
  // renders in its Owner column, so it is not cosmetic.
  for (const list of linesByRequest.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Band selection mirrors the SQL exactly (`order by sort_order, min_amount
  // limit 1`) so the client and the RPC can never pick different bands.
  const approversForAmount = (amount: number): string[] => {
    const band = [...data.approvalBands]
      .filter((b) => b.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount)
      .find((b) => amount >= b.minAmount && (b.maxAmount === null || amount <= b.maxAmount));
    return band?.approverUserIds ?? [];
  };

  const stepOwnerFor = (stepKey: string): StepOwner | undefined =>
    data.stepOwners.find((o) => o.stepKey === stepKey);

  const stepOwnerIds = (stepKey: string): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

  /**
   * Every step reads its owners from `step_owners`, except `approval` — there the
   * owner depends on the entry's value (the approval matrix band), plus any manual
   * reassign override stamped on an individual line.
   */
  const ownerIdsOf = (e: QueueEntry): string[] => {
    if (e.stepKey === ("approval" as StepKey)) {
      // Requisition-scoped: band on the entry's own total (the same figure the
      // RPC uses), plus anyone manually reassigned onto one of its lines.
      const ids = new Set<string>(approversForAmount(e.value ?? 0));
      const lines =
        e.entityType === "request"
          ? (linesByRequest.get(e.entityId) ?? []).filter((l) => l.status === "approval" || l.status === "on_hold")
          : [lineById.get(e.entityId)].filter((l): l is RequestItem => !!l);
      for (const l of lines) if (l.assignedApproverId) ids.add(l.assignedApproverId);
      return [...ids];
    }
    return stepOwnerIds(e.stepKey);
  };

  const isMine = (e: QueueEntry, userId: string): boolean => ownerIdsOf(e).includes(userId);

  return { approversForAmount, stepOwnerFor, stepOwnerIds, ownerIdsOf, isMine };
}
