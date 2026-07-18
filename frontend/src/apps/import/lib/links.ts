/**
 * Where an Import FMS queue entry opens.
 *
 * A `line` entry has no page of its own — it opens its parent requisition, which
 * is also where a requisition-scoped entry (the PO desk) goes.
 */
import type { RequestItem } from "../types";
import type { QueueEntry } from "./queues";

export const IMPORT_BASE = "/import";

/** Only the two fields the link rule reads, so callers can pass a full snapshot. */
type LineRef = Pick<RequestItem, "id" | "requestId">;

export function linkResolver(requestItems: LineRef[]): (e: QueueEntry) => string {
  const requestIdOfLine = new Map<string, string>();
  for (const l of requestItems) requestIdOfLine.set(l.id, l.requestId);

  return (e: QueueEntry): string => {
    if (e.entityType === "request") return `${IMPORT_BASE}/requests/${e.entityId}`;
    if (e.entityType === "line") return `${IMPORT_BASE}/requests/${requestIdOfLine.get(e.entityId) ?? ""}`;
    return `${IMPORT_BASE}/pos/${e.entityId}`;
  };
}
