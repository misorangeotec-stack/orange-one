/**
 * Order to Dispatch — scored steps (CC-1).
 *
 * Closed: `completedFor`, which reads every ROUND, archived and live, so an order
 * that looped three times contributes three sales bills — each its own step with
 * its own id (`order:round:step`). Its due date is `dispatchDueIso` called with
 * THAT round's view, which is what anchors Check Material Status on the round's
 * own start rather than on the order receipt. Anchor on the receipt and every
 * looped order reads permanently late. This is exactly what the register does
 * (lib/orderVm.ts → orderStepRows).
 *
 * Open: `dispatchWorkItems`, My Work Today's own rule — owners per location, and
 * an order's reassignment replacing them.
 *
 * ── credit_check is scored on the ACTION, and only on the action ────────────
 * It was out BOTH ways until 24-09-2026, because its clock restarts at the
 * decision (`cc_decided_at` is written with `cc_at`), so a decided check is
 * always due the day after it was done and can never read as late — all 840
 * closed in August would have scored on time.
 *
 * That is now the intended behaviour, on the user's decision of 24-09-2026:
 * RECORDING A CREDIT DECISION IS THE WORK, and every decision earns a full point
 * whether it took a day or a week. The outcome does not matter either — a hold
 * and a partial approval count exactly as an approval does, because the person
 * looked at the order and decided.
 *
 * TWO HALVES, DELIBERATELY ASYMMETRIC:
 *  · CLOSED — `creditActions` below, NOT `completedFor`. That builder reads
 *    `ccAt`, the RELEASE stamp, which a hold never writes; scoring on it would
 *    have paid for approvals and ignored every hold. It reads `ccDecidedAt` /
 *    `ccDecidedBy`, which all three outcomes write.
 *  · OPEN — still dropped as `excluded_step`. An undecided credit check charges
 *    nobody, so turning this on cannot take points away from anyone; it can only
 *    give them for work actually done. That was the condition for switching it
 *    back on at all.
 *
 * Left out:
 *  · sales_return — has no due date; the window belongs to Tally.
 *  · the orders in TEST_ORDERS below.
 */
import { fetchDispatchData, type DispatchData } from "@/apps/order-to-dispatch/data/dispatchFetch";
import {
  completedFor,
  dispatchDueIso,
  dispatchSnapshotFrom,
  type QueueStep,
} from "@/apps/order-to-dispatch/lib/queues";
import { allRoundViews } from "@/apps/order-to-dispatch/lib/rounds";
import { istDateOf } from "../month";
import { stepByKey } from "@/apps/order-to-dispatch/lib/steps";
import { dispatchWorkItems } from "@/core/workspace/mywork/items/orderToDispatch";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { heldDrop, parseItems } from "../workItems";

/** Scored through `completedFor`. credit_check is absent — see `creditActions`. */
const STEPS: QueueStep[] = ["material_status", "sales_bill", "gate_out", "dispatch_confirm"];

/** Excluded from the OPEN half only. A pending credit check charges nobody. */
const EXCLUDED: ReadonlySet<string> = new Set(["credit_check"]);

/**
 * Orders raised for training, a demo video or a build check — real people closed
 * their steps, so nothing else marks them. By order number, found 18-09-2026 from
 * their remarks ("Testing for kriti", "ZZ TEST — OD-13 …").
 */
const TEST_ORDERS: ReadonlySet<string> = new Set([
  "SO-2627-0549",
  "SO-2627-0553",
  "SO-2627-0555",
  "SO-2627-0556",
  "SO-2627-0563",
  "SO-2627-1134",
]);

const label = (k: string) => stepByKey(k)?.title ?? k;

/**
 * Every credit decision ever recorded, as a scored step worth a full point.
 *
 * ONE PER (order, round): a partial approval that sends the order back for a
 * fresh decision is two decisions and earns two points, which is right — the
 * person did the work twice. `allRoundViews` gives archived and live rounds
 * together, the same walk `completedFor` makes, so a looped order cannot be
 * counted once and lost the next time.
 *
 * ⚠ `dueIso` IS THE DECISION'S OWN DAY, so `outcomeOf` reads it as on time —
 *   that is the whole rule, not an accident of the SLA. Taking the SLA due date
 *   instead would smuggle speed back into a score the user asked to be about
 *   whether the action was taken at all.
 *
 * A round with no actor is skipped rather than credited to nobody; the runner
 * would otherwise report it as a `no_actor` drop, which reads as a fault.
 */
function creditActions(data: DispatchData): ClosedStep[] {
  const out: ClosedStep[] = [];
  for (const o of data.orders) {
    for (const v of allRoundViews(o)) {
      // The live round carries the decision stamps that a HOLD writes; an
      // archived round was released, so its own `ccAt` is when it was decided.
      const atIso = v.isArchived ? v.ccAt : (o.ccDecidedAt ?? v.ccAt);
      const actorId = v.isArchived ? v.ccBy : (o.ccDecidedBy ?? v.ccBy);
      if (!atIso || !actorId) continue;
      const dueIso = istDateOf(atIso);
      if (!dueIso) continue;
      out.push({
        stepId: `${o.id}:${v.roundNo}:credit_check`,
        entityId: o.id,
        ref: o.orderNo,
        stepKey: "credit_check",
        stepLabel: label("credit_check"),
        roundNo: v.roundNo,
        dueIso,
        actorId,
        doneAtIso: atIso,
        drop: TEST_ORDERS.has(o.orderNo) ? "test_record" : undefined,
      });
    }
  }
  return out;
}
const dropFor = (ref: string, stepKey: string): DropReason | undefined =>
  TEST_ORDERS.has(ref) ? "test_record" : EXCLUDED.has(stepKey) ? "excluded_step" : undefined;

export const orderToDispatchScorer: ModuleScorer<DispatchData> = {
  key: "order-to-dispatch",
  appId: "order-to-dispatch",
  load: () => fetchDispatchData(),

  closed(data) {
    const snap = dispatchSnapshotFrom({ orders: data.orders, stepSla: data.config.stepSla });
    const out: ClosedStep[] = [];
    for (const step of STEPS) {
      for (const e of completedFor(snap, step)) {
        out.push({
          stepId: e.id,
          entityId: e.orderId,
          ref: e.ref,
          stepKey: step,
          stepLabel: label(step),
          roundNo: e.roundNo,
          dueIso: dispatchDueIso(snap, e.row, step, e.view),
          actorId: e.actorId,
          doneAtIso: e.atIso,
          drop: dropFor(e.ref, step),
        });
      }
    }
    return out.concat(creditActions(data));
  },

  openFor(data, uid) {
    const byId = new Map(data.orders.map((o) => [o.id, o]));
    return parseItems(dispatchWorkItems(data, uid, false)).map(({ entityId, stepKey, item }): OpenStep => {
      const o = byId.get(entityId);
      const roundNo = o?.roundNo ?? 1;
      return {
        stepId: `${entityId}:${roundNo}:${stepKey}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: stepKey === "sales_return" ? "Sales Return" : label(stepKey),
        roundNo,
        dueIso: item.dueIso,
        drop: heldDrop(item) ?? dropFor(item.ref, stepKey),
      };
    });
  },
};
