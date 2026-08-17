/**
 * Order to Dispatch → work items. See ./README.md.
 *
 * An order sits at exactly one open step (derived from its `status`), so it can
 * never appear twice. There are NO approval steps in this flow.
 *
 * ⚠ OWNERSHIP HERE IS PER LOCATION, so this does NOT use the shared
 *   `isMineByStepOwners`. That helper answers "is this user in the one owner row
 *   for this step", which is right for HR, Exit and General Purchase — none of
 *   which have locations — and wrong here twice over: dispatch has SEVERAL rows
 *   per step, so its `.find()` would silently pick whichever came first, and
 *   owning gate-out at Vapi should not put an Ahmedabad order on your list.
 *   `ownsStepAt` mirrors `fms_dispatch_is_step_owner`.
 */
import { appName } from "@/apps/appInfo";
import type { DispatchData } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { buildQueueEntries, dispatchSnapshotFrom } from "@/apps/order-to-dispatch/lib/queues";
import { stepByKey } from "@/apps/order-to-dispatch/lib/steps";
import type { StepOwner } from "@/apps/order-to-dispatch/types";
import type { WorkItem } from "../types";

/**
 * Does `uid` own `stepKey` at `locationId`? A row with a null location is the
 * fallback grant and covers every site.
 */
const ownsStepAt = (
  stepKey: string,
  locationId: string | null,
  uid: string,
  owners: StepOwner[],
): boolean =>
  owners.some(
    (o) =>
      o.stepKey === stepKey &&
      o.employeeIds.includes(uid) &&
      (o.locationId === null || o.locationId === locationId),
  );

export function dispatchWorkItems(data: DispatchData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = data.stepOwners;
  const orderById = new Map(data.orders.map((o) => [o.id, o]));

  return buildQueueEntries(
    dispatchSnapshotFrom({ orders: data.orders, stepSla: data.config.stepSla }),
  )
    .filter(
      (e) =>
        isAdmin || ownsStepAt(e.stepKey, orderById.get(e.orderId)?.locationId ?? null, uid, owners),
    )
    .map((e) => {
      const o = orderById.get(e.orderId);
      return {
        id: `order-to-dispatch:${e.orderId}:${e.stepKey}`,
        source: "order-to-dispatch",
        sourceLabel: appName("order-to-dispatch"),
        ref: e.ref,
        detail: o
          ? [
              `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`,
              o.roundNo > 1 ? `round ${o.roundNo}` : null,
              // The customer's own reference, which is how they will refer to it.
              o.customerPoNo ? `PO ${o.customerPoNo}` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: `/order-to-dispatch/orders/${e.orderId}`,
        assignment: ownsStepAt(e.stepKey, o?.locationId ?? null, uid, owners)
          ? ("direct" as const)
          : ("team" as const),
        isApproval: false,
      };
    })
    /*
      The Sales Return step, appended LOCALLY.

      It is not a `QueueEntry` and must not become one: `buildQueueEntries` is the
      shared builder this file, the dispatch store and the FMS Control Center all
      read, and putting a cancelled order through it would make every cancellation
      count as open work on the six-step scoreboards. So the rule is restated here,
      over ten lines, rather than widened there.

      No due date — the window belongs to Tally, not to an SLA this app sets — so
      these land in the "No date set" tile.
    */
    .concat(
      data.orders
        .filter(
          (o) =>
            o.status === "awaiting_sales_return" &&
            o.srAt == null &&
            (isAdmin || ownsStepAt("sales_return", o.locationId, uid, owners)),
        )
        .map((o) => ({
          id: `order-to-dispatch:${o.id}:sales_return`,
          source: "order-to-dispatch",
          sourceLabel: appName("order-to-dispatch"),
          ref: o.orderNo,
          detail: [
            o.srInvoiceNo ? `invoice ${o.srInvoiceNo}` : null,
            "cancel the bill in Tally or punch a sales return",
          ]
            .filter(Boolean)
            .join(" · "),
          stage: "Sales Return",
          dueIso: null,
          to: `/order-to-dispatch/orders/${o.id}`,
          assignment: ownsStepAt("sales_return", o.locationId, uid, owners)
            ? ("direct" as const)
            : ("team" as const),
          isApproval: false,
        })),
    );
}
