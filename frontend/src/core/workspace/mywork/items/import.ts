/**
 * Purchase RM Import → work items. The Purchase twin — see ./purchase.ts.
 *
 * Import's owner rule is LINE-SCOPED with a single approver per band, unlike
 * Purchase's requisition-scoped multi-approver bands, which is why each app keeps
 * its own `lib/owners.ts` rather than sharing one.
 *
 * Hold is PER LINE here too, with the request staying on the `approval` step —
 * see ./purchase.ts for why that makes `isHeld` necessary. Same rule: the step is
 * held only when EVERY line still under decision is on hold.
 */
import { appName } from "@/apps/appInfo";
import type { ImportData } from "@/apps/import/data/importFetch";
import { buildQueueEntries, lineInApproval } from "@/apps/import/lib/queues";
import { stepByKey } from "@/apps/import/lib/steps";
import { ownerResolver } from "@/apps/import/lib/owners";
import { linkResolver } from "@/apps/import/lib/links";
import type { WorkItem } from "../types";

export function importWorkItems(data: ImportData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = ownerResolver(data);
  const linkOf = linkResolver(data.requestItems);

  const heldCount = (stepKey: string, entityId: string): number | null => {
    if (stepKey !== "approval") return null;
    const underDecision = data.requestItems.filter((l) => l.requestId === entityId && lineInApproval(l));
    if (underDecision.length === 0) return null;
    return underDecision.every((l) => l.status === "on_hold") ? underDecision.length : null;
  };

  return buildQueueEntries(data)
    .filter((e) => isAdmin || owners.isMine(e, uid))
    .map((e) => ({
      id: `import:${e.entityId}:${e.stepKey}`,
      source: "import",
      sourceLabel: appName("import"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: linkOf(e),
      assignment: owners.isMine(e, uid) ? ("direct" as const) : ("team" as const),
      isApproval: e.stepKey === "approval",
      ...holdFieldsOf(heldCount(e.stepKey, e.entityId)),
    }));
}

/** As Purchase: the line carries no hold reason, so the count is what can be said. */
function holdFieldsOf(n: number | null): Pick<WorkItem, "isHeld" | "holdReason"> {
  if (n === null) return {};
  return { isHeld: true, holdReason: n > 1 ? `${n} lines on hold` : null };
}
