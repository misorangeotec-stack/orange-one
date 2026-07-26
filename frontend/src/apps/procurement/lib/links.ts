/**
 * Where a Purchase FMS queue entry opens.
 *
 * Extracted from the Control Center page alongside `owners.ts` and for the same
 * reason: the home screen's My Work list has to turn a queue entry into a link
 * without mounting the procurement store.
 *
 * A `line` entry has no page of its own — it opens its parent requisition.
 */
import type { RequestItem } from "../types";
import type { QueueEntry } from "./queues";

export const PROC_BASE = "/procurement";

/** Only the two fields the link rule reads, so callers can pass a full snapshot. */
type LineRef = Pick<RequestItem, "id" | "requestId">;

export function linkResolver(requestItems: LineRef[]): (e: QueueEntry) => string {
  const requestIdOfLine = new Map<string, string>();
  for (const l of requestItems) requestIdOfLine.set(l.id, l.requestId);

  return (e: QueueEntry): string => {
    if (e.entityType === "request") return `${PROC_BASE}/requests/${e.entityId}`;
    if (e.entityType === "line") return `${PROC_BASE}/requests/${requestIdOfLine.get(e.entityId) ?? ""}`;
    return `${PROC_BASE}/pos/${e.entityId}`;
  };
}

export const PROC_REQUESTS = `${PROC_BASE}/requests`;
export const PROC_POS = `${PROC_BASE}/pos`;

/**
 * Where a PO stage opens from the dashboard's "Purchase orders by stage" card.
 *
 * A PO only exists from `share_po` onwards, and every live stage has its own queue
 * page — so the stage key maps straight onto a queue route. The two terminal stages
 * (`closed`, `cancelled`) have no queue and fall back to the PO list.
 */
const PO_STAGE_QUEUE: Record<string, string> = {
  share_po: `${PROC_BASE}/queues/share`,
  collect_pi: `${PROC_BASE}/queues/collect-pi`,
  advance_payment: `${PROC_BASE}/queues/advance`,
  follow_up: `${PROC_BASE}/queues/follow-up`,
  inward: `${PROC_BASE}/queues/inward`,
  tally: `${PROC_BASE}/queues/tally`,
  closed: PROC_POS,
  cancelled: PROC_POS,
};

/** Undefined for an unknown stage, so the row simply stays un-clickable. */
export function poStageHref(stage: string): string | undefined {
  return PO_STAGE_QUEUE[stage];
}
