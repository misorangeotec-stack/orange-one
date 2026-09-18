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
 * Left out:
 *  · credit_check (excluded_step). Deciding credit restarts its own clock at the
 *    decision (`cc_decided_at` is written with `cc_at`), so a decided check is
 *    always due the day after it was done and can never read as late — all 840
 *    closed in August would score on time. Out, both ways, until the module keeps
 *    the original clock start. The user's decision, 18-09-2026.
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
import { stepByKey } from "@/apps/order-to-dispatch/lib/steps";
import { dispatchWorkItems } from "@/core/workspace/mywork/items/orderToDispatch";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const STEPS: QueueStep[] = ["credit_check", "material_status", "sales_bill", "gate_out", "dispatch_confirm"];
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
    return out;
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
        drop: dropFor(item.ref, stepKey),
      };
    });
  },
};
