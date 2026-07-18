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
