/**
 * Reading My Work Today's items back into steps.
 *
 * The open half of the ranking charges an overdue step to everyone whose My Work
 * Today lists it, so it asks each module's `items/` rule the same question the
 * home screen asks — once per person — and turns each item it gets back into a
 * step. It never decides ownership itself.
 *
 * Every `items/` rule writes `id` as `${source}:${entityId}:${stepKey}` (see
 * core/workspace/mywork/types.ts), and every entity id is a uuid with no colon in
 * it, so the split below is exact.
 */
import type { WorkItem } from "@/core/workspace/mywork/types";

export interface ParsedItem {
  entityId: string;
  stepKey: string;
  item: WorkItem;
}

export function parseItems(items: WorkItem[]): ParsedItem[] {
  const out: ParsedItem[] = [];
  for (const item of items) {
    const parts = item.id.split(":");
    if (parts.length !== 3) {
      // A shape this file does not know. Refuse loudly rather than guess an owner.
      throw new Error(`ranking: unexpected My Work item id "${item.id}" — expected source:entity:step`);
    }
    out.push({ entityId: parts[1], stepKey: parts[2], item });
  }
  return out;
}
