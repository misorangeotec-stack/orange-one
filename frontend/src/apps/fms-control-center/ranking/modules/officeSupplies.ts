/**
 * General Purchase (office supplies) — scored steps (CC-1).
 *
 * Closed: the module's three Completed-tab builders, due from `supplyDueIso`.
 *  · A rejection is a decision too, and the module stamps `rejectedAt` for it. Only
 *    if neither an approval nor a rejection time exists does the builder fall back
 *    to the submission time — that is `no_time`.
 *  · Handover is credited as the Completed tab shows it: to whoever recorded the
 *    handover, at that moment. On a two-phase handover the step formally closes
 *    later, at delivery, which records no actor of its own. The user chose to follow
 *    the module's list, 18-09-2026.
 *
 * Open: `officeSuppliesWorkItems` — the department's HOD (or whoever the approval
 * was handed to) for First Approval, step owners for the rest.
 */
import { fetchSuppliesData, type SuppliesData } from "@/apps/office-supplies/data/suppliesFetch";
import {
  completedFirstApprovalEntries,
  completedHandoverEntries,
  completedSecondApprovalEntries,
  supplyDueIso,
  supplySnapshotFrom,
} from "@/apps/office-supplies/lib/queues";
import { stepByKey } from "@/apps/office-supplies/lib/steps";
import { officeSuppliesWorkItems } from "@/core/workspace/mywork/items/officeSupplies";
import type { ClosedStep, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const label = (k: string) => stepByKey(k)?.title ?? k;

export const officeSuppliesScorer: ModuleScorer<SuppliesData> = {
  key: "office-supplies",
  appId: "office-supplies",
  load: () => fetchSuppliesData(),

  closed(data) {
    const snap = supplySnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla });
    const out: ClosedStep[] = [];
    for (const build of [completedFirstApprovalEntries, completedSecondApprovalEntries, completedHandoverEntries]) {
      for (const e of build(snap)) {
        const r = e.row;
        out.push({
          stepId: `${r.id}:${e.stepKey}`,
          entityId: r.id,
          ref: e.ref,
          stepKey: e.stepKey,
          stepLabel: label(e.stepKey),
          roundNo: 0,
          dueIso: supplyDueIso(snap, r, e.stepKey),
          actorId: e.actorId,
          doneAtIso: e.atIso,
          drop: e.atIso === r.submittedAt && e.stepKey !== "handover" ? "no_time" : undefined,
        });
      }
    }
    return out;
  },

  openFor(data, uid) {
    return parseItems(officeSuppliesWorkItems(data, uid, false)).map(
      ({ entityId, stepKey, item }): OpenStep => ({
        stepId: `${entityId}:${stepKey}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: 0,
        dueIso: item.dueIso,
      }),
    );
  },
};
