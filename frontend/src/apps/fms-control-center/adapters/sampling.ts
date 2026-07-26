import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchSamplingData, samplingQueryKey } from "@/apps/sampling/data/samplingFetch";
import { buildQueueEntries, samplingSnapshotFrom } from "@/apps/sampling/lib/queues";
import { STAGES, STEPS } from "@/apps/sampling/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Sampling FMS adapter — a row on the scoreboard.
 *
 * The counts come from `buildQueueEntries(samplingSnapshotFrom(data))` — LITERALLY
 * the same two calls sampling/store.tsx makes, on the same react-query cache entry
 * keyed on the REAL session user id. Hand-write the snapshot a second time and the
 * two would compute different due dates from identical data.
 */
export const samplingAdapter: FmsAdapter = {
  key: "sampling",
  appId: "sampling",
  name: appName("sampling"),
  controlCenterPath: "/sampling/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: samplingQueryKey(userId),
      queryFn: fetchSamplingData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              buildQueueEntries(samplingSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla })),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
