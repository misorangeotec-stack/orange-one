import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchSuppliesData, suppliesQueryKey } from "@/apps/office-supplies/data/suppliesFetch";
import { buildQueueEntries, supplySnapshotFrom } from "@/apps/office-supplies/lib/queues";
import { STAGES, STEPS } from "@/apps/office-supplies/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Office Supplies FMS adapter — a row on the scoreboard.
 *
 * The counts come from `buildQueueEntries(supplySnapshotFrom(data))` — LITERALLY the
 * same two calls office-supplies/store.tsx makes, on the same react-query cache entry
 * keyed on the REAL session user id. Hand-write the snapshot a second time and the two
 * would compute different due dates from identical data.
 *
 * RLS does the scoping: a coordinator reads every request and counts everything; an
 * HOD reads only their department's requests and counts only those.
 */
export const officeSuppliesAdapter: FmsAdapter = {
  key: "office-supplies",
  name: "Office Supplies FMS",
  controlCenterPath: "/office-supplies/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: suppliesQueryKey(userId),
      queryFn: fetchSuppliesData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              buildQueueEntries(supplySnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla })),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
