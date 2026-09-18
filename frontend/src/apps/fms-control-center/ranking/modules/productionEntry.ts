/**
 * Production Entry — scored steps (CC-1).
 *
 * Closed: `completedFor` per step, due from `productionDueIso` — the same two
 * functions the Cycle Time report (lib/cycleTime.ts → legsFor) reads, and the same
 * `stepAppliesTo` filter, so a step on time here is `lateDays <= 0` there. Both
 * reduce the completion to its calendar day before comparing (month.ts does it in
 * IST explicitly; the report relies on the browser being in India).
 *
 * Open: `productionWorkItems`, My Work Today's rule (one owner row per step).
 *
 * What the module's own records mean for the score:
 *  · Log Book Entry (`transfer_slip`) has no due date → untimed, counts for nobody.
 *  · A QC rejection is not a closure: `qc_at` is stamped only on approval, so the
 *    step closes once, when the lot finally passes, to whoever approved it.
 *  · A rework pass of Handover or RM Transfer after a QC reject records no time or
 *    actor (only a done flag on the round), so only the first pass is scored.
 */
import { fetchProductionData, type ProductionData } from "@/apps/production-entry/data/productionFetch";
import { QUEUE_STEPS } from "@/apps/production-entry/lib/cycleTime";
import { completedFor, productionDueIso, productionSnapshotFrom } from "@/apps/production-entry/lib/queues";
import { stepAppliesTo, stepByKey, type StepKey } from "@/apps/production-entry/lib/steps";
import { productionWorkItems } from "@/core/workspace/mywork/items/productionEntry";
import type { ClosedStep, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const label = (k: string) => stepByKey(k)?.title ?? k;

export const productionEntryScorer: ModuleScorer<ProductionData> = {
  key: "production-entry",
  appId: "production-entry",
  load: () => fetchProductionData(),

  closed(data) {
    const snap = productionSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla });
    const out: ClosedStep[] = [];
    for (const step of QUEUE_STEPS) {
      for (const e of completedFor(snap, step)) {
        if (!stepAppliesTo(e.row.cardType, step as StepKey)) continue;
        out.push({
          stepId: `${e.requestId}:${step}`,
          entityId: e.requestId,
          ref: e.ref,
          stepKey: step,
          stepLabel: label(step),
          roundNo: 0,
          dueIso: productionDueIso(snap, e.row, step),
          actorId: e.actorId,
          doneAtIso: e.atIso,
        });
      }
    }
    return out;
  },

  openFor(data, uid) {
    return parseItems(productionWorkItems(data, uid, false)).map(
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
