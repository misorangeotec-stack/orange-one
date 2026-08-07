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
 * ⚠ OWNERSHIP HERE IS PER LOCATION, so this does NOT use the shared
 *   `isMineByStepOwners`. That helper answers "is this user in the one owner row
 *   for this step", which is exactly right for HR, Exit and Purchase — none of
 *   which have locations — and wrong here twice over: dispatch now has SEVERAL
 *   rows per step, so its `.find()` would silently pick whichever came first,
 *   and owning gate-out at Vapi should not put an Ahmedabad order on your list.
 *   `ownsStepAt` below is the local rule and mirrors `fms_dispatch_is_step_owner`.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchDispatchData, dispatchQueryKey } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { buildQueueEntries, dispatchSnapshotFrom } from "@/apps/order-to-dispatch/lib/queues";
import { stepByKey } from "@/apps/order-to-dispatch/lib/steps";
import type { StepOwner } from "@/apps/order-to-dispatch/types";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

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
      .filter((e) => isAdmin || ownsStepAt(e.stepKey, orderById.get(e.orderId)?.locationId ?? null, uid, owners))
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
              ].filter(Boolean).join(" · ")
            : undefined,
          stage: stepByKey(e.stepKey)?.short,
          dueIso: e.dueIso,
          to: `/order-to-dispatch/orders/${e.orderId}`,
          assignment: ownsStepAt(e.stepKey, o?.locationId ?? null, uid, owners)
            ? ("direct" as const)
            : ("team" as const),
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
