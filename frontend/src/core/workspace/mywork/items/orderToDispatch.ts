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
import { buildHeldEntries, buildQueueEntries, dispatchSnapshotFrom } from "@/apps/order-to-dispatch/lib/queues";
import { stepByKey } from "@/apps/order-to-dispatch/lib/steps";
import { STEP_STATUS } from "@/apps/order-to-dispatch/lib/format";
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

  /**
   * (order, step) → whoever it has been REASSIGNED to.
   *
   * ⚠ AN ASSIGNEE REPLACES ownsStepAt for that one order's step - it does not add
   *   to it. A reassignment MOVES the step, so it has to leave the location
   *   owner's My Work list and their line of the daily mail. Every OTHER order at
   *   that location stays theirs, which is why this is keyed on the order.
   */
  const assigneeByKey = new Map(
    (data.stepAssignees ?? []).map((a) => [`${a.orderId}|${a.stepKey}`, a.assignedTo]),
  );
  const mine = (stepKey: string, orderId: string, locationId: string | null): boolean => {
    const assignee = assigneeByKey.get(`${orderId}|${stepKey}`);
    if (assignee) return assignee === uid;
    return ownsStepAt(stepKey, locationId, uid, owners);
  };

  const snap = dispatchSnapshotFrom({ orders: data.orders, stepSla: data.config.stepSla });

  /**
   * THIS MODULE HAS TWO KINDS OF HOLD, and both belong on the hold tile.
   *
   *  1. ORDER-LEVEL (`status === "on_hold"`) — pulls the order out of every
   *     queue, so `buildHeldEntries` puts it back at the step it is parked at.
   *
   *  2. STEP-LEVEL (`STEP_STATUS` in lib/format.ts) — a credit hold, a parked
   *     invoice, or an order waiting on the balance of a PARTIAL credit
   *     approval. These deliberately LEAVE THE ORDER EXACTLY WHERE IT IS: it
   *     stays in its queue, still owed by the same desk, still accruing days
   *     against its due date. That is right for the step queue, which is the
   *     desk's own worklist, but it is what made a shelf of deliberately parked
   *     orders read as overdue here — the reason this tile was asked for.
   *
   * Read off `STEP_STATUS`, which is also what the step queue's Status column
   * reads, so the words on this screen and the words on that one cannot drift.
   * Its `rank` is the test: 0 = held, 1 = waiting on a partial balance, and both
   * are parked. Rank 2 is an approved order genuinely moving, and is NOT parked.
   */
  const stepParked = (
    stepKey: string,
    orderId: string,
  ): { isHeld: true; holdLabel: string; holdReason: string | null } | null => {
    const rule = STEP_STATUS[stepKey as keyof typeof STEP_STATUS];
    const o = orderById.get(orderId);
    if (!rule || !o) return null;
    const v = rule(o);
    if (!v || v.rank > 1) return null;
    return { isHeld: true, holdLabel: v.label, holdReason: v.reason?.trim() || null };
  };

  const entries = [
    ...buildQueueEntries(snap).map((e) => ({ e, held: false })),
    ...buildHeldEntries(snap).map((e) => ({ e, held: true })),
  ];

  return entries
    .filter(
      ({ e }) =>
        isAdmin || mine(e.stepKey, e.orderId, orderById.get(e.orderId)?.locationId ?? null),
    )
    .map(({ e, held }) => {
      const o = orderById.get(e.orderId);
      // Order-level hold wins if both are somehow live; either way it is parked.
      const parked = held ? { isHeld: true, holdReason: o?.holdReason ?? null } : stepParked(e.stepKey, e.orderId);
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
        assignment: mine(e.stepKey, e.orderId, o?.locationId ?? null)
          ? ("direct" as const)
          : ("team" as const),
        isApproval: false,
        ...(parked ?? {}),
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
            (isAdmin || mine("sales_return", o.id, o.locationId)),
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
