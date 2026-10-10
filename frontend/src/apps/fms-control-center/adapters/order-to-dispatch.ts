import { useMemo } from "react";
import { appName } from "@/apps/appInfo";
import { useDispatchOpenWork } from "@/apps/order-to-dispatch/data/useDispatchOpenWork";
import { buildQueueEntries, dispatchSnapshotFrom } from "@/apps/order-to-dispatch/lib/queues";
import { STAGES, STEPS } from "@/apps/order-to-dispatch/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Order to Dispatch FMS adapter — a row on the scoreboard.
 *
 * The counts come from `buildQueueEntries(dispatchSnapshotFrom(data))` — LITERALLY
 * the same two calls order-to-dispatch/store.tsx makes, so the scoreboard can never
 * drift from the app.
 *
 * ⚠ PENDING ORDERS ONLY (PERF-2). `buildQueueEntries` skips every closed or
 *   cancelled order, so the scoreboard never needed them; `useDispatchOpenWork`
 *   reuses the module's full copy when one is fresh, and loads only pending
 *   orders otherwise.
 */
export const orderToDispatchAdapter: FmsAdapter = {
  key: "order-to-dispatch",
  appId: "order-to-dispatch",
  name: appName("order-to-dispatch"),
  controlCenterPath: "/order-to-dispatch/monitoring",
  status: "live",
  useSnapshot() {
    const { data, isLoading, error } = useDispatchOpenWork(true);
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
