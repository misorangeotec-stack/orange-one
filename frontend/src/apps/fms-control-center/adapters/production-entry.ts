import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchProductionData, productionQueryKey } from "@/apps/production-entry/data/productionFetch";
import { buildQueueEntries, productionSnapshotFrom } from "@/apps/production-entry/lib/queues";
import { STAGES, STEPS } from "@/apps/production-entry/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Production Entry FMS adapter — a row on the scoreboard.
 *
 * The counts come from `buildQueueEntries(productionSnapshotFrom(data))` —
 * LITERALLY the same two calls production-entry/store.tsx makes, on the same
 * react-query cache entry keyed on the REAL session user id, so the scoreboard
 * can never drift from the app.
 */
export const productionEntryAdapter: FmsAdapter = {
  key: "production-entry",
  appId: "production-entry",
  name: appName("production-entry"),
  controlCenterPath: "/production-entry/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: productionQueryKey(userId),
      queryFn: fetchProductionData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              buildQueueEntries(productionSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla })),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
