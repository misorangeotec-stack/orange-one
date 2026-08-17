/**
 * Purchase RM Import → work items. The Purchase twin — see ./purchase.ts.
 *
 * Import's owner rule is LINE-SCOPED with a single approver per band, unlike
 * Purchase's requisition-scoped multi-approver bands, which is why each app keeps
 * its own `lib/owners.ts` rather than sharing one.
 */
import { appName } from "@/apps/appInfo";
import type { ImportData } from "@/apps/import/data/importFetch";
import { buildQueueEntries } from "@/apps/import/lib/queues";
import { stepByKey } from "@/apps/import/lib/steps";
import { ownerResolver } from "@/apps/import/lib/owners";
import { linkResolver } from "@/apps/import/lib/links";
import type { WorkItem } from "../types";

export function importWorkItems(data: ImportData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = ownerResolver(data);
  const linkOf = linkResolver(data.requestItems);
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
    }));
}
