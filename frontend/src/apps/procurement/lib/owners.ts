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
 *
 * ⚠ A requisition can be HANDED OVER to one person (Setup → Approval matrix names
 *   who may receive one). While it is, that person is its sole owner — the
 *   handover MOVES the work rather than sharing it. `holderOfLines` is the one
 *   place that rule is expressed; the store imports it too, so the queue, My Work,
 *   the daily snapshot mail and the Approve button cannot drift apart.
 */
import type { ApprovalBand, RequestItem, StepOwner } from "../types";
import type { StepKey } from "./steps";
import type { QueueEntry } from "./queues";

/**
 * Whoever this set of lines has been handed to, or null if it still sits with
 * the amount band.
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
  /** Whoever this requisition has been handed to while it awaits a decision. */
  holderOfRequest: (requestId: string) => string | null;
  isMine: (e: QueueEntry, userId: string) => boolean;
  /**
   * Who may decide THIS requisition's approval — the matrix band for `total`,
   * unless it has been HANDED OVER, in which case the holder alone. The band is
   * otherwise the single authority on approval routing.
   *
   * Exposed separately from `ownerIdsOf` because the request stepper has to caption
   * its Approval node and holds a requisition, not a QueueEntry. It used to caption
   * that node from `step_owners.approval` instead, which is a FIXED list that knows
   * nothing about the amount — so the rail cheerfully printed the Director's name on
   * a ₹34k requisition that routes to L2. Both callers now go through this one
   * function; do not reintroduce a second answer.
   */
  requestApprovalOwnerIds: (requestId: string, total: number) => string[];
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
   * The band for what these lines are worth — UNLESS the requisition has been
   * handed to someone, in which case they are its only owner. That is what makes
   * the handover a MOVE: it leaves the band's queue, their My Work list, and
   * their line on the daily snapshot mail, rather than merely appearing in one
   * more place.
   *
   * Both readers below go through here, so the queue and the request stepper
   * cannot give different answers.
   */
  const approvalOwnersOf = (lines: RequestItem[], total: number): string[] => {
    const holder = holderOfLines(lines);
    return holder ? [holder] : approversForAmount(total);
  };

  /** The lines actually under decision — the same set `requestApprovalTotal` sums. */
  const linesInApproval = (requestId: string): RequestItem[] =>
    (linesByRequest.get(requestId) ?? []).filter((l) => l.status === "approval" || l.status === "on_hold");

  const requestApprovalOwnerIds = (requestId: string, total: number): string[] =>
    approvalOwnersOf(linesInApproval(requestId), total);

  /** Handed over to whom, judged on the lines still awaiting a decision. */
  const holderOfRequest = (requestId: string): string | null =>
    holderOfLines(linesInApproval(requestId));

  /**
   * Every step reads its owners from `step_owners`, except `approval` — there the
   * owner depends on the entry's value (the approval matrix band).
   */
  const ownerIdsOf = (e: QueueEntry): string[] => {
    if (e.stepKey === ("approval" as StepKey)) {
      // Band on the entry's own total — the same figure the RPC uses.
      return e.entityType === "request"
        ? requestApprovalOwnerIds(e.entityId, e.value ?? 0)
        : approvalOwnersOf(
            [lineById.get(e.entityId)].filter((l): l is RequestItem => !!l),
            e.value ?? 0
          );
    }
    return stepOwnerIds(e.stepKey);
  };

  const isMine = (e: QueueEntry, userId: string): boolean => ownerIdsOf(e).includes(userId);

  return {
    approversForAmount,
    stepOwnerFor,
    stepOwnerIds,
    ownerIdsOf,
    holderOfRequest,
    isMine,
    requestApprovalOwnerIds,
  };
}
