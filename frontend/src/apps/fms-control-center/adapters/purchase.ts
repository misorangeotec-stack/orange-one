import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchProcurementData, procurementQueryKey } from "@/apps/procurement/data/procFetch";
import { buildQueueEntries } from "@/apps/procurement/lib/queues";
import { STEPS } from "@/apps/procurement/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Purchase FMS adapter.
 *
 * Counts come from `buildQueueEntries` — the exact predicates the per-step queue
 * pages use — so this scoreboard cannot drift from those pages.
 *
 * The query key matches `procurement/store.tsx` exactly (same helper, same REAL
 * session user id), so react-query serves both from one cache entry: no second
 * copy of the ~25 table reads, and the data is already warm if the user has
 * visited Purchase FMS this session.
 */
export const purchaseAdapter: FmsAdapter = {
  key: "purchase",
  appId: "procurement",
  name: appName("procurement"),
  controlCenterPath: "/procurement/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: procurementQueryKey(userId),
      queryFn: fetchProcurementData,
      enabled: !!userId,
    });
    const snapshot = useMemo(() => (data ? snapshotFrom(buildQueueEntries(data), STEPS) : null), [data]);
    return { snapshot, isLoading, error };
  },
};
