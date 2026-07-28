import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchDispatchData, dispatchQueryKey } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { buildQueueEntries, dispatchSnapshotFrom } from "@/apps/order-to-dispatch/lib/queues";
import { STAGES, STEPS } from "@/apps/order-to-dispatch/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Order to Dispatch FMS adapter — a row on the scoreboard.
 *
 * The counts come from `buildQueueEntries(dispatchSnapshotFrom(data))` — LITERALLY
 * the same two calls order-to-dispatch/store.tsx makes, on the same react-query
 * cache entry keyed on the REAL session user id, so the scoreboard can never drift
 * from the app.
 */
export const orderToDispatchAdapter: FmsAdapter = {
  key: "order-to-dispatch",
  appId: "order-to-dispatch",
  name: appName("order-to-dispatch"),
  controlCenterPath: "/order-to-dispatch/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: dispatchQueryKey(userId),
      queryFn: fetchDispatchData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              buildQueueEntries(dispatchSnapshotFrom({ orders: data.orders, stepSla: data.config.stepSla })),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
