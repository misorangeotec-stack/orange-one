/**
 * Purchase RM Domestic → work items. See ./README.md.
 *
 * `buildQueueEntries` deliberately does NOT filter by owner — a coordinator's
 * Control Center must count everyone's work — so the owner rule is applied here.
 * It lives in `procurement/lib/owners.ts` precisely so this can apply it without
 * mounting the procurement store.
 *
 * Purchase overrides the `approval` step with a VALUE-BAND matrix, which is why it
 * keeps its own resolver rather than using the shared step-owner helper.
 */
import { appName } from "@/apps/appInfo";
import type { ProcurementData } from "@/apps/procurement/data/procFetch";
import { buildQueueEntries } from "@/apps/procurement/lib/queues";
import { stepByKey } from "@/apps/procurement/lib/steps";
import { ownerResolver } from "@/apps/procurement/lib/owners";
import { linkResolver } from "@/apps/procurement/lib/links";
import type { WorkItem } from "../types";

export function purchaseWorkItems(data: ProcurementData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = ownerResolver(data);
  const linkOf = linkResolver(data.requestItems);
  return buildQueueEntries(data)
    // An admin owns no workflow steps, so a personal filter would show them an
    // empty screen. They see the whole book instead — matching the Control Center.
    .filter((e) => isAdmin || owners.isMine(e, uid))
    .map((e) => ({
      id: `purchase:${e.entityId}:${e.stepKey}`,
      source: "purchase",
      sourceLabel: appName("procurement"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: linkOf(e),
      assignment: owners.isMine(e, uid) ? ("direct" as const) : ("team" as const),
      isApproval: e.stepKey === "approval",
    }));
}
