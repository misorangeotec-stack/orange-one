/**
 * Order to Dispatch FMS → My Work.
 *
 * Uses `buildQueueEntries(dispatchSnapshotFrom(...))` — the same two calls the
 * dispatch store and the FMS Control Center make, on the same cache entry.
 *
 * An order sits at exactly one open step (derived from its `status`), so it can
 * never appear twice here. There are NO approval steps in this flow — isApproval
 * is always false.
 *
 * The delivery-confirmation step has one extra owner the step-owner list does not
 * know about: the portal user linked to the order's driver. That mirrors
 * `fms_dispatch_can_act`, so a driver sees their own delivery on this screen.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchDispatchData, dispatchQueryKey } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { buildQueueEntries, dispatchSnapshotFrom } from "@/apps/order-to-dispatch/lib/queues";
import { stepByKey } from "@/apps/order-to-dispatch/lib/steps";
import { isMineByStepOwners } from "@/shared/lib/fmsOwners";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useDispatchWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: dispatchQueryKey(uid),
    queryFn: fetchDispatchData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const owners = data.stepOwners;
    const orderById = new Map(data.orders.map((o) => [o.id, o]));
    /*
     * The delivery step used to have an extra arm for the driver named on the
     * order. It is gone with the Drivers master — delivery confirmation now
     * needs a configured step owner like every other step.
     */

    return buildQueueEntries(dispatchSnapshotFrom({ orders: data.orders, stepSla: data.config.stepSla }))
      .filter((e) => isAdmin || isMineByStepOwners(e.stepKey, uid, owners))
      .map((e) => {
        const o = orderById.get(e.orderId);
        return {
          id: `order-to-dispatch:${e.orderId}:${e.stepKey}`,
          source: "order-to-dispatch",
          sourceLabel: appName("order-to-dispatch"),
          ref: e.ref,
          detail: o
            ? `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}${o.roundNo > 1 ? ` · round ${o.roundNo}` : ""}`
            : undefined,
          stage: stepByKey(e.stepKey)?.short,
          dueIso: e.dueIso,
          to: `/order-to-dispatch/orders/${e.orderId}`,
          assignment: isMineByStepOwners(e.stepKey, uid, owners) ? ("direct" as const) : ("team" as const),
          isApproval: false,
        };
      });
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const orderToDispatchProvider: MyWorkProvider = {
  key: "order-to-dispatch",
  label: appName("order-to-dispatch"),
  appId: "order-to-dispatch",
  category: "sales",
  unit: "steps",
  tier: 2,
  useMyWork: useDispatchWork,
};
