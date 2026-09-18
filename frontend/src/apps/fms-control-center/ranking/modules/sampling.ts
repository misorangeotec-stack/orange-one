/**
 * Sampling — scored steps (CC-1).
 *
 * Closed: the module's ten `completed*Entries` builders — the same ten the store
 * reads for its Completed tabs — each due from `samplingDueIso`.
 *
 * Open: `samplingWorkItems`, My Work Today's rule: step owners (split Domestic /
 * Export on the three outward steps) plus whoever is named on the request.
 *
 * ⚠ Lab Process is due on the lab's committed date once one is recorded. That date
 *   can be edited after the step is done and keeps no history, so a late lab
 *   result can later be re-dated on time. The month it closed in is frozen at the
 *   month's end, which is as far as the ranking can protect it.
 */
import { fetchSamplingData, type SamplingData } from "@/apps/sampling/data/samplingFetch";
import {
  completedCollectEntries,
  completedConfirmEntries,
  completedHandoverEntries,
  completedLabProcessEntries,
  completedResultEntries,
  completedResultReceivedEntries,
  completedSampleReceivedEntries,
  completedSampleToLabEntries,
  completedSendEntries,
  completedTestingEntries,
  samplingDueIso,
  samplingSnapshotFrom,
} from "@/apps/sampling/lib/queues";
import { stepByKey } from "@/apps/sampling/lib/steps";
import { samplingWorkItems } from "@/core/workspace/mywork/items/sampling";
import type { ClosedStep, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const BUILDERS = [
  completedCollectEntries,
  completedSampleReceivedEntries,
  completedSampleToLabEntries,
  completedLabProcessEntries,
  completedResultReceivedEntries,
  completedSendEntries,
  completedConfirmEntries,
  completedTestingEntries,
  completedResultEntries,
  completedHandoverEntries,
];

const label = (k: string) => stepByKey(k)?.title ?? k;

export const samplingScorer: ModuleScorer<SamplingData> = {
  key: "sampling",
  appId: "sampling",
  load: () => fetchSamplingData(),

  closed(data) {
    const snap = samplingSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla });
    const out: ClosedStep[] = [];
    for (const build of BUILDERS) {
      for (const e of build(snap)) {
        out.push({
          stepId: `${e.row.id}:${e.stepKey}`,
          entityId: e.row.id,
          ref: e.ref,
          stepKey: e.stepKey,
          stepLabel: label(e.stepKey),
          roundNo: 0,
          dueIso: samplingDueIso(snap, e.row, e.stepKey),
          actorId: e.actorId,
          doneAtIso: e.atIso,
        });
      }
    }
    return out;
  },

  openFor(data, uid) {
    return parseItems(samplingWorkItems(data, uid, false)).map(
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
