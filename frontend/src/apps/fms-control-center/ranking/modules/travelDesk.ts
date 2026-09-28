/**
 * Travel Desk — scored steps (CC-1).
 *
 * ⚠ SWITCHED OFF in the ranking at launch (`fms_rank_modules`): the module is on
 *   hold at the client's request, with no grants and no step owners, and every trip
 *   on 18-09-2026 was raised while building it. Scored here so an admin can switch it
 *   on at go-live without anybody writing code that day.
 *
 * Closed: every trip × step with the module's own `stepCompletedIso`,
 * `stepActorId` and `tripDueIso` — the module has no Completed-tab builder, and
 * those three are what its detail page reads.
 *
 * From the module's own records:
 *  · A trip with nothing to claim closes itself: Claim Approval, Finance and
 *    Settlement are stamped at one instant with the traveller as actor. Nobody did
 *    those three, so they count for nobody (`no_actor`).
 *  · A "return" decision erases its own stamp, and a cancellation records no actor;
 *    neither leaves a closure to score.
 *
 * Open: `travelDeskWorkItems` — an assignee replaces everyone; otherwise the
 * traveller for the claim, the trip's approvers for the manager steps, step owners.
 */
import { fetchTravelData, type TravelData } from "@/apps/travel-desk/data/travelFetch";
import { stepActorId, stepCompletedIso, tripDueIso, type QueueStep } from "@/apps/travel-desk/lib/queues";
import { resolveStepSla } from "@/apps/travel-desk/lib/sla";
import { stepByKey } from "@/apps/travel-desk/lib/steps";
import type { Trip } from "@/apps/travel-desk/types";
import { travelDeskWorkItems } from "@/core/workspace/mywork/items/travel-desk";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { heldDrop, parseItems } from "../workItems";

const STEPS: QueueStep[] = [
  "manager_approval",
  "director_approval",
  "advance",
  "booking",
  "claim",
  "claim_review",
  "finance_review",
  "settlement",
];
const AUTO_CLOSED: ReadonlySet<string> = new Set(["claim_review", "finance_review", "settlement"]);
const label = (k: string) => stepByKey(k)?.title ?? k;

/** Raised while the module was being built — demo trips and two build-time trips. */
const isTestTrip = (ref: string) =>
  ref.startsWith("TRV-DEMO-") || ref === "TRV-2627-0001" || ref === "TRV-2627-0002";

const refOf = (t: Trip) => t.tripNo ?? t.id;

export const travelDeskScorer: ModuleScorer<TravelData> = {
  key: "travel-desk",
  appId: "travel-desk",
  load: () => fetchTravelData(),

  closed(data) {
    const sla = resolveStepSla(data.stepSla);
    const out: ClosedStep[] = [];
    for (const t of data.trips) {
      const selfClosed = !!t.stAt && t.crAt === t.stAt && t.frAt === t.stAt;
      for (const step of STEPS) {
        const at = stepCompletedIso(t, step);
        if (!at) continue;
        const drop: DropReason | undefined = isTestTrip(refOf(t))
          ? "test_record"
          : selfClosed && AUTO_CLOSED.has(step)
            ? "no_actor"
            : undefined;
        out.push({
          stepId: `${t.id}:${step}`,
          entityId: t.id,
          ref: refOf(t),
          stepKey: step,
          stepLabel: label(step),
          roundNo: 0,
          dueIso: tripDueIso(t, step, sla),
          actorId: stepActorId(t, step),
          doneAtIso: at,
          drop,
        });
      }
    }
    return out;
  },

  openFor(data, uid) {
    return parseItems(travelDeskWorkItems(data, uid, false)).map(
      ({ entityId, stepKey, item }): OpenStep => ({
        stepId: `${entityId}:${stepKey}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: 0,
        dueIso: item.dueIso,
        drop: heldDrop(item) ?? (isTestTrip(item.ref) ? "test_record" : undefined),
      }),
    );
  },
};
