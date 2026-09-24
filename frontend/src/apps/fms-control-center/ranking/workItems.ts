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

/**
 * A held row scores against nobody.
 *
 * Every `items/` rule now returns the entities its module has ON HOLD, flagged
 * with `isHeld`, so that My Work can show parked work on its own tile instead of
 * losing it (see `core/workspace/mywork/types.ts`). Those rows arrive here too —
 * `openFor` asks the same rule the home screen does — and they must not be
 * charged: somebody with the right to hold has already decided the work is not
 * owed today, and the ranking charges an OVERDUE OPEN STEP to everyone whose My
 * Work lists it. Without this, switching the hold tile on would have quietly
 * started docking people for work they had correctly parked.
 *
 * `month.ts` skips any step carrying a `drop` and counts it under `dropped.held`,
 * so the number is reported rather than silently absorbed.
 */
export const heldDrop = (item: WorkItem): "held" | undefined => (item.isHeld ? "held" : undefined);
